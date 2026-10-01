import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini'

/** 只注册知识库中常见的语言，避免把 Prism 全量语法打进包里 */
const LANGUAGES: Record<string, unknown> = {
  bash,
  sh: bash,
  shell: bash,
  json,
  jsonc: json,
  python,
  py: python,
  javascript,
  js: javascript,
  typescript,
  ts: typescript,
  c,
  cpp,
  toml,
  yaml,
  yml: yaml,
  markdown,
  md: markdown,
  sql,
  ini,
}

Object.entries(LANGUAGES).forEach(([name, definition]) => {
  SyntaxHighlighter.registerLanguage(name, definition as never)
})
import { Copy, ExternalLink, Link2, List, Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'
import { Badge, Separator } from './ui/badge'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip } from './ui/tooltip'
import { useMdContent } from '../hooks/useMdLibrary'
import { anchorDomId, findHeading, headingIndent } from '../lib/slug'
import { cn, formatChars } from '../lib/utils'
import { copyText, openInVscode } from '../lib/vscode'
import type { GraphRef, MdHeading } from '../lib/types'

/**
 * 允许标题上的 id，便于锚点定位；其余沿用 rehype-sanitize 默认白名单。
 *
 * 数学公式相关：remark-math 产出的不是自定义标签，而是
 * `<code class="language-math math-display">`（块级，外面还套一层 `<pre>`）与
 * `<code class="language-math math-inline">`（行内）。rehype-sanitize 默认对 `code`
 * 只放行 /^language-./ 的类名，会把 `math-display` / `math-inline` 丢掉，
 * 因此这里在保留原正则的前提下显式补上这两个类名（只是两个字面量，不放宽其它属性）。
 * `language-math` 必须留下：rehype-katex 靠它识别待渲染元素。
 */
const baseSchema = defaultSchema as unknown as { attributes?: Record<string, unknown[]> }
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...baseSchema.attributes,
    code: [['className', /^language-./, 'math-display', 'math-inline']],
    '*': [...(baseSchema.attributes?.['*'] ?? []), 'id', 'className'],
  },
} as typeof defaultSchema

const HEADING_CLASS: Record<number, string> = {
  1: 'mb-3 mt-1 border-b border-black/[0.07] pb-2 text-heading font-semibold',
  2: 'mb-2.5 mt-5 text-subhead font-semibold',
  3: 'mb-2 mt-4 text-tiny font-semibold',
  4: 'mb-1.5 mt-3 text-tiny font-medium',
}

interface MdReaderDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  docId: string | null
  anchor: string | null
  canAddRef: boolean
  onAddRef: (ref: GraphRef) => void
}

export function MdReaderDrawer({ open, onOpenChange, docId, anchor, canAddRef, onAddRef }: MdReaderDrawerProps) {
  const { doc, loading, error } = useMdContent(open ? docId : null)
  const [showToc, setShowToc] = useState(true)

  const activeHeading = useMemo(() => (doc && anchor ? findHeading(doc.headings, anchor) : null), [doc, anchor])

  const headings = useMemo(() => (doc ? doc.headings.filter((heading) => heading.depth <= 3) : []), [doc])

  useEffect(() => {
    if (!open || !doc || !anchor) return
    const timer = setTimeout(() => {
      document.getElementById(anchorDomId(doc.docId, anchor))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 140)
    return () => clearTimeout(timer)
  }, [open, doc, anchor])

  const jumpTo = (slug: string) => {
    if (!doc) return
    document.getElementById(anchorDomId(doc.docId, slug))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const targetLine = activeHeading?.line ?? 1

  const openInEditor = () => {
    if (!doc) return
    const result = openInVscode(doc.absolutePath, targetLine)
    if (!result.ok) copyText(`${doc.absolutePath}:${targetLine}`)
  }

  const renderHeading = (depth: number) => (props: { children?: React.ReactNode }) => {
    const text = String(props.children ?? '')
    const heading: MdHeading | undefined = doc?.headings.find((item) => item.text === text)
    const Tag = `h${depth}` as 'h1' | 'h2' | 'h3' | 'h4'
    return (
      <Tag
        id={doc && heading ? anchorDomId(doc.docId, heading.slug) : undefined}
        className={cn('scroll-mt-4 text-foreground/92', HEADING_CLASS[depth])}
      >
        {props.children}
      </Tag>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" width="w-[620px]" className="gap-0 p-0">
        <SheetHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="truncate">{doc?.title ?? docId ?? '文档'}</SheetTitle>
              <SheetDescription className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="truncate font-mono">{doc?.docId ?? docId}</span>
                {doc ? <Badge tone="muted">{formatChars(doc.chars)}</Badge> : null}
                {activeHeading ? <Badge tone="primary">§ {activeHeading.text}</Badge> : null}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip content="折叠 / 展开目录">
                <Button variant="ghost" size="icon-sm" onClick={() => setShowToc((prev) => !prev)}>
                  <List className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="复制文件路径与行号">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => doc && copyText(`${doc.absolutePath}:${targetLine}`)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="用 vscode:// 协议在编辑器中打开">
                <Button variant="secondary" size="sm" onClick={openInEditor} disabled={!doc}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  在 VS Code 中打开
                </Button>
              </Tooltip>
            </div>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 min-w-0 flex-1">
          {showToc && headings.length > 0 ? (
            <>
              <nav className="flex w-[188px] shrink-0 flex-col">
                <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="pr-2">
                  <ol className="flex min-w-0 flex-col gap-0.5 p-2">
                    {headings.map((heading) => {
                      const isActive = activeHeading?.slug === heading.slug
                      return (
                        <li key={heading.slug}>
                          <button
                            type="button"
                            onClick={() => jumpTo(heading.slug)}
                            style={{ paddingLeft: 10 + headingIndent(heading.depth) }}
                            className={cn(
                              'w-full cursor-pointer truncate rounded px-2 py-1 pr-2 text-left text-micro transition-colors',
                              isActive
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground',
                            )}
                          >
                            {heading.text}
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                </ScrollArea>
              </nav>
              <Separator orientation="vertical" />
            </>
          ) : null}

          <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="py-4 pl-5 pr-[30px]">
            {loading ? (
              <div className="flex items-center gap-2 py-10 text-micro text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在读取…
              </div>
            ) : error ? (
              <p className="py-10 text-micro text-destructive">{error}</p>
            ) : doc ? (
              <article className="md-body min-w-0 break-words text-tiny leading-[1.85]">
                <ReactMarkdown
                  // 顺序不可颠倒：remark-math 先把 $...$ 转成带 language-math 的 code 元素，
                  // sanitize 放行该元素，最后才由 rehype-katex 渲染成 KaTeX 结构
                  // （katex 的输出是可信 HTML，若放在 sanitize 之前会被白名单剥掉）。
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[
                    [rehypeSanitize, sanitizeSchema],
                    [rehypeKatex, { throwOnError: false, strict: 'ignore', errorColor: '#dc2626' }],
                  ]}
                  components={{
                    h1: renderHeading(1),
                    h2: renderHeading(2),
                    h3: renderHeading(3),
                    h4: renderHeading(4),
                    p: ({ children }) => <p className="mb-3 text-foreground/85">{children}</p>,
                    ul: ({ children }) => <ul className="mb-3 ml-4 list-disc space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-3 ml-4 list-decimal space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="text-foreground/85">{children}</li>,
                    hr: () => <hr className="my-4 border-black/[0.07]" />,
                    table: ({ children }) => (
                      <div className="mb-3 overflow-x-auto rounded-md border border-black/[0.07]">
                        <table className="w-full border-collapse text-micro">{children}</table>
                      </div>
                    ),
                    thead: ({ children }) => <thead className="bg-black/[0.04]">{children}</thead>,
                    th: ({ children }) => (
                      <th className="border-b border-black/[0.07] px-2.5 py-1.5 text-left font-semibold text-foreground/90">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border-b border-black/[0.05] px-2.5 py-1.5 align-top text-foreground/80">
                        {children}
                      </td>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="mb-3 border-l-2 border-primary/50 bg-primary/[0.07] px-3 py-2 text-foreground/78">
                        {children}
                      </blockquote>
                    ),
                    a: ({ children, href }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                      >
                        {children}
                      </a>
                    ),
                    pre: ({ children }) => <>{children}</>,
                    code: ({ className, children }) => {
                      const language = /language-(\w+)/.exec(className ?? '')?.[1]
                      if (language && LANGUAGES[language]) {
                        return (
                          <SyntaxHighlighter
                            language={language}
                            style={oneLight}
                            customStyle={{
                              margin: '0 0 12px',
                              borderRadius: 10,
                              fontSize: 12,
                              background: 'rgba(15,23,42,0.035)',
                              border: '1px solid rgba(15,23,42,0.07)',
                              // 长代码行在代码块自身区域内横滚，不撑破抽屉
                              overflowX: 'auto',
                            }}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        )
                      }
                      return (
                        <code className="rounded bg-black/[0.06] px-1 py-[1px] font-mono text-[11.5px] text-primary">
                          {children}
                        </code>
                      )
                    },
                  }}
                >
                  {doc.content}
                </ReactMarkdown>
              </article>
            ) : null}
          </ScrollArea>
        </div>

        {canAddRef && doc ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-black/[0.07] px-4 py-2.5">
            <span className="truncate text-micro text-muted-foreground">
              {activeHeading ? `将引用定位到「${activeHeading.text}」` : '引用整个文档'}
            </span>
            <Button
              size="sm"
              className="shrink-0"
              onClick={() =>
                onAddRef({
                  docId: doc.docId,
                  anchor: activeHeading?.slug ?? '',
                  label: activeHeading?.text ?? doc.title,
                })
              }
            >
              <Link2 className="h-3.5 w-3.5" />
              加入当前节点引用
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
