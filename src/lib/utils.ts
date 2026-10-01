import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合并 Tailwind 类名，后写的同类工具类覆盖先写的 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 生成短随机 id（前端乐观创建时使用，服务端会重新分配） */
export function localId(prefix: string) {
  const random = Math.random().toString(16).slice(2, 12)
  return `${prefix}_${random}`
}

/** 相对时间：刚刚 / 3 分钟前 / 2 小时前 / 日期 */
export function relativeTime(iso: string, now = Date.now()) {
  if (!iso) return '—'
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return '—'
  const diff = Math.max(0, now - time)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < 5_000) return '刚刚'
  if (diff < minute) return `${Math.floor(diff / 1000)} 秒前`
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatChars(count: number) {
  if (count < 1000) return `${count} 字`
  return `${(count / 1000).toFixed(1)}k 字`
}

/** 截断长文本 */
export function truncate(value: string, max = 60) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 判断字符串是否像 http(s) 链接 */
export function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

/** 去抖：wait 毫秒内的重复调用只保留最后一次 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  return wrapped
}
