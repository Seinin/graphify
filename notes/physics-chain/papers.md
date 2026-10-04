# 代码里的论文出处（含"拟合公式"那一批）与本地存量核对

本清单**只收代码注释里真实出现的引用**，按 `文件:行` 逐条可查。**不补全、不推断 DOI、不扩写残缺条目**——代码怎么写，这里怎么抄。第二栏"用途"是那处代码在做什么（拟合 / 参数定义 / 选项说明），不是我的解释性归类。

本地存量只按仓库里现有的文件核对：根目录三份 PDF（`21cm_physics_derivation.pdf`、`Pritchard & Loeb 2012 Review.pdf`、`The impact of the first galaxies on cosmic dawn and reionization.pdf`）；`docs/notes/` 下全是工程/主题笔记，没有论文正文。

## 一、拟合公式与解析式的来源

| 拟合的是**什么** | 代码位置 | 代码里的出处原文 | 本地 |
| --- | --- | --- | --- |
| 线性转移函数 `TFmdm` | `src/py21cmfast/src/cosmology.c:52` | "the power spectrum transfer function from Eisenstein & Hu ApJ, 1999, 511, 5" | ✗ |
| BBKS 转移函数 | `cosmology.c:74` | "Bardeen et al 1986 ApJ, 304, 15" | ✗ |
| ↑ 的重子修正 | `cosmology.c:75, 100, 113` | "with baryon correction from Sugiyama 1995 ApJS 100, 281" | ✗ |
| Efstathiou 转移函数 | `cosmology.c:86` | "Efstathiou et al 1992 MNRAS 258, 1"（并注明 "different from Bond & Efstathiou 1984"） | ✗ |
| Peebles 转移函数 | `cosmology.c:99` | "Peebles 1980 p.626" | ✗ |
| 白噪声/White 转移函数 | `cosmology.c:112` | "Actually from Davies, Efstathiou, Frenk & White 1985 ApJ 292, 371" | ✗ |
| FDM/WDM 转移函数系数 | `cosmology.c:23-25` | "Bode et al. 2000 trans. funct."（`BODE_e/n/v` 三个参数） | ✗ |
| 转移函数里的 Liddle 系数 | `cosmology.c:710, 768` | "it is taken from liddle et al." | ✗ |
| 维里过密度 `Δ_vir` | `cosmology.c:657` | "fitting formula from Bryan & Norman 1998" | ✗ |
| 球塌缩/参考 | `cosmology.c:666` | "from Barkana & Loeb 2001" | ✗ |
| **FOF 质量函数（含红移演化）** | `hmf.c:25-45` | "Universal FOF HMF (Watson et al. 2013)"，13 个拟合参数 `Watson_A/alpha/beta/gamma` 与 `*_z_*` | ✗ |
| **Sheth–Tormen 参数** | `hmf.c:59-61` | "Sheth and Tormen a/p/A parameter (from Jenkins et al. 2001)" | ✗ |
| 条件质量函数 | `hmf.c:199` | "Sheth Tormen 2002 fit for the CMF" | ✗ |
| 晕偏置 | `hmf.c:141` | "Mo & White 1996 fit" | ✗ |
| 移动势垒 | `hmf.c:125` | "DexM uses a fit to this barrier to acheive MF similar to ST" | ✗ |
| **Delos 随机游走质量函数** | `hmf.c:150` | "Unconditional Mass function from Delos 2023 (https://arxiv.org/pdf/2311.17986.pdf)" | ✗ |
| Delos 临界过密度 | `src/py21cmfast/src/Constants.h:62` | "critical overdensity in Delos 2025 random walk model" | ✗ |
| **Case A 复合系数** | `src/py21cmfast/src/thermochem.c:66`（`thermochem.h:14`） | "the case A hydrogen recombination coefficient (Abel et al. 1997) in cm^3 s^-1" | ✗ |
| **Case B 复合系数** | `thermochem.c:78`（`thermochem.h:16`） | "the case B hydrogen recombination coefficient (Spitzer 1978) in cm^3 s^-1" | ✗ |
| 电离反馈 | `thermochem.c:21` | "For reionization_feedback, reference Sobacchi & Mesinger 2013" | ✗ |
| 演化电离盒方程 | `thermochem.c:44` | "evolving ionized box eq. 6 of McQuinn 2015" | ✗ |
| UV 光度函数（论文的 Schechter 形式；代码改用晕质量函数换元，分野记在真源 `theory`） | `src/py21cmfast/src/LuminosityFunction.c:2` | "G. Sun and S. R. Furlanetto (2016) MNRAS, 417, 33" | ✗ |
| 电离区平均自由程 `R_max` | `src/py21cmfast/src/IonisationBox.c:182` | "Yuxiang's evolving Rmax for MFP in ionised regions **fit from Songaila+2010**" | ✗ |
| 绝热指数修正 | `IonisationBox.c:204` | "from 2302.08506 to fix adiabatic…"（arXiv 号，代码未给作者） | ✗ |
| **FDM 质量函数压制** | `src/py21cmfast/src/fdm.c:10, 51`（`fdm.h:7`） | "Schive et al. (2016), PRL 116, 201302" + "Schive et al. (2016), Eq. (7); Liu et al. (2025), Eq. (3)" | ✗ |
| FDM 核心-晕关系插值 | `src/py21cmfast/src/interp_tables.c:1244, 1249` | "This reproduces Liu et al. (2025), Eq. (5)" / "Reference: Liu et al. 2025, PRD 112, 103534, Eq. (5)" | ✗ |
| **ZA（一阶拉格朗日）速度** | `src/py21cmfast/src/InitialConditions.c:747` | "ZA reference: Scoccimarro R., 1998, MNRAS, 299, 1097-1118 Appendix D" | ✗ |
| 树生成/森林 | `src/py21cmfast/src/Stochasticity.c:501-502` | "modified from the tree generation function in Darkforest (Qiu et al 2020. ArXiv: 2007.14624)" | ✗ |
| 随机性对照测试 | `Stochasticity.c:287` | "only currently used for internal testing against Nikolic et al. 2024" | ✗ |
| 自旋温度盒 | `src/py21cmfast/src/SpinTemperatureBox.c:1249` | "Meiksin et al. 2021" | ✗ |

## 二、参数与选项级的引用（`wrapper/inputs.py` 等）

| 参数/选项 | 代码位置 | 出处原文 | 本地 |
| --- | --- | --- | --- |
| 转移函数选项 | `wrapper/inputs.py:581-585` | `EH : Eisenstein & Hu 1999`、`BBKS: Bardeen et al. 1986`、`EFSTATHIOU: Efstathiou et al. 1992`、`PEEBLES: Peebles 1980`、`WHITE: White 1985` | ✗ |
| ZA 选项 | `inputs.py:603` | "Scoccimarro R., 1998, MNRAS, 299, 1097-1118" | ✗ |
| ePS 选项 | `inputs.py:801-807` | "used in Parkinson et al. 2008"（3 处） | ✗ |
| `HII_EFF_FACTOR` | `inputs.py`（docstring） | "zeta, from Eq. 2 of **Greig+2015**" | ✗ |
| `F_STAR10` / `F_ESC10` | `inputs.py`（docstring） | "See Eq. 11 of **Greig+2018** and Sec 2.1 of **Park+2018**" | ✗ |
| `M_TURN` | `inputs.py`（docstring） | "See Sec 2.1 of **Park+2018**" | ✗ |
| `USE_MINI_HALOS` 相关 | `inputs.py`（docstring） | **Qin+2020**（见 `USE_MINI_HALOS` 说明段；同一段还引 `HII_EFF_FACTOR_MINI` 的 Eq. 8） | ✗ |
| `USE_CMB_HEATING` | `inputs.py:1026` | "cf Eq.4 of Meiksin 2021, arxiv.org/abs/2105.14516" | ✗ |
| `USE_LYA_HEATING` | `inputs.py:1028` | "cf Sec. 3 of Reis+2021, doi.org/10.1093/mnras/stab2089" | ✗ |
| `USE_EXP_FILTER` | `inputs.py:1051, 1055` | "MFP-epsilon(r) from **Davies & Furlanetto 2021**" / "part of the perspective shift (see Davies & Furlanetto 2021)" | ✗ |
| 引用信息本体 | `wrapper/utils.py:50-58, 99` | "21cmFAST v3: … **Murray et al., (2020)**"、"**Mesinger et al.** (2011) … MNRAS 411, 955-972"、"eprint arXiv:2504.17254, 2025" | ✗ |

## 三、本地存量与"缺口"

| 本地有 | 说明 |
| --- | --- |
| `Pritchard & Loeb 2012 Review.pdf` | 21cm 物理的标准综述（§2 基本物理、§3 全局信号、§4 涨落与功率谱） |
| `21cm_physics_derivation.pdf` | 一份 13 页的推导缩编（自称"基于 Pritchard & Loeb (2012)"，用 5 个标量驱动量） |
| `The impact of the first galaxies on cosmic dawn and reionization.pdf` | **按标题判断**应是 Park 等 2019（与代码当前新参数化同源）——**我没有打开核对**，请勿据此引用 |

| 本地没有（代码里引到但仓库无正文） | 类别 |
| --- | --- |
| Eisenstein & Hu 1999；Bardeen et al 1986；Sugiyama 1995；Efstathiou et al 1992；Peebles 1980；White 1985；Davies+1985；Bode et al 2000；Liddle et al；Bryan & Norman 1998；Barkana & Loeb 2001 | 转移函数与宇宙学解析式 |
| Watson et al 2013；Jenkins et al 2001；Sheth & Tormen 2002；Mo & White 1996；Delos 2023（arXiv:2311.17986）；Delos 2025；Parkinson et al 2008 | 质量函数与晕统计 |
| Abel et al 1997；Spitzer 1978；Sobacchi & Mesinger 2013；McQuinn 2015；Songaila+2010 | 复合、反馈、平均自由程 |
| Sun & Furlanetto 2016 | UV 光度函数 |
| Schive et al 2016（PRL 116, 201302）；Liu et al 2025（PRD 112, 103534）；arXiv:2302.08506 | FDM 与绝热修正 |
| Scoccimarro 1998；Qiu et al 2020（arXiv:2007.14624）；Nikolic et al 2024 | 初始条件与随机性 |
| Meiksin 2021（arXiv:2105.14516）；Meiksin et al 2021；Reis+2021（DOI:10.1093/mnras/stab2089）；Davies & Furlanetto 2021 | 加热与滤波 |
| Greig+2015；Greig+2018；Park+2018；Qin+2020；Mesinger+2011（MNRAS 411, 955）；Murray+2020；arXiv:2504.17254 | 参数化与模型主文 |

> 说明：本表**只标"本地有没有"**。需要哪几篇的正文（PDF）时，把文件放进仓库根目录或 `docs/notes/` 下即可，清单与图谱都会按文件名对上。

## 四、等式对照：推导里的式子 ↔ 现在的块

表由真源 `docs/notes/physics-chain/chain.json` 的 `eq` 字段逐字汇总（每个量挂一条，`eq` 的真源见该文件的 `note` 与 `sources`：编号按 `21cm_physics_derivation.pdf` 的式子，并对照 `Pritchard & Loeb 2012 Review.pdf` 的节号）。因此「哪条式子落在哪个块」由数据唯一决定，不是另行归类：**块认哪些式子 = 它全部成员的 `eq` 的并集**；块名与成员清单见 `README.md` §七。

| 式子（`eq` 逐字） | 认它的量 | 块 |
| --- | --- | --- |
| Eq.1 | `dn/dM(M,z)`、`ρ̇*(z)`、`标度关系(M_h)`、`源项的实现`（后两条是 Eq.1 / Eq.4 的实现） | 晕目录与质量函数、晕到星系属性、网格化源项 |
| Eq.2 | `M_min(z)` | 晕目录与质量函数 |
| Eq.3 | `Q_HII(z) = 1 − x_HI(z)` | 电离场 |
| Eq.4 | `Ṅ_ion(z)` | 网格化源项 |
| Eq.5 | `T_S(z)`、`T_γ`（`T_γ` 是 Eq.5 中的外源） | 气体热与自旋温度、常数与网格 |
| Eq.6 | `T_K(z)` | 气体热与自旋温度 |
| Eq.7 | `ε_heat(z)` | 气体热与自旋温度 |
| Eq.8 | `x_α` | 气体热与自旋温度 |
| Eq.9 | `δT_b(z)` | 亮温与观测 |
| Eq.10–Eq.11 | `P_21(k,z)` | 亮温与观测 |
| Eq.12–Eq.14 | `φ(M_1500, z)` | 晕到星系属性 |
| Eq.15–Eq.17 | `τ_e` | 亮温与观测 |
| §0 输入参数定义 | `f*`、`ζ`、`T_vir^min`、`L_X`、`k` | 晕到星系属性、网格化源项、晕目录与质量函数、亮温与观测 |
| §4.3（依赖 Eq.1） | `J_α(z)` | 气体热与自旋温度 |
| §IV（与 Eq.5 配套） | `x_c` | 气体热与自旋温度 |

- **真源没给式子的量就空着**：`matter_power`、`transfer_fn`、`vcb`、`initial_density`、`perturb_field`、`filtered_xray`、`gamma_12`、`recomb`、`mfp`、`z_reion` 这一类是代码里的量（推导缩编里没有编号式子），MUST NOT 替它们编一个。
- **式子 ≠ 代码算法**：`Q_HII / x_HI` 与 `T_S` 两处的理论式与代码实际执行的算法不是同一套（见 `README.md` §一），这里的 `eq` 记的是**理论式**；代码怎么算写在成员文档的「算法」一节。
- **块内关系不带式子**：`eq` 只挂在量上；「谁依赖谁」由依赖边表达，边的出处是源码（`codeRef`），不是式子号。
