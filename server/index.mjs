import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import { mdRouter } from './routes/md.mjs'
import { graphRouter } from './routes/graph.mjs'
import { codeRouter } from './routes/code.mjs'
import { chainLayoutRouter } from './routes/chainLayout.mjs'
import { CODE_DIR, DIST_DIR, JSON_BODY_LIMIT, MD_DIR, ROOT_DIR } from './lib/paths.mjs'

const HOST = process.env.HOST || '0.0.0.0'
const PORT = Number(process.env.PORT || 5178)
const IS_PROD = process.env.NODE_ENV === 'production'

/** 统一错误出口：把校验错误转成 400，其余按状态码兜底 */
function errorHandler(err, _req, res, _next) {
  const status = Number(err?.status) || (err?.name === 'ValidationError' ? 400 : 500)
  if (status >= 500) console.error('[graphify] 请求处理失败：', err)
  res.status(status).json({
    error: err?.message || '服务器内部错误',
    issues: Array.isArray(err?.issues) && err.issues.length ? err.issues : undefined,
  })
}

/** 组装 Express 应用：API 优先，随后交给 Vite 中间件或静态产物 */
export async function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: JSON_BODY_LIMIT }))

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      mode: IS_PROD ? 'production' : 'development',
      root: ROOT_DIR,
      mdDir: MD_DIR,
      codeDir: CODE_DIR,
      uptime: Math.round(process.uptime()),
    })
  })

  app.use('/api/md', mdRouter)
  app.use('/api/code', codeRouter)
  app.use('/api/graph', graphRouter)
  // 物理链页的手动摆放（`data/chain-layout.json`）：与画布那张图分开的一条通路
  app.use('/api/chain-layout', chainLayoutRouter)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '接口不存在' })
  })

  if (IS_PROD) {
    app.use(express.static(DIST_DIR, { index: false }))
    app.use((req, res, next) => {
      if (req.method !== 'GET') {
        next()
        return
      }
      /*
       * 带扩展名的请求一律当静态资源：没命中就是 404，不能吐首页。
       *
       * 构建产物带内容哈希，每次重新部署都会换名字。此前这里不分青红皂白把
       * 任何 GET 都回成 index.html，于是旧页面（重新部署前打开、尚未刷新的标签页）
       * 来要旧哈希的 `/assets/*.js`，拿到的是 `200` + 一页 HTML；浏览器把这页
       * HTML 当脚本执行，报 `SyntaxError: Unexpected token '<'`。症状是白屏，
       * 或者**只有按需加载的那部分打不开**（文档阅读器正是按需加载的 `markdown-*.js`），
       * 而已经加载过的主界面看着一切正常——很难和「服务挂了」区分开。
       */
      if (path.extname(req.path)) {
        res.status(404).type('txt').send('Not Found')
        return
      }
      res.sendFile(path.join(DIST_DIR, 'index.html'))
    })
  } else {
    const { createServer } = await import('vite')
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
  }

  app.use(errorHandler)
  return app
}

async function bootstrap() {
  await fs.mkdir(MD_DIR, { recursive: true })
  const app = await createApp()
  app.listen(PORT, HOST, () => {
    const shown = HOST === '0.0.0.0' ? 'localhost' : HOST
    console.log('')
    console.log('  Graphify · 知识图谱工作台')
    console.log(`  ▸ 服务已启动：http://${shown}:${PORT}`)
    console.log(`  ▸ 运行模式：${IS_PROD ? '生产（静态产物）' : '开发（Vite 中间件 + 热更新）'}`)
    console.log(`  ▸ notes 数据库：${MD_DIR}`)
    console.log(`  ▸ 源码索引根目录：${CODE_DIR}`)
    console.log(`  ▸ WSL 用户：若浏览器打不开，请改用 HOST=0.0.0.0 npm run dev 后重试`)
    console.log('')
  })
}

process.on('unhandledRejection', (reason) => {
  console.error('[graphify] 未处理的 Promise 拒绝：', reason)
})

bootstrap().catch((err) => {
  console.error('[graphify] 启动失败：', err)
  process.exitCode = 1
})
