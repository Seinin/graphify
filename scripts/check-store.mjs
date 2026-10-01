/**
 * 图谱存储自检：验证"保存即另存为保留副本"这套写盘口径（见 openspec 变更
 * `graphify-manual-save-only`）。检查的事：
 *
 *   1. 批量坐标：一次请求 = 一次写盘 = **一份**快照，且坐标真的落进工作文件；
 *   2. 空 positions / 未知 id / 非法坐标：不写盘、不产快照，且如实回报 `skipped`；
 *   3. 另存（`POST /api/graph/save`）：只新增一份带保留标记的副本，**工作文件一字不动**；
 *   4. 轮转：快照超过上限时清理未标记的那些，**保留副本必须留下**；
 *   5. 删除权限：只允许删保留副本；自动快照被拒（它们的生命周期由轮转管理）；
 *   6. 重命名走增量端点：只有名称变化，节点/边不被整图替换；
 *   7. 坏数据不允许进档案（另存同样过严格校验）；保留副本可回滚且回滚本身留快照。
 *
 * 隔离方式：整份自检跑在**临时数据目录**里（`GRAPHIFY_DATA_DIR`），随机端口起真服务，
 * 因此不会碰仓库里的 `data/graph.json` 与历史。跑完删临时目录。
 *
 * 用法：`npm run check:store`（失败时退出码 1）
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/* 环境必须在 import 服务端模块**之前**设好：paths.mjs / schema.mjs 在模块加载时读这些变量 */
const TMP_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'graphify-store-'))
const PORT = 5300 + Math.floor(Math.random() * 400)
const SNAPSHOT_LIMIT = 3

process.env.GRAPHIFY_DATA_DIR = TMP_DIR
process.env.GRAPHIFY_SNAPSHOT_LIMIT = String(SNAPSHOT_LIMIT)
process.env.PORT = String(PORT)
process.env.HOST = '127.0.0.1'
process.env.NODE_ENV = 'production' // 只为跳过 Vite 中间件：本自检只打 API

const { emptyGraph, nowIso } = await import('../server/lib/schema.mjs')
const { GRAPH_FILE, HISTORY_DIR } = await import('../server/lib/paths.mjs')
await import('../server/index.mjs') // bootstrap 在模块加载时启动监听

const BASE = `http://127.0.0.1:${PORT}`
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

/** 打一个 JSON 接口，返回状态码与解析后的 body（解析失败则给原文） */
async function api(method, route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const raw = await res.text()
  let parsed = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = raw
  }
  return { status: res.status, body: parsed }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const probe = await api('GET', '/api/health').catch(() => ({ status: 0 }))
    if (probe.status === 200) return true
    await sleep(100)
  }
  return false
}

/** 历史目录里所有快照文件名（升序） */
async function snapshotNames() {
  const entries = await fs.readdir(HISTORY_DIR).catch(() => [])
  return entries.filter((name) => name.endsWith('.json')).sort()
}

const keepNames = (names) => names.filter((name) => name.endsWith('-keep.json'))
const readWorking = () => fs.readFile(GRAPH_FILE, 'utf8')

const stamp = nowIso()
const node = (id, label, x = 0, y = 0) => ({
  id,
  label,
  type: 'method',
  summary: '',
  tags: [],
  tagDetails: {},
  refs: [],
  topics: [],
  parent: null,
  conditional: false,
  position: { x, y },
  createdAt: stamp,
  updatedAt: stamp,
})

function seedGraph() {
  const graph = emptyGraph()
  graph.meta.name = '自检种子图'
  graph.nodes = [node('a', '节点 A', 1, 1), node('b', '节点 B', 2, 2), node('c', '节点 C', 3, 3)]
  graph.edges = [
    {
      id: 'e1',
      source: 'a',
      target: 'b',
      label: '流向',
      type: 'relates_to',
      directed: true,
      note: '',
      sourcePort: null,
      targetPort: null,
      conditional: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]
  return graph
}

async function run() {
  console.log('图谱存储 · 服务端自检')
  console.log(`临时数据目录：${TMP_DIR}`)
  console.log(`快照轮转上限（本自检调低）：${SNAPSHOT_LIMIT} 份`)

  console.log('\n[隔离与起服务]')
  ok(GRAPH_FILE.startsWith(TMP_DIR) && HISTORY_DIR.startsWith(TMP_DIR), '工作文件与历史目录都在临时目录里', GRAPH_FILE)
  ok(await waitReady(), '服务已就绪', `${BASE}/api/health`)

  const seeded = await api('PUT', '/api/graph', { graph: seedGraph() })
  ok(seeded.status === 200, '种子图写入成功', `status=${seeded.status}`)

  console.log('\n[批量坐标：一次请求 = 一份快照]')
  {
    const before = await snapshotNames()
    const beforeRaw = JSON.parse(await readWorking())
    const res = await api('POST', '/api/graph/positions', {
      positions: { a: { x: 10, y: 11 }, c: { x: 30, y: 31 } },
    })
    const after = await snapshotNames()
    ok(res.status === 200 && res.body?.updated === 2, '回写两个节点的坐标', JSON.stringify(res.body?.updated))
    ok(after.length === before.length + 1, '这次回写只产生一份快照', `${before.length} → ${after.length}`)
    const working = JSON.parse(await readWorking())
    const byId = new Map(working.nodes.map((item) => [item.id, item]))
    ok(
      byId.get('a')?.position?.x === 10 && byId.get('c')?.position?.y === 31,
      '新坐标已落进工作文件',
      JSON.stringify([byId.get('a')?.position, byId.get('c')?.position]),
    )
    ok(byId.get('b')?.position?.x === 2, '没提交的节点坐标原样保留', JSON.stringify(byId.get('b')?.position))
    ok(working.meta.updatedAt !== beforeRaw.meta.updatedAt, '工作文件的 updatedAt 已前进')
  }

  console.log('\n[空 positions：不写盘、不产快照]')
  {
    const beforeNames = await snapshotNames()
    const beforeRaw = await readWorking()
    const res = await api('POST', '/api/graph/positions', { positions: {} })
    ok(res.status === 200 && res.body?.updated === 0, '空对象返回当前图且 updated=0')
    ok((await snapshotNames()).length === beforeNames.length, '没新增快照')
    ok((await readWorking()) === beforeRaw, '工作文件一字未动')
  }

  console.log('\n[未知 id / 非法坐标：如实回报]')
  {
    const beforeNames = await snapshotNames()
    const res = await api('POST', '/api/graph/positions', {
      positions: { nope: { x: 1, y: 1 }, a: { x: 'bad', y: 0 } },
    })
    const skipped = Array.isArray(res.body?.skipped) ? res.body.skipped : []
    ok(res.status === 200 && res.body?.updated === 0, '没有任何节点被更新', JSON.stringify(res.body?.updated))
    ok(skipped.includes('nope') && skipped.includes('a'), '未知 id 与非法坐标都记入 skipped', skipped.join('、'))
    ok((await snapshotNames()).length === beforeNames.length, '没写出无意义的快照')
  }

  console.log('\n[另存为：只加保留副本，不动工作文件]')
  let keepId = null
  {
    const beforeRaw = await readWorking()
    const beforeNames = await snapshotNames()
    const posted = JSON.parse(beforeRaw)
    posted.meta.name = '另存出来的副本名'
    const res = await api('POST', '/api/graph/save', { graph: posted, reason: 'graph:save-as' })
    keepId = res.body?.id ?? null
    ok(res.status === 201 && String(keepId).endsWith('-keep.json'), '返回一份保留副本的 id', String(keepId))
    const afterNames = await snapshotNames()
    ok(afterNames.length === beforeNames.length + 1 && keepNames(afterNames).length === 1, '只新增了一份保留副本', `${beforeNames.length} → ${afterNames.length}`)
    ok((await readWorking()) === beforeRaw, '工作文件没被这次另存改动')
    const copy = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, keepId), 'utf8'))
    ok(copy.pinned === true && copy.graph?.meta?.name === '另存出来的副本名', '副本带保留标记，内容是"本机看到的那一份"')
    ok(copy.graph?.nodes?.length === 3 && copy.graph?.edges?.length === 1, '副本含完整节点与关系', `${copy.graph?.nodes?.length}/${copy.graph?.edges?.length}`)
    const versions = await api('GET', '/api/graph/versions')
    const list = versions.body?.versions ?? []
    ok(list.find((item) => item.id === keepId)?.pinned === true, '版本列表回传 pinned=true')
    ok(list.filter((item) => item.pinned).length === 1, '列表里只有这一份是保留副本')
  }

  console.log('\n[轮转：保留副本必须留下]')
  {
    for (let index = 0; index < 6; index += 1) {
      await api('POST', '/api/graph/positions', { positions: { b: { x: 100 + index, y: 200 + index } } })
    }
    const names = await snapshotNames()
    ok(names.includes(keepId), '绕过 6 次写盘后，保留副本仍在', keepId)
    ok(keepNames(names).length === 1, '保留副本没有被误判成两份')
    ok(names.length - keepNames(names).length <= SNAPSHOT_LIMIT, `自动快照被裁到上限内（≤${SNAPSHOT_LIMIT}）`, String(names.length - keepNames(names).length))
  }

  console.log('\n[删除权限：只允许删保留副本]')
  {
    const names = await snapshotNames()
    const rolling = names.find((name) => !name.endsWith('-keep.json'))
    const denied = await api('DELETE', `/api/graph/versions/${rolling}`)
    ok(denied.status === 400, '删自动快照被拒（400）', `status=${denied.status}`)
    ok((await snapshotNames()).includes(rolling), '自动快照没被删掉')
    const removed = await api('DELETE', `/api/graph/versions/${keepId}`)
    ok(removed.status === 200, '删保留副本成功', `status=${removed.status}`)
    ok(!(await snapshotNames()).includes(keepId), '保留副本已从历史目录移除')
  }

  console.log('\n[重命名：只改名称的增量写]')
  {
    const before = JSON.parse(await readWorking())
    const res = await api('PATCH', '/api/graph/meta', { name: '改过的名字' })
    const after = JSON.parse(await readWorking())
    ok(res.status === 200 && after.meta.name === '改过的名字', '名称已写入工作文件', after.meta.name)
    ok(
      JSON.stringify(after.nodes) === JSON.stringify(before.nodes) &&
        JSON.stringify(after.edges) === JSON.stringify(before.edges),
      '节点与边逐字未变（不是整图替换）',
    )
    ok(after.meta.updatedAt !== before.meta.updatedAt, 'updatedAt 已前进')
    const empty = await api('PATCH', '/api/graph/meta', { name: '   ' })
    ok(empty.status === 400, '空名称被拒（400）', `status=${empty.status}`)
  }

  console.log('\n[坏数据不允许进档案]')
  {
    const beforeNames = await snapshotNames()
    const broken = emptyGraph()
    broken.nodes = [{ id: 'x' }]
    const res = await api('POST', '/api/graph/save', { graph: broken })
    ok(res.status === 400, '结构坏的图另存被拒（400）', `status=${res.status}`)
    ok((await snapshotNames()).length === beforeNames.length, '没留下半份坏档案')
  }

  console.log('\n[保留副本可回滚，且回滚本身留快照]')
  {
    const made = await api('POST', '/api/graph/save', { graph: (() => {
      const graph = JSON.parse(seedGraphJson())
      graph.meta.name = '回滚目标副本'
      return graph
    })() })
    const id = made.body?.id
    ok(made.status === 201, '先造一份保留副本', String(id))
    const beforeRolling = (await snapshotNames()).filter((name) => !name.endsWith('-keep.json'))
    const rolled = await api('POST', `/api/graph/versions/${id}/rollback`)
    ok(rolled.status === 200, '回滚请求成功', `status=${rolled.status}`)
    const working = JSON.parse(await readWorking())
    ok(working.meta.name === '回滚目标副本', '工作文件已换成副本内容', working.meta.name)
    const afterNames = await snapshotNames()
    const afterRolling = afterNames.filter((name) => !name.endsWith('-keep.json'))
    // 注意：快照到上限后"多一份就裁一份"，所以这里断言的是"出现了新的非保留快照"而不是总数 +1
    ok(
      afterRolling.some((name) => !beforeRolling.includes(name)),
      '回滚前留了一份新快照（因此回滚本身可再撤销）',
      `${beforeRolling.length} → ${afterRolling.length}`,
    )
    ok(afterNames.includes(id), '保留副本仍在（回滚不会消耗它）')
  }
}

/** 与 seedGraph 等价但走 JSON 字符串：给"回滚目标副本"用，避免共享同一对象引用 */
function seedGraphJson() {
  return JSON.stringify(seedGraph())
}

async function main() {
  try {
    await run()
  } catch (error) {
    failures.push(`自检过程抛错：${error?.stack || error?.message || error}`)
    console.error('  ✗ 自检过程抛错：', error)
  }

  console.log('')
  await fs.rm(TMP_DIR, { recursive: true, force: true }).catch(() => {})
  if (failures.length) {
    console.error(`✗ 图谱存储自检失败：${failures.length} / ${checks} 项`)
    for (const line of failures) console.error(`  · ${line}`)
    process.exit(1)
  }
  console.log(`✓ 图谱存储自检通过（${checks} 项断言）`)
  process.exit(0)
}

await main()
