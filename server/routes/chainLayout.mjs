/**
 * 物理链页手动摆放的读写口（`data/chain-layout.json`）。
 *
 * 只碰这一个文件：不写画布的工作文件、不进历史目录——这是这一页唯一的写通道，
 * 自检 `check:chain` 的「边界」一段钉着它（见 scripts/check-physics-chain.mjs）。
 */
import { Router } from 'express'
import { readChainLayout, writeChainLayout } from '../lib/chainLayout.mjs'

export const chainLayoutRouter = Router()

/** GET /api/chain-layout —— 读这一页记下的手摆坐标（缺文件时回空的一份） */
chainLayoutRouter.get('/', (_req, res, next) => {
  readChainLayout()
    .then((layout) => res.json({ layout }))
    .catch(next)
})

/**
 * PUT /api/chain-layout —— 整份替换手摆坐标。
 *
 * 交空对象 = 清掉覆盖层（页面回到生成物烘好的摆位），也就是界面上的"恢复默认摆放"。
 * 结构不对直接 400：保存失败要说清是哪一步错了，不能静默当成"保存成功"。
 */
chainLayoutRouter.put('/', (req, res, next) => {
  const positions = req.body?.positions
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) {
    next(Object.assign(new Error('positions 必须是一个对象：{ 节点 id: { x, y } }'), { status: 400 }))
    return
  }
  writeChainLayout(positions)
    .then(({ layout, updated, skipped }) => res.json({ layout, updated, skipped }))
    .catch(next)
})
