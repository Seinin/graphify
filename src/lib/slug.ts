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

/**
 * 标题里的中文序号前缀（`一、`、`十、`…）：**只是排版，不算名字的一部分**。
 * 模块文档里的标题写成 `## 八、<成员标签>`，而节点的笔记引用锚在**成员标签**上，
 * 所以算锚点之前先把号剥掉；服务端 `server/lib/mdIndex.mjs` 与自检各持同一份规则。
 */
export function stripSectionNumber(text: string) {
  return String(text || '').replace(/^[一二三四五六七八九十百]+[、.．]\s*/, '')
}

/** 标题的锚点：先剥序号，再 slug 化（与服务端 `mdIndex.headingSlug` 同口径） */
export function headingSlug(text: string) {
  return slugify(stripSectionNumber(text))
}

/** 渲染 markdown 时给标题挂的 DOM id，避免不同文档之间冲突 */
export function anchorDomId(docId: string, slug: string) {
  return `md-${slugify(docId) || 'doc'}--${slug}`
}

/** 转换阶段用得到的最小 hast 形状：标记名、文本、属性、位置与子节点 */
interface HastNode {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  position?: { start?: { line?: number; column?: number } }
  children?: HastNode[]
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** 拼出一个节点里的全部文字：行内代码与公式的原文都还在 text 里 */
function plainTextOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(plainTextOf).join('')
}

/**
 * 给正文标题挂锚点 id，六个层级都挂。
 *
 * 不在 React 组件里按 children 反查标题，是因为 children 已经是**渲染后**的东西：
 * 标题里只要有行内代码、公式或强调，它就成了元素数组，跟大纲里的 markdown 原文对不上，
 * 那个标题就挂不上 id，点目录或按引用定位便沉默不动；标题文本重名时（同一篇文档里同名的小节）
 * 又会一起挂到第一次出现的那个 id 上，点哪一节都跳到第一节去。
 *
 * 这里改在 markdown 转 HTML 的阶段，按**节点顺序**发 id，口径与服务端 `parseMarkdown` 完全一致：
 * 同一个 base slug 第 N 次出现记作 `<base>-N`，算出来是空的标题退化为 `section-<行号>`。
 * 标题文字也在这一步定型，公式那里取到的是 LaTeX 原文（`$f_{\rm coll}$` 与 `f_{\rm coll}` 的
 * slug 相同），不会因为 KaTeX 渲染出的结构而走样。
 *
 * 因此这个转换器必须排在 rehype-katex 之前，且它不关心标题的排印，只管锚点。
 */
export function rehypeHeadingAnchors(docId: string) {
  return (tree: HastNode) => {
    const used = new Map<string, number>()
    const visit = (node: HastNode) => {
      const column = node.position?.start?.column
      // 引用块、列表项里的 `#` 也算标题，但服务端按「行首就是 #」识别，大纲里没有它们；
      // 漏掉这一层，这些标题会白占一次同名计数，把后面同名标题的 `-N` 顶偏。
      const isOutlineHeading = Boolean(node.tagName && HEADING_TAGS.has(node.tagName) && (!column || column === 1))
      if (isOutlineHeading) {
        const base = headingSlug(plainTextOf(node)) || `section-${node.position?.start?.line ?? used.size + 1}`
        const seen = used.get(base) ?? 0
        used.set(base, seen + 1)
        node.properties = { ...node.properties, id: anchorDomId(docId, seen === 0 ? base : `${base}-${seen}`) }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
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
