#!/usr/bin/env node
/**
 * 代码逻辑拓扑生成器（大纲 v2）：把大纲（data/code.outline.json）编译成 Graphify 导入草案。
 *
 * 与 build-nion-graph.mjs（Nion 积分概念树）同源，区别只有三处：
 *   · 输入/输出路径指向 data/code.outline.json 与 data/code-draft.json；
 *   · 层级深度上限取自大纲的 meta.maxDepth（本树声明 5 层），不再写死常量；
 *   · 默认元信息与边 id 前缀改成代码拓扑的一套。
 * 大纲本身由 scripts/export-code-outline.mjs 从 docs/notes/CODE_TOPOLOGY.md 导出，
 * 因此这里的节点是「人工撰写的框架文档」的机械翻译，生成器只负责两件事：
 *   1. 锚点解析：大纲里只写「标题文本或正则」，slug 一律由 server/lib/mdIndex.mjs
 *      的真实 heading.slug 回填 —— 与 /api/md 同源，这是锚点零失配的唯一保证；
 *   2. 严格校验：任何解析不到、指向不存在、超长、类型非法、成环、超深、话题未注册
 *      的问题都**报错退出**，不静默降级（拒绝产出「看起来成功但锚点全丢」的草案）。
 *
 * 结构表达（v2 起只有一套）：
 *   · 层级 → node.parent。单父字段本身就是「无环」的结构前提，生成器再做一次独立 DFS 复核；
 *   · 话题 → node.topics[] + meta.topics 注册表。一个节点可归多个话题，
 *     话题视图**只含本话题成员**；父链越出话题的成员提升为顶层，以此保住 compound
 *     父子关系（把祖先容器设成 display:none 并不能让子节点继续显示）；
 *   · 主树零边：大纲不写 links 时草案 edges 为空数组（层级已由 parent 表达，无需边）。
 *     若日后要恢复跨支语义，可继续用 links[] 声明，生成器会照旧校验。
 *
 * 用法：
 *   node scripts/export-code-outline.mjs                   # 先由文档导出大纲
 *   node scripts/build-code-graph.mjs                      # 再生成 data/code-draft.json
 *   node scripts/build-code-graph.mjs --stdout             # 只打印统计与锚点解析结果，不落盘
 *   node scripts/build-code-graph.mjs --anchors            # 额外打印每个 refs 解析到的 slug 明细
 *   node scripts/build-code-graph.mjs --topics             # 额外打印各话题的成员/顶层方块数（含提升而来的数量）
 *   node scripts/build-code-graph.mjs --topics=code-ion    # 只详列某个话题的成员、提升后父级与顶层方块
 *   node scripts/build-code-graph.mjs --outline=a.json     # 换一份大纲（用于校验回归测试，不写默认草案路径）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listDocs } from '../server/lib/mdIndex.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTLINE_PATH = path.join(ROOT, 'data', 'code.outline.json')
const OUT_PATH = path.join(ROOT, 'data', 'code-draft.json')

/** 与 server/lib/schema.mjs 保持一致的上限，越界一律报错而不是截断 */
const LIMITS = {
  nodeId: 80,
  parent: 80,
  label: 140,
  summary: 600,
  tag: 40,
  tags: 24,
  refs: 48,
  anchor: 160,
  refLabel: 160,
  metaName: 120,
  metaDescription: 400,
  edgeLabel: 80,
  edgeNote: 400,
  topicId: 40,
  topicName: 60,
  topicDescription: 200,
}
/** 话题数量上限（与 schema.mjs 的 MAX_TOPICS 同口径） */
const MAX_TOPICS = 12
/**
 * 层级深度上限（含阶段根）：由大纲的 meta.maxDepth 声明，读到时才赋值。
 * 阶段根算第 1 层；大纲没声明即报错退出，避免「上限写死在代码里、换一棵树就静默失效」。
 */
let MAX_DEPTH = 0
const NODE_TYPES = new Set([
  'concept',
  'doc',
  'section',
  'method',
  'result',
  'question',
  'dataset',
  'tool',
])
const EDGE_TYPES = new Set([
  'depends_on',
  'relates_to',
  'derives_from',
  'references',
  'contradicts',
  'extends',
])
const DEFAULT_NODE_TYPE = 'concept'
const DEFAULT_EDGE_TYPE = 'depends_on'

/**
 * 压平 markdown 与公式记号：画布节点上只应出现纯文本。
 * 注意**不要**剥 `_` 与 `*`：这两者是物理符号本身（N_ion、f_*、M_turn、α_*），
 * 与文档标题场景不同（build-skeleton 里可以剥，因为标题不用下标记号）。
 * 这里只去掉 $ 定界符、反引号与 LaTeX 命令，保留公式内容文本。
 */
function cleanText(text, max) {
  const plain = String(text ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/\$/g, '')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
  return max ? plain.slice(0, max) : plain
}

async function main() {
  const argv = process.argv.slice(2)
  const stdoutOnly = argv.includes('--stdout')
  const showAnchors = argv.includes('--anchors') || stdoutOnly
  const topicArg = argv.find((item) => item.startsWith('--topics'))
  const showTopics = Boolean(topicArg)
  const topicDetail = topicArg && topicArg.includes('=') ? topicArg.split('=')[1].trim() : ''
  // 换一份大纲：只用于把「成环 / 超深 / 话题未注册」这类校验跑成回归测试，
  // 且不允许覆盖默认草案路径，避免误把测试产物写进 data/nion-draft.json。
  const outlineArg = argv.find((item) => item.startsWith('--outline='))
  const outlinePath = outlineArg ? path.resolve(ROOT, outlineArg.split('=')[1].trim()) : OUTLINE_PATH
  const customOutline = outlinePath !== OUTLINE_PATH

  const errors = []
  const warnings = []
  const stats = { anchors: 0, byDoc: new Map() }

  const outline = JSON.parse(await fs.readFile(outlinePath, 'utf8'))
  // 深度上限只认大纲声明：换一棵树不必改代码，漏声明也不会退回某个隐形常量
  const declaredMaxDepth = Number(outline.meta?.maxDepth)
  if (!Number.isInteger(declaredMaxDepth) || declaredMaxDepth < 1 || declaredMaxDepth > 6) {
    console.error('生成失败：大纲 meta.maxDepth 必须是 1 到 6 的整数（阶段根算第 1 层）')
    process.exitCode = 1
    return
  }
  MAX_DEPTH = declaredMaxDepth
  const docs = await listDocs({ force: true })
  const byDocId = new Map(docs.map((doc) => [doc.docId, doc]))

  /** 把 { docId, heading } 解析成 { docId, anchor, label } */
  const resolveRef = (spec, owner) => {
    if (!spec || typeof spec !== 'object') {
      errors.push(`${owner}：refs 项必须是 { docId, heading } 对象`)
      return null
    }
    const doc = byDocId.get(spec.docId)
    if (!doc) {
      errors.push(`${owner}：未知 docId「${spec.docId}」（可用：${docs.map((d) => d.docId).join(', ')}）`)
      return null
    }
    let re
    try {
      re = new RegExp(String(spec.heading ?? ''))
    } catch (err) {
      errors.push(`${owner}：heading 正则非法「${spec.heading}」（${err.message}）`)
      return null
    }
    // 原文与压平后的文本都参与匹配，但每个标题至多命中一次
    const matched = doc.headings.filter((h) => re.test(h.text) || re.test(cleanText(h.text)))
    if (matched.length === 0) {
      errors.push(`${owner}：锚点解析失败 —— ${spec.docId} 中没有任何标题匹配 /${spec.heading}/`)
      return null
    }
    if (matched.length > 1 && spec.pick !== 'first') {
      const list = matched.slice(0, 6).map((h) => `L${h.line} ${cleanText(h.text, 40)}`).join(' | ')
      errors.push(
        `${owner}：锚点歧义 —— /${spec.heading}/ 在 ${spec.docId} 命中 ${matched.length} 个标题（${list}）；请收紧正则或显式写 pick:"first"`,
      )
      return null
    }
    const hit = matched[0]
    stats.anchors += 1
    stats.byDoc.set(spec.docId, (stats.byDoc.get(spec.docId) || 0) + 1)
    if (showAnchors) {
      console.log(
        `      ${spec.docId}#${hit.slug || '(空)'}  ←  L${hit.line} ${cleanText(hit.text)}${matched.length > 1 ? `  [pick=first, 共 ${matched.length} 命中]` : ''}`,
      )
    }
    return {
      docId: doc.docId,
      anchor: String(hit.slug ?? '').slice(0, LIMITS.anchor),
      label: cleanText(hit.text, LIMITS.refLabel),
    }
  }

  const checkTags = (tags, owner) => {
    const list = Array.isArray(tags) ? tags : []
    if (list.length > LIMITS.tags) {
      errors.push(`${owner}：tags 超过 ${LIMITS.tags} 个`)
    }
    list.forEach((tag) => {
      if (String(tag).trim().length === 0) errors.push(`${owner}：存在空 tag`)
      if (String(tag).length > LIMITS.tag) errors.push(`${owner}：tag「${tag}」超过 ${LIMITS.tag} 字符`)
    })
    return list.map((tag) => String(tag).trim())
  }

  // ---------- 1. 话题注册表 ----------
  console.log(`大纲：${path.relative(ROOT, outlinePath)}${customOutline ? '（校验模式，不落盘）' : ''}`)
  const rawTopics = Array.isArray(outline.topics) ? outline.topics : []
  if (rawTopics.length > MAX_TOPICS) errors.push(`话题注册表超过 ${MAX_TOPICS} 项`)
  const registry = []
  const registryIds = new Set()
  rawTopics.forEach((topic, index) => {
    const owner = `topics[${index}]`
    const id = String(topic?.id ?? '').trim()
    const name = String(topic?.name ?? '').trim()
    const description = cleanText(topic?.description ?? '', LIMITS.topicDescription + 1)
    if (!id) {
      errors.push(`${owner}：缺少话题 id`)
      return
    }
    if (id.length > LIMITS.topicId) errors.push(`${owner}：id「${id}」超过 ${LIMITS.topicId} 字符`)
    if (registryIds.has(id)) errors.push(`${owner}：话题 id 重复：${id}`)
    if (!name) errors.push(`${owner}：缺少话题名称`)
    if (name.length > LIMITS.topicName) {
      errors.push(`${owner}：名称「${name}」超过 ${LIMITS.topicName} 字符`)
    }
    if (description.length > LIMITS.topicDescription) {
      errors.push(`${owner}：description 超过 ${LIMITS.topicDescription} 字符`)
    }
    if (id && /[|]/.test(id)) errors.push(`${owner}：话题 id 不应包含分隔符「|」（可见集指纹用它做分隔）`)
    registryIds.add(id)
    registry.push({ id, name, description })
  })
  console.log(`  话题注册表 ${registry.length} 个：${registry.map((t) => `${t.id}(${t.name})`).join(' · ') || '(空)'}`)

  // ---------- 2. 节点 ----------
  const rawNodes = Array.isArray(outline.nodes) ? outline.nodes : []
  if (!rawNodes.length) errors.push('nodes 为空：没有可生成的节点（v2 大纲必须是扁平 nodes 数组）')

  const nodes = []
  const ids = new Set()
  const byId = new Map()
  const seenLabels = new Map()

  rawNodes.forEach((raw, index) => {
    const owner = raw?.id ? String(raw.id) : `nodes[${index}]`
    const id = String(raw?.id ?? '').trim()
    if (!id) {
      errors.push(`${owner}：缺少 id`)
      return
    }
    if (id.length > LIMITS.nodeId) errors.push(`${id}：id 超过 ${LIMITS.nodeId} 字符`)
    if (ids.has(id)) errors.push(`节点 id 重复：${id}`)
    ids.add(id)

    const type = raw.type || DEFAULT_NODE_TYPE
    if (!NODE_TYPES.has(type)) {
      errors.push(`${owner}：非法节点类型「${type}」（可用：${[...NODE_TYPES].join('/')}）`)
    }
    const label = cleanText(raw.label, LIMITS.label + 1)
    if (!label) errors.push(`${owner}：label 为空`)
    if (label.length > LIMITS.label) errors.push(`${owner}：label 超过 ${LIMITS.label} 字符`)
    if (label) {
      const key = label.toLowerCase()
      if (seenLabels.has(key)) errors.push(`${owner}：label 与 ${seenLabels.get(key)} 重复（「${label}」）`)
      else seenLabels.set(key, id)
    }
    const summary = cleanText(raw.summary, LIMITS.summary + 1)
    if (!summary) errors.push(`${owner}：summary 为空（策划节点必须写摘要）`)
    if (summary.length > LIMITS.summary) errors.push(`${owner}：summary 超过 ${LIMITS.summary} 字符`)

    const refs = (Array.isArray(raw.refs) ? raw.refs : []).map((spec) => resolveRef(spec, owner)).filter(Boolean)
    if (refs.length > LIMITS.refs) errors.push(`${owner}：refs 超过 ${LIMITS.refs} 条`)

    // 话题归属：id 必须已注册；节点至少要归入一个话题（否则它只在「全部」视图里出现）
    const rawTopicsOfNode = Array.isArray(raw.topics) ? raw.topics : []
    if (rawTopicsOfNode.length > MAX_TOPICS) errors.push(`${owner}：topics 超过 ${MAX_TOPICS} 项`)
    const topics = []
    rawTopicsOfNode.forEach((value) => {
      const topicId = String(value ?? '').trim()
      if (!topicId) {
        errors.push(`${owner}：存在空话题 id`)
        return
      }
      if (!registryIds.has(topicId)) errors.push(`${owner}：引用了未注册的话题「${topicId}」`)
      if (!topics.includes(topicId)) topics.push(topicId)
    })
    if (!topics.length) errors.push(`${owner}：未归属任何话题（每个节点至少要在一个话题视图里出现）`)

    const parent = raw.parent === undefined || raw.parent === null ? null : String(raw.parent).trim()
    if (parent && parent.length > LIMITS.parent) errors.push(`${owner}：parent 超过 ${LIMITS.parent} 字符`)
    if (parent === id) errors.push(`${owner}：parent 不能是自己`)

    const node = { id, label, type, summary, tags: checkTags(raw.tags, owner), refs, topics, parent }
    nodes.push(node)
    if (!byId.has(id)) byId.set(id, node)
  })

  // ---------- 3. 父链：存在 / 无环 / 可达 / 深度 ----------
  const children = new Map()
  nodes.forEach((node) => {
    if (!node.parent) return
    if (!byId.has(node.parent)) {
      errors.push(`${node.id}：parent「${node.parent}」不存在`)
      return
    }
    if (!children.has(node.parent)) children.set(node.parent, [])
    children.get(node.parent).push(node.id)
  })

  /** 同一条环只报一次：环上每个节点上溯都会撞见它，逐节点报会刷屏 */
  const reportedCycles = new Set()
  /** 沿 parent 上溯：返回深度（根为 1）；遇环返回 null 并记一条错误 */
  const depthOf = (node) => {
    const chain = [node.id]
    const index = new Map([[node.id, 0]])
    let cursor = node
    let depth = 1
    while (cursor.parent && byId.has(cursor.parent)) {
      const next = cursor.parent
      if (index.has(next)) {
        // 环 = 链上从「首次出现处」到当前节点这一段，用成员集合做去重键，
        // 这样挂在环下面的节点也不会各自再报一遍。
        const cycle = chain.slice(index.get(next))
        const key = [...cycle].sort().join('|')
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key)
          errors.push(`${node.id}：父链成环（${cycle.join(' → ')} → ${next}）`)
        }
        return null
      }
      index.set(next, chain.length)
      chain.push(next)
      cursor = byId.get(next)
      depth += 1
    }
    return depth
  }

  const depthHistogram = new Map()
  nodes.forEach((node) => {
    const depth = depthOf(node)
    if (depth === null) return
    node.depth = depth
    depthHistogram.set(depth, (depthHistogram.get(depth) || 0) + 1)
    if (depth > MAX_DEPTH) {
      errors.push(`${node.id}：深度 ${depth} 超过上限 ${MAX_DEPTH}（根算第 1 层）`)
    }
  })

  // 无不可达节点：上溯必然终止于 parent=null（环已在上面报错），这里只做一次显式复核
  nodes.forEach((node) => {
    let cursor = node
    const seen = new Set([node.id])
    while (cursor.parent) {
      const next = byId.get(cursor.parent)
      if (!next || seen.has(next.id)) return // 缺父/成环已报错
      seen.add(next.id)
      cursor = next
    }
    if (cursor.parent) errors.push(`${node.id}：不在任何一棵以 null 为根的树里`)
  })

  const roots = nodes.filter((node) => !node.parent)

  // ---------- 4. 话题视图：只含本话题成员，父链越界的成员提升为顶层 ----------
  // 与 src/lib/topics.ts 的 topicView 同规则：每个成员沿 parent 上溯取最近的同话题祖先，
  // 一个都没有则为顶层。归属数据没变时，前端算出的可见集应与这里逐项一致。
  const topicStats = registry.map((topic) => {
    const members = nodes.filter((node) => node.topics.includes(topic.id))
    const memberIds = new Set(members.map((node) => node.id))
    const liftedParent = new Map()
    members.forEach((member) => {
      const seen = new Set([member.id])
      let parentId = member.parent
      let lifted = null
      while (parentId && byId.has(parentId) && !seen.has(parentId)) {
        if (memberIds.has(parentId)) {
          lifted = parentId
          break
        }
        seen.add(parentId)
        parentId = byId.get(parentId).parent
      }
      liftedParent.set(member.id, lifted)
    })
    const topLevel = members.filter((node) => liftedParent.get(node.id) === null)
    return { topic, members, memberIds, liftedParent, topLevel }
  })

  topicStats.forEach((entry) => {
    if (!entry.members.length) errors.push(`话题「${entry.topic.id}」没有任何成员节点`)
    // 成员非空时顶层方块必然存在（沿父链上溯一定停在某个成员上），这里只作兜底断言
    if (!entry.topLevel.length) {
      errors.push(`话题「${entry.topic.id}」没有顶层方块（本话题内找不到父链闭合的成员）`)
    }
  })

  // ---------- 5. 边（v2 主树零边；大纲若声明 links 则照旧校验） ----------
  const edges = []
  const edgeKeys = new Set()
  const makeEdge = (raw, fallbackLabel, owner) => {
    const type = raw.type || DEFAULT_EDGE_TYPE
    if (!EDGE_TYPES.has(type)) {
      errors.push(`${owner}：非法关系类型「${type}」（可用：${[...EDGE_TYPES].join('/')}）`)
    }
    const label = cleanText(raw.label || fallbackLabel, LIMITS.edgeLabel + 1)
    if (!label) errors.push(`${owner}：关系 label 为空`)
    if (label.length > LIMITS.edgeLabel) {
      errors.push(`${owner}：关系 label「${label}」超过 ${LIMITS.edgeLabel} 字符（schema 上限）`)
    }
    const note = cleanText(raw.note, LIMITS.edgeNote + 1)
    if (note.length > LIMITS.edgeNote) errors.push(`${owner}：note 超过 ${LIMITS.edgeNote} 字符`)
    if (!ids.has(raw.from)) errors.push(`${owner}：source「${raw.from}」不存在`)
    if (!ids.has(raw.to)) errors.push(`${owner}：target「${raw.to}」不存在`)
    const key = `${raw.from}|${type}|${raw.to}`
    if (edgeKeys.has(key)) {
      errors.push(`${owner}：重复关系 ${raw.from} --${type}--> ${raw.to}`)
      return
    }
    edgeKeys.add(key)
    edges.push({
      id: `code:e${edges.length + 1}`,
      source: raw.from,
      target: raw.to,
      label,
      type,
      directed: raw.directed !== false,
      note,
    })
  }
  if (Array.isArray(outline.links) && outline.links.length) {
    warnings.push(`大纲声明了 ${outline.links.length} 条 links：主树本应零边，请确认这是有意为之`)
    outline.links.forEach((item, i) => {
      makeEdge(
        { from: item.from, to: item.to, type: item.type, label: item.label, note: item.note, directed: item.directed },
        '相关',
        `links[${i}]`,
      )
    })
  }

  // ---------- 6. 元信息 ----------
  const metaName = String(outline.meta?.name ?? '').trim() || '代码逻辑拓扑'
  const metaDescription = cleanText(outline.meta?.description, LIMITS.metaDescription + 1)
  if (metaName.length > LIMITS.metaName) errors.push(`meta.name 超过 ${LIMITS.metaName} 字符`)
  if (metaDescription.length > LIMITS.metaDescription) {
    errors.push(`meta.description 超过 ${LIMITS.metaDescription} 字符`)
  }

  if (errors.length) {
    console.error(`\n校验失败 ${errors.length} 条，未生成草案：`)
    errors.forEach((item) => console.error(`  - ${item}`))
    process.exitCode = 1
    return
  }
  if (warnings.length) {
    console.warn(`警告 ${warnings.length} 条：`)
    warnings.forEach((item) => console.warn(`  - ${item}`))
  }

  const draft = {
    mode: 'replace',
    meta: { name: metaName, description: metaDescription, topics: registry },
    nodes: nodes.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      summary: node.summary,
      tags: node.tags,
      refs: node.refs,
      topics: node.topics,
      // 显式写 null，import 时才能把「顶层」与「未声明」区分开
      parent: node.parent,
    })),
    edges,
  }

  if (!stdoutOnly && !customOutline) {
    await fs.writeFile(OUT_PATH, `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
  }

  // ---------- 7. 统计 ----------
  console.log(`\n${stdoutOnly ? '[预览] ' : '[已生成] '}${path.relative(ROOT, OUT_PATH)}`)
  console.log(`  节点 ${nodes.length} · 顶层 ${roots.length} 个根（${roots.map((n) => n.id).join(', ')}）· 关系 ${edges.length}`)
  console.log(
    `  深度分布：${[...depthHistogram.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([depth, count]) => `L${depth}×${count}`)
      .join(' · ')}（上限 ${MAX_DEPTH} 层）`,
  )
  console.log(
    `  锚点解析 ${stats.anchors} 条全部命中真实标题 · 覆盖文档：${[...stats.byDoc.entries()]
      .map(([docId, n]) => `${docId}×${n}`)
      .join(' · ')}`,
  )

  if (showTopics || stdoutOnly) {
    console.log('  话题（可见 = 成员；父链越出话题的成员提升为顶层，以此保住 compound 关系）：')
    topicStats.forEach((entry) => {
      const lifted = entry.members.filter((node) => entry.liftedParent.get(node.id) === null && node.parent).length
      console.log(
        `    ${entry.topic.id.padEnd(8)} 成员 ${String(entry.members.length).padStart(2)} · 顶层方块 ${String(
          entry.topLevel.length,
        ).padStart(2)}（其中由提升而来 ${lifted}）· 折叠后可收起 ${entry.members.length - entry.topLevel.length}`,
      )
    })
  }

  if (topicDetail) {
    const entry = topicStats.find((item) => item.topic.id === topicDetail)
    if (!entry) {
      console.error(`\n--topics=${topicDetail}：话题不存在（可选：${registry.map((t) => t.id).join(', ')}）`)
      process.exitCode = 1
      return
    }
    console.log(`\n[topic:${entry.topic.id}] ${entry.topic.name} —— ${entry.topic.description}`)
    console.log(`  顶层方块（${entry.topLevel.length}）：`)
    entry.topLevel.forEach((node) =>
      console.log(`    ${node.id}  ${node.label}${node.parent ? `  （提升自 ${node.parent}）` : ''}`),
    )
    console.log(`  成员（${entry.members.length}，挂在本话题父级下的用 ↑ 标出）：`)
    entry.members.forEach((node) => {
      const lifted = entry.liftedParent.get(node.id)
      const where = !node.parent ? '(顶层)' : lifted === null ? `⤴提升（真实父级 ${node.parent}）` : `↑${lifted}`
      console.log(`    ${node.id}  L${node.depth}  ${where}  ${node.label}`)
    })
  }

  console.log(
    `  校验：id/parent/类型/长度/锚点全部合规 · 层级无环且 ≤${MAX_DEPTH} 层 · 话题引用均已注册 · 错误 0 · 警告 ${
      warnings.length
    }`,
  )
}

main().catch((err) => {
  console.error('生成失败：', err.message)
  process.exitCode = 1
})
