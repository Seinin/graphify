/**
 * 画布逻辑自检：在无头 cytoscape 上驱动真实的 `GraphRenderer`，检查
 * 「主图 = 装饰框内联展开 / 模块子节点不同屏 / 子图标签页只放焦点子节点 / 模块徽标 /
 *   条件虚线 / 端口吸附」这套规则。
 *
 * 为什么值得单独写一个脚本：
 *   这些行为全是「看不见的可见性计算」，出错时表现为「画布空白」或「层级不对」，
 *   而浏览器里只能靠人眼发现。放在这里跑，几秒钟就能给出结论。
 *
 * 环境替身：渲染器用到 requestAnimationFrame（标签合帧），node 里没有，这里用 setTimeout 顶替。
 *
 * 用法：`npm run check:canvas`（失败时退出码 1）
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cytoscape from 'cytoscape'
import fcose from 'cytoscape-fcose'
import * as esbuild from 'esbuild'
import fs from 'node:fs/promises'

globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

/** 把 TS 模块打包到 data/（已被 git 忽略）再按 ESM 导入：data: URL 解析不了裸模块名 */
async function load(entry, name) {
  const outfile = path.join(root, 'data', `.check-${name}.mjs`)
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'esm',
    outfile,
    platform: 'node',
    external: ['cytoscape', 'cytoscape-fcose'],
    logLevel: 'silent',
  })
  return import(`file://${outfile}`)
}

const { GraphRenderer } = await load('src/graph/cytoscapeSetup.ts', 'setup')
const { buildStylesheet } = await load('src/graph/styles.ts', 'styles')
cytoscape.use(fcose)

/**
 * 合成一张「装饰框 + 模块」的图：
 *   · A / B 是装饰容器（group），子节点直接画在框里；
 *   · A1 是模块（非 group 但有子节点 A1a）：A1a 不与 A1 同屏，只在 A1 自己的标签页出现；
 *   · L 是游离顶层节点。
 */
const g = (id, label, extra = {}) => ({
  id, label, type: 'method', summary: '', tags: [], refs: [], topics: [], parent: null,
  conditional: false, position: { x: 0, y: 0 }, createdAt: '', updatedAt: '', ...extra,
})
/**
 * 坐标必须**互不相同**：`ignoredPositionIds` 会把「一批共享同一坐标的节点」判为占位数据，
 * 于是它们带上 `.enter`（opacity 0 / 8×8）并跑 180ms 的过渡——自检读到的是过渡中间值
 * （踩过：宽度读到 35.13 而不是 140）。
 */
const nodes = [
  // A 这条层带自己也带标签：用来验证「容器不亮红点」
  g('A', '大框 A', { type: 'group', position: { x: 0, y: 0 }, tags: ['tag:demo'] }),
  g('A1', 'A 里的过程 1', { parent: 'A', position: { x: -160, y: 80 }, tags: ['tag:demo'] }),
  g('A1a', 'A1 的子节点（只属于 A1 的标签页）', { parent: 'A1', position: { x: -160, y: 200 } }),
  g('A2', 'A 里的过程 2', { parent: 'A', conditional: true, position: { x: 0, y: 80 } }),
  // 故意用长名字：用来验证「框宽高按内容算」（大小成比例）
  g('A3', 'A 里的过程 3（这行名字很长，用来验证框会变宽并折行）', { parent: 'A', position: { x: 160, y: 80 } }),
  g('B', '大框 B', { type: 'group', position: { x: 460, y: 0 } }),
  g('B1', 'B 里的过程 1', { parent: 'B', position: { x: 380, y: 80 } }),
  g('B2', 'B 里的过程 2', { parent: 'B', position: { x: 540, y: 80 } }),
  g('L', '游离顶层节点', { position: { x: 0, y: -160 } }),
]
const edges = [
  { id: 'e1', source: 'A1', target: 'A2', label: '产物 1', type: 'derives_from', directed: true, note: '', sourcePort: 'e', targetPort: 'w', conditional: false, createdAt: '', updatedAt: '' },
  { id: 'e2', source: 'A2', target: 'B1', label: '条件产物', type: 'depends_on', directed: true, note: '', sourcePort: null, targetPort: null, conditional: true, createdAt: '', updatedAt: '' },
]
const graph = {
  meta: {
    version: 1,
    name: '自检',
    description: '',
    topics: [],
    tags: [{ id: 'tag:demo', name: '演示标签', description: '' }],
    updatedAt: '',
  },
  nodes,
  edges,
}

const handlers = {
  onSelectNode() {}, onSelectEdge() {}, onClearSelection() {}, onNodeDragStart() {}, onNodeDragEnd() {},
  onHoverNode() {}, onNodeContextMenu() {}, onEdgeContextMenu() {}, onCanvasContextMenu() {}, onZoomChange() {},
  onLayoutSettled() {}, onLayoutError(e) { console.log('  [布局报错]', e && e.message) }, onVisibilityChange() {},
}

/** 主图标签页（focusId = null） */
const renderer = new GraphRenderer(handlers)
renderer.cy = cytoscape({ headless: true, styleEnabled: true, style: buildStylesheet(), elements: [] })
const cy = renderer.cy
renderer.layoutKind = 'manual'

/** 模块 A1 的子图标签页（focusId = 'A1'） */
const subRenderer = new GraphRenderer(handlers, { focusId: 'A1' })
subRenderer.cy = cytoscape({ headless: true, styleEnabled: true, style: buildStylesheet(), elements: [] })
const subCy = subRenderer.cy
subRenderer.layoutKind = 'manual'

const shown = () => cy.nodes().filter((n) => n.visible()).map((n) => n.id()).sort()
const expect = (label, actual, want) => {
  const a = [...actual].sort().join(',')
  const w = [...want].sort().join(',')
  const ok = a === w
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(38)} 得到 [${a}]${ok ? '' : ` 期望 [${w}]`}`)
  return ok
}

let failed = 0
const check = (label, actual, want) => {
  if (!expect(label, actual, want)) failed += 1
}

/** 标量断言（样式取值、取景次数这类），与集合断言共用同一套计数 */
const styleCheck = (label, actual, want) => {
  const ok = String(actual) === String(want)
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(38)} 得到 ${JSON.stringify(actual)}${ok ? '' : ` 期望 ${JSON.stringify(want)}`}`)
  if (!ok) failed += 1
}

console.log('=== 可见性自检（合成图：A[A1(模块),A2,A3] / B[B1,B2] / 游离 L）===')
renderer.sync(graph)
await new Promise((r) => setTimeout(r, 50))
check(
  '主图：装饰框内联展开，模块子节点不同屏',
  shown(),
  ['A', 'A1', 'A2', 'A3', 'B', 'B1', 'B2', 'L'],
)

console.log('=== 关系收起自检（收起某个模块的连线：只切 display，不动节点与坐标）===')
{
  const visibleEdges = () => cy.edges().filter((edge) => edge.visible()).map((edge) => edge.id()).sort()
  const nodesBefore = shown()
  const positionBefore = () => {
    const position = cy.getElementById('A1').position()
    return `${Math.round(position.x)},${Math.round(position.y)}`
  }
  const anchorPosition = positionBefore()

  check('基线：两条关系都画着', visibleEdges(), ['e1', 'e2'])

  // A1 只连 e1（A1 → A2）：收起它的关系只该少这一条
  renderer.setHiddenRelations(['A1'])
  check('收起 A1 的关系后只剩 e2', visibleEdges(), ['e2'])
  check('节点一个都没少（只切连线）', shown(), nodesBefore)

  // A2 是 e1 与 e2 的共同端点：收起它，两条线都不该画
  renderer.setHiddenRelations(['A2'])
  check('收起共同端点的关系后两条都不画', visibleEdges(), [])

  // 集合相等时重复设置：结果必须一样（幂等）
  renderer.setHiddenRelations(['A2'])
  check('同一集合重复设置结果不变（幂等）', visibleEdges(), [])

  // 大框是容器、不参与关系：把它的 id 设进去不该影响任何连线
  renderer.setHiddenRelations(['A'])
  check('容器进集合不影响连线', visibleEdges(), ['e1', 'e2'])

  // 清空即恢复，且坐标没被动过（元素从未被删除重建）
  renderer.setHiddenRelations([])
  check('清空集合后关系全部恢复', visibleEdges(), ['e1', 'e2'])
  check('节点仍然一个不多一个不少', shown(), nodesBefore)
  styleCheck('A1 的坐标未被改动', positionBefore(), anchorPosition)
}

subRenderer.sync(graph)
await new Promise((r) => setTimeout(r, 50))
// 子图里只有它自己的内容：不派生任何父层元素（邻居卡/派生线已取消）
check(
  '子图标签页只放焦点的直系子节点',
  subCy.nodes().filter((n) => n.visible()).map((n) => n.id()),
  ['A1a'],
)

/**
 * 全局标签：勾选后**显示该标签的节点**左上角亮红点。口径只有一份（`src/lib/tagEdit.ts`
 * 的 `tagDisplayOf`）：叶子看自己那份，**有子图的模块看子树叶子并集**（自己那份不参与），容器不参与。
 * 于是"在叶子上勾一个参数，它的模块祖先跟着亮"是这一段的重点，而"模块自己挂的标签"不点红点。
 * 红点画在节点自己的背景位图上，所以这里断言的是状态类与命中判定，不是 DOM。
 */
styleCheck('未勾选任何标签时没有红点', cy.$('node.tagged').length, 0)
renderer.setActiveTags(['tag:demo'])
styleCheck('容器不亮红点（容器不参与标签）', cy.$('#A').hasClass('tagged'), false)
styleCheck('未被标的模块不亮红点', cy.$('#L').hasClass('tagged'), false)
/*
 * 有子图的模块：显示的标签是**子树叶子标签的并集**（现算），它自己那份**不参与显示**。
 * 所以合成图里 A1 虽然自己挂着 `tag:demo`（A1a 是叶子、没标签），勾选后它也**不该**亮——
 * 这一条正是从旧口径换过来的地方（旧口径下这里会亮，红点是按"自己那份"点的）。
 */
styleCheck('有子图的模块：自己那份标签不参与显示（勾选后不亮）', cy.$('#A1').hasClass('tagged'), false)
styleCheck('有子图的模块：自己那份没写进 tagIds', (cy.$('#A1').data('tagIds') || []).join(','), '')
// 把标签挂到它的叶子上 → 祖先立刻亮（并集），tagIds 就是这个并集
const leafOfA1 = nodes.find((item) => item.id === 'A1a')
leafOfA1.tags = ['tag:demo']
renderer.sync(graph)
await new Promise((r) => setTimeout(r, 50))
styleCheck('叶子挂上标签后，有子图的祖先立刻亮红点', cy.$('#A1').hasClass('tagged'), true)
styleCheck('祖先的 tagIds 是子树叶子并集', (cy.$('#A1').data('tagIds') || []).join(','), 'tag:demo')
// 再从叶子上摘掉 → 祖先立刻灭（不残留上一次那份）
leafOfA1.tags = []
renderer.sync(graph)
await new Promise((r) => setTimeout(r, 50))
styleCheck('叶子摘掉后祖先的红点随之熄灭（不残留）', cy.$('#A1').hasClass('tagged'), false)
// 挂回来，供下面的徽标 / 命中判定继续用（亮的就是 A1）
leafOfA1.tags = ['tag:demo']
renderer.sync(graph)
await new Promise((r) => setTimeout(r, 50))
styleCheck('挂回来又亮（没有"记住上一次"的缓存）', cy.$('#A1').hasClass('tagged'), true)
/**
 * 红点徽标：红点本体由 DOM 按钮画，渲染器只负责给出「哪些可见模块亮了、画在哪」。
 * 曾经用节点的 `background-image` 位图，DPR≠1 的屏幕上会消失，别再改回去（见 palette.ts）。
 */
{
  const marks = renderer.tagMarks()
  styleCheck('红点徽标只落在命中的可见模块上', marks.map((mark) => mark.nodeId).sort().join(','), 'A1')
  styleCheck('徽标带渲染坐标与标签 id', `${Math.round(marks[0].x)},${Math.round(marks[0].y)}/${marks[0].tagId}`.length > 6, true)
}
{
  // 命中判定：左上角小方区里算命中，节点中心不算
  const box = cy.$('#A1').renderedBoundingBox({ includeLabels: false, includeOverlays: false })
  const onDot = renderer.tagDotAt({ x: box.x1 + 5, y: box.y1 + 5 })
  const onCenter = renderer.tagDotAt({ x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 })
  styleCheck('点左上角红点命中该标签', onDot ? `${onDot.nodeId}/${onDot.tagId}` : 'null', 'A1/tag:demo')
  styleCheck('点节点中心不命中红点', onCenter, null)
}
renderer.setActiveTags([])
styleCheck('取消勾选后红点熄灭', cy.$('node.tagged').length, 0)

/* 有子图的模块：呼吸光晕 + 粒子浮层的数据来源（装饰框与叶子都不算） */
{
  const marks = renderer.subgraphMarks()
  styleCheck('有子图的模块才给呼吸/粒子浮层', marks.map((mark) => mark.nodeId).sort().join(','), 'A1')
  // 无头环境里 renderedBoundingBox 退化为 0 尺寸，所以只断言坐标是有限数（尺寸由真实渲染决定）
  styleCheck(
    '浮层带可用渲染坐标',
    Boolean(marks[0]) && [marks[0].x, marks[0].y, marks[0].w, marks[0].h].every((value) => Number.isFinite(value)),
    true,
  )
}

styleCheck('模块带「可进入」标记（.branch）', cy.$('#A1').hasClass('branch'), true)
styleCheck('模块徽标计数只算直系子节点', cy.$('#A1').data('branchLabel'), 'A 里的过程 1 · 1')
styleCheck('装饰容器不带模块标记', cy.$('#A').hasClass('branch'), false)
styleCheck('模块的子节点不挂 compound（不与父同屏）', cy.$('#A1a').parent().length, 0)
styleCheck('装饰框的子节点挂 compound（画在框里）', cy.$('#A2').parent().id(), 'A')

/**
 * 关掉过渡再读样式。
 * 样式表里的 `transition-*` 在浏览器里由渲染帧驱动，而无头模式没有帧循环——
 * 过渡会停在起点（读到 0.000001 这种插值垃圾），让断言变成噪声。
 * 这里追加一条 duration=0 的规则，读到的就是最终值。
 */
cy.style().append([
  { selector: 'node', style: { 'transition-duration': '0ms' } },
  { selector: 'edge', style: { 'transition-duration': '0ms' } },
])
/**
 * 无头画布没有尺寸：`fit()` 只能退到 `cy.fit()`，把 zoom 压成 1e-50，
 * 于是 LOD 判定「缩得太小」给所有非容器节点挂上 `label-off`（text-opacity 0），
 * 后面读文字透明度就会读到 0。这里先把 zoom 拨回 1 并重算标签，再做样式断言。
 */
cy.zoom(1)
renderer.refreshLabels()

console.log('=== 样式语义（styleEnabled 下可读计算样式）===')
const styleOf = (sel, prop) => cy.$(sel).style(prop)
const nodeWidth = (sel) => cy.$(sel).numericStyle('width')
styleCheck('大框是实线带（不是虚线）', styleOf('#A', 'border-style'), 'solid')
styleCheck('条件节点是虚线框', styleOf('#A2', 'border-style'), 'dashed')
styleCheck('条件边是虚线', styleOf('#e2', 'line-style'), 'dashed')
styleCheck('大框标题贴左上', styleOf('#A', 'text-valign'), 'top')
/** 尺寸比例：短名字窄框、长名字宽框并折行加高，全部落在给定区间内 */
const boxWidth = (sel) => cy.$(sel).numericStyle('width')
const boxHeight = (sel) => cy.$(sel).numericStyle('height')
const widthOf = (sel) => Number(boxWidth(sel))
styleCheck('框宽随名字变长而变大', widthOf('#A3') > widthOf('#A1'), true)
styleCheck('长名字折行后更高', boxHeight('#A3') > boxHeight('#A1'), true)
// 下限与 labels.ts 的 BOX_MIN_WIDTH（116）同源：短名字收窄但不低于它
styleCheck('短名字不低于下限（116）', widthOf('#A1') >= 116, true)
styleCheck('长名字不超过上限（240）', widthOf('#A3') <= 240, true)
// 悬浮放大按**该节点自己的**基准等比放大，而不是一个统一的固定尺寸（大框小框都要保持比例）
const baseW = Number(cy.$('#A3').data('boxW'))
const baseH = Number(cy.$('#A3').data('boxH'))
cy.$('#A3').addClass('hovered')
renderer.applyHoverSize(cy.$('#A3'))
styleCheck('悬浮宽度 = 自身基准 × 1.32', Number(boxWidth('#A3')), Math.round(baseW * 1.32))
styleCheck('悬浮高度 = 自身基准 × 1.32', Number(boxHeight('#A3')), Math.round(baseH * 1.32))
renderer.restoreBaseSize(cy.$('#A3'))
cy.$('#A3').removeClass('hovered')
styleCheck('移开指针后回到基准尺寸', Number(boxWidth('#A3')), baseW)

/**
 * 悬停归谁：**模块有、容器没有**。
 *
 * 层带 / S09 框 / E lane 是大片背景，悬停时改颜色、还把其它元素一起弱化（邻居高亮），
 * 既难看又没信息量；而模块与关系要有放大突出效果。这两条把渲染器侧的判断钉死。
 */
renderer.setHoveredId('A1')
styleCheck('模块进入悬停态（放大突出）', cy.$('#A1').hasClass('hovered'), true)
renderer.setHoveredId('A')
styleCheck('容器不进入悬停态（无特效）', cy.$('#A').hasClass('hovered'), false)
styleCheck('容器悬停不写悬停 id', renderer.hoveredId, null)

/**
 * 悬停的读法：**一个模块 + 它的连接关系跳出来，其余模块连文字一起虚化**。
 * 指针指着谁，谁就该最好读——所以虚化档必须压文字（只压填充会留下一屏黑字）。
 */
renderer.setHoveredId('A1')
renderer.setFocus('A1')
styleCheck('未相连的模块进虚化档', cy.$('#L').hasClass('dimmed'), true)
styleCheck('虚化的模块连文字一起淡出', styleOf('#L', 'text-opacity'), 0.22)
styleCheck('悬停模块抬到最高层（跳出）', styleOf('#A1', 'z-index'), 60)
// 边宽是带单位的字符串（"2.6px"），要用 numericStyle 读
styleCheck('悬停模块的关系一起放大', Number(cy.$('#e1').numericStyle('width')), 2.6)
styleCheck('关系名字号 12（产物名要看得清）', Number(cy.$('#e1').numericStyle('font-size')), 12)
styleCheck('关系名一律水平（与线的朝向无关）', styleOf('#e1', 'text-rotation'), 'none')
renderer.setFocus(null)
renderer.clearHover()
styleCheck('端口 e 吸到右边中点', styleOf('#e1', 'source-endpoint'), '100% 50%')
styleCheck('端口 w 吸到左边中点', styleOf('#e1', 'target-endpoint'), '0% 50%')
styleCheck('未指定端口时自动吸到最近的边', styleOf('#e2', 'target-endpoint'), 'outside-to-node')
styleCheck('端口属性选择器命中正确', cy.$('edge[sourcePort = "e"]').map((e) => e.id()).join(','), 'e1')
/**
 * 箭头形态：直线（不是贝塞尔弧），端点只露在方框之外。
 *
 * 读法契约 = 「取两个方框中心的连线，只画框外那一段」：弧线会让方向和落点不可预期，
 * 一屏十几条弧就是一团乱麻。这三条断言把「直线 + outside-to-node + edge-distances: intersection」
 * 钉死，谁改回曲线这里就报警。
 */
styleCheck('边是直线（中心连线，不是弧）', styleOf('#e1', 'curve-style'), 'straight')
styleCheck('端点按方框边界求交（只露框外）', styleOf('#e2', 'source-endpoint'), 'outside-to-node')
styleCheck('端点距离按边界交点量', styleOf('#e2', 'edge-distances'), 'intersection')
/**
 * 关系名按需出现：默认**不显示**（画布先干净），三种时机才露出来——
 * 指针停在节点上（相邻的边一起显示）、指针停在某条线上（只显示那一条）、选中某条线（一直显示）。
 * 这三条各是一个断言，任何一个被改掉都会在这里报警。
 */
/** 加类后要等过渡（180ms）跑完再读，否则拿到的是插值中的中间值 */
const settle = () => new Promise((r) => setTimeout(r, 240))

styleCheck('关系标签默认不显示（画布先干净）', styleOf('#e1', 'text-opacity'), 0)
cy.$('#e1').addClass('hovered')
await settle()
styleCheck('直接悬浮某条线 → 显示它的关系名', styleOf('#e1', 'text-opacity'), 1)
cy.$('#e1').removeClass('hovered')
cy.$('#e1').addClass('highlighted')
await settle()
styleCheck('悬浮节点 → 相邻的边一起显示关系名', styleOf('#e1', 'text-opacity'), 1)
cy.$('#e1').removeClass('highlighted')
await settle()
cy.$('#e2').addClass('dimmed')
// 虚化的关系：线淡下去、标签也淡到几乎看不见（打开「常显边标签」时同样退到背景）
styleCheck('被弱化的边标签也淡下去（不抢注意力）', styleOf('#e2', 'text-opacity'), 0.15)
cy.$('#e2').removeClass('dimmed')

/* ---------------- 分层对齐：重心法要把交叉拉直 ---------------- */
{
  const { runOrderedLayout } = await load('src/graph/ordered.ts', 'ordered')
  const crossRenderer = new GraphRenderer(handlers)
  const crossCore = cytoscape({ headless: true, styleEnabled: true, style: buildStylesheet(), elements: [] })
  crossRenderer.cy = crossCore
  crossRenderer.layoutKind = 'manual'
  /** 两行各两个节点，连线故意交叉：上排 P1→下排 Q2、上排 P2→下排 Q1 */
  const crossGraph = {
    meta: { version: 1, name: '交叉自检', description: '', topics: [], tags: [], updatedAt: '' },
    nodes: [
      g('P1', '上排 1', { position: { x: 0, y: 0 } }),
      g('P2', '上排 2', { position: { x: 200, y: 0 } }),
      g('Q1', '下排 1', { position: { x: 0, y: 200 } }),
      g('Q2', '下排 2', { position: { x: 200, y: 200 } }),
    ],
    edges: [
      { id: 'c1', source: 'P1', target: 'Q2', label: '', type: 'derives_from', directed: true, note: '', sourcePort: null, targetPort: null, conditional: false, createdAt: '', updatedAt: '' },
      { id: 'c2', source: 'P2', target: 'Q1', label: '', type: 'derives_from', directed: true, note: '', sourcePort: null, targetPort: null, conditional: false, createdAt: '', updatedAt: '' },
    ],
  }
  crossRenderer.sync(crossGraph)
  await new Promise((r) => setTimeout(r, 40))
  const crossedBefore =
    (crossCore.$id('P1').position().x - crossCore.$id('P2').position().x) *
      (crossCore.$id('Q2').position().x - crossCore.$id('Q1').position().x) <
    0
  runOrderedLayout(crossCore)
  const core = crossCore
  const crossedAfter =
    (core.$id('P1').position().x - core.$id('P2').position().x) *
      (core.$id('Q2').position().x - core.$id('Q1').position().x) <
    0
  styleCheck('分层对齐前：两条连线是交叉的（构造前提）', crossedBefore, true)
  styleCheck('分层对齐后：交叉被拉直', crossedAfter, false)
  styleCheck('分层对齐后：同一行 y 完全一致', core.$id('P1').position().y === core.$id('P2').position().y, true)
  /**
   * 不重叠：现在**不再用等宽列**（每块按自己的宽度排，这才有「不规则但不乱」），
   * 所以断言从「列距一致」改成「相邻间距不小于 GAP」——这才是真正要守的线。
   */
  const boxWidthOf = (id) => Number(core.$id(id).data('boxW')) || 116
  const gapOf = (a, b) =>
    Math.abs(core.$id(a).position().x - core.$id(b).position().x) - (boxWidthOf(a) + boxWidthOf(b)) / 2
  styleCheck('分层对齐后：同行相邻不重叠（间距 ≥ 24）', gapOf('P1', 'P2') >= 23.5, true)
  styleCheck('分层对齐后：上下两行也不重叠', Math.abs(core.$id('P1').position().y - core.$id('Q1').position().y) >= 38, true)
}

/**
 * 真实数据：初始条件（S09）按产物链分的五块。
 *
 * 这里断言的是**这条结构口径本身**：进 `compute_initial_conditions` 的子图，顶层应当恰好是五个框
 * （前置 / 密度链 / 速度链 / vcb 链 / 产物与收尾），每个框里恰好是它在 `scripts/lib/ic-chains.mjs`
 * 里声明的成员——不多不少；被两条链共用的抽样与共轭各自在自己的框里出现一份（同名，靠容器区分）。
 * 早先这一层是一个大框（13 个步骤平铺），后来是三块（四个尾段与共用前缀挤在一块的「核心计算」，
 * 于是实空间化挂了 4 条出边）；现在按产物链拆开。
 */
{
  const { IC_BLOCKS, IC_BLOCK_IDS, IC_CHAIN_EDGES, IC_DUPLICATES, ICS, LEGACY_IC_FRAME } = await import(
    `file://${path.join(root, 'scripts', 'lib', 'ic-chains.mjs')}`
  )
  const raw = JSON.parse(await fs.readFile(path.join(root, 'data', 'graph.json'), 'utf8'))
  const icRenderer = new GraphRenderer(handlers, { focusId: ICS })
  icRenderer.cy = cytoscape({ headless: true, styleEnabled: true, style: buildStylesheet(), elements: [] })
  const icCy = icRenderer.cy
  icRenderer.layoutKind = 'manual'
  icRenderer.sync(raw)
  await new Promise((r) => setTimeout(r, 60))

  const visibleNodes = icCy.nodes().filter((node) => node.visible())
  const frames = visibleNodes
    .filter((node) => node.isParent())
    .map((node) => node.id())
    .sort()
  const steps = visibleNodes.filter((node) => !node.isParent()).map((node) => node.id())
  styleCheck('初始条件子图顶层恰为五块框', frames.join(','), [...IC_BLOCK_IDS].sort().join(','))
  styleCheck(
    '五块框内共 17 个步骤（含 4 份重复）',
    steps.length,
    IC_BLOCKS.reduce((sum, block) => sum + block.members.length, 0),
  )
  IC_BLOCKS.forEach((block) => {
    const inner = visibleNodes
      .filter((node) => node.parent().id() === block.id)
      .map((node) => node.id())
      .sort()
    styleCheck(`「${block.label}」的成员与声明一致`, inner.join(','), [...block.members].sort().join(','))
  })
  styleCheck('旧的 S09 大框已不存在', raw.nodes.some((node) => node.id === LEGACY_IC_FRAME), false)
  styleCheck(
    '没有节点还挂在旧大框上',
    raw.nodes.filter((node) => node.parent === LEGACY_IC_FRAME).length,
    0,
  )
  styleCheck('旧的「核心计算」容器已不存在', raw.nodes.some((node) => node.id === 'ic:g-core'), false)
  styleCheck(
    '模块直接子节点 = 五块',
    raw.nodes.filter((node) => node.parent === ICS).length,
    IC_BLOCKS.length,
  )
  const memberOf = new Map(IC_BLOCKS.flatMap((block) => block.members.map((id) => [id, block.id])))
  const icIds = raw.nodes.filter((node) => node.id.startsWith('ic:') && node.type !== 'group').map((node) => node.id)
  const unassigned = icIds.filter((id) => !memberOf.has(id))
  const missing = [...memberOf.keys()].filter((id) => !icIds.includes(id))
  styleCheck('图上的 ic:* 与五块成员表一一对应', `${unassigned.length}/${missing.length}`, '0/0')
  styleCheck(
    '每个 ic:* 的 parent 就是它所属的块',
    raw.nodes.filter((node) => memberOf.has(node.id) && node.parent !== memberOf.get(node.id)).length,
    0,
  )

  // 重复份：标签与原份逐字一致，且各自落在自己那条链的框里
  const labelOf = new Map(raw.nodes.map((node) => [node.id, node.label]))
  const mismatched = [...IC_DUPLICATES].filter(([dupId, sourceId]) => {
    const dup = raw.nodes.find((node) => node.id === dupId)
    const source = raw.nodes.find((node) => node.id === sourceId)
    return !dup || !source || dup.label !== source.label || dup.parent === source.parent
  })
  styleCheck('4 份重复的标签与原份逐字一致且不同框', mismatched.length, 0)
  styleCheck(
    '抽样与共轭各有 3 份（密度链 + 速度链 + vcb 链）',
    raw.nodes.filter((node) => labelOf.get(node.id) === labelOf.get('ic:proc-sample')).length,
    3,
  )

  // 关系：与链定义里的计划逐条一致（产物写在边标签上）
  const icEdge = (edge) => edge.source.startsWith('ic:') && edge.target.startsWith('ic:')
  const key = (edge) => `${edge.source} -> ${edge.target} [${edge.label}]`
  const rawEdges = new Set(raw.edges.filter(icEdge).map(key))
  const planEdges = new Set(IC_CHAIN_EDGES.map(key))
  styleCheck(
    'IC 内部关系与链定义的计划一致（少/多）',
    `${[...planEdges].filter((item) => !rawEdges.has(item)).length}/${[...rawEdges].filter((item) => !planEdges.has(item)).length}`,
    '0/0',
  )
  const outDegree = new Map()
  for (const edge of raw.edges) {
    if (edge.source.startsWith('ic:')) outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1)
  }
  // 实空间化的出边只剩"交付下游"与"报账给收尾"两条：四条分支已经拆到各自的链里
  styleCheck('实空间化不再当枢纽（只剩 2 条出边）', outDegree.get('ic:proc-realize'), 2)
  styleCheck(
    '除前置外没有节点挂 3 条以上出边',
    [...outDegree].filter(([id, degree]) => degree > 2 && id !== 'ic:proc-seed' && id !== 'ic:proc-ps').length,
    0,
  )

  // 五个框互不重叠（模型包围盒两两不相交）
  const boxes = IC_BLOCK_IDS.map((id) => {
    const node = icCy.getElementById(id)
    return { id, box: node.boundingBox({ includeLabels: true, includeOverlays: false }) }
  })
  const overlapping = []
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i].box
      const b = boxes[j].box
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) {
        overlapping.push(`${boxes[i].id}×${boxes[j].id}`)
      }
    }
  }
  styleCheck('五个框互不重叠', overlapping.join(',') || 'none', 'none')

  /* -------- 真实数据：标签（命名口径 + 类别配色） -------- */
  const { TAG_GROUP_COLORS, TAG_GROUP_FALLBACK_COLOR, TAG_DOT_COLOR } = await load(
    'src/graph/palette.ts',
    'palette',
  )
  const tags = raw.meta?.tags ?? []
  styleCheck('标签注册表非空', tags.length > 0, true)
  /**
   * 「被管的标签」= `group` 在配色表里的那些（即 `scan-param-tags.mjs` 扫出来的参数标签）：
   * 它们的 `color` 必须**严格等于**表值，名字里必须没有中文（命名口径是"一律用原变量名"）。
   * 其余标签（用户自建的）不归 seed 脚本管，只要求"要么没色、要么等于未分类兜底色"。
   * 想单独给某个**被管**的标签调色，得先把它从这条口径里排除（改 group 或改表），别让断言空转。
   */
  const tagProblems = []
  tags.forEach((tag) => {
    const group = String(tag.group ?? '').trim()
    const managed = Boolean(group) && Boolean(TAG_GROUP_COLORS[group])
    if (managed) {
      if (tag.color !== TAG_GROUP_COLORS[group]) tagProblems.push(`${tag.id} 的 color 与 ${group} 的表值不一致`)
      if (/[\u3000-\u9fff]/.test(tag.name)) tagProblems.push(`${tag.id} 的名字里还有中文：${tag.name}`)
      return
    }
    if (tag.color !== undefined && tag.color !== TAG_GROUP_FALLBACK_COLOR) {
      tagProblems.push(`${tag.id} 不在配色表里，却带了非兜底色 ${tag.color}`)
    }
  })
  styleCheck('标签的类别配色与表一致（被管的严格相等）', tagProblems.join(' / ') || 'none', 'none')
  styleCheck('tag:BOX_LEN 的名字已改回原变量名', tags.find((tag) => tag.id === 'tag:BOX_LEN')?.name, 'BOX_LEN')
  styleCheck('画布红点未被改成类别色', TAG_DOT_COLOR, '#E11D48')
}

// 清理打包产物
await fs.rm(path.join(root, 'data', '.check-setup.mjs'), { force: true })
await fs.rm(path.join(root, 'data', '.check-styles.mjs'), { force: true })
await fs.rm(path.join(root, 'data', '.check-ordered.mjs'), { force: true })
await fs.rm(path.join(root, 'data', '.check-palette.mjs'), { force: true })

/**
 * 关掉 esbuild 的常驻服务。
 *
 * 不加这一句：`esbuild.build()` 拉起的那支服务进程会一直挂着，Node 的事件循环也就退不出来
 * ——脚本跑完不返回（`npm run check:canvas` 看着像卡死），而且每跑一次就多留一个孤儿服务
 * 进程。以前只能靠外层 `timeout` 兜着，于是每次都白等满整个超时（实测这里是回归里最慢的一环）。
 */
await esbuild.stop()

if (failed) {
  console.error(`\n✗ ${failed} 项不符合预期`)
  process.exit(1)
}
console.log('\n✓ 全部符合预期')

/**
 * 显式收工。
 *
 * 断言全部跑完之后进程**仍然不自行退出**：上面那套 rAF 替身（`setTimeout`）会被渲染器的
 * 标签合帧 / 浮层继续排下去，事件循环里始终有活，`node` 于是一直挂着 —— 外层没有 `timeout`
 * 时表现为"命令一个多小时不返回"，有 `timeout` 时表现为每次都白等满整个超时。
 * 结论已经打出来了（失败已在上面 `exit(1)`），这里直接退出：退出码 0 = 全绿。
 */
process.exit(0)
