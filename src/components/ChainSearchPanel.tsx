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
 *      选中过程，词条展开成「物理量 / 参数」两栏——参数面里相关的那几行同时点亮，参数栏里点一个就切过去。
 *
 * 这是个**纯入参组件**：它是本页的视图，不读数据层、不碰选中状态，检索结果与词条分组都由页面算好递进来。
 */
import { useEffect, useState } from 'react'
import { AlertCircle, ChevronRight, ChevronsLeft, PanelLeftOpen, Search, X } from 'lucide-react'
import { Badge, Separator } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from './ui/popover'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip } from './ui/tooltip'
import { cn } from '../lib/utils'
import { PANEL_RAIL_WIDTH } from '../hooks/usePanelWidth'
import {
  ENGINEERING_LABEL,
  type ChainHit,
  type ChainHitKind,
  type ChainParamClassGroup,
  type ChainParamEntry,
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
  {
    id: 'processes',
    label: '天体物理过程',
    hint: '按论文等式划分的那条旧轴：一个过程 = 一组按等式串起来的量；点开还列出拧它的那些参数（口径与参数面同一份）',
  },
]

/**
 * 参数面上两个提法的口径（点标题行那个感叹号圆标打开）：每一条都是「疑问 + 口径」一起给出，
 * 不需要再点第二下。写的是这两个词在**本页**指什么，不新增数据、不影响生成物的算法；
 * 新增疑问按同一格式往下排。
 */
const PARAM_FACE_ISSUES: { question: string; answer: string }[] = [
  {
    question: '「作用于」意味着什么？',
    answer:
      '指读这个参数的代码，正是算那几个量用的那段——是「在这里被读到」，不是「它改变了这一步」。开关类（USE_*）在代码里没有读点，改的是走哪一支，所以单独标成「门控」。',
  },
  {
    question: '「属于」意味着什么？',
    answer:
      '指它碰到的那些量分别是谁的成员，按过程面自己的名单反查得来：一个量可以同时挂在多条过程下，一条都查不到时写「无」。',
  },
]

/**
 * 词条行的悬停提示：**直接作用的量 → 门控的边 → 门控到的量**。
 * 开关类没有直接落点，就不写"作用于 0 个量"——它门控的那条边在图上是有两端的，
 * 那两端就是它的去处（`fstar -> scaling_relations` 这条边，它为真时改的就是高质端那一支）。
 */
const paramEntryBrief = (entry: ChainParamEntry): string => {
  if (!entry.located) return `未落图：${entry.note}`
  const parts: string[] = []
  if (entry.nodeCount) parts.push(`作用于 ${entry.nodeCount} 个量`)
  if (entry.edgeCount) parts.push(`门控 ${entry.edgeCount} 条边：${entry.gateLabels.join('、')}`)
  if (entry.gatedNodeCount) parts.push(`它为真时改走 ${entry.gatedNodeCount} 个量那一支`)
  return parts.length ? parts.join('，') : '作用于 0 个量'
}

/** 选中参数后，脚上那段"它作用在哪"（页面按参数 × 节点矩阵算好递进来） */
export interface ChainParamEffect {
  name: string
  /** 代码里的类名（`AstroParams`…） */
  group: string
  /** 落在哪几个块（没有归属时为空数组） */
  blocks: string[]
  nodes: { id: string; label: string }[]
  /**
   * **门控边两端的量**（开关类才有）。它们不写成"作用于"（开关改的不是值，是走哪一支），
   * 但照样列出来、点得过去：那条边在图上就挂在这两端，开关的去处就是这里。
   */
  gated: { id: string; label: string }[]
  /** 门控边的人话两端（如 `恒星形成效率 → 标度关系`），与 `gated` 一一对应 */
  gateLabels: string[]
  /**
   * 没有落点时的**原因**（有落点则缺省）：脚上区不许只写「无」——
   * 「只门控边（改走哪一支）」「代码里没有读点」「链上没有量落在读到它的那段代码上」是三件事。
   */
  note?: string
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
  /** 兜底小节：只收「带」与还没收编的量（后者现为空——新增模块已按模块主题就近立条） */
  uncovered: { note: string; members: { id: string; label: string }[] }
  /** 当前选中的参数（高亮那一行） */
  activeParam: string | null
  activeParamEffect: ChainParamEffect | null
  onSelectParam: (name: string) => void
  /**
   * 点过程词条展开出来的**参数**那一栏：切到参数面并选中它。
   * 与脚上区那颗「属于」正好反向（那颗从参数面切到过程面），两颗都跨面，所以别合并成一个回调。
   */
  onJumpToParam: (name: string) => void
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
  onJumpToParam,
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
   * 兜底**默认收起**：它就是一层点击——标题上写着收纳什么、有几项。
   */
  const [noteOpen, setNoteOpen] = useState(false)
  const [uncoveredOpen, setUncoveredOpen] = useState(false)
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0)
  /**
   * 过程面词条就是这 12 条过程——兜底小节只收真源兜底名单里**还没收编进过程**的量，
   * 名单现为空（新增模块已按模块主题就近立条），故这一节平时不渲染。
   */
  const fallbackCount = uncovered.members.length
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
   * 过程词条行的悬停提示：行上只写名字，三个计数与那条拟合律口径都在这里给全
   * （与证据清单「落点只给文件名、完整路径退到 `title`」同一套做法：查阅不丢信息）。
   */
  const processRowTitle = (entry: ChainProcessEntry) =>
    [
      entry.label,
      [
        `${entry.memberCount} 个量`,
        entry.paramCount ? `${entry.paramCount} 个相关参数` : '无相关参数',
        entry.paperCount ? `${entry.paperCount} 篇出处` : '没查到出处',
      ].join(' · '),
      entry.fit ?? '',
      entry.note ?? '',
    ]
      .filter(Boolean)
      .join('\n')

  /**
   * 过程词条的一行（主清单与兜底小节渲染的是同一种行：交互必须是同一套）。
   * 点它＝定位到主块并选中；选中时展开成**两栏：物理量 + 参数**，各带副标题——
   * 两者不是一回事：量是这条过程算出来的产物（点它定位到那个量），参数是拧它的旋钮（点它切到参数面并选中）。
   * 词条上只写过程名：**不出现 `M8 气体热与自旋温度` 这类代码模块块名**（过程面不是一级轴，
   * 点到哪儿由 `primaryBlock` 决定，落到画布上自然看得见），计数与拟合律口径也不印在行上（退到悬停提示）。
   */
  const renderProcessRow = (entry: ChainProcessEntry) => {
    const active = activeProcess === entry.id
    const lit = litProcessIds.includes(entry.id)
    return (
      <div key={entry.id} className="flex flex-col">
        <button
          type="button"
          onClick={() => onSelectProcess(entry.id)}
          title={processRowTitle(entry)}
          className={cn(
            'group flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-left transition-colors duration-150',
            active ? 'bg-primary/12' : lit ? 'bg-primary/8' : 'hover:bg-black/[0.05]',
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-tiny font-medium text-foreground/92">{entry.label}</span>
          </span>
        </button>
        {active ? (
          /*
           * 展开成两栏，各带副标题（量与参数是两回事，混在一排会读成同一类东西）：
           *   · 物理量：这条过程下辖的量，点它定位到那个量；
           *   · 参数：拧这条过程的旋钮，点它切到参数面并选中那一个。
           * 参数那一栏的口径与参数面**同一份**（`relatedParams` 就是 `paramsOfProcess` 的结果），
           * 所以这里列出的参数，与切过去之后被点亮的那几行是同一批。
           * 两栏都可能为空，都写出「无」（规格：反查可能为空 → 显式写「无」，不许静默空着）。
           */
          <div className="flex flex-col gap-2 px-2 pb-2 pt-1.5">
            <div className="flex flex-col gap-1">
              <span className="text-micro text-muted-foreground/70">物理量</span>
              <div className="flex flex-wrap gap-1">
                {entry.members.length ? (
                  entry.members.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => onRevealNode(member.id)}
                      title={`定位到 ${member.label}`}
                      className="cursor-pointer rounded border border-black/[0.08] px-1.5 py-0.5 text-micro text-foreground/85 transition-colors hover:border-primary/50 hover:text-primary"
                    >
                      {member.label}
                    </button>
                  ))
                ) : (
                  <span className="text-micro text-muted-foreground/70">无</span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-micro text-muted-foreground/70">参数</span>
              <div className="flex flex-wrap gap-1">
                {entry.relatedParams.length ? (
                  entry.relatedParams.map((param) => (
                    <button
                      key={param.name}
                      type="button"
                      onClick={() => onJumpToParam(param.name)}
                      title={`切到参数面并选中 ${param.name}（${param.group}）`}
                      className="cursor-pointer rounded border border-primary/30 bg-primary/8 px-1.5 py-0.5 font-mono text-micro text-primary transition-colors hover:border-primary/60"
                    >
                      {param.name}
                    </button>
                  ))
                ) : (
                  <span className="text-micro text-muted-foreground/70">无</span>
                )}
              </div>
            </div>
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
            {/* 左上角的感叹号圆标：点开是这两个提法的口径，右上角可关，点别处也关 */}
            <Popover>
              <Tooltip content="问题">
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="问题"
                    className="h-5 w-5 shrink-0 rounded-full text-amber-600 hover:bg-amber-500/15 hover:text-amber-700"
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
              </Tooltip>
              <PopoverContent align="start" sideOffset={4} className="w-[320px] p-0">
                <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-2">
                  <span className="text-micro font-semibold">问题</span>
                  <PopoverClose asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="关闭问题">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverClose>
                </div>
                <ol className="space-y-2.5 px-3 py-2.5">
                  {PARAM_FACE_ISSUES.map((issue, index) => (
                    <li key={issue.question} className="space-y-1">
                      <div className="flex gap-1.5 text-micro font-medium text-foreground/90">
                        <span className="shrink-0 tabular-nums text-muted-foreground/60">{index + 1}.</span>
                        <span className="min-w-0">{issue.question}</span>
                      </div>
                      <p className="pl-4 text-micro leading-relaxed text-muted-foreground">{issue.answer}</p>
                    </li>
                  ))}
                </ol>
              </PopoverContent>
            </Popover>
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
            const count = item.id === 'params' ? total : processEntries.length
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
                        title={hit.detail ? `${hit.label}：${hit.detail}` : hit.label}
                        className={cn(
                          'group flex cursor-pointer flex-col rounded-md px-2 py-1.5 text-left transition-colors duration-150',
                          index === activeIndex ? 'bg-primary/12' : 'hover:bg-black/[0.05]',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate text-tiny font-medium text-foreground/92">{hit.label}</span>
                          {hit.collapsed ? <Badge tone="warning">{ENGINEERING_LABEL}</Badge> : null}
                        </span>
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

              {processEntries.length ? (
                processEntries.map((entry) => renderProcessRow(entry))
              ) : (
                /* 一面为空 MUST 写明原因（规格），不许渲染成空面板 */
                <p className="px-2 py-1.5 text-micro leading-4 text-muted-foreground/80">
                  生成物里没有过程词条（`processes.items` 为空）——不是这一面没内容，是数据还没到。
                </p>
              )}

              {/*
                **兜底小节**（名单非空才出现、默认收起）：收纳真源兜底名单里还没收编进任何过程的量
                （现为空——新增模块已按模块主题就近立条）。自检钉住"12 个过程 + 兜底名单 = 全部 38 个量"，
                所以这一节是安全网：真出现漏网的量，它会露头，且绝不混在过程词条之间。
              */}
              {fallbackCount ? (
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
                      还没收编的量（不是过程）
                    </span>
                    <Badge tone="muted">{fallbackCount}</Badge>
                  </button>
                  {uncoveredOpen ? (
                    <>
                      <p className="px-2 pb-1 text-micro leading-4 text-muted-foreground/80">{uncovered.note}</p>
                      {/* 点了定位到它所在的块并选中 */}
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
              ) : null}
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
                            title={[
                              entry.pl2012 ? `${entry.name}（${entry.pl2012}）` : entry.name,
                              paramEntryBrief(entry),
                            ].join('\n')}
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
                            {/* 没落点的词条照样列出来，但标出它在图上点不亮（原因退到悬停提示） */}
                            {entry.located ? null : <Badge tone="warning">未落图</Badge>}
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

      {/*
        选中参数后的脚上区：**最高占左栏一半**——作用于十几个量的参数（如 `USE_MINIHALOS`）不再把上面的
        词条清单顶出视野，超出的部分在区内滚动。「作用于几个量、落在哪几个块」不印在区里，退到名字那一行的悬停提示。
      */}
      {activeParamEffect ? (
        <>
          <Separator />
          <div className="max-h-[50%] shrink-0 overflow-y-auto px-3.5 py-2.5">
            <div
              className="flex items-center gap-1.5"
              title={`${activeParamEffect.name}：${
                activeParamEffect.nodes.length
                  ? `作用于 ${activeParamEffect.nodes.length} 个量`
                  : activeParamEffect.gateLabels.length
                    ? `门控 ${activeParamEffect.gateLabels.join('、')}`
                    : '作用于 0 个量'
              }${activeParamEffect.blocks.length ? `，落在 ${activeParamEffect.blocks.join('、')}` : '（还没落到任何块）'}${
                activeParamEffect.note ? `——${activeParamEffect.note}` : ''
              }`}
            >
              <span className="min-w-0 truncate font-mono text-micro font-semibold text-foreground/92">
                {activeParamEffect.name}
              </span>
              <Badge tone="muted">{activeParamEffect.group}</Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="text-micro text-muted-foreground/70">作用于</span>
              {activeParamEffect.nodes.length ? (
                activeParamEffect.nodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => onRevealNode(node.id)}
                    title={`定位到 ${node.label}`}
                    className="cursor-pointer rounded border border-black/[0.08] px-1.5 py-0.5 text-micro text-foreground/85 transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    {node.label}
                  </button>
                ))
              ) : (
                <span className="text-micro text-muted-foreground/70">
                  {activeParamEffect.note ? `无（${activeParamEffect.note}）` : '无'}
                </span>
              )}
            </div>
            {
              /* 开关类不写"作用于 0 个量"就完事：它门控的那条边在图上挂着两个量，那两端就是它的去处。
                 行标签写"门控"而不是"作用于"——它改的不是量的值，改的是走哪一支。 */
            }
            {activeParamEffect.gated.length ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-micro text-muted-foreground/70">门控</span>
                {activeParamEffect.gated.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => onRevealNode(node.id)}
                    title={`定位到 ${node.label}（这条开关为真时改的就是它这一支）`}
                    className="cursor-pointer rounded border border-black/[0.08] px-1.5 py-0.5 text-micro text-foreground/85 transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    {node.label}
                  </button>
                ))}
              </div>
            ) : null}
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
                <span className="text-micro text-muted-foreground/70">无</span>
              )}
            </div>
          </div>
        </>
      ) : null}
    </aside>
  )
}
