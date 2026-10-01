import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import type { CodeLine, CodeWindow, LexPrefix } from '../lib/types'

/**
 * 源码渲染：行号 + 语法高亮 + 目标行区间底色。
 *
 * 两个入口，都是这一份视觉规则：
 *   · `CodeBlock`——按**一个连续区间**渲染（抽屉：把已加载的段合并后一段一块），
 *     一个块只做一次词法分析，跨行构造不会被接缝切断；
 *   · `CodeSnippet`——单个行窗口的薄封装（选择器：围绕引用行的固定窗口）。
 *
 * 为什么自己包一层而不是直接用 SyntaxHighlighter：
 *   · 行号必须从**文件真实行号**开始（`startingLineNumber`），否则窗口从第 500 行开始时行号从 1 数；
 *   · 高亮区间要在**窗口内**换算，且首行（真正被引用的那行）比上下文更重；
 *   · 词法前缀（`lexPrefix`）要拼进待分析文本、却不能被渲染出来；
 *   · 预览与选择器要共用同一套视觉，避免两处各写一份高亮规则。
 */
const LANGUAGES: Record<string, unknown> = {
  bash,
  c,
  cpp,
  css,
  javascript,
  json,
  python,
  toml,
  typescript,
  // 这些是索引层给出的语言名，Prism 里没有同名包，映射到最接近的语法
  tsx: typescript,
  fortran: c,
  text: undefined,
}

Object.entries(LANGUAGES).forEach(([name, definition]) => {
  if (definition) SyntaxHighlighter.registerLanguage(name, definition as never)
})

/** 目标行底色（与高亮首行的强调色区分开） */
const HIGHLIGHT_BG = 'rgba(250, 204, 21, 0.18)'
const FOCUS_BG = 'rgba(250, 204, 21, 0.34)'

export interface CodeBlockProps {
  /** 要渲染的行（一个连续区间：行号连续） */
  lines: CodeLine[]
  /** Prism 语言名；不在白名单里就退化为不高亮 */
  language: string
  /** 本块首行的文件行号（1 起） */
  startLine: number
  /** 要强调的行区间；`highlightStart <= 0` 表示本块不含引用行 */
  highlightStart: number
  highlightEnd: number
  /**
   * 让本块首行处于正确词法状态的那一行（见 `LexPrefix`）：拼在待分析文本最前面，
   * 但**不渲染**——显示出来会让行号从上一段跳到本段，也会与已加载的上一段重复一行。
   */
  lexPrefix?: LexPrefix | null
  /** 紧凑模式：预览面板与选择器里的高度不同，行距与字号跟着收一档 */
  compact?: boolean
}

export function CodeBlock({
  lines,
  language,
  startLine,
  highlightStart,
  highlightEnd,
  lexPrefix = null,
  compact = false,
}: CodeBlockProps) {
  const registered = language && LANGUAGES[language] ? language : undefined
  /** 只在真的"在窗口之前"时才拼：同段之内不需要，越界的值也一律忽略 */
  const prelude = lexPrefix && lexPrefix.start < startLine ? lexPrefix : null
  /** 拼在最前面的行数：词法前缀固定是**一行**（开启构造的那一行原文） */
  const preludeLines = prelude ? 1 : 0
  const text = (prelude ? `${prelude.text}\n` : '') + lines.map((line) => line.text).join('\n')
  const emphasize = highlightStart > 0 && highlightEnd >= highlightStart

  return (
    <SyntaxHighlighter
      language={registered}
      style={oneLight}
      showLineNumbers
      /**
       * 行号必须按"这一行在文件里的真实行号"给。`startingLineNumber` 是**顺序编号**：
       * 隐藏的前缀行也占一格，若从 `startLine` 起数，后面每一行都会被顶掉 1 位
       * （实测：`code-line-644` 里装的其实是第 654 行，滚动与高亮全都错位）。
       * 所以起点往前挪"前缀行数"格——那一格正好被不显示的前缀行吃掉，可见行就回到了真行号。
       */
      startingLineNumber={startLine - preludeLines}
      wrapLines
      // 每一行都挂一个 id：预览打开时要能直接滚到目标行，与 md 阅读器的做法一致
      lineProps={(lineNumber: number) => {
        // 词法前缀那一行只参与语法分析：连它的行号一起隐藏（行号在行元素内）
        if (prelude && lineNumber < startLine) return { style: { display: 'none' } }
        const inRange = emphasize && lineNumber >= highlightStart && lineNumber <= highlightEnd
        const isFocus = emphasize && lineNumber === highlightStart
        return {
          id: `code-line-${lineNumber}`,
          style: {
            display: 'block',
            background: isFocus ? FOCUS_BG : inRange ? HIGHLIGHT_BG : undefined,
            boxShadow: isFocus ? 'inset 3px 0 0 0 #d97706' : undefined,
          },
        }
      }}
      customStyle={{
        margin: 0,
        padding: '10px 0 10px 0',
        background: 'transparent',
        fontSize: compact ? 11 : 11.5,
        lineHeight: 1.65,
      }}
      lineNumberStyle={{
        minWidth: compact ? '2.4em' : '3em',
        paddingRight: '0.9em',
        color: '#94a3b8',
        userSelect: 'none',
      }}
      codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' } }}
    >
      {text}
    </SyntaxHighlighter>
  )
}

export interface CodeSnippetProps {
  code: CodeWindow
  /** 紧凑模式：预览面板与选择器里的高度不同，行距与字号跟着收一档 */
  compact?: boolean
}

/** 单个行窗口（选择器的区间预览用它；抽屉按连续区间渲染，用 `CodeBlock`） */
export function CodeSnippet({ code, compact = false }: CodeSnippetProps) {
  return (
    <CodeBlock
      lines={code.lines}
      language={code.language}
      startLine={code.windowStart}
      highlightStart={code.highlightStart}
      highlightEnd={code.highlightEnd}
      lexPrefix={code.lexPrefix}
      compact={compact}
    />
  )
}
