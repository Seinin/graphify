#!/usr/bin/env node
/**
 * 标签一次性整理：**显示名回归原变量名** + **按类别 seed 颜色**。
 *
 * 为什么改
 * --------
 * 1. `tag:BOX_LEN` 的显示名曾经是「盒子共动边长 L」（当时定的规则是"物理量用中文名 + 论文符号"），
 *    但 25 个标签里只有它一个带中文——读图时反而要来回对照变量名，规则已作废：**一律用原变量名**。
 * 2. 右侧属性面板要按类别上色（四类：`MatterOptions` / `SimulationOptions` / `AstroOptions` / `AstroParams`），
 *    配色表在 `src/graph/palette.ts`（前端渲染用）与 `scripts/lib/tag-groups.mjs`（本脚本用），
 *    这里按 `group` 把色写进注册表的 `color` 字段，让数据自描述。
 *
 * 前端的取色优先级是「标签的 `color` → 按 `group` 派生 → 未分类兜底」，所以：
 * 写进数据的色是**默认值**，将来想单独调某一个标签，直接用界面上/接口里的 color 覆盖即可。
 * `npm run check:canvas` 有一条断言要求"每个标签的 color 等于其 group 的表值"，
 * 因此**单独调某个标签的颜色会让那条断言失败**——要单独调就同时把它从断言的白名单里排除（见该断言注释）。
 *
 * 用法
 * ----
 *   node scripts/color-tags.mjs            # dry-run（默认）
 *   node scripts/color-tags.mjs --apply    # 写回（先备份）
 *
 * 直接读写 `data/graph.json`，不经服务端（`readGraph()` 每次从磁盘读；线上旧进程会把不认识的字段剥掉）。
 * 本次只改注册表里的 `name`/`color`，不新增字段，写完**刷新页面**即可，不必重启服务、不必 build。
 * 脚本幂等：两个字段都已是目标值时不动数据。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tryParseGraph } from '../server/lib/schema.mjs'
import { TAG_GROUP_COLORS, tagColorOf } from './lib/tag-groups.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const GRAPH_PATH = path.resolve(here, '..', 'data', 'graph.json')
const BACKUP_PATH = path.resolve(here, '..', 'data', 'graph.before-tag-colors.json')

const APPLY = process.argv.includes('--apply')

/** 显示名的历史修正：id → 目标名（现在只有 BOX_LEN；日后若要再改名字也走这里） */
const NAME_FIXES = new Map([['tag:BOX_LEN', 'BOX_LEN']])

async function main() {
  const graph = JSON.parse(await fs.readFile(GRAPH_PATH, 'utf8'))
  const tags = graph.meta?.tags ?? []
  if (!tags.length) throw new Error('注册表里没有标签，先确认数据文件是否被换过')

  const before = { nodes: graph.nodes.length, edges: graph.edges.length }
  const plans = tags.map((tag) => ({
    id: tag.id,
    name: NAME_FIXES.get(tag.id) ?? tag.name,
    group: tag.group ?? '',
    color: tagColorOf(tag.group),
    nameChanged: (NAME_FIXES.get(tag.id) ?? tag.name) !== tag.name,
    colorChanged: tagColorOf(tag.group) !== tag.color,
  }))

  console.log(`标签注册表 ${tags.length} 个（节点 ${before.nodes} / 关系 ${before.edges}）`)
  console.log(`类别配色：${Object.entries(TAG_GROUP_COLORS).map(([group, hex]) => `${group}=${hex}`).join('  ')}\n`)
  for (const plan of plans) {
    const marks = [plan.nameChanged ? `名字: ${tags.find((t) => t.id === plan.id).name} → ${plan.name}` : '', plan.colorChanged ? '补色' : '']
      .filter(Boolean)
      .join(' · ')
    console.log(`  ${plan.id.padEnd(34)} ${plan.group.padEnd(18)} ${plan.color}  ${marks}`)
  }

  const changes = plans.filter((plan) => plan.nameChanged || plan.colorChanged)
  if (!changes.length) {
    console.log('\n名字与颜色都已是目标值，无需改动。')
    return
  }

  const nextTags = tags.map((tag) => {
    const plan = plans.find((item) => item.id === tag.id)
    return { ...tag, name: plan.name, color: plan.color }
  })
  const next = { ...graph, meta: { ...graph.meta, tags: nextTags, updatedAt: new Date().toISOString() } }

  /* ---------------- 断言（任一失败不写盘） ---------------- */
  const failures = []
  if (next.nodes.length !== before.nodes) failures.push('节点数被改变')
  if (next.edges.length !== before.edges) failures.push('关系数被改变')
  if (nextTags.length !== tags.length) failures.push('标签数被改变')
  if (nextTags.some((tag) => !/^#[0-9a-fA-F]{6}$/.test(tag.color))) failures.push('有标签的 color 不是 #RRGGBB')
  for (const tag of nextTags) {
    if (tag.color !== tagColorOf(tag.group)) failures.push(`${tag.id} 的 color 与 group 的表值不一致`)
  }
  // 只对本次明确改名的那些做"不许再有中文"的检查：注册表允许用户新建中文名标签，不该误伤
  for (const plan of plans.filter((item) => NAME_FIXES.has(item.id))) {
    if (/[\u3000-\u9fff]/.test(plan.name)) failures.push(`${plan.id} 的目标名字里仍有中文：${plan.name}`)
  }
  // 明细/归属都挂在 id 上，改名字不该动它们——抽查一下条数
  const detailBefore = graph.nodes.reduce((sum, node) => sum + Object.keys(node.tagDetails ?? {}).length, 0)
  const detailAfter = next.nodes.reduce((sum, node) => sum + Object.keys(node.tagDetails ?? {}).length, 0)
  if (detailBefore !== detailAfter) failures.push('明细条数被改变（改名不该动归属与明细）')
  const parsed = tryParseGraph(next)
  if (!parsed.ok) failures.push(`整图未通过 schema：${JSON.stringify(parsed.issues?.slice(0, 2))}`)

  if (failures.length) {
    console.error('\n断言失败，未写盘：')
    failures.forEach((item) => console.error(`  ✗ ${item}`))
    process.exit(1)
  }

  console.log(`\n待改：${changes.length} 个标签（改名 ${changes.filter((c) => c.nameChanged).length} 个 · 补色 ${changes.filter((c) => c.colorChanged).length} 个）`)
  if (!APPLY) {
    console.log('（dry-run：没有写回。核对无误后加 --apply 执行）')
    return
  }

  await fs.copyFile(GRAPH_PATH, BACKUP_PATH)
  const tmp = `${GRAPH_PATH}.tmp-${Date.now().toString(36)}`
  await fs.writeFile(tmp, `${JSON.stringify(parsed.graph, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, GRAPH_PATH)
  console.log(`\n已写回：${GRAPH_PATH}`)
  console.log(`  标签 ${nextTags.length} 个；节点 ${parsed.graph.nodes.length}；关系 ${parsed.graph.edges.length}`)
  console.log(`写前备份：${BACKUP_PATH}`)
  console.log('提醒：数据改完刷新页面即可（前端渲染按 group/color 取色，不需要重启服务）。')
}

main().catch((error) => {
  console.error('整理失败：', error.message)
  process.exit(1)
})
