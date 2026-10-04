/**
 * 物理链页的**手动摆放**：`data/chain-layout.json`。
 *
 * 为什么单独一个文件：
 *   · 生成物（`src/generated/physics-chain.json`）由 `scripts/build-physics-chain.mjs` 从真源重烘，
 *     手摆坐标写进去会被下一次生成抹掉；
 *   · `data/graph.json` 是画布页的工作文件，物理链的位置与它无关（自检钉着这条边界）。
 *
 * 它的角色是**坐标覆盖层**：读回来叠在生成物烘好的默认摆位上。页面因此仍是生成物驱动，
 * 本机能动的只有位置。文件小（一个节点一条），整份覆盖写即可。
 *
 * 不进 `data/history` 轮转：那套轮转是为整图历史设的（快照动辄几十万字符），
 * 这里没有值得回滚的中间态——要回到默认，清掉覆盖层就是了（见前端的"恢复默认摆放"）。
 */
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { CHAIN_LAYOUT_FILE, DATA_DIR } from './paths.mjs'

/** 写进文件里的归属标记：打开文件就知道它是谁的 */
const GRAPH_ID = 'physics-chain'

/** 条目上限：一级 11 个块 + 子图成员远小于它，超出的只可能是脏数据 */
const MAX_ENTRIES = 1000

/** 写队列：单进程内串行，避免两次保存互相覆盖 */
let writeChain = Promise.resolve()

function enqueue(task) {
  const next = writeChain.then(task, task)
  writeChain = next.catch(() => {})
  return next
}

/** 坐标归一化：只认有限数，四舍五入到整数（与前端拖拽落点的口径一致） */
function pickPosition(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
  return { x: Math.round(value.x), y: Math.round(value.y) }
}

/**
 * 清洗：只留「合法 id + 合法坐标」。
 *
 * 非法条目**如实回报**（`skipped`），不静默吞掉——读盘与写盘走同一条口径，
 * 手改坏的条目在日志里看得见，而不是悄悄少一个节点。
 */
export function sanitizePositions(input) {
  const positions = {}
  const skipped = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { positions, skipped: input === undefined || input === null ? [] : ['<整体不是对象>'] }
  }
  const entries = Object.entries(input)
  entries.slice(0, MAX_ENTRIES).forEach(([rawId, rawPosition]) => {
    const id = String(rawId).trim()
    const position = pickPosition(rawPosition)
    if (!id || id.length > 120 || !position) {
      skipped.push(String(rawId))
      return
    }
    positions[id] = position
  })
  if (entries.length > MAX_ENTRIES) skipped.push(`<超出上限的 ${entries.length - MAX_ENTRIES} 条>`)
  return { positions, skipped }
}

/** 没有手摆坐标时的那一份（文件缺失、为空或坏掉都回它） */
function emptyLayout() {
  return { graph: GRAPH_ID, updatedAt: null, positions: {} }
}

/**
 * 读摆放。
 * 文件缺失或损坏时回一份空的：页面照生成物默认显示，不会因为一个坏文件就打不开。
 */
export async function readChainLayout() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const raw = await fs.readFile(CHAIN_LAYOUT_FILE, 'utf8').catch(() => null)
  if (raw === null) return emptyLayout()
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error('[chain-layout] 解析失败，按「没有手摆坐标」处理：', err.message)
    return emptyLayout()
  }
  const { positions, skipped } = sanitizePositions(parsed?.positions)
  if (skipped.length) {
    console.warn(`[chain-layout] 读盘时剔除 ${skipped.length} 条非法坐标：${skipped.slice(0, 5).join('、')}`)
  }
  return {
    graph: GRAPH_ID,
    updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
    positions,
  }
}

/**
 * 写摆放：整份覆盖。
 *
 * 页面交上来的就是**当前全部手摆坐标**（盘上那份 + 本机那份，见前端 `state/chainLayoutStore`），
 * 所以这里是替换而不是合并；交空对象 = 清掉覆盖层，这是"恢复默认摆放"的落点。
 */
export async function writeChainLayout(rawPositions) {
  const { positions, skipped } = sanitizePositions(rawPositions)
  return enqueue(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true })
    const payload = { graph: GRAPH_ID, updatedAt: new Date().toISOString(), positions }
    // 原子写：先写临时文件再 rename，避免半截文件
    const tmp = `${CHAIN_LAYOUT_FILE}.tmp-${randomUUID().slice(0, 8)}`
    await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, CHAIN_LAYOUT_FILE)
    return { layout: payload, updated: Object.keys(positions).length, skipped }
  })
}
