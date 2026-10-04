import { History, Maximize2, Minus, Palette, Plus, Sparkles, Tag, Upload, ZoomIn } from 'lucide-react'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'
import { NODE_TYPE_COLORS, NODE_TYPE_LABELS, type NodeType } from '../lib/types'
import { cn } from '../lib/utils'
import {
  EDGE_STYLE_DASH,
  EDGE_STYLE_LEGEND,
  type EdgeStyleId,
  type EdgeStyleLegendEntry,
} from '../graph/palette'

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
 * 为什么口径要报全：关闭态下这些**全都不画**（见 `graph/styles.ts` 的那条关闭态规则），
 * 画布上没有任何痕迹说明"这里还藏着一层关系"——所以开关把口径报全：**标签上**只留开关名与开 / 关，
 * **悬停提示里**给出藏了几条以及它管哪些视图面（标签上不印统计）。
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
        跨红移反馈 · {state.enabled ? '已显现' : '已藏起'}
      </Button>
    </Tooltip>
  )
}

/**
 * 图例：**只列这一页此刻真画出来的东西**，贴画布左下角、默认收起成一枚入口。
 *
 * 两段条目都是派生的，不是写死的清单：
 * - 要素种类由渲染器报出此刻**真画出来**的那些（`types`，见 `GraphRenderer.presentNodeTypes`）——
 *   收起来的话题、别的标签页、收起的分支都不占条目，画布页因此也不会列出它根本没有的「相关 / 引用」；
 * - 线型同一口径（`edgeStyles`，见 `GraphRenderer.presentEdgeStyles`），于是物理链页终于能列出
 *   「跨红移回流」——它是否出现取决于开关，写死的清单做不到。
 * 色值与线型取自 `palette.ts` 那张表（与 `styles.ts` 同源），这里只负责画。
 *
 * 为什么默认收起：展开态是一块会换行的浮层，常驻就压在画布上；收起态只占一行。
 * 点开在它**上方**铺开（它贴着画布下边界，往下铺不开）。
 */
export function GraphLegend({
  types,
  edgeStyles,
  labels,
  open,
  onToggle,
}: {
  types: NodeType[]
  edgeStyles: EdgeStyleId[]
  /** 页面自有的叫法（缺省用表里的通用名）。物理链页把它那一档「主序」叫作「同一红移内的数据流」 */
  labels?: Partial<Record<EdgeStyleId, string>>
  /** 展开态由调用方持有：点画布空白收起图例与「点空白回到什么都没点亮」是同一次手势 */
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="pointer-events-auto flex flex-col items-start gap-2">
      {open ? (
        <div
          role="group"
          aria-label="图例"
          className="glass-panel flex max-w-[min(92vw,640px)] flex-col gap-1.5 rounded-lg px-2.5 py-2 text-micro"
        >
          {types.length ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {types.map((type) => (
                <span key={type} className="flex items-center gap-1.5 text-muted-foreground">
                  <span
                    className="h-2 w-2 rounded-[3px]"
                    style={{
                      backgroundColor: NODE_TYPE_COLORS[type],
                      boxShadow: `0 0 8px ${NODE_TYPE_COLORS[type]}80`,
                    }}
                  />
                  {NODE_TYPE_LABELS[type]}
                </span>
              ))}
            </div>
          ) : null}
          {edgeStyles.length ? (
            <div
              className={cn(
                'flex flex-wrap gap-x-3 gap-y-1',
                types.length && 'border-t border-black/[0.06] pt-1.5',
              )}
            >
              {edgeStyles.map((id) => (
                <span key={id} className="flex items-center gap-1.5 text-muted-foreground/80">
                  <EdgeSample entry={EDGE_STYLE_LEGEND[id]} />
                  {labels?.[id] ?? EDGE_STYLE_LEGEND[id].label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <Tooltip content="图例：本页画出来的要素与线型">
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={onToggle} className="glass-panel">
          <Palette className="h-3.5 w-3.5" />
          图例
        </Button>
      </Tooltip>
    </div>
  )
}

/**
 * 图例里的样例线段：按表里那一档画（线色 / 线型 / 画不画箭头 / 直或弧）。
 *
 * 提供 / 数据流动与跨红移回流在画布上是鼓开的弧（读作"绕过去"而非树脊），这里用一段二次曲线表示，
 * 不然那两档在图例里会被读成普通直线，与画布对不上。
 *
 * 箭头标记按**线色**各建一个：同一张图里最多几档色，标记 id 由色值派生即可稳定去重；
 * 两个页面同时挂着图例时它俩的 id 相同，但定义逐字一致，画出来没有差别。
 */
function EdgeSample({ entry }: { entry: EdgeStyleLegendEntry }) {
  const { color, kind, width, arrow, curve } = entry
  const dash = EDGE_STYLE_DASH[kind]
  const markerId = `legend-arrow-${color.replace('#', '')}`
  const mid = 5
  const common = {
    stroke: color,
    strokeWidth: width,
    strokeDasharray: dash,
    markerEnd: arrow ? `url(#${markerId})` : undefined,
    fill: 'none',
  }
  return (
    <svg width="20" height="10" viewBox="0 0 20 10" className="shrink-0" aria-hidden="true">
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill={color} />
        </marker>
      </defs>
      {curve ? (
        <path d={`M0,${mid + 2} Q10,${mid - 5} 20,${mid + 2}`} {...common} />
      ) : (
        <line x1="0" y1={mid} x2="20" y2={mid} {...common} />
      )}
    </svg>
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
