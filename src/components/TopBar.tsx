import { Suspense, lazy, useMemo, useState } from 'react'
import {
  BarChart3,
  Check,
  CloudUpload,
  CornerUpLeft,
  CornerUpRight,
  HelpCircle,
  LayoutDashboard,
  Link2,
  Search,
  Sparkles,
  Tag,
  Tags,
  Upload,
  Waypoints,
} from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Input } from './ui/input'
import { Tooltip } from './ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown'
import { useGraphStore } from '../state/graphStore'
import { tagDisplayOf } from '../lib/tagEdit'
import { cn, relativeTime } from '../lib/utils'
import { graphTopics, topicVisibleCount } from '../lib/topics'
import { LAYOUT_LABELS, type LayoutKind } from '../graph/layout'
import type { Graph } from '../lib/types'

/** 手动摆放排在最前：它是默认布局，也是「大框套小框 + 箭头吸附」这套表达的前提 */
const LAYOUTS: LayoutKind[] = ['manual', 'flow', 'fcose', 'concentric', 'breadthfirst', 'circle', 'grid']

// recharts 体积较大，统计面板改为按需加载，首屏不引入图表库
const GraphStatsPopover = lazy(() =>
  import('./GraphStatsPopover').then((module) => ({ default: module.GraphStatsPopover })),
)

/**
 * 应用内视图。两页：
 *   canvas = 工程视角图谱（`data/graph.json`，模块、数据流与关系，面向实现）；
 *   chain  = 物理链（`src/generated/physics-chain.json`，从观测量往下追到参数，面向物理）。
 *
 * 分段控件按"多于一项"才渲染——所以第二页接上后，顶栏的入口会自动出现。
 */
export type GraphView = 'canvas' | 'chain'

const VIEWS: { id: GraphView; label: string; icon: typeof Waypoints; hint: string }[] = [
  { id: 'canvas', label: '画布', icon: Waypoints, hint: '工程视角图谱：模块、数据流与关系（data/graph.json）' },
  {
    id: 'chain',
    label: '物理链',
    icon: Waypoints,
    hint: '物理视角：观测量往下追到参数；颜色按种类分，代码与文献默认收起（physics-chain.json）',
  },
]

interface TopBarProps {
  graph: Graph
  /**
   * 检索**作用在哪份图**上：不传＝`graph`（画布页现状）；物理链页传本页的图——
   * 两页的图不是同一份，检索词跟着视图走才不会"搜出另一页的东西"。
   */
  searchGraph?: Graph
  /**
   * 命中项的来源徽标：返回 null 走默认（「节点 / 关系」）。
   * 物理链页用它把收起层（旁路与实现细节）里的命中标出来——检索能直达一切，但不藏它的来源。
   */
  resultBadgeOf?: (kind: 'node' | 'edge', id: string) => string | null
  view: GraphView
  onViewChange: (view: GraphView) => void
  searchQuery: string
  searchInputRef: React.RefObject<HTMLInputElement>
  onSearchChange: (value: string) => void
  onSelectResult: (kind: 'node' | 'edge', id: string) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  layout: LayoutKind
  onLayoutChange: (kind: LayoutKind) => void
  /** 被关闭的话题 id 集合；空集合表示全部显示 */
  hiddenTopicIds: string[]
  onToggleTopic: (topicId: string) => void
  onSetHiddenTopics: (topicIds: string[]) => void
  /** 当前可见节点数（与状态条同源，触发器上直接显示） */
  visibleCount: number
  /** 被勾选的全局标签 id（纯视图状态；勾上就在对应模块左上角亮红点） */
  activeTagIds: string[]
  onToggleTag: (tagId: string) => void
  onClearActiveTags: () => void
  onOpenImport: () => void
  onOpenHistory: () => void
  onSave: () => void
  onRename: (name: string) => void
  /** 当前标签页的模块名（主图为 null）：顶栏要显示「在图谱的哪一层」 */
  activeTabLabel?: string | null
  onToggleHelp: () => void
}

export function TopBar({
  graph,
  searchGraph,
  resultBadgeOf,
  searchQuery,
  searchInputRef,
  onSearchChange,
  onSelectResult,
  canUndo,
  canRedo,
  view,
  onViewChange,
  onUndo,
  onRedo,
  layout,
  onLayoutChange,
  hiddenTopicIds,
  onToggleTopic,
  onSetHiddenTopics,
  visibleCount,
  activeTagIds,
  onToggleTag,
  onClearActiveTags,
  onOpenImport,
  onOpenHistory,
  onSave,
  onRename,
  activeTabLabel = null,
  onToggleHelp,
}: TopBarProps) {
  const saveState = useGraphStore((state) => state.saveState)
  const dirty = useGraphStore((state) => state.dirty)
  const lastSavedAt = useGraphStore((state) => state.lastSavedAt)
  const [nameDraft, setNameDraft] = useState(graph.meta.name)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [topicQuery, setTopicQuery] = useState('')

  const results = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase()
    if (!keyword) return { nodes: [], edges: [] }
    // 检索作用在「当前视图那份图」上：物理链页传自己的图，画布页不传＝`graph`（行为不变）
    const source = searchGraph ?? graph
    return {
      nodes: source.nodes
        .filter(
          (node) =>
            node.label.toLowerCase().includes(keyword) ||
            node.summary.toLowerCase().includes(keyword) ||
            node.tags.some((tag) => tag.toLowerCase().includes(keyword)),
        )
        .slice(0, 6),
      edges: source.edges
        .filter((edge) => edge.label.toLowerCase().includes(keyword) || edge.note.toLowerCase().includes(keyword))
        .slice(0, 4),
    }
  }, [graph, searchGraph, searchQuery])

  const hasResults = results.nodes.length + results.edges.length > 0

  /*
    画布专属控件只在画布视图出现（见 change graphify-matrix-view-isolation）。
    矩阵视图没有画布，搜索、撤销/重做、布局、话题、标签、导入、图谱统计在那里
    要么无对象可作用、要么统计的是另一份图——留着就是误导。
  */
  const canvasOnly = view === 'canvas'

  // 话题注册表为空（旧图 / 骨架视图）时整块控件不出现，避免给出无意义的入口
  const topics = useMemo(() => {
    const registry = graphTopics(graph)
    if (!registry.length) return []
    return registry.map((topic) => ({ ...topic, count: topicVisibleCount(graph, topic.id) }))
  }, [graph])

  // 勾选状态 = 「未被关闭」；被关闭集合默认空，因此打开时全部显示
  const hiddenSet = useMemo(() => new Set(hiddenTopicIds), [hiddenTopicIds])
  const openTopicCount = topics.filter((topic) => !hiddenSet.has(topic.id)).length

  // 搜索只匹配话题名（大小写不敏感），够用且不必给十余条注册表做索引
  const filteredTopics = useMemo(() => {
    const keyword = topicQuery.trim().toLowerCase()
    if (!keyword) return topics
    return topics.filter((topic) => topic.name.toLowerCase().includes(keyword))
  }, [topics, topicQuery])

  /**
   * 全局标签注册表 + 每个标签的命中节点数（勾选后亮红点）。
   *
   * 计数走 `tagDisplayOf`——与画布红点是**同一份口径**：有子图的模块算的是它当前子树叶子
   * 标签的并集，所以这个数就是「勾上之后会亮几个点」，两端对得上（见 lib/tagEdit.ts）。
   */
  const tags = useMemo(() => {
    const registry = graph.meta.tags ?? []
    if (!registry.length) return []
    const counts = new Map<string, number>()
    graph.nodes.forEach((node) => {
      tagDisplayOf(graph.nodes, node).tags.forEach((tagId) =>
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1),
      )
    })
    return registry.map((tag) => ({ ...tag, count: counts.get(tag.id) ?? 0 }))
  }, [graph])
  const activeTagSet = useMemo(() => new Set(activeTagIds), [activeTagIds])

  /** 分组副标题：把类名按词拆开显示（SimulationOptions → Simulation Options），数据里的类名不动 */
  const groupLabel = (group: string) =>
    (group || '未分类').replace(/([a-z0-9])([A-Z])/g, '$1 $2')

  /**
   * 参数按**代码里的划分**分组：`group` 就是 inputs.py 里 InputStruct 的子类名
   * （CosmoParams / MatterOptions / SimulationOptions / AstroOptions / AstroParams）。
   * 分组顺序取注册表里的出现顺序（脚本按代码顺序写入），没写分类的排最后。
   */
  const tagGroups = useMemo(() => {
    const buckets = new Map<string, typeof tags>()
    tags.forEach((tag) => {
      const key = (tag.group ?? '').trim()
      const list = buckets.get(key)
      if (list) list.push(tag)
      else buckets.set(key, [tag])
    })
    return [...buckets.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0))
  }, [tags])

  const saveLabel =
    saveState === 'saving' ? '保存中…' : dirty ? '有未保存改动' : `已保存 · ${relativeTime(lastSavedAt)}`

  return (
    <header className="glass-panel relative z-40 flex h-12 shrink-0 items-center gap-3 rounded-lg px-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-sheen shadow-glow">
          <Waypoints className="h-3.5 w-3.5 text-white" />
        </span>
        <span className="brand-text shrink-0 text-subhead font-semibold tracking-tight">Graphify</span>
        <span className="h-4 w-px bg-black/[0.08]" />
        <Input
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => {
            const next = nameDraft.trim()
            if (next && next !== graph.meta.name) onRename(next)
            else setNameDraft(graph.meta.name)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            if (event.key === 'Escape') setNameDraft(graph.meta.name)
          }}
          className="h-7 w-[168px] min-w-0 shrink border-transparent bg-transparent px-1.5 text-tiny font-medium hover:border-black/10"
          aria-label="图谱名称"
        />
        {/*
          当前标签页：主图就是根图本身，子图页要显式标出来——否则顶栏永远在说「根图」，
          人在子图里干活却看着根图的名字，不知道自己在哪一层。子图页不给改名入口（名字跟着模块走）。
        */}
        {activeTabLabel ? (
          <>
            <span className="shrink-0 text-micro text-muted-foreground/60">›</span>
            <span
              className="max-w-[220px] shrink-0 truncate rounded-md bg-primary/[0.08] px-2 py-0.5 text-tiny font-medium text-primary"
              title={`当前标签页：${activeTabLabel}（模块的子图）`}
            >
              {activeTabLabel}
            </span>
          </>
        ) : null}
      </div>

      {/*
        搜索只搜画布上的节点与关系。这里用 `hidden` 而不是卸载：这是个带结果面板的受控组件，
        卸载会让输入状态与焦点在每次切视图时重来一遍，而矩阵页只要它不可见、不可聚焦就够了。
      */}
      {/* 检索对两页都开放：物理链页要按天体物理参数名直达相关物理量（命中后由各页自己定位） */}
      <div className={cn('relative mx-auto w-full min-w-0 max-w-[420px]')}>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => {
            onSearchChange(event.target.value)
            setResultsOpen(true)
          }}
          onFocus={() => setResultsOpen(true)}
          onBlur={() => setTimeout(() => setResultsOpen(false), 160)}
          placeholder="搜索节点、关系或标签…  ( / )"
          className="pl-8"
        />
        {resultsOpen && searchQuery.trim() ? (
          <div className="glass-panel absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-[320px] animate-in fade-in-0 slide-in-from-top-2 overflow-y-auto rounded-lg p-1">
            {!hasResults ? (
              <p className="px-2.5 py-3 text-micro text-muted-foreground">没有匹配的节点或关系</p>
            ) : (
              <>
                {results.nodes.map((node) => {
                  // 来源徽标：默认「节点」；物理链页把收起层里的命中标成来源（命中了也要能看出它在哪一层）
                  const badge = resultBadgeOf?.('node', node.id) ?? null
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onMouseDown={() => onSelectResult('node', node.id)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-black/[0.06]"
                    >
                      <span className="truncate text-micro text-foreground/90">{node.label}</span>
                      <Badge tone={badge ? 'primary' : 'muted'}>{badge ?? '节点'}</Badge>
                    </button>
                  )
                })}
                {results.edges.map((edge) => {
                  const badge = resultBadgeOf?.('edge', edge.id) ?? null
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      onMouseDown={() => onSelectResult('edge', edge.id)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-black/[0.06]"
                    >
                      <span className="truncate text-micro text-foreground/90">{edge.label}</span>
                      <Badge tone={badge ? 'primary' : 'muted'}>{badge ?? '关系'}</Badge>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/* 撤销/重做是画布专属：矩阵页的选中已被清空，那里没有可撤销的画布操作 */}
        {canvasOnly ? (
          <>
            <Tooltip content="撤销 (Ctrl/Cmd + Z)">
              <Button variant="ghost" size="icon-sm" onClick={onUndo} disabled={!canUndo} aria-label="撤销">
                <CornerUpLeft className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="重做 (Ctrl/Cmd + Shift + Z)">
              <Button variant="ghost" size="icon-sm" onClick={onRedo} disabled={!canRedo} aria-label="重做">
                <CornerUpRight className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>

            <span className="mx-0.5 h-4 w-px bg-black/[0.08]" />
          </>
        ) : null}

        {/* 分段控件按"多于一项"才渲染：只画布一页时它没有意义（物理视角页回来会自动出现） */}
        {VIEWS.length > 1 ? (
        <div className="ml-0.5 flex items-center gap-0.5 rounded-md border border-black/[0.08] bg-black/[0.03] p-0.5">
          {VIEWS.map((item) => (
            <Tooltip key={item.id} content={item.hint}>
              <button
                type="button"
                aria-pressed={view === item.id}
                aria-label={item.label}
                onClick={() => onViewChange(item.id)}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                  view === item.id ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            </Tooltip>
          ))}
        </div>
        ) : null}

        {canvasOnly ? (
          <DropdownMenu>
            <Tooltip content={`布局：${LAYOUT_LABELS[layout]} (L 重新排布)`}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  {LAYOUT_LABELS[layout]}
                </Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent>
              <DropdownMenuLabel>布局方式</DropdownMenuLabel>
              {LAYOUTS.map((kind) => (
                <DropdownMenuItem key={kind} onSelect={() => onLayoutChange(kind)}>
                  <Sparkles className={cn('h-3.5 w-3.5', kind === layout ? 'text-primary' : 'text-muted-foreground/60')} />
                  {LAYOUT_LABELS[kind]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {canvasOnly && topics.length ? (
          <Popover>
            <Tooltip
              content={
                hiddenSet.size
                  ? `话题：已关掉 ${hiddenSet.size} 个（可见 ${visibleCount} 个节点）`
                  : `话题：全部显示（${graph.nodes.length} 个节点）`
              }
            >
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Tags className="h-3.5 w-3.5" />
                  <span className="tabular-nums">
                    话题 {openTopicCount}/{topics.length}
                  </span>
                  {hiddenSet.size ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
                  <span
                    className={cn(
                      'tabular-nums',
                      hiddenSet.size ? 'text-amber-600' : 'text-muted-foreground/70',
                    )}
                  >
                    {visibleCount}
                  </span>
                </Button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent className="w-[280px] p-0">
              <div className="flex items-center gap-2 border-b border-black/[0.06] px-2 py-2">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <Input
                  value={topicQuery}
                  onChange={(event) => setTopicQuery(event.target.value)}
                  onKeyDown={(event) => {
                    // 搜到唯一一条时回车即切换，避免还要用鼠标点一下
                    if (event.key === 'Enter' && filteredTopics.length === 1) {
                      onToggleTopic(filteredTopics[0].id)
                    }
                  }}
                  placeholder="搜索话题"
                  aria-label="搜索话题"
                  className="h-6 border-transparent bg-transparent px-0 text-micro hover:border-transparent"
                />
              </div>

              <div className="max-h-[264px] overflow-y-auto p-1">
                {filteredTopics.length ? (
                  filteredTopics.map((topic) => {
                    const checked = !hiddenSet.has(topic.id)
                    return (
                      <button
                        key={topic.id}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => onToggleTopic(topic.id)}
                        title={topic.description || undefined}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/[0.05]"
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                            checked
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-black/20 bg-white/70',
                          )}
                        >
                          {checked ? <Check className="h-2.5 w-2.5" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-micro text-foreground/90">{topic.name}</span>
                        <span className="shrink-0 tabular-nums text-micro text-muted-foreground/70">
                          {topic.count}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <p className="px-2 py-3 text-micro text-muted-foreground">没有匹配的话题</p>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-black/[0.06] px-2 py-1.5">
                <span className="tabular-nums text-micro text-muted-foreground">
                  {openTopicCount}/{topics.length} 个话题显示中
                </span>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSetHiddenTopics([])}
                    disabled={openTopicCount === topics.length}
                  >
                    全选
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSetHiddenTopics(topics.map((topic) => topic.id))}
                    disabled={openTopicCount === 0}
                  >
                    全不选
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

        {/*
          全局标签：勾选后，持有该标签的模块在画布左上角亮红点。
          勾选是**纯视图状态**（不入撤销栈、不落盘），关掉页面就回到「一个都没勾」。
        */}
        {canvasOnly && tags.length ? (
          <Popover>
            <Tooltip
              content={
                activeTagSet.size
                  ? `标签：已勾 ${activeTagSet.size} 个（命中的模块左上角亮红点）`
                  : `标签：${tags.length} 个已注册，勾选后在有它的模块上亮红点`
              }
            >
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Tag className="h-3.5 w-3.5" />
                  <span className="tabular-nums">
                    标签 {activeTagSet.size}/{tags.length}
                  </span>
                  {activeTagSet.size ? <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> : null}
                </Button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent className="w-[300px] p-0">
              <p className="border-b border-black/[0.06] px-2.5 py-2 text-micro leading-relaxed text-muted-foreground">
                勾选标签 → 有它的模块左上角亮<b className="text-rose-600">红点</b>；点红点在右侧属性面板看明细。
              </p>
              <div className="max-h-[300px] overflow-y-auto p-1">
                {tagGroups.map(([group, list]) => (
                  <div key={group || '__ungrouped'}>
                    {/* 分组标题就是代码里的类名，便于和 inputs.py 对照 */}
                    <div className="flex items-baseline justify-between px-2 pb-0.5 pt-2.5">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                        {groupLabel(group)}
                      </span>
                      <span className="tabular-nums text-[10px] text-muted-foreground/50">{list.length}</span>
                    </div>
                    {list.map((tag) => {
                      const checked = activeTagSet.has(tag.id)
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          role="checkbox"
                          aria-checked={checked}
                          onClick={() => onToggleTag(tag.id)}
                          title={tag.description || undefined}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/[0.05]"
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                              checked ? 'border-rose-500 bg-rose-500 text-white' : 'border-black/20 bg-white/70',
                            )}
                          >
                            {checked ? <Check className="h-2.5 w-2.5" /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-micro text-foreground/90">{tag.name}</span>
                          <span className="shrink-0 tabular-nums text-micro text-muted-foreground/70">{tag.count}</span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-black/[0.06] px-2 py-1.5">
                <span className="tabular-nums text-micro text-muted-foreground">
                  {activeTagSet.size}/{tags.length} 个标签勾选中
                </span>
                <Button variant="ghost" size="sm" onClick={onClearActiveTags} disabled={!activeTagSet.size}>
                  全不选
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

        {canvasOnly ? (
          <Tooltip content="LLM 建图端口 / 导入草案">
            <Button variant="ghost" size="sm" onClick={onOpenImport}>
              <Upload className="h-3.5 w-3.5" />
              导入
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip content="版本历史与回滚">
          <Button variant="ghost" size="sm" onClick={onOpenHistory}>
            <Link2 className="h-3.5 w-3.5" />
            历史
          </Button>
        </Tooltip>
        {/*
          图谱统计统计的是工程视角那幅图，所以只在画布页给入口。
          这个条件留着将来用：若再加入别的视角页，统计不该跟着出现在那些页面上。
        */}
        {canvasOnly ? (
          <Suspense
            fallback={
              <Button variant="ghost" size="icon-sm" disabled aria-label="图谱统计加载中">
                <BarChart3 className="h-3.5 w-3.5 animate-pulse" />
              </Button>
            }
          >
            <GraphStatsPopover graph={graph} />
          </Suspense>
        ) : null}
        <Tooltip content="快捷键帮助 ( ? )">
          <Button variant="ghost" size="icon-sm" onClick={onToggleHelp} aria-label="快捷键帮助">
            <HelpCircle className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>

        <Tooltip content="另存为一份保留副本 (Ctrl/Cmd + S)">
          <Button variant="secondary" size="sm" onClick={onSave}>
            <CloudUpload
              className={cn('h-3.5 w-3.5', saveState === 'saving' && 'animate-pulse')}
            />
            <span className={cn('tabular-nums', saveState === 'error' && 'text-destructive')}>{saveLabel}</span>
          </Button>
        </Tooltip>
      </div>
    </header>
  )
}
