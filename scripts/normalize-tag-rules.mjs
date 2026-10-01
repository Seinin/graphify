/**
 * 让图谱满足两条硬规则（**直接改 data/graph.json**，不走 API）：
 *
 *   1. **每个标签都必须有对应文档**：没有的按需新建一篇说明文件（空的也算），并写进 `docId`；
 *   2. **标签只长在叶子上**：有子节点的模块不自己挂标签（它的标签是子图标签的并集，前端派生展示），
 *      所以要把父模块上的 tags / tagDetails 摘掉。
 *
 * 为什么直接改文件而不是走 API：这两条规则是在 schema 里强制的，而旧的服务进程还跑着旧 schema——
 * 走 API 会被它把新字段（docId）剥掉；重启服务又会先读到不合规的数据（校验失败 → 回退空图）。
 * 所以顺序是：**先改文件 → 再重启服务**。
 *
 * 写文件前把当前版本复制到 data/history/（与 API 写入的快照同目录），可回滚。
 *
 * 用法：node scripts/normalize-tag-rules.mjs [--dry-run]
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const GRAPH_FILE = path.join(ROOT, 'data', 'graph.json')
const HISTORY_DIR = path.join(ROOT, 'data', 'history')
const NOTES_DIR = path.join(ROOT, '..', 'docs', 'notes')
const DRY_RUN = process.argv.includes('--dry-run')

/** 已经存在的文档：能对上的标签直接绑过去，而不是新建空壳 */
const EXISTING_DOCS = {
  'tag:X_RAY_SPEC_INDEX': 'XRAY_physics_manual.md',
  'tag:NU_X_THRESH': 'XRAY_physics_manual.md',
  'tag:L_X': 'XRAY_physics_manual.md',
  'tag:L_X_MINI': 'XRAY_physics_manual.md',
  'tag:X_RAY_TEMP': 'XRAY_physics_manual.md',
  'tag:HII_EFF_FACTOR': 'THREE_PIPELINES.md',
  'tag:F_STAR10': 'THREE_PIPELINES.md',
  'tag:F_ESC10': 'THREE_PIPELINES.md',
  'tag:M_TURN': 'THREE_PIPELINES.md',
  'tag:SOURCE_MODEL': 'THREE_PIPELINES.md',
  'tag:BOX_LEN': 'INITIAL_CONDITIONS.md',
  'tag:DIM': 'INITIAL_CONDITIONS.md',
  'tag:HII_DIM': 'INITIAL_CONDITIONS.md',
  'tag:HIRES_TO_LOWRES_FACTOR': 'INITIAL_CONDITIONS.md',
  'tag:PERTURB_ALGORITHM': 'INITIAL_CONDITIONS.md',
}

/** 标签名 → 文档文件名（放在 docs/notes/tags/ 下） */
function docFileNameOf(tag) {
  const base = String(tag.id).replace(/^tag:/, '').replace(/[\s/\\:*?"<>|]+/g, '_')
  return path.posix.join('tags', `${base || 'tag'}.md`)
}

function stubBody(tag) {
  return `# ${tag.name}

> 标签 \`${tag.id}\`　分类 \`${tag.group || '未分类'}\`　（由 \`scripts/normalize-tag-rules.mjs\` 自动建立）

这个标签还没有正文。规则是「**每个标签都必须有对应文档**」，所以先建了这篇空壳——
补内容时直接往下写：这个标签代表什么、在 21cmFAST 里对应哪段物理/代码、有哪些注意事项。
`
}

const graph = JSON.parse(await fs.readFile(GRAPH_FILE, 'utf8'))
const tags = graph.meta.tags ?? []
const parents = new Set(graph.nodes.map((node) => node.parent).filter(Boolean))

/* ---------- 1. 每个标签绑一篇文档 ---------- */
const createdDocs = []
const boundExisting = []
for (const tag of tags) {
  if (String(tag.docId || '').trim()) continue
  const existing = EXISTING_DOCS[tag.id]
  if (existing) {
    tag.docId = existing
    boundExisting.push(`${tag.name} → ${existing}`)
    continue
  }
  const docId = docFileNameOf(tag)
  const absolute = path.join(NOTES_DIR, docId)
  try {
    await fs.access(absolute)
  } catch {
    if (!DRY_RUN) {
      await fs.mkdir(path.dirname(absolute), { recursive: true })
      await fs.writeFile(absolute, stubBody(tag), 'utf8')
    }
    createdDocs.push(docId)
  }
  tag.docId = docId
}

/* ---------- 2. 标签只长在叶子上 ---------- */
const stripped = []
for (const node of graph.nodes) {
  if (!parents.has(node.id)) continue
  const tagCount = (node.tags ?? []).length
  const detailCount = Object.keys(node.tagDetails ?? {}).length
  if (!tagCount && !detailCount) continue
  stripped.push(`${node.label}（摘掉 ${tagCount} 个标签 / ${detailCount} 组明细）`)
  node.tags = []
  node.tagDetails = {}
}

console.log(`标签 ${tags.length} 个：新绑到既有文档 ${boundExisting.length} 个，新建空壳 ${createdDocs.length} 篇`)
boundExisting.slice(0, 6).forEach((line) => console.log(`  · ${line}`))
createdDocs.slice(0, 8).forEach((line) => console.log(`  + docs/notes/${line}`))
if (createdDocs.length > 8) console.log(`  …… 其余 ${createdDocs.length - 8} 篇同理`)
console.log(`\n父模块摘标签：${stripped.length} 个`)
stripped.slice(0, 10).forEach((line) => console.log(`  · ${line}`))

if (DRY_RUN) {
  console.log('\n（dry-run：没有写盘、也没有建文档）')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
await fs.mkdir(HISTORY_DIR, { recursive: true })
const backup = path.join(HISTORY_DIR, `graph-${stamp}.json`)
await fs.copyFile(GRAPH_FILE, backup)
await fs.writeFile(GRAPH_FILE, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
console.log(`\n已写入 data/graph.json（改前快照：${path.relative(ROOT, backup)}）`)
