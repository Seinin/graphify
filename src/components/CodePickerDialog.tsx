import { useEffect, useMemo, useState } from 'react'
import { FileCode, Loader2, RefreshCw, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Field, Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { CodeSnippet } from './CodeSnippet'
import { useCodeLibrary, useCodeWindow } from '../hooks/useCodeLibrary'
import { cn } from '../lib/utils'
import type { GraphRef } from '../lib/types'

/** 文件大小：列表里的辅助信息，字节 → 人类可读（不引第三方格式化库） */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 源码引用选择器：选文件 → 填行区间 → 预览 → 挂到节点上。
 *
 * 与 md 引用（点左侧文档即加）的区别是源码需要两个额外信息：**哪个文件**与**哪几行**。
 * 因此这里是一个小对话框而不是一次点击：左侧搜文件、右侧直接看这段代码长什么样，
 * 确认无误再挂——把「引用错行」这种低级错误挡在提交之前。
 */
interface CodePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 引用要挂到的节点名（标题里写清楚，避免挂错节点） */
  targetLabel?: string
  onPick: (ref: GraphRef) => void
}

export function CodePickerDialog({ open, onOpenChange, targetLabel, onPick }: CodePickerDialogProps) {
  // 只有对话框打开时才拉列表：不开就不该为它扫描一遍仓库
  const library = useCodeLibrary({ enabled: open })
  const [selected, setSelected] = useState<string | null>(null)
  const [start, setStart] = useState(1)
  const [end, setEnd] = useState(1)

  // 每次打开都重置选择：上一次的文件不该在下一次打开时还留着
  useEffect(() => {
    if (!open) return
    setSelected(null)
    setStart(1)
    setEnd(1)
    library.setQuery('')
    // library.setQuery 是稳定引用，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const { window: preview, loading: previewLoading, error: previewError } = useCodeWindow(
    open ? selected : null,
    start,
    end,
    6,
  )

  const files = library.filtered
  const totalLabel = useMemo(() => {
    if (library.loading) return '正在扫描…'
    if (library.query.trim()) return `${files.length} / ${library.files.length} 个文件`
    return `${library.files.length} 个文件`
  }, [files.length, library.files.length, library.loading, library.query])

  const confirm = () => {
    if (!selected) return
    const from = Math.max(1, Number(start) || 1)
    const to = Math.max(from, Number(end) || from)
    onPick({
      docId: '',
      anchor: '',
      label: to > from ? `${selected}:${from}-${to}` : `${selected}:${from}`,
      file: selected,
      line: from,
      endLine: to,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 固定高度：内部两栏都是 flex + 滚动区，不给定高就撑不出可滚动的列表与预览 */}
      <DialogContent className="!max-w-[900px] h-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-cyan-700" />
            添加源码引用
          </DialogTitle>
          <DialogDescription>
            {targetLabel ? `挂到节点「${targetLabel}」：` : ''}
            选一个文件并填行区间，右侧会预览这几行。索引根目录：<span className="font-mono">{library.codeDir || '—'}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-3">
          {/* 左：文件搜索与列表 */}
          <div className="flex w-[286px] shrink-0 flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                value={library.query}
                onChange={(event) => library.setQuery(event.target.value)}
                placeholder="按路径搜索，如 thermochem.c"
                className="pl-8"
              />
            </div>
            <div className="flex items-center justify-between text-micro text-muted-foreground">
              <span>{totalLabel}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => library.refresh(true)} title="重新扫描源码目录">
                <RefreshCw className={cn('h-3 w-3', library.loading && 'animate-spin')} />
              </Button>
            </div>
            <ScrollArea className="min-h-[220px] flex-1 rounded-md border border-black/[0.07]" viewportClassName="p-1">
              {library.error ? (
                <p className="p-2 text-micro text-destructive">{library.error}</p>
              ) : files.length === 0 ? (
                <p className="p-2 text-micro text-muted-foreground">
                  {library.loading ? '正在扫描源码目录…' : '没有匹配的文件'}
                </p>
              ) : (
                files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => {
                      setSelected(file.path)
                      setStart(1)
                      setEnd(1)
                    }}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-micro transition-colors',
                      selected === file.path
                        ? 'bg-primary/12 text-primary'
                        : 'text-foreground/85 hover:bg-black/[0.05]',
                    )}
                    title={file.path}
                  >
                    <span className="min-w-0 truncate font-mono">{file.path}</span>
                    <span className="shrink-0 text-muted-foreground/70">{formatBytes(file.size)}</span>
                  </button>
                ))
              )}
            </ScrollArea>
          </div>

          {/* 右：行区间与预览 */}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="grid grid-cols-2 items-end gap-3">
              <Field label="起始行" hint="1 起">
                <Input
                  type="number"
                  min={1}
                  value={start}
                  onChange={(event) => setStart(Number(event.target.value) || 1)}
                  disabled={!selected}
                />
              </Field>
              <Field label="结束行" hint="含该行">
                <Input
                  type="number"
                  min={1}
                  value={end}
                  onChange={(event) => setEnd(Number(event.target.value) || 1)}
                  disabled={!selected}
                />
              </Field>
            </div>

            <div className="min-h-[220px] flex-1 overflow-hidden rounded-md border border-black/[0.07] bg-white/60">
              {!selected ? (
                <p className="p-3 text-micro text-muted-foreground">从左侧选一个文件即可预览。</p>
              ) : previewLoading ? (
                <div className="flex items-center gap-2 p-3 text-micro text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在读取…
                </div>
              ) : previewError ? (
                <p className="p-3 text-micro text-destructive">{previewError}</p>
              ) : preview ? (
                <ScrollArea className="h-full" viewportClassName="px-1">
                  <CodeSnippet code={preview} compact />
                  {preview.clamped ? (
                    <p className="px-3 pb-3 text-micro text-amber-600">
                      区间已被夹到文件范围内（该文件共 {preview.totalLines} 行）
                    </p>
                  ) : null}
                </ScrollArea>
              ) : null}
            </div>

            {selected ? (
              <div className="flex items-center gap-1.5 text-micro text-muted-foreground">
                <Badge tone="muted">{preview?.language ?? '源码'}</Badge>
                <span className="truncate font-mono">
                  {selected}:{Math.max(1, Number(start) || 1)}
                  {Number(end) > Number(start) ? `-${Number(end)}` : ''}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="secondary" onClick={confirm} disabled={!selected}>
            添加引用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
