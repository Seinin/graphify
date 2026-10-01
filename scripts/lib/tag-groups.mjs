/**
 * 标签类别 → 颜色（脚本侧）。
 *
 * 类别就是标签注册表里的 `group`：`inputs.py` 里 `InputStruct` 的子类名。
 * 这份表给**脚本**用（`scan-param-tags.mjs` 重建标签时写色、`color-tags.mjs` 一次性 seed）；
 * 前端渲染用的是 `src/graph/palette.ts` 里同名的一张表。
 *
 * 为什么会有两份：脚本是 .mjs、直接 import 不了 TS 的 palette。为避免它们悄悄漂移，
 * `npm run check:canvas` 有一条断言（用 esbuild 载入 palette.ts 读真实 `data/graph.json`）：
 * **每个标签的 `color` 必须等于它 `group` 在本表里的色**，改一处忘另一处就直接失败。
 * 改配色时两张表一起改。
 */

export const TAG_GROUP_COLORS = {
  MatterOptions: '#1D4ED8',
  SimulationOptions: '#047857',
  AstroOptions: '#B45309',
  AstroParams: '#7E22CE',
}

/** 未分类（`group` 为空或没登记过）的兜底色 */
export const TAG_GROUP_FALLBACK_COLOR = '#4B5563'

/** 按 group 取类别色；没登记的组一律兜底（不是第五个类别） */
export function tagColorOf(group) {
  const key = String(group ?? '').trim()
  return TAG_GROUP_COLORS[key] ?? TAG_GROUP_FALLBACK_COLOR
}
