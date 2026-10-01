/**
 * 标签页模型自检：把「逐模块进入」这套交互里**能在 Node 下断言**的部分固化下来
 * 。检查的事：
 *
 *   1. 标签页状态机（`src/state/graphStore.ts`）：进入的幂等、激活页切换、选中态按页隔离、
 *      关闭激活页后激活左邻页、**关闭时清掉该页的选中态 stash**（曾经被 activateTab 撤销，
 *      导致重开同一模块会恢复关页前的陈旧选中态）、主图不可关闭；
 *   2. 可见集（`src/graph/hierarchy.ts`，纯函数）：主图 = 层带 + 内联后代，不含模块内部；
 *      装饰容器的子节点一律内联；各标签页可见集两两互斥；边只在两端同页时才画；
 *   3. 数据口径：`ic:art-*` 中间产物已解散成边、每条边都有 label、容器不作关系端点、无孤儿。
 *
 * 不进这里（需人眼或真浏览器）：实际像素观感、悬停/放大动效、URL 端到端还原。层级与状态机
 * 都是纯函数/纯状态机，直接拿仓库里的 `data/graph.json` 与内存 store 跑，不需要 DOM。
 *
 * 用法：`npm run check:tabs`（失败时退出码 1）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

/** 把 TS 模块打包到 data/（已被 git 忽略）再按 ESM 导入：`data:` URL 解析不了裸模块名。 */
async function load(entry, name) {
  const outfile = path.join(root, 'data', `.check-tabs-${name}.mjs`)
  await esbuild.build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'esm',
    outfile,
    platform: 'node',
    logLevel: 'silent',
  })
  return import(`file://${outfile}`)
}

let failed = 0
let checks = 0
const check = (label, actual, want) => {
  checks += 1
  const ok = String(actual) === String(want)
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(46)} 得到 ${JSON.stringify(actual)}${ok ? '' : ` 期望 ${JSON.stringify(want)}`}`)
  if (!ok) failed += 1
}

const { useGraphStore, MAIN_TAB } = await load('src/state/graphStore.ts', 'store')
const { buildHierarchy, tabVisibleIds } = await load('src/graph/hierarchy.ts', 'hierarchy')

const raw = JSON.parse(await fs.readFile(path.join(root, 'data', 'graph.json'), 'utf8'))
const nodes = raw.nodes
const edges = raw.edges
const byId = new Map(nodes.map((n) => [n.id, n]))
const kidsOf = (id) => nodes.filter((n) => n.parent === id).map((n) => n.id)
const typeOf = (id) => byId.get(id)?.type

const LANES = ['atlas:fig1:entry', 'atlas:fig1:orchestrate', 'atlas:fig1:prep', 'atlas:fig1:loop', 'atlas:fig1:out']
const S09 = 'atlas:fig1:prep:ics'
const ENTRY_B = 'atlas:fig1:orchestrate:b'

/* ============================ 1. 标签页状态机 ============================ */
console.log('\n标签页状态机（graphStore）')
const S = useGraphStore
const st = () => S.getState()
const reset = () =>
  S.setState({ tabs: [MAIN_TAB], activeTabId: 'main', selectionStash: {}, selection: { kind: null, id: null } })

reset()
st().openTab(S09, 'S09')
st().openTab(S09, 'S09')
check('重复进入同一模块不新开标签页', st().tabs.length, 2)
check('首次进入的模块页成为激活页', st().activeTabId, S09)

st().select('node', 'ic:g-load')
check('在模块页里选中一个节点', st().selection.id, 'ic:g-load')

st().openTab(ENTRY_B, '入口 B')
check('新进入的模块页成为激活页', st().activeTabId, ENTRY_B)
check('新页的选中态是干净的（不继承上一页）', st().selection.id, null)

st().activateTab(S09)
check('切回原页恢复它自己的选中态', st().selection.id, 'ic:g-load')
check('离开的页把自己的选中态存进 stash', st().selectionStash[ENTRY_B]?.id ?? 'none', 'none')

st().closeTab('main')
check('主图标签页不可关闭', st().tabs.some((t) => t.id === 'main'), true)

/* 回归：关闭激活页时，它的 stash 必须真的被清掉（曾被紧随的 activateTab 写回）。 */
st().activateTab(ENTRY_B)
st().closeTab(ENTRY_B)
check('关闭激活页后激活其左侧相邻页', st().activeTabId, S09)
check('关闭后该页的选中态 stash 已清除', ENTRY_B in st().selectionStash, false)
check('标签页列表里不再有该页', st().tabs.some((t) => t.id === ENTRY_B), false)

/* 可观后果：重开刚关掉的模块，选中态应是干净的，而不是关页前那一次的陈旧值。 */
st().activateTab(S09)
st().select('node', 'ic:g-out')
st().closeTab(S09)
st().openTab(S09, 'S09')
check('重开刚关掉的模块，选中态是干净的', st().selection.id, null)

/* 关闭非激活页：不动激活页，且照样清掉被关页的 stash。 */
reset()
st().openTab(S09, 'S09')
st().select('node', 'ic:g-dens')
st().openTab(ENTRY_B, '入口 B')
st().openTab(S09, 'S09') // 回到 S09（它是激活页）
check('切回后 S09 仍是激活页', st().activeTabId, S09)
st().closeTab(ENTRY_B)
check('关闭非激活页不影响当前激活页', st().activeTabId, S09)
check('关闭非激活页同样清掉它的 stash', ENTRY_B in st().selectionStash, false)
check('当前页的选中态仍在', st().selection.id, 'ic:g-dens')

/* ============================ 2. 可见集 ============================ */
console.log('\n标签页可见集（hierarchy 纯函数，真实数据）')
const hier = buildHierarchy(
  nodes.map((n) => ({ id: n.id, parent: n.parent ?? null, frame: n.type === 'group' })),
  null,
)
const ancestorsOf = (id) => {
  const chain = []
  let cur = hier.parentOf.get(id) ?? null
  while (cur) {
    chain.push(cur)
    cur = hier.parentOf.get(cur) ?? null
  }
  return chain
}
const inlineOk = (V) =>
  [...V].filter((id) => hier.frameIds.has(id)).every((id) => (hier.childrenOf.get(id) ?? []).every((c) => V.has(c)))

const roots = nodes.filter((n) => !n.parent).map((n) => n.id)
check('主图根层恰为五条层带', roots.length === 5 && LANES.every((id) => roots.includes(id)), true)
check('五条层带都是装饰容器', roots.every((id) => typeOf(id) === 'group'), true)
check('无「图一 / 图二」外层大框', !byId.has('atlas:fig1') && !byId.has('atlas:fig2'), true)

const enterable = nodes.filter((n) => kidsOf(n.id).length > 0 && n.type !== 'group').map((n) => n.id)
check('可进入模块恰 2 个（S09 与入口 B）', enterable.length === 2 && enterable.includes(S09) && enterable.includes(ENTRY_B), true)
const frames = nodes.filter((n) => n.type === 'group').map((n) => n.id)
check(
  '每个装饰容器要么是层带、要么挂在可进入模块下',
  frames.every((id) => roots.includes(id) || enterable.includes(byId.get(id).parent)),
  true,
)

const V0 = tabVisibleIds(hier, null)
const Vics = tabVisibleIds(hier, S09)
const Vb = tabVisibleIds(hier, ENTRY_B)
check('主图：可见装饰容器的子节点全部内联', inlineOk(V0), true)
check('主图只含层带与其内联内容', [...V0].every((id) => hier.roots.includes(id) || ancestorsOf(id).some((a) => LANES.includes(a))), true)
check('主图不显示模块内部', !V0.has('ic:g-load') && !V0.has('atlas:fig2:e1'), true)
check(
  'S09 标签页只含该框内内容、不含层带',
  [...Vics].every((id) => id === S09 || ancestorsOf(id).includes(S09)) && ![...Vics].some((id) => LANES.includes(id)),
  true,
)
check('模块页：可见装饰容器的子节点全部内联', inlineOk(Vics) && inlineOk(Vb), true)
const inter = (a, b) => [...a].filter((id) => b.has(id)).length
check('三个标签页可见集两两互斥', inter(V0, Vics) + inter(V0, Vb) + inter(Vics, Vb), 0)

const visEdges = (V) => edges.filter((e) => V.has(e.source) && V.has(e.target))
check('每个标签页都至少有一条自己的可见关系', visEdges(V0).length > 0 && visEdges(Vics).length > 0 && visEdges(Vb).length > 0, true)
const doubleDrawn = edges.filter(
  (e) => [V0, Vics, Vb].filter((V) => V.has(e.source) && V.has(e.target)).length > 1,
)
check('没有一条边同时画在两个标签页里', doubleDrawn.length, 0)

/* ============================ 3. 数据口径 ============================ */
console.log('\n数据口径')
const leftoverArt = nodes.filter((n) => n.id.startsWith('ic:art-') && n.id !== 'ic:art-inputs').map((n) => n.id)
check('ic:art-* 中间产物已全部解散成边', leftoverArt.length, 0)
check('每条关系都带 label', edges.filter((e) => !e.label || !String(e.label).trim()).length, 0)
check('没有任何关系以装饰容器为端点', edges.filter((e) => frames.includes(e.source) || frames.includes(e.target)).length, 0)
check('无孤儿节点（parent 都指向真实节点）', nodes.filter((n) => n.parent && !byId.has(n.parent)).length, 0)
check('S09 框下恰为五块产物链', kidsOf(S09).length === 5 && kidsOf(S09).every((id) => id.startsWith('ic:g-')), true)

/* ============================ 收尾 ============================ */
await fs.rm(path.join(root, 'data', '.check-tabs-store.mjs'), { force: true })
await fs.rm(path.join(root, 'data', '.check-tabs-hierarchy.mjs'), { force: true })
/** 不 stop：esbuild.build() 拉起的那支常驻服务会让事件循环退不出，脚本看着像卡死。 */
await esbuild.stop()

console.log(`\n共 ${checks} 条断言，${failed === 0 ? '全部符合预期' : `${failed} 项不符合预期`}`)
process.exit(failed === 0 ? 0 : 1)
