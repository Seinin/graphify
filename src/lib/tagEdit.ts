/**
 * 标签的两处**判据**（纯 TS，不 import React）：
 *   · `canEditNodeTags` —— 谁能增删标签；
 *   · `inheritedTagsOf` / `tagDisplayOf` —— 有子图者显示的标签从哪来（子树叶子并集，现算）；
 *   · `bucketByGroup` —— 按类别分桶的顺序（顶栏标签弹层与右侧属性面板同一份）。
 *
 * 为什么单独一个文件：这两条判据要同时被组件（`components/NodeTags.tsx`、`Inspector.tsx`、
 * 画布渲染器）与自检（`scripts/check-tags.mjs`，用 esbuild 直接在 Node 下加载 TS）读到——
 * 口径只写一份，页面里不许再写一遍。
 */
import type { GraphNode, TagDetailItem, TagDetailMap } from './types'

/** 一个节点**此刻显示的**标签：叶子是自己那份；有子图的是子树叶子并集（现算出来的） */
export interface TagDisplay {
  tags: string[]
  tagDetails: TagDetailMap
}

/**
 * 谁能增删标签：**只有叶子**。
 *
 * 判据只有一条——**有没有子图**：
 *   · 没有直系子节点（`childCount === 0`）＝叶子，叶子自持标签，可增删；
 *   · 有子图的模块 / 物理链页的块 ＝ 标签来自子图成员（子图叶子标签的并集，现算），只读；
 *   · 容器（`type: 'group'` 的大框）不参与标签，同样不可增删。
 *
 * 为什么不看"它有没有 tags"：有子图的节点恰恰**有**标签（并集），按"有没有标签"判会把该禁的放过。
 * 为什么不看链页的 `enterable`：那是块自己的字段（层返回 0），只在物理链页成立，换页就失真。
 */
export function canEditNodeTags(node: GraphNode, childCount: number): boolean {
  return node.type !== 'group' && childCount === 0
}

/**
 * 直系子级索引（成员 id → 直系子级 id，按传入顺序稳定）。
 *
 * 口径与页面里那三处"直系子节点数"一致：`candidate.parent === id` 就算直系子级。
 * 自环、以及指向不存在节点的 `parent` 一概丢掉——数据是人工编辑的，不能让一处脏值把渲染算崩。
 */
function childrenIndexOf(nodes: readonly GraphNode[]): Map<string, string[]> {
  const known = new Set(nodes.map((node) => node.id))
  const children = new Map<string, string[]>()
  nodes.forEach((node) => {
    const parent = node.parent
    if (!parent || parent === node.id || !known.has(parent)) return
    const bucket = children.get(parent)
    if (bucket) bucket.push(node.id)
    else children.set(parent, [node.id])
  })
  return children
}

/** 并集里的明细条目要能看出出处：把来源叶子名写进 `note`（新建对象，绝不碰数据里那条） */
function withLeafSource(item: TagDetailItem, leafLabel: string): TagDetailItem {
  const origin = `来自 ${leafLabel}`
  return { ...item, note: item.note ? `${item.note} · ${origin}` : origin }
}

/**
 * 有子图者显示的标签 = **当前**子树叶子标签的并集（现算、不落地、不缓存）。
 *
 * 三条语义（见规格 `graphify-graph-annotations`「标签只服务参数」）：
 *   1. 跟着叶子变：叶子上的归属一增一减，下一次渲染就是新值，不需要重新生成数据或刷新动作；
 *   2. 子树里没有叶子 → 空：叶子被删光（子图整个删掉）就是空，**不保留**删之前那份、**不缓存**上一份；
 *   3. 它自己原来那份不参与（建子图之前挂的标签不再作为显示依据）。
 *
 * 明细按叶子归并，每条带来源叶子名（否则点开明细会读成"模块本身有这个参数"）。
 * 返回的一律是新对象：并集是渲染时的派生值，MUST NOT 写回 `tags` / `tagDetails`。
 * 容器不参与标签，所以空大框不算叶子；环上同一节点只走一次。
 */
export function inheritedTagsOf(nodes: readonly GraphNode[], id: string): TagDisplay {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = childrenIndexOf(nodes)
  const tags: string[] = []
  const tagSeen = new Set<string>()
  const tagDetails: TagDetailMap = {}

  const walked = new Set<string>([id])
  const queue = [...(children.get(id) ?? [])]
  // 按 nodes 顺序广度优先（队列 + 下标，不用 shift）：并集与明细的顺序因此是稳定的
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentId = queue[cursor]
    if (walked.has(currentId)) continue
    walked.add(currentId)
    const kids = children.get(currentId) ?? []
    if (kids.length) {
      queue.push(...kids)
      continue
    }
    const leaf = byId.get(currentId)
    if (!leaf || leaf.type === 'group') continue
    leaf.tags.forEach((tagId) => {
      if (!tagSeen.has(tagId)) {
        tagSeen.add(tagId)
        tags.push(tagId)
      }
      const items = leaf.tagDetails?.[tagId] ?? []
      if (!items.length) return
      const bucket = tagDetails[tagId] ?? (tagDetails[tagId] = [])
      items.forEach((item) => bucket.push(withLeafSource(item, leaf.label)))
    })
  }

  return { tags, tagDetails }
}

/**
 * 「这个节点此刻显示什么标签」——页面统一从这里取，不许各自判断。
 *
 *   · 传了 `nodes`（画布页）：叶子 → 自己那份；有子图的模块 → `inheritedTagsOf`；容器 → 自己那份
 *     （容器不参与标签，不往下钻；历史数据里万一带着标签，面板照旧如实列出来）；
 *   · 没传 `nodes`（物理链页）：照读数据里那份——链页的块标签是生成物**烘好**的并集
 *     （归 `graphify-chain-param-sidebar`），它的成员与步骤是两层，现算会算到另一层上去。
 */
export function tagDisplayOf(nodes: readonly GraphNode[] | undefined, node: GraphNode): TagDisplay {
  const own: TagDisplay = { tags: node.tags, tagDetails: node.tagDetails ?? {} }
  if (!nodes || node.type === 'group') return own
  const hasChild = nodes.some((candidate) => candidate.parent === node.id && candidate.id !== node.id)
  return hasChild ? inheritedTagsOf(nodes, node.id) : own
}

/**
 * 按 `group` 分桶：桶的顺序取**首次出现**，空分类（没写 `group`）排在最后。
 *
 * 顶栏的标签弹层与右侧属性面板都按这个顺序铺分组标题（`tagGroupLabel` 给组名上人话），
 * 两处各写一遍必然漂——所以口径只留这一份。
 */
export function bucketByGroup<T>(
  items: readonly T[],
  groupOf: (item: T) => string | undefined,
): Array<[string, T[]]> {
  const buckets = new Map<string, T[]>()
  items.forEach((item) => {
    const key = (groupOf(item) ?? '').trim()
    const list = buckets.get(key)
    if (list) list.push(item)
    else buckets.set(key, [item])
  })
  return [...buckets.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0))
}
