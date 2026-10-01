import { AlertTriangle } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

export interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  /** 删除类操作使用更醒目的危险色 */
  danger?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({
  state,
  onOpenChange,
}: {
  state: ConfirmState | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        {state ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span
                  className={
                    state.danger
                      ? 'flex h-5 w-5 items-center justify-center rounded-full bg-destructive/15 text-destructive'
                      : 'flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary'
                  }
                >
                  <AlertTriangle className="h-3 w-3" />
                </span>
                {state.title}
              </DialogTitle>
              <DialogDescription>{state.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                variant={state.danger ? 'danger' : 'default'}
                onClick={() => {
                  state.onConfirm()
                  onOpenChange(false)
                }}
              >
                {state.confirmLabel}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
