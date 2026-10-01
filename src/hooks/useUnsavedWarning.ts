import { useEffect } from 'react'
import { useGraphStore } from '../state/graphStore'

/**
 * 有未保存改动时，关闭标签页 / 刷新浏览器先弹一次**浏览器原生**确认。
 *
 * 为什么用原生 `beforeunload`：它是唯一无法被忽略、且零 UI 成本的离开拦截——
 * 自己画弹窗需要额外的对话框与状态，而这里只需要"别悄悄丢掉改动"。
 *
 * 为什么需要它：自动保存取消后，本机改动（拖拽坐标、自动重排、撤销/重做）不再落盘，
 * 忘了保存就会丢。只有真的脏了才挂监听，干净状态下刷新不受打扰。
 */
export function useUnsavedWarning() {
  const dirty = useGraphStore((state) => state.dirty)

  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // 兼容老实现：部分浏览器要靠 returnValue 非空才弹确认
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}
