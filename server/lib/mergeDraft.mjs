import { emptyGraph, newId, nowIso } from './schema.mjs'

const norm = (value) => String(value || '').trim().toLowerCase()

function keyOf(node) {
  return `id:${node.id}`
}

/**
 * 引用的身份取决于它**指向什么**：
 *   · 源码引用 → 文件 + 行区间（同一个文件的不同行是两条独立的引用）；
 *   · 文档引用 → docId + anchor。
 *
 * 早先只按 `docId::anchor` 去重，源码引用的 docId 为空、anchor 也为空，
 * 于是同一节点上的多条源码引用会塌成一条——重跑一次导入就丢引用（踩过：47 处 → 35 处）。
 */
function refKey(ref) {
  const file = String(ref.file ?? '').trim()
  if (file) {
    const line = ref.line ?? ''
    const endLine = ref.endLine ?? line
    return `code::${file}::${line}::${endLine}`
  }
  return `doc::${ref.docId}::${ref.anchor || ''}`
}

function unionRefs(prevRefs = [], nextRefs = []) {
  const map = new Map()
  prevRefs.forEach((ref) => map.set(refKey(ref), ref))
  nextRefs.forEach((ref) => {
    const key = refKey(ref)
    map.set(key, { ...(map.get(key) || {}), ...ref })
  })
  return [...map.values()]
}

function unionTags(prevTags = [], nextTags = []) {
  return [...new Set([...prevTags, ...nextTags])]
}

/** 话题归属是并集语义：草案只会「追加话题」，不会把节点从别的话题里摘掉 */
function unionTopics(prevTopics = [], nextTopics = []) {
  return [...new Set([...prevTopics, ...(nextTopics || [])])]
}

/** 注册表按 id 合并（草案侧覆盖同 id 条目的名称与说明），保证存量节点的话题归属不因草案只列部分话题而失效 */
function mergeTopics(baseTopics = [], draftTopics) {
  if (!draftTopics) return baseTopics
  const map = new Map(baseTopics.map((topic) => [topic.id, topic]))
  draftTopics.forEach((topic) => map.set(topic.id, topic))
  return [...map.values()]
}

/** 标签注册表同样按 id 合并（草案侧覆盖同 id 条目） */
function mergeTagRegistry(baseTags = [], draftTags) {
  if (!draftTags) return baseTags
  const map = new Map(baseTags.map((tag) => [tag.id, tag]))
  draftTags.forEach((tag) => map.set(tag.id, tag))
  return [...map.values()]
}

/**
 * 把草案里的标签写法解析成注册表 id。
 *
 * 草案（尤其是 LLM 生成的）习惯直接写**标签名**；注册表里存的是 id。
 * 因此这里按「先当 id 找、再当名字找、都没有就登记一个新标签」解析——
 * 保持 LLM 端口可用的同时，落盘数据里只有 id（改名不会让归属失效）。
 */
function resolveTagId(registry, token) {
  const raw = String(token ?? '').trim()
  if (!raw) return null
  const byId = registry.find((tag) => tag.id === raw)
  if (byId) return byId.id
  const byName = registry.find((tag) => tag.name === raw)
  if (byName) return byName.id
  const tag = { id: `tag:${raw.slice(0, 56)}`, name: raw, description: '' }
  registry.push(tag)
  return tag.id
}

/**
 * 将 LLM/脚本提交的草案合并进图谱。
 * 去重规则：节点优先按 id，其次按 label；边优先按 id，其次按 (source, target, label)。
 * 返回差异与逐条校验错误，供 dry-run 预览使用。
 */
export function applyDraft(currentGraph, draft) {
  const errors = []
  const created = { nodes: [], edges: [] }
  const updated = { nodes: [], edges: [] }
  /** 待解析的父节点声明：节点全部建好后统一按 id / 名称解析 */
  const pendingParents = []

  const base = draft.mode === 'replace' ? emptyGraph() : currentGraph
  /** 标签注册表（可增长）：草案里出现的新标签名在这里登记 */
  const tagRegistry = mergeTagRegistry(base.meta?.tags || [], draft.meta?.tags)
  const nodes = base.nodes.map((node) => ({
    ...node,
    refs: [...node.refs],
    tags: [...node.tags],
    tagDetails: { ...(node.tagDetails || {}) },
    topics: [...(node.topics || [])],
  }))
  const edges = base.edges.map((edge) => ({ ...edge }))

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const byLabel = new Map()
  nodes.forEach((node) => {
    if (!byLabel.has(norm(node.label))) byLabel.set(norm(node.label), node)
  })

  // ---------- 节点 ----------
  draft.nodes.forEach((draftNode, index) => {
    const label = String(draftNode.label ?? '').trim()
    if (!label) {
      // 缺 label 直接跳过：否则会建出一批空标签节点，并让按 label 解析的边全部失配
      errors.push({ index, reason: 'label 不能为空' })
      return
    }
    const existing = draftNode.id ? byId.get(draftNode.id) : byLabel.get(norm(label))
    if (existing) {
      existing.label = label
      existing.type = draftNode.type || existing.type
      if (draftNode.summary) existing.summary = draftNode.summary
      existing.tags = unionTags(
        existing.tags,
        (draftNode.tags || []).map((token) => resolveTagId(tagRegistry, token)).filter(Boolean),
      )
      existing.refs = unionRefs(existing.refs, draftNode.refs)
      if (draftNode.topics) existing.topics = unionTopics(existing.topics, draftNode.topics)
      if (draftNode.parent !== undefined) pendingParents.push({ node: existing, token: draftNode.parent, index })
      // 语义标记可以随草案更新；**坐标不更新**——否则重跑一次导入就会把用户手摆的版面冲掉
      if (draftNode.conditional !== undefined) existing.conditional = Boolean(draftNode.conditional)
      existing.updatedAt = nowIso()
      updated.nodes.push(existing.id)
      return
    }

    const node = {
      id: draftNode.id || newId('n'),
      label,
      type: draftNode.type || 'concept',
      summary: draftNode.summary || '',
      // 草案里按名字写的标签在这里解析成注册表 id（并登记新标签）
      tags: (draftNode.tags || []).map((token) => resolveTagId(tagRegistry, token)).filter(Boolean),
      tagDetails: {},
      refs: draftNode.refs || [],
      topics: draftNode.topics || [],
      parent: null,
      conditional: Boolean(draftNode.conditional),
      /**
       * 草案里给了坐标就用它：迁移既有图纸（层带 / 步骤都有确定位置）时，
       * 「导入即摆好版面」比导完再手摆一遍有意义得多。没给坐标则保持 null。
       */
      position: draftNode.position ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    if (byId.has(node.id)) {
      errors.push({ index, reason: `节点 id 重复：${node.id}` })
      return
    }
    nodes.push(node)
    byId.set(node.id, node)
    if (!byLabel.has(norm(label))) byLabel.set(norm(label), node)
    created.nodes.push(node)
    if (draftNode.parent !== undefined) pendingParents.push({ node, token: draftNode.parent, index })
  })

  // ---------- 关系 ----------
  const resolve = (token) => {
    const direct = byId.get(token)
    if (direct) return direct
    return byLabel.get(norm(token)) || null
  }

  // ---------- 分组（compound 父节点） ----------
  // 放在节点全部就位之后解析，草案就可以先声明子节点、后声明父节点。
  const ancestorIds = (node) => {
    const seen = new Set()
    let cursor = node
    while (cursor) {
      if (seen.has(cursor.id)) return null // 已存在的环
      seen.add(cursor.id)
      cursor = cursor.parent ? byId.get(cursor.parent) || null : null
    }
    return seen
  }

  pendingParents.forEach(({ node, token, index }) => {
    if (!token) {
      // 显式声明为顶层，不算错误
      node.parent = null
      return
    }
    const target = resolve(token)
    if (!target || target.id === node.id || (ancestorIds(target) || new Set()).has(node.id)) {
      node.parent = null
      const reason = !target
        ? `父节点未匹配：${token}`
        : target.id === node.id
          ? `父节点不能是自己：${token}`
          : `父子关系成环：${node.label} → ${target.label}`
      errors.push({ index, reason: `节点「${node.label}」的${reason}` })
      return
    }
    node.parent = target.id
  })

  draft.edges.forEach((draftEdge, index) => {
    const label = String(draftEdge.label ?? '').trim()
    if (!label) {
      errors.push({ index, reason: 'label 不能为空' })
      return
    }
    const source = resolve(draftEdge.source)
    const target = resolve(draftEdge.target)
    if (!source) {
      errors.push({ index, reason: `source 未匹配到节点：${draftEdge.source}` })
      return
    }
    if (!target) {
      errors.push({ index, reason: `target 未匹配到节点：${draftEdge.target}` })
      return
    }

    const existing =
      (draftEdge.id && edges.find((edge) => edge.id === draftEdge.id)) ||
      edges.find(
        (edge) =>
          edge.source === source.id &&
          edge.target === target.id &&
          norm(edge.label) === norm(label),
      )

    if (existing) {
      existing.label = label
      existing.type = draftEdge.type || existing.type
      existing.directed = draftEdge.directed ?? existing.directed
      // 语义标记随草案更新（与节点一致：可更新、不是布局）
      if (draftEdge.conditional !== undefined) existing.conditional = Boolean(draftEdge.conditional)
      if (draftEdge.sourcePort !== undefined) existing.sourcePort = draftEdge.sourcePort
      if (draftEdge.targetPort !== undefined) existing.targetPort = draftEdge.targetPort
      if (draftEdge.note) existing.note = draftEdge.note
      existing.updatedAt = nowIso()
      updated.edges.push(existing.id)
      return
    }

    const edge = {
      id: draftEdge.id || newId('e'),
      source: source.id,
      target: target.id,
      label,
      type: draftEdge.type || 'relates_to',
      directed: draftEdge.directed ?? true,
      conditional: Boolean(draftEdge.conditional),
      sourcePort: draftEdge.sourcePort ?? null,
      targetPort: draftEdge.targetPort ?? null,
      note: draftEdge.note || '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    if (edges.some((item) => item.id === edge.id)) {
      errors.push({ index, reason: `关系 id 重复：${edge.id}` })
      return
    }
    edges.push(edge)
    created.edges.push(edge)
  })

  const meta = {
    ...base.meta,
    name: draft.meta?.name || base.meta.name,
    description: draft.meta?.description ?? base.meta.description,
    // 注册表按 id 合并、草案侧的同 id 条目覆盖名称与说明。
    // 不做整体替换：merge 模式下若草案只列部分话题，会连带让存量节点的话题归属失效。
    // replace 模式下 base 是空图，合并结果就等于草案本身。
    topics: mergeTopics(base.meta.topics, draft.meta?.topics),
    // 标签注册表：合并结果的注册表就是解析时用的那一份（含草案新增的标签）
    tags: tagRegistry,
    updatedAt: nowIso(),
  }

  return {
    graph: { meta, nodes, edges },
    applied: { nodes: created.nodes.length + updated.nodes.length, edges: created.edges.length + updated.edges.length },
    created,
    updated,
    errors,
  }
}

/** 供导入预览使用：仅统计不落盘 */
export function summarize(diff) {
  return {
    applied: diff.applied,
    createdNodes: diff.created.nodes.map((node) => ({ id: node.id, label: node.label })),
    updatedNodeIds: diff.updated.nodes,
    createdEdges: diff.created.edges.map((edge) => ({ id: edge.id, label: edge.label })),
    updatedEdgeIds: diff.updated.edges,
    errors: diff.errors,
  }
}

export { keyOf }
