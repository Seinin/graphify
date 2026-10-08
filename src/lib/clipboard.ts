/**
 * 剪贴板工具。
 *
 * notes 阅读器与源码预览抽屉共用它做「复制」出口：复制的是「路径:行」，
 * 粘到编辑器里就能直达那一处，不依赖任何协议唤起。
 */
export function copyText(text: string) {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch((err: unknown) => {
      console.error('[graphify] 复制失败：', err)
      return false
    })
}
