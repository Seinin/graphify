import type { HTMLAttributes } from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from '../../lib/utils'

type BadgeTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'muted'

const toneStyles: Record<BadgeTone, string> = {
  default: 'border-black/10 bg-black/[0.05] text-foreground/85',
  primary: 'border-primary/35 bg-primary/15 text-primary',
  success: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-600',
  warning: 'border-amber-500/30 bg-amber-500/12 text-amber-600',
  danger: 'border-red-500/30 bg-red-500/12 text-red-600',
  muted: 'border-black/[0.07] bg-black/[0.03] text-muted-foreground',
}

export function Badge({
  tone = 'default',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-micro font-medium leading-4',
        toneStyles[tone],
        className,
      )}
      {...props}
    />
  )
}

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        'shrink-0 bg-black/[0.06]',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}

/** 带色点的小标签，用于展示节点/关系的类型 */
export function DotBadge({
  color,
  children,
  className,
}: {
  color: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.04] px-2 py-[2px] text-micro text-foreground/85',
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
      {children}
    </span>
  )
}
