/**
 * 标签编辑自检（**只读**，不修改任何文件）。
 *
 * 为什么需要它：标签的增删入口曾经在属性面板里**长了两处**（顶部一排带 × 的胶囊 +
 * 下方明细区块），而且"谁可以增删"这件事没有任何断言——父模块自己挂上标签也无人察觉。
 * 这里把 `graphify-tag-edit-leaf-only` 的契约钉死：
 *
 *   1. **身份**（`src/lib/tagEdit.ts` 的 `canEditNodeTags`，纯函数，判据只此一份）：
 *      叶子模块可增删；有子图的模块 / 容器只读——判据是"有没有子图"，**不是**"有没有标签"
 *      （有子图的节点恰恰有标签：子树叶子的并集）；
 *   2. **真数据**：拿仓库里真实的 `data/graph.json` 与 `src/generated/physics-chain.json`
 *      数一遍"可编叶子 / 只读模块 / 容器"，两者都非零——判据写反或永远 false 会在这里被抓住；
 *   3. **只有一处**：`components/Inspector.tsx` 里不得再引用被删掉的 `NodeTagEditor`，
 *      标签区块 `<NodeTagSection` 恰好出现一次（防止第二处实现再长回来）；
 *   4. **并集**（`inheritedTagsOf`）：画布真数据里"有子方"的并集**独立重算**一遍比对；
 *      子树叶子删光 → 空；调用不写回节点数据。
 *
 * 用法：`npm run check:tags`（失败时退出码 1）
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

/** 把 TS 模块打包到 `data/`（已被 git 忽略）再按 ESM 导入：`data:` URL 解析不了裸模块名 */
async function load(entry, name) {
  const outfile = path.join(ROOT, 'data', `.check-tags-${name}.mjs`)
  await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    format: 'esm',
    outfile,
    platform: 'node',
    logLevel: 'silent',
  })
  return import(`file://${outfile}`)
}

const failures = []
let checks = 0

function ok(condition, label, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ✓ ${label}`)
    return true
  }
  const line = `${label}${detail ? ` — ${detail}` : ''}`
  failures.push(line)
  console.log(`  ✗ ${line}`)
  return false
}

const { canEditNodeTags, inheritedTagsOf, tagDisplayOf } = await load('src/lib/tagEdit.ts', 'tagEdit')

/**
 * 真数据：`data/graph.json`（画布）。`data/` 被 git 忽略，缺文件时**不假装通过**——
 * 由调用处显式报一条"跳过"，免得把"没数据"读成"全对"。
 */
async function readJson(rel) {
  try {
    return JSON.parse(await readFile(path.join(ROOT, rel), 'utf8'))
  } catch {
    return null
  }
}

/** 造一个最小可用节点；只填判据看得见的字段 */
const node = (over) => ({
  id: 'n1',
  label: 'n1',
  type: 'process',
  summary: '',
  tags: [],
  tagDetails: {},
  refs: [],
  topics: [],
  parent: null,
  position: null,
  createdAt: '',
  updatedAt: '',
  ...over,
})

console.log('')
console.log('1. 身份判据（canEditNodeTags）')
ok(canEditNodeTags(node(), 0) === true, '叶子模块（无子节点）可增删')
ok(canEditNodeTags(node({ type: 'param' }), 0) === true, '叶子参数节点可增删')
ok(canEditNodeTags(node(), 3) === false, '有子图的模块只读')
ok(
  canEditNodeTags(node({ tags: ['tag:h2', 'tag:ts'] }), 3) === false,
  '有子图且自己带着标签（并集）时仍然只读',
  '判据看"有没有子图"，不看"有没有标签"',
)
ok(canEditNodeTags(node({ type: 'group' }), 0) === false, '容器（大框）不可增删')
ok(canEditNodeTags(node({ type: 'group' }), 2) === false, '容器且有子节点不可增删')

console.log('')
console.log('3. 并集（inheritedTagsOf / tagDisplayOf）：删光即空、不落地、真数据对得上')

/** 造一个小树：`m` 下挂带标签的叶子 `a`；再挂个空大框 `g`（容器不算叶子） */
const m = node({ id: 'm', label: '模块', type: 'process' })
const a = node({
  id: 'a',
  label: '叶子参数',
  type: 'param',
  parent: 'm',
  tags: ['tag:h2'],
  tagDetails: { 'tag:h2': [{ label: 'hlittle', kind: 'assign', note: '起点', ref: null }] },
})
const g = node({ id: 'g', label: '空大框', type: 'group', parent: 'm' })

/*
 * 独立重算：脚本里**自己写一遍**递归（不 import 被测实现，否则同错同对、白测）。
 * 环上只走一次，防止数据脏了把自检本身挂死。
 */
function recomputeUnion(nodes, id) {
  const byId = new Map(nodes.map((item) => [item.id, item]))
  const out = []
  const seen = new Set()
  const walked = new Set()
  const visit = (nodeId) => {
    if (walked.has(nodeId)) return
    walked.add(nodeId)
    const kids = nodes.filter((item) => item.parent === nodeId && item.id !== nodeId)
    if (kids.length) {
      kids.forEach((kid) => visit(kid.id))
      return
    }
    const leaf = byId.get(nodeId)
    if (!leaf || leaf.type === 'group') return
    ;(leaf.tags ?? []).forEach((tagId) => {
      if (!seen.has(tagId)) {
        seen.add(tagId)
        out.push(tagId)
      }
    })
  }
  nodes.filter((item) => item.parent === id && item.id !== id).forEach((kid) => visit(kid.id))
  return out
}

ok(inheritedTagsOf([m, a], 'm').tags.join(',') === 'tag:h2', '父的并集认得子树叶子的标签')
// 跨层：m → mid → deep 仍要合并到 m 上；同一个标签挂在两个叶子上只算一条
const mid = node({ id: 'mid', label: '中层模块', type: 'process', parent: 'm' })
const deep = node({ id: 'd1', label: '深层叶子', type: 'param', parent: 'mid', tags: ['tag:h2'] })
ok(
  inheritedTagsOf([m, mid, deep, a], 'm').tags.join(',') === 'tag:h2',
  '跨层合并：非直系叶子也算进祖先的并集',
)
ok(
  inheritedTagsOf([m, mid, deep, a], 'm').tags.length === 1,
  '同一个标签挂在不同叶子上，并集里只算一条（去重）',
)
ok(
  inheritedTagsOf([m, a, g], 'm').tags.join(',') === 'tag:h2',
  '空大框不算叶子，不进并集',
  '容器不参与标签',
)
// 明细要能看出出处：并集里的条目得写明来自哪个叶子（否则会被读成"模块本身有这个参数"）
const merged = inheritedTagsOf([m, a], 'm').tagDetails['tag:h2'] ?? []
ok(
  merged.length === 1 && merged[0].note.includes('叶子参数'),
  '并集明细带着来源叶子名',
  JSON.stringify(merged),
)
ok(a.tagDetails['tag:h2'][0].note === '起点', '并集明细是新建对象，没改数据里那条')

// 删光即空：叶子从数据里拿掉之后，父必须回到空——不保留删之前那份、不缓存上一份
const emptied = inheritedTagsOf([m], 'm')
ok(
  emptied.tags.length === 0 && Object.keys(emptied.tagDetails).length === 0,
  '子树叶子删光 → 父显示为空',
  '既不留旧并集，也不缓存上一次结果',
)
ok(
  inheritedTagsOf([m, a], 'm').tags.join(',') === 'tag:h2',
  '叶子挂回来立刻又能算出来（证明没有"记住上一次"的缓存）',
)

// 口径统一：页面只从 tagDisplayOf 取，三种身份各一条
ok(tagDisplayOf([m, a], a).tags === a.tags, '叶子照读自己那份（可编的那份）')
ok(tagDisplayOf([m, a], m).tags.join(',') === 'tag:h2', '有子方的走并集（与面板/红点同一份）')
ok(tagDisplayOf(undefined, m).tags === m.tags, '没递节点表（物理链页）照读数据里那份')

// MUST NOT 写回：算并集是只读派生，跑完数据必须原样
{
  const snapshot = JSON.stringify([m, a, g])
  inheritedTagsOf([m, a, g], 'm')
  tagDisplayOf([m, a, g], m)
  ok(JSON.stringify([m, a, g]) === snapshot, '算并集 MUST NOT 写回节点数据（tags / tagDetails 原样）')
}

// 真数据：画布 `data/graph.json` 里每个"有子方"的并集，与独立重算逐一对上
{
  const canvas = await readJson('data/graph.json')
  if (!canvas?.nodes?.length) {
    ok(false, '读不到 data/graph.json（真数据未生成？）', '不跳过：缺真数据等于这条断言没跑')
  } else {
    const nodes = canvas.nodes
    const parents = nodes.filter((item) =>
      nodes.some((kid) => kid.parent === item.id && kid.id !== item.id),
    )
    const mismatches = parents.filter((item) => {
      const got = [...inheritedTagsOf(nodes, item.id).tags].sort().join(',')
      const want = [...recomputeUnion(nodes, item.id)].sort().join(',')
      return got !== want
    })
    ok(parents.length > 0, `真数据里确有「有子方」的节点（${parents.length} 个）`)
    ok(
      mismatches.length === 0,
      '每个「有子方」的并集都与独立重算一致',
      mismatches.map((item) => item.id).join(', '),
    )
    ok(
      parents.some((item) => inheritedTagsOf(nodes, item.id).tags.length > 0),
      '至少一个「有子方」的并集非空',
      '否则断言在真数据上是空转的',
    )
  }
}

console.log('')
console.log('4. 真数据计数 + 「只有一处」（防判据写反、防第二处实现长回来）')

/**
 * 三个计数：可编 / 只读 / 容器。**可编与只读这一刀必须由 `canEditNodeTags` 切**——
 * 这就是"判据写反会被真数据抓住"的着力点：恒 `true` 则只读为 0（红），恒 `false` 则可编为 0（红）。
 * 容器单列，是因为它压根不参与标签（连"只读"都不算它的身份），混进去会把两个数都搅浑。
 */
function census(nodes) {
  const childCount = (id) => nodes.filter((kid) => kid.parent === id && kid.id !== id).length
  const out = { total: nodes.length, editable: 0, readOnly: 0, group: 0 }
  nodes.forEach((item) => {
    if (item.type === 'group') out.group += 1
    else if (canEditNodeTags(item, childCount(item.id))) out.editable += 1
    else out.readOnly += 1
  })
  return out
}

for (const [label, rel, pick] of [
  ['画布 data/graph.json', 'data/graph.json', (json) => json.nodes],
  ['链页 src/generated/physics-chain.json', 'src/generated/physics-chain.json', (json) => json.graph?.nodes],
]) {
  const json = await readJson(rel)
  const nodes = json ? pick(json) : null
  if (!nodes?.length) {
    ok(false, `${label}：读不到真数据`, '不跳过：缺真数据等于这条断言没跑')
    continue
  }
  const counts = census(nodes)
  // 判据写反（恒 true / 恒 false）会在这两条上现形：两类都必须真实存在
  ok(counts.editable > 0, `${label}：可编叶子非零（${counts.editable} / ${counts.total}）`)
  ok(counts.readOnly > 0, `${label}：只读模块非零（${counts.readOnly}，容器 ${counts.group}）`)
}

// 只有一处：编辑入口与明细必须同住在唯一的那个区块里
{
  const source = await readFile(
    path.join(ROOT, 'src/components/Inspector.tsx'),
    'utf8',
  ).catch(() => null)
  if (source === null) {
    ok(false, '读不到 components/Inspector.tsx')
  } else {
    const sections = source.match(/<NodeTagSection/g) ?? []
    ok(!/NodeTagEditor/.test(source), 'Inspector 里不再引用被删掉的 NodeTagEditor')
    ok(
      sections.length === 1,
      `标签区块 <NodeTagSection 恰好出现一次（实测 ${sections.length}）`,
      '再多一处就是又长回第二个编辑入口',
    )
  }
}

console.log('')
console.log(`自检${failures.length ? '失败' : '通过'}：${checks - failures.length} / ${checks} 项`)
if (failures.length) {
  for (const line of failures) console.error(`  · ${line}`)
  process.exit(1)
}
