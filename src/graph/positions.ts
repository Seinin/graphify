import type { NodePosition } from '../lib/types'

/**
 * 占位坐标的判定。
 *
 * 为什么需要它：cytoscape 给没有坐标的元素默认落在原点，而图谱数据里的节点坐标是「回存」写进去的——
 * 一旦把「当前不可见、还没排布过」的节点也一起回存，它们就会以 `(0,0)` 的形式落盘。
 * 攒够一批之后，画布上就是一堆完全重叠的节点：标签互相压住、指针永远命中最上面那一个，
 * 表现成「悬停某个节点，文字却变成另一个节点的名字」。这类坐标必须在加载时被识别并丢弃，
 * 交给开场布局重新排布。
 *
 * 判定口径：同一坐标被 **≥3** 个节点占用即视为占位。真实布局（breadthfirst + avoidOverlap、
 * fcose + nodeSeparation）不会让两个以上节点落在同一整数坐标上；而用户故意把 2 个节点叠在
 * 一起是可能的行为，不该被当成脏数据清掉。要更激进只需改这一个常量。
 */
export const STACK_THRESHOLD = 3

/** 节点坐标是取整回存的，判定也用取整后的键，避免浮点误差把同一堆拆开 */
const keyOf = (position: NodePosition): string => `${Math.round(position.x)},${Math.round(position.y)}`

/**
 * 返回「坐标应被忽略（视为尚未排布）」的节点 id。
 * 判据是本文件顶部说明的堆叠占位；没有坐标的节点自然不在返回集合里。
 */
export function ignoredPositionIds(
  nodes: readonly { id: string; position?: NodePosition | null }[],
): Set<string> {
  const buckets = new Map<string, string[]>()
  nodes.forEach((node) => {
    if (!node.position) return
    const key = keyOf(node.position)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(node.id)
    else buckets.set(key, [node.id])
  })

  const ignored = new Set<string>()
  buckets.forEach((ids) => {
    if (ids.length < STACK_THRESHOLD) return
    ids.forEach((id) => ignored.add(id))
  })
  return ignored
}
