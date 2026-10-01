/**
 * 表面文案自检：站点文档、页面文案与生成物里不许留对话痕迹、记账话术与过程词命名。
 *
 * 规则来源：`.codebuddy/rules/no-chatter-in-docs.md`。
 * 过程工作区（`openspec/**`、`.codebuddy/**`）与归档（`Graphify/attic/**`、`docling-graph/**`）不受约束。
 *
 * 跑：`npm run check:copy`
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..');

/** 正文禁用措辞：命中即失败 */
const TEXT_BANS = [
  { name: '用户归属', re: /用户\s*20\d\d-\d\d-\d\d|用户口径|用户明确|用户要求|用户反馈|用户点名/g },
  { name: '对话引用', re: /按你说的|你说过的|你点名的|应[「“"][^」”"]{0,30}[」”"]之问|给评审/g },
  { name: '记账与施工痕迹', re: /本轮|本次变更|只列不改|待补名单|先记账|后决定/g },
  { name: '过程叙事', re: /待你确认|需你实走|等你定|只列不改|先记账|施工计划/g },
  { name: '变更名引用', re: /变更\s*`[^`]+`/g },
];

/** 第二人称（先抹掉含「你」的物理名词再判） */
const SECOND_PERSON_ALLOW = [/迷你晕/g, /你晕/g, /你是 Graphify 的建图助手/g];

/** 文件名禁用词 */
const NAME_BANS = [
  /(^|[^a-z])plan([^a-z]|$)/i,
  /todo/i,
  /\bdraft\b/i,
  /\bwip\b/i,
  /\btemp\b/i,
  /notes/i,
  /digest/i,
  /备份/,
  /新版/,
  /最终/,
  /_plan/,
];

/** 正文扫描范围 */
const TEXT_ROOTS = [
  'docs/notes',
  'docs/DIRECTORY.md',
  'Graphify/README.md',
  'Graphify/docs',
  'Graphify/src',
];
const SKIP_PATH = [/\.bak/, /(^|\/)attic\//, /(^|\/)node_modules\//, /(^|\/)\.git\//];

/** 文件名扫描范围（站点可读文档） */
const NAME_ROOTS = ['docs/notes', 'Graphify/docs'];

function walk(p, out = []) {
  let st;
  try {
    st = statSync(p);
  } catch {
    return out;
  }
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) walk(join(p, e), out);
  } else {
    out.push(p);
  }
  return out;
}

const fails = [];
const rel = (p) => relative(repo, p);

for (const root of TEXT_ROOTS) {
  for (const file of walk(join(repo, root))) {
    const r = rel(file);
    if (SKIP_PATH.some((re) => re.test(r))) continue;
    if (!/\.(md|ts|tsx|json|css|html)$/.test(file)) continue;
    if (/node_modules/.test(r)) continue;
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const [i, line] of lines.entries()) {
      for (const { name, re } of TEXT_BANS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) fails.push(`${r}:${i + 1}: [${name}] ${m[0]}`);
      }
      let probe = line;
      for (const re of SECOND_PERSON_ALLOW) probe = probe.replace(re, '〇');
      const sp = probe.match(/[你您]/);
      if (sp) fails.push(`${r}:${i + 1}: [第二人称] ${line.trim().slice(0, 80)}`);
    }
  }
}

for (const root of NAME_ROOTS) {
  for (const file of walk(join(repo, root))) {
    const r = rel(file);
    if (SKIP_PATH.some((re) => re.test(r))) continue;
    const name = basename(file);
    for (const re of NAME_BANS) {
      if (re.test(name)) fails.push(`${r}: [文件名] ${name} 命中 ${re}`);
    }
  }
}

if (fails.length) {
  console.error(`✗ 表面文案自检失败（${fails.length} 处）：`);
  for (const f of fails.slice(0, 60)) console.error('  ' + f);
  if (fails.length > 60) console.error(`  …还有 ${fails.length - 60} 处`);
  console.error('\n规则见 .codebuddy/rules/no-chatter-in-docs.md');
  process.exit(1);
}
console.log('✓ 表面文案自检通过（无对话痕迹 / 记账话术 / 过程词命名）');
