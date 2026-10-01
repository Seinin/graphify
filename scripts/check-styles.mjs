/**
 * 画布样式自检：把 `src/graph/styles.ts` 交给 cytoscape 自己解析一遍，提前抓出非法取值。
 *
 * 为什么需要它（踩过的坑）：
 * `source-endpoint` / `target-endpoint` 的类型是 `edgeEndpoint`（`multiple: true`），
 * 类型解析器会把值按空白切开逐个解析，**任一 token 非法就返回 null，而调用方直接读
 * `p.value`** —— 于是浏览器里表现为 `TypeError: Cannot read properties of null (reading 'value')`，
 * 且崩在 `new Core()` 里（整个画布白屏，错误栈全在 cytoscape 内部，完全看不出是哪个属性写错了）。
 * 之前把端口写成 `north` / `east` 正是这么炸的；同时发现 `arrow-scale: 0` 也是非法值
 * （合法范围不含 0，只是它不属于 multiple 类型，所以只报错不崩）。
 *
 * 检查三件事：
 *   1. **整表构造**：用 `styleEnabled: true` 建一个 headless Core（与浏览器同一条代码路径），
 *      能建起来就说明不会白屏；
 *   2. **逐条声明**：调用 cytoscape 的 `style.parse()`，把「解析为 null」与「抛错」都揪出来；
 *   3. **multiple 类型的内层 token**：模拟 cytoscape 的切分逻辑再解析一遍——这才是崩溃的真实触发点；
 *   4. 顺带确认每条规则的**选择器**能被选择器引擎解析（`core` 除外，它不是元素选择器）。
 *
 * 用法：`npm run check:styles`（失败时退出码 1，可直接接进 CI）。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cytoscape from 'cytoscape'
import * as esbuild from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

/** 把 TS 样式模块就地打包成 ESM（不落盘），再用 data: URL 载入 */
async function loadStyles() {
  const built = await esbuild.build({
    entryPoints: [path.join(root, 'src/graph/styles.ts')],
    bundle: true,
    format: 'esm',
    write: false,
    platform: 'node',
    external: ['cytoscape'],
    logLevel: 'silent',
  })
  const code = built.outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

const problems = []
const note = (kind, selector, prop, value, detail) => problems.push({ kind, selector, prop, value, detail })

const { buildStylesheet } = await loadStyles()
const rules = buildStylesheet()

// ---- 1. 整表构造：与浏览器同一条路径（这里能建起来，浏览器就不会白屏）----
let cy
try {
  cy = cytoscape({ headless: true, styleEnabled: true, style: rules, elements: [] })
} catch (error) {
  console.error('✗ 样式表整体构造失败——浏览器会在 new Core() 处白屏：')
  console.error('  ', error.message)
  process.exit(1)
}

const style = cy.style()
const parse = (prop, value) => {
  try {
    return { ok: true, parsed: style.parse(prop, value) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

// ---- 2/3. 逐条声明 + multiple 内层 token ----
let declarations = 0
for (const rule of rules) {
  // ---- 4. 选择器合法性（core 是核心选择器，不在元素选择器语法里）----
  if (rule.selector !== 'core') {
    try {
      cy.$(rule.selector)
    } catch (error) {
      note('选择器无法解析', rule.selector, '-', '-', error.message.slice(0, 90))
    }
  }
  for (const [prop, value] of Object.entries(rule.style ?? {})) {
    declarations += 1
    const { ok, parsed, error } = parse(prop, value)
    if (!ok) {
      note('解析抛错', rule.selector, prop, String(value), String(error).slice(0, 90))
      continue
    }
    if (parsed == null) {
      note('取值非法（解析为 null，该声明会被丢弃）', rule.selector, prop, String(value), '')
      continue
    }
    const definition = style.properties[prop]
    if (!definition?.multiple) continue
    for (const token of String(value).trim().split(/\s+/)) {
      const inner = parse(prop, token)
      if (!inner.ok || inner.parsed == null) {
        note(
          'multiple 属性的 token 非法（浏览器会因此崩在 new Core）',
          rule.selector,
          prop,
          token,
          inner.ok ? '' : String(inner.error).slice(0, 90),
        )
      }
    }
  }
}

const selectors = rules.filter((rule) => rule.selector !== 'core').length
console.log(`样式规则 ${rules.length} 条（元素选择器 ${selectors} 条）· 声明 ${declarations} 条`)

if (!problems.length) {
  console.log('✓ 全部合法：选择器可解析、取值可解析、multiple 属性的 token 也都能解析')
  process.exit(0)
}

console.error(`✗ 发现 ${problems.length} 处问题：`)
for (const item of problems) {
  console.error(`  · [${item.kind}] ${item.selector}  ${item.prop} = ${JSON.stringify(item.value)}`)
  if (item.detail) console.error(`      ${item.detail}`)
}
process.exit(1)
