import fs from 'node:fs/promises'
import path from 'node:path'
import { MD_DIR, MD_EXTENSIONS } from './paths.mjs'

/** 目录扫描结果缓存：{ key: { signature, docs } } */
let cache = { signature: '', docs: [] }

/**
 * 生成标题锚点 slug（与前端 src/lib/slug.ts 保持一致）。
 * 中文标题保留原字符，仅做小写化、空白转连字符与标点清理。
 */
export function slugify(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
    .replace(/[\s\u3000]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 标题里的中文序号前缀（`一、`、`十、`…）：只是排版，不算名字的一部分。
 * 模块文档的标题写成 `## 八、<成员标签>`，而节点的笔记引用锚在**成员标签**上，
 * 所以算锚点前先把号剥掉；前端 `src/lib/slug.ts` 持有同一份规则。
 */
export function stripSectionNumber(text) {
  return String(text || '').replace(/^[一二三四五六七八九十百]+[、.．]\s*/, '')
}

/** 标题的锚点：先剥序号，再 slug 化（与前端 `headingSlug` 同口径） */
export function headingSlug(text) {
  return slugify(stripSectionNumber(text))
}

/** 相对路径 <-> docId（统一使用 POSIX 分隔符） */
export function toDocId(absPath) {
  return path.relative(MD_DIR, absPath).split(path.sep).join('/')
}

/** 解析 docId 为绝对路径，并校验是否越出 notes 目录 */
export function resolveDocId(docId) {
  const normalized = String(docId || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) return null
  const abs = path.resolve(MD_DIR, normalized)
  const base = path.resolve(MD_DIR)
  if (abs !== base && !abs.startsWith(`${base}${path.sep}`)) return null
  return abs
}

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, out)
      continue
    }
    if (MD_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full)
  }
  return out
}

async function signatureOf(files) {
  const stats = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(file).catch(() => null)
      return `${file}:${stat?.size ?? 0}:${stat?.mtimeMs ?? 0}`
    }),
  )
  return stats.join('|')
}

/** 解析 markdown 正文，抽出标题树与摘要 */
export function parseMarkdown(content, fallbackTitle) {
  const lines = String(content || '').split(/\r?\n/)
  const headings = []
  const usedSlugs = new Map()
  let inFence = false
  let title = ''
  let summary = ''

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return
    }
    if (inFence) return

    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (match) {
      const depth = match[1].length
      const text = match[2].trim()
      if (!text) return
      const base = headingSlug(text) || `section-${index + 1}`
      const seen = usedSlugs.get(base) || 0
      usedSlugs.set(base, seen + 1)
      const slug = seen === 0 ? base : `${base}-${seen}`
      headings.push({ depth, text, slug, line: index + 1 })
      if (!title && depth === 1) title = text
      return
    }

    if (summary) return
    const trimmed = line.trim()
    if (!trimmed) return
    if (/^[>|\-*+`\d]/.test(trimmed)) return
    summary = trimmed
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .trim()
  })

  return {
    title: title || fallbackTitle,
    summary: summary.length > 180 ? `${summary.slice(0, 180)}…` : summary,
    headings,
  }
}

/** 扫描 notes 数据库，返回文档列表（含大纲与统计） */
export async function listDocs({ force = false } = {}) {
  await fs.mkdir(MD_DIR, { recursive: true })
  const files = await walk(MD_DIR)
  const signature = await signatureOf(files)
  if (!force && signature === cache.signature) return cache.docs

  const docs = await Promise.all(
    files.map(async (file) => {
      const [content, stat] = await Promise.all([
        fs.readFile(file, 'utf8').catch(() => ''),
        fs.stat(file).catch(() => null),
      ])
      const docId = toDocId(file)
      const parsed = parseMarkdown(content, path.basename(file, path.extname(file)))
      return {
        docId,
        fileName: path.basename(file),
        folder: path.dirname(docId) === '.' ? '' : path.dirname(docId),
        title: parsed.title,
        summary: parsed.summary,
        headings: parsed.headings,
        chars: content.length,
        updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : '',
      }
    }),
  )

  docs.sort((a, b) => a.docId.localeCompare(b.docId, 'zh-Hans-CN'))
  cache = { signature, docs }
  return docs
}

/** 读取单篇文档原文 + 大纲 */
export async function readDoc(docId) {
  const abs = resolveDocId(docId)
  if (!abs) throw Object.assign(new Error('非法的文档路径'), { status: 400 })
  const content = await fs.readFile(abs, 'utf8').catch(() => {
    throw Object.assign(new Error(`未找到文档：${docId}`), { status: 404 })
  })
  const parsed = parseMarkdown(content, path.basename(abs, path.extname(abs)))
  const stat = await fs.stat(abs).catch(() => null)
  return {
    docId: toDocId(abs),
    absolutePath: abs,
    title: parsed.title,
    summary: parsed.summary,
    headings: parsed.headings,
    content,
    chars: content.length,
    updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : '',
  }
}

/** 失效缓存（notes 目录内容变化后由路由调用） */
export function invalidateMdCache() {
  cache = { signature: '', docs: [] }
}
