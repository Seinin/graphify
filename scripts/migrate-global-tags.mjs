/**
 * 迁移：自由文本标签 → 全局标签注册表。
 *
 * 为什么**直接读写文件**而不是走 API
 * --------------------------------
 * 新 schema 要求节点 `tags` 必须是 `meta.tags` 里登记过的 id，而迁移前的数据恰恰是自由文本
 * （图集导入时打的 18 种）——也就是说新版服务端读这份文件会**校验失败、回退空图**。
 * 走 API 会先撞上这件事（读到空图甚至把空图写回去）。所以这里直接对 `data/graph.json` 动手，
 * 用服务端同一份 schema 做写前自检，写完再让服务端重启加载。
 *
 * 做什么
 * ------
 * 1. 把现有节点 `tags` 里的**自由文本**按原名登记进 `meta.tags`（同名合并成一项），
 *    id 取 `tag:<名称>`（可读、稳定、天然去重）；
 * 2. 节点 `tags` 的文本改写为对应 id；已经是注册 id 的保持不动（**幂等**，可重复跑）；
 * 3. 节点补上空 `tagDetails`（明细由 `tag-parameters.mjs` 之类后续脚本填）；
 * 4. 断言：节点/关系数不变、带标签节点数不减、每个标签都解析得到注册项、整图能通过新 schema；
 *    任一失败都不写盘。
 *
 * 用法：
 *   node scripts/migrate-global-tags.mjs [--apply]
 * 默认 **dry-run**：只打印将要登记与改写的清单。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tryParseGraph } from '../server/lib/schema.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const GRAPH_PATH = path.resolve(here, '..', 'data', 'graph.json')
const BACKUP_PATH = path.resolve(here, '..', 'data', 'graph.before-global-tags.json')
const APPLY = process.argv.includes('--apply')

const tagIdFor = (name) => `tag:${String(name).slice(0, 56)}`

async function main() {
  const graph = JSON.parse(await fs.readFile(GRAPH_PATH, 'utf8'))
  const nodes = graph.nodes || []
  const registry = [...(graph.meta?.tags || [])]
  const byName = new Map(registry.map((tag) => [tag.name, tag]))
  const byId = new Map(registry.map((tag) => [tag.id, tag]))

  const created = []
  const resolve = (token) => {
    const raw = String(token ?? '').trim()
    if (!raw) return null
    if (byId.has(raw)) return raw
    if (byName.has(raw)) return byName.get(raw).id
    /**
     * 已经是「id 形状」（`tag:xxx`）但注册表里没有：说明注册表被丢过一次
     * （例如旧版服务端把没有 schema 的字段剥掉后又被写回磁盘）。
     * 这种 token 直接按 id 补登记，名字取 `tag:` 之后的原文——比再套一层 `tag:tag:xxx` 干净得多。
     */
    if (raw.startsWith('tag:')) {
      const tag = { id: raw, name: raw.slice(4), description: '' }
      if (!byName.has(tag.name)) byName.set(tag.name, tag)
      registry.push(tag)
      byId.set(tag.id, tag)
      created.push(tag)
      return tag.id
    }
    const tag = { id: tagIdFor(raw), name: raw, description: '' }
    if (byId.has(tag.id)) throw new Error(`标签 id 冲突：${tag.id}`)
    registry.push(tag)
    byId.set(tag.id, tag)
    byName.set(tag.name, tag)
    created.push(tag)
    return tag.id
  }

  const taggedBefore = nodes.filter((node) => (node.tags || []).length > 0).length
  let rewritten = 0
  const next = {
    ...graph,
    meta: { ...graph.meta, tags: registry },
    nodes: nodes.map((node) => {
      const before = node.tags || []
      const tags = [...new Set(before.map(resolve).filter(Boolean))]
      if (tags.length !== before.length || tags.some((id, index) => id !== before[index])) rewritten += 1
      return { ...node, tags, tagDetails: { ...(node.tagDetails || {}) } }
    }),
  }

  // ---------- 断言（任一失败都不写盘） ----------
  const failures = []
  const assert = (ok, message) => {
    if (!ok) failures.push(message)
  }
  const taggedAfter = next.nodes.filter((node) => node.tags.length > 0).length
  assert(next.nodes.length === nodes.length, '节点数被改变')
  assert(next.edges.length === (graph.edges || []).length, '关系数被改变')
  assert(taggedAfter === taggedBefore, `带标签的节点数变了：${taggedBefore} → ${taggedAfter}`)
  assert(registry.length === new Set(registry.map((tag) => tag.name)).size, '注册表里出现同名标签')
  const known = new Set(registry.map((tag) => tag.id))
  const dangling = next.nodes.filter((node) => node.tags.some((id) => !known.has(id)))
  assert(dangling.length === 0, `仍有解析不到注册项的节点：${dangling.map((n) => n.id).join(', ')}`)

  // 用服务端同一份 schema 预检：写下去的文件必须能被新版服务端读成完整图谱
  const parsed = tryParseGraph(next)
  assert(parsed.ok, `整图未通过 schema 校验：${(parsed.issues || []).map((i) => `${i.path} ${i.message}`).slice(0, 3).join('；')}`)

  console.log(`节点 ${nodes.length} / 关系 ${(graph.edges || []).length}；带标签节点 ${taggedBefore}`)
  console.log(`注册表：原有 ${(graph.meta?.tags || []).length} 项，本次新登记 ${created.length} 项`)
  created.forEach((tag) => console.log(`  + ${tag.id}  ←  ${tag.name}`))
  console.log(`需要改写标签写法的节点：${rewritten}`)
  if (failures.length) {
    console.error('断言失败，未写盘：')
    failures.forEach((message) => console.error(`  ✗ ${message}`))
    process.exit(1)
  }

  if (!APPLY) {
    console.log('\n（dry-run：没有写盘。核对无误后加 --apply 执行）')
    return
  }
  await fs.copyFile(GRAPH_PATH, BACKUP_PATH)
  await fs.writeFile(GRAPH_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  console.log(`\n已写回：${GRAPH_PATH}`)
  console.log(`迁移前备份：${BACKUP_PATH}`)
  console.log('（服务端需要重启才会加载新 schema 与迁移后的数据）')
}

main().catch((error) => {
  console.error('迁移失败：', error.message)
  process.exit(1)
})
