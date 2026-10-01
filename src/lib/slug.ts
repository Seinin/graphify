import type { MdHeading } from './types'

/**
 * 标题锚点生成规则，必须与服务端 server/lib/mdIndex.mjs 的 slugify 保持一致。
 * 中文标题保留汉字，仅小写化、空白转连字符并移除标点。
 */
export function slugify(text: string) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
    .replace(/[\s\u3000]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** 渲染 markdown 时给标题挂的 DOM id，避免不同文档之间冲突 */
export function anchorDomId(docId: string, slug: string) {
  return `md-${slugify(docId) || 'doc'}--${slug}`
}

/** 在标题树中按 slug 查找标题，找不到时退回最接近的层级 */
export function findHeading(headings: MdHeading[], slug: string) {
  if (!slug) return null
  return (
    headings.find((heading) => heading.slug === slug) ??
    headings.find((heading) => heading.slug.startsWith(slug)) ??
    null
  )
}

/** 标题层级缩进（用于大纲树渲染） */
export function headingIndent(depth: number) {
  return Math.max(0, Math.min(depth, 6) - 1) * 12
}

/** 从 markdown 正文抽取第一个标题文本，作为文档回退标题 */
export function firstHeadingText(content: string) {
  const match = /^#{1,6}\s+(.*)$/m.exec(content || '')
  return match ? match[1].trim() : ''
}
