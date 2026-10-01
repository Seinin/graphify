/**
 * 图谱标注自检（**只读**，不修改任何文件）。
 *
 * 为什么需要它：这一类问题曾经悄无声息地发生——二阶修正（2LPT）只在特定参数下执行，
 * 却因为"可选性只写在源码注释里"而被画成必走步骤；历史自由标签（初始条件、2LPT、
 * C: rng.c…）也在无人察觉的情况下混进注册表、又与参数筛选混在一起。这里把契约钉死：
 *
 *   1. 可选性：生成器与 `ic-chains.mjs` 里声明的条件步骤 / 条件关系，数据里必须是 `conditional`，
 *      并且必须留下"**控制它的那个 flag**"的踪迹（节点挂该 flag 的参数标签、关系写 note）；
 *   2. 注册表政策：标签只服务**参数**——注册表里不得有无 `group` 的标签；每个标签都要有文档、
 *      id 不重复；标签只长在叶子上（父模块不挂标签，由子图并集派生）。
 *
 * 断言对象是 `data/graph.json` 与两份生成器源码（`build-initial-conditions-graph.mjs`、
 * `lib/ic-chains.mjs`）——与生成器同源，所以"源码改了数据没跟上"会立刻失败。
 *
 * 用法：`npm run check:graph`（失败时退出码 1）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
/** 可覆盖：便于拿"被篡改的副本"做负例自测，不必去动真实图谱 */
const GRAPH_FILE = process.env.GRAPHIFY_GRAPH_FILE || path.join(ROOT, 'data', 'graph.json')
const BUILDER_FILE = path.join(ROOT, 'scripts', 'build-initial-conditions-graph.mjs')
const CHAINS_FILE = path.join(ROOT, 'scripts', 'lib', 'ic-chains.mjs')

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

/** 节点标签在数据里存的是注册表 id（`tag:<名字>`） */
const tagIdOf = (name) => `tag:${name}`

/**
 * 读 `build-initial-conditions-graph.mjs` 的节点声明：`id` 行起一条记录，
 * 取紧随其后的 `tags: [...]` 与 `conditional: true`。与生成器同一份源码，避免手抄漂移。
 */
function readBuilderSpecs() {
  const lines = fs.readFileSync(BUILDER_FILE, 'utf8').split('\n')
  const specs = new Map()
  let current = null
  for (const line of lines) {
    const id = line.match(/^\s*id: '([^']+)',\s*$/)
    if (id) {
      current = { id: id[1], tags: null, conditional: false }
      specs.set(current.id, current)
      continue
    }
    if (!current) continue
    if (current.tags === null) {
      const tags = line.match(/^\s*tags: \[(.*)\],\s*$/)
      if (tags) {
        current.tags = tags[1]
          .split(',')
          .map((item) => item.trim().replace(/^'|'$/g, ''))
          .filter(Boolean)
      }
      continue
    }
    if (/^\s*conditional: true,\s*$/.test(line)) current.conditional = true
  }
  return specs
}

/** IC 关系计划里声明为条件的关系 id（`IC_CHAIN_EDGES` 的单行条目） */
function readConditionalEdgeIds() {
  return fs
    .readFileSync(CHAINS_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.includes('conditional: true'))
    .map((line) => line.match(/id: '([^']+)'/)?.at(1))
    .filter(Boolean)
}

/** `IC_CONDITIONAL_DUPLICATES`：哪些重复份自身属于可选支路 */
function readConditionalDuplicateIds() {
  const source = fs.readFileSync(CHAINS_FILE, 'utf8')
  const block = source.match(/IC_CONDITIONAL_DUPLICATES = new Set\(\[([\s\S]*?)\]\)/)
  if (!block) return []
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'))
const nodes = graph.nodes ?? []
const edges = graph.edges ?? []
const byId = new Map(nodes.map((node) => [node.id, node]))
const parents = new Set(nodes.map((node) => node.parent).filter(Boolean))
const registry = graph.meta?.tags ?? []
const icLeaves = nodes.filter((node) => String(node.id).startsWith('ic:') && !parents.has(node.id))

console.log('图谱标注自检')
console.log(`  节点 ${nodes.length} · 关系 ${edges.length} · 注册表 ${registry.length} · IC 叶子 ${icLeaves.length}\n`)

// ---- 1. 生成器声明的可选步骤（标签不在这里校验：标签只服务参数，见第 4 节的注册表政策） ----
const specs = readBuilderSpecs()
const specConditional = [...specs.values()].filter((spec) => spec.conditional).map((spec) => spec.id)

// ---- 2. 可选性（节点 + 关系） ----
const optionalNodeIds = [...new Set([...specConditional, ...readConditionalDuplicateIds()])]
const notConditional = optionalNodeIds.filter((id) => byId.get(id)?.conditional !== true)
ok(
  optionalNodeIds.length > 0 && notConditional.length === 0,
  '生成器声明的可选步骤在数据里都是 conditional（2LPT / vcb）',
  notConditional.join(', '),
)

const conditionalEdgeIds = readConditionalEdgeIds()
const edgeNotConditional = conditionalEdgeIds.filter((id) => edges.find((edge) => edge.id === id)?.conditional !== true)
ok(
  conditionalEdgeIds.length > 0 && edgeNotConditional.length === 0,
  '关系计划里声明的条件关系在数据里都是 conditional',
  edgeNotConditional.join(', '),
)

/**
 * 可选支路必须留下"**控制它的那个 flag**"的踪迹：节点上挂参数标签（带出处的那种），
 * 关系上写明由哪个 flag 控制。
 *
 * 口径来自使用者的提问："既然它是非必要的，就说明有一个 flag 控制它的流程"——
 * 只有虚线、说不清是谁控制的，等于没标。IC 链的两处对照是：
 * vcb 链 ⇐ `USE_RELATIVE_VELOCITIES`（MatterOptions，C: `InitialConditions.c:734`）；
 * 2LPT  ⇐ `PERTURB_ALGORITHM == "2LPT"`（C: `InitialConditions.c:751`）。
 */
const flagTagsOf = (node) =>
  Object.entries(node.tagDetails ?? {})
    .filter(([, list]) => list.some((item) => item.ref?.file))
    .map(([id]) => id)
const optionalIcNodes = icLeaves.filter((node) => node.conditional === true)
const withoutFlag = optionalIcNodes.filter((node) => flagTagsOf(node).length === 0)
ok(
  optionalIcNodes.length > 0 && withoutFlag.length === 0,
  '标了可选的 IC 节点都带「控制它的那个 flag」的参数标签',
  withoutFlag.map((node) => node.id).join(', '),
)

/**
 * 具体到**哪一个** flag —— 这条是使用者的口径："非必要 ⇒ 有一个 flag 控制它的流程"。
 * 只"有某个参数标签"不算数：必须挂着控制这一支的那个 flag，且它有出处（不是手填的）。
 * 依据（人读过代码后确认）：
 *   · 2LPT 支路 ⇐ `PERTURB_ALGORITHM`（C: InitialConditions.c:751；Python: outputs.py:563）
 *   · vcb 支路  ⇐ `USE_RELATIVE_VELOCITIES`（C: InitialConditions.c:734；Python: outputs.py:576）
 */
const OPTIONAL_BRANCH_FLAGS = {
  'ic:proc-2lpt-phi': 'PERTURB_ALGORITHM',
  'ic:proc-2lpt-v': 'PERTURB_ALGORITHM',
  'ic:vcb:proc-sample': 'USE_RELATIVE_VELOCITIES',
  'ic:vcb:proc-conj': 'USE_RELATIVE_VELOCITIES',
  'ic:proc-vcb': 'USE_RELATIVE_VELOCITIES',
}
const flagMismatch = Object.entries(OPTIONAL_BRANCH_FLAGS).filter(([id, flag]) => {
  const node = byId.get(id)
  if (!node) return true
  const tagId = tagIdOf(flag)
  return node.conditional !== true || !(node.tags ?? []).includes(tagId) || !flagTagsOf(node).includes(tagId)
})
ok(
  flagMismatch.length === 0,
  '可选支路的节点挂着控制它的那个 flag（2LPT ⇐ PERTURB_ALGORITHM；vcb ⇐ USE_RELATIVE_VELOCITIES）',
  flagMismatch.map(([id, flag]) => `${id} 缺 ${flag}`).join('；'),
)
const edgesWithoutNote = conditionalEdgeIds.filter(
  (id) => !String(edges.find((edge) => edge.id === id)?.note ?? '').trim(),
)
ok(
  conditionalEdgeIds.length > 0 && edgesWithoutNote.length === 0,
  '条件关系都写明了由哪个 flag 控制（note 非空）',
  edgesWithoutNote.join(', '),
)

// 2LPT 支路整体（节点 + 三条关系）——这是用户点名的那一处
const twoLptNodes = ['ic:proc-2lpt-phi', 'ic:proc-2lpt-v']
const twoLptEdges = edges.filter(
  (edge) => twoLptNodes.includes(edge.source) || twoLptNodes.includes(edge.target),
)
ok(twoLptNodes.every((id) => byId.get(id)?.conditional === true), '2LPT 两个步骤都是 conditional')
ok(
  twoLptEdges.length === 3 && twoLptEdges.every((edge) => edge.conditional === true),
  '2LPT 的三条关系都是 conditional',
  `${twoLptEdges.filter((edge) => edge.conditional).length}/${twoLptEdges.length}`,
)
// ---- 3. 参数标签真的由源码引用产出了 ----
const paramTagged = icLeaves.filter((node) =>
  (node.tags ?? []).some((id) => {
    const name = id.replace(/^tag:/, '')
    return id.startsWith('tag:') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && node.tagDetails?.[id]?.some((item) => item.ref?.file)
  }),
)
ok(paramTagged.length > 0, 'IC 链至少有一个节点带「由源码引用扫出」的参数标签', `${paramTagged.length} 个节点`)

// ---- 4. 注册表与 schema 的两条硬规则 ----
const withoutDoc = registry.filter((tag) => !String(tag.docId || '').trim())
ok(withoutDoc.length === 0, '每个标签都有对应文档（docId 非空）', withoutDoc.map((tag) => tag.name).join('、'))
ok(new Set(registry.map((tag) => tag.id)).size === registry.length, '注册表 id 不重复')
/**
 * 政策门：标签只服务**参数**——注册表里只允许有带 `group` 的参数标签。
 * 历史自由标签（初始条件、2LPT、C: rng.c…）已由 `scripts/prune-tags.mjs` 清掉，
 * 这条断言保证它们不会再被任何草稿/构建带回来。
 */
const ungrouped = registry.filter((tag) => !String(tag.group ?? '').trim())
ok(ungrouped.length === 0, '注册表里没有无 group 的自由标签（标签只服务参数）', ungrouped.map((tag) => tag.name).join('、'))
const parentTagged = nodes.filter((node) => parents.has(node.id) && (node.tags ?? []).length)
ok(parentTagged.length === 0, '父模块节点自身不带标签（标签只长在叶子上）', parentTagged.map((node) => node.id).join(', '))
const duplicateTags = nodes.filter((node) => new Set(node.tags ?? []).size !== (node.tags ?? []).length)
ok(duplicateTags.length === 0, '没有节点的标签列表重复（重复导入幂等）', duplicateTags.map((node) => node.id).join(', '))

console.log('')
if (failures.length) {
  console.error(`✗ 图谱标注自检失败：${failures.length} / ${checks} 项`)
  for (const line of failures) console.error(`  · ${line}`)
  process.exit(1)
}
console.log(`✓ 图谱标注自检通过（${checks} 项断言）`)
