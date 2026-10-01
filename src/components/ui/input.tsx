import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '../../lib/utils'

const fieldBase =
  'w-full rounded-md border border-black/10 bg-black/[0.03] text-tiny text-foreground outline-none transition-colors duration-150 placeholder:text-muted-foreground/70 hover:border-black/20 focus:border-primary/70 focus:bg-black/[0.04] focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-55'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, 'h-8 px-2.5', className)} {...props} />
  ),
)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, 'min-h-[64px] resize-y px-2.5 py-2 leading-relaxed', className)} {...props} />
  ),
)
Textarea.displayName = 'Textarea'

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('flex items-center gap-1.5 text-micro font-medium text-muted-foreground select-none', className)}
    {...props}
  />
))
Label.displayName = 'Label'

/**
 * 字段外壳：统一标签、提示与错误文案的排版。
 *
 * **`plain` 用在「内容里有多个可交互控件」的字段上**（如标签 chip 列表、按钮组）。
 * 默认外壳是 `<label>`，而 HTML 里点 `<label>` 会**激活它内部第一个可聚焦控件**——
 * 标签 chip 的叉号正好是那个「第一个控件」，于是点标签名字也会把标签删掉，
 * 表现就是「叉号范围大得整个标签都能触发」。`plain` 时外壳退成 `<div>`，不再有这种转发。
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  plain,
}: {
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
  className?: string
  /** 内容里有多个可交互控件时置 true：外壳用 div，避免 label 的点击转发 */
  plain?: boolean
}) {
  const Wrapper = plain ? 'div' : 'label'
  return (
    <Wrapper className={cn('flex flex-col gap-1.5', className)}>
      <span className="flex items-baseline justify-between gap-2">
        <Label asChild>
          <span className="text-micro font-medium text-muted-foreground">{label}</span>
        </Label>
        {hint ? <span className="text-micro text-muted-foreground/60">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="animate-shake text-micro text-destructive">{error}</span> : null}
    </Wrapper>
  )
}
