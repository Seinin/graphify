#!/usr/bin/env node
/**
 * LaTeX 渲染冒烟校验（只读，不修改任何文件）。
 *
 * 两部分：
 *  1) 覆盖率：扫 docs/notes 下全部 markdown，抽出 $$...$$ 与 $...$，逐个交给
 *     katex.renderToString({ throwOnError: true })，统计渲染失败的公式。
 *     失败数为 0 才说明「全量公式可渲染」，而不是靠肉眼抽查。
 *  2) 管线：用 react-dom/server 把一段含行内/显示公式的 markdown 走一遍与
 *     MdReaderDrawer 完全相同的插件三元组，断言
 *       - 输出里出现 KaTeX 结构（class="katex"）与 display 包装（katex-display）
 *       - 不残留 $$ 与 <code class="language-math">
 *       - 不兼容命令降级为 .katex-error 而不是整块消失
 *     这一步专门守「rehype-sanitize 把 math 占位元素剥掉导致公式全没了」这个最高风险点。
 *
 * 另有一条源码契约断言：插件三元组必须与 MdReaderDrawer.tsx 保持一致，
 * 任何一侧改动而另一侧没跟上都会在这里报错。
 *
 * 用法：node scripts/check-latex.mjs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import katex from 'katex'
import { MD_DIR } from '../server/lib/paths.mjs'

const DRAWER_FILE = path.resolve(import.meta.dirname, '..', 'src', 'components', 'MdReaderDrawer.tsx')

/* ------------------------------------------------------------------ *
 * 与 MdReaderDrawer.tsx 保持一致的 sanitize 白名单
 * ------------------------------------------------------------------ */

const baseSchema = defaultSchema
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...baseSchema.attributes,
    code: [['className', /^language-./, 'math-display', 'math-inline']],
    '*': [...(baseSchema.attributes?.['*'] ?? []), 'id', 'className'],
  },
}

const remarkPlugins = [remarkGfm, remarkMath]
const rehypePlugins = [
  [rehypeSanitize, sanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: 'ignore', errorColor: '#f87171' }],
]

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

async function walkMarkdown(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkMarkdown(full, out)
      continue
    }
    if (/\.(md|markdown)$/i.test(entry.name)) out.push(full)
  }
  return out
}

function walkNodes(node, onNode) {
  onNode(node)
  if (Array.isArray(node.children)) node.children.forEach((child) => walkNodes(child, onNode))
}

/**
 * 用 remark-math 本身抽取公式节点，而不是自己拿正则切 $。
 * 这样「统计口径」与「应用实际渲染口径」完全一致：围栏代码、行内代码、
 * 转义 \$、以及 micromark 对空白的规则都由插件负责判定。
 */
function collectMath(content) {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(content)
  const display = []
  const inline = []
  walkNodes(tree, (node) => {
    if (node.type === 'math') display.push(node.value)
    else if (node.type === 'inlineMath') inline.push(node.value)
  })
  return { display, inline }
}

/* ------------------------------------------------------------------ *
 * 1) 覆盖率
 * ------------------------------------------------------------------ */

async function checkCoverage() {
  const files = await walkMarkdown(MD_DIR)
  if (!files.length) {
    console.error(`未在 ${MD_DIR} 下找到任何 markdown`)
    process.exit(1)
  }

  let displayCount = 0
  let inlineCount = 0
  let delimiterPairs = 0
  const failures = []

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8').catch(() => '')
    const { display, inline } = collectMath(content)
    const docId = path.relative(MD_DIR, file).split(path.sep).join('/')
    displayCount += display.length
    inlineCount += inline.length
    delimiterPairs += ((content.match(/\$\$/g) || []).length / 2) | 0

    for (const [kind, list] of [
      ['display', display],
      ['inline', inline],
    ]) {
      for (const body of list) {
        try {
          katex.renderToString(body, { throwOnError: true, displayMode: kind === 'display', strict: 'ignore' })
        } catch (error) {
          failures.push({ docId, kind, body, error: String(error?.message ?? error) })
        }
      }
    }
  }

  console.log(`扫描 ${files.length} 篇文档：显示公式 ${displayCount} 个，行内公式 ${inlineCount} 个`)
  console.log(`（原文中 $$ 定界对约 ${delimiterPairs} 个，差额来自围栏代码块内的 $$）`)
  if (failures.length) {
    console.log(`\n渲染失败 ${failures.length} 个：`)
    for (const item of failures.slice(0, 20)) {
      console.log(`  [${item.kind}] ${item.docId}\n    ${item.body.replace(/\s+/g, ' ').slice(0, 140)}\n    ${item.error}`)
    }
    if (failures.length > 20) console.log(`  … 另有 ${failures.length - 20} 个`)
  } else {
    console.log('KaTeX 覆盖率：全部公式渲染通过')
  }

  return failures.length
}

/* ------------------------------------------------------------------ *
 * 2) 管线断言
 * ------------------------------------------------------------------ */

const SAMPLE = [
  '行内公式 $\\langle N_{\\rm ion}\\rangle$ 与中文正文混排。',
  '',
  '$$',
  '\\langle N_{\\rm ion}\\rangle = \\int_{M_{\\min}}^{M_{\\max}} \\mathrm{d}\\ln M\\, \\frac{\\mathrm{d}n_c}{\\mathrm{d}\\ln M}\\, n_{\\rm ion}(M\\,|\\,\\delta_R)',
  '$$',
  '',
  '对齐环境：',
  '',
  '$$',
  '\\begin{aligned}',
  '\\zeta &= \\frac{f_\\ast f_{\\rm esc}}{1 + n_{\\rm rec}}, \\\\',
  'M_{\\rm turn} &= \\max\\left(M_{\\rm min},\\ M_{\\rm crit}\\right)',
  '\\end{aligned}',
  '$$',
  '',
  '不兼容命令降级：$\\foo{x}$ 之后正文照常显示。',
].join('\n')

function checkPipeline() {
  const html = renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins, rehypePlugins }, SAMPLE),
  )
  // KaTeX 默认输出 HTML + MathML，MathML 的 <annotation> 里会原样保留 TeX 源码，
  // 判断「有没有残留未消费的占位文本」时必须先把它摘掉。
  const visible = html.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '')

  const katexNodes = (visible.match(/class="katex"/g) || []).length
  const displayNodes = (visible.match(/class="katex-display"/g) || []).length

  const checks = [
    ['渲染出 KaTeX 结构', katexNodes >= 3],
    [`显示公式带 katex-display 包装（实际 ${displayNodes} 个，期望 2）`, displayNodes === 2],
    ['aligned 环境已被消费（可见 HTML 中无 \\begin）', !visible.includes('\\begin')],
    ['不残留 $$ 定界符', !visible.includes('$$')],
    ['未残留 language-math 占位 code 元素', !visible.includes('language-math')],
    // KaTeX 0.16 对「未定义命令」不再整体失败，而是就地渲染为 errorColor 红色文本；
    // rehype-katex 的 .katex-error 包装只在整条表达式无法解析时才出现。
    // 这里断言前者：降级可见、且不影响同行其余正文。
    ['不兼容命令降级为红色提示（errorColor 生效）', visible.includes('color:#f87171')],
    ['公式以外的正文未被吞掉', visible.includes('之后正文照常显示')],
  ]

  let failed = 0
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`)
    if (!ok) failed += 1
  }
  return failed
}

/* ------------------------------------------------------------------ *
 * 3) 与 MdReaderDrawer 的源码契约
 * ------------------------------------------------------------------ */

async function checkContract() {
  const source = await fs.readFile(DRAWER_FILE, 'utf8').catch(() => '')
  if (!source) {
    console.error(`读不到 ${DRAWER_FILE}`)
    return 1
  }
  const checks = [
    ['remarkPlugins 为 [remarkGfm, remarkMath]', /remarkPlugins=\{\[remarkGfm,\s*remarkMath\]\}/.test(source)],
    ['rehypePlugins 顺序为 sanitize → katex', /\[rehypeSanitize,\s*sanitizeSchema\][\s\S]{0,120}\[rehypeKatex,/.test(source)],
    ['sanitize 放行 math-display / math-inline', /\/\^language-\.\/,\s*'math-display',\s*'math-inline'/.test(source)],
    ['katex 选项为 throwOnError:false', /throwOnError:\s*false/.test(source)],
    ['已引入 katex 样式', /import 'katex\/dist\/katex\.min\.css'/.test(source)],
  ]

  let failed = 0
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`)
    if (!ok) failed += 1
  }
  return failed
}

/* ------------------------------------------------------------------ */

const coverageFailures = await checkCoverage()

console.log('\nSSR 管线断言（与 MdReaderDrawer 同配置）：')
const pipelineFailures = checkPipeline()

console.log('\n与 MdReaderDrawer.tsx 的契约：')
const contractFailures = await checkContract()

const total = coverageFailures + pipelineFailures + contractFailures
console.log(total === 0 ? '\n全部通过。' : `\n共 ${total} 项失败。`)
process.exit(total === 0 ? 0 : 1)
