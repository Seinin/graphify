import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { History, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Badge, Separator } from './ui/badge'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'
import { ConfirmDialog, type ConfirmState } from './ConfirmDialog'
import { api } from '../api/client'
import { useGraphStore } from '../state/graphStore'
import { cn, formatBytes, relativeTime } from '../lib/utils'
import type { GraphVersion } from '../lib/types'

const REASON_LABELS: Record<string, string> = {
  'node:create': '新建节点',
  'node:update': '修改节点',
  'node:delete': '删除节点',
  'edge:create': '建立关系',
  'edge:update': '修改关系',
  'edge:delete': '取消关系',
  'node:positions': '调整坐标（手动保存）',
  'graph:rename': '改图谱名称',
  'graph:save-as': '另存为保留副本',
  'graph:import': 'LLM 导入',
  'graph:manual-save': '手动保存',
  'graph:replace': '整体替换',
  'cli:import': '命令行导入',
  // 历史遗留：下面这两个理由自「只能手动另存」起不再产生（自动保存与撤销落盘都已取消），
  // 标签保留只是为了让旧快照在面板里仍然读得懂。
  'graph:autosave': '自动保存（旧）',
  'history:undo': '撤销（旧）',
  'history:redo': '重做（旧）',
}

function reasonLabel(reason: string) {
  if (reason.startsWith('rollback:')) return '回滚快照'
  return REASON_LABELS[reason] ?? reason
}

interface HistoryPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRolledBack: () => void
}

export function HistoryPanel({ open, onOpenChange, onRolledBack }: HistoryPanelProps) {
  const [versions, setVersions] = useState<GraphVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [rollingBack, setRollingBack] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const loadGraph = useGraphStore((state) => state.loadGraph)

  const load = useCallback(() => {
    setLoading(true)
    api
      .listVersions()
      .then(({ versions: list }) => setVersions(list))
      .catch((err: Error) => toast.error('读取版本历史失败', { description: err.message }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const rollback = (version: GraphVersion) => {
    setRollingBack(version.id)
    api
      .rollbackVersion(version.id)
      .then(({ graph }) => {
        loadGraph(graph)
        toast.success('已回滚到所选快照', {
          description: '当前状态已自动存为一份新快照，可再次回滚回来',
        })
        onRolledBack()
        load()
      })
      .catch((err: Error) => toast.error('回滚失败', { description: err.message }))
      .finally(() => setRollingBack(null))
  }

  /**
   * 删除一份**保留副本**（手动另存出来的那份）。
   * 保留副本不参与轮转，所以必须给一个显式出口，否则会只增不减；自动快照不给删
   * （它们的生命周期由轮转上限管理，放开单删等于给"清空历史"开口子）。
   */
  const remove = (version: GraphVersion) => {
    setDeleting(version.id)
    api
      .deleteVersion(version.id)
      .then(() => {
        toast.success('已删除这份保留副本')
        load()
      })
      .catch((err: Error) => toast.error('删除副本失败', { description: err.message }))
      .finally(() => setDeleting(null))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" width="w-[460px]" className="gap-0 p-0">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            版本历史
          </SheetTitle>
          <SheetDescription>
            每次写入前都会自动留存一份快照（服务端最多保留 50 份）；手动保存产出的「保留副本」不参与轮转，可单独删除。
            回滚同样会先备份当前状态，因此可以反悔。
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between border-b border-black/[0.07] px-4 py-2">
          <Badge tone="muted">{versions.length} 份快照</Badge>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            刷新
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <ol className="flex flex-col gap-1.5 p-3">
            {versions.length === 0 && !loading ? (
              <li className="px-1 py-8 text-center text-micro text-muted-foreground">
                还没有快照。做一次改动（新建节点、改属性…）或按 Ctrl/Cmd + S 另存后就会生成。
              </li>
            ) : null}

            {versions.map((version, index) => (
              <li
                key={version.id}
                className={cn(
                  'group flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 transition-colors',
                  index === 0
                    ? 'border-primary/25 bg-primary/[0.07]'
                    : 'border-black/[0.07] bg-black/[0.03] hover:border-black/10',
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-micro font-medium text-foreground/90">
                      {reasonLabel(version.reason)}
                    </span>
                    {version.pinned ? <Badge tone="primary">保留</Badge> : null}
                    {index === 0 ? <Badge tone="muted">最新</Badge> : null}
                  </div>
                  <span className="mt-0.5 block truncate text-micro text-muted-foreground">
                    {relativeTime(version.savedAt)} · {version.nodes} 节点 / {version.edges} 关系 ·{' '}
                    {formatBytes(version.size)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={rollingBack !== null}
                    onClick={() => rollback(version)}
                  >
                    {rollingBack === version.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    回滚
                  </Button>
                  {version.pinned ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="删除这份保留副本"
                      disabled={deleting !== null}
                      onClick={() =>
                        setConfirm({
                          title: '删除这份保留副本？',
                          description: `${relativeTime(version.savedAt)} 的副本（${version.nodes} 节点 / ${version.edges} 关系）将从历史目录移除；自动快照不受影响。`,
                          confirmLabel: '删除',
                          danger: true,
                          onConfirm: () => remove(version),
                        })
                      }
                    >
                      {deleting === version.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      删除
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </ScrollArea>

        <Separator />
        <p className="shrink-0 px-4 py-3 text-micro leading-relaxed text-muted-foreground">
          快捷键 <kbd className="rounded bg-black/[0.06] px-1">Ctrl/Cmd + Z</kbd> 撤销、
          <kbd className="ml-1 rounded bg-black/[0.06] px-1">Ctrl/Cmd + Shift + Z</kbd> 重做，
          只作用于当前会话（不写盘）；要留存撤销后的状态，按
          <kbd className="ml-1 rounded bg-black/[0.06] px-1">Ctrl/Cmd + S</kbd> 另存一份保留副本。
        </p>
      </SheetContent>
      <ConfirmDialog
        state={confirm}
        onOpenChange={(next) => {
          if (!next) setConfirm(null)
        }}
      />
    </Sheet>
  )
}
