import type { Core, NodeSingular } from 'cytoscape'
import { NODE_BOX_HEIGHT, NODE_BOX_WIDTH } from './palette'
import { PACK_PARAMS } from './pack'

/**
 * 分层对齐布局：**整齐 + 少交叉**。
 *
 * 与「整理布局」（pack.ts）的分工：
 *   · pack 只把内容摆整齐，行内顺序沿用现有坐标（用户认可的先后顺序）；
 *   · 这里在「整齐」之上再做一层**减少箭头交叉**的排序：行内顺序由**重心法**决定——
 *     每个模块的横向位置取「它与上下行相连模块位置的平均」，反复扫几遍，
 *     交叉会显著减少（这正是分层图绘制的标准做法，Sugiyama 的第二步）。
 *
 * 整齐来自两条硬规则：
 *   · 一行之内**列宽相同**（取该行最宽的模块），于是相邻模块间距处处相等；
 *   · 所有行的**列心对齐**（共用中轴），上下层因此叠得正，箭头多为近竖直。
 *
 * 不动的东西：行的划分（谁和谁同一层由层级/父节点决定）、行的上下顺序（沿用现有 y）。
 */

/**
 * 行间距与列间距同档（由 gridOf 统一加）：早先用两倍间距（48）「给跨行的箭头留地方」，
 * 实测主图五条层带叠起来就多出近百单位高，整块因此超出可视高度、最上面那条层带被切掉——
 * 相邻层带各自有框线分隔，视觉上不需要额外留白。
 */

/** 重心法迭代轮数：两轮就基本收敛，四轮留余量（多轮不会变差，只会更稳） */
const SWEEPS = 4

const round1 = (value: number) => Math.round(value * 10) / 10

interface Item {
  node: NodeSingular
  width: number
  height: number
  /** 初始横向顺序用（现有坐标） */
  x: number
  y: number
}

interface Row {
  key: string
  items: Item[]
  /** 行的锚点 y（用原有坐标算），用于决定行的上下顺序 */
  anchorY: number
}

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

/** 收集当前视图可见节点 */
function visibleNodes(cy: Core): NodeSingular[] {
  const out: NodeSingular[] = []
  cy.nodes().forEach((node) => {
    if (node.visible()) out.push(node as NodeSingular)
  })
  return out
}

/**
 * 行的划分：**可见 compound 父节点的子节点各成一行**（层带 / E lane / S09 框里的一排方框），
 * 没有可见父节点的顶层节点合成「顶层行」（此时通常就是几条层带本身）。
 */
function collectRows(cy: Core, visible: NodeSingular[]): Row[] {
  const byParent = new Map<string, Item[]>()
  visible.forEach((node) => {
    const position = node.position()
    const size = sizeOf(node)
    let parentId = '__top__'
    node.parent().forEach((parent) => {
      if (parent.visible()) parentId = parent.id()
    })
    const item: Item = { node, width: size.width, height: size.height, x: position.x, y: position.y }
    const list = byParent.get(parentId)
    if (list) list.push(item)
    else byParent.set(parentId, [item])
  })

  /**
   * 顶层没有装饰框时，再按 y 切成「一排排」。
   *
   * 只靠 compound 父节点分行时，一张没有大框的图会把所有顶层节点算作**同一行**，
   * 重心法就没有「行间」可言，交叉一个也拉不直（自检里两条交叉的连线就是这么暴露的）。
   * 有装饰框时不做这一步：主图那五条层带本来就各是一行，硬切反而会把框与框内内容交错。
   */
  const top = byParent.get('__top__')
  if (top && top.length > 1 && !top.some((item) => item.node.isParent())) {
    byParent.delete('__top__')
    splitTopByY(top).forEach((items, index) => byParent.set(`__top__${index}`, items))
  }

  return [...byParent.entries()].map(([key, items]) => ({
    key,
    items,
    anchorY: items.reduce((sum, item) => sum + item.y, 0) / items.length,
  }))
}

/** 按 y 把顶层模块切成行：与当前行中心的纵向落差超过「半高 + 间距」就另起一排 */
function splitTopByY(items: Item[]): Item[][] {
  const rows: Item[][] = []
  ;[...items]
    .sort((a, b) => a.y - b.y)
    .forEach((item) => {
      const last = rows[rows.length - 1]
      if (!last) {
        rows.push([item])
        return
      }
      const meanY = last.reduce((sum, rowItem) => sum + rowItem.y, 0) / last.length
      const tallest = Math.max(...last.map((rowItem) => rowItem.height))
      const tolerance = (tallest + item.height) / 2 + PACK_PARAMS.GAP
      if (Math.abs(item.y - meanY) > tolerance) rows.push([item])
      else last.push(item)
    })
  return rows
}

/** 跨行的可见关系：`nodeId → 对端 nodeId 列表`（同行的关系不参与排序） */
function crossRowNeighbors(cy: Core, rowOf: Map<string, string>) {
  const neighbors = new Map<string, string[]>()
  cy.edges().forEach((edge) => {
    if (!edge.visible()) return
    const source = edge.source().id()
    const target = edge.target().id()
    const sourceRow = rowOf.get(source)
    const targetRow = rowOf.get(target)
    if (!sourceRow || !targetRow || sourceRow === targetRow) return
    if (!neighbors.has(source)) neighbors.set(source, [])
    if (!neighbors.has(target)) neighbors.set(target, [])
    neighbors.get(source)!.push(target)
    neighbors.get(target)!.push(source)
  })
  return neighbors
}

/**
 * 行内排序：重心法。
 * 每个模块的「重心」= 它在其它行里的对端位置的**平均值**；没有跨行对端的模块
 * 保持自己原来的次序（用当前下标当重心），于是孤立模块不会被甩来甩去。
 */
function sortRowByBarycenter(row: Row, neighbors: Map<string, string[]>, indexOf: Map<string, number>) {
  const scored = row.items.map((item, index) => {
    const opposite = (neighbors.get(item.node.id()) ?? [])
      .map((id) => indexOf.get(id))
      .filter((value): value is number => value !== undefined)
    const barycenter = opposite.length ? opposite.reduce((sum, value) => sum + value, 0) / opposite.length : index
    return { item, barycenter, index }
  })
  scored.sort((a, b) => a.barycenter - b.barycenter || a.index - b.index)
  row.items = scored.map((entry) => entry.item)
}

/**
 * 这一行是「**叠起来的一摞**」而不是「一横排模块」：行里含装饰框或带子节点的模块。
 *
 * 这种行的上下顺序**就是语义顺序**（主图 = ①入口层 → ⑤输出层），重心法按「对端下标」排它会让
 * 顺序乱掉——实测五条层带被排成 ①→⑤→④，读图的人直接找不到北。所以它只参与「单列竖排」的排版，
 * 不参与行内排序。
 */
function isStackRow(row: Row): boolean {
  return row.items.some((item) => item.node.isParent() || Number(item.node.data('childCount')) > 0)
}

/**
 * 这行是不是「**一摞装饰框**」：框的内容内联渲染，自己就是一横条，横着并排会撑出 4000+ 的宽度，
 * 所以这类行只能单列竖排（与 pack.ts 一致）。
 *
 * 判定必须是**整行都是框**，不能用「含框」：层带里只要有一个小框（例如 ④ 里的 `xray` 框），
 * 整行就会被判成一摞、排成 12 层高的一条竖列（实测整视图 1490 高、下半截看不见）。
 */
function isFrameStack(row: Row): boolean {
  return row.items.length > 1 && row.items.every((item) => item.node.isParent())
}

/** 名称里带步骤序号的写法：①…⑳、①②③ 连写、`3.`、`4)` 之类 */
const SEQUENCE_MARK = /^[\s(（]*([\u2460-\u2473]|\d+\s*[.、)）])/

/**
 * 这一行的顺序是**人写的序列**（层带里 ①②③… 的步骤），不能被优化掉。
 *
 * 交叉优化只对「无序的一堆」有意义；顺序本身就是信息的行（步骤流）必须原样保留——
 * 把 ③ 挪到 ① 前面确实能少几根交叉线，但读图的人再也拼不回流程。
 */
function hasSequenceOrder(row: Row): boolean {
  const marked = row.items.filter((item) => SEQUENCE_MARK.test(String(item.node.data('label') ?? '')))
  return marked.length >= Math.max(2, Math.ceil(row.items.length * 0.6))
}

/** 该行是否必须保持现有顺序（容器堆叠 / 带序号的步骤流） */
function keepOrder(row: Row): boolean {
  return isStackRow(row) || hasSequenceOrder(row)
}

/** 一行的排版形状：行高统一、折成若干行，**每行里各按自己的宽度**排 */
interface BlockShape {
  lineHeight: number
  lines: Item[][]
  totalW: number
  totalH: number
}

/**
 * 预算用的取景下限：比渲染器的 0.85 下限**再留一档余量**（0.95）。
 *
 * 渲染器取景要连标签、光晕一起算，还会被 0.85 的下限截断；按 0.85 满打满算规划，实测整块会比
 * 能显示的多出十几像素，表现为「最上面那条层带的标题被切掉一点」。留余量后实际取景稳在 0.85 以上。
 */
const FIT_MIN_ZOOM = 0.95
/** 装饰框自身的纵向开销（内边距 + 标题条）：算进高度预算，否则整叠会超出画布 */
const FRAME_OVERHEAD = 56

function shapeOf(row: Row, budget: { w: number; h: number }): BlockShape {
  const lineHeight = Math.max(...row.items.map((item) => item.height))
  const widest = Math.max(...row.items.map((item) => item.width))
  const linesOf = (cols: number) => {
    const out: Item[][] = []
    for (let index = 0; index < row.items.length; index += cols) out.push(row.items.slice(index, index + cols))
    return out
  }
  const measure = (lines: Item[][]) => ({
    totalW: Math.max(
      ...lines.map((items) => items.reduce((sum, item) => sum + item.width, 0) + PACK_PARAMS.GAP * Math.max(0, items.length - 1)),
    ),
    totalH: lineHeight * lines.length + PACK_PARAMS.GAP * Math.max(0, lines.length - 1),
  })

  /**
   * 整行都是装饰框时单列竖排（层带这种东西自己是「一横条」，横着并排会撑出 4000+ 的宽度，
   * 一屏根本装不下、取景只能卡在 0.85 下限、内容被切掉）。
   */
  if (isFrameStack(row)) {
    const lines = row.items.map((item) => [item])
    return { lineHeight, lines, ...measure(lines) }
  }

  /**
   * 折几行由**一屏预算**决定，而不是只看这一块自己：每行能占的高度 ≈ 一屏高度 ÷ 行数，
   * 于是「整视图能否在 0.85 以上装进画布」由每行共同保证。估宽用最宽的节点（保守），
   * 实际落位时再按各自宽度收紧——所以同一行的宽度不必相同。
   */
  const maxCols = Math.max(
    1,
    Math.min(row.items.length, Math.floor((budget.w + PACK_PARAMS.GAP) / (widest + PACK_PARAMS.GAP))),
  )
  let bestCols = 1
  let bestScore = -Infinity
  for (let cols = 1; cols <= maxCols; cols += 1) {
    const size = measure(linesOf(cols))
    const score = Math.min(budget.w / size.totalW, budget.h / size.totalH)
    if (score > bestScore + 1e-6) {
      bestScore = score
      bestCols = cols
    }
  }
  const lines = linesOf(bestCols)
  return { lineHeight, lines, ...measure(lines) }
}

/**
 * 消重叠：给定每个节点的**目标中心**与自身宽度，左右各扫一遍，
 * 保证相邻间距不小于 `GAP`——**不重叠由此成为构造性保证**，不是事后检查。
 */
function resolveOverlaps(desired: number[], widths: number[]): number[] {
  const xs = [...desired]
  for (let index = 1; index < xs.length; index += 1) {
    const need = widths[index - 1] / 2 + PACK_PARAMS.GAP + widths[index] / 2
    if (xs[index] - xs[index - 1] < need) xs[index] = xs[index - 1] + need
  }
  for (let index = xs.length - 2; index >= 0; index -= 1) {
    const need = widths[index] / 2 + PACK_PARAMS.GAP + widths[index + 1] / 2
    if (xs[index + 1] - xs[index] < need) xs[index] = xs[index + 1] - need
  }
  return xs
}

/**
 * 算出一块里每个节点的目标位置（先算不落位：顶层要连子孙一起搬）。
 *
 * 位置来源不是网格，而是**关系**：优先对齐「相邻行里对端的中心」（`anchorX`，取中位数），
 * 于是连线尽量竖直、交叉少；然后再用 `resolveOverlaps` 把重叠挤开。
 * 结果就是「不等宽、不网格，但相邻不重叠、间距合理」——即要求里的「不规则」。
 */
function blockTargets(
  shape: BlockShape,
  centerX: number,
  topY: number,
  anchorX: Map<string, number>,
): Array<{ item: Item; x: number; y: number }> {
  const out: Array<{ item: Item; x: number; y: number }> = []
  shape.lines.forEach((items, lineIndex) => {
    const y = topY + lineIndex * (shape.lineHeight + PACK_PARAMS.GAP) + shape.lineHeight / 2
    const widths = items.map((item) => item.width)
    const desired = items.map((item) => anchorX.get(item.node.id()) ?? item.x)
    const xs = resolveOverlaps(desired, widths)
    const left = Math.min(...xs.map((x, index) => x - widths[index] / 2))
    const right = Math.max(...xs.map((x, index) => x + widths[index] / 2))
    const shift = centerX - (left + right) / 2
    items.forEach((item, index) => out.push({ item, x: round1(xs[index] + shift), y: round1(y) }))
  })
  return out
}

/**
 * 执行分层对齐，返回是否有节点被重排。
 * 行顺序、行划分都沿用现状，只重排行内顺序与坐标——所以可以反复点，不会越排越乱。
 */
export function runOrderedLayout(cy: Core, viewport?: { w: number; h: number }): boolean {
  const visible = visibleNodes(cy)
  if (visible.length <= 1) return false

  const rows = collectRows(cy, visible)
  const rowOf = new Map<string, string>()
  rows.forEach((row) => row.items.forEach((item) => rowOf.set(item.node.id(), row.key)))
  const neighbors = crossRowNeighbors(cy, rowOf)

  /** 行内初始顺序：沿用现有横坐标（用户认可的读序），重心法从它出发 */
  rows.forEach((row) => row.items.sort((a, b) => a.x - b.x))
  rows.sort((a, b) => a.anchorY - b.anchorY)

  const indexOf = new Map<string, number>()
  const refreshIndex = () =>
    rows.forEach((row) => row.items.forEach((item, index) => indexOf.set(item.node.id(), index)))
  refreshIndex()

  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    /**
     * 交替自上而下 / 自下而上：让位置信息在两遍之间来回传播（只扫一遍只能拉直一半的线）。
     *
     * 每排完**一行**就刷新一次下标：只用上一轮的下标，两行会永远反相摆动——
     * 甲行把 A 挪到左边，乙行却还按甲行的旧位置把对端也挪到左边，于是交叉原地打转
     * （实测在「两条连线交叉」的最小样例上，四轮下来顺序会来回翻，一次都没收敛）。
     */
    const order = sweep % 2 === 0 ? rows : [...rows].reverse()
    order.forEach((row) => {
      // 「一摞容器」与「带序号的步骤流」的顺序是语义顺序，不参与交叉优化（见 keepOrder）
      if (!keepOrder(row)) sortRowByBarycenter(row, neighbors, indexOf)
      refreshIndex()
    })
  }

  // 整体质心：所有行都围绕它摆放，点一下「分层对齐」视图不会跳走
  const centerX = visible.reduce((sum, node) => sum + node.position().x, 0) / visible.length
  const centerY = visible.reduce((sum, node) => sum + node.position().y, 0) / visible.length

  /**
   * 一屏预算：整块必须在 ≥0.85 的缩放下装进画布。
   * 行数越多，每行能占的高度越小——所以「每行折几列」由它共同决定，而不是各行只顾自己横着铺。
   */
  /**
   * 画布尺寸：优先用调用方给的视口（脚本验收时传真实尺寸），否则读 cytoscape 的容器尺寸。
   * 无头环境里 `cy.width()` 可能是 1（不是 0），所以用下限兜底而不是 `|| 默认值`——
   * 否则预算会退化成 1×1、「一屏装得下」这条线全被判死，实测表现为整块细高到 0.48 的缩放。
   */
  const canvas = viewport ?? { w: Math.max(600, cy.width() || 0), h: Math.max(420, cy.height() || 0) }
  const budget = { w: canvas.w / FIT_MIN_ZOOM, h: canvas.h / FIT_MIN_ZOOM }
  const shapedCount = Math.max(1, rows.filter((row) => !isFrameStack(row)).length)
  /**
   * 每行的高度预算里要**扣掉装饰框自身的开销**（内边距 + 标题那一条，实测约 56）。
   * 不扣的话框内的块按满预算折行，加上框边之后整叠就超高：主图实测 914 > 783 的预算，
   * 取景落到 0.81（低于 0.85 的下限，最上/最下的层带会被切掉一截）。
   */
  const perRow = { w: budget.w, h: Math.max(80, budget.h / shapedCount - FRAME_OVERHEAD) }
  const shapes = new Map(rows.map((row) => [row.key, shapeOf(row, perRow)]))

  /**
   * 落位分三步，关键在**别把所有行平铺成一竖列**：
   *
   *   ① 框内：每个装饰框的子节点整成一块，居中放在该框当前的中心——内容不跑出框；
   *   ② 框心对齐子节点质心（深→浅）：框由 compound 自动合围；
   *   ③ 顶层：把顶层那些项（主图 = 五条层带）**堆成一列**，框动的时候它的子孙一起平移。
   *
   * 早先直接按「一行一行往下摞」排，六行就摞成 2500 高——一屏要缩到 0.24，
   * 正是「全局看不到、局部看不清」。嵌套摆放后整块的高度由各框自己的块决定。
   */
  /**
   * 「对齐锚点」：每个节点希望落在哪一列，取**它跨行对端当前位置的中位数**。
   * 它是「按关系排布」的来源——对端在左边，自己就往左靠，连线因此尽量竖直、少绕。
   * 每摆完一块就刷新一次：先摆的上层会成为下层的锚。
   */
  const anchorX = new Map<string, number>()
  const refreshAnchor = () => {
    visible.forEach((node) => {
      const peers = neighbors.get(node.id()) ?? []
      const xs = peers
        .map((id) => cy.$id(id).position().x)
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      if (!xs.length) anchorX.delete(node.id())
      else anchorX.set(node.id(), xs[Math.floor(xs.length / 2)])
    })
  }
  refreshAnchor()

  rows
    .filter((row) => !row.key.startsWith('__top__'))
    .forEach((row) => {
      const frame = cy.$id(row.key)
      if (!frame.length) return
      const shape = shapes.get(row.key)!
      const center = frame.position()
      blockTargets(shape, center.x, center.y - shape.totalH / 2, anchorX).forEach(({ item, x, y }) =>
        item.node.position({ x, y }),
      )
    })

  visible
    .filter((node) => node.isParent())
    .sort((a, b) => b.ancestors().length - a.ancestors().length)
    .forEach((frame) => {
      const box = frame.children().boundingBox({ includeLabels: false, includeOverlays: false })
      if (!Number.isFinite(box.x1)) return
      frame.position({ x: round1((box.x1 + box.x2) / 2), y: round1((box.y1 + box.y2) / 2) })
    })

  const topItems = rows
    .filter((row) => row.key.startsWith('__top__'))
    .flatMap((row) => row.items)
  if (topItems.length > 1) {
    /**
     * 顶层堆叠前必须**重新量一次尺寸**：`collectRows` 量的框高是**排版前**的，
     * 而框内的内容刚刚被重排过、框心也按新内容对齐过，框高早就变了。
     * 用旧高算堆叠间距，框之间就会叠在一起（实测入口 B 出现 11 处重叠、最小间距 -37）。
     */
    topItems.forEach((item) => {
      const size = sizeOf(item.node)
      item.width = size.width
      item.height = size.height
    })
    const shape = shapeOf({ key: '__top__', items: topItems, anchorY: centerY }, budget)
    const topY = centerY - shape.totalH / 2
    refreshAnchor()
    blockTargets(shape, centerX, topY, anchorX).forEach(({ item, x, y }) => {
      const node = item.node
      const from = node.position()
      node.position({ x, y })
      // 框动，框里的子孙跟着动：compound 只改父的位置不会带着子节点走
      if (node.isParent()) {
        const deltaX = x - from.x
        const deltaY = y - from.y
        node.descendants().forEach((child) => {
          const position = child.position()
          child.position({ x: round1(position.x + deltaX), y: round1(position.y + deltaY) })
        })
      }
    })
  }

  /**
   * 装饰框的位置由**子节点**决定（compound 会自动长大包住内容）：
   * 先深后浅，浅框量到的包围盒才包含已经摆好的深框。
   */
  visible
    .filter((node) => node.isParent())
    .sort((a, b) => b.ancestors().length - a.ancestors().length)
    .forEach((frame) => {
      const box = frame.children().boundingBox({ includeLabels: false, includeOverlays: false })
      if (!Number.isFinite(box.x1)) return
      frame.position({ x: round1((box.x1 + box.x2) / 2), y: round1((box.y1 + box.y2) / 2) })
    })

  return true
}
