#!/usr/bin/env python
"""清理 docs/notes/FDM.md 中已失去价值的内容。

删除依据
--------
1. 原第五篇（FDM_hmf_design 存档）：核心结论「条件 HMF 应当加 f_FDM」
   与 2026-09-10 的回退（改为不乘）直接矛盾，留之误导 → 整篇删除。
   其有价值部分（无条件/条件 HMF 用途、Eq.(5) 三要素）已在第一篇覆盖。

2. 原第六篇（FDM_MCG_modeling 存档）：
   - §1 现有代码基础设施（已过时）
   - 方案 2（已回退）、方案 3（不推荐）
   - §4 实施建议「推荐方案 1+2」（已作废）
   - §5 文件索引、§6 参考文献（重复）
   - 附录 A（Liu 代码诊断已被第一篇 §8 修正）
   → 全部删除。

保留（具备参考价值、尚未实施）
----------------------------
- 核心困难与文献现状
- 方案 1：只改 M_turn（最小改动）
- 方案 4：Du+17 完整 FDM 条件 HMF（长期方向）
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "notes" / "FDM.md"

NEW_PART5 = '''# 第五篇　备选方案存档（未实施）

> 本篇仅保留**尚未实施且具备参考价值**的备选方案。
>
> 以下内容已删除，正确结论见**第一篇 §8–§9**：
> - 「条件 HMF 乘 $f_{\\rm FDM}$」（方案 2）—— 已于 2026-09-10 回退，见第一篇 §9.7
> - 「FDM σ 通道方案」（方案 3）—— 不推荐，与 $f_{\\rm FDM}$ 互斥
> - Liu 源码的公式级对比诊断 —— 已被第一篇 §8 修正
> - 已过时的代码基础设施描述、文件索引、重复参考文献

## 1. 核心困难与文献现状

**FDM 的条件 HMF 没有现成的半解析经验公式可直接用。**

原因不是没人研究，而是 FDM 的 excursion set 问题本质上比 CDM 难：

1. **CDM 的 EPS 依赖 sharp-k 滤波器** —— 恰好对应的马尔可夫过程使 first-crossing 概率有解析解
2. **FDM 的量子压力天然对应 sharp-k 截止** —— 但 Du et al. (2017) 证明即使使用 sharp-k，FDM 的 barrier 也是**质量依赖的**（不再是常数 $\\delta_c$），这导致解析解复杂得多
3. Du+17 确实解了这个问题（用修正的 Lacey & Cole 形式 + GALACTICUS 半解析模型），但公式涉及**双重数值积分 + 质量依赖 barrier 的 Taylor 展开**，不是一条解析公式能写完的

### 文献现状

- **Jones et al. (2021)**: 直接用的 `dndm_FDM` 乘在 ST HMF 上（和代码现有做法一样），未专门处理 minihalo
- **Liu et al. (2025)**: 更近一步把 FDM 的 $\\sigma(M)$ 代入了条件 HMF，但也**没有专门处理分子冷却晕**

**FDM 的分子冷却阈值目前没有一篇文献给出过可直接用的解析公式。所有现有工作都回避了这个问题 —— 要么不做 minihalo，要么直接用 CDM 的 $M_{\\rm turn}$ + FDM HMF 压制。**

## 2. 方案 A：只改 $M_{\\rm turn}$（最小改动）

利用现有 FDM 基础设施，**只修改分子冷却质量阈值**：

$$M_{\\text{turn}}^{\\text{FDM}} = \\max\\left(M_{\\text{cool}},\\; M_{1/2}\\right), \\quad M_{1/2} = 1.6\\times 10^{10}\\; m_{22}^{-4/3}\\; M_\\odot$$

其中 $M_{\\text{cool}}$ 是现有的分子冷却阈值（含 LW 反馈，来自 `lyman_werner_threshold()`），
$M_{1/2}$ 是 Schive+16 半模质量。物理直觉：FDM 量子压力压制了低于 $M_{1/2}$ 的晕形成，
因此 MCG 的下限至少为 $M_{1/2}$。

- **修改位置**：`thermochem.c: lyman_werner_threshold()` 返回前取 max，
  或 `hmf.c: nion_fraction_mini()` 的 `Mturn_mcg` 处
- **优点**：~10 行代码，$dndm\\_FDM$ 已经定义了 $M_{1/2}$
- **缺点**：忽略了 FDM 对条件 HMF 形状的修正 —— 在 $\\sigma(M)\\sim\\sigma(R)$ 附近，
  FDM 的条件 HMF 形状和 CDM 明显不同（Du+17 图 3）

> 注：与第三篇的 $m_{\\rm crit}^{\\rm FDM}$ 方案**互斥**（两者都改 $M_{\\rm turn}$，
> 但取值不同：本篇用 $M_{1/2}$，第三篇用 $M_{\\rm sol}=\\sqrt{(\\cdot)^2+M_{\\rm sol}^2}$ 合成）。
> 因 $M_{\\rm sol}\\ll M_{1/2}$，第三篇方案物理上更优（冷却抑制主导），
> 本篇仅作备选记录。

## 3. 方案 B：实现 Du+17 的完整 FDM 条件 HMF（长期方向）

Du et al. (2017, ApJ, 838, 63) 提供了完整的 FDM excursion set 解。核心公式（Eq. 6-9）：

$$\\frac{dn}{d\\ln M}\\bigg|_{\\delta} = \\frac{M_{\\text{cond}}}{M} \\cdot \\frac{\\Delta\\delta}{\\sqrt{2\\pi\\Delta S}}\\cdot\\exp\\!\\left(-\\frac{\\Delta\\delta^2}{2\\Delta S}\\right)\\cdot\\frac{dS}{d\\ln M}\\cdot\\frac{1}{\\Delta S}\\cdot\\text{Taylor terms}$$

其中 barrier 不再是常数 $\\delta_c$，而是质量依赖的：

$$\\delta_{\\text{FDM}}(M, z) = \\delta_c \\cdot \\left[1 + a_1\\!\\left(\\frac{M_{1/2}}{M}\\right)^{b_1} + a_2\\!\\left(\\frac{M_{1/2}}{M}\\right)^{b_2}\\right]$$

参数 $(a_1,b_1,a_2,b_2)$ 是质量依赖 barrier 的拟合系数。

- **优点**：理论正确，和 Du+17 的 merger tree 结果一致
- **缺点**：
  - 需要在 `conditional_hmf` 里新增一个函数，改写 excursion set 的 barrier
  - 工作量大，且 Du+17 的拟合公式依赖 sharp-k 滤波器，和代码现有的 top-hat 滤波器不完全兼容
  - 估计 **2-3 个月**工作量

---

'''


def main():
    lines = DOC.read_text(encoding="utf-8").split("\n")

    # 定位（1-based 行号 → 0-based 索引）
    def find(prefix):
        for i, ln in enumerate(lines):
            if ln.startswith(prefix):
                return i
        raise SystemExit(f"未找到：{prefix}")

    i_p5 = find("# 第五篇")
    i_p6 = find("# 第六篇")
    i_app = find("# 附录")

    head = lines[:i_p5]
    tail = lines[i_app:]

    new = "\n".join(head) + "\n" + NEW_PART5 + "\n".join(tail)

    # 更新扉页导航表
    old_nav = ("| **第五篇** | HMF 处理方案（**历史存档**：核心结论已被推翻） | 历史 |\n"
               "| **第六篇** | MCG 建模方案（**历史存档**：方案 2 已回退） | 历史 |")
    new_nav = ("| **第五篇** | 备选方案存档（未实施）：只改 $M_{\\rm turn}$、Du+17 完整解 | 参考 |\n"
               "\n> 已删除：原第五篇（结论与回退后的代码矛盾）、原第六篇的方案 2/3、"
               "实施建议、文件索引、附录 A 诊断——均属已作废或已被第一篇覆盖的内容。")
    if old_nav in new:
        new = new.replace(old_nav, new_nav)
    else:
        print("  [warn] 导航表未匹配，请手工核对扉页")

    DOC.write_text(new, encoding="utf-8")
    print(f"清理完成：{DOC}")
    print(f"  行数 {len(lines)} -> {len(new.split(chr(10)))}")


if __name__ == "__main__":
    main()
