import { Fragment, useMemo, type ReactNode } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * 标题文本里的**行内公式**：`$…$` 与 `\(…\)` 渲染成行内 KaTeX，其余照原样印。
 *
 * 为什么需要它：正文走阅读器那条 markdown 管线（remark-math + rehype-katex），
 * 但**目录（大纲）与「§ 当前小节」徽标不是正文**——它们拿的是服务端抽出的标题纯文本
 * （`server/lib/mdIndex.mjs` 的 `headings[].text`），标题里若写着 `$M_{\rm turn}$`，
 * 原先在这两处就是原样的 LaTeX 源码。
 *
 * 数学与文字混排，所以是行内模式（`displayMode: false`）——与 `Formula.tsx` 的"独立成行"分工不同。
 * `throwOnError: false` 与阅读器 / `Formula.tsx` 同一档：坏公式渲染成降级红字（`.heading-math .katex-error`），
 * 而不是让整个目录炸掉。输出是 KaTeX 的可信 HTML、文本来自本仓 markdown（与阅读器同一判断）。
 */
const MATH = /\$([^$\n]+)\$|\\\(([\s\S]+?)\\\)/g

function toNodes(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let key = 0

  for (const match of text.matchAll(MATH)) {
    const at = match.index ?? 0
    if (at > cursor) nodes.push(<Fragment key={key++}>{text.slice(cursor, at)}</Fragment>)
    const latex = match[1] ?? match[2] ?? ''
    nodes.push(
      <span
        key={key++}
        className="heading-math"
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(latex, { displayMode: false, throwOnError: false }),
        }}
      />,
    )
    cursor = at + match[0].length
  }

  if (cursor < text.length) nodes.push(<Fragment key={key++}>{text.slice(cursor)}</Fragment>)
  return nodes
}

export function HeadingText({ text }: { text: string }) {
  const nodes = useMemo(() => toNodes(text), [text])
  return <>{nodes}</>
}
