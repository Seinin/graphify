import { CloudOff, Layers, Loader2, MousePointerClick, PenLine } from 'lucide-react'
import { useGraphStore } from '../state/graphStore'
import { LAYOUT_LABELS, type LayoutKind } from '../graph/layout'
import { relativeTime } from '../lib/utils'

/** 本页自己的口径（物理链页）：画布那几个数在那里要么无意义、要么数的是另一份图 */
export interface SelfStats {
  /** 过程块：一级 11 个块里"过程"那 10 个（常数与网格是层，不算过程） */
  processBlocks: number
  /** 物理量：11 个块的成员里物理量的条数（39 个，不重不漏；块里只有物理量） */
  quantities: number
  /** 参数数 */
  params: number
  /** 文献数（参数上出现的不重复出处） */
  papers: number
  /** 当前打开的对象名（没选中就是 null） */
  current: string | null
}

interface StatusBarProps {
  layout: LayoutKind
  zoom: number
  connectMode: boolean
  /** 当前标签页的可见节点数 */
  visibleCount: number
  /**
   * 传了＝按本页口径渲染（物理链页），**跳过画布口径**（节点数、关系数、布局、缩放、
   * 本视图可见数、保存状态）；不传＝画布口径（现状）。
   */
  selfStats?: SelfStats
}

/**
 * 底部状态条：默认画布口径，另可选本页口径（`selfStats`）。
 *
 * 物理链页没有画布，也没有可选择、可保存的东西——把画布那几个数留在那里就是误导，
 * 于是它只报自己的规模：过程块 / 物理量 / 参数 / 文献，外加当前打开的对象。
 */
export function StatusBar({ layout, zoom, connectMode, visibleCount, selfStats }: StatusBarProps) {
  const saveState = useGraphStore((state) => state.saveState)
  const dirty = useGraphStore((state) => state.dirty)
  const lastSavedAt = useGraphStore((state) => state.lastSavedAt)
  const selection = useGraphStore((state) => state.selection)
  const nodes = useGraphStore((state) => state.graph.nodes.length)
  const edges = useGraphStore((state) => state.graph.edges.length)

  const selectionLabel =
    selection.kind === 'node' ? '已选中节点' : selection.kind === 'edge' ? '已选中关系' : '未选中任何对象'

  if (selfStats) {
    return (
      <footer className="pointer-events-auto flex h-8 shrink-0 items-center justify-between gap-4 border-t border-black/[0.07] bg-black/[0.04] px-3 text-micro text-muted-foreground backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3 tabular-nums">
          <span>过程块 {selfStats.processBlocks}</span>
          <span className="text-muted-foreground/40">|</span>
          <span>物理量 {selfStats.quantities}</span>
          <span className="text-muted-foreground/40">|</span>
          <span>参数 {selfStats.params}</span>
          <span className="text-muted-foreground/40">|</span>
          <span>文献 {selfStats.papers}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <MousePointerClick className="h-3 w-3 shrink-0" />
          {selfStats.current ? <span className="truncate">当前：{selfStats.current}</span> : <span>未选中任何对象</span>}
        </div>
      </footer>
    )
  }

  return (
    <footer className="pointer-events-auto flex h-8 shrink-0 items-center justify-between gap-4 border-t border-black/[0.07] bg-black/[0.04] px-3 text-micro text-muted-foreground backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1.5">
          <MousePointerClick className="h-3 w-3" />
          {selectionLabel}
        </span>
        <span className="text-muted-foreground/40">|</span>
        <span>
          {nodes} 节点 · {edges} 关系
        </span>
        <span className="text-muted-foreground/40">|</span>
        <span>布局：{LAYOUT_LABELS[layout]}</span>
        <span className="text-muted-foreground/40">|</span>
        <span>缩放 {Math.round(zoom * 100)}%</span>
        <span className="text-muted-foreground/40">|</span>
        <span className="flex items-center gap-1.5 tabular-nums" title="当前标签页可见的节点数">
          <Layers className="h-3 w-3" />
          本视图 {visibleCount} 节点
        </span>
      </div>

      <div className="flex items-center gap-3">
        {connectMode ? (
          <span className="flex items-center gap-1.5 text-cyan-700">
            <PenLine className="h-3 w-3" />
            连线模式：点击目标节点建立关系（Esc 取消）
          </span>
        ) : null}
        {saveState === 'saving' ? (
          <span className="flex items-center gap-1.5 text-foreground/80">
            <Loader2 className="h-3 w-3 animate-spin" />
            保存中…
          </span>
        ) : saveState === 'error' ? (
          <span className="flex items-center gap-1.5 text-destructive">
            <CloudOff className="h-3 w-3" />
            保存失败
          </span>
        ) : dirty ? (
          <span className="text-amber-600/90">有未保存的改动</span>
        ) : (
          <span className="text-emerald-600/85">已保存 · {relativeTime(lastSavedAt)}</span>
        )}
      </div>
    </footer>
  )
}
