# 21cmFAST 全局手册：物理链与代码地图

> **性质**：**总纲 / 导航**。只立骨架与坐标（谁产出谁、谁在哪、边界在哪），**不复制正文**——每节末尾给权威出处。
> **依据**（全部取自本仓）：`src/py21cmfast/`（Python 13 个顶层模块 + C 端 31 个 `.c`）、物理链真源 `docs/notes/physics-chain/chain.json`、画布图 `Graphify/data/graph.json`、既有分层与专题文档。
> **日期**：2026-10-05　**基线**：本仓 `main`。

## 0 怎么用

| 想知道 | 去哪 |
| :--- | :--- |
| 全貌（一张图 + 九步） | **§1**（自足） |
| 某块在算什么、跟谁接 | **§2** → `graphify/G4-物理链.md` + `physics-chain/modules/<块>.md` |
| 某个量/函数在哪个文件 | **§3.3 §3.4** → `atlas/L3-units.md`、`atlas/L0-pipeline.md#5` |
| C 端逐行级分层 | **§3.3** → `CODE_TOPOLOGY.md`（C 端唯一权威） |
| 三条流水线差别 | **§3.5** → `THREE_PIPELINES.md`、`atlas/L0-pipeline.md#13` |
| 图上有什么、怎么起 | **§4** → `Graphify/README.md` |
| 改代码的影响面 | **§5** → `atlas/INDEX.md#3` |
| 改东西前该引谁 | **§6** → `docs/DIRECTORY.md` |

**本册不做**：不写公式推导（在真源与 `papers.md`）、不写函数体级实现（在 `CODE_TOPOLOGY.md` 与模块文档的 `### 工程`）、不写安装调参（在 Read the Docs 与模板文件）。

## 1 全局主干

```
① 输入              ② 一次性备料（不随红移重复）        ③ 逐红移推进（z 由高到低）
                                                      P06 源项网格 ─▶ P07 X射线源箱 ─▶ P08 自旋温度盒 ─▶ P09 电离盒 ─▶ P10 亮温盒
P01 参数集 ─▶ P02 初始条件 ─┬─▶ P03 微扰场 ────────────┘        │              │              │            │
（模板/命令行）              └─▶ P04 晕目录 ─────────────────────┘              │              │            │
                                   （旁支 P05 微扰晕目录，主链不消费）           └──────────────┴────────────┘
                                                                                  （上一快照回喂下一快照）
④ 输出   P10 亮温盒 ─┬─▶ P11 演化快照（E1 联合演化盒）　├─▶ P12 光锥（E2）　└─▶ P13 全局演化历史（E3）
⑤ 旁路   P14 光度函数 · P15 再电离光学深度 · P16 光子守恒校准曲线（回灌③）· P17 宇宙学查表（并入 P01）
```

**只有 P02–P10 在计算链上**；P11–P13 是三种收尾形态，P14–P17 是旁路。P04/P06/P07 **条件性**（离散晕抽样 / 自旋温度涨落 / 拉格朗日型源模型）。出处：`atlas/README.md` §1、`atlas/L0-pipeline.md`。

九步：参数装配(S01) → 初始条件+微扰场(S09/S10) → 晕目录(S11) → 源项(S12) → X 射线源箱(S14.3) → 自旋温度(S14) → 电离(S13) → 亮温(S15) → 收尾(S02)。出处：`atlas/README.md` §2、`L1`、`L2`。

## 2 物理面

### 2.1 根：三个观测量

`P_21(k,z)`、`φ(M_1500,z)`、`τ_e`。它们不在任何块里，是链的出口——物理链就是**从观测往下追到参数**。

### 2.2 十一个块（一级骨架）

**划分依据 = 与代码同构**：一个块 = 一个 `.c` + 一个 `Compute*` + 一个输出盒子（层只声明文件）；成员取自该盒子的字段。

| 位次 | 块（物理语言） | 真源 id | 性质 | 成员 | 代码锚 |
| :-- | :--- | :--- | :--- | :-- | :--- |
| 0 | 常数与网格 | `block:const` | **层** | 1 | `Constants.c` |
| 1 | 宇宙学背景与物质功率谱 | `block:cosmo` | 过程 | 2 | `cosmology.c`·`init_ps` |
| 2 | 初始条件 | `block:initial` | 过程 | 4 | `InitialConditions.c`·`ComputeInitialConditions` |
| 3 | 引力扰动 | `block:grav` | 过程 | 2 | `PerturbedField.c`·`ComputePerturbedField` |
| 4 | 晕目录与质量函数 | `block:halocat` | 过程 | 4 | `HaloCatalog.c`·`ComputeHaloCatalog` |
| 5 | 晕到星系属性 | `block:galaxy` | 过程 | 5 | `PerturbedHaloCatalog.c`·`ComputePerturbedHaloCatalog` |
| 6 | 网格化源项 | `block:halobox` | 过程 | 4 | `HaloBox.c`·`ComputeHaloBox` |
| 7 | X 射线源的历史卷积 | `block:xray` | 过程 | 3 | `SpinTemperatureBox.c`·`UpdateXraySourceBox` |
| 8 | 气体热与自旋温度 | `block:thermal` | 过程 | 7 | `SpinTemperatureBox.c`·`ComputeTsBox` |
| 9 | 电离场 | `block:ionization` | 过程 | 6 | `IonisationBox.c`·`ComputeIonizedBox` |
| 10 | 亮温与观测 | `block:obs` | 过程 | 3 | `BrightnessTemperatureBox.c`·`ComputeBrightnessTemp` |

> 第 7、8 块**共用同一个 `.c`** 但函数与盒子不同，所以是两个块。
> 输出盒子依次：`PhysicalConstants`/`CosmoTables`/`InitialConditions`/`PerturbedField`/`HaloCatalog`/`PerturbedHaloCatalog`/`HaloBox`/`XraySourceBox`/`TsBox`/`IonizedBox`/`BrightnessTemp`。

**逐块成员（41 个，真源 `blocks.items[].members`）**

| 块 | 成员 |
| :--- | :--- |
| 常数与网格 | `tgamma` |
| 宇宙学 | `transfer_fn` → `matter_power` |
| 初始条件 | `initial_density`、`zeldovich_velocity`、`second_order_velocity`、`vcb` |
| 引力扰动 | `perturb_field`、`perturb_velocity` |
| 晕目录 | `tvir_min` → `mmin`、`hmf_impl` → `dn_dm` |
| 晕到星系 | `scaling_relations`、`rho_star`、`phi_uv`、`fstar`、`lx` |
| 网格化源项 | `source_grid`、`nion`、`nion_grid`、`zeta` |
| X 射线 | `filtered_xray`、`filtered_sfr`、`mean_sfr` |
| 热与自旋温度 | `eps_heat`、`tk`、`jalpha`、`xalpha`、`j21_lw`、`xc`、`ts` |
| 电离场 | `q_hii`、`neutral_fraction`、`gamma_12`、`recomb`、`mfp`、`z_reion` |
| 亮温与观测 | `dtb`、`p21`、`tau_e` |

**块内边 26 条**（每个可进入的块至少 1 条）；例：`transfer_fn → matter_power`（`cosmology.c:398` / `:450`）。出处：`chain.json`、`G4-物理链.md` §2.1、`physics-chain/modules/<块>.md`（11 篇手写，一模块一篇）。

### 2.3 块间接口与回流

58 条依赖边 = **块内 26** + **跨块 32**；跨块按"块对"合并为 **21 条接口边**，另有 **2 条跨红移回流边**（边条目合计 81 = 58+21+2）。**接口边静息不画**，悬浮块时显现，箭头文字只写跨块交付的量名。

接口边（上游 → 下游，括号内为交付量）：

- 常数与网格 → 热与自旋温度（`T_γ`×3）、→ 亮温（`T_γ`）
- 宇宙学 → 初始条件（`matter_power`）、→ 晕目录（`matter_power`）
- 初始条件 → 引力扰动（`vcb`）、→ 晕目录（`initial_density`，**给晕查找器的是线性初始密度场**）、→ 热与自旋温度（`vcb`）、→ 电离场（`vcb`）、→ 网格化源项（`vcb`）
- 引力扰动 → 热与自旋温度（`perturb_field`）、→ 电离场、→ 亮温
- 晕目录 → 晕到星系（`dn_dm`/`mmin`×3）、→ 网格化源项（`dn_dm`）
- 晕到星系 → 网格化源项（`scaling_relations`/`fstar`/`rho_star`）、→ 热与自旋温度（`lx`/`rho_star`）
- 网格化源项 → 电离场（`nion`/`nion_grid`）、→ X 射线（`source_grid`）
- X 射线 → 热与自旋温度（`filtered_xray`/`filtered_sfr`）
- 热与自旋温度 → 亮温（`ts`）；电离场 → 亮温（`q_hii`×3）

**两条回流边**（下游回喂上游，取自**上一个红移**的快照）：

| 回流 | 载体 | 代码落点 |
| :--- | :--- | :--- |
| 热与自旋温度 → 网格化源项 | `ts` → `nion`：`J21_val = previous_spin_temp->J_21_LW[i]` 经 `lyman_werner_threshold(z, J21_val, curr_vcb)` 改写 `M_turn_m` | `HaloBox.c:495` · `get_log10_turnovers` |
| 电离场 → 网格化源项 | `q_hii` → `nion`：`Gamma12_val = previous_ionize_box->ionisation_rate_G12[i]`、`zre_val = previous_ionize_box->z_reion[i]` 经 `reionization_feedback(z, Gamma12_val, zre_val)` 改写 `M_turn_r` | `HaloBox.c:496` · 同一个 `get_log10_turnovers` |

> **两条回流都落在同一个辅助函数** `get_log10_turnovers` 里（`HaloBox.c`；由 `ComputeHaloBox` 调用，`previous_spin_temp` / `previous_ionize_box` 是后者的形参）——改这块要同时看两条路。

### 2.4 参数：两条通道

- **顶层物理驱动量**（真源 `drivers`，4 个）：`f*`、`ζ`、`T_vir^min`、`L_X`，带取值范围。
- **`params` 五组，共 63**：`drivers` 8 / `astro` 29 / `cosmo` 12 / `numeric` 5 / `effects` 9；按代码里的类名分则是 `AstroParams` 40 / `CosmoParams` 12 / `AstroOptions` 11。
- **参数 × 节点矩阵 `paramMatrix` 62 条**；**标签注册表 62 条**（一个参数一个标签）挂在 **39 个节点**上——注册表硬编码在生成脚本 `Graphify/scripts/build-physics-chain.mjs`，随生成物发为 `graph.meta.tags`。
- **宇宙学参数分两类**：控制性选项（`HMF`、`POWER_SPECTRUM`、`SOURCE_MODEL`、`FILTER`、`FDM`…）**挂标签**，在 `MatterOptions`（`wrapper/inputs.py:560`）而**不在** `CosmoParams`；硬编码常量（`Constants.c:25` 的 `T_cmb = 2.7255`）**只写文档、不上图**。
- **天体物理参数**（`AstroParams` 那 40 个）单独一个「抽屉」：选中词条 → 高亮相关模块。
- **效应开关**（`USE_*`、`INTEGRATION_METHOD_*`、`PHOTON_CONS_TYPE`）**画在它门控的那条边**上。

出处：`physics-chain/README.md` §八、`chain.json`、生成物 `Graphify/src/generated/physics-chain.json` 的 `stats` 与 `graph.meta.tags`。

### 2.5 为什么是 11 块（口径转换史，遇旧文档分歧按此裁决）

| 次 | 时间 | 从 → 到 |
| :-- | :--- | :--- |
| 一 | 09-30 | 按**代码阶段**分层（`stage:S01…S15`）→ 按**天体物理过程**打包 |
| 二 | 10-01 | 按过程打包 → **与代码同构**（`.c` + `Compute*` + 盒子）；成员 28 → **38** |
| 三 | 10-04 | 两个横切层 → **一个层**；**公共头文件那一路退场**，块数 12 → **11** |
| 四 | 10-04 | 一对象一篇（49 篇）→ **一模块一篇（11 篇）** |

> 后果：`block:kernel` 与 `modules/kernel.md` 已在第三次转换中**有意删除**，旧部署副本里那份是残留。自检 179 → 268 → **267** 项。

出处：`graphify/G4-物理链.md` §1.2。

## 3 代码面

### 3.1 顶层目录

`src/py21cmfast/` 主线包（Python 前端 + C 后端）｜`tests/` 测试｜`scripts/` 离线分析标定（**不在链上**）｜`docs/` Sphinx 站点 + `notes/`（本册所在）｜`Graphify/` 图谱应用（§4）｜`openspec/` 变更提案｜`attic/`·`train/`·`traintest/`·`joss-paper/`·`testplots/`·`math-mcp/`·`docling-graph/` 归档试验，**不参与主线**。

构建：`pyproject.toml`（setuptools + setuptools_scm + cython），C 扩展由 `build_cffi.py` 驱动；本机产物 `c_21cmfast.cpython-311-x86_64-linux-gnu.so`（Python ≥ 3.11）。

### 3.2 Python 侧

| 位置 | 是什么 | 约 |
| :--- | :--- | :-- |
| `cli.py` | 命令行入口（`21cmfast run ics/coeval/lightcone`…） | 851 行 |
| `lightconers.py` | 光锥几何（视距/角度 → 切片） | 701 |
| `plotting.py` | 绘图呈现 | 522 |
| `rsds.py` | 红移空间畸变 | 297 |
| `input_serialization.py`·`_templates.py`·`yaml.py` | 输入序列化与模板 | 218/141/52 |
| `_cfg.py`·`utils.py`·`management.py` | 全局配置、工具、环境管理 | 各 ~105 |
| `drivers/` | **四条驱动**：`coeval.py`(E1)、`lightcone.py`(E2)、`global_evolution.py`(E3)、`single_field.py`(E4 单场直算，只算一个盒子、不推进红移) | — |
| `wrapper/` | 后端桥与结构：`cfuncs.py`(cffi 绑定)、`inputs.py`(`InputParameters`/`CosmoParams`/`AstroParams`/`MatterOptions`)、`outputs.py`、`arrays.py`+`arraystate.py`(数组状态机)、`structs.py`、`photoncons.py` | — |
| `io/` | `caching.py`(`OutputCache` 路径与哈希)、`h5.py`(HDF5) | — |
| `templates/`·`_data/` | 参数模板 YAML、内置数据（`x_int_tables`） | — |

### 3.3 C 侧：31 个单元，两类

**A 盒子型（10 个文件承担 11 个块）** —— 即 §2.2 各块的"代码锚"：`cosmology.c`、`InitialConditions.c`、`PerturbedField.c`、`HaloCatalog.c`、`PerturbedHaloCatalog.c`、`HaloBox.c`、`SpinTemperatureBox.c`（**两个块**：`UpdateXraySourceBox` + `ComputeTsBox`）、`IonisationBox.c`、`BrightnessTemperatureBox.c`、`Constants.c`（层）。

**B 基建型（21 个，不产出盒子、被上面调用）**：

`InputParameters.c`（运行时参数结构）·`LuminosityFunction.c`（光度函数诊断）·`hmf.c`（质量函数）·`Stochasticity.c`（随机晕采样）·`scaling_relations.c`（星系标度关系）·`thermochem.c`（热化学率）·`recombinations.c`（复合与自屏蔽）·`bubble_helper_progs.c`（游程集气泡）·`heating_helper_progs.c`（加热率）·`photoncons.c`（光子守恒）·`interp_tables.c`·`elec_interp.c`·`interpolation.c`（查表基建）·`integral_wrappers.c`（积分）·`filtering.c`（傅里叶滤波）·`dft.c`（变换）·`map_mass.c`（质量位移重映射）·`indexing.c`（网格索引与坐标回卷）·`rng.c`（随机数与种子）·`fdm.c`（FDM 修正）·`debugging.c`。

> **C 端分层唯一权威 = `CODE_TOPOLOGY.md`**（1028 行），把 31 个 `.c` 组织成「阶段 → 子过程 → 计算单元 → 关键过程与关键量」。

### 3.4 五层分层（atlas，把 Python 与 C 串成同一条流水线）

| 层 | 文件 | 内容 | 条目 |
| :-- | :--- | :--- | :-- |
| L0 | `atlas/L0-pipeline.md` | 七个入口（E1–E7）、**17 种产物**（P01–P17）、谁产出谁、三条流水线伪代码对照 | 17 |
| L1 | `atlas/L1-stages.md` | **16 个阶段**（S01–S16）吃吐什么 | 16 |
| L2 | `atlas/L2-subprocesses.md` | 每个阶段内部切成哪几步 | **71** |
| L3 | `atlas/L3-units.md` | 每个子过程由**哪个文件的哪个函数**承担（最厚） | **137** 单元 |
| L4 | `atlas/L4-key-processes.md` | 每个单元的末端过程与关键变量/常量 | **137** |

**入口角色**：E1/E2/E3 是三条并列"总开关"，内部都调用 **E4 单场直算**；**E5 参数装配**在最前，**E6 持久化**横包所有步骤，**E7 离线旁路**挂在旁边。

### 3.5 三条时间流水线（E1/E2/E3）

同一台引擎（E1/E2 是薄壳，E3 不是），差别只在参数、循环外的额外处理与**收尾形态**：

| | E1 联合演化盒 | E2 光锥 | E3 全局演化 |
| :--- | :--- | :--- | :--- |
| 入口 | `run_coeval`（`coeval.py:632`，薄壳 `:639`） | `run_lightcone`（`lightcone.py:691`，薄壳 `:698`） | `run_global_evolution`（`global_evolution.py:230`，**唯一非薄壳**） |
| 交出 | Coeval 列表 | `LightCone`（沿视线切片拼接） | 零维时间序列（逐红移取盒均值） |
| 额外 | 红移表裁剪 + `yield` 过滤 | `lightconer` 校验 + 每红移切片 + RSD | `SOURCE_MODEL` 校验 + 单格 `evolve_input_structs` |
| 共用骨架 | 准备（一次性）→ 逐红移推进（`_redshift_loop_generator`）→ 收尾；**上一时刻回喂下一时刻**（§2.3 两条回流） | 同左 | 同左 |

出处：`THREE_PIPELINES.md`、`atlas/L0-pipeline.md#13`。

## 4 图谱面（Graphify）

### 4.1 画布图 `Graphify/data/graph.json` —— 65 节点 / 59 边，三个分区

| 分区 | 节点 | 边 | 内容 |
| :--- | :-- | :-- | :--- |
| `atlas:fig1:*` | 22 | 18 | **主调度链**：入口层 → 编排层（命令行 / Python API）→ 备料层 → 红移循环（晕→X射线→自旋温度→电离→亮温→装配）→ 输出层 |
| `atlas:fig2:*` | 21 | 15 | **三个顶层驱动**：E1(5步)/E2(6步)/E3(7步) |
| `ic:*` | 22 | 26 | **初始条件链**：过程①–⑩ + 三条支链（密度/速度/vcb）+ 产物与收尾 |

节点类型 `method` 41 / `group` 13 / `variable` 4 / `artifact` 4 / `driver` 3；边 `depends_on` 35 / `derives_from` 24。
读法：层带 = 大框（进去看该层步骤）；虚线 = 条件/可选；节点自带源码引用可预览对应行。

### 4.2 物理链图 `Graphify/src/generated/physics-chain.json`

由真源 `docs/notes/physics-chain/chain.json` **机械生成**（`npm run build:chain`，自检 `npm run check:chain`，**267 项**）：11 块 + 41 成员 + 81 条边（58 依赖 + 21 接口 + 2 回流）+ 63 参数 + 62 条标签注册 + 55 处成员代码落点（去重后 `stats.codeSites`；真源核定 `codeSitesFromChain` 记 56 条）。

> **改图先改真源**：改 `chain.json`，再 `build:chain`；不要改生成物。

### 4.3 应用与命令

`Graphify/` 是 Node/React 应用：`src/`（`components/`·`graph/`·`state/`·`lib/`，含 `PhysicsChainView.tsx`、`GraphCanvas.tsx`、`MdLibraryPanel.tsx`）+ `server/`（Express，路由 `graph`/`code`/`md`/`chainLayout`）+ `scripts/`（构建与自检）。

| 命令 | 作用 |
| :--- | :--- |
| `npm run dev` / `build` / `start` | 起服务（默认 `localhost:5178`）/ `tsc -b && vite build` / 生产启动 |
| `npm run build:chain` / `check:chain` | 重建物理链图 / 自检 267 项 |
| `npm run build:atlas` / `import` | 重建 atlas 图 / 导入图 |
| `npm run check:graph`·`check:tags`·`check:canvas`·`check:code`·`check:store`·`check:tabs`·`check:copy`·`check:styles` | 各类一致性自检 |

### 4.4 部署与同步

线上站点 = 另一个仓库 `Seinin/graphify`（Render 部署，**无鉴权、公开**），内容由本仓**手工镜像**过去：应用（`Graphify/src|scripts|server|public`）+ 图谱数据（`data/graph.json`、`data/chain-layout.json`）+ 站点文档（`docs/notes/` → `notes/`）+ 源码索引（`code/`）。该仓库的 `README.md` 是**部署版说明**，与本仓开发 README 不是一份。

> **关键性质**：线上拖拽产生的改动**不回到仓库**（写的是容器临时盘），所以"改默认"只有一条路——**在本地改 → 同步推送**。同步口径与步骤见 `Seinin/graphify` 的 `README.md`。

## 5 交叉索引

| 想干什么 | 去哪 |
| :--- | :--- |
| 21-cm 亮温怎么算出来 | `atlas/L2#S15` → `L3 S15.2.1`（`ComputeBrightnessTemp` 幅度填充段） |
| 电离场/气泡怎么来的 | `atlas/L2#S13.4–S13.5` → `L3 S13.5.2`（`find_ionised_regions`，游程集） |
| 自旋温度怎么解的 | `atlas/L2#S14.6` → `L3 S14.6.1`（`get_ts`） |
| 晕怎么找/怎么抽样 | `atlas/L2#S11.1–S11.2` → `L3 S11.1.1`（`ComputeHaloCatalog`） |
| 源项从哪来 | `atlas/L2#S12.1–S12.2` → `L3 S12.2.1`（`ComputeHaloBox`） |
| 参数怎么装进来、模板在哪 | `atlas/L2#S01.1` → `L3 S01.1.1`（`create_params_from_template`） |
| 红移循环在哪、什么顺序 | `atlas/L2#S02.3` → `L3 S02.3.1`（`_redshift_loop_generator`） |
| 结果存哪、重跑怎么续 | `atlas/L2#S03` → `L3 S03.1.1`（`OutputCache`） |
| 光子守恒校准怎么起作用 | `atlas/L2#S16.1` → `L3 S13.2.1`（`adjust_redshifts_for_photoncons`） |
| 初始条件一条链看到底 | `INITIAL_CONDITIONS.md`（垂直切片专题） |
| 三条流水线代码+物理入门 | `THREE_PIPELINES.md` |
| FDM / X 射线 / ACG-MCG | `FDM*.md` / `XRAY_*.md` / `ACG_MCG_*.md`（见 §6） |

## 6 权威分工与维护规矩

**改任何东西前先读 `docs/DIRECTORY.md`**（那是对外声明"哪份文档对哪个主题权威"的唯一入口，含"禁止"条款）。要点：

- **代码分层**：C 端 = `CODE_TOPOLOGY.md`；全仓自上而下 = `atlas/`（从 `atlas/README.md` 进，按问题查 `atlas/INDEX.md`）。
- **物理链**：真源 = `physics-chain/chain.json`；口径账本 = `physics-chain/README.md`；画法规范 = `graphify/G0-绘制规范.md`；论文对照 = `physics-chain/papers.md`。**改图先改真源**。
- **专题物理**：`FDM*.md`（分子冷却阈值 $m_{\rm crit}$ 以 `FDM_mcrit_report.md` 为唯一权威）、`XRAY_*.md`、`ACG_MCG_*.md`。**禁止**在别处重写同一主题的第二份副本。
- **本册位置**：`docs/notes/HANDBOOK.md`，是**总纲**——只加"骨架与坐标"和新出现的**跨面**结论；深内容一律改上列权威文档，本册只更新指针。
