/**
 * 画布配色单一来源（浅色主题）。
 *
 * 画布由 cytoscape 画在 canvas 上，颜色不能走 CSS 变量，所以集中定义在这里：
 * `styles.ts`（cytoscape 样式表）与 `CanvasOverlays.tsx`（图例、浮层）必须同时引用本文件，
 * 否则图例与画布会各写一套色值并逐渐漂移（既有问题：图例硬编码 `#3A4252` / `#2A3140`）。
 */

/** 画布底色，与 `index.css` 里 `.canvas-grid` 的底色一致 */
export const CANVAS_BACKGROUND = 'hsl(0 0% 100%)'
/** 画布点阵颜色，与 `.canvas-grid` 的第二个 radial-gradient 一致 */
export const CANVAS_GRID_DOT = 'hsl(226 20% 84%)'

/** 节点标签：深色文字 + 浅色描边，在彩色节点块与近白画布上都清晰 */
export const LABEL_COLOR = '#1F2430'
export const LABEL_OUTLINE_COLOR = '#FFFFFF'
export const LABEL_OUTLINE_OPACITY = 0.9

/** 语义关系连线：近白底上取中灰，视觉权重仍明显高于层级连线 */
export const EDGE_COLOR = '#7C8798'
export const EDGE_LABEL_COLOR = '#475569'
export const EDGE_LABEL_OUTLINE_COLOR = '#FFFFFF'

/** 层级连线：最轻的一档，只表达「父 → 直系子节点」的细分关系 */
export const HIERARCHY_EDGE_COLOR = '#C7CEDA'

/**
 * **跨层捷径**连线（物理链页专用）。
 *
 * 物理链按"到终点的最长路径"分层，于是**骨干树上的边层差恒为 1**；不在最长路径上的真实依赖
 * （一个量有好几个上游，或直连到旁路诊断出口）必然跨层。这些边不能删——它们是真实的公式依赖，
 * 删掉就是篡改物理——所以照画，但用**这一档颜色 + 点线 + 弧线**和骨干边区分开：
 * 看到弧线就知道"这条箭头跳过了几层"，而不是以为树的层级画错了。
 * 取紫灰（比语义关系灰更冷、比分层灰更深），与「条件虚线」用的灰、`contradicts` 用的琥珀都不同族。
 */
export const CROSS_LINK_COLOR = '#8B7FD4'

/**
 * **跨红移回流**连线（物理链页专用）。
 *
 * 与「跨层捷径」是两种跨法：捷径跳的是**链条深度**（仍在同一轮内），回流跨的是**迭代**
 * ——下一轮指回上一轮（`previous_spin_temp` / `previous_ionize_box`），方向与自上而下的主序相反。
 * 两者不能共用一档颜色，否则"跨了几层"与"跨了一轮"会被读成同一件事。
 *
 * 取品红一档：比跨层捷径的紫灰更饱和、更暗（在白底上对比度更高），与语义关系的灰、
 * 分层连线的浅灰、`contradicts` 的琥珀、`SNAP_COLOR` 的靛都不撞；红点（`TAG_DOT_COLOR`）
 * 虽同为暖色，但它是节点角上的小圆点、且色相更偏红，不会与一条长划虚线混认。
 */
export const FEEDBACK_COLOR = '#A21CAF'

/** 交互状态色 */
export const SELECTION_COLOR = '#7C3AED'
export const HIGHLIGHT_COLOR = '#4F46E5'
export const SNAP_COLOR = '#0891B2'
export const HIGHLIGHT_LABEL_COLOR = '#334155'
export const SELECTION_BOX_COLOR = '#4F46E5'

/** 语义关系中的特殊类型色 */
export const CONTRADICTS_COLOR = '#D97706'

/**
 * 大框（容器节点）配色：浅底 + 同色虚线描边，标题贴在左上角。
 * 填充刻意压得比普通节点更淡（0.05），否则十几个小框叠在大框里会把大框自身盖住。
 */
export const GROUP_COLOR = '#0F766E'
export const GROUP_BACKGROUND_OPACITY = 0.05
/** 大框标题色（比填充深一档，才压得住框内的连线） */
export const GROUP_TITLE_COLOR = '#0B5A54'

/**
 * 方框的**兜底**基准尺寸（模型单位）。
 *
 * 实际尺寸由名称算出（见 labels.ts 的 measureBoxSize，写进 data.boxW/boxH），
 * 这两个常量只用于「量不出文字」时的兜底，以及没有 boxW 的旧数据。
 */
export const NODE_BOX_WIDTH = 140
export const NODE_BOX_HEIGHT = 40
/**
 * 悬浮放大倍数：按节点自己的基准尺寸等比放大（渲染器写在行内样式里）。
 *
 * 1.18 看着「只是亮了一点」，和虚线框/条件框那种常规强调分不开；1.32 才有一眼可见的
 * 「跳出来」的手感（配合 styles.ts 里加粗描边 + 光晕 + 抬层）。
 */
export const NODE_BOX_HOVER_SCALE = 1.32

/** 兜底节点色（未知类型），与主色同族 */
export const NODE_FALLBACK_COLOR = '#4F46E5'

/**
 * 全局标签标记（红点）。
 *
 * 红点由 **DOM 徽标**画（见 GraphCanvas 的 tagMarks 渲染）：早期试过用节点自己的
 * `background-image` 位图，在 `devicePixelRatio = 1` 时正常，但**高分屏（125%/150% 缩放）
 * 下画布上根本不出现**（实测 1.5 倍缩放：样式解析正常、像素里却没有红点）。
 * DOM 用同一套 CSS 像素定位，缩放/平移/高分屏都一致，而且是个真按钮，点起来也省事。
 *
 * 尺寸是**屏幕像素**：缩小时节点变小，红点不变小。
 */
export const TAG_DOT_SIZE = 9
export const TAG_DOT_COLOR = '#E11D48'
/** 红点距节点左上角的偏移（渲染器命中判定与本文件的样式共用同一口径） */
export const TAG_DOT_INSET = 3

/**
 * 全局标签的**类别配色**（只用于右侧属性面板；画布红点仍是上面那个固定玫红）。
 *
 * 类别就是注册表里的 `group`——`inputs.py` 里 `InputStruct` 的子类名。
 * 四类各取一个色相相隔较远的深色：面板里 11px 微文字直接用它当文字色，浅底上对比度够；
 * 也刻意避开明细块里"出处"链接的青色（`text-cyan-700`）与画布红点的玫红，
 * 免得让人以为"面板里的色 = 画布上的那个点"。
 *
 * `group` 为空归「未分类」，用中性灰兜底——那是"没归类"，不是第五个类别。
 *
 * 数据侧：`data/graph.json` 里标签的 `color` 由 `scripts/color-tags.mjs` 按**同一张表** seed
 * （那个脚本是 .mjs，直接 import 不了本文件，所以抄了一份 hex，末尾注释指回这里）；
 * `npm run check:canvas` 有一条断言把两处钉在一起，漂移就失败。
 */
export const TAG_GROUP_COLORS: Record<string, string> = {
  MatterOptions: '#1D4ED8',
  SimulationOptions: '#047857',
  AstroOptions: '#B45309',
  AstroParams: '#7E22CE',
}

/** 未分类（`group` 为空或没登记过）的兜底色 */
export const TAG_GROUP_FALLBACK_COLOR = '#4B5563'

/**
 * 标签的类别色：**标签自己的 `color` → 按 `group` 派生 → 兜底**。
 *
 * `color` 优先是为了留出"单独调某一个标签"的口子（服务端的 `updateTag` 早就能收这个字段）；
 * 没填就按类别派生，所以新建标签不必手工配色。
 */
export function tagAccentOf(tag: { color?: string; group?: string }): string {
  if (tag.color) return tag.color
  const group = tag.group?.trim()
  if (group && TAG_GROUP_COLORS[group]) return TAG_GROUP_COLORS[group]
  return TAG_GROUP_FALLBACK_COLOR
}

/**
 * 把一个 `#RRGGBB` 合成 `rgba(...)`：同一类别色的底色 / 描边 / 悬停底都靠它算，
 * 免得为每个类别再抄一份浅色值。解析不了就原样返回（画面退化成实色，不会崩）。
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = String(hex ?? '').trim().replace(/^#/, '')
  const full = value.length === 3 ? [...value].map((char) => char + char).join('') : value
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex
  const int = Number.parseInt(full, 16)
  const red = (int >> 16) & 255
  const green = (int >> 8) & 255
  const blue = int & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
