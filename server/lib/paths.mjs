import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 项目根目录（server/lib -> 项目根） */
export const ROOT_DIR = path.resolve(here, '..', '..')

/**
 * notes 数据库目录。
 * 默认指向仓库根下的 docs/notes（引用而非复制：文档被增删改后点刷新即可同步，
 * 且不会产生第二份副本）。可用 GRAPHIFY_MD_DIR 覆盖为任意目录。
 */
export const MD_DIR = process.env.GRAPHIFY_MD_DIR
  ? path.resolve(process.env.GRAPHIFY_MD_DIR)
  : path.resolve(ROOT_DIR, '..', 'docs', 'notes')

/**
 * 图谱数据目录。
 * 默认是项目根的 data/；可用 GRAPHIFY_DATA_DIR 覆盖——断言脚本据此在临时目录里跑，
 * 不污染真实图谱与历史（见 scripts/check-store.mjs）。
 */
export const DATA_DIR = process.env.GRAPHIFY_DATA_DIR
  ? path.resolve(process.env.GRAPHIFY_DATA_DIR)
  : path.join(ROOT_DIR, 'data')

/** 图谱主文件 */
export const GRAPH_FILE = path.join(DATA_DIR, 'graph.json')

/**
 * 物理链页的手动摆放（工作文件）：`{ 节点 id: { x, y } }`。
 * 与画布的工作文件分开——物理链的摆放与那张图无关（见 `lib/chainLayout.mjs`）。
 */
export const CHAIN_LAYOUT_FILE = path.join(DATA_DIR, 'chain-layout.json')

/** 自动快照目录 */
export const HISTORY_DIR = path.join(DATA_DIR, 'history')

/** 前端构建产物目录 */
export const DIST_DIR = path.join(ROOT_DIR, 'dist')

/** 快照保留上限（超出后从最旧开始滚动清理） */
export const SNAPSHOT_LIMIT = Number(process.env.GRAPHIFY_SNAPSHOT_LIMIT || 50)

/**
 * 单次 JSON 请求体上限。默认 8mb；节点数放开后若「一次导入」的体积仍不够，调大它
 * （例如 GRAPHIFY_JSON_BODY_LIMIT=64mb）。注意这里必须是有限值——express 没有「不限」。
 */
export const JSON_BODY_LIMIT = process.env.GRAPHIFY_JSON_BODY_LIMIT?.trim() || '8mb'

/**
 * 数量上限开关：节点数 / 边数。
 *
 * 返回值有三态：
 *   · undefined —— 未设置：各校验点保留自己的原默认（导入草案 2000 / 6000，落盘图 5000 / 20000）
 *   · null      —— 明确关掉上限（**不设上限**）
 *   · 正整数    —— 统一改用该数字（上述两处都采用）
 *
 * 之所以用 null 而不是 Infinity：zod 的 `.max()` 表达不了「无穷」，
 * 「关掉上限」只能等价于「根本不写 .max()」，见 schema.mjs 的 cappedArray()。
 */
const UNLIMITED_TOKENS = new Set(['0', 'none', 'off', 'unlimited', 'inf', 'infinity', '-1', '∞'])

function readLimit(raw) {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!text) return undefined
  if (UNLIMITED_TOKENS.has(text)) return null
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

/** 节点数上限开关：GRAPHIFY_MAX_NODES */
export const MAX_NODES = readLimit(process.env.GRAPHIFY_MAX_NODES)

/** 边数上限开关：GRAPHIFY_MAX_EDGES */
export const MAX_EDGES = readLimit(process.env.GRAPHIFY_MAX_EDGES)

/** 允许纳入 notes 数据库的扩展名 */
export const MD_EXTENSIONS = new Set(['.md', '.markdown'])

/**
 * 源码索引根目录。默认是整个仓库根（`Graphify/..`），因为要被索引的代码
 * （src/ 下的 C 与 Python、scripts/、tests/）本来就散落在仓库各处；
 * 想收窄范围时用 GRAPHIFY_CODE_DIR 覆盖。
 */
export const CODE_DIR = process.env.GRAPHIFY_CODE_DIR
  ? path.resolve(process.env.GRAPHIFY_CODE_DIR)
  : path.resolve(ROOT_DIR, '..')

/** 源码索引允许的扩展名（只列代码，不把 data/ 与构建产物卷进来） */
export const CODE_EXTENSIONS = new Set([
  '.c',
  '.h',
  '.py',
  '.mjs',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.sh',
  '.cu',
  '.cpp',
  '.cc',
  '.hpp',
  '.f90',
  '.toml',
  '.ipynb',
])

/** 源码索引跳过的目录名（构建产物、依赖、缓存、数据与版本库） */
export const CODE_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'data',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.vite',
  '.ipynb_checkpoints',
  'legacy',
])

/**
 * 按「相对仓库根的路径」跳过的目录。与 CODE_SKIP_DIRS 的区别是这里按整条路径判定，
 * 因此可以只排掉某一个同名的目录：
 *   · `py21cmfast` —— 仓库根的构建镜像（.gitignore 第 79 行 `/py21cmfast/`），
 *     里面的 C 与 Python 是 src/py21cmfast/ 的副本，一并索引会让每个文件都出现两份；
 *     src/py21cmfast/ 才是真正的那一份，不能被误伤。
 */
export const CODE_SKIP_PATHS = new Set(['py21cmfast'])

/** 源码索引的节点数上限（防止把整个大仓库塞进选择器） */
export const CODE_MAX_FILES = Number(process.env.GRAPHIFY_CODE_MAX_FILES || 4000)

/** 单次预览最多返回的行数 */
export const CODE_MAX_WINDOW_LINES = Number(process.env.GRAPHIFY_CODE_MAX_LINES || 400)

/**
 * 按段浏览的行数阈值：超过它算「大文件」，预览**仍可按段读完**，但界面要说明
 * 「这是按段加载，完整阅读建议在编辑器里打开」。
 *
 * 与 CODE_MAX_WINDOW_LINES 的分工：后者是单次响应的硬上限（超过就夹紧），
 * 这个阈值只决定要不要给用户一句解释——静默地只给一小段才是要避免的。
 */
export const CODE_LARGE_FILE_LINES = Number(process.env.GRAPHIFY_CODE_LARGE_LINES || 3000)

/** 允许预览的单文件大小上限（字节）：超过则只返回前若干行并给出提示 */
export const CODE_MAX_FILE_BYTES = Number(process.env.GRAPHIFY_CODE_MAX_BYTES || 2_000_000)
