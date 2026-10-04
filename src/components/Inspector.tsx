import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Boxes,
  ChevronsRight,
  CornerUpRight,
  ExternalLink,
  FileCode,
  FileText,
  Info,
  Link2,
  PanelRightOpen,
  Plus,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import { Formula } from './Formula'
import { Badge, DotBadge, Separator } from './ui/badge'
import { Button } from './ui/button'
import { Field, Input, Textarea } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'
import { Tooltip } from './ui/tooltip'
import {
  EDGE_TYPE_LABELS,
  EDGE_TYPE_ORDER,
  NODE_TYPE_COLORS,
  NODE_TYPE_LABELS,
  NODE_TYPE_ORDER,
  codeRefFileName,
  codeRefLineRange,
  isCodeRef,
  refLocation,
  refLocationShort,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type GraphRef,
  type NodeType,
  type TagDefinition,
  type Topic,
} from '../lib/types'
import { PANEL_RAIL_WIDTH } from '../hooks/usePanelWidth'
import { NodeTagSection } from './NodeTags'
import { canEditNodeTags, tagDisplayOf } from '../lib/tagEdit'

/** 节点的一条关系（跨层的也列出：画布只画同视图内的边，其余在这里看） */
export interface RelationItem {
  id: string
  label: string
  /** 对端节点 id */
  otherId: string
  otherLabel: string
  /** true = 本节点是起点（→ 对端）；false = 本节点是终点（对端 →） */
  outgoing: boolean
  /** 对端是否在当前标签页可见（跨层关系为 false） */
  sameView: boolean
}

/**
 * 「块」这一层的事实：由页面从生成物（物理链页读 `physics-chain.json` 的 `graph.blocks.items`）
 * 读出来喂进来。检查器**不认识物理链**——通用页不传它，这一段就整段不出现；
 * 传了它就只按下面这几组数据渲染，自己不推算任何东西。
 */
export interface BlockDetail {
  /** 块类型的人话标签（「过程 / 可进入」还是「层 / 不可进入」由调用方给出） */
  kindLabel: string
  /** 是不是**层**（常数与网格）：成员是常数、成员之间没有因果连线 */
  isLayer: boolean
  /**
   * 成员明细：点一下即选中该成员。
   *
   * 每行只有成员名：**没有阶段号列**。`stage`（`S14` 这类阶段号）是数据字段、
   * 也是检索命中面，但不是这一页的呈现——这一页的名字与落点一律不带内部编号。
   */
  members: { id: string; label: string }[]
  /** 有没有子图可进（层一定不可进入） */
  enterable: boolean
}

interface InspectorProps {
  node: GraphNode | null
  edge: GraphEdge | null
  sourceLabel: string
  targetLabel: string
  /** 话题注册表：用来把节点上的 topic id 翻译成可读名字 */
  topics: Topic[]
  /** 点击节点所属的某个话题：确保该话题未被关闭（不影响其它话题）并选中该节点 */
  onOpenTopic: (topicId: string) => void
  onPatchNode: (patch: Partial<GraphNode>) => void
  onPatchEdge: (patch: Partial<GraphEdge>) => void
  onRemoveNode: () => void
  onRemoveEdge: () => void
  onEditEdge: () => void
  onConnectFrom: (nodeId: string) => void
  onOpenRef: (ref: GraphRef) => void
  onRemoveRef: (index: number) => void
  /** 打开「添加源码引用」选择器 */
  onAddCodeRef?: () => void
  /**
   * 引用的呈现方式（证据层）：
   *   · `inline`（默认）＝引用卡片直接铺开（画布页用的就是它，行为改动前后一致）；
   *   · `collapsed`＝只给一条「源码 N / 文献 M」的小标签页（物理链页用：一级先讲物理，
   *     选中一个标签才铺开那一类），且**没选标签时不生成任何路径与行号 DOM**。
   * `collapsed` 时这一段还会被移到「关系 / 子图入口」之后 —— 物理在前、证据在最后。
   */
  evidence?: 'inline' | 'collapsed'
  /** 可选的所属大框（已排除自身与自己的子孙，避免把大框塞进自己身体里） */
  groupOptions?: { id: string; label: string }[]
  /** 选中节点的直系子节点数（模块 > 0 时显示「进入子图 ↗」） */
  childCount?: number
  /**
   * **当前这一页的节点表**：有子图的模块显示的标签要按"当前子树叶子并集"现算，离了它算不出来。
   * 画布页递 `graph.nodes`；物理链页**不递**——那一页的块标签是生成物烘好的，照读即可
   * （见 `lib/tagEdit.ts` 的 `tagDisplayOf`）。
   */
  nodes?: readonly GraphNode[]
  /** 进入该模块的子图标签页（仅模块显示） */
  onEnterSubgraph?: () => void
  /**
   * **这一页**的标签能不能改（默认能）。物理链页整页读生成物 → 传 `false`：
   * 那一页的标签是生成器烘好的，在页面上改它等于让屏幕跟产物对不上。
   * 它与"**这个节点**能不能改"是两件事——后者看有没有子图（`lib/tagEdit.ts`），
   * 两个条件都成立才给编辑入口。
   */
  tagsEditable?: boolean
  /**
   * **这一页**的节点字段能不能改（默认能）。物理链页整页读生成物 → 传 `false`：
   *   · 名称 / 类型 / 参数数 / 所属大框 / 条件这些控件都不出现——名字与类型在抬头已经读到，
   *     「所属大框」与「条件（虚线框）」是画布上的编组与可选标记，那一页两样都没有
   *     （生成物里每个节点都是 `conditional: false`，一条虚线框都不画）；
   *   · 摘要不再是输入框，而是把生成物里那一段**印出来**；
   *   · 「从此节点拉出关系」与「删除节点」两个动手入口一并退场（那一页的编辑回调本来就只接成只读提示）。
   * 与 `tagsEditable` 是两件事、分开传：这里关的是"改这个节点"，标签另有它自己的口径。
   */
  nodeEditable?: boolean
  /** 选中节点的全部关系（含跨层），点击可选中该关系 */
  relations?: RelationItem[]
  /**
   * 选中的是「块」时，块这一层的事实（成员明细）。
   * 通用页不传 → 整段不出现；物理链页传 → 块属性页就是这两样，不另画一个面板。
   */
  blockDetail?: BlockDetail | null
  /** 点成员明细里的某个成员：选中它（块属性页要能从块走进成员） */
  onSelectNode?: (id: string) => void
  /**
   * **灰显的对外输入**（物理链的块子图）：选中的这个量是被当前块"读"的、算在别的块里的外部输入。
   *
   * 文案由**页面**算好递进来（检查器不认识物理链）：检查器只负责把它摆在最上面说清身份——
   * 没有这一句，用户看到的就是"一个灰着的、点开却什么都没有的盒子"。
   */
  contextNote?: string | null
  /** 参数注册表：编辑入口从这里多选，明细区块用它显示名称与说明 */
  tagRegistry?: TagDefinition[]
  /** 由点画布红点带过来的标签 id：该标签的明细自动展开 */
  activeTagId?: string | null
  /** 新建一个全局标签（写进注册表）并归属到当前节点 */
  onCreateTag?: (name: string) => void
  onSelectRelation?: (edgeId: string) => void
  /** 选中模块的关系是否已收起（纯视图状态，记在本机浏览器里） */
  relationsHidden?: boolean
  /** 收起 / 展开该模块的关系 */
  onToggleRelations?: (id: string) => void
  /** 受控宽度（由 usePanelWidth 管理，纯视图状态） */
  width: number
  /** 是否收起为细条 */
  collapsed: boolean
  onToggleCollapsed: () => void
  onClose: () => void
}

/** 「所属大框」下拉里代表「顶层」的哨兵值：Select 不能把 null 当 value */
const NO_GROUP = '__top__'

const panelMotion = {
  initial: { opacity: 0, x: 18 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 18 },
  transition: { type: 'spring' as const, stiffness: 260, damping: 26 },
}

export function Inspector({
  node,
  edge,
  sourceLabel,
  targetLabel,
  topics,
  onOpenTopic,
  onPatchNode,
  onPatchEdge,
  onRemoveNode,
  onRemoveEdge,
  onEditEdge,
  onConnectFrom,
  onOpenRef,
  onRemoveRef,
  onAddCodeRef,
  evidence = 'inline',
  groupOptions = [],
  childCount = 0,
  tagsEditable = true,
  nodeEditable = true,
  nodes,
  onEnterSubgraph,
  relations = [],
  blockDetail = null,
  onSelectNode,
  contextNote = null,
  onSelectRelation,
  relationsHidden = false,
  onToggleRelations,
  tagRegistry = [],
  activeTagId = null,
  onCreateTag,
  width,
  collapsed,
  onToggleCollapsed,
  onClose,
}: InspectorProps) {
  const [label, setLabel] = useState('')
  const [summary, setSummary] = useState('')

  // 同一节点可在多个话题里出现；这里只做 id → 名字的翻译，注册表缺项就跳过
  const nodeTopics = (node?.topics ?? [])
    .map((topicId) => topics.find((topic) => topic.id === topicId))
    .filter((topic): topic is Topic => Boolean(topic))

  useEffect(() => {
    if (!node) return
    setLabel(node.label)
    setSummary(node.summary)
  }, [node?.id, node])

  const edgeLabelState = useState(edge?.label ?? '')
  const edgeNoteState = useState(edge?.note ?? '')

  useEffect(() => {
    edgeLabelState[1](edge?.label ?? '')
    edgeNoteState[1](edge?.note ?? '')
  }, [edge?.id, edge])

  const commitNodeLabel = () => {
    if (!node) return
    const trimmed = label.trim()
    if (!trimmed || trimmed === node.label) {
      setLabel(node.label)
      return
    }
    onPatchNode({ label: trimmed })
  }

  const commitSummary = () => {
    if (node && summary !== node.summary) onPatchNode({ summary: summary.trim() })
  }

  /**
   * 只读那句说明要说清"为什么不给编"——两种身份两句话，不能混成一句糊弄：
   *   · 有子图的（模块 / 块）：它的标签是子图里所有叶子标签的并集，改它没有意义，得去成员上改；
   *   · 没子图却仍然只读的（物理链页的成员量）：整页读生成物，这一页就没有编辑入口。
   */
  /**
   * 这个节点**此刻显示的**标签（面板与画布红点同一份口径）：有子图的模块是当前子树叶子并集，
   * 叶子照读自己那份，没递节点表（物理链页）也照读数据里那份——口径只有 `tagDisplayOf` 一处。
   */
  const tagDisplay = node ? tagDisplayOf(nodes, node) : { tags: [], tagDetails: {} }

  const tagReadOnlyNote =
    childCount > 0 ? '只读 · 参数来自子图成员，要改去成员上改' : '只读 · 这一页只读，参数来自源码扫描'



  /**
   * 证据小标签页选中的那一类（只在 `evidence="collapsed"` 下用）。
   * `null` = **没选**：此刻两类清单都不铺开（一个路径、一个行号都不生成）；
   * 换一个节点就复位为没选。
   */
  const [evidenceTab, setEvidenceTab] = useState<'impl' | 'paper' | null>(null)

  useEffect(() => {
    setEvidenceTab(null)
  }, [node?.id])

  /**
   * 「源码 / 文献」这一段。两种呈现方式：
   *   · `inline`（默认，画布页用的就是它）：引用卡片直接铺开；
   *   · `collapsed`（物理链页）：一条**小标签页**切换两类证据——标签上只有「源码 12」「文献 3」
   *     （类别 + 数量，不再有「看实现 / 看文献」「展开 / 收起」这些话）；
   *     **没选标签时一个路径、一个行号都不渲染**（DOM 里根本没有，而不是视觉上藏起来），
   *     选中才铺开**那一类**，两类不同时铺开——证据默认收起，一级先讲物理。
   *
   * 卡片第二行只给**不带目录的文件名**（`SpinTemperatureBox.c:120-145`），完整路径退到 `title`。
   *
   * **两类清单都按「同一个目标」归并**：源码按**文件**、文献按**文档**。一个文件一条，主行就是
   * 文件名（`codeRefFileName` / `refLocationShort`），同一目标上的多个落点逐条列在下面、每条可点即开。
   * 理由同一条：一个块的证据常常全落在同一处——落点挤在同一个 `.c` 上、成员锚点全落在它自己那一篇
   * `.md` 里（逐锚点铺卡＝同一个文件名印 N 遍），而成员名标题在同一面板的「成员明细」上方已经出现过一遍。
   * 于是标签上的条数：源码＝落点条数、**文献＝文档数**——一个模块只有它自己那一篇笔记，写「文献 1」。
   * 画布页的清单（`inline`）不归并：那里引用可增删，合并会把删除的粒度拆掉。
   */
  const renderRefs = (target: GraphNode) => {
    const codeRefs = target.refs.filter((ref) => isCodeRef(ref) && Boolean(ref.file))
    const docRefs = target.refs.filter((ref) => !isCodeRef(ref) && Boolean(ref.docId))
    /**
     * 卡片：两类引用共用一张（图标与第二行按目标类型切换）。
     * `index` 取它在**原数组**里的下标（标签页按类型过滤过），删除时才删得对。
     */
    const card = (ref: GraphRef, index: number) => {
      const code = isCodeRef(ref)
      const location = refLocation(ref)
      return (
        <li
          key={`${location}-${index}`}
          className="group flex items-start gap-2 rounded-md border border-black/[0.07] bg-black/[0.03] px-2.5 py-2 transition-colors hover:border-primary/35 hover:bg-primary/[0.06]"
        >
          {code ? (
            <FileCode className="mt-[2px] h-3.5 w-3.5 shrink-0 text-teal-700/80" />
          ) : (
            <FileText className="mt-[2px] h-3.5 w-3.5 shrink-0 text-cyan-700/80" />
          )}
          <button
            type="button"
            onClick={() => onOpenRef(ref)}
            title={location}
            className="min-w-0 flex-1 cursor-pointer text-left"
          >
            <span className="block truncate text-micro font-medium text-foreground/90">
              {ref.label || ref.anchor || location}
            </span>
            <span className="block truncate font-mono text-micro text-muted-foreground/70">
              {refLocationShort(ref)}
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Tooltip content={code ? '预览这几行' : '打开文档'}>
              <Button variant="ghost" size="icon-sm" onClick={() => onOpenRef(ref)}>
                <ExternalLink className="h-3 w-3" />
              </Button>
            </Tooltip>
            <Tooltip content="移除引用">
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive/85 hover:bg-destructive/12"
                onClick={() => onRemoveRef(index)}
              >
                <X className="h-3 w-3" />
              </Button>
            </Tooltip>
          </div>
        </li>
      )
    }

    /**
     * 源码清单按**文件**归并：同一个文件上的多个行区间合成一条，主行印文件名。
     * 分组按引用在数组里的首次出现顺序（生成物已排好序，这里不重排）；
     * 组内保持原顺序，于是行区间从上到下就是文件里的先后。
     */
    const codeGroups = (refs: GraphRef[]) => {
      const groups = new Map<string, GraphRef[]>()
      for (const ref of refs) {
        const file = String(ref.file ?? '')
        const bucket = groups.get(file)
        if (bucket) bucket.push(ref)
        else groups.set(file, [ref])
      }
      return [...groups.entries()].map(([file, list]) => ({ file, refs: list }))
    }

    /**
     * 归并后的源码卡片：**主行＝文件名**（点它开这一文件的第一段落点），下面一行是行区间，
     * 每个区间自己可点（`title` 给完整路径 + 行号）。整卡没有删除按钮——`collapsed` 是可读页。
     */
    const codeCard = (file: string, list: GraphRef[]) => (
      <li
        key={file}
        className="group flex items-start gap-2 rounded-md border border-black/[0.07] bg-black/[0.03] px-2.5 py-2 transition-colors hover:border-primary/35 hover:bg-primary/[0.06]"
      >
        <FileCode className="mt-[2px] h-3.5 w-3.5 shrink-0 text-teal-700/80" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenRef(list[0])}
            title={file}
            className="block max-w-full cursor-pointer truncate text-left font-mono text-micro font-medium text-foreground/90"
          >
            {codeRefFileName(list[0])}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {list.map((ref, index) => (
              <button
                key={`${refLocation(ref)}-${index}`}
                type="button"
                onClick={() => onOpenRef(ref)}
                title={refLocation(ref)}
                className="cursor-pointer rounded-[4px] bg-black/[0.05] px-1 font-mono text-micro text-muted-foreground/75 transition-colors hover:bg-primary/[0.12] hover:text-foreground"
              >
                {codeRefLineRange(ref) || '整文件'}
              </button>
            ))}
          </div>
        </div>
      </li>
    )

    /**
     * 笔记清单按**文档**归并：同一篇笔记上的多个锚点合成一条，主行印文档名。
     * 分组按引用在数组里的首次出现顺序（生成物已按 `docId`→`anchor` 排好，这里不重排）。
     */
    const docGroups = (refs: GraphRef[]) => {
      const groups = new Map<string, GraphRef[]>()
      for (const ref of refs) {
        const docId = String(ref.docId ?? '')
        const bucket = groups.get(docId)
        if (bucket) bucket.push(ref)
        else groups.set(docId, [ref])
      }
      return [...groups.entries()].map(([docId, list]) => ({ docId, refs: list }))
    }

    /**
     * 归并后的文献卡片：**主行＝文档名**（点它开这一篇的第一个锚点），下面一行是这篇里的各个锚点，
     * 每个自己可点（`title` 给完整落点）。整卡没有删除按钮——`collapsed` 是可读页。
     */
    const docCard = (docId: string, list: GraphRef[]) => (
      <li
        key={docId}
        className="group flex items-start gap-2 rounded-md border border-black/[0.07] bg-black/[0.03] px-2.5 py-2 transition-colors hover:border-primary/35 hover:bg-primary/[0.06]"
      >
        <FileText className="mt-[2px] h-3.5 w-3.5 shrink-0 text-cyan-700/80" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenRef(list[0])}
            title={docId}
            className="block max-w-full cursor-pointer truncate text-left font-mono text-micro font-medium text-foreground/90"
          >
            {refLocationShort(list[0])}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {list.map((ref, index) => (
              <button
                key={`${refLocation(ref)}-${index}`}
                type="button"
                onClick={() => onOpenRef(ref)}
                title={refLocation(ref)}
                className="max-w-full cursor-pointer truncate rounded-[4px] bg-black/[0.05] px-1 text-left text-micro text-muted-foreground/75 transition-colors hover:bg-primary/[0.12] hover:text-foreground"
              >
                {ref.label || ref.anchor || '正文'}
              </button>
            ))}
          </div>
        </div>
      </li>
    )

    /** 归并后的分组只算一次：标签上的条数与铺出来的卡片必须是同一份 */
    const docGroupsList = docGroups(docRefs)

    /** 标签页：只列**非空**的那几类（不出现「源码 0」这种把入口藏起来的写法） */
    const tabs = [
      { id: 'impl' as const, Icon: FileCode, text: '源码', count: codeRefs.length, tone: 'text-teal-700/80' },
      { id: 'paper' as const, Icon: FileText, text: '文献', count: docGroupsList.length, tone: 'text-cyan-700/80' },
    ].filter((tab) => tab.count > 0)
    /** 选中的那一类；它要是这一节点上不存在（如只在代码一类），就当没选 */
    const active = tabs.some((tab) => tab.id === evidenceTab) ? evidenceTab : null

    return (
      <section className="flex flex-col gap-2">
        {/*
          标题与两个「添加」入口只在 `inline`（画布页）出现：在那里它们是真能用的编辑入口。
          `collapsed`（物理链页）整页只读、引用不可增删，标签页自己就说明是什么——
          标题与「文档 / 源码」两个入口在那里只是话，不出现。
        */}
        {evidence === 'inline' ? (
          <div className="flex items-center justify-between">
            <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground/80">
              notes / 源码引用
            </h3>
            <div className="flex items-center gap-2">
              <Tooltip content="在左侧 notes 数据库点击或拖拽文档即可添加">
                <span className="flex cursor-default items-center gap-1 text-micro text-muted-foreground/60">
                  <Plus className="h-3 w-3" />
                  文档
                </span>
              </Tooltip>
              <Tooltip content="选一个源文件与行区间，挂到本节点">
                <button
                  type="button"
                  onClick={() => onAddCodeRef?.()}
                  className="flex cursor-pointer items-center gap-1 text-micro text-cyan-700 transition-colors hover:text-cyan-800"
                >
                  <FileCode className="h-3 w-3" />
                  源码
                </button>
              </Tooltip>
            </div>
          </div>
        ) : null}

        {target.refs.length === 0 ? (
          <p className="rounded-md border border-dashed border-black/10 px-2.5 py-3 text-micro leading-relaxed text-muted-foreground">
            {evidence === 'inline'
              ? '还没有引用。在左侧选择文档或章节，或点上方「源码」把某几行代码锚到这个节点上。'
              : '还没有引用。'}
          </p>
        ) : evidence === 'collapsed' ? (
          <>
            <div
              role="tablist"
              className="flex items-center gap-0.5 rounded-md border border-black/[0.07] bg-black/[0.03] p-0.5"
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active === tab.id}
                  onClick={() => setEvidenceTab(active === tab.id ? null : tab.id)}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-[5px] px-2 py-1 text-micro transition-colors ${
                    active === tab.id
                      ? 'bg-white font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <tab.Icon className={`h-3.5 w-3.5 shrink-0 ${tab.tone}`} />
                  {tab.text} {tab.count}
                </button>
              ))}
            </div>
            {active ? (
              <ul role="tabpanel" className="flex flex-col gap-1.5">
                {active === 'impl'
                  ? codeGroups(codeRefs).map((group) => codeCard(group.file, group.refs))
                  : docGroupsList.map((group) => docCard(group.docId, group.refs))}
              </ul>
            ) : null}
          </>
        ) : (
          <ul className="flex flex-col gap-1.5">{target.refs.map((ref, index) => card(ref, index))}</ul>
        )}

        {target.type === 'group' ? (
          <p className="flex items-start gap-1.5 rounded-md border border-teal-600/20 bg-teal-600/[0.06] px-2.5 py-2 text-micro leading-relaxed text-teal-800">
            <Boxes className="mt-[1px] h-3 w-3 shrink-0" />
            这是一个大框（容器）：把模块拖进它的范围（或在模块的「所属大框」里选中它）即可装进来。
            <br />
            容器只作分组，<span className="font-semibold">不参与关系</span>——关系只建立在模块之间。
          </p>
        ) : null}
      </section>
    )
  }

  /**
   * 「块」这一段（只有调用方传了 `blockDetail` 才出现）：成员明细。
   *
   * 块不是一个"名字 + 摘要"的盒子，它的物理含义是**装了哪些量**（成员）。
   *
   * **不再有「代码锚 / 阶段号」这两行**：它们点不开、给不出可核验的
   * 落点；块算在哪段代码里改由那条小标签页回答——「源码」列出成员与步骤汇总来的落点，
   * 「文献」列出笔记文档，两者都可点即开。字段本身仍在生成物里（`codeAnchor` 是
   * "与代码同构"的可证伪依据、`stages` 是检索命中面），只是不再有界面出口。
   *
   * **不列对外接口**：跨块送了什么在画布上悬浮块时就看得见
   * （接口边静息不画、悬浮显现，见 `graph/styles.ts` 的 `edge[?focusOnly]`），
   * 右侧栏再铺一张进出清单是重复。
   *
   * **不再印块的一级注释**：那句话在**摘要位置**（就在这一段上方）已经读到，这里只列成员；
   * 字段本身仍在生成物与真源里（自检逐条断言它非空）。
   *
   * 成员列表可点 → 选中该成员。
   */
  const renderBlock = (block: BlockDetail) => {
    const rowClass =
      'flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-black/[0.07] bg-black/[0.03] px-2.5 py-1.5 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.06]'
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground/80">
          块 · {block.kindLabel}
        </h3>

        <div className="flex items-center justify-between">
          <h4 className="text-micro font-medium text-foreground/85">成员明细（{block.members.length}）</h4>
          <span className="shrink-0 text-micro text-muted-foreground/70">
            {block.enterable ? '块内连通 · 可进入' : block.isLayer ? '层 · 不可进入' : '成员互不相连 · 不可进入'}
          </span>
        </div>
        <ul className="flex flex-col gap-1">
          {block.members.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => onSelectNode?.(member.id)}
                title={member.label}
                className={rowClass}
              >
                <span className="min-w-0 flex-1 truncate text-micro text-foreground/90">{member.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  const open = Boolean(node || edge)

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.aside
          key="inspector"
          {...panelMotion}
          className="glass-panel flex shrink-0 flex-col overflow-hidden rounded-lg"
          style={{ width: collapsed ? PANEL_RAIL_WIDTH : width }}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-2 py-3">
              <Tooltip content="展开节点详情">
                <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="展开节点详情">
                  <PanelRightOpen className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tags className="h-3.5 w-3.5 text-primary" />
            </div>
          ) : node ? (
            <>
              <header className="flex shrink-0 items-start justify-between gap-2 px-3.5 pb-2.5 pt-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <DotBadge color={NODE_TYPE_COLORS[node.type]}>{NODE_TYPE_LABELS[node.type]}</DotBadge>
                    <Badge tone="muted">
                      {node.refs.length} 引用 · {tagDisplay.tags.length} 参数
                    </Badge>
                  </div>
                  <h2 className="mt-2 truncate text-tiny font-semibold text-foreground/92" title={node.label}>
                    {node.label}
                  </h2>
                  {nodeTopics.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {nodeTopics.map((topic) => (
                        <button
                          key={topic.id}
                          type="button"
                          onClick={() => onOpenTopic(topic.id)}
                          title={topic.description || `显示话题「${topic.name}」并选中该节点`}
                          className="flex cursor-pointer items-center gap-1 rounded-full border border-primary/25 bg-primary/[0.08] px-2 py-[2px] text-micro text-primary/90 transition-colors hover:border-primary/45 hover:bg-primary/[0.14]"
                        >
                          <Tags className="h-2.5 w-2.5" />
                          {topic.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Tooltip content="收起面板">
                    <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="收起节点详情">
                      <ChevronsRight className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                  <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="收起检查器">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </header>

              <Separator />

              <ScrollArea className="min-h-0 flex-1" viewportClassName="px-3.5 py-3">
                <div className="flex flex-col gap-3">
                  {/*
                    灰显的对外输入先亮身份：它是**别的块**的量，本块只是读它。
                    措辞由页面给（含"算在哪一块里"），这里不编物理。
                  */}
                  {contextNote ? (
                    <div className="flex items-start gap-2 rounded-md border border-slate-300/70 bg-slate-500/[0.06] px-2.5 py-2">
                      <Info className="mt-[2px] h-3 w-3 shrink-0 text-slate-500" />
                      <p className="text-micro leading-relaxed text-muted-foreground/90">{contextNote}</p>
                    </div>
                  ) : null}

                  {/*
                    可编页面才有下面这些字段（`nodeEditable`）：
                       · 节点名称与类型——只读那一页的抬头已经印着名字与类型，再给一遍更可读的控件没意义；
                       · 所属大框与条件——它们是画布上的编组与虚线框，物理链那一页两样都没有
                         （生成物里每个节点都是 `conditional: false`），
                         只会在每个块上都显示"（顶层 · 不在任何大框里）"这种改不动的控件。
                  */}
                  {nodeEditable ? (
                    <>
                      <Field label="节点名称">
                        <Input
                          value={label}
                          onChange={(event) => setLabel(event.target.value)}
                          onBlur={commitNodeLabel}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitNodeLabel()
                            if (event.key === 'Escape') setLabel(node.label)
                          }}
                        />
                      </Field>

                      <div className="grid grid-cols-2 gap-3">
                        <Field label="类型">
                          <Select value={node.type} onValueChange={(value) => onPatchNode({ type: value as NodeType })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {NODE_TYPE_ORDER.map((item) => (
                                <SelectItem key={item} value={item}>
                                  {NODE_TYPE_LABELS[item]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="参数数" hint="看和改都在下方「参数」里（只有叶子能编）">
                          <div className="flex h-8 items-center rounded-md border border-black/10 bg-black/[0.03] px-2.5 text-micro text-muted-foreground">
                            {tagDisplay.tags.length} 个已归属
                          </div>
                        </Field>
                      </div>

                      {/*
                        这里原先有一行「阶段号」（生成物写在**量**上的只读属性 `codeHints` 的第一段）。
                        已撤：它是点不开的摘要，回答不了"这段代码在哪"，而且它是代码坐标、不是这一页的名字。
                        量的落点改由「源码」标签页给（文件 + 行区间，可点即开）。
                        字段仍是**数据**（`stage` / `codeHints`）与**检索命中面**（按 `S14` 仍能查到），
                        只是不再有任何界面出口——命中说明里也不印它。
                      */}

                      {/* 参数的编辑入口**不在这里**：它跟着明细一起住在下方那唯一的
                          「参数」区块的标题行里（见 NodeTags.tsx 的 NodeTagSection）。
                          从前这里另有一排可编的胶囊，同一份归属有两处实现，已撤销。 */}

                      {/* 大框归属：手动建立层级的第二种入口（第一种是画布上把节点拖进大框） */}
                      <Field label="所属大框" hint="画布上拖进框里也可以">
                        <Select
                          value={node.parent ?? NO_GROUP}
                          onValueChange={(value) => onPatchNode({ parent: value === NO_GROUP ? null : value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_GROUP}>（顶层 · 不在任何大框里）</SelectItem>
                            {groupOptions.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>

                      {/* 条件 / 可选：画布上用虚线框表达（对应流程图的「这一步只在某些配置下才存在」） */}
                      <div className="flex h-8 items-center justify-between rounded-md border border-black/10 bg-black/[0.03] px-2.5">
                        <span
                          className="text-micro text-muted-foreground"
                          title="虚线框：这一步只在某些配置下才存在（例如「仅 lagrangian 源模型」）"
                        >
                          条件 / 可选（虚线框）
                        </span>
                        <Switch
                          checked={Boolean(node.conditional)}
                          onCheckedChange={(value) => onPatchNode({ conditional: value })}
                        />
                      </div>
                    </>
                  ) : null}

                  {/* 收起关系：连线一多就先把它们收起来，只看节点本身。
                      纯视图动作——不删关系、不改数据、不动坐标；状态记在本机浏览器里，刷新后保持。
                      大框不参与关系，因此不显示这一行。 */}
                  {node.type !== 'group' ? (
                    <div className="flex h-8 items-center justify-between rounded-md border border-black/10 bg-black/[0.03] px-2.5">
                      <span
                        className="text-micro text-muted-foreground"
                        title="只把它的连线收起来：节点、坐标与层级都不变；状态记在本机浏览器里，刷新后保持"
                      >
                        收起它的连线
                      </span>
                      <Switch
                        checked={relationsHidden}
                        onCheckedChange={() => onToggleRelations?.(node.id)}
                      />
                    </div>
                  ) : null}

                  {/*
                    摘要：**有公式的对象**（物理链上可求值的量，生成物逐字带着真源那份 LaTeX）
                    在这里读到排过版的公式，不再给输入框；其余对象在可编页面上走原来的通用形态，
                    只读页面（`nodeEditable === false`）则把这一段**印出来**。判据都是数据
                    （有没有 `formula`、这一页能不能编），不按节点种类另写名单。
                  */}
                  <Field label="摘要">
                    {node.formula ? (
                      <Formula latex={node.formula} />
                    ) : nodeEditable ? (
                      <Textarea
                        value={summary}
                        onChange={(event) => setSummary(event.target.value)}
                        onBlur={commitSummary}
                        placeholder="一句话说明"
                        className="min-h-[56px]"
                      />
                    ) : (
                      /* 只读那一支：这一段是生成物里印出来的话（真源逐字）。给它一个输入框，
                         只会让人以为"能在这一页改它"——就是给一个改不动的控件。 */
                      <p className="text-micro leading-relaxed text-foreground/85">{summary}</p>
                    )}
                  </Field>

                  {/* 块属性页（成员明细）：物理在前，所以紧跟摘要 */}
                  {blockDetail ? renderBlock(blockDetail) : null}

                  {evidence === 'inline' ? (
                    <>
                      <Separator />
                      {renderRefs(node)}
                    </>
                  ) : null}

                  <Separator />

                  {/* 参数：**唯一**一处区块（标题行右侧就是编辑入口，标题由区块自带）。
                      显示的是"这个节点此刻的参数"——有子图的是子树叶子并集（由 tagEdit 算好递进去）。
                      容器不参与参数，整块跳过。 */}
                  {(node.type !== 'group' || node.tags.length > 0) ? (
                    <section className="flex flex-col gap-2">
                      <NodeTagSection
                        tags={tagDisplay.tags}
                        tagDetails={tagDisplay.tagDetails}
                        registry={tagRegistry}
                        activeTagId={activeTagId}
                        onOpenRef={onOpenRef}
                        editable={tagsEditable && canEditNodeTags(node, childCount)}
                        readOnlyNote={tagReadOnlyNote}
                        onPatchNode={onPatchNode}
                        onCreateTag={onCreateTag}
                      />
                    </section>
                  ) : null}

                  {/* 关系（含跨层）：画布只画两端都在本视图的边，其余在这里看全。
                      大框是容器，不参与关系，所以这里对容器整段不显示。 */}
                  {node.type !== 'group' && relations.length ? (
                    <section className="flex flex-col gap-2">
                      <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground/80">
                        关系（{relations.length}）
                      </h3>
                      <ul className="flex flex-col gap-1.5">
                        {relations.map((relation) => (
                          <li key={relation.id}>
                            <button
                              type="button"
                              onClick={() => onSelectRelation?.(relation.id)}
                              title={relation.sameView ? relation.label : `${relation.label}（对端不在当前标签页）`}
                              className="flex w-full cursor-pointer items-center gap-1.5 rounded-md border border-black/[0.07] bg-black/[0.03] px-2.5 py-1.5 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.06]"
                            >
                              <span className="min-w-0 flex-1 truncate text-micro text-foreground/90">
                                {relation.outgoing ? `→ ${relation.otherLabel}` : `← ${relation.otherLabel}`}
                              </span>
                              <span className="shrink-0 text-micro text-muted-foreground/70">{relation.label}</span>
                              {!relation.sameView ? (
                                <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-px text-[9.5px] text-amber-700">
                                  跨层
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  {/* 模块入口：子图在新标签页打开（与双击模块等效） */}
                  {node.type !== 'group' && childCount > 0 ? (
                    <Button variant="secondary" onClick={() => onEnterSubgraph?.()}>
                      <CornerUpRight className="h-3.5 w-3.5" />
                      进入子图 ↗（{childCount} 个子节点）
                    </Button>
                  ) : null}

                  {/*
                    证据层排在最后（物理在前、证据在后）：物理链页把引用收成一条
                    「源码 / 文献」小标签页，选中前一个路径与行号都不渲染。
                  */}
                  {evidence === 'collapsed' ? (
                    <>
                      <Separator />
                      {renderRefs(node)}
                    </>
                  ) : null}

                  {/* 大框是容器，不参与关系：不给「拉出关系」入口。只读页面同样不给——
                      那一页的 onConnectFrom 接的是只读提示，按钮按下去只会弹一句"只能读"。 */}
                  {nodeEditable && node.type !== 'group' ? (
                    <Button variant="secondary" onClick={() => onConnectFrom(node.id)}>
                      <Link2 className="h-3.5 w-3.5" />
                      从此节点拉出关系
                    </Button>
                  ) : null}
                </div>
              </ScrollArea>

              {/* 删除节点是动手入口：只读页面（`nodeEditable === false`）整条不出现 */}
              {nodeEditable ? (
                <>
                  <Separator />
                  <div className="shrink-0 p-3">
                    <Button variant="danger-ghost" className="w-full" onClick={onRemoveNode}>
                      <Trash2 className="h-3.5 w-3.5" />
                      删除节点（连带其关系）
                    </Button>
                  </div>
                </>
              ) : null}
            </>
          ) : edge ? (
            <>
              <header className="flex shrink-0 items-start justify-between gap-2 px-3.5 pb-2.5 pt-3.5">
                <div className="min-w-0">
                  <Badge tone="primary">{EDGE_TYPE_LABELS[edge.type]}</Badge>
                  <h2 className="mt-2 flex items-center gap-1.5 text-tiny font-semibold text-foreground/92">
                    <span className="truncate">{sourceLabel}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="truncate">{targetLabel}</span>
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Tooltip content="收起面板">
                    <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="收起节点详情">
                      <ChevronsRight className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                  <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="收起检查器">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </header>

              <Separator />

              <ScrollArea className="min-h-0 flex-1" viewportClassName="px-3.5 py-3">
                <div className="flex flex-col gap-3">
                  <Field label="关系名称" hint="显示在连边上">
                    <Input
                      value={edgeLabelState[0]}
                      onChange={(event) => edgeLabelState[1](event.target.value)}
                      onBlur={() => {
                        const next = edgeLabelState[0].trim()
                        if (next && next !== edge.label) onPatchEdge({ label: next })
                        else edgeLabelState[1](edge.label)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                        if (event.key === 'Escape') edgeLabelState[1](edge.label)
                      }}
                    />
                  </Field>

                  <div className="grid grid-cols-2 items-end gap-3">
                    <Field label="类型">
                      <Select value={edge.type} onValueChange={(value) => onPatchEdge({ type: value as EdgeType })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EDGE_TYPE_ORDER.map((item) => (
                            <SelectItem key={item} value={item}>
                              {EDGE_TYPE_LABELS[item]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="flex h-8 items-center justify-between rounded-md border border-black/10 bg-black/[0.03] px-2.5">
                      <span className="text-micro text-muted-foreground">有向</span>
                      <Switch checked={edge.directed} onCheckedChange={(value) => onPatchEdge({ directed: value })} />
                    </div>
                  </div>

                  {/* 条件 / 可选流动：画布上用虚线表达（例如「halobox 可能是 None」这类只在特定配置下成立的数据流） */}
                  <div className="flex h-8 items-center justify-between rounded-md border border-black/10 bg-black/[0.03] px-2.5">
                    <span
                      className="text-micro text-muted-foreground"
                      title="虚线连线：这条数据流只在某些配置下才成立"
                    >
                      条件 / 可选（虚线）
                    </span>
                    <Switch
                      checked={Boolean(edge.conditional)}
                      onCheckedChange={(value) => onPatchEdge({ conditional: value })}
                    />
                  </div>

                  <Field label="备注" hint="可选">
                    <Textarea
                      value={edgeNoteState[0]}
                      onChange={(event) => edgeNoteState[1](event.target.value)}
                      onBlur={() => {
                        if (edgeNoteState[0] !== edge.note) onPatchEdge({ note: edgeNoteState[0].trim() })
                      }}
                      placeholder="记录依据或前提"
                      className="min-h-[56px]"
                    />
                  </Field>

                  <Separator />

                  <Button variant="secondary" onClick={onEditEdge}>
                    用对话框编辑
                  </Button>
                </div>
              </ScrollArea>

              <Separator />
              <div className="shrink-0 p-3">
                <Button variant="danger-ghost" className="w-full" onClick={onRemoveEdge}>
                  <Trash2 className="h-3.5 w-3.5" />
                  取消这条关系
                </Button>
              </div>
            </>
          ) : null}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
