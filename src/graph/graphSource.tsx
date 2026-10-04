/**
 * 图数据源：**画布模板从这里取「图 + 选中 + 标签」，不直接认某一个单例 store。**
 *
 * 这就是"复用模板、不复用数据"的那层缝：
 *   · 画布页给的是**服务端那份图**（共享 store 的实时状态）；
 *   · 物理链页给的是**生成物里的那份图**（自带数据，本地选中/标签，只读）。
 * 模板（`GraphCanvas` 及其渲染层）只认这个接口，于是两张图各用各的数据，互不干扰。
 *
 * 缺省（没有 provider）时**直接接共享 store**——画布页的既有行为因此逐字不变。
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useGraphStore } from '../state/graphStore'
import type { Graph, Selection, SelectionKind } from '../lib/types'

export interface GraphSource {
  graph: Graph
  selection: Selection
  select: (kind: SelectionKind, id: string | null) => void
  hoveredNodeId: string | null
  setHovered: (id: string | null) => void
  activeTagIds: string[]
  hiddenRelationIds: string[]
  toggleHiddenRelations: (nodeId: string) => void
  /**
   * 点画布空白 = 回到**什么都没点亮**：清选中（检查器随之空）**并**熄灭这一页自己的点亮标记
   * （画布页的标签勾选与红点、物理链页的词条点亮与红点）。
   *
   * 单独一条通路、而不是塞进 `select`：`select(null, null)` 还被关属性页、切页、清检索那几处用，
   * "选中变空"不该顺手把勾选也清掉。子图标签页（看到哪儿）不归它管。
   */
  clearHighlight: () => void
}

const SourceContext = createContext<GraphSource | null>(null)

/** 给某一页提供它自己的数据源（物理链页用这个） */
export function GraphSourceProvider({ value, children }: { value: GraphSource; children: ReactNode }) {
  return <SourceContext.Provider value={value}>{children}</SourceContext.Provider>
}

/**
 * 取当前数据源。**没有 provider 时退回共享 store**：
 * 这样"画布页那一大摊 JSX"一行都不用改，行为与以前完全一致。
 *
 * 注意：无论有没有 provider 都会订阅共享 store（hooks 不能有条件地调用）；
 * 代价只是几处无用的订阅，换来的是画布页零改动——值。
 */
export function useGraphSource(): GraphSource {
  const fromProvider = useContext(SourceContext)
  const graph = useGraphStore((state) => state.graph)
  const selection = useGraphStore((state) => state.selection)
  const select = useGraphStore((state) => state.select)
  const hoveredNodeId = useGraphStore((state) => state.hoveredNodeId)
  const setHovered = useGraphStore((state) => state.setHovered)
  const activeTagIds = useGraphStore((state) => state.activeTagIds)
  const hiddenRelationIds = useGraphStore((state) => state.hiddenRelationIds)
  const toggleHiddenRelations = useGraphStore((state) => state.toggleHiddenRelations)
  const setActiveTags = useGraphStore((state) => state.setActiveTags)

  return useMemo(
    () =>
      fromProvider ?? {
        graph,
        selection,
        select,
        hoveredNodeId,
        setHovered,
        activeTagIds,
        hiddenRelationIds,
        toggleHiddenRelations,
        clearHighlight: () => {
          select(null, null)
          setActiveTags([])
        },
      },
    [fromProvider, graph, selection, select, hoveredNodeId, setHovered, activeTagIds, hiddenRelationIds, toggleHiddenRelations, setActiveTags],
  )
}
