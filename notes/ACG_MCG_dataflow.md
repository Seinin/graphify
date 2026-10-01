# ACG/MCG 端到端数据流

> 本文档是《ACG/MCG 实现手册》（`ACG_MCG_manual.md`）的**调用链版**。两本手册的分工：
>
> - **`ACG_MCG_manual.md` = 概念图**：按"层"讲每个物理量/函数**是什么**、公式长什么样（§2 核心公式、§3 两条计算路径、§4 质量阈值、§5 标度关系、§6 积分引擎、§8 离散采样）；
> - **本文档 = 调用图**：按**时间轴**讲一次红移步里**谁调用谁、数据往哪流**。
>
> **与主手册的章节映射**（读本文档时随时回查）：

| 本文档                       | 对应主手册                                              | 主手册讲什么                                       |
| ---------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| §1 Python 驱动层            | §2、§9                                                | 一次时步顶层调用链；核心公式$\zeta f_{\rm coll}$ |
| §2 ComputeIonizedBox 五阶段 | §3（两条计算路径）                                     | 电离箱内部骨架                                     |
| §3 calculate_fcoll_grid     | **§3（Path A）+ §6（积分引擎）+ §8（Path B）** | 光子预算怎么算                                     |
| §4 find_ionised_regions     | §2.1（ζ 三种处理方式）                                | 电离判据不等式                                     |
| §6 LW 反馈闭环              | §4.3（$M_{\rm crit}$ 模型）                          | 跨步负反馈                                         |
| §7 两模式对比               | §3（Path A vs Path B）                                 | Eulerian vs Lagrangian                             |

> **建议阅读路径**：先读主手册 §1–§3（两类星系、两条计算路径、核心公式 $N_{\rm ion}=\int dn_c\,M f_\star f_{\rm esc}N_\gamma$），再读 §4–§6 看积分边界与标度关系；然后回到本文档，按 §1 → §2 → §3 → §4 走一遍 `ComputeIonizedBox`。**如果在代码里看到 `calculate_fcoll_grid` 却不知道它属于哪——答案在本文档 §2 阶段 B（壳层循环内）与 §3（定位小节）；它在主手册里对应 §3 的 Path A（"用积分还是抽样"这个决策的代码落点）。**

---

## 1. Python 驱动层：一次红移步的调用序列

用户调用 `run_coeval()`（`drivers/coeval.py:632`）→ `generate_coeval()`。前置阶段为每个红移准备好初始条件场和扰动场后，进入红移循环（`_redshift_loop_generator`, `coeval.py:691`）。

对每个红移 $z$（从高到低），调用链如下：

```
[前置：@single_field_func 装饰器]
  Broadcast_struct_global_all()    — 将 Python 参数广播到 C 全局结构体
  _make_wisdoms()                  — 创建 FFTW 计划

步骤 5a: (当 LAGRANGIAN_SOURCE_GRID=True)
  compute_halo_grid()
    → lib.ComputeHaloBox           — 混合源网格：低质量积分 + 大质量离散采样 (HaloBox.c:608-644, 主手册 §8)
      产生: Lagrangian source-grid SFR 场

  说明：ComputeHaloBox 内部不是"全离散采样"——
    • 低质量端 [M_min, M_max_integral]：set_fixed_grids() 逐格点积分期望值 (HaloBox.c:641-644)
    • 大质量端 (> M_max_integral)：sum_halos_onto_grid() 从晕表离散采样 (HaloBox.c:628-631)
    积分上限 M_max_integral 依 SOURCE_MODEL 而定：=4 (CHMF-SAMPLER) 取 SAMPLER_MIN_MASS；
    =3 (DEXM-ESF) 取格点对应质量 RtoM(L_cell)；其余取 M_MAX_INTEGRAL（即纯积分，无采样部分）
    (HaloBox.c:633-640)

步骤 5b: (当 USE_TS_FLUCT=True 且 lagrangian)
  compute_xray_source_field()
    → lib.UpdateXraySourceBox      — 各壳层 X 射线能谱积分
      产生: X 射线能量沉积率场

步骤 5c: (当 USE_TS_FLUCT=True)
  compute_spin_temperature()
    → lib.ComputeTsBox             — Wouthuysen-Field 耦合 + 加热
      产生: 自旋温度场 T_s(x)

步骤 6: (总是执行)
  compute_ionization_field()
    → lib.ComputeIonizedBox        — 核心：电离历史推进
       内部骨架（先给一张全景，详见 §2）：
         阶段 A: 预备 — 拷贝/滤波输入场（§2.1）
         阶段 B: 壳层循环 — 对每个滤波半径 R（从大到小）：
           ├─ copy_filter_transform(R)  平滑各场到尺度 R
           ├─ calculate_fcoll_grid(R)   光子预算 f_coll（§3）★
           └─ find_ionised_regions(R)   电离判据 + 标记（§4）
         阶段 E: 后处理 — 统计量、温度、LW 反馈场（§5）
       其中 ★ = 本文档 §3 的主角，对应主手册 §3 的 Path A

步骤 7: (总是执行)
  brightness_temperature()
    → lib.ComputeBrightnessTemp    — T_s × (1-x_HII) → δT_b
```

> `@single_field_func` 装饰器（`_param_config.py:417`）统一处理缓存检查→参数广播→FFTW 创建→调用实际函数。对每个步骤，如果该场已有缓存则直接跳过。

**本文档余下部分聚焦步骤 6**（`ComputeIonizedBox`），因为它是唯一覆盖主手册 §2–§8 全部理论的落地点。

---

## 2. C 层：ComputeIonizedBox 内部五阶段

`ComputeIonizedBox` 入口（`IonisationBox.c:1492`）按以下骨架执行：

```
阶段 A: 预备 — FFT & 场外滤波
阶段 B: 壳层循环 — 对每个滤波半径 R (从大到小)
  阶段 C: calculate_fcoll_grid  — 每个格点的光子预算
  阶段 D: find_ionised_regions  — 电离判据 + 标记
阶段 E: 后处理 — 统计量、温度赋值、LW 反馈场准备
```

### 2.0 输入来源：本步源场与上一步反馈场的三条通道

`ComputeIonizedBox` 的输入按来源分三条通道，其中 **B、C 两条直接来自上一步**（§1 步骤 5c 的 `ComputeTsBox` 和步骤 6 的上一时步电离箱）——这就是它与「电离光子」「X 射线」关联的入口：

| 通道                                | 场                                                                                                         | 来源                                                                                                                      | 去向                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **A. 电离光子（本步源场）**   | `deltax` / `stars_filtered` / `sfr_filtered`                                                         | 本步`ComputeHaloBox`（Lagrangian 混合源网格，§7）或本步密度场 + 本步 scaling constants（Eulerian 现场条件积分，§3.2） | 光子预算$f_{\rm coll}$、$f_{\rm coll,mini}$ → 判据左边（§4.1）           |
| **B. X 射线预电离（上一步）** | `xe_filtered` ← `spin_temp->xray_ionised_fraction`                                                    | 上一步`ComputeTsBox` 的 X 射线加热与次级电离（`IonisationBox.c:1504-1506`）                                           | 判据右边$(1-x_e^{\rm X})$、部分电离扣减（§4.1）                             |
| **C. 电离历史（上一步）**     | `N_rec_filtered` ← `previous_ionize_box->cumulative_recombinations`；`mean_f_coll`；`prev_deltax` | 上一时步电离箱                                                                                                            | 复合因子$1+\bar{n}_{\rm rec}$、$M_{\rm crit}$ 跳变差分修正（§3.1、§4.1） |

**要点澄清：电离光子预算不是跨步传递的，而是本步在壳层循环内重新计算的。** 上一步真正跨步传下来的只有三个量：LW 反馈场（经 `log10_Mturnover` 进入本步 $M_{\rm crit}$，见 §6 闭环）、X 射线预电离份额 $x_e^{\rm X}$（通道 B）、累积复合数（通道 C）。「电离光子」与「X 射线」在本步判据里扮演的角色完全不同：

- **电离光子（EUV，$h\nu>13.6\,$eV）**：被中性 IGM 强吸收，只能靠 $R$ 壳层内的源收集，决定判据左边的**正贡献**——光子预算超过消耗即电离；
- **X 射线（keV，穿透型）**：平均自由程远大于电离光子，在上一步已经把一部分中性氢**预电离**（次级电离），在本步把判据右边的中性份额从 $1$ 降为 $1-x_e^{\rm X}$，等效**降低电离门槛**。它不进入左边。

这两条通道对应 §1 步骤 5b/5c（X 射线源场 → 自旋温度）与步骤 5a（光子源网格）的分工：前者产出的 `xray_ionised_fraction` 在阶段 A 被 `prepare_box_for_filtering` 拷入 `xe_unfiltered`（`IonisationBox.c:1504-1506`），与密度、$M_{\rm crit}$ 一同经受壳层滤波，最终在判据里作为 `xHII_from_xrays` 被消费（`IonisationBox.c:1098`）。

---

### 2.1 阶段 A：预备（`IonisationBox.c:1492-1512`）

进入 `ComputeIonizedBox` 后，首先把**本步需要用到的所有场**做预备滤波 / 拷贝 / 截止：

| 场名                     | 操作                                    | 目的                                                                |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------- |
| `deltax`               | 拷贝到`deltax_filtered` + 下限 clamp  | 密度场，供后续壳层滤波                                              |
| `prev_deltax`          | 同上                                    | 上前一步的密度，用于 evaluate 在$M_{\rm crit}$ 跳变时的差分修正   |
| `log10_Mturnover`      | 格点值计算 + 拷贝 + clamp               | $M_{\rm crit}$ 场（主手册 §4.3）                                 |
| `log10_Mturnover_MINI` | 同上（MCG 版本）                        | 小质量晕反馈截断场                                                  |
| `stars_filtered`       | Lagrangian 模式：从 HaloBox 拷贝 SFR 场 | 混合产出（低质量积分 + 大质量采样）直接作为源（否则后续用积分重建） |
| `sfr_filtered`         | 同上，SFR 场（供 INHOMO_RECO）          | 非均匀复合修正                                                      |
| `N_rec_filtered`       | 当`filter_recombinations` 时 clamp≥0 | 复合数场                                                            |
| `xe_filtered`          | 当`USE_TS_FLUCT` 时 clamp∈[0,0.999]  | 自由电子丰度场                                                      |

---

### 2.2 阶段 B：壳层循环（`IonisationBox.c:1524`）

```c
for (R_ct = n_radii; R_ct--; )   // 从最大 R 递减到最小 R
```

这是 21cmFAST 的核心——**Excursion Set 原理**（主手册 §8.2.1）：对每个滤波半径 $R$ 从大到小尝试。

对一个给定的 $R$（记 `rspec_array[R_index]`），做：

```
copy_filter_transform(fg, R_index)
  → 把"源格点场"（fourier_grid）拷贝到 k 空间
  → filter_box(R) 施加球 top-hat of radius R（k 空间乘法）
  → 逆 FFT → deltax_filtered 等实空间场

calculate_fcoll_grid(fg, rspec, ...)
  → 遍历所有格点，计算每个格点的光子预算（定位见 §3.0，内部见 §3）

find_ionised_regions(fg, box, rspec, ...)
  → 遍历所有格点，判断电离条件，标记 x_HII（详见 §4）
```

**关键**：`R_ct` 递减意味着**先试大球再试小球**——大球能收集更多光子的格点优先电离。被大球电离的格点在后续小球壳层被跳过。

每次 `copy_filter_transform` 对以下场施加 R 波滤（即平滑到尺度 R）：

| Fourier 场                           | 目的                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| `fourier_grid[*].deltax`           | 平滑密度 →`deltax_filtered`                       |
| `fourier_grid[*].prev_deltax`      | 上步密度平滑（$M_{\rm crit}$ 差分修正用）          |
| `fourier_grid[*].log10_Mturn`      | 平滑$M_{\rm crit}$ → `log10_Mturnover_filtered` |
| `fourier_grid[*].log10_Mturn_MINI` | 同上 MINI 版                                         |
| `fourier_grid[*].stars`            | 平滑 Lagrangian SFR 场（混合源网格模式下使用）       |
| `fourier_grid[*].sfr`              | 平滑 SFR → 用于 INHOMO_RECO 复合修正                |
| `fourier_grid[*].N_rec`            | 平滑复合数（当 INHOMO_RECO 启用）                    |
| `fourier_grid[*].xe`               | 平滑电子丰度（USE_TS_FLUCT）                         |

**滤波的数学**：`copy_filter_transform` 内的 `filter_box`（`filtering.c:118`）先在 k 空间乘窗函数、再逆 FFT：

$$
\delta_R(\mathbf{x}) = \int \frac{d^3k}{(2\pi)^3}\,\tilde\delta(\mathbf{k})\,\tilde W(kR)\,e^{i\mathbf{k}\cdot\mathbf{x}}
$$

窗函数按 `HII_FILTER`（`filtering.c:31-45`）：

| 值            | 窗             | $\tilde W(kR)$                                            | 实空间含义                                                                                                                  |
| ------------- | -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `0`（默认） | 实空间 top-hat | $\dfrac{3(\sin kR-kR\cos kR)}{(kR)^3}$                    | $\delta_R(\mathbf{x})=\frac{3}{4\pi R^3}\int_{|\mathbf{r}|<R}d^3r\,\delta(\mathbf{x}+\mathbf{r})$：球内**等权平均** |
| `1`         | sharp-k        | $\Theta(k_c-k)$ | 球内严格等权，$M\propto R^3$ 严格成立 |                                                                                                                             |
| `2`         | 高斯           | $e^{-0.413\,(kR)^2}$                                      | 方差匹配 top-hat 的软窗                                                                                                     |

**关键**：实空间 top-hat 窗满足 $\int d^3r\,W(\mathbf{r})=1$，因此滤波是**平均**（量纲不变）而非求和——这决定了 §3.3 里 $f_{\rm coll}(\delta_R)$ 的量纲是"份额/归一化光子强度"，也决定了 §3.2 里 Lagrangian 的 `stars_filtered` 是"球内平均源强度"而不是"总光子数"。

---

## 3. calculate_fcoll_grid 内部（光子预算）

### 3.0 定位：谁调用、何时调、输入输出

先回答"它在哪、为什么此刻出现"——这是全文最容易被跳过的函数：

```
调用位置（本文档 §2 阶段 B）：
  ComputeIonizedBox (IonisationBox.c:1492)
   └─ 阶段 B 壳层循环（R 从大到小，IonisationBox.c:1524）
       ├─ copy_filter_transform(R)   ← 先把 δ、M_crit、stars 等平滑到尺度 R
       ├─ calculate_fcoll_grid(R)    ← 本节主角（IonisationBox.c:790）
       │     输入： 平滑后的 δ_R、log10_Mturnover_R（M_crit 场）、
       │            stars_filtered/sfr_filtered（仅 Lagrangian 模式）
       │            + scaling constants（ζ、标度关系参数，主手册 §5）
       │     输出： Splined_Fcoll、Splined_Fcoll_MINI（光子预算，格点数组）
       │            主手册 §2 的 ζ·f_coll 里的 f_coll
       └─ find_ionised_regions(R)    ← 用 Splined_Fcoll 判断电离（§4）
```

**调用时机**：每个壳层半径 $R$ 调一次（最多 `n_radii` 次），不是全函数一次。**对应主手册**：Path A（条件积分）= §3 + §6；Lagrangian 直接取场 = §8。**物理问题**：$f_{\rm coll}(\delta_R)$ = "尺度 $R$ 内、密度为 $\delta_R$ 的区域内，质量落在 $[M_{\min}, M_{\max}]$（主手册 §4.4 积分区间）的晕的质量份额，按 §2 的标度关系折成光子产出"——即主手册核心公式的积分在格点上的实例化。

### 3.1 Eulerian 与 Lagrangian：同一个 $f_{\rm coll}$，两种"源"模型（物理总览）

先回答最根本的问题：**为什么同一件事（算光子预算）要分两条路？** 因为"一个密度为 $\delta_R$ 的区域能产生多少电离光子"这个量，本质上取决于如何描述**星系源**——是当作连续场，还是当作离散的晕目录。**注意：这两条路不是独立开关，而是 `SOURCE_MODEL` 的派生属性**（`IonisationBox.c:152-153`）——选 `0/1` 自动进入 Eulerian 族，选 `2/3/4` 自动进入 Lagrangian 族，**没有"单独切换 Eulerian/Lagrangian"的选项**，族随模式而定：

```c
consts->mass_dep_zeta        = matter_options_global->SOURCE_MODEL > 0;
consts->lagrangian_source_grids = matter_options_global->SOURCE_MODEL > 1;
```

| `SOURCE_MODEL`                          | 族         | $f_{\rm coll}$ 怎么来                                                                                                                    | 效率 ζ               | 物理假设                                                     |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------ |
| `0` `CONST-ION-EFF`                   | Eulerian   | `EvaluateFcoll_delta`：纯坍缩分数 $F_{>\sigma_{\min}}(\delta_R)$ | `HII_EFF_FACTOR` 常数 | 所有 >$M_{\min}$ 的晕一视同仁，固定效率 |                       |                                                              |
| `1` `E-INTEGRAL`                      | Eulerian   | 条件积分`EvaluateNion_Conditional`：条件质量函数 × 单晕产出                                                                             | 质量依赖`ζ(δ_R)`  | 源是密度场的**光滑函数**，晕性质严格等于标度关系期望值 |
| `2` `L-INTEGRAL`                      | Lagrangian | 直接取`stars_filtered` 混合源网格（主手册 §8）                                                                                          | `= 1`（已折进源场） | 源是**离散晕目录的采样**，保留 Poisson 噪声            |
| `3` `DEXM-ESF`                        | Lagrangian | 同上（HaloBox 端多离散晕采样到 cell 质量）                                                                                                 | `= 1`               | 同上                                                         |
| `4` `CHMF-SAMPLER` **（默认）** | Lagrangian | 同上（采样占比最大）                                                                                                                       | `= 1`               | 同上                                                         |

**物理直觉——两种模式的本质区别：**

- **Eulerian（欧拉，站在空间点看）**：把源当作确定性平均场。给定 $\delta_R$，星系形成是期望过程：条件质量函数 $dn_c/d\ln M(M|\delta_R)$ 给出"区域内质量为 $M$ 的晕**平均**有几个"，每个晕按标度关系产生**期望**光子数。优点：无需追踪单个晕，积分可以查表（`USE_INTERPOLATION_TABLES`），快；缺点：**抹掉了离散性**。EoR 早期源稀少，一个格点常常只有零星几个晕——实际光子产出是强 Poisson 涨落（一个碰巧装了大晕的格点，光子远超期望值），期望近似把这种涨落抹平，导致电离图样偏"扩散、模糊"，且低估光子匮乏区的偶然电离。
- **Lagrangian（拉格朗日，跟着物质走）**：在 `ComputeHaloBox` 阶段（步骤 5a）就从晕目录**真正采样**出每个格点的源：低质量端（晕多、Poisson 噪声相对小）用积分期望值，大质量端（晕少、个体差异主导）用 Poisson 抽样（混合源网格，主手册 §8）。壳层循环里不再积分，直接读这个场。优点：保留源的离散性和晕际不均匀性，电离图样更真实（更"泡状"）；代价：必须先算完整晕盒（重），且每格点光子数是抽样结果、带噪声。

**为什么代码这么分**：这是**精度 vs 速度**的权衡。欧拉族（0/1）的定位是快速半解析模拟——`E-INTEGRAL` 一档在查表后每个格点只用 O(1) 次运算算 $f_{\rm coll}$；拉格朗日族（2/3/4）是"物理更真实"模式，与 `INHOMO_RECO` 搭配还能直接用 SFR 场算局域复合（行 1082-1093）。**注意默认值是 `CHMF-SAMPLER`（拉格朗日族）**（`inputs.py:682-684`），不是 Eulerian——v4 默认就带离散晕目录，用于保留早期稀有源的电离涨落。经典 `SOURCE_MODEL=0` 则保留 21cmFAST 原始版本的行为（常数效率、无质量依赖），用于与旧结果对比。

**一个常被问错的点**：Lagrangian 模式下判据里 `ion_eff_factor = 1`（`IonisationBox.c:173-175`），**不是**说"电离效率是 1"，而是 $f_\star$、$f_{\rm esc}$、$N_\gamma$ 已经在 `ComputeHaloBox` 阶段折进 `stars_filtered` 源场了，判据处不需要再乘。Eulerian 模式下源场是"裸密度"，效率必须在判据处由 `ζ(δ_R)$ 补上。

下面分别展开两条路径的实现细节。**顺序说明**：实现小节按代码行号排（Lagrangian 分支在 `calculate_fcoll_grid` 里先出现，行 817；Eulerian 在行 834），与 §3.1 总览表"先欧后拉"的罗列顺序无关。

### 3.2 Lagrangian 模式（`SOURCE_MODEL` 2/3/4，行 817-833）

直接从混合源网格取：`Splined_Fcoll = stars_filtered[cell]`（行 826）。

ComputeHaloBox **已经为每个格点完成了混合源网格**（主手册 §8）：低质量端由 `set_fixed_grids` 积分期望值、大质量端由 `sum_halos_onto_grid` 做 Poisson 采样（`HaloBox.c:628-644`），二者合并进 `stars_filtered`。壳层循环内**不再做 Path A 条件积分**，直接取该场（`Splined_Fcoll_MINI = 0`，mini 已含在源场里，行 828）。

**是"球内等权平均"，不是"求和"**（`IonisationBox.c:613-615`，`filter_hf = USE_EXP_FILTER ? 3 : hii_filter`）：

$$
\overline{n}_{\rm ion}(\mathbf{x};R) = \frac{3}{4\pi R^3}\int_{|\mathbf{r}|<R} d^3r\, n_{\rm ion}(\mathbf{x}+\mathbf{r})
$$

卷积窗是归一化的（$\int W\,d^3r=1$），量纲保持为"每格光子强度"的平均——因为 `n_ion` 已含 $f_\star$、$f_{\rm esc}$、$N_\gamma$ 全部效率，平均后直接当 `Splined_Fcoll` 用（`ion_eff_factor=1`）。若开 `USE_EXP_FILTER`，窗换成 Davies & Furlanetto 的指数 MFP 窗 `exp_mfp_filter`（`filtering.c:79-103`），实空间约 $e^{-r/\lambda}$ 加权、远源按 $e^{-R/\lambda}$ 衰减——对应"光子传播 R 距离逃出 IGM"的概率，不再是等权相加。

**$M_{\rm crit}$ 跳变修正**（行 830-831）——这是 Lagrangian 特有的一步，物理上很重要：

```
Nion_smoothed(z, M_crit) = Nion(z, M_crit)
    + [Nion(z_prev, M_crit_prev) - Nion(z_prev, M_crit)]
```

**为什么需要**：混合源网格的离散采样是用**上一步**的 $M_{\rm crit}$ 做截断生成的（晕表在步骤 5a 已定）。但本步的 $M_{\rm crit}$ 可能因 LW 反馈（§6 闭环）发生变化——若 $M_{\rm crit}$ 跳变，直接乘一个用新 $M_{\rm crit}$ 算的因子会让 $f_{\rm coll}$ 不连续。修正项的物理含义：把 $M_{\rm crit}$ 变化对光子预算的贡献拆出来，用**积分量**（对密度条件积分，差异小、较精确）补齐采样与期望之间的差。等价于"假设 $f_{\rm coll}$ 对 $M_{\rm crit}$ 的依赖是光滑的，把跳变部分线性化"。

### 3.3 Eulerian 模式（`SOURCE_MODEL` 0/1，行 834-877）

每个格点用条件积分（Path A），积分式（主手册 §6、`EvaluateNion_Conditional`）：

$$
f_{\rm coll}(\delta_R) = \int_{\ln M_{\min}}^{\ln M_{\max}} d\ln M\ \frac{dn_c}{d\ln M}(M\,|\,\delta_R)\ \bar{n}_{\rm ion}(M)
$$

其中 $dn_c/d\ln M(M|\delta_R)$ 是**条件质量函数**——excursion set 的核心工具，回答"给定尺度 $R$ 内平均过密度 $\delta_R$，质量为 $M$ 的晕的数量期望"。物理上它编码了**偏袒（bias）**：高密度区有更多、更大的晕，故 $f_{\rm coll}$ 是 $\delta_R$ 的增函数。$M_{\min}$ 由平滑后的 $M_{\rm crit}$ 场决定（LW 反馈，§6），$M_{\max}$ 由滤波半径决定（$M_{\max,R}={\rm RtoM}(R)$，比 $R$ 更大的晕不算"在 $R$ 内"）。

实现细节（行 834-877）：

1. **质量依赖积分路径**（`mass_dep_zeta=True`，即 `SOURCE_MODEL==1`）：主积分 `EvaluateNion_Conditional(δ, M_turn, ...)` 得 ACG 产出；**若再开 `USE_MINI_HALOS`**，才先 `EvaluateNion_Conditional_MINI(δ, M_turn_MINI, ...)` 得 MCG 产出（两个独立积分，同区间+指数窗分离，见主手册 §6 双函数讨论）。两者都走 `Nion_ConditionalM*`，内部用 `INTEGRATION_METHOD_ATOMIC/MINI` 指定的积分器；`USE_INTERPOLATION_TABLES>1` 时直接查 $\ln f_{\rm coll}(\delta, \log_{10}M_{\rm turn})$ 二维表（`interp_tables.c:994-1022`）——这是 Eulerian 能快的关键：条件积分只在建表时做一次，壳层循环里全部 O(1) 查表。
2. **$M_{\rm crit}$ 变化修正**（行 848-866）：当前步与上步 $M_{\rm crit}$ 不同时，额外评估 `prev_Splined_Fcoll = EvaluateNion_Conditional(prev_δ, prev_M_turn, prev_gf)`。**物理含义与 §3.2 相同**——$f_{\rm coll}$ 对 $M_{\min}$（即 $M_{\rm crit}$）敏感（软截断尾部，见主手册 §7.1），$M_{\rm crit}$ 跳变会让 $\langle N_{\rm ion}\rangle$ 跳变；用上步密度、上步 $M_{\rm crit}$ 的积分做差分，保证连续。注意这里的触发条件是**上一红移步**的全局量 `prev mean_f_coll_MINI·ion_eff_factor_mini_gl + prev mean_f_coll·ion_eff_factor_gl > 1e-4`（行 848-852）：上一步电离率极低时跳过整个修正（prev=0）。由于条件是全局标量，对盒子内所有格点同真同假，是"整盒跳过"而非逐格判断——纯性能优化（避免几乎无电离时昂贵的 prev 积分）。
3. **无 MCG**（`mass_dep_zeta=False`，即 `SOURCE_MODEL==0`）：仅 `EvaluateFcoll_delta(δ, gf, σ_min, σ_max)`，即 $F_{>\sigma_{\min}}$ 坍缩分数（`FgtrM_bias_fast`）。没有质量积分、没有质量依赖——这就是经典 21cmFAST 的 $\zeta f_{\rm coll}$ 常数效率模型。

#### 完整公式链（Eulerian：密度 → 平滑 → 条件积分 → ζ）

整个链路（§2.2 滤波数学 + 本节积分）：

$$
\delta(\mathbf{x}) \xrightarrow[\text{top-hat 平滑}]{} \delta_R(\mathbf{x})
\xrightarrow[\text{条件 HMF 积分}]{} f_{\rm coll}(\delta_R)
\xrightarrow{\times\,\zeta} \text{判据}
$$

**条件质量函数显式式**（EPS 形式，`hmf.c:285-298`；$\sigma_1\equiv\sigma(M)$、$\sigma_R\equiv\sigma(M_{\max}(R))$；ST/Delos 为移动势垒的推广）：

$$
\frac{dn_{\rm cond}}{d\ln M}(M\,|\,\delta_R) =
-\frac{(\delta_c-\delta_R)\,\frac{d\sigma^2}{d\ln M}}
{\sqrt{2\pi}\,(\sigma^2-\sigma_R^2)^{3/2}}
\exp\!\left[-\frac{(\delta_c-\delta_R)^2}{2(\sigma^2-\sigma_R^2)}\right]
$$

**单晕产出是"归一化"的**：被积函数里的 $\tilde f_* = (M/10^{10}M_\odot)^{\alpha_*}$、$\tilde f_{\rm esc}$ 同理，且 `log_scaling_PL_limit` 非 clamp 分支**不含 $\ln_{\rm norm}$**（`scaling_relations.c:210-216`）——真正的 $f_{*,10}f_{\rm esc,10}$ 被拆到外部的 ζ，所以"归一化积分 × ζ"的分解成立：

$$
f_{\rm coll}(\delta_R) =
\int_{\ln M_{\min}}^{\ln M_{\max}(R)} d\ln M\;
\frac{dn_{\rm cond}}{d\ln M}(M|\delta_R)\;
\tilde f_*(M)\,\tilde f_{\rm esc}(M)\,M\,e^{-M_{\rm turn}/M}
$$

积分区间：下限 $M_{\min}$ = 平滑后的 $M_{\rm crit}$ 场（LW 反馈，§6），被积函数内另有指数软截断 $e^{-M_{\rm turn}/M}$；上限 $M_{\max}(R)=\frac{4\pi}{3}\bar\rho_m R^3 = {\rm RtoM}(R)$——半径 $R$ 球内的**总质量**，比它更大的晕不算"在 $R$ 内"。对应的方差 $\sigma_R$ 经 `rspec->sigma_maxmass` 传入。

**ζ 的拆分**：`Nion_ConditionalM` 返回归一化量，效率基准 $\zeta = f_{*,10}f_{\rm esc,10}\zeta_{\rm ion}$ 留在 `ion_eff_factor`（`IonisationBox.c:164,177`），判据处：

$$
\zeta\, f_{\rm coll}(\delta_R) + \zeta_{\rm mini}\, f_{\rm coll,mini}(\delta_R)
\;>\; (1+\bar n_{\rm rec})\,(1-x_e^X)
$$

与 §3.2 的对应：Eulerian 的"对 $\delta_R$ 的条件积分"正是 Lagrangian "对 $n_{\rm ion}$ 的平滑"的解析期望版本——密度高斯、采样充分时两者等价；区别在 Eulerian 把「密度→源」当确定性函数（抹掉晕的 Poisson 涨落），Lagrangian 保留真实晕位置与离散性。

---

## 4. find_ionised_regions 内部（电离判断）

`find_ionised_regions`（`IonisationBox.c:1060`）是三重循环（`for(x) for(y) for(z)`）遍历所有格点。

### 4.1 电离条件（行 1112-1114）

这是 §2.0 三条通道汇合的落点。判据的物理形式是 excursion-set 的光子预算不等式：**滤波尺度 $R$ 内电离光子数 ≥ 消耗数（复合 + 残余中性氢）**

$$
\langle n_{\rm ion}\rangle_R \;\ge\; \langle n_{\rm rec}\rangle_R
$$

代码逐格点实现为：

```c
if (curr_fcoll * ion_eff + curr_fcoll_mini * ion_eff_mini
    > (1 + rec) * (1 - xHII_from_xrays))
    // 电离！
```

$$
\zeta\, f_{\rm coll}(\delta_R) \;+\; \zeta_{\rm mini}\, f_{\rm coll,mini}(\delta_R)
\;>\;
(1+\bar{n}_{\rm rec})\,(1-x_e^{\rm X})
$$

**判据两侧的量纲必须一致：都是"每单位重子质量的光子数"（无量纲）**——这是整个不等式成立的前提，也是最容易误读的地方。三个概念先厘清：

- **"每重子"还是"每重子质量"？** 代码里除的是**重子质量密度** $\rho_{\rm crit}\Omega_b(1+\delta)$（行 1064-1065），严格说是"每单位重子质量的光子数"。但质量密度与重子**数**密度只差常数 $m_p$，所以两种说法是同一件事——文献口语说"每重子"，代码实际按质量密度除。关键是两侧都归一到"单位重子"基准。
- **不是"每秒"**：判据两侧都是**累积光子数**——$N_\gamma$ 是恒星寿命内的光子总数，$\bar n_{\rm rec}$ 是到当前时刻的累积复合数（见下），均无量纲。
- **Nγ 的"重子"≠ 判据的"重子"**：Nγ（默认 5000，`inputs.py:1259-1260`）是"**恒星内**的重子"——每个参与恒星形成的重子产出的电离光子数；判据右侧的"重子"是**当地所有重子**（含未坍缩进晕的）。两个基准靠效率链换算（见下文公式）。

**为什么 Lagrangian 端必须除**——因为它的 `n_ion` 是**绝对光子数密度**，不是份额：

```c
// HaloBox.c:88-89 —— 单晕的光子数（无体积因子）
n_ion_sample = stellar_mass * pop2_ion * fesc + stellar_mass_mini * pop3_ion * fesc_mini;
// map_mass.c:458-459 —— 网格化后乘格点体积倒数
boxes->n_ion[i_cell] *= cell_vol_inv;   // → 光子数/Mpc³（密度！）
```

它带着"当地有多少重子"的密度信息，**不能直接拿去比较**。判据前先除以当地重子质量密度（行 1064-1065）把密度剥离：

$$
\frac{n_{\rm ion}(\mathbf{x};R)}{\rho_{\rm crit}\Omega_b\,(1+\delta_R(\mathbf{x}))}
\;\longrightarrow\;\text{每重子光子数}
$$

**Eulerian 端不用除**——因为它的条件质量函数**根本不是"数密度"，而是"份额导数"**。通常的 HMF 返回每 Mpc³ 每 M 的光晕**数密度**：

$$
\frac{dn_c}{dM} = \frac{\bar\rho_m}{M}\,\frac{df_c}{dM}
$$

要从中得到坍缩质量**份额** $f_{\rm coll}$，标准算法必须乘 $M$ 再除以 $\bar\rho_m$——这个 $M/\bar\rho_m$ 就是"隐式除法"：

$$
f_{\rm coll} = \int \frac{M}{\bar\rho_m}\,\frac{dn_c}{dM}\,dM = \int \frac{df_c}{dM}\,dM
$$

而代码的 `dNdM_conditional_EPS`（`hmf.c:285-298`，条件 EPS / Lacey & Cole 1993）返回的**就是**右边那个 $df_c/dM$——EPS 公式的质量份额形式，$\bar\rho_m$ 与 $M$ 因子从头到尾没出现过：

$$
\frac{df_c}{dM}\bigg|_{\delta_R} = -\frac{\delta_c - \delta_R}{\sqrt{2\pi}}\,
\frac{d\sigma^2/dM}{(\sigma^2 - \sigma_R^2)^{3/2}}\,
\exp\!\left[-\frac{(\delta_c - \delta_R)^2}{2(\sigma^2 - \sigma_R^2)}\right]
$$

（$\delta_c$ 与条件阈值 $\delta_R$ 均经增长因子线性外推，对应代码 `del = (delta_c_sph - delta_cond)/growthf`；$d\sigma^2/dM<0$，负号与导数共同保证 $df_c/dM>0$。）

于是条件坍缩份额直接就是一次**无量纲**积分（`hmf.c:473-475`：积分变量是 $\ln M$，被积函数取 $M\cdot df_c/dM = df_c/d\ln M$）：

$$
f_{\rm coll}(\delta_R) = \int_{\ln M_{\min}(\delta_R)}^{\infty} \frac{df_c}{d\ln M}\,d\ln M
= \int_{M_{\min}(\delta_R)}^{\infty} \frac{df_c}{dM}\,dM
\quad(\text{无量纲份额})
$$

**这就是"隐式除法"的全部含义**：$df_c$ 的定义是"质量份额"而非"光晕数"，除以 $\bar\rho_m/M$ 的动作在 EPS 公式的定义里就完成了——密度信息从未进入积分。`conditional_hmf` 的注释印证了这一点（`hmf.c:439`：`dNdlnM = dfcoll/dM * M / M * constants`，"$M/M$"即换到 $\ln M$ 时质量因子自行抵消）。而 Lagrangian 端 `n_ion` 是绝对密度，享受不到这层"定义内归一化"，必须显式除。代码注释说得最直白（`IonisationBox.c:1060-1063`）：

```C
// Since the halo boxes give ionising photon output, this term accounts for the
// local density of absorbers
//   We have separated the source/absorber filtering in the halo model so this
//   is necessary
```

**"ζ f_coll 就是 n_ion"要修正为**：ζ f_coll 不是 `n_ion` 本身，而是 `n_ion` **除以重子质量密度之后**：

$$
\frac{n_{\rm ion}(\text{光子数/Mpc}^3)}{\rho_b(\text{M}_\odot/\text{Mpc}^3)}
\;\Longleftrightarrow\;
\zeta f_{\rm coll}
$$

Eulerian 端的除法是**隐式**的（藏在 $f_{\rm coll}$ 份额定义里），Lagrangian 端是**显式**的（因为 $n_{\rm ion}$ 是绝对密度）。两条路径殊途同归，都是"每重子光子数"。

**Nγ 与 $f_{\rm coll}$ 的基准换算**（效率参数拆法见 §3.3）：Nγ 提供"光子/恒星重子"，$f_{\star10}$ 与 $f_{\rm coll}$ 依次把它换成"光子/总重子"：

$$
\zeta f_{\rm coll} = \underbrace{f_{\star10}}_{\frac{\text{恒星重子}}{\text{晕重子}}}
\underbrace{f_{\rm esc10}}_{\text{逃逸}}
\underbrace{N_\gamma}_{\frac{\text{光子}}{\text{恒星重子}}}
\times \underbrace{f_{\rm coll}}_{\frac{\text{晕重子}}{\text{总重子}}}
= \frac{\text{光子}}{\text{总重子}}
$$

右侧的 `rec` 同样做了每重子归一化（行 1090 `rec /= (1+curr_dens)`）——`recombinations.c:179` 注释即为 "recombination rate **per baryon**"。

于是判据的物理语言可以压缩为：

$$
\underbrace{\text{每重子电离光子供给（累积）}}_{\zeta f_{\rm coll}(\delta_R)+\zeta_{\rm mini}f_{\rm coll,mini}(\delta_R)}
\;>\;
\underbrace{\text{每重子光子消耗（累积）}}_{(1-x_e^{\rm X})\,(1+\bar n_{\rm rec})}
$$

两条通路数值一致的机制：共享同一标度关系与同一效率参数，且 Lagrangian 端靠 `mean_fix_term_acg`（行 1020-1021，§2.0 通道 C）把采样盒平均**强制校准**到解析期望 `mean_f_coll`——"对齐"靠校准保证，不是天然相等（Poisson 涨落见 §3.1）。

各量定义（与 §2.0 通道一一对应）：

| 符号                                                                                                                                                    | 代码                | 定义与来源                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| $\zeta$ | `ion_eff` | **电离效率（通道 A 的归一）**：$\zeta = f_{\star,10}\, f_{\rm esc,10}\, N_{\gamma,\rm II}$（`IonisationBox.c:164`） |                     |                                                                                                                                              |
| $\zeta_{\rm mini}$ | `ion_eff_mini` | MCG 版：$\zeta_{\rm mini} = f_{\star,7}\, f_{\rm esc,7}\, N_{\gamma,\rm III}$（`IonisationBox.c:165`）    |                     |                                                                                                                                              |
| $f_{\rm coll}(\delta_R)$                                                                                                                              | `curr_fcoll`      | **光子预算（通道 A）**：尺度 $R$ 内落在 ACG 质量区间的晕质量份额，经条件积分或混合源网格得到（§3）；$f_{\rm coll,mini}$ 为 MCG 版 |
| $\bar{n}_{\rm rec}$                                                                                                                                   | `rec`             | **复合因子（通道 C）**：均匀复合常数，`INHOMO_RECO` 时叠加 `N_rec_filtered` 场                                                     |
| $x_e^{\rm X}$                                                                                                                                         | `xHII_from_xrays` | **X 射线预电离份额（通道 B）**：上一步 `spin_temp->xray_ionised_fraction` 经壳层滤波（`IonisationBox.c:1098, 1504-1506`）          |

**X 射线在判据里的唯一显式角色就是右边的 $(1-x_e^{\rm X})$**：把中性份额从 1 降到 $1-x_e^{\rm X}$，等效降低电离门槛。Eulerian 模式下 $f_{\rm coll}$ 本身的积分还隐含第二个 X 射线关联——$M_{\rm crit}$ 场（LW 反馈，§6）决定了积分下限 $M_{\min}$，而 $M_{\rm crit}$ 由 X 射线/恒星场共同驱动。

（$f_{\rm coll}$ 的完整积分式不在此重复：Eulerian 见 §3.3"完整公式链"，Lagrangian 见 §3.2。）

**判据右边的物理拆解——每个因子回答"这笔光子账为什么这么贵"**：

| 因子                                                                                                                                                                                                      | 物理含义                                                                                                                                            | 代码来源 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| $(1-x_e^{\rm X})$ | **实际待电离的中性份额**。$x_e^{\rm X}$ 是 X 射线预电离留下的残余电子（通道 B，行 1098）：已经电离的重子不必再花光子，所以中性份额从 1 降到 $1-x_e^{\rm X}$，等效降低门槛 | `xHII_from_xrays`                                                                                                                                 |          |
| $1$                                                                                                                                                                                                     | **电离一个氢原子本身的成本**：每个中性重子至少需要 1 个 $h\nu>13.6\,$eV 光子                                                                | 常数 1   |
| $\bar n_{\rm rec}$                                                                                                                                                                                      | **维持成本**：已电离的重子到当前时刻累计平均复合 $\bar n_{\rm rec}$ 次，每次复合都要再电离补 1 个光子。复合不是一次性消费，而是持续的"漏水" | `rec`  |

$\bar n_{\rm rec}$ 的物理来源（`IonisationBox.c:1277-1278`，通道 C）：每格点每时间步的复合增量

$$
dN_{\rm rec} = R_{\rm rec}(z_{\rm eff},\Gamma)\,\frac{dt}{dz}\,dz\,(1-x_{\rm H})
$$

复合率 $R_{\rm rec}$ 依赖有效红移与当地电离背景 $\Gamma$（光致电离屏蔽，`splined_recombination_rate`），只作用在已电离部分 $(1-x_{\rm H})$，逐时间步累加进 `cumulative_recombinations`；判据处再除以 $(1+\delta)$ 归一到每重子。**注意 $\bar n_{\rm rec}$ 是"累积"的每重子复合数**（不是瞬时速率），这正是 `INHOMO_RECO` 时它需要随壳层滤波（行 1087）的原因——复合数也要按 R 球平均，才能与 R 球内的光子供给同尺度比较。

**Excursion-set 扫描的物理图像**（行 1524 起）：对每个格点，从最大半径 $R$ 递减尝试。第一个满足上式的 $R$ 定义了该格点 HII 泡的**尺度**——光子从 $R$ 球内全部源收集，球边界正是"供给=消耗"的临界处。$R$ 递减 = 泡向内收缩的尝试：大球光子不够（被稀薄源区拖累）就换小球；**中心格点被"最大可行 $R$"电离，这就是电离图样中泡尺寸的由来**。已被更大 $R$ 标记电离的格点，在后续更小 $R$ 壳层被跳过（Center/Sphere 模式见 §4.2）。

### 4.2 两种标记模式（行 1144-1152）

| 模式                                     | 机制                                 |
| ---------------------------------------- | ------------------------------------ |
| Center（`IONISE_ENTIRE_SPHERE=false`） | R 球光子充分 → 只标中心格点为电离   |
| Sphere（`IONISE_ENTIRE_SPHERE=true`）  | R 球光子充分 → 球内所有格点标记电离 |

### 4.3 部分电离（行 1155-1190）

在最后一个壳层（`R_index==0`）且格点尚未被完全电离时，执行部分电离：

```c
res_xH = 1.0 - curr_fcoll * ion_eff - curr_fcoll_mini * ion_eff_mini
res_xH -= xHII_from_xrays
// clamp 到 [0, 1]
box->neutral_fraction[cell] = res_xH
```

若 `USE_TS_FLUCT=True`，还同时根据 `x_HII` 计算部分电离温度 $T_K$（`ComputePartiallyIonizedTemperature`）。

**部分电离的物理**：格点在**所有** $R$ 上都不满足判据（供给恒小于消耗），说明光子不足——但它也不是完全中性。剩余中性分数就是"欠账"：

$$
x_{\rm H} = 1 - \underbrace{\big[\zeta f_{\rm coll}+\zeta_{\rm mini}f_{\rm coll,mini}\big]}_{\text{已电离的每重子光子}} - \underbrace{x_e^{\rm X}}_{\text{X 射线已电离份额}}
$$

物理含义：供给的光子把对应份额的重子电离了，剩下的 $\big[1-\zeta f_{\rm coll}-\zeta_{\rm mini}f_{\rm coll,mini}\big]$ 没有被电离（再扣除 X 射线预电离份额，clamp 到 $[0,1]$）。这是"光子星斥（photon-starved）"区——再电离进行中尚未被泡覆盖的区域，$x_{\rm H}$ 在 0 到 1 之间连续取值，为温度场（`ComputePartiallyIonizedTemperature`）提供边界条件。**与完全电离格点的差异**：完全电离（§4.1）表示供给溢出，$x_{\rm H}=0$；部分电离表示供给连最小 $R$ 球都覆盖不了，$x_{\rm H}>0$。

### 4.4 判据与"再电离反馈"：两个"再电离"的区分

判据本身描述的是**再电离过程**——这个格点此刻是否被电离（局部事件）。而冷却链路里的"再电离反馈"（`thermochem.c:302-307`，Sobacchi & Mesinger 2013 参数化）是**同一个过程的后果反过来抑制恒星形成**，两者不是一回事：

|          | 判据（本节）               | 再电离反馈（`thermochem.c`）                                                                                                                                    |
| -------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本质     | 过程：IGM 被电离的局部判据 | 反馈：UVB 抬高$M_{\rm crit}$，抑制小晕恒星形成                                                                                                                  |
| 作用对象 | 格点（宏观 IGM）           | 单个晕（微观）                                                                                                                                                    |
| 物理量   | $x_{\rm HII}$ 场推进     | $M_{\rm crit}^{\rm RE} = 3\times10^9\,(2\Gamma_{\rm HII})^{0.17}\left(\frac{1+z}{10}\right)^{-2.1}\left[1-\left(\frac{1+z}{1+z_{\rm IN}}\right)^2\right]^{2.5}$ |
| 机制     | 光子供给 vs 复合消耗       | UVB 光致蒸发加热 vs 气体冷却                                                                                                                                      |

**反馈进入判据的路径**：再电离进行 → 出现电离背景 UVB（$\Gamma_{\rm HII}$ 增大）→ $M_{\rm crit}^{\rm RE}$ 上升 → 积分下限 $M_{\min}$ 抬高（`hmf.c:719-720` 的 `lnM_lo_limit`）→ $f_{\rm coll}$ 变小（§3.3 积分核尾部被截）→ 判据左侧供给减少 → 再电离放缓。这是自洽**负反馈闭环**：

$$
\text{再电离} \;\to\; \Gamma_{\rm HII}\uparrow \;\to\; M_{\rm crit}\uparrow \;\to\; f_{\rm coll}\downarrow \;\to\; \text{电离源减少} \;\to\; \text{再电离放缓}
$$

时间上反馈只在再电离已开始后开启（$z<z_{\rm IN}$ 且 $\Gamma_{\rm HII}>0$ 时非零）。**一句话**：判据回答"IGM 该不该电离"（需求/供给平衡），反馈回答"电离光子从哪来"（源的门槛），二者经 $\Gamma_{\rm HII}$ 与 $f_{\rm coll}$ 互相咬合、构成闭环。

---

## 5. 阶段 E：后处理

壳层循环结束后，`ComputeIonizedBox` 做收尾：

1. **全局统计量**：`mean_f_coll`、`mean_f_coll_MINI` 存入 `IonizedBox`，供下一步的 `prev_*` 使用
2. **温度赋值**：对已电离格点，调用 `set_ionized_temperatures` 设定 $T_K = T_{\rm re}$（再电离温度）
3. **LW 反馈场准备**：根据本步 SFRD 分布，计算 $J_{21}^{\rm LW}$ 场 → 输入下一步的 `lyman_werner_threshold` → 决定下一步的 $M_{\rm crit}$ 分布

---

## 6. LW 反馈闭环（跨步数据流）

这也是主手册 §4.3 的 $M_{\rm crit}$ 模型在代码中的落点：

```
t_n 步:
  calculate_fcoll_grid → Splined_Fcoll_MINI
  → 包含 MCG 的 SFRD 贡献
  → (在 ComputeIonizedBox 末尾)
  → 从 SFRD 场计算 J_LW 辐射场

t_{n+1} 步:
  (ComputeIonizedBox 开头,行 426-431)
  lyman_werner_threshold(z, J_LW, vcb)  ← 逐格 J_21_LW 场 + vcb
  → M_crit[cell] = F(J_LW, vcb, z)  [主手册 §4.3 公式]
  → M_crit 增大 → MCG 被抑制 → SFRD_MCG 降低
```

这是**负反馈自洽环**：MCG 越多 → LW 辐射越强 → $M_{\rm crit}$ 越高 → MCG 被更早抑制。通常 3-5 步收敛，代码默认在每个红移步间不迭代（单步假设 LW 场变化缓慢）。

---

## 7. 两种模式对比

| 维度                                                                                                            |      Eulerian（`SOURCE_MODEL` 0/1）      |          Lagrangian（`SOURCE_MODEL` 2/3/4）          |
| --------------------------------------------------------------------------------------------------------------- | :----------------------------------------: | :-----------------------------------------------------: |
| 光子预算来源                                                                                                    | 每个壳层现场积分$f_{\rm coll}(\delta_R)$ | HaloBox 混合源网格（低质量积分 + 大质量采样）+ FFT 平滑 |
| 额外开销                                                                                                        | `calculate_fcoll_grid` 每壳层逐格点积分 |           `ComputeHaloBox` 一次 + FFT 平滑           |
| Poisson 噪声                                                                                                    |         **无**（均为期望值）         |           **有**（离散采样的涨落保留）           |
| $M_{\rm crit}$ 修正 |       积分内换$M_{\rm turn}$ 参数       |            上步-本步$M_{\rm turn}$ 差分项 |                                            |                                                        |
| 大质量晕的稀有事件                                                                                              |           期望值平均化，可能低估           |              自然处理（Poisson + 双幂律）              |
| 适用场景                                                                                                        |          平滑大尺度、快速参数扫描          |           小体积盒子、精细统计、MCG 占主导时           |
