/**
 * 扫描节点的源码引用，把参数写成**一个参数一个标签**（取代早期的「参数参与」总标签）。
 *
 * 与旧版 `tag-parameters.mjs` 的区别（旧版扫不到 AstroParams，因为窗口太窄）：
 *   · 扫描范围 = **引用所在的那个函数体**（引用行在函数中间时，先往上找 `def`，
 *     再跳过可能跨多行的签名，一直扫到下一个同级定义）——旧版只取「引用行 +30 行」，
 *     而物理量（F_STAR10 / M_TURN / N_STEP_TS / L_X…）往往用在函数中后段，扫不到；
 *   · 写入的是**按参数粒度**的标签（`tag:<变量名>`），不是一个大标签；
 *   · 分类 `group` 直接取参数在 inputs.py 里所属的 InputStruct 子类名。
 *
 * 命名：**一律用原变量名**（曾给 BOX_LEN 配过「中文名 + 符号」，已按要求撤销）。
 * 颜色：按参数所属类（`group`）取 `./lib/tag-groups.mjs` 里的类别色写进标签的 `color`，
 * 右侧属性面板按它上色；前端另有一份同表（`src/graph/palette.ts`），由 `check:canvas` 的断言钉住。
 *
 * 用法：
 *   node scripts/scan-param-tags.mjs            # dry-run：打印「参数 × 节点 × 用法 × 行号」汇总
 *   node scripts/scan-param-tags.mjs --apply    # 核对后写回服务端
 *
 * 两条纪律（都是被事故教出来的）：
 *   · **只增不减**：只刷新本脚本负责的参数标签（id 形如 `tag:<已知参数名>`），其余标签一律保留。
 *     旧版把「所有 `tag:` 前缀的 id」当成自己的产物先删后建，一次重扫就把非参数标签整片抹掉
 *     ——IC 链的「初始条件」「2LPT」当年就是这么没的。
 *   · **C 也要认**：引用落在 `.c` 里时用花括号口径圈函数体，屏蔽表也换成 C 的那套
 *     （块注释 / `//` / 引号），否则 `inputs->matter_options->PERTURB_ALGORITHM` 这类写法扫不到，
 *     而注释里提到的参数名又会被误算成命中。
 *
 * `--apply` 之后要跟着跑 `scripts/normalize-tag-rules.mjs`：新增的参数标签写回时还没有
 * `docId`，而 schema 要求「每个标签都必须有一篇文档」，它会把空壳建好并绑上；然后重启 dev 服务。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { tagColorOf } from './lib/tag-groups.mjs'

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname, '..')
const PARAM_SOURCE = path.join(REPO_ROOT, 'src/py21cmfast/wrapper/inputs.py')
const BASE = process.argv.find((arg) => arg.startsWith('http')) || 'http://127.0.0.1:5178'
const APPLY = process.argv.includes('--apply')

/** 代码里的参数划分（inputs.py 的 InputStruct 子类），顺序即组顺序 */
const PARAM_CLASSES = ['CosmoParams', 'MatterOptions', 'SimulationOptions', 'AstroOptions', 'AstroParams']

/** 参数名 → 标签 id（显示名就是参数名本身，不再做任何翻译） */
const tagIdOf = (name) => `tag:${name}`

/* ---------------- inputs.py 解析 ---------------- */

/** 参数名 → 所属类（取首次出现）；同时给出类的出现顺序 */
async function collectParams() {
  const text = await fs.readFile(PARAM_SOURCE, 'utf8')
  const owner = new Map()
  let current = null
  text.split('\n').forEach((line) => {
    const classMatch = /^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line)
    if (classMatch) {
      current = PARAM_CLASSES.includes(classMatch[1]) ? classMatch[1] : null
      return
    }
    // 顶格行 = 类结束（字段都是 4 空格缩进）：否则会把后续类的字段算进来（实测多算 31 个）
    if (/^\S/.test(line)) {
      current = null
      return
    }
    if (!current) return
    const fieldMatch = /^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line)
    if (!fieldMatch) return
    const raw = fieldMatch[1]
    if (raw.length < 2) return
    if (!owner.has(raw)) owner.set(raw, current)
    if (raw.startsWith('_') && !owner.has(raw.replace(/^_+/, ''))) owner.set(raw.replace(/^_+/, ''), current)
  })
  return owner
}

/* ---------------- 代码扫描（与 tag-parameters.mjs 同一套判定） ---------------- */

/**
 * 行级屏蔽表：注释与字符串里的散文不是「参数参与」。
 *
 * 分两套，由引用文件的语言决定（`languageOfFile`）：
 *   · Python：三引号块 + `#` 行注释；
 *   · C 系：块注释（可跨行）、`//` 行注释、单双引号字符串。
 *
 * 为什么必须区分：IC 链的过程节点引用的是 `.c`（`InitialConditions.c` 等），
 * C 里参数写成 `inputs->matter_options->PERTURB_ALGORITHM`，得能被认出来；
 * 而注释里提到的参数名（历史注释、被注释掉的代码）不能被算成命中。
 * 判定是"整行没有代码才屏蔽"：行尾的 `//` 注释不影响该行代码部分。
 */
function stringMask(lines, language) {
  return language === 'c' ? cStringMask(lines) : pythonStringMask(lines)
}

/** Python：三引号块与 `#` 行注释 */
function pythonStringMask(lines) {
  const mask = new Array(lines.length).fill(false)
  let inTriple = null
  lines.forEach((line, index) => {
    const quotes = ['"""', "'''"].map((q) => {
      let count = 0
      let cursor = 0
      while ((cursor = line.indexOf(q, cursor)) !== -1) {
        count += 1
        cursor += 3
      }
      return { q, count }
    })
    if (inTriple) {
      mask[index] = true
      if ((quotes.find((item) => item.q === inTriple)?.count ?? 0) % 2 === 1) inTriple = null
      return
    }
    const opened = quotes.find((item) => item.count % 2 === 1)
    if (opened) {
      inTriple = opened.q
      mask[index] = true
      return
    }
    if (/^\s*#/.test(line)) mask[index] = true
  })
  return mask
}

/** C 系：逐字符走一遍，跟踪块注释与引号；整行没留下代码就屏蔽 */
function cStringMask(lines) {
  const mask = new Array(lines.length).fill(false)
  let inBlock = false
  lines.forEach((line, index) => {
    let cursor = 0
    let hasCode = false
    let inside = inBlock
    while (cursor < line.length) {
      if (inside) {
        const close = line.indexOf('*/', cursor)
        if (close === -1) break
        inside = false
        cursor = close + 2
        continue
      }
      const char = line[cursor]
      if (char === '/' && line[cursor + 1] === '*') {
        inside = true
        cursor += 2
        continue
      }
      if (char === '/' && line[cursor + 1] === '/') break
      if (char === '"' || char === "'") {
        hasCode = true
        cursor += 1
        while (cursor < line.length) {
          if (line[cursor] === '\\') {
            cursor += 2
            continue
          }
          if (line[cursor] === char) {
            cursor += 1
            break
          }
          cursor += 1
        }
        continue
      }
      if (!/\s/.test(char)) hasCode = true
      cursor += 1
    }
    inBlock = inside
    mask[index] = inside || !hasCode
  })
  return mask
}

const PROSE = /:param\b|:return\b|:class:|:func:|:rtype:|:type\b|\.\. note::|\\param|@param/

/**
 * Python 函数体范围（1 起，含）：跳过可能跨多行的签名，到下一个同级定义为止。
 * 旧版直接找「缩进 ≤ def 缩进」的第一行，于是
 * `def _setup_ics_and_pfs_for_scrolling(` 这种多行签名会把函数体截成 3 行。
 */
function pythonFunctionRange(lines, defLine) {
  const indent = (lines[defLine - 1] ?? '').match(/^\s*/)[0].length
  let depth = 0
  let signatureEnd = defLine
  for (let n = defLine; n <= lines.length; n += 1) {
    const line = lines[n - 1] ?? ''
    for (const char of line) {
      if ('([{'.includes(char)) depth += 1
      else if (')]}'.includes(char)) depth -= 1
    }
    if (depth <= 0 && /:\s*$/.test(line)) {
      signatureEnd = n
      break
    }
  }
  for (let n = signatureEnd + 1; n <= lines.length; n += 1) {
    const line = lines[n - 1] ?? ''
    if (!line.trim() || /^\s*#/.test(line)) continue
    if ((line.match(/^\s*/)[0].length) <= indent) return { start: defLine, end: n - 1 }
  }
  return { start: defLine, end: lines.length }
}

/**
 * C 函数体范围：从函数头往后数花括号配对。
 * 近似处理——不排除字符串 / 注释里的花括号；这里只用来圈"参数可能出现在哪段"，
 * 圈大一点无害（多出来的行还要过屏蔽表）。
 */
function cFunctionRange(lines, defLine) {
  let depth = 0
  let started = false
  for (let n = defLine; n <= lines.length; n += 1) {
    for (const char of lines[n - 1] ?? '') {
      if (char === '{') {
        depth += 1
        started = true
      } else if (char === '}') {
        depth -= 1
        if (started && depth <= 0) return { start: defLine, end: n }
      }
    }
  }
  return { start: defLine, end: lines.length }
}

/**
 * 引用行往上找最近的函数头：Python 找 `def`，C 找函数定义行
 * （跳过 `#` 预处理行、分号结尾的声明、以及 `if` / `for` 这类控制语句）。
 * 找不到就返回 null，由调用方退回「引用行 ± 30 行」的窗口。
 */
function enclosingFunctionLine(lines, line, language) {
  const limit = Math.min(line, lines.length)
  for (let index = limit - 1; index >= 0; index -= 1) {
    const text = lines[index] ?? ''
    if (language !== 'c') {
      if (/^(\s*)(async\s+)?def\s/.test(text)) return index + 1
      continue
    }
    if (/^\s*#/.test(text)) continue
    if (/^\s*(if|for|while|switch|else|do|return)\b/.test(text)) continue
    if (/;\s*$/.test(text)) continue
    if (/^\s*[A-Za-z_][A-Za-z0-9_\s\*]*\b\w+\s*\(/.test(text)) return index + 1
  }
  return null
}

/** 只分两类：Python 走缩进口径，其余（C 系）走花括号口径 */
const languageOfFile = (file) => (String(file).endsWith('.py') ? 'py' : 'c')

/** 用法分类：赋值 / 开关 / 入公式 */
function classify(line, name) {
  if (new RegExp(`\\b${name}\\b["']?\\s*(:[^:=]|=(?!=)|\\+=|-=)`).test(line)) return '赋值'
  if (/\b(if|elif|while)\b/.test(line)) return '开关'
  return '入公式'
}

/* ---------------- 主流程 ---------------- */

const owner = await collectParams()
const paramNames = [...owner.keys()]
console.log(`参数名 ${paramNames.length} 个（${PARAM_CLASSES.map((cls) => `${cls}:${paramNames.filter((n) => owner.get(n) === cls).length}`).join(' ')}）`)

const graph = (await (await fetch(`${BASE}/api/graph`)).json()).graph
const nodes = graph.nodes ?? []
const fileCache = new Map()
async function readSource(relative) {
  if (fileCache.has(relative)) return fileCache.get(relative)
  let entry = null
  try {
    const lines = (await fs.readFile(path.resolve(REPO_ROOT, relative), 'utf8')).split('\n')
    entry = { lines, mask: stringMask(lines, languageOfFile(relative)) }
  } catch {
    entry = null
  }
  fileCache.set(relative, entry)
  return entry
}

const stat = { refs: 0, missing: 0, hits: 0, noRef: 0, noHit: 0, skippedParent: 0 }
const detailsByNode = new Map()

/**
 * 标签**只长在叶子上**（有子节点的模块靠「子图标签的并集」派生展示）。
 * 所以扫描时直接跳过父模块——否则写回去会被 server 的交叉校验拒掉（schema 里已强制）。
 */
const parents = new Set(nodes.map((node) => node.parent).filter(Boolean))

for (const node of nodes) {
  if (parents.has(node.id)) {
    stat.skippedParent += 1
    continue
  }
  const refs = (node.refs ?? []).filter((ref) => ref.file && ref.line)
  if (!refs.length) {
    stat.noRef += 1
    continue
  }
  const found = new Map() // `${name}::${kind}` → item
  for (const ref of refs) {
    stat.refs += 1
    const entry = await readSource(ref.file)
    if (!entry) {
      stat.missing += 1
      continue
    }
    const { lines, mask } = entry
    // 范围：给了区间用区间；否则用「引用所在的函数体」；Python 里找不到 def 才退回 30 行窗口
    let start = Math.max(1, Number(ref.line) - 2)
    let end = Math.min(lines.length, Number(ref.endLine || ref.line + 30))
    if (!ref.endLine) {
      const language = languageOfFile(ref.file)
      const defLine = enclosingFunctionLine(lines, Number(ref.line), language)
      if (defLine) {
        const range = language === 'c' ? cFunctionRange(lines, defLine) : pythonFunctionRange(lines, defLine)
        start = Math.max(1, Math.min(start, range.start))
        end = Math.max(end, range.end)
      }
    }
    for (let n = start; n <= end; n += 1) {
      if (mask[n - 1]) continue
      const line = lines[n - 1] ?? ''
      if (PROSE.test(line)) continue
      for (const name of paramNames) {
        if (!new RegExp(`\\b${name}\\b`).test(line)) continue
        const kind = classify(line, name)
        const key = `${name}::${kind}`
        stat.hits += 1
        if (found.has(key)) continue
        found.set(key, { label: name, kind, note: '', ref: { file: ref.file, line: n } })
      }
    }
  }
  if (!found.size) {
    stat.noHit += 1
    continue
  }
  detailsByNode.set(node.id, [...found.values()].sort((a, b) => a.label.localeCompare(b.label)))
}

/* ---------------- 汇总打印 ---------------- */
console.log(`扫描引用 ${stat.refs} 处（缺文件 ${stat.missing}），命中出现 ${stat.hits} 次`)
console.log(
  `节点：父模块跳过 ${stat.skippedParent}（标签只长在叶子上），无引用跳过 ${stat.noRef}，有引用但无命中跳过 ${stat.noHit}，命中 ${detailsByNode.size}\n`,
)

const perParam = new Map()
for (const [nodeId, items] of detailsByNode) {
  const node = nodes.find((item) => item.id === nodeId)
  for (const item of items) {
    if (!perParam.has(item.label)) perParam.set(item.label, [])
    perParam.get(item.label).push({ node, item })
  }
}
const classOrder = new Map(PARAM_CLASSES.map((cls, index) => [cls, index]))
;[...perParam.entries()]
  .sort((a, b) => (classOrder.get(owner.get(a[0])) ?? 99) - (classOrder.get(owner.get(b[0])) ?? 99) || b[1].length - a[1].length)
  .forEach(([name, list]) => {
    const byKind = list.reduce((acc, { item }) => {
      acc[item.kind] = (acc[item.kind] ?? 0) + 1
      return acc
    }, {})
    const sample = list
      .slice(0, 2)
      .map(({ node, item }) => `${node.label.slice(0, 14)}@${path.basename(item.ref.file)}:${item.ref.line}`)
      .join(' ')
    console.log(
      `  ${String(owner.get(name) ?? '?').padEnd(18)} ${name.padEnd(24)} ${String(list.length).padStart(2)} 条明细 / ${new Set(list.map(({ node }) => node.id)).size} 节点 ${JSON.stringify(byKind)}  ${sample}`,
    )
  })

/* ---------------- 组装并写回 ---------------- */
const registry = [...(graph.meta?.tags ?? [])]
/** 推送新标签之前记下既有的：dry-run 用它报告"将新增哪些" */
const existingTagIds = new Set(registry.map((tag) => tag.id))
/**
 * 本脚本负责的标签 = id 形如 `tag:<已知参数名>`。**只有这些允许被刷新**。
 *
 * 旧版这里用的是「所有 `tag:` 前缀的 id」，于是重扫时会把节点上那些
 * 非参数标签（`tag:初始条件`、`tag:2LPT` …）先删掉、又重建不出来——
 * IC 链的标签当年就是这么没的。现在只碰自己负责的那批，其余一律保留。
 */
const managedTagIds = new Set(paramNames.map((name) => tagIdOf(name)))
perParam.forEach((_list, name) => {
  const id = tagIdOf(name)
  if (existingTagIds.has(id)) return
  registry.push({
    id,
    name,
    description: '',
    group: owner.get(name) ?? '',
    color: tagColorOf(owner.get(name)),
  })
  managedTagIds.add(id)
})

const nextTags = registry
  .map((tag) =>
    owner.has(tag.id.slice(4))
      ? { ...tag, group: owner.get(tag.id.slice(4)), color: tagColorOf(owner.get(tag.id.slice(4))) }
      : tag,
  )
  .sort((a, b) => {
    const left = owner.has(a.id.slice(4)) ? classOrder.get(owner.get(a.id.slice(4))) ?? 90 : 91
    const right = owner.has(b.id.slice(4)) ? classOrder.get(owner.get(b.id.slice(4))) ?? 90 : 91
    return left - right
  })

const nextNodes = nodes.map((node) => {
  // 只摘掉本脚本负责的参数标签（它们由这一轮扫描重建）；自由标签与明细原样留着
  const keptTags = (node.tags ?? []).filter((id) => !managedTagIds.has(id))
  const keptDetails = Object.fromEntries(Object.entries(node.tagDetails ?? {}).filter(([id]) => !managedTagIds.has(id)))
  const items = detailsByNode.get(node.id)
  if (!items) return { ...node, tags: keptTags, tagDetails: keptDetails }
  return {
    ...node,
    tags: [...keptTags, ...new Set(items.map((item) => tagIdOf(item.label)))],
    tagDetails: {
      ...keptDetails,
      ...items.reduce((acc, item) => {
        const id = tagIdOf(item.label)
        acc[id] = [...(acc[id] ?? []), item]
        return acc
      }, {}),
    },
  }
})

const failures = []
const assert = (ok, message) => {
  if (!ok) failures.push(message)
}
assert(nextNodes.length === nodes.length, '节点数被改变')
assert(graph.edges.length === (graph.edges ?? []).length, '关系数被改变')
nextNodes.forEach((node) => {
  const items = Object.entries(node.tagDetails).filter(([id]) => managedTagIds.has(id))
  items.forEach(([id, list]) => {
    if (!node.tags.includes(id)) failures.push(`明细没有对应归属：${node.id} / ${id}`)
    if (!list.length) failures.push(`空明细：${node.id} / ${id}`)
    list.forEach((item) => {
      if (!item.ref?.file || !item.ref?.line) failures.push(`明细缺出处：${node.id} / ${item.label}`)
    })
  })
})
if (failures.length) {
  console.error(`\n断言失败，未写盘（${failures.length} 条）：`)
  failures.slice(0, 8).forEach((message) => console.error(`  ✗ ${message}`))
  process.exit(1)
}

const addedTags = registry.filter((tag) => !existingTagIds.has(tag.id))
const keptFreeTags = [...new Set(nodes.flatMap((node) => (node.tags ?? []).filter((id) => !managedTagIds.has(id))))]
console.log(
  `标签：新增 ${addedTags.length} 个${addedTags.length ? `（${addedTags.map((tag) => tag.name).join('、')}）` : ''}` +
    ` · 非参数标签保留 ${keptFreeTags.length} 个${keptFreeTags.length ? `（${keptFreeTags.join('、')}）` : ''}`,
)

if (!APPLY) {
  console.log('\n（dry-run：没有写盘。核对清单后加 --apply 执行）')
  process.exit(0)
}

const response = await fetch(`${BASE}/api/graph`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    graph: { ...graph, meta: { ...graph.meta, tags: nextTags }, nodes: nextNodes },
    reason: 'tags:scan-parameters',
  }),
})
const body = await response.json().catch(() => ({}))
if (!response.ok) {
  console.error(`写盘失败 ${response.status}: ${JSON.stringify(body).slice(0, 500)}`)
  process.exit(1)
}
const after = (await (await fetch(`${BASE}/api/graph`)).json()).graph
console.log(`\n已写回：${(after.meta.tags ?? []).length} 个标签，${after.nodes.filter((n) => n.tags.length).length} 个节点带标签`)
