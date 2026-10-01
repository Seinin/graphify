import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DATA_DIR, GRAPH_FILE, HISTORY_DIR, SNAPSHOT_LIMIT } from './paths.mjs'
import { emptyGraph, parseGraph, tryParseGraph } from './schema.mjs'

/** 串行写队列：单进程内保证不会出现并发写导致的数据错乱 */
let writeChain = Promise.resolve()

function enqueue(task) {
  const next = writeChain.then(task, task)
  writeChain = next.catch(() => {})
  return next
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.mkdir(HISTORY_DIR, { recursive: true })
}

/** 原子写入：先写临时文件再 rename，避免半截文件 */
async function writeJsonAtomic(target, data) {
  const tmp = `${target}.tmp-${randomUUID().slice(0, 8)}`
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, target)
}

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8')
  return JSON.parse(raw)
}

/** 读取图谱；文件缺失或损坏时回退为空图，保证服务可用 */
export async function readGraph() {
  await ensureDirs()
  const exists = await fs
    .access(GRAPH_FILE)
    .then(() => true)
    .catch(() => false)

  if (!exists) {
    const fresh = emptyGraph()
    await enqueue(() => writeJsonAtomic(GRAPH_FILE, fresh))
    return fresh
  }

  const parsed = await readJson(GRAPH_FILE).catch((err) => {
    console.error('[store] graph.json 解析失败，已回退为空图：', err.message)
    return null
  })

  if (!parsed) return emptyGraph()

  return parseGraphSafe(parsed)
}

function parseGraphSafe(input) {
  const result = tryParseGraph(input)
  if (result.ok) return result.graph
  const repaired = repairTopicRefs(input, result.issues)
  if (repaired) return repaired
  console.error('[store] graph.json 结构不符合 schema，已回退为空图：', JSON.stringify(result.issues))
  return emptyGraph()
}

/** normalizeIssues 产出的路径形如 nodes.0.topics */
const TOPIC_REF_ISSUE = /^nodes\.(\d+)\.topics$/

/**
 * 读盘容错：话题交叉校验失败时只丢弃未注册的话题归属，而不是把整张图判死回退成空图。
 * 写盘路径仍走严格校验（parseGraph），所以被丢弃的归属不会被写回磁盘，
 * 也就不会出现「打开即空图、随手一存就覆盖掉真实数据」这种最难恢复的失败方式。
 */
function repairTopicRefs(input, issues) {
  const badIndexes = new Set()
  for (const issue of issues || []) {
    const matched = TOPIC_REF_ISSUE.exec(issue.path)
    // 只要还有别类问题，就按原逻辑整体回退，不做部分修复
    if (!matched) return null
    badIndexes.add(Number(matched[1]))
  }
  if (badIndexes.size === 0) return null

  const known = new Set((input?.meta?.topics || []).map((topic) => topic?.id))
  const nodes = Array.isArray(input?.nodes) ? [...input.nodes] : null
  if (!nodes) return null

  for (const index of badIndexes) {
    const node = nodes[index]
    if (!node || !Array.isArray(node.topics)) return null
    const dropped = node.topics.filter((id) => !known.has(id))
    console.error(
      `[store] 读取时丢弃未注册的话题归属（节点 ${node.id || node.label || index}）：`,
      JSON.stringify(dropped),
    )
    nodes[index] = { ...node, topics: node.topics.filter((id) => known.has(id)) }
  }

  const retry = tryParseGraph({ ...input, nodes })
  return retry.ok ? retry.graph : null
}

/**
 * 保留副本的文件名后缀。
 *
 * 手动保存（"另存为"）产出的副本带这个后缀：它与自动快照同目录、同样可回滚，
 * 但**不参与轮转**——所以清理时按文件名就能跳过，不必把每份快照都读一遍。
 */
const KEEP_SUFFIX = '-keep'

/** 这份快照是不是「保留副本」（用户手动另存的那一份） */
export function isKeepName(name) {
  return String(name || '').endsWith(`${KEEP_SUFFIX}.json`)
}

/**
 * 生成一份带时间戳的快照，并滚动清理超量文件。
 * `pinned` 为真时产出的是**保留副本**（见 KEEP_SUFFIX）：只写盘、不参与轮转。
 */
async function snapshot(currentGraph, reason, { pinned = false } = {}) {
  await ensureDirs()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  // 毫秒时间戳在连续写入时仍可能撞名，补 4 位随机后缀（快照写入本身是串行的）
  const name = `graph-${stamp}-${randomUUID().slice(0, 4)}${pinned ? KEEP_SUFFIX : ''}.json`
  const file = path.join(HISTORY_DIR, name)
  await writeJsonAtomic(file, {
    reason: reason || 'manual',
    savedAt: new Date().toISOString(),
    ...(pinned ? { pinned: true } : {}),
    graph: currentGraph,
  })
  if (!pinned) await pruneSnapshots()
  return name
}

async function pruneSnapshots() {
  // 保留副本不参与轮转：只裁剪没带保留后缀的那些
  const names = (await listSnapshotNames()).filter((name) => !isKeepName(name))
  const overflow = names.length - SNAPSHOT_LIMIT
  if (overflow <= 0) return
  const stale = names.slice(0, overflow)
  await Promise.all(
    stale.map((name) =>
      fs.unlink(path.join(HISTORY_DIR, name)).catch((err) => {
        console.error('[store] 清理旧快照失败：', name, err.message)
      }),
    ),
  )
}

async function listSnapshotNames() {
  const entries = await fs.readdir(HISTORY_DIR).catch(() => [])
  return entries
    .filter((name) => name.startsWith('graph-') && name.endsWith('.json'))
    .sort()
}

/**
 * 写入图谱：先快照旧数据，再原子替换。
 * reason 会写入快照文件，便于在历史面板中区分操作来源。
 */
export async function writeGraph(nextGraph, reason = 'update') {
  return enqueue(async () => {
    await ensureDirs()
    const previous = await readGraph()
    await snapshot(previous, reason)
    const payload = parseGraph({ ...nextGraph, meta: { ...nextGraph.meta, updatedAt: new Date().toISOString() } })
    await writeJsonAtomic(GRAPH_FILE, payload)
    return payload
  })
}

/** 快照列表（新到旧），只返回元信息，不带图谱正文 */
export async function listSnapshots() {
  await ensureDirs()
  const names = (await listSnapshotNames()).reverse()
  return Promise.all(
    names.map(async (name) => {
      const full = path.join(HISTORY_DIR, name)
      const stat = await fs.stat(full).catch(() => null)
      const raw = await readJson(full).catch(() => null)
      return {
        id: name,
        reason: raw?.reason || 'unknown',
        savedAt: raw?.savedAt || '',
        size: stat?.size || 0,
        nodes: raw?.graph?.nodes?.length ?? 0,
        edges: raw?.graph?.edges?.length ?? 0,
        /** 保留副本（手动另存）：不参与轮转，可单独删除 */
        pinned: Boolean(raw?.pinned) || isKeepName(name),
      }
    }),
  )
}

/** 读取单个快照的图谱正文 */
export async function readSnapshot(id) {
  const safe = path.basename(String(id))
  const full = path.join(HISTORY_DIR, safe)
  const raw = await readJson(full)
  if (!raw?.graph) throw new Error('快照内容缺失')
  return { meta: raw, graph: parseGraphSafe(raw.graph) }
}

/** 回滚到指定快照：当前图谱会先被快照保存，因此回滚本身也可再撤销 */
export async function rollbackToSnapshot(id) {
  const { graph } = await readSnapshot(id)
  return writeGraph(graph, `rollback:${path.basename(String(id))}`)
}

/**
 * 手动保存（"另存为"）：把这份整图写成一份**保留副本**。
 *
 * 与 `writeGraph` 的关键区别是**不碰工作文件**——只往历史目录写一份带保留标记的快照。
 * 这是「图谱只能手动保存、且保存即另存」的落点：前端不再整图覆盖 `data/graph.json`，
 * 因此"工作文件被一个还开着旧数据的标签页整图覆盖"那条失败路径被彻底关掉。
 *
 * 仍走 `parseGraph` 严格校验（坏数据不允许进档案），但**不加破坏性护栏**——
 * 护栏是为"覆盖会丢数据"设的，另存不覆盖任何东西。
 */
export async function writeArchive(nextGraph, reason = 'graph:save-as') {
  return enqueue(async () => {
    await ensureDirs()
    const payload = parseGraph(nextGraph)
    const id = await snapshot(payload, reason, { pinned: true })
    return {
      id,
      savedAt: new Date().toISOString(),
      nodes: payload.nodes.length,
      edges: payload.edges.length,
    }
  })
}

/**
 * 删除一份**保留副本**。
 * 自动快照不允许逐个删——它们的生命周期由轮转上限管理，放开单删等于给"清空历史"开口子。
 */
export async function deleteArchive(id) {
  const safe = path.basename(String(id))
  if (!isKeepName(safe)) {
    throw Object.assign(new Error('只能删除保留副本（自动快照由轮转上限管理）'), { status: 400 })
  }
  await fs.unlink(path.join(HISTORY_DIR, safe))
  return safe
}
