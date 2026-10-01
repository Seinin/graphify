 

# L0 · 流水线：入口与产物

> **什么时候看这一页**：想知道"这个量是谁算的、什么时候有的、谁产出谁"的时候。
> 读法总览见 [README](README.md)｜按问题查见 [INDEX](INDEX.md)｜维护规则见 [CONVENTIONS](CONVENTIONS.md) §3.3。
>
> 本层只有两种概念：**入口 E**（对外可以怎么调）与**产物 P**（会得到什么、谁给谁）。
> 除 [§1.3 的伪代码块](#13-三条时间流水线的伪代码对照)外，本层不出现阶段、子过程、函数名、文件路径、变量名；需要往下走时只给链接。
>
> **两处例外**：[§1.3](#13-三条时间流水线的伪代码对照) 的伪代码块——讲清三条时间流水线的编排差异所必需，其中允许出现的编排层符号名由 [CONVENTIONS](CONVENTIONS.md) §3.3 **显式枚举**；以及每个词条的一行「代码位置」字段与文末 [代码位置速查表](#5-代码位置速查表)——后两处集中给出"落在哪个文件的哪个符号"。其余正文（结论、矩阵、依赖图、词条的其它字段）保持上面的纯度要求。

## 0. 本层结论

1. 对外有 **7 个入口**（E1–E7），分 **5 种角色**：**时间流水线**（E1 联合演化盒、E2 光锥、E3 全局演化）、**底层直算**（E4 单场直算）、**前置装配**（E5 参数装配与模板）、**横切设施**（E6 持久化与读取）、**旁路回灌**（E7 离线与旁路）。**它们不都是并列的**：只有 E1–E3 互为替代（且 E3 是 E1 的零维特例），E4 是这三位的**下一层**，E5/E6/E7 不是"路径"而是前置、横切与旁路——见 [§1.1](#11-七个入口不是并列的)。
2. 内部只有 **17 种产物**（P01–P17），其中 P01–P10 构成一条**主链**，P11–P13 是聚合形态，P14–P17 是旁路形态。
3. 主链沿红移递减方向推进一次；**P02–P05 在推进之前一次性备好**，P06–P10 每个红移各一份。
4. 每个词条都带一行「代码位置」（**文件 + 符号名**，不给行号以免过期）；文末另有 [代码位置速查表](#5-代码位置速查表) 可一眼扫完并直接跳进源码。

## 1. 入口的角色与产物矩阵

### 1.1 七个入口不是并列的

| 角色                 | 成员                                                                           | 在本层的作用                                                          | 与其它角色的关系                                                                                                                                                                      |
| :------------------- | :----------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **时间流水线** | [E1 联合演化盒](#e1-联合演化盒)、[E2 光锥](#e2-光锥)、[E3 全局演化](#e3-全局演化) | 一次运行沿红移拿到主链的整套产物                                      | 三者互为替代（[E3](#e3-全局演化) 是 [E1](#e1-联合演化盒) 的零维特例）；**都建立在 [E4](#e4-单场直算) 之上**                                                                        |
| **底层直算**   | [E4 单场直算](#e4-单场直算)                                                     | 主链[P02](#p02-初始条件)–[P10](#p10-亮温盒) 的**唯一直接产出者** | 被时间流水线内部调用；自己对用户也公开，可单独编排红移顺序                                                                                                                            |
| **前置装配**   | [E5 参数装配与模板](#e5-参数装配与模板)                                         | 产出[P01 输入参数集](#p01-输入参数集)，任何入口都得先有它              | 先于全部入口；接受旁路并入的[P17 宇宙学查表](#p17-宇宙学查表)                                                                                                                          |
| **横切设施**   | [E6 持久化与读取](#e6-持久化与读取)                                             | 不推进主链，只负责把产物落盘、重跑时回读                              | 包裹其它入口；[E3 全局演化](#e3-全局演化) 运行时缓存被显式关闭，因此与它不相交                                                                                                         |
| **旁路回灌**   | [E7 离线与旁路](#e7-离线与旁路)                                                 | 产出离线诊断，并把一个全局状态回灌主链                                | [P14](#p14-光度函数诊断)、[P15](#p15-再电离光学深度) 是端点；[P16 光子守恒校准曲线](#p16-光子守恒校准曲线) 回灌流水线；[P17 宇宙学查表](#p17-宇宙学查表) 前置交给 [E5](#e5-参数装配与模板) |

层次一览（`──→` 读作"内部调用"；三个角色的"包裹/前置/回灌"关系各不相同）：

```
E1 联合演化盒 ┐
E2 光锥       ├──→ E4 单场直算 ──→ P02 … P10 ──→ P11 / P12 / P13
E3 全局演化   ┘

E5 前置装配 ──（P01）──→ 以上全部入口
E6 横切设施 ──包裹──→ 以上全部入口（E3 运行时关闭缓存，除外）
E7 旁路回灌 ──P16──→ E1 / E2      ──P17──→ E5      P14 / P15：到此为止
```

### 1.2 产物矩阵

图例（同一个格子只标**最强**的那种关系：拿到产物就不再标消费）：

- `○` = **直接产出**：该入口自己实现该产物。
- `△` = **经由内部编排**：该入口内部调用 `○` 的那个入口才得到它，自身不实现。
- `●` = **只消费**：读别人产出的，自己不产出。
- `◐` = **产出与消费兼具**：落盘后回读，或"内部触发建立 + 随后读取"。
- 空白 = 无关。

标记表示**该路径会走到**该产物的产生步骤；是否真正产生取决于参数开关（例如是否启用离散晕抽样、自旋温度涨落，以及源模型是否为拉格朗日型），参数条件不在本层展开。列的先后即 [§1.1](#11-七个入口不是并列的) 的角色顺序。

| 产物 \ 入口          | E1 联合演化盒 · 流水线 | E2 光锥 · 流水线 | E3 全局演化 · 流水线 | E4 单场直算 · 底层 | E5 参数装配 · 前置 | E6 持久化读写 · 横切 | E7 离线旁路 · 旁路 |
| :------------------- | :---------------------: | :---------------: | :-------------------: | :-----------------: | :-----------------: | :-------------------: | :-----------------: |
| P01 输入参数集       |           ●           |        ●        |          ●          |         ●         |         ○         |          ◐          |         ◐         |
| P02 初始条件         |           △           |        △        |          △          |         ○         |                    |          ◐          |                    |
| P03 微扰场           |           △           |        △        |          △          |         ○         |                    |          ◐          |                    |
| P04 晕目录           |           △           |        △        |                      |         ○         |                    |          ◐          |                    |
| P05 微扰晕目录       |                        |                  |                      |         ○         |                    |          ◐          |                    |
| P06 源项网格         |           △           |        △        |          △          |         ○         |                    |          ◐          |                    |
| P07 X 射线源箱       |           △           |        △        |          △          |         ○         |                    |          ◐          |                    |
| P08 自旋温度盒       |           △           |        △        |          △          |         ○         |                    |          ◐          |                    |
| P09 电离盒           |           △           |        △        |          △          |         ○         |                    |          ◐          |                    |
| P10 亮温盒           |           △           |        △        |          △          |         ○         |                    |          ◐          |                    |
| P11 演化快照         |           ○           |                  |                      |                    |                    |          ◐          |                    |
| P12 光锥             |                        |        ○        |                      |                    |                    |          ◐          |                    |
| P13 全局演化历史     |                        |                  |          ○          |                    |                    |          ◐          |                    |
| P14 光度函数诊断     |                        |                  |                      |                    |                    |                      |         ○         |
| P15 再电离光学深度   |                        |                  |                      |                    |                    |                      |         ○         |
| P16 光子守恒校准曲线 |           ◐           |        ◐        |                      |                    |                    |                      |         ○         |
| P17 宇宙学查表       |                        |                  |                      |                    |         ●         |                      |         ○         |

### 1.3 三条时间流水线的伪代码对照

[E1 联合演化盒](#e1-联合演化盒)、[E2 光锥](#e2-光锥)、[E3 全局演化](#e3-全局演化) 是同一台引擎的三种"出片方式"：物理计算完全共用，只是**参数怎么给、循环之外多做了什么、结果怎么收**三处不同。它们共用两个构件——先把与红移无关（或能一次性算齐）的东西备好，再进入逐红移循环。下面先给这两个构件，再按「**准备 → 循环 → 收尾**」三段并排写三条流水线各自"剩下的行"（公共处写「同上」），最后是 E3 那套参数退化逐项表与一张差异对照表。

读代码前先认四个简写：`ics` / `pfs` / `halos` / `pnc` 就是**备料返回的四元组**，依次是初始条件盒、逐红移微扰场、晕场列表、光子守恒数据——**按位置取**（顺序即 `return` 语句的顺序），不要按名字猜：函数体内第 2 项叫 `perturbed_field`（单数），E2/E3 解包时叫 `perturbed_fields`（复数）。

**公共构件一：备料**（三条流水线都先调它，因此三者"不各自实现"）

```python
# _setup_ics_and_pfs_for_scrolling：进循环之前，把能提前算齐的一次性备好
if initial_conditions is None:                       # 没给现成的就现算，给了就复用
    initial_conditions = sf.compute_initial_conditions(inputs, initial_density=overdensity_z0)
if write.initial_conditions:
    initial_conditions.prepare_for_perturb()         # 卸掉后面用不到的数组

if PHOTON_CONS_TYPE != "no-photoncons":              # P16 只在这里建立一次
    photon_nonconservation_data = setup_photon_cons(inputs, initial_conditions=initial_conditions)
    if PHOTON_CONS_TYPE == "z-photoncons":           # 校准曲线有红移下限，越界直接报错
        require min(all_redshifts) >= PHOTONCONS_CALIBRATION_END

perturbed_field = []                                 # 与红移有关、但能一次算齐的第一样
for z in all_redshifts:                              # 全部红移的微扰场，先算齐
    p = sf.perturb_field(redshift=z, inputs=inputs)
    if MINIMIZE_MEMORY and write.perturbed_field:
        p.purge()                                    # 算完只留元数据，用时再 load_all()
    perturbed_field.append(p)

halofield_list = evolve_halos(inputs, all_redshifts) # 第二样：晕场列表（无离散晕时为空表）
if write.initial_conditions:
    initial_conditions.prepare_for_spin_temp()

return initial_conditions, perturbed_field, halofield_list, photon_nonconservation_data
```

**公共构件二：逐红移滚动**（三条流水线共用这个循环；循环里只做"必须逐红移做"的那一段）

```python
# _redshift_loop_generator：红移从高到低，上一快照回喂下一快照
prev = init_coeval                               # 上一快照（跨快照回喂的来源；首轮可能是 None）
hbox_arr = []                                    # 已累积的晕盒（拉格朗日型源要用整条历史）
for iz, z in enumerate(all_redshifts):           # iz = 该红移在 all_redshifts 里的下标
    this_perturbed_field = perturbed_field[iz]   # 备料早已把这份微扰场算好

    if lagrangian_source_grid:                       # 源项网格：只在拉格朗日型源下算
        this_halobox = sf.compute_halo_grid(
            redshift=z, halo_catalog=this_halofield,
            previous_ionize_box=prev.ionized_box, previous_spin_temp=prev.ts_box)

    if USE_TS_FLUCT:                                 # 热与自旋温度：开关关掉则整段跳过
        this_xraysource = sf.compute_xray_source_field(redshift=z, hboxes=[*hbox_arr, this_halobox])
        this_spin_temp = sf.compute_spin_temperature(
            perturbed_field=this_perturbed_field, xray_source_box=this_xraysource,
            previous_spin_temp=prev.ts_box, cleanup=(cleanup and z == all_redshifts[-1]))
                                                     # cleanup 只在最后一条红移上生效

    this_ionized_box = sf.compute_ionization_field(
        perturbed_field=this_perturbed_field, halobox=this_halobox, spin_temp=this_spin_temp,
        previous_ionized_box=prev.ionized_box, previous_perturbed_field=prev.perturbed_field)
                                                     # ↑ 回喂上一快照的电离盒与微扰场
    this_bt = sf.brightness_temperature(
        ionized_box=this_ionized_box, perturbed_field=this_perturbed_field, spin_temp=this_spin_temp)

    if PHOTON_CONS_TYPE == "z-photoncons":           # 校准数据逐红移刷新（曲线本身已在备料里建好）
        photon_nonconservation_data = _get_photon_nonconservation_data()

    this_coeval = Coeval(                             # 快照容器：7 个字段一次给全，构造后不再改
        initial_conditions=initial_conditions,
        perturbed_field=this_perturbed_field,
        ionized_box=this_ionized_box,
        brightness_temperature=this_bt,
        ts_box=this_spin_temp,
        halobox=this_halobox,
        photon_nonconservation_data=photon_nonconservation_data)

    if prev is not None:                             # 清理"上一快照"（当前这份留到下一轮才清）
        if HII_DIM > 1:
            prev.perturbed_field.purge()
        for hbox in hbox_arr:                        # 累积晕盒推进到下一快照（仅拉格朗日源且要落盘时）
            hbox.prepare_for_next_snapshot(next_z=all_redshifts[iz + 1])

    if z in inputs.node_redshifts:                   # 只有节点红移才成为"上一快照"并累积晕盒
        prev, hbox_arr = this_coeval, [*hbox_arr, this_halobox]
                                                     # 用户额外要的输出红移不更新 prev，不污染回喂链

    yield iz, this_coeval                            # 先交出结果：它的清理发生在下一轮开头
```

三条流水线**围绕这两个构件**的差别，各自只剩下面三段；三段行序一致（准备 / 循环 / 收尾），公共处写「同上」。

**E1 联合演化盒**

```python
# 准备：同上（备料照原样参数走一遍；initial_conditions 可由用户注入）
# 循环：共用逐红移循环——这条不需要 iz，直接丢掉
for _, coeval in _redshift_loop_generator(all_redshifts=all_redshifts, ...):
    # 收尾：逐个红移交出，同时告诉调用方"这是不是选定的红移"
    yield coeval, coeval.redshift in out_redshifts      # → P11 演化快照
```

**E2 光锥**

```python
# 准备：同上；备料实参是 all_redshifts=inputs.node_redshifts
# 循环 + 收尾：把同一个逐红移循环交给光锥消费者包裹——循环体在它内部，此处不展开
yield from _run_lightcone_from_perturbed_fields(...)     # → P12 光锥
# 消费者内部做两件事：
#   · 逐红移按几何取采样点、沿视线写进光锥（盒 → 观测形态）
#   · 循环结束后（可选）再修两项视线方向效应：
#       视线速度梯度修正 include_dvdr_in_tau21、红移空间畸变 apply_rsds（配 n_rsd_subcells）
```

**E3 全局演化**

```python
# 准备①：先把整套参数换成一个"单格"版本——注意这是新对象，不是就地修改
inputs_one_cell = inputs.evolve_input_structs(
    DIM=1, HII_DIM=1, BOX_LEN=1e6, PERTURB_ALGORITHM="LINEAR",
    PHOTON_CONS_TYPE="no-photoncons", ...)               # 共 13 项，逐项理由见下表
# 准备②：备料用单格参数，且强制自算初始条件、不读也不写缓存
ics, pfs, halos, pnc = _setup_ics_and_pfs_for_scrolling(
    inputs_one_cell, all_redshifts=inputs_one_cell.node_redshifts,
    initial_conditions=None, write=CacheConfig.off(),
    overdensity_z0=overdensity_z0)
# 循环：同一个逐红移循环；起点快照由上一轮喂进来（断点续算也走这条）
for iz, coeval in _redshift_loop_generator(
        inputs_one_cell, all_redshifts=inputs_one_cell.node_redshifts,
        write=CacheConfig.off(), cleanup=True, init_coeval=prev_coeval, ...):
    # 收尾：不收盒，而是逐量取"盒均值"写进一维曲线
    for q in global_evolution.quantities:      # 按量名建好的数组，长度 = 节点红移数
        global_evolution.quantities[q][iz] = np.mean(getattr(coeval, q))
                                               # iz = 节点红移下标；单格下"盒均值"就是那一格的值
    prev_coeval = coeval                       # 当前快照喂给下一轮，做跨快照回喂
                                               # → P13 全局演化历史
```

**E3 那 13 项参数改写，逐项的理由**（每一条都落在同一个原因上：**只剩一格**）

| 改写项 | 改成什么 | 为什么 |
| :--- | :--- | :--- |
| `HIRES_TO_LOWRES_FACTOR` | `None` | 单格下高、低分辨率同尺寸，这个因子无处可用，显式关掉 |
| `DIM` | `1` | 只要一格 |
| `HII_DIM` | `1` | 同上 |
| `BOX_LEN` | `1e6` | 让"一格代表整个宇宙"，避免与盒长相关的换算退化 |
| `SOURCE_MODEL` | 入参或参数里给出的值 | 单格没有晕目录，故只允许三类无离散晕源模型，否则直接报错 |
| `PERTURB_ALGORITHM` | `"LINEAR"` | 一格无法做位移，二阶扰动无意义 |
| `USE_INTERPOLATION_TABLES` | `"sigma-interpolation"` | 只需方差插值表；积分每快照只做一次，不必预建质量函数积分表 |
| `INTEGRATION_METHOD_ATOMIC` | `"GSL-QAG"` | 正因为不再预建积分表，积分必须走通用求积（源码注释自标存疑） |
| `INTEGRATION_METHOD_MINI` | `"GSL-QAG"` | 同上 |
| `USE_UPPER_STELLAR_TURNOVER` | `False` | 无离散晕时不启用恒星质量上限转折 |
| `USE_EXP_FILTER` | `False` | 不跑经典再电离模块（没有气泡），指数滤波只服务那个模块 |
| `KEEP_3D_VELOCITIES` | `False` | 全局量不需要速度场 |
| `PHOTON_CONS_TYPE` | `"no-photoncons"` | 光子守恒校正是修游程集算法的非守恒误差，这里没有游程集 |

**三条流水线的差异，逐维对照**

| 维度 | [E1 联合演化盒](#e1-联合演化盒) | [E2 光锥](#e2-光锥) | [E3 全局演化](#e3-全局演化) |
| :--- | :--- | :--- | :--- |
| 参数怎么给 | 原样用用户参数 | 原样，另加几何与畸变选项 | 先换成一整套单格版本（13 项，见上表） |
| 备料实参 | `all_redshifts` = 推进用的全部红移；`initial_conditions` 可注入 | `all_redshifts=inputs.node_redshifts`；`initial_conditions` 可注入 | `all_redshifts=inputs_one_cell.node_redshifts`；`initial_conditions=None`（强制自算）；`write=CacheConfig.off()`；另传 `overdensity_z0` |
| 循环实参 | `all_redshifts=all_redshifts`；起点快照按断点重建 | 同一个循环，但由光锥消费者调用；起点按光锥断点续算 | `all_redshifts=inputs_one_cell.node_redshifts`；`write=CacheConfig.off()`；`cleanup=True` |
| 循环中的额外动作 | 无 | 逐红移取几何采样点写进光锥；循环结束后可选两项视线修正 | 无 |
| 收尾动作 | 逐红移交出 `(盒, 是否选定)` | 交出光锥对象（另含按红移的均值） | 逐量写 `quantities[q][iz] = np.mean(...)` |
| 产出 | [P11 演化快照](#p11-演化快照) | [P12 光锥](#p12-光锥) | [P13 全局演化历史](#p13-全局演化历史) |

三条都是编排：**物理都在 [E4 单场直算](#e4-单场直算) 的九个单场入口里**，本节只出现"谁在什么顺序上调用谁"。这条对照里出现的新符号名，是 [CONVENTIONS](CONVENTIONS.md) §3.3 对该节**显式枚举**的例外（其余正文仍按原纯度要求）。

**数据流：对象在谁手里**

把上面两块构件与三段收尾连起来看，**数据只沿一条装配线走一次**；箭头是"交给谁"，括注是"就地改内存"（内存管理，与物理无关）。

```
InputParameters / CacheConfig（只读，沿线到处传）
        │
        ▼
   备料：_setup_ics_and_pfs_for_scrolling
        ├─ InitialConditions        复用传入的，或现算；就地 prepare_for_perturb / prepare_for_spin_temp
        ├─ list[PerturbedField]     逐红移算齐；就地 purge
        ├─ list[HaloCatalog]        evolve_halos 产出
        └─ 光子守恒校准数据 dict
        │（返回四元组，按位置解包）
        ▼
   逐红移循环：_redshift_loop_generator
        HaloBox        ← 上一快照的 IonizedBox、TsBox       （仅拉格朗日型源）
        XraySourceBox  ← 迄今累积的全部晕盒                  （仅开启自旋温度涨落）
        TsBox          ← 上一快照的 TsBox
        IonizedBox     ← 上一快照的 IonizedBox、PerturbedField
        BrightnessTemp
        │
        ▼
      Coeval（把 InitialConditions 与上述各场、校准数据一起挂上；构造后不再改）
        │ yield（下标, 快照）
        ├─ E1 原样转交 ──────────────▶ list[Coeval]     → P11 演化快照
        ├─ E2 切片 + 逐红移取均值 ───▶ LightCone        → P12 光锥
        └─ E3 逐量取盒均值 ─────────▶ GlobalEvolution  → P13 全局演化历史
```

**`Coeval` 的每个字段由谁给**——这正是"它构造后不再被改"的原因：7 个字段在构造时一次给全。

| `Coeval` 的字段 | 由谁给 |
| :--- | :--- |
| `initial_conditions` | 备料返回的第 1 项（同一个对象，原样传下来） |
| `perturbed_field` | 备料返回的第 2 项按红移取——这就是"备料为什么先把全部红移算齐" |
| `halobox` | 循环里由 `HaloCatalog` 与上一快照算出 |
| `ts_box` | 循环里算（吃上一快照的 `TsBox`） |
| `ionized_box` | 循环里算（吃上一快照的 `IonizedBox` 与 `PerturbedField`） |
| `brightness_temperature` | 循环里算 |
| `photon_nonconservation_data` | 备料返回的第 4 项（逐红移刷新只重新绑定局部量，不改快照） |

**三个出口容器**：E1 交出快照列表、E2 交出光锥（另含逐红移均值）、E3 交出一维曲线——装配线完全共用，三条的差别只有"喂进去的参数"与"接出来怎么装箱"两处。

**读这段时抓住四件事**：

1. **类型只装数据，函数只搬数据**：全流程没有继承与多态；所有分支都来自 `InputParameters` / `CacheConfig` 里的开关（光子守恒类型、自旋温度涨落、源模型、内存最小化、是否落盘）。
2. **`InitialConditions` 是唯一的共享底座**：只建一次，被每一份 `PerturbedField` 消费，也被一路挂进每个 `Coeval`；它不被复制，只被反复"卸内存"。
3. **唯一的"状态"是上一快照**：`HaloBox`、`TsBox`、`IonizedBox` 都吃它，而只有节点红移才更新它——用户额外点名的输出红移不会污染这条回喂链。
4. **`purge` 与 `prepare_for_*` 是内存管理，不是物理**：它们只决定"哪些数组还留在内存里"，不改物理内容——别误读成数据被改写。

## 2. 产物依赖与推进顺序

**一次性准备（不随红移重复）**

```
P01 输入参数集 ──▶ P02 初始条件 ──┬──▶ P03 微扰场
                                  ├──▶ P04 晕目录 ──▶ P05 微扰晕目录
                                  │                     （旁支：主链不消费，仅 E4 显式调用时产生）
                                  └──▶ P16 光子守恒校准曲线
                                                        （仅启用光子守恒时；由 E1 / E2 在 P02 之后、红移循环之前建立一次）
```

P16 光子守恒校准曲线的**建立**也归在这一步：一次、不随红移重复，且没有独立的对外入口——它发生在 [E1 联合演化盒](#e1-联合演化盒) 与 [E2 光锥](#e2-光锥) 的公共准备阶段内部；[E7 离线与旁路](#e7-离线与旁路) 另把这条建立路径作为公开符号单独暴露，因此「E7 直接产出」与「E1 / E2 经由内部编排产出」同时成立。
它的**读取**在下面「旁路回灌」里，每个红移一次——[§1.2](#12-产物矩阵) 给 E1 / E2 记 `◐`（产出与消费兼具）即由此而来。是否走这一步取决于光子守恒开关，取值不在本层展开（同 §1.2 末行）。

**逐红移推进（以下每个红移各一份，沿红移递减方向推进）**

```
P03 微扰场 ─────────────────────────────┐
                                        ├──▶ P09 电离盒 ──▶ P10 亮温盒 ──┬──▶ P11 演化快照
P04 晕目录 ──▶ P06 源项网格 ──▶ P07 X 射线源箱 ──▶ P08 自旋温度盒 ──┴──▶ P09 电离盒            └──▶ P12 光锥
P08 自旋温度盒 ─────────────────────────────────────────▶ P10 亮温盒
```

**旁路回灌**

```
P17 宇宙学查表 ──▶ 并入 P01
P16 光子守恒校准曲线 ──▶ 被 E1 / E2 在每个红移读取
```

（同一产物的多份实例由"红移"区分；本层不出现红移之外的下标细节。）

## 3. 入口

### E1 联合演化盒

- **公开符号**：`Coeval` / `generate_coeval` / `run_coeval`
- **代码位置**：`drivers/coeval.py` 的 `Coeval` / `generate_coeval` / `run_coeval`（E 的公开符号都经 `__init__.py` 再导出，此处提一次）
- **消费产物**：[P01 输入参数集](#p01-输入参数集)、[P16 光子守恒校准曲线](#p16-光子守恒校准曲线)
- **产出产物**：**直接产出** [P11 演化快照](#p11-演化快照)；**经由内部编排**（内部调用 [E4 单场直算](#e4-单场直算) 的各单场入口）得到 [P02 初始条件](#p02-初始条件) … [P10 亮温盒](#p10-亮温盒)，并在建好 [P02 初始条件](#p02-初始条件) 后触发 [P16 光子守恒校准曲线](#p16-光子守恒校准曲线) 的建立
- **作用与意义**：**时间流水线**——一次运行沿红移拿到主链的整套产物，并汇成 [P11 演化快照](#p11-演化快照)；与 [E2](#e2-光锥)、[E3](#e3-全局演化) 互为替代，三者都建立在 [E4](#e4-单场直算) 之上（详见 [§1.1](#11-七个入口不是并列的)）；三者逐行对照见 [§1.3](#13-三条时间流水线的伪代码对照)。

### E2 光锥

- **公开符号**：`LightCone` / `generate_lightcone` / `run_lightcone` / `AngularLightconer` / `RectilinearLightconer`
- **代码位置**：`drivers/lightcone.py` 的 `LightCone` / `generate_lightcone` / `run_lightcone`；`lightconers.py` 的 `RectilinearLightconer` / `AngularLightconer`
- **消费产物**：[P01 输入参数集](#p01-输入参数集)、[P16 光子守恒校准曲线](#p16-光子守恒校准曲线)
- **产出产物**：**直接产出** [P12 光锥](#p12-光锥)；**经由内部编排**（内部调用 [E4 单场直算](#e4-单场直算) 的各单场入口）得到 [P02 初始条件](#p02-初始条件) … [P10 亮温盒](#p10-亮温盒)，同样在建好 [P02 初始条件](#p02-初始条件) 后触发 [P16 光子守恒校准曲线](#p16-光子守恒校准曲线) 的建立
- **作用与意义**：**时间流水线**——与 [E1](#e1-联合演化盒) 同一套推进，差别只在把每个红移的盒沿视线切片拼成 [P12 光锥](#p12-光锥)，并在末端做一次视线方向的速度位移；与 [E1](#e1-联合演化盒)、[E3](#e3-全局演化) 的逐行对照见 [§1.3](#13-三条时间流水线的伪代码对照)。

### E3 全局演化

- **公开符号**：`GlobalEvolution` / `run_global_evolution`
- **代码位置**：`drivers/global_evolution.py` 的 `GlobalEvolution` / `run_global_evolution`
- **消费产物**：[P01 输入参数集](#p01-输入参数集)
- **产出产物**：**直接产出** [P13 全局演化历史](#p13-全局演化历史)；**经由内部编排**（内部调用 [E4 单场直算](#e4-单场直算) 的各单场入口）得到 [P02 初始条件](#p02-初始条件) … [P10 亮温盒](#p10-亮温盒) 的**单格退化形态**
- **作用与意义**：**时间流水线（退化）**——把参数压成单格后复用 [E1](#e1-联合演化盒) 的推进，把各产物取均值汇成 [P13 全局演化历史](#p13-全局演化历史)；运行时缓存被显式关闭，因此与 [E6](#e6-持久化与读取) 不相交；与 [E1](#e1-联合演化盒)、[E2](#e2-光锥) 的逐行对照见 [§1.3](#13-三条时间流水线的伪代码对照)。

### E4 单场直算

- **公开符号**：`compute_initial_conditions` / `perturb_field` / `determine_halo_catalog` / `perturb_halo_catalog` / `compute_halo_grid` / `compute_xray_source_field` / `compute_spin_temperature` / `compute_ionization_field` / `brightness_temperature`
- **代码位置**：`drivers/single_field.py` 的 `compute_initial_conditions` / `perturb_field` / `determine_halo_catalog` / `perturb_halo_catalog` / `compute_halo_grid` / `compute_xray_source_field` / `compute_spin_temperature` / `compute_ionization_field` / `brightness_temperature`
- **消费产物**：[P01 输入参数集](#p01-输入参数集)，以及每个入口各自需要的上游产物（见 [L1 阶段](L1-stages.md)）
- **产出产物**：**全部直接产出** [P02 初始条件](#p02-初始条件) … [P10 亮温盒](#p10-亮温盒)（每一种产物的直接产出者都只有本入口；**P05 微扰晕目录**尤其只由本入口产出）
- **作用与意义**：**底层直算**——主链每种产物的唯一直接产出者，是时间流水线三者的下一层；自己对用户也公开，可单独调用以自行编排红移顺序。

### E5 参数装配与模板

- **公开符号**：`InputParameters` / `create_params_from_template` / `list_templates` / `write_template` / `config`
- **代码位置**：`wrapper/inputs.py` 的 `InputParameters`；`_templates.py` 的 `create_params_from_template` / `list_templates` / `write_template`；`_cfg.py` 的 `Config`
- **消费产物**：无（输入来自模板文件与调用参数）
- **产出产物**：**直接产出** [P01 输入参数集](#p01-输入参数集)
- **作用与意义**：**前置装配**——所有其它入口唯一的参数来源，产出 [P01 输入参数集](#p01-输入参数集)；先于全部入口，并接收 [E7](#e7-离线与旁路) 并入的 [P17 宇宙学查表](#p17-宇宙学查表)。

### E6 持久化与读取

- **公开符号**：`write_output_to_hdf5` / `read_output_struct` / `read_inputs` / `RunCache` / `OutputCache` / `CacheConfig`
- **代码位置**：`io/h5.py` 的 `write_output_to_hdf5` / `read_output_struct` / `read_inputs`；`io/caching.py` 的 `RunCache` / `OutputCache` / `CacheConfig`
- **消费产物**：[P01 输入参数集](#p01-输入参数集) … [P13 全局演化历史](#p13-全局演化历史)（用于落盘与回读）
- **产出产物**：无新的逻辑产物；产出的是磁盘上的副本与"哪些产物已存在"的清单
- **作用与意义**：**横切设施**——不推进主链，只把产物写成磁盘副本并在重跑时回读，因此它出现在矩阵的几乎每一行；[E3](#e3-全局演化) 运行时关闭缓存，不经过它。

### E7 离线与旁路

- **公开符号**：`compute_luminosity_function` / `compute_tau` / `compute_rms` / `run_classy` / `construct_fftw_wisdoms` / `setup_photon_cons`
- **代码位置**：`wrapper/cfuncs.py` 的 `compute_luminosity_function` / `compute_tau` / `construct_fftw_wisdoms`；`wrapper/classy_interface.py` 的 `run_classy` / `compute_rms`；`wrapper/photoncons.py` 的 `setup_photon_cons`
- **消费产物**：[P01 输入参数集](#p01-输入参数集)，以及 [P09 电离盒](#p09-电离盒) 的全局序列（用于产出 [P15 再电离光学深度](#p15-再电离光学深度)）
- **产出产物**：**直接产出** [P14 光度函数诊断](#p14-光度函数诊断)、[P15 再电离光学深度](#p15-再电离光学深度)、[P16 光子守恒校准曲线](#p16-光子守恒校准曲线)、[P17 宇宙学查表](#p17-宇宙学查表)；落盘缓存类操作不产生逻辑产物
- **作用与意义**：**旁路回灌**——不推进主链；[P14](#p14-光度函数诊断)、[P15](#p15-再电离光学深度) 到此为止，[P16 光子守恒校准曲线](#p16-光子守恒校准曲线) 回灌 [E1](#e1-联合演化盒)/[E2](#e2-光锥)，[P17 宇宙学查表](#p17-宇宙学查表) 前置交给 [E5](#e5-参数装配与模板)。

## 4. 产物

> 「由谁产出」区分**直接产出者**与**经由内部编排**的入口（记号含义见 [§1.2 图例](#12-产物矩阵)）；「由谁消费」显式列出入口，"内部编排"指该产物所在的那套编排层。落盘与回读由 [E6 持久化与读取](#e6-持久化与读取) 承担（矩阵里记为 `◐`），本节不逐条重复；唯一例外是 [E3 全局演化](#e3-全局演化)——它运行时关闭缓存，不落盘。本节每个产物第一行都给出它**在本层的作用与意义**。

### P01 输入参数集

- **作用与意义**：主链的入口条件——一切后续产物都由它派生，改它等于改整次运行。
- **载体**：`InputParameters`（六个子结构：`CosmoParams` / `SimulationOptions` / `MatterOptions` / `AstroOptions` / `AstroParams` / `CosmoTables`，外加随机种子与红移网格）
- **代码位置**：载体 `wrapper/inputs.py` 的 `InputParameters`（`CosmoParams` / `SimulationOptions` / `MatterOptions` / `AstroOptions` / `AstroParams` / `CosmoTables`）；C 侧结构声明 `src/_inputparams_wrapper.h`
- **由谁产出**：**直接产出者**：[E5 参数装配与模板](#e5-参数装配与模板)（[P17 宇宙学查表](#p17-宇宙学查表) 由 [E7 离线与旁路](#e7-离线与旁路) 并入）
- **由谁消费**：全部入口（[E1](#e1-联合演化盒)–[E7](#e7-离线与旁路)），并随产物被 [E6 持久化与读取](#e6-持久化与读取) 落盘与回读
- **下游产物**：主链上的一切（P02 起）

### P02 初始条件

- **作用与意义**：主链的起点：一次备好、被后续所有红移复用；随机性由它的种子固定。
- **载体**：`InitialConditions`
- **代码位置**：载体 `wrapper/outputs.py` 的 `InitialConditions`；生产入口 `src/InitialConditions.c` 的 `ComputeInitialConditions`
- **由谁产出**：**直接产出者**（唯一）：[E4 单场直算](#e4-单场直算)；**经由内部编排**：[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)
- **由谁消费**：[E4 单场直算](#e4-单场直算)（用于产出 [P03 微扰场](#p03-微扰场)、[P04 晕目录](#p04-晕目录)）；[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)（内部编排）
- **下游产物**：[P03 微扰场](#p03-微扰场)、[P04 晕目录](#p04-晕目录)

### P03 微扰场

- **作用与意义**：把初始场推进到目标红移，是电离与亮温两类产物的共同输入之一。
- **载体**：`PerturbedField`
- **代码位置**：载体 `wrapper/outputs.py` 的 `PerturbedField`；生产入口 `src/PerturbedField.c` 的 `ComputePerturbedField`
- **由谁产出**：**直接产出者**（唯一）：[E4 单场直算](#e4-单场直算)；**经由内部编排**：[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)
- **由谁消费**：[E4 单场直算](#e4-单场直算)（用于产出 [P09 电离盒](#p09-电离盒)、[P10 亮温盒](#p10-亮温盒)）；[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)（内部编排）
- **下游产物**：[P09 电离盒](#p09-电离盒)、[P10 亮温盒](#p10-亮温盒)

### P04 晕目录

- **作用与意义**：离散晕的唯一来源——只有它存在，源项网格才会逐晕累加地填出来。
- **载体**：`HaloCatalog`
- **代码位置**：载体 `wrapper/outputs.py` 的 `HaloCatalog`；生产入口 `src/HaloCatalog.c` 的 `ComputeHaloCatalog`
- **由谁产出**：**直接产出者**（唯一）：[E4 单场直算](#e4-单场直算)；**经由内部编排**：[E1](#e1-联合演化盒)、[E2](#e2-光锥)
- **由谁消费**：[E4 单场直算](#e4-单场直算)（用于产出 [P05 微扰晕目录](#p05-微扰晕目录)、[P06 源项网格](#p06-源项网格)）；[E1](#e1-联合演化盒)、[E2](#e2-光锥)（内部编排）
- **下游产物**：[P05 微扰晕目录](#p05-微扰晕目录)、[P06 源项网格](#p06-源项网格)

### P05 微扰晕目录

- **作用与意义**：旁支产物：主链不消费，供外部检查晕经速度位移后的坐标与属性。
- **载体**：`PerturbedHaloCatalog`
- **代码位置**：载体 `wrapper/outputs.py` 的 `PerturbedHaloCatalog`；生产入口 `src/PerturbedHaloCatalog.c` 的 `ComputePerturbedHaloCatalog`
- **由谁产出**：**直接产出者**（唯一）：[E4 单场直算](#e4-单场直算)；无经由内部编排的入口
- **由谁消费**：无（当前主链不消费；作为独立可取的中间产物供外部使用）
- **下游产物**：无

### P06 源项网格

- **作用与意义**：把晕折算成网格上的源项，是电离与 X 射线两条路的共同输入。
- **载体**：`HaloBox`
- **代码位置**：载体 `wrapper/outputs.py` 的 `HaloBox`；生产入口 `src/HaloBox.c` 的 `ComputeHaloBox`
- **由谁产出**：**直接产出者**（唯一）：[E4 单场直算](#e4-单场直算)；**经由内部编排**：[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)
- **由谁消费**：[E4 单场直算](#e4-单场直算)（用于产出 [P07 X 射线源箱](#p07-x-射线源箱)、[P09 电离盒](#p09-电离盒)）；[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)（内部编排）
- **下游产物**：[P07 X 射线源箱](#p07-x-射线源箱)、[P09 电离盒](#p09-电离盒)

### P07 X 射线源箱

- **作用与意义**：自旋温度阶段的多尺度源场：把源项按环状壳层预先滤波，避免逐格点重复积分。
- **载体**：`XraySourceBox`
- **代码位置**：载体 `wrapper/outputs.py` 的 `XraySourceBox`；生产入口 `src/SpinTemperatureBox.c` 的 `UpdateXraySourceBox`
- **由谁产出**：**直接产出者**（唯一）：[E4 单场直算](#e4-单场直算)；**经由内部编排**：[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)
- **由谁消费**：[E4 单场直算](#e4-单场直算)（用于产出 [P08 自旋温度盒](#p08-自旋温度盒)）；[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)（内部编排）
- **下游产物**：[P08 自旋温度盒](#p08-自旋温度盒)

### P08 自旋温度盒

- **作用与意义**：热与自旋温度阶段的输出：既是电离箱的输入，也直接改写亮温。
- **载体**：`TsBox`
- **代码位置**：载体 `wrapper/outputs.py` 的 `TsBox`；生产入口 `src/SpinTemperatureBox.c` 的 `ComputeTsBox`
- **由谁产出**：**直接产出者**（唯一）：[E4 单场直算](#e4-单场直算)；**经由内部编排**：[E1 联合演化盒](#e1-联合演化盒)、[E2 光锥](#e2-光锥)、[E3 全局演化](#e3-全局演化)
- **由谁消费**：[E4 单场直算](#e4-单场直算)（用于产出 [P05 微扰晕目录](#p05-微扰晕目录)、[P09 电离盒](#p09-电离盒)、[P10 亮温盒](#p10-亮温盒)）；[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)（内部编排）
- **下游产物**：[P09 电离盒](#p09-电离盒)、[P10 亮温盒](#p10-亮温盒)

### P09 电离盒

- **作用与意义**：电离场的载体——中性分数与电离历史都在这里，亮温与光学深度由它派生。
- **载体**：`IonizedBox`
- **代码位置**：载体 `wrapper/outputs.py` 的 `IonizedBox`；生产入口 `src/IonisationBox.c` 的 `ComputeIonizedBox`
- **由谁产出**：**直接产出者**（唯一）：[E4 单场直算](#e4-单场直算)；**经由内部编排**：[E1 联合演化盒](#e1-联合演化盒)、[E2 光锥](#e2-光锥)、[E3 全局演化](#e3-全局演化)
- **由谁消费**：[E4 单场直算](#e4-单场直算)（用于产出 [P10 亮温盒](#p10-亮温盒)）；[E7 离线与旁路](#e7-离线与旁路)（用于产出 [P15 再电离光学深度](#p15-再电离光学深度)，需要本产物的全局序列）；[E1](#e1-联合演化盒)、[E2](#e2-光锥)、[E3](#e3-全局演化)（内部编排）
- **下游产物**：[P10 亮温盒](#p10-亮温盒)、[P15 再电离光学深度](#p15-再电离光学深度)

### P10 亮温盒

- **作用与意义**：主链的终点：三条流水线都在此分岔成快照、光锥与全局历史。
- **载体**：`BrightnessTemp`
- **代码位置**：载体 `wrapper/outputs.py` 的 `BrightnessTemp`；生产入口 `src/BrightnessTemperatureBox.c` 的 `ComputeBrightnessTemp`
- **由谁产出**：**直接产出者**（唯一）：[E4 单场直算](#e4-单场直算)；**经由内部编排**：[E1 联合演化盒](#e1-联合演化盒)、[E2 光锥](#e2-光锥)、[E3 全局演化](#e3-全局演化)
- **由谁消费**：[E1 联合演化盒](#e1-联合演化盒)（聚合成 [P11 演化快照](#p11-演化快照)）、[E2 光锥](#e2-光锥)（切片拼成 [P12 光锥](#p12-光锥)）、[E3 全局演化](#e3-全局演化)（取均值汇入 [P13 全局演化历史](#p13-全局演化历史)）
- **下游产物**：[P11 演化快照](#p11-演化快照)、[P12 光锥](#p12-光锥)

### P11 演化快照

- **作用与意义**：联合演化盒的聚合形态，终态产物，不再进入任何其它产物。
- **载体**：`Coeval`
- **代码位置**：载体 `drivers/coeval.py` 的 `Coeval`；后端生产者 —（纯 Python 聚合）
- **由谁产出**：[E1 联合演化盒](#e1-联合演化盒)
- **由谁消费**：调用者（经 [E6 持久化与读取](#e6-持久化与读取) 落盘）
- **下游产物**：无

### P12 光锥

- **作用与意义**：光锥的聚合形态，终态产物；也是唯一带视线切片的产物。
- **载体**：`LightCone`
- **代码位置**：载体 `drivers/lightcone.py` 的 `LightCone`；后端生产者 —（纯 Python 聚合）
- **由谁产出**：[E2 光锥](#e2-光锥)
- **由谁消费**：调用者（经 [E6 持久化与读取](#e6-持久化与读取) 落盘）
- **下游产物**：无

### P13 全局演化历史

- **作用与意义**：全局演化的聚合形态：零维的红移历史曲线。
- **载体**：`GlobalEvolution`
- **代码位置**：载体 `drivers/global_evolution.py` 的 `GlobalEvolution`；后端生产者 —（纯 Python 聚合）
- **由谁产出**：[E3 全局演化](#e3-全局演化)
- **由谁消费**：调用者（经 [E6 持久化与读取](#e6-持久化与读取) 落盘）
- **下游产物**：无

### P14 光度函数诊断

- **作用与意义**：旁路诊断：在质量–红移网格上给出光度函数，不参与主链。
- **载体**：三元组 `(Muvfunc, Mhfunc, lfunc)`
- **代码位置**：接口 `wrapper/cfuncs.py` 的 `compute_luminosity_function`；生产入口 `src/LuminosityFunction.c` 的 `ComputeLF`
- **由谁产出**：[E7 离线与旁路](#e7-离线与旁路)
- **由谁消费**：调用者
- **下游产物**：无

### P15 再电离光学深度

- **作用与意义**：旁路产物：由电离历史的全局序列积分得到的光学深度。
- **载体**：标量 τ
- **代码位置**：接口 `wrapper/cfuncs.py` 的 `compute_tau`；生产入口 `src/thermochem.c` 的 `ComputeTau`
- **由谁产出**：[E7 离线与旁路](#e7-离线与旁路)
- **由谁消费**：调用者
- **下游产物**：无

### P16 光子守恒校准曲线

- **作用与意义**：唯一回灌主链的产物：它改变的不是某个盒，而是后续红移推进时读取的输入。
- **载体**：后端全局校准状态（全局电离历史及其对应的红移偏移、逃逸分数拟合、修正参数）
- **代码位置**：接口 `wrapper/photoncons.py` 的 `setup_photon_cons`；生产入口 `src/photoncons.c` 的 `InitialisePhotonCons` / `PhotonCons_Calibration` / `adjust_redshifts_for_photoncons`
- **由谁产出**：**直接产出者**（唯一）：[E7 离线与旁路](#e7-离线与旁路)；**经由内部编排**：[E1](#e1-联合演化盒)、[E2](#e2-光锥)（在建好 [P02 初始条件](#p02-初始条件) 后触发同一件事）
- **由谁消费**：[E1 联合演化盒](#e1-联合演化盒)、[E2 光锥](#e2-光锥)（每个红移读取）
- **下游产物**：无（它改变的是红移推进时被读取的输入）

### P17 宇宙学查表

- **作用与意义**：外部宇宙学表：并入 P01 后即不再单独出现。
- **载体**：`CosmoTables`（外部玻尔兹曼码给出的传输函数表）
- **代码位置**：载体 `wrapper/inputs.py` 的 `CosmoTables`；提供者 `wrapper/classy_interface.py` 的 `run_classy` / `get_transfer_function`
- **由谁产出**：[E7 离线与旁路](#e7-离线与旁路)
- **由谁消费**：[E5 参数装配与模板](#e5-参数装配与模板)（并入 [P01 输入参数集](#p01-输入参数集)）
- **下游产物**：[P01 输入参数集](#p01-输入参数集)

## 5. 代码位置速查表

路径已省略公共前缀 `src/py21cmfast/`（C 端因此写作 `src/IonisationBox.c`）；点击即到源码。位置一律**不给行号**，以免随代码改动过期。

`_inputparams_wrapper.h` 与 `_outputstructs_wrapper.h` 是两类结构的**统一声明处**（前者为参数结构，后者为输出结构）：P02–P10 的 C 结构声明都以后者为准，故不在每行重复；`_inputparams_wrapper.h` 只在 P01 行写出。

| 编号                        | 名称             | 文件                                                                                                                                                                                                                                    | 符号                                                                                                                                                                                                                                                          |
| :-------------------------- | :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [E1](#e1-联合演化盒)         | 联合演化盒       | [`drivers/coeval.py`](../../../src/py21cmfast/drivers/coeval.py) · [`__init__.py`](../../../src/py21cmfast/__init__.py)                                                                                                              | `Coeval` / `generate_coeval` / `run_coeval`                                                                                                                                                                                                             |
| [E2](#e2-光锥)               | 光锥             | [`drivers/lightcone.py`](../../../src/py21cmfast/drivers/lightcone.py) · [`lightconers.py`](../../../src/py21cmfast/lightconers.py)                                                                                                  | `LightCone` / `generate_lightcone` / `run_lightcone`；`RectilinearLightconer` / `AngularLightconer`                                                                                                                                                 |
| [E3](#e3-全局演化)           | 全局演化         | [`drivers/global_evolution.py`](../../../src/py21cmfast/drivers/global_evolution.py)                                                                                                                                                   | `GlobalEvolution` / `run_global_evolution`                                                                                                                                                                                                                |
| [E4](#e4-单场直算)           | 单场直算         | [`drivers/single_field.py`](../../../src/py21cmfast/drivers/single_field.py)                                                                                                                                                           | `compute_initial_conditions` / `perturb_field` / `determine_halo_catalog` / `perturb_halo_catalog` / `compute_halo_grid` / `compute_xray_source_field` / `compute_spin_temperature` / `compute_ionization_field` / `brightness_temperature` |
| [E5](#e5-参数装配与模板)     | 参数装配与模板   | [`wrapper/inputs.py`](../../../src/py21cmfast/wrapper/inputs.py) · [`_templates.py`](../../../src/py21cmfast/_templates.py) · [`_cfg.py`](../../../src/py21cmfast/_cfg.py)                                                         | `InputParameters`；`create_params_from_template` / `list_templates` / `write_template`；`Config`                                                                                                                                                    |
| [E6](#e6-持久化与读取)       | 持久化与读取     | [`io/h5.py`](../../../src/py21cmfast/io/h5.py) · [`io/caching.py`](../../../src/py21cmfast/io/caching.py)                                                                                                                            | `write_output_to_hdf5` / `read_output_struct` / `read_inputs`；`RunCache` / `OutputCache` / `CacheConfig`                                                                                                                                         |
| [E7](#e7-离线与旁路)         | 离线与旁路       | [`wrapper/cfuncs.py`](../../../src/py21cmfast/wrapper/cfuncs.py) · [`wrapper/classy_interface.py`](../../../src/py21cmfast/wrapper/classy_interface.py) · [`wrapper/photoncons.py`](../../../src/py21cmfast/wrapper/photoncons.py) | `compute_luminosity_function` / `compute_tau` / `construct_fftw_wisdoms`；`run_classy` / `compute_rms`；`setup_photon_cons`                                                                                                                       |
| [P01](#p01-输入参数集)       | 输入参数集       | [`wrapper/inputs.py`](../../../src/py21cmfast/wrapper/inputs.py) · [`src/_inputparams_wrapper.h`](../../../src/py21cmfast/src/_inputparams_wrapper.h)                                                                                | `InputParameters`；`CosmoParams` / `SimulationOptions` / `MatterOptions` / `AstroOptions` / `AstroParams` / `CosmoTables`                                                                                                                       |
| [P02](#p02-初始条件)         | 初始条件         | [`wrapper/outputs.py`](../../../src/py21cmfast/wrapper/outputs.py) · [`src/InitialConditions.c`](../../../src/py21cmfast/src/InitialConditions.c)                                                                                    | `InitialConditions`；`ComputeInitialConditions`                                                                                                                                                                                                           |
| [P03](#p03-微扰场)           | 微扰场           | [`wrapper/outputs.py`](../../../src/py21cmfast/wrapper/outputs.py) · [`src/PerturbedField.c`](../../../src/py21cmfast/src/PerturbedField.c)                                                                                          | `PerturbedField`；`ComputePerturbedField`                                                                                                                                                                                                                 |
| [P04](#p04-晕目录)           | 晕目录           | [`wrapper/outputs.py`](../../../src/py21cmfast/wrapper/outputs.py) · [`src/HaloCatalog.c`](../../../src/py21cmfast/src/HaloCatalog.c)                                                                                                | `HaloCatalog`；`ComputeHaloCatalog`                                                                                                                                                                                                                       |
| [P05](#p05-微扰晕目录)       | 微扰晕目录       | [`wrapper/outputs.py`](../../../src/py21cmfast/wrapper/outputs.py) · [`src/PerturbedHaloCatalog.c`](../../../src/py21cmfast/src/PerturbedHaloCatalog.c)                                                                              | `PerturbedHaloCatalog`；`ComputePerturbedHaloCatalog`                                                                                                                                                                                                     |
| [P06](#p06-源项网格)         | 源项网格         | [`wrapper/outputs.py`](../../../src/py21cmfast/wrapper/outputs.py) · [`src/HaloBox.c`](../../../src/py21cmfast/src/HaloBox.c)                                                                                                        | `HaloBox`；`ComputeHaloBox`                                                                                                                                                                                                                               |
| [P07](#p07-x-射线源箱)       | X 射线源箱       | [`wrapper/outputs.py`](../../../src/py21cmfast/wrapper/outputs.py) · [`src/SpinTemperatureBox.c`](../../../src/py21cmfast/src/SpinTemperatureBox.c)                                                                                  | `XraySourceBox`；`UpdateXraySourceBox`                                                                                                                                                                                                                    |
| [P08](#p08-自旋温度盒)       | 自旋温度盒       | [`wrapper/outputs.py`](../../../src/py21cmfast/wrapper/outputs.py) · [`src/SpinTemperatureBox.c`](../../../src/py21cmfast/src/SpinTemperatureBox.c)                                                                                  | `TsBox`；`ComputeTsBox`                                                                                                                                                                                                                                   |
| [P09](#p09-电离盒)           | 电离盒           | [`wrapper/outputs.py`](../../../src/py21cmfast/wrapper/outputs.py) · [`src/IonisationBox.c`](../../../src/py21cmfast/src/IonisationBox.c)                                                                                            | `IonizedBox`；`ComputeIonizedBox`                                                                                                                                                                                                                         |
| [P10](#p10-亮温盒)           | 亮温盒           | [`wrapper/outputs.py`](../../../src/py21cmfast/wrapper/outputs.py) · [`src/BrightnessTemperatureBox.c`](../../../src/py21cmfast/src/BrightnessTemperatureBox.c)                                                                      | `BrightnessTemp`；`ComputeBrightnessTemp`                                                                                                                                                                                                                 |
| [P11](#p11-演化快照)         | 演化快照         | [`drivers/coeval.py`](../../../src/py21cmfast/drivers/coeval.py)                                                                                                                                                                       | `Coeval`                                                                                                                                                                                                                                                    |
| [P12](#p12-光锥)             | 光锥             | [`drivers/lightcone.py`](../../../src/py21cmfast/drivers/lightcone.py)                                                                                                                                                                 | `LightCone`                                                                                                                                                                                                                                                 |
| [P13](#p13-全局演化历史)     | 全局演化历史     | [`drivers/global_evolution.py`](../../../src/py21cmfast/drivers/global_evolution.py)                                                                                                                                                   | `GlobalEvolution`                                                                                                                                                                                                                                           |
| [P14](#p14-光度函数诊断)     | 光度函数诊断     | [`wrapper/cfuncs.py`](../../../src/py21cmfast/wrapper/cfuncs.py) · [`src/LuminosityFunction.c`](../../../src/py21cmfast/src/LuminosityFunction.c)                                                                                    | `compute_luminosity_function`；`ComputeLF`                                                                                                                                                                                                                |
| [P15](#p15-再电离光学深度)   | 再电离光学深度   | [`wrapper/cfuncs.py`](../../../src/py21cmfast/wrapper/cfuncs.py) · [`src/thermochem.c`](../../../src/py21cmfast/src/thermochem.c)                                                                                                    | `compute_tau`；`ComputeTau`                                                                                                                                                                                                                               |
| [P16](#p16-光子守恒校准曲线) | 光子守恒校准曲线 | [`wrapper/photoncons.py`](../../../src/py21cmfast/wrapper/photoncons.py) · [`src/photoncons.c`](../../../src/py21cmfast/src/photoncons.c)                                                                                            | `setup_photon_cons`；`InitialisePhotonCons` / `PhotonCons_Calibration` / `adjust_redshifts_for_photoncons`                                                                                                                                            |
| [P17](#p17-宇宙学查表)       | 宇宙学查表       | [`wrapper/inputs.py`](../../../src/py21cmfast/wrapper/inputs.py) · [`wrapper/classy_interface.py`](../../../src/py21cmfast/wrapper/classy_interface.py)                                                                              | `CosmoTables`；`run_classy` / `get_transfer_function`                                                                                                                                                                                                   |

## 6. 下一层

本层到此为止：以上入口与产物**各自的逐层拆解**，见 [L1 阶段](L1-stages.md)。
