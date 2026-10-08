import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { CodeFile, CodeLine, CodeWindow, LexPrefix } from '../lib/types'

/**
 * 源码索引列表 + 搜索 + 手动刷新。
 *
 * 与 notes 数据库（useMdLibrary）同一套路：列表一次拉全（默认上限 400 条，
 * 够放下本仓库的代码文件），过滤放前端做，输一个字就筛一次不必往返服务端。
 * `codeDir` 回显索引根目录，界面上要显示它是为了让人确认「索引的是哪棵树」。
 */
export function useCodeLibrary({ enabled = true }: { enabled?: boolean } = {}) {
  const [files, setFiles] = useState<CodeFile[]>([])
  const [codeDir, setCodeDir] = useState('')
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(
    (force = false) => {
      setLoading(true)
      setError(null)
      api
        .listCode('', 4000)
        .then((data) => {
          setFiles(data.files)
          setCodeDir(data.codeDir)
          setTotal(data.count)
          if (force) return api.refreshCode().then(() => undefined)
          return undefined
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false))
    },
    [],
  )

  useEffect(() => {
    if (!enabled) return
    refresh(false)
  }, [enabled, refresh])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return files
    return files.filter((file) => file.path.toLowerCase().includes(keyword))
  }, [files, query])

  return { files, filtered, codeDir, total, loading, error, query, setQuery, refresh }
}

/**
 * 按需读取某文件的一段行窗口。
 * `file` 为空时不发请求（没有目标的预览请求只会换来一条 400）。
 */
export function useCodeWindow(
  file: string | null,
  start: number | null,
  end: number | null,
  context = 8,
) {
  const [data, setData] = useState<CodeWindow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setData(null)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    api
      .readCode(file, start, end, context)
      .then((payload) => {
        if (alive) setData(payload.window)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [file, start, end, context])

  return { window: data, loading, error }
}

/**
 * 分段连续浏览的段大小（行）。
 *
 * 必须 ≤ 服务端单次上限（`CODE_MAX_WINDOW_LINES`，默认 400）并留点余量：
 * 一段就是一次请求，取满上限会让「请求被夹紧」变成常态。
 */
export const SEGMENT_LINES = 300

/** 一个**连续区间**：显示层的一次语法分析单位（区间数 = 已加载的不连续区间数，与请求次数无关） */
export interface CodeWindowRun {
  /** 区间首行的文件行号（1 起） */
  startLine: number
  /** 区间末行的文件行号（1 起、含两端） */
  endLine: number
  /** 区间内所有行，按行号升序拼接 */
  lines: CodeLine[]
  /** 只取区间**首段**的：区间内部已经连续，不需要再补词法上下文 */
  lexPrefix: LexPrefix | null
  /** 区间之外还有没有内容：与首 / 末段同值 */
  hasPrev: boolean
  hasNext: boolean
}

/**
 * 把已加载的段按「首尾相接」合并成连续区间。
 *
 * 为什么必须合并：语法高亮是逐窗口做词法分析的——一段一个窗口，就等于每 300 行重开一次
 * 词法环境，跨段接缝处的文档字符串 / 块注释会被切断（同一份内容还会被反复分析）。
 * 段只是**读取与传输**单位，显示层不该跟着分段。
 *
 * 跳转造成的空洞自然分成多块：每块内部行号连续，`code-line-N` 依旧不重不漏。
 */
export function mergeRuns(segments: CodeWindow[]): CodeWindowRun[] {
  const runs: CodeWindowRun[] = []
  for (const segment of [...segments].sort((a, b) => a.segmentStart - b.segmentStart)) {
    const last = runs[runs.length - 1]
    if (last && last.endLine + 1 === segment.segmentStart) {
      last.lines.push(...segment.lines)
      last.endLine = segment.segmentEnd
      last.hasNext = segment.hasNext
      continue
    }
    runs.push({
      startLine: segment.segmentStart,
      endLine: segment.segmentEnd,
      lines: [...segment.lines],
      lexPrefix: segment.lexPrefix ?? null,
      hasPrev: segment.hasPrev,
      hasNext: segment.hasNext,
    })
  }
  return runs
}

/** 分页器对外暴露的文件元信息（取任一段的公共字段） */
export interface CodePagerMeta {
  path: string
  /** 绝对路径：复制「路径:行」时带上它，粘到编辑器 / 终端里可直接定位 */
  absolutePath: string
  name: string
  language: string
  totalLines: number
  /** 需要说明「为什么只能按段给」时的原因；正常文件为 null */
  oversizedReason: string | null
}

/**
 * 跳转请求：分页器只说「要停在哪一行」，滚动由视图层做（它才碰得到 DOM）。
 *
 * 刻意不带 `smooth`：长距离平滑滚动会和「续段的滚动锚定」抢滚动位置
 * （浏览器在动画里持续改写 scrollTop，锚定补偿会被覆盖），所以定位一律即时完成。
 */
export interface CodePagerScrollTarget {
  line: number
  /** 每次跳转都换一个值：让视图层的 effect 能对同一次跳转重复触发 */
  token: number
}

/** 行 → 页号（0 起） */
const pageOfLine = (line: number) => Math.floor((Math.max(1, Math.floor(line)) - 1) / SEGMENT_LINES)
/** 页号 → 页内首行（1 起） */
const pageStartLine = (page: number) => page * SEGMENT_LINES + 1
/** 页号 → 页内末行（1 起、含两端；越界由服务端夹到文件末尾） */
const pageEndLine = (page: number) => page * SEGMENT_LINES + SEGMENT_LINES

/**
 * 源码分段浏览器（抽屉用；选择器继续用 useCodeWindow，两者互不影响）。
 *
 * 与 `useCodeWindow` 的分工：那个是「读一段固定窗口」，这个是「按页取、可续段、可跳转」。
 * 关键约定：
 *   · **页边界按 SEGMENT_LINES 对齐**（`from = 300k + 1`）——段区间互不重叠，
 *     行号与 `code-line-N` 的 DOM id 天然唯一，去重不需要额外逻辑；
 *   · **去重不靠请求次数**：已加载的页记在内存里，跳回已加载的行不会再打接口；
 *     同一页的并发请求合并成一次（React 严格模式下 effect 会跑两遍）；
 *   · **换文件 / 换引用即换代号**：旧一轮迟到的响应照旧被丢掉，不会串进新一轮。
 *
 * 返回的 `scrollTarget` 是给视图层的「请滚到这里」信号——分页器不碰 DOM；
 * 视图层处理完用 `consumeScrollTarget()` 清掉。
 */
export function useCodePager(file: string | null, anchorStart: number | null, anchorEnd: number | null) {
  const [segments, setSegments] = useState<CodeWindow[]>([])
  const [meta, setMeta] = useState<CodePagerMeta | null>(null)
  const [loading, setLoading] = useState<'prev' | 'next' | 'jump' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scrollTarget, setScrollTarget] = useState<CodePagerScrollTarget | null>(null)

  /** 引用区间（要锚定 / 高亮的那几行）：缺省第 1 行，与 useCodeWindow 的默认一致 */
  const anchorFrom = Math.max(1, Math.floor(anchorStart ?? 1))
  const anchorTo = Math.max(Math.floor(anchorEnd ?? anchorFrom), anchorFrom)

  /** 已加载的段：页号 → 段 */
  const loadedRef = useRef(new Map<number, CodeWindow>())
  /** 正在飞的请求：页号 → 同一个 promise（并发同一页只发一次） */
  const inFlightRef = useRef(new Map<number, Promise<CodeWindow | null>>())
  /** 目标代号：换目标之后的迟到响应一律丢弃 */
  const generationRef = useRef(0)
  /** 跳转令牌：同一次跳转重复点击也能再次触发视图层 */
  const tokenRef = useRef(0)

  /** 把一段并进已加载集合：按行号排序输出，段之间天然不重不漏 */
  const commit = useCallback((page: number, segment: CodeWindow, generation: number) => {
    if (generation !== generationRef.current) return
    loadedRef.current.set(page, segment)
    setMeta({
      path: segment.path,
      absolutePath: segment.absolutePath,
      name: segment.name,
      language: segment.language,
      totalLines: segment.totalLines,
      oversizedReason: segment.oversizedReason,
    })
    setSegments([...loadedRef.current.values()].sort((a, b) => a.segmentStart - b.segmentStart))
    setError(null)
  }, [])

  /** 取一页；已加载就直接给（不重复请求），正在飞就复用那一次请求 */
  const fetchPage = useCallback(
    async (page: number, generation: number): Promise<CodeWindow | null> => {
      if (!file || page < 0) return null
      const cached = loadedRef.current.get(page)
      if (cached) return cached
      const running = inFlightRef.current.get(page)
      if (running) {
        const segment = await running
        // 复用同一次请求，但按**当前**这一轮登记——换目标后旧响应会被丢掉，这里补一次
        if (segment) commit(page, segment, generation)
        return segment
      }
      const task = (async () => {
        try {
          const payload = await api.readCodeRange(
            file,
            pageStartLine(page),
            pageEndLine(page),
            anchorFrom,
            anchorTo,
          )
          commit(page, payload.window, generation)
          return payload.window
        } catch (err) {
          // 旧一轮的失败不打扰新一轮
          if (generation === generationRef.current) setError((err as Error).message)
          return null
        }
      })()
      inFlightRef.current.set(page, task)
      try {
        return await task
      } finally {
        inFlightRef.current.delete(page)
      }
    },
    [file, anchorFrom, anchorTo, commit],
  )

  const requestScroll = useCallback((line: number) => {
    tokenRef.current += 1
    setScrollTarget({ line, token: tokenRef.current })
  }, [])

  const loadPage = useCallback(
    async (page: number, direction: 'prev' | 'next' | 'jump'): Promise<CodeWindow | null> => {
      if (!file || page < 0) return null
      const generation = generationRef.current
      setLoading(direction)
      try {
        return await fetchPage(page, generation)
      } finally {
        if (generation === generationRef.current) setLoading(null)
      }
    },
    [file, fetchPage],
  )

  /** 续上一段：`fromLine` = 「哪一段的上沿到头了」（默认已加载的最前一段） */
  const loadPrev = useCallback(
    (fromLine?: number) => {
      const list = [...loadedRef.current.values()]
      if (!list.length) return
      const base = fromLine ?? Math.min(...list.map((item) => item.segmentStart))
      void loadPage(pageOfLine(base) - 1, 'prev')
    },
    [loadPage],
  )

  /** 续下一段：`fromLine` = 「哪一段的下沿到头了」（默认已加载的最后一段） */
  const loadNext = useCallback(
    (fromLine?: number) => {
      const list = [...loadedRef.current.values()]
      if (!list.length) return
      const base = fromLine ?? Math.max(...list.map((item) => item.segmentEnd))
      void loadPage(pageOfLine(base) + 1, 'next')
    },
    [loadPage],
  )

  /** 跳到某一行所在的那一段；到地方了再请视图层滚过去（那一段可能刚取回来） */
  const jumpToLine = useCallback(
    (line: number) => {
      const generation = generationRef.current
      void loadPage(pageOfLine(line), 'jump').then((segment) => {
        if (segment && generation === generationRef.current) requestScroll(line)
      })
    },
    [loadPage, requestScroll],
  )

  const jumpToTop = useCallback(() => jumpToLine(1), [jumpToLine])
  const jumpToAnchor = useCallback(() => jumpToLine(anchorFrom), [jumpToLine, anchorFrom])
  const jumpToBottom = useCallback(() => {
    if (!meta) return
    jumpToLine(meta.totalLines)
  }, [meta, jumpToLine])

  /** 丢掉已加载的段，重新从引用行所在的那一段开始（换引用 / 手动重载都走它） */
  const reset = useCallback(() => {
    generationRef.current += 1
    loadedRef.current = new Map()
    inFlightRef.current = new Map()
    setSegments([])
    setMeta(null)
    setError(null)
    setLoading(null)
    setScrollTarget(null)
    if (!file) return
    void loadPage(pageOfLine(anchorFrom), 'jump')
  }, [file, anchorFrom, loadPage])

  // 换文件 / 换引用即重来一轮；旧一轮的响应由 generationRef 拦掉
  useEffect(() => {
    reset()
  }, [reset])

  const consumeScrollTarget = useCallback(() => setScrollTarget(null), [])

  return {
    segments,
    meta,
    loading,
    error,
    hasPrev: segments.length ? segments[0].hasPrev : false,
    hasNext: segments.length ? segments[segments.length - 1].hasNext : false,
    scrollTarget,
    consumeScrollTarget,
    loadPrev,
    loadNext,
    jumpToTop,
    jumpToAnchor,
    jumpToBottom,
    reset,
  }
}
