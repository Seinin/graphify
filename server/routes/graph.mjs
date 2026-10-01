import fs from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import {
  ARROW_PORTS,
  EDGE_TYPES,
  MAX_TAGS,
  MAX_TOPICS,
  NODE_TYPES,
  applyFieldAliases,
  effectiveCaps,
  newId,
  nowIso,
  parseGraph,
} from '../lib/schema.mjs'
import {
  deleteArchive,
  isKeepName,
  listSnapshots,
  readGraph,
  readSnapshot,
  rollbackToSnapshot,
  writeArchive,
  writeGraph,
} from '../lib/store.mjs'
import { applyDraft, summarize } from '../lib/mergeDraft.mjs'
import { DIST_DIR } from '../lib/paths.mjs'

export const graphRouter = Router()

const fail = (status, message) => Object.assign(new Error(message), { status })

const text = (value, max) => String(value ?? '').trim().slice(0, max)

function pickPosition(position) {
  if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') return null
  return { x: Number(position.x), y: Number(position.y) }
}

/**
 * 父节点必须是图谱里真实存在的其他节点；悬空、自指或成环一律降级为顶层。
 * 成环检查是必须的：大框可以互相嵌套，一旦把自己塞进自己的子孙里，
 * compound 渲染与可见性推导都会出现断链（前端只能靠兜底，不能靠运气）。
 */
function pickParent(token, nodes, selfId) {
  const id = text(token, 80)
  if (!id || id === selfId) return null
  if (!nodes.some((item) => item.id === id)) return null
  if (!selfId) return id
  const descendants = new Set()
  const childrenOf = new Map()
  nodes.forEach((item) => {
    if (!item.parent) return
    const bucket = childrenOf.get(item.parent)
    if (bucket) bucket.push(item.id)
    else childrenOf.set(item.parent, [item.id])
  })
  const queue = [...(childrenOf.get(selfId) ?? [])]
  while (queue.length) {
    const current = queue.shift()
    if (descendants.has(current)) continue
    descendants.add(current)
    queue.push(...(childrenOf.get(current) ?? []))
  }
  return descendants.has(id) ? null : id
}

/**
 * 话题归属：只做裁剪与去重，不在这里过滤未注册 id。
 * 未注册 id 由 graphSchema 的交叉校验拦下（返回 400 并指名节点与话题），
 * 避免「静默丢弃话题」这种最难排查的失败方式。
 */
function pickTopics(topics) {
  if (!Array.isArray(topics)) return []
  return [...new Set(topics.map((topic) => text(topic, 40)).filter(Boolean))].slice(0, MAX_TOPICS)
}

/** 全局标签归属：与话题同一套口径——只裁剪去重，未注册 id 交给 graphSchema 交叉校验拦下 */
function pickTagIds(tags) {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags.map((tag) => text(tag, 60)).filter(Boolean))].slice(0, 24)
}

/**
 * 标签明细清洗：`{ [tagId]: [{ label, kind, note, ref }] }`。
 *
 * 只保留**本节点确实归属**的标签的明细（与 graphSchema 的交叉校验同口径），
 * 条目按 label 去重（同名条目重复没有意义），出处复用 pickRefs 的归一化。
 */
function pickTagDetails(details, tagIds) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {}
  const owned = new Set(tagIds)
  const out = {}
  Object.entries(details).forEach(([rawTagId, rawItems]) => {
    const tagId = text(rawTagId, 60)
    if (!tagId || !owned.has(tagId) || !Array.isArray(rawItems)) return
    const seen = new Set()
    const items = []
    rawItems.slice(0, 200).forEach((item) => {
      const label = text(item?.label, 120)
      if (!label || seen.has(label)) return
      seen.add(label)
      const ref = Array.isArray(item?.ref) ? pickRefs([item.ref])[0] : item?.ref ? pickRefs([item.ref])[0] : null
      items.push({
        label,
        kind: text(item?.kind, 20),
        note: text(item?.note, 300),
        ref: ref ?? null,
      })
    })
    if (items.length) out[tagId] = items
  })
  return out
}

/** 源码路径归一化：POSIX 分隔符、去掉前导斜杠与 ./，避免落盘出平台相关的写法 */
function normalizeCodePath(value) {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .slice(0, 300)
}

/** 行号：正整数才认，其余（0 / null / 非数字）归 null = 「不指定」 */
function pickLine(value) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : null
}

/**
 * 引用归一化。notes 引用（docId）与源码引用（file）共用一条记录，
 * 只要两者有一个非空就保留——源码引用本来就常常没有 docId。
 */
function pickRefs(refs) {
  if (!Array.isArray(refs)) return []
  return refs
    .map((ref) => ({
      docId: text(ref?.docId, 240),
      anchor: text(ref?.anchor, 160),
      label: text(ref?.label, 160),
      file: normalizeCodePath(ref?.file),
      line: pickLine(ref?.line),
      endLine: pickLine(ref?.endLine),
    }))
    .filter((ref) => ref.docId || ref.file)
    .slice(0, 48)
}

/** 端口：只认 n/e/s/w，其余归 null = 自动吸附 */
const pickPort = (value) => (ARROW_PORTS.includes(value) ? value : null)

/** GET /api/graph —— 读取整图 */
graphRouter.get('/', (_req, res, next) => {
  readGraph()
    .then((graph) => res.json({ graph }))
    .catch(next)
})

/* ---------------- 全局标签注册表 ----------------
 * 与话题同一套模式：节点只存 id，名称/说明放注册表，所以**改名不动归属**。
 * id 取自名称（`tag:<名称>`）：可读、稳定、同名天然去重。
 */
const tagIdFor = (name) => `tag:${String(name).slice(0, 56)}`

const pickColor = (value) => {
  const color = text(value, 7)
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined
}

/** POST /api/graph/tags —— 登记一个全局标签；同名已存在时直接复用（幂等） */
graphRouter.post('/tags', (req, res, next) => {
  const body = applyFieldAliases(req.body || {})
  const name = text(body.name, 60)
  if (!name) {
    next(fail(400, '标签名称不能为空'))
    return
  }
  readGraph()
    .then((graph) => {
      const tags = graph.meta?.tags || []
      const existing = tags.find((tag) => tag.name === name)
      if (existing) {
        res.json({ graph, tag: existing, reused: true })
        return
      }
      if (tags.length >= MAX_TAGS) throw fail(400, `标签数已达上限 ${MAX_TAGS}`)
      const id = text(body.id, 60) || tagIdFor(name)
      if (tags.some((tag) => tag.id === id)) throw fail(409, `标签 id 已存在：${id}`)
      const color = pickColor(body.color)
      const tag = { id, name, description: text(body.description, 400), ...(color ? { color } : {}) }
      return writeGraph(
        { ...graph, meta: { ...graph.meta, tags: [...tags, tag], updatedAt: nowIso() } },
        'tag:create',
      ).then((saved) => res.status(201).json({ graph: saved, tag }))
    })
    .catch(next)
})

/** PATCH /api/graph/tags/:id —— 改名称 / 说明 / 颜色；id 不变，归属因此不受影响 */
graphRouter.patch('/tags/:id', (req, res, next) => {
  const id = req.params.id
  readGraph()
    .then((graph) => {
      const tags = graph.meta?.tags || []
      const tag = tags.find((item) => item.id === id)
      if (!tag) throw fail(404, `标签不存在：${id}`)
      const body = applyFieldAliases(req.body || {})
      if (body.name !== undefined) {
        const name = text(body.name, 60)
        if (!name) throw fail(400, '标签名称不能为空')
        if (tags.some((item) => item.id !== id && item.name === name)) throw fail(409, `标签名已存在：${name}`)
        tag.name = name
      }
      if (body.description !== undefined) tag.description = text(body.description, 400)
      if (body.color !== undefined) {
        const color = pickColor(body.color)
        if (color) tag.color = color
        else delete tag.color
      }
      return writeGraph(graph, 'tag:update').then((saved) => res.json({ graph: saved, tag }))
    })
    .catch(next)
})

/** DELETE /api/graph/tags/:id —— 注销标签，并把所有节点上的归属与明细一并摘掉 */
graphRouter.delete('/tags/:id', (req, res, next) => {
  const id = req.params.id
  readGraph()
    .then((graph) => {
      const tags = graph.meta?.tags || []
      const tag = tags.find((item) => item.id === id)
      if (!tag) throw fail(404, `标签不存在：${id}`)
      const next = {
        ...graph,
        meta: { ...graph.meta, tags: tags.filter((item) => item.id !== id), updatedAt: nowIso() },
        nodes: graph.nodes.map((node) => {
          if (!(node.tags || []).includes(id)) return node
          const details = { ...(node.tagDetails || {}) }
          delete details[id]
          return { ...node, tags: node.tags.filter((item) => item !== id), tagDetails: details }
        }),
      }
      return writeGraph(next, 'tag:delete').then((saved) => res.json({ graph: saved, removedTag: tag }))
    })
    .catch(next)
})

/**
 * 整图替换的护栏。
 *
 * 前端是「整图 PUT」：一个**还开着旧数据**的标签页（或一次半途而废的加载）就能把整个图覆盖掉。
 * 这不是假设——迁移好的 70 节点图谱被一个仍持有 24 节点旧数据的页面在 45 秒内连写 6 次，
 * 整份迁移凭空消失，而界面上没有任何提示。
 *
 * 规则：存量 ≥ 20 节点时，若这次写入要移除超过 55% 的节点，就拒绝并说清差值；
 * 确实要大刀阔斧精简时，带 `?force=1`（或 body 里 `force: true`）放行。
 * 阈值取得比较宽：正常的逐条删除每次只掉一两个节点，绝不会触发。
 *
 * 注：**前端已不再整图 PUT**（手动保存改为"另存为一份保留副本"，见 `store.writeArchive`），
 * 所以这道护栏现在防的是脚本与外部调用——保留的原因正是上面那次事故的教训。
 */
const DESTRUCTIVE_DROP_RATIO = 0.55
const DESTRUCTIVE_GUARD_MIN_NODES = 20

/** PUT /api/graph —— 整图替换（前端批量保存坐标时使用） */
graphRouter.put('/', (req, res, next) => {
  const body = req.body?.graph ? req.body : { graph: req.body }
  const result = parseGraph(body.graph)
  readGraph()
    .then((current) => {
      const force = req.query.force === '1' || body.force === true
      const before = current.nodes.length
      const removed = before - result.nodes.length
      if (
        !force &&
        before >= DESTRUCTIVE_GUARD_MIN_NODES &&
        removed > 0 &&
        removed / before > DESTRUCTIVE_DROP_RATIO
      ) {
        const percent = Math.round((removed / before) * 100)
        console.warn(`[graphify] 拦下一次破坏性写入：${before} → ${result.nodes.length} 节点（-${percent}%）`)
        next(
          fail(
            409,
            `这次保存会删掉 ${percent}% 的节点（${before} → ${result.nodes.length}），已拦下。` +
              '常见原因：另一个标签页还开着旧数据。请刷新那个页面；若确实要这样精简，请在请求里加 force=1。',
          ),
        )
        return null
      }
      return writeGraph(result, text(body.reason, 60) || 'graph:replace').then((saved) =>
        res.json({ graph: saved }),
      )
    })
    .catch(next)
})

/**
 * PATCH /api/graph/meta —— 只改图谱元信息（目前是名称）。
 *
 * 前端以前是"本地改 meta.name 然后整图 PUT"，那既慢又把整张图置于被覆盖的风险里。
 * 有了这个增量通道，改一个字段就只写一个字段。
 */
graphRouter.patch('/meta', (req, res, next) => {
  const body = req.body || {}
  readGraph()
    .then((graph) => {
      const meta = { ...graph.meta }
      if (body.name !== undefined) {
        const name = text(body.name, 80)
        if (!name) throw fail(400, '图谱名称不能为空')
        meta.name = name
      }
      return writeGraph({ ...graph, meta }, 'graph:rename').then((saved) => res.json({ graph: saved }))
    })
    .catch(next)
})

/**
 * POST /api/graph/save —— 手动保存：把本机整图**另存为一份保留副本**。
 *
 * 注意它**不写工作文件**：这是"最新看到的存一份"而不是"覆盖"。前端的两步保存是
 * 「先 POST /positions 把本机坐标增量写回工作文件 → 再打这个端点归档」。
 * 副本带保留标记，不参与历史轮转（见 `store.writeArchive`）。
 */
graphRouter.post('/save', (req, res, next) => {
  const body = req.body?.graph ? req.body : { graph: req.body }
  const result = parseGraph(body.graph)
  writeArchive(result, text(body.reason, 60) || 'graph:save-as')
    .then((archive) => res.status(201).json(archive))
    .catch(next)
})

/** POST /api/graph/nodes —— 新增节点 */
graphRouter.post('/nodes', (req, res, next) => {
  const body = applyFieldAliases(req.body || {})
  const label = text(body.label, 140)
  if (!label) {
    next(fail(400, '节点名称不能为空'))
    return
  }
  readGraph()
    .then((graph) => {
      const tags = pickTagIds(body.tags)
      const node = {
        id: newId('n'),
        label,
        type: NODE_TYPES.includes(body.type) ? body.type : 'concept',
        summary: text(body.summary, 600),
        tags,
        tagDetails: pickTagDetails(body.tagDetails, tags),
        refs: pickRefs(body.refs),
        topics: pickTopics(body.topics),
        parent: pickParent(body.parent, graph.nodes, ''),
        conditional: Boolean(body.conditional),
        position: pickPosition(body.position),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      return writeGraph({ ...graph, nodes: [...graph.nodes, node] }, 'node:create').then((saved) =>
        res.status(201).json({ graph: saved, node }),
      )
    })
    .catch(next)
})

/** PATCH /api/graph/nodes/:id —— 修改节点 */
graphRouter.patch('/nodes/:id', (req, res, next) => {
  const id = req.params.id
  readGraph()
    .then((graph) => {
      const node = graph.nodes.find((item) => item.id === id)
      if (!node) throw fail(404, `节点不存在：${id}`)
      const body = applyFieldAliases(req.body || {})
      if (body.label !== undefined) {
        const label = text(body.label, 140)
        if (!label) throw fail(400, '节点名称不能为空')
        node.label = label
      }
      if (body.type !== undefined && NODE_TYPES.includes(body.type)) node.type = body.type
      if (body.summary !== undefined) node.summary = text(body.summary, 600)
      if (body.tags !== undefined) node.tags = pickTagIds(body.tags)
      if (body.tagDetails !== undefined || body.tags !== undefined) {
        // 归属变了就按新归属裁剪明细：摘掉标签时它的明细一并消失，不留悬空数据
        node.tagDetails = pickTagDetails(body.tagDetails ?? node.tagDetails ?? {}, node.tags)
      }
      if (body.refs !== undefined) node.refs = pickRefs(body.refs)
      if (body.topics !== undefined) node.topics = pickTopics(body.topics)
      if (body.parent !== undefined) node.parent = pickParent(body.parent, graph.nodes, node.id)
      if (body.conditional !== undefined) node.conditional = Boolean(body.conditional)
      if (body.position !== undefined) node.position = pickPosition(body.position)
      node.updatedAt = nowIso()
      return writeGraph(graph, 'node:update').then((saved) => res.json({ graph: saved, node }))
    })
    .catch(next)
})

/**
 * POST /api/graph/positions —— 批量回写节点坐标（一次请求 = 一次写盘 = 一份快照）。
 *
 * 为什么必须批量：拖 20 个节点若逐节点 PATCH 就是 20 次写盘 20 份快照，几十次拖拽
 * 就能把 50 份历史刷满坐标噪声。前端把"只存在于本机的坐标改动"收集起来一次交上来。
 * 空对象直接返回当前图（不写盘、不产快照）。
 */
graphRouter.post('/positions', (req, res, next) => {
  const body = req.body || {}
  const positions = body.positions
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) {
    next(fail(400, 'positions 必须是一个对象：{ 节点 id: { x, y } }'))
    return
  }
  const requested = Object.keys(positions)
  if (requested.length === 0) {
    readGraph()
      .then((graph) => res.json({ graph, updated: 0, skipped: [] }))
      .catch(next)
    return
  }
  readGraph()
    .then((graph) => {
      const known = new Set(graph.nodes.map((node) => node.id))
      // 未知 id 与坐标非法的都如实回报，不静默吞掉
      const skipped = requested.filter((id) => !known.has(id))
      let updated = 0
      const nodes = graph.nodes.map((node) => {
        if (!Object.prototype.hasOwnProperty.call(positions, node.id)) return node
        const position = pickPosition(positions[node.id])
        if (!position) {
          skipped.push(node.id)
          return node
        }
        updated += 1
        return { ...node, position }
      })
      if (updated === 0) {
        res.json({ graph, updated: 0, skipped })
        return
      }
      return writeGraph({ ...graph, nodes }, text(body.reason, 60) || 'node:positions').then((saved) =>
        res.json({ graph: saved, updated, skipped }),
      )
    })
    .catch(next)
})

/** DELETE /api/graph/nodes/:id —— 删除节点并级联删除其关系 */
graphRouter.delete('/nodes/:id', (req, res, next) => {
  const id = req.params.id
  readGraph()
    .then((graph) => {
      const node = graph.nodes.find((item) => item.id === id)
      if (!node) throw fail(404, `节点不存在：${id}`)
      const removedEdges = graph.edges.filter((edge) => edge.source === id || edge.target === id)
      // 删掉容器节点时把子节点上提到祖父层，避免留下悬空的 compound 引用
      const next = {
        ...graph,
        nodes: graph.nodes
          .filter((item) => item.id !== id)
          .map((item) => (item.parent === id ? { ...item, parent: node.parent || null } : item)),
        edges: graph.edges.filter((edge) => edge.source !== id && edge.target !== id),
      }
      return writeGraph(next, 'node:delete').then((saved) =>
        res.json({ graph: saved, removedNode: node, removedEdges: removedEdges.length }),
      )
    })
    .catch(next)
})

/** POST /api/graph/edges —— 新增关系 */
graphRouter.post('/edges', (req, res, next) => {
  const body = applyFieldAliases(req.body || {})
  const source = text(body.source, 80)
  const target = text(body.target, 80)
  const label = text(body.label, 80)
  if (!source || !target) {
    next(fail(400, '关系的起点与终点不能为空'))
    return
  }
  if (!label) {
    next(fail(400, '关系名称不能为空'))
    return
  }
  readGraph()
    .then((graph) => {
      const exists = graph.nodes.some((node) => node.id === source) && graph.nodes.some((node) => node.id === target)
      if (!exists) throw fail(400, '关系的起点或终点节点不存在')
      const edge = {
        id: newId('e'),
        source,
        target,
        label,
        type: EDGE_TYPES.includes(body.type) ? body.type : 'relates_to',
        directed: body.directed ?? true,
        note: text(body.note, 400),
        sourcePort: pickPort(body.sourcePort),
        targetPort: pickPort(body.targetPort),
        conditional: Boolean(body.conditional),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      return writeGraph({ ...graph, edges: [...graph.edges, edge] }, 'edge:create').then((saved) =>
        res.status(201).json({ graph: saved, edge }),
      )
    })
    .catch(next)
})

/** PATCH /api/graph/edges/:id —— 修改关系 */
graphRouter.patch('/edges/:id', (req, res, next) => {
  const id = req.params.id
  readGraph()
    .then((graph) => {
      const edge = graph.edges.find((item) => item.id === id)
      if (!edge) throw fail(404, `关系不存在：${id}`)
      const body = applyFieldAliases(req.body || {})
      if (body.label !== undefined) {
        const label = text(body.label, 80)
        if (!label) throw fail(400, '关系名称不能为空')
        edge.label = label
      }
      if (body.type !== undefined && EDGE_TYPES.includes(body.type)) edge.type = body.type
      if (body.directed !== undefined) edge.directed = Boolean(body.directed)
      if (body.note !== undefined) edge.note = text(body.note, 400)
      if (body.sourcePort !== undefined) edge.sourcePort = pickPort(body.sourcePort)
      if (body.targetPort !== undefined) edge.targetPort = pickPort(body.targetPort)
      if (body.conditional !== undefined) edge.conditional = Boolean(body.conditional)
      if (body.source !== undefined) {
        const exists = graph.nodes.some((node) => node.id === body.source)
        if (!exists) throw fail(400, '新的起点节点不存在')
        edge.source = String(body.source)
      }
      if (body.target !== undefined) {
        const exists = graph.nodes.some((node) => node.id === body.target)
        if (!exists) throw fail(400, '新的终点节点不存在')
        edge.target = String(body.target)
      }
      edge.updatedAt = nowIso()
      return writeGraph(graph, 'edge:update').then((saved) => res.json({ graph: saved, edge }))
    })
    .catch(next)
})

/** DELETE /api/graph/edges/:id —— 取消关系 */
graphRouter.delete('/edges/:id', (req, res, next) => {
  const id = req.params.id
  readGraph()
    .then((graph) => {
      const edge = graph.edges.find((item) => item.id === id)
      if (!edge) throw fail(404, `关系不存在：${id}`)
      const next = { ...graph, edges: graph.edges.filter((item) => item.id !== id) }
      return writeGraph(next, 'edge:delete').then((saved) => res.json({ graph: saved, removedEdge: edge }))
    })
    .catch(next)
})

/** POST /api/graph/import —— LLM / 脚本建图端口，支持 dryRun 与幂等合并 */
graphRouter.post('/import', (req, res, next) => {
  // 归一化 snake_case 别名：docling-graph 生成的 Pydantic 模板与多数 LLM 都按 snake_case 输出
  const payload = applyFieldAliases(req.body || {})
  readGraph()
    .then((graph) => {
      const draft = {
        mode: payload.mode === 'replace' ? 'replace' : 'merge',
        nodes: payload.nodes || [],
        edges: payload.edges || [],
        meta: payload.meta,
      }
      const diff = applyDraft(graph, draft)
      const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true' || payload.dryRun === true
      if (dryRun) {
        res.json({ dryRun: true, preview: summarize(diff) })
        return
      }
      writeGraph(diff.graph, 'graph:import').then((saved) =>
        res.json({ dryRun: false, preview: summarize(diff), graph: saved }),
      )
    })
    .catch(next)
})

/** GET /api/graph/versions —— 快照列表 */
graphRouter.get('/versions', (_req, res, next) => {
  listSnapshots()
    .then((versions) => res.json({ versions }))
    .catch(next)
})

/** GET /api/graph/versions/:id —— 单个快照详情（含节点/关系数量与预览标签） */
graphRouter.get('/versions/:id', (req, res, next) => {
  readSnapshot(req.params.id)
    .then(({ meta, graph }) =>
      res.json({
        version: meta,
        graph: { ...graph, nodes: graph.nodes.slice(0, 12).map((node) => ({ id: node.id, label: node.label })) },
      }),
    )
    .catch(next)
})

/**
 * DELETE /api/graph/versions/:id —— 删除一份**保留副本**（手动另存的那一份）。
 *
 * 只对保留副本开放：自动快照的生命周期由轮转上限管理，放开逐个删除等于给"清空历史"开口子。
 */
graphRouter.delete('/versions/:id', (req, res, next) => {
  const id = path.basename(String(req.params.id))
  if (!isKeepName(id)) {
    next(fail(400, '只能删除保留副本：自动快照由轮转上限管理'))
    return
  }
  deleteArchive(id)
    .then((removed) => res.json({ removed }))
    .catch((err) =>
      next(fail(err.status || 404, err.status ? err.message : `副本不存在或已被删除：${id}`)),
    )
})

/** POST /api/graph/versions/:id/rollback —— 回滚到指定快照（回滚前会再存一份当前状态） */
graphRouter.post('/versions/:id/rollback', (req, res, next) => {
  rollbackToSnapshot(req.params.id)
    .then((saved) => res.json({ graph: saved, rolledBackTo: req.params.id }))
    .catch(next)
})

/**
 * 对外 schema 必须反映「当前生效的上限」：静态文件里写的是默认值（nodes 2000 / edges 6000），
 * 而真正执行校验的是 GRAPHIFY_MAX_NODES / GRAPHIFY_MAX_EDGES 解析出来的上限。
 * 关掉上限时删掉 maxItems——JSON Schema 没有「无穷」，字段缺省即不限制。
 */
function withEffectiveLimits(raw) {
  if (effectiveCaps.nodes === undefined && effectiveCaps.edges === undefined) return raw
  const parsed = JSON.parse(raw)
  const apply = (key, cap) => {
    if (cap === undefined) return
    const field = parsed?.properties?.[key]
    if (!field) return
    if (cap === null) delete field.maxItems
    else field.maxItems = cap
  }
  apply('nodes', effectiveCaps.nodes)
  apply('edges', effectiveCaps.edges)
  return JSON.stringify(parsed, null, 2)
}

/** GET /api/graph/schema —— 供 LLM 读取的 JSON Schema（含导入契约说明，上限与当前生效值一致） */
graphRouter.get('/schema', (_req, res, next) => {
  fs.readFile(new URL('../schema/graph.schema.json', import.meta.url), 'utf8')
    .then((raw) => {
      res.type('application/json').send(withEffectiveLimits(raw))
    })
    .catch(() => {
      res.status(404).json({ error: '未找到 schema 文件', distDir: DIST_DIR })
    })
})
