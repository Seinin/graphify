import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardCopy,
  ExternalLink,
  FileCode,
  Info,
  Link2,
  Loader2,
  Locate,
} from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip } from './ui/tooltip'
import { CodeBlock } from './CodeSnippet'
import { mergeRuns, useCodePager, type CodeWindowRun } from '../hooks/useCodeLibrary'
import { copyText, openInVscode } from '../lib/vscode'
import type { GraphRef } from '../lib/types'

/**
 * 源码预览抽屉。
 *
 * 与 md 阅读器（MdReaderDrawer）并列的另一半：节点既能锚到笔记的某节，也能锚到源码的某几行。
 * 打开时落在**被引用行所在的那一段**，滚到引用行并高亮；此后可以按段连续读完整个文件——
 * 滚到上 / 下边界自动续一段（每段 300 行），也能一键跳到文件头 / 引用行 / 文件尾。
 *
 * 段只是**读取与传输**单位：显示层把已加载的段按「首尾相接」合并成连续区间，
 * 一个区间只做一次词法分析——否则每 300 行的接缝都会把跨行的文档串 / 块注释切断。
 *
 * 三个出口与 md 阅读器保持一致：在 VS Code 中打开 / 复制「路径:行」/ 挂到当前选中节点。
 * 它们一律对准**被引用的那几行**，不随滚动漂移（否则滚一会儿再复制，位置就变了）。
 */
interface CodePreviewDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: string | null
  line: number | null
  endLine: number | null
  /** 当前是否选中了节点：决定「加入引用」是否可用 */
  canAddRef: boolean
  onAddRef: (ref: GraphRef) => void
}

/** 续段时的那一行提示：让「滚到边界」有回应，而不是看起来卡住了 */
function SegmentHint({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-2 text-micro text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      {label}
    </div>
  )
}

/**
 * 一个连续区间里要高亮的行区间 = 引用区间与本区间的交集。
 * 交集为空（本区间不含引用行）时给 0：渲染层据此"本区间不高亮"。
 * 与合并前的口径一致——那时这个交点是服务端逐段算好给的。
 */
function highlightOf(run: CodeWindowRun, anchorFrom: number, anchorTo: number) {
  const start = Math.max(anchorFrom, run.startLine)
  const end = Math.min(anchorTo, run.endLine)
  return start <= end ? { start, end } : { start: 0, end: 0 }
}

export function CodePreviewDrawer({
  open,
  onOpenChange,
  file,
  line,
  endLine,
  canAddRef,
  onAddRef,
}: CodePreviewDrawerProps) {
  const {
    segments,
    meta,
    loading,
    error,
    scrollTarget,
    consumeScrollTarget,
    loadPrev,
    loadNext,
    jumpToTop,
    jumpToAnchor,
    jumpToBottom,
  } = useCodePager(open ? file : null, line, endLine)

  /**
   * 真正的滚动视口（Radix 的 Viewport）：滚动监听与锚定补偿都作用在它身上。
   *
   * 用**回调 ref + state** 而不是 useRef：抽屉内容是 Radix 的 Portal，挂载时机晚于组件本身，
   * 用 useRef 会在 effect 第一次跑时读到 null，而 effect 的依赖又不再变化——
   * 监听就永远挂不上（浏览器探针实测踩过这个坑：滚到边界毫无反应）。
   */
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const viewportRef = useCallback((node: HTMLDivElement | null) => setViewport(node), [])
  /** 已渲染的段：给滚动监听用（回调里读，不触发重渲染） */
  const segmentsRef = useRef(segments)
  /** 加载中标志：同样只给监听用，避免把 loading 写进 effect 依赖里反复重订阅 */
  const loadingRef = useRef(loading)
  /**
   * 续段前的锚点：{ 行号, 它当时的屏幕偏移 }。
   *
   * 续段会往内容里插 300 行，插在视口上方时整块内容会往下挪——插入前记住一个
   * 位于视口上沿（或其上）的行，插入后把它的屏幕位置摆回去，读到哪里就还是哪里。
   */
  const anchorRef = useRef<{ line: number; offset: number } | null>(null)
  /** 一次续段只做一次：等用户再动一下才允许下一次，免得一次触底连取好几段 */
  const autoLockRef = useRef(false)
  /**
   * 用户是否真的动过（滚轮 / 触摸 / 键盘 / 拖滚动条）。
   *
   * 程序化滚动（打开定位、跳转）不算「用户滚到边界」——不加这道闸，
   * 打开抽屉的第一次定位就会顺手把相邻段也取回来（探针实测过）。
   */
  const gestureRef = useRef(false)
  const frameRef = useRef(0)

  /**
   * 引用区间：三个出口与高亮都对准它。
   * 缺省第 1 行，并按文件长度夹紧——与改动前服务端给出的 highlight 区间一致。
   */
  const anchorFrom = Math.max(1, Math.floor(line ?? 1))
  const anchorTo = Math.max(Math.floor(endLine ?? anchorFrom), anchorFrom)
  const anchorStartLine = meta ? Math.min(anchorFrom, meta.totalLines) : anchorFrom
  const anchorEndLine = meta ? Math.min(anchorTo, meta.totalLines) : anchorTo

  const location = meta
    ? anchorEndLine > anchorStartLine
      ? `${meta.path}:${anchorStartLine}-${anchorEndLine}`
      : `${meta.path}:${anchorStartLine}`
    : (file ?? '')

  /**
   * 已加载内容按**连续区间**渲染：一个区间一次词法分析。
   * 段是读取与传输单位，显示层不跟着分段——一段一分析的话，每 300 行的接缝都会
   * 把跨行的文档串 / 块注释切断（"644 行整片变色"就是这么来的）。
   */
  const runs = useMemo(() => mergeRuns(segments), [segments])
  /** 任何一段被单次上限截断过：沿用既有的「区间已被截断」提示 */
  const truncated = segments.some((segment) => segment.clamped)

  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])

  useEffect(() => {
    loadingRef.current = loading
  }, [loading])

  /**
   * 把某一行滚到视野中间：打开定位与三个跳转都走它。
   *
   * 一律**即时**定位（不用平滑滚动）：长距离平滑滚动是浏览器在动画里持续改写 scrollTop，
   * 会与续段的锚定补偿抢位置，最后停在哪不好预测。
   */
  const scrollToLine = useCallback((target: number) => {
    document.getElementById(`code-line-${target}`)?.scrollIntoView({ behavior: 'auto', block: 'center' })
  }, [])

  /** 打开 / 换引用 / 首次拿到内容后，把被引用的那几行滚到视野中间（等排版落定再滚） */
  const ready = segments.length > 0
  useEffect(() => {
    if (!open || !ready) return
    const timer = setTimeout(() => scrollToLine(anchorStartLine), 140)
    return () => clearTimeout(timer)
  }, [open, ready, file, line, endLine, anchorStartLine, scrollToLine])

  /** 跳转信号：分页器说「滚到这一行」，这里负责滚，然后清掉信号 */
  useEffect(() => {
    if (!scrollTarget) return
    scrollToLine(scrollTarget.line)
    consumeScrollTarget()
  }, [scrollTarget, scrollToLine, consumeScrollTarget])

  /**
   * 续段后把锚点行摆回原来的屏幕位置。
   * 用 layout effect：在浏览器绘制前补偿，否则会先看到一次跳动再被拉回来。
   */
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!viewport || !anchor) return
    /**
     * 等取段的提示收走再补偿。
     * 「正在取上一段…」是**占高度**的一行，补偿若在它还在时算完，它随后被移除，
     * 上面的内容就整体上移那一行的高度（探针实测 ~44px）——锚点仍然会跳。
     */
    if (loading) return
    const compensate = () => {
      const element = document.getElementById(`code-line-${anchor.line}`)
      if (!element) return
      const offset = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
      viewport.scrollTop += offset - anchor.offset
    }
    compensate()
    /**
     * 下一帧再对一次：提示收走、字体度量落定这类「排版在补偿之后才变」的情况，
     * 一次补偿对齐不了（探针实测差 ~44px）。位置没变时这一趟算出来是 0，等于什么也不做。
     */
    const frame = requestAnimationFrame(() => {
      compensate()
      if (anchorRef.current === anchor) anchorRef.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [segments, viewport, loading])

  /* -------- 边界续段：哪个段的上/下沿到头了就取它的相邻段 -------- */
  useEffect(() => {
    const view = viewport
    if (!view || !open) return

    /** 记住一个「已经在视口上沿或其上」的行，续段后据此把视图摆回原位 */
    const rememberAnchor = () => {
      const viewRect = view.getBoundingClientRect()
      const list = segmentsRef.current
      let target = list[0]
      for (const segment of list) {
        const element = document.getElementById(`code-line-${segment.segmentStart}`)
        if (element && element.getBoundingClientRect().top <= viewRect.top) target = segment
      }
      const element = target ? document.getElementById(`code-line-${target.segmentStart}`) : null
      anchorRef.current = element
        ? { line: target.segmentStart, offset: element.getBoundingClientRect().top - viewRect.top }
        : null
    }

    const evaluate = () => {
      // 没被用户动过就不续段：程序化定位（打开、跳转）不算「滚到边界」
      if (!gestureRef.current || autoLockRef.current || loadingRef.current) return
      const viewRect = view.getBoundingClientRect()
      // 「快到了」的判定宽度：200px，约等于两三行代码，够早开始取，又不会无谓预取
      const threshold = 200
      for (const segment of segmentsRef.current) {
        if (segment.hasPrev) {
          const element = document.getElementById(`code-line-${segment.segmentStart}`)
          const top = element?.getBoundingClientRect().top
          if (top !== undefined && top >= viewRect.top - threshold && top <= viewRect.bottom) {
            autoLockRef.current = true
            rememberAnchor()
            loadPrev(segment.segmentStart)
            return
          }
        }
        if (segment.hasNext) {
          const element = document.getElementById(`code-line-${segment.segmentEnd}`)
          const bottom = element?.getBoundingClientRect().bottom
          if (bottom !== undefined && bottom <= viewRect.bottom + threshold && bottom >= viewRect.top) {
            autoLockRef.current = true
            rememberAnchor()
            loadNext(segment.segmentStart)
            return
          }
        }
      }
    }

    const onScroll = () => {
      if (frameRef.current) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        evaluate()
      })
    }
    /** 用户再动一下（滚轮 / 触摸 / 键盘 / 拖滚动条）就解锁，允许续下一段 */
    const unlock = () => {
      gestureRef.current = true
      autoLockRef.current = false
    }

    // 手势挂在**外层容器**上：滚动条是视口的兄弟节点，挂在视口上会漏掉「拖滚动条」
    const gestureHost = view.parentElement ?? view

    view.addEventListener('scroll', onScroll)
    gestureHost.addEventListener('wheel', unlock, { passive: true })
    gestureHost.addEventListener('touchstart', unlock, { passive: true })
    gestureHost.addEventListener('pointerdown', unlock)
    gestureHost.addEventListener('keydown', unlock)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      view.removeEventListener('scroll', onScroll)
      gestureHost.removeEventListener('wheel', unlock)
      gestureHost.removeEventListener('touchstart', unlock)
      gestureHost.removeEventListener('pointerdown', unlock)
      gestureHost.removeEventListener('keydown', unlock)
    }
  }, [open, viewport, loadPrev, loadNext])

  const openInEditor = () => {
    if (!meta) return
    const result = openInVscode(meta.absolutePath, anchorStartLine)
    // 协议没注册时退化为复制位置，用户可以自己粘到编辑器（与 md 阅读器同一策略）
    if (!result.ok) copyText(location)
  }

  const attachRef = () => {
    if (!meta) return
    onAddRef({
      docId: '',
      anchor: '',
      label: location,
      file: meta.path,
      line: anchorStartLine,
      endLine: anchorEndLine,
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" width="w-[720px]" className="gap-0 p-0">
        <SheetHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="flex items-center gap-2 truncate">
                <FileCode className="h-3.5 w-3.5 shrink-0 text-cyan-700" />
                {meta?.name ?? file ?? '源码'}
              </SheetTitle>
              <SheetDescription className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="truncate font-mono">{meta?.path ?? file}</span>
                {meta ? <Badge tone="muted">{meta.language}</Badge> : null}
                {meta ? <Badge tone="muted">共 {meta.totalLines} 行</Badge> : null}
                {runs.length ? (
                  <Badge tone="muted">
                    已加载 {runs[0].startLine}–{runs[0].endLine}
                    {runs.length > 1 ? `（共 ${runs.length} 段）` : ''}
                  </Badge>
                ) : null}
                {anchorEndLine > anchorStartLine ? (
                  <Badge tone="primary">
                    高亮 {anchorStartLine}-{anchorEndLine}
                  </Badge>
                ) : null}
                {truncated ? <Badge tone="warning">区间已被截断</Badge> : null}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Tooltip content="跳到文件头">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="跳到文件头"
                  onClick={jumpToTop}
                  disabled={!segments.length}
                >
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="跳到被引用的那几行">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="跳到引用行"
                  onClick={jumpToAnchor}
                  disabled={!segments.length}
                >
                  <Locate className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="跳到文件尾">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="跳到文件尾"
                  onClick={jumpToBottom}
                  disabled={!segments.length}
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="把「路径:行」复制到剪贴板">
                <Button variant="ghost" size="icon-sm" onClick={() => copyText(location)}>
                  <ClipboardCopy className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="在 VS Code 中打开并定位到这一行">
                <Button variant="ghost" size="sm" onClick={openInEditor} disabled={!meta}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  在 VS Code 中打开
                </Button>
              </Tooltip>
            </div>
          </div>
        </SheetHeader>

        {/* 「为什么只能按段给」的说明：文件大到阈值以上时才出现，正常文件不打扰 */}
        {meta?.oversizedReason ? (
          <div className="flex shrink-0 items-start gap-1.5 border-b border-black/[0.07] bg-amber-50/70 px-4 py-2 text-micro text-muted-foreground">
            <Info className="mt-[1px] h-3 w-3 shrink-0 text-amber-600" />
            <span>大文件：按段加载，完整阅读建议在 VS Code 中打开（{meta.oversizedReason}）。</span>
          </div>
        ) : null}

        <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="py-3 px-3" viewportRef={viewportRef}>
          {segments.length ? (
            <div className="min-w-0">
              {loading === 'prev' ? <SegmentHint label="正在取上一段…" /> : null}
              {runs.map((run) => {
                const highlight = highlightOf(run, anchorStartLine, anchorEndLine)
                return (
                  <div
                    key={run.startLine}
                    className="mt-3 min-w-0 overflow-hidden rounded-md border border-black/[0.07] bg-white/60 first:mt-0"
                  >
                    <CodeBlock
                      lines={run.lines}
                      language={meta?.language ?? 'text'}
                      startLine={run.startLine}
                      highlightStart={highlight.start}
                      highlightEnd={highlight.end}
                      lexPrefix={run.lexPrefix}
                    />
                  </div>
                )
              })}
              {loading === 'next' ? <SegmentHint label="正在取下一段…" /> : null}
              {/* 续段失败时把已看到的内容留着，只在下面说明为什么没继续 */}
              {error ? <p className="py-2 text-micro text-destructive">{error}</p> : null}
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 py-10 text-micro text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在读取源码…
            </div>
          ) : error ? (
            <p className="py-10 text-micro text-destructive">{error}</p>
          ) : (
            <p className="py-10 text-micro text-muted-foreground">没有可预览的目标。</p>
          )}
        </ScrollArea>

        {canAddRef ? (
          <div className="shrink-0 border-t border-black/[0.07] p-3">
            <Button variant="secondary" className="w-full" onClick={attachRef} disabled={!meta}>
              <Link2 className="h-3.5 w-3.5" />
              把这段代码加入当前节点引用
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
