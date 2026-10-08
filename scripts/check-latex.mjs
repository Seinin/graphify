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
 *  3) 与 MdReaderDrawer.tsx 的源码契约：插件三元组两侧必须一致，
 *     任何一侧改动而另一侧没跟上都会在这里报错。
 *  4) 标题公式：目录（大纲）与「§ 当前小节」徽标拿的是服务端抽出的标题**纯文本**，
 *     不经过上面那条 markdown 管线，所以单独真渲染一遍（HeadingText.tsx），
 *     并盯住两处消费点不许绕过它直印标题文本。
 *
 * 用法：node scripts/check-latex.mjs
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'
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

/* ------------------------------------------------------------------ *
 * 4) 标题公式（目录／徽标：HeadingText.tsx）
 * ------------------------------------------------------------------ */

const HERE = import.meta.dirname
const HEADING_FILE = path.resolve(HERE, '..', 'src', 'components', 'HeadingText.tsx')
const LIBRARY_FILE = path.resolve(HERE, '..', 'src', 'components', 'MdLibraryPanel.tsx')
const INSPECTOR_FILE = path.resolve(HERE, '..', 'src', 'components', 'Inspector.tsx')

/**
 * 把 HeadingText.tsx 打包进 `data/`（已被 git 忽略）再按 ESM 导入——`data:` URL 解析不了裸模块名。
 * 与 `check-physics-chain.mjs` 的 loadTs 同一做法：**真渲染**，不是只查源码字符串。
 * react 走 external：本脚本自己也要用同一份 react-dom/server 渲染，不能出现两份 React。
 * CSS 导入换成空模块：这里只要组件产出的 HTML，不需要 KaTeX 的样式表。
 */
async function loadHeadingText() {
  const outfile = path.resolve(HERE, '..', 'data', '.check-latex-heading.mjs')
  await esbuild.build({
    entryPoints: [HEADING_FILE],
    bundle: true,
    format: 'esm',
    outfile,
    platform: 'node',
    logLevel: 'silent',
    external: ['react', 'react/jsx-runtime', 'react-dom'],
    // 自动 JSX 运行时：本文件只 `import { useState }` 之类的具名导入，
    // 一旦走 classic 运行时（React.createElement）就会缺 React 标识符。
    jsx: 'automatic',
    plugins: [
      {
        name: 'stub-css',
        setup(build) {
          build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'stub-css' }))
          build.onLoad({ filter: /.*/, namespace: 'stub-css' }, () => ({ contents: '', loader: 'js' }))
        },
      },
    ],
  })
  return import(`file://${outfile}`)
}

/**
 * 渲染一段标题文本。先摘掉 MathML 的 <annotation>：里面原样保留 TeX 源码，
 * 会让"有没有残留定界符／源码"的判断失真（做法同上面那条正文管线断言）。
 */
function renderHeading(HeadingText, text) {
  return renderToStaticMarkup(React.createElement(HeadingText, { text })).replace(
    /<annotation[^>]*>[\s\S]*?<\/annotation>/g,
    '',
  )
}

async function checkHeadingMath() {
  let failed = 0
  const ok = (label, condition) => {
    console.log(`  ${condition ? '✓' : '✗'} ${label}`)
    if (!condition) failed += 1
  }

  const { HeadingText } = await loadHeadingText()
  ok('能加载并调用 HeadingText.tsx', typeof HeadingText === 'function')

  // 渲染样本取自真文档：标题里写着 LaTeX。文档侧若不再有这种标题，这条会失败，提示去换样本。
  const halobox = await fs.readFile(path.join(MD_DIR, 'physics-chain', 'modules', 'halobox.md'), 'utf8').catch(() => '')
  const sample = halobox.split('\n').find((line) => /^#{2,4}\s/.test(line) && line.includes('$'))
  ok('物理链文档的标题里确有 LaTeX（样本存在）', Boolean(sample))

  if (sample) {
    const text = sample.replace(/^#+\s*/, '')
    const html = renderHeading(HeadingText, text)
    ok('标题里的公式渲染成 KaTeX', html.includes('class="katex"'))
    ok('标题里不残留 $ 定界符，也不漏 LaTeX 源码', !html.includes('$') && !html.includes('\\rm'))
    // 公式之后的散文在 HTML 里是连续的一段，用它反证"只渲染公式、把字吞了"
    const prose = text.split('$').pop().trim()
    ok('公式以外的标题文字未被打散', prose.length > 2 && html.includes(prose.slice(0, 6)))
  }

  const mixed = renderHeading(HeadingText, '前 \\(x^2\\) 中 $y_i$ 后')
  ok('$…$ 与 \\(…\\) 两种定界符都被消费（两处 KaTeX）', (mixed.match(/class="katex"/g) || []).length === 2)
  ok('与公式混排的前后文字照常显示', ['前', '中', '后'].every((piece) => mixed.includes(piece)))

  const broken = renderHeading(HeadingText, '后面 $\\foo{x}$ 还有正文')
  // KaTeX 0.16：整条解析不了才出 .katex-error，未定义命令是就地渲染成 errorColor 的红字
  ok('坏公式降级可见（红色 / katex-error），不是静默消失', /#cc0000|katex-error/.test(broken))
  ok('坏公式不影响同一行其余文字', broken.includes('还有正文'))

  const plain = renderHeading(HeadingText, '五、两个回流')
  ok('无公式的标题原样输出、不产生 KaTeX', !plain.includes('katex') && plain.includes('五、两个回流'))

  const drawer = await fs.readFile(DRAWER_FILE, 'utf8').catch(() => '')
  const library = await fs.readFile(LIBRARY_FILE, 'utf8').catch(() => '')
  // 先摘掉"通过 HeadingText 渲染"的用法，再查有没有落在 JSX 文本位上的直印（`>{heading.text}<`）
  const withoutHeading = (source) => source.replace(/<HeadingText text=\{(?:heading|activeHeading)\.text\} \/>/g, '')
  ok('阅读器大纲的每条标题走 HeadingText', /<HeadingText text=\{heading\.text\} \/>/.test(drawer))
  ok('阅读器标题旁的小节名走 HeadingText', /<HeadingText text=\{activeHeading\.text\} \/>/.test(drawer))
  ok(
    '阅读器不再直印标题文本',
    !/>\{heading\.text\}</.test(withoutHeading(drawer)) && !/>\{activeHeading\.text\}</.test(withoutHeading(drawer)),
  )
  ok('笔记库章节清单走 HeadingText', /<HeadingText text=\{heading\.text\} \/>/.test(library))
  ok('笔记库不再直印标题文本', !/>\{heading\.text\}</.test(withoutHeading(library)))

  // 引用标签也是标题原文（加入引用时按 `label: heading.text` 存），三处都得渲染
  const inspector = await fs.readFile(INSPECTOR_FILE, 'utf8').catch(() => '')
  ok('文献卡片主行的标签走 HeadingText', /<HeadingText text=\{ref\.label \|\| ref\.anchor \|\| location\} \/>/.test(inspector))
  ok('归并卡片的锚点芯片走 HeadingText', /<HeadingText text=\{ref\.label \|\| ref\.anchor \|\| '正文'\} \/>/.test(inspector))
  ok('阅读器「将引用定位到…」提示走 HeadingText', /将引用定位到「<HeadingText text=\{activeHeading\.text\} \/>」/.test(drawer))

  const source = await fs.readFile(HEADING_FILE, 'utf8').catch(() => '')
  ok('HeadingText 坏公式不抛错（与阅读器同档）', /throwOnError:\s*false/.test(source))
  ok('HeadingText 已引入 katex 样式', /import 'katex\/dist\/katex\.min\.css'/.test(source))
  const mathPattern = source.split('\n').find((line) => line.includes('const MATH')) ?? ''
  ok('HeadingText 认两种定界符（$…$ 与 \\(…\\)）', mathPattern.includes('\\$') && mathPattern.includes('\\\\('))

  return failed
}

/* ------------------------------------------------------------------ */

const coverageFailures = await checkCoverage()

console.log('\nSSR 管线断言（与 MdReaderDrawer 同配置）：')
const pipelineFailures = checkPipeline()

console.log('\n与 MdReaderDrawer.tsx 的契约：')
const contractFailures = await checkContract()

console.log('\n标题公式（目录／徽标，HeadingText.tsx）：')
const headingFailures = await checkHeadingMath()

const total = coverageFailures + pipelineFailures + contractFailures + headingFailures
console.log(total === 0 ? '\n全部通过。' : `\n共 ${total} 项失败。`)
process.exit(total === 0 ? 0 : 1)
