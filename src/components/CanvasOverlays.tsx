import { History, Maximize2, Minus, Plus, Sparkles, Tag, Upload, ZoomIn } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'
import {
  NODE_TYPE_COLORS,
  NODE_TYPE_LABELS,
  NODE_TYPE_ORDER,
  EDGE_TYPE_LABELS,
  EDGE_TYPE_ORDER,
  type NodeType,
} from '../lib/types'
import { cn } from '../lib/utils'
import { EDGE_COLOR } from '../graph/palette'

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  onRelayout,
  showEdgeLabels = false,
  onToggleEdgeLabels,
}: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onRelayout: () => void
  /** 是否常显边标签（产物名写在边标签上，默认只在悬停/选中时显示） */
  showEdgeLabels?: boolean
  onToggleEdgeLabels?: () => void
}) {
  return (
    <div className="glass-panel pointer-events-auto flex items-center gap-0.5 rounded-lg p-1">
      <Tooltip content="缩小">
        <Button variant="ghost" size="icon-sm" onClick={onZoomOut} aria-label="缩小">
          <Minus className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      <span className="w-11 text-center text-micro tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
      <Tooltip content="放大">
        <Button variant="ghost" size="icon-sm" onClick={onZoomIn} aria-label="放大">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      <span className="mx-0.5 h-4 w-px bg-black/10" />
      <Tooltip content="适应屏幕（F）">
        <Button variant="ghost" size="icon-sm" onClick={onFit} aria-label="适应屏幕">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      <Tooltip content="整理布局（L）">
        <Button variant="ghost" size="icon-sm" onClick={onRelayout} aria-label="整理布局">
          <Sparkles className="h-3.5 w-3.5" />
        </Button>
      </Tooltip>
      {onToggleEdgeLabels ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-black/10" />
          <Tooltip content={showEdgeLabels ? '隐藏边标签（产物名）' : '常显边标签（产物名）'}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleEdgeLabels}
              aria-label="切换边标签"
              aria-pressed={showEdgeLabels}
              className={cn(showEdgeLabels && 'bg-primary/10 text-primary')}
            >
              <Tag className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </>
      ) : null}
    </div>
  )
}

/**
 * 跨红移反馈开关的状态与动作。**不传这个 prop 就是不画这个开关**（画布页走的正是这条路：
 * 它的产物里没有跨红移回流边，开关对它零影响）。
 */
export interface CrossRedshiftFeedbackState {
  enabled: boolean
  /** 产物里标为跨红移回流的边数（由调用方从生成物算出，控件自己既不写死也不读数据） */
  count: number
  onToggle: () => void
}

/**
 * **跨红移反馈**开关：下一轮指回上一轮的那些关系，默认不画在图上，由它开合。
 *
 * 它管的是这件事的**全部视图面**：一级上块 → 块的那几条弧，以及它们在弧两端块子图里的成员级落点
 * （上一轮送出的量 → 这一步读它的量，连同落点两端那些灰显的盒子）。
 *
 * 为什么必须报数：关闭态下这些**全都不画**（见 `graph/styles.ts` 的那条关闭态规则），
 * 画布上没有任何痕迹说明"这里还藏着一层关系"——所以控件把当前口径报全：开着还是关着、藏了几条。
 * 条数为 0 时不渲染成开关，而是说明原因（产物里没有这类边），否则会得到"点了没反应"的死开关。
 */
export function CrossRedshiftFeedbackToggle({ state }: { state?: CrossRedshiftFeedbackState }) {
  if (!state) return null
  if (state.count <= 0) {
    return (
      <div className="glass-panel pointer-events-auto rounded-lg px-2.5 py-2 text-micro text-muted-foreground">
        跨红移反馈 · 产物里没有标为回流的边
      </div>
    )
  }
  return (
    <Tooltip
      side="left"
      content={
        state.enabled
          ? `当前开着：${state.count} 条跨红移回流画在图上——一级的块间弧，以及它们在两端块子图里的成员级落点`
          : `当前关着：这 ${state.count} 条跨红移回流一级与子图里都不画，点一下全部显现`
      }
    >
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={state.enabled}
        onClick={state.onToggle}
        className={cn('glass-panel pointer-events-auto', state.enabled && 'bg-primary/10 text-primary')}
      >
        <History className="h-3.5 w-3.5" />
        跨红移反馈 · {state.count} 条（{state.enabled ? '已显现' : '已藏起'}）
      </Button>
    </Tooltip>
  )
}

/**
 * 图例只列**当前图谱实际出现**的类型：类型是「要素种类」，一张图通常只用其中几类，
 * 把未使用的类型（工具、问题…）堆进图例只会占地方、还会让人去找根本不存在的颜色。
 */
export function GraphLegend({ compact = false, types }: { compact?: boolean; types?: NodeType[] }) {
  const shown = types?.length ? types : NODE_TYPE_ORDER
  return (
    <div
      className={cn(
        'glass-panel pointer-events-auto rounded-lg px-2.5 py-2 text-micro',
        compact ? 'flex items-center gap-3' : 'flex flex-col gap-1.5',
      )}
    >
      <div className={cn('flex flex-wrap gap-x-3 gap-y-1', compact ? 'items-center' : '')}>
        {shown.map((type) => (
          <span key={type} className="flex items-center gap-1.5 text-muted-foreground">
            <span
              className="h-2 w-2 rounded-[3px]"
              style={{ backgroundColor: NODE_TYPE_COLORS[type], boxShadow: `0 0 8px ${NODE_TYPE_COLORS[type]}80` }}
            />
            {NODE_TYPE_LABELS[type]}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-black/[0.06] pt-1.5">
        {/* 箭头标记：语义关系带箭头，层级连线不带，图例里按同一规则对照 */}
        <svg width="0" height="0" className="absolute" aria-hidden="true">
          <defs>
            <marker
              id="legend-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill={EDGE_COLOR} />
            </marker>
          </defs>
        </svg>
        {EDGE_TYPE_ORDER.slice(0, 4).map((type) => (
          <span key={type} className="flex items-center gap-1.5 text-muted-foreground/80">
            <svg width="16" height="6" viewBox="0 0 16 6" className="shrink-0">
              <line
                x1="0"
                y1="3"
                x2="16"
                y2="3"
                stroke={EDGE_COLOR}
                strokeWidth="1.4"
                strokeDasharray={type === 'relates_to' ? '4 3' : undefined}
                markerEnd="url(#legend-arrow)"
              />
            </svg>
            {EDGE_TYPE_LABELS[type]}
          </span>
        ))}
      </div>
    </div>
  )
}

export function EmptyState({
  onNewNode,
  onOpenImport,
  onFocusLibrary,
}: {
  onNewNode: () => void
  onOpenImport: () => void
  onFocusLibrary: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
      <div className="glass-panel pointer-events-auto flex w-full max-w-[460px] animate-slide-up flex-col gap-4 rounded-xl p-6 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-sheen shadow-glow">
          <ZoomIn className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-subhead font-semibold">开始构建知识图谱</h2>
          <p className="text-balance text-micro leading-relaxed text-muted-foreground">
            节点可以锚定到 notes 数据库中的具体章节；关系可以随时建立、修改与取消。所有操作都能撤销，
            误删也能找回。
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={onNewNode}>
            <Plus className="h-3.5 w-3.5" />
            新建第一个节点
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={onFocusLibrary}>
              浏览 notes 数据库
            </Button>
            <Button variant="secondary" className="flex-1" onClick={onOpenImport}>
              <Upload className="h-3.5 w-3.5" />
              LLM 导入草案
            </Button>
          </div>
        </div>
        <p className="text-micro text-muted-foreground/60">
          提示：按 <kbd className="rounded bg-black/[0.06] px-1">N</kbd> 新建节点、
          <kbd className="ml-1 rounded bg-black/[0.06] px-1">L</kbd> 重新布局、
          <kbd className="ml-1 rounded bg-black/[0.06] px-1">/</kbd> 搜索
        </p>
      </div>
    </div>
  )
}
