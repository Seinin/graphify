/**
 * 从源码里抽「文献引用」——只抽注释与字符串（含 docstring）里**已经写着**的引用。
 *
 * 为什么只抽不生成：21cmFAST 的 C 源码与 Python docstring 里本来就写着它依据的论文
 * （`Scoccimarro R., 1998, MNRAS, 299, 1097`、`Bardeen et al 1986 ApJ, 304, 15`、
 * `Meiksin et al. 2021`、`Eq. 2 of Greig+2015`…）。这些是**可核查的事实**；
 * 任何"补全残缺条目、猜期刊卷页、按印象推荐文献"的做法都会让这一层变成编造。
 * 所以：抽不到就是空的，缺字段就留空。
 *
 * 实现上复用 `paramScan.maskSource()`：它把注释与字符串换成等长空白（保留换行与偏移），
 * 于是"原文有、屏蔽后是空白"的位置就是注释/字符串区——不必重写一遍词法。
 */

import { maskSource } from './paramScan.mjs'

/**
 * 不像作者的词。判据是"作者名 + 年份"的形态，但注释里也有 `参见 Fig. 2020` 这类写法，
 * 这些首词一律不算作者。
 */
const NOT_AUTHOR = new Set([
  'Fig',
  'Figs',
  'Figure',
  'Table',
  'Eq',
  'Eqs',
  'Equation',
  'Section',
  'Sec',
  'Chapter',
  'Note',
  'NOTE',
  'TODO',
  'FIXME',
  'Version',
  'Since',
  'After',
  'Before',
  'See',
  'The',
  'This',
  'That',
  'These',
  'Those',
  'Here',
  'When',
  'While',
  'Because',
  'However',
  'Both',
  'Only',
  'From',
  'With',
  'If',
  'In',
  'On',
  'At',
  'For',
  'And',
  'But',
  'Or',
  'Use',
  'Used',
  'Using',
  'All',
  'Any',
  'Each',
  'Every',
  'New',
  'Old',
  'Step',
  'Steps',
  'Case',
  'Warning',
  'WARNING',
  'Default',
  'Optimization',
  'Approach',
  'Method',
  'Methods',
  'Code',
  'Python',
  'GSL',
  'MPI',
  'OpenMP',
  'Cosmo',
  'Astro',
])

/**
 * 「作者 + 年份」的核心形态。三条已知写法都覆盖：
 *   · `Scoccimarro R., 1998, MNRAS, 299, 1097`（姓 + 名缩写 + 逗号 + 年）
 *   · `Bardeen et al 1986 ApJ, 304, 15`（姓 + et al + 年）
 *   · `Eisenstein & Hu ApJ, 1999, 511, 5`（姓 & 姓 + 年）
 *   · `Greig+2015` / `Park+2018`（姓 + 加号 + 年，inputs.py 的写法）
 */
const CITATION = /\b([A-Z][A-Za-z'’\-]{1,20})\s*(?:[A-Z]\.\s*)?(?:(?:et\s*al\.?|and|&)\s*(?:[A-Z][A-Za-z'’\-]{1,20}\s*)?|\+\s*)?,?\s*((?:19|20)\d{2})\b/g

/** 一行里的期刊/链接线索：有它说明这行确实是引文，而不是"2020 年"这种普通年份 */
const VENUE = /\b(ApJ|ApJS|MNRAS|MN\b|PhRvD|Phys\.?\s*Rev|A&A|AJ|JCAP|Nature|Science|PRL|RNAAS)\b/
const LINK = /\b(arxiv|doi|adsabs|ui\.adsabs|10\.\d{4}\/)/i

/** 把一行注释/字符串清成可读文本：去注释符、去引号、压空白 */
export function cleanCommentLine(line) {
  return String(line)
    .replace(/^\s*(?:\/\/+|\/\*+|\*+\/?|#+)\s?/, '')
    .replace(/\*\*?\/\s*$/, '')
    .replace(/^\s*(?:r|u|f)?("""|'''|"|')/, '')
    .replace(/("""|'''|"|')\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 抽一份源码里的文献引用。
 * @returns {{ key: string, label: string, year: number, refs: { line: number, text: string, venue: string|null, link: string|null }[] }[]}
 */
export function extractCitations(text, file, language) {
  const original = String(text).split('\n')
  const masked = maskSource(text, language).split('\n')
  const findings = []

  for (let index = 0; index < original.length; index += 1) {
    const source = original[index]
    const blank = masked[index] ?? ''
    if (!source.trim()) continue

    /**
     * 只认注释与字符串：屏蔽后的同一行里，原文的实义字符都变成了空格。
     * 判据取"这一行里有没有被屏蔽掉的实义内容"，避免把纯代码行当成引文来源。
     */
    const maskedAway = [...source].some((char, position) => char.trim() && blank[position] === ' ')
    if (!maskedAway) continue

    const line = cleanCommentLine(source)
    if (!line || !/\d{4}/.test(line)) continue

    const venueMatch = VENUE.exec(line)
    const linkMatch = LINK.exec(line)

    CITATION.lastIndex = 0
    let match = CITATION.exec(line)
    while (match) {
      const author = match[1]
      const year = Number(match[2])
      const plausible =
        !NOT_AUTHOR.has(author) &&
        author.length > 2 &&
        year >= 1950 &&
        year <= 2030 &&
        // 有期刊/链接线索时放宽；否则要求引用形态明显（et al / & / 加号 / 名缩写逗号）
        (Boolean(venueMatch) ||
          Boolean(linkMatch) ||
          /\b(?:et\s*al|\+|&)\b/.test(match[0]) ||
          /[A-Z]\.,\s*\d{4}/.test(match[0]))
      if (plausible) {
        findings.push({
          key: `${author.toLowerCase()}${year}`,
          label: match[0].replace(/\s+/g, ' ').trim(),
          year,
          line: index + 1,
          text: line.slice(0, 400),
          venue: venueMatch ? venueMatch[1] : null,
          link: linkMatch ? linkMatch[1] : null,
          file,
        })
      }
      match = CITATION.exec(line)
    }
  }

  return findings
}

/**
 * 把同一篇文献的多个引用点合并成实体（引用点全部保留：它们正是"论文 → 代码"的检索路径）。
 *
 * 引用点按 (文件, 行) 去重：同一行可能被"单元行区间"和"整文件"两条路径各抽一次，
 * 不去重的话同一行会堆出几十个重复引用点。
 */
export function mergeCitations(findings) {
  const byKey = new Map()
  for (const finding of findings) {
    const entity = byKey.get(finding.key) ?? { key: finding.key, label: finding.label, year: finding.year, refs: [], seen: new Set() }
    if (finding.label.length > entity.label.length) entity.label = finding.label
    const refKey = `${finding.file}:${finding.line}`
    if (!entity.seen.has(refKey)) {
      entity.seen.add(refKey)
      entity.refs.push({ file: finding.file, line: finding.line, text: finding.text, venue: finding.venue, link: finding.link })
    }
    byKey.set(finding.key, entity)
  }
  return [...byKey.values()]
    .map(({ seen, ...entity }) => ({
      ...entity,
      refs: entity.refs.sort((left, right) => (left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file))),
    }))
    .sort((left, right) => right.refs.length - left.refs.length || left.key.localeCompare(right.key))
}
