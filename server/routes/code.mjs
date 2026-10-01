import { Router } from 'express'
import { invalidateCodeCache, listCodeFiles, readCodeWindow } from '../lib/codeIndex.mjs'
import { CODE_DIR } from '../lib/paths.mjs'

export const codeRouter = Router()

/**
 * GET /api/code —— 源码索引列表（路径 / 语言 / 大小）。
 * 供「源码引用选择器」做文件搜索，也是 /api/code/content 之外唯一的读接口。
 * `q` 可选：按路径子串过滤（大小写不敏感），避免把上千个文件全塞给前端。
 */
codeRouter.get('/', (req, res, next) => {
  const force = req.query.force === '1' || req.query.force === 'true'
  const query = String(req.query.q ?? '').trim().toLowerCase()
  const limit = Math.max(1, Math.min(2000, Number(req.query.limit) || 400))
  listCodeFiles({ force })
    .then((files) => {
      const matched = query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files
      res.json({
        codeDir: CODE_DIR,
        count: files.length,
        matched: matched.length,
        fetchedAt: new Date().toISOString(),
        files: matched.slice(0, limit),
      })
    })
    .catch(next)
})

/**
 * GET /api/code/content —— 读一段行窗口。
 *
 * 两种取法，互不影响：
 *   · 默认（`start` / `end` + `context`）：`start` / `end` 是要**高亮**的区间（1 起、含两端），
 *     返回窗口 = 该区间 ± `context`。预览抽屉打开一个引用时用它。
 *   · `mode=range` + `from` / `to`：`from` / `to` 是要**取**的行区间本身（1 起、含两端，
 *     不叠加 `context`），`start` / `end` 仍是要高亮的引用区间，高亮取它与本段的交集。
 *     按段连续浏览整个文件时用它。两种取法都受单次行数上限夹紧。
 *
 * 例：GET /api/code/content?file=src/foo.c&mode=range&from=301&to=600&start=536&end=545
 */
codeRouter.get('/content', (req, res, next) => {
  const file = req.query.file
  if (!file) {
    res.status(400).json({ error: '缺少 file 参数' })
    return
  }
  const toNumber = (value) => {
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  }
  readCodeWindow(String(file), {
    start: toNumber(req.query.start),
    end: toNumber(req.query.end),
    context: toNumber(req.query.context) ?? 6,
    // 只认显式的 mode=range，其余一律走默认取法（旧调用方的参数一个都没变）
    mode: req.query.mode === 'range' ? 'range' : 'highlight',
    from: toNumber(req.query.from),
    to: toNumber(req.query.to),
  })
    .then((window) => res.json({ window }))
    .catch(next)
})

/** POST /api/code/refresh —— 强制重新扫描源码目录 */
codeRouter.post('/refresh', (_req, res, next) => {
  invalidateCodeCache()
  listCodeFiles({ force: true })
    .then((files) => res.json({ count: files.length, refreshedAt: new Date().toISOString() }))
    .catch(next)
})
