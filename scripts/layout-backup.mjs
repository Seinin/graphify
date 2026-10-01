/**
 * 版面备份 / 还原：整图级别的「存盘」与「一键退回」。
 *
 * 为什么单独做：自动重排一旦把手工摆好的版面冲掉，光靠服务端的自动快照要在 50 份里翻，
 * 而且分不清哪一份是「手工版」。这里把整张图（含坐标、层级、标签）按名字存一份，随时退回来。
 *
 * 用法：
 *   node scripts/layout-backup.mjs save [说明]     # 存一份（默认说明「手工版面」）
 *   node scripts/layout-backup.mjs list            # 列出所有备份
 *   node scripts/layout-backup.mjs restore [文件]  # 还原（不给文件就取最新那份；还原前会先存当前状态）
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const GRAPH_FILE = path.join(ROOT, 'data', 'graph.json')
const BACKUP_DIR = path.join(ROOT, 'data', 'backups')

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

async function listBackups() {
  await fs.mkdir(BACKUP_DIR, { recursive: true })
  const files = (await fs.readdir(BACKUP_DIR)).filter((name) => name.endsWith('.json')).sort().reverse()
  return files.map((name) => path.join(BACKUP_DIR, name))
}

async function summarize(file) {
  const graph = JSON.parse(await fs.readFile(file, 'utf8'))
  const top = graph.nodes.filter((node) => !node.parent).length
  return `${path.basename(file)}\n    节点 ${graph.nodes.length} · 关系 ${graph.edges.length} · 标签 ${(graph.meta.tags ?? []).length} · 顶层 ${top}`
}

const [command = 'save', ...rest] = process.argv.slice(2)

if (command === 'list') {
  const files = await listBackups()
  console.log(`备份 ${files.length} 份（新 → 旧）：`)
  for (const file of files) console.log(`  ${await summarize(file)}`)
} else if (command === 'restore') {
  const files = await listBackups()
  const target = rest[0] ? path.resolve(ROOT, rest[0]) : files[0]
  if (!target) {
    console.error('没有可还原的备份')
    process.exit(1)
  }
  // 还原前先给「当前状态」留一份，避免手滑把现状也丢了
  const safety = path.join(BACKUP_DIR, `graph-${stamp()}-还原前.json`)
  await fs.copyFile(GRAPH_FILE, safety)
  await fs.copyFile(target, GRAPH_FILE)
  console.log(`已还原：${path.basename(target)}`)
  console.log(`  （还原前的状态另存为 ${path.basename(safety)}）`)
  console.log('  服务端读的是文件，下一次请求即为新版面；必要的话重启一次更保险。')
} else {
  const note = rest.join(' ').trim() || '手工版面'
  const file = path.join(BACKUP_DIR, `graph-${stamp()}-${note.replace(/\s+/g, '_')}.json`)
  await fs.mkdir(BACKUP_DIR, { recursive: true })
  await fs.copyFile(GRAPH_FILE, file)
  console.log(`已存盘：${path.basename(file)}`)
  console.log(`  ${await summarize(file)}`)
  console.log('  还原：node scripts/layout-backup.mjs restore')
}
