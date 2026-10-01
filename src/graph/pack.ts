import type { Core, NodeSingular } from 'cytoscape'
import { GROUP_PADDING } from './labels'
import { NODE_BOX_HEIGHT, NODE_BOX_WIDTH } from './palette'

/**
 * 「整理布局」的确定性网格打包：只作用于当前标签页可见的节点。
 *
 * 与 scripts/normalize-layout.mjs 同一口径（参数改了要两边同步）：
 *   · 自底向上：先把容器（compound 父节点：层带 / E lane / S09 框）里的模块排成带，
 *     框由 cytoscape 自动合围，再排本视图的顶层——框的尺寸因此总是「恰好包住内容」；
 *   · 两档规则：
 *       - 顶层是容器或模块 → 单列竖排（主图 = 五条层带自上而下）；
 *       - 容器内部 → 横排成带，超过 7 个才折成网格；
 *   · 阅读顺序沿用现有坐标（先 y 后 x），不会把用户认可的先后顺序打乱；
 *   · 每块围绕自己的质心摆放，不挪视图里的其它块。
 */

/** 同层节点之间的统一间距 */
const GAP = 24
/** 取景目标（与 normalize-layout.mjs 一致）：列数按「塞进这个矩形后字多大」来选 */
const AVAIL_W = 960
const AVAIL_H = 460
/** 单行横排的数量上限（容器内部：7 个以内一字排开；与 normalize-layout.mjs 同口径） */
const MAX_ROW_LEAVES = 7
/** 容器内部折行时的固定列数（4 列 → 带子宽而扁） */
const INSIDE_GRID_COLS = 4

const round1 = (value: number) => Math.round(value * 10) / 10

interface PackItem {
  node: NodeSingular
  width: number
  height: number
  x: number
  y: number
  /** 模块（非装饰框但还有子节点）：触发单列竖排 */
  isModule: boolean
  /** 装饰框（compound 父节点）：同样触发单列竖排 */
  isFrame: boolean
}

interface GridShape {
  cols: number
  rows: number
  colWidths: number[]
  rowHeights: number[]
  totalW: number
  totalH: number
}

function gridByColumns(sizes: { width: number; height: number }[], cols: number): GridShape {
  const rows = Math.ceil(sizes.length / cols)
  const colWidths = Array.from({ length: cols }, (_, col) =>
    Math.max(...sizes.filter((_, index) => index % cols === col).map((s) => s.width)),
  )
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...sizes.slice(row * cols, row * cols + cols).map((s) => s.height)),
  )
  return {
    cols,
    rows,
    colWidths,
    rowHeights,
    totalW: colWidths.reduce((sum, w) => sum + w, 0) + GAP * Math.max(0, cols - 1),
    totalH: rowHeights.reduce((sum, h) => sum + h, 0) + GAP * Math.max(0, rows - 1),
  }
}

/**
 * 网格列数：取「整层取景后缩放最大」的那个；≤4 且横排放得下时直接横排。
 *
 * 导出给 `ordered.ts` 复用：**「一屏装得下、字还看得清」是全局指标**，
 * 两处各写一套迟早会漂移（一边折 4 列、另一边铺 23 列排成一条线）。
 */
export function pickGrid(sizes: { width: number; height: number }[]): GridShape {
  if (sizes.length <= 4) {
    const row = gridByColumns(sizes, sizes.length)
    if (row.totalW <= AVAIL_W) return row
  }
  const max = Math.min(sizes.length, 8)
  let best = gridByColumns(sizes, 1)
  let bestScore = Math.min(AVAIL_W / best.totalW, AVAIL_H / best.totalH)
  for (let cols = 2; cols <= max; cols += 1) {
    const candidate = gridByColumns(sizes, cols)
    const score = Math.min(AVAIL_W / candidate.totalW, AVAIL_H / candidate.totalH)
    if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) < 1e-6 && candidate.totalH < best.totalH)) {
      best = candidate
      bestScore = score
    }
  }
  return best
}

/** 节点的排版尺寸：叶子/模块用按名称算出的基准尺寸；装饰框用子节点撑出来的实际包围盒 */
function sizeOf(node: NodeSingular): { width: number; height: number } {
  if (node.isParent()) {
    const box = node.boundingBox({ includeLabels: false, includeOverlays: false })
    if (Number.isFinite(box.w) && box.w > 0) return { width: box.w, height: box.h }
  }
  return {
    width: Number(node.data('boxW')) || NODE_BOX_WIDTH,
    height: Number(node.data('boxH')) || NODE_BOX_HEIGHT,
  }
}

function toItems(nodes: NodeSingular[]): PackItem[] {
  return nodes.map((node) => {
    const position = node.position()
    const size = sizeOf(node)
    return {
      node,
      width: size.width,
      height: size.height,
      x: position.x,
      y: position.y,
      isModule: !node.isParent() && Number(node.data('childCount')) > 0,
      isFrame: node.isParent(),
    }
  })
}

/** 阅读顺序：先按行（y，容忍半框高）再按列（x） */
function readingOrder(items: PackItem[]): PackItem[] {
  return [...items].sort((a, b) => {
    const tolerance = Math.min(a.height, b.height) / 2
    if (Math.abs(a.y - b.y) > tolerance) return a.y - b.y
    return a.x - b.x
  })
}

function centroid(items: PackItem[]): { x: number; y: number } {
  if (!items.length) return { x: 0, y: 0 }
  return {
    x: items.reduce((sum, item) => sum + item.x, 0) / items.length,
    y: items.reduce((sum, item) => sum + item.y, 0) / items.length,
  }
}

/** 单列竖排：围绕质心，按阅读顺序自上而下 */
function packColumn(items: PackItem[]) {
  const ordered = readingOrder(items)
  const anchor = centroid(ordered)
  const totalH = ordered.reduce((sum, item) => sum + item.height, 0) + GAP * (ordered.length - 1)
  let cursor = anchor.y - totalH / 2
  ordered.forEach((item) => {
    item.node.position({ x: round1(anchor.x), y: round1(cursor + item.height / 2) })
    cursor += item.height + GAP
  })
}

/** 单行横排：围绕质心，按阅读顺序自左向右 */
function packRow(items: PackItem[]) {
  const ordered = readingOrder(items)
  const anchor = centroid(ordered)
  const totalW = ordered.reduce((sum, item) => sum + item.width, 0) + GAP * (ordered.length - 1)
  let cursor = anchor.x - totalW / 2
  ordered.forEach((item) => {
    item.node.position({ x: round1(cursor + item.width / 2), y: round1(anchor.y) })
    cursor += item.width + GAP
  })
}

/** 网格：围绕质心按阅读顺序填充；`cols` 给定时用固定列数（容器内部用 4 列，带子宽而扁） */
function packGrid(items: PackItem[], cols?: number) {
  const ordered = readingOrder(items)
  const anchor = centroid(ordered)
  const sizes = ordered.map((item) => ({ width: item.width, height: item.height }))
  const grid = cols ? gridByColumns(sizes, Math.min(cols, ordered.length)) : pickGrid(sizes)
  const colX: number[] = []
  let cursorX = anchor.x - grid.totalW / 2
  grid.colWidths.forEach((width) => {
    colX.push(cursorX + width / 2)
    cursorX += width + GAP
  })
  const rowY: number[] = []
  let cursorY = anchor.y - grid.totalH / 2
  grid.rowHeights.forEach((height) => {
    rowY.push(cursorY + height / 2)
    cursorY += height + GAP
  })
  ordered.forEach((item, index) => {
    item.node.position({
      x: round1(colX[index % grid.cols]),
      y: round1(rowY[Math.floor(index / grid.cols)]),
    })
  })
}

/**
 * 按位置分两档排一块：
 *
 *   · **顶层**（当前标签页的根）：里面是容器（层带）或模块时单列竖排——主图就是五条层带自上而下
 *     叠着（图一的读法），子图层里继承同一套「带子竖排」的骨架；
 *   · **容器内部**（层带 / E lane / S09 框里）：模块横排成带（左→右读），超过 7 个才折成网格
 *     ——这正是图纸里「一条层带里一排方框」的样子。
 */
function packBlock(nodes: NodeSingular[], kind: 'top' | 'inside') {
  if (nodes.length <= 1) return
  const items = toItems(nodes)
  if (kind === 'top' && items.some((item) => item.isModule || item.isFrame)) {
    packColumn(items)
    return
  }
  if (items.length <= MAX_ROW_LEAVES) {
    packRow(items)
    return
  }
  // 容器内部装不下就折成固定 4 列：带子要宽而扁（图纸的样子），
  // 交给 pickGrid 只会为了「字最大」挑出 2 列 × 4 行的竖条
  packGrid(items, INSIDE_GRID_COLS)
}

/** 收集当前可见节点（cytoscape 集合的泛型太宽，统一在这里收窄成 NodeSingular 数组） */
function visibleNodes(cy: Core): NodeSingular[] {
  const out: NodeSingular[] = []
  cy.nodes().forEach((node) => {
    if (node.visible()) out.push(node as NodeSingular)
  })
  return out
}

function visibleChildrenOf(frame: NodeSingular): NodeSingular[] {
  const out: NodeSingular[] = []
  frame.children().forEach((node) => {
    if (node.visible()) out.push(node as NodeSingular)
  })
  return out
}

/** 是否有可见的 compound 父节点 */
function hasVisibleParent(node: NodeSingular): boolean {
  let found = false
  node.parent().forEach((parent) => {
    if (parent.visible()) found = true
  })
  return found
}

/**
 * 整理当前标签页：自底向上先排各装饰框的内部（深框先排，浅框的尺寸才量得准），
 * 再排顶层。返回是否有可见节点被重排。
 */
export function packVisible(cy: Core): boolean {
  const visible = visibleNodes(cy)
  if (!visible.length) return false

  const frames = visible
    .filter((node) => node.isParent())
    .sort((a, b) => b.ancestors().length - a.ancestors().length)
  frames.forEach((frame) => packBlock(visibleChildrenOf(frame), 'inside'))

  // 顶层：自己可见、且没有「可见的 compound 父节点」的节点
  const topLevel = visible.filter((node) => !hasVisibleParent(node))
  packBlock(topLevel, 'top')

  // 装饰框内部排完后位置可能偏离中心：把框心挪回子节点质心，嵌套框才套得正
  frames.forEach((frame) => {
    const children = visibleChildrenOf(frame)
    if (!children.length) return
    const box = frame.children().boundingBox({ includeLabels: false, includeOverlays: false })
    if (!Number.isFinite(box.x1)) return
    frame.position({
      x: round1((box.x1 + box.x2) / 2),
      y: round1((box.y1 + box.y2) / 2),
    })
  })
  return true
}

/** 供脚本侧复用的排版参数（normalize-layout.mjs 与本文件必须同口径） */
export const PACK_PARAMS = { GAP, AVAIL_W, AVAIL_H, MAX_ROW_LEAVES, GROUP_PADDING }
