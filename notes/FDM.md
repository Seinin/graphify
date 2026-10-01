# FDM 建模文档（整合版）

> 本册由原 `docs/FDM_*.md` 六份文档整合而成，内容完整保留，仅统一结构与导航。
> 整合日期：2026-09-10
>
> **2026-09-14 更新**：第三篇中与 `docs/notes/FDM_mcrit_report.md` 重复的推导与数值已迁出（该报告由原 `docs/FDM_mcrit_theory.md` 与 `docs/FDM_rcool_derivation.md` 合并而成，二者已删除）。

## 阅读导航

| 篇章             | 内容                                                                                                            | 状态 |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| **第一篇** | HMF 通道：dndm、Eq.(3)(4)(5)、excursion set 出发点、$\sigma_1$/$\sigma_2$、Liu 源码实现、对照实验、回退记录 | 现行 |
| **第二篇** | 冷却通道：CDM 拟合因子的依赖审计（A–E 分类）                                                                   | 现行 |
| **第三篇** | 分子冷却阈值 $m_{\rm crit}$ 的 FDM 迁移：保留代码角色（§1–§2）、Muñoz+22 与三效应审计（§3.3.4–3.3.5）、C 端实现方案（§7）、基础设施关系（§8–§9）、现状缺口（§10.8）、附录 A–C；**推导与数值以 `docs/notes/FDM_mcrit_report.md` 为准** | 现行 |
| **第四篇** | 一致性审计与冲突裁决、基线说明                                                                                  | 现行 |
| **第五篇** | 备选方案存档（未实施）：只改$M_{\rm turn}$、Du+17 完整解                                                      | 参考 |

> 已删除的无价值内容：原第五篇（「条件 HMF 应当加 $f_{\rm FDM}$」与 2026-09-10 回退后的代码**直接矛盾**）、
> 原第六篇的方案 2（已回退）/方案 3（不推荐）/实施建议（已作废）/文件索引/重复参考文献/
> 附录 A 诊断（已被第一篇 §8 修正）。正确结论见第一篇 §8–§9。

## 核心结论速览

1. **FDM 的 dndm = 用 CDM σ 算出的 CDM dndm × $f_{\rm FDM}(m)$**。σ 恒用 CDM，
   FDM 效应由 $f_{\rm FDM}$ 表达（唯一例外：条件 HMF 的 $\sigma_2$ 用 FDM σ）。
2. **全局（无条件）路径**：本仓库与 Liu+25 源码**严格一致**（实测中位相对误差 $3\times10^{-13}$），
   故功率谱与无条件 HMF 的复现结果必然相同。
3. **条件 HMF** 已于 2026-09-10 回退对齐 Liu：不乘 $f_{\rm FDM}$、$\sigma_2$ 取 FDM σ。
4. **最大缺口是冷却通道**：$M_{\rm sol}\ll M_{\rm hm}$（$m_{22}{=}1$、$z{=}0$：$5.5\times10^6$ vs $1.6\times10^{10}$），
   冷却抑制比 HMF 截断早约 3 个量级生效，但 `mcrit_noLW` 与 SM13 仍为纯 CDM。
5. **事实基准**：Liu et al. 2025, PRD 112, 103534 + Liu 源码 `D:\v21cmFAST`
   （v3.3.1，`ps.c` 4544 行）。**禁止**用 `/home/dministrat/v21cmFAST`（重构版，4423 行）核对行号。
6. **基线**：`git tag baseline/pre-fdm` → `d8f67b76`（FDM 引入前最后一个提交）。

---

# 第一篇　HMF 通道：dndm 与条件质量函数

> 来源：`docs/FDM_dndm_report.md`　状态：**现行**

**日期**：2026-09-09
**事实基准**：Liu et al. 2025, *Phys. Rev. D* **112**, 103534（Eq.2–5）

+ Liu 源码 `D:\v21cmFAST`（v3.3.1，`ps.c` 4544 行）
  **审阅对象**：本仓库 fork（v4 开发版）
  **相关文档**：`FDM_audit_report.md`（冲突裁决与本报告的审计依据）

---

### 0. 一句话总结

```
FDM 的 dndm = [用 CDM σ 算出的 CDM dndm] × [FDM 压制因子 f_FDM(m)]
                        ↑ 恒用 CDM σ              ↑ 唯一显式表达 FDM 的地方
```

**σ 永远用 CDM 的，FDM 效应全部由 $f_{\rm FDM}(m)$ 表达。** 这是理解全部问题的钥匙。

唯一例外是条件 HMF 的 $\sigma_2$（见 §7）——它不参与坍缩统计，属环境参数，须用 FDM σ。

---

### 1. 什么是 dndm / HMF

**HMF**（Halo Mass Function）$dn/dm$：单位体积、单位质量区间内暗物质晕的数量。

- 量纲：${\rm Mpc^{-3}}\,M_\odot^{-1}$
- 等价写法：$dn/d\ln m = m\cdot dn/dm$（每对数质量区间）

在 21cmFAST 中 HMF 决定**每个质量区间有多少个晕**，是恒星形成率、电离光子产额、21cm 信号的基础输入。

#### 1.1 两种 HMF

|           | 无条件 HMF                                                                       | 条件 HMF                                            |
| --------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| 记号      | $dn/dm$                                                                        | $dn/dm\|_\delta$                                  |
| 含义      | 全宇宙平均                                                                       | 给定局部密度$\delta$ 时的晕分布                   |
| 依赖      | 只依赖$m,z$                          | 额外依赖格点$\delta$ 与条件尺度 $M$ |                                                     |
| 用途      | 全局归一化、光度函数、再电离历史 ODE                                             | 逐格点$f_{\rm coll}$/N_ion/X 射线积分、离散采样表 |
| fork 代码 | `unconditional_hmf`（`hmf.c:489`）                                           | `conditional_hmf`（`hmf.c:438`）                |

两者关系：条件 HMF 给出格点间的相对差异，无条件 HMF 提供全局归一化基准。
格点物理量 = 条件积分结果 ×（全局无条件平均 / 格点条件平均），即 mean-fixing。

---

### 2. CDM 的 dndm —— Eq.(4)

$$
\left.\frac{dn}{dm}\right|_{\rm CDM} = -\frac{\bar\rho_m}{m}\,f(\nu)\,\frac{d\ln\sigma}{dm}
$$

#### 2.1 三个因子

| 因子                                                                                                                  | 含义                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| $-\bar\rho_m/m$ | 数密度归一化（$\bar\rho_m$ 为平均物质密度；$1/m$ 把质量换成个数）。负号因 $d\ln\sigma/dm<0$ |                                                                                    |
| $d\ln\sigma/dm$                                                                                                     | σ 随质量的变化率。小质量 σ 大、大质量 σ 小                                      |
| $f(\nu)$                                                                                                            | **晕多重度函数**（multiplicity function）：峰值高度 $\nu$ 处的坍缩概率密度 |

#### 2.2 峰值高度 ν

$$
\nu \equiv \frac{\delta_c}{\sigma(m,z)},\qquad \delta_c \approx 1.686
$$

- $\nu$ 大（大质量晕 / 高红移）→ 稀有 → $f(\nu)$ 小
- $\nu$ 小（小质量晕）→ 常见

#### 2.3 多重度函数的两种选择

| 模型                        | $f(\nu)$                                                                                                        | 说明       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| Press-Schechter (PS)        | $\sqrt{2/\pi}\,\nu\,e^{-\nu^2/2}$                                                                               | 球对称坍缩 |
| **Sheth-Tormen (ST)** | $A\sqrt{2/\pi}\,[1+(a\nu^2)^{-p}]\sqrt{a}\,\nu\,e^{-a\nu^2/2}$ | 椭球坍缩，$a{=}0.73,\ p{=}0.175,\ A{=}0.353$ |            |

**Liu+25 采用 Sheth-Tormen**（论文原文："the functional form of $f(\nu)$ based on the ellipsoidal collapse model is adopted"）。

#### 2.4 代码对应

Liu 源码 `ps.c:995`（`dNdM_st`）：

```c
nuhat = sqrt(SHETH_a) * Deltac / sigma;
return (-(cosmo_params_ps->OMm)*RHOcrit/M)   /* ← -ρ̄_m/m   */
     * (dsigmadm/sigma)                      /* ← dlnσ/dm  */
     * sqrt(2./PI)*SHETH_A
     * (1. + pow(nuhat, -2*SHETH_p)) * nuhat * pow(E, -nuhat*nuhat/2.0);
                                             /* ← ST 的 f(ν) */
```

**Eq.(4) 与 FDM 完全无关**——它就是纯 CDM 的 HMF。

---

### 3. FDM 的压制 —— Eq.(3)

$$
\left.\frac{dn}{dm}\right|_{\rm FDM}(m,z) = \underbrace{\left.\frac{dn}{dm}\right|_{\rm CDM}(m,z)}_{\text{Eq.(4)}}\;\cdot\;\underbrace{\left[1+\left(\frac{m}{M_0}\right)^{\alpha}\right]^{-2.2}}_{f_{\rm FDM}(m)}
$$

#### 3.1 参数

| 参数       | 值                                                                                                                  | 含义                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| $M_0$    | $1.6\times10^{10}\,m_{22}^{-4/3}\,M_\odot$ | 特征压制尺度。$m_{22}$ 越小（轴子越轻）→ $M_0$ 越大 → 压制越强 |                           |
| $\alpha$ | $-1.1$                                                                                                            | 幂指数，**负值**    |
| 外指数     | $-2.2$                                                                                                            | Schive+16 N-body 模拟拟合 |

#### 3.2 行为（为什么压制的是小质量）

因 $\alpha=-1.1<0$：

| 区间                  | $(m/M_0)^{-1.1}$ | $f_{\rm FDM}$           | 结果                       |
| --------------------- | ------------------ | ------------------------- | -------------------------- |
| $m \gg M_0$（大晕） | $\to 0$          | $\to[1+0]^{-2.2}=1$     | **无压制，回归 CDM** |
| $m = M_0$           | $=1$             | $=2^{-2.2}\approx0.22$  | FDM 晕数约为 CDM 的 22%    |
| $m \ll M_0$（小晕） | $\to\infty$      | $\to(m/M_0)^{2.42}\to0$ | **强烈压制**         |

**物理**：FDM 的量子压力（波动力学 Jeans 尺度）阻止小尺度结构坍缩，因此小质量晕数量被压低，大质量晕不受影响。

#### 3.3 数值示例

| $m_{22}$ | $M_0\ [M_\odot]$    |
| ---------- | --------------------- |
| 0.1        | $3.45\times10^{11}$ |
| 0.5        | $4.03\times10^{10}$ |
| 1.0        | $1.60\times10^{10}$ |
| 5.0        | $1.87\times10^{9}$  |
| 10.0       | $7.43\times10^{8}$  |

#### 3.4 代码对应

fork `src/py21cmfast/src/fdm.c:51`（与 Liu `ps.c:987` 一致）：

```c
double dndm_FDM(double M) {
    double M0 = 1.6e10 * pow(cosmo_params_global->m22, -4./3);
    return pow((1. + pow(M/M0, matter_options_global->HMF_FINDEX)), -2.2);
    /*                                    HMF_FINDEX = -1.1 = α          */
}
```

> **注释误导已修正**：fork `fdm.c:47` 原注释写 "Applies the high-mass cutoff"，
> 但 $\alpha=-1.1<0$ 压制的是**小质量**晕。2026-09-09 审计中已改为 low-mass suppression。

---

### 4. 组合规则：CDM σ + $f_{\rm FDM}$（为什么不能双重计数）

#### 4.1 规则

计算 Eq.(4) 的 CDM HMF 时，**σ 必须用 CDM 的**（不含 $T_F$ 截断）。

#### 4.2 为什么

$f_{\rm FDM}$ 是 Schive+16 用 N-body 模拟拟合的**比值**：

$$
f_{\rm FDM}(m) = \frac{(dn/dm)_{\rm FDM}^{\rm 模拟}}{(dn/dm)_{\rm CDM}^{\rm 理论}}
$$

分母是 **CDM HMF**。所以：

| σ 的选择                                               | Eq.(4) 的结果  | 再乘$f_{\rm FDM}$ | 判定 |
| ------------------------------------------------------- | -------------- | ------------------- | ---- |
| CDM σ                                                  | 真正的 CDM HMF | 正确                | ✅   |
| FDM σ（含$T_F$，σ 更小 → ν 更大 → HMF 已被压低） | 已被压低       | **压了两次**  | ❌   |

#### 4.3 代码体现

| 代码                                    | 位置                     | FDM 模式行为                     |
| --------------------------------------- | ------------------------ | -------------------------------- |
| fork`EvaluateSigma`                   | `interp_tables.c:1210` | 返回`Sigma_InterpTable_CDM` ✅ |
| Liu`dNdM_st` 的 σ 分支               | `ps.c:1005-1011`       | 用`Sigma_InterpTable_CDM` ✅   |
| Liu`dNdM_conditional` 的 $\sigma_1$ | `ps.c:2255`            | 用`Sigma_InterpTable_CDM` ✅   |

**两边一致，都是对的。**

---

### 5. 无条件 vs 条件 HMF 的 FDM 版

#### 5.1 无条件

直接套 Eq.(3)：

$$
\left.\frac{dn}{dm}\right|_{\rm FDM}^{\rm global} = \left.\frac{dn}{dm}\right|_{\rm CDM}^{\rm global}\big(\nu_{\rm CDM}\big)\times f_{\rm FDM}(m)
$$

代码（fork `hmf.c:509`）：

```c
if (matter_options_global->FDM) {
    result *= dndm_FDM(exp(lnM));
}
```

#### 5.2 条件

条件 HMF 多一个环境维度，标准 EPS 形式：

$$
\left.\frac{dn}{dm}\right|_{\delta} \propto \frac{\delta_1-\delta_2}{D}\cdot\frac{2\sigma_1|d\sigma_1/dm|}{(\sigma_1^2-\sigma_2^2)^{3/2}}\cdot\exp\!\left[-\frac{(\delta_1-\delta_2)^2}{2D^2(\sigma_1^2-\sigma_2^2)}\right]
$$

可写成 peak height 形式 $\nu_{\rm cond}^2 = \dfrac{(\delta_1-\delta_2)^2}{\sigma_1^2-\sigma_2^2}$。

FDM 版：

$$
\boxed{\left.\frac{dn}{dm}\right|_{\rm FDM}^{\rm cond} = \underbrace{\left.\frac{dn}{dm}\right|_{\rm CDM}^{\rm cond}\big(\nu_{\rm Eq.(5)}\big)}_{\text{条件版，ν 按 Eq.(5) 取}} \times f_{\rm FDM}(m)}
$$

**形式与无条件完全一样**：CDM dndm × $f_{\rm FDM}$。
区别只在于那个「CDM dndm」是**条件版**的，且 ν 按 Eq.(5) 取。

---

### 6. 条件 HMF 的出发点与 $\sigma_1$、$\sigma_2$

#### 6.1 理论出发点：excursion set（随机游走）

条件 HMF 出自 Bond et al. (1991) 的 **excursion set** 形式体系
（Lacey & Cole 1993 给出条件质量函数）。

**设定**：用尺度 $R$ 平滑线性密度场，得 $\delta_R$，其方差 $\sigma^2(R)$。
当 $R$ 由大变小（等价质量 $M$ 由大变小），$\sigma^2$ 单调**递增**——
因为小尺度包含更多功率。

把 $\delta_R$ 看成随"方差距离" $\sigma^2$ 演化的**随机游走**（布朗运动）：

|                      | 起点                                                                                                                                              | 问题 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **无条件 HMF** | 从原点$(0,\,0)$ 出发             | 首次穿越壁垒$\delta_c$ 发生在哪个 $\sigma^2(m)$？→ 晕质量 $m$                                         |      |
| **条件 HMF**   | 从$(\sigma_2^2,\,\delta_0)$ 出发 | 已知环境尺度$M$ 处密度超标为 $\delta_0$，继续向小尺度走，首次穿越 $\delta_c$ 的尺度？→ 子晕质量 $m$ |      |

**条件 HMF 的"条件"就体现在起点不是原点**——环境的涨落已经实现、被固定为 $\delta_0$，
不再是随机的。

#### 6.2 转移概率 → 条件 HMF 公式

从 $(\sigma_2^2,\delta_0)$ 出发，在方差距离 $\Delta\sigma^2=\sigma_1^2-\sigma_2^2$ 内
首达 $\delta_c$ 的概率，就是布朗运动的转移概率：

$$
f(\delta_c,\sigma_1^2\mid\delta_0,\sigma_2^2)=\frac{1}{\sqrt{2\pi(\sigma_1^2-\sigma_2^2)}}\exp\!\left[-\frac{(\delta_c-\delta_0)^2}{2(\sigma_1^2-\sigma_2^2)}\right]
$$

配上质量权重 $|d\sigma_1^2/dm|$，得到条件质量函数（PS 形式）：

$$
\left.\frac{dn}{dm}\right|_{\delta} \propto \frac{\delta_c-\delta_0}{D}\cdot\frac{2\sigma_1|d\sigma_1/dm|}{(\sigma_1^2-\sigma_2^2)^{3/2}}\cdot\exp\!\left[-\frac{(\delta_c-\delta_0)^2}{2D^2(\sigma_1^2-\sigma_2^2)}\right]
$$

#### 6.3 $\sigma_1$ 与 $\sigma_2$ 分别表征什么

|                            | 数学定义                                          | **物理表征**                                                       |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| $\sigma_1^2=\sigma^2(m)$ | 用**晕质量** $m$ 对应尺度平滑的密度场方差 | **晕自身尺度**的涨落总幅度——决定坍缩有多"难"                     |
| $\sigma_2^2=\sigma^2(M)$ | 用**条件尺度** $M$ 平滑的密度场方差       | **环境已实现**的那部分涨落——已由 $\delta_0$ 固定，不再是随机的 |

**两者之差才是关键量**：

$$
\boxed{\Delta\sigma^2 \equiv \sigma_1^2-\sigma_2^2}
$$

= 从尺度 $M$ 走到尺度 $m$ 之间**新增的小尺度功率**（方差增量）。

它度量的是：**在环境给定的基础上，还需要多少额外涨落，质量为 $m$ 的晕才能坍缩。**

对应地，peak height 就是"跨越难度"：

$$
\nu_{\rm cond}^2 = \frac{(\delta_c-\delta_0)^2}{\sigma_1^2-\sigma_2^2}
= \frac{(\text{还需跨越的高度})^2}{(\text{可用的方差距离})}
$$

分母越小（$\Delta\sigma^2$ 小）→ $\nu_{\rm cond}$ 越大 → 越难形成 → 条件 HMF 越小。

#### 6.4 为什么必须 $m<M$

$\sigma^2$ 随尺度减小而**增大**，故：

- $m<M$ → $\sigma_1^2>\sigma_2^2$ → $\Delta\sigma^2>0$ → 公式有意义
- $m>M$ → $\sigma_1^2<\sigma_2^2$ → 分母为负 → 无意义

**物理**：子晕不可能比它所在的父区域更大。这也是代码里积分上限取 $M_{\rm cond}$ 的原因。

#### 6.5 随机游走图像（示意）

```
  δ
  │                              ┄┄┄┄ δ_c  ← 坍缩壁垒
  │                          ╱
  │                      ╱          ← 从 (σ₂², δ₀) 出发继续游走
  │                  ╱
  │      ● (σ₂², δ₀)                ← 起点：环境已实现
  │      │
  │      │                          ← 已固定，不再随机
  │   ╱──┘
  │ ╱                               ← 从原点出发的部分（无条件情形）
  └──┴──────────────────────────────→ σ²
     0   σ₂²(M)        σ₁²(m)
         └──── Δσ² ────┘
         还需跨越的方差距离
```

**无条件**情形：游走从 $(0,0)$ 出发，$\sigma_2=0,\ \delta_0=0$，
$\nu^2=\delta_c^2/\sigma^2(m)$ —— 正是 §2.2 的定义。**条件 HMF 是无条件的推广。**

#### 6.6 21cmFAST 中的具体对应

| 符号                                                                                                  | 在 21cmFAST 中                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| $M$（条件尺度） | 格点暗物质质量$M_{\rm cond}=\rho_{\rm crit,0}\Omega_m V_{\rm cell}/N_{\rm pix}$ |                                                  |
| $\delta_0$                                                                                          | 该格点的密度超标（来自密度场）                   |
| $m$             | 子晕质量，积分范围$[M_{\rm min},\ M_{\rm cond}]$                                |                                                  |
| $\sigma_2$                                                                                          | `EvaluateSigma(log(M_cond))` —— 每格点一个值 |
| $\sigma_1$      | 被积函数内，随积分变量$\ln M$ 变化                                              |                                                  |

即：**给定每个格点的密度，算出该格点内的晕分布**。
这是逐格点 $f_{\rm coll}$ / N_ion / X 射线积分与离散采样的核心输入。

#### 6.7 FDM 下三者如何取值（对应 Eq.(5)）

| 量                                                                                                                               | 取值                              | 理由                        |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------- |
| 分子$\delta_c-\delta_{\rm FDM}$                                                                                                | 用**FDM 场**的 $\delta_0$ | 环境就是真实的 FDM 密度场   |
| $\sigma_1^2=\sigma^2_{\rm CDM}(m)$ | **CDM**                     | 晕坍缩统计走 CDM 基准，避免与$f_{\rm FDM}$ 双重计数 |                                   |                             |
| $\sigma_2^2=\sigma^2_{\rm FDM}(M)$                                                                                             | **FDM**                     | 环境尺度的涨落属真实 FDM 场 |

于是方差增量为

$$
\Delta\sigma^2 = \sigma^2_{\rm CDM}(m)-\sigma^2_{\rm FDM}(M)
$$

**物理直觉**：

- 环境这端（$\sigma_2$）用真实 FDM 场——FDM 的 $T_F$ 压制了小尺度功率，
  故 $\sigma_{\rm FDM}(M)<\sigma_{\rm CDM}(M)$
- 晕坍缩这端（$\sigma_1$）保持 CDM 基准，FDM 压制由 $f_{\rm FDM}(m)$ 单独表达

**关键**：$\sigma_2$ 只描述环境、不参与坍缩统计，因此**不会**与 $f_{\rm FDM}(m)$ 重叠——
这正是「σ₁ 用 CDM、σ₂ 用 FDM」不矛盾的根本原因（详见 §7.2）。

---

### 7. Eq.(5)：FDM 的条件 HMF ansatz

论文原文：

> "We will work with the ansatz where the peak height variable that affects the FDM HMF in Eq. (3) **via the $(dn/dm)|_{\rm CDM}$ term** should be written as

$$
\nu^2 = \frac{[\delta_c - \delta_{\rm FDM}(z)]^2}{\sigma^2_{\rm CDM}(m,z) - \sigma^2_{\rm FDM}(M,z)}
$$

> where $m$ is the halo mass, $M$ is the total mass within the comoving volume under consideration, $\delta_{\rm FDM}(z)$ is the linear-theory FDM overdensity within this volume at redshift $z$, and $\sigma^2_{\rm FDM}(M,z)$ is the variance of the linear-theory FDM density field smoothed on mass scale $M$."

论文自述闭合性：

> "On very large scales ($M\to\infty$), the density-modulated HMF resulting from this ansatz reduces to the global average, Eq. (3), as expected."

#### 7.1 三要素

| 位置                   | 取值                                                            | 理由                          |
| ---------------------- | --------------------------------------------------------------- | ----------------------------- |
| **分子**         | $\delta_{\rm FDM}$                                            | 环境就是真实的 FDM 线性密度场 |
| **$\sigma_1$** | $\sigma_{\rm CDM}(m)$ | 避免与$f_{\rm FDM}$ 双重计数（§4） |                               |
| **$\sigma_2$** | $\sigma_{\rm FDM}(M)$                                         | 环境尺度的涨落是真实 FDM 场   |

论文总结句：

> "the density-modulated environmental effects are treated using **the actual FDM linear density field**, indicated by **the second terms** in both the numerator and the denominator"

（「第二项」= 分子第二项 $\delta_{\rm FDM}$ 与分母第二项 $\sigma^2_{\rm FDM}(M)$）

#### 7.2 核心辨析：σ₁ 用 CDM 与 σ₂ 用 FDM 为什么不矛盾

两条规则作用于**不同对象**：

|                                                                                                                                                                                                                                                            | 角色 | 取值 | 为什么 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ------ |
| $\sigma_1$                                                                                                                                               | 晕坍缩统计 | **CDM** | 若用 FDM σ，Eq.(4) 本身已被压低，再乘$f_{\rm FDM}$ = 双重计数 |      |      |        |
| $\sigma_2$ | 环境参数 | **FDM** | 与坍缩统计无关；$f_{\rm FDM}$ 是 $m$ 的函数，而 $\sigma_2$ 在给定 $M$ 时是常数，两者**不可能重叠**                                                                                                 |      |      |        |

**判据**：凡是参与「晕形成概率」的量 → 走 CDM 基准；
凡是描述「环境场本身」的量 → 用真实 FDM 场。

#### 7.3 分子 $\delta_{\rm FDM}$ 在代码中自动满足

FDM 模式下 ICs 由含 $T_F$ 的功率谱生成（fork `cosmology.c:297-300`）：

```c
// FDM: multiply by T_F(k)^2 transfer function cutoff
if (matter_options_global->FDM) {
    p *= T_F(k) * T_F(k);
}
```

因此格点的 `curr_dens` **本身就是 FDM 场的 δ**，无需额外处理。

---

### 8. Liu 源码的实现（代码级）

Liu 的处理很巧妙：**$\sigma_2$ 处一行 FDM 代码都没有，却自动正确**。

#### 8.1 两张 σ 表

| 表                            | 由谁计算                                  | CDM 模式 | FDM 模式                       |
| ----------------------------- | ----------------------------------------- | -------- | ------------------------------ |
| `Sigma_InterpTable`（主表） | `sigma_z0`（用 `power_in_k`）         | CDM σ   | **FDM σ（含 $T_F$）** |
| `Sigma_InterpTable_CDM`     | `sigma_z0_pre`（用 `power_in_k_cdm`） | CDM σ   | CDM σ                         |

建表：`ps.c:1694`（`Sigma_InterpTable_CDM[i] = sigma_z0_pre(...)`）
配套 CDM 功率谱：`ps.c:310`（`power_in_k_cdm`）

> **命名反直觉**：主表在 FDM 模式下是 FDM σ，反而是带 `_CDM` 后缀的表才是纯 CDM σ。

#### 8.2 $\sigma_1$：显式切 CDM 表

`ps.c:2251-2256`：

```c
if(!user_params_ps->FDM) {
    sigma1 = Sigma_InterpTable[...];       // CDM 模式：主表（=CDM σ）
} else {
    sigma1 = Sigma_InterpTable_CDM[...];   // FDM 模式：显式切 CDM 表
}
```

→ **$\sigma_1$ 在两种模式下恒为 CDM σ** ✅

#### 8.3 $\sigma_2$：直接读主表

`ps.c:2845`（另有 2930 / 3072 / 3397 / 3507）：

```c
sigma2 = Sigma_InterpTable[MassBin] + ( Mmax - MassBinLow )*(...) *inv_mass_bin_width;
```

→ CDM 模式 = CDM σ；**FDM 模式 = FDM σ（含 $T_F$）** ✅

#### 8.4 小结

```
σ₁：显式切 _CDM 表  → 恒为 CDM σ           （防双重计数）
σ₂：直接用主表      → FDM 模式自动为 FDM σ  （真实环境场）
δ ：由 ICs 自动是 FDM 场
× f_FDM：           → Liu 代码此处缺失（见 §9）
```

**这个设计完全符合 Eq.(5)。**

---

### 9. fork 现状与偏离

> **【2026-09-10 回退】** 本节已按 Liu 源码逻辑回退，当前条件 HMF 与 Liu **严格一致**。
> 回退内容见 §9.6。以下为回退后的状态。

#### 9.1 当前状态（回退后）

| 项                                      | 状态               | 位置                                                                     |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| $\sigma_1$ = CDM σ                   | ✅                 | `EvaluateSigma`→`Sigma_InterpTable_CDM`（`interp_tables.c:1210`） |
| **$\sigma_2$ = FDM σ**         | ✅**已修复** | `EvaluateSigmaConditional`（`interp_tables.c:1252`），7 处调用       |
| 分子$\delta_{\rm FDM}$                | ✅                 | `cosmology.c:297-300`                                                  |
| 无条件 HMF ×$f_{\rm FDM}$            | ✅                 | `hmf.c`（`unconditional_hmf`）                                       |
| **条件 HMF 不乘 $f_{\rm FDM}$** | ✅**已回退** | `hmf.c`（`conditional_hmf`）——与 Liu 一致                          |

**结论：全局路径与条件路径现在均与 Liu 原码一致，无偏离。**

#### 9.2 唯一偏离：$\sigma_2$ 退化为 CDM σ

fork 把 σ 取值统一到一个函数（`interp_tables.c:1206-1217`）：

```c
double EvaluateSigma(double lnM) {
    if (matter_options_global->USE_INTERPOLATION_TABLES > 0) {
        // FDM: use CDM-reference sigma table (no T_F cutoff) for HMF calculations
        if (matter_options_global->FDM)
            return EvaluateRGTable1D_f(lnM, &Sigma_InterpTable_CDM);   // 一律 CDM σ
        return EvaluateRGTable1D_f(lnM, &Sigma_InterpTable);
    }
    if (matter_options_global->FDM) return sigma_z0_pre(exp(lnM));
    return sigma_z0(exp(lnM));
}
```

$\sigma_1$ 与 $\sigma_2$ **共用此函数**（调用点 `interp_tables.c:317/435/518/599/632/692/741` 共 7 处），
故 $\sigma_2$ 也被强制成 CDM σ —— 而 Liu 原码中 $\sigma_2$ **从不走这个切换**。

同源函数 `EvaluatedSigmasqdm`（`interp_tables.c:1219-1231`）有同样分支。

#### 9.3 三方对照

| 要素                     | Liu 论文 | Liu 代码`D:\v21cmFAST` |          fork          |
| ------------------------ | :------: | :----------------------: | :---------------------: |
| $\sigma_1$=CDM σ      |   要求   |     ✅`ps.c:2255`     |           ✅           |
| $\sigma_2$=FDM σ      |   要求   |     ✅`ps.c:2845`     | **❌ 退化为 CDM** |
| 分子$\delta_{\rm FDM}$ |   要求   |            ✅            |           ✅           |
| ×$f_{\rm FDM}(m)$     |   要求   |    **❌ 缺失**    |     ✅`hmf.c:457`     |

**一句话：Liu 代码缺 $f_{\rm FDM}$，fork 补上了但丢了 $\sigma_2$。两边各缺一半。**

#### 9.4 这是重构引入的回归

v4.1.1 官方基线（`/mnt/d/21cmFAST/src/py21cmfast/src/interp_tables.c:1170-1176`）的
`EvaluateSigma` **无任何 FDM 分支**：

```c
double EvaluateSigma(double lnM) {
    if (matter_options_global->USE_INTERPOLATION_TABLES > 0) {
        return EvaluateRGTable1D_f(lnM, &Sigma_InterpTable);
    }
    return sigma_z0(exp(lnM));
}
```

因此该 FDM 分支是 FDM 移植时新增的。**性质是重构回归**，而非方案选择错误：
v4 把 σ 取值收敛到统一函数时，顺手加了「FDM 用 CDM σ」（本意服务 $\sigma_1$，正确），
却未意识到 $\sigma_2$ 需要**相反**的 FDM σ。

#### 9.5 影响量级：**实测 < 0.5%，实践上可忽略**

> **【2026-09-10 实测修正】** 本节原为粗估（曾判断"轻轴子端可能显著"）。
> 用 `train/_verify_cond_hmf_fdm.py` 实测后**予以修正**：实际影响远小于粗估。

**定性方向**：$\sigma_{\rm FDM}(M)<\sigma_{\rm CDM}(M)$（$T_F$ 压制小尺度功率）
→ 用偏大的 $\sigma_2$ → $(\sigma_1^2-\sigma_2^2)$ 偏小
→ 指数项压得更低 → 条件 HMF 被**额外压低**。

**实测设置**：HII_DIM=64、BOX_LEN=200 → $M_{\rm cond}=1.21\times10^{12}M_\odot$，$z=15$。
对比三种配置：

| 配置                                 | $\sigma_2$ | $\times f_{\rm FDM}$ | 说明                           |
| ------------------------------------ | ------------ | ---------------------- | ------------------------------ |
| **A**（fork **回退前**） | CDM σ       | ✅                     | 2026-09-10 已回退，见 §9.7    |
| **B**（Liu 原码等效）          | FDM σ       | ❌                     | **当前 fork 采用此配置** |
| **C**（论文 Eq.3+5 完整解）    | FDM σ       | ✅                     | 严格按论文，未采用             |

**实测结果**：

| $m_{22}$ | $M_0$              | $\sigma_2$ 相对差异 | A/C 净偏差（晕总数密度） |
| ---------- | -------------------- | --------------------- | ------------------------ |
| 10.0       | $7.4\times10^{8}$  | −0.0008 %            | **1.0000**         |
| 1.0        | $1.6\times10^{10}$ | −0.0323 %            | **0.9999**         |
| 0.5        | $4.0\times10^{10}$ | −0.0983 %            | **0.9997**         |
| 0.1        | $3.5\times10^{11}$ | −1.4926 %            | **0.9950**         |

**结论**：

1. **配置 A（回退前 fork）相对论文完整解 C 的净偏差 < 0.5%**（所有 $m_{22}$），
   $m_{22}\ge1$ 时 < 0.01%。
   → $\sigma_2$ 退化是**真实但影响极小**的技术偏离，**不构成实践问题**。
   （2026-09-10 已回退到配置 B，见 §9.7。）
2. 原因：$M_{\rm cond}$（格点质量，通常 $\gtrsim10^{11}M_\odot$）远大于 FDM 压制尺度，
   在此尺度上 $T_F$ 截断几乎不起作用，$\sigma_{\rm FDM}\approx\sigma_{\rm CDM}$。
3. 仅在**单点小质量端**可见偏差（$m_{22}=0.1$、$M/M_{\rm cond}=0.02$ 时 A/C≈0.70），
   但这些质量对总晕数的贡献极小，净效应被摊薄。
4. 作为对照，**B/C = $1/f_{\rm FDM}(M)$**——Liu 原码缺失 $f_{\rm FDM}$ 在压制区
   可导致条件 HMF 高估达数个量级（远超 $\sigma_2$ 的影响）。
   即：**$f_{\rm FDM}$ 才是主导项，$\sigma_2$ 是次要项。**

> **优先级修正**：fork 已具备主导项 $f_{\rm FDM}$（§9.1），
> 缺失的是次要项 $\sigma_2$。因此 fork 在实践上**与论文完整解几乎等价**，
> 无需为 $\sigma_2$ 紧急修改代码。若追求严格符合 Eq.(5)，再按 §9.6 修复即可。

复现命令：

```bash
.venv/bin/python train/_verify_cond_hmf_fdm.py
```

#### 9.6 修复方式（不能简单删分支）

```c
double EvaluateSigma(double lnM);             // σ₁：FDM 下返回 CDM σ（现有逻辑，保留）
double EvaluateSigmaConditional(double lnM);  // σ₂：始终读主表（FDM 下自动为 FDM σ）
```

再把 7 处 $\sigma_2$/$\sigma_{\rm cond}$ 的调用改用 `EvaluateSigmaConditional`。

**切勿**直接删掉 `EvaluateSigma` 的 FDM 分支——那会破坏 $\sigma_1$ 的正确行为。

---

#### 9.7 回退记录（2026-09-10）：条件 HMF 对齐 Liu

**决策**：条件 HMF 回退到与 Liu 原码一致（不乘 $f_{\rm FDM}$、$\sigma_2$ 用 FDM σ）。

**当初这么改的理由**（出处：`docs/FDM_MCG_modeling.md` §3 方案 2，114–125 行）：

> 答案是**有，而且是物理自洽的**（见附录 A.2）：
>
> - `f_FDM(M)` 是 Schive+16 拟合的 FDM/CDM HMF 比值，**完整吸收一切 FDM 效应**
> - 条件 HMF 和无条件 HMF 描述**同一个物理过程**——halo collapse——只是前者多了环境约束
> - FDM 量子压力对 halo collapse 的抑制是**普适的、不依赖环境的**
> - 因此 $f_{\rm FDM}(M)$ 适用于**任何 CDM HMF 基准**
>
> 对比：若说"ST 参数是为无条件 HMF 拟合的，用来构造 ST 条件 HMF 没依据"——说不通，
> 因为条件 ST 解析导出自无条件 ST。**f_FDM 同理**。

配套依据在 §4（176、179 行）：列为"短期立即可做"，理由含"Jones+21 和 Liu+25 在**无条件路径**已验证"——
即当时是**从无条件路径类推到条件路径**；文档 §5 亦坦承这是"文献上没有先例的事"。

**回退依据**：该论证物理上有其道理，但与 Liu 源码实现不一致；且实测表明两种配置
在全局量上被 mean-fixing 完全对齐（§13.2），仅在起伏量有 11–29% 差异。
为与参考实现严格对齐，按 Liu 逻辑回退。

**改动清单**：

| 文件                                                 | 改动                                                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/py21cmfast/src/hmf.c`                         | `conditional_hmf` 移除 `result *= dndm_FDM(exp(lnM))`，改为详尽注释记录原理由与回退依据                                                                               |
| `src/py21cmfast/src/interp_tables.c`               | **新增** `EvaluateSigmaConditional()`（始终读主表 → FDM 模式下为 FDM σ）；7 处 $\sigma_2$/$\sigma_{\rm cond}$ 调用改用之（`317/435/518/599/632/692/741`） |
| `src/py21cmfast/src/interp_tables.h`               | 声明`EvaluateSigmaConditional`                                                                                                                                          |
| `src/py21cmfast/src/_functionprototypes_wrapper.h` | 声明`EvaluateSigmaConditional`                                                                                                                                          |

$\sigma_1$（`dNdM_conditional_EPS` 内 `hmf.c:288`）**保持不变**，仍走 `EvaluateSigma`（FDM→CDM 表），
避免与 Eq.(5) 要求冲突。

**验证**：编译通过（exit 0），`.so` 已同步至 `src/py21cmfast/`；
实测 $\sigma_2^{\rm FDM}=2.152282$ vs $\sigma_2^{\rm CDM}=2.152299$（差 −0.0008%），
`conditional_hmf` 返回值已不含 $f_{\rm FDM}$。

**回退后条件路径三要素**（与 Liu 一致）：

$$
\sigma_1=\sigma_{\rm CDM}(m),\qquad \sigma_2=\sigma_{\rm FDM}(M),\qquad
\nu^2=\frac{[\delta_c-\delta_{\rm FDM}]^2}{\sigma_1^2-\sigma_2^2},\qquad
\text{不乘 } f_{\rm FDM}
$$

---

### 10. 速查表

| 问题                                                                           | 答案                                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| FDM 的 dndm 怎么算？                                                           | CDM dndm（**用 CDM σ**）× $f_{\rm FDM}(m)$       |
| σ 用 CDM 还是 FDM？                                                           | **CDM**（唯一例外：条件 HMF 的 $\sigma_2$ 用 FDM） |
| 为什么不用 FDM σ？                                                            | 会与$f_{\rm FDM}$ 双重计数                               |
| $f_{\rm FDM}$ 压制大质量还是小质量？ | **小质量**（$\alpha=-1.1<0$） |                                                            |
| 条件 HMF 要不要乘$f_{\rm FDM}$？                                             | **要**（Eq.(3) 要求；且闭合性严格成立）              |
| $\sigma_1$ 用什么？                                                          | CDM σ                                                     |
| $\sigma_2$ 用什么？                                                          | FDM σ（fork 当前退化为 CDM，是唯一偏离）                  |
| 分子 δ 用什么？                                                               | FDM 场的 δ（代码自动满足）                                |
| md 的行号引用准确吗？                                                          | **准确**（以 `D:\v21cmFAST` ps.c 4544 行为准）     |
| 基线在哪？                                                                     | `git tag baseline/pre-fdm` → `d8f67b76`               |

---

### 11. 常见误区

| 误区                                                                                                                                                                                                                                                                                                  | 纠正                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 「$f_{\rm FDM}$ 是压制大质量晕的」 | 错。$\alpha=-1.1<0$，压制**小质量**晕                                                                                                                                                                                                                  |                                                                                                                                                |
| 「条件 HMF 乘$f_{\rm FDM}$ 会破坏闭合关系」 | 错。$f_{\rm FDM}(M)$ 只依赖 $M$、不依赖 $\delta$，可提出 $\delta$ 平均之外：$\langle$cond$_{\rm CDM}\times f\rangle_\delta=f\times\langle$cond$_{\rm CDM}\rangle_\delta=f\times$uncond$_{\rm CDM}=$uncond$_{\rm FDM}$，闭合严格成立 |                                                                                                                                                |
| 「σ₁ 用 CDM、σ₂ 用 FDM 是 bug」                                                                                                                                                                                                                                                                   | 错。这正是 Eq.(5) 的明确要求                                                                                                                   |
| 「σ₁ 和 σ₂ 应统一为 CDM σ」                                                                                                                                                                                                                                                                      | 错。$\sigma_2$ 必须是 FDM σ                                                                                                                 |
| 「FDM 效应主要来自 HMF」                                                                                                                                                                                                                                                                              | 不准确。$M_{\rm sol}\ll M_{\rm hm}$（$m_{22}{=}1$、$z{=}0$：$5.5\times10^6$ vs $1.6\times10^{10}$），**冷却通道才是主导，且目前完全缺失** |
| 「用`/home/dministrat/v21cmFAST` 核对 Liu 行号」                                                                                                                                                                                                                                                    | 错。那是本仓库重构版（`1945bf0`，4423 行，含独立 `fdm.c`），要用 `D:\v21cmFAST`（4544 行）                                               |

---

### 12. 代码索引

#### Liu 源码 `D:\v21cmFAST`（v3.3.1，`ps.c` 4544 行）

| 符号                                           | 位置                                          |
| ---------------------------------------------- | --------------------------------------------- |
| `dndm_FDM`                                   | `ps.c:987`                                  |
| `dNdM_st`                                    | `ps.c:995`                                  |
| `dNdM_st_F`（= `dNdM_st` × `dndm_FDM`） | `ps.c:1032-1034`                            |
| `power_in_k_cdm`                             | `ps.c:310`                                  |
| `dNdM_conditional`                           | `ps.c:2240-2286`                            |
| $\sigma_1$ 的 FDM 分支                       | `ps.c:2251-2256`                            |
| $\sigma_2 = $`Sigma_InterpTable[...]`        | `ps.c:2845`（另 2930 / 3072 / 3397 / 3507） |
| `Sigma_InterpTable_CDM` 建表                 | `ps.c:1684, 1694`                           |

#### 本仓库 fork

| 符号                                            | 位置                                                     |
| ----------------------------------------------- | -------------------------------------------------------- |
| `T_F`                                         | `src/py21cmfast/src/fdm.c:35`                          |
| `dndm_FDM`                                    | `src/py21cmfast/src/fdm.c:51`                          |
| `sigma_z0_pre` / `dsigmasqdm_z0_pre`        | `fdm.c:92` / `fdm.c:150`                             |
| `conditional_hmf`（含 ×`dndm_FDM`）        | `src/py21cmfast/src/hmf.c:438-462`（**未提交**） |
| `unconditional_hmf`（含 ×`dndm_FDM`）      | `src/py21cmfast/src/hmf.c:509`                         |
| $T_F$ 接入功率谱                              | `src/py21cmfast/src/cosmology.c:297-300`               |
| `EvaluateSigma`                               | `src/py21cmfast/src/interp_tables.c:1206-1217`         |
| `EvaluatedSigmasqdm`                          | `interp_tables.c:1219-1231`                            |
| $\sigma_2$/$\sigma_{\rm cond}$ 调用（7 处） | `interp_tables.c:317/435/518/599/632/692/741`          |
| Python 参数`m22` / `FDM` / `HMF_FINDEX`   | `src/py21cmfast/wrapper/inputs.py:456 / 687 / 689`     |

#### 基线

```
git tag baseline/pre-fdm  →  d8f67b76   (FDM 引入前最后一个提交)
git diff baseline/pre-fdm -- src/py21cmfast/src/      # FDM 全部改动（含工作区）
```

---

### 13. 对照实验：为什么 fork 与 Liu 的结果一致？

> **【2026-09-10 实验记录】** 本节回答一个实证问题：
> fork 改了条件 HMF（加了 $f_{\rm FDM}$、$\sigma_2$ 退化为 CDM σ），
> 为何复现 Liu 论文上游结果（功率谱、HMF）时**一模一样**？

**实验脚本**：`train/_verify_fork_vs_liu.py`、`train/_verify_meanfixing.py`
**配置**：A = fork 现状（$\sigma_2$=CDM σ，$\times f_{\rm FDM}$）；
B = Liu 原码等效（$\sigma_2$=FDM σ，无 $f_{\rm FDM}$）
**固定条件**：$z=15$，BOX_LEN=200、HII_DIM=64 → $M_{\rm cond}=1.21\times10^{12}M_\odot$

#### 13.1 实验一：A/B 是 $M_{\min}/M_0$ 的普适函数

$M_0=1.6\times10^{10}m_{22}^{-4/3}$。扫描 $m_{22}$ 与积分下限 $M_{\min}$：

| $M_{\min}/M_0$ | 0.1   | 1         | 10    | 100   | 1000   |
| ---------------- | ----- | --------- | ----- | ----- | ------ |
| **A/B**    | ~0.01 | ~0.3–0.4 | ~0.90 | ~0.99 | ~0.999 |

**A/B 只依赖 $M_{\min}/M_0$，与 $m_{22}$ 本身无关**（各组数据落在同一条曲线上）。

判读：

- $M_{\min}\gg M_0$：积分区间全在 $f_{\rm FDM}\approx1$ 区域 → **A ≈ B**
- $M_{\min}\lesssim M_0$：$f_{\rm FDM}$ 的压制进入积分区间 → **A 显著小于 B**

即：**积分下限越高（相对 $M_0$），fork 与 Liu 越接近**。

#### 13.2 实验二：mean-fixing 才是"一模一样"的主因

21cmFAST 的 mean-fixing：

$$
\text{格点物理量} = \text{条件积分}(\delta)\times\frac{\text{全局无条件平均}}{\text{格点条件平均}}
$$

两者无条件路径**都含** $f_{\rm FDM}$，故分子相同。对 $\delta$ 扫描（$m_{22}{=}10$，$M_{\min}=10^9$，$M_{\min}/M_0=1.35$）：

| $\delta$     | ∫A (fork) | ∫B (Liu)  | **A/B 原始** | **A/B mean-fix 后** |
| -------------- | ---------- | ---------- | ------------------ | ------------------------- |
| −0.50         | 1.706e−07 | 4.758e−07 | 0.359              | 0.933                     |
| −0.20         | 2.115e−05 | 5.680e−05 | 0.372              | 0.969                     |
| **0.00** | 3.420e−04 | 8.901e−04 | 0.384              | **1.0000**          |
| 0.20           | 3.900e−03 | 9.785e−03 | 0.399              | 1.038                     |
| 0.50           | 7.690e−02 | 1.802e−01 | 0.427              | 1.111                     |
| 1.00           | 1.559e+00  | 3.152e+00  | 0.495              | 1.287                     |

> $\delta=2.0$ 处出现负值（条件 HMF 在大 $\delta$ 下数值失效），已排除。

**关键发现**：

1. **$\delta=0$ 处 mean-fix 后 A/B 恰好 = 1.0000**——这是 mean-fixing 的归一化锚点，
   所有全局平均量在此被强制对齐。
2. **原始条件积分差异达 60%**（A/B≈0.38），但 mean-fixing 后压缩到
   $|\delta|\le0.2$ 范围内 <4%。
3. 差异随 $|\delta|$ 增大而显现：$\delta=0.5$ 时 11%，$\delta=1$ 时 29%。

#### 13.3 结论：三层原因

| 层次                                                  | 现象                                     | 原因                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **上游量**(功率谱、无条件 HMF)                  | **完全一致**                       | 两者实现相同：$T_F$ 都接入 `power_in_k`；无条件 HMF 都乘 $f_{\rm FDM}$。这是 Liu 论文 Fig.1、Fig.2 复现成功的原因 |
| **全局平均量**(δ≈0，全局 21cm 信号、电离历史) | **完全一致**                       | mean-fixing 把条件结果锚定到无条件结果（含$f_{\rm FDM}$），归一化差异被完全吸收                                       |
| **起伏量**(高 δ 区、小尺度功率谱)              | **有差异**(δ=0.5→11%，δ=1→29%) | $f_{\rm FDM}$ 是 $M$ 依赖的形状因子，mean-fixing 只能补一个标量，补不回形状                                         |

**因此**：复现论文上游图时"一模一样"是**正确且预期的**——
那些图验证的是功率谱与无条件 HMF，本来就不涉及条件 HMF 的分歧。
分歧只在对**密度起伏敏感**的观测量上才显现，且需要 $M_{\min}\lesssim M_0$ 才显著。

#### 13.4 关于 Liu 代码

基于 §8 的证据（$dndm\_FDM$ 在 `ps.c` 仅 2 处：定义 987、$dNdM\_st\_F$ 内 1033），
Liu 条件路径未显式乘 $f_{\rm FDM}$。但由本节实验可知：

- 该缺失**不影响**论文 Fig.1/Fig.2 的上游复现（条件路径不参与）
- 对全局量，mean-fixing 会补偿归一化
- 其残余影响属"起伏形状"层面

故 Liu 代码的整体结果仍自洽，此前报告中"代码缺失"的表述应理解为
**相对论文 Eq.(3)+(5) 的严格形式而言**，而非"结果错误"。

---

### 14. 参考文献

**FDM 物理**：Liu et al. 2025, PRD 112, 103534（Eq.2–5）· Schive et al. 2016, PRL 116, 201302（$f_{\rm FDM}$）· Schive et al. 2014, Nature Phys. 10, 496（孤子核心–晕关系）· Hu, Barkana & Gruzinov 2000, PRL 85, 1158（$T_F$）· Du et al. 2017, ApJ 838, 63（FDM excursion set）

**结构形成**：Sheth & Tormen 2001, MNRAS 323, 1（ST 多重度函数）· Press & Schechter 1974, ApJ 187, 425 · Bond et al. 1991（EPS）· Lacey & Cole 1993（条件质量函数）· Barkana & Loeb 2001, Phys. Rep. 349, 125

**21cmFAST**：Mesinger, Furlanetto & Cen 2011, MNRAS 411, 955 · Park et al. 2019, MNRAS 484, 933

# 第二篇　冷却通道：CDM 拟合因子依赖审计

> 来源：`docs/FDM_cooling_report.md`　状态：**现行**

> **【2026-09-09 交叉引用】** 本报告的姊妹文档 **`docs/FDM_audit_report.md`**
> 处理的是 **HMF 通道**（条件/无条件 HMF 的 FDM 处理）与 Liu+25 论文的一致性审计。
>
> 两文的分工：
>
> - **本文（`FDM_cooling_report.md`）**：冷却链路中 CDM 校准因子的依赖审计（A–E 分类）
> - **审计报告（`FDM_audit_report.md`）**：HMF 通道的三方对照与冲突裁决
>
> 若需查证「条件 HMF 该不该乘 `dndm_FDM`」「σ 混合是否为 bug」「Liu 源码行号」等问题，
> **请直接查阅 `FDM_audit_report.md`**，本文不重复论证。

### 1. 问题陈述

21cmFAST 的气体冷却与反馈模型包含大量从 CDM 模拟中校准的经验参数。在 FDM（Fuzzy Dark Matter）下，是否需要修改这些参数？

**本报告的核心任务**：逐个核查冷却链路中每个参数的物理含义、原始论文校准背景、CDM 依赖程度，给出是否需要 FDM 修正的判定。

---

### 2. 代码冷却链路总览

```
Nion_ConditionalM_MINI = ∫ [nion_fraction × conditional_hmf] d(lnM)
                              │
        ┌─────────────────────┴──────────────────────┐
        │ nion_fraction_mini(lnM)                     │ conditional_hmf(lnM)
        │   │                                          │   │
        │   ├─ Fstar = PL(F_STAR7_MINI, α)             │   ├─ dNdM_conditional_EPS(CDM σ_ref)  [ST拟合]
        │   ├─ Fesc  = PL(F_ESC7_MINI, α)              │   └─ × dndm_FDM(exp lnM)              [FDM已实现]
        │   ├─ exp(-M/acg_thresh)                      │
        │   └─ exp(-Mturn_mcg / M)                     │
        │        │                                     │
        │        └─ Mturn_mcg = max( mcrit_RE,         │
        │                            max( mcrit_LW,    │
        │                                 mcrit_noLW)) │
        │              │                               │
        │              ├─ mcrit_noLW  = 3.314e7(1+z)^-1.5            [C类: CDM校准]
        │              ├─ mcrit_LW    = mcrit_noLW × (1+A_LW·J21^B)  [B类: CDM校准]
        │              └─ mcrit_RE    = SM13(Γ, z, z_IN)              [C类: CDM NFW校准]
        │
        └─ TtoM(z, T, μ) 贯穿全程（所有温度阈值 → 质量阈值转换）        [A类: 物理常数]
```

**关键架构认知**：`conditional_hmf`（有多少晕）和 `nion_fraction`（哪些晕发光）是独立串联的。FDM 修正只需在 HMF 层面通过 `× dndm_FDM` 完成，冷却管线中的参数需单独评估 CDM 依赖。

---

### 3. 分类标准

| 类别        | 定义                                   | 判断准则                                                                          |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| **A** | 物理常数，无模拟校准                   | 数值来自量子/分子/原子物理或宇宙学定义                                            |
| **B** | CDM 模拟校准，但描述的是 DM-无关的物理 | 函数形式描述气体化学/辐射转移/流体力学                                            |
| **C** | CDM 校准，且隐含 CDM 晕结构假设        | 校准依赖 NFW 密度轮廓等 CDM 特有属性                                              |
| **D** | 唯象参数，调参即可，无需改公式         | 描述晕内天体物理，不论 CDM/FDM 同类晕不应有系统差异，但最优值会因 dndm_FDM 而不同 |
| **E** | 物理尺度远大于 FDM 截止尺度            | FDM 量子压力影响 < 0.1%，可忽略                                                   |

---

### 4. 完整参数依赖表

#### 4.1 基础物理参数（A类）

| 参数                            | 默认值/公式                                                 | 物理来源                          | 代码路径             |
| ------------------------------- | ----------------------------------------------------------- | --------------------------------- | -------------------- |
| `TtoM(z, T, μ)`              | `7030.97/h · √(Ωm(z)/(Ωm·Δc)) · [T/(μ(1+z))]^3/2` | Virial 定理 (Barkana & Loeb 2001) | `cosmology.c:671`  |
| `deltac_nonlinear(z)`         | `18π² + 82[Ωm(z)-1] − 39[Ωm(z)-1]²`                 | 球对称坍缩 (Bryan & Norman 1998)  | `cosmology.c:658`  |
| `atomic_cooling_threshold`    | `TtoM(z, 10⁴ K, 0.59)`                                   | Lyα 激发能 10.2 eV               | `thermochem.c:278` |
| `molecular_cooling_threshold` | `TtoM(z, 600 K, 1.22)`                                    | H₂ 转动-振动冷却 = 绝热膨胀率    | `thermochem.c:280` |

> **判定**：全部不依赖 CDM。TtoM 中 Δc 的 Bryan-Norman 拟合系数虽然从 SCDM N-body 获得，但球坍模型在 FDM virial 尺度（量子压力亚主导）依旧适用，差异可忽略。

#### 4.2 LW 反馈（B/C 类）

**实现**（`thermochem.c:282`）：

$$
M_{\text{crit}}^{\text{LW}}(z) = \underbrace{3.314\times 10^7 (1+z)^{-1.5}}_{\text{mcrit\_noLW}} \times \underbrace{(1 + A_{\text{LW}} J_{21}^{B_{\text{LW}}})}_{\text{LW 倍增}} \times \underbrace{\left(1 + A_{\text{VCB}} \frac{v_{\text{cb}}}{\sigma_{\text{VCB}}}\right)^{B_{\text{VCB}}}}_{\text{VCB 倍增}}
$$

##### 论文校准链

| 论文                                                             | 贡献                                                        |      DM 模型      |
| ---------------------------------------------------------------- | ----------------------------------------------------------- | :----------------: |
| Stacy, Bromm & Loeb (2011, MNRAS 413, 172)                       | 首次 CDM+gas 分子冷却 cosmological 模拟                     |   **CDM**   |
| Greif et al. (2011, ApJ 737, 75)                                 | 同上，独立验证                                              |   **CDM**   |
| Fialkov, Barkana, Tseliakhovich & Hirata (2012, MNRAS 424, 1335) | 拟合 Stacy+11/Greif+11 模拟，给出 M_min(v_cb, z)            | **CDM 校准** |
| Visbal et al. (2015, Nature 528, 357)                            | 从 Fialkov+12 提取最优拟合：3.314×10⁷ (1+z)^(-1.5)        | **CDM 校准** |
| Schauer, Glover, Klessen & Clark (2020, MNRAS 507, 1775)         | 高分辨率 CDM+gas 模拟，发现 LW 反馈更弱（H₂ 自屏蔽被低估） |   **CDM**   |
| Muñoz et al. (2021, arXiv:2110.13919)                           | 综合多项模拟，推荐 A_LW=2.0, BETA_LW=0.6                    | **CDM 综合** |

> 代码注释 (`thermochem.c:272-278`) 原文：*"correction follows Schauer+20, fit jointly to LW feedback and relative velocities. They find weaker effect of LW feedback than before (Stacy+11, Greif+11, etc.) due to HII self shielding. this follows Visbal+15, which is taken as the optimal fit from Fialkov+12 which was calibrated with the simulations of Stacy+11 and Greif+11"*

##### 逐参数判定

| 参数           | 默认值                       |    类别    | 理由                                                                                                 | 建议                                                                             |
| -------------- | ---------------------------- | :---------: | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `mcrit_noLW` | `3.314×10⁷ (1+z)^(-1.5)` | **C** | 从 CDM NFW 晕的 H₂ 形成模拟中拟合。FDM soliton 平核需更大 M_vir 达到同等中心气体密度                | **FDM 下变化最大的参数。** 建议预留 `FDM_COOLING_BOOST` 占位（默认 1.0） |
| `A_LW`       | 2.0                          | **B** | H₂ 光解离倍增因子。光解离截面是分子物理常数，但数值来自 CDM 模拟拟合                                | 暂保留，待 FDM+gas 模拟校准                                                      |
| `BETA_LW`    | 0.6                          | **B** | 同上                                                                                                 | 同上                                                                             |
| `A_VCB`      | 1.0                          | **B** | v_cb 对气体吸积的影响是流体力学，不依赖 DM。Muñoz+21 确认 A_VCB=1.0 "agrees between different sims" | 暂保留                                                                           |
| `BETA_VCB`   | 1.8                          | **B** | 同上                                                                                                 | 暂保留                                                                           |
| `σ_VCB`     | 29.0 km/s                    | **E** | BAO 尺度（~100 Mpc）≫ FDM 截止尺度（~kpc），T_F(k) 影响 < 0.1%                                      | 不修改                                                                           |

> `inputs.py:1242-1250` 存档了两个版本：Machacek+01（A_LW=22.86, BETA_LW=0.47）和 Muñoz+21（A_LW=2.0, BETA_LW=0.6）。代码默认使用后者。

#### 4.3 再电离反馈（C 类）

**实现**（`thermochem.c:26-30,302-307`，SM13 参数化）：

$$
M_{\text{crit}}^{\text{RE}} = M_0 \times (B \cdot \Gamma_{\text{HII}})^{a} \times \left(\frac{1+z}{10}\right)^{b} \times \left[1 - \left(\frac{1+z}{1+z_{\text{IN}}}\right)^{c}\right]^{d}
$$

其中：

| 符号                                                                                                        | 代码常量          | 默认值                     | 含义                    |
| ----------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------- | ----------------------- |
| $M_0$                                                                                                     | `REION_SM13_M0` | $3\times 10^9\; M_\odot$ | 参考特征质量            |
| $a$   | `REION_SM13_A`  | 0.17                       | 电离背景$\Gamma$ 的幂律指数                    |                   |                            |                         |
| $b$                                                                                                       | `REION_SM13_B`  | −2.1                      | $(1+z)/10$ 的幂律指数 |
| $c$   | `REION_SM13_C`  | 2.0                        | 再电离进度$1-(1+z)/(1+z_{\text{IN}})$ 的内指数 |                   |                            |                         |
| $d$                                                                                                       | `REION_SM13_D`  | 2.5                        | 再电离进度项的外指数    |
| $B$                                                                                                       | `HALO_BIAS`     | 2.0                        | 晕偏置常数近似          |

##### 校准背景

| 论文                                                 | 内容                                                                                   |       DM 模型       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- | :------------------: |
| Sobacchi & Mesinger 2013, Paper I (MNRAS 432, L51)   | 球对称坍缩 +**固定 NFW 暗物质势阱** + 气体流体力学 + UVB 加热，测量 M_min(Γ, z) | **CDM NFW 势** |
| Sobacchi & Mesinger 2013, Paper II (MNRAS 432, 3340) | 将 Paper I 的 M_min 参数化引入半数值再电离模拟                                         |    **CDM**    |

**核心问题**：SM13 使用固定 NFW 势阱（尖点 ρ ∝ r⁻¹）。FDM soliton 平核 → 同一 M_vir 的中心引力势更浅 → 气体更容易被 UVB 光致蒸发吹散 → M_min 更大。

| 参数                         | 默认值        |    类别    | 理由                                                                        | 建议                |
| ---------------------------- | ------------- | :---------: | --------------------------------------------------------------------------- | ------------------- |
| M₀                          | 3×10⁹ M_sun | **C** | CDM NFW 势阱校准                                                            | FDM 下 M₀ 可能偏小 |
| a=0.17, b=-2.1, c=2.0, d=2.5 | —            | **C** | 同上                                                                        | FDM 下可能不同      |
| HALO_BIAS                    | 2.0           | **C** | 常数近似，CDM 下约 2-3。FDM 小晕被压制后有效偏置更高，但差异 < 近似本身误差 | 不修改              |

#### 4.4 晕内天体物理参数（D 类）

**D 类定义**：描述晕内部 gas → 恒星 → 辐射转换效率的参数。它们的公式本身描述的是晕内天体物理，不依赖 DM 类型——FDM 影响的是「有多少晕存在」（通过 `conditional_hmf × dndm_FDM`），而不改变「单个晕是否发光」的物理规律。

**与 C 类的本质区别**：

- **C 类**（如 mcrit_noLW）：公式是 CDM NFW 晕结构 → 气体冷却的映射，FDM soliton 平核下**这条映射本身就变了**，需要 FDM+gas 模拟重新校准公式系数。
- **D 类**（如 F_STAR10, M_TURN）：公式描述恒星形成效率等晕内物理，不论 CDM 还是 FDM 晕，同类晕的 f* 不应有系统差异。所以**公式不需要因 FDM 改写**。但由于 dndm_FDM 砍掉了小晕，同样的参数值在 FDM 下会输出更少的 Nion——如果想匹配同样的观测数据，自然会为 FDM 选一组不同的参数值。**这是手动调参的行为，不是公式层面的 FDM 修正。**

##### 代码中的角色

这些参数通过 `set_scaling_constants()` (`scaling_relations.c:36`) 写入 `ScalingConstants` 结构体，然后由 `Nion_General_MINI()` (`hmf.c:904`) 填入 `parameters_gsl_MF_integrals`，最终在 `nion_fraction_mini()` (`hmf.c:397`) 的积分核中使用：

```c
// hmf.c:397-403 — MINI 晕每对数质量区间的电离光子数
double nion_fraction_mini(double lnM, void *param_struct) {
    struct parameters_gsl_MF_integrals p = ...;
    double Fstar = log_scaling_PL_limit(lnM, p.f_star_norm, p.alpha_star, 1e7, p.Mlim_star);
    double Fesc  = log_scaling_PL_limit(lnM, p.f_esc_norm,  p.alpha_esc,  1e7, p.Mlim_esc);
    double M = exp(lnM);
    return exp(Fstar + Fesc - M / p.Mturn_upper - p.Mturn_mcg / M + lnM);
}
```

| 参数字段          | Python 参数          | 默认值                        | 在式中的角色                                                                    |     判定     |
| ----------------- | -------------------- | ----------------------------- | ------------------------------------------------------------------------------- | :-----------: |
| `p.f_star_norm` | `F_STAR7_MINI`     | `F_STAR10 − 3×ALPHA_STAR` | log f*(M=10⁷ M_sun)：分子冷却晕的恒星形成效率归一化                            |  **D**  |
| `p.alpha_star`  | `ALPHA_STAR_MINI`  | `= ALPHA_STAR`              | f*(M) ∝ M^α 的幂律指数                                                        |  **D**  |
| `p.f_esc_norm`  | `F_ESC7_MINI`      | 10⁻²                        | log f_esc(M=10⁷ M_sun)：电离光子逃逸分数                                       |  **D**  |
| `p.alpha_esc`   | `ALPHA_ESC`        | —                            | f_esc(M) 的幂律指数（与 ACG 共用）                                              |  **D**  |
| `p.Mturn_mcg`   | LW+VCB+SM13 联合计算 | 见 4.2/4.3                    | exp(−M_turn/M)：低质量端指数截断                                               | **B/C** |
| `p.Mturn_upper` | `acg_thresh`       | z-dependent (T_vir=10⁴ K)    | exp(−M/M_acg)：高质量端截断（超出分子冷却范围）                                |  **A**  |
| —                | `L_X_MINI`         | `= L_X`                     | X 射线光度 / SFR（`scaling_relations.c:62`），用于 `Xray_General()`         |  **D**  |
| —                | `M_TURN`           | 10^8.7 M_sun                  | ACG 的 SN/光加热截断质量（`scaling_relations.c:80`，仅 ACG 路径使用）         |  **D**  |
| —                | `ION_Tvir_MIN`     | 10^4.7 K                      | 电离源积分下限（`hmf.c:1262`），FDM 的影响在 HMF 中已囊括                     |  **D**  |
| —                | `F_H2_SHIELD`      | 0.0                           | H₂ 自屏蔽因子（`inputs.py:1237-1240`），分子云内部物理，与宿主晕 DM 类型无关 |  **B**  |

#### 4.5 HMF / 结构形成参数

| 参数                              | 默认值            |     类别     | 校准来源                                           |                                      判定                                      |
| --------------------------------- | ----------------- | :-----------: | -------------------------------------------------- | :----------------------------------------------------------------------------: |
| ST HMF (a=0.73, p=0.175, A=0.353) | `hmf.c:269-281` | **B/C** | Sheth & Tormen 2001, 从 Jenkins+01 CDM N-body 校准 | CDM σ + ST 拟合 + dndm_FDM 是 FDM 文献标准 (Schive+16, Du+17, Liu+25)，不修改 |
| EPS 条件质量函数                  | `hmf.c:285-298` |  **A**  | Bond+91 / Lacey & Cole 93                          |                           纯统计框架，不依赖 DM 类型                           |
| dndm_FDM                          | `fdm.c:51-55`   | **—** | Schive+16 SP 模拟                                  |                              **已实现 ✓**                              |
| HMF_FINDEX                        | -1.1              | **—** | Schive+16 拟合                                     |                              **已实现 ✓**                              |
| m22                               | —                | **—** | FDM 粒子质量                                       |                               **用户输入**                               |

> **关于 dndm_FDM 的命名**：代码注释中的 "high-mass cutoff" 是误导性的。实际负指数 -1.1 压制的是 **小质量晕**（M ≪ M₀ → f(M) → 0），应理解为 "low-mass suppression"。

---

### 5. Nion 积分链路的完整依赖标注

```
Nion_ConditionalM_MINI
  = ∫ nion_fraction_mini × conditional_hmf  d(lnM)
      │
      ├─ nion_fraction_mini(lnM):
      │    ├─ Fstar(lnM)      → F_STAR7_MINI, ALPHA_STAR_MINI    [D]
      │    ├─ Fesc(lnM)       → F_ESC7_MINI, ALPHA_ESC            [D]
      │    ├─ exp(-M/M_acg)                                       [A]
      │    └─ exp(-Mturn_mcg/M)
      │         │
      │         └─ Mturn_mcg = max( Mturn_RE, max(Mturn_LW, mcrit_noLW) )
      │              ├─ Mturn_RE  → SM13(Γ, z)                    [C]
      │              ├─ Mturn_LW  → mcrit_noLW × (1+A_LW·J21^B)  [B/C]
      │              └─ mcrit_noLW → 3.314e7(1+z)^-1.5            [C]
      │
      └─ conditional_hmf:
           ├─ dNdM_conditional_EPS(CDM σ_ref)                     [B/C]
           └─ × dndm_FDM(lnM)                                     [FDM ✓]
```

---

### 6. 结论与行动建议

#### 6.1 按优先级排序

|      优先级      | 参数                            | 类别 | 行动                                                                                                       |
| :--------------: | ------------------------------- | :--: | ---------------------------------------------------------------------------------------------------------- |
|   **P0**   | dndm_FDM                        |  —  | **已完成** — `conditional_hmf` 和 `unconditional_hmf` 均已接入                                  |
|   **P1**   | mcrit_noLW (3.314×10⁷)        |  C  | **最大不确定性** — 建议预留 `FDM_COOLING_BOOST` 乘法因子（默认 1.0），待 FDM+gas 模拟数据重新校准 |
|   **P1**   | SM13 reionization_feedback 参数 |  C  | 从 CDM NFW 势校准，FDM 平核下光致蒸发更有效，M₀ 和 a/b/c/d 可能需要重校                                   |
|   **P2**   | A_LW, BETA_LW, A_VCB, BETA_VCB  |  B  | 暂保留 CDM 校准值，待 FDM+gas 模拟验证                                                                     |
|   **P3**   | M_TURN, F_STAR7_MINI 等         |  D  | 晕内天体物理公式不需要 FDM 修正；在 FDM 下如需匹配同一组观测数据，这些参数的手动取值会与 CDM 不同          |
| **不修改** | A, E 类全部参数                 | A/E | 物理常数或尺度分离，不受 FDM 影响                                                                          |

#### 6.2 架构正确性确认

冷却管线中的两条链路是独立串联的：

- **`conditional_hmf`**：通过 `dndm_FDM` 决定了 FDM 下有多少晕存在（**一阶效应，已实现**）
- **`nion_fraction`**：决定了给定晕是否发光（冷却/反馈物理，需要评估 CDM 校准依赖）

FDM 的量子压力通过**通道 1**（减少晕的数量，dndm_FDM）已经实现。**通道 2**（soliton 平核影响单晕冷却效率）目前没有公认模型，体现在 C 类参数的不确定性中。

---

### 参考文献

**FDM 物理**：Schive et al. 2016, Nature Physics 12, 191 · Hu, Barkana & Gruzinov 2000, PRL 85, 1158 · Liu et al. 2025 · Du et al. 2017, MNRAS 465, 941

**CDM 冷却/反馈校准**：Machacek, Bryan & Abel 2001, ApJ 548, 509 · Stacy, Bromm & Loeb 2011, MNRAS 413, 172 · Greif et al. 2011, ApJ 737, 75 · Fialkov et al. 2012, MNRAS 424, 1335 · Visbal et al. 2015, Nature 528, 357 · Schauer et al. 2020, MNRAS 507, 1775 · Muñoz et al. 2021, arXiv:2110.13919 · Qin et al. 2020

**CDM 再电离反馈**：Sobacchi & Mesinger 2013 (Paper I), MNRAS 432, L51 · Sobacchi & Mesinger 2013 (Paper II), MNRAS 432, 3340

**CDM 结构形成/宇宙学**：Barkana & Loeb 2001, Phys. Rept. 349, 125 · Bryan & Norman 1998, ApJ 495, 80 · Jenkins et al. 2001, MNRAS 321, 372 · Sheth & Tormen 2001, MNRAS 323, 1 · Tseliakhovich & Hirata 2010, PRD 82, 083520

**21cmFAST**：Park et al. 2018, MNRAS 484, 933

# 第三篇　分子冷却阈值 mcrit 的 FDM 迁移

> 来源：`docs/FDM_mcrit_algorithm.md`　状态：**现行**

### 1. 问题定义

21cmFAST 通过两条链路控制小质量晕的恒星形成效率：

| 链路        | 环境               | 冷却机制                 | 代码入口                     |
| ----------- | ------------------ | ------------------------ | ---------------------------- |
| A: 分子冷却 | 中性 IGM, 再电离前 | H₂ 转动-振动线 (~100 K) | `lyman_werner_threshold()` |
| B: 原子冷却 | 电离 IGM, 再电离后 | H/He 原子线 (~10⁴ K)    | `reionization_feedback()`  |

本报告聚焦**链路 A**：将 `mcrit_noLW` 从 CDM 迁移到 FDM。链路 B 的 SM13 改造见附录 B。

---

### 2. `mcrit_noLW` 在代码中的角色

#### 2.1 作为指数截断尺度（非二元开关）

`thermochem.c:289` 定义 `mcrit_noLW`。下游唯一的消费点位于 `scaling_relations.c:354-355`：

```c
f_sample_mini *= exp(-mturn_mcg / halo_mass - halo_mass / consts->acg_thresh + ...);
```

其中 `mturn_mcg = max(Mturn_RE, max(Mturn_LW, mcrit_noLW))`（含 LW 和相对速度修正）。

关键认识：`mcrit_noLW` **不是**"能否冷却"的二元判定，而是 **`exp(−mturn/M)` 截断曲线的特征质量标度**[20]。当 `halo_mass ≫ mturn` 时 `exp → 1`（无抑制）；当 `halo_mass ≪ mturn` 时恒星形成被指数压低。

#### 2.2 完整调用链

```
lyman_werner_threshold(z, J_21_LW, vcb)       [thermochem.c]
    │
    ├─ mcrit_noLW = 3.314e7 (1+z)^-1.5        ← 当前: CDM Fialkov+12 [9]
    ├─ × f_LW(J_21_LW)                         ← Schauer+21 [11] LW 反馈
    └─ × f_vcb(vcb)                            ← 相对速度修正
        │
        └→ nion_fraction_mini(lnM)             [nion_fractions.c]
               │
               Mturn_mcg = max(Mturn_RE, max(Mturn_LW, mcrit_noLW))
               └→ exp(−Mturn_mcg / M)           ← 低质量指数截断
```

FDM 修改的入口点唯一：替换 `mcrit_noLW` 的数值。所有下游逻辑不变。

---

### 3. CDM 基线：`mcrit_CDM = 3.314e7 (1+z)^-1.5` 的物理起源

> **已迁出**：基线的判据归属、$V_{\rm cool,0}\leftrightarrow T_{\rm vir}$ 换算、$z$ 依赖归属
> 与前置因子核对，见 `docs/notes/FDM_mcrit_report.md` §1。此处只保留下游需引用的 **Muñoz+22 参数化审计**（§3.3.4）
> 与 **Fialkov+12 三效应**（§3.3.5）。

---

#### 3.3.4 ★ 完整参数化：Muñoz+22 的综合拟合（21cmFAST 实际采用）

> **【2026-09-10 查证自原论文】**
> Muñoz, Qin, Mesinger, Murray, Greig & Mason 2022, MNRAS 511, 3657
> （arXiv:2110.13919，`论文/The impact of the first galaxies on cosmic dawn and reionization.pdf`）
> —— 作者含 21cmFAST 核心开发者，故代码直接采用其拟合。

**Eq.(11)** 把分子冷却晕的翻转质量写成三因子之积：

$$
M_{\rm mol}=M_0(z)\;f_{v_{cb}}(v_{cb})\;f_{\rm LW}(J_{21})
$$

其中无反馈阈值（原文）：

$$
M_0(z)=\tilde M_0(1+z)^{-3/2},\qquad \tilde M_0=3.3\times10^7\,M_\odot
$$

> **原文括注："corresponding to $T_{\rm vir}=10^3$ K; Tegmark et al. 1997"**

**这独立印证了 §3.3.0c/§3.3.1 的结论**——三条互不相干的路径给出同一温度：

| 路径                                          | $T_{\rm vir}$      |
| --------------------------------------------- | -------------------- |
| §3.3.1 用`TtoM` 反解 $3.314\times10^7$   | 1007 K               |
| §3.3.0c 由$V_{\rm cool,0}=3.714$ km/s 换算 | 1019 K               |
| **Muñoz+22 原文直接写出**              | **$10^3$ K** |

##### $f_{\rm LW}$ 与 $f_{v_{cb}}$（Eq. 13 / 16）

$$
f_{\rm LW}=1+A_{\rm LW}(J_{21})^{\beta_{\rm LW}}\qquad\text{(13)}
$$

$$
f_{v_{cb}}=\left(1+A_{v_{cb}}\frac{v_{cb}}{v_{\rm rms}}\right)^{\beta_{v_{cb}}}\qquad\text{(16)}
$$

原文取值：

| 参数               | Muñoz+22                  | 21cmFAST 代码          |
| ------------------ | -------------------------- | ---------------------- |
| $A_{\rm LW}$     | 2                          | `A_LW = 2.0` ✓      |
| $\beta_{\rm LW}$ | **0.5**（图 1 黑线） | `BETA_LW = 0.6` ⚠   |
| $A_{v_{cb}}$     | 1                          | `A_VCB = 1.0` ✓     |
| $\beta_{v_{cb}}$ | 1.8                        | `BETA_VCB = 1.8` ✓  |
| $v_{\rm rms}$    | ~30 km/s                   | `SIGMAVCB = 29.0` ⚠ |

> **$v_{cb}$ 的量纲**：图 2 注明 "here divided by its rms value $v_{\rm rms}$ so it is dimensionless"。
> 即式中的 $v_{cb}$ 是**无量纲比值** $v_{cb}/v_{\rm rms}$（0 至 ~3，Maxwell–Boltzmann 分布）。

各模拟的独立拟合值（原文）：

| 模拟                          | $\{A_{\rm LW},\beta_{\rm LW}\}$ |
| ----------------------------- | --------------------------------- |
| Kulkarni+21                   | {0.8, 0.9}                        |
| Schauer+21                    | {3.0, 0.5}                        |
| **Muñoz 采用（居中）** | **{2, 0.5}**                |

##### 两处代码与论文的不一致（记录备查）

1. **`BETA_LW = 0.6` vs 论文图注 0.5**：代码注释写
   "Latest simulations suggest 2.0 and 0.6. See Sec 2 of Muñoz+21 (2110.13919)"，
   但论文图 1 注明确为 0.5。差异虽小（$J_{21}=1$ 时 $f_{\rm LW}$ 分别为 3.0 与 3.0；
   $J_{21}=0.1$ 时 1.50 vs 1.63，约 8%），若做高精度对比需留意。
2. **`SIGMAVCB = 29.0` vs 论文 ~30 km/s**：约 3% 差异，可能源于宇宙学参数不同。

##### Muñoz+22 对 Fialkov+12 的评价

论文 Eq.(17) 复述了 Fialkov+12 的原形式，并明确评价（图 2 注）：

> "The brown dashed line shows the formula from Fialkov et al. (2012),
> which **underpredicts** the star formation suppression from relative velocities."

$$
V_{\rm mol}=\sqrt{V_0^2+\alpha_{cb}^2v_{cb}^2(z)}\qquad\text{(17)}
$$

（此处 $V_0$ 被引用为 4 km/s，即 Fialkov+12 最优拟合 3.714 km/s 的四舍五入。）

**⇒ 所以：基线 $M_0(z)$ 沿用 Fialkov+12（经 Tegmark+97 的 $10^3$ K），
而 $f_{\rm LW}$、$f_{v_{cb}}$ 已替换为 Muñoz+22 依据更新模拟（Kulkarni+21、Schauer+21）的更强拟合。**

#### 3.3.5 Fialkov+12 的"三效应"与 21cmFAST 的结构对应

Fialkov+12 §5 把相对速度的影响分解为**三种效应**（原文 Eq. 4）：

> "the relative velocities produce three distinct effects (equation 4):
> suppression of the **halo abundance** ($dn/dM$), suppression of the **gas content**
> within each halo ($f_g(M)$), and **boosting of the minimum cooling mass**
> ($M_{\rm cool}$, determined by $V_{\rm cool}(z)$)"

并给出量级："at $z=20$ the bulk velocities reduce the mean gas fraction in
star-forming haloes by a factor of **1.8** and that in minihaloes by **3.1**"。

与 21cmFAST 的 `N_ion = ∫ [HMF] × [nion_fraction] dlnM` 对照：

| Fialkov+12 效应                                                                     | 21cmFAST 对应               | FDM 现状                  |
| ----------------------------------------------------------------------------------- | --------------------------- | ------------------------- |
| ① 晕丰度$dn/dM$ 抑制                                                             | HMF 通道                    | ✅ 已实现（`dndm_FDM`） |
| ② 每晕气体含量$f_g(M)$ 抑制             | 未显式建模（吸收进$f_\star$ 等参数） | —                          |                           |
| ③**冷却质量 $M_{\rm cool}$ 提升**                                          | `M_turn` / `mcrit_noLW` | ❌**完全缺失**      |

**这正是第三篇 §5 提出用 $M_{\rm sol}$ 改造 $m_{\rm crit}$ 的根本依据**——
FDM 的 soliton 平核降低中心气体密度，等效于抬高有效冷却阈值，
即作用在**效应 ③**，与已实现的效应 ① 相互独立、互补（§8.1 的"两个互补通道"）。

##### 3.3.5a 效应③ 是什么：抬高"能点燃恒星的门槛"

先回到 MCG 形成恒星的条件——**质量必须超过某个门槛**：

| 晕质量                                                 | $T_{\rm vir}$              | H₂ 冷却           | 结果 |
| ------------------------------------------------------ | ---------------------------- | ------------------ | ---- |
| $M<M_{\rm cool}$ | 太低 | 激发不足，$\Lambda$ 太小 | 气体不坍缩，**无恒星** |                    |      |
| $M>M_{\rm cool}$ | 够高（$\gtrsim10^3$ K）         | 有效，runaway collapse       | **形成恒星** |      |

无相对速度时，这个门槛就是 §3.3 的 $M_0(z)=3.3\times10^7(1+z)^{-1.5}$。

**有相对速度时，门槛被抬高。** 物理图像：

> 重子以速度 $v_{bc}$ **流过**暗物质势阱。晕要留住气体，引力必须"追上"这些流动的重子，
> 判据是圆周速度 $V_c\gtrsim v_{bc}$（引力束缚条件）。

于是所需的最小圆周速度从 $V_{\rm cool,0}$ 提高到（§3.3.0 的 Eq. 2/3）：

$$
V_{\rm cool}=\sqrt{V_{\rm cool,0}^2+(\alpha v_{bc})^2}
$$

而质量按 $M\propto V_c^3$ 跟着涨，故门槛提升倍数为

$$
\boxed{\frac{M_{\rm cool}(v_{bc})}{M_{\rm cool}(0)}=\left[1+\left(\frac{\alpha v_{bc}}{V_{\rm cool,0}}\right)^2\right]^{3/2}}
$$

**数值**（Fialkov+12 第 5 页正文，z=20）：

| 区域                         | $M_{\rm cool}$                                     |
| ---------------------------- | ---------------------------------------------------- |
| $v_{bc}=0$（静止区）       | $3.6\times10^5\,M_\odot$                           |
| $v_{bc}=\rm rms$（典型区） | $6.0\times10^5\,M_\odot$（**提升 1.67 倍**） |

**即：同一红移下，流动快的区域需要更大的晕才能点燃恒星。** 这就是"boosting of the minimum cooling mass"。

##### 3.3.5b 效应① vs 效应③：改变的是"数量"还是"门槛"

**这是最易混淆之处**，务必分清：

|            | 效应① 晕丰度抑制                                | 效应③ 冷却质量提升                                      |
| ---------- | ------------------------------------------------ | -------------------------------------------------------- |
| 改变了什么 | 晕的**数量** $dn/dM$                     | 单个晕的**成败门槛** $M_{\rm cool}$              |
| 物理原因   | 相对速度压制小尺度功率 → 结构**长不出来** | 相对速度阻碍气体被捕获/冷却 →**长出来了也点不着** |
| 在积分中   | 改变被积函数的**幅度**                     | 改变积分的**下限**                                 |
| 通俗类比   | 考场里**考生变少**                         | **录取分数线提高**                                 |

用 21cmFAST 的积分看更直观：

$$
N_{\rm ion}=\int_{M_{\min}}^{M_{\max}}\underbrace{[\mathrm{HMF}]}_{\text{效应①改这里}}\times\underbrace{[\mathrm{nion\_fraction}]}_{\text{含 }e^{-M_{\rm turn}/M}}\,d\ln M,\qquad M_{\min}\!\!\uparrow\ \text{由效应③决定}
$$

- 效应① → HMF 整体被压低（`dndm_FDM`）
- 效应③ → $M_{\rm turn}$（$=m_{\rm crit}$）变大 → 指数截断 $e^{-M_{\rm turn}/M}$ 更狠 → 可用质量区间下界上移

**两者独立且互补**：效应① 让每个质量档的晕变少，效应③ 让整个可用区间的下界上移。
Fialkov+12 原文给出各自的量级："$\sim20$–$30$ per cent effect each"。

##### 3.3.5c FDM 为什么也作用在效应③

**FDM 的 soliton 平核改变的是晕内部密度结构，从而改变"门槛"。**

|               | 中心密度剖面                                                                                                 | 中心气体密度 | H₂ 冷却率$\Lambda\propto n^2$ | 门槛                     |
| ------------- | ------------------------------------------------------------------------------------------------------------ | ------------ | -------------------------------- | ------------------------ |
| **CDM** | NFW 尖点$\rho\propto r^{-1}$，中心（形式上）极高                                                           | 高           | 强                               | 低质量晕也能冷却         |
| **FDM** | soliton**平核**，中心密度有限且较低（$\rho_c\propto M_h^{4/3}$，慢于 CDM 的 $\propto M_h^{2.13}$） | 低           | 显著下降                         | **需更大质量才够** |

**结论：FDM 晕要达到与 CDM 晕相同的冷却效率，必须质量更大** —— 有效冷却阈值被抬高。
这正是**效应③**，只是抬高的原因从 CDM 的「相对速度阻碍气体捕获」
换成了 FDM 的「soliton 平核降低中心气体密度」。

**定量对比**（z=10，凸显 FDM 的分量）：

| 情形                       | $M_{\rm cool}$               | 相对 CDM 提升    |
| -------------------------- | ------------------------------ | ---------------- |
| CDM（无反馈）              | $9.08\times10^5\,M_\odot$    | 1×              |
| CDM +$v_{bc}=\rm rms$    | $\sim1.5\times10^6\,M_\odot$ | **~1.7×** |
| **FDM $m_{22}=1$** | $5.56\times10^7\,M_\odot$    | **~61×**  |

> **FDM 的效应③ 比相对速度的效应③ 强约 $36\times$。**
> 这就是「$M_{\rm sol}\ll M_{\rm hm}$，冷却通道才是 FDM 主导通道」的定量含义——
> 也是 §8.1「两个互补通道」里冷却这一支远比 HMF 那一支重要的原因。

##### 3.3.5d 于是 P0 要改的就是 $M_{\rm cool}$ 这个门槛

FDM 现状：

| 效应                 | 状态                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| ① 晕丰度            | ✅ 已实现（`dndm_FDM`，HMF 通道）                                                  |
| ③**冷却门槛** | ❌**完全缺失**（`mcrit_noLW` 仍是纯 CDM 的 $3.314\times10^7(1+z)^{-1.5}$） |

**P0 = 给 `mcrit_noLW` 加上 FDM 修正**：

$$
\eta_p(u)\left(\frac{u}{r}\right)^{\gamma}=1,\qquad
u=\frac{m_{\rm crit}^{\rm FDM}}{M_{\rm sol}(m_{22})},\quad r=\frac{m_{\rm crit}^{\rm CDM}(z)}{M_{\rm sol}(m_{22})}
$$

即 `docs/notes/FDM_mcrit_report.md` §5.1 的方程 (1)（中心参数 $p=1$、$\gamma=0.1$；旧版 $\sqrt{a^2+b^2}$ 的口径已废弃，见同文 §5.4、§5.5）。方程 (1) 无闭式解，**尚未接入 C 端**，落地路径见 **§7.1**（`thermochem.c: lyman_werner_threshold()`）。
数值表见 §6.1–6.3（已用 `train/_sens_mcrit_kpg.py` 复算，全部吻合；注意 `scripts/calibrate_fdm_mcrit.py` 等旧脚本仍硬编码 $M_{\rm sol}=1.54\times10^7m_{22}^{-3/2}$，尚未随本次标度修正更新）。

#### 3.4 NFW 尖点的中心密度优势

> **已迁出**：见 `docs/notes/FDM_mcrit_report.md` §4.1（$\rho_{\rm eff}^{\rm CDM}\propto c^3/\mu(c)\propto M_h^{-0.32}$
> 与孤子 $\rho_c\propto m_{22}^2M_h^{4/3}$ 的质量幂次符号相反）。

---

### 4. FDM 物理修正

> **已迁出**：孤子平核剖面、$M_{\rm core}(M_h,m_{22})$、$M_{\rm sol}(m_{22},z)$、
> 三个质量区间及其对气体冷却的影响，见 `docs/notes/FDM_mcrit_report.md` §4。

---

### 5. 从密度剖面到 $m_{\rm crit}^{\rm FDM}$

> **已迁出**：$\eta$ 的定义与参数化、隐式方程 (★) 与 (1)、两条渐近、对照族 $L_k$ 的
> 不可行结论、$k$ 的定位、最终公式与数值验证，见 `docs/notes/FDM_mcrit_report.md` §5。

---

### 6. 数值结果

> **已迁出**：$M_{\rm sol}$/$M_{\rm hm}$/$R$ 表、$m_{\rm crit}^{\rm FDM}(m_{22},z)$ 绝对值表、
> $\exp(-M_{\rm turn}/M)$ 截断影响、$z=10,m_{22}=1$ 算例，见 `docs/notes/FDM_mcrit_report.md` §5.5、§10。

---

### 7. `thermochem.c` 实现

#### 7.1 代码修改（尚未实施）

现状（`thermochem.c:289`）是纯 CDM，没有 `m22` 分支：

```c
double mcrit_noLW = 3.314e7 * pow(1. + z, -1.5);
```

目标是把上式换成 `docs/notes/FDM_mcrit_report.md` §5.1 方程 (1) 的解。注意方程 (1) **无闭式解**——旧版文档曾建议改成 `sqrt(a²+b²)`，该做法已被证明无法表示方程 (1) 的解（同文 §5.4、§5.5），不再采用。落地有两条路：

```c
if (cosmo_params_global->m22 > 0) {
    /* M_sol(m22,z) = 5.47e6 * m22^-1.5 * (1+z)^0.75 * (zeta(z)/zeta(0))^0.25
       注意系数是 5.47e6（不是旧版的 1.54e7），且必须带 z 因子 */
    double M_sol = fdm_msol(cosmo_params_global->m22, z);
    /* 解 eta_p(u)*(u/r)^gamma = 1，u = mcrit/M_sol, r = mcrit_CDM/M_sol */
    mcrit_noLW = fdm_mcrit_solve(mcrit_noLW / M_sol, 1.0, 0.1) * M_sol;
}
```

- **推荐：预计算查找表。** `lyman_werner_threshold()` 位于热路径（`HaloBox.c:495`、`scaling_relations.c:87`/`:149`、`SpinTemperatureBox.c:553`/`:1467`、`IonisationBox.c:430`），内联迭代求解开销不可忽略；可由 `scripts/calibrate_fdm_mcrit.py` 生成 $m_{22}\times z$ 表并做双线性插值。
- 备选：把 `train/_sens_mcrit_kpg.py` 的 log 空间倍增定界 + `brentq` 逻辑移植为 C 的 `fdm_mcrit_solve()`。

#### 7.2 设计要点

| 要点             | 说明                                                                |
| ---------------- | ------------------------------------------------------------------- |
| 求根，非闭式     | 方程 (1) 无解析解；`sqrt(a²+b²)` 已被证明无法表示其解（见 `docs/notes/FDM_mcrit_report.md` §5.4、§5.5） |
| `m22 > 0` 守卫 | CDM 模式（`m22=0`）完全不受影响                                   |
| 复用已有参数     | `cosmo_params_global->m22` 与 `fdm.c` 一致                      |
| 建议查找表       | 见 §7.1；避免在热路径内联迭代                                      |
| 可选`f_wave`   | 见 §9.2，建议默认 1.0（保守）                                      |

---

### 8. 与已有 FDM 基础设施的关系

#### 8.1 两个互补通道

`fdm.c` 已实现两个 FDM 效应：

| 通道                 | 物理                     | 实现                                           | 特征尺度                                                        |
| -------------------- | ------------------------ | ---------------------------------------------- | --------------------------------------------------------------- |
| **结构形成**   | 功率谱截断 → 晕数量减少 | $T_F(k)$ [13] + `dndm_FDM(M)` [13]         | $M_{\rm hm} = 1.6\times 10^{10}\,m_{22}^{-4/3}\,M_\odot$ [13] |
| **晕内部物理** | 孤子平核 → 冷却效率降低 | $m_{\rm crit}^{\rm FDM}(m_{22},z)$（本方案） | $M_{\rm sol} = 5.47\times 10^6\,m_{22}^{-3/2}(1+z)^{3/4}\,M_\odot$ [12]  |

由于 $M_{\rm sol} \ll M_{\rm hm}$（例如 $m_{22}=1$：$5.5\times 10^6 \ll 1.6\times 10^{10}$），**冷却抑制远早于 HMF 截断起作用**——在 HMF 还几乎没有抑制的质量范围内，孤子平核已经在压低恒星形成。换言之，**冷却抑制是 FDM 影响小质量恒星形成率的主导通道**。

#### 8.2 与 `dndm_FDM` 的独立性

`dndm_FDM(M)` [13] 控制晕的**数量**（halo abundance），$m_{\rm crit}^{\rm FDM}$ 控制晕的**效率**（star formation efficiency）。两者物理独立，通过不同代码路径消费：

```
fdm.c: dndm_FDM(M)        → hmf.c: 乘到无条件 HMF 上 → 影响 f_coll 积分
本方案: mcrit_FDM(m22,z)  → thermochem.c: 替换 mcrit_noLW → 影响 nion_fraction_mini
```

---

### 9. 与 Tocher+2026 的关系

#### 9.1 互补而非重叠

Tocher+2026 [17] 模拟的晕质量范围（$3\times 10^8$–$8\times 10^9 M_\odot$，原子冷却域）远大于 $M_{\rm sol}$（$10^6$–$10^7 M_\odot$）。其观测到的抑制主要来自**波动力学涨落**（Schrödinger-Poisson 含时演化产生的随机角动量注入），而非孤子平核的几何效应。

|                  | 本方案                                 | Tocher+2026                                            |
| ---------------- | -------------------------------------- | ------------------------------------------------------ |
| 捕获的物理       | 孤子几何（平核 → 中心密度降低）       | 波动力学 + 孤子几何                                    |
| 等价于 Tocher 的 | "Frozen" 模式                          | "Dyn" 模式（完整）                                     |
| 质量域           | $10^5$–$10^8 M_\odot$（分子冷却） | $3\times 10^8$–$8\times 10^9 M_\odot$（原子冷却） |
| 与本方案的关系   | —                                     | 提供波动力学校准锚点                                   |

Tocher 所有晕的质量均满足 $M_h \gg M_{\rm sol}$（$M_{\rm sol}/M_h \sim 0.001$–$0.01$），因此其 $M_{\rm sol}$ 几何效应可以忽略——这确认了 Tocher 观测到的抑制**全部来自波动力学**。

#### 9.2 波动力学修正因子 $f_{\rm wave}$

本方案不含波动力学效应。可保守地引入 $f_{\rm wave} \ge 1$ 作为预留接口（其物理动机来自 Tocher+2026 [17] 中 "Dyn" vs "Frozen" 模式的比较）。它等价于把孤子质量标度整体放大，$M_{\rm sol} \to f_{\rm wave}\,M_{\rm sol}$，再代入方程 (1)：

$$
\eta_p(u)\left(\frac{u}{r}\right)^{\gamma}=1,\qquad
u=\frac{m_{\rm crit}^{\rm FDM}}{f_{\rm wave}\,M_{\rm sol}(m_{22})},\quad
r=\frac{m_{\rm crit}^{\rm CDM}(z)}{f_{\rm wave}\,M_{\rm sol}(m_{22})}
$$

> **已迁出**：$f_{\rm wave}$ 的取值表与加入修正后的 $m_{\rm crit}$ 数值见 `docs/notes/FDM_mcrit_report.md` §10.2
> （该表按带 $z$ 因子的 $M_{\rm sol}$ 重算；本节旧表基于无 $z$ 的 $1.54\times10^7m_{22}^{-3/2}$，已作废）。
> 建议默认 $f_{\rm wave}=1$（保守）；其取值仍是从 Tocher+2026 数据外推，待正式拟合公式发布后更新。

---

### 10. 验证策略与认知地位

> **已迁出**：可验证证据层级、L2 半解析基准、L4 直接数值检验、认知地位与不确定度逐项，
> 见 `docs/notes/FDM_mcrit_report.md` §11–§13。本节只保留现状缺口（§10.8）。

#### 10.8 现状缺口：FDM $m_{\rm crit}$ 尚未进入模拟

§5–§6 的 $m_{\rm crit}^{\rm FDM}$ 目前只存在于离线脚本与本文档中，**没有进入 21cmFAST 的 C 端积分路径**：

| 位置                                                | 现状                                                                       | 缺口                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| `HaloBox.c:495`                                   | MCG turnover 仍调用`lyman_werner_threshold`                              | 未按 FDM$m_{\rm crit}$ 改写          |
| `scaling_relations.c:87`（另见 `:149`）         | 恒星形成效率的 turnover 取自同一函数                                       | 同上                                   |
| `fdm.c:54`（`dndm_FDM`，被 `hmf.c:520` 调用） | 只实现 Schive+16 [13] 的 HMF 压制$M_0 = 1.6\times 10^{10} m_{22}^{-4/3}$ | 属**结构通道**，不含分子冷却阈值 |

也就是说，FDM 在当前模拟中只通过 HMF 压制（"晕变少了"）起作用，而 $\exp(-m_{\rm crit}/M_h)$ 这条**冷却通道**仍由 CDM 标度律决定。要让 `docs/notes/FDM_mcrit_report.md` §5 的结论真正影响 21cm 信号，需把其判据（或数值解表）接入上述两处，并按同文 §12 校准 $(\eta, \gamma)$。

---

### 11. 参考文献

> 本主题的参考文献表已并入 `docs/notes/FDM_mcrit_report.md` §14。

### 附录

#### A. `compute_fdm_mcrit.py` 算法流程

> # ⚠ 本脚本定量结果不可用
>
> **`scripts/compute_fdm_mcrit.py` 的输出不能用于任何定量结论。**
>
> - 该脚本基于**静态 DM 势**的二分查找，**不含气体动力学收缩**
> - 对 FDM 严重高估 $M_{\rm crit}$，误差达 **$10^2$–$10^4$ 倍**
> - 与 Tocher+2026 实测直接矛盾：静态模型判「不冷却」时，模拟实测 $M_h=3\times10^9$ 处仍有 **46% SFE**
> - 在 $m_a \lesssim 5\times10^{-22}\,{\rm eV}$ 时完全失效（返回 `inf`）
>
> **推荐替代**：正文 §5–§7 的判据方案——方程 (1) 的数值解
> $\eta_p(u)(u/r)^{\gamma} = 1$（中心参数 $p=1$、$\gamma=0.1$，见 `docs/notes/FDM_mcrit_report.md` §5.1），
> 实现方案与数值表见同文 §5.5、§11。**此缺陷的根因分析见同文 §7–§9**（静态/平衡态评估把塌缩物理换成了平衡态密度估计，差 $\sim10^{8}$）。
>
> 本附录记录该脚本的**缺陷成因与定量证据**，供避免重蹈覆辙之用。

##### A.2 静态模型的根本缺陷

真实物理：DM 势阱 → 气体落入 → 压缩加热 → 冷却 → **进一步收缩** → $\rho$ 上升 → 冷却更快 → runaway

静态模型在固定 DM 密度处评估冷却，**不追踪气体向更高密度的动力学收缩**。对 FDM soliton 平核（中心 DM 密度低至 $0.1$–$50\,{\rm cm}^{-3}$），静态判据几乎总是返回"不冷却"——这直接导致 $M_{\rm crit}$ 高估 $10^2$–$10^4\times$。

##### A.3 与 Tocher+2026 定量鸿沟

|                        $m_a$                        | 静态模型判定                                                | Tocher 实测                  | 鸿沟 |
| :----------------------------------------------------: | ----------------------------------------------------------- | ---------------------------- | :--: |
| $1\times 10^{-22}$ | 所有$M_h \le 10^{10}$: 不冷却 | $M_h=3\times10^9$: 46% SFE                                | ∞                           |      |
|                  $2\times 10^{-22}$                  | 同上                                                        | $M_h=8\times10^8$: 16% SFE |  ∞  |
|                  $1\times 10^{-21}$                  | $M_h=10^{10}$: COOLS          | 外推:$\sim 10^9$ 可冷却 | $\sim 10\times$            |      |

结论：静态模型在 $m_a \lesssim 5\times 10^{-22}$ eV 时完全不可用（返回 `inf`）。推荐方案（正文 §5-7）取代静态模型的二分查找，直接给出物理上自洽的 $m_{\rm crit}^{\rm FDM}$。

---

#### B. SM13 再电离反馈的 FDM 迁移

##### B.1 物理本质

SM13（Sobacchi & Mesinger 2013 [16]）处理**原子冷却域**（$T_{\rm vir} > 10^4$ K）的 UVB 光致蒸发反馈。与分子冷却路径的本质区别：

|      | 链路 A: 分子冷却                                           | 链路 B: SM13 原子冷却       |
| ---- | ---------------------------------------------------------- | --------------------------- |
| 冷却 | H₂ 转动线 (~100 K)                                        | H/He 原子线 (~10⁴ K)       |
| 障碍 | LW 光子摧毁 H₂                                            | UVB 加热气体                |
| 环境 | 中性 IGM ($z \gtrsim 15$) | 电离 IGM ($z \lesssim 15$) |                             |
| 代码 | `lyman_werner_threshold()`                               | `reionization_feedback()` |

##### B.2 FDM 修改策略

SM13 的 CDM 参数化为 [16]：

$$
M_{\rm crit} = M_0 \cdot (B \cdot \Gamma)^a \cdot ((1+z)/10)^b \cdot [1 - ((1+z)/(1+z_{\rm IN}))^c]^d
$$

FDM 修改是将系数 $\{M_0, a, b, c, d\}$ 变为 $m_a$ 的函数。这需要**1D 球对称 Lagrangian hydro** 将 NFW 势替换为 soliton+NFW 势，扫描 $(M_h, z, \Gamma, m_a)$ 参数空间后重新拟合。

##### B.3 可行性

| 方面             | 评估                                                  |
| ---------------- | ----------------------------------------------------- |
| 技术可行性       | 高 — 1D hydro 是成熟技术，方程全部在 SM13 Paper I 中 |
| 代码规模         | ~900 行 Python                                        |
| 工量             | 单人 1–2 周                                          |
| 关键风险         | 低 — CDM 基线可先复现 SM13 原始结果                  |
| 与分子冷却的关系 | 共享同一个 hydro 求解器，仅化学/冷却模块不同          |

---

#### C. `calibrate_fdm_mcrit.py` 说明

> ⚠ **该脚本仍硬编码 $M_{\rm sol}=1.54\times10^7m_{22}^{-3/2}$（无 $z$ 因子），数值与
> `docs/notes/FDM_mcrit_report.md` §5.5 不一致**，须先统一口径（详见该报告"附"）。

`scripts/calibrate_fdm_mcrit.py` 实现了 §5（二次合成）的全部数值计算，包括：

- $M_{\rm sol}(m_{22})$ 计算（含正确的 Schive+14 $m_{22}$ 转换）
- $m_{\rm crit}^{\rm FDM}(m_{22}, z)$ 与 CDM 比值表
- $\exp(-m_{\rm crit}/M_h)$ 截断影响表
- 与 Tocher+2026 的一致性检验
- $f_{\rm wave}$ 因子表
- 可直接复制的 C 代码片段

运行：`.venv/bin/python scripts/calibrate_fdm_mcrit.py`

# 第四篇　一致性审计与冲突裁决

> 来源：`docs/FDM_audit_report.md`　状态：**现行**

**审计日期**：2026-09-09
**审计范围**：本仓库 FDM 实现、`docs/FDM_*.md` 文档与 Liu+25 论文/源码的一致性
**审计类型**：文档审计（不修改任何物理公式）

---

### 0. 摘要

| 问题                     | 结论                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Liu 有没有要改条件 HMF？ | **有**，且是论文自称首次提出的核心创新（Eq.(5)）                                                                                    |
| 两份 md 谁对？           | 各对一半：`FDM_MCG_modeling.md`「应加 `f_FDM`」对；`FDM_MCG_modeling.md` 附录「σ mix 是 bug」错；`FDM_hmf_design.md`「不能加」错 |
| md 的行号过时吗？        | **没有**，`D:\v21cmFAST` 下全部准确（此前判"过时"是误用重构版所致）                                                               |
| fork 相对论文的偏离      | 补上了 Liu 代码缺失的`f_FDM`（✓），但 sigma2 退化为 CDM σ（✗）                                                                       |

---

### 1. 事实基准（务必遵守）

#### 1.1 版本矩阵

| 目录                                     | 版本                | git HEAD                              | 用途                                     |
| ---------------------------------------- | ------------------- | ------------------------------------- | ---------------------------------------- |
| `/mnt/d/v21cmFAST`（`D:\v21cmFAST`） | **v3.3.1**    | `369e5b2` Steven Murray, 2023-09-18 | **Liu 源码，唯一权威基准**         |
| `/mnt/d/21cmFAST`                      | v4.1.1              | `d098e902` 官方 bot, 2026-05-05     | v4 官方干净版（FDM 零命中），本仓库上游  |
| `/mnt/d/21cmFAST3.3.1fdm版本`          | v3.3.1(+41)         | `1945bf0` 王子乐, 2026-07-05        | 本仓库的 v3 重构版                       |
| `/home/dministrat/v21cmFAST`           | 同上                | `1945bf0`                           | 与上一行**同一 commit 的另一副本** |
| `/home/dministrat/21cmFAST_fork`       | **v4 开发版** | `111a0b2a`, 2026-07-09              | 本仓库（工作区）                         |

> **禁止**用 `/home/dministrat/v21cmFAST`（4423 行，含独立 `fdm.c`）核对 Liu 代码行号。
> 该副本是 2026-07-05 由本仓库做的「FDM 模块分离」重构，`dNdM_st_F` 等函数是重构产物，**不是 Liu 原码**。

#### 1.2 论文

Liu et al. 2025, *Phys. Rev. D* **112**, 103534 (2025)
（Shihang Liu, Yilin Liu, Bowen Peng, Mengzhou Xie, Zelong Liu, Bohua Li, Yi Mao）
PDF：`/mnt/c/Users/Administrator/Desktop/Liu et al. 2025.pdf`

#### 1.3 基线（FDM 前）

```
git tag baseline/pre-fdm  →  d8f67b76
```

`d8f67b76` 是 FDM 引入前的最后一个提交（`72df7832^`）。纯净度验证：

| 关键字         | 命中数                                                               |
| -------------- | -------------------------------------------------------------------- |
| `FDM`        | 0                                                                    |
| `m22`        | 0                                                                    |
| `dndm_FDM`   | 0                                                                    |
| `HMF_FINDEX` | 0                                                                    |
| `T_F`        | 17（**全部是 `FRACT_FLOAT_ERR` 的子串误匹配**，与 FDM 无关） |

派生链：

```
d098e902  v4.1.1 官方纯净版
    │  ← 40 commits（本仓库自有改动：训练脚本、LHS 采样、power spectrum 重写…）
    ▼
d8f67b76  ★ baseline/pre-fdm（FDM 前基线）
    │  ← 3 commits：72df7832 → 269c3e8f(fdm.c) → eb55d016(fdm.h)
    ▼
  HEAD     当前（含 FDM）+ 未提交工作区改动
```

常用命令：

```bash
git diff baseline/pre-fdm -- src/py21cmfast/src/      # FDM 全部改动（含工作区）
git diff baseline/pre-fdm HEAD -- src/py21cmfast/src/ # 仅已提交部分
```

---

### 2. FDM 改动清单

相对 `baseline/pre-fdm`，共 **14 文件 +374/−45**。其中：

#### 2.1 纯 FDM 改动（10 文件）

| 文件                              | 改动         | 说明                                                                      |
| --------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `src/py21cmfast/src/fdm.c`      | +185（新增） | `T_F`、`dndm_FDM`、`sigma_z0_pre`、`dsigmasqdm_z0_pre`            |
| `src/py21cmfast/src/fdm.h`      | +16（新增）  | 声明                                                                      |
| `cosmology.c`                   | +34          | `power_in_k` 乘 $T_F^2$（L297-300）、`power_in_k_cdm`（L310）       |
| `cosmology.h`                   | +1           | —                                                                        |
| `hmf.c`                         | ±56         | 无条件 HMF（L509）、**条件 HMF（L457，未提交）** 乘 `dndm_FDM`    |
| `interp_tables.c`               | +47          | `Sigma_InterpTable_CDM` 建表与 `EvaluateSigma` FDM 分支（L1206-1217） |
| `wrapper/inputs.py`             | +8           | `m22`(L456)、`FDM`(L687)、`HMF_FINDEX`(L689)                        |
| `_inputparams_wrapper.h`        | +6           | —                                                                        |
| `_functionprototypes_wrapper.h` | +13          | —                                                                        |
| `debugging.c`                   | ±11         | 仅打印 FDM 参数（L100, L119）                                             |

#### 2.2 混入的非 FDM 改动（**审计时排除**）

| 文件                            | 改动      | 性质                                                                              |
| ------------------------------- | --------- | --------------------------------------------------------------------------------- |
| `indexing.c` / `indexing.h` | +6 / ±16 | `inline` → `static inline` 链接性整理 + `resample_index` 从 header 迁至 .c |
| `.gitignore`                  | ±2       | `py21cmfast/` → `/py21cmfast/` 路径锚定                                      |

> 这些改动与 FDM 逻辑无关，是同期混入的工程性改动。
>
> **【2026-09-10 更新】** 原列于此的 `IonisationBox.c` 条目（`R_index_MINI`/`R_MINI` 字段）
> **已删除**：该 WIP 只赋值未在 `struct RadiusSpec` 中定义，导致编译失败，
> 且上下游 v4.1.1 均无此字段，属未完成的独立改动（与 FDM 无关）。
> 同时修正了该文件中 `maximum_radius`/`minimum_radius` 上下限写反的注释。

---

### 3. 论文核心（原文引用）

#### 3.1 摘要

> "The full FDM dynamics are implemented in reionization simulations, along with **a new ansatz on modulation of the FDM HMF by the linear overdensity**."

#### 3.2 Sec. II A（P3）

> "The nonlinear effects of FDM on halo formation are modeled by (i) a fitting formula for the halo mass function, adopted from full FDM numerical simulations [20,21], (ii) **an ansatz that treats the density-modulated environmental effects in FDM cosmologies, which we introduce for the first time** (Sec. II A 2)."

#### 3.3 公式

**Eq.(2)** — FDM 线性功率谱（Hu+00）：

$$
\frac{P_{\rm FDM}(k,z)}{P_{\rm CDM}(k,z)} = \left[\frac{\cos(x^3)}{1+x^8}\right]^2,\quad x(k)\equiv 1.61\,m_{22}^{1/18}\frac{k}{k_{J,\rm eq}},\quad k_{J,\rm eq}=9\,m_{22}^{1/2}\,{\rm Mpc^{-1}}
$$

**Eq.(3)** — FDM HMF（Schive+16 拟合）：

$$
\left.\frac{dn}{dm}\right|_{\rm FDM}(m,z) = \left.\frac{dn}{dm}\right|_{\rm CDM}(m,z) \cdot \left[1+\left(\frac{m}{M_0}\right)^{\alpha}\right]^{-2.2},\quad M_0\equiv1.6\times10^{10}m_{22}^{-4/3}M_\odot,\ \alpha=-1.1
$$

**Eq.(4)** — 标准 excursion set：$\left.\frac{dn}{dm}\right|_{\rm CDM} = -\frac{\bar\rho_m}{m}f(\nu)\frac{d\ln\sigma}{dm}$，$\nu\equiv\delta_c/\sigma(m,z)$

**Eq.(5)** — 条件 HMF 的 ansatz（**核心**）：

> "We will work with the ansatz where the peak height variable that affects the FDM HMF in Eq. (3) **via the $(dn/dm)|_{\rm CDM}$ term** should be written as

$$
\nu^2 = \frac{[\delta_c - \delta_{\rm FDM}(z)]^2}{\sigma^2_{\rm CDM}(m,z) - \sigma^2_{\rm FDM}(M,z)}
$$

> where $m$ is the halo mass, $M$ is the total mass within the comoving volume under consideration, $\delta_{\rm FDM}(z)$ is the linear-theory FDM overdensity within this volume at redshift $z$, and $\sigma^2_{\rm FDM}(M,z)$ is the variance of the linear-theory FDM density field smoothed on mass scale $M$."

**闭合性自述**：

> "On very large scales ($M\to\infty$), the density-modulated HMF resulting from this ansatz reduces to the global average, Eq. (3), as expected."

#### 3.4 条件 FDM HMF 三要素

由 Eq.(3)+(5) 推出，**必须同时具备**：

1. **分子**用 $\delta_{\rm FDM}$（FDM 线性密度场）
2. **分母**用 $\sigma^2_{\rm CDM}(m) - \sigma^2_{\rm FDM}(M)$（**混合 σ**）
3. **整体保留** $f_{\rm FDM}(m)$（由 Eq.(3) 经 $(dn/dm)|_{\rm CDM}$ 项继承）

> Eq.(5) 只改写 peak height $\nu$，**未取消** Eq.(3) 的 $f_{\rm FDM}$。两者是「同时具备」，非二选一。

---

### 4. 三方对照表

| 要素                                                                                                                      |         Liu 论文         |                       Liu 代码`D:\v21cmFAST`                       |                 本仓库 fork                 |
| ------------------------------------------------------------------------------------------------------------------------- | :-----------------------: | :-------------------------------------------------------------------: | :-----------------------------------------: |
| ①$\sigma_{\rm CDM}(m)$ for sigma1                                                                                      |           要求           |              ✓`ps.c:2255` (`Sigma_InterpTable_CDM`)              |         ✓`EvaluateSigma`→CDM 表         |
| ②**$\sigma_{\rm FDM}(M)$ for sigma2**                                                                                  |   **要求 Eq.(5)**   |         ✓`ps.c:2845`（`Sigma_InterpTable`，含 $T_F$）         | **✗ 退化为 $\sigma_{\rm CDM}(M)$** |
| ③**$\times f_{\rm FDM}(m)$**                                                                                           |   **要求 Eq.(3)**   | **✗ 缺失**（`dNdM_conditional` 2240-2286 内无 `dndm_FDM`） |          ✓`hmf.c:457`（未提交）          |
| ④ 分子$\delta_{\rm FDM}$                    |         要求         |                    ✓（ICs 用含$T_F$ 的功率谱） | ✓`cosmology.c:297-300` |                                                                      |                                            |

**一句话**：Liu 代码缺 ③，本仓库补上了 ③ 但丢了 ②——**两边各缺一半**。

#### 4.1 fork 偏离点详解

`src/py21cmfast/src/interp_tables.c:1206-1217`：

```c
double EvaluateSigma(double lnM) {
    if (matter_options_global->USE_INTERPOLATION_TABLES > 0) {
        // FDM: use CDM-reference sigma table (no T_F cutoff) for HMF calculations
        if (matter_options_global->FDM)
            return EvaluateRGTable1D_f(lnM, &Sigma_InterpTable_CDM);   // ← 无条件返回 CDM σ
        return EvaluateRGTable1D_f(lnM, &Sigma_InterpTable);
    }
    if (matter_options_global->FDM) return sigma_z0_pre(exp(lnM));
    return sigma_z0(exp(lnM));
}
```

条件 HMF 的 sigma2 全部经 `EvaluateSigma` 取得（`interp_tables.c:317/435/518/599/632/692/741`，共 7 处），
故 FDM 下 $\sigma_2 = \sigma_{\rm CDM}(M)$，偏离 Eq.(5)。`EvaluatedSigmasqdm`（L1219-1231）有同样分支。

**该分支是 FDM 移植时新增的**——v4.1.1 官方基线（`/mnt/d/21cmFAST/src/py21cmfast/src/interp_tables.c:1170-1176`）的 `EvaluateSigma` **无任何 FDM 分支**。
因此这属于**重构引入的回归**：v4 把 σ 取值收敛到统一函数，顺手加了「FDM 用 CDM σ」（对 sigma1 正确），却未意识到 sigma2 需要 **FDM σ**，两者语义相反。

> 修复时需给 `EvaluateSigma` 增加区分 sigma1/sigma2 语义的参数（或新增 `EvaluateSigmaConditional`），
> **不能**简单删除该分支（否则破坏 sigma1 的正确行为）。

---

### 5. 逐条裁决

| #  | 主张                                                                                                                                                                                             | 裁决                                  | 依据                                                                                                                                                                                    |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | `FDM_hmf_design.md` §3「条件 HMF **不能**加 `dndm_FDM`」                                                                                                                              | **错误**                        | Eq.(3) 要求$f_{\rm FDM}$ 经 $(dn/dm)\|_{\rm CDM}$ 保留；论文自述 $M\to\infty$ 时条件 HMF「reduces to Eq.(3)」，不含 $f_{\rm FDM}$ 则无法回归全局 FDM HMF                        |
| 2  | 同上文档「乘$f_{\rm FDM}$ 会破坏 $\langle$cond$\rangle_\delta$=uncond」                                                                                                                    | **数学上不成立**                | $f_{\rm FDM}(M)$ 仅依赖 $M$、不依赖 $\delta$，可提出 $\delta$ 平均之外：$\langle$cond$_{\rm CDM}\times f\rangle_\delta=f\times$uncond$_{\rm CDM}=$uncond$_{\rm FDM}$ ✓ |
| 3  | 同上文档「FDM 抑制如何随 δ 变化目前无数据/公式」                                                                                                                                                | **过时**                        | Liu+25 已给出 Eq.(5)（自称首次提出）                                                                                                                                                    |
| 4  | `FDM_MCG_modeling.md` A.3「σ mix 是 bug，sigma2 应用 σ_CDM」                                                                                                                                 | **错误**                        | 混合 σ 正是 Eq.(5) 要求；Liu 代码`ps.c:2255+2845` 是**正确实现**                                                                                                               |
| 5  | 同上文档 A.3「缺少$f_{\rm FDM}$ 因子」                                                                                                                                                         | **正确**（论证框架错）          | 非「σ 通道 vs f 通道二选一」，论文要求**两者同时具备**                                                                                                                           |
| 6  | 同上文档正文方案 2「全 CDM σ + 事后乘$f_{\rm FDM}$」                       | **与 Eq.(5) 冲突**              | Eq.(5) 要求分母含$\sigma^2_{\rm FDM}(M)$；本仓库照此实施导致要素②偏离 |                                       |                                                                                                                                                                                         |
| 7  | 两份 md 的 ps.c 行号引用                                                                                                                                                                         | **准确，不应改**                | 以`D:\v21cmFAST`（4544 行）核对全部吻合                                                                                                                                               |
| 8  | `fdm.c:47` 注释 "high-mass cutoff"                                                                                                                                                             | **确认为误导**                  | $\alpha=-1.1$ 压制**小质量**晕，应为 low-mass suppression                                                                                                                       |
| 9  | `FDM_MCG_modeling.md` §1「`dndm_FDM` 仅作用于 `unconditional_hmf`」                                                                                                                       | 对 Liu 为真，**对 fork 已过时** | fork 条件 HMF 已加（L457）                                                                                                                                                              |
| 10 | `compute_fdm_mcrit.py` 静态势模型                                                                                                                                                              | **定量不可用**                  | 高估$M_{\rm crit}$ 达 10²–10⁴ 倍；与 Tocher+26 矛盾（静态判「不冷却」vs 实测 46% SFE）                                                                                             |

#### 5.1 Liu 代码行号索引（基准：`D:\v21cmFAST`，ps.c 4544 行）

| 符号                                | 位置                                                               |
| ----------------------------------- | ------------------------------------------------------------------ |
| `dndm_FDM`                        | `ps.c:987`                                                       |
| `dNdM_st`                         | `ps.c:995`                                                       |
| `dNdM_st_F`                       | `ps.c:1032-1034`（`return dNdM_st(growthf,M) * dndm_FDM(M);`） |
| `dNdM_conditional`                | `ps.c:2240-2286`                                                 |
| sigma1 的 FDM 分支                  | `ps.c:2251-2256`                                                 |
| `sigma2 = Sigma_InterpTable[...]` | `ps.c:2845`（另有 2930 / 3072 / 3397 / 3507）                    |
| `Sigma_InterpTable_CDM` 建表      | `ps.c:1684, 1694`                                                |

---

### 6. FDM 通道覆盖状况（供后续开发参考）

| 通道                                      | 状态                                              | 特征尺度                                             |
| ----------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| ① 功率谱截断$T_F(k)$                   | ✓ 已接入`cosmology.c:298`                      | —                                                   |
| ② HMF 压制$f_{\rm FDM}$                | △ 无条件 ✓ / 条件**部分偏离**（缺要素②） | $M_{\rm hm}=1.6\times10^{10}m_{22}^{-4/3}M_\odot$  |
| ③**分子冷却阈值 $m_{\rm crit}$** | **✗ 完全缺失**                             | $M_{\rm sol}=5.47\times10^{6}m_{22}^{-3/2}(1+z)^{3/4}M_\odot$ |
| ④**SM13 原子冷却/再电离反馈**      | **✗ 完全缺失**                             | 需 1D hydro 重拟合                                   |
| ⑤ 波动力学$f_{\rm wave}$               | ✗ 无接口                                         | Tocher+26                                            |

**关键量化**：$M_{\rm sol}\ll M_{\rm hm}$（$m_{22}=1$、$z=0$：$5.5\times10^6$ vs $1.6\times10^{10}$）——
冷却抑制比 HMF 截断早约 **3.5 个量级**生效。即 **FDM 影响小质量恒星形成的主导通道（冷却）目前完全未建模**。

- `thermochem.c:289`：`mcrit_noLW = 3.314e7 * pow(1.+z, -1.5)` —— 纯 CDM
- `thermochem.c:302-307`：`reionization_feedback`（SM13）—— 纯 CDM
- `thermochem.c:278` `atomic_cooling_threshold`、L280 `molecular_cooling_threshold`

#### 6.1 数值复算验证（2026-09-12）

用 `.venv/bin/python train/_sens_mcrit_kpg.py`（T1–T3，exit 0）复算
`docs/notes/FDM_mcrit_report.md` §5.5、§10 的全部表格，**逐项一致**：

| 表                                                    | 核对项                                               | 结果 |
| ----------------------------------------------------- | ---------------------------------------------------- | ---- |
| §5.5（$M_{\rm sol}$、$M_{\rm hm}$、$R$） | $M_{\rm sol}(z{=}0)$、$M_{\rm hm}$、$R(z=10/20/30)$ | ✓ 逐项一致（如$m_{22}=1$：$5.47\times10^6$ / $1.60\times10^{10}$ / 61.2 / 192.7 / 392.2） |      |
| §5.5（$m_{\rm crit}^{\rm FDM}$ 绝对值表）       | $m_{\rm crit}^{\rm FDM}(m_{22},z)$        | ✓ 逐项一致（如$z{=}10$：CDM $9.084\times10^5$，$m_{22}{=}1$ 为 $5.559\times10^7$）       |      |
| §10（截断因子）                                        | $\exp(-m_{\rm crit}/M_h)$                 | ✓ 逐项一致（如$M_h{=}10^7$：CDM 0.9132，$m_{22}{=}1$ 为 $0.0039$）                             |      |
| §5.4–§5.5（$L_k$ 对照族、$k_{\rm eff}$）             | 表 (a)、$k_{\rm eff}$ 分布 | ✓ 逐项一致（$k_{\rm eff}$ 中位 $0.374$，全范围 $[0.184,\ 0.950]$，$400/400$ 均 $<1$） |      |

结论：`docs/notes/FDM_mcrit_report.md` §5.5、§10 的数值表格**经独立复算确认无误**（旧版基于 $M_{\rm sol}=1.54\times10^7m_{22}^{-3/2}$ 的全部数字已作废），可作为后续实现 mcrit FDM 迁移的依据。

---

### 7. 遗留问题与风险

1. **要素④ 仅推断**：分子 $\delta_{\rm FDM}$ 由 ICs 含 $T_F$ 推断成立，未逐点追踪 `delta` 传入 `conditional_hmf` 的完整链路。
2. **`72df7832` 混入非 FDM 改动**：`indexing.c/h`、`IonisationBox.c`、`.gitignore`（见 §2.2），审计时已排除。
3. **未提交改动**：`hmf.c`（条件 HMF 加 FDM）与 `IonisationBox.c` 仍在工作区。`git diff baseline/pre-fdm HEAD` **看不到**它们，必须用不带 `HEAD` 的形式。
4. **多副本风险**：`/mnt/c/Users/zile/Desktop/` 存有 5 份 md 副本 + `ps7` 目录，可能与仓库内 `docs/` 不同步。**权威副本为仓库内 `docs/`**。
5. **不修复任何偏离**：fork 的 sigma2 退化仍存在，仅记录不修改，超出「审计」范围。

---

### 8. 参考文献

**FDM 物理**：Liu et al. 2025, PRD 112, 103534 · Schive et al. 2016, PRL 116, 201302 · Schive et al. 2014, Nature Phys. 10, 496 · Hu, Barkana & Gruzinov 2000, PRL 85, 1158 · Du et al. 2017, ApJ 838, 63 · Tocher et al. 2026, arXiv:2603.25546

**CDM 冷却/反馈**：Fialkov et al. 2012, MNRAS 424, 1335 · Visbal et al. 2015, Nature 528, 357 · Schauer et al. 2021, MNRAS 507, 1775 · Muñoz et al. 2021, arXiv:2110.13919 · Sobacchi & Mesinger 2013, MNRAS 432, L51 / 3340 · Stacy et al. 2011, MNRAS 413, 172 · Greif et al. 2011, ApJ 737, 75

**结构形成**：Sheth & Tormen 2001, MNRAS 323, 1 · Barkana & Loeb 2001, Phys. Rep. 349, 125 · Bryan & Norman 1998, ApJ 495, 80

# 第五篇　备选方案存档（未实施）

> 本篇仅保留**尚未实施且具备参考价值**的备选方案。
>
> 以下内容已删除，正确结论见**第一篇 §8–§9**：
>
> - 「条件 HMF 乘 $f_{\rm FDM}$」（方案 2）—— 已于 2026-09-10 回退，见第一篇 §9.7
> - 「FDM σ 通道方案」（方案 3）—— 不推荐，与 $f_{\rm FDM}$ 互斥
> - Liu 源码的公式级对比诊断 —— 已被第一篇 §8 修正
> - 已过时的代码基础设施描述、文件索引、重复参考文献

## 1. 核心困难与文献现状

**FDM 的条件 HMF 没有现成的半解析经验公式可直接用。**

原因不是没人研究，而是 FDM 的 excursion set 问题本质上比 CDM 难：

1. **CDM 的 EPS 依赖 sharp-k 滤波器** —— 恰好对应的马尔可夫过程使 first-crossing 概率有解析解
2. **FDM 的量子压力天然对应 sharp-k 截止** —— 但 Du et al. (2017) 证明即使使用 sharp-k，FDM 的 barrier 也是**质量依赖的**（不再是常数 $\delta_c$），这导致解析解复杂得多
3. Du+17 确实解了这个问题（用修正的 Lacey & Cole 形式 + GALACTICUS 半解析模型），但公式涉及**双重数值积分 + 质量依赖 barrier 的 Taylor 展开**，不是一条解析公式能写完的

### 文献现状

- **Jones et al. (2021)**: 直接用的 `dndm_FDM` 乘在 ST HMF 上（和代码现有做法一样），未专门处理 minihalo
- **Liu et al. (2025)**: 更近一步把 FDM 的 $\sigma(M)$ 代入了条件 HMF，但也**没有专门处理分子冷却晕**

**FDM 的分子冷却阈值目前没有一篇文献给出过可直接用的解析公式。所有现有工作都回避了这个问题 —— 要么不做 minihalo，要么直接用 CDM 的 $M_{\rm turn}$ + FDM HMF 压制。**

## 2. 方案 A：只改 $M_{\rm turn}$（最小改动）

利用现有 FDM 基础设施，**只修改分子冷却质量阈值**：

$$
M_{\text{turn}}^{\text{FDM}} = \max\left(M_{\text{cool}},\; M_{1/2}\right), \quad M_{1/2} = 1.6\times 10^{10}\; m_{22}^{-4/3}\; M_\odot
$$

其中 $M_{\text{cool}}$ 是现有的分子冷却阈值（含 LW 反馈，来自 `lyman_werner_threshold()`），
$M_{1/2}$ 是 Schive+16 半模质量。物理直觉：FDM 量子压力压制了低于 $M_{1/2}$ 的晕形成，
因此 MCG 的下限至少为 $M_{1/2}$。

- **修改位置**：`thermochem.c: lyman_werner_threshold()` 返回前取 max，
  或 `hmf.c: nion_fraction_mini()` 的 `Mturn_mcg` 处
- **优点**：~10 行代码，$dndm\_FDM$ 已经定义了 $M_{1/2}$
- **缺点**：忽略了 FDM 对条件 HMF 形状的修正 —— 在 $\sigma(M)\sim\sigma(R)$ 附近，
  FDM 的条件 HMF 形状和 CDM 明显不同（Du+17 图 3）

> 注：与第三篇的 $m_{\rm crit}^{\rm FDM}$ 方案**互斥**（两者都改 $M_{\rm turn}$，
> 但取值不同：本篇用 $M_{1/2}$，第三篇用方程 (1) 的精确解）。
> 因 $M_{\rm sol}\ll M_{1/2}$，第三篇方案物理上更优（冷却抑制主导），
> 本篇仅作备选记录。

## 3. 方案 B：实现 Du+17 的完整 FDM 条件 HMF（长期方向）

Du et al. (2017, ApJ, 838, 63) 提供了完整的 FDM excursion set 解。核心公式（Eq. 6-9）：

$$
\frac{dn}{d\ln M}\bigg|_{\delta} = \frac{M_{\text{cond}}}{M} \cdot \frac{\Delta\delta}{\sqrt{2\pi\Delta S}}\cdot\exp\!\left(-\frac{\Delta\delta^2}{2\Delta S}\right)\cdot\frac{dS}{d\ln M}\cdot\frac{1}{\Delta S}\cdot\text{Taylor terms}
$$

其中 barrier 不再是常数 $\delta_c$，而是质量依赖的：

$$
\delta_{\text{FDM}}(M, z) = \delta_c \cdot \left[1 + a_1\!\left(\frac{M_{1/2}}{M}\right)^{b_1} + a_2\!\left(\frac{M_{1/2}}{M}\right)^{b_2}\right]
$$

参数 $(a_1,b_1,a_2,b_2)$ 是质量依赖 barrier 的拟合系数。

- **优点**：理论正确，和 Du+17 的 merger tree 结果一致
- **缺点**：
  - 需要在 `conditional_hmf` 里新增一个函数，改写 excursion set 的 barrier
  - 工作量大，且 Du+17 的拟合公式依赖 sharp-k 滤波器，和代码现有的 top-hat 滤波器不完全兼容
  - 估计 **2-3 个月**工作量

---

# 附录　速查与常见误区

## A.1 速查表

| 问题                                                                           | 答案                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| FDM 的 dndm 怎么算？                                                           | CDM dndm（**用 CDM σ**）× $f_{\rm FDM}(m)$              |
| σ 用 CDM 还是 FDM？                                                           | **CDM**（唯一例外：条件 HMF 的 $\sigma_2$ 用 FDM）        |
| 为什么不用 FDM σ？                                                            | 会与$f_{\rm FDM}$ 双重计数                                      |
| $f_{\rm FDM}$ 压制大质量还是小质量？ | **小质量**（$\alpha=-1.1<0$） |                                                                   |
| 条件 HMF 要不要乘$f_{\rm FDM}$？                                             | **不要**（已回退对齐 Liu）                                  |
| $\sigma_1$ / $\sigma_2$ 用什么？                                           | $\sigma_1$=CDM σ / $\sigma_2$=**FDM σ**               |
| 分子 δ 用什么？                                                               | FDM 场的 δ（ICs 含$T_F$，自动满足）                            |
| 基线在哪？                                                                     | `git tag baseline/pre-fdm` → `d8f67b76`                      |
| 复现论文图用哪个脚本？                                                         | `train/_plot_ps_dimensionless.py`、`train/_plot_hmf_three.py` |

## A.2 常见误区

| 误区                                                                               | 纠正                                                                        |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 「$f_{\rm FDM}$ 是压制大质量晕的」 | 错。$\alpha=-1.1<0$，压制**小质量** |                                                                             |
| 「σ₁ 用 CDM、σ₂ 用 FDM 是 bug」                                                | 错。这正是 Eq.(5) 的要求                                                    |
| 「条件 HMF 乘$f_{\rm FDM}$ 会破坏闭合」                                          | 该论据不成立；但实际已按 Liu 回退为不乘                                     |
| 「FDM 效应主要来自 HMF」                                                           | 不准确。$M_{\rm sol}\ll M_{\rm hm}$，**冷却通道才是主导且完全缺失** |
| 「用`/home/dministrat/v21cmFAST` 核对 Liu 行号」                                 | 错。那是重构版（4423 行），要用`D:\v21cmFAST`（4544 行）                  |

## A.3 验证脚本（`train/`，该目录被 .gitignore 忽略）

| 脚本                          | 用途                                                  |
| ----------------------------- | ----------------------------------------------------- |
| `_plot_ps_dimensionless.py` | 复现 Liu Fig.1 功率谱                                 |
| `_plot_hmf_three.py`        | 复现 Liu Fig.2 HMF（含 FDM I.C.s 对照）               |
| `_verify_global_path.py`    | 验证全局路径 = CDM HMF(CDM σ) ×$f_{\rm FDM}$      |
| `_verify_cond_hmf_fdm.py`   | 定量对比 A/B/C 三配置的条件 HMF                       |
| `_verify_fork_vs_liu.py`    | 扫描$M_{\min}/M_0$ 对 A/B 比值的影响                |
| `_verify_meanfixing.py`     | 验证 mean-fixing 对差异的抹平作用                     |
| `_probe_mcrit_coeff.py`     | 反解$3.314\times10^7$ 对应的特征维里温度（§3.3.1） |

> 以上均为**本地一次性验证/探针脚本**，位于被 `.gitignore` 忽略的 `train/` 下，
> 有意**不入库**，以避免污染项目源码工具目录（`scripts/`）。
> 其结论与数值产出已固化于本文档相应章节，脚本本身丢失不影响结论可查。
