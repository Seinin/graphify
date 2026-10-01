import { cn } from '../lib/utils'
import { Tooltip } from './ui/tooltip'

export interface ResizeHandleProps {
  /** 手柄所服务的面板类型，仅用于无障碍文案 */
  label: string
  /** 是否正在拖拽：高亮反馈 */
  dragging?: boolean
  /** 面板已收起：手柄贴到细条上，视觉弱化 */
  collapsed?: boolean
  /** 键盘/指针事件由 usePanelWidth 的 handleProps 提供 */
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
}

/**
 * 竖直拖拽手柄：视觉上是一条贴在两栏内侧边缘的细线，hover / 拖拽 / 聚焦时点亮。
 * 键盘可达（←/→ 调整，Shift 加倍，Home/End 到极限，Enter 收起或展开，双击复位）。
 */
export function ResizeHandle({
  label,
  dragging = false,
  collapsed = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClick,
  onKeyDown,
}: ResizeHandleProps) {
  return (
    <Tooltip content={`拖拽调整${label}宽度 · 双击复位 · ←/→ 微调`}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`调整${label}宽度`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        className={cn(
          'group relative w-2 shrink-0 cursor-col-resize touch-none select-none rounded-full',
          'focus-visible:outline-none',
          collapsed && 'opacity-70',
        )}
      >
        <span
          className={cn(
            'absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full transition-all duration-150',
            'bg-black/[0.08] group-hover:bg-primary/70 group-focus-visible:bg-primary/80',
            dragging && 'w-0.5 bg-primary',
          )}
        />
      </div>
    </Tooltip>
  )
}
