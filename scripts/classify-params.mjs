/**
 * 给参数标签打上「代码里的划分」：`group` = inputs.py 里 InputStruct 的子类名
 * （CosmoParams / MatterOptions / SimulationOptions / AstroOptions / AstroParams）。
 *
 * 为什么从代码解析而不是手写映射：分组是代码的事实（参数在哪一类里定义），
 * 手写一份迟早和上游漂移；这里每次重跑都以 `src/py21cmfast/wrapper/inputs.py` 为准。
 *
 * 幂等：分类没变就不写盘。
 *
 * 用法：node scripts/classify-params.mjs [baseUrl]
 */
import fs from 'node:fs/promises'

const BASE = process.argv[2] || 'http://127.0.0.1:5178'
const INPUTS_PATH = new URL('../../src/py21cmfast/wrapper/inputs.py', import.meta.url)

/** 只认 InputStruct 的子类（其余类里的同名字段不是「参数定义」） */
const BASE_CLASS = 'InputStruct'

/** 解析 inputs.py：字段名 → 定义它的类名（取首次出现，即类的属性声明处） */
function parseInputClasses(source) {
  const fieldClass = new Map()
  const classes = []
  let current = null
  let isInputStruct = false
  source.split('\n').forEach((line) => {
    const header = /^class\s+(\w+)\s*\(([^)]*)\)/.exec(line)
    if (header) {
      current = header[1]
      isInputStruct = header[2].split(',').some((base) => base.trim() === BASE_CLASS)
      if (isInputStruct) classes.push(current)
      return
    }
    if (!current || !isInputStruct) return
    const field = /^\s{4}([A-Z][A-Z0-9_]*)\s*:/.exec(line)
    if (field && !fieldClass.has(field[1])) fieldClass.set(field[1], current)
  })
  return { fieldClass, classes }
}

const source = await fs.readFile(INPUTS_PATH, 'utf8')
const { fieldClass, classes } = parseInputClasses(source)
console.log(`inputs.py: ${classes.length} 个 InputStruct 子类 → ${classes.join(', ')}`)
console.log(`解析出字段 ${fieldClass.size} 个`)

const readGraph = async () => (await (await fetch(`${BASE}/api/graph`)).json()).graph
const writeGraph = async (graph, reason) => {
  const response = await fetch(`${BASE}/api/graph`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph, reason }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`写图失败: ${response.status} ${JSON.stringify(body).slice(0, 400)}`)
}

const graph = await readGraph()
const tags = graph.meta.tags ?? []
let changed = 0
const unmatched = []
tags.forEach((tag) => {
  const variable = tag.id.startsWith('tag:') ? tag.id.slice(4) : ''
  const group = fieldClass.get(variable)
  if (!group) {
    unmatched.push(tag.name)
    return
  }
  if (tag.group !== group) {
    tag.group = group
    changed += 1
  }
})

/* 注册表顺序也按代码里的类顺序排（Array.sort 稳定，类内保持原顺序）：
   前端按注册表顺序分组显示，这样弹层里的分组次序与 inputs.py 的类定义次序一致。 */
const classOrder = new Map(classes.map((name, index) => [name, index]))
const reordered = [...tags].sort((a, b) => {
  const left = classOrder.get(a.group) ?? Number.MAX_SAFE_INTEGER
  const right = classOrder.get(b.group) ?? Number.MAX_SAFE_INTEGER
  return left - right
})
const reorderedChanged = reordered.some((tag, index) => tag.id !== tags[index].id)
if (reorderedChanged) graph.meta.tags = reordered

if (changed || reorderedChanged) await writeGraph(graph, 'tags:group-by-input-class')

const after = await readGraph()
const grouped = new Map()
;(after.meta.tags ?? []).forEach((tag) => {
  const key = tag.group || '未分类'
  if (!grouped.has(key)) grouped.set(key, [])
  grouped.get(key).push(tag.name)
})
console.log(`\n更新 ${changed} 个标签的分类（未变则不写盘）`)
;(after.meta.tags ?? []).length &&
  [...grouped.entries()].forEach(([group, names]) => {
    console.log(`  ${group.padEnd(20)} ${names.length} 个: ${names.join(', ')}`)
  })
if (unmatched.length) console.log(`\n未匹配到类（保持原样）: ${unmatched.join(', ')}`)
