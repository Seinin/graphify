# G2 入口 B · 三条顶层驱动子图

> 这张图是主图里 `入口 B · 三个顶层驱动` 的**放大**：三条并排的时间流水线（E1 / E2 / E3），每条都是一条"备料 → 断点续算 → 逐红移循环 → 收尾"的链。
> **规范摘要**（全文见 [G0 绘制规范](G0-绘制规范.md)）：一张图只画它这一层的事实，**子图不派生父层关系**（本图只画这三条 lane 自己的节点与边）；容器（E lane）不参与关系；产物写在边标签上；虚线只表示条件/可选。
> 上游见 [G1 主图](G1-主图.md#入口-b-三个顶层驱动)；编号沿用 atlas 的 `S02.x`（[L2 驱动编排](../atlas/L2-subprocesses.md#s02-驱动编排)、[L3 计算单元](../atlas/L3-units.md#s021-初始条件与微扰场准备)）。

## 一 这张图与规范摘要

| 项 | 值 |
| :--- | :--- |
| 本图节点 | 3 个容器（E lane）+ 18 个步骤（E1 五步、E2 六步、E3 七步），共 21 个 |
| 与父图的关系 | 父图里 `入口 B` 是**一个**方框，这里展开成三条 lane。父图里 `入口 B` 的两条模块级关系（`命令行 → 入口 B`、`入口 B → _setup_ics_and_pfs_for_scrolling`）**只画在主图上**，不派生进本图（口径见 [G0 §四](G0-绘制规范.md#四-子图与父图的关系不继承父层关系)） |
| 三条 lane 的读法 | 三条**并列**，实跑只走一条（见 [分支 1](#分支-1-三条-lane-的差别)）；lane 是容器，不参与关系 |
| 共用骨架 | ② 备料与 ④/⑤ 循环在三张 lane 里**同一份实现**（名字里的"三条共用"就是标注） |

## 二 核心入口与主干流程

### 三条 lane 共用的骨架

三条 lane 的骨架完全一致，差别只在"怎么做收尾"（见 [分支 1](#分支-1-三条-lane-的差别)）：

```text
① 准备（各自的校验/建表） → ② 备料（三条共用） → ③ 断点续算 → ④/⑤ 逐红移循环 → 收尾形态
```

- **② 备料**：三条 lane 都调同一个 `_setup_ics_and_pfs_for_scrolling`——它内部依次做 `compute_initial_conditions` → `prepare_for_perturb` → `setup_photon_cons` → 逐红移 `perturb_field` → （条件）`evolve_halos` → `prepare_for_spin_temp`。
- **④/⑤ 逐红移循环**：都调同一个 `_redshift_loop_generator`，循环体顺序固定为 `① compute_halo_grid → （条件）② compute_xray_source_field → （条件）③ compute_spin_temperature → ④ compute_ionization_field → ⑤ brightness_temperature → ⑥ 装配`。循环里每一步的细节见 [G1 主图 §④](G1-主图.md#④-红移循环每红移重复z-由高到低)。

### E1 · run_coeval

> lane 容器：`E1 · run_coeval（coeval.py:632，薄壳 :639 → generate_coeval :478）`。收尾形态 = 逐个红移交付完整盒。

#### E1 ① 红移表 _get_required_redshifts_coeval

- **作用与意义**：把用户要的红移展开成"实际要遍历的红移表"（含节点红移），后面所有步骤都按这张表推进。
- **对应子过程**：[S02.3 红移递减推进循环](../atlas/L2-subprocesses.md#s023-红移递减推进循环)
- **输入 / 产出**：输入 `out_redshifts` 与参数里的节点红移；产出红移表（边标签 `红移表`）。
- **关键位置**：`drivers/coeval.py` 的 `_get_required_redshifts_coeval`。
- **参数**：无直接参数（只读 `node_redshifts` 与目标红移）。

#### E1 ② 备料（三条共用）_setup_ics_and_pfs_for_scrolling

- **作用与意义**：同一份备料实现——初始条件、逐红移微扰场、（条件）晕目录与光子守恒校准数据都在这里备齐；**只在这里做一遍**，循环里不再重复。
- **对应子过程**：[S02.1 初始条件与微扰场准备](../atlas/L2-subprocesses.md#s021-初始条件与微扰场准备)（单元 [S02.1.1](../atlas/L3-units.md#s0211-_setup_ics_and_pfs_for_scrolling)）
- **输入 / 产出**：输入 P01；产出 P02/P03（与条件 P04、P16），边标签 `ICs / 微扰场`。
- **关键位置**：`drivers/coeval.py` 的 `_setup_ics_and_pfs_for_scrolling`。
- **参数**：`MINIMIZE_MEMORY`（开关）、`PHOTON_CONS_TYPE`（开关）、`PHOTONCONS_CALIBRATION_END`（校验）。

#### E1 ③ 断点续算 _obtain_starting_point_for_scrolling

- **作用与意义**：查缓存判断"已经算到哪"，决定从下一个红移接着算还是从第一个开始，并把已算的红移重建成容器。
- **对应子过程**：[S02.6 断点续算与起始点定位](../atlas/L2-subprocesses.md#s026-断点续算与起始点定位)（单元 [S02.6.1](../atlas/L3-units.md#s0261-_obtain_starting_point_for_scrolling)）
- **输入 / 产出**：输入 P01 与缓存清单；产出"起始索引"（边标签 `起始 iz`）。
- **关键位置**：`drivers/coeval.py` 的 `_obtain_starting_point_for_scrolling`；判定依据是 `io/caching.py` 的 `RunCache.is_complete_at`（清单文件是否齐全）。
- **参数**：无独立参数；行为由 `CacheConfig` 与 `regenerate` 决定。

#### E1 ④ 循环（三条共用）_redshift_loop_generator

- **作用与意义**：逐个红移推进本体——每轮跑完 ①–⑥ 并装配一份快照，是整条流水线的心跳。
- **对应子过程**：[S02.3 红移递减推进循环](../atlas/L2-subprocesses.md#s023-红移递减推进循环)（单元 [S02.3.1](../atlas/L3-units.md#s0231-_redshift_loop_generator)）
- **输入 / 产出**：输入 P02/P03（与条件 P04、P16）；产出 [P06](../atlas/L0-pipeline.md#p06-源项网格)…[P10 亮温盒](../atlas/L0-pipeline.md#p10-亮温盒)，边标签 `Coeval`。
- **关键位置**：`drivers/coeval.py` 的 `_redshift_loop_generator`（循环体末尾装配快照并清掉上一轮的中间量）。
- **参数**：`HII_DIM`、`PHOTON_CONS_TYPE`、`USE_TS_FLUCT`（三步开关）；循环内部各步自己的参数见 [G1 §④](G1-主图.md#④-红移循环每红移重复z-由高到低) 与 [§五](#五-每步参数与标签)。

#### E1 ⑤ yield 过滤 → Coeval 列表

- **作用与意义**：只把选定的那几个红移交出去（其余红移照算，但不进返回值），于是 `run_coeval` 得到的是一个 Coeval 列表。
- **对应子过程**：[S02.4 快照组装](../atlas/L2-subprocesses.md#s024-快照组装)（单元 [S02.4.1 generate_coeval](../atlas/L3-units.md#s0241-generate_coeval)）
- **输入 / 产出**：输入逐轮快照；产出 [P11 演化快照](../atlas/L0-pipeline.md#p11-演化快照) 列表。
- **关键位置**：`drivers/coeval.py` 的 `generate_coeval` 收尾处 `yield coeval, coeval.redshift in out_redshifts`。
- **参数**：无（只做过滤）。

### E2 · run_lightcone

> lane 容器：`E2 · run_lightcone（lightcone.py:691，薄壳 :698 → generate_lightcone :575）`。收尾形态 = 沿视线切片拼成光锥。

#### E2 ① lightconer 校验

- **作用与意义**：先校验光锥几何参数（角度/直积、视场、频率或红移范围、单元尺寸等）自洽，不合格直接报错，避免算了半天才发现几何配不上。
- **对应子过程**：[S02.5 光锥切片与拼接](../atlas/L2-subprocesses.md#s025-光锥切片与拼接)
- **输入 / 产出**：输入光锥几何定义；产出"校验结果"（边标签 `校验结果`）。
- **关键位置**：`drivers/lightcone.py` 的 `generate_lightcone` 里 `lightconer.validate_options`。
- **参数**：`HII_DIM`、`BOX_LEN`（单元格与视场换算）；RSD 相关还要 `KEEP_3D_VELOCITIES`（见 [分支 6](#分支-6-e2-独有的-rsd-与-trimming)）。

#### E2 ② 备料（三条共用）_setup_ics_and_pfs_for_scrolling

- **作用与意义**：与 E1 ② 同一份实现（三条 lane 共用）。
- **对应子过程**：[S02.1 初始条件与微扰场准备](../atlas/L2-subprocesses.md#s021-初始条件与微扰场准备)
- **输入 / 产出**：输入 P01；产出 P02/P03（与条件 P04、P16），边标签 `ICs / 微扰场`。
- **关键位置**：`drivers/coeval.py` 的 `_setup_ics_and_pfs_for_scrolling`（E2 直接导入复用）。
- **参数**：`MINIMIZE_MEMORY`、`PHOTON_CONS_TYPE`、`PHOTONCONS_CALIBRATION_END`。

#### E2 ③ 建 LightCone setup_lightcone_instance

- **作用与意义**：按几何定义建出光锥容器与它的切片骨架（每个红移一格），后续每轮把数据填进去。
- **对应子过程**：[S02.5 光锥切片与拼接](../atlas/L2-subprocesses.md#s025-光锥切片与拼接)（单元 [S02.5.1 generate_lightcone](../atlas/L3-units.md#s0251-generate_lightcone)）
- **输入 / 产出**：输入几何定义与 P01；产出 [P12 光锥](../atlas/L0-pipeline.md#p12-光锥) 容器，边标签 `LightCone`。
- **关键位置**：`drivers/lightcone.py` 的 `setup_lightcone_instance` / `LightCone`。
- **参数**：`USE_TS_FLUCT`（决定填哪些字段）；几何相关的 `HII_DIM` / `BOX_LEN`。

#### E2 ④ 断点续算 _obtain_starting_point_for_scrolling

- **作用与意义**：与 E1 ③ 同一份判定，但起点取自**光锥自己的 checkpoint**（上次切到哪一格）。
- **对应子过程**：[S02.6 断点续算与起始点定位](../atlas/L2-subprocesses.md#s026-断点续算与起始点定位)
- **输入 / 产出**：输入光锥 checkpoint；产出起始索引（边标签 `起始 iz`）。
- **关键位置**：`drivers/lightcone.py` 的 `_run_lightcone_from_perturbed_fields` 内 `_obtain_starting_point_for_scrolling` + `make_checkpoint`。
- **参数**：无独立参数。

#### E2 ⑤ 循环（三条共用）_redshift_loop_generator

- **作用与意义**：与 E1 ④ 同一份循环实现；E2 在每轮之后**多做一步切片**（把这一轮盒里落在光锥上的采样点取出来）。
- **对应子过程**：[S02.3 红移递减推进循环](../atlas/L2-subprocesses.md#s023-红移递减推进循环)
- **输入 / 产出**：输入 P02/P03（与条件 P04/P16）；产出逐轮盒与切片。
- **关键位置**：`drivers/lightcone.py` 的 `_run_lightcone_from_perturbed_fields` 内调 `_redshift_loop_generator`。
- **参数**：`HII_DIM`、`PHOTON_CONS_TYPE`、`USE_TS_FLUCT`（与 E1 ④ 同）。

#### E2 ⑥ 每红移切片 → LightCone

- **作用与意义**：每个红移把该格切片写进光锥容器，循环结束后做 RSD、速度梯度修正与 trimming，得到最终光锥。
- **对应子过程**：[S02.5 光锥切片与拼接](../atlas/L2-subprocesses.md#s025-光锥切片与拼接)（单元 [S02.5.2 make_lightcone_slices](../atlas/L3-units.md#s0252-make_lightcone_slices)）
- **输入 / 产出**：输入逐轮盒；产出 [P12 光锥](../atlas/L0-pipeline.md#p12-光锥)。
- **关键位置**：`drivers/lightcone.py` 的 `make_lightcone_slices` → `apply_rsds` → `trim`。
- **参数**：`USE_TS_FLUCT`、`KEEP_3D_VELOCITIES`（RSD 前提）、`HII_DIM` / `BOX_LEN`。
- **分支**：见 [分支 6](#分支-6-e2-独有的-rsd-与-trimming)。

### E3 · run_global_evolution

> lane 容器：`E3 · run_global_evolution（global_evolution.py:230，唯一不是薄壳）`。收尾形态 = 压成零维的红移历史曲线；**强制不落盘**。

#### E3 ① source_model 校验

- **作用与意义**：全局演化只看盒均值，因此先校验源模型是否适合这条路径（`CONST-ION-EFF` 这类常系数模型才是它的主场）。
- **对应子过程**：[S02.1 初始条件与微扰场准备](../atlas/L2-subprocesses.md#s021-初始条件与微扰场准备)（前置校验）
- **输入 / 产出**：输入 `SOURCE_MODEL`；产出校验结果（边标签 `source_model`）。
- **关键位置**：`drivers/global_evolution.py` 的 `run_global_evolution` 开头。
- **参数**：`SOURCE_MODEL`（开关 / 校验）。

#### E3 ② 单格参数 evolve_input_structs

- **作用与意义**：把三维模拟的参数改写成"单格模拟"的参数——盒子压成一个格点后，很多参数的意义要跟着变，这一步保证后续算的是正确的退化模型。
- **对应子过程**：[S02.1 初始条件与微扰场准备](../atlas/L2-subprocesses.md#s021-初始条件与微扰场准备)
- **输入 / 产出**：输入 P01；产出单格参数（边标签 `单格参数`）。
- **关键位置**：`drivers/global_evolution.py` 的 `inputs.evolve_input_structs`（会改写十余项参数）。
- **参数**：`BOX_LEN`、`DIM`、`HII_DIM`、`HIRES_TO_LOWRES_FACTOR`、`KEEP_3D_VELOCITIES`、`PERTURB_ALGORITHM`、`PHOTON_CONS_TYPE`、`SOURCE_MODEL`、`USE_EXP_FILTER`、`USE_INTERPOLATION_TABLES`、`USE_UPPER_STELLAR_TURNOVER`、`INTEGRATION_METHOD_ATOMIC`、`INTEGRATION_METHOD_MINI`（**都是被改写的对象**，见 [分支 5](#分支-5-e3-的单格参数派生)）。

#### E3 ③ 建容器 GlobalEvolution

- **作用与意义**：建出零维历史容器（每个量一条随红移的曲线），后续每轮把均值填进去。
- **对应子过程**：[S02.4 快照组装](../atlas/L2-subprocesses.md#s024-快照组装)（单元 [S02.4.2 run_global_evolution](../atlas/L3-units.md#s0242-run_global_evolution)）
- **输入 / 产出**：输入单格参数；产出 [P13 全局演化历史](../atlas/L0-pipeline.md#p13-全局演化历史) 容器，边标签 `GlobalEvolution`。
- **关键位置**：`drivers/global_evolution.py` 的 `GlobalEvolution`。
- **参数**：无（容器初始化）。

#### E3 ④ 备料（三条共用）_setup_ics_and_pfs_for_scrolling

- **作用与意义**：与 E1/E2 同一份备料实现（在单格参数下运行）。
- **对应子过程**：[S02.1 初始条件与微扰场准备](../atlas/L2-subprocesses.md#s021-初始条件与微扰场准备)
- **输入 / 产出**：输入单格参数；产出 P02/P03（与条件 P04/P16），边标签 `ICs / 微扰场`。
- **关键位置**：`drivers/coeval.py` 的 `_setup_ics_and_pfs_for_scrolling`。
- **参数**：`MINIMIZE_MEMORY`、`PHOTON_CONS_TYPE`、`PHOTONCONS_CALIBRATION_END`。

#### E3 ⑤ 循环（三条共用）_redshift_loop_generator

- **作用与意义**：与 E1/E2 同一份循环实现；因为盒子只有一格，每一步都退化成标量运算。
- **对应子过程**：[S02.3 红移递减推进循环](../atlas/L2-subprocesses.md#s023-红移递减推进循环)
- **输入 / 产出**：输入 P02/P03；产出逐轮结果（边标签 `单格结果`）。
- **关键位置**：`drivers/global_evolution.py` 内调 `_redshift_loop_generator`。
- **参数**：`HII_DIM`、`PHOTON_CONS_TYPE`、`USE_TS_FLUCT`（与 E1 ④ 同）。

#### E3 ⑥ 逐红移均值 quantities[q][iz] = mean

- **作用与意义**：把每轮的单格结果按量取算术平均，写进历史容器的对应红移槽位——这一行就是"整体演化"的定义。
- **对应子过程**：[S02.4 快照组装](../atlas/L2-subprocesses.md#s024-快照组装)
- **输入 / 产出**：输入逐轮结果；产出各量的红移序列（边标签 `时间序列`）。
- **关键位置**：`drivers/global_evolution.py` 的均值循环（`np.mean`）。
- **参数**：`USE_TS_FLUCT`、`BOX_LEN`、`DIM`、`HII_DIM`、`F_ESC10`、`F_STAR10`、`HII_EFF_FACTOR`、`POP2_ION` 等（决定要均值的是哪些量）。

#### E3 ⑦ return → GlobalEvolution

- **作用与意义**：返回历史容器；用户手动 `save()` 才落盘（E3 全程 `CacheConfig.off()`）。
- **对应子过程**：[S02.4 快照组装](../atlas/L2-subprocesses.md#s024-快照组装)
- **输入 / 产出**：产出 [P13 全局演化历史](../atlas/L0-pipeline.md#p13-全局演化历史)。
- **关键位置**：`drivers/global_evolution.py` 的 `GlobalEvolution.save`。
- **参数**：无。

## 三 分支

### 分支 1 三条 lane 的差别

- **触发条件**：在入口 B 里选一条（`run_coeval` / `run_lightcone` / `run_global_evolution`）。
- **分叉走向**（逐条对照）：

| 环节 | E1 run_coeval | E2 run_lightcone | E3 run_global_evolution |
| :--- | :--- | :--- | :--- |
| 入口形态 | 薄壳 `run_coeval` → `generate_coeval` | 薄壳 `run_lightcone` → `generate_lightcone` | 无薄壳，函数本身即实现 |
| 前置准备 | ① 红移表 | ① lightconer 几何校验 | ① source_model 校验 + ② 单格参数派生 |
| 备料 / 断点 / 循环 | 同一份实现（②③④） | 同一份实现（②④⑤），多建光锥容器 ③ | 同一份实现（④⑤） |
| 每轮额外动作 | 无 | 每轮切片；收尾 RSD + 速度梯度修正 + trim | 无（盒子只有一格） |
| 收尾形态 | `yield` 过滤出目标红移的 Coeval 列表 | 一张拼接好的光锥 | 一条零维历史曲线 |
| 落盘 | 手动 `save()` | 手动 `save()`（另有 checkpoint） | 手动 `save()`，且**强制关缓存** |
| 命令行 | `21cmfast run coeval` | `21cmfast run lightcone` | **无子命令**，只有 Python API |

- **位置**：`drivers/coeval.py`、`drivers/lightcone.py`、`drivers/global_evolution.py`。

### 分支 2 备料只在第一条 lane 真正做一遍（三条共用）

- **触发条件**：无——这是"共用"而不是分支：三条 lane 都调同一份备料实现，各自跑时都从头备一次。
- **分叉走向**：备料内部依次 `compute_initial_conditions` → `prepare_for_perturb` → `setup_photon_cons` →（逐红移）`perturb_field` →（条件）`evolve_halos` → `prepare_for_spin_temp`；其中 `setup_photon_cons` 与 `evolve_halos` 是条件步骤（见 [分支 4](#分支-4-光子守恒与最小内存) 与 [G1 分支 F](G1-主图.md#分支-f-离散晕-has_discrete_halos)）。
- **为什么**：备料贵（初始条件 + 每红移微扰场），所以三条 lane 都把它挡在循环之外，循环里只做逐红移的增量。
- **位置**：`drivers/coeval.py` 的 `_setup_ics_and_pfs_for_scrolling`（E2/E3 直接导入复用）。

### 分支 3 断点续算命中与不命中

- **触发条件**：缓存清单（`RunCache`）里"最后一个完整红移"之前的所有条目都在（`is_complete_at`），且没有 `regenerate`。
- **分叉走向**：
  - 命中：从该红移的下一节点继续推进，并把已算的红移**重建**进容器（E1 重建 Coeval；E2 从自己的 checkpoint 格继续；E3 不落盘，基本不会命中）。
  - 不命中：从第一个目标红移开始整段算。
- **位置**：`_obtain_starting_point_for_scrolling`、`io/caching.py` 的 `RunCache`。
- **注意**：要求离散晕（`has_discrete_halos`）时直接跳过续算（多红移下缓存会被关闭）。

### 分支 4 光子守恒与最小内存

- **触发条件**：`PHOTON_CONS_TYPE`（四档）与 `MINIMIZE_MEMORY`（真/假）。
- **分叉走向**：
  - `no-photoncons`：备料里的 `setup_photon_cons` 什么都不做；循环里不刷新校准数据。
  - `z-photoncons`：备料装配校准曲线（红移下限 `PHOTONCONS_CALIBRATION_END`），循环里**每轮**刷新校准数据。
  - `alpha-photoncons` / `f-photoncons`：校准作用在星族参数上，不逐轮改红移。
  - `MINIMIZE_MEMORY` 为真：备料阶段对已用完的微扰场即时 `purge()`，C 侧也只保留当前半径的中间表。
- **位置**：`wrapper/photoncons.py` 的 `setup_photon_cons`；`drivers/coeval.py` 的备料与循环；`src/SpinTemperatureBox.c`、`src/IonisationBox.c`。

### 分支 5 E3 的单格参数派生

- **触发条件**：走 E3 时必然发生。
- **分叉走向**：`inputs.evolve_input_structs` 会改写十余项参数（盒子/网格/扰动/源项开关等，见 [E3 ②](#e3-②-单格参数-evolve_input_structs) 的参数列），所以**同一个参数在 E3 里与 E1/E2 含义不同**——这也是 E3 不落盘（缓存键对不上）的原因。
- **位置**：`drivers/global_evolution.py` 的 `evolve_input_structs`。

### 分支 6 E2 独有的 RSD 与 trimming

- **触发条件**：E2 收尾时按配置启用。
- **分叉走向**：切片之后依次做「速度梯度修正（`include_dvdr_in_tau21`）→ RSD（`apply_rsds`）→ trimming」，得到与观测口径一致的光锥；RSD 需要水平速度，所以要求 `KEEP_3D_VELOCITIES` 为真。
- **位置**：`drivers/lightcone.py` 的 `apply_rsds` / `include_dvdr_in_tau21` / `trim`；相关校验见 `drivers/lightconers.py`。

## 四 关键产物

| 产物 | 载体 | 在本图里由谁产出 | 边标签 | 是否落盘 |
| :--- | :--- | :--- | :--- | :--- |
| [P02 初始条件](../atlas/L0-pipeline.md#p02-初始条件) | `InitialConditions` | ②/④ 备料（三条共用） | `ICs / 微扰场` | 是（`CacheConfig.initial_conditions`） |
| [P03 微扰场](../atlas/L0-pipeline.md#p03-微扰场) | `PerturbedField` | 同上一行（逐红移一份） | `ICs / 微扰场` | 是（`perturbed_field`） |
| [P04 晕目录](../atlas/L0-pipeline.md#p04-晕目录) | `HaloCatalog` | 备料里的 `evolve_halos`（条件） | `晕目录[iz]` | 是（`halo_catalog`） |
| [P06 源项网格](../atlas/L0-pipeline.md#p06-源项网格)…[P10 亮温盒](../atlas/L0-pipeline.md#p10-亮温盒) | `HaloBox`…`BrightnessTemp` | ④/⑤ 逐红移循环 | 各产物名（见 [G1 §四](G1-主图.md#四-关键产物)） | 是（按 `CacheConfig` 分类） |
| [P11 演化快照](../atlas/L0-pipeline.md#p11-演化快照) | `Coeval` | E1 ⑤ yield 过滤 | `Coeval` | 手动 `save()` |
| [P12 光锥](../atlas/L0-pipeline.md#p12-光锥) | `LightCone` | E2 ⑥ 每红移切片 | `LightCone` | 手动 `save()` |
| [P13 全局演化历史](../atlas/L0-pipeline.md#p13-全局演化历史) | `GlobalEvolution` | E3 ⑥ 逐红移均值 → ⑦ return | `单格结果` / `时间序列` | 手动 `save()`（E3 关缓存） |
| [P16 光子守恒校准曲线](../atlas/L0-pipeline.md#p16-光子守恒校准曲线) | C 侧全局状态 | 备料里的 `setup_photon_cons`（条件） | — | 否 |

**本图特有的中间交接物**（同样写在边标签上）：`红移表`、`校验结果`、`source_model`、`单格参数`、`起始 iz`。

## 五 每步参数与标签

| 步骤（节点） | 参数（注册表原名） | 用法 | 标签 id | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| E1 ① 红移表 | （无：只读目标红移与节点红移） | — | — | — |
| E1/E2/E3 备料（三条共用） | `MINIMIZE_MEMORY` | 开关 | `tag:MINIMIZE_MEMORY` | 已注册 |
| E1/E2/E3 备料（三条共用） | `PHOTON_CONS_TYPE`、`PHOTONCONS_CALIBRATION_END` | 开关 / 校验 | `tag:PHOTON_CONS_TYPE`、`tag:PHOTONCONS_CALIBRATION_END` | 已注册 |
| E1/E2/E3 备料（三条共用） | `has_discrete_halos`、`lagrangian_source_grid`（由 `SOURCE_MODEL` 派生） | 开关 | — | **待注册** |
| E1 ③ / E2 ④ 断点续算 | （无独立参数；由 `CacheConfig` 与 `regenerate` 决定） | — | — | — |
| E1 ④ / E2 ⑤ / E3 ⑤ 循环 | `HII_DIM`、`PHOTON_CONS_TYPE`、`USE_TS_FLUCT` | 赋值 / 开关 | `tag:HII_DIM`、`tag:PHOTON_CONS_TYPE`、`tag:USE_TS_FLUCT` | 已注册 |
| E1 ⑤ yield 过滤 | （无） | — | — | — |
| E2 ① lightconer 校验 | `HII_DIM`、`BOX_LEN`、`KEEP_3D_VELOCITIES` | 赋值 / 校验 / 开关 | 对应标签 | 已注册 |
| E2 ③ 建 LightCone | `USE_TS_FLUCT`、`HII_DIM`、`BOX_LEN` | 开关 / 赋值 | 对应标签 | 已注册 |
| E2 ⑥ 每红移切片 | `USE_TS_FLUCT`、`KEEP_3D_VELOCITIES`、`HII_DIM`、`BOX_LEN` | 开关 / 赋值 | 对应标签 | 已注册 |
| E3 ① source_model 校验 | `SOURCE_MODEL` | 校验 | `tag:SOURCE_MODEL` | 已注册 |
| E3 ② 单格参数 | `BOX_LEN`、`DIM`、`HII_DIM`、`HIRES_TO_LOWRES_FACTOR`、`KEEP_3D_VELOCITIES`、`PERTURB_ALGORITHM`、`PHOTON_CONS_TYPE`、`SOURCE_MODEL`、`USE_EXP_FILTER`、`USE_INTERPOLATION_TABLES`、`USE_UPPER_STELLAR_TURNOVER`、`INTEGRATION_METHOD_ATOMIC`、`INTEGRATION_METHOD_MINI` | 赋值（**被改写**） | 对应 13 个标签 | 已注册 |
| E3 ③ 建容器 | （无） | — | — | — |
| E3 ⑥ 逐红移均值 | 同 E3 ② 的十三项 + `USE_TS_FLUCT`、`F_ESC10`、`F_STAR10`、`HII_EFF_FACTOR`、`POP2_ION` | 入公式 / 开关 | 对应标签 | 已注册 |
| E3 ⑦ return | （无） | — | — | — |

> 待注册的派生开关（`has_discrete_halos` / `lagrangian_source_grid`）与 `CacheConfig` 见 [G1 §五 待注册参数清单](G1-主图.md#待注册参数清单)。

## 六 节点与锚点对照

`docId` = `graphify/G2-入口B.md`。

| 图内节点 id | 画布标签 | 本文档锚点 |
| :--- | :--- | :--- |
| `atlas:fig2:e1` | E1 · run_coeval（coeval.py:632，薄壳 :639 → generate_coeval :478） | `#e1-run_coeval` |
| `atlas:fig2:e1:step1` | ① 红移表 _get_required_redshifts_coeval | `#e1-①-红移表-_get_required_redshifts_coeval` |
| `atlas:fig2:e1:step2` | ② 备料（三条共用）_setup_ics_and_pfs_for_scrolling | `#e1-②-备料三条共用_setup_ics_and_pfs_for_scrolling` |
| `atlas:fig2:e1:step3` | ③ 断点续算 _obtain_starting_point_for_scrolling | `#e1-③-断点续算-_obtain_starting_point_for_scrolling` |
| `atlas:fig2:e1:step4` | ④ 循环（三条共用）_redshift_loop_generator | `#e1-④-循环三条共用_redshift_loop_generator` |
| `atlas:fig2:e1:step5` | ⑤ yield 过滤 → Coeval 列表 | `#e1-⑤-yield-过滤-coeval-列表` |
| `atlas:fig2:e2` | E2 · run_lightcone（lightcone.py:691，薄壳 :698 → generate_lightcone :575） | `#e2-run_lightcone` |
| `atlas:fig2:e2:step1` | ① lightconer 校验 | `#e2-①-lightconer-校验` |
| `atlas:fig2:e2:step2` | ② 备料（三条共用）_setup_ics_and_pfs_for_scrolling | `#e2-②-备料三条共用_setup_ics_and_pfs_for_scrolling` |
| `atlas:fig2:e2:step3` | ③ 建 LightCone setup_lightcone_instance | `#e2-③-建-lightcone-setup_lightcone_instance` |
| `atlas:fig2:e2:step4` | ④ 断点续算 _obtain_starting_point_for_scrolling | `#e2-④-断点续算-_obtain_starting_point_for_scrolling` |
| `atlas:fig2:e2:step5` | ⑤ 循环（三条共用）_redshift_loop_generator | `#e2-⑤-循环三条共用_redshift_loop_generator` |
| `atlas:fig2:e2:step6` | ⑥ 每红移切片 → LightCone | `#e2-⑥-每红移切片-lightcone` |
| `atlas:fig2:e3` | E3 · run_global_evolution（global_evolution.py:230，唯一不是薄壳） | `#e3-run_global_evolution` |
| `atlas:fig2:e3:step1` | ① source_model 校验 | `#e3-①-source_model-校验` |
| `atlas:fig2:e3:step2` | ② 单格参数 evolve_input_structs | `#e3-②-单格参数-evolve_input_structs` |
| `atlas:fig2:e3:step3` | ③ 建容器 GlobalEvolution | `#e3-③-建容器-globalevolution` |
| `atlas:fig2:e3:step4` | ④ 备料（三条共用）_setup_ics_and_pfs_for_scrolling | `#e3-④-备料三条共用_setup_ics_and_pfs_for_scrolling` |
| `atlas:fig2:e3:step5` | ⑤ 循环（三条共用）_redshift_loop_generator | `#e3-⑤-循环三条共用_redshift_loop_generator` |
| `atlas:fig2:e3:step6` | ⑥ 逐红移均值 quantities[q][iz] = mean | `#e3-⑥-逐红移均值-quantitiesqiz-mean` |
| `atlas:fig2:e3:step7` | ⑦ return → GlobalEvolution | `#e3-⑦-return-globalevolution` |

> 上表就是本图的全部节点（21 个 = 3 条 lane 容器 + 18 个步骤）；子图里不会出现数据之外的卡片或连线（口径见 [G0 §四](G0-绘制规范.md#四-子图与父图的关系不继承父层关系)）。
