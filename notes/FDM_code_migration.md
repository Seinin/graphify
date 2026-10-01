# 从 CDM 迁移到 FDM：21cmFAST 代码改进方案

> 配套文档：结构见 `docs/DIRECTORY.md`；判据与公式见 `docs/notes/FDM_mcrit_report.md`；
> 现状盘点与 C 端现状见 `docs/notes/FDM.md` 第三篇 §2、§7、§10.8 与第四篇。
> 本文只谈**代码改动**，不重复推导。

## 0. 现状盘点（实测，2026-09-15）

| 项 | 位置 | 状态 |
| :--- | :--- | :--- |
| FDM 总开关 | `matter_options.FDM`（`bool`，默认 `False`） | ✅ 已有 |
| 轴子质量 | `cosmo_params.m22`（`float`，默认 `1.6`，单位 $10^{-22}$ eV） | ✅ 已有 |
| **HMF 通道**：$f_{\rm FDM}$ 压制 | `src/fdm.c:54` `dndm_FDM(M)`（Schive+16/Liu+25 Eq.3）；无条件 HMF 在 `src/hmf.c:521-523` 乘上它 | ✅ 已接入 |
| 条件 HMF | `src/hmf.c:452-455`：显式**不乘** $f_{\rm FDM}$（对齐 Liu+25） | ✅ 有意如此 |
| **冷却通道**：`mcrit_noLW` | `src/thermochem.c:289` 硬编码 `3.314e7*(1+z)^-1.5` | ❌ **纯 CDM，未迁移** |
| $f_{\rm wave}$、$p$、$\gamma$ | 无 | ❌ 无参数 |

调用点（`mcrit_noLW` 的消费端）：`scaling_relations.c:87`/`:149`、`HaloBox.c:495`/`:744`、`SpinTemperatureBox.c:553`/`:1467`、`IonisationBox.c:430`。

**关键结构事实**：`mcrit_noLW` 只依赖 $(z, m_{22})$，**与单个晕无关**；$J_{21}$ 与 $v_{cb}$ 才逐晕变化。所以 FDM 修正在每个红移步内是一个**标量常数**——这是下面 P3 缓存方案的依据。

---

## 1. 改动总表

| 优先级 | 改动 | 文件 | 阻塞关系 |
| :---: | :--- | :--- | :--- |
| **P0** | 钉死三处口径（$m_{22}$ 单位、$M_{\rm sol}$ 系数、孤子 $z$ 依赖） | `scripts/*.py` + 文档 | **阻塞 P1** |
| **P1** | 新增 `fdm_mcrit_solve()`：方程 (1) 的 C 端数值解 | `src/fdm.c`、`src/fdm.h` | — |
| **P2** | 在 `lyman_werner_threshold()` 内按 FDM 门控替换 `mcrit_noLW`，并与原子通道取 $\min$ | `src/thermochem.c` | 依赖 P1 |
| **P3** | 每红移步缓存（memo） | `src/thermochem.c` | 依赖 P2 |
| **P4** | 暴露参数 $(p,\gamma,f_{\rm wave})$ 与开关 | `_inputparams_wrapper.h`、`wrapper/inputs.py` | 依赖 P2 |
| **P5** | 验证与回归测试 | `tests/`、`train/` | 依赖 P2 |
| — | HMF 通道遗留（$\sigma_2$） | `src/hmf.c` | 独立，见 §5 |

---

## P0 先钉死口径（**不做完就不要动 C 端**）

三处不一致会让 C 端实现与 Python 参考实现差 $2$–$3$ 倍，且方向不统一：

| # | 问题 | 现状 | 处置 |
| :---: | :--- | :--- | :--- |
| 1 | $m_{22}$ 单位 | C 端 `m22` 用 $m_a/10^{-22}$（`_inputparams_wrapper.h:22`）；`scripts/compute_fdm_mcrit.py` 用 $m_a/(2\times10^{-22})$ | **统一为 $m_{22}\equiv m_a/10^{-22}$**（与 `docs/notes/FDM_mcrit_report.md` 一致）。差 2 倍 $\Rightarrow\rho_c$ 差 4 倍 $\Rightarrow M_{\rm crit}$ 差 $2.8$ 倍 |
| 2 | $M_{\rm sol}$ 系数 | 权威式 $5.47\times10^6m_{22}^{-3/2}(1+z)^{3/4}(\zeta/\zeta_0)^{1/4}$；`compare_fdm_mcrit.py`/`calibrate_fdm_mcrit.py` 硬编码 $1.54\times10^7m_{22}^{-3/2}$（无 $z$） | **C 端与 Python 都用带 $z$ 的权威式**；旧脚本同步或标注作废 |
| 3 | 孤子 $z$ 依赖 | 实现里 $r_c\propto(M_h/10^9)^{-1/3}$ 无 $z$ 因子，与 Schive 的 $a^{1/2}$ 不一致 | 该不确定度已在报告 §12 列为**高**优先级；C 端默认沿用 $a^{1/2}$ 并在参数里留出可切换开关 |

$\zeta(z)/\zeta(0)$：$z=5$–$40$ 内仅由 $0.540$ 变到 $0.537$（$<0.6\%$），**取常数 $0.538$ 即可**，不要为它引入额外的表或拟合。

---

## P1 新增 `fdm_mcrit_solve()`

在 `src/fdm.c` 实现报告 §5.1 的方程 (1)：

$$
\frac{u^p}{1+u^p}\Big(\frac{u}{r}\Big)^{\gamma}=1,
\qquad
u=\frac{m_{\rm crit}^{\rm FDM}}{f_{\rm wave}M_{\rm sol}},\quad
r=\frac{m_{\rm crit}^{\rm CDM}(z)}{f_{\rm wave}M_{\rm sol}}
$$

要点（照搬 `train/_sens_mcrit_kpg.py` 已验证的做法）：

- **在 $\ln u$ 空间求根**：等比倍增定上界（`u=1,2,4,\dots`，上界 $10^{14}$ 仍未命中则报错），再 `brentq`（C 端用 GSL 的 `gsl_root_fsolver_brent`，仓库已依赖 GSL）；
- 残差用 $\ln$ 形式写，避免溢出：`log_eta = p*lu - logaddexp(0, p*lu)`，残差 $= \mathrm{expm1}(\texttt{log\_eta} + \gamma(\texttt{lu} - \texttt{log\_r}))$；
- **守卫**：$\gamma\le0$ 时方程退化无解 → `LOG_ERROR` 并回落 CDM（不要静默返回 0 或 $\infty$，报告 §5.5 已注明这是曾经踩过的坑）；
- 极限行为自检（应写进单测）：$m_{22}\to\infty$ 与 $z\to0$ 时 $u\to r$，$m_{\rm crit}^{\rm FDM}\to m_{\rm crit}^{\rm CDM}$。

签名建议：

```c
/* src/fdm.h */
double fdm_M_sol(double z, double m22, double f_wave);   /* 式 (13) */
double fdm_mcrit_solve(double z, double m22,
                       double p, double gamma, double f_wave);
```

---

## P2 接入 `thermochem.c`（核心）

现状（`thermochem.c:282-300`）只改一行 + 一段门控：

```c
double lyman_werner_threshold(float z, float J_21_LW, float vcb) {
    double mcrit_noLW = 3.314e7 * pow(1. + z, -1.5);   /* CDM 基线 */

    if (matter_options_global->FDM) {
        double m_h2 = fdm_mcrit_solve(z, cosmo_params_global->m22,
                                      astro_params_global->MCRIT_FDM_P,
                                      astro_params_global->MCRIT_FDM_GAMMA,
                                      astro_params_global->F_WAVE);
        /* 报告 §8.7：分子通道被原子通道封顶 */
        mcrit_noLW = fmin(m_h2, atomic_cooling_threshold(z));
    }

    double f_LW  = 1.0 + astro_params_global->A_LW * pow(J_21_LW, astro_params_global->BETA_LW);
    double f_vcb = pow(1.0 + astro_params_global->A_VCB * vcb / SIGMAVCB,
                       astro_params_global->BETA_VCB);
    return (mcrit_noLW * f_LW * f_vcb);
}
```

**四条必须遵守的约定**

1. **只改 `mcrit_noLW` 的数值**，下游（`scaling_relations.c` 的 `max(...)`、`HaloBox` 的 `M_turn_m`、`exp(-M_turn/M)`）一律不动——入口点唯一（第三篇 §2.2）。
2. **`f_LW`、`f_vcb` 保持原样**：它们来自 Muñoz+21/Schauer+21，与 FDM 基线不同源；FDM 效应只作用在基线上（第三篇 §3.3.4、§3.3.5e）。
3. **必须做 $\min$ 封顶**：不封顶会报告出"$m_{22}{=}1$、$z{=}10$ 阈值 $5.6\times10^7$"这类被原子通道掩盖的结论（报告 §8.7、§10.1）。
4. **`FDM=False` 时行为逐位不变**——这是回归测试的硬门槛。

---

## P3 每红移步缓存（热路径）

`lyman_werner_threshold()` 位于热路径（`HaloBox.c:495` 逐晕调用、`IonisationBox.c:430` 逐格调用）。但 **`m_{22}` 与 $z$ 在一个红移步内都是常数**，而 J/$v_{cb}$ 才逐点变化。

因此无需 2D 查找表，只需按 $(z, m_{22})$ memo：

```c
static double _cache_z = -1.0, _cache_m22 = -1.0, _cache_val = 0.0;
if (z != _cache_z || m22 != _cache_m22) {
    _cache_val = /* P2 的求解结果 */;
    _cache_z = z; _cache_m22 = m22;
}
```

每个红移步只解一次方程（$\sim50$ 次迭代），开销可忽略。**静态缓存的线程安全性**需确认（仓库目前是单线程/OpenMP 分区；若为多线程，`z` 在同一 step 内仍相同，故缓存只读安全，但首次写入需加锁或用 `thread-local`）。

> 备选（若将来 $m_{22}$ 变成逐网格可变）：$m_{22}\times z$ 二维表 + 双线性插值，由 `scripts/calibrate_fdm_mcrit.py` 生成；当前**不需要**。

---

## P4 参数与 Python 侧

在 `AstroParams`（或 `CosmoParams`，视语义）新增：

| 字段 | 默认 | 说明 |
| :--- | :--- | :--- |
| `MCRIT_FDM_P` | `1.0` | Hill 指数 $p$，先验 $[0.5,2]$ |
| `MCRIT_FDM_GAMMA` | `0.1` | 隐式方程指数 $\gamma$，先验 $[0.05,0.15]$ |
| `F_WAVE` | `1.0` | 波动力学接口（报告 §10.2）；默认 1 = 不引入额外抑制（保守） |
| `USE_MCRIT_FDM` | `True` | 独立于 `FDM` 的开关，便于单独关掉冷却通道做对照 |

同时在 `debugging.c` 的参数转储里补上这几项（现在只打印 `m22`，见 `debugging.c:117`）。

---

## P5 验证与回归

| 类别 | 内容 |
| :--- | :--- |
| **逐点对照** | C 端 `fdm_mcrit_solve()` 与 `train/_sens_mcrit_kpg.py` 在 $(m_{22},z)$ 网格上逐点比对，相对误差 $<10^{-6}$ |
| **极限行为** | $m_{22}\to\infty$、$z\to0$ 时回到 CDM（比值 $\to1$）；$m_{22}\to0$ 时单调上升 |
| **CDM 不变性** | `FDM=False` 时全流程输出与迁移前 **bit-identical** |
| **反向验证** | 报告 §10 的 $z{=}10$ 表：$m_{22}=1$ 给 $5.56\times10^7$，封顶后 $\min(\cdot,\ 8.57\times10^7)$；封顶是否触发须在日志里显式报告 |
| **数值棒** | `compute_fdm_mcrit.py`（静态直接路由）**不要**接进 C 端，其输出不可用（报告 §7；附录 A 已记录缺陷） |

---

## 5. HMF 通道的遗留（独立于上述）

| 项 | 现状 | 建议 |
| :--- | :--- | :--- |
| $\sigma_2$ 退化为 CDM σ | 回退后与 Liu 一致；实测影响 $<0.5\%$ | **不动**（对齐 Liu 优先） |
| 条件 HMF 不乘 $f_{\rm FDM}$ | 有意对齐 Liu+25 | **不动**，注释已写明 |
| `HMF_FINDEX` 负值 | `fdm.c` 注释已修正 | 保持 |

**注意两个通道互补且独立**：`dndm_FDM` 压制"晕的数量"，`mcrit` 压制"每个晕的恒星形成效率"。**不能因为 HMF 已经压制了小晕就不做冷却通道**——报告 §10.1 指出 $M_{\rm sol}\ll M_{\rm hm}$（$m_{22}=1$：$5.5\times10^6$ vs $1.6\times10^{10}$），冷却抑制比 HMF 截断早约 3 个量级生效。

---

## 6. 明确不做的事

1. **不要把静态直接路由（`compute_fdm_mcrit.py`）接进 C 端**——它是报告 §7 判定失效的那条路（差 $\sim10^{8}$）。
2. **不要把 $f_{\rm wave}$ 并入 $M_{\rm sol}$ 的拟合系数**——它是独立通道的接口，待 Tocher+2026 正式拟合后再更新（报告 §10.2）。
3. **不要改 `f_LW`/`f_vcb` 的系数**——与 FDM 不同源。
4. **不要试图给方程 (1) 找闭式解**——$L_k$ 族已被证明不能表示其解（报告 §5.4）；数值求根是必要步骤。
5. **不要追求"精确的单点阈值"**——当前只能给方向与 $\mathcal O(2$–$3)$ 量级带（报告 §12）；接口设计应允许后续替换 $(\eta,\gamma)$ 而不改结构。

---

## 7. 建议落地顺序

```
P0 口径统一（脚本 + 文档，半天）
 └─ P1 fdm_mcrit_solve() + 单测（1 天）
     └─ P2 接入 thermochem.c + min 封顶（半天）
         └─ P3 每红移步缓存（2 小时）
             └─ P4 参数暴露（2 小时）
                 └─ P5 验证：CDM bit-identical + 逐点对照（1 天）
```

前置依赖只有一条：**P0 未完成时不要动 C 端**，否则会同时引入物理错误与口径错误，事后无法归因。
