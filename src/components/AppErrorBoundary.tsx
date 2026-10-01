import { Component, type ErrorInfo, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Copy, RotateCw } from 'lucide-react'
import { Button } from './ui/button'

/** index.html 里的启动看门狗据此判断「应用是否已接管界面」 */
const BOOT_PLACEHOLDER_SELECTOR = '[data-boot-placeholder]'

/**
 * 标记应用已经成功接管界面：清掉启动占位并打上 data 标记，
 * 若不标记，index.html 的看门狗会在超时后把画面替换成「资源加载失败」的诊断。
 */
function markAppMounted() {
  const root = document.getElementById('root')
  if (!root) return
  root.querySelector(BOOT_PLACEHOLDER_SELECTOR)?.remove()
  root.dataset.appMounted = 'true'
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(typeof error === 'string' ? error : String(error))
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string
}

/**
 * 界面级兜底：渲染期或副作用期抛错时不再留下「无声白屏」，而是给出可读诊断与恢复入口。
 * 只包住 App —— Toaster 留在外层，保证界面报错时提示条依然可用。
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: normalizeError(error) }
  }

  componentDidMount() {
    markAppMounted()
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // 诊断面板马上就会渲染出来，先解除看门狗，避免它把面板再替换一次
    markAppMounted()
    this.setState({ componentStack: info.componentStack ?? '' })
    console.error('[Graphify] 界面渲染异常：', error, info.componentStack)
  }

  private diagnosis() {
    const { error, componentStack } = this.state
    if (!error) return ''
    return [
      `${error.name}: ${error.message}`,
      error.stack ? `\n堆栈：\n${error.stack}` : '',
      componentStack ? `\n组件栈：${componentStack}` : '',
    ].join('')
  }

  private copyDiagnosis = async () => {
    try {
      await navigator.clipboard.writeText(this.diagnosis())
      toast.success('错误信息已复制')
    } catch (error) {
      console.error('[Graphify] 复制错误信息失败：', error)
      toast.error('复制失败，请手动选中文本复制')
    }
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full min-h-screen items-center justify-center overflow-y-auto bg-background p-6">
        <div className="glass-panel w-full max-w-2xl rounded-lg p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h1 className="text-subhead font-semibold text-foreground">界面未能渲染</h1>
          </div>

          <p className="mt-2 text-tiny text-muted-foreground">
            页面在渲染时抛出了异常，已在此停住以免继续出错。刷新即可重试；磁盘上的图谱数据不会因此被改动。
          </p>

          <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-black/10 bg-black/[0.05] p-3 font-mono text-micro text-destructive">
            {error.name}: {error.message}
          </pre>

          <details className="mt-3 text-tiny text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">技术细节（堆栈）</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-black/10 bg-black/[0.05] p-3 font-mono text-micro text-muted-foreground">
              {error.stack || '（无堆栈）'}
              {componentStack ? `\n\n组件栈：${componentStack}` : ''}
            </pre>
          </details>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => window.location.reload()}>
              <RotateCw className="h-3.5 w-3.5" />
              重新加载
            </Button>
            <Button variant="secondary" onClick={this.copyDiagnosis}>
              <Copy className="h-3.5 w-3.5" />
              复制错误信息
            </Button>
          </div>

          <p className="mt-4 text-micro text-muted-foreground">
            若反复出现：先看浏览器控制台的第一条报错；开发环境下可在{' '}
            <code className="font-mono text-foreground/80">Graphify/</code> 目录重启开发服务（停掉{' '}
            <code className="font-mono text-foreground/80">node server/index.mjs</code>，删除{' '}
            <code className="font-mono text-foreground/80">node_modules/.vite</code> 后重新{' '}
            <code className="font-mono text-foreground/80">npm run dev</code>），再硬刷新页面。
          </p>
        </div>
      </div>
    )
  }
}
