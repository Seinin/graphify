/**
 * 把一份「标注草稿」应用到 `data/graph.json`。
 *
 * 为什么不用 `import-graph.mjs`（走 API）：`importDraftSchema.meta` 只认
 * `name` / `description` / `topics`——**不认 `tags`**，于是标签注册表条目里的
 * `docId` 会被 zod 静默剥掉；而「每个标签都必须有一篇 notes 文档」是 `graphSchema`
 * 强制的，剥掉就再也写不回去（实测报错：`meta.tags.N.docId: 标签「2LPT」没有对应文档`）。
 * `normalize-tag-rules.mjs` 的头部记录过同一个坑，它的结论是「先改文件 → 再重启服务」，
 * 这里沿用同一顺序，并在写盘前补一道安全网：用服务端**同一份** `graphSchema` 校验结果，
 * 不通过就一个字都不写。
 *
 * 合并语义与服务端完全一致：直接调 `server/lib/mergeDraft.mjs` 的 `applyDraft`
 * （坐标不更新、标签取并集、引用取并集、未知标签名自动登记）。
 *
 * 用法：
 *   node scripts/apply-annotations.mjs <draft.json> --dry-run
 *   node scripts/apply-annotations.mjs <draft.json> --tag-doc <docId>
 *
 * `--tag-doc`：给注册表里**还没有文档**的标签绑这篇文档（相对 `docs/notes` 的路径，
 * 必须已存在）。不带该参数时，缺文档的标签会让校验失败——这是故意的：
 * 宁可停下来，也不要写出「有标签、没处可查」的图谱。
 *
 * 写盘前会把当前版本复制到 `data/history/`（与 API 写入的快照同目录），可回滚。
 * 写盘后需要**重启 dev 服务**才会被读入。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { applyDraft } from '../server/lib/mergeDraft.mjs'
import { graphSchema } from '../server/lib/schema.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const GRAPH_FILE = path.join(ROOT, 'data', 'graph.json')
const HISTORY_DIR = path.join(ROOT, 'data', 'history')
const NOTES_DIR = path.join(ROOT, '..', 'docs', 'notes')

const args = process.argv.slice(2)
const draftPath = args.find((arg) => !arg.startsWith('--'))
const DRY_RUN = args.includes('--dry-run')
const tagDoc = args.includes('--tag-doc') ? args[args.indexOf('--tag-doc') + 1] : null

if (!draftPath) {
  console.error('用法：node scripts/apply-annotations.mjs <draft.json> [--dry-run] [--tag-doc <docId>]')
  process.exit(2)
}

const draft = JSON.parse(await fs.readFile(path.resolve(ROOT, draftPath), 'utf8'))
const current = JSON.parse(await fs.readFile(GRAPH_FILE, 'utf8'))
const diff = applyDraft(current, draft)
const graph = diff.graph

console.log(`草稿：${draftPath}`)
console.log(`  节点 新增 ${diff.created.nodes.length} / 更新 ${diff.updated.nodes.length}`)
console.log(`  关系 新增 ${diff.created.edges.length} / 更新 ${diff.updated.edges.length}`)

if (diff.errors.length) {
  console.error(`\n✗ 合并失败：${diff.errors.length} 处`)
  diff.errors.slice(0, 12).forEach((item) => console.error(`  · ${item.reason}`))
  process.exit(1)
}

/** 给还没有文档的标签绑一篇（都由 --tag-doc 指定；要求该文档真实存在） */
const missing = graph.meta.tags.filter((tag) => !String(tag.docId || '').trim())
if (missing.length) {
  if (!tagDoc) {
    console.error(`\n✗ ${missing.length} 个标签还没有对应文档：${missing.map((tag) => tag.name).join('、')}`)
    console.error('  用 --tag-doc <docs/notes 下的相对路径> 指定，或先跑 scripts/normalize-tag-rules.mjs')
    process.exit(1)
  }
  const absolute = path.join(NOTES_DIR, tagDoc)
  try {
    await fs.access(absolute)
  } catch {
    console.error(`\n✗ 文档不存在：docs/notes/${tagDoc}`)
    process.exit(1)
  }
  missing.forEach((tag) => {
    tag.docId = tagDoc
  })
  console.log(`  标签绑文档：${missing.length} 个 → ${tagDoc}`)
}

// 安全网：用服务端同一份 schema 校验结果，不通过就不写
const parsed = graphSchema.safeParse(graph)
if (!parsed.success) {
  console.error(`\n✗ 结果不符合 graphSchema：${parsed.error.issues.length} 处`)
  parsed.error.issues.slice(0, 12).forEach((issue) => {
    console.error(`  · ${issue.path.join('.')}: ${issue.message}`)
  })
  process.exit(1)
}
console.log('  校验：graphSchema 通过')

if (DRY_RUN) {
  console.log('\n（dry-run：没有写盘）')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
await fs.mkdir(HISTORY_DIR, { recursive: true })
const backup = path.join(HISTORY_DIR, `graph-${stamp}.json`)
await fs.copyFile(GRAPH_FILE, backup)
await fs.writeFile(GRAPH_FILE, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
console.log(`\n已写入 data/graph.json（改前快照：${path.relative(ROOT, backup)}）`)
console.log('记得重启 dev 服务：pkill -f server/index.mjs && nohup node server/index.mjs &')
