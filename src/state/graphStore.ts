import { create } from 'zustand'
import {
  cloneGraph,
  emptyGraph,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Selection,
  type SelectionKind,
} from '../lib/types'
import {
  canRedo,
  canUndo,
  emptyHistory,
  pushHistory,
  redoStep,
  undoStep,
  type HistoryState,
} from './undo'
import { topicVisibility } from '../lib/topics'
import {
  HIDDEN_RELATIONS_KEY,
  readStringArrayPreference,
  writeStringArrayPreference,
} from '../lib/viewPreferences'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * 一个子图标签页：主图固定为 id 'main'（focusId null），
 * 其余每个标签页对应一个模块（focusId = 模块节点 id）。
 */
export interface TabInfo {
  id: string
  focusId: string | null
  label: string
}

export const MAIN_TAB: TabInfo = { id: 'main', focusId: null, label: '主图' }

interface MutateOptions {
  /** 是否记录到撤销栈（拖拽过程中的连续坐标变化应传 false） */
  history?: boolean
}

interface GraphState {
  graph: Graph
  history: HistoryState
  selection: Selection
  /** 打开的标签页（主图固定在最前，不可关闭） */
  tabs: TabInfo[]
  activeTabId: string
  /** 各标签页离开时的选中态：切回来时恢复，实现「每个标签页记住自己的选中」 */
  selectionStash: Record<string, Selection>
  /**
   * 被关闭的话题集合（纯视图状态：不入撤销栈、不落盘）。
   * 空数组表示不做过滤、显示整张图谱——旧图与骨架视图都走这条路径。
   * 存「被关闭」而不是「被开启」：默认全开，新增话题自动可见，无需同步。
   */
  hiddenTopicIds: string[]
  /**
   * 被收起关系的模块集合（纯视图状态 + **本机记忆**）。
   *
   * 与其它视图状态的区别只有一处：它记在浏览器本地存储里，刷新/重开页面后保持
   * （与面板宽度同类）。仍然不入撤销栈、不写图谱数据——换机器或用别人的链接打开不带它。
   * 命中的模块，其**语义关系连线**不绘制；节点本身、坐标与层级结构一概不动。
   */
  hiddenRelationIds: string[]
  /**
   * 被勾选的全局标签（纯视图状态：不入撤销栈、不落盘，刷新页面回到「一个都没勾」）。
   * 勾上哪个，持有该标签的模块就在画布左上角亮红点。
   */
  activeTagIds: string[]
  hoveredNodeId: string | null
  highlightedNodeIds: string[]
  /** 每次本地变更自增，用于丢弃过期的服务端响应 */
  revision: number
  dirty: boolean
  saveState: SaveState
  saving: boolean
  lastSavedAt: string
  error: string | null
  /**
   * **只在本机改过坐标**的节点 id。
   *
   * 手动保存的第一步只把这些节点批量写回工作文件：既不做整图坐标回写，也不逐节点写
   * （逐节点写会把 50 份历史刷满坐标噪声）。保存成功或重新加载时清空。
   */
  pendingPositionIds: string[]

  loadGraph: (graph: Graph) => void
  /** 切换单个话题的显示 / 隐藏 */
  toggleTopic: (topicId: string) => void
  /** 一次性设置被关闭的话题集合（全选 / 全不选 / 恢复某话题用） */
  setHiddenTopics: (topicIds: readonly string[]) => void
  /** 收起 / 展开某个模块的关系（纯视图 + 本机记忆，一次点击写一次存储） */
  toggleHiddenRelations: (nodeId: string) => void
  /** 一次性设置被收起关系的模块集合（归一化后写存储） */
  setHiddenRelationIds: (ids: readonly string[]) => void
  /** 勾选 / 取消一个全局标签 */
  toggleActiveTag: (tagId: string) => void
  /** 一次性设置勾选的标签集合 */
  setActiveTags: (tagIds: readonly string[]) => void
  mutate: (mutator: (draft: Graph) => void, options?: MutateOptions) => void
  /** 只记录撤销点，不改动当前图谱（结构性操作在发起请求前调用） */
  pushHistoryPoint: () => void
  /** 记下"坐标只在本机改过"的节点（手动保存时只提交这些） */
  notePendingPositions: (ids: readonly string[]) => void
  applyServerGraph: (graph: Graph, options?: MutateOptions) => void
  markSaved: (graph?: Graph) => void
  setSaveState: (state: SaveState, error?: string | null) => void
  setSaving: (saving: boolean) => void
  undo: () => Graph | null
  redo: () => Graph | null
  select: (kind: SelectionKind, id: string | null) => void
  /** 打开（或激活）某个模块的子图标签页 */
  openTab: (focusId: string, label: string) => void
  /** 关闭标签页；主图不可关闭。关闭激活标签后激活其左侧相邻标签 */
  closeTab: (tabId: string) => void
  activateTab: (tabId: string) => void
  /** 节点改名后同步标签页标题 */
  renameTab: (tabId: string, label: string) => void
  setHovered: (nodeId: string | null) => void
  setHighlighted: (ids: string[]) => void
  reset: () => void
}

const initialSelection: Selection = { kind: null, id: null }

export const useGraphStore = create<GraphState>((set, get) => ({
  graph: emptyGraph(),
  history: emptyHistory(),
  selection: initialSelection,
  tabs: [MAIN_TAB],
  activeTabId: 'main',
  selectionStash: {},
  hiddenTopicIds: [],
  // 初值直接来自本机存储：刷新后自动恢复上次收起的那几个模块
  hiddenRelationIds: readStringArrayPreference(HIDDEN_RELATIONS_KEY),
  activeTagIds: [],
  hoveredNodeId: null,
  highlightedNodeIds: [],
  revision: 0,
  dirty: false,
  saveState: 'idle',
  saving: false,
  lastSavedAt: '',
  error: null,
  pendingPositionIds: [],

  /** 初次加载：重置历史，避免把服务端初始态当成可撤销操作 */
  loadGraph: (graph) =>
    set({
      graph: cloneGraph(graph),
      history: emptyHistory(),
      revision: 0,
      dirty: false,
      saveState: 'idle',
      lastSavedAt: graph.meta.updatedAt || '',
      error: null,
      pendingPositionIds: [],
    }),

  /**
   * 切换单个话题的显示 / 隐藏。开关只换可见集，不重建元素，因此节点位置不会丢。
   */
  toggleTopic: (topicId) => {
    const { hiddenTopicIds } = get()
    const hidden = hiddenTopicIds.includes(topicId)
      ? hiddenTopicIds.filter((id) => id !== topicId)
      : [...hiddenTopicIds, topicId]
    get().setHiddenTopics(hidden)
  },

  /**
   * 设置被关闭的话题集合：只换可见集，不重建元素，因此节点位置不会丢。
   * 展开状态按新可见集重算（见 GraphRenderer.resetExpansion），不跨开关状态沿用。
   * 若当前选中的节点/关系在新可见集里不可见，则一并清掉选中，避免详情页停留在画布外的东西上。
   */
  setHiddenTopics: (topicIds) => {
    const { graph, selection } = get()
    const view = topicVisibility(graph, topicIds)
    const kind = selection.kind
    const id = selection.id
    const keepSelection =
      !kind ||
      !id ||
      (kind === 'node'
        ? view.memberIds.has(id)
        : (() => {
            const edge = graph.edges.find((item) => item.id === id)
            return Boolean(edge) && view.memberIds.has(edge!.source) && view.memberIds.has(edge!.target)
          })())
    set({
      // 存归一化后的集合：未注册的 id 在计算时已被剔除，避免开关状态与画布不一致
      hiddenTopicIds: view.hiddenTopicIds,
      selection: keepSelection ? selection : initialSelection,
    })
  },

  /**
   * 收起 / 展开某个模块的关系。只换一条边的显示规则，不重建元素，因此节点位置不会丢。
   * 纯视图动作：不标脏、不触发保存、不进撤销栈（本次会话之外只留一份本机偏好）。
   */
  toggleHiddenRelations: (nodeId) => {
    const { hiddenRelationIds } = get()
    const hidden = hiddenRelationIds.includes(nodeId)
      ? hiddenRelationIds.filter((id) => id !== nodeId)
      : [...hiddenRelationIds, nodeId]
    get().setHiddenRelationIds(hidden)
  },

  /**
   * 设置被收起关系的模块集合。
   *
   * 三件事都收敛在这里（切换动作只负责算出新集合）：
   *   · 归一化并丢掉图谱里不存在的 id——换了图谱之后旧 id 会留在本机存储里，
   *     不清理就会变成看不见的幽灵状态；
   *   · 写一次本机存储（一次点击一次，无高频写）；
   *   · 选中兜底：正选中的关系被收起时清掉选中，免得详情面板停在一条看不见的线上
   *     （与 `setHiddenTopics` 同一口径）。
   */
  setHiddenRelationIds: (ids) => {
    const { graph, selection } = get()
    const known = new Set(graph.nodes.map((node) => node.id))
    const hidden = new Set([...new Set(ids)].filter((id) => known.has(id)))
    const edge =
      selection.kind === 'edge' && selection.id
        ? graph.edges.find((item) => item.id === selection.id)
        : undefined
    const keepSelection = !edge || (!hidden.has(edge.source) && !hidden.has(edge.target))
    const next = [...hidden]
    writeStringArrayPreference(HIDDEN_RELATIONS_KEY, next)
    set({
      hiddenRelationIds: next,
      selection: keepSelection ? selection : initialSelection,
    })
  },

  /** 勾选 / 取消勾选一个全局标签（纯视图：不标脏、不触发保存） */
  toggleActiveTag: (tagId) => {
    const { activeTagIds } = get()
    const next = activeTagIds.includes(tagId)
      ? activeTagIds.filter((id) => id !== tagId)
      : [...activeTagIds, tagId]
    set({ activeTagIds: next })
  },

  setActiveTags: (tagIds) => set({ activeTagIds: [...new Set(tagIds)] }),

  /**
   * 本地变更：可选记录历史。
   * 结构性操作随后由同步层立刻写服务端；**只改本机的改动（坐标、撤销）留待手动保存**，
   * 期间以 `dirty` 表示"本机与服务端不一致"。
   */
  mutate: (mutator, options = {}) => {
    const { history = true } = options
    const current = get().graph
    const draft = cloneGraph(current)
    mutator(draft)
    draft.meta.updatedAt = new Date().toISOString()
    set((state) => ({
      graph: draft,
      history: history ? pushHistory(state.history, current) : state.history,
      revision: state.revision + 1,
      dirty: true,
    }))
  },

  pushHistoryPoint: () => set((state) => ({ history: pushHistory(state.history, state.graph) })),

  /** 记下坐标只在本机改过的节点（去重；保存时只提交这些） */
  notePendingPositions: (ids) => {
    if (!ids.length) return
    set((state) => ({
      pendingPositionIds: [...new Set([...state.pendingPositionIds, ...ids])],
    }))
  },

  /**
   * 服务端返回的权威图谱。
   *
   * 若本地存在尚未落盘的改动（例如刚拖动完节点、还没手动保存），会把本地坐标合并进
   * 服务端结果，并保持 `dirty`，避免「服务端响应覆盖本地新位置」造成的跳动。
   * 自动保存取消后 `dirty` 会长期为真，这段合并因此更要紧——坐标是**只在本机**的改动，
   * 只有手动保存的第一步才会把它们写回工作文件。
   */
  applyServerGraph: (graph, options = {}) => {
    const { history = false } = options
    const current = get().graph
    const wasDirty = get().dirty
    const incoming = cloneGraph(graph)

    if (wasDirty) {
      const localPositions = new Map(
        current.nodes.filter((node) => node.position).map((node) => [node.id, node.position]),
      )
      incoming.nodes.forEach((node) => {
        const position = localPositions.get(node.id)
        if (position) node.position = { ...position }
      })
    }

    set((state) => ({
      graph: incoming,
      history: history ? pushHistory(state.history, current) : state.history,
      revision: state.revision + 1,
      dirty: wasDirty,
      saveState: wasDirty ? 'idle' : 'saved',
      lastSavedAt: wasDirty ? state.lastSavedAt : graph.meta.updatedAt || new Date().toISOString(),
      error: null,
    }))
  },

  markSaved: (graph) =>
    set((state) => ({
      graph: graph ? cloneGraph(graph) : state.graph,
      dirty: false,
      saveState: 'saved',
      lastSavedAt: graph?.meta.updatedAt || new Date().toISOString(),
      error: null,
      // 手动保存已把本机坐标写回工作文件，待写集合随之清空
      pendingPositionIds: [],
    })),

  setSaveState: (saveState, error = null) => set({ saveState, error }),

  setSaving: (saving) => set({ saving }),

  /**
   * 撤销：只回退本机（不再写盘）。
   *
   * 整图覆盖已被禁止，所以撤销**没有**"立即落盘"这一步：它只把本机状态退回去并标脏，
   * 工作文件仍是"服务端已执行"的状态。要让撤销后的状态留存，走手动保存（另存为副本）。
   */
  undo: () => {
    const { history, graph } = get()
    if (!canUndo(history)) return null
    const result = undoStep(history, graph)
    if (!result.applied) return null
    set({
      graph: result.applied,
      history: result.history,
      revision: get().revision + 1,
      dirty: true,
      saveState: 'idle',
    })
    return result.applied
  },

  /** 重做：与撤销同一口径——只作用于本机会话，不写盘 */
  redo: () => {
    const { history, graph } = get()
    if (!canRedo(history)) return null
    const result = redoStep(history, graph)
    if (!result.applied) return null
    set({
      graph: result.applied,
      history: result.history,
      revision: get().revision + 1,
      dirty: true,
      saveState: 'idle',
    })
    return result.applied
  },

  select: (kind, id) => set({ selection: { kind, id } }),

  openTab: (focusId, label) => {
    const { tabs } = get()
    const existing = tabs.find((tab) => tab.focusId === focusId)
    if (existing) {
      get().activateTab(existing.id)
      return
    }
    const tab: TabInfo = { id: focusId, focusId, label }
    set({ tabs: [...tabs, tab] })
    get().activateTab(tab.id)
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get()
    if (tabId === 'main') return
    const index = tabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return
    /**
     * 顺序要紧：`activateTab` 会把「当前页」的选中态写进 stash，而此刻 `activeTabId` 仍是
     * 刚关掉这个 id —— 若先删后切，那次写入会把 `delete` 原样撤销（关页的清理失效，重开该
     * 模块会恢复关页前的陈旧选中态）。所以先切到左邻页，再删这个键。
     */
    if (activeTabId === tabId) get().activateTab(tabs[Math.max(0, index - 1)].id)
    const stash = { ...get().selectionStash }
    delete stash[tabId]
    set({ tabs: get().tabs.filter((tab) => tab.id !== tabId), selectionStash: stash })
  },

  activateTab: (tabId) => {
    const { tabs, activeTabId, selection, selectionStash } = get()
    if (tabId === activeTabId) return
    if (!tabs.some((tab) => tab.id === tabId)) return
    set({
      activeTabId: tabId,
      selectionStash: { ...selectionStash, [activeTabId]: selection },
      selection: selectionStash[tabId] ?? initialSelection,
    })
  },

  renameTab: (tabId, label) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, label } : tab)),
    })),

  setHovered: (hoveredNodeId) => set({ hoveredNodeId }),
  setHighlighted: (highlightedNodeIds) => set({ highlightedNodeIds }),

  reset: () =>
    set({
      graph: emptyGraph(),
      history: emptyHistory(),
      selection: initialSelection,
      tabs: [MAIN_TAB],
      activeTabId: 'main',
      selectionStash: {},
      hiddenTopicIds: [],
      activeTagIds: [],
      hoveredNodeId: null,
      highlightedNodeIds: [],
      dirty: false,
      error: null,
    }),
}))

// ---------- 选择器（避免组件订阅整图导致过度渲染） ----------

export const selectSelectedNode = (state: GraphState): GraphNode | null =>
  state.selection.kind === 'node'
    ? state.graph.nodes.find((node) => node.id === state.selection.id) ?? null
    : null

export const selectSelectedEdge = (state: GraphState): GraphEdge | null =>
  state.selection.kind === 'edge'
    ? state.graph.edges.find((edge) => edge.id === state.selection.id) ?? null
    : null

export const selectHistoryFlags = (state: GraphState) => ({
  canUndo: canUndo(state.history),
  canRedo: canRedo(state.history),
})

export const selectStats = (state: GraphState) => ({
  nodes: state.graph.nodes.length,
  edges: state.graph.edges.length,
  refs: state.graph.nodes.reduce((sum, node) => sum + node.refs.length, 0),
  tags: new Set(state.graph.nodes.flatMap((node) => node.tags)).size,
})
