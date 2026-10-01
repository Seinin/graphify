# 初始条件（InitialConditions）· 自顶向下专题

> **这份文档只讲一件事：初始条件这个产物是怎么算出来的。**
>
> 它是**专题**（垂直切片：从对外入口一直切到关键量与公式），不是 atlas 的分层文件——因为一条链上同时出现阶段、子过程、函数与变量，跨层。
>
> - 想按"哪一层归谁、编号是什么"看骨架：**[atlas](atlas/README.md)**（本文的每一节都标注了对应的 atlas 编号，见 §8 追溯表）。
> - C 端分层的既有权威是 **[CODE_TOPOLOGY.md](CODE_TOPOLOGY.md)**；本文不复制它的分层结论，只把「初始条件」这一条竖着切开。
> - 选型与求解全貌仍以 `CODE_TOPOLOGY.md`、`FDM.md` 等为准；本文只做这一条的深入。
>
> 行号仅用于快速定位（随代码改动会失效）；**函数名 + 文件名才是稳定标识**。

## 0. 三十秒版

初始条件 = **一份高斯随机密度场 + 由它派生出来的一阶（以及可选的二阶）速度场**，全部在**高分辨率网格**上生成，再按需滤波降采样到**计算网格**。

```
random_seed ──▶ ① 逐线程种子         (rng.c)
P(k) 参数   ──▶ ② 功率谱就绪         (cosmology.c:init_ps)
                     │
                     ▼
        ③ k 空间高斯抽样：box(k)=sqrt(V·P(k)/2)·(a+ib)   (sample_ic_modes)
        ④ 共轭对称修正（让实空间场是实数）              (adj_complex_conj)
                     │
                     ▼ 反变换
        ⑤ 高分辨密度 δ_hires(x) = FFT⁻¹(δ_k)/V
                     │
                     ├─▶ ⑥ 滤波(顶帽 R=l·L/HII_DIM) + 采样 ──▶ δ_lowres
                     │
                     ├─▶ ⑦ 一阶速度 v_i(k)=δ_k·i·k_i/k² ──(必要时滤波)──▶ vx,vy,vz
                     │
                     ├─▶ ⑧ 相对速度 vcb（可选：重子-暗物质速度差）
                     │
                     └─▶ ⑨ 二阶修正 2LPT（可选：φ₂ 的二阶位移）
                     │
                     ▼
                 回收 FFTW / 随机数 / 功率谱
```

一句话抓住它的地位：**整条流水线的随机性只在这里被固定一次**，之后所有红移上的场都是它的确定性推导（见 §6.1）。

---

## 1. 顶层：它是什么、产出什么、谁调用

### 1.1 产物定位

| 项         | 内容                                                                                                                |
| :--------- | :------------------------------------------------------------------------------------------------------------------ |
| 产物编号   | **P02 初始条件**（atlas [L0](atlas/L0-pipeline.md#p02-初始条件)）                                              |
| 载体结构   | `InitialConditions`（Python 类在 `wrapper/outputs.py:505`；C 结构在 `src/_outputstructs_wrapper.h:6`）        |
| 直接生产者 | `ComputeInitialConditions`（`src/InitialConditions.c:547`）——经单场入口 [E4](atlas/L0-pipeline.md#e4-单场直算) |
| 消费方     | 微扰场（PerturbField）：降采样 / 平滑 / 速度位移都以它为输入                                                        |
| 上游       | 只有**P01 输入参数集**（含随机种子）                                                                          |
| 特殊性质   | 它是**唯一不随红移变化**的主链产物（一份用到最后），缓存键因此只看用户宇宙学（§6.4）                         |

### 1.2 它到底产出了哪些数组

`InitialConditions.new()`（`wrapper/outputs.py:530-579`）按参数**条件性地**创建字段 ——不是所有字段在任何配置下都存在：

| 字段                     | 形状                                              | 何时存在                            |
| :----------------------- | :------------------------------------------------ | :---------------------------------- |
| `hires_density`        | `(DIM, DIM, DIM·NON_CUBIC_FACTOR)`             | 总是                                |
| `lowres_density`       | `(HII_DIM, HII_DIM, HII_DIM·NON_CUBIC_FACTOR)` | 总是                                |
| `hires_vx/vy/vz`       | 同`hires_*`                                     | `PERTURB_ON_HIGH_RES = True`      |
| `lowres_vx/vy/vz`      | 同`lowres_*`                                    | `PERTURB_ON_HIGH_RES = False`     |
| `hires_v{x,y,z}_2LPT`  | 同`hires_*`                                     | `PERTURB_ALGORITHM == "2LPT"`     |
| `lowres_v{x,y,z}_2LPT` | 同`lowres_*`                                    | 同上**且** 不在高分辨上做扰动 |
| `lowres_vcb`           | 同`lowres_*`                                    | `USE_RELATIVE_VELOCITIES = True`  |

**注意两个反直觉点**：速度场是"要么全在高分辨、要么全在低分辨"（由 `PERTURB_ON_HIGH_RES` 二选一），而 2LPT 的对角分量为省内存**借用 `hires_v*_2LPT` 当工作区**（§4.9）。

### 1.3 谁"发起"计算：全仓只有三个调用点

**要点：算不算初始条件，由这三个调用点决定，而不是由"谁需要它"决定。**

| # | 发起者                                                              | 位置                                                                                                               | 触发条件                                                                           |
| :- | :------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| 1 | **备料函数 `_setup_ics_and_pfs_for_scrolling`**（包内唯一） | `drivers/coeval.py:837`，调用点 `:847`                                                                         | 传进来的`initial_conditions is None`（调用方没给现成的）                         |
| 2 | **CLI 子命令** `21cmfast run ics`（`cli.py:393` 定义、`:429` 调用） | `cli.py:429`                                                                                                     | 命令被调用；且`RunCache` 里没有现成的 ICs（否则打印提示后**直接 return**） |
| 3 | **用户代码**                                                  | `py21cmfast.compute_initial_conditions`（`drivers/single_field.py:37`，[E4](atlas/L0-pipeline.md#e4-单场直算)） | 用户显式调用（手动编排红移顺序时）                                                 |

第 1 个调用点被**三条流水线共用**，它们都**不是各自实现**：

| 流水线                                                                                     | 它的调用点                          | 传给备料函数的`initial_conditions`                                                                                     |
| :----------------------------------------------------------------------------------------- | :---------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| [E1 联合演化盒](atlas/L0-pipeline.md#e1-联合演化盒)（`generate_coeval` / `run_coeval`） | `drivers/coeval.py:579`           | 用户可选注入                                                                                                             |
| [E2 光锥](atlas/L0-pipeline.md#e2-光锥)（`run_lightcone`）                                | `drivers/lightcone.py:661`        | 用户可选注入                                                                                                             |
| [E3 全局演化](atlas/L0-pipeline.md#e3-全局演化)（`run_global_evolution`）                 | `drivers/global_evolution.py:344` | **写死 `None`**——永远自己重算，且 `cache=None` / `regenerate=True` / `CacheConfig.off()`，不读也不写缓存 |

> `run_coeval` 不单独算：它只是把 `generate_coeval` 这个生成器抽干（`drivers/coeval.py:632` 定义、`:639` 就是那一行列表推导）。

### 1.4 调用契约：怎么传参才不会踩坑

备料函数里的原样调用（`drivers/coeval.py:846-852`）：

```python
if initial_conditions is None:
    initial_conditions = sf.compute_initial_conditions(
        inputs=inputs,                    # 参数集
        write=write.initial_conditions,   # ← CacheConfig 的子开关
        initial_density=overdensity_z0,   # ← 只有全局演化会传非 None
        **iokw,                           # ← cache / regenerate / free_cosmo_tables
    )
```

四条约定，每条都有代价：

| 约定                                                                                | 说明                                                                                                    | 不遵守会怎样                                                                      |
| :---------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------- |
| **只用关键字调用**                                                            | 签名是`def compute_initial_conditions(*, inputs, initial_density=None)`，`*` 之后全是 keyword-only  | 传位置参数直接`TypeError`                                                       |
| **`cache` / `regenerate` / `write` / `free_cosmo_tables` 不在签名里** | 由`single_field_func` 装饰器 `kwargs.pop` 掉（`drivers/_param_config.py:445-451`）                | 只看签名会以为没有缓存控制                                                        |
| **要落盘就必须给 `cache`**                                                  | 装饰器检查`if write and not cache: raise ValueError("Cannot write to cache without a cache object.")` | `write=True` + 无 `cache` → 报错                                             |
| **链式调用应传 `free_cosmo_tables=False`**                                  | 默认`True`，每次调用后释放全局宇宙学查表                                                              | 后面每个红移都要重建功率谱查表，白花时间（三条流水线的`iokw` 都传了 `False`） |

另外 `inputs` 在**消费者**侧可省：装饰器会从"依赖里最靠前的那个结构体"取（`drivers/_param_config.py:453-458`），所以 `perturb_field(redshift=z, initial_conditions=ics)` 这种写法也能跑。

### 1.5 谁"消费"已有 ICs：拿到它才能往下算

这些函数**不会自己算 ICs**——`drivers/single_field.py` 内部没有任何一个入口调用另一个入口（逐个核对过），所以手动编排时必须先自己调 `compute_initial_conditions`，再一路传下去。

**单场入口：10 个里 8 个必收 `initial_conditions`**

| 函数                           | 位置                            | `initial_conditions` |
| :----------------------------- | :------------------------------ | :--------------------- |
| `perturb_field`              | `drivers/single_field.py:112` | 必填                   |
| `determine_halo_catalog`     | `:154`                        | 必填                   |
| `perturb_halo_catalog`       | `:209`                        | 必填                   |
| `compute_halo_grid`          | `:285`                        | 必填                   |
| `compute_xray_source_field`  | `:460`                        | 必填                   |
| `compute_spin_temperature`   | `:588`                        | 必填                   |
| `compute_ionization_field`   | `:662`                        | 必填                   |
| `interp_halo_boxes`          | `:370`                        | 不需要                 |
| `brightness_temperature`     | `:783`                        | 不需要                 |
| `compute_initial_conditions` | `:37`                         | 自己就是生产者         |

**编排层**

| 组件                                     | 位置                               | 角色                                                                                                   |
| :--------------------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `Coeval`（类 / 字段）                  | `drivers/coeval.py:61` / `:64` | ICs 的落点：每个快照都挂着同一份 ICs                                                                   |
| `_obtain_starting_point_for_scrolling` | `:642`                           | 断点续算：用缓存输出重新拼 Coeval 时也要挂上 ICs                                                       |
| `_redshift_loop_generator`             | `:691`                           | 把 ICs 塞进每个红移的调用：`kw = {**iokw, "initial_conditions": initial_conditions}`（`:718-721`） |
| `evolve_halos`                         | `:390`                           | 晕演化                                                                                                 |
| `_run_lightcone_from_perturbed_fields` | `drivers/lightcone.py:408`       | 光锥组装                                                                                               |
| `setup_photon_cons`                    | `wrapper/photoncons.py:202`      | 光子守恒校准（**消费**，不发起）                                                                 |

> 一处**误导性文档**：`setup_photon_cons` 的 docstring 写着 "Any other parameters able to be passed to `compute_initial_conditions`"（`wrapper/photoncons.py:227`），容易被读成"它会去算 ICs"。实际上它自己不调用，只是转发 kwargs；真正的调用发生在备料函数里，且在它**之前**。

### 1.6 时序：谁在谁之前

```
generate_coeval / run_lightcone / run_global_evolution / CLI
   │
   ├─ ① 没有现成 ICs → compute_initial_conditions(...)
   │       └─ 装饰器：一致性检查 → 读缓存 → 广播参数 → 建 wisdom
   │                   → C: ComputeInitialConditions → 按 write 落盘
   │
   ├─ ② write.initial_conditions → ics.prepare_for_perturb()        （精简内存）
   │
   ├─ ③ PHOTON_CONS_TYPE != "no-photoncons" → setup_photon_cons(initial_conditions=ics)
   │
   ├─ ④ 每个红移：perturb_field(initial_conditions=ics) → evolve_halos(...)
   │
   ├─ ⑤ write.initial_conditions → ics.prepare_for_spin_temp()
   │
   └─ ⑥ 红移循环：compute_spin_temperature / compute_ionization_field(initial_conditions=ics)
```

① 只在 `initial_conditions is None` 时发生；② 与 ⑤ 只在"确实要落盘"时才裁剪内存（`drivers/coeval.py:854-857` 有注释解释：没有缓存兜底时裁剪会丢信息）。

### 1.7 三条流水线的差异（同一份 ICs，三种用法）

| 流水线                                 | 允许用户注入 ICs              | 读缓存 | 写盘              | 实际会进 C 吗                                                                                               |
| :------------------------------------- | :---------------------------- | :----- | :---------------- | :---------------------------------------------------------------------------------------------------------- |
| E1`generate_coeval` / `run_coeval` | 是                            | 是     | 按`CacheConfig` | 会                                                                                                          |
| E2`run_lightcone`                    | 是                            | 是     | 按`CacheConfig` | 会                                                                                                          |
| E3`run_global_evolution`             | **否**（写死 `None`） | 否     | 否                | **不会**：它把 `DIM=HII_DIM=1`（`drivers/global_evolution.py:309-323`）→ 走单格退化分支（§2.1） |

E3 是唯一"调用了初始条件过程、却一行业都没算"的路径；它传 `overdensity_z0` 正是为了把"盒子平均值"塞进那一格。

### 1.8 在 atlas 里的编号对应

| 本文内容                                | atlas 编号                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| :-------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 整个链路                                | [S09 初始条件](atlas/L1-stages.md#s09-初始条件)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 随机数、FFT、抽样与滤波、速度、顶层编排 | [S09.1](atlas/L2-subprocesses.md#s091-逐线程随机数与种子管理) / [S09.2](atlas/L2-subprocesses.md#s092-傅里叶变换基建) / [S09.3](atlas/L2-subprocesses.md#s093-高斯随机密度场的抽样与实空间化) / [S09.4](atlas/L2-subprocesses.md#s094-速度场与相对速度场) / [S09.5](atlas/L2-subprocesses.md#s095-初始条件的顶层编排与资源回收)                                                                                                                                                                                  |
| 九个计算单元                            | [S09.1.1](atlas/L3-units.md#s0911-seed_rng_threads)、[S09.2.1](atlas/L3-units.md#s0921-dft_r2c_cube)、[S09.3.1](atlas/L3-units.md#s0931-sample_ic_modes)、[S09.3.2](atlas/L3-units.md#s0932-filter_box)、[S09.4.1](atlas/L3-units.md#s0941-compute_velocity_fields)、[S09.4.2](atlas/L3-units.md#s0942-compute_velocity_fields_2lpt)、[S09.4.3](atlas/L3-units.md#s0943-compute_relative_velocities)、[S09.5.1](atlas/L3-units.md#s0951-computeinitialconditions)、[S09.5.2](atlas/L3-units.md#s0952-resample_index) |

---

## 2. Python 侧：入口与装饰器

### 2.1 入口函数的两个分支（`drivers/single_field.py:37-108`）

```python
@single_field_func
def compute_initial_conditions(*, inputs, initial_density=None) -> InitialConditions:
```

1. `ics = InitialConditions.new(inputs=inputs)` —— 先按参数把**所有该有的数组**建好（形状见 §1.2）。
2. **单格分支**（`HII_DIM == 1 and DIM == 1`）：不进 C。它借用 `PerturbedField.new(redshift=0).get_required_input_arrays(ics)` 问出"下游真正需要的数组名"，逐个填 `0.0`，**只有 `hires_density` / `lowres_density` 会被 `initial_density` 覆盖**。这是个很实用的设计：省掉 1³ 网格上毫无意义的 FFT。
3. **常规分支**：若传了 `initial_density`，先做形状检查与均值提醒（§7 第 3 条），把它直接写进 `ics.hires_density`，然后 `ics.compute()`。

### 2.2 装饰器在调用前后做了什么（`drivers/_param_config.py:417-472`）

`@single_field_func` 是一个**类装饰器**，它把入口函数包成一个可调用对象，调用时按固定顺序执行：

| 顺序 | 动作                                                                                    | 作用                                                                         |
| :--- | :-------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| 1    | `check_consistency` / `check_output_struct_types` / `ensure_redshift_consistency` | 参数与入参结构体的一致性（红移、类型、兼容性）                               |
| 2    | `check_backend_state`                                                                 | 例如"需要光子守恒但还没校准"就直接报错，避免算出静默错误的场                 |
| 3    | `_handle_read_from_cache`                                                             | 命中缓存就**直接返回**，不进 C                                         |
| 4    | `_broadcast_inputs`                                                                   | 把六个参数结构体广播成 C 端全局量                                            |
| 5    | `_make_wisdoms`                                                                       | 首次运行会建 FFT 计划缓存（§6.3）                                           |
| 6    | `self._func(**kwargs)`                                                                | 真正的函数体（§2.1）                                                        |
| 7    | `_handle_write_to_cache`                                                              | 按`write=` 决定是否落盘                                                    |
| 8    | `_free_cosmo_tables`                                                                  | 默认释放全局查表；高层驱动会显式传`free_cosmo_tables=False` 以免反复重分配 |

**关键点**：这个装饰器是**所有**单场入口共用的，所以 §4 的每一步都不必自己关心"参数有没有广播过、缓存要不要读"。

### 2.3 从 Python 对象到 C 结构体（cffi 桥）

```
ics.compute()                                  # InitialConditions.compute()
 └─ OutputStruct._compute(seed)                # wrapper/outputs.py:444-485
     ├─ push_to_backend()                      # Python 数组 → C 结构体指针
     ├─ self._c_compute_function(seed, cstruct)
     │    = lib.ComputeInitialConditions       # outputs.py:508 声明绑定
     ├─ _process_exitcode(...)                 # C 返回值 → Python 异常
     └─ pull_from_backend()                    # C 填好的数组 → Python
```

C 侧可见性由 `src/_functionprototypes_wrapper.h:6` 声明：

```c
int ComputeInitialConditions(unsigned long long random_seed, InitialConditions *boxes);
```

**所以整个初始条件对外只有这一个 C 入口**——它没有和别的 `Compute*` 相互调用（这一点与电离/自旋温度阶段不同）。

---

## 3. 算法总流程（C 侧）

### 3.1 主函数骨架（`src/InitialConditions.c:547-776`）

| 段           | 行号    | 做什么                                                                                                                            |
| :----------- | :------ | :-------------------------------------------------------------------------------------------------------------------------------- |
| A 准备       | 555-616 | 取种子建 RNG、算高低分辨维度、绑定输出指针、分配两个 k 空间工作盒                                                                 |
| B 抽样或反向 | 617-697 | `init_ps()` → 判 `non_zero_input` → **要么** 抽样+反变换得 `hires_density`，**要么** 把外部密度正向变换后跳过 |
| C 低分辨密度 | 698-732 | 拷贝工作盒（避免污染已存的密度）→ 视条件滤波 → 反变换 → 按`resample_index` 采到低分辨                                        |
| D 速度       | 734-740 | 可选`compute_relative_velocities`；然后 `compute_velocity_fields`（一阶）                                                     |
| E 2LPT       | 742-755 | `PERTURB_ALGORITHM == 2` 时才跑                                                                                                 |
| F 回收       | 760-771 | 清 FFTW 线程/计划、释放工作盒、`free_ps()`、`free_rng_threads()`                                                              |

两个工作盒是全流程的关键：

- `HIRES_box`：**当前正在用的** k 空间/实空间盒（反复被覆盖）；
- `HIRES_box_saved`：**初始 δ_k 的只读副本**——所有速度场都从它派生（`compute_f_gradient(box_saved → box)`），所以它必须活到最后（§4.10）。

### 3.2 数据流

```
                 ┌─────────────────────── HIRES_box_saved（δ_k 副本，只读）───────────────────────┐
                 │                                                                              │
δ_k ──┬── 反变换 ──▶ hires_density                                      ┌──▶ 一阶速度 v_i
      │                                                                  │
      ├── 滤波+反变换 ──▶ lowres_density                                 ├──▶ 相对速度 vcb
      │                                                                  │
      └── 拉普拉斯组合 ──▶ φ₂ 的 k 空间 ── 反变换 ── 梯度 ──▶ 2LPT 速度 ───┘
```

---

## 4. 逐步代码解析

> 每步统一四问：**做什么 → 落在哪 → 关键代码点 → 为什么这么写**。

### 4.1 步骤 ①：逐线程种子派生（`src/rng.c:30-89`）

- **做什么**：由 `random_seed` 派生 `N_THREADS` 个互不相同的种子，各建一个 GSL 生成器。
- **关键代码点**：从 `INT_MAX/16` 个整数中 `gsl_ran_choose` 抽 N 个 → `gsl_ran_shuffle` 打乱 → 按 `checker` 轮换 **5 种**生成器（`mt19937` / `gfsr4` / `cmrg` / `mrg` / `taus2`）。
- **为什么**：抽样是各线程独立进行的（`sample_ic_modes` 里 `gsl_ran_ugaussian(r[thread_num])`），必须保证线程之间不共享流。
- 文件里有一条作者自己留的 TODO：这个函数**慢**，而且每次快照都想调用它并不合适；另有一个 `seed_rng_threads_fast`，注释明确写了**初始条件不用它**（"using the slower version is only used once"）。

### 4.2 步骤 ②：功率谱就绪（`src/cosmology.c:536-545`）

- **做什么**：`init_ps()` 把宇宙学参数整理成 `cosmo_consts`（`omhh`、`theta_cmb`、`f_nu`、`f_baryon`…）。
- **为什么先做**：`sample_ic_modes` 每格点都调 `power_in_k(k)`，而 `power_in_k` 依赖 `cosmo_consts` 与传输函数。
- **对应的释放**是收尾的 `free_ps()`（`cosmology.c:589`），它在用 CLASS 功率谱时会顺手把 CLASS 插值器也释放掉。

### 4.3 步骤 ③：k 空间高斯抽样（`src/InitialConditions.c:103-139`）

对每个独立 k 模（只遍历 `n_z ≤ dim_z/2`，因为实空间场是实数的）：

```c
k_mag = sqrt(k_x² + k_y² + k_z²);
p     = power_in_k(k_mag);                       // 见下
a = gsl_ran_ugaussian(r[thread_num]);            // 标准正态
b = gsl_ran_ugaussian(r[thread_num]);
box[grid_index_fftw_c(n_x,n_y,n_z,dim)] = sqrt(VOLUME * p / 2.0) * (a + b*I);
```

- **两处物理**：幅度取 `sqrt(V·P(k)/2)`，其中 `V = BOX_LEN³ · NON_CUBIC_FACTOR`；实部虚部各取一个独立标准正态（这样模长的相位是均匀的）。
- **`power_in_k` 内部**（`cosmology.c:273-308`）依次乘：原始曲率谱 × 传输函数² / k³；非 CLASS 传输函数要先补 `k²`（两种约定归一不同，代码里有注释说明）；`USE_RELATIVE_VELOCITIES` 时乘一个**相对速度的平均压制**高斯（模板参数 `A_VCB_PM` / `KP_VCB_PM` / `SIGMAK_VCB_PM`）；`FDM` 时乘 `T_F(k)²`。
- `k` 由 `index_to_k`（`src/indexing.h:109`）给出：`idx ≤ dim/2` 取正、否则回绕为负，再乘 `2π/len`。

### 4.4 步骤 ④：共轭对称修正（`src/InitialConditions.c:26-101`）

抽样只填了半空间，`adj_complex_conj` 把另一半按 `conjf` 补齐，保证反变换出来是**实的**：

- 先把 7 个自共轭角点（i、j、k 取 0 或中点）取实部；
- 把 `(0,0,0)` 模**置零**（DC 模 = 盒子平均值，零均值是"密度对比"的定义域要求）；
- 再处理两条切片（i 非 0、j 与 k 取角点）与 i 角点行。

这段是纯索引技巧（`grid_index_fftw_c`，r2c 布局下 z 只存一半），逻辑不难但很容易写错，改动风险高。

### 4.5 步骤 ⑤：实空间化与高分辨密度（`src/InitialConditions.c:666-697`）

```c
sample_ic_modes(HIRES_box, hi_dim, box_len, r);            // 抽样
memcpy(HIRES_box_saved, HIRES_box, KSPACE_NUM_PIXELS);     // 存 δ_k 副本 ← 后面所有速度都靠它
dft_c2r_cube(..., HIRES_box);                              // k → x
boxes->hires_density[idx_r] = HIRES_box[idx_f] / VOLUME;   // FFTW 不做归一，必须除 V
```

**`non_zero_input` 反向分支**（`:638-665`）：如果用户传进来的 `hires_density` 不是全零，则

1. 把它乘 `V/TOT_NUM_PIXELS` 后放进 `HIRES_box`，做 `dft_r2c_cube` 得 δ_k；
2. 存进 `HIRES_box_saved`；
3. **跳过抽样，也跳过写回 `hires_density`**（用户给的密度原样保留），后续滤波、速度全部照常。

即："外部给密度"与"自己抽样"的差别只在**δ_k 从哪里来**。

### 4.6 步骤 ⑥：滤波与低分辨密度（`src/InitialConditions.c:698-732`）

```c
memcpy(HIRES_box, HIRES_box_saved, KSPACE_NUM_PIXELS);      // 从副本恢复，保护 hires_density
if (DIM != HII_DIM)                                          // 只有两者不等才滤波
    filter_box(HIRES_box, hi_dim, 0, physconst.l_factor * BOX_LEN / HII_DIM, 0.);
dft_c2r_cube(..., HIRES_box);
boxes->lowres_density[idx_r] = HIRES_box[idx_f] / VOLUME;    // 用 resample_index 采到低分辨
```

- `filter_type = 0` 是**实空间顶帽**（`src/filtering.c`）；半径 `R = l_factor · BOX_LEN / HII_DIM`，其中 `l_factor = 0.620350491 = (4π/3)^(−1/3)`，即"与一个低分辨格点等体积的球半径"。
- 采样用 `resample_index`（`src/indexing.c:88`）：高/低分辨维度比不一定是整数，所以**在输出格点上加 0.5 再取整**（函数上方的注释写明了这一点）。
- `DIM == HII_DIM` 时跳过滤波——这时低分辨密度就是高分辨密度，只是形状一样。

### 4.7 步骤 ⑦：一阶速度场（`src/InitialConditions.c:299-364`）

对三个方向各做一次"k 空间求梯度 + 反变换 + 采样"：

```
v_i(k) = δ_k · i·k_i / k²          (compute_f_gradient, :240-267)
v_i(x) = FFT⁻¹[v_i(k)] / V          (dft_c2r_cube + 采样)
```

- `compute_f_gradient` 里 DC 模单独置 0（否则 `k=0` 处除零出 NaN）——代码注释就写了这一点。
- **是否滤波**取决于 `PERTURB_ON_HIGH_RES`：为假时先按同样的顶帽滤波再采样到低分辨（`:331-336`）；为真时直接采到高分辨。
- 输出指针在 `InitialConditions.c:585-599` 二选一绑定（`vel_pointers` 指向 hires 或 lowres 的那一组）。

### 4.8 步骤 ⑧：相对速度 vcb（可选，`src/InitialConditions.c:141-238`）

- **做什么**：重子与暗物质的速度差。对三个方向：

  ```
  v_i(k) = δ_k · i·k_i/k · sqrt(P_vcb(k)/P(k)) · c_kms      (physconst.c_kms)
  ```
- 然后**直接滤波到低分辨**（不等价于先反变换再采样），反变换，采到低分辨并累加三个分量的平方，最后 `sqrt(Σv_i²)/V` 得到 `lowres_vcb`。
- 只支持 CLASS 功率谱（`power_in_k` 里有注释：`USE_RELATIVE_VELOCITIES` 只允许配 CLASS），并且它会**改变初始条件的 P(k)**（§4.3 的压制项）。

### 4.9 步骤 ⑨：二阶修正 2LPT（可选，`src/InitialConditions.c:366-544`）

只在 `PERTURB_ALGORITHM == 2` 时进入。按 Scoccimarro (1998) 附录 D：

1. 对三个对角分量 `(ii) = (00),(11),(22)` 算 `φ_{1,ii}(k) = −k_i k_i/k² · δ_k`（`compute_f_laplacian`，`:269-297`），反变换后**暂存进 `hires_v*_2LPT`**（借输出当工作区，省一次大分配，代码注释明说了）；
2. 对三个非对角分量 `(01),(02),(12)` 同样求 `φ_{1,ij}`，并在实空间就地合成拉普拉斯：

   ```
   ∇²φ₂ = Σ_{i≠j} [ φ_{1,ii}·φ_{1,jj} − φ_{1,ij}² ]        （:451-482）
   ```
3. 归一化 `/(V²·N)`（`:486-498`，N = `TOT_NUM_PIXELS`），再变换回 k 空间、**存回 `HIRES_box_saved`**（`:507`）——即此后"副本"里装的是 φ₂ 而不是 δ_k；
4. 对三个方向求梯度（`compute_f_gradient`）、按 `PERTURB_ON_HIGH_RES` 决定是否滤波、反变换、采样到输出（`:510-543`）。

### 4.10 步骤 ⑩：收尾与资源回收（`src/InitialConditions.c:760-771`）

```
fftwf_cleanup_threads() → fftwf_cleanup() → fftwf_forget_wisdom()
fftwf_free(HIRES_box) / fftwf_free(HIRES_box_saved)
free_ps()            // 含 CLASS 插值器
free_rng_threads(r)  // 逐个 gsl_rng_free
```

顺序并不随意：**FFTW 计划必须在下游可能重复使用之前清掉**（避免计划缓存与服务端状态互相污染），而 `free_ps()` 在最后是因为 2LPT 分支也会用到功率谱。

---

## 5. 关键量与参数

### 5.1 关键量（记号来自 `src/indexing.h` 与 `src/Constants.c`）

| 量                                         | 含义                                         | 影响                                   |
| :----------------------------------------- | :------------------------------------------- | :------------------------------------- |
| `VOLUME`                                 | `BOX_LEN³ · NON_CUBIC_FACTOR`            | 抽样幅度与所有`/VOLUME` 归一         |
| `TOT_NUM_PIXELS` / `KSPACE_NUM_PIXELS` | 高分辨实空间/半空间格点数                    | 内存与 FFT 规模                        |
| `D_PARA` / `HII_D_PARA`                | `NON_CUBIC_FACTOR · DIM` / `· HII_DIM` | 非立方盒的第三维                       |
| `hi_dim[3]` / `lo_dim[3]`              | 高/低分辨维度（第三维用`D_PARA`）          | 决定滤波与采样                         |
| `dim_ratio_hi_lo`                        | `DIM / HII_DIM`                            | `resample_index` 的换算比            |
| `physconst.l_factor` = 0.620350491       | `(4π/3)^(−1/3)`                          | 顶帽半径与格点等体积                   |
| `physconst.c_kms` = 2.99792458e5         | 光速 km/s                                    | 只用于 vcb 换算                        |
| `HIRES_box_saved`                        | δ_k 的只读副本                              | 所有速度场的种子；2LPT 后被覆写为 φ₂ |
| `non_zero_input`                         | 用户是否给了密度场                           | 决定"抽样 vs 反向"整条分支             |

### 5.2 参数怎么影响结果

| 参数                                                       | 影响                                                      |
| :--------------------------------------------------------- | :-------------------------------------------------------- |
| `random_seed`                                            | **唯一**决定这一份实现（§6.1）                     |
| `DIM` / `HII_DIM` / `BOX_LEN` / `NON_CUBIC_FACTOR` | 分辨率与体积；决定是否滤波、采样比、数组形状              |
| `PERTURB_ON_HIGH_RES`                                    | 速度场落在高分辨还是低分辨                                |
| `PERTURB_ALGORITHM`                                      | `1LPT`：只做一阶；`2LPT`：多算 φ₂ 并多产出 6 个数组 |
| `USE_RELATIVE_VELOCITIES`                                | 是否算`lowres_vcb`；**同时**轻微改变 P(k)         |
| `FDM`                                                    | 让`power_in_k` 乘 `T_F(k)²`（模糊暗物质截断）        |
| `POWER_SPECTRUM`                                         | 传输函数来源（EH/BBKS/…/CLASS）；CLASS 才能配相对速度    |
| `USE_FFTW_WISDOM`                                        | 是否用 FFT 计划缓存                                       |
| `N_THREADS`                                              | 并行度；**会改变抽样所用的随机流张成**（见 §6.2）  |

### 5.3 从使用者角度看到的表现

- 改 `random_seed` → 换一份实现（同样的统计性质）。
- 改 `BOX_LEN` / `HII_DIM` → 改变最低可分辨尺度与样本量，`δ` 的实现随之不同（因为 `power_in_k` 与体积都变）。
- 打开 `2LPT` → 位移场更准，代价是多 3 次（对角）+ 3 次（非对角）反变换与一整套额外数组。

---

## 6. 复现性、并行与缓存

### 6.1 随机数链（决定"能不能复现"）

```
用户 random_seed
  └─ seed_rng_threads：mt19937(seed) → 从 INT_MAX/16 个整数中选 N_THREADS 个 → shuffle
       └─ 每线程一个生成器（5 种轮换）→ sample_ic_modes 中逐模取两个标准正态
```

- **只有这一处**用到随机数：整条流水线的其他阶段都是确定性推导，所以"同一份输入 + 同一种子 = 同一份初始条件"成立。
- 但请注意：**改变 `N_THREADS` 会改变每线程拿到的种子序列**，从而改变随机场在模上的具体分配（统计性质不变，实现不同）。

### 6.2 并行

- 抽样、共轭修正、各次实空间归一化与采样都用 `#pragma omp parallel for` + `num_threads(N_THREADS)`。
- 主函数开头有 `omp_set_num_threads()`，但各循环仍显式指定线程数（两处都要一致才行）。

### 6.3 FFTW 计划缓存

- `dft_r2c_cube` / `dft_c2r_cube`（`src/dft.c:18-72`）在 `USE_FFTW_WISDOM` 为真时，从 `config_settings.wisdoms_path` 读计划；读不到就退回 `FFTW_ESTIMATE` 并打警告。
- 计划由 `CreateFFTWWisdoms`（`dft.c:74-147`，Python 侧 `construct_fftw_wisdoms`）预先以 `FFTW_PATIENT` 生成并落盘——**首次运行慢、之后快**的原因就在这里。

### 6.4 缓存键

`InitialConditions` 声明 `_compat_hash = _HashType.user_cosmo`（`wrapper/outputs.py:510`），即它的缓存键**只看用户宇宙学参数，不含红移网格**。这与它的物理性质一致（与红移无关），也是为什么"只改红移列表"时初始条件能直接复用。

---

## 7. 边界与坑

1. **单格退化**：`DIM == HII_DIM == 1` 时 C 侧完全不执行（`single_field.py:65-87`）。若误以为"全局演化也算了初始条件"，其实是填了常数——密度只有 `hires_density` / `lowres_density` 会被 `initial_density` 覆盖，其余为 0。
2. **2LPT 会借用输出当工作区**：`compute_velocity_fields_2LPT` 把 `hires_v*_2LPT` 当 φ₁ 对角分量的暂存区（`:749-750` 注释）。所以**如果 2LPT 中途失败，这些数组里是中间量而不是结果**。
3. **`initial_density` 的均值检查有个笔误**：`single_field.py:90` 写的是 `np.abs(initial_density.mean() > 1e-3)`，实际效果是"只有均值为**正**且大于 1e-3 才警告"，负均值不会提醒（原意应是 `abs(mean) > 1e-3`）。传入的应当是**密度对比**（零均值），不是绝对密度。
4. **滤波只在 `DIM != HII_DIM` 时发生**：两个分支共用同一段代码，误把 `HII_DIM` 设成 `DIM` 不会报错，但会悄悄改变低分辨密度的物理含义（顶帽半径变成 1 格）。
5. **`USE_RELATIVE_VELOCITIES` 有双重影响**：既多产一个数组，又在 `power_in_k` 里乘压制项，并且**只支持 CLASS 功率谱**。想要别的传输函数就不能开它。
6. **vcb 的采样路径与其他量不同**：它先滤波（k 空间）再反变换再采样，而不是"先反变换再滤波"——这是刻意的省算力写法，改动时必须保持与 `lowres_vcb` 的定义一致。
7. **`free_ps()` 在最后**：如果将来把它挪到 2LPT 之前，`PERTURB_ALGORITHM == 2` 时会读到已释放的插值器。

---

## 8. 追溯表：本文 ↔ atlas 编号

| 本文小节                  | atlas 子过程                                                         | atlas 计算单元                                                 | 代码落点                    |
| :------------------------ | :------------------------------------------------------------------- | :------------------------------------------------------------- | :-------------------------- |
| §4.1 种子派生            | [S09.1](atlas/L2-subprocesses.md#s091-逐线程随机数与种子管理)         | [S09.1.1](atlas/L3-units.md#s0911-seed_rng_threads)             | `src/rng.c`               |
| §3/§4 各次变换          | [S09.2](atlas/L2-subprocesses.md#s092-傅里叶变换基建)                 | [S09.2.1](atlas/L3-units.md#s0921-dft_r2c_cube)                 | `src/dft.c`               |
| §4.3 抽样 / §4.4 共轭   | [S09.3](atlas/L2-subprocesses.md#s093-高斯随机密度场的抽样与实空间化) | [S09.3.1](atlas/L3-units.md#s0931-sample_ic_modes)              | `src/InitialConditions.c` |
| §4.6 低分辨滤波          | [S09.3](atlas/L2-subprocesses.md#s093-高斯随机密度场的抽样与实空间化) | [S09.3.2](atlas/L3-units.md#s0932-filter_box)                   | `src/filtering.c`         |
| §4.7 一阶速度            | [S09.4](atlas/L2-subprocesses.md#s094-速度场与相对速度场)             | [S09.4.1](atlas/L3-units.md#s0941-compute_velocity_fields)      | `src/InitialConditions.c` |
| §4.9 二阶修正            | [S09.4](atlas/L2-subprocesses.md#s094-速度场与相对速度场)             | [S09.4.2](atlas/L3-units.md#s0942-compute_velocity_fields_2lpt) | `src/InitialConditions.c` |
| §4.8 相对速度            | [S09.4](atlas/L2-subprocesses.md#s094-速度场与相对速度场)             | [S09.4.3](atlas/L3-units.md#s0943-compute_relative_velocities)  | `src/InitialConditions.c` |
| §3/§4.10 顶层编排与回收 | [S09.5](atlas/L2-subprocesses.md#s095-初始条件的顶层编排与资源回收)   | [S09.5.1](atlas/L3-units.md#s0951-computeinitialconditions)     | `src/InitialConditions.c` |
| §4.6 采样比换算          | [S09.5](atlas/L2-subprocesses.md#s095-初始条件的顶层编排与资源回收)   | [S09.5.2](atlas/L3-units.md#s0952-resample_index)               | `src/indexing.c`          |

**图上怎么读（Graphify 的子图）**：进入 `compute_initial_conditions`，这一层是**三块骨架**（装饰框）。
它们与本文小节、atlas 子过程的对应：

| 图上的块 | 覆盖本文小节 | atlas 子过程 |
| :------- | :----------- | :----------- |
| 初始加载（参数 · 种子 · 功率谱） | §4.1、§4.2、§5.2 | S09.1 + S09.2（基建部分） |
| 核心计算（密度场 · 低分辨场 · 速度场） | §4.3–§4.9 | S09.2（变换）+ S09.3 + S09.4 |
| 产物与收尾（交付下游 · 资源回收） | §1.5、§4.10 | S09.5 |

划分依据是 `src/InitialConditions.c` 主函数 `ComputeInitialConditions`（:547）的三段：try 块开头的
一次性准备（557–620）、物理核心（660–758，内含 `BEGIN/END 2LPT PART` 注释）、末尾的释放（760–770）。
成员表以 `Graphify/scripts/lib/ic-blocks.mjs` 为准（重组 / 导入 / 断言脚本共用那一份）。
早先这一层是「初始条件（S09）」一个大框装 13 个步骤——进子图看不出分成哪几块，且这一层只挂一个子节点。

返回：[atlas 导览](atlas/README.md) ｜ [atlas 主题索引](atlas/INDEX.md) ｜ [C 端分层权威 CODE_TOPOLOGY.md](CODE_TOPOLOGY.md) ｜ [本文的有向图视图（Graphify）](../../Graphify/README.md)
