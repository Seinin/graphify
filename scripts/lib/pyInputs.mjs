/**
 * 解析 `src/py21cmfast/wrapper/inputs.py` 里的 `AstroParams` / `AstroOptions` 结构体：
 * 字段名、**默认值**、**是否以 log10 存储**、**取值范围**、以及 docstring 原文。
 *
 * 为什么要默认值与范围：科学家第一句话是"这个参数是什么、默认多少、动它会怎样"。
 * 早期那份"参数矩阵"的生成器只收了字段名与 docstring（它用不上默认值），
 * 物理图谱要显示它们，所以这里**另起一份**解析——不去改那个脚本的产物口径。
 *
 * 不编造：认不出的写法（新的 validator、动态默认值）一律留空并把原文留在 `validatorText`，
 * 由自检去核对"至少 N 个参数解析出了默认值"，避免静默全空。
 */

/** 认得出下界的写法：`gt(x)` / `ge(x)` / `validator=...` 里嵌的 between 等 */
function parseBounds(definition) {
  const between = /between\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(definition)
  if (between) return { min: Number(between[1]), max: Number(between[2]) }
  const lower = /(?:gt|ge)\(\s*(-?[\d.]+)\s*\)/.exec(definition)
  const upper = /(?:lt|le)\(\s*(-?[\d.]+)\s*\)/.exec(definition)
  return {
    min: lower ? Number(lower[1]) : null,
    max: upper ? Number(upper[1]) : null,
  }
}

/** 默认值：数字 / True / False / 字符串 / None。认不出返回 null（宁可空着也不猜） */
function parseDefault(definition) {
  const match = /\bdefault\s*=\s*([^,)]+)/.exec(definition)
  if (!match) return null
  const raw = match[1].trim()
  if (/^(True|False)$/.test(raw)) return raw === 'True'
  if (/^None$/.test(raw)) return null
  if (/^-?\d+(?:\.\d+)?(?:e-?\d+)?$/i.test(raw)) return Number(raw)
  const quoted = /^(['"])(.*)\1$/.exec(raw)
  if (quoted) return quoted[2]
  return null
}

/** 选项：`Literal["a","b"]` 或 `choice_field(...)` 里出现的字符串字面量 */
function parseChoices(definition) {
  const literals = [...definition.matchAll(/"([A-Za-z0-9_.\-]+)"/g)].map((match) => match[1])
  const list = literals.filter((item) => !/^(True|False)$/.test(item))
  return list.length ? [...new Set(list)] : null
}

/**
 * 把类 docstring 的内容行抹成等长空行（行号不变）。
 * 为什么必须抹：类 docstring 里也写着 `NB: 全部标度关系都在 log 空间` 这类说明行，
 * 以及 `NAME: type, optional` 形式的字段清单——它们长得像字段定义，会被误收进去，
 * 并覆盖后面真正的定义（踩过的坑：`INHOMO_RECO` 因此被算进错的类、默认值也丢了）。
 */
function stripDocstrings(classBody) {
  let inDoc = false
  return classBody
    .split('\n')
    .map((line) => {
      const quotes = (line.match(/"""/g) ?? []).length
      if (inDoc) {
        if (quotes % 2 === 1) inDoc = false
        return ' '.repeat(line.length)
      }
      if (quotes % 2 === 1) {
        inDoc = true
        return ' '.repeat(line.length)
      }
      return line
    })
    .join('\n')
}

/**
 * 收集类体里的字段定义原文。
 * 字段定义可能跨行（`F_STAR10: float = field(` 换行写 default/validator/transformer），
 * 所以按括号配平一直读到平衡为止；这是踩过的坑：只读一行会漏掉 validator 与 transformer。
 * 名字**不能限定全大写**：`ION_Tvir_MIN`、`t_STAR`、`M_MIN_in_Mass`、`hlittle`、`OMm`、`Y_He`
 * 这类混写名字会被整片漏掉（踩过的坑：`ION_Tvir_MIN` 消失、`CosmoParams` 只剩 2 个字段）。
 */
function collectDefinitions(classBody) {
  const definitions = new Map()
  const lines = stripDocstrings(classBody).split('\n')
  const head = /^ {4}([A-Za-z_][A-Za-z_0-9]*)\s*:\s*(\S.*)$/

  for (let index = 0; index < lines.length; index += 1) {
    const match = head.exec(lines[index])
    if (!match) continue
    const name = match[1]
    let text = match[2]
    let depth = (text.match(/[([{]/g)?.length ?? 0) - (text.match(/[)\]}]/g)?.length ?? 0)
    let cursor = index
    while (depth > 0 && cursor + 1 < lines.length) {
      cursor += 1
      const next = lines[cursor]
      // 只吃"续行"：下一行若回到 4 空格字段头，说明上一个定义其实已经结束
      if (head.test(next)) break
      text += ` ${next.trim()}`
      depth += (next.match(/[([{]/g)?.length ?? 0) - (next.match(/[)\]}]/g)?.length ?? 0)
    }
    definitions.set(name, text.replace(/\s+/g, ' ').trim())
    index = cursor
  }
  return definitions
}

/** 类 docstring 里按字段写的说明（`NAME : type, optional` + 8 空格缩进的描述行） */
function collectDocstrings(classBody) {
  const docs = new Map()
  let inDoc = false
  let current = null
  let buffer = []

  const flush = () => {
    if (current && buffer.length) docs.set(current, buffer.join(' ').replace(/\s+/g, ' ').trim())
    current = null
    buffer = []
  }

  for (const line of classBody.split('\n')) {
    if (/^ {4}r?"""\s*$/.test(line)) {
      inDoc = !inDoc
      flush()
      continue
    }
    if (!inDoc) continue
    const fieldDoc = /^\s{4}([A-Za-z_][A-Za-z_0-9]*)\s*:\s*\S+/.exec(line)
    if (fieldDoc) {
      flush()
      current = fieldDoc[1]
      continue
    }
    if (current && /^\s{8,}\S/.test(line)) buffer.push(line.trim())
  }
  flush()
  return docs
}

/**
 * 解析整个 inputs.py。
 * @returns {Map<string, { name, group, docstring, default, log10, range, choices, validatorText }>}
 */
export function parseInputStructs(text) {
  const source = String(text)
  const classPattern = /^class\s+(\w+)\(InputStruct\)/gm
  const starts = [...source.matchAll(classPattern)].map((match) => ({ name: match[1], at: match.index, end: match.index + match[0].length }))

  const params = new Map()
  starts.forEach((klass, index) => {
    const until = index + 1 < starts.length ? starts[index + 1].at : source.length
    const body = source.slice(klass.end, until)
    const definitions = collectDefinitions(body)
    const docs = collectDocstrings(body)

    for (const [name, definition] of definitions) {
      const bounds = parseBounds(definition)
      params.set(name, {
        name,
        group: klass.name,
        docstring: docs.get(name) ?? '',
        default: parseDefault(definition),
        log10: /logtransformer/.test(definition),
        range: bounds.min !== null || bounds.max !== null ? bounds : null,
        choices: parseChoices(definition),
        /** 校验器原文：解析不出范围时它是唯一的真相，留给自检与界面（`gt(0)` / `between(-3.0, 0.0)`） */
        validatorText: (/validator\s*=\s*(?:validators\.)?([a-z_]+\([^)]*\)|[^,)]+)/.exec(definition)?.[1] ?? '').trim(),
      })
    }
  })

  /**
   * 私有存储 + 公有属性的写法：类体里能解析到的是 `_A_s`、`_DIM`、`_BOX_LEN` 这种带前导下划线的
   * 字段名，对外的名字（`A_s` / `DIM`）写在 `@property` 上，字段名正则收不到。
   * 真源按对外名字登记参数，用对外名字查表就会落空，连带丢掉类名、默认值与范围
   * （表现是侧栏里那一组「未标类」）。所以补一条**去掉前导下划线**的别名：
   * 对外名字已被别的字段占用时不补，不静默覆盖类体里真写出来的那个。
   */
  for (const [name, value] of [...params]) {
    const publicName = name.replace(/^_+/, '')
    if (!publicName || publicName === name || params.has(publicName)) continue
    params.set(publicName, { ...value, name: publicName })
  }

  return params
}
