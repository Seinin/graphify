/**
 * 参考文献范围：把一个对象的「落点附近」核成行号集合，再给出**必须登记的出处段落**。
 *
 * 为什么要有这一份共用库：真源补登记（人写）与自检（机器判）必须同口径——两边各写一版范围算法，
 * 就会出现在一边"够了"、在另一边"漏一条"的摇摆。这里只做一件事：给定真源与源码，回答
 * "这个对象的实现范围里，哪几行真的引了论文"，自检拿它当失败判据，补登记拿它当清单。
 *
 * 范围（四块，与 `docs/notes/physics-chain/README.md` 里那节口径一致）：
 *   1. 该对象的每条落点（真源 `codeSites`）**所在函数的整段**，含定义上方的注释块——
 *      落点本身往往只有几行赋值，出处注释写在函数头上，只认落点那几行会把它们全漏掉；
 *   2. 它认领到的步骤落点（真源 `stepSites`，按 `codeHints` 前缀认领）所在函数的整段；
 *   3. 上面两处的文本与 needles 里出现的标识符，在**同文件**里的定义行（宏定义或函数定义，
 *      连定义上方的注释块）——追两层：注释是写给那些符号的，落在它们的定义处；
 *   4. 它拥有的参数（真源 `symbolMap[].codeName` 里认得出标识符、且在 `inputs.py` 里声明了的）
 *      的 docstring 整段。
 *
 * 「出处」= 代码注释或参数 docstring 里真的引到论文的那些：作者年份（`Park+2018`、
 * `Watson et al. 2013`）、期刊卷页、arXiv 号，或论文里的节号与等式号（`Sec 2.1 of Park+2018`、
 * `Eq. (12)`）。只写"硬编码""口径提醒"这类没有引出任何论文的注释不算。
 *
 * 必需粒度：命中的注释行按**相邻段**归并（间隔 ≤2 行算同一段），每段至少一条登记即可——
 * 一段注释引同一篇论文时写一条，不要按行拆成十几条。
 */

/** 出处标记：作者年份 / 期刊卷页 / arXiv / 论文的节号与等式号 */
export const CITATION_MARK =
  /(arXiv|MNRAS|ApJ|ApJS|ApJL|PRD|PhRvD|Phys\.? ?Rev|JCAP|A&A|Sec\.? ?\d|Eq\.? ?\(?\d|Appendix ?[A-Z]|[A-Z][a-z]+ ?\+ ?\d{2,4}|et al\.?,? ?\(?\d|(?<![\d.])(?:19|20)\d{2}(?!\d))/

const IDENT = /[A-Za-z_]\w{3,}/g
/** `inputs.py` docstring 里的参数条目头：`    NAME : type, optional`（名字可混写、可一行两个） */
const PARAM_HEAD = /^ {4}([A-Za-z][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z][A-Za-z0-9_]*)*)\s*(?::|$)/
/** `inputs.py` 在仓库里的相对路径（参数 docstring 只在这一份里） */
export const INPUTS_REL = 'src/py21cmfast/wrapper/inputs.py'

const lineStartsWithComment = (line) => {
  const text = String(line).trim()
  return text.startsWith('//') || text.startsWith('/*') || text.startsWith('*') || text.endsWith('*/')
}

/** 去掉行首缩进与注释标记，得到"人读到的那句原文" */
export const stripCommentMark = (line) =>
  String(line)
    .replace(/^\s+/, '')
    .replace(/^(\/\/+|#|\*+|\/\*+)\s?/, '')
    .trim()

/** 把一段源码行折成一句：去注释标记、去缩进、空白折叠（`quote` 与它的对拍都走这一句） */
export const flattenSource = (lines) =>
  (Array.isArray(lines) ? lines : [lines])
    .map(stripCommentMark)
    .filter((line) => line.length)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

/** 0-based 的 `index` 往上吃掉连续注释行，返回起始行号（0-based） */
export function commentBlockAbove(lines, index) {
  let top = index
  while (top > 0 && lineStartsWithComment(lines[top - 1])) top -= 1
  return top
}

/** 函数定义段（1-based，`{line, endLine}`）：找不到定义行返回 `null`；括号配平到函数体结束 */
export function functionSpan(lines, symbol) {
  const head = new RegExp(`^[A-Za-z_][\\w \\t*]*\\b${escapeRe(symbol)}\\s*\\(`)
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith('//')) continue
    if (head.test(lines[index])) {
      start = index
      break
    }
  }
  if (start < 0) return null
  const top = commentBlockAbove(lines, start)
  let depth = 0
  let seen = false
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === '{') {
        depth += 1
        seen = true
      } else if (char === '}') depth -= 1
    }
    if (seen && depth <= 0) return { line: top + 1, endLine: index + 1 }
  }
  return { line: top + 1, endLine: lines.length }
}

/** 某个符号在同文件里的定义（宏定义或函数定义，连上方的注释块）：1-based `{line, top, endLine}` */
function definitionsOf(lines, tokens) {
  const out = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const token of tokens) {
      const define = new RegExp(`^\\s*#\\s*define\\s+${escapeRe(token)}\\b`)
      if (define.test(line)) {
        out.push({ line: index + 1, top: commentBlockAbove(lines, index) + 1, endLine: index + 1 })
        break
      }
      const head = new RegExp(`^[A-Za-z_][\\w \\t*]*\\b${escapeRe(token)}\\s*\\(`)
      if (!line.trim().startsWith('//') && head.test(line)) {
        const span = functionSpan(lines, token)
        out.push({ line: index + 1, top: commentBlockAbove(lines, index) + 1, endLine: span ? span.endLine : index + 1 })
        break
      }
    }
  }
  return out
}

/** 追 `depth` 层：命中行的行号集合（含定义段与定义上方的注释块） */
export function definitionLines(lines, tokens, depth = 2) {
  const hit = new Set()
  const seen = new Set()
  let frontier = new Set(tokens)
  for (let round = 0; round < depth; round += 1) {
    const todo = [...frontier].filter((token) => !seen.has(token))
    if (!todo.length) break
    for (const token of todo) seen.add(token)
    const next = new Set()
    for (const definition of definitionsOf(lines, todo)) {
      for (let number = definition.top; number <= definition.endLine; number += 1) hit.add(number)
      const text = lines.slice(definition.line - 1, definition.endLine).join('\n')
      for (const identifier of text.match(IDENT) ?? []) next.add(identifier)
    }
    frontier = next
  }
  return hit
}

/** `inputs.py` 里每个参数的 docstring 段（1-based `{line, endLine}`，按参数名索引） */
export function paramDocSpans(inputsText) {
  const lines = String(inputsText).split('\n')
  const starts = []
  lines.forEach((line, index) => {
    const match = PARAM_HEAD.exec(line)
    if (match) starts.push({ index, names: match[1].split(',').map((name) => name.trim()) })
  })
  const spans = new Map()
  starts.forEach((start, at) => {
    let stop = at + 1 < starts.length ? starts[at + 1].index : lines.length
    while (stop > start.index + 1 && !lines[stop - 1].trim()) stop -= 1
    for (const name of start.names) {
      if (!spans.has(name)) spans.set(name, [])
      spans.get(name).push({ line: start.index + 1, endLine: stop })
    }
  })
  return spans
}

/**
 * 步骤落点的认领：`codeHints` 里的带点前缀（`S04.1`）认领 `stepSites` 的同名前缀单元，
 * 同一个单元只归第一个认领者（与生成器的归属唯一同口径）。
 * @returns Map<对象 id, string[]>
 */
export function claimedStepUnits(chain) {
  const claimed = new Set()
  const byOwner = new Map()
  for (const item of [...(chain.drivers ?? []), ...(chain.nodes ?? [])]) {
    const hints = (item.codeHints ?? []).map(String).filter((hint) => hint.includes('.'))
    const mine = []
    for (const unit of Object.keys(chain.stepSites ?? {})) {
      if (claimed.has(unit) || !(chain.stepSites[unit] ?? []).length) continue
      if (hints.some((hint) => unit.startsWith(`${hint}.`))) {
        claimed.add(unit)
        mine.push(unit)
      }
    }
    byOwner.set(String(item.id), mine)
  }
  return byOwner
}

/** 该对象拥有的参数名（`symbolMap[].codeName` 里认得出标识符的那些） */
export function ownedCodeNames(chain, owner) {
  const names = new Set()
  for (const row of chain.symbolMap ?? []) {
    if (String(row.owner) !== String(owner)) continue
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(String(row.codeName ?? '').trim())
    if (name) names.add(name[0])
  }
  return names
}

/**
 * 一个对象的实现范围：`Map<文件, Set<行号>>`。
 * `readLines(rel)` 要能同步取回某个仓库相对路径的全部行（取不到返回 `null`）。
 */
export function ownerScope(item, { chain, steps, paramSpans, readLines }) {
  const scope = new Map()
  const add = (file, numbers) => {
    if (!scope.has(file)) scope.set(file, new Set())
    const bucket = scope.get(file)
    for (const number of numbers) bucket.add(number)
  }
  const sites = (item.codeSites ?? []).filter((site) => Number.isFinite(site.line))
  for (const unit of steps.get(String(item.id)) ?? []) {
    sites.push(...(chain.stepSites?.[unit] ?? []).filter((site) => Number.isFinite(site.line)))
  }
  for (const site of sites) {
    const lines = readLines(site.file)
    if (!lines) continue
    const endLine = site.endLine ?? site.line
    const tokens = new Set(lines.slice(site.line - 1, endLine).join('\n').match(IDENT) ?? [])
    for (const needle of site.needles ?? []) if (typeof needle === 'string' && needle.trim()) tokens.add(needle.trim())
    const symbol = String(site.symbol ?? '').trim()
    const span = symbol ? functionSpan(lines, symbol) : null
    const from = span ? span.line : Math.max(1, site.line - 2)
    const to = span ? span.endLine : endLine + 2
    add(site.file, Array.from({ length: to - from + 1 }, (_, offset) => from + offset))
    add(site.file, definitionLines(lines, [...tokens]))
  }
  const inputsLines = readLines(INPUTS_REL)
  if (inputsLines) {
    for (const name of ownedCodeNames(chain, item.id)) {
      for (const span of paramSpans.get(name) ?? []) {
        add(INPUTS_REL, Array.from({ length: span.endLine - span.line + 1 }, (_, offset) => span.line + offset))
      }
    }
  }
  return scope
}

/** 命中的行按相邻段归并：间隔 ≤2 行算同一段（`gap` 是"中间空几行"） */
export function groupRuns(numbers, gap = 2) {
  const out = []
  for (const number of [...numbers].sort((a, b) => a - b)) {
    const last = out[out.length - 1]
    if (last && number - last[last.length - 1] <= gap + 1) last.push(number)
    else out.push([number])
  }
  return out
}

/** 这一行算不算"给出处的注释行"：注释（`//`、`/*`、`*`、`#`）或 `inputs.py` 的 docstring */
const isCitationLine = (line, file) => {
  if (!CITATION_MARK.test(line)) return false
  const text = String(line).trim()
  return text.startsWith('//') || text.startsWith('/*') || text.startsWith('*') || text.startsWith('#') || text.includes('//') || file.endsWith('inputs.py')
}

/**
 * 每个对象**必须登记**的出处段落。
 * @returns Map<对象 id, Array<{file, line, endLine, sample}>>
 */
export function requiredCitationRuns(chain, readLines) {
  const steps = claimedStepUnits(chain)
  const inputsText = readLines(INPUTS_REL)
  const paramSpans = paramDocSpans(inputsText ? inputsText.join('\n') : '')
  const out = new Map()
  for (const item of [...(chain.drivers ?? []), ...(chain.nodes ?? [])]) {
    const scope = ownerScope(item, { chain, steps, paramSpans, readLines })
    const runs = []
    for (const [file, numbers] of [...scope.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const lines = readLines(file)
      if (!lines) continue
      const hits = [...numbers].filter(
        (number) => number >= 1 && number <= lines.length && isCitationLine(lines[number - 1], file),
      )
      for (const run of groupRuns(hits)) {
        runs.push({
          file,
          line: run[0],
          endLine: run[run.length - 1],
          sample: String(lines[run[0] - 1]).trim().slice(0, 160),
        })
      }
    }
    if (runs.length) out.set(String(item.id), runs)
  }
  return out
}

/** 两条行区间有没有重叠 */
export const overlaps = (a, b) => Number(a.line) <= Number(b.endLine ?? b.line) && Number(b.line) <= Number(a.endLine ?? a.line)

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
