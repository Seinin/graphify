import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-tiny font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-45 active:scale-[0.97] select-none',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[0_6px_20px_-8px_hsl(var(--primary)/0.9)] hover:bg-primary/90 hover:shadow-[0_10px_28px_-10px_hsl(var(--primary)/1)]',
        secondary: 'border border-black/10 bg-black/[0.04] text-foreground hover:bg-black/[0.06] hover:border-black/20',
        ghost: 'text-muted-foreground hover:bg-black/[0.05] hover:text-foreground',
        outline: 'border border-black/10 bg-transparent text-foreground hover:bg-black/[0.05]',
        danger: 'bg-destructive/90 text-destructive-foreground hover:bg-destructive',
        'danger-ghost': 'text-destructive/90 hover:bg-destructive/12 hover:text-destructive',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-micro',
        lg: 'h-9 px-4 text-subhead',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7 px-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
