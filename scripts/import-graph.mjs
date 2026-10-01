#!/usr/bin/env node
/**
 * Graphify 命令行导入工具：把一份 JSON 草案合并进图谱。
 *
 * 用法：
 *   node scripts/import-graph.mjs <draft.json>                  # 合并写入（幂等）
 *   node scripts/import-graph.mjs <draft.json> --dry-run        # 只预览差异（不写盘、不校验）
 *   node scripts/import-graph.mjs <draft.json> --replace        # 清空后重建
 *   node scripts/import-graph.mjs <draft.json> --no-verify      # 跳过写后回读校验
 *   node scripts/import-graph.mjs <draft.json> --port=5178      # 指定被探测的 dev 服务端口
 *   cat draft.json | node scripts/import-graph.mjs -            # 从标准输入读取
 *
 * 写盘走本地数据文件、使用本进程加载的最新 schema，不经过 HTTP。
 * 写盘后会做两段回读校验：
 *   ① 重新读取落盘文件，比对称谓级字段指纹（话题注册表、节点话题归属、节点、引用、关系）；
 *   ② 探测运行中的 dev 服务读接口并比对同样指纹——若磁盘有话题而接口返回 0，
 *      说明服务端内存里仍是旧 schema（在 schema 改动前启动的进程），
 *      此时报错并提示重启服务，而不是静默当作成功。
 */
import fs from 'node:fs/promises'
import { applyDraft, summarize } from '../server/lib/mergeDraft.mjs'
import { readGraph, writeGraph } from '../server/lib/store.mjs'
import { applyFieldAliases, parseDraft } from '../server/lib/schema.mjs'

const argv = process.argv.slice(2)
const target = argv.find((item) => !item.startsWith('--'))
const dryRun = argv.includes('--dry-run')
const replace = argv.includes('--replace')
const portFlag = argv.find((item) => item.startsWith('--port='))
const PORT = Number(
  portFlag ? portFlag.slice('--port='.length) : process.env.GRAPHIFY_PORT || process.env.PORT || 5178,
)
/** 默认开启写后回读校验：--no-verify 关闭；--dry-run 不写盘，自然跳过 */
const verify = !dryRun && !argv.includes('--no-verify')

if (!target) {
  console.error(
    '用法：node scripts/import-graph.mjs <draft.json|-> [--dry-run] [--replace] [--verify|--no-verify] [--port=5178]',
  )
  process.exit(1)
}

/** 字段指纹：只统计数量，用于发现「字段被静默剥离」这类问题 */
const FINGERPRINT_FIELDS = [
  ['topics', '话题注册表'],
  ['nodeTopics', '节点话题归属'],
  ['nodes', '节点'],
  ['refs', '引用'],
  ['edges', '关系'],
]

function fingerprint(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  return {
    topics: Array.isArray(graph?.meta?.topics) ? graph.meta.topics.length : 0,
    nodeTopics: nodes.reduce((sum, node) => sum + (Array.isArray(node?.topics) ? node.topics.length : 0), 0),
    nodes: nodes.length,
    refs: nodes.reduce((sum, node) => sum + (Array.isArray(node?.refs) ? node.refs.length : 0), 0),
    edges: Array.isArray(graph?.edges) ? graph.edges.length : 0,
  }
}

function diffFingerprint(expected, actual) {
  return FINGERPRINT_FIELDS.filter(([key]) => expected[key] !== actual[key]).map(
    ([key, label]) => `${label}(${key}) 期望 ${expected[key]}，实际 ${actual[key]}`,
  )
}

function formatFingerprint(fp) {
  return FINGERPRINT_FIELDS.map(([key, label]) => `${label} ${fp[key]}`).join(' · ')
}

/** 探测运行中的 dev 服务读接口；未启动/超时只跳过，不阻塞导入 */
async function probeServer() {
  const url = `http://127.0.0.1:${PORT}/api/graph`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return { skipped: `读接口返回 HTTP ${response.status}` }
    const payload = await response.json()
    return { served: fingerprint(payload?.graph) }
  } catch (err) {
    return { skipped: err.name === 'TimeoutError' ? '探测超时' : err.message }
  }
}

async function verifyWritten(expected) {
  const issues = []
  let serverMismatch = false

  const onDisk = fingerprint(await readGraph())
  const diskDiff = diffFingerprint(expected, onDisk)
  if (diskDiff.length) {
    issues.push(`落盘文件与导入结果不一致 → ${diskDiff.join('；')}`)
  } else {
    console.log(`[校验] 落盘一致：${formatFingerprint(onDisk)}`)
  }

  const probe = await probeServer()
  if (probe.skipped) {
    console.log(`[校验] 跳过服务端探测：${probe.skipped}`)
    return { issues, serverMismatch }
  }

  const servedDiff = diffFingerprint(onDisk, probe.served)
  if (servedDiff.length) {
    serverMismatch = true
    issues.push(`运行中的 dev 服务（端口 ${PORT}）读回不完整 → ${servedDiff.join('；')}`)
  } else {
    console.log(`[校验] 服务端（端口 ${PORT}）读回一致：${formatFingerprint(probe.served)}`)
  }

  return { issues, serverMismatch }
}

async function readInput(file) {
  if (file === '-') {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8')
  }
  return fs.readFile(file, 'utf8')
}

async function main() {
  const raw = await readInput(target)
  const parsed = applyFieldAliases(JSON.parse(raw))
  const draft = parseDraft({ ...parsed, mode: replace ? 'replace' : parsed.mode || 'merge', dryRun })

  const graph = await readGraph()
  const diff = applyDraft(graph, draft)
  const preview = summarize(diff)
  const expected = fingerprint(diff.graph)

  if (!dryRun) {
    await writeGraph(diff.graph, 'cli:import')
  }

  console.log(`${dryRun ? '[预览] ' : '[已写入] '}节点 +${preview.createdNodes.length} / 更新 ${preview.updatedNodeIds.length}`)
  console.log(`        关系 +${preview.createdEdges.length} / 更新 ${preview.updatedEdgeIds.length}`)
  if (preview.createdNodes.length) {
    console.log('新增节点：', preview.createdNodes.map((node) => node.label).join('、'))
  }
  if (preview.errors.length) {
    console.warn(`跳过 ${preview.errors.length} 条：`)
    preview.errors.forEach((err) => console.warn(`  - #${err.index} ${err.reason}`))
    process.exitCode = 2
  }

  if (dryRun) return

  if (!verify) {
    console.log('[校验] 已按 --no-verify 跳过写后回读校验')
    return
  }

  const { issues, serverMismatch } = await verifyWritten(expected)
  if (!issues.length) return

  console.error('')
  console.error('导入校验失败：')
  issues.forEach((line) => console.error(`  - ${line}`))
  if (serverMismatch) {
    console.error('  提示：服务端 schema 可能落后于源码（常见于 dev 服务在 schema 改动前就已启动），')
    console.error('        请重启 dev 服务后重新导入；跳过本次校验可用 --no-verify。')
  } else {
    console.error('  提示：数据未能按预期落盘，请检查磁盘状态与 schema 版本后重试。')
  }
  process.exitCode = 1
}

main().catch((err) => {
  console.error('导入失败：', err.message)
  if (err.issues) err.issues.forEach((issue) => console.error(`  - ${issue.path}: ${issue.message}`))
  process.exitCode = 1
})
