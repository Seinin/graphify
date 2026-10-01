import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '../../lib/utils'

/**
 * Radix 的 Viewport 内部会再包一层 `display:table` 的盒子把内容撑破（详见 index.css 顶部的全局覆盖），
 * 因此视口内的子元素需要自带 `min-w-0` 才能让 `truncate` 生效；调用方若要给纵向滚动条留出间距，
 * 通过 viewportClassName 追加右侧内边距（滚动条是绝对定位、会浮在内容之上）。
 */
export function ScrollArea({
  className,
  viewportClassName,
  viewportRef,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string
  /**
   * 可选：拿到**真正的滚动视口**（Radix 的 Viewport）的 DOM 引用。
   *
   * 需要监听 `scroll` 或读写 `scrollTop` / `scrollHeight` 的调用方用它——
   * 外层 Root 不是滚动容器（`overflow-hidden`），挂在它上面读不到这些东西。
   * 纯增量 prop：不传时行为与之前完全一致。
   */
  viewportRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        className={cn('h-full w-full rounded-[inherit]', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none select-none p-[2px] transition-opacity duration-200"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-black/[0.03] hover:bg-black/[0.03]" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
