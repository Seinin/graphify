/**
 * 版面归一化：把「每个标签页」的可见内容重排成紧凑布局（与前端的「整理布局」同口径）。
 *
 * 做法
 * ----
 * **逐个父节点**处理它自己的子节点（一个父级 = 一个标签页的内容）：
 *   · 两档规则（与 src/graph/pack.ts 一致，改了要两边同步）：
 *       - **顶层**是容器（层带）或模块 → 单列竖排（主图 = 五条层带自上而下）；
 *       - **容器内部** → 单行横排（模块 / 步骤自左向右），超过 7 个折成固定 4 列的网格
 *         （带子要宽而扁，像图纸那样）；
 *   · 保持阅读顺序（先按 y、再按 x）——序列与层级语义本来就在顺序里；
 *   · 间距统一 GAP，原有的大片空白不再保留；
 *   · 整块以父节点为中心摆放，父框由 compound 自动长大包住它（子节点因此不会被甩到框外）。
 * 自顶向下处理，父层定了位置，子层再以父的新位置为中心。
 *
 * 只改 position：节点、边、父子关系、引用一律不碰。
 *
 * 用法：node scripts/normalize-layout.mjs [baseUrl] [scopeId]
 *   scopeId 缺省时整理全部层；给定父节点 id 时只整理那一层（= 那个标签页）。
 */
const BASE = process.argv[2] || 'http://127.0.0.1:5178'
const SCOPE = process.argv[3] || null

/* ---------------- 尺寸估计 ----------------
 * 尺寸口径**不在这个文件里**：统一来自 `scripts/lib/boxSize.mjs`（它逐字照抄
 * `src/graph/labels.ts`，并在文件头写明"改一边要同步另一边"）。这里只把节点映射成
 * 该口径要的入参——大框看 type，其余按标签。 */
import { GAP, measureBoxSize, measureGroupSize } from './lib/boxSize.mjs'

const sizeOf = (node) => (node.type === 'group' ? measureGroupSize(node.label) : measureBoxSize(node.label))
/**
 * 取景目标：典型画布可用区（1120×620 的画布减去 fit 的 160 内边距）。
 * 列数就是按「整层塞进这个矩形后还剩多少倍（= 字多大）」来选的。
 */
const AVAIL_W = 960
const AVAIL_H = 460

const round1 = (value) => Math.round(value * 10) / 10

/** 给定列数时的排版结果：各列宽、各行高、总宽高 */
function layoutByColumns(sizes, cols) {
  const rows = Math.ceil(sizes.length / cols)
  const colWidths = Array.from({ length: cols }, (_, col) =>
    Math.max(...sizes.filter((_, index) => index % cols === col).map((s) => s.width)),
  )
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...sizes.slice(row * cols, row * cols + cols).map((s) => s.height)),
  )
  const totalW = colWidths.reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, cols - 1)
  const totalH = rowHeights.reduce((sum, h) => sum + h, 0) + GAP * Math.max(0, rows - 1)
  return { cols, rows, colWidths, rowHeights, totalW, totalH }
}

/**
 * 选列数：在所有候选里取「整层取景后缩放最大」的那个 —— 缩放越大字越大。
 *
 * 只按宽度挑（更早的写法）会在节点多时挑出过窄的多行排布，屏幕装不下反而更小；
 * 而纯按缩放挑又会让**节点很少的层**竖排成一列（竖排更省宽，缩放能更大，
 * 但三样东西竖着堆显然不如横着摆）。所以先立一条：≤4 个节点且横排宽度放得下，就横排。
 */
export function pickColumns(sizes) {
  if (sizes.length <= 4) {
    const row = layoutByColumns(sizes, sizes.length)
    if (row.totalW <= AVAIL_W) return row
  }
  const max = Math.min(sizes.length, 8)
  let best = layoutByColumns(sizes, 1)
  let bestScore = Math.min(AVAIL_W / best.totalW, AVAIL_H / best.totalH)
  for (let cols = 2; cols <= max; cols += 1) {
    const candidate = layoutByColumns(sizes, cols)
    const score = Math.min(AVAIL_W / candidate.totalW, AVAIL_H / candidate.totalH)
    // 平分时取更矮的（横向阅读更自然）
    if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) < 1e-6 && candidate.totalH < best.totalH)) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/** 全是叶子时单行横排的数量上限（与 pack.ts 的 MAX_ROW_LEAVES 一致） */
const MAX_ROW_LEAVES = 7

/** 排一层：写回每个子节点的 position，返回排版概况。规则见文件头 */
function packLevel(items, anchor, childrenOfMap, kind) {
  const ordered = [...items].sort((a, b) => {
    const rowTolerance = Math.min(a.size.height, b.size.height) / 2
    if (Math.abs(a.position.y - b.position.y) > rowTolerance) return a.position.y - b.position.y
    return a.position.x - b.position.x
  })
  // 顶层是容器（层带）或模块 → 单列竖排（主图 = 五条层带自上而下）
  const hasModuleOrFrame = ordered.some(
    (item) => item.node.type === 'group' || (childrenOfMap.get(item.node.id) ?? []).length > 0,
  )
  if (kind === 'top' && hasModuleOrFrame && ordered.length > 1) {
    const totalH = ordered.reduce((sum, item) => sum + item.size.height, 0) + GAP * (ordered.length - 1)
    let cursor = anchor.y - totalH / 2
    ordered.forEach((item) => {
      item.node.position = { x: round1(anchor.x), y: round1(cursor + item.size.height / 2) }
      cursor += item.size.height + GAP
    })
    return { cols: 1, rows: ordered.length, totalW: Math.round(Math.max(...ordered.map((i) => i.size.width))), totalH: Math.round(totalH) }
  }
  if (ordered.length > 1 && ordered.length <= MAX_ROW_LEAVES) {
    const totalW = ordered.reduce((sum, item) => sum + item.size.width, 0) + GAP * (ordered.length - 1)
    let cursor = anchor.x - totalW / 2
    ordered.forEach((item) => {
      item.node.position = { x: round1(cursor + item.size.width / 2), y: round1(anchor.y) }
      cursor += item.size.width + GAP
    })
    return { cols: ordered.length, rows: 1, totalW: Math.round(totalW), totalH: Math.round(Math.max(...ordered.map((i) => i.size.height))) }
  }
  // 容器内部折行时固定 4 列（带子要宽而扁）；顶层才让 pickColumns 挑列数
  const shape =
    kind === 'inside'
      ? layoutByColumns(ordered.map((i) => i.size), Math.min(4, ordered.length))
      : pickColumns(ordered.map((i) => i.size))
  const { cols, rows, colWidths, rowHeights, totalW, totalH } = shape

  const colX = []
  let cursorX = anchor.x - totalW / 2
  colWidths.forEach((w) => {
    colX.push(cursorX + w / 2)
    cursorX += w + GAP
  })
  const rowY = []
  let cursorY = anchor.y - totalH / 2
  rowHeights.forEach((h) => {
    rowY.push(cursorY + h / 2)
    cursorY += h + GAP
  })

  ordered.forEach((item, index) => {
    const x = round1(colX[index % cols])
    const y = round1(rowY[Math.floor(index / cols)])
    item.position = { x, y }
    item.node.position = { x, y }
  })
  return { cols, rows, totalW: Math.round(totalW), totalH: Math.round(totalH) }
}

/** 一层排完后的实际包围盒（含框尺寸）：网格是理想值，实际受各行高影响 */
function extentOf(items) {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  items.forEach(({ size, position }) => {
    x1 = Math.min(x1, position.x - size.width / 2)
    x2 = Math.max(x2, position.x + size.width / 2)
    y1 = Math.min(y1, position.y - size.height / 2)
    y2 = Math.max(y2, position.y + size.height / 2)
  })
  return { w: x2 - x1, h: y2 - y1 }
}

async function main() {
  const res = await fetch(`${BASE}/api/graph`)
  if (!res.ok) throw new Error(`读取失败：HTTP ${res.status}`)
  const graph = (await res.json()).graph
  const nodes = graph.nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const childrenOf = new Map()
  nodes.forEach((node) => {
    if (!node.parent || !byId.has(node.parent)) return
    const bucket = childrenOf.get(node.parent) ?? []
    bucket.push(node)
    childrenOf.set(node.parent, bucket)
  })

  const sizeCache = new Map()
  const sizeOfCached = (node) => {
    if (!sizeCache.has(node.id)) sizeCache.set(node.id, sizeOf(node))
    return sizeCache.get(node.id)
  }
  const itemsOf = (list) =>
    list.map((node) => ({
      node,
      size: sizeOfCached(node),
      position: { x: node.position?.x ?? 0, y: node.position?.y ?? 0 },
    }))

  const before = new Map(nodes.map((n) => [n.id, { x: n.position?.x ?? 0, y: n.position?.y ?? 0 }]))

  // 自顶向下逐父节点处理：根层 → 每个「有子节点」的节点；给了 scope 就只整理那一层
  const report = []
  const roots = nodes.filter((n) => !n.parent || !byId.has(n.parent))
  const queue = [{ parentId: null, children: roots }]
  const seen = new Set()
  while (queue.length) {
    const { parentId, children } = queue.shift()
    if (!children.length || seen.has(parentId ?? '__root__')) continue
    seen.add(parentId ?? '__root__')

    const items = itemsOf(children)
    const parent = parentId ? byId.get(parentId) : null
    const anchor = parent
      ? { x: parent.position?.x ?? 0, y: parent.position?.y ?? 0 }
      : {
          x: items.reduce((s, i) => s + i.position.x, 0) / items.length,
          y: items.reduce((s, i) => s + i.position.y, 0) / items.length,
        }
    // scope 模式：只排指定父级那一层；其余层级不动，但子层仍要入队才能走到目标层
    if (!SCOPE || parentId === SCOPE) {
      const beforeExtent = extentOf(items)
      const grid = packLevel(items, anchor, childrenOf, parentId === null ? 'top' : 'inside')
      const afterExtent = extentOf(items)
      // 与渲染器同口径：取景缩放还要被 FIT_MAX_ZOOM 夹住（一屏两个节点不该撑成一堵墙）
      const rawFit = Math.min(AVAIL_W / Math.max(1, afterExtent.w), AVAIL_H / Math.max(1, afterExtent.h))
      const fit = Math.max(0.85, Math.min(1.45, rawFit))
      report.push({
        name: parent ? `↳ ${parent.label}` : '一级（顶层）',
        count: items.length,
        before: `${Math.round(beforeExtent.w)}×${Math.round(beforeExtent.h)}`,
        after: `${Math.round(afterExtent.w)}×${Math.round(afterExtent.h)}`,
        grid: `${grid.cols}列×${grid.rows}行`,
        fit: fit.toFixed(2),
      })
    }

    // 子层入队（父层已定，可以按新位置排）
    children.forEach((child) => {
      const kids = childrenOf.get(child.id)
      if (kids?.length) queue.push({ parentId: child.id, children: kids })
    })
  }

  const moved = nodes.filter((n) => {
    const b = before.get(n.id)
    return b && (Math.abs(b.x - (n.position?.x ?? 0)) > 0.5 || Math.abs(b.y - (n.position?.y ?? 0)) > 0.5)
  }).length

  const put = await fetch(`${BASE}/api/graph`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph, reason: 'layout:normalize' }),
  })
  if (!put.ok) {
    const payload = await put.json().catch(() => ({}))
    throw new Error(`写入失败：HTTP ${put.status} ${payload.error ?? ''}`)
  }

  console.log('层级                          节点  压缩前        压缩后        网格      取景后字(小屏)')
  report.forEach((row) => {
    console.log(
      `  ${row.name.slice(0, 26).padEnd(28)} ${String(row.count).padStart(3)}  ${row.before.padEnd(13)} ` +
        `${row.after.padEnd(13)} ${row.grid.padEnd(9)} ${(13 * Number(row.fit)).toFixed(1)}px`,
    )
  })
  console.log(`\n位移节点 ${moved} / ${nodes.length}；已写回（reason=layout:normalize）`)
}

main().catch((error) => {
  console.error('归一化失败：', error.message)
  process.exit(1)
})
