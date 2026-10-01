/**
 * 方框尺寸（脚本侧的**唯一**副本）。
 *
 * 前端在 `src/graph/labels.ts` 里按标签算方框宽高，**排版脚本必须用同一套数**——
 * 否则就会重演"坐标按 820 宽的框排、真正画出来只有 135 宽"的错：间隙比框大好几倍，
 * 一取景整屏缩得只有几像素（用户 2026-09-30 的原话：*初始模块尺寸和距离要成比例，
 * 距离过大模块又太小*）。
 *
 * 为什么是副本而不是 import：`labels.ts` 是 TS，`node scripts/*.mjs` 直接跑不了。
 * 所以**这条口径有两个物理副本**（TS 一份、这里一份），改任何一边都要同步另一边；
 * 脚本里所有需要尺寸的地方（`build-physics-chain.mjs`、`normalize-layout.mjs`）
 * 一律 import 这**一份**，脚本内部不再各写一遍。
 */
export const NODE_FONT_SIZE = 13
export const GROUP_TITLE_FONT_SIZE = 18
export const GROUP_PADDING = 14
/** 行高与字号的比值（与 cytoscape 的默认行高一致） */
export const LINE_HEIGHT_RATIO = 1.2

/** 方框左右内边距之和 / 上下内边距之和 / 宽度区间 / 单行最小高度（同 labels.ts） */
const BOX_PADDING_X = 20
const BOX_PADDING_Y = 14
const BOX_MIN_WIDTH = 116
const BOX_MAX_WIDTH = 240
const BOX_MIN_HEIGHT = 38

/** 大框（容器）的宽度区间与最小高度（同 labels.ts） */
const GROUP_MIN_WIDTH = 170
const GROUP_MAX_WIDTH = 460
const GROUP_MIN_HEIGHT = 52

/**
 * 量一段文字的宽度（模型单位）：与 `labels.ts` 的无 DOM 分支逐字一致。
 * 脚本里没有 canvas，所以走的是**估算**这条路——也正因如此，它与前端实测值允许有
 * 一两像素的出入，间距一律留够（`GAP` 是按"够分清彼此"定的，不是按贴边定的）。
 */
export function measureLabelWidth(text, fontSize = NODE_FONT_SIZE) {
  const value = String(text ?? '')
  if (!value) return 0
  const cjk = (value.match(/[\u3000-\u9fff\uff00-\uffef]/g) ?? []).length
  return cjk * fontSize + (value.length - cjk) * fontSize * 0.55
}

/** 贪心折行后有几行（按字符量，与 `labels.ts` 的 countWrappedLines 同口径） */
function countWrappedLines(text, wrapWidth, fontSize = NODE_FONT_SIZE) {
  if (wrapWidth <= 0) return 1
  let lines = 1
  let current = ''
  for (const char of String(text ?? '')) {
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

/** 按名称算方框尺寸：短名字给短框，长名字折行并加高（同 `labels.ts` 的 measureBoxSize） */
export function measureBoxSize(label) {
  const text = String(label ?? '').trim() || '未命名'
  const natural = measureLabelWidth(text, NODE_FONT_SIZE) + BOX_PADDING_X
  const width = Math.round(Math.min(BOX_MAX_WIDTH, Math.max(BOX_MIN_WIDTH, natural)))
  const textMaxWidth = width - BOX_PADDING_X
  const lines = countWrappedLines(text, textMaxWidth, NODE_FONT_SIZE)
  const height = Math.round(Math.max(BOX_MIN_HEIGHT, lines * NODE_FONT_SIZE * LINE_HEIGHT_RATIO + BOX_PADDING_Y))
  return { width, height, textMaxWidth }
}

/** 按名称算大框尺寸（同 `labels.ts` 的 measureGroupSize） */
export function measureGroupSize(label) {
  const inner = Math.round(measureLabelWidth(label, GROUP_TITLE_FONT_SIZE))
  const titleRow = Math.round(GROUP_TITLE_FONT_SIZE * LINE_HEIGHT_RATIO)
  return {
    width: Math.round(Math.min(GROUP_MAX_WIDTH, Math.max(GROUP_MIN_WIDTH, inner + GROUP_PADDING * 2))),
    height: Math.max(GROUP_MIN_HEIGHT, titleRow + GROUP_PADDING * 2),
    textMaxWidth: Math.round(Math.min(432, Math.max(142, inner))),
  }
}

/**
 * 同层节点之间的统一间距（模型单位）。与 `normalize-layout.mjs` 用的是同一个值：
 * 「够分清彼此，又不浪费屏幕」。**排版一律用它**——间距是常数、框是内容决定的，
 * 于是"尺寸与距离成比例"这句话在数据里就成立（框大则整片跟着大，框小则空隙也小）。
 */
export const GAP = 24

/**
 * 一行 / 一列排完后，从起点量出来的**中心坐标**（按每个框自己的宽高累加）。
 *
 * @param sizes 依次要排的框尺寸 `{width, height}`
 * @param axis 'x' 横排（用宽）/ 'y' 竖排（用高）
 * @param center 这一行 / 一列的中心（另一条轴上对齐到它）
 * @returns 每个框的中心坐标（与 `sizes` 同序）
 */
export function stackCenters(sizes, axis, center) {
  const extent = sizes.reduce((sum, size) => sum + size[axis === 'x' ? 'width' : 'height'], 0) + GAP * Math.max(0, sizes.length - 1)
  let cursor = center - extent / 2
  return sizes.map((size) => {
    const span = size[axis === 'x' ? 'width' : 'height']
    const at = cursor + span / 2
    cursor += span + GAP
    return Math.round(at * 10) / 10
  })
}
