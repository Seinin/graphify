/**
 * 清掉 atlas 迁移产生的节点与边，用于把一次导入的结果整体推倒重来——
 * 生成器改进后重新导入前先跑它，避免留下「逻辑相同、id 不同」的重复边。
 *
 * 删除范围：id 以 `atlas:fig` 开头的节点（图一 / 图二的层带与步骤）、两端涉及它们的边，
 * 以及**初始条件（S09）的三块骨架**（`ic:g-load` / `ic:g-core` / `ic:g-out`）。
 * 框里的 `ic:*` 节点会被放回顶层，等导入脚本重新收拢（两个脚本成对使用）。
 *
 * 注意：本脚本经服务端 `PUT` 写入，所以**服务端必须是当前 schema 的进程**——
 * 旧进程会把它不认识的新字段静默剥掉。
 *
 * 用法：node scripts/reset-atlas-nodes.mjs [baseUrl]
 */

// 初始条件三块骨架的唯一定义（与重组 / 导入脚本共用一份）
import { IC_BLOCK_IDS, LEGACY_IC_FRAME } from './lib/ic-chains.mjs'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'

const api = async (pathname, options = {}) => {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status} ${payload?.error ?? ''}`)
  return payload
}

const graph = (await api('/api/graph')).graph
/**
 * 连初始条件的三块骨架一起撤掉：它们的位置是按当时那份图纸的边界算的，
 * 图纸重排后必须按新边界重算，否则一级视图会拖出一条大空档。
 * （历史遗留的单个 `atlas:ic-frame` 大框已被三块取代；若还遇到它，一并删掉。）
 * 五块 id 来自 `./lib/ic-chains.mjs`，与重组 / 导入脚本共用一份定义。
 */
const doomedNodes = new Set(
  graph.nodes
    .filter(
      (node) =>
        node.id.startsWith('atlas:fig') ||
        IC_BLOCK_IDS.includes(node.id) ||
        node.id === LEGACY_IC_FRAME,
    )
    .map((node) => node.id),
)
const doomedEdges = graph.edges.filter(
  (edge) => doomedNodes.has(edge.source) || doomedNodes.has(edge.target),
)
if (!doomedNodes.size && !doomedEdges.length) {
  console.log('没有 atlas 节点/边需要清理')
  process.exit(0)
}

const next = {
  ...graph,
  // 被撤掉的框里的节点放回顶层（parent 置空），避免留下悬空父子链
  nodes: graph.nodes
    .filter((node) => !doomedNodes.has(node.id))
    .map((node) => (node.parent && doomedNodes.has(node.parent) ? { ...node, parent: null } : node)),
  edges: graph.edges.filter((edge) => !doomedEdges.includes(edge)),
}
await api('/api/graph', { method: 'PUT', body: { graph: next, reason: 'graph:atlas-reset' } })

const after = (await api('/api/graph')).graph
console.log(`已清理 ${doomedNodes.size} 个 atlas 节点、${doomedEdges.length} 条边`)
console.log(`剩余：${after.nodes.length} 节点 / ${after.edges.length} 边（顶层 ${after.nodes.filter((n) => !n.parent).length} 个）`)
