/**
 * 物理链页的左栏：**检索与两条词条面**。
 *
 * 它原来是一个浮在画布左上角的小抽屉，一展开就压住一级左侧的两块，
 * 而且窄得看不全——现在跟画布页的「notes 数据库」同一套：真侧栏、宽度可拖（`usePanelWidth` 管，
 * 双击复位、拖过最小宽度自动收成细条）、宽度与收起状态记在本地。
 *
 * 这一栏里的事：
 *   1. **两个页签**：「参数」（按代码里的类名分组：`AstroParams` / `CosmoParams` / `AstroOptions`…）
 *      与「天体物理过程」（旧的一级轴，按论文等式划分）。两条面**并存**，谁也不替代谁；
 *   2. **四路检索**（参数 / 物理量 / 过程 / 文献）按类分组、给出计数，键盘 ↑↓ 走、Enter 定位、Esc 清空。
 *      有检索词时结果**跨两条面**（页签不影响检索结果）；
 *   3. 两条面**互相查找**：选中参数，脚上写"它落在哪些过程下"（点了切到过程面并选中）；
 *      选中过程，参数面里相关的那些行同时点亮。
 *
 * 这是个**纯入参组件**：它是本页的视图，不读数据层、不碰选中状态，检索结果与词条分组都由页面算好递进来。
 */
import { useEffect, useState } from 'react'
import { ChevronRight, ChevronsLeft, PanelLeftOpen, Search } from 'lucide-react'
import { Badge, Separator } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip } from './ui/tooltip'
import { cn } from '../lib/utils'
import { PANEL_RAIL_WIDTH } from '../hooks/usePanelWidth'
import {
  ENGINEERING_LABEL,
  type ChainHit,
  type ChainHitKind,
  type ChainParamClassGroup,
  type ChainProcessEntry,
} from '../lib/physicsChain'

/** 四类命中在结果里的**分组顺序**＝命中面的顺序（与数据层 `searchChain` 的推入顺序一致） */
const HIT_GROUPS: { kind: ChainHitKind; label: string }[] = [
  { kind: 'param', label: '参数' },
  { kind: 'quantity', label: '物理量' },
  { kind: 'process', label: '过程' },
  { kind: 'paper', label: '文献' },
]

/**
 * 左栏的两个页签。`params` 是主面（默认打开），`processes` 是**旧的一级轴降级来的检索面**
 * （划分依据是论文等式，见 `chainProcessNote()`）——页签只切换"列哪一面"，不影响检索。
 */
export type ChainPanelTab = 'params' | 'processes'

const PANEL_TABS: { id: ChainPanelTab; label: string; hint: string }[] = [
  { id: 'params', label: '参数', hint: '按代码里的类名分组（AstroParams / CosmoParams / AstroOptions…）' },
  { id: 'processes', label: '天体物理过程', hint: '按论文等式划分的那条旧轴：一个过程 = 一组按等式串起来的量' },
]

/** 选中参数后，脚上那段"它作用在哪"（页面按参数 × 节点矩阵算好递进来） */
export interface ChainParamEffect {
  name: string
  /** 代码里的类名（`AstroParams`…） */
  group: string
  /** 落在哪几个块（没有归属时为空数组） */
  blocks: string[]
  nodes: { id: string; label: string }[]
  /**
   * 这些量挂在**哪些过程面词条**下（两条面互相查找：点它切到过程面并选中那条）。
   * 一个量可能同时挂在多条过程下，所以这里是数组（去重后）。
   */
  processes: { id: string; label: string }[]
}

interface ChainSearchPanelProps {
  /** 受控宽度（由 usePanelWidth 管理，纯视图状态） */
  width: number
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 检索词（受控：切页要清空，所以状态放在页面里，面板只管显示） */
  query: string
  onQueryChange: (value: string) => void
  /** 有查询＝走四路命中；空＝列词条分组 */
  searching: boolean
  hits: ChainHit[]
  counts: Record<ChainHitKind, number>
  /** 词条分组（按代码类名，页面从数据层取） */
  groups: ChainParamClassGroup[]
  /** 当前页签（受控在页面里：切页要清空检索词，面板只管显示） */
  tab: ChainPanelTab
  onTabChange: (tab: ChainPanelTab) => void
  /** 过程面词条（旧的一级轴：过程名 + 下辖量数 + 论文出处数 + 主块，页面从数据层取） */
  processEntries: ChainProcessEntry[]
  /** 过程面的口径（真源同一句：为什么这么分、`fit` 的收条标准）——在词条清单顶上可展开 */
  processNote: string
  /** 兜底小节：旧划分覆盖不到的量（显式列出，不替它们编过程名） */
  uncovered: { note: string; members: { id: string; label: string }[] }
  /** 当前选中的参数（高亮那一行） */
  activeParam: string | null
  activeParamEffect: ChainParamEffect | null
  onSelectParam: (name: string) => void
  /** 当前选中的过程（高亮那一行、展开它的成员） */
  activeProcess: string | null
  onSelectProcess: (processId: string) => void
  /** 选中参数时点亮的过程行（点参数 → 点亮过程面） */
  litProcessIds: string[]
  /** 选中过程时点亮的参数行（点过程 → 点亮参数面） */
  litParamNames: string[]
  onSelectHit: (hit: ChainHit) => void
  /** 点"作用于"里的某一项：定位到那个量（页面负责先把它所在的块摆到眼前） */
  onRevealNode: (nodeId: string) => void
}

export function ChainSearchPanel({
  width,
  collapsed,
  onToggleCollapsed,
  query,
  onQueryChange,
  searching,
  hits,
  counts,
  groups,
  tab,
  onTabChange,
  processEntries,
  processNote,
  uncovered,
  activeParam,
  activeParamEffect,
  onSelectParam,
  activeProcess,
  onSelectProcess,
  litProcessIds,
  litParamNames,
  onSelectHit,
  onRevealNode,
}: ChainSearchPanelProps) {
  /** 键盘走命中的当前项（面板内部状态，不往页面递） */
  const [cursor, setCursor] = useState(0)
  /** 词条分组的收起状态（默认全展开：这一栏就是给人翻的） */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  /**
   * 过程面顶上那句口径、以及兜底小节，是否展开。
   * 兜底**默认收起**（规格钉的就是这个状态）：收起是为了"带与未归属的量不与过程词条混排"；
   * 它就是一层点击，缺口没有被藏起来——标题上写着收纳什么、有几项、以及它们不是过程。
   */
  const [noteOpen, setNoteOpen] = useState(false)
  const [uncoveredOpen, setUncoveredOpen] = useState(false)
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0)
  /** 过程面词条只有**过程**（8 条）；「带」与旧划分覆盖不到的量进兜底小节，不与过程混排 */
  const processRows = processEntries.filter((entry) => entry.kind === 'process')
  const fallbackRows = processEntries.filter((entry) => entry.kind === 'band')
  const fallbackCount = fallbackRows.length + uncovered.members.length
  const hitTotal = HIT_GROUPS.reduce((sum, item) => sum + counts[item.kind], 0)
  // 换检索词就把当前项收回第一条：否则会出现"当前项停在列表之外"
  useEffect(() => setCursor(0), [query])
  const activeIndex = hits.length ? Math.min(cursor, hits.length - 1) : -1

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onQueryChange('')
      setCursor(0)
      return
    }
    if (!hits.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => Math.min(value + 1, hits.length - 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => Math.max(value - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const hit = hits[activeIndex]
      if (hit) onSelectHit(hit)
    }
  }

  if (collapsed) {
    return (
      <aside
        className="glass-panel flex shrink-0 flex-col items-center gap-2 overflow-hidden rounded-lg py-3"
        style={{ width: PANEL_RAIL_WIDTH }}
      >
        <Tooltip content="展开检索与词条">
          <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="展开检索与词条">
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        <Search className="h-3.5 w-3.5 text-primary" />
        <span className="text-micro tabular-nums text-muted-foreground/70">{total}</span>
      </aside>
    )
  }

  /**
   * 过程词条与带词条**共用的一行**（主清单与兜底小节渲染的是同一种行：交互必须是同一套）。
   * 点它＝定位到主块并选中；选中时把下辖的量铺开，每一项可点、点了定位到那个量。
   * 词条上只写过程名与三个计数：**不出现 `M8 气体热与自旋温度` 这类代码模块块名**（过程面不是一级轴，
   * 点到哪儿由 `primaryBlock` 决定，落到画布上自然看得见）。
   */
  const renderProcessRow = (entry: ChainProcessEntry) => {
    const active = activeProcess === entry.id
    const lit = litProcessIds.includes(entry.id)
    return (
      <div key={entry.id} className="flex flex-col">
        <button
          type="button"
          onClick={() => onSelectProcess(entry.id)}
          title={entry.note ?? entry.label}
          className={cn(
            'group flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-left transition-colors duration-150',
            active ? 'bg-primary/12' : lit ? 'bg-primary/8' : 'hover:bg-black/[0.05]',
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-tiny font-medium text-foreground/92">{entry.label}</span>
            {entry.kind === 'band' ? <Badge tone="muted">带</Badge> : null}
            {/* 拟合律口径没查到的，明确标出来：那份空缺就是给人核验的线索（带不谈拟合律，不标） */}
            {entry.kind === 'process' && !entry.fit ? <Badge tone="warning">口径待核</Badge> : null}
          </span>
          {/* 三件事：下辖几个量 / 几个参数读到它（一个都没有就写「无」）/ 几篇论文出处 */}
          <span className="mt-0.5 block text-micro leading-4 text-muted-foreground">
            {`${entry.memberCount} 个量`}
            {entry.paramCount ? ` · ${entry.paramCount} 个相关参数` : ' · 无相关参数'}
            {entry.paperCount ? ` · ${entry.paperCount} 篇出处` : ' · 没查到出处'}
          </span>
          {entry.fit ? <span className="mt-1 block text-micro leading-4 text-muted-foreground/85">{entry.fit}</span> : null}
        </button>
        {active ? (
          <div className="flex flex-wrap gap-1 px-2 pb-2 pt-1">
            {entry.members.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => onRevealNode(member.id)}
                title={`定位到 ${member.label}`}
                className="cursor-pointer rounded border border-black/[0.08] px-1.5 py-0.5 text-micro text-foreground/85 transition-colors hover:border-primary/50 hover:text-primary"
              >
                {member.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <aside className="glass-panel flex shrink-0 flex-col overflow-hidden rounded-lg" style={{ width }}>
      <div className="flex shrink-0 flex-col gap-2.5 px-3.5 pb-2.5 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-primary" />
            <h2 className="truncate text-tiny font-semibold tracking-wide">检索与词条</h2>
          </div>
          <Tooltip content="收起面板">
            <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="收起检索与词条">
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>

        {/* 两个页签：参数面 / 过程面。计数写在页签上（不再单列「N 个代码类」那种总计数徽标） */}
        <div className="flex items-center gap-0.5 rounded-md bg-black/[0.04] p-0.5">
          {PANEL_TABS.map((item) => {
            const active = tab === item.id
            const count = item.id === 'params' ? total : processRows.length
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                aria-pressed={active}
                title={item.hint}
                className={cn(
                  'flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded px-1.5 py-1 text-micro font-medium transition-colors duration-150',
                  active ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground/85',
                )}
              >
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground/70">{count}</span>
              </button>
            )
          })}
        </div>

        {/* 有检索词时：四路命中的计数（结果**跨两条面**，页签不影响它） */}
        {searching ? (
          <div className="flex items-center gap-1.5">
            <Badge tone={hitTotal ? 'primary' : 'muted'}>命中 {hitTotal} 条</Badge>
            {HIT_GROUPS.filter((item) => counts[item.kind] > 0).map((item) => (
              <Badge key={item.kind} tone="muted">
                {item.label} {counts[item.kind]}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜参数 / 物理量 / 过程 / 文献"
            className="pl-8"
            aria-label="物理链检索"
          />
        </div>
      </div>

      <Separator />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {searching ? (
            hits.length ? (
              HIT_GROUPS.map((group) => {
                const indexed = hits
                  .map((hit, index) => ({ hit, index }))
                  .filter((item) => item.hit.kind === group.kind)
                if (!indexed.length) return null
                return (
                  <div key={group.kind} className="flex flex-col">
                    <div className="flex items-center gap-1.5 px-2 pb-1 pt-1.5">
                      <span className="text-micro font-medium text-muted-foreground">{group.label}</span>
                      <Badge tone="muted">{indexed.length}</Badge>
                    </div>
                    {indexed.map(({ hit, index }) => (
                      <button
                        key={`${hit.kind}:${hit.id}`}
                        type="button"
                        onClick={() => onSelectHit(hit)}
                        title={hit.label}
                        className={cn(
                          'group flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-left transition-colors duration-150',
                          index === activeIndex ? 'bg-primary/12' : 'hover:bg-black/[0.05]',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-tiny font-medium text-foreground/92">{hit.label}</span>
                          {hit.collapsed ? <Badge tone="warning">{ENGINEERING_LABEL}</Badge> : null}
                        </span>
                        <span className="mt-0.5 block text-micro leading-4 text-muted-foreground">{hit.detail}</span>
                      </button>
                    ))}
                  </div>
                )
              })
            ) : (
              <p className="px-2 py-3 text-micro text-muted-foreground">
                没有匹配「{query}」的参数、物理量、过程或论文出处
              </p>
            )
          ) : tab === 'processes' ? (
            /* 空查询 + 过程页签＝**天体物理过程**词条：过程名 + 下辖量数 + 论文出处数 + 拟合律口径 */
            <>
              {/* 这一面按什么划分（真源同一句）：默认收起，免得每次翻词条都先读一段散文 */}
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => setNoteOpen((value) => !value)}
                  aria-expanded={noteOpen}
                  className="mt-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-black/[0.05]"
                >
                  <ChevronRight
                    className={cn(
                      'h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-200',
                      noteOpen && 'rotate-90',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-micro font-medium text-muted-foreground">这一面按什么划分？</span>
                </button>
                {noteOpen ? <p className="px-2 pb-1.5 text-micro leading-4 text-muted-foreground/80">{processNote}</p> : null}
              </div>

              {processRows.length ? (
                processRows.map((entry) => renderProcessRow(entry))
              ) : (
                /* 一面为空 MUST 写明原因（规格），不许渲染成空面板 */
                <p className="px-2 py-1.5 text-micro leading-4 text-muted-foreground/80">
                  生成物里没有过程词条（`processes.items` 为空）——不是这一面没内容，是数据还没到。
                </p>
              )}

              {/*
                **兜底小节**（常驻、默认收起）：收纳**不是过程**的两条「带」与旧划分覆盖不到的量。
                它们要么是带（成员之间没有块内边、进不去子图），要么出生在旧稿之后的代码模块里——
                本仓不替它们编过程名（缺口要显示出来、不许被粉饰掉）；自检钉住
                "8 过程 + 2 带 + 兜底 = 全部 28 个量，不重不漏"。收起时它们绝不混在过程词条之间。
              */}
              <div className="mt-2 flex flex-col border-t border-black/[0.06] pt-1.5">
                <button
                  type="button"
                  onClick={() => setUncoveredOpen((value) => !value)}
                  aria-expanded={uncoveredOpen}
                  className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-black/[0.05]"
                >
                  <ChevronRight
                    className={cn(
                      'h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-200',
                      uncoveredOpen && 'rotate-90',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-micro font-medium text-muted-foreground">
                    带与未归属的量（不是过程）
                  </span>
                  <Badge tone="muted">{fallbackCount}</Badge>
                </button>
                {uncoveredOpen ? (
                  <>
                    <p className="px-2 pb-1 text-micro leading-4 text-muted-foreground/80">{uncovered.note}</p>
                    {/* 两条带：与过程词条**同一套交互**（点它定位到主块并选中、展开成员） */}
                    {fallbackRows.map((entry) => renderProcessRow(entry))}
                    {/* 旧划分覆盖不到的量：点了定位到它所在的块并选中 */}
                    <div className="flex flex-wrap gap-1 px-2 pb-1 pt-0.5">
                      {uncovered.members.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => onRevealNode(member.id)}
                          title={`定位到 ${member.label}`}
                          className="cursor-pointer rounded border border-black/[0.08] px-1.5 py-0.5 text-micro text-foreground/85 transition-colors hover:border-primary/50 hover:text-primary"
                        >
                          {member.label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            /* 空查询＝词条清单：按**代码里的类名**分组（名字来自生成物，页面不写死） */
            groups.map((group) => {
              const isCollapsed = collapsedGroups[group.group] ?? false
              return (
                <div key={group.group} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.group]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    className="mt-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 transition-colors hover:bg-black/[0.05]"
                  >
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-200',
                        !isCollapsed && 'rotate-90',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-micro font-medium text-muted-foreground">
                      {group.group}
                    </span>
                    <Badge tone="muted">{group.entries.length}</Badge>
                  </button>
                  {isCollapsed ? null : (
                    <ul className="space-y-0.5">
                      {group.entries.map((entry) => (
                        <li key={entry.name}>
                          <button
                            type="button"
                            onClick={() => onSelectParam(entry.name)}
                            title={
                              entry.edgeCount
                                ? `${entry.name}：作用于 ${entry.nodeCount} 个量，门控 ${entry.edgeCount} 条边`
                                : `${entry.name}：作用于 ${entry.nodeCount} 个量`
                            }
                            className={cn(
                              'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-micro transition-colors duration-150',
                              activeParam === entry.name
                                ? 'bg-primary/15 text-primary'
                                : litParamNames.includes(entry.name)
                                  ? 'bg-primary/8 text-primary/90'
                                  : 'text-foreground/88 hover:bg-black/[0.05]',
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                            {entry.pl2012 ? (
                              <span className="shrink-0 text-micro text-muted-foreground/70">{entry.pl2012}</span>
                            ) : null}
                            <span className="shrink-0 text-micro tabular-nums text-muted-foreground/70">
                              {entry.nodeCount} 处
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>

      {/* 选中参数：它作用在哪几个块、哪些量；每一项都可点，点了就定位过去 */}
      {activeParamEffect ? (
        <>
          <Separator />
          <div className="shrink-0 px-3.5 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 truncate font-mono text-micro font-semibold text-foreground/92">
                {activeParamEffect.name}
              </span>
              <Badge tone="muted">{activeParamEffect.group}</Badge>
            </div>
            <p className="mt-1 text-micro leading-4 text-muted-foreground">
              作用于 {activeParamEffect.nodes.length} 个量
              {activeParamEffect.blocks.length ? `，落在 ${activeParamEffect.blocks.join('、')}` : '（还没落到任何块）'}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {activeParamEffect.nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onRevealNode(node.id)}
                  title={`定位到 ${node.label}`}
                  className="cursor-pointer rounded border border-black/[0.08] px-1.5 py-0.5 text-micro text-foreground/85 transition-colors hover:border-primary/50 hover:text-primary"
                >
                  {node.label}
                </button>
              ))}
            </div>
            {
              /* 两条面互相查找：这些量挂在哪些**过程**下——点了切到过程面并选中那一条。
                 反查为空时 MUST 写明「无」（规格：反查可能为空 → 显式写「无」，不许静默空面板） */
            }
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <span className="text-micro text-muted-foreground/70">属于</span>
              {activeParamEffect.processes.length ? (
                activeParamEffect.processes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectProcess(item.id)}
                    title={`切到过程面并选中「${item.label}」`}
                    className="cursor-pointer rounded border border-primary/30 bg-primary/8 px-1.5 py-0.5 text-micro text-primary transition-colors hover:border-primary/60"
                  >
                    {item.label}
                  </button>
                ))
              ) : (
                <span className="text-micro text-muted-foreground/70">无（还没有任何过程面词条读到它）</span>
              )}
            </div>
          </div>
        </>
      ) : null}
    </aside>
  )
}
