import { createRoot } from 'react-dom/client'
import { Toaster, toast } from 'sonner'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './index.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('未找到 #root 挂载节点')
}

/* ------------- 全局兜底：未捕获的错误不再只是控制台里的一行 ------------- */
// 同一消息短时间内只提示一次，最多跟踪 MAX_REPORT_KEYS 条：持续抛错的循环不会把提示刷屏。
const reportedAt = new Map<string, number>()
const REPORT_COOLDOWN = 8000
const MAX_REPORT_KEYS = 12

function reportRuntimeError(title: string, detail: string) {
  const key = `${title}|${detail}`.slice(0, 200)
  const now = Date.now()
  const last = reportedAt.get(key)
  if (last !== undefined && now - last < REPORT_COOLDOWN) return
  if (reportedAt.size >= MAX_REPORT_KEYS) reportedAt.clear()
  reportedAt.set(key, now)
  // 用固定 id 让同一类错误只占一条提示，而不是叠成一列
  toast.error(title, { id: `runtime-error:${key}`, description: detail || undefined, duration: 8000 })
}

// 资源加载失败（script / link）：错误事件落在元素上，必须用捕获阶段才拿得到
window.addEventListener(
  'error',
  (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const source = target.getAttribute('src') || target.getAttribute('href') || '(未知地址)'
    reportRuntimeError('前端资源加载失败', `${target.tagName.toLowerCase()} ${source}`)
  },
  true,
)

window.addEventListener('error', (event) => {
  if (!event.message) return
  const where = event.filename ? `（${event.filename}:${event.lineno}:${event.colno}）` : ''
  reportRuntimeError('页面出现未捕获错误', `${event.message}${where}`)
})

window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  const detail = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
  reportRuntimeError('未处理的异步错误', detail)
})

// 说明：这里不使用 StrictMode —— Cytoscape 实例是命令式资源，
// 开发期的双次挂载会带来重复的布局与事件绑定，影响交互稳定性。
createRoot(container).render(
  <>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <Toaster
      position="bottom-right"
      theme="light"
      closeButton
      duration={4200}
      toastOptions={{
        style: {
          background: 'rgba(255, 255, 255, 0.96)',
          border: '1px solid rgba(15, 23, 42, 0.1)',
          color: '#1F2430',
          fontSize: '12.5px',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 18px 48px -22px rgba(15, 23, 42, 0.22)',
        },
      }}
    />
  </>,
)
