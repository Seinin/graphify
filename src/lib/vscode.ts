/**
 * 生成 VS Code 跳转链接。
 *
 * 默认使用 `vscode://file/<绝对路径>:<行号>`；
 * 若在远程（Remote-WSL / SSH）场景下需要自定义协议或路径前缀，
 * 可通过环境变量覆盖：
 *   VITE_VSCODE_URI_TEMPLATE = "vscode://vscode-remote/wsl+Ubuntu{path}:{line}"
 *   VITE_VSCODE_PATH_PREFIX  = "/home/dministrat"
 */
const URI_TEMPLATE = import.meta.env.VITE_VSCODE_URI_TEMPLATE as string | undefined
const PATH_PREFIX = import.meta.env.VITE_VSCODE_PATH_PREFIX as string | undefined

export interface VscodeOpenResult {
  ok: boolean
  url: string
  reason?: string
}

function encodeAbsolutePath(absolutePath: string) {
  const normalized = String(absolutePath || '')
    .replace(/\\/g, '/')
    .trim()
  const prefixed = PATH_PREFIX && !normalized.startsWith(PATH_PREFIX) ? `${PATH_PREFIX}${normalized}` : normalized
  return prefixed
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function buildVscodeUrl(absolutePath: string, line?: number) {
  const path = encodeAbsolutePath(absolutePath)
  const lineSuffix = line && line > 0 ? `:${line}` : ''
  if (URI_TEMPLATE) {
    return URI_TEMPLATE.replace('{path}', path).replace('{line}', String(line ?? 1))
  }
  return `vscode://file/${path}${lineSuffix}`
}

/**
 * 尝试用 VS Code 打开文件。浏览器无法感知协议是否被注册，
 * 因此这里给出「可能失败」的判定依据，由调用方决定是否提示复制路径。
 */
export function openInVscode(absolutePath: string, line?: number): VscodeOpenResult {
  if (!absolutePath) {
    return { ok: false, url: '', reason: '缺少文件绝对路径' }
  }

  const url = buildVscodeUrl(absolutePath, line)
  const opened = window.open(url, '_self')

  if (opened === null) {
    return { ok: false, url, reason: '浏览器阻止了协议跳转，请检查 VS Code 是否已安装' }
  }
  return { ok: true, url }
}

/** 复制文本到剪贴板（VS Code 打开失败时的兜底手段） */
export function copyText(text: string) {
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch((err: unknown) => {
      console.error('[graphify] 复制失败：', err)
      return false
    })
}

/** 判断当前环境是否可能注册了 vscode:// 协议（浏览器无法可靠探测，仅做粗略估计） */
export function vscodeLikelyAvailable() {
  return typeof window !== 'undefined' && !/iPhone|iPad|Android/i.test(navigator.userAgent)
}
