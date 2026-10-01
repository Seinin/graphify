/**
 * 解析 `docs/notes/atlas/` 这套分层文档。
 *
 * 为什么解析而不是硬编码：这套文档本身**就是物理语言写成的**（L1 明确声明"不出现函数名、
 * 文件路径、子过程名、变量名"），物理过程的名字与描述都该从它取——硬编码一份就会与文档分叉。
 *
 * 文档契约（见 `docs/notes/atlas/CONVENTIONS.md`）：
 *   · 条目 = `### 编号 名称`（编号与名称之间一个半角空格）
 *   · 字段 = `- **字段名**：值`（全角冒号）
 *   · 锚点 = GitHub slug（转小写、删 `.`、空格转 `-`、中文保留）
 */

import fs from 'node:fs/promises'
import path from 'node:path'

/** GitHub 风格锚点：与文档里 `[S13 电离与复合](L1-stages.md#s13-电离与复合)` 的写法一致 */
export function slugOf(heading) {
  return String(heading)
    .trim()
    .toLowerCase()
    .replace(/[.`]/g, '')
    .replace(/\s+/g, '-')
}

/** 把字段值里的 markdown 清成纯文本：链接留文字、粗体与行内代码去壳 */
export function plainText(value) {
  return String(value ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 取字段值里的全部链接（用于拿源码路径与下一层锚点） */
function linksOf(value) {
  const links = []
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g
  let match = pattern.exec(String(value ?? ''))
  while (match) {
    links.push({ text: match[1], url: match[2] })
    match = pattern.exec(String(value ?? ''))
  }
  return links
}

/** 取字段值里全部行内代码（L3 的「承担者」用它列出函数名与文件名） */
export function codeSpans(value) {
  return [...String(value ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1].trim())
}

/**
 * 解析一份分层文档，返回条目数组。
 * 每条：{ code, name, heading, anchor, fields: { 字段名: { text, links } } }
 */
export function parseEntries(markdown) {
  const entries = []
  let current = null
  let field = null

  for (const line of String(markdown).split('\n')) {
    const heading = /^###\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (heading) {
      current = {
        code: heading[1],
        name: heading[2],
        heading: `${heading[1]} ${heading[2]}`,
        anchor: slugOf(`${heading[1]} ${heading[2]}`),
        fields: {},
      }
      entries.push(current)
      field = null
      continue
    }
    if (!current) continue

    const fieldMatch = /^-\s+\*\*(.+?)\*\*：\s*(.*)$/.exec(line)
    if (fieldMatch) {
      field = fieldMatch[1].trim()
      current.fields[field] = {
        text: plainText(fieldMatch[2]),
        // 原始值也要留：行内代码（`set_scaling_constants`、`scaling_relations.c`）是 L3 的关键信息，
        // 而 plainText 会把反引号去掉，拿不回符号名。
        raw: fieldMatch[2],
        links: linksOf(fieldMatch[2]),
      }
      continue
    }
    // 字段值的续行（缩进继续写）：拼回上一个字段
    if (field && /^\s+\S/.test(line) && current.fields[field]) {
      current.fields[field].text = plainText(`${current.fields[field].text} ${line}`)
      current.fields[field].raw = `${current.fields[field].raw} ${line}`
      continue
    }
    field = null
  }

  return entries
}

/** 读一份文档并解析 */
export async function readEntries(file) {
  const markdown = await fs.readFile(file, 'utf8')
  return parseEntries(markdown)
}

/** 从「下一层」字段的链接里取出 `文件.md#anchor` 形式的目标 */
export function docTargetOf(field) {
  const link = (field?.links ?? []).find((item) => /\.md#/.test(item.url))
  if (!link) return null
  const [file, anchor] = link.url.split('#')
  return { file, anchor }
}

/** 从「承担者」字段的源码链接里取出仓库相对路径（`../../../src/...` → `src/...`） */
export function sourcePathOf(field) {
  const link = (field?.links ?? []).find((item) => /src\/py21cmfast/.test(item.url))
  if (!link) return null
  return link.url.replace(/^(\.\.\/)+/, '').split('#')[0]
}

/**
 * 编号形态判断。
 * L3 文档里 `###` 同时用于两种粒度：子过程 `S13.5` 与计算单元 `S13.5.1`，
 * 只有三段编号才是"计算单元"（承接者字段才给出源码符号）。
 */
export const isUnitCode = (code) => /^S\d{2}\.\d+\.\d+$/.test(String(code ?? ''))
export const isSubprocessCode = (code) => /^S\d{2}\.\d+$/.test(String(code ?? ''))
export const isStageCode = (code) => /^S\d{2}$/.test(String(code ?? ''))

const HERE = path.dirname(new URL(import.meta.url).pathname)

/** 仓库根（Graphify/scripts/lib → 上溯三层）：atlas 文档里的源码链接都相对它 */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

/** atlas 目录 */
export const ATLAS_DIR = path.join(REPO_ROOT, 'docs', 'notes', 'atlas')

/** 一次性读齐三层文档（L1 阶段 / L2 子过程 / L3 计算单元） */
export async function loadAtlas() {
  const [stages, subprocesses, units] = await Promise.all([
    readEntries(path.join(ATLAS_DIR, 'L1-stages.md')),
    readEntries(path.join(ATLAS_DIR, 'L2-subprocesses.md')),
    readEntries(path.join(ATLAS_DIR, 'L3-units.md')),
  ])
  return { stages, subprocesses, units }
}
