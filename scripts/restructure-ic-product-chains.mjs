#!/usr/bin/env node
/**
 * 初始条件（S09）子图重组：从**三块骨架**改成**按产物链分五块**。
 *
 * 为什么改
 * --------
 * 旧的三块把四个产物的尾段与它们共用的前缀塞进同一个容器，于是 `实空间化` 挂了 4 条出边
 * （→ 低分辨 / 一阶速度 / 相对速度 / 二阶修正）。拆成五块后每条链在自己的容器里自足：
 * 抽样与共轭在速度链、vcb 链里各有一份同名副本（密度链沿用原 id），容器区分它们是哪一份。
 *
 * 顺带按代码改对一处事实错误：`HIRES_box_saved` 是**完整 δ_k**（InitialConditions.c:667-669，
 * 抽样+共轭之后、反变换之前），四条尾段全部由它派生；旧图把它记成"实空间化"的产物，
 * 于是 vcb 被接在实空间化上。现在分歧点定在 ④（完整 δ_k）。
 *
 * 只改结构、不碰内容：删 1 个旧容器、新增 3 个容器、13 个步骤改 `parent`、
 * 新建 4 个重复份、IC 内部关系按计划重建（26 条）；`atlas:*` 一个都不动。
 * 节点 16 → 22（`ic:` 子树内），关系 21 → 26。
 *
 * 用法
 * ----
 *   node scripts/restructure-ic-product-chains.mjs            # dry-run（默认）
 *   node scripts/restructure-ic-product-chains.mjs --apply    # 写回（先备份）
 *
 * 直接读写 `data/graph.json`，**不经过服务端**（`readGraph()` 每次从磁盘读；线上旧 schema 的进程
 * 会把不认识的字段静默剥掉）。本次不新增字段，因此写完**只需刷新页面**，不必重启服务、不必 build。
 * 脚本幂等：已是目标形状时不动数据。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tryParseGraph } from '../server/lib/schema.mjs'
import {
  IC_BLOCKS,
  IC_BLOCK_IDS,
  IC_CHAIN_EDGES,
  IC_DUPLICATES,
  IC_MEMBER_BLOCK,
  IC_RETIRED_BLOCK_IDS,
  ICS,
  LEGACY_IC_FRAME,
  applyIcChains,
} from './lib/ic-chains.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const GRAPH_PATH = path.resolve(here, '..', 'data', 'graph.json')
const BACKUP_PATH = path.resolve(here, '..', 'data', 'graph.before-ic-chains.json')

const APPLY = process.argv.includes('--apply')

const childIdsOf = (nodes, id) => nodes.filter((node) => node.parent === id).map((node) => node.id)
const isIcEdge = (edge) => edge.source.startsWith('ic:') && edge.target.startsWith('ic:')
const edgeKey = (edge) => `${edge.source} -> ${edge.target} [${edge.label}]`

async function main() {
  const graph = JSON.parse(await fs.readFile(GRAPH_PATH, 'utf8'))
  const before = { nodes: graph.nodes.length, edges: graph.edges.length }
  const atlasBefore = graph.nodes.filter((node) => node.id.startsWith('atlas:'))
  const icNodes = graph.nodes.filter((node) => node.id.startsWith('ic:'))
  const icEdges = graph.edges.filter(isIcEdge)

  const targetIcNodes = IC_MEMBER_BLOCK.size + IC_BLOCK_IDS.length
  const alreadyDone =
    !graph.nodes.some((node) => IC_RETIRED_BLOCK_IDS.includes(node.id) || node.id === LEGACY_IC_FRAME) &&
    IC_BLOCK_IDS.every((id) => childIdsOf(graph.nodes, id).length === IC_BLOCKS.find((b) => b.id === id).members.length) &&
    childIdsOf(graph.nodes, ICS).length === IC_BLOCK_IDS.length &&
    icNodes.length === targetIcNodes &&
    icEdges.length === IC_CHAIN_EDGES.length

  if (alreadyDone) {
    console.log('已是目标形状（五块就位、旧容器不存在、关系数与计划一致），无需改动。')
    IC_BLOCKS.forEach((block) => console.log(`  ${block.id}（${block.members.length}）：${block.label}`))
    return
  }

  if (!graph.nodes.some((node) => node.id === ICS)) throw new Error(`缺少焦点模块：${ICS}`)
  if (!icNodes.length) throw new Error('图上没有 ic: 节点，先确认数据文件是否被换过')

  console.log(`焦点模块：${ICS}`)
  console.log(`IC 子树：节点 ${icNodes.length} → ${targetIcNodes}；内部关系 ${icEdges.length} → ${IC_CHAIN_EDGES.length}`)
  console.log(`撤掉的旧容器：${IC_RETIRED_BLOCK_IDS.join(', ')}`)
  console.log(`新增重复份：${[...IC_DUPLICATES.keys()].join(', ')}（各自复制原份的标签与引用）\n`)
  IC_BLOCKS.forEach((block, index) => {
    console.log(`[${index + 1}] ${block.label}`)
    console.log(`     id=${block.id} | atlas=${block.atlas} | ${block.members.length} 个成员`)
    block.members.forEach((id) => {
      const node = graph.nodes.find((item) => item.id === id)
      const source = IC_DUPLICATES.get(id)
      const origin = source ? graph.nodes.find((item) => item.id === source)
        : null
      console.log(`     · ${id}  ${node?.label ?? origin?.label ?? '（新副本）'}`)
    })
  })

  const { nodes, edges } = applyIcChains(graph.nodes, graph.edges)
  const next = { ...graph, nodes, edges }

  /* ---------------- 断言：形状、守恒、整洁 ---------------- */
  const failures = []

  // 1) ic: 子树的形状
  IC_BLOCKS.forEach((block) => {
    const frame = next.nodes.find((node) => node.id === block.id)
    if (!frame) return failures.push(`缺少容器 ${block.id}`)
    if (frame.type !== 'group') failures.push(`${block.id} 不是 group`)
    if (frame.parent !== ICS) failures.push(`${block.id} 的父节点不是 ${ICS}`)
    if (frame.tags.length || frame.topics.length || frame.refs.length > 1) {
      failures.push(`${block.id} 挂了标签/话题/多个引用（容器只作分组）`)
    }
    const kids = childIdsOf(next.nodes, block.id).sort()
    const want = [...block.members].sort()
    if (kids.join(',') !== want.join(',')) {
      failures.push(`${block.id} 的子节点与成员表不一致：${kids.join(',')} vs ${want.join(',')}`)
    }
  })
  for (const id of [...IC_RETIRED_BLOCK_IDS, LEGACY_IC_FRAME]) {
    if (next.nodes.some((node) => node.id === id)) failures.push(`旧容器仍在图上：${id}`)
  }
  const nextIcNodes = next.nodes.filter((node) => node.id.startsWith('ic:'))
  const stray = nextIcNodes.filter(
    (node) => node.type !== 'group' && !IC_MEMBER_BLOCK.has(node.id),
  )
  if (stray.length) failures.push(`有 ic:* 节点不属于任何块：${stray.map((n) => n.id).join(', ')}`)
  const covered = nextIcNodes.filter((node) => node.type !== 'group' && IC_MEMBER_BLOCK.has(node.id))
  if (covered.length !== IC_MEMBER_BLOCK.size) {
    failures.push(`成员节点数 ${covered.length} ≠ 成员表 ${IC_MEMBER_BLOCK.size}`)
  }

  // 2) 重复份：除 id/parent/position/时间戳外与原份逐字一致
  for (const [dupId, sourceId] of IC_DUPLICATES) {
    const dup = next.nodes.find((node) => node.id === dupId)
    const source = next.nodes.find((node) => node.id === sourceId)
    if (!dup || !source) {
      failures.push(`重复份缺失：${dupId} / ${sourceId}`)
      continue
    }
    const strip = ({ id, parent, position, createdAt, updatedAt, ...rest }) => rest
    if (JSON.stringify(strip(dup)) !== JSON.stringify(strip(source))) {
      failures.push(`重复份 ${dupId} 与原份字段不一致（除 id/parent/position/时间戳）`)
    }
    if (dup.parent === source.parent) failures.push(`重复份 ${dupId} 与原件同块`)
  }

  // 3) 关系与计划一致
  const nextIcEdges = next.edges.filter(isIcEdge)
  const gotEdges = new Set(nextIcEdges.map(edgeKey))
  const wantEdges = new Set(IC_CHAIN_EDGES.map(edgeKey))
  const missingEdges = [...wantEdges].filter((key) => !gotEdges.has(key))
  const extraEdges = [...gotEdges].filter((key) => !wantEdges.has(key))
  if (missingEdges.length) failures.push(`缺少关系：${missingEdges.join(' / ')}`)
  if (extraEdges.length) failures.push(`多出关系：${extraEdges.join(' / ')}`)
  const nextEdgeIds = nextIcEdges.map((edge) => edge.id)
  if (new Set(nextEdgeIds).size !== nextEdgeIds.length) failures.push('IC 内部边的 id 有重复')

  // 4) 不动 atlas:*
  const atlasAfter = next.nodes.filter((node) => node.id.startsWith('atlas:'))
  if (atlasAfter.length !== atlasBefore.length) failures.push('atlas:* 节点数发生变化')
  const atlasKeysBefore = new Set(atlasBefore.map((node) => node.id))
  const atlasMoved = atlasAfter.filter((node) => !atlasKeysBefore.has(node.id))
  if (atlasMoved.length) failures.push(`atlas:* 多出节点：${atlasMoved.map((n) => n.id).join(', ')}`)
  const atlasTouched = atlasBefore.filter((node) => {
    const after = atlasAfter.find((item) => item.id === node.id)
    return JSON.stringify(after) !== JSON.stringify(node)
  })
  if (atlasTouched.length) failures.push(`atlas:* 被改动：${atlasTouched.map((n) => n.id).slice(0, 3).join(', ')}`)

  // 5) 通用健全性：id 唯一、坐标有限且互不相同、schema
  const ids = next.nodes.map((node) => node.id)
  if (new Set(ids).size !== ids.length) failures.push('节点 id 有重复')
  const icPositions = nextIcNodes.map((node) => `${node.position?.x},${node.position?.y}`)
  if (nextIcNodes.some((node) => !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y))) {
    failures.push('有 ic:* 节点坐标不是有限值')
  }
  if (new Set(icPositions).size !== icPositions.length) failures.push('有 ic:* 节点共享同一坐标（会被判为占位数据）')
  const parsed = tryParseGraph(next)
  if (!parsed.ok) failures.push(`整图未通过 schema：${JSON.stringify(parsed.issues?.slice(0, 2))}`)

  if (failures.length) {
    console.error('\n断言失败，未写盘：')
    failures.forEach((item) => console.error(`  ✗ ${item}`))
    process.exit(1)
  }

  console.log(`\n全图：节点 ${before.nodes} → ${next.nodes.length}；关系 ${before.edges} → ${next.edges.length}`)

  if (!APPLY) {
    console.log('（dry-run：没有写回。核对无误后加 --apply 执行）')
    return
  }

  await fs.copyFile(GRAPH_PATH, BACKUP_PATH)
  // 原子写入：先写临时文件再 rename（与 server/lib/store.mjs 同口径）
  const tmp = `${GRAPH_PATH}.tmp-${Date.now().toString(36)}`
  await fs.writeFile(tmp, `${JSON.stringify(parsed.graph, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, GRAPH_PATH)
  console.log(`\n已写回：${GRAPH_PATH}`)
  console.log(`  节点 ${parsed.graph.nodes.length}；关系 ${parsed.graph.edges.length}`)
  console.log(`写前备份：${BACKUP_PATH}`)
  console.log('提醒：数据改完刷新页面即可（本次不新增字段，不需要重启服务）。')
}

main().catch((error) => {
  console.error('重组失败：', error.message)
  process.exit(1)
})
