/**
 * 把 `build-atlas-graph.mjs` 生成的图纸草案导入正在运行的 Graphify，并把现有的
 * 初始条件（S09）节点整理成**按产物链分的五块**（前置 / 密度链 / 速度链 / vcb 链 / 产物与收尾）——
 * 这样一级视图只有几个框，进子图又能一眼看出每条产物链各自用了哪些步骤。
 *
 * 两步、可重复运行：
 *   1. POST /api/graph/import（merge）：图一/图二的节点、大框、边、源码引用、条件标记与**坐标**一并落盘；
 *      已存在的节点只更新语义字段，**不动坐标**，所以重跑不会冲掉你手摆的版面。
 *   2. 把 id 以 `ic:` 开头的存量节点按 `scripts/lib/ic-chains.mjs` 的链定义归位、建容器、复制重复份并重写内部关系
 *      （只做一次：五块都已就位就跳过）。这一步用整图 PUT，因此只写一次盘、只产生一份快照；
 *      归位之前会把当前 graph.json 备份到 data/ 下。
 *
 * 注意：本脚本经服务端 `PUT` 写入，所以**服务端必须是当前 schema 的进程**——
 * 旧进程会把它不认识的新字段静默剥掉。
 *
 * 用法：
 *   node scripts/import-atlas-graph.mjs                 # 打到默认 http://127.0.0.1:5178
 *   node scripts/import-atlas-graph.mjs http://127.0.0.1:5197
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// 初始条件子图"按产物链分块"的唯一定义（与重组 / 重置 / 断言脚本共用一份，避免成员表漂移）
import { IC_BLOCKS, IC_BLOCK_IDS, IC_MEMBER_BLOCK, applyIcChains } from './lib/ic-chains.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const DRAFT = path.join(root, 'data', 'atlas-pipeline-draft.json')
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

const draft = JSON.parse(await fs.readFile(DRAFT, 'utf8'))
console.log(`草案：${draft.nodes.length} 节点 / ${draft.edges.length} 边（来自 ${path.relative(root, DRAFT)}）`)

// ---- 1. 导入图一 / 图二 ----
const imported = await api('/api/graph/import', { method: 'POST', body: draft })
const preview = imported.preview ?? {}
console.log(
  `导入完成：新建节点 ${preview.createdNodes?.length ?? 0}、更新节点 ${preview.updatedNodeIds?.length ?? 0}、` +
    `新建边 ${preview.createdEdges?.length ?? 0}、错误 ${preview.errors?.length ?? 0}`,
)
if (preview.errors?.length) console.log('  草案问题：', preview.errors.slice(0, 5))

// ---- 2. 把初始条件子树整理成"按产物链分五块" ----
let graph = (await api('/api/graph')).graph
const memberSet = new Set(IC_MEMBER_BLOCK.keys())
const icNodes = graph.nodes.filter((node) => memberSet.has(node.id))
const chainsReady =
  IC_BLOCK_IDS.every((id) => graph.nodes.some((node) => node.id === id)) &&
  icNodes.length === memberSet.size &&
  icNodes.every((node) => node.parent === IC_MEMBER_BLOCK.get(node.id))

if (!icNodes.length) {
  console.log('没有需要归位的 ic: 节点，跳过第二步')
} else if (chainsReady) {
  console.log(`初始条件已按产物链分块（${icNodes.length} 个节点分属 ${IC_BLOCKS.length} 块），跳过第二步`)
} else {
  await fs.writeFile(path.join(root, 'data', 'graph.before-atlas.json'), `${JSON.stringify(graph, null, 2)}\n`, 'utf8')

  /**
   * 归位、建容器、复制重复份、重写 IC 内部关系——全部交给 `applyIcChains`：
   * 它和 `restructure-ic-product-chains.mjs` 共用同一份链定义与排位，否则"重建主图"会产出旧形状。
   */
  const { nodes, edges } = applyIcChains(graph.nodes, graph.edges)
  const next = { ...graph, nodes, edges }

  await api('/api/graph', { method: 'PUT', body: { graph: next, reason: 'graph:atlas-migration' } })
  console.log(
    `已把 ${icNodes.length} 个 ic: 节点整理成 ${IC_BLOCKS.length} 块` +
      `（${IC_BLOCKS.map((block) => `${block.label} ${block.members.length}`).join(' / ')}）` +
      `（原图备份：data/graph.before-atlas.json，也可用界面里的「历史」回滚）`,
  )
}

// ---- 3. 汇总 ----
graph = (await api('/api/graph')).graph
const topLevel = graph.nodes.filter((node) => !node.parent)
const conditionalNodes = graph.nodes.filter((node) => node.conditional)
const conditionalEdges = graph.edges.filter((edge) => edge.conditional)
const refs = graph.nodes.reduce((sum, node) => sum + node.refs.length, 0)
const sourceRefs = graph.nodes.reduce(
  (sum, node) => sum + node.refs.filter((ref) => ref.file).length,
  0,
)
console.log('')
console.log(`图谱现状：${graph.nodes.length} 节点 / ${graph.edges.length} 边 · 引用 ${refs} 处（其中源码引用 ${sourceRefs} 处）`)
console.log(`一级视图（顶层节点）${topLevel.length} 个：${topLevel.map((node) => node.label).join(' / ')}`)
console.log(`条件（虚线）节点 ${conditionalNodes.length} 个 · 条件边 ${conditionalEdges.length} 条`)
console.log('打开界面后：一级只看到这几个框 → 点框进入这一层 → 面包屑 / Esc 返回。')
