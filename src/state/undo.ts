import { cloneGraph, type Graph } from '../lib/types'

/** 撤销栈深度上限：整图快照式历史，百级节点时开销可忽略 */
export const HISTORY_LIMIT = 100

export interface HistoryState {
  past: Graph[]
  future: Graph[]
}

export const emptyHistory = (): HistoryState => ({ past: [], future: [] })

/** 记录一个快照：新操作会清空重做栈 */
export function pushHistory(history: HistoryState, snapshot: Graph): HistoryState {
  const past = [...history.past, cloneGraph(snapshot)]
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
  return { past, future: [] }
}

/** 撤销：当前状态进入重做栈，返回上一个快照 */
export function undoStep(history: HistoryState, current: Graph) {
  if (!history.past.length) return { history, applied: null as Graph | null }
  const past = [...history.past]
  const previous = past.pop() as Graph
  const future = [cloneGraph(current), ...history.future].slice(0, HISTORY_LIMIT)
  return { history: { past, future }, applied: cloneGraph(previous) }
}

/** 重做：当前状态回到撤销栈，返回下一个快照 */
export function redoStep(history: HistoryState, current: Graph) {
  if (!history.future.length) return { history, applied: null as Graph | null }
  const [next, ...future] = history.future
  const past = [...history.past, cloneGraph(current)]
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
  return { history: { past, future }, applied: cloneGraph(next) }
}

export const canUndo = (history: HistoryState) => history.past.length > 0
export const canRedo = (history: HistoryState) => history.future.length > 0
