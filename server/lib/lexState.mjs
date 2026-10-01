/**
 * 词法状态机：判断「某一行开头」是否落在跨行的字符串 / 注释内部，
 * 并把**开启那个构造的那一行**原文找出来。
 *
 * 为什么需要它：
 * 预览是按段取行窗口的（一段 300 行），前端拿到的常常是"文件中间的一段"。
 * Prism 这类正则词法器没有起始状态——从窗口开头开始扫，窗口里那个本该是**闭引号**的
 * `"""` 就被当成了开引号，于是它往后的所有行都被吞进一个字符串。
 * 实测：`src/py21cmfast/drivers/lightcone.py` 的 `r"""` 在第 590 行、闭引号在 639 行，
 * 而为第 644 行取的 601–900 段不含开引号 → 644 行那一整片变成字符串色，VS Code 却正常。
 *
 * 所以服务端给窗口时顺带算一行「词法前缀」：开启那个构造的那一行的原文。
 * 前端把它拼在窗口文本最前面一起交给词法器（但不显示），状态就摆正了。
 * 为什么给一行就够：三引号字符串与块注释的**内部在词法上是不透明的**，
 * 只要把开引号那一行喂进去，后面的内容由窗口正文自己闭合，结果与整文件分析一致。
 *
 * 只认会影响"下一行状态"的构造：三引号字符串、块注释、反引号模板串，
 * 以及以孤立反斜杠续行的普通字符串。行注释（`#` / `//` / `!`）到行尾就结束，不跨行。
 *
 * 已知不覆盖（这类语法边缘不影响本仓的预览）：shell 的 heredoc、JS 正则字面量里的
 * 引号/反引号、模板串 `${}` 插值内部再嵌字符串。
 */

/** 语言家族 → 标记集合；未列出的语言（json / text 等）没有跨行构造，直接跳过 */
const FAMILIES = {
  /** `#` 行注释 + 三引号（Python / TOML / shell） */
  hash: { lineComment: '#', quotes: ['"', "'"], triples: ['"""', "'''"] },
  /** `!` 行注释（Fortran；`//` 在那门语言里是字符串拼接，不能当注释） */
  bang: { lineComment: '!', quotes: ['"', "'"] },
  /** C 系：`//` 行注释 + 块注释（斜杠星号开、星号斜杠闭） */
  slash: { lineComment: '//', quotes: ['"', "'"], blocks: [['/*', '*/']] },
  /** JS 系：再加反引号模板串（可以跨行） */
  template: { lineComment: '//', quotes: ['"', "'"], blocks: [['/*', '*/']], template: true },
}

/** 与 codeIndex.mjs 的 `LANGUAGE_BY_EXT` 同一套语言名（前端 Prism 也用这套名字） */
const FAMILY_BY_LANGUAGE = {
  python: 'hash',
  toml: 'hash',
  bash: 'hash',
  fortran: 'bang',
  c: 'slash',
  cpp: 'slash',
  css: 'slash',
  javascript: 'template',
  typescript: 'template',
  tsx: 'template',
}

/**
 * 取「让第 `lineNumber` 行处于正确词法状态」所需的**一行**前缀。
 *
 * 返回 `{ start, text }`：`start` 是开启该构造的行号（1 起），`text` 是那一行的原文；
 * 第 `lineNumber` 行开头不在任何跨行构造里时返回 `null`（绝大多数窗口都是这种，零开销）。
 *
 * 注意口径：只看**行首**的状态。若构造是在第 `lineNumber` 行上才开始的，
 * 这一行本身属于"代码"，不需要前缀（闭引号同理，它由窗口正文自己消化）。
 */
export function lexPrefixFor(lines, lineNumber, language) {
  const family = FAMILIES[FAMILY_BY_LANGUAGE[language]]
  const target = Math.floor(Number(lineNumber))
  if (!family || !Number.isFinite(target) || target <= 1) return null

  // 只扫到目标行的**前一行**：目标行行首的状态就是扫完这些行之后的状态
  let state = null
  const limit = Math.min(target - 1, lines.length)
  for (let index = 0; index < limit; index += 1) {
    state = scanLine(lines[index] ?? '', index + 1, state, family)
  }

  if (!state) return null
  return { start: state.opener, text: lines[state.opener - 1] ?? '' }
}

/**
 * 扫一行，返回**跨到下一行**的状态（null = 没有构造在开着）。
 *
 * `state` 是上一行留下的状态，形状 `{ kind, opener, closer?, quote? }`；
 * 只在真正跨行的构造上保留（三引号 / 块注释 / 模板串 / 反斜杠续行的字符串）。
 */
function scanLine(line, lineNumber, state, family) {
  const triples = family.triples ?? []
  const blocks = family.blocks ?? []
  const quotes = family.quotes ?? []
  let current = state
  let index = 0

  while (index < line.length) {
    const ch = line[index]

    // ---- 已经在构造内部：只找闭合（不透明，不看里面的引号/注释标记）----
    if (current) {
      if (current.kind === 'block') {
        if (line.startsWith(current.closer, index)) {
          index += current.closer.length
          current = null
        } else index += 1
        continue
      }
      if (current.kind === 'triple') {
        if (line.startsWith(current.closer, index)) {
          index += current.closer.length
          current = null
        } else if (ch === '\\') index += 2 // 转义：`\"` 不能当闭引号
        else index += 1
        continue
      }
      if (current.kind === 'template') {
        if (ch === '`') {
          index += 1
          current = null
        } else if (ch === '\\') index += 2
        else index += 1
        continue
      }
      // 普通单行字符串
      if (ch === '\\') index += 2
      else if (ch === current.quote) {
        index += 1
        current = null
      } else index += 1
      continue
    }

    // ---- 在代码里：找构造的起点 ----
    if (family.lineComment && line.startsWith(family.lineComment, index)) {
      // 行注释吃掉这一行的剩余部分，不跨行
      return null
    }
    const block = blocks.find((pair) => line.startsWith(pair[0], index))
    if (block) {
      current = { kind: 'block', opener: lineNumber, closer: block[1] }
      index += block[0].length
      continue
    }
    const triple = triples.find((mark) => line.startsWith(mark, index))
    if (triple) {
      current = { kind: 'triple', opener: lineNumber, closer: triple }
      index += triple.length
      continue
    }
    if (family.template && ch === '`') {
      current = { kind: 'template', opener: lineNumber, closer: '`' }
      index += 1
      continue
    }
    if (quotes.includes(ch)) {
      current = { kind: 'string', opener: lineNumber, quote: ch }
      index += 1
      continue
    }
    index += 1
  }

  if (!current) return null
  // 本来就是跨行的构造：带到下一行
  if (current.kind !== 'string') return current
  /**
   * 普通字符串：只有行尾是**孤立的**反斜杠时才续行（Python / C 都这么写）。
   * 否则这一行就结束了——没闭合的字符串是语法错误，编辑器也是从下一行当代码恢复的。
   */
  return endsWithLoneEscape(line) ? current : null
}

/** 行尾是不是孤立的反斜杠（`\\` 是转义过的反斜杠，不算续行） */
function endsWithLoneEscape(line) {
  let count = 0
  for (let index = line.length - 1; index >= 0 && line[index] === '\\'; index -= 1) count += 1
  return count % 2 === 1
}
