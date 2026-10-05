/**
 * 物理链页（与「画布」并列的那一页）。
 *
 * **复用第一页的前端模板，但不复用它的数据。**
 *   · 模板：同一个 `GraphCanvas`（取景/缩放/选中/标签高亮）、同一个右侧 `Inspector`、
 *     同一套抽屉（`CodePreviewDrawer` 看源码、`MdReaderDrawer` 看文档）。
 *   · 数据：这一页有自己的数据源（`GraphSourceProvider`，读生成物里的图 + 本地选中/标签），
 *     **不碰画布那个共享 store** —— 所以两边数据彻底分开，物理链的坐标不可能写进画布的数据里。
 *
 * 三条硬规矩：
 *   1. **只读**：这张图由生成物驱动（真源 `docs/notes/physics-chain/chain.json`），页面上的
 *      编辑动作一律说明"只读"，不假装能用（文案见 `lib/physicsChainNotice`）。
 *      **唯一的例外是节点摆放**：拖开一个节点只改本机，按保存（顶栏按钮 / Ctrl/Cmd + S）
 *      写回 `data/chain-layout.json`，下次打开照它显示（见 `state/chainLayoutStore`）。
 *   2. **首屏只有物理**：一级只有 11 个块（10 个天体物理过程 + 1 个层）；工程节点（"实现细节"）贴在块**内部**的成员层，
 *      走进块才出现——检索命中时会标出来源，但不因此把工程项提到一级来。
 *   3. 视图只读生成物：块的成员/接口、参数、开关、落点全部来自 `physics-chain.json`，界面不写死。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { toast } from 'sonner'
import chainArtifact from '../generated/physics-chain.json'
import { GraphCanvas, type CanvasApi } from './GraphCanvas'
import { Inspector, type BlockDetail } from './Inspector'
import { CodePreviewDrawer } from './CodePreviewDrawer'
import { MdReaderDrawer } from './MdReaderDrawer'
import { GraphSourceProvider, type GraphSource } from '../graph/graphSource'
import { TabBar } from './TabBar'
/** 标签页的形状直接取自 `TabBar` 的入参（TabBar 没导出它的类型，也不猜字段） */
type TabInfo = ComponentProps<typeof TabBar>['tabs'][number]
import { type Graph, type GraphRef, type NodeType, type Selection, type SelectionKind } from '../lib/types'
import { SHOW_CROSS_REDSHIFT_FEEDBACK_KEY, readBooleanPreference, writeBooleanPreference } from '../lib/viewPreferences'
import { readOnlyNotice } from '../lib/physicsChainNotice'
import { useChainLayoutStore } from '../state/chainLayoutStore'
import type { LayoutKind } from '../graph/layout'
import {
  CHAIN_GRAPH,
  PARAM_GROUP_FALLBACK,
  blockOf,
  chainBlocks,
  chainProcessEntries,
  chainProcessNote,
  paramBlocks,
  paramClassGroups,
  paramAbsenceReason,
  paramEntryOf,
  paramGateLabels,
  paramGatedNodes,
  paramMatrixOf,
  paramTouchedNodes,
  paramsOfProcess,
  processUncovered,
  processesOf,
  searchChain,
  subgraphSizeOf,
  type ChainHit,
} from '../lib/physicsChain'
import { ChainSearchPanel, type ChainPanelTab, type ChainParamEffect } from './ChainSearchPanel'
import { ResizeHandle } from './ResizeHandle'
import { PANEL_RAIL_WIDTH, usePanelWidth } from '../hooks/usePanelWidth'

/**
 * 图例里**不列**的要素种类：只有段容器（`group`）——它是装饰，不是要素种类
 * （`graphify-physics-chain` 的「段容器不参与图例与标签」）。常数在模块级：引用稳定，
 * 图例那段的 `useMemo` 才不会每次渲染都重算。
 */
const LEGEND_HIDDEN_TYPES: NodeType[] = ['group']

/**
 * 生成物里这一页另外要读的那一段：效应开关（`gatesEdges` 就是它门控的那几条边，
 * "开关写在箭头上"的依据）。参数词条清单不再从这里手抄数组了——见 `paramClassGroups()`。
 */
const ARTIFACT = chainArtifact as unknown as {
  params: {
    /** 效应开关：`gatesEdges` 就是它门控的那几条边（"开关写在箭头上"的依据） */
    effects: { name: string; role?: string; default?: unknown; gatesEdges?: string[] }[]
  }
}

/** 左栏（检索与词条）默认宽度：与画布页的 notes 数据库同一档，装得下参数名 + 两列说明 */
const SEARCH_PANEL_DEFAULT_WIDTH = 304

/**
 * 这里原先拼过块的**代码锚**人话（属性页那一行"这块在代码里是什么"）。
 * 已撤：那一行点不开、给不出可核验的落点；
 * 块算在哪段代码里改由「源码」标签页的落点清单回答（文件 + 行区间，可点即开）。
 * 生成物里的 `codeAnchor` 字段仍保留——它是"块与代码同构"的可证伪依据，被自检逐条断言。
 */

/**
 * 检查器里点话题 pill 的说明：这一页**不再按话题分层**，也没有话题过滤。
 *
 * 一级只讲 11 个块（10 个天体物理过程 + 1 个层）；「实现细节」这类工程节点贴在块**内部**的成员层，
 * 走进那个块才看得到（检索命中时会标出来源）。所以这里只解释一句——
 * 点了却什么都没变，比不响应更糟。
 */
const explainTopic = () =>
  toast.info('这一页不按话题分层', {
    description:
      '一级只讲 11 个块（10 个天体物理过程 + 1 个层）；「实现细节」这类工程节点贴在块内部的成员层，走进那个块才看得到（检索命中时会标出来源）。',
  })

/** 顶栏检索的一次性定位请求；`nonce` 让"再点一次同一条结果"也能重新定位 */
export interface ChainFocusRequest {
  kind: 'node' | 'edge'
  id: string
  nonce: number
}

interface PhysicsChainViewProps {
  /** 一次性定位请求（顶栏检索给出，由本页消费）；按 `nonce` 去重 */
  focus?: ChainFocusRequest | null
  /** 把「当前选中的对象名」报给 App（状态条要显示它） */
  onSelectionChange?: (label: string | null) => void
}

export function PhysicsChainView({ focus, onSelectionChange }: PhysicsChainViewProps) {
  /* -------- 这一页自己的数据：本地选中、本地标签，不借画布的 store -------- */
  const [selection, setSelection] = useState<Selection>({ kind: null, id: null })
  const [activeTagIds, setActiveTagIds] = useState<string[]>([])
  const [hoveredNodeId, setHovered] = useState<string | null>(null)
  const [hiddenRelationIds, setHiddenRelationIds] = useState<string[]>([])
  const select = useCallback((kind: SelectionKind, id: string | null) => setSelection({ kind, id }), [])

  /**
   * **跨红移回流开关**（默认关）。
   *
   * 它管的是产物里标为回流的那几条边（下一轮指回上一轮）：关着时整条不画，所以主序图上没有回指的箭头。
   * 管的是这件事的**全部视图面**——一级上"上一轮送出它的块 → 这一步读它的块"那条弧，以及它在弧两端块
   * 子图里落成的成员级边（连同落点那些盒子），三样同进同出。
   * 状态留在这一页——本页不碰画布的共享 store（见文件头"三条硬规矩"），所以不借它，只在挂载时读一次
   * 本机偏好、切换时写回去；口径与「面板宽度」「收起的关系」一致：只记界面偏好，不进图谱数据、
   * 不进撤销栈、也不会被保存带进产物。存储不可用或内容损坏时，读回来的就是默认关，页照常渲染。
   */
  const [showFeedback, setShowFeedback] = useState(() => readBooleanPreference(SHOW_CROSS_REDSHIFT_FEEDBACK_KEY))
  /** 产物里的回流边：条数报给浮层上的开关，不写死（产物里没有这类边时开关会说明原因，而不是摆个空开关） */
  const feedbackEdges = useMemo(() => CHAIN_GRAPH.edges.filter((edge) => edge.kind === 'feedback'), [])
  const applyFeedback = useCallback((next: boolean) => {
    setShowFeedback(next)
    writeBooleanPreference(SHOW_CROSS_REDSHIFT_FEEDBACK_KEY, next)
  }, [])

  /**
   * **回流在子图里的落点**（一级讲回声，进到块里还要能指着两个量说）。
   *
   * 产物里每条回流边记的是**两端块**（弧画在一级），而 `fromNode` / `toNode` 记着两端的量：
   * 一级上是"上一轮送出它的那块 → 这一步读它的那块"一条弧，归浮层上那个开关管。
   * 进到子图里，这条关系落在**成员级**，方向不变（`fromNode → toNode`），但在两端块的子图里语义不同：
   *   · 收方块那侧：它是这一块的**对外输入**——这一步的参数表里真的收上一轮的那个量；
   *   · 来源块那侧：它是这一块的**对外输出**——上一轮算出的那个量被别的块读走。
   * 所以每条弧派生**两条**落点边（同一个端点对、同一档样式），各声明给弧的一端块（`subgraphOf`），
   * 把两侧不在场的那个量并进那一块的对外输入去灰显——否则这条边在那一侧根本没有第二个端点。
   *
   * 端点与方向全从产物算，页面不写死块名与量名；**产物与生成物一个字节都不动**。
   * 标签留空：落点边两端就是那两个量盒（`T_S(z)` → `Ṅ_ion(z)`），箭头上的文字只写跨块交付的量名
   * （见 [G4 §3.2](../../../docs/notes/graphify/G4-物理链.md)），这里写了就是重复盒子名。
   *
   * 落点是同一件事的另两个视图面，显隐仍归浮层上那个开关：这里只标出"它落在哪一块、来处与去处是哪个量"
   * （`subgraphOf` 与 `inputOf` / `outputOf`），渲染器按开关切类名。投影因此与开关状态无关——
   * 开合不增删元素、不动坐标。
   */
  const feedbackInputs = useMemo(() => {
    const arcs = CHAIN_GRAPH.edges.filter((edge) => edge.kind === 'feedback' && edge.fromNode && edge.toNode)
    const edges = arcs.flatMap((arc) => {
      const shared = {
        source: arc.fromNode as string,
        target: arc.toNode as string,
        label: '',
        type: arc.type,
        directed: arc.directed,
        kind: 'feedback-input' as const,
        // 子图里就这三个盒子，不必绕开树脊；鼓起来的弧线留给一级上那两条
        crossLink: false,
        fromNode: arc.fromNode,
        toNode: arc.toNode,
        createdAt: arc.createdAt,
        updatedAt: arc.updatedAt,
      }
      return [
        { ...shared, id: `${arc.id}#input`, note: `跨红移回流（读进来的那一侧）：${arc.note}`, subgraphOf: arc.target },
        { ...shared, id: `${arc.id}#output`, note: `跨红移回流（送出去的那一侧）：${arc.note}`, subgraphOf: arc.source },
      ]
    })
    /** 收方块 → 它从上一轮读到的那些量（并进对外输入：子图里灰显，属性页写明来处） */
    const readFromLastRound = new Map<string, string[]>()
    /** 来源块 → 它上一轮送出去、被别的块读走的那些量（并进对外输入去灰显，属性页写明去处） */
    const sentToNextRound = new Map<string, string[]>()
    const push = (map: Map<string, string[]>, key: string, value: string) => {
      const list = map.get(key) ?? []
      if (!list.includes(value)) list.push(value)
      map.set(key, list)
    }
    for (const arc of arcs) {
      push(readFromLastRound, arc.target, arc.fromNode as string)
      push(sentToNextRound, arc.source, arc.toNode as string)
    }
    /** 本块自己声明的对外输入：它进这一块不是回流的功劳（关掉开关它仍该在场） */
    const declaredOf = (blockId: string) =>
      new Set(CHAIN_GRAPH.nodes.find((node) => node.id === blockId)?.contexts ?? [])
    /**
     * 量 → "它进这一块只因落在回流上"的那些块（值是块 id）：来处与去处各一份，
     * 渲染器按当前聚焦的块判该不该让开关一并管着这个盒子（见 `feedbackInputOf` / `feedbackOutputOf`）。
     */
    const inputOf = new Map<string, string[]>()
    const outputOf = new Map<string, string[]>()
    for (const arc of arcs) {
      if (!declaredOf(arc.target).has(arc.fromNode as string)) push(inputOf, arc.fromNode as string, arc.target)
      if (!declaredOf(arc.source).has(arc.toNode as string)) push(outputOf, arc.toNode as string, arc.source)
    }
    return { edges, readFromLastRound, sentToNextRound, inputOf, outputOf }
  }, [])

  /**
   * **手动摆放**（`state/chainLayoutStore`）：盘上那份覆盖层 + 本机改了还没保存的那份。
   * 这里只做一件事——把它叠在生成物烘好的坐标上；页面挂载时读一次盘上那份。
   *
   * 拖完一个节点只记在本机（`onPositionsSettled`），按保存才写盘（按钮 / Ctrl/Cmd + S）。
   * 与画布同一条路：不自动写盘，也就不会有"以为存了其实没存"的错觉。
   */
  const savedChainPositions = useChainLayoutStore((state) => state.saved)
  const pendingChainPositions = useChainLayoutStore((state) => state.pending)
  const noteChainPositions = useChainLayoutStore((state) => state.notePositions)
  const loadChainLayout = useChainLayoutStore((state) => state.load)
  /** 覆盖层优先于生成物的坐标；没记过的节点照生成物摆 */
  const chainPositions = useMemo(
    () => ({ ...savedChainPositions, ...pendingChainPositions }),
    [savedChainPositions, pendingChainPositions],
  )
  useEffect(() => {
    void loadChainLayout()
  }, [loadChainLayout])

  /**
   * 本页的图 = 产物 + 上面那份投影（**不写回产物**）：画布页读的还是 `data/graph.json`，与这里无关。
   * 并进对外输入只动视图的可见集与灰显样式——不复制节点、`parent` 不变，主图与层级计数都不受影响。
   * 回流的两端另标一份（`feedbackInputOf` / `feedbackOutputOf`）：它们是投影的一部分，
   * **与开关状态无关**，开合只让渲染器切类名。
   */
  const pageGraph = useMemo<Graph>(
    () => ({
      ...CHAIN_GRAPH,
      nodes: CHAIN_GRAPH.nodes.map((node) => {
        const readIn = feedbackInputs.readFromLastRound.get(node.id)
        const sentOut = feedbackInputs.sentToNextRound.get(node.id)
        const inputOf = feedbackInputs.inputOf.get(node.id)
        const outputOf = feedbackInputs.outputOf.get(node.id)
        /**
         * 并进对外输入的两端量，**先去重**：本块可能早就声明了它（电离场声明了 `Ṅ_ion`，
         * 同时上一轮又把 `Ṅ_ion` 送了出去），重复并进去会在属性页的清单里列两遍。
         */
        const extra = [...(readIn ?? []), ...(sentOut ?? [])].filter((id) => !(node.contexts ?? []).includes(id))
        return {
          ...node,
          /**
           * 手摆坐标：本机记下的（`chainLayoutStore`）盖住生成物那一份。
           * **只有位置来自本机**，块与连线的其余字段逐字来自生成物。
           */
          ...(chainPositions[node.id] ? { position: chainPositions[node.id] } : {}),
          ...(extra.length ? { contexts: [...(node.contexts ?? []), ...extra] } : {}),
          ...(inputOf ? { feedbackInputOf: inputOf } : {}),
          ...(outputOf ? { feedbackOutputOf: outputOf } : {}),
        }
      }),
      edges: [...CHAIN_GRAPH.edges, ...feedbackInputs.edges],
    }),
    [feedbackInputs, chainPositions],
  )
  const source: GraphSource = useMemo(
    () => ({
      graph: pageGraph,
      selection,
      select,
      hoveredNodeId,
      setHovered,
      activeTagIds,
      hiddenRelationIds,
      toggleHiddenRelations: (nodeId: string) =>
        setHiddenRelationIds((ids) => (ids.includes(nodeId) ? ids.filter((item) => item !== nodeId) : [...ids, nodeId])),
      // 点画布空白：清选中，并熄灭本页四个来源的点亮（参数 / 过程词条、检索命中、点红点）
      clearHighlight: () => {
        select(null, null)
        setActiveParam(null)
        setActiveProcess(null)
        setActiveTagIds([])
      },
    }),
    [pageGraph, selection, select, hoveredNodeId, activeTagIds, hiddenRelationIds],
  )

  /* -------- 视图状态 -------- */
  /**
   * **手动摆放**：用生成物里那套"观测量在上、参数在下"的坐标。
   * 不用自动排布的原因：画布在"待排布"时会**跳过取景**（`if (!willPlace && active && !layoutIfPending()) fit()`），
   * 而布局本身一律不取景（`layout.ts` 写明"取景交给 fit()"）——于是初始大小与视野都会不对。
   */
  const [layout, setLayout] = useState<LayoutKind>('manual')
  const labelOf = useCallback((id: string) => CHAIN_GRAPH.nodes.find((node) => node.id === id)?.label ?? id, [])

  /**
   * **子图（块）**：与画布页同一套做法——双击一个块就"进"到它里面（画布聚焦到该块），
   * 顶部标签条记着走过的层级，可以来回切。
   *
   * 「层」（常数与网格）**不提供进入**：它没有一条自己的主序流
   * （`enterable` 由生成物按真源的 `kind` 给出：层一定为假）。拦在这里并说明一句，
   * 而不是让画布进去或"点了没反应"。
   */
  const [tabs, setTabs] = useState<TabInfo[]>([{ id: 'chain:root', focusId: null, label: '物理链' }])
  const [activeTabId, setActiveTabId] = useState('chain:root')
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const openSubgraph = useCallback(
    (nodeId: string) => {
      const block = blockOf(nodeId)
      if (block && !block.enterable) {
        toast.info(`「${block.label}」是一层，不是一个过程`, {
          description: `${block.memberCount} 个成员横切在主序各块之间（L0 是常数与网格、L1 是公共头文件），进去没有一条属于它自己的流；它们的事实读右侧属性栏。`,
        })
        return
      }
      /**
       * **没有子图的对象不给进**：进去是一张空画布，比"点了没反应"更糟。
       * 判据与「进入子图 ↗」旁边那个数字**同源**（`subgraphSizeOf`），两处不会各说各话。
       * 而函数那一级不上图之后，**成员一律没有子图**（design.md D1）——它由哪几行算出，
       * 读它的「源码」标签页与那篇模块文档的工程一节（实现步骤在那里逐个小节列出）。
       */
      if (subgraphSizeOf(nodeId) === 0) {
        toast.info(`「${labelOf(nodeId)}」没有子图`, {
          description:
            '物理链的底就是量与过程：它下面是函数，那是"这个量由哪几行算出"的问题——读它的「源码」标签页与那篇文档的工程一节。',
        })
        return
      }
      const id = `chain:${nodeId}`
      setTabs((list) => (list.some((tab) => tab.id === id) ? list : [...list, { id, focusId: nodeId, label: labelOf(nodeId) }]))
      setActiveTabId(id)
    },
    [labelOf],
  )

  /**
   * 命中/选中一个块里的对象时，把它**摆到看得见的地方**：它所在的块可进入就进那个块。
   * 一级已经没有折叠条可展开了——工程项本来就不在一级，它在某个块的成员层里。
   */
  const revealNode = useCallback(
    (nodeId: string) => {
      const block = blockOf(nodeId)
      if (block?.enterable) openSubgraph(block.id)
    },
    [openSubgraph],
  )

  /**
   * 选中一个对象，并处理"选中了却看不见"这一种情形。
   *
   * 三条通路都会选中画布上**静息不画**的边：接口边（`focusOnly`，悬浮两端块才显现）、
   * 被上面这个开关藏起来的回流关系（一级那条弧与它在子图里的两端落点），以及只在某一个块标签页里画的边。
   * 而点这些入口时指针根本不在画布上，没有悬浮这一步，所以这里顺手把它的显形条件补上——
   * 接口边靠把所在块"悬"起来（见 `onSelectRelation`），回流关系当场打开开关（并把口径记进本机偏好：
   * 既然在看回流，开关就该是开的），落点则先把它所声明的那一块摆到眼前。
   */
  const selectWithReveal = useCallback(
    (kind: SelectionKind, id: string | null) => {
      select(kind, id)
      if (!id) return
      if (kind === 'edge') {
        const landing = feedbackInputs.edges.find((edge) => edge.id === id)
        // 落点只在自己声明的那一块里显形：先把它摆到眼前（收方块侧 / 来源块侧各一条）
        if (landing?.subgraphOf) openSubgraph(landing.subgraphOf)
        // 一级那条弧与它的落点同归开关管：点中即打开，不出现"选中了一条看不见的边"
        const isFeedback =
          Boolean(landing) || CHAIN_GRAPH.edges.some((edge) => edge.id === id && edge.kind === 'feedback')
        if (isFeedback) applyFeedback(true)
        return
      }
      // 回流两端那一侧的盒子也归开关管：它们在这一块里显形只因这条回流（读进来 / 送出去）
      if (
        kind === 'node' &&
        activeTab.focusId &&
        (feedbackInputs.inputOf.get(id)?.includes(activeTab.focusId) ||
          feedbackInputs.outputOf.get(id)?.includes(activeTab.focusId))
      ) {
        applyFeedback(true)
      }
    },
    [activeTab.focusId, applyFeedback, feedbackInputs, openSubgraph, select],
  )

  const closeTab = (id: string) => {
    setTabs((list) => list.filter((tab) => tab.id !== id))
    if (activeTabId === id) setActiveTabId('chain:root')
  }
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  /** 左栏的检索词（受控在页面里：切页要清空，面板只管显示） */
  const [paramQuery, setParamQuery] = useState('')
  /** 当前点亮的参数（画布上亮它作用的块与量，左栏里高亮那一行） */
  const [activeParam, setActiveParam] = useState<string | null>(null)
  /**
   * 左栏的页签（受控在页面里：切页要清空检索词，面板只管显示）与当前选中的**过程**。
   * 过程面是旧的一级轴降级来的检索面，它跟参数面一样能点亮画布——两条面互相查找。
   */
  const [panelTab, setPanelTab] = useState<ChainPanelTab>('params')
  const [activeProcess, setActiveProcess] = useState<string | null>(null)
  const canvasApi = useRef<CanvasApi | null>(null)

  /* ---------------- 左栏宽度（纯视图状态，不进任何数据） ---------------- */

  const rowRef = useRef<HTMLDivElement>(null)
  const [rowWidth, setRowWidth] = useState(0)
  /**
   * 这一行也是三列（左栏 / 画布 / 检查器），所以跟画布页同一套：量一下行宽，
   * 让两栏互相夹紧（`usePanelWidth` 的 containerWidth + peerWidth）。
   * 检查器一直是渲染着的（只是能收成细条），所以 `peerVisible` 恒真。
   */
  useEffect(() => {
    const element = rowRef.current
    if (!element) return
    const measured = element.getBoundingClientRect().width
    if (measured > 0) setRowWidth(measured)
    const observer = new ResizeObserver((entries) => setRowWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const searchPanel = usePanelWidth({
    storageKey: 'chainSidebar',
    side: 'left',
    defaultWidth: SEARCH_PANEL_DEFAULT_WIDTH,
    containerWidth: rowWidth,
    peerWidth: inspectorCollapsed ? PANEL_RAIL_WIDTH : 336,
    peerVisible: true,
  })
  /** 证据出口：源码预览 / 文档阅读（与画布页同一套抽屉） */
  const [codeViewer, setCodeViewer] = useState<{ open: boolean; file: string | null; line: number | null; endLine: number | null }>({
    open: false,
    file: null,
    line: null,
    endLine: null,
  })
  const [reader, setReader] = useState<{ open: boolean; docId: string | null; anchor: string | null }>({
    open: false,
    docId: null,
    anchor: null,
  })

  const selectedNode = useMemo(
    () => (selection.kind === 'node' ? (CHAIN_GRAPH.nodes.find((node) => node.id === selection.id) ?? null) : null),
    [selection],
  )
  const selectedEdge = useMemo(
    () => (selection.kind === 'edge' ? (pageGraph.edges.find((edge) => edge.id === selection.id) ?? null) : null),
    [selection, pageGraph],
  )
  /** 这条连线上的开关：从生成物里"效应开关"那一组按 `gatesEdges` 认领，不手抄 */
  const edgeSwitches = useMemo(
    () => (selectedEdge ? ARTIFACT.params.effects.filter((effect) => (effect.gatesEdges ?? []).includes(selectedEdge.id)) : []),
    [selectedEdge],
  )

  /**
   * 顶栏检索选中的对象：这一页的选中是**本地状态**（不碰画布那个共享 store），
   * 所以由 App 递一个一次性请求过来，按 `nonce` 消费。
   * 命中块里的对象时先把它所在的块摆到眼前（`revealNode`）——否则会出现"选中了却看不见"。
   */
  const lastFocusNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || lastFocusNonce.current === focus.nonce) return
    lastFocusNonce.current = focus.nonce
    if (focus.kind === 'node') revealNode(focus.id)
    selectWithReveal(focus.kind, focus.id)
  }, [focus, revealNode, selectWithReveal])

  /** 当前选中的对象名：报给 App，状态条显示它（本页的选中在本地，App 看不到） */
  const selectionLabel = useMemo(() => {
    if (selection.kind === 'node') return selection.id ? labelOf(selection.id) : null
    if (!selectedEdge) return null
    return selectedEdge.label || `${labelOf(selectedEdge.source)} → ${labelOf(selectedEdge.target)}`
  }, [selection, selectedEdge, labelOf])
  useEffect(() => {
    onSelectionChange?.(selectionLabel)
  }, [selectionLabel, onSelectionChange])
  /**
   * 直系子节点数：有子对象的模块才显示「进入子图 ↗」（数字现算，不写死）。
   * 口径只有一处（lib 的 `subgraphSizeOf`）：**块报自己的成员数**（不可进入的层返回 0，
   * 那条入口对 L0 / L1 两个层根本不出现），**成员一律 0**——函数那一级不上图（design.md D1），
   * 入口因此只出现在块上。「装在哪个块里」（`blockOf`）更不是它自己的子节点。
   */

  /**
   * **块属性页**（task 3.3）：选中的是块时，把「成员明细」拼出来喂给检查器。
   *
   * 两样全从生成物读：块本身取 `graph.blocks.items`（成员、可进入），
   * 成员的标签与阶段号从 `graph.nodes` 取。页面只做"查表 + 取名"，不推算任何物理；
   * 检查器那边只管渲染（它不认识物理链）。
   *
   * **代码锚 / 阶段号不进这里**：两者都还在生成物里，但不再有界面出口。
   * **不递对外接口**：跨块送了什么由画布上悬浮块时显现的接口边承载；
   * 生成物里块的出入接口表仍保留，但只供自检核对"每条边恰被两端认领一次"，不进界面。
   */
  const blockDetail = useMemo<BlockDetail | null>(() => {
    if (!selectedNode) return null
    const block = chainBlocks().find((item) => item.id === selectedNode.id)
    if (!block) return null
    return {
      kindLabel: block.kind === 'layer' ? '层' : '过程',
      isLayer: block.kind === 'layer',
      members: block.members.map((id) => ({
        id,
        // 层的成员是文件（`cosmology.h`）：图上没有这个节点，`labelOf` 回落到 id ＝ 文件名本身
        label: labelOf(id),
      })),
      enterable: block.enterable,
    }
  }, [selectedNode, labelOf])

  /**
   * **灰显的对外输入**（task 4.2）：当前标签页聚焦的块与这个量的关系不属于"本块自己算的"时，
   * 属性页最上面先写一句它的身份——"算在别的哪一块里"。
   *
   * 三种来源，判据都落在产物上，页面不另立规矩：
   *   · 块上的 `contexts`（生成物里那块外指进来的量）——本块读它；
   *   · **上一轮送来的那一份**（回流落到本块的输入）——本块读上一轮算出来的它；
   *   · **上一轮送出去的那一份**（回流从本块出去，目的地在别的块）——本块不算它，只是把它送了过去。
   * 后两种再补一句：它们就是主图上那条块间回流弧在子图里的两端落点，浮层上那个开关一并开合。
   * **不复制节点**：画布上灰显的那个盒子就是主图里那个量本身（同一个 id、同一份数据），
   * 编辑类回调在这一页本来就已经全部接成只读提示（见下面 `<Inspector>` 那一段）。
   */
  const contextNote = useMemo(() => {
    if (!selectedNode || !activeTab.focusId) return null
    const host = chainBlocks().find((item) => item.id === activeTab.focusId)
    const declared = Boolean(host?.contexts?.includes(selectedNode.id))
    const fromLastRound = Boolean(feedbackInputs.readFromLastRound.get(activeTab.focusId)?.includes(selectedNode.id))
    const toNextRound = Boolean(feedbackInputs.sentToNextRound.get(activeTab.focusId)?.includes(selectedNode.id))
    if (!declared && !fromLastRound && !toNextRound) return null
    const owner = blockOf(selectedNode.id)
    const ownerName = owner?.label ?? '别的块'
    /** 身份那一句按"本块与它是什么关系"分开说：读它 / 读上一轮的那份 / 只是上一轮把它送了过去 */
    const sentences: string[] = []
    if (declared) sentences.push(`这是外部输入：它算在「${ownerName}」里，本块只是读它——在这里灰显、只读。`)
    else if (fromLastRound)
      sentences.push(`这是外部输入：它算在「${ownerName}」里，本块读的是上一轮算出来的那一份——在这里灰显、只读。`)
    else sentences.push(`它算在「${ownerName}」里：本块不算它，只是上一轮把本块的那一份送过去被它读了。`)
    if (toNextRound && (declared || fromLastRound))
      sentences.push('本块上一轮算出来的那一份也被它读走（跨红移回流）。')
    if (fromLastRound || toNextRound)
      sentences.push('这是那条跨红移回流在子图里的落点——它随浮层上那个开关与主图上的回流弧一并开合。')
    return sentences.join(' ')
  }, [selectedNode, activeTab.focusId, feedbackInputs])

  /**
   * 点参数词条（或命中一条参数）＝把**它点亮的那些块与量**点亮（画布的标签高亮，块也在内），
   * 并把选中落在它作用的**第一个块**上。
   *
   * 为什么选块而不是成员：一级上只有块，选成员＝"选中了却看不见"。要精确定位到某个量，
   * 用左栏脚上那份"作用于…"清单——每一项都可点（`revealNode` + `select`）。
   */
  const highlightParam = useCallback(
    (name: string) => {
      setActiveParam(name)
      setActiveProcess(null)
      setActiveTagIds([`tag:${name}`])
      const nodes = paramMatrixOf(name)?.nodes ?? []
      const block = nodes.length ? blockOf(nodes[0]) : undefined
      if (block) select('node', block.id)
      else if (nodes.length) select('node', nodes[0])
    },
    [select],
  )

  /** 点同一个词条＝熄灭它（再点一次回到"什么都没点亮"）；点别的＝换一个点亮 */
  const showParam = (name: string) => {
    if (activeParam === name) {
      setActiveParam(null)
      setActiveTagIds([])
      return
    }
    highlightParam(name)
  }

  /** 左栏词条清单：分组与顺序全由数据层按**代码类名**给出，页面不写死任何类名 */
  const paramGroups = useMemo(() => paramClassGroups(), [])

  /* ---------------- 左栏第二个检索面：天体物理过程（旧的一级轴降级来的） ---------------- */

  /**
   * 过程面词条与兜底名单**都读生成物**（`processes.items` / `processes.uncovered`）：
   * 页面不写死过程名；兜底名单现在为空（新增模块已就近立条），仍照读、不删字段。
   */
  const processEntries = useMemo(() => chainProcessEntries(), [])
  const processNote = useMemo(() => chainProcessNote(), [])
  const uncovered = useMemo(() => {
    const source = processUncovered()
    return { note: source.note, members: source.members.map((id) => ({ id, label: labelOf(id) })) }
  }, [labelOf])

  /**
   * 两条面**互相查找**：
   *   · `litProcessIds`：选中参数时，过程面里"下辖的量被它碰到"的那些行点亮；
   *   · `litParamNames`：选中过程时，参数面里"作用于它下辖量"的那些行点亮；
   *     过程词条展开后「参数」那一栏（`ChainProcessEntry.relatedParams`）铺的就是这同一个名单。
   * 两个名单都由既有的「参数 × 节点矩阵」+ 过程面的成员算出来，**不新增归属数据**；
   * 判据取 `paramTouchedNodes`（矩阵落点 + 门控边两端）——与 `paramsOfProcess` 同源，两个方向才对得上。
   */
  const litProcessIds = useMemo(() => {
    if (!activeParam) return []
    return [...new Set(paramTouchedNodes(activeParam).flatMap((id) => processesOf(id).map((item) => item.id)))]
  }, [activeParam])

  const litParamNames = useMemo(
    () => (activeProcess ? paramsOfProcess(activeProcess) : []),
    [activeProcess],
  )

  /** 切页签：顺手清空检索词（结果跨两条面，留着会让人以为"这一面只有这些"） */
  const switchPanelTab = (next: ChainPanelTab) => {
    setPanelTab(next)
    setParamQuery('')
  }

  /**
   * 点过程词条＝**定位到它的主块**并选中（过程面不是第三套节点：定位落回代码模块面的块上），
   * 同时把参数面里相关的行点亮（`litParamNames`）。再点一次＝熄灭。
   */
  const showProcess = (id: string) => {
    if (activeProcess === id) {
      setActiveProcess(null)
      return
    }
    setActiveProcess(id)
    setActiveParam(null)
    setActiveTagIds([])
    const entry = processEntries.find((item) => item.id === id)
    if (entry?.primaryBlock) select('node', entry.primaryBlock)
  }

  /** 从参数脚上那排「属于」跳过来：切到过程面并选中那条 */
  const jumpToProcess = (id: string) => {
    setPanelTab('processes')
    if (activeProcess !== id) showProcess(id)
  }

  /** 反过来：从过程词条展开的「参数」那一栏跳过去——切到参数面并选中那个参数（两颗 chip 一正一反） */
  const jumpToParam = (name: string) => {
    setPanelTab('params')
    if (activeParam !== name) showParam(name)
  }

  /**
   * 本页检索：空查询＝词条清单（按代码里的类名分组）；有查询＝**四路命中**
   * （参数 / 物理量 / 过程名 / 论文出处，每条带来源与数量说明，工程侧的词标「实现细节」）。
   * 检索能直达一切，但不把一级弄脏：命中块里的对象时，先把那个块摆到眼前再选中。
   */
  const chainHits = useMemo(() => searchChain(paramQuery), [paramQuery])
  const searching = Boolean(paramQuery.trim())
  const focusHit = (hit: ChainHit) => {
    if (hit.kind === 'param') highlightParam(hit.id)
    else {
      setActiveParam(null)
      setActiveTagIds([])
    }
    /**
     * 命中的是**过程面词条**（`process:*` / `band:*`）时顺手把它选中——过程面那一行也会亮、
     * 成员会铺开；命中别的对象则清掉过程高亮（两条面的点亮互斥，跟参数那边一样）。
     */
    setActiveProcess(hit.id.startsWith('process:') || hit.id.startsWith('band:') ? hit.id : null)
    if (hit.focus?.kind === 'node') revealNode(hit.focus.id)
    if (hit.focus) selectWithReveal(hit.focus.kind, hit.focus.id)
  }

  /**
   * 左栏脚上那段"它作用在哪"：类名（生成物里的 `group`）、落在哪几个块（矩阵反查块清单）、
   * 作用的量清单（可以逐个点过去）。三样都在页面里算好，面板只管渲染。
   * 一个量都不直接作用时要分两种：开关类是**改走哪一支**（门控边两端就是它的去处，照样列出来点得过去），
   * 真没有落点才写原因（代码里没有读点 / 链上没人认领那段代码）——`作用于 无` 说不清是哪一种。
   */
  const activeParamEffect = useMemo<ChainParamEffect | null>(() => {
    if (!activeParam) return null
    const nodes = (paramMatrixOf(activeParam)?.nodes ?? []).map((id) => ({ id, label: labelOf(id) }))
    const gated = paramGatedNodes(activeParam).map((id) => ({ id, label: labelOf(id) }))
    return {
      name: activeParam,
      group: paramEntryOf(activeParam)?.group ?? PARAM_GROUP_FALLBACK,
      blocks: paramBlocks(activeParam),
      nodes,
      gated,
      gateLabels: paramGateLabels(activeParam),
      note: nodes.length ? undefined : gated.length ? '它不改量的值，改的是走哪一支' : paramAbsenceReason(activeParam),
      /**
       * 这些量挂在哪些**过程面词条**下（两条面互相查找的入口）：点它切到过程面并选中那条。
       * 一个量可能同时挂在多条过程下——所以是数组，`Set` 去的只是同一段对象。
       * 门控边的两端也算（开关落在哪条过程上）：与 `paramsOfProcess` 同源，两个方向才对得上。
       */
      processes: [...new Set(paramTouchedNodes(activeParam).flatMap((id) => processesOf(id)))].map((item) => ({
        id: item.id,
        label: item.label,
      })),
    }
  }, [activeParam, labelOf])

  /** 点"作用于"里的某一项：先把所在的块摆到眼前，再选中它本身 */
  const revealAndSelect = (nodeId: string) => {
    revealNode(nodeId)
    select('node', nodeId)
  }

  /** 「看引用」：有源码落点就开源码预览，否则开文档阅读（与画布页的判断口径一致：先看 file） */
  const openRef = (ref: GraphRef) => {
    if (ref.file) {
      setCodeViewer({ open: true, file: ref.file, line: ref.line ?? null, endLine: ref.endLine ?? null })
      return
    }
    if (ref.docId) {
      setReader({ open: true, docId: ref.docId, anchor: ref.anchor ?? null })
      return
    }
    toast.info('这条引用没有可打开的内容', { description: '既没有源码落点，也没有文档锚点。' })
  }

  return (
    /*
     * 三列：左栏（检索与词条，可拖可收）+ 画布（弹性）+ 右侧检查器（定宽、可收起）。
     * 左栏是**真侧栏**：不再浮在画布左上角压住一级左侧两块，
     * 宽度记在本地（`usePanelWidth`，与画布页的 notes 数据库同一套）。
     */
    <div ref={rowRef} className="relative flex min-h-0 min-w-0 flex-1 gap-2">
      <ChainSearchPanel
        width={searchPanel.width}
        collapsed={searchPanel.collapsed}
        onToggleCollapsed={searchPanel.toggleCollapsed}
        query={paramQuery}
        onQueryChange={setParamQuery}
        searching={searching}
        hits={chainHits.hits}
        counts={chainHits.counts}
        groups={paramGroups}
        tab={panelTab}
        onTabChange={switchPanelTab}
        processEntries={processEntries}
        processNote={processNote}
        uncovered={uncovered}
        activeParam={activeParam}
        activeParamEffect={activeParamEffect}
        onSelectParam={showParam}
        onJumpToParam={jumpToParam}
        activeProcess={activeProcess}
        onSelectProcess={jumpToProcess}
        litProcessIds={litProcessIds}
        litParamNames={litParamNames}
        onSelectHit={focusHit}
        onRevealNode={revealAndSelect}
      />

      <ResizeHandle
        label="检索与词条"
        dragging={searchPanel.dragging}
        collapsed={searchPanel.collapsed}
        {...searchPanel.handleProps}
      />

      <div className="relative flex min-h-0 min-w-0 flex-1">
        <GraphSourceProvider value={source}>
          <GraphCanvas
            // key 按标签页：换子图就换实例，渲染器才会按新的聚焦重新装配
            key={activeTabId}
            focusId={activeTab.focusId}
            /*
             * 这一页的块标签是生成物**烘好**的并集（`build-physics-chain.mjs` 产出），
             * 不在这现算——块的成员与步骤是两层，现算会算到另一层上去（见变更 D7.5）。
             */
            tagUnion={false}
            active
            ready
            layout={layout}
            connectSource={null}
            refDragPayload={null}
            // 一级不做话题过滤（11 个块里没有一件要藏的）：传 null ＝ 整图不过滤
            topicFilter={null}
            topicKey="chain"
            /*
             * 跨红移回流开关：状态由这一页持有（本机偏好），控件画在右上角那一列浮层里。
             * 画布页不传这个 prop，那边因此既不出现控件、行为也逐字不变。
             */
            crossRedshiftFeedback={{
              enabled: showFeedback,
              count: feedbackEdges.length,
              onToggle: () => applyFeedback(!showFeedback),
            }}
            /*
             * 图例里「数据流」这一档在本页叫「同一红移内的数据流」：页面上同时可能画着跨红移回流，
             * 两条只有靠这个名字才对得上（`graphify-physics-chain` 的图例要求）。
             * 其余几档照通用名（提供 / 数据流动、对外输入、条件 / 可选…），本页的叫法与它们逐字一致。
             */
            legendEdgeLabels={{ flow: '同一红移内的数据流' }}
            /*
             * 段容器是装饰，不当要素种类：本页图例因此不列「大框」。
             * 画布页的层带照旧列（`graphify-canvas-appearance` 的「按要素种类着色」）——两页口径不同。
             */
            legendHiddenTypes={LEGEND_HIDDEN_TYPES}
            onLayoutChange={setLayout}
            onEnterSubgraph={openSubgraph}
            onOpenTagDetail={(nodeId, tagId) => {
              select('node', nodeId)
              setActiveTagIds([tagId])
            }}
            onConnectComplete={readOnlyNotice}
            onConnectCancel={readOnlyNotice}
            onAddRefToNode={readOnlyNotice}
            onRequestCreateNode={readOnlyNotice}
            onRequestCreateEdge={readOnlyNotice}
            onRequestEditNode={readOnlyNotice}
            onRequestEditEdge={readOnlyNotice}
            onRequestDeleteNode={readOnlyNotice}
            onRequestDeleteEdge={readOnlyNotice}
            onFocusLibrary={readOnlyNotice}
            onOpenImport={readOnlyNotice}
            /*
             * 落点只记在本机（`chainLayoutStore`）：这一页没有自动保存，
             * 按保存（顶栏按钮 / Ctrl/Cmd + S）才写回 `data/chain-layout.json`。
             * 写进去的只有位置——块与连线的数据仍逐字来自生成物。
             */
            onPositionsSettled={noteChainPositions}
            onPositionEditStart={() => {}}
            registerApi={(api) => {
              canvasApi.current = api
            }}
          />
        </GraphSourceProvider>

        {/* 顶部：子图标签条（双击模块进去、点标签来回切；与画布页同一个组件） */}
        {tabs.length > 1 || activeTab.focusId ? (
          <div className="pointer-events-auto absolute left-1/2 top-3 z-10 -translate-x-1/2">
            <TabBar tabs={tabs} activeTabId={activeTabId} onActivate={setActiveTabId} onClose={closeTab} />
          </div>
        ) : null}

        {/* 左上：画布上的浮层只留"跟手上这一下有关"的东西——词条与检索已经搬去左栏（真侧栏，不压画布） */}
        <div className="pointer-events-none absolute left-4 top-4 max-w-[22rem] space-y-2">
          {/* 选中连线时：箭头上的开关（是哪个开关、默认值、关掉会怎样） */}
          {selectedEdge ? (
            <div className="pointer-events-auto w-[21rem] rounded-lg border border-slate-200 bg-white/94 px-3 py-2 shadow-sm backdrop-blur">
              <div className="text-[12px] font-semibold text-slate-800">
                连线{selectedEdge.label ? ` · ${selectedEdge.label}` : ''}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                {labelOf(selectedEdge.source)} → {labelOf(selectedEdge.target)}
              </div>
              {edgeSwitches.length ? (
                <ul className="mt-2 space-y-1.5">
                  {edgeSwitches.map((effect) => (
                    <li key={effect.name} className="rounded border border-slate-100 px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-slate-800">{effect.name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">默认 {String(effect.default)}</span>
                      </div>
                      {effect.role ? <p className="mt-1 text-[11px] leading-5 text-slate-600">{effect.role}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">这条没有开关：它在任何配置下都走。</p>
              )}
            </div>
          ) : null}
        </div>

      </div>

      {/* 右侧：第一页同款检查器（它就是纯入参组件，所以能原样复用） */}
      <Inspector
        node={selectedNode}
        edge={selectedEdge}
        sourceLabel={selectedEdge ? labelOf(selectedEdge.source) : ''}
        targetLabel={selectedEdge ? labelOf(selectedEdge.target) : ''}
        topics={CHAIN_GRAPH.meta.topics ?? []}
        // 话题 pill：这一页不按话题分层了，点它只解释一句（见 `explainTopic`）
        onOpenTopic={explainTopic}
        onPatchNode={readOnlyNotice}
        onPatchEdge={readOnlyNotice}
        onRemoveNode={readOnlyNotice}
        onRemoveEdge={readOnlyNotice}
        onEditEdge={readOnlyNotice}
        onConnectFrom={readOnlyNotice}
        onOpenRef={openRef}
        onRemoveRef={readOnlyNotice}
        onAddCodeRef={readOnlyNotice}
        // 证据（代码落点 / 文献引用）默认收起：这一页先讲物理，选中「源码 / 文献」标签页才铺开
        evidence="collapsed"
        groupOptions={[]}
        childCount={subgraphSizeOf(selectedNode?.id ?? null)}
        onEnterSubgraph={() => {
          if (selectedNode) openSubgraph(selectedNode.id)
          else readOnlyNotice()
        }}
        tagRegistry={CHAIN_GRAPH.meta.tags ?? []}
        activeTagId={activeTagIds[0] ?? null}
        onCreateTag={readOnlyNotice}
        /*
         * 这一页整页读生成物：标签是生成器**烘进产物**的（块的标签＝成员量并集），
         * 在屏幕上改它等于让页面跟产物对不上。所以整页关掉标签编辑——
         * 连叶子（成员量）也不给勾，全页只读。
         */
        tagsEditable={false}
        /*
         * 同理关掉节点字段：这一页的名称、类型、层级与摘要都来自生成物，
         * 在屏幕上改它只会让页面跟产物对不上；而「所属大框」「条件（虚线框）」是画布上的
         * 编组与可选标记，这一页一个都没有——摆上来只会是"（顶层 · 不在任何大框里）"
         * 这种改不动的控件。摘要因此不再是输入框，而是把生成物里那一段印出来。
         */
        nodeEditable={false}
        // 块属性页（成员明细）：只在选中块时递进来，通用页从不传它
        blockDetail={blockDetail}
        // 灰显的对外输入：只在"当前块把它列成对外输入"时成立（其余场合不出现这一句）
        contextNote={contextNote}
        // 点成员＝选中它，并先把所在的块摆到眼前（成员在块的成员层，与检索命中的做法一致）
        onSelectNode={(nodeId) => {
          revealNode(nodeId)
          select('node', nodeId)
        }}
        onSelectRelation={(edgeId) => {
          selectWithReveal('edge', edgeId)
          /*
           * 接口边静息不画（`focusOnly`），只在块被聚焦时才显现——而从属性页点进来的这一下
           * 鼠标根本不在画布上，没有悬浮就不会显现。所以顺手把所在的块"悬"起来（就是悬浮块那条通路），
           * 否则会出现"选中了一条看不见的边"。被开关藏起来的回流边在 `selectWithReveal` 里另走一步
           * （当场把开关打开），这里只管接口边那一种。
           */
          if (blockDetail) setHovered(selectedNode?.id ?? null)
        }}
        relationsHidden={false}
        onToggleRelations={(nodeId) => source.toggleHiddenRelations(nodeId)}
        width={336}
        collapsed={inspectorCollapsed}
        onToggleCollapsed={() => setInspectorCollapsed((value) => !value)}
        onClose={() => select(null, null)}
      />

      {/* 证据出口：源码预览（文件 + 行区间）与文档阅读（docId + 锚点） */}
      <CodePreviewDrawer
        open={codeViewer.open}
        onOpenChange={(open) => setCodeViewer((state) => ({ ...state, open }))}
        file={codeViewer.file}
        line={codeViewer.line}
        endLine={codeViewer.endLine}
        canAddRef={false}
        onAddRef={readOnlyNotice}
      />
      <MdReaderDrawer
        open={reader.open}
        onOpenChange={(open) => setReader((state) => ({ ...state, open }))}
        docId={reader.docId}
        anchor={reader.anchor}
        canAddRef={false}
        onAddRef={readOnlyNotice}
      />
    </div>
  )
}
