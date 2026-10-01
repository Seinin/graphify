# L4 · 关键过程与关键量

> **什么时候看这一页**：想知道"这条链末端该盯哪几个量、关键过程与阈值在哪"的时候。
> 读法总览见 [README](README.md)｜按问题查见 [INDEX](INDEX.md)｜维护规则见 [CONVENTIONS](CONVENTIONS.md) §3.3。
>
> 本层是末端层：只登记**每个计算单元末端的关键过程**与**关键变量/常量叫什么、起什么作用**。
> 本层不回头解释上层编排，也不复制既有推导；公式只在必要时以行内数学给出。
>
> **按阶段跳**：[S01](#s01-参数装配与模板)｜[S02](#s02-驱动编排)｜[S03](#s03-缓存与持久化)｜[S04](#s04-旁路与后处理接口)｜[S05](#s05-后端桥与全局前置)｜[S06](#s06-输入与全局配置)｜[S07](#s07-宇宙学背景)｜[S08](#s08-质量函数与统计工具)｜[S09](#s09-初始条件)｜[S10](#s10-微扰场与速度)｜[S11](#s11-晕目录与位移)｜[S12](#s12-天体物理源)｜[S13](#s13-电离与复合)｜[S14](#s14-热与自旋温度)｜[S15](#s15-亮温输出)｜[S16](#s16-跨阶段基建与校准)
>
> 每个计算单元**恰好一条**条目，标题固定为「关键过程与关键量」，编号 `Snn.m.k-a`。
> 变量名一律以**本仓库当前工作区**为准；名称为 `—` 的条目表示该单元的关键量请以 [CODE_TOPOLOGY.md](../CODE_TOPOLOGY.md) 的对应小节为准。

## S01 参数装配与模板

### S01.1.1-a 关键过程与关键量
- **所属单元**：[S01.1.1 create_params_from_template](L3-units.md#s0111-create_params_from_template)
- **作用与意义**：盯住它：模板叠加的顺序与字段级覆盖规则一旦改动，所有模板的语义都会跟着变。
- **关键过程**：模板条目 → 覆盖值 → 取值字典的三步合并，模板只写非默认项。
- **关键量**：`TEMPLATE_PATH`（模板目录）、`manifest`（模板清单）、`full_template`（合并结果）、`dct`（待实例化字典）

### S01.1.2-a 关键过程与关键量
- **所属单元**：[S01.1.2 load_template_file](L3-units.md#s0112-load_template_file)
- **作用与意义**：盯住它：模板名与别名的解析顺序，决定了同一次运行到底读了哪份文件。
- **关键过程**：模板文件的读写与列举；写入时只落盘与默认值不同的项。
- **关键量**：`templates/`（17 个模板）、`manifest.toml`（清单）

### S01.2.1-a 关键过程与关键量
- **所属单元**：[S01.2.1 deserialize_inputs](L3-units.md#s0121-deserialize_inputs)
- **作用与意义**：盯住它：多余参数会在这里直接报错，是拼写错误的第一道拦截。
- **关键过程**：按结构名逐项构造参数对象；传输函数表按表类型特判。
- **关键量**：`structname`（结构名）、`Table1D`（查表容器）

### S01.2.2-a 关键过程与关键量
- **所属单元**：[S01.2.2 InputParameters.from_template](L3-units.md#s0122-inputparametersfrom_template)
- **作用与意义**：盯住它：参数集能否自洽，最终由这一步的组装结果决定。
- **关键过程**：模板取值 → 六个子结构 → 完整参数集，并接上随机种子与红移网格。
- **关键量**：`random_seed`、`node_redshifts`、`cosmo_tables`

### S01.2.3-a 关键过程与关键量
- **所属单元**：[S01.2.3 InputStruct](L3-units.md#s0123-inputstruct)
- **作用与意义**：盯住它：两侧字段名一旦不一致，故障会在很远的地方才暴露。
- **关键过程**：Python 字段与后端结构体字段的双向映射与类型转换。
- **关键量**：`cdict`（后端字段字典）、`cstruct`（后端结构体实例）

### S01.3.1-a 关键过程与关键量
- **所属单元**：[S01.3.1 get_logspaced_redshifts](L3-units.md#s0131-get_logspaced_redshifts)
- **作用与意义**：盯住它：红移网格决定了快照数量，也决定了整次运行的时间与磁盘开销。
- **关键过程**：按盒长与终末红移定界后取对数等距的红移网格。
- **关键量**：`zmin`、`zmax`、`n_redshifts`

### S01.3.2-a 关键过程与关键量
- **所属单元**：[S01.3.2 evolve_input_structs](L3-units.md#s0132-evolve_input_structs)
- **作用与意义**：盯住它：派生参数是全局演化与校准能复用主链代码的原因。
- **关键过程**：把一套参数改写成"子集形态"（更小维度、关掉某些过程），用于派生试算。
- **关键量**：`_user_cosmo_hash`、`_zgrid_hash`

### S01.4.1-a 关键过程与关键量
- **所属单元**：[S01.4.1 _get_inputs](L3-units.md#s0141-_get_inputs)
- **作用与意义**：盯住它：命令行能覆盖哪些参数，取决于这里的字段清单。
- **关键过程**：命令行取值去空后作为覆盖值交给模板装配。
- **关键量**：`Parameters`（全默认 None 的命令行模型）

### S01.4.2-a 关键过程与关键量
- **所属单元**：[S01.4.2 Config](L3-units.md#s0142-config)
- **作用与意义**：盯住它：进程级配置影响所有入口，排查环境问题从这里开始。
- **关键过程**：进程级配置的读写，并透传到后端配置结构。
- **关键量**：`direc`（缓存目录）、`HALO_CATALOG_MEM_FACTOR`、`external_table_path`、`wisdoms_path`

## S02 驱动编排

### S02.1.1-a 关键过程与关键量
- **所属单元**：[S02.1.1 _setup_ics_and_pfs_for_scrolling](L3-units.md#s0211-_setup_ics_and_pfs_for_scrolling)
- **作用与意义**：盯住它：这是三条流水线共用的备料口，它少备一样，三条路都会缺。
- **关键过程**：先算初始条件，再逐红移把微扰场与晕目录备齐；顺带建立光子守恒校准。
- **关键量**：`all_redshifts`、`ics`（初始条件盒）、`_ics_and_pfs`（已备好的微扰场集合）

### S02.1.2-a 关键过程与关键量
- **所属单元**：[S02.1.2 compute_initial_conditions](L3-units.md#s0212-compute_initial_conditions)
- **作用与意义**：盯住它：首次运行的随机实现只在这一处被固定。
- **关键过程**：单格退化时直接填充，否则转成一次后端调用。
- **关键量**：`DIM` / `HII_DIM`（退化判据）、`initial_density`

### S02.2.1-a 关键过程与关键量
- **所属单元**：[S02.2.1 evolve_halos](L3-units.md#s0221-evolve_halos)
- **作用与意义**：盯住它：晕在红移之间的继承关系，决定了晕目录的物理可信度。
- **关键过程**：按反红移序逐级算晕目录，每级把上一级结果作为"后代"传入。
- **关键量**：`descendant_halos`（后代晕）、`halo_catalogs`（逐红移晕目录）

### S02.3.1-a 关键过程与关键量
- **所属单元**：[S02.3.1 _redshift_loop_generator](L3-units.md#s0231-_redshift_loop_generator)
- **作用与意义**：盯住它：单红移动作顺序就是全仓唯一的时间序列定义。
- **关键过程**：单个红移上按固定次序请求源项 → X 射线源 → 自旋温度 → 电离 → 亮温，并按开关跳过不需要的步。
- **关键量**：`lagrangian_source_grid`（是否用拉格朗日源网格）、`USE_TS_FLUCT`（是否算自旋温度涨落）、`prev_*`（上一快照的盒）

### S02.4.1-a 关键过程与关键量
- **所属单元**：[S02.4.1 generate_coeval](L3-units.md#s0241-generate_coeval)
- **作用与意义**：盯住它：聚合容器的字段清单，就是用户能取到的全部量。
- **关键过程**：把逐红移的盒装进可按量取用的容器，结束时释放后端全局资源。
- **关键量**：`Coeval`（容器）、`_computed_outputs`（已算的量）、`free_cosmo_tables`

### S02.4.2-a 关键过程与关键量
- **所属单元**：[S02.4.2 run_global_evolution](L3-units.md#s0242-run_global_evolution)
- **作用与意义**：盯住它：零维改写清单说明全局演化到底丢掉了哪些功能。
- **关键过程**：把参数改写为单格形态后走同一条推进循环，逐红移取盒均值。
- **关键量**：`quantities`（红移 × 量的历史表）、`node_redshifts`、`PHOTON_CONS_TYPE`（被强制关闭）

### S02.5.1-a 关键过程与关键量
- **所属单元**：[S02.5.1 generate_lightcone](L3-units.md#s0251-generate_lightcone)
- **作用与意义**：盯住它：光锥与联合演化盒的差异全部集中在切片与检查点。
- **关键过程**：复用推进循环，每红移后取切片并拼接；支持检查点续算。
- **关键量**：`lightconer`（几何定义）、`make_checkpoint`、`LightCone`（容器）

### S02.5.2-a 关键过程与关键量
- **所属单元**：[S02.5.2 make_lightcone_slices](L3-units.md#s0252-make_lightcone_slices)
- **作用与意义**：盯住它：几何抽象决定了光锥能取什么形状，也框定了它的使用边界。
- **关键过程**：把几何定义翻译成"每个红移取哪些格点"。
- **关键量**：`RectilinearLightconer`（直角视线）、`AngularLightconer`（角向视线）、`make_lightcone_slices`

### S02.5.3-a 关键过程与关键量
- **所属单元**：[S02.5.3 apply_rsds](L3-units.md#s0253-apply_rsds)
- **作用与意义**：盯住它：末端一次位移，决定了红移空间畸变是否被包含。
- **关键过程**：把速度引起的视线位移施加到光锥上，并在 τ₂₁ 中补上速度梯度项。
- **关键量**：`rsds_shift`（位移量）、`dvdr_in_tau21`、`estimate_rsd_displacements`

### S02.6.1-a 关键过程与关键量
- **所属单元**：[S02.6.1 _obtain_starting_point_for_scrolling](L3-units.md#s0261-_obtain_starting_point_for_scrolling)
- **作用与意义**：盯住它：续算判定直接决定重复运行是几分钟还是几小时。
- **关键过程**：查已有缓存，决定从哪个红移开始推进以及需要哪些上游产物。
- **关键量**：`RunCache.is_complete_at`、`starting_redshift`

## S03 缓存与持久化

### S03.1.1-a 关键过程与关键量
- **所属单元**：[S03.1.1 OutputCache](L3-units.md#s0311-outputcache)
- **作用与意义**：盯住它：磁盘布局一旦变化，旧缓存会全部失效。
- **关键过程**：由四类哈希拼出目录层级与文件名，并按同一模板查找既有文件。
- **关键量**：`_HashType.user_cosmo` / `.zgrid` / `.full`（三种降级层级）、`matter_cosmo` / `seed` / `zgrid` / `astro_flag`（四段哈希）

### S03.2.1-a 关键过程与关键量
- **所属单元**：[S03.2.1 write_output_to_hdf5](L3-units.md#s0321-write_output_to_hdf5)
- **作用与意义**：盯住它：落盘格式的版本号，是旧文件还能否被读回的判据。
- **关键过程**：一个结构一个文件，参数组与字段组分写。
- **关键量**：`InputParameters` / `OutputFields`（两个组）、`21cmFAST-version`（属性）

### S03.2.2-a 关键过程与关键量
- **所属单元**：[S03.2.2 read_output_struct](L3-units.md#s0322-read_output_struct)
- **作用与意义**：盯住它：回读路径决定了产物能否脱离产生它的那次运行使用。
- **关键过程**：按文件内版本号选择读取路径并还原结构与参数。
- **关键量**：`hdf5_to_dict`、`_read_outputs_v4`、`21cmFAST-version`

### S03.3.1-a 关键过程与关键量
- **所属单元**：[S03.3.1 RunCache](L3-units.md#s0331-runcache)
- **作用与意义**：盯住它：清单完备性判断，是断点续算能否成立的前提。
- **关键过程**：由参数集推出全部可能文件，逐项判断存在性，给出"某红移是否齐备"。
- **关键量**：`is_complete_at`、`get_output_struct_at_z`、`get_ics`

### S03.4.1-a 关键过程与关键量
- **所属单元**：[S03.4.1 CacheConfig](L3-units.md#s0341-cacheconfig)
- **作用与意义**：盯住它：写盘开关是内存与磁盘之间唯一的调节处。
- **关键过程**：按量类型与步进决定是否落盘。
- **关键量**：`on` / `off` / `noloop` / `last_step_only`

## S04 旁路与后处理接口

### S04.1.1-a 关键过程与关键量
- **所属单元**：[S04.1.1 compute_luminosity_function](L3-units.md#s0411-compute_luminosity_function)
- **作用与意义**：盯住它：这是光度函数与观测对照时唯一的数据来源。
- **关键过程**：对两个恒星族各自循环调用后端光度函数，并组装成红移/质量维数组。
- **关键量**：`component`（恒星族）、`Muvfunc` / `Mhfunc` / `lfunc`（三元输出）

### S04.2.1-a 关键过程与关键量
- **所属单元**：[S04.2.1 compute_tau](L3-units.md#s0421-compute_tau)
- **作用与意义**：盯住它：再电离光学深度是最常被引用的约束量，它错则整篇结论都要改。
- **关键过程**：把红移与中性分数序列交给后端做视线积分。
- **关键量**：`z_re_HeII`（氦再电离红移）、返回的 τ

### S04.3.1-a 关键过程与关键量
- **所属单元**：[S04.3.1 setup_photon_cons](L3-units.md#s0431-setup_photon_cons)
- **作用与意义**：盯住它：校准试算的参数构造方式，决定了回灌曲线的物理含义。
- **关键过程**：按类型分派后端校准；校准是一次"去掉演化"的试算再与解析历史比对。
- **关键量**：`_photoncons_state`（单例状态）、`photon_cons_allocated`、`PHOTON_CONS_TYPE`

### S04.4.1-a 关键过程与关键量
- **所属单元**：[S04.4.1 run_classy](L3-units.md#s0441-run_classy)
- **作用与意义**：盯住它：外部表与解析表的分界点，是换宇宙学后端时唯一的开关。
- **关键过程**：用外部玻尔兹曼码算出传输函数表，作为参数集查表的默认来源。
- **关键量**：`classy_params_default`、`get_transfer_function`、`find_redshift_kinematic_decoupling`

### S04.4.2-a 关键过程与关键量
- **所属单元**：[S04.4.2 compute_rms](L3-units.md#s0442-compute_rms)
- **作用与意义**：盯住它：均方根是位移估计的输入，也是尺度相关性的度量。
- **关键过程**：用传输函数与平滑窗在给定尺度上积分得到均方根。
- **关键量**：`R`（尺度）、返回的 σ(R)

### S04.5.1-a 关键过程与关键量
- **所属单元**：[S04.5.1 coeval_sliceplot](L3-units.md#s0451-coeval_sliceplot)
- **作用与意义**：盯住它：不参与计算，但它决定结果能否被人看见。
- **关键过程**：切片、光锥与全局历史的可视化。
- **关键量**：—

## S05 后端桥与全局前置

### S05.1.1-a 关键过程与关键量
- **所属单元**：[S05.1.1 broadcast_input_struct](L3-units.md#s0511-broadcast_input_struct)
- **作用与意义**：盯住它：全局量登记是后续阶段不再传参的全部依据。
- **关键过程**：把六个参数子结构一次性转成后端结构体并登记为全局量。
- **关键量**：`simulation_options_global`、`matter_options_global`、`cosmo_params_global`、`astro_params_global`、`astro_options_global`、`cosmo_tables_global`

### S05.1.2-a 关键过程与关键量
- **所属单元**：[S05.1.2 init_backend_ps](L3-units.md#s0512-init_backend_ps)
- **作用与意义**：盯住它：前置顺序决定了哪些量必须在使用前就绪。
- **关键过程**：装饰器栈按"参数广播 → 功率谱 → 方差表 → 积分节点"的顺序在调用前自动补齐前置。
- **关键量**：`broadcast_params`、`init_backend_ps`、`init_sigma_table`、`init_gl`

### S05.1.3-a 关键过程与关键量
- **所属单元**：[S05.1.3 OutputStruct._compute_function](L3-units.md#s0513-outputstruct_compute_function)
- **作用与意义**：盯住它：结构到后端入口的绑定表，就是两侧接口的清单。
- **关键过程**：每个输出结构声明自己的后端入口，并按声明顺序推送输入数组。
- **关键量**：`_c_compute_function`（结构 → 后端入口的绑定）、`_compat_hash`（兼容性层级）、`NON_CUBIC_FACTOR`（第三轴拉伸）

### S05.2.1-a 关键过程与关键量
- **所属单元**：[S05.2.1 single_field_func](L3-units.md#s0521-single_field_func)
- **作用与意义**：盯住它：单场外壳是所有入口行为一致性的来源。
- **关键过程**：一致性检查 → 按需建变换缓存 → 广播参数 → 调用体 → 按开关释放全局表。
- **关键量**：`free_cosmo_tables`（是否立即释放）、`USE_FFTW_WISDOM`、`check_backend_state`

### S05.2.2-a 关键过程与关键量
- **所属单元**：[S05.2.2 construct_fftw_wisdoms](L3-units.md#s0522-construct_fftw_wisdoms)
- **作用与意义**：盯住它：变换缓存是同尺寸重跑更快的唯一机制。
- **关键过程**：变换计划的落盘或读入，使同尺寸重跑更快。
- **关键量**：`wisdoms_path`、`CreateFFTWWisdoms`

### S05.3.1-a 关键过程与关键量
- **所属单元**：[S05.3.1 free_cosmo_tables](L3-units.md#s0531-free_cosmo_tables)
- **作用与意义**：盯住它：释放策略决定连续多次调用会不会把内存耗尽。
- **关键过程**：按"本次是否还会复用"决定释放全局查表。
- **关键量**：`Free_cosmo_tables_global`

## S06 输入与全局配置

### S06.1.1-a 关键过程与关键量
- **所属单元**：[S06.1.1 physconst](L3-units.md#s0611-physconst)
- **作用与意义**：盯住它：常数只此一份，改它等于改全仓的物理约定。
- **关键过程**：把编译期常数固化成一个只读结构；派生量以宏在头文件里给出。
- **关键量**：`physconst`（只读常数结构）

### S06.2.1-a 关键过程与关键量
- **所属单元**：[S06.2.1 Broadcast_struct_global_all](L3-units.md#s0621-broadcast_struct_global_all)
- **作用与意义**：盯住它：广播清单就是后端能看到的全部参数。
- **关键过程**：把六个参数结构登记为全局指针；使用外部分支时另分配并拷贝传输函数表。
- **关键量**：六个 `*_global` 指针、`ps_norm` / `USE_SIGMA_8`（拷贝项）

### S06.2.2-a 关键过程与关键量
- **所属单元**：[S06.2.2 CosmoParams](L3-units.md#s0622-cosmoparams)
- **作用与意义**：盯住它：结构布局是两侧对话的契约，改动会同时影响两端。
- **关键过程**：两侧共享的结构布局在此一次性声明，字段名必须两侧一致。
- **关键量**：`CosmoParams`、`SimulationOptions`、`MatterOptions`、`AstroParams`、`AstroOptions`、`CosmoTables`、`ConfigSettings`

## S07 宇宙学背景

### S07.1.1-a 关键过程与关键量
- **所属单元**：[S07.1.1 init_ps](L3-units.md#s0711-init_ps)
- **作用与意义**：盯住它：功率谱的装配方式决定了后续所有统计量的口径。
- **关键过程**：装配功率谱求值所需的参数与归一化，结束时可整体回收。
- **关键量**：`ps_norm`、`USE_SIGMA_8`、`ps_allocated`

### S07.1.2-a 关键过程与关键量
- **所属单元**：[S07.1.2 transfer_function](L3-units.md#s0712-transfer_function)
- **作用与意义**：盯住它：传输函数来源是复现他人结果时最需要核对的开关之一。
- **关键过程**：按参数选择传输函数来源：若干解析近似或外部查表。
- **关键量**：`POWER_SPECTRUM`（来源选择）、`transfer_density`（外部表）

### S07.1.3-a 关键过程与关键量
- **所属单元**：[S07.1.3 power_in_k](L3-units.md#s0713-power_in_k)
- **作用与意义**：盯住它：抑制项乘在哪里，决定了模糊暗物质影响的物理含义。
- **关键过程**：原始曲率谱 × 传输函数² × 归一化；模糊暗物质抑制在此乘入。
- **关键量**：`power_in_k`、`power_in_k_cdm`（不含抑制）、`power_in_vcb`（相对速度）、`T_F`（抑制因子）

### S07.2.1-a 关键过程与关键量
- **所属单元**：[S07.2.1 dicke](L3-units.md#s0721-dicke)
- **作用与意义**：盯住它：增长因子是同一套场在不同红移之间的唯一桥梁。
- **关键过程**：线性增长因子及其导数与积分量（时间、距离、哈勃率）。
- **关键量**：`dicke`、`ddickedt`、`dtdz`、`hubble`、`drdz`、`TtoM`

### S07.3.1-a 关键过程与关键量
- **所属单元**：[S07.3.1 sigma_z0](L3-units.md#s0731-sigma_z0)
- **作用与意义**：盯住它：方差及其导数是质量函数与塌缩分数的共同输入。
- **关键过程**：对功率谱做窗口积分得到质量方差及其对尺度的导数。
- **关键量**：`sigma_z0`、`dsigmasqdm_z0`、`MtoR` / `RtoM`（质量↔尺度）

### S07.3.2-a 关键过程与关键量
- **所属单元**：[S07.3.2 sigma_z0_pre](L3-units.md#s0732-sigma_z0_pre)
- **作用与意义**：盯住它：参考方差是构造抑制因子时的分母，口径不能混。
- **关键过程**：为模糊暗物质情形准备"不含抑制"的参考方差，用于构造抑制因子。
- **关键量**：`sigma_z0_pre`、`dsigmasqdm_z0_pre`、`Sigma_InterpTable_CDM`

### S07.4.1-a 关键过程与关键量
- **所属单元**：[S07.4.1 initialiseSigmaMInterpTable](L3-units.md#s0741-initialisesigmaminterptable)
- **作用与意义**：盯住它：方差表是精度与速度之间的取舍点。
- **关键过程**：在质量区间上预建方差表，后续只做查表求值。
- **关键量**：`M_MIN_INTEGRAL` / `M_MAX_INTEGRAL`（表区间）、`EvaluateSigma`、`EvaluateSigmaConditional`、`EvaluatedSigmasqdm`

### S07.4.2-a 关键过程与关键量
- **所属单元**：[S07.4.2 allocate_RGTable1D](L3-units.md#s0742-allocate_rgtable1d)
- **作用与意义**：盯住它：规则网格表是后续所有查表操作的共同实现。
- **关键过程**：一维/二维规则网格表的通用分配、释放、求值与越界判定。
- **关键量**：`RGTable1D` / `RGTable2D`、`EvaluateRGTable1D` / `EvaluateRGTable2D`

### S07.5.1-a 关键过程与关键量
- **所属单元**：[S07.5.1 get_sigma](L3-units.md#s0751-get_sigma)
- **作用与意义**：盯住它：直接查询出口让外部不必跑完整条链也能核对统计量。
- **关键过程**：把表与积分包装成不经主链、可外部直接调用的查询。
- **关键量**：`get_sigma`、`get_condition_integrals`、`get_global_Nion_z`、`get_conditional_FgtrM`

## S08 质量函数与统计工具

### S08.1.1-a 关键过程与关键量
- **所属单元**：[S08.1.1 unconditional_hmf](L3-units.md#s0811-unconditional_hmf)
- **作用与意义**：盯住它：质量函数的形式选择，直接决定晕数与塌缩分数的数值。
- **关键过程**：按选定形式给出质量函数；条件形式额外依赖局部密度与方差。
- **关键量**：`HMF`（形式选择）、`delta_crit`（塌缩阈值）、`unconditional_hmf` / `conditional_hmf`

### S08.1.2-a 关键过程与关键量
- **所属单元**：[S08.1.2 IntegratedNdM_GL](L3-units.md#s0812-integratedndm_gl)
- **作用与意义**：盯住它：积分方法的选择会改变数值结果，属于必须记录的口径。
- **关键过程**：把质量函数在有上下限的区间上积成晕数或塌缩分数。
- **关键量**：`INTEGRATION_METHOD_ATOMIC` / `INTEGRATION_METHOD_MINI`、`initialise_GL`、`MFIntegral_Approx`

### S08.1.3-a 关键过程与关键量
- **所属单元**：[S08.1.3 FgtrM](L3-units.md#s0813-fgtrm)
- **作用与意义**：盯住它：塌缩分数是电离判据的量纲基准。
- **关键过程**：给出阈值以上的累计塌缩质量占比及其随红移的变化。
- **关键量**：`FgtrM`、`FgtrM_bias`、`dfcoll_dz`

### S08.1.4-a 关键过程与关键量
- **所属单元**：[S08.1.4 minimum_source_mass](L3-units.md#s0814-minimum_source_mass)
- **作用与意义**：盯住它：质量下限决定低质量端被算进去多少，是常见分歧来源。
- **关键过程**：按冷却阈值定出最小源质量；另用二分法求积分两侧的质量限。
- **关键量**：`minimum_source_mass`、`atomic_cooling_threshold`、`Mass_limit_bisection`

### S08.2.1-a 关键过程与关键量
- **所属单元**：[S08.2.1 T_F](L3-units.md#s0821-t_f)
- **作用与意义**：盯住它：这是换暗物质模型时唯一需要改动的核之一。
- **关键过程**：给出模糊暗物质转移函数，并在无条件质量函数上乘抑制因子（条件形式不乘）。
- **关键量**：`T_F`、`dndm_FDM`、`m22`（粒子质量参数）

## S09 初始条件

### S09.1.1-a 关键过程与关键量
- **所属单元**：[S09.1.1 seed_rng_threads](L3-units.md#s0911-seed_rng_threads)
- **作用与意义**：盯住它：随机流派生方式决定了结果的可复现性。
- **关键过程**：由总种子派生各线程独立随机流，保证并行与串行结果一致。
- **关键量**：`random_seed`、`N_THREADS`、`seed_rng_threads_fast`

### S09.2.1-a 关键过程与关键量
- **所属单元**：[S09.2.1 dft_r2c_cube](L3-units.md#s0921-dft_r2c_cube)
- **作用与意义**：盯住它：变换约定错了，后面每一步都会带着同一个错误。
- **关键过程**：实↔复三维变换的统一封装，负责对齐与归一化约定。
- **关键量**：`dft_r2c_cube`、`dft_c2r_cube`、`CreateFFTWWisdoms`

### S09.3.1-a 关键过程与关键量
- **所属单元**：[S09.3.1 sample_ic_modes](L3-units.md#s0931-sample_ic_modes)
- **作用与意义**：盯住它：随机场的抽样方式，决定初始条件的统计性质是否正确。
- **关键过程**：按功率谱给各模赋随机幅度与相位，并保证实场所需的共轭对称。
- **关键量**：`sample_ic_modes`、`adj_complex_conj`、`HIRES_box`

### S09.3.2-a 关键过程与关键量
- **所属单元**：[S09.3.2 filter_box](L3-units.md#s0932-filter_box)
- **作用与意义**：盯住它：滤波是尺度这个概念唯一的实现处。
- **关键过程**：在傅里叶空间施加窗函数，把密度场调到给定尺度。
- **关键量**：`R`（尺度）、`filter_flag`（窗函数选择）、`dwdm_filter`（模糊暗物质）

### S09.4.1-a 关键过程与关键量
- **所属单元**：[S09.4.1 compute_velocity_fields](L3-units.md#s0941-compute_velocity_fields)
- **作用与意义**：盯住它：位移场决定质量如何被搬运，是结构增长的直接体现。
- **关键过程**：由密度场的势梯度得到一阶位移场。
- **关键量**：`vel_pointers`、`compute_f_gradient`

### S09.4.2-a 关键过程与关键量
- **所属单元**：[S09.4.2 compute_velocity_fields_2LPT](L3-units.md#s0942-compute_velocity_fields_2lpt)
- **作用与意义**：盯住它：二阶项是否生效，取决于参数与这里的实现。
- **关键过程**：二阶扰动修正（仅在选用二阶算法时启用）。
- **关键量**：`PERTURB_ALGORITHM`、`vel_pointers_2LPT`、`compute_f_laplacian`

### S09.4.3-a 关键过程与关键量
- **所属单元**：[S09.4.3 compute_relative_velocities](L3-units.md#s0943-compute_relative_velocities)
- **作用与意义**：盯住它：相对速度是否被计入，取决于这一处的输出是否存在。
- **关键过程**：给出重子与暗物质的速度差场。
- **关键量**：`USE_RELATIVE_VELOCITIES`、`boxes->lowres_vcb`

### S09.5.1-a 关键过程与关键量
- **所属单元**：[S09.5.1 ComputeInitialConditions](L3-units.md#s0951-computeinitialconditions)
- **作用与意义**：盯住它：这是初始条件产物能否成立的总装配口。
- **关键过程**：串起抽样、变换、滤波与降采样，写出高低分辨密度与速度，并回收随机数环境。
- **关键量**：`hi_dim` / `lo_dim`、`HIRES_box_saved`、`non_zero_input`、`dim_ratio_hi_lo`、`boxes->lowres_density` / `boxes->hires_density`

### S09.5.2-a 关键过程与关键量
- **所属单元**：[S09.5.2 resample_index](L3-units.md#s0952-resample_index)
- **作用与意义**：盯住它：索引映射错一处，降采样就会出现系统性偏差。
- **关键过程**：建立高低分辨网格之间的索引对应关系。
- **关键量**：`resample_index`、`dim_ratio_hi_lo`

## S10 微扰场与速度

### S10.1.1-a 关键过程与关键量
- **所属单元**：[S10.1.1 filter_function](L3-units.md#s1011-filter_function)
- **作用与意义**：盯住它：窗函数族就是尺度选择这一操作的全部词汇。
- **关键过程**：提供实空间顶帽、锐 k、高斯、模糊暗物质、平均自由程与球壳等窗函数。
- **关键量**：`filter_function`、`sharp_k_filter`、`exp_mfp_filter`、`spherical_shell_filter`

### S10.2.1-a 关键过程与关键量
- **所属单元**：[S10.2.1 make_density_grid](L3-units.md#s1021-make_density_grid)
- **作用与意义**：盯住它：密度场是该红移一切后续计算的起点。
- **关键过程**：按扰动算法把初始场推到目标红移，内部调用质量位移。
- **关键量**：`PERTURB_ON_HIGH_RES`（是否在高分辨上做）、`fft_density_grid`

### S10.2.2-a 关键过程与关键量
- **所属单元**：[S10.2.2 move_grid_masses](L3-units.md#s1022-move_grid_masses)
- **作用与意义**：盯住它：质量搬运是扰动理论落到网格上的核心一步。
- **关键过程**：把质量按位移场搬运到新位置（云中云加权）。
- **关键量**：`move_grid_masses`、`do_cic_interpolation_*`（云中云权重）

### S10.3.1-a 关键过程与关键量
- **所属单元**：[S10.3.1 assign_to_lowres_grid](L3-units.md#s1031-assign_to_lowres_grid)
- **作用与意义**：盯住它：归并方式决定计算网格上的密度是否守恒。
- **关键过程**：高分辨密度向低分辨网格的归并（含非立方拉伸）。
- **关键量**：`NON_CUBIC_FACTOR`、`LOWRES_density_perturb`

### S10.3.2-a 关键过程与关键量
- **所属单元**：[S10.3.2 normalise_delta_grid](L3-units.md#s1032-normalise_delta_grid)
- **作用与意义**：盯住它：归一化口径不统一，跨阶段比较就没有意义。
- **关键过程**：把密度换算成相对平均的对比并强制零均值。
- **关键量**：`deltax`（过密度）、`TOT_MEAN` / `TOT_NPART`（均值口径）

### S10.4.1-a 关键过程与关键量
- **所属单元**：[S10.4.1 smooth_and_clip_density](L3-units.md#s1041-smooth_and_clip_density)
- **作用与意义**：盯住它：裁剪阈值过低会让极端值污染后续积分。
- **关键过程**：按可选尺度平滑，并把过度负值裁剪到物理下限。
- **关键量**：`SMOOTH_EVOLVED_DENSITY`（是否平滑）、`MIN_DELTAX`（裁剪下限）

### S10.5.1-a 关键过程与关键量
- **所属单元**：[S10.5.1 compute_perturbed_velocities](L3-units.md#s1051-compute_perturbed_velocities)
- **作用与意义**：盯住它：速度分量是晕位移与光学深度修正的共同输入。
- **关键过程**：给出该红移的速度分量，横轴分量按开关决定是否保留。
- **关键量**：`KEEP_3D_VELOCITIES`、`perturbed_field->velocity_z`

### S10.6.1-a 关键过程与关键量
- **所属单元**：[S10.6.1 ComputePerturbedField](L3-units.md#s1061-computeperturbedfield)
- **作用与意义**：盯住它：这里定义了微扰场产物的最终字段清单。
- **关键过程**：串起密度构造、降采样、平滑与速度，写出 [P03 微扰场](L0-pipeline.md#p03-微扰场)。
- **关键量**：`density_perturb_saved`（供速度使用的副本）、`perturbed_field->density`

## S11 晕目录与位移

### S11.1.1-a 关键过程与关键量
- **所属单元**：[S11.1.1 ComputeHaloCatalog](L3-units.md#s1111-computehalocatalog)
- **作用与意义**：盯住它：离散晕的产生方式决定了源项走哪条路径。
- **关键过程**：从大到小递减滤波半径扫过网格标出晕，或改走随机采样路径；随后给出晕坐标与属性。
- **关键量**：`M_MIN`、`Delta_R`、`DELTA_R_FACTOR`、`delta_crit`、`in_halo` / `forbidden`（重叠与禁区加速盒）、`halo_catalog`

### S11.1.2-a 关键过程与关键量
- **所属单元**：[S11.1.2 check_halo](L3-units.md#s1112-check_halo)
- **作用与意义**：盯住它：重叠判定错一处，会导致晕数系统性偏多或偏少。
- **关键过程**：判定候选格点是否已落在更大的晕或禁区中，避免重复计数。
- **关键量**：`in_halo`、`forbidden`、`delta_m`（滤波后密度）

### S11.2.1-a 关键过程与关键量
- **所属单元**：[S11.2.1 stochastic_halofield](L3-units.md#s1121-stochastic_halofield)
- **作用与意义**：盯住它：抽样核决定源项的随机性是否物理。
- **关键过程**：按条件质量函数的期望晕数在格点内做随机抽样，产生离散晕。
- **关键量**：`expected_nhalo`（期望晕数）、`stoc_*_sample`（抽样核）

### S11.2.2-a 关键过程与关键量
- **所属单元**：[S11.2.2 add_properties_cat](L3-units.md#s1122-add_properties_cat)
- **作用与意义**：盯住它：随机数是恒星、形成率与 X 射线三条通道的公共输入。
- **关键过程**：给抽样晕补上质量与三类随机数（恒星、形成率、X 射线）。
- **关键量**：`buffer_size`、`halo_masses`、`star_rng` / `sfr_rng` / `xray_rng`

### S11.3.1-a 关键过程与关键量
- **所属单元**：[S11.3.1 ComputePerturbedHaloCatalog](L3-units.md#s1131-computeperturbedhalocatalog)
- **作用与意义**：盯住它：位移因子与属性补全，决定晕目录在目标红移是否可用。
- **关键过程**：按增长因子算出一/二阶位移因子，把晕坐标推到目标红移并补上恒星与辐射属性。
- **关键量**：`growth_factor`、`velocity_displacement_factor(_2LPT)`、`halos->halo_coords`、`box_size`

### S11.3.2-a 关键过程与关键量
- **所属单元**：[S11.3.2 wrap_position](L3-units.md#s1132-wrap_position)
- **作用与意义**：盯住它：回卷规则决定位移后的坐标是否仍在盒内。
- **关键过程**：位移后越界坐标的回卷，并转成网格索引。
- **关键量**：`wrap_position`、`wrap_coord`、`grid_index_general`

### S11.4.1-a 关键过程与关键量
- **所属单元**：[S11.4.1 move_halo_galprops](L3-units.md#s1141-move_halo_galprops)
- **作用与意义**：盯住它：属性摊派方式决定网格源项的空间分布。
- **关键过程**：把离散晕的属性按质量权重摊到网格上。
- **关键量**：`move_halo_galprops`、`convert_halo_props`、`set_halo_properties`

## S12 天体物理源

### S12.1.1-a 关键过程与关键量
- **所属单元**：[S12.1.1 set_scaling_constants](L3-units.md#s1211-set_scaling_constants)
- **作用与意义**：盯住它：标度关系是全部天体物理参数的落点。
- **关键过程**：把天体物理参数折算成"晕属性 → 星系属性"的换算核。
- **关键量**：`F_STAR10` / `F_ESC10`（标度关系幅度）、`ALPHA_STAR` / `ALPHA_ESC`（斜率）、`get_halo_stellarmass`、`get_halo_xray`

### S12.1.2-a 关键过程与关键量
- **所属单元**：[S12.1.2 lyman_werner_threshold](L3-units.md#s1212-lyman_werner_threshold)
- **作用与意义**：盯住它：质量下限是反馈效应能否体现的关键开关。
- **关键过程**：按 Lyman-Werner 强度与再电离反馈给出两类源的质量下限。
- **关键量**：`lyman_werner_threshold`、`mcrit_noLW`（不含 LW 时的阈值）、`atomic_cooling_threshold`

### S12.2.1-a 关键过程与关键量
- **所属单元**：[S12.2.1 ComputeHaloBox](L3-units.md#s1221-computehalobox)
- **作用与意义**：盯住它：两条源模型路径在这里分界，换模型即换整段计算。
- **关键过程**：先清零源项网格，再按源模型选择"离散晕累加"或"条件积分表"两条路径。
- **关键量**：`SOURCE_MODEL`（路径选择）、`halo_sfr`、`n_ion`、`halo_xray`、`whalo_sfr`、`mturn_a_grid` / `mturn_m_grid`、`log10_Mcrit_ACG_ave` / `log10_Mcrit_MCG_ave`

### S12.2.2-a 关键过程与关键量
- **所属单元**：[S12.2.2 sum_halos_onto_grid](L3-units.md#s1222-sum_halos_onto_grid)
- **作用与意义**：盯住它：这是离散晕模型的全部实现。
- **关键过程**：离散晕路径：逐晕算属性并累加到网格。
- **关键量**：`halo_sfr`、`halo_sfr_mini`、`halo_xray`、`whalo_sfr`

### S12.2.3-a 关键过程与关键量
- **所属单元**：[S12.2.3 set_fixed_grids](L3-units.md#s1223-set_fixed_grids)
- **作用与意义**：盯住它：条件积分路径是另一类源模型的立足点。
- **关键过程**：条件积分路径：建条件表后逐格点积分得到源项，并取盒均值。
- **关键量**：`M_min` / `M_max_integral`（积分上下限）、`hbox_consts`（快照常数）、`mean_fix_grids`（盒均值）

### S12.3.1-a 关键过程与关键量
- **所属单元**：[S12.3.1 ComputeLF](L3-units.md#s1231-computelf)
- **作用与意义**：盯住它：这是与观测对照最直接的一条产物，不推进主链。
- **关键过程**：在质量–红移网格上给出紫外光度函数，纯诊断、不参与主链。
- **关键量**：`Mhalo_param`（质量表）、`z_LF`（红移表）、`M_uv_z` / `M_h_z`（绝对星等与晕质量）、`log10phi`（光度函数）

## S13 电离与复合

### S13.1.1-a 关键过程与关键量
- **所属单元**：[S13.1.1 set_ionbox_constants](L3-units.md#s1311-set_ionbox_constants)
- **作用与意义**：盯住它：常数打包方式决定格点循环的开销。
- **关键过程**：把该快照用到的常数打包成一个结构，避免在格点循环里反复取参。
- **关键量**：`ionbox_constants`、`RecombFactor`、`OVERDENSITY_TOT_MEAN`

### S13.1.2-a 关键过程与关键量
- **所属单元**：[S13.1.2 setup_radii](L3-units.md#s1312-setup_radii)
- **作用与意义**：盯住它：半径序列决定电离场能出现多大的结构。
- **关键过程**：定出该快照要遍历的滤波半径序列，并为首次计算补齐上一快照密度。
- **关键量**：`radii_spec`、`n_radii`、`R_BUBBLE_MAX`

### S13.1.3-a 关键过程与关键量
- **所属单元**：[S13.1.3 allocate_fftw_grids](L3-units.md#s1313-allocate_fftw_grids)
- **作用与意义**：盯住它：变换复用是这一阶段能跑得动的前提。
- **关键过程**：为整箱滤波分配并回收可复用的变换网格。
- **关键量**：`grid_struct`（滤波网格容器）

### S13.2.1-a 关键过程与关键量
- **所属单元**：[S13.2.1 adjust_redshifts_for_photoncons](L3-units.md#s1321-adjust_redshifts_for_photoncons)
- **作用与意义**：盯住它：红移平移是光子守恒校准作用到主链的唯一通道。
- **关键过程**：把本快照红移按校准曲线平移，并给出密度增长修正因子。
- **关键量**：`photoncons_adjustment_factor`、`PHOTON_CONS_TYPE`、`absolute_delta_z`

### S13.3.1-a 关键过程与关键量
- **所属单元**：[S13.3.1 set_mean_fcoll](L3-units.md#s1331-set_mean_fcoll)
- **作用与意义**：盯住它：全局量是判断电离是否启动的依据。
- **关键过程**：先算全局量：平均塌缩分数、电离光子期望与两组塌缩分数下限。
- **关键量**：`exp_global_hii`（全局电离光子期望）、`f_limit_acg` / `f_limit_mcg`（塌缩分数下限）、`mean_f_coll(_MINI)`

### S13.3.2-a 关键过程与关键量
- **所属单元**：[S13.3.2 Nion_General](L3-units.md#s1332-nion_general)
- **作用与意义**：盯住它：这里给出的是判据数值，不是图像。
- **关键过程**：把质量函数在质量区间上积成全局电离光子数与塌缩分数。
- **关键量**：`Nion_General`、`Nion_General_MINI`、`Fcoll_General`

### S13.3.3-a 关键过程与关键量
- **所属单元**：[S13.3.3 set_fully_neutral_box](L3-units.md#s1333-set_fully_neutral_box)
- **作用与意义**：盯住它：提前退出既省算力，也是尚无电离源的显式表示。
- **关键过程**：判为尚无电离源时直接写出完全中性的盒并跳过后续。
- **关键量**：`NO_LIGHT`（无光标志）、`global_xH = 1`

### S13.4.1-a 关键过程与关键量
- **所属单元**：[S13.4.1 setup_integration_tables](L3-units.md#s1341-setup_integration_tables)
- **作用与意义**：盯住它：条件积分表决定逐尺度判据能否成立。
- **关键过程**：在非拉格朗日源网格路径下，逐半径准备条件积分所需的表。
- **关键量**：`FgtrM_delta_table`、`Nion_Conditional_spline`

### S13.4.2-a 关键过程与关键量
- **所属单元**：[S13.4.2 prepare_box_for_filtering](L3-units.md#s1342-prepare_box_for_filtering)
- **作用与意义**：盯住它：变换准备方式决定半径循环的耗时。
- **关键过程**：把密度场搬到傅里叶空间，并在半径循环中复用同一份变换。
- **关键量**：`deltax_unfiltered`（未滤波密度场）、`copy_filter_transform`

### S13.4.3-a 关键过程与关键量
- **所属单元**：[S13.4.3 calculate_fcoll_grid](L3-units.md#s1343-calculate_fcoll_grid)
- **作用与意义**：盯住它：逐格点塌缩分数是电离判据的直接输入。
- **关键过程**：逐格点在当前尺度上积分塌缩分数，得到该尺度的电离判据输入。
- **关键量**：`R`（当前尺度）、逐格点塌缩分数

### S13.4.4-a 关键过程与关键量
- **所属单元**：[S13.4.4 initialise_Nion_Conditional_spline](L3-units.md#s1344-initialise_nion_conditional_spline)
- **作用与意义**：盯住它：表格化方式是精度与速度的取舍点。
- **关键过程**：把"给定局部密度与尺度"的积分结果预先表格化并做样条求值。
- **关键量**：`initialise_Nion_Conditional_spline`、`initialise_FgtrM_delta_table`

### S13.4.5-a 关键过程与关键量
- **所属单元**：[S13.4.5 calculate_mcrit_boxes](L3-units.md#s1345-calculate_mcrit_boxes)
- **作用与意义**：盯住它：质量下限的空间变化是源项非均匀性的来源之一。
- **关键过程**：当质量下限随位置变化时，为每格点算出两类源的质量下限。
- **关键量**：`log10_Mturnover_ave` / `log10_Mturnover_MINI_ave`、LCG/MCG 两类下限

### S13.5.1-a 关键过程与关键量
- **所属单元**：[S13.5.1 ComputeIonizedBox](L3-units.md#s1351-computeionizedbox)
- **作用与意义**：盯住它：这是本阶段的总装配口，字段清单即产物定义。
- **关键过程**：本阶段顶层入口，串起常数、校准、滤波、判据、复合与温度各步。
- **关键量**：`box->neutral_fraction`、`global_xH`、`box->z_reion`、`box->cumulative_recombinations`

### S13.5.2-a 关键过程与关键量
- **所属单元**：[S13.5.2 find_ionised_regions](L3-units.md#s1352-find_ionised_regions)
- **作用与意义**：盯住它：判据的形式决定电离区的形态学特征。
- **关键过程**：对每个过阈值的源做整球标记，累加各格点被覆盖的电离光子数，得到中性分数。
- **关键量**：`neutral_fraction`、`ionisation_rate_G12`、`unnormalised_nion(_mini)`

### S13.5.3-a 关键过程与关键量
- **所属单元**：[S13.5.3 update_in_sphere](L3-units.md#s1353-update_in_sphere)
- **作用与意义**：盯住它：算子实现决定气泡标记的效率。
- **关键过程**：球内格点的几何遍历与判据检查，是气泡标记的算子实现。
- **关键量**：`update_in_sphere`、`check_region`、球心与半径

### S13.6.1-a 关键过程与关键量
- **所属单元**：[S13.6.1 init_MHR](L3-units.md#s1361-init_mhr)
- **作用与意义**：盯住它：模板构建是非均匀复合功能能否启用的前提。
- **关键过程**：构建复合与自屏蔽所需的模板（仅在启用非均匀复合时）。
- **关键量**：`INHOMO_RECO`、MHR 模板表

### S13.6.2-a 关键过程与关键量
- **所属单元**：[S13.6.2 splined_recombination_rate](L3-units.md#s1362-splined_recombination_rate)
- **作用与意义**：盯住它：复合率是电离历史不过分乐观的保证。
- **关键过程**：给出逐格点复合率（含自屏蔽抑制）。
- **关键量**：`splined_recombination_rate`、`Gamma_SS`（自屏蔽抑制）、`MHR_rr`

### S13.6.3-a 关键过程与关键量
- **所属单元**：[S13.6.3 set_recombination_rates](L3-units.md#s1363-set_recombination_rates)
- **作用与意义**：盯住它：累计复合量是长期演化的可用性指标。
- **关键过程**：把复合率写进电离盒，并累积到累计复合量。
- **关键量**：`Gamma12_ion`、`cumulative_recombinations`

### S13.7.1-a 关键过程与关键量
- **所属单元**：[S13.7.1 set_ionized_temperatures](L3-units.md#s1371-set_ionized_temperatures)
- **作用与意义**：盯住它：温度赋值是电离与热两个阶段的接口。
- **关键过程**：对完全电离与部分电离两类格点分别给出动理学温度。
- **关键量**：`kinetic_temperature`、中性分数阈值（分类判据）

### S13.7.2-a 关键过程与关键量
- **所属单元**：[S13.7.2 ComputeFullyIonizedTemperature](L3-units.md#s1372-computefullyionizedtemperature)
- **作用与意义**：盯住它：两类温度解决定电离区热状态的物理可信度。
- **关键过程**：用热化学平衡给出两类区域的温度解。
- **关键量**：`ComputeFullyIonizedTemperature`、`ComputePartiallyIonizedTemperature`、`RecombFactor`

## S14 热与自旋温度

### S14.1.1-a 关键过程与关键量
- **所属单元**：[S14.1.1 alloc_global_arrays](L3-units.md#s1411-alloc_global_arrays)
- **作用与意义**：盯住它：全局数组是跨快照连续演化的载体。
- **关键过程**：分配跨快照复用的全局数组（只在首次调用时）。
- **关键量**：`x_e_ave_p`（上一快照电子分数）、全局数组容器

### S14.1.2-a 关键过程与关键量
- **所属单元**：[S14.1.2 setup_z_edges](L3-units.md#s1412-setup_z_edges)
- **作用与意义**：盯住它：壳层切分方式直接决定精度与耗时。
- **关键过程**：把上一快照到本快照之间切成若干壳层；红移过高时直接给出无光初值。
- **关键量**：`zpp_for_evolve_list`（壳层红移）、`NO_LIGHT`、`Z_HEAT_MAX`

### S14.1.3-a 关键过程与关键量
- **所属单元**：[S14.1.3 init_heat](L3-units.md#s1413-init_heat)
- **作用与意义**：盯住它：沉积表是次级电子物理唯一的外部依赖。
- **关键过程**：读入次级电子能量沉积表并准备频率积分容器（只做一次）。
- **关键量**：`initialize_interp_arrays`、能量沉积分数表

### S14.2.1-a 关键过程与关键量
- **所属单元**：[S14.2.1 calculate_spectral_factors](L3-units.md#s1421-calculate_spectral_factors)
- **作用与意义**：盯住它：预因子是 Lyα 耦合强度的量纲来源。
- **关键过程**：为各 Lyman 跃迁准备光子预因子。
- **关键量**：`freq_int_lya_tbl`（Lyα 频段系数）、再循环系数

### S14.2.2-a 关键过程与关键量
- **所属单元**：[S14.2.2 frecycle](L3-units.md#s1422-frecycle)
- **作用与意义**：盯住它：再循环系数决定同样多的光子能产生多少次散射。
- **关键过程**：给出各能级的再循环系数与频率表。
- **关键量**：`frecycle`、`nu_n`、主量子数

### S14.2.3-a 关键过程与关键量
- **所属单元**：[S14.2.3 spectral_emissivity](L3-units.md#s1423-spectral_emissivity)
- **作用与意义**：盯住它：发射率是源项与 Lyman 频率之间的翻译层。
- **关键过程**：源谱在 Lyman 频率上的发射率与散射修正因子。
- **关键量**：`spectral_emissivity`、`Salpha_tilde`、`xalpha_tilde`

### S14.3.1-a 关键过程与关键量
- **所属单元**：[S14.3.1 UpdateXraySourceBox](L3-units.md#s1431-updatexraysourcebox)
- **作用与意义**：盯住它：源箱的形态决定 X 射线影响的空间范围。
- **关键过程**：为给定内/外半径做环状滤波，产出 [P07 X 射线源箱](L0-pipeline.md#p07-x-射线源箱) 的一个半径切片。
- **关键量**：`R_inner` / `R_outer` / `R_ct`、`filtered_sfr` / `filtered_xray`、`mean_sfr`

### S14.3.2-a 关键过程与关键量
- **所属单元**：[S14.3.2 one_annular_filter](L3-units.md#s1432-one_annular_filter)
- **作用与意义**：盯住它：环平均是来自某个壳层这一概念的实现。
- **关键过程**：两个半径之差构成的环上做球平均，得到"来自该壳层"的贡献。
- **关键量**：`one_annular_filter`、`R_inner` / `R_outer`

### S14.3.3-a 关键过程与关键量
- **所属单元**：[S14.3.3 global_reion_properties](L3-units.md#s1433-global_reion_properties)
- **作用与意义**：盯住它：全局电离历史是热阶段与电离阶段的共同基准。
- **关键过程**：给出该红移的全局电离历史（填充因子、平均电子分数等）。
- **关键量**：`Q_HI`（全局填充因子）、`x_e_ave_p`

### S14.3.4-a 关键过程与关键量
- **所属单元**：[S14.3.4 initialise_SFRD_spline](L3-units.md#s1434-initialise_sfrd_spline)
- **作用与意义**：盯住它：样条化方式是源随红移变化的精度控制点。
- **关键过程**：把恒星形成率与电离光子的红移依赖做成样条。
- **关键量**：`initialise_SFRD_spline`、`initialise_Nion_Ts_spline`、`EvaluateSFRD`

### S14.3.5-a 关键过程与关键量
- **所属单元**：[S14.3.5 calculate_sfrd_from_grid](L3-units.md#s1435-calculate_sfrd_from_grid)
- **作用与意义**：盯住它：网格统计与解析计算是两种口径，不能混用。
- **关键过程**：从源项网格统计出恒星形成率密度（拉格朗日源网格路径）。
- **关键量**：`calculate_sfrd_from_grid`

### S14.4.1-a 关键过程与关键量
- **所属单元**：[S14.4.1 fill_freqint_tables](L3-units.md#s1441-fill_freqint_tables)
- **作用与意义**：盯住它：频率积分表是热阶段的主要开销所在。
- **关键过程**：对每个壳层把 X 射线谱在频率上积分成加热/电离/Lyman 三类系数。
- **关键量**：`freq_int_heat_tbl`、`freq_int_ion_tbl`、`freq_int_lya_tbl`

### S14.4.2-a 关键过程与关键量
- **所属单元**：[S14.4.2 integrate_over_nu](L3-units.md#s1442-integrate_over_nu)
- **作用与意义**：盯住它：频率积分决定能量去加热还是去电离。
- **关键过程**：沿频率的衰减与沉积积分，含单位光深的频率位置。
- **关键量**：`integrate_over_nu`、`tauX`（光深）、`nu_tau_one`

### S14.4.3-a 关键过程与关键量
- **所属单元**：[S14.4.3 set_zp_consts](L3-units.md#s1443-set_zp_consts)
- **作用与意义**：盯住它：壳层常数是格点循环的输入契约。
- **关键过程**：把该壳层参数打包成结构，供格点循环直接使用。
- **关键量**：`zp_consts`、`R_values`、`sigma_min` / `sigma_max`、`M_min_R` / `M_max_R`

### S14.5.1-a 关键过程与关键量
- **所属单元**：[S14.5.1 ts_main](L3-units.md#s1451-ts_main)
- **作用与意义**：盯住它：辐射率箱是自旋温度求解的全部输入。
- **关键过程**：把每个壳层的贡献累加成逐格点的加热率、电离率与 Lyman 各系列辐射率。
- **关键量**：`dxheat_dt_box` / `dxion_source_dt_box`、`dxlya_dt_box` / `dstarlya_dt_box` / `dstarlyLW_dt_box`

### S14.6.1-a 关键过程与关键量
- **所属单元**：[S14.6.1 get_Ts](L3-units.md#s1461-get_ts)
- **作用与意义**：盯住它：单点求解是自旋温度物理的集中体现。
- **关键过程**：解出单点的自旋温度与电子分数（含 Lyα 与碰撞耦合）。
- **关键量**：`get_Ts`、`Tc_eff`（有效色温）、`Salpha_tilde`

### S14.6.2-a 关键过程与关键量
- **所属单元**：[S14.6.2 get_Ts_fast](L3-units.md#s1462-get_ts_fast)
- **作用与意义**：盯住它：格点落地方式决定三张输出图是否自洽。
- **关键过程**：把单点求解嵌进格点循环，写入自旋温度、电离度与动理学温度。
- **关键量**：`spin_temperature`、`xray_ionised_fraction`、`kinetic_temp_neutral`、`J_21_LW`

### S14.6.3-a 关键过程与关键量
- **所属单元**：[S14.6.3 xcoll_HI](L3-units.md#s1463-xcoll_hi)
- **作用与意义**：盯住它：碰撞耦合在低温高密度时是主导项。
- **关键过程**：给出氢原子与电子/质子/氢原子的碰撞退激发率。
- **关键量**：`xcoll_HI`、`xcoll_eH` / `xcoll_pH`

### S14.7.1-a 关键过程与关键量
- **所属单元**：[S14.7.1 thermochem.c 率系数](L3-units.md#s1471-thermochemc-率系数)
- **作用与意义**：盯住它：率系数共用一处，是两阶段不自相矛盾的前提。
- **关键过程**：提供被 S13、S14 反复引用的原子物理率系数与光电截面。
- **关键量**：复合/电离/冷却率系数族、`atomic_cooling_threshold`、`ComputeTau`

### S14.7.2-a 关键过程与关键量
- **所属单元**：[S14.7.2 interp_fheat](L3-units.md#s1472-interp_fheat)
- **作用与意义**：盯住它：沉积插值是 X 射线能量去向的最终分配。
- **关键过程**：次级电子能量沉积分数的双线性插值（按能量与电离度）。
- **关键量**：`interp_fheat`、`interp_n_Lya`、`interp_nion_HI` / `interp_nion_HeI` / `interp_nion_HeII`

## S15 亮温输出

### S15.1.1-a 关键过程与关键量
- **所属单元**：[S15.1.1 ComputeBrightnessTemp 常数与前因子段](L3-units.md#s1511-computebrightnesstemp-常数与前因子段)
- **作用与意义**：盯住它：前因子是亮温量纲的基准，错一处整幅图会整体偏移。
- **关键过程**：按本快照红移算出背景辐射温度、哈勃率与信号换算前因子。
- **关键量**：`const_factor`（前因子）、`T_rad`（背景辐射温度）、`H`（哈勃率）

### S15.2.1-a 关键过程与关键量
- **所属单元**：[S15.2.1 ComputeBrightnessTemp 幅度填充段](L3-units.md#s1521-computebrightnesstemp-幅度填充段)
- **作用与意义**：盯住它：这是主链里最直接可观测的量。
- **关键过程**：中性分数 × 密度对比 × 前因子，逐格点写入信号。
- **关键量**：`pixel_x_HI`（中性分数）、`pixel_deltax`（密度对比）、`box->brightness_temp`

### S15.3.1-a 关键过程与关键量
- **所属单元**：[S15.3.1 ComputeBrightnessTemp 光学深度修正段](L3-units.md#s1531-computebrightnesstemp-光学深度修正段)
- **作用与意义**：盯住它：光学深度决定低温时段的信号是否可信。
- **关键过程**：启用自旋温度涨落时计算光学深度，并用自旋温度改写信号。
- **关键量**：`USE_TS_FLUCT`、`box->tau_21`、`spin_temp->spin_temperature`

### S15.4.1-a 关键过程与关键量
- **所属单元**：[S15.4.1 ComputeBrightnessTemp 均值与有限性段](L3-units.md#s1541-computebrightnesstemp-均值与有限性段)
- **作用与意义**：盯住它：这是主链最后一道校验，异常不会被静默带出。
- **关键过程**：求盒平均并检查是否存在非有限值，异常则报错。
- **关键量**：`ave`（盒平均）、有限性检查

### S15.4.2-a 关键过程与关键量
- **所属单元**：[S15.4.2 debugSummarizeBox](L3-units.md#s1542-debugsummarizebox)
- **作用与意义**：盯住它：定位异常时最先看的地方。
- **关键过程**：调试模式下打印盒的极值与均值。
- **关键量**：`debugSummarizeBox(Double)` / `debugSummarizeBox(Complex)`

## S16 跨阶段基建与校准

### S16.1.1-a 关键过程与关键量
- **所属单元**：[S16.1.1 InitialisePhotonCons](L3-units.md#s1611-initialisephotoncons)
- **作用与意义**：盯住它：初始化状态是校准流程能否继续的前提。
- **关键过程**：分配校准内存并置位"已初始化"标志。
- **关键量**：`photon_cons_allocated`（extern 标志）

### S16.1.2-a 关键过程与关键量
- **所属单元**：[S16.1.2 PhotonCons_Calibration](L3-units.md#s1612-photoncons_calibration)
- **作用与意义**：盯住它：拟合曲线是电离历史位置正确性的来源。
- **关键过程**：与解析电离历史比对得到红移偏移曲线，并给出逃逸分数随红移的拟合。
- **关键量**：`PhotonCons_deltaz`（红移偏移曲线）、`PhotonCons_NFdata`、`get_fesc_fit`、`z_at_Q` / `Q_at_z`

### S16.1.3-a 关键过程与关键量
- **所属单元**：[S16.1.3 ObtainPhotonConsData](L3-units.md#s1613-obtainphotonconsdata)
- **作用与意义**：盯住它：两侧可见性决定校准能否被回灌到主链。
- **关键过程**：把校准结果导出给 Python 侧，并在需要时释放内存。
- **关键量**：`z_cal_data` / `nf_cal_data`、`Ndata_PhotonCons`

### S16.2.1-a 关键过程与关键量
- **所属单元**：[S16.2.1 wrap_coord](L3-units.md#s1621-wrap_coord)
- **作用与意义**：盯住它：索引换算共用一处，避免了各处各写一遍的偏差。
- **关键过程**：坐标回卷与"格点 ↔ 索引"的通用换算。
- **关键量**：`wrap_coord`、`grid_index_fftw_r` / `grid_index_fftw_c`

### S16.2.2-a 关键过程与关键量
- **所属单元**：[S16.2.2 random_point_in_sphere](L3-units.md#s1622-random_point_in_sphere)
- **作用与意义**：盯住它：抽样取点是随机晕位置分布的实现。
- **关键过程**：在球内/胞内取随机点（随机晕采样用）。
- **关键量**：`random_point_in_sphere`、`random_point_in_cell`

### S16.3.1-a 关键过程与关键量
- **所属单元**：[S16.3.1 allocate_RGTable2D](L3-units.md#s1631-allocate_rgtable2d)
- **作用与意义**：盯住它：二维表容器支撑条件积分表的全部查询。
- **关键过程**：二维规则网格表的分配与双线性求值。
- **关键量**：`RGTable2D`、`EvaluateRGTable2D`、`RGTable2D_out_of_bounds`

### S16.3.2-a 关键过程与关键量
- **所属单元**：[S16.3.2 free_global_tables](L3-units.md#s1632-free_global_tables)
- **作用与意义**：盯住它：释放时机决定换参数重跑是否会读到旧值。
- **关键过程**：按类别释放全局表与条件表，避免跨参数污染。
- **关键量**：`free_global_tables`、`free_conditional_tables`

### S16.4.1-a 关键过程与关键量
- **所属单元**：[S16.4.1 writeSimulationOptions](L3-units.md#s1641-writesimulationoptions)
- **作用与意义**：盯住它：日志里的参数是复现某次运行的全部依据。
- **关键过程**：把参数结构逐字段打进日志，便于复现某次运行。
- **关键量**：`writeSimulationOptions`、`writeCosmoParams`、`writeAstroParams`、`writeAstroOptions`

### S16.4.2-a 关键过程与关键量
- **所属单元**：[S16.4.2 SomethingThatCatches](L3-units.md#s1642-somethingthatcatches)
- **作用与意义**：盯住它：异常通路本身也需要被验证，它是所有报错的可信度基础。
- **关键过程**：验证"后端报错 → Python 异常"这条通路本身是否可靠。
- **关键量**：`SomethingThatCatches`、`FunctionThatCatches`、`FunctionThatThrows`

---

## 末端

本层是整棵树的末端，不再向下链接。上层编排见 [L0](L0-pipeline.md) / [L1](L1-stages.md) / [L2](L2-subprocesses.md) / [L3](L3-units.md)；后端细节见 [CODE_TOPOLOGY.md](../CODE_TOPOLOGY.md)。
