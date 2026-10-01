# L3 · 计算单元

> **什么时候看这一页**：要动代码、要按函数名定位文件的时候（本页 137 个条目，是五份文件里最厚的）。
> 读法总览见 [README](README.md)｜按问题查见 [INDEX](INDEX.md)｜维护规则见 [CONVENTIONS](CONVENTIONS.md) §3.3。
>
> 本层只有一个概念：**计算单元**（`Snn.m.k`）——承担某个子过程的函数、方法或文件。
> 本层**才**允许出现代码符号与文件路径；本层不写关键公式与变量取值（见 L4），也不回头解释上层编排。
>
> 每个子过程一个小节（`### Snn.m`，供上层跳转），其下每个计算单元一个小节（`### Snn.m.k`）。行号一律省略以免过期，只给函数/文件归属。
>
> **按阶段跳**：[S01](#s01-参数装配与模板)｜[S02](#s02-驱动编排)｜[S03](#s03-缓存与持久化)｜[S04](#s04-旁路与后处理接口)｜[S05](#s05-后端桥与全局前置)｜[S06](#s06-输入与全局配置)｜[S07](#s07-宇宙学背景)｜[S08](#s08-质量函数与统计工具)｜[S09](#s09-初始条件)｜[S10](#s10-微扰场与速度)｜[S11](#s11-晕目录与位移)｜[S12](#s12-天体物理源)｜[S13](#s13-电离与复合)｜[S14](#s14-热与自旋温度)｜[S15](#s15-亮温输出)｜[S16](#s16-跨阶段基建与校准)

## 0. 本层结论

1. Python 侧（S01–S05）**完整展开**：单元以"模块 + 公开符号"给出。
2. 后端侧（S06–S16）**只登记主承担函数与其所在文件**，关键过程与关键量以 [CODE_TOPOLOGY.md](../CODE_TOPOLOGY.md) 为准，本层不复制其正文。
3. 每个阶段分组的开头都写明该阶段在两侧的分工；两侧的接口是 cffi 暴露的那一组函数（见 [S05.1](#s051-cffi-绑定与装饰器栈)）。

---

## S01 参数装配与模板

### S01.1 模板加载与合并
- **计算单元**：[S01.1.1](#s0111-create_params_from_template)、[S01.1.2](#s0112-load_template_file)

### S01.1.1 create_params_from_template
- **所属子过程**：[S01.1 模板加载与合并](L2-subprocesses.md#s011-模板加载与合并)
- **作用与意义**：承担合并这一步：把多份模板与覆盖值收成一份取值集合，是装配链上唯一做叠加的地方。
- **承担者**：`_templates.py` 的 `create_params_from_template`（[源码](../../../src/py21cmfast/_templates.py)）
- **关键过程**：按模板名从模板清单取出条目，合并调用方覆盖值，再交给反序列化。
- **下一层**：见 [L4 · S01.1.1](L4-key-processes.md#s0111-a-关键过程与关键量)

### S01.1.2 load_template_file
- **所属子过程**：[S01.1 模板加载与合并](L2-subprocesses.md#s011-模板加载与合并)
- **作用与意义**：承担找模板：先认盘上文件、再认内置别名，决定一次运行到底以哪份取值为起点。
- **承担者**：`_templates.py` 的 `load_template_file`、`list_templates`、`write_template`（[源码](../../../src/py21cmfast/_templates.py)）；模板数据在 `templates/` 下
- **关键过程**：模板文件与清单的读写；模板本身只列"非默认值"。
- **下一层**：见 [L4 · S01.1.2](L4-key-processes.md#s0112-a-关键过程与关键量)

### S01.2 反序列化与结构体实例化
- **计算单元**：[S01.2.1](#s0121-deserialize_inputs)、[S01.2.2](#s0122-inputparametersfrom_template)、[S01.2.3](#s0123-inputstruct)

### S01.2.1 deserialize_inputs
- **所属子过程**：[S01.2 反序列化与结构体实例化](L2-subprocesses.md#s012-反序列化与结构体实例化)
- **作用与意义**：承担取值变对象：字段过滤、关键字覆盖与默认值补全都在这里发生。
- **承担者**：`input_serialization.py` 的 `deserialize_inputs`（[源码](../../../src/py21cmfast/input_serialization.py)）
- **关键过程**：把"结构名 → 字段字典"逐项实例化为参数结构，传输函数表按表类型特判。
- **下一层**：见 [L4 · S01.2.1](L4-key-processes.md#s0121-a-关键过程与关键量)

### S01.2.2 InputParameters.from_template
- **所属子过程**：[S01.2 反序列化与结构体实例化](L2-subprocesses.md#s012-反序列化与结构体实例化)
- **作用与意义**：承担组装成完整参数集：模板、种子与红移网格在此合成唯一可用的输入。
- **承担者**：`wrapper/inputs.py` 的 `InputParameters.from_template`（[源码](../../../src/py21cmfast/wrapper/inputs.py)）
- **关键过程**：把各子结构组装成完整参数集，并接受随机种子与红移网格的显式覆盖。
- **下一层**：见 [L4 · S01.2.2](L4-key-processes.md#s0122-a-关键过程与关键量)

### S01.2.3 InputStruct
- **所属子过程**：[S01.2 反序列化与结构体实例化](L2-subprocesses.md#s012-反序列化与结构体实例化)
- **作用与意义**：承担两侧字段的对齐：Python 对象与后端结构体的映射错一处，报错会出现在离现场很远的地方。
- **承担者**：`wrapper/inputs.py` 的 `InputStruct`（其 `new` / `cstruct` / `cdict`）（[源码](../../../src/py21cmfast/wrapper/inputs.py)）
- **关键过程**：Python 参数对象与后端结构体之间的字段映射与类型转换。
- **下一层**：见 [L4 · S01.2.3](L4-key-processes.md#s0123-a-关键过程与关键量)

### S01.3 缺省补全与派生
- **计算单元**：[S01.3.1](#s0131-get_logspaced_redshifts)、[S01.3.2](#s0132-evolve_input_structs)

### S01.3.1 get_logspaced_redshifts
- **所属子过程**：[S01.3 缺省补全与派生](L2-subprocesses.md#s013-缺省补全与派生)
- **作用与意义**：承担红移网格的默认值：没写网格时由它决定整条流水线在哪些红移上取快照。
- **承担者**：`wrapper/inputs.py` 的 `get_logspaced_redshifts`、`InputParameters.with_logspaced_redshifts`（[源码](../../../src/py21cmfast/wrapper/inputs.py)）
- **关键过程**：未给出红移网格时按对数间隔补全，并据盒长与终末红移定界。
- **下一层**：见 [L4 · S01.3.1](L4-key-processes.md#s0131-a-关键过程与关键量)

### S01.3.2 evolve_input_structs
- **所属子过程**：[S01.3 缺省补全与派生](L2-subprocesses.md#s013-缺省补全与派生)
- **作用与意义**：承担派生一套子集参数：全局演化与校准试算靠它避免手改参数。
- **承担者**：`wrapper/inputs.py` 的 `evolve_input_structs`、`clone`（[源码](../../../src/py21cmfast/wrapper/inputs.py)）
- **关键过程**：派生一套"子集参数"（如降到单格、去掉某类过程），供全局演化与校准试算复用。
- **下一层**：见 [L4 · S01.3.2](L4-key-processes.md#s0132-a-关键过程与关键量)

### S01.4 命令行与全局配置
- **计算单元**：[S01.4.1](#s0141-_get_inputs)、[S01.4.2](#s0142-config)

### S01.4.1 _get_inputs
- **所属子过程**：[S01.4 命令行与全局配置](L2-subprocesses.md#s014-命令行与全局配置)
- **作用与意义**：承担人机接口到参数集的翻译：命令行给出的少数取值如何覆盖模板，由它定义。
- **承担者**：`cli.py` 的 `_get_inputs`、`_run_setup`、`Parameters`（[源码](../../../src/py21cmfast/cli.py)）
- **关键过程**：命令行给出的值只保留非空项，作为覆盖值交给模板装配；随后按需写回模板。
- **下一层**：见 [L4 · S01.4.1](L4-key-processes.md#s0141-a-关键过程与关键量)

### S01.4.2 Config
- **所属子过程**：[S01.4 命令行与全局配置](L2-subprocesses.md#s014-命令行与全局配置)
- **作用与意义**：承担进程级配置：缓存目录、外部表路径一类全局开关都在这里，改它会同时影响所有入口。
- **承担者**：`_cfg.py` 的 `Config` 单例 `config`（[源码](../../../src/py21cmfast/_cfg.py)）
- **关键过程**：进程级配置（缓存目录、外部表路径、内存系数等）；赋值会同步到后端配置结构。
- **下一层**：见 [L4 · S01.4.2](L4-key-processes.md#s0142-a-关键过程与关键量)

---

## S02 驱动编排

### S02.1 初始条件与微扰场准备
- **计算单元**：[S02.1.1](#s0211-_setup_ics_and_pfs_for_scrolling)、[S02.1.2](#s0212-compute_initial_conditions)

### S02.1.1 _setup_ics_and_pfs_for_scrolling
- **所属子过程**：[S02.1 初始条件与微扰场准备](L2-subprocesses.md#s021-初始条件与微扰场准备)
- **作用与意义**：承担推进前的备料：初始条件、微扰场与晕都在这里一次备齐，三条流水线共用。
- **承担者**：`drivers/coeval.py` 的 `_setup_ics_and_pfs_for_scrolling`（[源码](../../../src/py21cmfast/drivers/coeval.py)）
- **关键过程**：先算初始条件，再逐红移算微扰场与晕目录；光子守恒校准在此建立。
- **下一层**：见 [L4 · S02.1.1](L4-key-processes.md#s0211-a-关键过程与关键量)

### S02.1.2 compute_initial_conditions
- **所属子过程**：[S02.1 初始条件与微扰场准备](L2-subprocesses.md#s021-初始条件与微扰场准备)
- **作用与意义**：承担最早的密度与速度场：整条链的随机性由它一次性固定。
- **承担者**：`drivers/single_field.py` 的 `compute_initial_conditions`（[源码](../../../src/py21cmfast/drivers/single_field.py)）
- **关键过程**：单场入口；在退化为单格时直接填充而不进后端。
- **下一层**：见 [L4 · S02.1.2](L4-key-processes.md#s0212-a-关键过程与关键量)

### S02.2 晕演化与位移编排
- **计算单元**：[S02.2.1](#s0221-evolve_halos)

### S02.2.1 evolve_halos
- **所属子过程**：[S02.2 晕演化与位移编排](L2-subprocesses.md#s022-晕演化与位移编排)
- **作用与意义**：承担晕目录的逐级演化：晕在红移方向上的连续性由它维持。
- **承担者**：`drivers/coeval.py` 的 `evolve_halos`（[源码](../../../src/py21cmfast/drivers/coeval.py)）
- **关键过程**：按反红移序逐级算晕目录，并把上一级结果作为"后代"传入。
- **下一层**：见 [L4 · S02.2.1](L4-key-processes.md#s0221-a-关键过程与关键量)

### S02.3 红移递减推进循环
- **计算单元**：[S02.3.1](#s0231-_redshift_loop_generator)

### S02.3.1 _redshift_loop_generator
- **所属子过程**：[S02.3 红移递减推进循环](L2-subprocesses.md#s023-红移递减推进循环)
- **作用与意义**：承担单红移上的动作编排：全仓唯一把各阶段串成一条时间序列的地方。
- **承担者**：`drivers/coeval.py` 的 `_redshift_loop_generator`（[源码](../../../src/py21cmfast/drivers/coeval.py)）
- **关键过程**：单个红移上按固定次序依次请求源项、X 射线源、自旋温度、电离、亮温；光锥路径复用同一生成器。
- **下一层**：见 [L4 · S02.3.1](L4-key-processes.md#s0231-a-关键过程与关键量)

### S02.4 快照组装
- **计算单元**：[S02.4.1](#s0241-generate_coeval)、[S02.4.2](#s0242-run_global_evolution)

### S02.4.1 generate_coeval
- **所属子过程**：[S02.4 快照组装](L2-subprocesses.md#s024-快照组装)
- **作用与意义**：承担联合演化盒的收尾：把逐红移结果按量装进容器，并负责释放后端资源。
- **承担者**：`drivers/coeval.py` 的 `generate_coeval`、`run_coeval`、`Coeval`（[源码](../../../src/py21cmfast/drivers/coeval.py)）
- **关键过程**：把逐红移的各盒装进一个可按量取用的容器并在结束时释放后端全局资源。
- **下一层**：见 [L4 · S02.4.1](L4-key-processes.md#s0241-a-关键过程与关键量)

### S02.4.2 run_global_evolution
- **所属子过程**：[S02.4 快照组装](L2-subprocesses.md#s024-快照组装)
- **作用与意义**：承担全局演化的零维改写：参数如何退化、结果如何取均值都由它定义。
- **承担者**：`drivers/global_evolution.py` 的 `run_global_evolution`、`compute_global_reionization_at_z`（[源码](../../../src/py21cmfast/drivers/global_evolution.py)）
- **关键过程**：把参数改写成单格形态再走同一条推进循环，逐红移取盒均值。
- **下一层**：见 [L4 · S02.4.2](L4-key-processes.md#s0242-a-关键过程与关键量)

### S02.5 光锥切片与拼接
- **计算单元**：[S02.5.1](#s0251-generate_lightcone)、[S02.5.2](#s0252-make_lightcone_slices)、[S02.5.3](#s0253-apply_rsds)

### S02.5.1 generate_lightcone
- **所属子过程**：[S02.5 光锥切片与拼接](L2-subprocesses.md#s025-光锥切片与拼接)
- **作用与意义**：承担光锥路径的推进：在共用的循环之外只多出切片与检查点。
- **承担者**：`drivers/lightcone.py` 的 `generate_lightcone`、`_run_lightcone_from_perturbed_fields`、`LightCone`（[源码](../../../src/py21cmfast/drivers/lightcone.py)）
- **关键过程**：复用推进循环，在每个红移后取切片并拼接；支持检查点。
- **下一层**：见 [L4 · S02.5.1](L4-key-processes.md#s0251-a-关键过程与关键量)

### S02.5.2 make_lightcone_slices
- **所属子过程**：[S02.5 光锥切片与拼接](L2-subprocesses.md#s025-光锥切片与拼接)
- **作用与意义**：承担几何到采样点的翻译：切片取哪些格点由它决定，换几何即换光锥。
- **承担者**：`lightconers.py` 的 `Lightconer` / `RectilinearLightconer` / `AngularLightconer`（[源码](../../../src/py21cmfast/lightconers.py)）
- **关键过程**：按几何定义从每个红移的盒中抽出该几何关心的采样点。
- **下一层**：见 [L4 · S02.5.2](L4-key-processes.md#s0252-a-关键过程与关键量)

### S02.5.3 apply_rsds
- **所属子过程**：[S02.5 光锥切片与拼接](L2-subprocesses.md#s025-光锥切片与拼接)
- **作用与意义**：承担光锥末端的一次性速度位移：不做它就会丢掉红移空间畸变。
- **承担者**：`rsds.py` 的 `apply_rsds`、`include_dvdr_in_tau21`、`estimate_rsd_displacements`（[源码](../../../src/py21cmfast/rsds.py)）
- **关键过程**：把速度引起的视线位移施加到光锥上（可选，只在光锥末端做一次）。
- **下一层**：见 [L4 · S02.5.3](L4-key-processes.md#s0253-a-关键过程与关键量)

### S02.6 断点续算与起始点定位
- **计算单元**：[S02.6.1](#s0261-_obtain_starting_point_for_scrolling)

### S02.6.1 _obtain_starting_point_for_scrolling
- **所属子过程**：[S02.6 断点续算与起始点定位](L2-subprocesses.md#s026-断点续算与起始点定位)
- **作用与意义**：承担续算判定：从哪个红移接手、还缺哪些上游产物由它决定。
- **承担者**：`drivers/coeval.py` 的 `_obtain_starting_point_for_scrolling`（[源码](../../../src/py21cmfast/drivers/coeval.py)）
- **关键过程**：查询已有缓存，决定从哪个红移开始推进、以及需要哪些上游产物。
- **下一层**：见 [L4 · S02.6.1](L4-key-processes.md#s0261-a-关键过程与关键量)

---

## S03 缓存与持久化

### S03.1 缓存键与路径模板
- **计算单元**：[S03.1.1](#s0311-outputcache)

### S03.1.1 OutputCache
- **所属子过程**：[S03.1 缓存键与路径模板](L2-subprocesses.md#s031-缓存键与路径模板)
- **作用与意义**：承担磁盘布局：四段哈希如何组成目录与文件名，决定同一次运行在盘上怎么被认出。
- **承担者**：`io/caching.py` 的 `OutputCache`（其哈希计算、路径模板填充、查找、写入、载入）（[源码](../../../src/py21cmfast/io/caching.py)）
- **关键过程**：按"物质与宇宙学参数 / 种子 / 红移网格 / 天体物理参数 / 红移"的层级拼出目录与文件名。
- **下一层**：见 [L4 · S03.1.1](L4-key-processes.md#s0311-a-关键过程与关键量)

### S03.2 输出结构落盘与读取
- **计算单元**：[S03.2.1](#s0321-write_output_to_hdf5)、[S03.2.2](#s0322-read_output_struct)

### S03.2.1 write_output_to_hdf5
- **所属子过程**：[S03.2 输出结构落盘与读取](L2-subprocesses.md#s032-输出结构落盘与读取)
- **作用与意义**：承担落盘格式：参数与字段分块写入的约定在此固定。
- **承担者**：`io/h5.py` 的 `write_output_to_hdf5`（[源码](../../../src/py21cmfast/io/h5.py)）
- **关键过程**：一个结构一个文件，参数与字段分两个组写入，并记录产生它的版本。
- **下一层**：见 [L4 · S03.2.1](L4-key-processes.md#s0321-a-关键过程与关键量)

### S03.2.2 read_output_struct
- **所属子过程**：[S03.2 输出结构落盘与读取](L2-subprocesses.md#s032-输出结构落盘与读取)
- **作用与意义**：承担回读与还原：单独读回一个产物还能拿到它的参数，靠的就是这里。
- **承担者**：`io/h5.py` 的 `read_output_struct`、`read_inputs`（[源码](../../../src/py21cmfast/io/h5.py)）
- **关键过程**：回读单文件并还原结构与参数；按文件内的版本号选择读取路径。
- **下一层**：见 [L4 · S03.2.2](L4-key-processes.md#s0322-a-关键过程与关键量)

### S03.3 运行级缓存清单
- **计算单元**：[S03.3.1](#s0331-runcache)

### S03.3.1 RunCache
- **所属子过程**：[S03.3 运行级缓存清单](L2-subprocesses.md#s033-运行级缓存清单)
- **作用与意义**：承担清单级判断：某个红移上是否齐备、还差哪一件，由它回答。
- **承担者**：`io/caching.py` 的 `RunCache`（其构造、完备性判断、按红移取结构）（[源码](../../../src/py21cmfast/io/caching.py)）
- **关键过程**：一次运行涉及的全部可能文件构成一张清单，用来判断"某个红移上是否已齐备"。
- **下一层**：见 [L4 · S03.3.1](L4-key-processes.md#s0331-a-关键过程与关键量)

### S03.4 写盘策略开关
- **计算单元**：[S03.4.1](#s0341-cacheconfig)

### S03.4.1 CacheConfig
- **所属子过程**：[S03.4 写盘策略开关](L2-subprocesses.md#s034-写盘策略开关)
- **作用与意义**：承担写盘旋钮：内存与磁盘之间的取舍集中在这一个开关组。
- **承担者**：`io/caching.py` 的 `CacheConfig`（[源码](../../../src/py21cmfast/io/caching.py)）
- **关键过程**：按量类型决定是否落盘、是否只在最后一步落盘。
- **下一层**：见 [L4 · S03.4.1](L4-key-processes.md#s0341-a-关键过程与关键量)

---

## S04 旁路与后处理接口

### S04.1 光度函数诊断
- **计算单元**：[S04.1.1](#s0411-compute_luminosity_function)

### S04.1.1 compute_luminosity_function
- **所属子过程**：[S04.1 光度函数诊断](L2-subprocesses.md#s041-光度函数诊断)
- **作用与意义**：承担旁路诊断的取数：把两个恒星族的结果装配成可供对照的表。
- **承担者**：`wrapper/cfuncs.py` 的 `compute_luminosity_function`（[源码](../../../src/py21cmfast/wrapper/cfuncs.py)）；后端侧为 [S12.3.1](#s1231-computelf)
- **关键过程**：对两个恒星族分别循环调用后端的光度函数计算并按红移/质量维组装。
- **下一层**：见 [L4 · S04.1.1](L4-key-processes.md#s0411-a-关键过程与关键量)

### S04.2 再电离光学深度
- **计算单元**：[S04.2.1](#s0421-compute_tau)

### S04.2.1 compute_tau
- **所属子过程**：[S04.2 再电离光学深度](L2-subprocesses.md#s042-再电离光学深度)
- **作用与意义**：承担把全局历史压成一个标量：最常被引用的那个约束量在这里产生。
- **承担者**：`wrapper/cfuncs.py` 的 `compute_tau`（[源码](../../../src/py21cmfast/wrapper/cfuncs.py)）；后端侧为 [S16.1.2](#s1612-photoncons_calibration) 所在模块中的 τ 积分
- **关键过程**：把红移序列与中性分数序列交给后端做视线积分。
- **下一层**：见 [L4 · S04.2.1](L4-key-processes.md#s0421-a-关键过程与关键量)

### S04.3 光子守恒校准装配
- **计算单元**：[S04.3.1](#s0431-setup_photon_cons)

### S04.3.1 setup_photon_cons
- **所属子过程**：[S04.3 光子守恒校准装配](L2-subprocesses.md#s043-光子守恒校准装配)
- **作用与意义**：承担校准的编排：试算参数如何构造、结果如何回灌，由它定义。
- **承担者**：`wrapper/photoncons.py` 的 `setup_photon_cons`、`calibrate_photon_cons`（[源码](../../../src/py21cmfast/wrapper/photoncons.py)）
- **关键过程**：按校准类型分派后端算法；校准本身是一次"去掉演化"的试算，再与解析历史比对。
- **下一层**：见 [L4 · S04.3.1](L4-key-processes.md#s0431-a-关键过程与关键量)

### S04.4 外部宇宙学表与密度场 RMS
- **计算单元**：[S04.4.1](#s0441-run_classy)、[S04.4.2](#s0442-compute_rms)

### S04.4.1 run_classy
- **所属子过程**：[S04.4 外部宇宙学表与密度场 RMS](L2-subprocesses.md#s044-外部宇宙学表与密度场-rms)
- **作用与意义**：承担外部表的引入：用外部宇宙学码替掉解析传输函数的那条路。
- **承担者**：`wrapper/classy_interface.py` 的 `run_classy`、`get_transfer_function`、`find_redshift_kinematic_decoupling`（[源码](../../../src/py21cmfast/wrapper/classy_interface.py)）
- **关键过程**：用外部玻尔兹曼码算出传输函数表，作为参数集里查表的默认来源。
- **下一层**：见 [L4 · S04.4.1](L4-key-processes.md#s0441-a-关键过程与关键量)

### S04.4.2 compute_rms
- **所属子过程**：[S04.4 外部宇宙学表与密度场 RMS](L2-subprocesses.md#s044-外部宇宙学表与密度场-rms)
- **作用与意义**：承担尺度查询：给位移估计提供均方根输入。
- **承担者**：`wrapper/classy_interface.py` 的 `compute_rms`（[源码](../../../src/py21cmfast/wrapper/classy_interface.py)）
- **关键过程**：用传输函数与平滑窗在给定尺度上积分得到密度场均方根。
- **下一层**：见 [L4 · S04.4.2](L4-key-processes.md#s0442-a-关键过程与关键量)

### S04.5 绘图与结果呈现
- **计算单元**：[S04.5.1](#s0451-coeval_sliceplot)

### S04.5.1 coeval_sliceplot
- **所属子过程**：[S04.5 绘图与结果呈现](L2-subprocesses.md#s045-绘图与结果呈现)
- **作用与意义**：承担结果的呈现：不参与计算，但它是查看结果的第一入口。
- **承担者**：`plotting.py` 的 `coeval_sliceplot`、`lightcone_sliceplot`、`plot_global_history`（[源码](../../../src/py21cmfast/plotting.py)）
- **关键过程**：对切片、光锥与全局历史的可视化；不参与任何计算。
- **下一层**：见 [L4 · S04.5.1](L4-key-processes.md#s0451-a-关键过程与关键量)

---

## S05 后端桥与全局前置

### S05.1 cffi 绑定与装饰器栈
- **计算单元**：[S05.1.1](#s0511-broadcast_input_struct)、[S05.1.2](#s0512-init_backend_ps)、[S05.1.3](#s0513-outputstruct_compute_function)

### S05.1.1 broadcast_input_struct
- **所属子过程**：[S05.1 cffi 绑定与装饰器栈](L2-subprocesses.md#s051-cffi-绑定与装饰器栈)
- **作用与意义**：承担参数进入后端这一步：六个子结构一次性登记为全局量。
- **承担者**：`wrapper/cfuncs.py` 的 `broadcast_input_struct`（[源码](../../../src/py21cmfast/wrapper/cfuncs.py)）；后端侧为 [S06.2.1](#s0621-broadcast_struct_global_all)
- **关键过程**：把参数集的各子结构一次性转成后端结构体并登记为全局量。
- **下一层**：见 [L4 · S05.1.1](L4-key-processes.md#s0511-a-关键过程与关键量)

### S05.1.2 init_backend_ps
- **所属子过程**：[S05.1 cffi 绑定与装饰器栈](L2-subprocesses.md#s051-cffi-绑定与装饰器栈)
- **作用与意义**：承担前置的自动补齐：调用方不必知道建表与建节点的先后。
- **承担者**：`wrapper/cfuncs.py` 的 `init_backend_ps` / `init_sigma_table` / `init_gl` 装饰器栈（[源码](../../../src/py21cmfast/wrapper/cfuncs.py)）
- **关键过程**：被装饰的查询函数在被调用前先自动完成"功率谱就绪 → 方差表就绪 → 积分节点就绪"。
- **下一层**：见 [L4 · S05.1.2](L4-key-processes.md#s0512-a-关键过程与关键量)

### S05.1.3 OutputStruct._compute_function
- **所属子过程**：[S05.1 cffi 绑定与装饰器栈](L2-subprocesses.md#s051-cffi-绑定与装饰器栈)
- **作用与意义**：承担输出结构与后端入口的绑定：每一次计算请求在这里变成一次后端调用。
- **承担者**：`wrapper/outputs.py` 的 `OutputStruct`（其 `compute` / 各子类声明的后端入口）（[源码](../../../src/py21cmfast/wrapper/outputs.py)）
- **关键过程**：每个输出结构声明自己要调哪个后端入口，并把输入数组按声明顺序推送过去。
- **下一层**：见 [L4 · S05.1.3](L4-key-processes.md#s0513-a-关键过程与关键量)

### S05.2 后端前置触发时序
- **计算单元**：[S05.2.1](#s0521-single_field_func)、[S05.2.2](#s0522-construct_fftw_wisdoms)

### S05.2.1 single_field_func
- **所属子过程**：[S05.2 后端前置触发时序](L2-subprocesses.md#s052-后端前置触发时序)
- **作用与意义**：承担单场入口的统一外壳：一致性检查、前置与释放都挂在这一层。
- **承担者**：`drivers/_param_config.py` 的 `single_field_func`、`high_level_func`（[源码](../../../src/py21cmfast/drivers/_param_config.py)）
- **关键过程**：包住每个单场入口：先做参数一致性检查、再广播参数与建变换缓存、最后按需释放全局表。
- **下一层**：见 [L4 · S05.2.1](L4-key-processes.md#s0521-a-关键过程与关键量)

### S05.2.2 construct_fftw_wisdoms
- **所属子过程**：[S05.2 后端前置触发时序](L2-subprocesses.md#s052-后端前置触发时序)
- **作用与意义**：承担变换缓存的落盘与读入：同尺寸重跑能更快靠它。
- **承担者**：`wrapper/cfuncs.py` 的 `construct_fftw_wisdoms`（[源码](../../../src/py21cmfast/wrapper/cfuncs.py)）
- **关键过程**：把变换计划缓存落盘或读入，使同尺寸的重跑更快。
- **下一层**：见 [L4 · S05.2.2](L4-key-processes.md#s0522-a-关键过程与关键量)

### S05.3 全局查表内存释放
- **计算单元**：[S05.3.1](#s0531-free_cosmo_tables)

### S05.3.1 free_cosmo_tables
- **所属子过程**：[S05.3 全局查表内存释放](L2-subprocesses.md#s053-全局查表内存释放)
- **作用与意义**：承担查表回收：连续多次调用会不会把内存撑满，由它决定。
- **承担者**：`wrapper/cfuncs.py` 的 `free_cosmo_tables`（[源码](../../../src/py21cmfast/wrapper/cfuncs.py)）
- **关键过程**：高层驱动在收尾时释放全局查表；单场调用则按开关决定是否立即释放。
- **下一层**：见 [L4 · S05.3.1](L4-key-processes.md#s0531-a-关键过程与关键量)

---

## S06 输入与全局配置

> 后端：本阶段只有 2 个子过程、无网格计算。关键过程与关键量见 [CODE_TOPOLOGY.md §输入与全局配置](../CODE_TOPOLOGY.md#输入与全局配置)。

### S06.1 基础物理常量的固化
- **计算单元**：[S06.1.1](#s0611-physconst)

### S06.1.1 physconst
- **所属子过程**：[S06.1 基础物理常量的固化](L2-subprocesses.md#s061-基础物理常量的固化)
- **作用与意义**：承担物理常量的唯一出处：所有计算都直接取它，避免同一个常数在两处写成不同值。
- **承担者**：`Constants.c` 的 `physconst` 实例，派生量在 `Constants.h`（[源码](../../../src/py21cmfast/src/Constants.c)）
- **关键过程**：把编译期常数固化成一个只读结构，供全部计算单元直接读取。
- **下一层**：见 [L4 · S06.1.1](L4-key-processes.md#s0611-a-关键过程与关键量)

### S06.2 运行时参数结构的定义与广播
- **计算单元**：[S06.2.1](#s0621-broadcast_struct_global_all)、[S06.2.2](#s0622-cosmoparams)

### S06.2.1 Broadcast_struct_global_all
- **所属子过程**：[S06.2 运行时参数结构的定义与广播](L2-subprocesses.md#s062-运行时参数结构的定义与广播)
- **作用与意义**：承担全局参数的登记：后续阶段不再传参的前提是它。
- **承担者**：`InputParameters.c` 的 `Broadcast_struct_global_all`、`Broadcast_struct_global_noastro`、`Free_cosmo_tables_global`（[源码](../../../src/py21cmfast/src/InputParameters.c)）
- **关键过程**：把六个参数结构登记为全局指针；使用外部传输函数时另分配并拷贝表。
- **下一层**：见 [L4 · S06.2.1](L4-key-processes.md#s0621-a-关键过程与关键量)

### S06.2.2 CosmoParams
- **所属子过程**：[S06.2 运行时参数结构的定义与广播](L2-subprocesses.md#s062-运行时参数结构的定义与广播)
- **作用与意义**：承担两侧共享的结构布局：字段名一致是 Python 与后端能对话的基础。
- **承担者**：`_inputparams_wrapper.h` 中的参数结构与 `_outputstructs_wrapper.h` 中的输出结构定义（[源码](../../../src/py21cmfast/src/_inputparams_wrapper.h)）
- **关键过程**：两侧共享的结构布局在此一次性声明，Python 侧与后端侧的字段名必须一致。
- **下一层**：见 [L4 · S06.2.2](L4-key-processes.md#s0622-a-关键过程与关键量)

---

## S07 宇宙学背景

> 后端：本阶段建表与求值并重，被后续所有阶段读取。关键过程与关键量见 [CODE_TOPOLOGY.md §宇宙学背景](../CODE_TOPOLOGY.md#宇宙学背景)。

### S07.1 线性功率谱的构造
- **计算单元**：[S07.1.1](#s0711-init_ps)、[S07.1.2](#s0712-transfer_function)、[S07.1.3](#s0713-power_in_k)

### S07.1.1 init_ps
- **所属子过程**：[S07.1 线性功率谱的构造](L2-subprocesses.md#s071-线性功率谱的构造)
- **作用与意义**：承担功率谱求值的装配：所有与功率谱有关的量都从它开始。
- **承担者**：`cosmology.c` 的 `init_ps` / `free_ps`（[源码](../../../src/py21cmfast/src/cosmology.c)）
- **关键过程**：一次性装配功率谱求值所需的参数与归一化，并在结束时可回收。
- **下一层**：见 [L4 · S07.1.1](L4-key-processes.md#s0711-a-关键过程与关键量)

### S07.1.2 transfer_function
- **所属子过程**：[S07.1 线性功率谱的构造](L2-subprocesses.md#s071-线性功率谱的构造)
- **作用与意义**：承担传输函数的来源选择：解析近似与外部表在此分流。
- **承担者**：`cosmology.c` 的 `transfer_function` 及其各解析近似分支与外部表分支（[源码](../../../src/py21cmfast/src/cosmology.c)）
- **关键过程**：按参数选择传输函数来源；外部分支直接查表。
- **下一层**：见 [L4 · S07.1.2](L4-key-processes.md#s0712-a-关键过程与关键量)

### S07.1.3 power_in_k
- **所属子过程**：[S07.1 线性功率谱的构造](L2-subprocesses.md#s071-线性功率谱的构造)
- **作用与意义**：承担线性功率谱的最终形态：抑制项是否乘入在这里决定。
- **承担者**：`cosmology.c` 的 `power_in_k`、`power_in_k_cdm`、`power_in_vcb`（[源码](../../../src/py21cmfast/src/cosmology.c)）
- **关键过程**：原始曲率谱 × 传输函数² × 归一化；模糊暗物质抑制在此乘入。
- **下一层**：见 [L4 · S07.1.3](L4-key-processes.md#s0713-a-关键过程与关键量)

### S07.2 增长因子与时间距离量
- **计算单元**：[S07.2.1](#s0721-dicke)

### S07.2.1 dicke
- **所属子过程**：[S07.2 增长因子与时间距离量](L2-subprocesses.md#s072-增长因子与时间距离量)
- **作用与意义**：承担时间与距离的换算：把场推到某个红移、把晕位移多少都依赖它。
- **承担者**：`cosmology.c` 的 `dicke` 与同族的增长率、哈勃率、时间/距离换算函数（[源码](../../../src/py21cmfast/src/cosmology.c)）
- **关键过程**：线性增长因子及其随红移的导数与积分量。
- **下一层**：见 [L4 · S07.2.1](L4-key-processes.md#s0721-a-关键过程与关键量)

### S07.3 质量方差与尺度映射
- **计算单元**：[S07.3.1](#s0731-sigma_z0)、[S07.3.2](#s0732-sigma_z0_pre)

### S07.3.1 sigma_z0
- **所属子过程**：[S07.3 质量方差与尺度映射](L2-subprocesses.md#s073-质量方差与尺度映射)
- **作用与意义**：承担方差与其导数的求值：质量函数与塌缩分数的输入。
- **承担者**：`cosmology.c` 的 `sigma_z0`、`dsigmasqdm_z0`（[源码](../../../src/py21cmfast/src/cosmology.c)）
- **关键过程**：对功率谱做窗口积分得到质量方差及其对尺度的导数。
- **下一层**：见 [L4 · S07.3.1](L4-key-processes.md#s0731-a-关键过程与关键量)

### S07.3.2 sigma_z0_pre
- **所属子过程**：[S07.3 质量方差与尺度映射](L2-subprocesses.md#s073-质量方差与尺度映射)
- **作用与意义**：承担模糊暗物质情形的参考方差：抑制因子由它与含抑制结果相除得到。
- **承担者**：`fdm.c` 的 `sigma_z0_pre`、`dsigmasqdm_z0_pre`、`dsigma_dk_pre`、`dsigmasq_dm_pre`（[源码](../../../src/py21cmfast/src/fdm.c)）
- **关键过程**：为模糊暗物质情形准备"不含抑制"的参考方差，用于构造抑制因子。
- **下一层**：见 [L4 · S07.3.2](L4-key-processes.md#s0732-a-关键过程与关键量)

### S07.4 跨阶段查表基建
- **计算单元**：[S07.4.1](#s0741-initialisesigmaminterptable)、[S07.4.2](#s0742-allocate_rgtable1d)

### S07.4.1 initialiseSigmaMInterpTable
- **所属子过程**：[S07.4 跨阶段查表基建](L2-subprocesses.md#s074-跨阶段查表基建)
- **作用与意义**：承担方差表的建成与查询：后续阶段的快慢主要由它决定。
- **承担者**：`interp_tables.c` 的 `initialiseSigmaMInterpTable`、`EvaluateSigma`、`EvaluateSigmaConditional`、`EvaluatedSigmasqdm`（[源码](../../../src/py21cmfast/src/interp_tables.c)）
- **关键过程**：在质量区间上预建方差表，后续阶段只做查表求值。
- **下一层**：见 [L4 · S07.4.1](L4-key-processes.md#s0741-a-关键过程与关键量)

### S07.4.2 allocate_RGTable1D
- **所属子过程**：[S07.4 跨阶段查表基建](L2-subprocesses.md#s074-跨阶段查表基建)
- **作用与意义**：承担规则网格表的通用容器：所有先建表后查询的做法都用同一套实现。
- **承担者**：`interpolation.c` 的规则网格表族（分配、释放、求值、越界判定）（[源码](../../../src/py21cmfast/src/interpolation.c)）
- **关键过程**：所有一维/二维规则网格表的通用容器与查询。
- **下一层**：见 [L4 · S07.4.2](L4-key-processes.md#s0742-a-关键过程与关键量)

### S07.5 前端直接积分入口
- **计算单元**：[S07.5.1](#s0751-get_sigma)

### S07.5.1 get_sigma
- **所属子过程**：[S07.5 前端直接积分入口](L2-subprocesses.md#s075-前端直接积分入口)
- **作用与意义**：承担不经主链的查询出口：外部核对统计量最直接的入口。
- **承担者**：`integral_wrappers.c` 的 `get_sigma` 等一组查询入口（[源码](../../../src/py21cmfast/src/integral_wrappers.c)）
- **关键过程**：把表与积分包装成不经过主链、可被外部直接调用的查询。
- **下一层**：见 [L4 · S07.5.1](L4-key-processes.md#s0751-a-关键过程与关键量)

---

## S08 质量函数与统计工具

> 后端：源项与电离阶段的核心统计量在此产生。关键过程与关键量见 [CODE_TOPOLOGY.md §质量函数与统计工具](../CODE_TOPOLOGY.md#质量函数与统计工具)。

### S08.1 质量函数与积分引擎
- **计算单元**：[S08.1.1](#s0811-unconditional_hmf)、[S08.1.2](#s0812-integratedndm_gl)、[S08.1.3](#s0813-fgtrm)、[S08.1.4](#s0814-minimum_source_mass)

### S08.1.1 unconditional_hmf
- **所属子过程**：[S08.1 质量函数与积分引擎](L2-subprocesses.md#s081-质量函数与积分引擎)
- **作用与意义**：承担质量函数的取值：源项积分与晕抽样都以它为分布。
- **承担者**：`hmf.c` 的 `unconditional_hmf`、`conditional_hmf` 及各解析核（[源码](../../../src/py21cmfast/src/hmf.c)）
- **关键过程**：按选定形式给出质量函数；条件形式额外依赖局部密度与方差。
- **下一层**：见 [L4 · S08.1.1](L4-key-processes.md#s0811-a-关键过程与关键量)

### S08.1.2 IntegratedNdM_GL
- **所属子过程**：[S08.1 质量函数与积分引擎](L2-subprocesses.md#s081-质量函数与积分引擎)
- **作用与意义**：承担质量区间上的积分：晕数与塌缩分数从这里积出来。
- **承担者**：`hmf.c` 的积分引擎族（自适应积分、高斯-勒让德积分与节点初始化、解析近似分支）（[源码](../../../src/py21cmfast/src/hmf.c)）
- **关键过程**：把质量函数在有上下限的区间上积成晕数或塌缩分数。
- **下一层**：见 [L4 · S08.1.2](L4-key-processes.md#s0812-a-关键过程与关键量)

### S08.1.3 FgtrM
- **所属子过程**：[S08.1 质量函数与积分引擎](L2-subprocesses.md#s081-质量函数与积分引擎)
- **作用与意义**：承担塌缩分数的取值：电离判据的阈值比较用它。
- **承担者**：`hmf.c` 的塌缩分数族（含快速偏置近似）（[源码](../../../src/py21cmfast/src/hmf.c)）
- **关键过程**：给定尺度以上的累计塌缩质量占比及其随红移的变化。
- **下一层**：见 [L4 · S08.1.3](L4-key-processes.md#s0813-a-关键过程与关键量)

### S08.1.4 minimum_source_mass
- **所属子过程**：[S08.1 质量函数与积分引擎](L2-subprocesses.md#s081-质量函数与积分引擎)
- **作用与意义**：承担质量上下限的确定：源项到底积到多低的质量由它划界。
- **承担者**：`hmf.c` 的 `minimum_source_mass`、`Mass_limit_bisection`（[源码](../../../src/py21cmfast/src/hmf.c)）
- **关键过程**：按冷却阈值定出最小源质量；另按二分法求积分两侧的质量限。
- **下一层**：见 [L4 · S08.1.4](L4-key-processes.md#s0814-a-关键过程与关键量)

### S08.2 FDM 修正
- **计算单元**：[S08.2.1](#s0821-t_f)

### S08.2.1 T_F
- **所属子过程**：[S08.2 FDM 修正](L2-subprocesses.md#s082-fdm-修正)
- **作用与意义**：承担模糊暗物质的抑制：换暗物质模型时唯一需要改动的核之一。
- **承担者**：`fdm.c` 的 `T_F`、`dndm_FDM`（[源码](../../../src/py21cmfast/src/fdm.c)）
- **关键过程**：给出模糊暗物质的转移函数，并在无条件质量函数上乘抑制因子（条件形式不乘）。
- **下一层**：见 [L4 · S08.2.1](L4-key-processes.md#s0821-a-关键过程与关键量)

---

## S09 初始条件

> 后端：本阶段的产物是 [P02 初始条件](L0-pipeline.md#p02-初始条件)。关键过程与关键量见 [CODE_TOPOLOGY.md §初始条件](../CODE_TOPOLOGY.md#初始条件)。

### S09.1 逐线程随机数与种子管理
- **计算单元**：[S09.1.1](#s0911-seed_rng_threads)

### S09.1.1 seed_rng_threads
- **所属子过程**：[S09.1 逐线程随机数与种子管理](L2-subprocesses.md#s091-逐线程随机数与种子管理)
- **作用与意义**：承担随机流的派生：并行与串行、首跑与重跑结果一致的保证。
- **承担者**：`rng.c` 的 `seed_rng_threads`、`free_rng_threads`（[源码](../../../src/py21cmfast/src/rng.c)）
- **关键过程**：由总种子派生各线程的独立随机流，保证并行与串行结果一致。
- **下一层**：见 [L4 · S09.1.1](L4-key-processes.md#s0911-a-关键过程与关键量)

### S09.2 傅里叶变换基建
- **计算单元**：[S09.2.1](#s0921-dft_r2c_cube)

### S09.2.1 dft_r2c_cube
- **所属子过程**：[S09.2 傅里叶变换基建](L2-subprocesses.md#s092-傅里叶变换基建)
- **作用与意义**：承担傅里叶变换的统一封装：对齐与归一化约定错一处就会全盘偏移。
- **承担者**：`dft.c` 的 `dft_r2c_cube`、`dft_c2r_cube`、`CreateFFTWWisdoms`（[源码](../../../src/py21cmfast/src/dft.c)）
- **关键过程**：实↔复三维变换的统一封装，负责对齐与归一化约定。
- **下一层**：见 [L4 · S09.2.1](L4-key-processes.md#s0921-a-关键过程与关键量)

### S09.3 高斯随机密度场的抽样与实空间化
- **计算单元**：[S09.3.1](#s0931-sample_ic_modes)、[S09.3.2](#s0932-filter_box)

### S09.3.1 sample_ic_modes
- **所属子过程**：[S09.3 高斯随机密度场的抽样与实空间化](L2-subprocesses.md#s093-高斯随机密度场的抽样与实空间化)
- **作用与意义**：承担随机场的抽样：整条链的随机性在频谱上定型。
- **承担者**：`InitialConditions.c` 的 `sample_ic_modes`、`adj_complex_conj`（[源码](../../../src/py21cmfast/src/InitialConditions.c)）
- **关键过程**：按功率谱给各模赋随机相位与幅度，并保证实场所需的共轭对称。
- **下一层**：见 [L4 · S09.3.1](L4-key-processes.md#s0931-a-关键过程与关键量)

### S09.3.2 filter_box
- **所属子过程**：[S09.3 高斯随机密度场的抽样与实空间化](L2-subprocesses.md#s093-高斯随机密度场的抽样与实空间化)
- **作用与意义**：承担把场调到某个尺度：初始条件与后续多尺度操作共用的手段。
- **承担者**：`filtering.c` 的 `filter_box`（[源码](../../../src/py21cmfast/src/filtering.c)）
- **关键过程**：在傅里叶空间施加窗函数，是"把密度场调到某个尺度"的公共手段。
- **下一层**：见 [L4 · S09.3.2](L4-key-processes.md#s0932-a-关键过程与关键量)

### S09.4 速度场与相对速度场
- **计算单元**：[S09.4.1](#s0941-compute_velocity_fields)、[S09.4.2](#s0942-compute_velocity_fields_2lpt)、[S09.4.3](#s0943-compute_relative_velocities)

### S09.4.1 compute_velocity_fields
- **所属子过程**：[S09.4 速度场与相对速度场](L2-subprocesses.md#s094-速度场与相对速度场)
- **作用与意义**：承担一阶位移场：质量如何被搬运由它给出。
- **承担者**：`InitialConditions.c` 的 `compute_velocity_fields`、`compute_f_gradient`（[源码](../../../src/py21cmfast/src/InitialConditions.c)）
- **关键过程**：由密度场的势梯度得到一阶位移场。
- **下一层**：见 [L4 · S09.4.1](L4-key-processes.md#s0941-a-关键过程与关键量)

### S09.4.2 compute_velocity_fields_2LPT
- **所属子过程**：[S09.4 速度场与相对速度场](L2-subprocesses.md#s094-速度场与相对速度场)
- **作用与意义**：承担二阶修正：高精度扰动算法只在选用时生效。
- **承担者**：`InitialConditions.c` 的 `compute_velocity_fields_2LPT`、`compute_f_laplacian`（[源码](../../../src/py21cmfast/src/InitialConditions.c)）
- **关键过程**：二阶扰动修正（在参数选择二阶算法时启用）。
- **下一层**：见 [L4 · S09.4.2](L4-key-processes.md#s0942-a-关键过程与关键量)

### S09.4.3 compute_relative_velocities
- **所属子过程**：[S09.4 速度场与相对速度场](L2-subprocesses.md#s094-速度场与相对速度场)
- **作用与意义**：承担重子与暗物质的速度差：相对速度效应的输入。
- **承担者**：`InitialConditions.c` 的 `compute_relative_velocities`（[源码](../../../src/py21cmfast/src/InitialConditions.c)）
- **关键过程**：重子与暗物质的速度差场（在启用相对速度时产出）。
- **下一层**：见 [L4 · S09.4.3](L4-key-processes.md#s0943-a-关键过程与关键量)

### S09.5 初始条件的顶层编排与资源回收
- **计算单元**：[S09.5.1](#s0951-computeinitialconditions)、[S09.5.2](#s0952-resample_index)

### S09.5.1 ComputeInitialConditions
- **所属子过程**：[S09.5 初始条件的顶层编排与资源回收](L2-subprocesses.md#s095-初始条件的顶层编排与资源回收)
- **作用与意义**：承担初始条件的顶层编排：抽样、变换、滤波与降采样在此收口。
- **承担者**：`InitialConditions.c` 的 `ComputeInitialConditions`（[源码](../../../src/py21cmfast/src/InitialConditions.c)）
- **关键过程**：串起抽样、变换、滤波与降采样，写出高低分辨密度与速度，并回收随机数环境。
- **下一层**：见 [L4 · S09.5.1](L4-key-processes.md#s0951-a-关键过程与关键量)

### S09.5.2 resample_index
- **所属子过程**：[S09.5 初始条件的顶层编排与资源回收](L2-subprocesses.md#s095-初始条件的顶层编排与资源回收)
- **作用与意义**：承担高低分辨的索引对应：降采样是否正确全看这一层映射。
- **承担者**：`indexing.c` 的 `resample_index`（[源码](../../../src/py21cmfast/src/indexing.c)）
- **关键过程**：高分辨到低分辨的索引对应关系。
- **下一层**：见 [L4 · S09.5.2](L4-key-processes.md#s0952-a-关键过程与关键量)

---

## S10 微扰场与速度

> 后端：本阶段的产物是 [P03 微扰场](L0-pipeline.md#p03-微扰场)。关键过程与关键量见 [CODE_TOPOLOGY.md §微扰场与速度](../CODE_TOPOLOGY.md#微扰场与速度)。

### S10.1 傅里叶空间滤波工具
- **计算单元**：[S10.1.1](#s1011-filter_function)

### S10.1.1 filter_function
- **所属子过程**：[S10.1 傅里叶空间滤波工具](L2-subprocesses.md#s101-傅里叶空间滤波工具)
- **作用与意义**：承担窗函数的定义：所有尺度选择最终都落到这一族函数上。
- **承担者**：`filtering.c` 的窗函数族与 `test_filter`（[源码](../../../src/py21cmfast/src/filtering.c)）
- **关键过程**：提供实空间顶帽、锐 k、高斯、模糊暗物质、平均自由程、球壳等窗函数。
- **下一层**：见 [L4 · S10.1.1](L4-key-processes.md#s1011-a-关键过程与关键量)

### S10.2 密度场构造与质量位移
- **计算单元**：[S10.2.1](#s1021-make_density_grid)、[S10.2.2](#s1022-move_grid_masses)

### S10.2.1 make_density_grid
- **所属子过程**：[S10.2 密度场构造与质量位移](L2-subprocesses.md#s102-密度场构造与质量位移)
- **作用与意义**：承担把初始场推到目标红移：微扰场的密度部分由它给出。
- **承担者**：`PerturbedField.c` 的 `make_density_grid`（[源码](../../../src/py21cmfast/src/PerturbedField.c)）
- **关键过程**：按扰动算法把初始场推到目标红移；内部调用质量位移。
- **下一层**：见 [L4 · S10.2.1](L4-key-processes.md#s1021-a-关键过程与关键量)

### S10.2.2 move_grid_masses
- **所属子过程**：[S10.2 密度场构造与质量位移](L2-subprocesses.md#s102-密度场构造与质量位移)
- **作用与意义**：承担质量搬运的算子：扰动算法里最核心的一步。
- **承担者**：`map_mass.c` 的 `move_grid_masses` 与云中云插值族（[源码](../../../src/py21cmfast/src/map_mass.c)）
- **关键过程**：把质量按位移场搬运到新位置（云中云加权）。
- **下一层**：见 [L4 · S10.2.2](L4-key-processes.md#s1022-a-关键过程与关键量)

### S10.3 降采样与过密度归一化
- **计算单元**：[S10.3.1](#s1031-assign_to_lowres_grid)、[S10.3.2](#s1032-normalise_delta_grid)

### S10.3.1 assign_to_lowres_grid
- **所属子过程**：[S10.3 降采样与过密度归一化](L2-subprocesses.md#s103-降采样与过密度归一化)
- **作用与意义**：承担高分辨到低分辨的归并：计算网格上的密度由此得到。
- **承担者**：`PerturbedField.c` 的 `assign_to_lowres_grid`（[源码](../../../src/py21cmfast/src/PerturbedField.c)）
- **关键过程**：高分辨密度向低分辨网格的归并（含非立方拉伸）。
- **下一层**：见 [L4 · S10.3.1](L4-key-processes.md#s1031-a-关键过程与关键量)

### S10.3.2 normalise_delta_grid
- **所属子过程**：[S10.3 降采样与过密度归一化](L2-subprocesses.md#s103-降采样与过密度归一化)
- **作用与意义**：承担量纲与口径的统一：密度对比的零点在这里定死。
- **承担者**：`PerturbedField.c` 的 `normalise_delta_grid`（[源码](../../../src/py21cmfast/src/PerturbedField.c)）
- **关键过程**：把密度换算成相对平均的对比并强制零均值。
- **下一层**：见 [L4 · S10.3.2](L4-key-processes.md#s1032-a-关键过程与关键量)

### S10.4 平滑与裁剪
- **计算单元**：[S10.4.1](#s1041-smooth_and_clip_density)

### S10.4.1 smooth_and_clip_density
- **所属子过程**：[S10.4 平滑与裁剪](L2-subprocesses.md#s104-平滑与裁剪)
- **作用与意义**：承担尺度平滑与下限裁剪：后续积分不会因极端值失真。
- **承担者**：`PerturbedField.c` 的 `smooth_and_clip_density`（[源码](../../../src/py21cmfast/src/PerturbedField.c)）
- **关键过程**：按可选尺度平滑，并把过度负值裁剪到物理下限。
- **下一层**：见 [L4 · S10.4.1](L4-key-processes.md#s1041-a-关键过程与关键量)

### S10.5 微扰速度场
- **计算单元**：[S10.5.1](#s1051-compute_perturbed_velocities)

### S10.5.1 compute_perturbed_velocities
- **所属子过程**：[S10.5 微扰速度场](L2-subprocesses.md#s105-微扰速度场)
- **作用与意义**：承担该红移的速度分量：晕位移与光学深度修正都取它。
- **承担者**：`PerturbedField.c` 的 `compute_perturbed_velocities`（[源码](../../../src/py21cmfast/src/PerturbedField.c)）
- **关键过程**：给出该红移的速度分量（横轴分量按开关决定是否保留）。
- **下一层**：见 [L4 · S10.5.1](L4-key-processes.md#s1051-a-关键过程与关键量)

### S10.6 微扰场的顶层编排
- **计算单元**：[S10.6.1](#s1061-computeperturbedfield)

### S10.6.1 ComputePerturbedField
- **所属子过程**：[S10.6 微扰场的顶层编排](L2-subprocesses.md#s106-微扰场的顶层编排)
- **作用与意义**：承担微扰场的顶层编排：一个产物由三个子步骤收口而成。
- **承担者**：`PerturbedField.c` 的 `ComputePerturbedField`（[源码](../../../src/py21cmfast/src/PerturbedField.c)）
- **关键过程**：串起密度构造、降采样、平滑与速度，写出 [P03 微扰场](L0-pipeline.md#p03-微扰场)。
- **下一层**：见 [L4 · S10.6.1](L4-key-processes.md#s1061-a-关键过程与关键量)

---

## S11 晕目录与位移

> 后端：本阶段的产物是 [P04 晕目录](L0-pipeline.md#p04-晕目录) 与 [P05 微扰晕目录](L0-pipeline.md#p05-微扰晕目录)。关键过程与关键量见 [CODE_TOPOLOGY.md §晕目录与位移](../CODE_TOPOLOGY.md#晕目录与位移)。

### S11.1 网格晕识别
- **计算单元**：[S11.1.1](#s1111-computehalocatalog)、[S11.1.2](#s1112-check_halo)

### S11.1.1 ComputeHaloCatalog
- **所属子过程**：[S11.1 网格晕识别](L2-subprocesses.md#s111-网格晕识别)
- **作用与意义**：承担晕目录的产生：离散晕的位置、质量与随机数都出自它。
- **承担者**：`HaloCatalog.c` 的 `ComputeHaloCatalog`（[源码](../../../src/py21cmfast/src/HaloCatalog.c)）
- **关键过程**：从大到小递减滤波半径扫过网格标出晕，或改走随机采样路径；随后给出晕坐标与属性。
- **下一层**：见 [L4 · S11.1.1](L4-key-processes.md#s1111-a-关键过程与关键量)

### S11.1.2 check_halo
- **所属子过程**：[S11.1 网格晕识别](L2-subprocesses.md#s111-网格晕识别)
- **作用与意义**：承担晕的重叠与禁区判定：避免同一个晕被数两次。
- **承担者**：`HaloCatalog.c` 的 `check_halo`、`pixel_in_halo`（[源码](../../../src/py21cmfast/src/HaloCatalog.c)）
- **关键过程**：判定候选格点是否已落在更大的晕或禁区中，避免重复计数。
- **下一层**：见 [L4 · S11.1.2](L4-key-processes.md#s1112-a-关键过程与关键量)

### S11.2 随机晕采样
- **计算单元**：[S11.2.1](#s1121-stochastic_halofield)、[S11.2.2](#s1122-add_properties_cat)

### S11.2.1 stochastic_halofield
- **所属子过程**：[S11.2 随机晕采样](L2-subprocesses.md#s112-随机晕采样)
- **作用与意义**：承担随机采样的主循环：源项带上随机性靠的是它。
- **承担者**：`Stochasticity.c` 的 `stochastic_halofield`、`expected_nhalo`（[源码](../../../src/py21cmfast/src/Stochasticity.c)）
- **关键过程**：按条件质量函数的期望晕数在格点内做随机抽样，产生离散晕。
- **下一层**：见 [L4 · S11.2.1](L4-key-processes.md#s1121-a-关键过程与关键量)

### S11.2.2 add_properties_cat
- **所属子过程**：[S11.2 随机晕采样](L2-subprocesses.md#s112-随机晕采样)
- **作用与意义**：承担给晕补属性：恒星、形成率与 X 射线的随机源在这里挂上。
- **承担者**：`Stochasticity.c` 的 `add_properties_cat`、`single_test_sample`（[源码](../../../src/py21cmfast/src/Stochasticity.c)）
- **关键过程**：给每个抽样晕补上质量与各类随机数（供恒星、形成率、X 射线散射使用）。
- **下一层**：见 [L4 · S11.2.2](L4-key-processes.md#s1122-a-关键过程与关键量)

### S11.3 晕位置的速度位移
- **计算单元**：[S11.3.1](#s1131-computeperturbedhalocatalog)、[S11.3.2](#s1132-wrap_position)

### S11.3.1 ComputePerturbedHaloCatalog
- **所属子过程**：[S11.3 晕位置的速度位移](L2-subprocesses.md#s113-晕位置的速度位移)
- **作用与意义**：承担晕位移与属性补全：位移后的坐标与辐射属性由它给出。
- **承担者**：`PerturbedHaloCatalog.c` 的 `ComputePerturbedHaloCatalog`（[源码](../../../src/py21cmfast/src/PerturbedHaloCatalog.c)）
- **关键过程**：按增长因子算出一阶/二阶位移因子，把晕坐标推到目标红移，并补上恒星/形成率/电离与 X 射线属性。
- **下一层**：见 [L4 · S11.3.1](L4-key-processes.md#s1131-a-关键过程与关键量)

### S11.3.2 wrap_position
- **所属子过程**：[S11.3 晕位置的速度位移](L2-subprocesses.md#s113-晕位置的速度位移)
- **作用与意义**：承担位移后的坐标回卷：越界处理错一处就会造出假晕。
- **承担者**：`indexing.c` 的 `wrap_position`、`wrap_coord` 与网格索引宏（[源码](../../../src/py21cmfast/src/indexing.c)）
- **关键过程**：位移后越界的坐标回卷，并转成网格索引。
- **下一层**：见 [L4 · S11.3.2](L4-key-processes.md#s1132-a-关键过程与关键量)

### S11.4 质量与属性到欧拉网格的映射
- **计算单元**：[S11.4.1](#s1141-move_halo_galprops)

### S11.4.1 move_halo_galprops
- **所属子过程**：[S11.4 质量与属性到欧拉网格的映射](L2-subprocesses.md#s114-质量与属性到欧拉网格的映射)
- **作用与意义**：承担离散属性到网格的搬运：离散晕与网格源项之间的桥。
- **承担者**：`map_mass.c` 的 `move_halo_galprops`、`move_grid_galprops`、`set_halo_properties`、`convert_halo_props`（[源码](../../../src/py21cmfast/src/map_mass.c)）
- **关键过程**：把离散晕的属性按质量权重摊到网格上。
- **下一层**：见 [L4 · S11.4.1](L4-key-processes.md#s1141-a-关键过程与关键量)

---

## S12 天体物理源

> 后端：本阶段的产物是 [P06 源项网格](L0-pipeline.md#p06-源项网格)。关键过程与关键量见 [CODE_TOPOLOGY.md §天体物理源](../CODE_TOPOLOGY.md#天体物理源)。

### S12.1 星系标度关系与散射
- **计算单元**：[S12.1.1](#s1211-set_scaling_constants)、[S12.1.2](#s1212-lyman_werner_threshold)

### S12.1.1 set_scaling_constants
- **所属子过程**：[S12.1 星系标度关系与散射](L2-subprocesses.md#s121-星系标度关系与散射)
- **作用与意义**：承担标度关系的装配：晕属性到星系属性的换算在此定型。
- **承担者**：`scaling_relations.c` 的 `set_scaling_constants` 与晕质量→恒星质量/形成率/金属性/X 射线各函数（[源码](../../../src/py21cmfast/src/scaling_relations.c)）
- **关键过程**：把天体物理参数折算成"晕属性 → 星系属性"的换算核，供源项与积分复用。
- **下一层**：见 [L4 · S12.1.1](L4-key-processes.md#s1211-a-关键过程与关键量)

### S12.1.2 lyman_werner_threshold
- **所属子过程**：[S12.1 星系标度关系与散射](L2-subprocesses.md#s121-星系标度关系与散射)
- **作用与意义**：承担两类源的质量下限：反馈强度如何改变源的质量门槛由它决定。
- **承担者**：`thermochem.c` 的 `lyman_werner_threshold`（含分子冷却阈值的构造）、`atomic_cooling_threshold`（[源码](../../../src/py21cmfast/src/thermochem.c)）
- **关键过程**：按 Lyman-Werner 强度与再电离反馈给出两类源的质量下限。
- **下一层**：见 [L4 · S12.1.2](L4-key-processes.md#s1212-a-关键过程与关键量)

### S12.2 源项网格化
- **计算单元**：[S12.2.1](#s1221-computehalobox)、[S12.2.2](#s1222-sum_halos_onto_grid)、[S12.2.3](#s1223-set_fixed_grids)

### S12.2.1 ComputeHaloBox
- **所属子过程**：[S12.2 源项网格化](L2-subprocesses.md#s122-源项网格化)
- **作用与意义**：承担源项网格的产生：两条源模型路径在此分流。
- **承担者**：`HaloBox.c` 的 `ComputeHaloBox`（[源码](../../../src/py21cmfast/src/HaloBox.c)）
- **关键过程**：先清零源项网格，再按源模型选择"离散晕累加"或"条件积分表"两条路径。
- **下一层**：见 [L4 · S12.2.1](L4-key-processes.md#s1221-a-关键过程与关键量)

### S12.2.2 sum_halos_onto_grid
- **所属子过程**：[S12.2 源项网格化](L2-subprocesses.md#s122-源项网格化)
- **作用与意义**：承担逐晕累加：离散晕路径的全部实现。
- **承担者**：`HaloBox.c` 的 `sum_halos_onto_grid`（[源码](../../../src/py21cmfast/src/HaloBox.c)）
- **关键过程**：离散晕路径：逐晕算属性并累加到网格。
- **下一层**：见 [L4 · S12.2.2](L4-key-processes.md#s1222-a-关键过程与关键量)

### S12.2.3 set_fixed_grids
- **所属子过程**：[S12.2 源项网格化](L2-subprocesses.md#s122-源项网格化)
- **作用与意义**：承担条件积分路径：非离散晕模型中源项如何逐格点积出来。
- **承担者**：`HaloBox.c` 的 `set_fixed_grids`、`set_integral_constants`、`mean_fix_grids`；条件表在 `interp_tables.c`（[源码](../../../src/py21cmfast/src/HaloBox.c)）
- **关键过程**：条件积分路径：建条件表后逐格点积分得到源项，并取盒均值。
- **下一层**：见 [L4 · S12.2.3](L4-key-processes.md#s1223-a-关键过程与关键量)

### S12.3 光度函数诊断输出
- **计算单元**：[S12.3.1](#s1231-computelf)

### S12.3.1 ComputeLF
- **所属子过程**：[S12.3 光度函数诊断输出](L2-subprocesses.md#s123-光度函数诊断输出)
- **作用与意义**：承担光度函数诊断：与观测对照，而不推进主链。
- **承担者**：`LuminosityFunction.c` 的 `ComputeLF`（[源码](../../../src/py21cmfast/src/LuminosityFunction.c)）
- **关键过程**：在质量–红移网格上给出紫外光度函数，纯诊断、不参与主链。
- **下一层**：见 [L4 · S12.3.1](L4-key-processes.md#s1231-a-关键过程与关键量)

---

## S13 电离与复合

> 后端：本阶段的产物是 [P09 电离盒](L0-pipeline.md#p09-电离盒)。关键过程与关键量见 [CODE_TOPOLOGY.md §电离与复合](../CODE_TOPOLOGY.md#电离与复合)。

### S13.1 常数与尺度初始化
- **计算单元**：[S13.1.1](#s1311-set_ionbox_constants)、[S13.1.2](#s1312-setup_radii)、[S13.1.3](#s1313-allocate_fftw_grids)

### S13.1.1 set_ionbox_constants
- **所属子过程**：[S13.1 常数与尺度初始化](L2-subprocesses.md#s131-常数与尺度初始化)
- **作用与意义**：承担快照常数的打包：格点循环不必反复取参。
- **承担者**：`IonisationBox.c` 的 `set_ionbox_constants`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：把该快照用到的常数打包成一个结构，避免在格点循环里反复取参。
- **下一层**：见 [L4 · S13.1.1](L4-key-processes.md#s1311-a-关键过程与关键量)

### S13.1.2 setup_radii
- **所属子过程**：[S13.1 常数与尺度初始化](L2-subprocesses.md#s131-常数与尺度初始化)
- **作用与意义**：承担滤波半径序列：本快照扫哪些尺度由它决定。
- **承担者**：`IonisationBox.c` 的 `setup_radii`、`setup_first_z_prevbox`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：定出该快照要遍历的滤波半径序列，并为首次计算补齐上一快照的密度。
- **下一层**：见 [L4 · S13.1.2](L4-key-processes.md#s1312-a-关键过程与关键量)

### S13.1.3 allocate_fftw_grids
- **所属子过程**：[S13.1 常数与尺度初始化](L2-subprocesses.md#s131-常数与尺度初始化)
- **作用与意义**：承担变换网格的复用：逐尺度滤波不至于每次重新分配。
- **承担者**：`IonisationBox.c` 的 `allocate_fftw_grids`、`free_fftw_grids`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：为整箱滤波分配/回收可复用的变换网格。
- **下一层**：见 [L4 · S13.1.3](L4-key-processes.md#s1313-a-关键过程与关键量)

### S13.2 光子守恒红移校准的接入
- **计算单元**：[S13.2.1](#s1321-adjust_redshifts_for_photoncons)

### S13.2.1 adjust_redshifts_for_photoncons
- **所属子过程**：[S13.2 光子守恒红移校准的接入](L2-subprocesses.md#s132-光子守恒红移校准的接入)
- **作用与意义**：承担红移平移：电离历史的整体位置由它对齐解析结果。
- **承担者**：`photoncons.c` 的 `adjust_redshifts_for_photoncons`（[源码](../../../src/py21cmfast/src/photoncons.c)）
- **关键过程**：把本快照红移按校准曲线平移，并给出相应的密度增长修正。
- **下一层**：见 [L4 · S13.2.1](L4-key-processes.md#s1321-a-关键过程与关键量)

### S13.3 全局塌缩分数与中性提前退出
- **计算单元**：[S13.3.1](#s1331-set_mean_fcoll)、[S13.3.2](#s1332-nion_general)、[S13.3.3](#s1333-set_fully_neutral_box)

### S13.3.1 set_mean_fcoll
- **所属子过程**：[S13.3 全局塌缩分数与中性提前退出](L2-subprocesses.md#s133-全局塌缩分数与中性提前退出)
- **作用与意义**：承担全局量：电离光子期望与塌缩分数下限在此定出。
- **承担者**：`IonisationBox.c` 的 `set_mean_fcoll`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：先算全局量：平均塌缩分数、电离光子期望与两组塌缩分数下限。
- **下一层**：见 [L4 · S13.3.1](L4-key-processes.md#s1331-a-关键过程与关键量)

### S13.3.2 Nion_General
- **所属子过程**：[S13.3 全局塌缩分数与中性提前退出](L2-subprocesses.md#s133-全局塌缩分数与中性提前退出)
- **作用与意义**：承担全局积分的求值：电离是否启动的判据数值来自它。
- **承担者**：`hmf.c` 的 `Nion_General`、`Nion_General_MINI`、`Fcoll_General`（[源码](../../../src/py21cmfast/src/hmf.c)）
- **关键过程**：把质量函数在质量区间上积成全局电离光子数与塌缩分数。
- **下一层**：见 [L4 · S13.3.2](L4-key-processes.md#s1332-a-关键过程与关键量)

### S13.3.3 set_fully_neutral_box
- **所属子过程**：[S13.3 全局塌缩分数与中性提前退出](L2-subprocesses.md#s133-全局塌缩分数与中性提前退出)
- **作用与意义**：承担提前退出：省下后面全部计算，也是尚无电离源的显式表示。
- **承担者**：`IonisationBox.c` 的 `set_fully_neutral_box`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：判为尚无电离源时直接写出完全中性的盒并跳过后续。
- **下一层**：见 [L4 · S13.3.3](L4-key-processes.md#s1333-a-关键过程与关键量)

### S13.4 多尺度滤波与塌缩分数积分
- **计算单元**：[S13.4.1](#s1341-setup_integration_tables)、[S13.4.2](#s1342-prepare_box_for_filtering)、[S13.4.3](#s1343-calculate_fcoll_grid)、[S13.4.4](#s1344-initialise_nion_conditional_spline)、[S13.4.5](#s1345-calculate_mcrit_boxes)

### S13.4.1 setup_integration_tables
- **所属子过程**：[S13.4 多尺度滤波与塌缩分数积分](L2-subprocesses.md#s134-多尺度滤波与塌缩分数积分)
- **作用与意义**：承担条件积分表的准备：逐尺度判据能否成立的前提。
- **承担者**：`IonisationBox.c` 的 `setup_integration_tables`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：在非拉格朗日源网格路径下，逐半径准备条件积分所需的表。
- **下一层**：见 [L4 · S13.4.1](L4-key-processes.md#s1341-a-关键过程与关键量)

### S13.4.2 prepare_box_for_filtering
- **所属子过程**：[S13.4 多尺度滤波与塌缩分数积分](L2-subprocesses.md#s134-多尺度滤波与塌缩分数积分)
- **作用与意义**：承担滤波前的变换准备与复用：半径循环快慢的关键。
- **承担者**：`IonisationBox.c` 的 `prepare_box_for_filtering`、`copy_filter_transform`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：把密度场搬到傅里叶空间，并在半径循环中复用同一份变换。
- **下一层**：见 [L4 · S13.4.2](L4-key-processes.md#s1342-a-关键过程与关键量)

### S13.4.3 calculate_fcoll_grid
- **所属子过程**：[S13.4 多尺度滤波与塌缩分数积分](L2-subprocesses.md#s134-多尺度滤波与塌缩分数积分)
- **作用与意义**：承担逐格点塌缩分数：电离判据的逐格点输入。
- **承担者**：`IonisationBox.c` 的 `calculate_fcoll_grid`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：逐格点在当前尺度上积分塌缩分数，得到该尺度的电离判据输入。
- **下一层**：见 [L4 · S13.4.3](L4-key-processes.md#s1343-a-关键过程与关键量)

### S13.4.4 initialise_Nion_Conditional_spline
- **所属子过程**：[S13.4 多尺度滤波与塌缩分数积分](L2-subprocesses.md#s134-多尺度滤波与塌缩分数积分)
- **作用与意义**：承担条件表的表格化：把积分结果变成可重复查询的样条。
- **承担者**：`interp_tables.c` 的条件积分表族（光子数条件样条、塌缩分数–密度表等）（[源码](../../../src/py21cmfast/src/interp_tables.c)）
- **关键过程**：把"给定局部密度与尺度"的积分结果预先表格化并做样条求值。
- **下一层**：见 [L4 · S13.4.4](L4-key-processes.md#s1344-a-关键过程与关键量)

### S13.4.5 calculate_mcrit_boxes
- **所属子过程**：[S13.4 多尺度滤波与塌缩分数积分](L2-subprocesses.md#s134-多尺度滤波与塌缩分数积分)
- **作用与意义**：承担逐格点质量下限：源项质量门槛随位置变化时的输入。
- **承担者**：`IonisationBox.c` 的 `calculate_mcrit_boxes`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：当源项质量下限随位置变化时，为每格点算出两类源的质量下限。
- **下一层**：见 [L4 · S13.4.5](L4-key-processes.md#s1345-a-关键过程与关键量)

### S13.5 游程集电离判据与气泡标记
- **计算单元**：[S13.5.1](#s1351-computeionizedbox)、[S13.5.2](#s1352-find_ionised_regions)、[S13.5.3](#s1353-update_in_sphere)

### S13.5.1 ComputeIonizedBox
- **所属子过程**：[S13.5 游程集电离判据与气泡标记](L2-subprocesses.md#s135-游程集电离判据与气泡标记)
- **作用与意义**：承担电离与复合的顶层编排：本阶段全部子步骤在此收口。
- **承担者**：`IonisationBox.c` 的 `ComputeIonizedBox`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：本阶段顶层入口，串起常数、校准、滤波、判据、复合与温度各步。
- **下一层**：见 [L4 · S13.5.1](L4-key-processes.md#s1351-a-关键过程与关键量)

### S13.5.2 find_ionised_regions
- **所属子过程**：[S13.5 游程集电离判据与气泡标记](L2-subprocesses.md#s135-游程集电离判据与气泡标记)
- **作用与意义**：承担游程集判据：气泡与中性区的划分在这里完成。
- **承担者**：`IonisationBox.c` 的 `find_ionised_regions`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：对每个过阈值的源做整球标记，累加各格点被覆盖的电离光子数，得到中性分数。
- **下一层**：见 [L4 · S13.5.2](L4-key-processes.md#s1352-a-关键过程与关键量)

### S13.5.3 update_in_sphere
- **所属子过程**：[S13.5 游程集电离判据与气泡标记](L2-subprocesses.md#s135-游程集电离判据与气泡标记)
- **作用与意义**：承担球内遍历与判据检查：气泡标记的算子实现。
- **承担者**：`bubble_helper_progs.c` 的 `update_in_sphere`、`check_region`（[源码](../../../src/py21cmfast/src/bubble_helper_progs.c)）
- **关键过程**：球内格点的几何遍历与判据检查，是气泡标记的算子实现。
- **下一层**：见 [L4 · S13.5.3](L4-key-processes.md#s1353-a-关键过程与关键量)

### S13.6 复合与自屏蔽
- **计算单元**：[S13.6.1](#s1361-init_mhr)、[S13.6.2](#s1362-splined_recombination_rate)、[S13.6.3](#s1363-set_recombination_rates)

### S13.6.1 init_MHR
- **所属子过程**：[S13.6 复合与自屏蔽](L2-subprocesses.md#s136-复合与自屏蔽)
- **作用与意义**：承担复合模板的构建：非均匀复合功能的前提。
- **承担者**：`recombinations.c` 的 `init_MHR`（[源码](../../../src/py21cmfast/src/recombinations.c)）
- **关键过程**：构建复合与自屏蔽所需的模板（仅在启用非均匀复合时）。
- **下一层**：见 [L4 · S13.6.1](L4-key-processes.md#s1361-a-关键过程与关键量)

### S13.6.2 splined_recombination_rate
- **所属子过程**：[S13.6 复合与自屏蔽](L2-subprocesses.md#s136-复合与自屏蔽)
- **作用与意义**：承担逐格点复合率：含自屏蔽的损耗在这里算出。
- **承担者**：`recombinations.c` 的 `splined_recombination_rate`、`Gamma_SS`、`recombination_rate`（[源码](../../../src/py21cmfast/src/recombinations.c)）
- **关键过程**：给出逐格点的复合率（含自屏蔽抑制）。
- **下一层**：见 [L4 · S13.6.2](L4-key-processes.md#s1362-a-关键过程与关键量)

### S13.6.3 set_recombination_rates
- **所属子过程**：[S13.6 复合与自屏蔽](L2-subprocesses.md#s136-复合与自屏蔽)
- **作用与意义**：承担把复合写回产物：累计复合量在此累积。
- **承担者**：`IonisationBox.c` 的 `set_recombination_rates`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：把复合率写进电离盒，并累积到累计复合量。
- **下一层**：见 [L4 · S13.6.3](L4-key-processes.md#s1363-a-关键过程与关键量)

### S13.7 电离区温度赋值
- **计算单元**：[S13.7.1](#s1371-set_ionized_temperatures)、[S13.7.2](#s1372-computefullyionizedtemperature)

### S13.7.1 set_ionized_temperatures
- **所属子过程**：[S13.7 电离区温度赋值](L2-subprocesses.md#s137-电离区温度赋值)
- **作用与意义**：承担温度赋值：两类区域分别给温度，供下一阶段使用。
- **承担者**：`IonisationBox.c` 的 `set_ionized_temperatures`（[源码](../../../src/py21cmfast/src/IonisationBox.c)）
- **关键过程**：对完全电离与部分电离两类格点分别给出动理学温度。
- **下一层**：见 [L4 · S13.7.1](L4-key-processes.md#s1371-a-关键过程与关键量)

### S13.7.2 ComputeFullyIonizedTemperature
- **所属子过程**：[S13.7 电离区温度赋值](L2-subprocesses.md#s137-电离区温度赋值)
- **作用与意义**：承担两类区域的温度解：电离区温度不是任取的数。
- **承担者**：`thermochem.c` 的 `ComputeFullyIonizedTemperature`、`ComputePartiallyIonizedTemperature`（[源码](../../../src/py21cmfast/src/thermochem.c)）
- **关键过程**：用热化学平衡给出两类区域的温度解。
- **下一层**：见 [L4 · S13.7.2](L4-key-processes.md#s1372-a-关键过程与关键量)

---

## S14 热与自旋温度

> 后端：本阶段的产物是 [P07 X 射线源箱](L0-pipeline.md#p07-x-射线源箱) 与 [P08 自旋温度盒](L0-pipeline.md#p08-自旋温度盒)。关键过程与关键量见 [CODE_TOPOLOGY.md §热与自旋温度](../CODE_TOPOLOGY.md#热与自旋温度)。

### S14.1 初始化与红移壳层几何
- **计算单元**：[S14.1.1](#s1411-alloc_global_arrays)、[S14.1.2](#s1412-setup_z_edges)、[S14.1.3](#s1413-init_heat)

### S14.1.1 alloc_global_arrays
- **所属子过程**：[S14.1 初始化与红移壳层几何](L2-subprocesses.md#s141-初始化与红移壳层几何)
- **作用与意义**：承担跨快照全局数组：热阶段能连续演化的前提。
- **承担者**：`SpinTemperatureBox.c` 的 `alloc_global_arrays`（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：分配跨快照复用的全局数组（只在首次调用时）。
- **下一层**：见 [L4 · S14.1.1](L4-key-processes.md#s1411-a-关键过程与关键量)

### S14.1.2 setup_z_edges
- **所属子过程**：[S14.1 初始化与红移壳层几何](L2-subprocesses.md#s141-初始化与红移壳层几何)
- **作用与意义**：承担壳层几何与无光早退：红移切分方式由它定，也是高红移省算力的地方。
- **承担者**：`SpinTemperatureBox.c` 的 `setup_z_edges`、`init_first_Ts`（含高红移早退）（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：把上一快照到本快照之间切成若干壳层；红移过高时直接给出无光初值。
- **下一层**：见 [L4 · S14.1.2](L4-key-processes.md#s1412-a-关键过程与关键量)

### S14.1.3 init_heat
- **所属子过程**：[S14.1 初始化与红移壳层几何](L2-subprocesses.md#s141-初始化与红移壳层几何)
- **作用与意义**：承担能量沉积表的读入：次级电子如何分配能量全靠它。
- **承担者**：`heating_helper_progs.c` 的 `init_heat`（[源码](../../../src/py21cmfast/src/heating_helper_progs.c)）
- **关键过程**：读入次级电子能量沉积表、准备频率积分所需的容器（只做一次）。
- **下一层**：见 [L4 · S14.1.3](L4-key-processes.md#s1413-a-关键过程与关键量)

### S14.2 Lyman 谱系光子预因子
- **计算单元**：[S14.2.1](#s1421-calculate_spectral_factors)、[S14.2.2](#s1422-frecycle)、[S14.2.3](#s1423-spectral_emissivity)

### S14.2.1 calculate_spectral_factors
- **所属子过程**：[S14.2 Lyman 谱系光子预因子](L2-subprocesses.md#s142-lyman-谱系光子预因子)
- **作用与意义**：承担 Lyman 光子预因子：Lyα 耦合强度的前提。
- **承担者**：`SpinTemperatureBox.c` 的 `calculate_spectral_factors`（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：为各 Lyman 跃迁准备光子预因子（依赖再循环系数与能级布居）。
- **下一层**：见 [L4 · S14.2.1](L4-key-processes.md#s1421-a-关键过程与关键量)

### S14.2.2 frecycle
- **所属子过程**：[S14.2 Lyman 谱系光子预因子](L2-subprocesses.md#s142-lyman-谱系光子预因子)
- **作用与意义**：承担再循环系数与频率表：光子被吸收后再发射的数目由它给出。
- **承担者**：`heating_helper_progs.c` 的 `frecycle`、`nu_n`（[源码](../../../src/py21cmfast/src/heating_helper_progs.c)）
- **关键过程**：各能级的再循环系数与频率表。
- **下一层**：见 [L4 · S14.2.2](L4-key-processes.md#s1422-a-关键过程与关键量)

### S14.2.3 spectral_emissivity
- **所属子过程**：[S14.2 Lyman 谱系光子预因子](L2-subprocesses.md#s142-lyman-谱系光子预因子)
- **作用与意义**：承担源谱的发射率与散射修正：把源项翻译成 Lyman 频率上的可用光子。
- **承担者**：`heating_helper_progs.c` 的 `spectral_emissivity`、`Salpha_tilde`、`xalpha_tilde`（[源码](../../../src/py21cmfast/src/heating_helper_progs.c)）
- **关键过程**：源谱在 Lyman 频率上的发射率与散射修正因子。
- **下一层**：见 [L4 · S14.2.3](L4-key-processes.md#s1423-a-关键过程与关键量)

### S14.3 源场多尺度滤波与全局电离历史
- **计算单元**：[S14.3.1](#s1431-updatexraysourcebox)、[S14.3.2](#s1432-one_annular_filter)、[S14.3.3](#s1433-global_reion_properties)、[S14.3.4](#s1434-initialise_sfrd_spline)、[S14.3.5](#s1435-calculate_sfrd_from_grid)

### S14.3.1 UpdateXraySourceBox
- **所属子过程**：[S14.3 源场多尺度滤波与全局电离历史](L2-subprocesses.md#s143-源场多尺度滤波与全局电离历史)
- **作用与意义**：承担环状滤波源箱：一个半径一张切片，X 射线源场的形态由它形成。
- **承担者**：`SpinTemperatureBox.c` 的 `UpdateXraySourceBox`（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：为给定内/外半径做环状滤波，产出 [P07 X 射线源箱](L0-pipeline.md#p07-x-射线源箱) 的一个半径切片。
- **下一层**：见 [L4 · S14.3.1](L4-key-processes.md#s1431-a-关键过程与关键量)

### S14.3.2 one_annular_filter
- **所属子过程**：[S14.3 源场多尺度滤波与全局电离历史](L2-subprocesses.md#s143-源场多尺度滤波与全局电离历史)
- **作用与意义**：承担环上的球平均：把源项变成来自该壳层的贡献。
- **承担者**：`SpinTemperatureBox.c` 的 `one_annular_filter`（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：两个半径之差构成的环上做球平均，得到"来自该壳层"的贡献。
- **下一层**：见 [L4 · S14.3.2](L4-key-processes.md#s1432-a-关键过程与关键量)

### S14.3.3 global_reion_properties
- **所属子过程**：[S14.3 源场多尺度滤波与全局电离历史](L2-subprocesses.md#s143-源场多尺度滤波与全局电离历史)
- **作用与意义**：承担全局电离历史：热阶段的全局输入。
- **承担者**：`SpinTemperatureBox.c` 的 `global_reion_properties`（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：给出该红移的全局电离历史（填充因子、平均电子分数等）。
- **下一层**：见 [L4 · S14.3.3](L4-key-processes.md#s1433-a-关键过程与关键量)

### S14.3.4 initialise_SFRD_spline
- **所属子过程**：[S14.3 源场多尺度滤波与全局电离历史](L2-subprocesses.md#s143-源场多尺度滤波与全局电离历史)
- **作用与意义**：承担红移依赖的样条：把源随红移的变化变成可查询的表。
- **承担者**：`interp_tables.c` 的 `initialise_SFRD_spline`、`initialise_Nion_Ts_spline`（[源码](../../../src/py21cmfast/src/interp_tables.c)）
- **关键过程**：把恒星形成率与电离光子的红移依赖做成样条。
- **下一层**：见 [L4 · S14.3.4](L4-key-processes.md#s1434-a-关键过程与关键量)

### S14.3.5 calculate_sfrd_from_grid
- **所属子过程**：[S14.3 源场多尺度滤波与全局电离历史](L2-subprocesses.md#s143-源场多尺度滤波与全局电离历史)
- **作用与意义**：承担从网格统计全局量：拉格朗日源网格路径的全局输入。
- **承担者**：`SpinTemperatureBox.c` 的 `calculate_sfrd_from_grid`（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：从源项网格统计出恒星形成率密度（拉格朗日源网格路径）。
- **下一层**：见 [L4 · S14.3.5](L4-key-processes.md#s1435-a-关键过程与关键量)

### S14.4 X 射线连续谱频率积分表
- **计算单元**：[S14.4.1](#s1441-fill_freqint_tables)、[S14.4.2](#s1442-integrate_over_nu)、[S14.4.3](#s1443-set_zp_consts)

### S14.4.1 fill_freqint_tables
- **所属子过程**：[S14.4 X 射线连续谱频率积分表](L2-subprocesses.md#s144-x-射线连续谱频率积分表)
- **作用与意义**：承担频率积分表：逐格点不必重复做频率积分。
- **承担者**：`SpinTemperatureBox.c` 的 `fill_freqint_tables`（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：对每个壳层把 X 射线谱在频率上积分成加热/电离/Lyman 三类系数。
- **下一层**：见 [L4 · S14.4.1](L4-key-processes.md#s1441-a-关键过程与关键量)

### S14.4.2 integrate_over_nu
- **所属子过程**：[S14.4 X 射线连续谱频率积分表](L2-subprocesses.md#s144-x-射线连续谱频率积分表)
- **作用与意义**：承担沿频率的沉积积分：X 射线能量最终去哪由它决定。
- **承担者**：`heating_helper_progs.c` 的 `integrate_over_nu`、`tauX`、`nu_tau_one`（[源码](../../../src/py21cmfast/src/heating_helper_progs.c)）
- **关键过程**：沿频率的衰减与沉积积分，含单位光深的频率位置。
- **下一层**：见 [L4 · S14.4.2](L4-key-processes.md#s1442-a-关键过程与关键量)

### S14.4.3 set_zp_consts
- **所属子过程**：[S14.4 X 射线连续谱频率积分表](L2-subprocesses.md#s144-x-射线连续谱频率积分表)
- **作用与意义**：承担壳层常数打包：格点循环的输入容器。
- **承担者**：`SpinTemperatureBox.c` 的 `set_zp_consts`（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：把该壳层的参数打包成结构，供格点循环直接使用。
- **下一层**：见 [L4 · S14.4.3](L4-key-processes.md#s1443-a-关键过程与关键量)

### S14.5 加热与电离辐射率箱累积
- **计算单元**：[S14.5.1](#s1451-ts_main)

### S14.5.1 ts_main
- **所属子过程**：[S14.5 加热与电离辐射率箱累积](L2-subprocesses.md#s145-加热与电离辐射率箱累积)
- **作用与意义**：承担辐射率箱的累积：自旋温度求解的全部输入在此形成。
- **承担者**：`SpinTemperatureBox.c` 的 `ts_main`（其半径/壳层循环与逐格点累加段）（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：把每个壳层的贡献累加成逐格点的加热率、电离率与 Lyman 各系列辐射率。
- **下一层**：见 [L4 · S14.5.1](L4-key-processes.md#s1451-a-关键过程与关键量)

### S14.6 逐格点自旋温度演化
- **计算单元**：[S14.6.1](#s1461-get_ts)、[S14.6.2](#s1462-get_ts_fast)、[S14.6.3](#s1463-xcoll_hi)

### S14.6.1 get_Ts
- **所属子过程**：[S14.6 逐格点自旋温度演化](L2-subprocesses.md#s146-逐格点自旋温度演化)
- **作用与意义**：承担单点自旋温度的求解：Lyα 与碰撞耦合如何合成一个温度。
- **承担者**：`heating_helper_progs.c` 的 `get_Ts`（[源码](../../../src/py21cmfast/src/heating_helper_progs.c)）
- **关键过程**：解出单点的自旋温度与电子分数（含 Lyα 与碰撞耦合）。
- **下一层**：见 [L4 · S14.6.1](L4-key-processes.md#s1461-a-关键过程与关键量)

### S14.6.2 get_Ts_fast
- **所属子过程**：[S14.6 逐格点自旋温度演化](L2-subprocesses.md#s146-逐格点自旋温度演化)
- **作用与意义**：承担把求解嵌进格点循环：温度、电离度与动理学温度在此落格。
- **承担者**：`SpinTemperatureBox.c` 的 `get_Ts_fast`（[源码](../../../src/py21cmfast/src/SpinTemperatureBox.c)）
- **关键过程**：把单点求解嵌进格点循环，并写入自旋温度、电离度与动理学温度。
- **下一层**：见 [L4 · S14.6.2](L4-key-processes.md#s1462-a-关键过程与关键量)

### S14.6.3 xcoll_HI
- **所属子过程**：[S14.6 逐格点自旋温度演化](L2-subprocesses.md#s146-逐格点自旋温度演化)
- **作用与意义**：承担碰撞耦合系数：低温高密度时信号主要由它决定。
- **承担者**：`heating_helper_progs.c` 的碰撞耦合系数族与有效温度修正（[源码](../../../src/py21cmfast/src/heating_helper_progs.c)）
- **关键过程**：氢原子与电子/质子/氢原子的碰撞退激发率。
- **下一层**：见 [L4 · S14.6.3](L4-key-processes.md#s1463-a-关键过程与关键量)

### S14.7 热化学率系数与光电截面
- **计算单元**：[S14.7.1](#s1471-thermochemc-率系数)、[S14.7.2](#s1472-interp_fheat)

### S14.7.1 thermochem.c 率系数
- **所属子过程**：[S14.7 热化学率系数与光电截面](L2-subprocesses.md#s147-热化学率系数与光电截面)
- **作用与意义**：承担原子物理系数：电离、复合与冷却共用同一套率，避免两条路打架。
- **承担者**：`thermochem.c` 的复合/电离/冷却率系数族与光电截面（[源码](../../../src/py21cmfast/src/thermochem.c)）
- **关键过程**：被 S13、S14 反复引用的原子物理率系数。
- **下一层**：见 [L4 · S14.7.1](L4-key-processes.md#s1471-a-关键过程与关键量)

### S14.7.2 interp_fheat
- **所属子过程**：[S14.7 热化学率系数与光电截面](L2-subprocesses.md#s147-热化学率系数与光电截面)
- **作用与意义**：承担次级电子能量沉积的插值：沉积比例随能量与电离度变化由它给出。
- **承担者**：`elec_interp.c` 的 `interp_fheat`、`interp_n_Lya`、`interp_nion_HI` 等（[源码](../../../src/py21cmfast/src/elec_interp.c)）
- **关键过程**：次级电子能量沉积分数的双线性插值（按能量与电离度）。
- **下一层**：见 [L4 · S14.7.2](L4-key-processes.md#s1472-a-关键过程与关键量)

---

## S15 亮温输出

> 后端：本阶段的产物是 [P10 亮温盒](L0-pipeline.md#p10-亮温盒)。关键过程与关键量见 [CODE_TOPOLOGY.md §亮温输出](../CODE_TOPOLOGY.md#亮温输出)。

### S15.1 常数与前因子准备
- **计算单元**：[S15.1.1](#s1511-computebrightnesstemp-常数与前因子段)

### S15.1.1 ComputeBrightnessTemp 常数与前因子段
- **所属子过程**：[S15.1 常数与前因子准备](L2-subprocesses.md#s151-常数与前因子准备)
- **作用与意义**：承担信号换算的基准：背景温度与前因子错一处，整幅图就会整体偏移。
- **承担者**：`BrightnessTemperatureBox.c` 的 `ComputeBrightnessTemp` 前半段（[源码](../../../src/py21cmfast/src/BrightnessTemperatureBox.c)）
- **关键过程**：按本快照红移算出背景辐射温度、哈勃率与信号换算前因子。
- **下一层**：见 [L4 · S15.1.1](L4-key-processes.md#s1511-a-关键过程与关键量)

### S15.2 中性氢信号幅度填充
- **计算单元**：[S15.2.1](#s1521-computebrightnesstemp-幅度填充段)

### S15.2.1 ComputeBrightnessTemp 幅度填充段
- **所属子过程**：[S15.2 中性氢信号幅度填充](L2-subprocesses.md#s152-中性氢信号幅度填充)
- **作用与意义**：承担逐格点的信号填充：主链里最容易读出物理意义的一步。
- **承担者**：`BrightnessTemperatureBox.c` 的 `ComputeBrightnessTemp` 格点循环（[源码](../../../src/py21cmfast/src/BrightnessTemperatureBox.c)）
- **关键过程**：中性分数 × 密度对比 × 前因子，逐个格点写入信号。
- **下一层**：见 [L4 · S15.2.1](L4-key-processes.md#s1521-a-关键过程与关键量)

### S15.3 光学深度与自旋温度修正
- **计算单元**：[S15.3.1](#s1531-computebrightnesstemp-光学深度修正段)

### S15.3.1 ComputeBrightnessTemp 光学深度修正段
- **所属子过程**：[S15.3 光学深度与自旋温度修正](L2-subprocesses.md#s153-光学深度与自旋温度修正)
- **作用与意义**：承担自旋温度修正：不做它，低温时段的信号就不正确。
- **承担者**：`BrightnessTemperatureBox.c` 的 `ComputeBrightnessTemp` 修正段（[源码](../../../src/py21cmfast/src/BrightnessTemperatureBox.c)）
- **关键过程**：启用自旋温度涨落时计算光学深度，并用自旋温度改写信号。
- **下一层**：见 [L4 · S15.3.1](L4-key-processes.md#s1531-a-关键过程与关键量)

### S15.4 平均与有限性检查
- **计算单元**：[S15.4.1](#s1541-computebrightnesstemp-均值与有限性段)、[S15.4.2](#s1542-debugsummarizebox)

### S15.4.1 ComputeBrightnessTemp 均值与有限性段
- **所属子过程**：[S15.4 平均与有限性检查](L2-subprocesses.md#s154-平均与有限性检查)
- **作用与意义**：承担主链末端的自检：出问题的值不会静默地流出去。
- **承担者**：`BrightnessTemperatureBox.c` 的 `ComputeBrightnessTemp` 收尾段（[源码](../../../src/py21cmfast/src/BrightnessTemperatureBox.c)）
- **关键过程**：求盒平均并检查是否存在非有限值，异常则报错。
- **下一层**：见 [L4 · S15.4.1](L4-key-processes.md#s1541-a-关键过程与关键量)

### S15.4.2 debugSummarizeBox
- **所属子过程**：[S15.4 平均与有限性检查](L2-subprocesses.md#s154-平均与有限性检查)
- **作用与意义**：承担诊断打印：定位异常时最先看的地方。
- **承担者**：`debugging.c` 的 `debugSummarizeBox*`（[源码](../../../src/py21cmfast/src/debugging.c)）
- **关键过程**：调试模式下打印盒的极值与均值。
- **下一层**：见 [L4 · S15.4.2](L4-key-processes.md#s1542-a-关键过程与关键量)

---

## S16 跨阶段基建与校准

> 后端：本阶段的产物是 [P16 光子守恒校准曲线](L0-pipeline.md#p16-光子守恒校准曲线)。关键过程与关键量见 [CODE_TOPOLOGY.md §跨阶段基建与校准](../CODE_TOPOLOGY.md#跨阶段基建与校准)。

### S16.1 全局光子守恒校准
- **计算单元**：[S16.1.1](#s1611-initialisephotoncons)、[S16.1.2](#s1612-photoncons_calibration)、[S16.1.3](#s1613-obtainphotonconsdata)

### S16.1.1 InitialisePhotonCons
- **所属子过程**：[S16.1 全局光子守恒校准](L2-subprocesses.md#s161-全局光子守恒校准)
- **作用与意义**：承担校准的初始化：后续校准步骤能否执行的前提。
- **承担者**：`photoncons.c` 的 `InitialisePhotonCons`（[源码](../../../src/py21cmfast/src/photoncons.c)）
- **关键过程**：分配校准所需的内存并置位"已初始化"标志。
- **下一层**：见 [L4 · S16.1.1](L4-key-processes.md#s1611-a-关键过程与关键量)

### S16.1.2 PhotonCons_Calibration
- **所属子过程**：[S16.1 全局光子守恒校准](L2-subprocesses.md#s161-全局光子守恒校准)
- **作用与意义**：承担校准曲线的拟合：电离历史整体位置正确性的来源。
- **承担者**：`photoncons.c` 的 `PhotonCons_Calibration`、`ComputeZstart_PhotonCons`、`determine_deltaz_for_photoncons`、`get_fesc_fit`、`set_alphacons_params`（[源码](../../../src/py21cmfast/src/photoncons.c)）
- **关键过程**：与解析电离历史比对得到红移偏移曲线，并给出逃逸分数随红移的拟合。
- **下一层**：见 [L4 · S16.1.2](L4-key-processes.md#s1612-a-关键过程与关键量)

### S16.1.3 ObtainPhotonConsData
- **所属子过程**：[S16.1 全局光子守恒校准](L2-subprocesses.md#s161-全局光子守恒校准)
- **作用与意义**：承担校准结果的外送与释放：两侧对同一份校准的可见性靠它。
- **承担者**：`photoncons.c` 的 `ObtainPhotonConsData`、`FreePhotonConsMemory`（[源码](../../../src/py21cmfast/src/photoncons.c)）
- **关键过程**：把校准结果导出给 Python 侧，并在需要时释放内存。
- **下一层**：见 [L4 · S16.1.3](L4-key-processes.md#s1613-a-关键过程与关键量)

### S16.2 网格索引与坐标回卷
- **计算单元**：[S16.2.1](#s1621-wrap_coord)、[S16.2.2](#s1622-random_point_in_sphere)

### S16.2.1 wrap_coord
- **所属子过程**：[S16.2 网格索引与坐标回卷](L2-subprocesses.md#s162-网格索引与坐标回卷)
- **作用与意义**：承担坐标与索引的换算：位移、抽样与球内遍历共用同一套换算，避免各处各写一遍。
- **承担者**：`indexing.c` 的 `wrap_coord` 与网格索引宏（[源码](../../../src/py21cmfast/src/indexing.c)）
- **关键过程**：坐标回卷与"格点 ↔ 索引"的通用换算。
- **下一层**：见 [L4 · S16.2.1](L4-key-processes.md#s1621-a-关键过程与关键量)

### S16.2.2 random_point_in_sphere
- **所属子过程**：[S16.2 网格索引与坐标回卷](L2-subprocesses.md#s162-网格索引与坐标回卷)
- **作用与意义**：承担抽样取点：随机晕在格点内的位置由它给出。
- **承担者**：`indexing.c` 的 `random_point_in_sphere`、`random_point_in_cell`（[源码](../../../src/py21cmfast/src/indexing.c)）
- **关键过程**：在球内/胞内取随机点（随机晕采样用）。
- **下一层**：见 [L4 · S16.2.2](L4-key-processes.md#s1622-a-关键过程与关键量)

### S16.3 规则网格插值表基建
- **计算单元**：[S16.3.1](#s1631-allocate_rgtable2d)、[S16.3.2](#s1632-free_global_tables)

### S16.3.1 allocate_RGTable2D
- **所属子过程**：[S16.3 规则网格插值表基建](L2-subprocesses.md#s163-规则网格插值表基建)
- **作用与意义**：承担二维表的容器：条件积分表一类二维查询的实现。
- **承担者**：`interpolation.c` 的二维表族（[源码](../../../src/py21cmfast/src/interpolation.c)）
- **关键过程**：二维规则网格表的分配与双线性求值。
- **下一层**：见 [L4 · S16.3.1](L4-key-processes.md#s1631-a-关键过程与关键量)

### S16.3.2 free_global_tables
- **所属子过程**：[S16.3 规则网格插值表基建](L2-subprocesses.md#s163-规则网格插值表基建)
- **作用与意义**：承担表的释放：换一套参数重跑时不清理就会读到旧值。
- **承担者**：`interp_tables.c` 的 `free_global_tables`、`free_conditional_tables`（[源码](../../../src/py21cmfast/src/interp_tables.c)）
- **关键过程**：按类别释放全局表与条件表，避免跨参数污染。
- **下一层**：见 [L4 · S16.3.2](L4-key-processes.md#s1632-a-关键过程与关键量)

### S16.4 调试输出与盒统计
- **计算单元**：[S16.4.1](#s1641-writesimulationoptions)、[S16.4.2](#s1642-somethingthatcatches)

### S16.4.1 writeSimulationOptions
- **所属子过程**：[S16.4 调试输出与盒统计](L2-subprocesses.md#s164-调试输出与盒统计)
- **作用与意义**：承担参数入日志：复现某次运行的第一步。
- **承担者**：`debugging.c` 的参数结构打印族（[源码](../../../src/py21cmfast/src/debugging.c)）
- **关键过程**：把参数结构逐字段打进日志，便于复现某次运行。
- **下一层**：见 [L4 · S16.4.1](L4-key-processes.md#s1641-a-关键过程与关键量)

### S16.4.2 SomethingThatCatches
- **所属子过程**：[S16.4 调试输出与盒统计](L2-subprocesses.md#s164-调试输出与盒统计)
- **作用与意义**：承担异常通路的自测：后端报错能否变成可读的异常，由它守着。
- **承担者**：`debugging.c` 的异常框架自测函数（[源码](../../../src/py21cmfast/src/debugging.c)）
- **关键过程**：验证"后端报错 → Python 异常"这条通路本身是否可靠。
- **下一层**：见 [L4 · S16.4.2](L4-key-processes.md#s1642-a-关键过程与关键量)

---

## 下一层

以上计算单元**各自末端的关键过程与关键量**，见 [L4 关键过程与关键量](L4-key-processes.md)。
