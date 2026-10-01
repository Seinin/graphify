import type { Core } from 'cytoscape'

/**
 * 画布文字度量：**模型单位字号** + 命中测试。
 *
 * 这一版是对早先「恒屏字号」的纠偏。当时的写法是 `font-size = 12 / zoom`，
 * 再夹一条「两行必须装进框高」的上限；上限一夹，字号就再也不会随缩放变大了，
 * 于是缩到 0.5（**整层视图的典型缩放**）时字在屏幕上只剩 6px —— 越是看全局越看不见字。
 *
 * 现在文字与方框同为模型单位（与 draw.io / Figma 一致）：
 *   · 字号是常量，框高就是照它算的，永远装得进；
 *   · 缩放时文字与框一起变大变小，屏幕可读性取决于「这一层排得够不够紧凑」——
 *     紧凑问题交给布局去收空档（tools/normalize-layout.mjs），不再用字号去缝补；
 *   · 标签写在方框内部（`text-valign: center`），折行宽度固定在样式表里（= 框宽 - 内边距），
 *     因此换行位置在任何缩放级别都一致，不会出现「滚一下滚轮文字重排」；
 *   · 缩得太小时只隐藏**小框**文字、保留大框标题（见渲染器的 LOD）：宁可少给细节，
 *     也不给一层看不清的灰雾；
 *   · 不按重叠省略标签：方框里的文字就是框的内容，省略只会得到一排空框。
 */
export const NODE_FONT_SIZE = 13
/** 边标签的模型字号：比节点标签（13）小一档，但要够看清产物名 */
export const EDGE_FONT_SIZE = 12
/** 大框标题的模型字号：比正文大一档，框里的层级标题要压得住连线 */
export const GROUP_TITLE_FONT_SIZE = 18
/** 行高与字号的比值（cytoscape 默认行高约为字号的 1.15~1.2） */
const LINE_HEIGHT_RATIO = 1.2

/** 标签矩形（渲染坐标，左上 → 右下） */
export interface LabelCandidate {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** 越大越优先 */
  priority: number
}

/* ------------------------------------------------------------------ *
 * 方框尺寸：按文字量算，而不是所有节点一个尺寸
 * ------------------------------------------------------------------ */

/** 方框左右内边距之和（模型单位） */
const BOX_PADDING_X = 20
/** 方框上下内边距之和 */
const BOX_PADDING_Y = 14
/** 方框宽度区间：窄标题不至于太瘦，长标题不至于拖成长条 */
const BOX_MIN_WIDTH = 116
const BOX_MAX_WIDTH = 240
/** 名称之外的最小高度（单行） */
const BOX_MIN_HEIGHT = 38

/**
 * 量一段文字在给定字号下的宽度（模型单位，正数）。
 *
 * 与画布上渲染用的是同一套字重与字族；拿不到 DOM（无头自检、SSR）时按平均字宽估算，
 * 估算宁可略宽：宽了只是框大一点，窄了文字会溢出框。
 *
 * 字号作为参数传进来（大框标题比正文大一档），且**每个字号各用一份度量上下文**：
 * canvas 的 `font` 是上下文级状态，共用一个会在来回切换时量错。
 */
const widthCache = new Map<string, number>()
const ctxCache = new Map<number, CanvasRenderingContext2D>()

const labelFont = (fontSize: number) => `500 ${fontSize}px "PingFang SC", "Noto Sans SC", sans-serif`

function measureContext(fontSize: number): CanvasRenderingContext2D | null {
  const cached = ctxCache.get(fontSize)
  if (cached) return cached
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.font = labelFont(fontSize)
  ctxCache.set(fontSize, ctx)
  return ctx
}

export function measureLabelWidth(text: string, fontSize: number = NODE_FONT_SIZE): number {
  const value = String(text ?? '')
  if (!value) return 0
  const key = `${fontSize}:${value}`
  const cached = widthCache.get(key)
  if (cached !== undefined) return cached
  const ctx = measureContext(fontSize)
  let width = ctx ? ctx.measureText(value).width : 0
  if (!Number.isFinite(width) || width <= 0) {
    // 中文按一个字宽、其余按 0.55 字宽估：与该字号下的实际渲染接近
    const cjk = (value.match(/[\u3000-\u9fff\uff00-\uffef]/g) ?? []).length
    width = cjk * fontSize + (value.length - cjk) * fontSize * 0.55
  }
  if (widthCache.size > 2000) widthCache.clear()
  widthCache.set(key, width)
  return width
}

/** 贪心折行后有几行（按字符量，对中英混排足够准） */
function countWrappedLines(text: string, wrapWidth: number, fontSize = NODE_FONT_SIZE): number {
  if (wrapWidth <= 0) return 1
  let lines = 1
  let current = ''
  for (const char of text) {
    const next = current + char
    if (current && measureLabelWidth(next, fontSize) > wrapWidth) {
      lines += 1
      current = char
    } else {
      current = next
    }
  }
  return lines
}

export interface BoxSize {
  /** 模型单位的框宽 */
  width: number
  /** 模型单位的框高 */
  height: number
  /** 框内文字的折行宽度（= 框宽 - 左右内边距） */
  textMaxWidth: number
}

/**
 * 按名称算方框尺寸：短名字给短框，长名字折行并加高。
 * 这样一屏里的框宽高互不相同，但都由内容决定——就是「大小成比例」的来源。
 */
export function measureBoxSize(label: string): BoxSize {
  const text = String(label ?? '').trim() || '未命名'
  const natural = measureLabelWidth(text, NODE_FONT_SIZE) + BOX_PADDING_X
  const width = Math.round(Math.min(BOX_MAX_WIDTH, Math.max(BOX_MIN_WIDTH, natural)))
  const textMaxWidth = width - BOX_PADDING_X
  const lines = countWrappedLines(text, textMaxWidth, NODE_FONT_SIZE)
  const height = Math.round(
    Math.max(BOX_MIN_HEIGHT, lines * NODE_FONT_SIZE * LINE_HEIGHT_RATIO + BOX_PADDING_Y),
  )
  return { width, height, textMaxWidth }
}

/** 大框内边距（模型单位，四边各一份；必须与样式表里 container 的 padding 一致） */
export const GROUP_PADDING = 14

/**
 * 大框的最小尺寸：**一条只有标题的层带**要尽量矮。
 *
 * 这一版把高度从 120 压到 52（标题行高 + 内边距）——旧值让每条层带占 120 单位高，
 * 五条层带就要 600+ 单位，一屏根本装不下，于是整层取景只能缩到 0.43（字 5.6px）。
 * 真正的大小仍由子节点撑开（compound），这里只保证「空框不塌成一条线」。
 */
export function measureGroupSize(label: string): BoxSize {
  const inner = Math.round(measureLabelWidth(label, GROUP_TITLE_FONT_SIZE))
  const titleRow = Math.round(GROUP_TITLE_FONT_SIZE * LINE_HEIGHT_RATIO)
  return {
    width: Math.round(Math.min(460, Math.max(170, inner + GROUP_PADDING * 2))),
    height: Math.max(52, titleRow + GROUP_PADDING * 2),
    textMaxWidth: Math.round(Math.min(432, Math.max(142, inner))),
  }
}

/**
 * 命中测试：指针（渲染坐标）落在哪个节点上。
 *
 * 标签现在就在方框里，所以「文字矩形」与「方框矩形」是同一个东西，判定只剩一条：
 * 取**包含该点、且最小**的方框——这样点在大框里的某个小框上时命中的是小框，
 * 点在大框的空白处才命中大框。容器（compound 父节点）永远排在子节点之后，
 * 否则大框会把整片区域吃掉，里面的小框永远悬停不到。
 */
export function hitTestNode(cy: Core, point: { x: number; y: number }): string | null {
  const contains = (rect: { x1: number; y1: number; x2: number; y2: number }) =>
    point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2

  const hits: { id: string; parent: boolean; area: number; priority: number }[] = []
  cy.nodes().forEach((node) => {
    if (!node.visible()) return
    const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false })
    if (!contains(box)) return
    hits.push({
      id: node.id(),
      parent: node.isParent(),
      area: Math.max(0, box.w) * Math.max(0, box.h),
      priority: node.degree(true),
    })
  })
  if (!hits.length) return null

  hits.sort((a, b) => {
    // 子节点优先：大框只是背景，指针在里面的小框上时用户要的是小框
    if (a.parent !== b.parent) return a.parent ? 1 : -1
    // 同在一条链上时取更小的那个（更「深」）
    if (a.area !== b.area) return a.area - b.area
    return b.priority - a.priority
  })
  return hits[0].id
}

/**
 * 收集节点的标签矩形（= 方框的渲染矩形）。
 * 保留这个函数是为了让「方框会不会互相压住」这类判断有统一的几何来源；
 * 是否显示标签已不再由它决定（见文件头说明）。
 */
export function computeLabelCandidates(cy: Core): LabelCandidate[] {
  const candidates: LabelCandidate[] = []
  cy.nodes().forEach((node) => {
    if (!node.visible()) return
    const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false })
    if (!Number.isFinite(box.x1) || !Number.isFinite(box.y1)) return
    const branch = node.hasClass('branch')
    const text = String((branch ? node.data('branchLabel') : node.data('label')) ?? '').trim()
    if (!text) return
    candidates.push({
      id: node.id(),
      x1: box.x1,
      y1: box.y1,
      x2: box.x2,
      y2: box.y2,
      // 大框与未展开分支信息量最高；其余按度数（连接越多越像「主干」）
      priority: node.isParent() ? 4000 + node.degree(true) : branch ? 3000 + node.degree(true) : node.degree(true) * 10,
    })
  })
  return candidates
}

/** 两个矩形是否相交（各边内缩 1px，容忍相邻标签刚好贴边） */
export function rectsIntersect(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  return a.x1 < b.x2 - 1 && a.x2 > b.x1 + 1 && a.y1 < b.y2 - 1 && a.y2 > b.y1 + 1
}
