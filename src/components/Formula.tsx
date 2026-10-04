import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * 排过版的公式：把一份 LaTeX **独立成行**渲染出来。
 *
 * 用在检查器摘要位置那种"一句话说明"的位置上：带公式的对象（生成物里的 `formula`，逐字来自真源
 * `docText[id].formula`）由它承担，那个位置就不再是一个可编的伪公式文本框。
 *
 * 为什么直接调 KaTeX、不走 `MdReaderDrawer` 那套 markdown 管线：
 * 这里只需要**一条**公式；那条管线的存在理由是"站点文档里 Markdown 与公式混排"，
 * 为一条公式拖 remark-math + rehype-sanitize 白名单进来不划算。
 *
 * `throwOnError: false`：一条坏公式渲染成降级红字，而不是把整栏的 React 树炸掉。
 * **能不能渲染由自检守**——物理链自检对生成物里每条 `formula` 跑一次严格（`throwOnError: true`）渲染。
 * KaTeX 的输出是可信 HTML、公式来自本仓真源（不是用户输入），与阅读器那边的判断一致。
 *
 * 空串不渲染成空框：调用方本该只在有公式时才挂它，这里兜一道底。
 */
export function Formula({ latex }: { latex: string }) {
  const html = useMemo(
    () => katex.renderToString(latex, { displayMode: true, throwOnError: false }),
    [latex],
  )

  if (!latex.trim()) return null

  return <div className="formula-block" dangerouslySetInnerHTML={{ __html: html }} />
}
