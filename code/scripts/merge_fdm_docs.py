#!/usr/bin/env python
"""将 docs/notes/FDM_*.md 整合为单册 docs/notes/FDM.md。

策略：保留全部正文（含公式、数值表、代码索引），仅做
  1) 标题层级下沉（原 H1 -> H2，H2 -> H3 …），代码块内的 # 不动
  2) 按主题分篇，加统一扉页与导航
  3) 标注每篇的时效状态（现行 / 历史存档）
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs" / "notes"
OUT = DOCS / "FDM.md"

# (源文件, 篇章标题, 状态标注)
PARTS = [
    ("FDM_dndm_report.md", "第一篇　HMF 通道：dndm 与条件质量函数", "现行"),
    ("FDM_cooling_report.md", "第二篇　冷却通道：CDM 拟合因子依赖审计", "现行"),
    ("FDM_mcrit_algorithm.md", "第三篇　分子冷却阈值 mcrit 的 FDM 迁移", "现行"),
    ("FDM_audit_report.md", "第四篇　一致性审计与冲突裁决", "现行"),
    ("FDM_hmf_design.md", "第五篇　[历史存档] HMF 处理方案（结论已被推翻）", "历史"),
    ("FDM_MCG_modeling.md", "第六篇　[历史存档] MCG 建模方案（方案 2 已回退）", "历史"),
]


def demote(text: str, levels: int = 1) -> str:
    """把所有标题下沉 levels 级；跳过 ``` 围栏内的行。"""
    out, in_fence = [], False
    for ln in text.split("\n"):
        s = ln.strip()
        if s.startswith("```"):
            in_fence = not in_fence
            out.append(ln)
            continue
        if not in_fence and ln.startswith("#"):
            out.append("#" * levels + ln)
        else:
            out.append(ln)
    return "\n".join(out)


def strip_h1(text: str) -> str:
    """去掉文首的一级标题（已由篇章标题替代）与紧随的空行。"""
    lines = text.split("\n")
    i = 0
    while i < len(lines) and lines[i].strip() == "":
        i += 1
    if i < len(lines) and lines[i].startswith("# "):
        i += 1
    return "\n".join(lines[i:]).lstrip("\n")


def main():
    chunks = []

    # ---------- 扉页 ----------
    chunks.append("""# FDM 建模文档（整合版）

> 本册由原 `docs/FDM_*.md` 六份文档整合而成，内容完整保留，仅统一结构与导航。
> 整合日期：2026-09-10

## 阅读导航

| 篇章 | 内容 | 状态 |
|---|---|---|
| **第一篇** | HMF 通道：dndm、Eq.(3)(4)(5)、excursion set 出发点、$\\sigma_1$/$\\sigma_2$、Liu 源码实现、对照实验、回退记录 | 现行 |
| **第二篇** | 冷却通道：CDM 拟合因子的依赖审计（A–E 分类） | 现行 |
| **第三篇** | 分子冷却阈值 $m_{\\rm crit}$ 的 FDM 迁移方案（含 §6 数值表，已复算验证） | 现行 |
| **第四篇** | 一致性审计与冲突裁决、基线说明 | 现行 |
| **第五篇** | HMF 处理方案（**历史存档**：核心结论已被推翻） | 历史 |
| **第六篇** | MCG 建模方案（**历史存档**：方案 2 已于 2026-09-10 回退） | 历史 |

## 核心结论速览

1. **FDM 的 dndm = 用 CDM σ 算出的 CDM dndm × $f_{\\rm FDM}(m)$**。σ 恒用 CDM，
   FDM 效应由 $f_{\\rm FDM}$ 表达（唯一例外：条件 HMF 的 $\\sigma_2$ 用 FDM σ）。
2. **全局（无条件）路径**：本仓库与 Liu+25 源码**严格一致**（实测中位相对误差 $3\\times10^{-13}$），
   故功率谱与无条件 HMF 的复现结果必然相同。
3. **条件 HMF** 已于 2026-09-10 回退对齐 Liu：不乘 $f_{\\rm FDM}$、$\\sigma_2$ 取 FDM σ。
4. **最大缺口是冷却通道**：$M_{\\rm sol}\\ll M_{\\rm hm}$（$m_{22}{=}1$：$1.5\\times10^7$ vs $1.6\\times10^{10}$），
   冷却抑制比 HMF 截断早约 3 个量级生效，但 `mcrit_noLW` 与 SM13 仍为纯 CDM。
5. **事实基准**：Liu et al. 2025, PRD 112, 103534 + Liu 源码 `D:\\v21cmFAST`
   （v3.3.1，`ps.c` 4544 行）。**禁止**用 `/home/dministrat/v21cmFAST`（重构版，4423 行）核对行号。
6. **基线**：`git tag baseline/pre-fdm` → `d8f67b76`（FDM 引入前最后一个提交）。

---
""")

    # ---------- 各篇 ----------
    for fname, title, status in PARTS:
        src = DOCS / fname
        if not src.exists():
            print(f"  [skip] {fname} 不存在")
            continue
        body = demote(strip_h1(src.read_text(encoding="utf-8")), levels=1)
        note = {
            "现行": "",
            "历史": ("\n> **⚠ 本篇为历史存档**，其内容已被第一篇/第四篇取代或修正，"
                     "保留仅用于追溯决策过程，请勿据此实施。\n"),
        }[status]
        chunks.append(f"\n# {title}\n\n> 来源：`docs/{fname}`　状态：**{status}**\n{note}\n{body}\n")

    # ---------- 附录：代码索引速查 ----------
    chunks.append("""
---

# 附录　速查与常见误区

## A.1 速查表

| 问题 | 答案 |
|---|---|
| FDM 的 dndm 怎么算？ | CDM dndm（**用 CDM σ**）× $f_{\\rm FDM}(m)$ |
| σ 用 CDM 还是 FDM？ | **CDM**（唯一例外：条件 HMF 的 $\\sigma_2$ 用 FDM） |
| 为什么不用 FDM σ？ | 会与 $f_{\\rm FDM}$ 双重计数 |
| $f_{\\rm FDM}$ 压制大质量还是小质量？ | **小质量**（$\\alpha=-1.1<0$） |
| 条件 HMF 要不要乘 $f_{\\rm FDM}$？ | **不要**（已回退对齐 Liu） |
| $\\sigma_1$ / $\\sigma_2$ 用什么？ | $\\sigma_1$=CDM σ / $\\sigma_2$=**FDM σ** |
| 分子 δ 用什么？ | FDM 场的 δ（ICs 含 $T_F$，自动满足） |
| 基线在哪？ | `git tag baseline/pre-fdm` → `d8f67b76` |
| 复现论文图用哪个脚本？ | `train/_plot_ps_dimensionless.py`、`train/_plot_hmf_three.py` |

## A.2 常见误区

| 误区 | 纠正 |
|---|---|
| 「$f_{\\rm FDM}$ 是压制大质量晕的」 | 错。$\\alpha=-1.1<0$，压制**小质量** |
| 「σ₁ 用 CDM、σ₂ 用 FDM 是 bug」 | 错。这正是 Eq.(5) 的要求 |
| 「条件 HMF 乘 $f_{\\rm FDM}$ 会破坏闭合」 | 该论据不成立；但实际已按 Liu 回退为不乘 |
| 「FDM 效应主要来自 HMF」 | 不准确。$M_{\\rm sol}\\ll M_{\\rm hm}$，**冷却通道才是主导且完全缺失** |
| 「用 `/home/dministrat/v21cmFAST` 核对 Liu 行号」 | 错。那是重构版（4423 行），要用 `D:\\v21cmFAST`（4544 行） |

## A.3 验证脚本（`train/`，该目录被 .gitignore 忽略）

| 脚本 | 用途 |
|---|---|
| `_plot_ps_dimensionless.py` | 复现 Liu Fig.1 功率谱 |
| `_plot_hmf_three.py` | 复现 Liu Fig.2 HMF（含 FDM I.C.s 对照） |
| `_verify_global_path.py` | 验证全局路径 = CDM HMF(CDM σ) × $f_{\\rm FDM}$ |
| `_verify_cond_hmf_fdm.py` | 定量对比 A/B/C 三配置的条件 HMF |
| `_verify_fork_vs_liu.py` | 扫描 $M_{\\min}/M_0$ 对 A/B 比值的影响 |
| `_verify_meanfixing.py` | 验证 mean-fixing 对差异的抹平作用 |
""")

    OUT.write_text("\n".join(chunks), encoding="utf-8")
    print(f"已生成 {OUT}  ({len(OUT.read_text(encoding='utf-8').splitlines())} 行)")


if __name__ == "__main__":
    main()
