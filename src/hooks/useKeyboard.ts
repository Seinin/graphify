import { useEffect } from 'react'

export interface KeyboardActions {
  onUndo?: () => void
  onRedo?: () => void
  onDelete?: () => void
  onEscape?: () => void
  onSave?: () => void
  onFocusSearch?: () => void
  onRelayout?: () => void
  onFit?: () => void
  onNewNode?: () => void
  onToggleConnect?: () => void
  onToggleHelp?: () => void
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}

/** 全局快捷键：撤销/重做、删除、保存、搜索、布局与新建 */
export function useKeyboard(actions: KeyboardActions) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      const typing = isTypingTarget(event.target)

      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault()
        actions.onSave?.()
        return
      }

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) actions.onRedo?.()
        else actions.onUndo?.()
        return
      }

      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        actions.onRedo?.()
        return
      }

      if (typing) {
        if (event.key === 'Escape') actions.onEscape?.()
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        actions.onDelete?.()
        return
      }

      if (event.key === 'Escape') {
        actions.onEscape?.()
        return
      }

      if (event.key === '/') {
        event.preventDefault()
        actions.onFocusSearch?.()
        return
      }

      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        actions.onToggleHelp?.()
        return
      }

      if (event.key.toLowerCase() === 'n') {
        actions.onNewNode?.()
        return
      }

      if (event.key.toLowerCase() === 'c') {
        actions.onToggleConnect?.()
        return
      }

      if (event.key.toLowerCase() === 'l') {
        actions.onRelayout?.()
        return
      }

      if (event.key.toLowerCase() === 'f') {
        actions.onFit?.()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [actions])
}
