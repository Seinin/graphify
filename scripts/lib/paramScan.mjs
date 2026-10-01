/**
 * 在源码里定位函数体、并在其中扫描参数名。
 *
 * 与 `scripts/scan-param-tags.mjs` 的关系：那是给**已有图谱的节点**用的（按节点的 refs ±窗口），
 * 本文件是给**新图谱的文档锚点**用的（按 L3「承担者」给出的符号精确取函数体）。
 * 后者不会重演"窗口延伸把整个函数吸进来"的偏差：
 *   · scan-param-tags 的窗口是 `min(引用行-2, 函数体起)` 到 `max(引用行+30, 函数体末)`，
 *     对 `atlas:fig1:out:snapshots` 那个节点的 ref（global_evolution.py:110）会一路盖到 27–140 行；
 *   · 这里只取**符号自己**的函数体（C 按花括号配对、Python 按缩进），不做 ±窗口。
 *
 * 不 import 那个脚本（它是可执行脚本、不导出函数），因此这里自带一份实现，保持独立可测。
 */

import fs from 'node:fs/promises'

/** 把注释与字符串字面量替换成等长空白（保留换行与偏移，所以行号仍然对得上） */
export function maskSource(text, language) {
  const masked = Array.from(String(text))
  let state = 'code'
  let quote = ''

  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index]
    const next = masked[index + 1]

    if (state === 'code') {
      if (language === 'python' && char === '#') {
        state = 'line'
        continue
      }
      if (language === 'c' && char === '/' && next === '/') {
        state = 'line'
        masked[index] = ' '
        masked[index + 1] = ' '
        index += 1
        continue
      }
      if (language === 'c' && char === '/' && next === '*') {
        state = 'block'
        masked[index] = ' '
        masked[index + 1] = ' '
        index += 1
        continue
      }
      if (language === 'python' && (char === '"' || char === "'") && masked.slice(index, index + 3).join('') === char.repeat(3)) {
        state = 'triple'
        quote = char
        masked[index] = masked[index + 1] = masked[index + 2] = ' '
        index += 2
        continue
      }
      if (char === '"' || char === "'") {
        state = 'string'
        quote = char
        continue
      }
      continue
    }

    if (state === 'line') {
      if (char === '\n') state = 'code'
      else masked[index] = ' '
      continue
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        masked[index] = masked[index + 1] = ' '
        index += 1
        state = 'code'
      } else if (char !== '\n') {
        masked[index] = ' '
      }
      continue
    }

    if (state === 'triple') {
      if (masked.slice(index, index + 3).join('') === quote.repeat(3)) {
        masked[index] = masked[index + 1] = masked[index + 2] = ' '
        index += 2
        state = 'code'
      } else if (char !== '\n') {
        masked[index] = ' '
      }
      continue
    }

    // state === 'string'
    if (char === '\\') {
      masked[index] = ' '
      if (next !== undefined && next !== '\n') masked[index + 1] = ' '
      index += 1
      continue
    }
    if (char === quote) {
      state = 'code'
      continue
    }
    if (char !== '\n') masked[index] = ' '
  }

  return masked.join('')
}

const lineStarts = (text) => {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) if (text[index] === '\n') starts.push(index + 1)
  return starts
}

const lineOf = (starts, offset) => {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (starts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}

/** 从 `{` 开始的花括号配对（输入必须是已屏蔽的文本），返回结束偏移 */
function matchBrace(masked, open) {
  let depth = 0
  for (let index = open; index < masked.length; index += 1) {
    if (masked[index] === '{') depth += 1
    else if (masked[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return masked.length - 1
}

/** 定位 C 函数体：找"定义"而不是"调用/声明" */
function cBodies(masked, symbol) {
  const starts = lineStarts(masked)
  const bodies = []
  const pattern = new RegExp(`\\b${symbol}\\s*\\(`, 'g')
  let match = pattern.exec(masked)
  while (match) {
    const offset = match.index
    const start = starts[lineOf(starts, offset) - 1]
    const prefix = masked.slice(start, offset)
    const rest = masked.slice(offset)
    const headerEnd = rest.indexOf(')')
    const afterParen = headerEnd >= 0 ? rest.slice(headerEnd + 1) : ''
    const braceAt = afterParen.search(/\{/)
    const semicolonAt = afterParen.search(/;/)
    const looksLikeDefinition =
      /^[A-Za-z_][\w\s\*]*\s*$/.test(prefix) && // 前缀只应是返回类型（没有 `=`、`.`、`->`、逗号）
      !prefix.includes('=') &&
      !prefix.includes('.') &&
      !prefix.includes(',') &&
      braceAt >= 0 &&
      (semicolonAt < 0 || braceAt < semicolonAt)
    if (looksLikeDefinition) {
      const open = offset + headerEnd + 1 + braceAt
      const close = matchBrace(masked, open)
      bodies.push({ startLine: lineOf(starts, start), endLine: lineOf(starts, close) })
    }
    match = pattern.exec(masked)
  }
  return bodies
}

/** 定位 Python 函数/类体：先吃掉可能多行的签名，再按缩进收体 */
function pythonBodies(masked, symbol) {
  const lines = masked.split('\n')
  const bodies = []
  const head = new RegExp(`^(\\s*)(?:async\\s+)?(?:def|class)\\s+${symbol}\\b`)

  lines.forEach((line, index) => {
    const match = head.exec(line)
    if (!match) return
    const indent = match[1].length

    // 签名可能换行写（参数一行一个），右括号会回到零缩进——按括号配平找到签名末尾
    let signatureEnd = index
    let depth = 0
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      for (const char of lines[cursor]) {
        if ('([{'.includes(char)) depth += 1
        else if (')]}'.includes(char)) depth -= 1
      }
      signatureEnd = cursor
      if (depth <= 0) break
    }

    let end = lines.length
    for (let scan = signatureEnd + 1; scan < lines.length; scan += 1) {
      const text = lines[scan]
      if (!text.trim()) continue
      const current = text.length - text.trimStart().length
      if (current <= indent) {
        end = scan
        break
      }
    }
    bodies.push({ startLine: index + 1, endLine: end })
  })
  return bodies
}

/** 在文件里定位符号的函数体（找不到返回空数组） */
export function findSymbolBodies(masked, symbol, language) {
  return language === 'python' ? pythonBodies(masked, symbol) : cBodies(masked, symbol)
}

/**
 * 角色判定：入公式 / 赋值 / 开关。
 *   · 开关 —— 出现在条件或布尔语境（比较、逻辑、if/while/switch、Python 的 True/False 判断）
 *   · 赋值 —— 整句是"把这个参数原样存进某个字段"（`X = <参数>;`、`->f = <参数>;`）
 *   · 入公式 —— 其余（参与算术、作为函数实参、进表达式）
 */
export function classifyKind(line) {
  const text = String(line ?? '').trim()
  if (!text) return '入公式'
  if (/\b(if|elif|else\s+if|while|switch|case)\b|==|!=|<=|>=|&&|\|\||\?|IsTrue|IsFalse|\btrue\b|\bfalse\b/.test(text)) {
    // 含比较/逻辑的表达式优先判为开关，但要排除"赋值右侧刚好有比较"的极少数情况
    if (/[<>!=]=|\?|&&|\|\||\b(if|elif|else\s+if|while|switch)\b|IsTrue|IsFalse/.test(text)) return '开关'
  }
  const assignment = /=\s*([^=]|$)/.exec(text)
  if (assignment) {
    const rhs = text.slice(assignment.index + 1).replace(/;.*$/, '').replace(/\)?\s*$/, '').trim()
    // RHS 就是参数本身（可带 `inputs.astro_params.` 之类限定前缀）⇒ 原样存字段，算"赋值"
    if (/^[\w.]*[A-Za-z_]\w*$/.test(rhs) || /^[\w.]+$/.test(rhs)) return '赋值'
  }
  return '入公式'
}

/** 在给定行区间里扫描若干参数名，返回 Map<参数名, [{line, text}]> */
export function scanParams(originalLines, ranges, names) {
  const hits = new Map()
  for (const name of names) hits.set(name, [])
  const pattern = new RegExp(`\\b(${names.join('|')})\\b`, 'g')

  for (const range of ranges) {
    const masked = range.masked ?? []
    for (let line = range.startLine; line <= Math.min(range.endLine, masked.length); line += 1) {
      const text = masked[line - 1] ?? ''
      pattern.lastIndex = 0
      const found = new Set()
      let match = pattern.exec(text)
      while (match) {
        found.add(match[1])
        match = pattern.exec(text)
      }
      for (const name of found) {
        hits.get(name).push({ line, text: (originalLines[line - 1] ?? '').trim() })
      }
    }
  }
  return hits
}

/** 读文件并同时给出原文行与被屏蔽行 */
export async function readSource(file, language) {
  const text = await fs.readFile(file, 'utf8')
  return { text, lines: text.split('\n'), maskedLines: maskSource(text, language).split('\n') }
}
