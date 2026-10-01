import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CODE_DIR,
  CODE_EXTENSIONS,
  CODE_LARGE_FILE_LINES,
  CODE_MAX_FILES,
  CODE_MAX_FILE_BYTES,
  CODE_MAX_WINDOW_LINES,
  CODE_SKIP_DIRS,
  CODE_SKIP_PATHS,
} from './paths.mjs'
import { lexPrefixFor } from './lexState.mjs'

/**
 * 源码索引：把仓库里的代码文件列出来，并按行区间读取片段。
 *
 * 与 notes 索引（mdIndex.mjs）同一套约定：
 *   · 只读、不复制，源文件改动后点刷新即可同步；
 *   · 用「文件数 + 大小 + mtime」签名缓存列表；
 *   · 所有路径解析都做越界防护，只能落在 CODE_DIR 内（拒绝 ../ 与绝对路径逃逸）。
 *
 * 与 notes 索引的区别：这里返回的是**行窗口**而不是全文。窗口有两种取法（见 readCodeWindow）：
 * 围绕「节点锚定的那几行」多看一点上下文，或按调用方指定的行区间分段取——
 * 无论哪种，一次都只给一段，把整个 .c 文件塞进浏览器既慢也没意义。
 */

/** 列表缓存：{ signature, files } */
let cache = { signature: '', files: [] }

/** 扩展名 → Prism 语言名（前端 react-syntax-highlighter 用同一套名字） */
const LANGUAGE_BY_EXT = {
  '.c': 'c',
  '.h': 'c',
  '.cu': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.py': 'python',
  '.mjs': 'javascript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.css': 'css',
  '.sh': 'bash',
  '.f90': 'fortran',
  '.toml': 'toml',
  '.ipynb': 'json',
}

export function languageOf(filePath) {
  return LANGUAGE_BY_EXT[path.extname(filePath).toLowerCase()] || 'text'
}

/** 相对路径（POSIX）↔ 绝对路径；写入图谱时统一用相对路径，跨机器也能对上 */
export function toCodePath(absPath) {
  return path.relative(CODE_DIR, absPath).split(path.sep).join('/')
}

/**
 * 解析源码路径为绝对路径，并校验：
 *   · 必须落在 CODE_DIR 内（`../` 与绝对路径都不能逃逸）；
 *   · 扩展名在允许清单里（避免被当成任意文件读取器）。
 * 返回 null 表示拒绝。
 */
export function resolveCodePath(file) {
  const normalized = String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) return null
  if (!CODE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) return null
  const base = path.resolve(CODE_DIR)
  const abs = path.resolve(base, normalized)
  if (abs !== base && !abs.startsWith(`${base}${path.sep}`)) return null
  return abs
}

/** 递归收集代码文件；跳过构建产物、依赖与数据目录（见 CODE_SKIP_DIRS） */
async function walkCode(dir, out = []) {
  if (out.length >= CODE_MAX_FILES) return out
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (out.length >= CODE_MAX_FILES) break
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (CODE_SKIP_DIRS.has(entry.name) || entry.name.endsWith('.egg-info')) continue
      // 按整条相对路径判定：只排掉仓库根的构建镜像，不误伤 src/ 下同名的真目录
      if (CODE_SKIP_PATHS.has(toCodePath(full))) continue
      await walkCode(full, out)
      continue
    }
    // 符号链接一律跳过：可能指向仓库外，也会让大小/去重失去意义
    if (!entry.isFile()) continue
    if (!CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    out.push(full)
  }
  return out
}

async function signatureOf(files) {
  const stats = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(file).catch(() => null)
      return `${file}:${stat?.size ?? 0}:${stat?.mtimeMs ?? 0}`
    }),
  )
  return stats.join('|')
}

/** 源码文件列表（含语言与大小），按路径排序，签名未变时直接命中缓存 */
export async function listCodeFiles({ force = false } = {}) {
  const files = await walkCode(CODE_DIR)
  const signature = await signatureOf(files)
  if (!force && signature === cache.signature) return cache.files

  const entries = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(file).catch(() => null)
      const rel = toCodePath(file)
      return {
        path: rel,
        name: path.basename(file),
        dir: path.dirname(rel) === '.' ? '' : path.dirname(rel),
        ext: path.extname(file).toLowerCase(),
        language: languageOf(file),
        size: stat?.size ?? 0,
        updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : '',
      }
    }),
  )

  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  cache = { signature, files: entries }
  return entries
}

/** 失效缓存（源码目录变化后由路由调用） */
export function invalidateCodeCache() {
  cache = { signature: '', files: [] }
}

/**
 * 读取某文件的一段行窗口。
 *
 * 两种取法（`mode`），都在同一个入口里，共用越界防护、语言判定与行数夹紧：
 *
 *   · `highlight`（默认，与改动前逐字段一致）：`start` / `end` 是**要高亮的行区间**
 *     （1 起，含两端），`context` 是前后额外多给的行数，返回窗口 = 该区间 ± context。
 *     预览面板打开一个引用时用它，既能把目标行放在中间，又不必把整文件传过去。
 *   · `range`：`from` / `to` 是**要取的行区间本身**（1 起、含两端），不叠加 `context`；
 *     `start` / `end` 仍表示「要高亮的引用区间」，返回值里的高亮取它与本段的**交集**
 *     （无交集时给 0，表示本段不含引用行）。按段连续浏览整个文件时用它——
 *     一段就是一段，调用方按页边界对齐请求，行号天然不重不漏。
 *
 * 两种取法都受 `CODE_MAX_WINDOW_LINES` 夹紧，返回值都带段元数据
 * （`segmentStart/segmentEnd/hasPrev/hasNext`）与「文件大到需要说明一句」的原因。
 * `lines` 是 [{ n, text }]，`highlightStart/End` 是要高亮的行区间（已夹紧），
 * 前端据此渲染行号、高亮与「在 VS Code 中打开」的目标行。
 *
 * 还带一个 `lexPrefix`：窗口起点若落在跨行的字符串 / 注释**内部**，给出开启那个构造的
 * 那一行（`{ start, text }`），否则 null。语法高亮是逐窗口做词法分析的，没有它的话
 * 窗口里那个本该是闭引号的 `"""` 会被当成开引号，往后整片染色（见 lexState.mjs）。
 */
export async function readCodeWindow(
  file,
  { start = null, end = null, context = 6, mode = 'highlight', from = null, to = null } = {},
) {
  const abs = resolveCodePath(file)
  if (!abs) throw Object.assign(new Error('非法的源码路径'), { status: 400 })
  const stat = await fs.stat(abs).catch(() => null)
  if (!stat || !stat.isFile()) throw Object.assign(new Error(`未找到源码文件：${file}`), { status: 404 })

  const raw = await fs.readFile(abs, 'utf8').catch(() => {
    throw Object.assign(new Error(`无法读取源码文件：${file}`), { status: 500 })
  })
  const all = raw.split(/\r?\n/)
  const totalLines = all.length

  /** 引用区间（要锚定 / 高亮的那几行）：两种取法含义一致，先夹到文件范围内 */
  const first = clampLine(start ?? 1, totalLines)
  const last = clampLine(Math.max(end ?? first, first), totalLines)

  const base = {
    path: toCodePath(abs),
    absolutePath: abs,
    name: path.basename(abs),
    language: languageOf(abs),
    totalLines,
    bytes: stat.size,
    /** 字节超限：口径与改动前一致（供前端判断「这个文件很大」） */
    oversized: stat.size > CODE_MAX_FILE_BYTES,
    /** 需要说明一句「为什么只能按段给」的原因；不需要说明时是 null */
    oversizedReason: largeFileReason(stat.size, totalLines),
    updatedAt: new Date(stat.mtimeMs).toISOString(),
  }

  if (mode === 'range') {
    // from / to 就是窗口本身：不叠加 context（分页器按页边界请求，多给反而让它对不齐）
    const requestedFrom = positiveInt(from) ?? first
    const requestedTo = Math.max(requestedFrom, positiveInt(to) ?? requestedFrom)
    const windowStart = clampLine(requestedFrom, totalLines)
    const cappedEnd = clampLine(requestedTo, totalLines)
    // 单次上限对窗口本身生效：超长请求只给前 CODE_MAX_WINDOW_LINES 行
    const windowEnd = Math.min(cappedEnd, windowStart + CODE_MAX_WINDOW_LINES - 1)

    // 高亮 = 引用区间与本段的交集；本段不含引用行时给 0
    const overlapStart = Math.max(first, windowStart)
    const overlapEnd = Math.min(last, windowEnd)
    const overlapping = overlapStart <= overlapEnd

    return {
      ...base,
      /** 实际返回的行窗口 */
      windowStart,
      windowEnd,
      /** 要高亮的行区间（本段与引用区间的交集；0 表示本段不高亮） */
      highlightStart: overlapping ? overlapStart : 0,
      highlightEnd: overlapping ? overlapEnd : 0,
      /**
       * 请求的区间是否被**单次上限**截断。
       *
       * 与 highlight 取法的口径不同：那里"夹紧"包含「越出文件末尾」，因为那种请求是
       * 围绕一个引用行取窗口，越界说明要的窗口没给全；而这里调用方是按页请求的
       * ——**最后一段本来就会越过文件末尾**（文件长度很少正好是段长的整数倍），
       * 那不是异常。界面据此显示既有的「区间已被截断」，所以只认上限截断这一种。
       */
      clamped: windowEnd < cappedEnd,
      lines: sliceLines(all, windowStart, windowEnd),
      /**
       * 让窗口起点落在正确词法状态所需的**一行**前缀（开引号 / 块注释起始那一行）；
       * 起点不在任何跨行构造里时是 null。前端拼上它但不显示，见 lexState.mjs。
       */
      lexPrefix: lexPrefixFor(all, windowStart, base.language),
      /** 段 = 实际返回的行范围（分页语义的名字，与 windowStart/End 同值） */
      segmentStart: windowStart,
      segmentEnd: windowEnd,
      hasPrev: windowStart > 1,
      hasNext: windowEnd < totalLines,
    }
  }

  // 高亮段自身也受窗口上限约束：超长区间只给前 CODE_MAX_WINDOW_LINES 行
  const highlightEnd = Math.min(last, first + CODE_MAX_WINDOW_LINES - 1)

  const pad = Math.max(0, Math.min(200, Math.floor(Number(context) || 0)))
  const windowStart = Math.max(1, first - pad)
  const windowEnd = Math.min(totalLines, highlightEnd + pad)

  return {
    ...base,
    /** 实际返回的行窗口 */
    windowStart,
    windowEnd,
    /** 要高亮的行区间（已夹紧到文件与窗口上限内） */
    highlightStart: first,
    highlightEnd,
    /** 请求的高亮区间是否被截断或夹紧 */
    clamped: first !== (start ?? 1) || highlightEnd !== last,
    lines: sliceLines(all, windowStart, windowEnd),
    /** 与 range 取法同一口径：窗口起点落在跨行构造内部时给一行前缀（见 lexState.mjs） */
    lexPrefix: lexPrefixFor(all, windowStart, base.language),
    /** 段 = 实际返回的行范围（分页语义的名字，与 windowStart/End 同值） */
    segmentStart: windowStart,
    segmentEnd: windowEnd,
    hasPrev: windowStart > 1,
    hasNext: windowEnd < totalLines,
  }
}

function clampLine(value, total) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 1
  return Math.min(Math.max(1, Math.floor(num)), Math.max(1, total))
}

/** 正整数行号；非法（非数 / 0 / 负数）给 null，由调用方决定回退值 */
function positiveInt(value) {
  const num = Math.floor(Number(value))
  return Number.isFinite(num) && num > 0 ? num : null
}

/** 按行区间切片（1 起、含两端），越界处补空串——与整文件切片的取法一致 */
function sliceLines(all, from, to) {
  const lines = []
  for (let n = from; n <= to; n += 1) {
    lines.push({ n, text: all[n - 1] ?? '' })
  }
  return lines
}

/**
 * 「这个文件大到需要说明一句」的原因；不需要说明时给 null。
 *
 * 两个阈值都不阻止读取（range 取法照样一段一段给），只决定界面要不要说
 * 「按段加载、完整阅读建议在编辑器里打开」——静默地只给一小段才是要避免的。
 */
function largeFileReason(bytes, totalLines) {
  const reasons = []
  if (bytes > CODE_MAX_FILE_BYTES) {
    const mb = (value) => `${(value / 1024 / 1024).toFixed(1)} MB`
    reasons.push(`文件 ${mb(bytes)}，超过单文件上限 ${mb(CODE_MAX_FILE_BYTES)}`)
  }
  if (totalLines > CODE_LARGE_FILE_LINES) {
    reasons.push(`共 ${totalLines} 行，超过按段浏览阈值 ${CODE_LARGE_FILE_LINES} 行`)
  }
  return reasons.length ? reasons.join('；') : null
}
