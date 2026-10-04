import { useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronRight,
  ChevronsLeft,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'
import { Badge, Separator } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { Tooltip } from './ui/tooltip'
import { cn, formatChars } from '../lib/utils'
import { headingIndent } from '../lib/slug'
import { PANEL_RAIL_WIDTH } from '../hooks/usePanelWidth'
import type { MdDoc } from '../lib/types'

interface MdLibraryPanelProps {
  docs: MdDoc[]
  loading: boolean
  error: string | null
  query: string
  mdDir: string
  totalChars: number
  refCounts: Map<string, number>
  activeDocId: string | null
  canAddRef: boolean
  /** 受控宽度（由 usePanelWidth 管理，纯视图状态） */
  width: number
  /** 是否收起为细条 */
  collapsed: boolean
  onToggleCollapsed: () => void
  onQueryChange: (value: string) => void
  onRefresh: () => void
  onOpenDoc: (docId: string, anchor?: string) => void
  onAddRef: (docId: string, anchor?: string, label?: string) => void
  onDragRefStart: (payload: { docId: string; anchor: string; label: string } | null) => void
}

export function MdLibraryPanel({
  docs,
  loading,
  error,
  query,
  mdDir,
  totalChars,
  refCounts,
  activeDocId,
  canAddRef,
  width,
  collapsed,
  onToggleCollapsed,
  onQueryChange,
  onRefresh,
  onOpenDoc,
  onAddRef,
  onDragRefStart,
}: MdLibraryPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({})

  // 按子目录分组：根目录文档归入空串分组；分组按路径排序，根目录始终在最前
  const groups = useMemo(() => {
    const buckets = new Map<string, MdDoc[]>()
    docs.forEach((doc) => {
      const key = doc.folder || ''
      const bucket = buckets.get(key)
      if (bucket) bucket.push(doc)
      else buckets.set(key, [doc])
    })
    return [...buckets.entries()]
      .map(([folder, items]) => ({ folder, docs: items }))
      .sort((a, b) => {
        if (a.folder === b.folder) return 0
        if (!a.folder) return -1
        if (!b.folder) return 1
        return a.folder.localeCompare(b.folder, 'zh-Hans-CN')
      })
  }, [docs])

  /** 只有存在子目录时才显示分组头，扁平目录保持原有观感 */
  const hasSubFolders = groups.some((group) => group.folder !== '')

  const stats = useMemo(
    () => ({
      docs: docs.length,
      refs: [...refCounts.values()].reduce((sum, value) => sum + value, 0),
    }),
    [docs.length, refCounts],
  )

  const renderDoc = (doc: MdDoc) => {
    const isExpanded = expanded[doc.docId] ?? false
    const refCount = refCounts.get(doc.docId) ?? 0
    const isActive = activeDocId === doc.docId
    return (
      <div key={doc.docId} className="flex flex-col">
        <div
          draggable
          onDragStart={(event) => {
            onDragRefStart({ docId: doc.docId, anchor: '', label: doc.title })
            event.dataTransfer.effectAllowed = 'link'
            event.dataTransfer.setData('text/plain', doc.docId)
          }}
          onDragEnd={() => onDragRefStart(null)}
          className={cn(
            'group flex items-start gap-1.5 rounded-md px-2 py-1.5 transition-colors duration-150',
            isActive ? 'bg-primary/12' : 'hover:bg-black/[0.05]',
            canAddRef && 'cursor-grab active:cursor-grabbing',
          )}
        >
          <button
            type="button"
            onClick={() => setExpanded((prev) => ({ ...prev, [doc.docId]: !isExpanded }))}
            className="mt-[1px] shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground/70 transition-transform duration-200 hover:text-foreground"
            aria-label={isExpanded ? '收起大纲' : '展开大纲'}
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform duration-200', isExpanded && 'rotate-90')} />
          </button>

          <button
            type="button"
            onClick={() => onOpenDoc(doc.docId)}
            className="min-w-0 flex-1 cursor-pointer text-left"
            title={doc.docId}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <FileText className="h-3 w-3 shrink-0 text-cyan-700/80" />
              <span className="truncate text-tiny font-medium text-foreground/92">{doc.title}</span>
              {refCount > 0 ? <Badge tone="primary">{refCount}</Badge> : null}
            </span>
          </button>

          <Tooltip content={canAddRef ? '添加到当前节点引用' : '先选中一个节点'}>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!canAddRef}
              onClick={() => onAddRef(doc.docId, '', doc.title)}
              className="mt-[1px] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
              aria-label={`为当前节点引用 ${doc.title}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>

        {isExpanded ? (
          <ol className="mb-1 ml-[18px] flex animate-fade-in flex-col border-l border-black/[0.07] pl-1.5">
            {doc.headings.map((heading) => (
              <li key={`${doc.docId}-${heading.slug}`}>
                <button
                  type="button"
                  onClick={() => onOpenDoc(doc.docId, heading.slug)}
                  style={{ marginLeft: headingIndent(heading.depth) }}
                  className="group/heading flex w-full cursor-pointer items-center justify-between gap-1.5 rounded px-1.5 py-1 text-left text-micro text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{heading.text}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    title="把该章节加入节点引用"
                    onClick={(event) => {
                      event.stopPropagation()
                      onAddRef(doc.docId, heading.slug, heading.text)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.stopPropagation()
                        onAddRef(doc.docId, heading.slug, heading.text)
                      }
                    }}
                    className={cn(
                      'shrink-0 rounded p-0.5 transition-opacity',
                      canAddRef ? 'opacity-0 group-hover/heading:opacity-100' : 'hidden',
                    )}
                  >
                    <Plus className="h-3 w-3" />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    )
  }

  if (collapsed) {
    return (
      <aside
        className="glass-panel flex shrink-0 flex-col items-center gap-2 overflow-hidden rounded-lg py-3"
        style={{ width: PANEL_RAIL_WIDTH }}
      >
        <Tooltip content="展开 notes 数据库">
          <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="展开 notes 数据库">
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
        <FolderOpen className="h-3.5 w-3.5 text-primary" />
        <span className="text-micro tabular-nums text-muted-foreground/70">{docs.length}</span>
      </aside>
    )
  }

  return (
    <aside className="glass-panel flex shrink-0 flex-col overflow-hidden rounded-lg" style={{ width }}>
      <div className="flex shrink-0 flex-col gap-2.5 px-3.5 pb-2.5 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
            <h2 className="truncate text-tiny font-semibold tracking-wide">notes 数据库</h2>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip content="重新扫描 notes 目录">
              <Button variant="ghost" size="icon-sm" onClick={onRefresh} aria-label="刷新 notes 数据库">
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </Button>
            </Tooltip>
            <Tooltip content="收起面板">
              <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} aria-label="收起 notes 数据库">
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-micro text-muted-foreground">
          <Badge tone="muted">{stats.docs} 篇</Badge>
          <Badge tone="muted">{formatChars(totalChars)}</Badge>
          <Badge tone={stats.refs > 0 ? 'primary' : 'muted'}>{stats.refs} 处引用</Badge>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索文档或标题…"
            className="pl-8"
            data-md-search="true"
          />
        </div>
      </div>

      <Separator />

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {error ? (
            <p className="px-2 py-3 text-micro text-destructive">{error}</p>
          ) : docs.length === 0 && !loading ? (
            query ? (
              <p className="px-2 py-3 text-micro text-muted-foreground">没有匹配「{query}」的文档</p>
            ) : (
              <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                <FilePlus2 className="h-5 w-5 text-muted-foreground/60" />
                <p className="text-micro leading-relaxed text-muted-foreground">
                  notes 数据库为空
                  <br />
                  把 markdown 放入 <span className="font-mono text-foreground/80">docs/notes/</span> 后点击刷新
                </p>
              </div>
            )
          ) : null}

          {groups.map((group) => {
            const depth = group.folder ? group.folder.split('/').length - 1 : 0
            const isCollapsed = collapsedFolders[group.folder] ?? false
            return (
              <div key={group.folder || '__root__'} className="flex flex-col">
                {hasSubFolders ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedFolders((prev) => ({ ...prev, [group.folder]: !isCollapsed }))
                    }
                    style={{ paddingLeft: 2 + depth * 12 }}
                    aria-expanded={!isCollapsed}
                    className="mt-1 flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 transition-colors hover:bg-black/[0.05]"
                  >
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform duration-200',
                        !isCollapsed && 'rotate-90',
                      )}
                    />
                    <Folder className="h-3 w-3 shrink-0 text-amber-600/80" />
                    <span className="min-w-0 flex-1 truncate font-mono text-micro font-medium text-muted-foreground">
                      {group.folder || '根目录'}
                    </span>
                    <Badge tone="muted">{group.docs.length}</Badge>
                  </button>
                ) : null}
                {isCollapsed ? null : group.docs.map(renderDoc)}
              </div>
            )
          })}

          {docs.length > 0 && query ? (
            <div className="flex items-center gap-1.5 px-2 py-3 text-micro text-muted-foreground">
              <BookOpen className="h-3 w-3" />
              关键词「{query}」匹配 {docs.length} 篇
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <Separator />
      <div className="shrink-0 px-3.5 py-2.5">
        <p className="text-micro leading-relaxed text-muted-foreground">
          {canAddRef ? (
            <>
              选中节点后<strong className="text-foreground/85">点击文档</strong>或
              <strong className="text-foreground/85">拖到节点上</strong>即可添加引用
            </>
          ) : (
            <>先在画布中选中一个节点，才能为它添加引用</>
          )}
        </p>
        <p className="mt-1 truncate font-mono text-micro text-muted-foreground/50" title={mdDir}>
          {mdDir}
        </p>
      </div>
    </aside>
  )
}
