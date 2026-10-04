import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Plus, Tag } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { cn } from '../lib/utils'
import { bucketByGroup } from '../lib/tagEdit'
import { tagAccentOf, tagGroupLabel, withAlpha } from '../graph/palette'
import {
  refLocation,
  refLocationShort,
  type GraphNode,
  type GraphRef,
  type TagDefinition,
  type TagDetailItem,
  type TagDetailMap,
} from '../lib/types'

/**
 * 类别色 → 一组 CSS 自定义属性。
 *
 * 为什么绕这一道：Tailwind 只认**静态**类名，`text-${accent}` 这种拼接在构建时会被丢掉
 * （而且不报错、线上就是没颜色）。所以类名一律写成固定的 `text-[var(--tag-accent)]`，
 * 真正的色值由行内 style 变量带进来——颜色只有 palette / 数据一个真源，悬停态也能跟着变。
 */
function accentVars(accent: string): React.CSSProperties {
  return {
    '--tag-accent': accent,
    '--tag-accent-70': withAlpha(accent, 0.7),
    '--tag-accent-25': withAlpha(accent, 0.25),
    '--tag-accent-20': withAlpha(accent, 0.2),
    '--tag-accent-8': withAlpha(accent, 0.08),
    '--tag-accent-4': withAlpha(accent, 0.04),
  } as React.CSSProperties
}

/**
 * 标签编辑入口：从**注册表**里多选，也可以当场新建。
 *
 * 入口只有这一处（标签区块的标题行）——曾经那排「胶囊 + ×」是同一份归属的第二处实现，
 * 已删除：摘标签走这里的取消勾选。
 *
 * 自由文本输入已经移除——落盘数据里只允许出现注册表里的 id，
 * 否则「改名不动归属」这条承诺就不成立（名字变了，归属就找不到自己了）。
 */
export function TagEditButton({
  tagIds,
  registry,
  onPatchNode,
  onCreateTag,
}: {
  /** 当前已归属的标签 id（有子图的节点传的是子树并集，见变更 D7） */
  tagIds: string[]
  registry: TagDefinition[]
  onPatchNode: (patch: Partial<GraphNode>) => void
  onCreateTag?: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const candidates = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return registry
    return registry.filter((tag) => tag.name.toLowerCase().includes(keyword))
  }, [registry, query])

  const exact = query.trim() && registry.some((tag) => tag.name.trim() === query.trim())

  const toggle = (tagId: string) => {
    const next = tagIds.includes(tagId) ? tagIds.filter((id) => id !== tagId) : [...tagIds, tagId]
    // 明细由服务端按新归属裁剪：摘掉标签，它的明细一并消失，不留悬空数据
    onPatchNode({ tags: next })
  }

  const create = () => {
    const name = query.trim()
    if (!name) return
    onCreateTag?.(name)
    setQuery('')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="从注册表里选，或新建一个"
          className="flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-black/15 px-2 py-[1px] text-micro text-muted-foreground transition-colors hover:border-black/25 hover:text-foreground"
        >
          <Plus className="h-2.5 w-2.5" />
          参数
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <div className="border-b border-black/[0.06] p-1.5">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !exact && query.trim()) create()
            }}
            placeholder="搜索或输入新参数"
            className="h-7 text-micro"
            aria-label="搜索或新建参数"
          />
        </div>
        <div className="max-h-[220px] overflow-y-auto p-1">
          {candidates.map((tag) => {
            const checked = tagIds.includes(tag.id)
            const accent = tagAccentOf(tag)
            return (
              <button
                key={tag.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(tag.id)}
                title={tag.description || undefined}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/[0.05]"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                    checked
                      ? 'border-[var(--tag-accent)] bg-[var(--tag-accent)] text-white'
                      : 'border-black/20 bg-white/70',
                  )}
                  style={accentVars(accent)}
                >
                  {checked ? '✓' : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-micro text-[var(--tag-accent)]">{tag.name}</span>
              </button>
            )
          })}
          {query.trim() && !exact ? (
            <Button variant="secondary" size="sm" className="mt-1 w-full" onClick={create}>
              <Plus className="h-3 w-3" />
              新建参数「{query.trim()}」
            </Button>
          ) : null}
          {!candidates.length && !query.trim() ? (
            <p className="px-2 py-3 text-micro text-muted-foreground">注册表里还没有参数</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** 明细按「用法」分组，保持首次出现的顺序（赋值 / 入公式 / 开关 之类） */
function groupByKind(items: TagDetailItem[]): Array<[string, TagDetailItem[]]> {
  const groups = new Map<string, TagDetailItem[]>()
  items.forEach((item) => {
    const kind = item.kind?.trim() || '其它'
    const bucket = groups.get(kind)
    if (bucket) bucket.push(item)
    else groups.set(kind, [item])
  })
  return [...groups.entries()]
}

function DetailRow({ item, onOpenRef }: { item: TagDetailItem; onOpenRef: (ref: GraphRef) => void }) {
  const ref = item.ref ?? null
  /** 出处只显示文件名（不带目录），完整路径进 `title`：这一栏窄，路径前缀把标签挤没了 */
  const location = ref ? refLocation(ref) : ''
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-md px-1.5 py-1 transition-colors hover:bg-black/[0.03]">
      <span className="font-mono text-micro text-foreground/90">{item.label}</span>
      {item.note ? <span className="text-micro text-muted-foreground/80">{item.note}</span> : null}
      {ref && location ? (
        <button
          type="button"
          onClick={() => onOpenRef(ref)}
          className="flex cursor-pointer items-center gap-0.5 font-mono text-[10px] text-cyan-700 transition-colors hover:text-cyan-800"
          title={`${location} · 打开出处`}
        >
          {refLocationShort(ref)}
          <ExternalLink className="h-2.5 w-2.5" />
        </button>
      ) : null}
    </li>
  )
}

/**
 * 属性面板的**参数**区块——**全局唯一一处**（标题行右侧就是编辑入口）。
 *
 * 为什么标题行要搬进区块里：编辑入口（`TagEditButton`）与明细必须并排出现在同一处，
 * 拆成"上面一排可编的、下面一片明细"正是从前长出第二处实现的原因
 * 。
 *
 * 明细条目就是「这个参数在这一处具体是什么」——
 * 「参数名 · 用法（赋值/入公式/开关）· 出处行号」，出处可点开对照源码。
 * 有子图的节点，这里列的是**当前子树叶子参数的并集**（由调用方算好递进来，本组件不猜）。
 *
 * 参数**按类别分段**铺开（`group` = inputs.py 的 InputStruct 子类名）：同类的卡片挨在一起、
 * 组名在段首、组内计数在段首右侧——一份平铺的彩色卡片看不出"这几张是一类"。
 */
export function NodeTagSection({
  tags,
  tagDetails,
  registry,
  activeTagId,
  onOpenRef,
  editable,
  readOnlyNote,
  onPatchNode,
  onCreateTag,
}: {
  /** 要显示的那一份归属：叶子是自己那份；有子图的是子树叶子的并集（见 lib/tagEdit.ts） */
  tags: string[]
  tagDetails: TagDetailMap
  registry: TagDefinition[]
  activeTagId?: string | null
  onOpenRef: (ref: GraphRef) => void
  /** 能不能在这增删（只有叶子能，判据见 lib/tagEdit.ts 的 canEditNodeTags） */
  editable: boolean
  /** 只读时标题行右侧那句说明；理由由调用方按身份给（参数来自子图成员 / 整页只读） */
  readOnlyNote: string
  onPatchNode: (patch: Partial<GraphNode>) => void
  onCreateTag?: (name: string) => void
}) {
  const [expanded, setExpanded] = useState<string[]>(() => (activeTagId ? [activeTagId] : []))
  const byId = useMemo(() => new Map(registry.map((tag) => [tag.id, tag])), [registry])

  /**
   * 按类别分组：`group` 就是 inputs.py 里 InputStruct 的子类名（与顶栏标签弹层同一口径）。
   * 组的顺序、组名都由 `bucketByGroup` / `tagGroupLabel` 给，本组件不自己排。
   */
  const tagGroups = useMemo(
    () => bucketByGroup(tags, (tagId) => byId.get(tagId)?.group),
    [tags, byId],
  )

  // 点画布红点带过来的标签：自动展开（不收起用户已经展开的其它标签）
  useEffect(() => {
    if (!activeTagId) return
    setExpanded((prev) => (prev.includes(activeTagId) ? prev : [...prev, activeTagId]))
  }, [activeTagId])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground/80">参数</h3>
        {/* 两种身份各一条分支：可编 → 入口；只读 → 一句话说清为什么不给编 */}
        {editable ? (
          <TagEditButton tagIds={tags} registry={registry} onPatchNode={onPatchNode} onCreateTag={onCreateTag} />
        ) : (
          <span className="max-w-[62%] text-right text-[10px] leading-tight text-muted-foreground/70">
            {readOnlyNote}
          </span>
        )}
      </div>
      {!tags.length ? (
        <p className="rounded-md border border-dashed border-black/10 px-2.5 py-3 text-micro leading-relaxed text-muted-foreground">
          {editable ? '还没有参数。点右上「参数」从注册表里选，或新建一个。' : `当前没有参数。${readOnlyNote}`}
        </p>
      ) : null}
      {tagGroups.map(([group, groupTagIds]) => (
        <section key={group || '__ungrouped'} className="flex flex-col gap-1.5">
          {/* 分组标题就是代码里的类名，便于和 inputs.py 对照（与顶栏标签弹层同一套） */}
          <div className="flex items-baseline justify-between gap-2 px-0.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              {tagGroupLabel(group)}
            </span>
            <span className="tabular-nums text-[10px] text-muted-foreground/50">{groupTagIds.length}</span>
          </div>
          {groupTagIds.map((tagId) => {
            const def = byId.get(tagId)
            const items = tagDetails[tagId] ?? []
            const isOpen = expanded.includes(tagId)
            // 整行按类别上色（边框 / 淡底 / 图标 / 名字）；计数、展开箭头与行分隔线保持中性
            const accent = tagAccentOf(def ?? {})
            return (
              <div
                key={tagId}
                className="overflow-hidden rounded-md border border-[var(--tag-accent-20)] bg-[var(--tag-accent-4)]"
                style={accentVars(accent)}
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]))
                  }
                  className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--tag-accent-8)]"
                  aria-expanded={isOpen}
                >
                  <Tag className="h-3 w-3 shrink-0 text-[var(--tag-accent)]" />
                  <span className="min-w-0 flex-1 truncate text-micro font-medium text-[var(--tag-accent)]">
                    {def?.name ?? tagId}
                  </span>
                  <span className="shrink-0 tabular-nums text-micro text-muted-foreground/70">{items.length} 条</span>
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  )}
                </button>
                {isOpen ? (
                  <div className="flex flex-col gap-2 border-t border-black/[0.06] px-2.5 py-2">
                    {def?.description ? (
                      <p className="text-micro leading-relaxed text-muted-foreground">{def.description}</p>
                    ) : null}
                    {!items.length ? (
                      <p className="text-micro text-muted-foreground/70">暂无明细（只标了归属）</p>
                    ) : (
                      groupByKind(items).map(([kind, list]) => (
                        <div key={kind} className="flex flex-col gap-0.5">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                            {kind}（{list.length}）
                          </div>
                          <ul className="flex flex-col">
                            {list.map((item, index) => (
                              <DetailRow key={`${item.label}-${index}`} item={item} onOpenRef={onOpenRef} />
                            ))}
                          </ul>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
