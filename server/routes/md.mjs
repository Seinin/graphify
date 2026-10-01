import { Router } from 'express'
import { listDocs, readDoc, invalidateMdCache } from '../lib/mdIndex.mjs'
import { MD_DIR } from '../lib/paths.mjs'

export const mdRouter = Router()

/** GET /api/md —— notes 数据库列表（含标题大纲与统计） */
mdRouter.get('/', (req, res, next) => {
  const force = req.query.force === '1' || req.query.force === 'true'
  listDocs({ force })
    .then((docs) =>
      res.json({
        mdDir: MD_DIR,
        count: docs.length,
        totalChars: docs.reduce((sum, doc) => sum + doc.chars, 0),
        fetchedAt: new Date().toISOString(),
        docs,
      }),
    )
    .catch(next)
})

/** GET /api/md/content?docId=xxx —— 读取文档原文与大纲 */
mdRouter.get('/content', (req, res, next) => {
  const docId = req.query.docId
  if (!docId) {
    res.status(400).json({ error: '缺少 docId 参数' })
    return
  }
  readDoc(String(docId))
    .then((doc) => res.json({ doc }))
    .catch(next)
})

/** POST /api/md/refresh —— 强制重新扫描 notes 目录 */
mdRouter.post('/refresh', (_req, res, next) => {
  invalidateMdCache()
  listDocs({ force: true })
    .then((docs) => res.json({ docs, count: docs.length, refreshedAt: new Date().toISOString() }))
    .catch(next)
})
