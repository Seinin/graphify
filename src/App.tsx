import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from './api/client'
import { useGraphSync } from './hooks/useGraphSync'
import { useUnsavedWarning } from './hooks/useUnsavedWarning'
import { countRefs, useMdLibrary } from './hooks/useMdLibrary'
import { useKeyboard } from './hooks/useKeyboard'
import { PANEL_RAIL_WIDTH, usePanelWidth } from './hooks/usePanelWidth'
import { selectSelectedEdge, selectSelectedNode, useGraphStore } from './state/graphStore'
import { TopBar, type GraphView } from './components/TopBar'
import { PhysicsChainView, type ChainFocusRequest } from './components/PhysicsChainView'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { GraphCanvas, type ArrowPorts, type CanvasApi } from './components/GraphCanvas'
import { MdLibraryPanel } from './components/MdLibraryPanel'
import { Inspector, type RelationItem } from './components/Inspector'
import { MdReaderDrawer } from './components/MdReaderDrawer'
import { CodePreviewDrawer } from './components/CodePreviewDrawer'
import { CodePickerDialog } from './components/CodePickerDialog'
import { ResizeHandle } from './components/ResizeHandle'
import { ImportDialog } from './components/ImportDialog'
import { HistoryPanel } from './components/HistoryPanel'
import { HelpDialog } from './components/HelpDialog'
import { ConfirmDialog, type ConfirmState } from './components/ConfirmDialog'
import { EdgeDialog, NodeDialog, type EdgeFormValues, type NodeFormValues } from './components/EntityDialogs'
import { DEFAULT_LAYOUT_KIND, type LayoutKind } from './graph/layout'
import { buildHierarchy, tabVisibleIds } from './graph/hierarchy'
import { graphTopics, topicVisibility, topicVisibilityFingerprint, type TopicVisibility } from './lib/topics'
import { CHAIN_GRAPH, ENGINEERING_LABEL, chainStats, isEngineeringObject } from './lib/physicsChain'
import { codeRefLocation, descendantIdsOf, isCodeRef, type GraphRef, type NodePosition } from './lib/types'
import { TooltipProvider } from './components/ui/tooltip'

interface NodeDialogState {
  open: boolean
  mode: 'create' | 'edit'
  nodeId?: string
  position?: NodePosition | null
  /** 新建节点的层级归属：当前标签页焦点（模块）或选中的装饰框 */
  parent?: string | null
}

interface EdgeDialogState {
  open: boolean
  mode: 'create' | 'edit'
  edgeId?: string
  sourceId?: string
  targetId?: string
}

export default function App() {
  const sync = useGraphSync()
  // 有未保存改动时，刷新/关闭页面先弹原生确认（改动不再自动落盘）
  useUnsavedWarning()
  const md = useMdLibrary()
  const graph = useGraphStore((state) => state.graph)
  const selection = useGraphStore((state) => state.selection)
  const select = useGraphStore((state) => state.select)
  const tabs = useGraphStore((state) => state.tabs)
  const activeTabId = useGraphStore((state) => state.activeTabId)
  const openTab = useGraphStore((state) => state.openTab)
  const closeTabRaw = useGraphStore((state) => state.closeTab)
  const activateTab = useGraphStore((state) => state.activateTab)
  const renameTab = useGraphStore((state) => state.renameTab)
  const hiddenTopicIds = useGraphStore((state) => state.hiddenTopicIds)
  const activeTagIds = useGraphStore((state) => state.activeTagIds)
  const toggleActiveTag = useGraphStore((state) => state.toggleActiveTag)
  const setActiveTags = useGraphStore((state) => state.setActiveTags)
  const toggleTopic = useGraphStore((state) => state.toggleTopic)
  const setHiddenTopics = useGraphStore((state) => state.setHiddenTopics)
  const hiddenRelationIds = useGraphStore((state) => state.hiddenRelationIds)
  const toggleHiddenRelations = useGraphStore((state) => state.toggleHiddenRelations)
  const selectedNode = useGraphStore(selectSelectedNode)
  const selectedEdge = useGraphStore(selectSelectedEdge)
  const pastLength = useGraphStore((state) => state.history.past.length)
  const futureLength = useGraphStore((state) => state.history.future.length)

  /**
   * 布局方式**按标签页各自一份**。
   *
   * 曾经是全局一份，结果「在子图里换一种布局」会把主图与其它子图一起重排——
   * 各视图的节点集合互不相交、坐标空间却共用，于是别的视图被排成一团（用户实测踩到）。
   * 现在只有当前标签页的布局会变，其它标签页保留自己的版面和视口。
   * 新开的标签页默认「手动摆放」：位置是整理好的，不该被自动布局冲掉。
   */
  const [layoutByTab, setLayoutByTab] = useState<Record<string, LayoutKind>>({})
  const layout = layoutByTab[activeTabId] ?? DEFAULT_LAYOUT_KIND
  const [searchQuery, setSearchQuery] = useState('')
  const [connectSource, setConnectSource] = useState<string | null>(null)
  const [refDragPayload, setRefDragPayload] = useState<GraphRef | null>(null)
  const [reader, setReader] = useState<{ open: boolean; docId: string | null; anchor: string | null }>({
    open: false,
    docId: null,
    anchor: null,
  })
  /**
   * 应用内视图：`canvas` = 工程视角图谱（data/graph.json，画布那套）；
   * 物理视角那一页（论文的物理链）正在重建，回来时在这里加一个取值。
   * 初值取自 `?view=matrix`，可分享、刷新不丢。
   */
  /**
   * 视图。目前只有画布一页（`GraphView` 仍是联合类型，物理视角页重建后在这里加取值即可）；
   * `setView` 留给顶栏的分段控件，控件按"多于一项"才渲染。
   */
  const [view, setView] = useState<GraphView>('canvas')
  /** 源码预览抽屉：与 notes 阅读器并列的另一个「读原文」出口 */
  const [codeViewer, setCodeViewer] = useState<{
    open: boolean
    file: string | null
    line: number | null
    endLine: number | null
  }>({ open: false, file: null, line: null, endLine: null })
  const [codePickerOpen, setCodePickerOpen] = useState(false)
  /** 拖线时吸附到的端口，随下一条新建的关系一起落盘 */
  const [pendingPorts, setPendingPorts] = useState<ArrowPorts | null>(null)
  const [nodeDialog, setNodeDialog] = useState<NodeDialogState>({ open: false, mode: 'create' })
  const [edgeDialog, setEdgeDialog] = useState<EdgeDialogState>({ open: false, mode: 'create' })
  const [importOpen, setImportOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [zoom, setZoom] = useState(1)
  /** 激活标签页的可见节点数：状态条与顶栏话题按钮显示用 */
  const [visibleCount, setVisibleCount] = useState(0)
  /** 属性面板要展开明细的全局标签（点画布红点带过来；纯视图状态） */
  const [activeTagId, setActiveTagId] = useState<string | null>(null)
  /**
   * 物理链页的选中也是**本页本地状态**（那一页不碰画布那个 store）。
   * 顶栏检索命中后，这一页拿不到它，所以 App 递一个一次性请求过去（`nonce` 保证重复点也生效）。
   */
  const [chainFocus, setChainFocus] = useState<ChainFocusRequest | null>(null)
  /** 物理链页当前打开的对象名（由本页回报，状态条显示它） */
  const [chainSelection, setChainSelection] = useState<string | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)
  /** 每个标签页一份画布命令式接口：快捷键与工具条只作用于激活标签页 */
  const canvasApisRef = useRef(new Map<string, CanvasApi>())
  const activeApi = useCallback(() => canvasApisRef.current.get(activeTabId) ?? null, [activeTabId])

  /** 直系子节点数表：模块判定（可进入子图）、Inspector 徽标都取这里 */
  const childrenCountOf = useMemo(() => {
    const map = new Map<string, number>()
    graph.nodes.forEach((node) => {
      if (!node.parent) return
      map.set(node.parent, (map.get(node.parent) ?? 0) + 1)
    })
    return map
  }, [graph.nodes])

  /** 激活标签页的焦点（null = 主图） */
  const activeFocusId = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId)?.focusId ?? null,
    [tabs, activeTabId],
  )

  /** 顶栏显示的「当前在哪一层」：主图为 null，子图页给模块名 */
  const activeTabLabel = useMemo(
    () => (activeFocusId ? (tabs.find((tab) => tab.id === activeTabId)?.label ?? null) : null),
    [activeFocusId, tabs, activeTabId],
  )

  /* ---------------- 标签页导航 ---------------- */

  /** 进入某个模块的子图：已有标签页则激活，否则新建并激活 */
  const enterSubgraph = useCallback(
    (nodeId: string) => {
      const node = useGraphStore.getState().graph.nodes.find((item) => item.id === nodeId)
      if (!node || node.type === 'group') return
      if (!(childrenCountOf.get(nodeId) ?? 0)) return
      openTab(node.id, node.label)
    },
    [childrenCountOf, openTab],
  )

  /**
   * 建立关系的唯一入口（点选连线与拖线都走这里）：**大框是容器，不参与关系**，
   * 任一端是大框就直接拒绝并提示，不打开对话框。
   */
  const openCreateEdge = useCallback((sourceId: string, targetId: string, ports: ArrowPorts | null) => {
    const nodes = useGraphStore.getState().graph.nodes
    const isContainer = (id: string) => nodes.find((node) => node.id === id)?.type === 'group'
    if (isContainer(sourceId) || isContainer(targetId)) {
      toast.info('大框是容器，不参与关系；请把关系建在模块之间')
      setConnectSource(null)
      return
    }
    setPendingPorts(ports)
    setEdgeDialog({ open: true, mode: 'create', sourceId, targetId })
  }, [])

  /**
   * 新建一个全局标签并直接归属到当前选中的节点。
   *
   * 两步：先把标签登记进注册表（服务端返回权威图谱），再给节点补上归属——
   * 注册表里没有 id 的标签是写不进去的（服务端会拒），所以顺序不能颠倒。
   */
  const createTag = useCallback(
    (name: string) => {
      api
        .createTag({ name })
        .then(({ graph: incoming, tag }) => {
          useGraphStore.getState().applyServerGraph(incoming)
          const selected = useGraphStore.getState().selection
          if (selected.kind !== 'node' || !selected.id) return
          const node = incoming.nodes.find((item) => item.id === selected.id)
          if (!node || node.tags.includes(tag.id)) return
          sync.patchNode(node.id, { tags: [...node.tags, tag.id] })
        })
        .catch((err: Error) => toast.error('新建标签失败', { description: err.message }))
    },
    [sync],
  )

  /** 关闭标签页：连它的布局方式记录一起丢掉 */
  const closeTab = useCallback(
    (tabId: string) => {
      closeTabRaw(tabId)
      setLayoutByTab((prev) => {
        if (!(tabId in prev)) return prev
        const next = { ...prev }
        delete next[tabId]
        return next
      })
    },
    [closeTabRaw],
  )

  // 节点被删除 / 改名后同步标签页：焦点失效的标签页关闭，改名的换标题
  useEffect(() => {
    tabs.forEach((tab) => {
      if (!tab.focusId) return
      const node = graph.nodes.find((item) => item.id === tab.focusId)
      const childCount = childrenCountOf.get(tab.focusId) ?? 0
      if (!node || node.type === 'group' || childCount === 0) closeTab(tab.id)
      else if (node.label !== tab.label) renameTab(tab.id, node.label)
    })
  }, [graph.nodes, tabs, childrenCountOf, closeTab, renameTab])

  /*
    切页时把**两边的**残留都收干净（双向）：
      · 画布侧：选中、连线模式、引用拖拽、检索词——物理链页没有画布也没有检查器，
        留着会让状态条继续断言「已选中节点」，并让快捷键按一个看不见的对象工作；
      · 物理链侧：一次性定位请求与"当前对象名"——否则从物理链切回画布，本页的关键词
        会跟着过去（原先 `view === 'canvas'` 时直接 return，就是这个方向漏了）。
    见 change graphify-matrix-view-isolation 与本变更的 6.2/6.3。
  */
  useEffect(() => {
    select(null, null)
    setConnectSource(null)
    setRefDragPayload(null)
    setSearchQuery('')
    setChainFocus(null)
    setChainSelection(null)
  }, [view, select])

  // 当前标签页与视图同步到 URL（?g=<focusId>、?view=matrix）：复制链接可还原现场
  useEffect(() => {
    const url = new URL(window.location.href)
    if (activeFocusId) url.searchParams.set('g', activeFocusId)
    else url.searchParams.delete('g')
    if (view === 'canvas') url.searchParams.delete('view')
    else url.searchParams.set('view', view)
    window.history.replaceState(null, '', url)
  }, [activeFocusId, view])

  // 启动时从 URL 恢复标签页：非法 id、叶子、装饰容器一律回退主图
  const urlRestoredRef = useRef(false)
  useEffect(() => {
    if (!sync.ready || urlRestoredRef.current) return
    urlRestoredRef.current = true
    const param = new URLSearchParams(window.location.search).get('g')
    if (!param) return
    const node = graph.nodes.find((item) => item.id === param)
    if (node && node.type !== 'group' && (childrenCountOf.get(param) ?? 0) > 0) {
      openTab(node.id, node.label)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.ready])

  /**
   * 选择排布方案。换成别的方案时由 GraphCanvas 的 effect 立刻重排；
   * 重复点「本来就是当前」的方案时 state 不变、effect 不会跑，这里显式触发一次重排。
   */
  const handleLayoutChange = useCallback(
    (kind: LayoutKind) => {
      setLayoutByTab((prev) => ({ ...prev, [activeTabId]: kind }))
      if (kind === layout) activeApi()?.relayout()
    },
    [activeTabId, layout, activeApi],
  )

  /* ---------------- 面板宽度（纯视图状态，不进撤销栈） ---------------- */

  const inspectorOpen = Boolean(selectedNode || selectedEdge)
  const rowRef = useRef<HTMLDivElement>(null)
  const [rowWidth, setRowWidth] = useState(0)
  // 上一帧的实测宽度：用于互相夹紧（每次只拖一栏，一帧滞后即可收敛）
  const libraryWidthRef = useRef(312)
  const inspectorWidthRef = useRef(326)

  useEffect(() => {
    const element = rowRef.current
    if (!element) return
    const measured = element.getBoundingClientRect().width
    if (measured > 0) setRowWidth(measured)
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setRowWidth(width)
    })
    observer.observe(element)
    return () => observer.disconnect()
    // 依赖 view：矩阵视图下这一行不存在（ref 为 null），切回画布后要重新测量
  }, [view])

  const libraryPanel = usePanelWidth({
    storageKey: 'library',
    side: 'left',
    defaultWidth: 312,
    containerWidth: rowWidth,
    peerWidth: inspectorWidthRef.current,
    peerVisible: inspectorOpen,
  })
  const inspectorPanel = usePanelWidth({
    storageKey: 'inspector',
    side: 'right',
    defaultWidth: 326,
    containerWidth: rowWidth,
    peerWidth: libraryWidthRef.current,
    peerVisible: true,
  })
  libraryWidthRef.current = libraryPanel.collapsed ? PANEL_RAIL_WIDTH : libraryPanel.width
  inspectorWidthRef.current = inspectorPanel.collapsed ? PANEL_RAIL_WIDTH : inspectorPanel.width

  /**
   * 选中对象时，属性面板若是收起状态就自动展开。
   *
   * 收起状态是存在 localStorage 里的（`graphify.panelWidth.v1`），一旦收起来就一直是 36px 细条；
   * 而「选中节点 → 看详情」是用户最直接的期待，面板却纹丝不动地留在细条上，
   * 表现就是「点了半天，侧边栏打不开」。只在**新出现选中**时展开，不会跟用户的手动收起打架。
   */
  const inspectorCollapsed = inspectorPanel.collapsed
  const expandInspector = inspectorPanel.expand
  useEffect(() => {
    if (inspectorOpen && inspectorCollapsed) expandInspector()
  }, [inspectorOpen, inspectorCollapsed, expandInspector])

  /**
   * 改图谱名称：走增量端点（只写名称这一个字段）。
   * 以前是"本地改完借整图 PUT 落盘"，那条通道已随自动保存一起取消。
   */
  const renameGraph = useCallback(
    (name: string) => {
      void sync.rename(name)
    },
    [sync],
  )

  const refCounts = useMemo(() => countRefs(md.docs, graph.nodes), [md.docs, graph.nodes])

  /* -------- 话题开关（可见集 = 不属于任何被关闭话题的节点，父链越界者以「最近的可见祖先」为层级父级） -------- */

  const topicRegistry = useMemo(() => graphTopics(graph), [graph])
  const topic = useMemo(() => topicVisibility(graph, hiddenTopicIds), [graph, hiddenTopicIds])
  // 指纹只在可见集或其层级结构真变时变化：改摘要、拖节点这类编辑不会让画布重新取景
  const topicKey = useMemo(() => topicVisibilityFingerprint(topic), [topic])
  const topicFilter = useMemo<TopicVisibility | null>(
    () => (topic.filtered ? { members: topic.members, hierParentOf: topic.hierParentOf } : null),
    [topic],
  )
  // 全部话题都被关掉时，画布要给恢复入口而不是一片空白
  const showAllTopics = useCallback(() => setHiddenTopics([]), [setHiddenTopics])
  /** 详情页点话题：确保该话题未被关闭（不影响其它话题），并把节点带入选区 */
  const revealTopic = useCallback(
    (topicId: string, nodeId?: string | null) => {
      setHiddenTopics(hiddenTopicIds.filter((id) => id !== topicId))
      if (nodeId) select('node', nodeId)
    },
    [hiddenTopicIds, select, setHiddenTopics],
  )

  const nodeLabelOf = useCallback(
    (id: string) => graph.nodes.find((node) => node.id === id)?.label ?? id,
    [graph.nodes],
  )

  /** 当前标签页的可见节点集合：关系列表的「同视图 / 跨层」判定用 */
  const activeVisibleIds = useMemo(() => {
    const memberSet = topicFilter ? new Set(topicFilter.members) : null
    const members = memberSet ? graph.nodes.filter((node) => memberSet.has(node.id)) : graph.nodes
    const hierarchy = buildHierarchy(
      members.map((node) => ({ id: node.id, parent: node.parent ?? null, frame: node.type === 'group' })),
      topicFilter ? new Map(Object.entries(topicFilter.hierParentOf)) : null,
    )
    return tabVisibleIds(hierarchy, activeFocusId)
  }, [graph.nodes, topicFilter, activeFocusId])

  /** 选中节点的全部关系（含跨层）：画布只画同视图的边，属性页里看全 */
  const relations = useMemo<RelationItem[]>(() => {
    if (!selectedNode) return []
    return graph.edges
      .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
      .map((edge) => {
        const outgoing = edge.source === selectedNode.id
        const otherId = outgoing ? edge.target : edge.source
        return {
          id: edge.id,
          label: edge.label,
          otherId,
          otherLabel: nodeLabelOf(otherId),
          outgoing,
          sameView: activeVisibleIds.has(edge.source) && activeVisibleIds.has(edge.target),
        }
      })
  }, [selectedNode, graph.edges, nodeLabelOf, activeVisibleIds])

  /* ---------------- 引用操作 ---------------- */

  const addRefToNode = useCallback(
    (nodeId: string, ref: GraphRef) => {
      const node = useGraphStore.getState().graph.nodes.find((item) => item.id === nodeId)
      if (!node) return
      /**
       * 去重口径按引用类型分开：
       *   · 源码引用看「文件 + 行区间」（同一函数被引用两次没意义，但同一文件的不同行是两条）；
       *   · 文档引用沿用「docId + anchor」。
       */
      const duplicated = node.refs.some((item) =>
        isCodeRef(ref)
          ? isCodeRef(item) && codeRefLocation(item) === codeRefLocation(ref)
          : !isCodeRef(item) && item.docId === ref.docId && item.anchor === ref.anchor,
      )
      if (duplicated) {
        toast.info('该引用已存在', { description: isCodeRef(ref) ? codeRefLocation(ref) : ref.docId })
        return
      }
      select('node', nodeId)
      sync.patchNode(nodeId, { refs: [...node.refs, ref] })
      toast.success('已添加引用', { description: `${node.label} → ${ref.label || ref.docId}` })
    },
    [select, sync],
  )

  const removeRefFromNode = useCallback(
    (index: number) => {
      if (!selectedNode) return
      const refs = selectedNode.refs.filter((_, position) => position !== index)
      sync.patchNode(selectedNode.id, { refs })
      toast.success('已移除引用')
    },
    [selectedNode, sync],
  )

  /** 点引用：源码引用开代码预览，文档引用开 md 阅读器（同一个按钮，两条出口） */
  const openRef = useCallback((ref: GraphRef) => {
    if (isCodeRef(ref)) {
      setCodeViewer({
        open: true,
        file: ref.file ?? null,
        line: ref.line ?? null,
        endLine: ref.endLine ?? null,
      })
      return
    }
    setReader({ open: true, docId: ref.docId, anchor: ref.anchor || null })
  }, [])

  /* ---------------- 删除（可撤销） ---------------- */

  const confirmDeleteNode = useCallback(() => {
    if (!selectedNode) return
    const node = selectedNode
    setConfirm({
      title: `删除节点「${node.label}」？`,
      description: `与它相连的关系会一并移除。删除后可在提示条中撤销，也可在版本历史里回滚。`,
      confirmLabel: '删除节点',
      danger: true,
      onConfirm: () => {
        select(null, null)
        sync.removeNode(node.id).then((result) => {
          if (!result) return
          toast('已删除节点', {
            description: `「${node.label}」及其关系已移除`,
            action: { label: '撤销', onClick: () => sync.undo() },
          })
        })
      },
    })
  }, [select, selectedNode, sync])

  const confirmDeleteEdge = useCallback(() => {
    if (!selectedEdge) return
    const edge = selectedEdge
    setConfirm({
      title: `取消关系「${edge.label}」？`,
      description: `${nodeLabelOf(edge.source)} → ${nodeLabelOf(edge.target)}，取消后可在提示条中撤销。`,
      confirmLabel: '取消关系',
      danger: true,
      onConfirm: () => {
        select(null, null)
        sync.removeEdge(edge.id).then((result) => {
          if (!result) return
          toast('已取消关系', {
            description: `${nodeLabelOf(edge.source)} → ${nodeLabelOf(edge.target)}`,
            action: { label: '撤销', onClick: () => sync.undo() },
          })
        })
      },
    })
  }, [nodeLabelOf, select, selectedEdge, sync])

  /* ---------------- 大框（装饰容器）操作 ---------------- */

  /**
   * 新建大框并把某个节点放进去。新框与节点同层（继承节点的父级），
   * 这样它一定出现在当前标签页里，而不是跑到别的视图去。
   */
  const createGroupWithNode = useCallback(
    (nodeId: string) => {
      const node = useGraphStore.getState().graph.nodes.find((item) => item.id === nodeId)
      if (!node) return
      sync
        .createNode({
          label: '新大框',
          type: 'group',
          parent: node.parent ?? null,
          position: node.position ? { ...node.position } : null,
        })
        .then((result) => {
          if (!result) return
          sync.patchNode(nodeId, { parent: result.node.id })
          toast.success('已建立大框', { description: `「${node.label}」已放入新大框，可改名后继续拖入其它节点` })
        })
    },
    [sync],
  )

  const createGroupAt = useCallback(
    (position: NodePosition, containerId: string | null) => {
      sync.createNode({ label: '新大框', type: 'group', parent: containerId, position })
      toast.success('已新建大框', { description: '把节点拖进它的范围即可装进来' })
    },
    [sync],
  )

  /** 移出大框 = 上提一层（到祖父级），保证节点仍留在当前标签页的可见范围里 */
  const detachFromGroup = useCallback(
    (nodeId: string) => {
      const node = useGraphStore.getState().graph.nodes.find((item) => item.id === nodeId)
      if (!node?.parent) return
      const parent = useGraphStore.getState().graph.nodes.find((item) => item.id === node.parent)
      sync.patchNode(nodeId, { parent: parent?.parent ?? null })
      toast.success('已移出大框')
    },
    [sync],
  )

  /** 画布上把一个节点拖进 / 拖出大框的落地动作：落在空白处 = 归当前标签页的焦点 */
  const handleNodeReparent = useCallback(
    (nodeId: string, containerId: string | null) => {
      const parent = containerId ?? activeFocusId
      sync.patchNode(nodeId, { parent })
      const container = parent ? graph.nodes.find((item) => item.id === parent) : null
      toast.success(container ? `已放入「${container.label}」` : '已移到顶层')
    },
    [graph.nodes, sync, activeFocusId],
  )

  /** 「所属大框」下拉的可选值：排掉自身与自己的子孙（不能把自己塞进自己身体里） */
  const groupOptions = useMemo(() => {
    if (!selectedNode) return []
    const descendants = descendantIdsOf(graph.nodes, selectedNode.id)
    return graph.nodes
      .filter((item) => item.type === 'group' && item.id !== selectedNode.id && !descendants.has(item.id))
      .map((item) => ({ id: item.id, label: item.label }))
  }, [graph.nodes, selectedNode])

  /* ---------------- 节点/关系对话框 ---------------- */

  /**
   * 新建节点的归属：当前选中装饰框则进框，否则归当前标签页的焦点模块（主图则为顶层）。
   * 这样「添加节点」一定落在正在看的这个视图里。
   */
  const requestCreateNode = useCallback(
    (position: NodePosition | null) => {
      const state = useGraphStore.getState()
      const selected = state.selection.kind === 'node' ? state.graph.nodes.find((n) => n.id === state.selection.id) : null
      const parent = selected?.type === 'group' ? selected.id : activeFocusId
      setNodeDialog({ open: true, mode: 'create', position, parent })
    },
    [activeFocusId],
  )

  const submitNodeDialog = (values: NodeFormValues) => {
    if (nodeDialog.mode === 'create') {
      sync.createNode({
        ...values,
        parent: nodeDialog.parent ?? null,
        position: nodeDialog.position ?? null,
        refs: [],
      })
      return
    }
    if (nodeDialog.nodeId) sync.patchNode(nodeDialog.nodeId, values)
  }

  const submitEdgeDialog = (values: EdgeFormValues) => {
    if (edgeDialog.mode === 'create' && edgeDialog.sourceId && edgeDialog.targetId) {
      // 兜底：对话框里也可能把端点改成大框（容器不参与关系）
      const nodes = useGraphStore.getState().graph.nodes
      const isContainer = (id: string) => nodes.find((node) => node.id === id)?.type === 'group'
      if (isContainer(edgeDialog.sourceId) || isContainer(edgeDialog.targetId)) {
        toast.info('大框是容器，不参与关系；请把关系建在模块之间')
        return
      }
      sync.createEdge({
        source: edgeDialog.sourceId,
        target: edgeDialog.targetId,
        ...values,
        // 拖线时吸附到的端口跟着落盘：否则箭头会退回到「自动选边」
        ...(pendingPorts ?? {}),
      })
      setPendingPorts(null)
      return
    }
    if (edgeDialog.edgeId) sync.patchEdge(edgeDialog.edgeId, values)
  }

  /* ---------------- 快捷键 ---------------- */

  /*
    快捷键只在画布视图注册（见 change graphify-matrix-view-isolation）。
    矩阵页的选中状态已被清空，键盘却还按「看不见的选中」工作——在矩阵页按 Delete
    就是删掉一个用户根本看不见的节点。跨视图动作（另存、帮助）两种视图都保留。
  */
  useKeyboard(
    view !== 'canvas'
      ? {
          onSave: sync.saveNow,
          onToggleHelp: () => setHelpOpen((prev) => !prev),
        }
      : {
          onUndo: sync.undo,
          onRedo: sync.redo,
          onSave: sync.saveNow,
          onFocusSearch: () => searchInputRef.current?.focus(),
          onNewNode: () => requestCreateNode(null),
          onRelayout: () => activeApi()?.relayout(),
          onFit: () => activeApi()?.fit(),
          onToggleHelp: () => setHelpOpen((prev) => !prev),
          onToggleConnect: () => {
            if (!selectedNode) {
              toast.info('请先选中一个节点')
              return
            }
            setConnectSource((prev) => (prev ? null : selectedNode.id))
          },
          onDelete: () => {
            if (selection.kind === 'node') confirmDeleteNode()
            else if (selection.kind === 'edge') confirmDeleteEdge()
          },
          onEscape: () => {
            if (connectSource) {
              setConnectSource(null)
              return
            }
            select(null, null)
          },
        },
  )

  const overlayOpen =
    reader.open ||
    codeViewer.open ||
    codePickerOpen ||
    nodeDialog.open ||
    edgeDialog.open ||
    importOpen ||
    historyOpen ||
    helpOpen ||
    Boolean(confirm)

  /* ---------------- 物理链页的口径（检索作用哪份图、命中来源、状态条数字） ---------------- */

  /** 本页规模：四个数都从生成物里数出来（静态数据，算一次就够） */
  const chainSelfStats = useMemo(() => chainStats(), [])
  /** 命中项来源徽标：属于收起层（旁路与实现细节）的才标，其余走默认「节点 / 关系」 */
  const chainBadgeOf = useCallback(
    (kind: 'node' | 'edge', id: string) => (isEngineeringObject(kind, id) ? ENGINEERING_LABEL : null),
    [],
  )

  return (
    <TooltipProvider delayDuration={260} skipDelayDuration={120}>
      <div className="flex h-screen w-screen flex-col gap-2 bg-background p-2">
        <TopBar
          view={view}
          onViewChange={setView}
          graph={graph}
          // 物理链页检索的是**它自己那份图**，并给收起层里的命中标注来源
          searchGraph={view === 'chain' ? CHAIN_GRAPH : undefined}
          resultBadgeOf={view === 'chain' ? chainBadgeOf : undefined}
          searchQuery={searchQuery}
          searchInputRef={searchInputRef}
          onSearchChange={setSearchQuery}
          onSelectResult={(kind, id) => {
            // 物理链页的选中是那一页的本地状态：递一次性请求过去，由它自己选中（必要时先展开折叠条）
            if (view === 'chain') setChainFocus((prev) => ({ kind, id, nonce: (prev?.nonce ?? 0) + 1 }))
            else select(kind, id)
            setSearchQuery('')
          }}
          canUndo={pastLength > 0}
          canRedo={futureLength > 0}
          onUndo={sync.undo}
          onRedo={sync.redo}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          hiddenTopicIds={hiddenTopicIds}
          onToggleTopic={(topicId) => {
            toggleTopic(topicId)
            setConnectSource(null)
          }}
          onSetHiddenTopics={(ids) => {
            setHiddenTopics(ids)
            setConnectSource(null)
          }}
          visibleCount={visibleCount}
          activeTagIds={activeTagIds}
          onToggleTag={toggleActiveTag}
          onClearActiveTags={() => setActiveTags([])}
          onOpenImport={() => setImportOpen(true)}
          onOpenHistory={() => setHistoryOpen(true)}
          onSave={sync.saveNow}
          onRename={renameGraph}
          activeTabLabel={activeTabLabel}
          onToggleHelp={() => setHelpOpen(true)}
        />

        {/* 只有画布一页；物理视角页重建后在这里加分支 */}
        {view === 'canvas' ? (
        <div ref={rowRef} className="flex min-h-0 flex-1 gap-2">
          <MdLibraryPanel
            docs={md.filtered}
            loading={md.loading}
            error={md.error}
            query={md.query}
            mdDir={md.mdDir}
            totalChars={md.totalChars}
            refCounts={refCounts}
            activeDocId={reader.open ? reader.docId : null}
            canAddRef={Boolean(selectedNode)}
            width={libraryPanel.width}
            collapsed={libraryPanel.collapsed}
            onToggleCollapsed={libraryPanel.toggleCollapsed}
            onQueryChange={md.setQuery}
            onRefresh={() => md.refresh(true)}
            onOpenDoc={(docId, anchor) => setReader({ open: true, docId, anchor: anchor ?? null })}
            onAddRef={(docId, anchor, label) => {
              if (!selectedNode) return
              addRefToNode(selectedNode.id, { docId, anchor: anchor ?? '', label: label ?? '' })
            }}
            onDragRefStart={setRefDragPayload}
          />

          <ResizeHandle
            label="notes 数据库"
            dragging={libraryPanel.dragging}
            collapsed={libraryPanel.collapsed}
            {...libraryPanel.handleProps}
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <TabBar tabs={tabs} activeTabId={activeTabId} onActivate={activateTab} onClose={closeTab} />
            <div className="relative flex min-h-0 flex-1">
              {tabs.map((tab) => (
                <GraphCanvas
                  key={tab.id}
                  focusId={tab.focusId}
                  active={tab.id === activeTabId}
                  ready={sync.ready}
                  layout={layout}
                  connectSource={connectSource}
                  refDragPayload={refDragPayload}
                  topicFilter={topicFilter}
                  topicKey={topicKey}
                  overlayOpen={overlayOpen}
                  registerApi={(api) => {
                    if (api) canvasApisRef.current.set(tab.id, api)
                    else canvasApisRef.current.delete(tab.id)
                  }}
                  onZoomChange={setZoom}
                  onVisibilityChange={(info) => setVisibleCount(info.visible)}
                  onLayoutChange={handleLayoutChange}
                  onEnterSubgraph={enterSubgraph}
                  // 点红点：选中节点（渲染器里已做）并把要展开的标签报给面板
                  onOpenTagDetail={(_nodeId, tagId) => setActiveTagId(tagId)}
                  onConnectComplete={(sourceId, targetId) => {
                    setConnectSource(null)
                    // 点选式连线没有吸附过程，端口一律留空（= 自动选边）
                    if (targetId) openCreateEdge(sourceId, targetId, null)
                  }}
                  onConnectCancel={() => setConnectSource(null)}
                  onAddRefToNode={addRefToNode}
                  onNodeReparent={handleNodeReparent}
                  onCreateGroupWithNode={createGroupWithNode}
                  onCreateGroupAt={createGroupAt}
                  onDetachFromGroup={detachFromGroup}
                  onRequestCreateNode={requestCreateNode}
                  onRequestCreateEdge={(sourceId, targetId, ports) => openCreateEdge(sourceId, targetId, ports ?? null)}
                  onRequestEditNode={(nodeId) => setNodeDialog({ open: true, mode: 'edit', nodeId })}
                  onRequestEditEdge={(edgeId) => setEdgeDialog({ open: true, mode: 'edit', edgeId })}
                  onRequestDeleteNode={(nodeId) => {
                    select('node', nodeId)
                    setConfirm({
                      title: `删除节点「${nodeLabelOf(nodeId)}」？`,
                      description: '与它相连的关系会一并移除，删除后仍可撤销。',
                      confirmLabel: '删除节点',
                      danger: true,
                      onConfirm: () => {
                        select(null, null)
                        sync.removeNode(nodeId).then((result) => {
                          if (!result) return
                          toast('已删除节点', { action: { label: '撤销', onClick: () => sync.undo() } })
                        })
                      },
                    })
                  }}
                  onRequestDeleteEdge={(edgeId) => {
                    select('edge', edgeId)
                    const edge = useGraphStore.getState().graph.edges.find((item) => item.id === edgeId)
                    if (!edge) return
                    setConfirm({
                      title: `取消关系「${edge.label}」？`,
                      description: '取消后可在提示条中撤销。',
                      confirmLabel: '取消关系',
                      danger: true,
                      onConfirm: () => {
                        select(null, null)
                        sync.removeEdge(edgeId).then((result) => {
                          if (!result) return
                          toast('已取消关系', { action: { label: '撤销', onClick: () => sync.undo() } })
                        })
                      },
                    })
                  }}
                  onFocusLibrary={() => md.refresh(false)}
                  onOpenImport={() => setImportOpen(true)}
                  onPositionsSettled={sync.applyPositions}
                  onPositionEditStart={sync.beginPositionEdit}
                  topicsAllClosed={topic.allHidden}
                  onEnableAllTopics={showAllTopics}
                />
              ))}
            </div>
          </div>

          {inspectorOpen ? (
            <>
              <ResizeHandle
                label="节点详情"
                dragging={inspectorPanel.dragging}
                collapsed={inspectorPanel.collapsed}
                {...inspectorPanel.handleProps}
              />
              <Inspector
                node={selectedNode}
                edge={selectedEdge}
                sourceLabel={selectedEdge ? nodeLabelOf(selectedEdge.source) : ''}
                targetLabel={selectedEdge ? nodeLabelOf(selectedEdge.target) : ''}
                topics={topicRegistry}
                width={inspectorPanel.width}
                collapsed={inspectorPanel.collapsed}
                onToggleCollapsed={inspectorPanel.toggleCollapsed}
                onOpenTopic={(topicId) => revealTopic(topicId, selectedNode?.id ?? null)}
                onPatchNode={(patch) => selectedNode && sync.patchNode(selectedNode.id, patch)}
                onPatchEdge={(patch) => selectedEdge && sync.patchEdge(selectedEdge.id, patch)}
                onRemoveNode={confirmDeleteNode}
                onRemoveEdge={confirmDeleteEdge}
                onEditEdge={() =>
                  selectedEdge && setEdgeDialog({ open: true, mode: 'edit', edgeId: selectedEdge.id })
                }
                onConnectFrom={(nodeId) => setConnectSource(nodeId)}
                relationsHidden={selectedNode ? hiddenRelationIds.includes(selectedNode.id) : false}
                onToggleRelations={toggleHiddenRelations}
                onOpenRef={openRef}
                onRemoveRef={removeRefFromNode}
                onAddCodeRef={() => setCodePickerOpen(true)}
                groupOptions={groupOptions}
                childCount={selectedNode ? (childrenCountOf.get(selectedNode.id) ?? 0) : 0}
                onEnterSubgraph={() => selectedNode && enterSubgraph(selectedNode.id)}
                // 有子图的模块显示的标签 = 当前子树叶子并集：节点表递给面板，口径由 lib/tagEdit 统一算
                nodes={graph.nodes}
                tagRegistry={graph.meta.tags ?? []}
                activeTagId={activeTagId}
                onCreateTag={createTag}
                relations={relations}
                onSelectRelation={(edgeId) => select('edge', edgeId)}
                onClose={() => select(null, null)}
              />
            </>
          ) : null}
        </div>
        ) : (
          <PhysicsChainView focus={chainFocus} onSelectionChange={setChainSelection} />
        )}

        {/*
          物理链页用手动摆放（坐标由生成物给出），状态条也只报本页口径
          （物理过程 / 子过程 / 参数 / 文献 + 当前对象名）——画布那几个数在这一页没有意义。
        */}
        <StatusBar
          layout={view === 'canvas' ? layout : 'manual'}
          zoom={zoom}
          connectMode={Boolean(connectSource)}
          visibleCount={visibleCount}
          selfStats={view === 'chain' ? { ...chainSelfStats, current: chainSelection } : undefined}
        />

        <MdReaderDrawer
          open={reader.open}
          onOpenChange={(open) => setReader((prev) => ({ ...prev, open }))}
          docId={reader.docId}
          anchor={reader.anchor}
          canAddRef={Boolean(selectedNode)}
          onAddRef={(ref) => selectedNode && addRefToNode(selectedNode.id, ref)}
        />

        <CodePreviewDrawer
          open={codeViewer.open}
          onOpenChange={(open) => setCodeViewer((prev) => ({ ...prev, open }))}
          file={codeViewer.file}
          line={codeViewer.line}
          endLine={codeViewer.endLine}
          canAddRef={Boolean(selectedNode)}
          onAddRef={(ref) => selectedNode && addRefToNode(selectedNode.id, ref)}
        />

        <CodePickerDialog
          open={codePickerOpen}
          onOpenChange={setCodePickerOpen}
          targetLabel={selectedNode?.label}
          onPick={(ref) => selectedNode && addRefToNode(selectedNode.id, ref)}
        />

        <NodeDialog
          open={nodeDialog.open}
          mode={nodeDialog.mode}
          initial={nodeDialog.nodeId ? graph.nodes.find((node) => node.id === nodeDialog.nodeId) : undefined}
          onOpenChange={(open) => setNodeDialog((prev) => ({ ...prev, open }))}
          onSubmit={submitNodeDialog}
        />

        <EdgeDialog
          open={edgeDialog.open}
          mode={edgeDialog.mode}
          sourceLabel={
            edgeDialog.sourceId
              ? nodeLabelOf(edgeDialog.sourceId)
              : selectedEdge
                ? nodeLabelOf(selectedEdge.source)
                : ''
          }
          targetLabel={
            edgeDialog.targetId
              ? nodeLabelOf(edgeDialog.targetId)
              : selectedEdge
                ? nodeLabelOf(selectedEdge.target)
                : ''
          }
          initial={edgeDialog.edgeId ? graph.edges.find((edge) => edge.id === edgeDialog.edgeId) : undefined}
          onOpenChange={(open) => setEdgeDialog((prev) => ({ ...prev, open }))}
          onSubmit={submitEdgeDialog}
        />

        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          docs={md.docs}
          onImported={() => {
            sync.reload()
            md.refresh(false)
          }}
        />

        <HistoryPanel
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          onRolledBack={() => {
            select(null, null)
            md.refresh(false)
          }}
        />

        <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

        <ConfirmDialog state={confirm} onOpenChange={(open) => (open ? null : setConfirm(null))} />
      </div>
    </TooltipProvider>
  )
}
