/**
 * 只保留「参数」标签，其余标签一律删除（**政策实现**，可重复执行、幂等）。
 *
 * 政策：标签这个功能只服务**参数**——一个参数一个标签，由 `scan-param-tags.mjs` 从源码
 * 引用扫出来并带 `group`（就是 `inputs.py` 里 InputStruct 的子类名）。没有 `group` 的
 * 历史自由标签（初始条件、2LPT、C: rng.c、FFT…）一律从注册表、节点 `tags`、以及明细里摘掉。
 *
 * 两种用法：
 *   node scripts/prune-tags.mjs            # 走 API（服务在跑时用；服务端会留快照）
 *   node scripts/prune-tags.mjs --file     # 直接改 data/graph.json（服务没在跑 / 不想惊动它）
 *
 * 为什么要有 `--file`：走 API 时改动落在**服务进程的内存**里；若之后 kill 掉那个进程，
 * 它可能在退出时把内存里的旧图写回磁盘（实测踩过：清理已生效，重启服务后磁盘被写回旧状态）。
 * `--file` 模式下写盘前留 `data/history/` 快照、并用服务端同一份 `graphSchema` 校验，
 * 写完重启服务即可。
 *
 * 幂等：没有可删的标签时什么都不改。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { graphSchema } from '../server/lib/schema.mjs'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const GRAPH_FILE = path.join(ROOT, 'data', 'graph.json')
const HISTORY_DIR = path.join(ROOT, 'data', 'history')

const args = process.argv.slice(2)
const FILE_MODE = args.includes('--file')
const BASE = args.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:5178'

/**
 * 保留的标签 = **有 `group` 的**（即由 `scan-param-tags.mjs` 从 inputs.py 扫出来、
 * 归到 InputStruct 子类里的参数标签）。这样不再维护白名单：参数标签增减时这个脚本
 * 不会误删（早期版本写死 14 个名字，新增 AstroParams 后会把它们删掉）。
 */
const keepIds = (tags) => new Set(tags.filter((tag) => (tag.group ?? '').trim()).map((tag) => tag.id))

const readGraph = FILE_MODE
  ? async () => JSON.parse(await fs.readFile(GRAPH_FILE, 'utf8'))
  : async () => (await (await fetch(`${BASE}/api/graph`)).json()).graph

const writeGraph = FILE_MODE
  ? async (graph) => {
      // 安全网：用服务端同一份 schema 校验结果，不通过就一个字都不写
      const parsed = graphSchema.safeParse(graph)
      if (!parsed.success) {
        console.error(`✗ 结果不符合 graphSchema：${parsed.error.issues.length} 处`)
        parsed.error.issues.slice(0, 8).forEach((issue) => {
          console.error(`  · ${issue.path.join('.')}: ${issue.message}`)
        })
        process.exit(1)
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await fs.mkdir(HISTORY_DIR, { recursive: true })
      await fs.copyFile(GRAPH_FILE, path.join(HISTORY_DIR, `graph-${stamp}.json`))
      await fs.writeFile(GRAPH_FILE, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
      console.log(`已写入 data/graph.json（改前快照：data/history/graph-${stamp}.json）`)
    }
  : async (graph, reason) => {
      const response = await fetch(`${BASE}/api/graph`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph, reason }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(`写图失败: ${response.status} ${JSON.stringify(body).slice(0, 400)}`)
    }

const graph = await readGraph()
const before = graph.meta.tags ?? []
const KEEP_SET = keepIds(before)
const dropped = before.filter((tag) => !KEEP_SET.has(tag.id))
console.log(`注册表 ${before.length} 个 → 保留 ${before.length - dropped.length} 个，删除 ${dropped.length} 个`)
console.log(`删除清单: ${dropped.map((tag) => tag.name).join('、') || '（无）'}`)
if (!KEEP_SET.size) console.log('注意：没有任何带 group 的参数标签，先跑 scan-param-tags.mjs 再清理')

graph.meta.tags = before.filter((tag) => KEEP_SET.has(tag.id))

let strippedNodes = 0
let strippedDetails = 0
graph.nodes.forEach((node) => {
  const tags = (node.tags ?? []).filter((id) => KEEP_SET.has(id))
  const details = Object.fromEntries(Object.entries(node.tagDetails ?? {}).filter(([id]) => KEEP_SET.has(id)))
  if (tags.length !== (node.tags ?? []).length) strippedNodes += 1
  strippedDetails += Object.keys(node.tagDetails ?? {}).length - Object.keys(details).length
  node.tags = tags
  node.tagDetails = details
})

if (dropped.length) await writeGraph(graph, 'tags:keep-parameter-only')
else console.log('\n（无可删：什么都没改）')

const after = await readGraph()
const left = after.meta.tags ?? []
console.log(`\n复核：注册表 ${left.length} 个 | 还有标签的节点 ${after.nodes.filter((node) => node.tags.length).length} 个 | 清理节点 ${strippedNodes} 个、悬空明细 ${strippedDetails} 条`)
left
  .map((tag) => ({ tag, count: after.nodes.filter((node) => node.tags.includes(tag.id)).length }))
  .forEach((row) => console.log(`  ${row.tag.name.padEnd(26)} ${row.count} 个节点`))
