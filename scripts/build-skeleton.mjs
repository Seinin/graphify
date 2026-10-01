#!/usr/bin/env node
/**
 * 骨架生成器：把 docs/notes 的大纲（H1/H2）规则化地转成 Graphify 导入草案。
 *
 * 与 docling-graph 那条 LLM 抽取管线不同，这里**不含任何模型判断**：
 *   · 节点只来自文档自身大纲 —— 每篇 1 个文档节点 + N 个章节节点，天然自顶向下；
 *   · 锚点直接复用 mdIndex 的 slugify，与 /api/md 返回的 slug 同源，零失配；
 *   · 降噪名单（目录 / 阅读导航 / 参考文献 / 附录 / 变更记录…）与跨文档权威路由
 *     写在 data/skeleton.config.json，路由依据是人工维护的 docs/DIRECTORY.md §2；
 *   · 父子归属写成 node.parent（供画布 compound 折叠），不额外生成结构性边。
 *
 * 用法：
 *   node scripts/build-skeleton.mjs            # 生成 data/skeleton-draft.json
 *   node scripts/build-skeleton.mjs --stdout   # 只打印统计，不落盘
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listDocs, resolveDocId } from '../server/lib/mdIndex.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = path.join(ROOT, 'data', 'skeleton.config.json')
const OUT_PATH = path.join(ROOT, 'data', 'skeleton-draft.json')
const MAX_LABEL = 140
const MAX_SUMMARY = 600

/** 去掉行内 markdown 记号并压平空白，得到可直接上画布的标题 */
function cleanHeading(text) {
  return String(text ?? '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1$2')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL)
}

/** 归一化：用于「H1 与文档标题重复」判定与降噪名单比对 */
const norm = (text) => cleanHeading(text).toLowerCase().replace(/[\s\u3000·:：.、()《》"]/g, '')

/** 取章节正文的首个有效段落作为摘要（跳过代码块、列表、公式行） */
function sectionSummary(lines, startLine, endLine) {
  let inFence = false
  for (let i = startLine; i < Math.min(endLine, lines.length); i += 1) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (/^[>|\-*+\d]/.test(trimmed) || trimmed.startsWith('|')) continue
    const plain = trimmed
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/[`*_~$]/g, '')
      .replace(/[\s\u3000]+/g, ' ')
      .trim()
    if (plain.length < 8) continue
    return plain.length > 190 ? `${plain.slice(0, 190)}…` : plain
  }
  return ''
}

const sectionId = (docId, slug) => `sec:${docId}#${slug}`

async function main() {
  const standalone = process.argv.includes('--stdout')
  const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'))
  const docs = await listDocs({ force: true })
  const byDocId = new Map(docs.map((doc) => [doc.docId, doc]))

  const maxDepth = config.maxDepth || 2
  const dropExact = new Set((config.dropHeadings || []).map(norm))
  const dropPatterns = (config.dropHeadingPatterns || []).map((item) => new RegExp(item))

  const nodes = []
  const edges = []
  const nodeIds = new Set()
  const pendingRoutes = []
  const warnings = []
  const stats = { docs: 0, sections: 0, dropped: 0, routed: 0 }

  const push = (node) => {
    nodeIds.add(node.id)
    nodes.push(node)
    return node
  }

  for (const doc of docs) {
    const docTitle = cleanHeading(doc.title)
    const docNodeId = `doc:${doc.docId}`
    push({
      id: docNodeId,
      label: docTitle,
      type: 'doc',
      summary: String(doc.summary || '').slice(0, MAX_SUMMARY),
      tags: ['notes'],
      refs: [{ docId: doc.docId, anchor: '', label: docTitle }],
      parent: null,
    })
    stats.docs += 1

    const abs = resolveDocId(doc.docId)
    const content = abs ? await fs.readFile(abs, 'utf8').catch(() => '') : ''
    const lines = content.split(/\r?\n/)
    // 摘要下界按「所有标题」（含 H3+）切，否则 H2 的摘要会吃进子节正文
    const nextLineOf = new Map()
    doc.headings.forEach((heading, index) => {
      nextLineOf.set(heading, doc.headings[index + 1]?.line ?? lines.length + 1)
    })

    let topLevelId = docNodeId
    for (const heading of doc.headings) {
      if (heading.depth > maxDepth) continue
      const label = cleanHeading(heading.text)
      if (!label) {
        stats.dropped += 1
        continue
      }
      // 与文档标题重复的 H1 就是文档节点自身
      if (heading.depth === 1 && norm(label) === norm(docTitle)) {
        stats.dropped += 1
        continue
      }
      if (dropExact.has(norm(label)) || dropPatterns.some((re) => re.test(label))) {
        stats.dropped += 1
        continue
      }

      const route = (config.routes || []).find(
        (item) => item.match && item.match.docId === doc.docId && new RegExp(item.match.heading).test(label),
      )
      if (route && route.drop) {
        // 重合主题不复制内容，只留一条指向权威文档的「详见」指针
        pendingRoutes.push({ route, sourceId: null })
        stats.dropped += 1
        stats.routed += 1
        continue
      }

      const id = sectionId(doc.docId, heading.slug)
      if (nodeIds.has(id)) {
        warnings.push(`章节 id 重复，已跳过：${id}`)
        stats.dropped += 1
        continue
      }
      push({
        id,
        label,
        type: 'section',
        summary: sectionSummary(lines, heading.line, nextLineOf.get(heading) - 1),
        tags: [],
        refs: [{ docId: doc.docId, anchor: heading.slug, label }],
        parent: heading.depth === 1 ? docNodeId : topLevelId,
      })
      stats.sections += 1
      if (heading.depth === 1) topLevelId = id
      if (route) {
        pendingRoutes.push({ route, sourceId: id })
        stats.routed += 1
      }
    }
  }

  // ---------- 跨文档「详见」指针 ----------
  pendingRoutes.forEach(({ route, sourceId }, index) => {
    let fromId = sourceId
    if (!fromId && route.from) {
      const fromDoc = byDocId.get(route.from.docId)
      const matched = fromDoc?.headings.find(
        (heading) =>
          heading.depth <= maxDepth && new RegExp(route.from.heading).test(cleanHeading(heading.text)),
      )
      if (matched) fromId = sectionId(route.from.docId, matched.slug)
    }
    const toId = `doc:${route.toDoc}`
    if (!fromId || !nodeIds.has(fromId) || !nodeIds.has(toId)) {
      warnings.push(`路由未生效（源或目标不存在）：${route.match?.docId} → ${route.toDoc}`)
      return
    }
    edges.push({
      id: `ske:r${index + 1}`,
      source: fromId,
      target: toId,
      label: route.label,
      type: 'references',
      directed: true,
      note: route.note || '',
    })
  })

  // ---------- 文档之间的配套关系 ----------
  ;(config.docEdges || []).forEach((item, index) => {
    const fromId = `doc:${item.from}`
    const toId = `doc:${item.to}`
    if (!nodeIds.has(fromId) || !nodeIds.has(toId)) {
      warnings.push(`配套关系未生效：${item.from} → ${item.to}`)
      return
    }
    edges.push({
      id: `ske:d${index + 1}`,
      source: fromId,
      target: toId,
      label: item.label,
      type: 'relates_to',
      directed: false,
      note: '',
    })
  })

  const draft = {
    mode: 'replace',
    meta: {
      name: config.meta?.name || '知识骨架',
      description: config.meta?.description || '',
    },
    nodes,
    edges,
  }

  if (!standalone) {
    await fs.writeFile(OUT_PATH, `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
  }

  console.log(`${standalone ? '[预览] ' : '[已生成] '}${path.relative(ROOT, OUT_PATH)}`)
  console.log(`  文档 ${stats.docs} · 章节 ${stats.sections} · 合计节点 ${nodes.length} / 关系 ${edges.length}`)
  console.log(`  降噪丢弃 ${stats.dropped} 个标题 · 转「详见」指针 ${stats.routed} 处`)
  if (warnings.length) {
    console.warn(`  警告 ${warnings.length} 条：`)
    warnings.forEach((item) => console.warn(`    - ${item}`))
  }
}

main().catch((err) => {
  console.error('生成失败：', err.message)
  process.exitCode = 1
})
