import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import type { TabInfo } from '../state/graphStore'

/**
 * 子图标签栏：主图固定在最前且不可关闭；其余每个标签页对应一个模块的子图。
 * 单击切换；关闭激活标签后激活其左侧相邻标签（由 store 保证）。
 */
export function TabBar({
  tabs,
  activeTabId,
  onActivate,
  onClose,
}: {
  tabs: TabInfo[]
  activeTabId: string
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
}) {
  return (
    <div
      className="glass-panel flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto rounded-lg px-1.5 pt-1"
      role="tablist"
      aria-label="子图标签页"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const closable = tab.id !== 'main'
        return (
          <span
            key={tab.id}
            className={cn(
              'group flex h-7 max-w-[220px] shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2.5 text-micro transition-colors',
              active
                ? 'border-black/[0.09] bg-background font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-black/[0.05] hover:text-foreground/85',
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={tab.label}
              onClick={() => onActivate(tab.id)}
              className="min-w-0 cursor-pointer truncate"
            >
              {tab.label}
            </button>
            {closable ? (
              <button
                type="button"
                aria-label={`关闭 ${tab.label}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.id)
                }}
                className={cn(
                  'flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-black/10',
                  active ? 'text-muted-foreground' : 'text-transparent group-hover:text-muted-foreground',
                )}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}
