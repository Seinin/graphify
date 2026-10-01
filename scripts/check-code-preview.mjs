/**
 * 源码预览自检（服务端这一半）：直接 import `readCodeWindow` 跑断言，**不依赖 dev 服务**。
 *
 * 为什么需要它：
 * 预览的两个取法（围绕引用行的 `highlight`、按段请求的 `range`）都在同一个函数里，
 * 而它们的返回值会被前端拿来当行号、高亮区间与「还有没有下一段」的依据——
 * 一旦边界算错，表现是"少了半段""段重叠导致行号重复""滚到底不动"，
 * 在浏览器里都很难一眼看出是服务端的口径问题，所以在这里钉死。
 *
 * 检查的事：
 *   1. range 取法：给什么行区间就返回什么（1 起、含两端、不叠加 context），行号连续；
 *   2. 边界：首段 hasPrev=false、尾段夹到文件末行、请求越界夹紧并标 clamped；
 *   3. 单次行数上限：超过 `CODE_MAX_WINDOW_LINES` 被夹紧（分段浏览的体积兜底）；
 *   4. 高亮取交集：本段不含引用行时给 0（前端据此"本段不高亮"）；
 *   5. 逐段读到底：行号恰好覆盖 1..N（不重不漏，段边界对齐的意义就在这里）；
 *   6. highlight 取法回归：窗口与高亮区间与改动前一致（选择器靠它）；
 *   7. 正常文件不给大文件提示；调低阈值后（另起子进程）两个原因都要给出；
 *   8. 越界防护不放宽：`../` 逃逸、白名单外扩展名、文件不存在分别 400 / 400 / 404；
 *   9. 词法前缀：窗口起点落在跨行字符串 / 注释内部时给出"开引号那一行"，其余时候不给。
 *
 * 用法：`npm run check:code`（失败时退出码 1）
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readCodeWindow } from '../server/lib/codeIndex.mjs'
import { lexPrefixFor } from '../server/lib/lexState.mjs'
import { CODE_LARGE_FILE_LINES, CODE_MAX_WINDOW_LINES } from '../server/lib/paths.mjs'

/** 与前端分页器一致的段大小（见 src/hooks/useCodeLibrary.ts 的 SEGMENT_LINES） */
const SEGMENT = 300

/** 大文件提示的验证要另起进程：阈值在模块加载时读取，本进程改不动 */
const NOTICE_PHASE = process.env.GRAPHIFY_CODE_PREVIEW_PHASE === 'notice'

/** 样例文件候选：按行数从多到少，取第一个够长的（够长才能验证翻页与夹紧） */
const SAMPLE_CANDIDATES = [
  'src/py21cmfast/src/SpinTemperatureBox.c',
  'src/py21cmfast/src/IonisationBox.c',
  'src/py21cmfast/src/heating_helper_progs.c',
  'src/py21cmfast/src/hmf.c',
  'src/py21cmfast/src/interp_tables.c',
]

const failures = []
let checks = 0

function ok(condition, label, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ✓ ${label}`)
    return true
  }
  const line = `${label}${detail ? ` — ${detail}` : ''}`
  failures.push(line)
  console.log(`  ✗ ${line}`)
  return false
}

/** 期望调用被拒绝，并核对它抛出的状态码 */
async function rejects(label, file, options, status) {
  try {
    await readCodeWindow(file, options)
    ok(false, label, '没有抛错')
  } catch (error) {
    ok(error.status === status, label, `status=${error.status}（期望 ${status}）`)
  }
}

/** 挑一个够长的真实源码文件做样例；挑不到就返回 null（不让断言误报） */
async function pickSample(minLines) {
  for (const candidate of SAMPLE_CANDIDATES) {
    try {
      const probe = await readCodeWindow(candidate, { mode: 'range', from: 1, to: 1 })
      if (probe.totalLines >= minLines) return { file: candidate, total: probe.totalLines }
    } catch {
      // 文件不在（换了机器/换了源码根）就换下一个候选
    }
  }
  return null
}

async function runNoticePhase() {
  console.log('\n[大文件提示] 阈值已在子进程里调低（行数 10 / 字节 100）')
  const sample = await pickSample(1)
  if (!sample) {
    ok(false, '找到样例文件', '候选项都读不到')
    return
  }
  const probe = await readCodeWindow(sample.file, { mode: 'range', from: 1, to: 10 })
  ok(probe.oversized === true, '字节超上限时 oversized 为真')
  ok(
    typeof probe.oversizedReason === 'string' && probe.oversizedReason.includes('超过单文件上限'),
    '字节超限给出原因',
    String(probe.oversizedReason),
  )
  ok(
    typeof probe.oversizedReason === 'string' && probe.oversizedReason.includes('按段浏览阈值'),
    '行数超阈值给出原因',
    String(probe.oversizedReason),
  )
}

/** 用调低的阈值另起一个进程，验证「必须说明原因」那条（阈值在模块加载时读取） */
function runNoticePhaseInChild() {
  console.log('\n[大文件提示] 另起子进程验证（阈值在模块加载时读取，本进程改不动）')
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: {
      ...process.env,
      GRAPHIFY_CODE_PREVIEW_PHASE: 'notice',
      GRAPHIFY_CODE_LARGE_LINES: '10',
      GRAPHIFY_CODE_MAX_BYTES: '100',
    },
    encoding: 'utf8',
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  ok(result.status === 0, '子进程（调低阈值）里的两条原因断言都成立')
}

async function runMainPhase() {
  const sample = await pickSample(900)
  if (!ok(Boolean(sample), '找到一个 ≥900 行的真实源码文件作为样例', '候选项都不够长')) return
  const { file, total } = sample
  console.log(`  样例：${file}（${total} 行，共 ${Math.ceil(total / SEGMENT)} 段）`)

  // ---- 1. range：给什么行区间就返回什么 ----
  const mid = await readCodeWindow(file, { mode: 'range', from: 301, to: 600 })
  ok(mid.windowStart === 301 && mid.windowEnd === 600, 'range 段 301–600 的窗口与请求一致', `${mid.windowStart}–${mid.windowEnd}`)
  ok(mid.lines.length === 300 && mid.lines[0].n === 301 && mid.lines[299].n === 600, 'range 段返回 300 行且行号连续首尾正确')
  ok(mid.segmentStart === mid.windowStart && mid.segmentEnd === mid.windowEnd, '段元数据与窗口同值')
  ok(mid.hasPrev === true && mid.hasNext === true, '中段的 hasPrev / hasNext 都为真')
  ok(mid.clamped === false, '未触上限时 clamped 为假')
  const withContext = await readCodeWindow(file, { mode: 'range', from: 301, to: 600, context: 200 })
  ok(
    withContext.windowStart === 301 && withContext.windowEnd === 600,
    'range 取法不叠加 context（给 200 也不多给一行）',
    `${withContext.windowStart}–${withContext.windowEnd}`,
  )
  ok(mid.oversized === false && mid.oversizedReason === null, '正常文件不给大文件提示（oversizedReason 为 null）')

  // ---- 2. 边界：首段 / 尾段 / 越界 ----
  const head = await readCodeWindow(file, { mode: 'range', from: 1, to: SEGMENT })
  ok(head.hasPrev === false && head.hasNext === true, '首段 hasPrev 为假、hasNext 为真')
  const lastStart = Math.floor((total - 1) / SEGMENT) * SEGMENT + 1
  const tail = await readCodeWindow(file, { mode: 'range', from: lastStart, to: lastStart + SEGMENT - 1 })
  ok(tail.windowEnd === total && tail.hasNext === false, '尾段夹到文件末行且 hasNext 为假', `${tail.windowEnd}/${total}`)
  const beyond = await readCodeWindow(file, { mode: 'range', from: total - 9, to: total + 500 })
  ok(beyond.windowEnd === total && beyond.hasNext === false, '请求越过文件末尾时夹到末行', `${beyond.windowEnd}/${total}`)
  ok(beyond.clamped === false, '越过文件末尾不算被截断（最后一段本来就会越界，不该报警）')

  // ---- 3. 单次行数上限 ----
  const oversizedRequest = await readCodeWindow(file, { mode: 'range', from: 1, to: 900 })
  ok(
    oversizedRequest.lines.length === CODE_MAX_WINDOW_LINES && oversizedRequest.windowEnd === CODE_MAX_WINDOW_LINES,
    `单请求超过上限被夹到 ${CODE_MAX_WINDOW_LINES} 行`,
    `${oversizedRequest.lines.length} 行`,
  )
  ok(oversizedRequest.clamped === true, '被夹紧时 clamped 为真')

  // ---- 4. 高亮取交集 ----
  const anchored = await readCodeWindow(file, { mode: 'range', from: 301, to: 600, start: 350, end: 360 })
  ok(anchored.highlightStart === 350 && anchored.highlightEnd === 360, '本段包含引用区间时高亮取交集（350–360）')
  const unanchored = await readCodeWindow(file, { mode: 'range', from: 601, to: 900, start: 350, end: 360 })
  ok(unanchored.highlightStart === 0 && unanchored.highlightEnd === 0, '本段不含引用行时高亮给 0')
  const partial = await readCodeWindow(file, { mode: 'range', from: 301, to: 400, start: 380, end: 420 })
  ok(partial.highlightStart === 380 && partial.highlightEnd === 400, '引用区间跨段时高亮取本段内的那部分（380–400）')

  // ---- 5. 逐段读到底：行号恰好覆盖 1..N ----
  const seen = []
  const pages = Math.ceil(total / SEGMENT)
  for (let index = 0; index < pages; index += 1) {
    const from = index * SEGMENT + 1
    const segment = await readCodeWindow(file, { mode: 'range', from, to: from + SEGMENT - 1 })
    for (const line of segment.lines) seen.push(line.n)
  }
  ok(
    seen.length === total && seen[0] === 1 && seen[seen.length - 1] === total && new Set(seen).size === total,
    '逐段读到底：行号恰好覆盖 1..N（不重不漏）',
    `${seen.length} 行 / 共 ${total} 行，去重后 ${new Set(seen).size}`,
  )

  // ---- 6. highlight 取法回归（选择器靠它，一个字段都不能变） ----
  const legacy = await readCodeWindow(file, { start: 536, end: 545, context: 10 })
  ok(legacy.windowStart === 526 && legacy.windowEnd === 555, 'highlight 取法窗口 = 区间 ± context（与改动前一致）')
  ok(legacy.highlightStart === 536 && legacy.highlightEnd === 545, 'highlight 取法的高亮区间不变')
  ok(legacy.clamped === false, '未越界的 highlight 请求不标 clamped')
  const clampedLegacy = await readCodeWindow(file, { start: 1, end: 900, context: 0 })
  ok(
    clampedLegacy.highlightEnd === firstWindowCap(legacy.totalLines),
    'highlight 取法的高亮区间仍受单次上限夹紧',
    `${clampedLegacy.highlightEnd}`,
  )
  ok(clampedLegacy.clamped === true, 'highlight 取法被夹紧时标 clamped')
  const noFile = await readCodeWindow(file, {})
  ok(noFile.windowStart === 1 && noFile.highlightStart === 1, 'highlight 取法缺省参数回到文件头')

  // ---- 7. 越界防护（新老参数走同一道 resolveCodePath） ----
  await rejects('拒绝 ../ 逃逸', '../Graphify/server/index.mjs', { mode: 'range', from: 1, to: 10 }, 400)
  await rejects('拒绝绝对路径逃逸', '/etc/passwd', { mode: 'range', from: 1, to: 10 }, 400)
  await rejects('拒绝白名单外的扩展名', 'README.md', { mode: 'range', from: 1, to: 10 }, 400)
  await rejects('文件不存在给 404', 'src/py21cmfast/src/__not_here__.c', { mode: 'range', from: 1, to: 10 }, 404)
  await rejects('highlight 取法同样拒绝越界路径', '../Graphify/server/index.mjs', { start: 1, end: 2 }, 400)
}

/**
 * 词法前缀（`lexPrefix`）：窗口起点落在跨行构造内部时，必须给出"开引号那一行"。
 *
 * 它修的是这样一个偏差：预览按段取窗口，段内那个本该是**闭引号**的 `"""` 会被词法器
 * 当成开引号，于是它往后整片染色。实测 `lightcone.py`（`r"""` 在 590 行、闭引号在
 * 639 行）为 644 行取的 601–900 段就是这种情况，而 VS Code 显示正常。
 */
async function runLexPhase() {
  console.log('\n[词法前缀] 窗口起点落在跨行构造内部时给出一行前缀')

  // ---- 1. 状态机本身：合成输入，不依赖仓库文件 ----
  const units = [
    ['三引号内部给出开引号那一行', ['x = 1', '    r"""', 'doc', '"""', 'y = 2'], 3, 'python', 2],
    ['闭引号那一行的行首仍在字符串里（要给前缀）', ['x = 1', '    r"""', 'doc', '"""', 'y = 2'], 4, 'python', 2],
    ['闭引号之后不再给前缀', ['x = 1', '    r"""', 'doc', '"""', 'y = 2'], 5, 'python', null],
    ['块注释内部给出起始行', ['int a; /* 开始', 'still', 'end */', 'b;'], 2, 'c', 1],
    ['块注释结束之后不给', ['int a; /* 开始', 'still', 'end */', 'b;'], 4, 'c', null],
    ['字符串里的 /* 不算注释', ['char *p = "/*";', 'b;'], 2, 'c', null],
    ['注释里的引号不算构造', ['# 他说 """ 就完了', 'x = 1'], 2, 'python', null],
    ['反引号模板串跨行', ['const s = `a', 'b`', 'c'], 2, 'javascript', 1],
    ['反斜杠续行的字符串', ['s = "abc\\', 'def"', 'g'], 2, 'python', 1],
    ['没闭合的字符串不当续行（编辑器式恢复）', ['s = "abc', 'g'], 2, 'python', null],
    ['第一行行首永远在构造外', ['"""doc', 'x'], 1, 'python', null],
    ['json 没有跨行构造', ['{ "a": "b" }', '{'], 2, 'json', null],
    ['fortran 的 // 是字符串拼接、不是注释', ['x = "a" // "b"', 'y'], 2, 'fortran', null],
  ]
  for (const [label, lines, line, language, expect] of units) {
    const found = lexPrefixFor(lines, line, language)
    const start = found ? found.start : null
    ok(start === expect, label, `start=${start}（期望 ${expect}）`)
  }

  // ---- 2. 用户报的那一处：lightcone.py 的文档串跨到 639 行 ----
  const pinned = 'src/py21cmfast/drivers/lightcone.py'
  const pinnedOpener = await readCodeWindow(pinned, { mode: 'range', from: 590, to: 590 }).catch(() => null)
  const pinnedCloser = await readCodeWindow(pinned, { mode: 'range', from: 639, to: 639 }).catch(() => null)
  const premise =
    pinnedOpener?.lines?.[0]?.text.includes('r"""') && pinnedCloser?.lines?.[0]?.text.trim() === '"""'
  if (!premise) {
    console.log(`  – 跳过 lightcone.py 的行号断言（${pinned} 不在当前源码根，或 590 / 639 行已不是那个文档串）`)
  } else {
    const segment = await readCodeWindow(pinned, { mode: 'range', from: 601, to: 900 })
    ok(segment.lexPrefix?.start === 590, '段 601–900 的前缀指向 590 行（开引号）', JSON.stringify(segment.lexPrefix))
    ok(segment.lexPrefix?.text === '    r"""', '前缀就是那一行的原文', JSON.stringify(segment.lexPrefix?.text))
    const afterDoc = await readCodeWindow(pinned, { mode: 'range', from: 644, to: 698 })
    ok(afterDoc.lexPrefix === null, '644 起（文档串已闭合）不给前缀', JSON.stringify(afterDoc.lexPrefix))
    const highlight = await readCodeWindow(pinned, { start: 644, end: 650, context: 6 })
    ok(
      highlight.lexPrefix?.start === 590,
      'highlight 取法的窗口（638 起）同样带前缀',
      `窗口 ${highlight.windowStart}–${highlight.windowEnd}`,
    )
  }

  // ---- 3. 通用性质：前缀只能在窗口之前、不能落在窗口里（否则前端会把它当正文渲染） ----
  const sample = await pickSample(900)
  if (!sample) {
    ok(false, '找到样例文件以核对前缀位置', '候选项都读不到')
    return
  }
  const pages = Math.ceil(sample.total / SEGMENT)
  let prefixed = 0
  let violated = 0
  for (let index = 0; index < pages; index += 1) {
    const from = index * SEGMENT + 1
    const segment = await readCodeWindow(sample.file, { mode: 'range', from, to: from + SEGMENT - 1 })
    if (!segment.lexPrefix) continue
    prefixed += 1
    const firstLine = segment.lines[0].n
    const insideWindow = segment.lines.some((line) => line.n === segment.lexPrefix.start)
    if (segment.lexPrefix.start >= firstLine || insideWindow || !segment.lexPrefix.text) violated += 1
  }
  ok(
    violated === 0,
    '每段带的前缀都在窗口之前、不在窗口内、且非空',
    `${prefixed} / ${pages} 段带前缀`,
  )
}

/** highlight 取法里区间被单次上限夹紧后的末行 */
function firstWindowCap(totalLines) {
  return Math.min(900, 1 + CODE_MAX_WINDOW_LINES - 1, totalLines)
}

async function main() {
  console.log('源码预览 · 服务端自检')
  console.log(
    `阈值：单次上限 ${CODE_MAX_WINDOW_LINES} 行 | 大文件行数阈值 ${CODE_LARGE_FILE_LINES} 行 | 段大小 ${SEGMENT} 行`,
  )
  if (NOTICE_PHASE) {
    await runNoticePhase()
  } else {
    await runMainPhase()
    await runLexPhase()
    runNoticePhaseInChild()
  }

  console.log('')
  if (failures.length) {
    console.error(`✗ 源码预览自检失败：${failures.length} / ${checks} 项`)
    for (const line of failures) console.error(`  · ${line}`)
    process.exit(1)
  }
  console.log(`✓ 源码预览自检通过（${checks} 项断言）`)
}

await main()
