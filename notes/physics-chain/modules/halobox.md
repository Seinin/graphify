# 网格化源项

源项是链上第一次出现空间结构的地方。之前的量都只讲体积平均，从这里开始，源被铺到三维格点上：恒星形成率、电离光子与 X 射线三类权重各得一张场，供电离与加热按格点取用。"源在哪里"这个信息就是这一步注入的。

铺场有两条口径。一条把离散晕按属性逐个摊到格点上，再把全域平均校准回解析平均，以压掉有限分辨带来的偏差——它保留晕的位置与散粒噪声。另一条直接按条件质量函数与条件积分表逐格算，平滑但更快。两条口径给的是同一张场的两种精度，怎么选由源模型的档位决定。

分辨率是这块的固有局限：格内能出现的最大塌缩质量由体元尺度定，体元以下的结构与晕的成团都不被分辨，只能靠把平均校准回解析值来校正整体幅度。因此这张场的大尺度图案可靠，小尺度细节取决于分辨率。

## 源项的实现 · 把源项的积分算出来

### 物理

源项网格是把离散晕的贡献铺到三维格点上的那一步：每个格点按自己的平均密度定出格内能出现的最大塌缩质量，与全局的质量上下限一起给出该格的条件质量函数；塌缩分数、恒星质量、恒星形成率、电离光子与 X 射线都用这一套条件积分，只配不同权重。

它有两种口径：把真实晕按属性逐个摊到格点上，再把全域平均校准回解析平均，以压掉有限分辨的偏差；或直接按条件质量函数与条件积分表逐格计算。前者保留了晕的位置与散粒噪声，后者平滑但更快，两者给的是同一张场的两种精度。

它读入密度场、晕属性与自旋温度，输出同一批格点上的多张场：恒星形成率、电离光子与 X 射线三类权重各自一张，供电离与加热按格点取用。因为筛选条件是密度，这一步把"源在哪里"的空间信息第一次注进链里——此前的量都是体积平均，从这里开始才有空间结构。

局限在网格分辨率：格内最大塌缩质量由体元尺度定，体元以下的结构与晕的成团都不被分辨，只能靠把平均校准回解析值来校正整体幅度，所以这张场的大尺度图案可靠，小尺度细节取决于分辨率。

$$f_{\rm coll}(\rho)=\frac{1}{\rho_m}\int_{M_{\min}}^{M_{\rm cell}(\rho)}\mathrm dM\,M\,\frac{\mathrm dn}{\mathrm dM}$$

### 代码解析

两条口径在 `map_mass.c` 里各有一段。

第一条在 `move_grid_galprops` 里，逐个晕处理：对晕所在的格点求出一份条件积分 `properties`，再按属性分几路做云中云插值——恒星质量带的是恒星形成率权重，电离光子带的是逃逸加权的积分，X 射线只在开自旋温度涨落时铺。同一个 `properties` 里还有晕的计数与总质量场，它们只在开了额外输出开关时才铺，不进任何物理链条。条件积分那段的注释把权重讲得很清楚：哪个量乘了逃逸分数、哪个没乘——读这张网格时如果不注意，很容易把恒星质量错当成电离光子的来源。

第二条在 `sum_halos_onto_grid` 里，不做散粒点，直接对每个晕按它所在的位置做一次插值，把恒星形成率、电离光子、mini-halo 与 X 射线铺上去；开非均匀复合时还多铺一份逃逸加权的恒星形成率，供下游算复合用。

总装在 `HaloBox.c` 的 `ComputeHaloBox`：源模型档位高于 2 时先把离散星表铺上格，然后按档位定条件积分的上限——用采样器的最小质量、用格点能分辨的质量、或用一个固定上限。只有在质量下限低于这个上限时才继续，否则这一段积分口径就空着，说明源全由离散晕提供。

再往下 `set_fixed_grids` 按本格密度建条件积分表：恒星形成率、含再电离反馈的电离光子、质量函数，以及开自旋温度涨落时的 X 射线表，四张表建好后同样交给 `move_grid_galprops` 把整段质量区间铺到格上。看这一串调用的顺序有个好处：能分清哪些量来自离散晕、哪些来自条件积分。

### 工程

- `src/py21cmfast/src/map_mass.c:300-334`

```c
                    get_cell_integrals(curr_dens, l10_mturn_a, l10_mturn_m, consts, integral_cond,
                                       &properties);

                    // using the properties struct:
                    // stellar_mass --> no F_esc integral ACG
                    // stellar_mass_mini --> no F_esc integral MCG
                    // n_ion --> F_esc integral ACG
                    // fescweighted_sfr --> F_esc integral MCG
                    // halo_xray --> Xray integral
                    do_cic_interpolation(boxes->halo_sfr, pos, out_dim,
                                         properties.stellar_mass * prefactor_sfr);
                    do_cic_interpolation(boxes->n_ion, pos, out_dim,
                                         properties.n_ion * prefactor_nion +
                                             properties.fescweighted_sfr * prefactor_nion_mini);

                    if (astro_options_global->USE_MINI_HALOS) {
                        do_cic_interpolation(boxes->halo_sfr_mini, pos, out_dim,
                                             properties.stellar_mass_mini * prefactor_sfr_mini);
                    }
                    if (astro_options_global->USE_TS_FLUCT) {
                        do_cic_interpolation(boxes->halo_xray, pos, out_dim,
                                             properties.halo_xray * prefactor_xray);
                    }

                    if (config_settings.EXTRA_HALOBOX_FIELDS) {
                        do_cic_interpolation(boxes->count, pos, out_dim, properties.count);
                        do_cic_interpolation(boxes->halo_mass, pos, out_dim,
                                             properties.halo_mass * prefactor_mass);
                        do_cic_interpolation(boxes->halo_stars, pos, out_dim,
                                             properties.stellar_mass * prefactor_stars);
                        if (astro_options_global->USE_MINI_HALOS) {
                            do_cic_interpolation(
                                boxes->halo_stars_mini, pos, out_dim,
                                properties.stellar_mass_mini * prefactor_stars_mini);
                        }
```

- `src/py21cmfast/src/map_mass.c:421-433`

```c
            // CIC interpolation
            set_halo_properties(hmass, M_turn_a, M_turn_m, consts, halo_rng, &properties);
            do_cic_interpolation(boxes->halo_sfr, pos, out_dim, properties.halo_sfr);
            do_cic_interpolation(boxes->n_ion, pos, out_dim, properties.n_ion);
            if (astro_options_global->USE_MINI_HALOS) {
                do_cic_interpolation(boxes->halo_sfr_mini, pos, out_dim, properties.sfr_mini);
            }
            if (astro_options_global->USE_TS_FLUCT) {
                do_cic_interpolation(boxes->halo_xray, pos, out_dim, properties.halo_xray);
            }
            if (astro_options_global->INHOMO_RECO) {
                do_cic_interpolation(boxes->whalo_sfr, pos, out_dim, properties.fescweighted_sfr);
            }
```

#### ComputeHaloBox
- `src/py21cmfast/src/HaloBox.c:628-645`——源格子总装：`SOURCE_MODEL > 2` 时把离散星表铺上格；再按 `SOURCE_MODEL` 定亚星表积分上限 `M_max_integral`，交给 `set_fixed_grids` 把 `[M_min, M_max_integral]` 这一段积进 `grids`。

```c
        if (matter_options_global->SOURCE_MODEL > 2) {
            sum_halos_onto_grid(redshift, ini_boxes, halos, mturn_a_grid, mturn_m_grid,
                                &hbox_consts, grids);
        }
        // set sub-catalogue properties
        if (matter_options_global->SOURCE_MODEL == 4) {
            M_max_integral = simulation_options_global->SAMPLER_MIN_MASS;
        } else if (matter_options_global->SOURCE_MODEL == 3) {
            M_max_integral = RtoM(physconst.l_factor * simulation_options_global->BOX_LEN /
                                  simulation_options_global->DIM);
        } else {
            M_max_integral = M_MAX_INTEGRAL;
        }
        if (M_min < M_max_integral) {
            set_fixed_grids(M_min, M_max_integral, ini_boxes, mturn_a_grid, mturn_m_grid,
                            &hbox_consts, grids);
            LOG_DEBUG("finished integrated component M[%.2e %.2e]", M_min, M_max_integral);
        }
```

#### sum_halos_onto_grid
- `src/py21cmfast/src/HaloBox.c:547-548`——逐个 halo 把恒星形成率与电离光子产量累加到它所在的格（`move_halo_galprops`），得 `halo_sfr` 与 `n_ion`；`INHOMO_RECO` 时另累一份 `whalo_sfr`。

```c
    move_halo_galprops(redshift, halos, vel_pointers, vel_pointers_2LPT, vel_dim, mturn_a_grid,
                       mturn_m_grid, grids, out_dim, consts);
```

#### set_fixed_grids
- `src/py21cmfast/src/HaloBox.c:398-417`——按本格密度与质量分格建四张积分表——`SFRD`、含再电离反馈的 `Nion`、`dNdM`，以及开 `USE_TS_FLUCT` 时的 X 射线表——再用 `move_grid_galprops` 把整段质量区间的贡献铺到格上。

```c
        initialise_SFRD_Conditional_table(ev_consts->redshift, min_density, max_density, M_min,
                                          M_max, M_cell, ev_consts);

        // This table includes reionisation feedback, but takes the atomic turnover anyway for the
        // upper turnover
        initialise_Nion_Conditional_spline(ev_consts->redshift, min_density, max_density, M_min,
                                           M_max, M_cell, min_log10_mturn_a, max_log10_mturn_a,
                                           min_log10_mturn_m, max_log10_mturn_m, ev_consts, false);

        initialise_dNdM_tables(min_density, max_density, integral_cond.lnM_min,
                               integral_cond.lnM_max, integral_cond.growth_factor,
                               integral_cond.lnM_cell, false);
        if (astro_options_global->USE_TS_FLUCT) {
            initialise_Xray_Conditional_table(ev_consts->redshift, min_density, max_density, M_min,
                                              M_max, M_cell, ev_consts);
        }
    }
    move_grid_galprops(ev_consts->redshift, dens_pointer, grid_dim, vel_pointers, vel_pointers_2LPT,
                       grid_dim, grids, out_dim, mturn_a_grid, mturn_m_grid, ev_consts,
                       &integral_cond);
```

- 输入：晕属性（$M_\star$、$\dot M_\star$、$f_{\rm esc}$、$L_X$）、$\delta$、$v_{cb}$ 与上一快照 $T_s$；上游为 scaling_relations 与 dn_dm
- 产出：源项网格：SFR、电离光子与 X 射线三类权重

### 参数语境

#### INHOMO_RECO

非均匀再复合的总开关。打开时源项权重会按局部电离度改写（`src/py21cmfast/src/HaloBox.c` 里 `whalo_sfr` 那条支），网格上的源因此带上"被自己电离出来的气体反压"这一项；关闭时网格只由密度场与标度关系决定。

#### INTEGRATION_METHOD_ATOMIC

原子冷却支积分的求积方法，决定每个格点的塌缩分数怎么积出来。换方法只带来小的数值差异。

#### INTEGRATION_METHOD_MINI

分子冷却支的求积方法，与上一项各管一支。

#### M_TURN

恒星形成的截断质量，经坍缩分数进源项。它随红移由反馈移动，是这张网格上最主要的红移依赖——同一个格点在相邻两个快照上的源强差异，多半来自它。

#### OMm

总物质密度。它进坍缩分数与密度因子 $(1+\delta)$（阈值与归一都随它变），因此它改的不只是网格整体高低，还有网格里对比度的大小。

#### USE_MINI_HALOS

迷你晕总开关。打开时网格上多一整套迷你晕权重（`halo_sfr_mini`、与之配套的转折质量场等），下游的滤波要对它们各滤一遍；关闭时这些格子在内存里根本不出现。

#### USE_TS_FLUCT

自旋温度涨落的总开关，决定这张网格要不要附带与逐格点自旋温度配套的量，以及这次计算走逐格点还是平均路径。

## Ṅ_ion(z) · 电离光子发射率

### 物理

电离光子发射率是单位体积、单位时间里发出的电离光子数：由恒星形成率密度乘上每个恒星形成活动放出的电离光子数、再乘上逃逸分数给出。它是电离场那本账右侧唯一的源项，红移演化的形状几乎就是再电离历史本身——源项早，再电离就早。

公式是三个因子的乘积：恒星形成率密度、每重子的光子产额与逃逸分数；第二、第三星族各有一套产额与逃逸分数，总速率是两套的和。前提是光子就地瞬时产生，且逃逸分数与光子产额都用与质量、红移无关的平均值——真实的逃逸分数随晕质量与红移有依赖，这里被压成一个常数。

进它的是恒星形成率密度、光子产额与逃逸分数，后两者随红移演化；分子冷却支另加一条，由小质量晕的恒星形成率密度与它们自己的产额、逃逸分数组成。它是积分量，先按质量函数对逐晕贡献积分，再在源项网格上按密度分格，所以体积平均值与空间结构都从这一步出来。

数学上它对三个因子都是精确线性的，于是它与恒星形成效率、逃逸分数、光子产额之间存在完全的简并：三者只以乘积出现，任一单独都约束不到，要靠紫外光度分布把它们拆开。这一条没有记忆、也不非局域，红移是唯一的自变量。

它交给电离场当唯一源项，与复合项一起定电离分数与再电离历史；X 射线加热与莱曼-$\alpha$ 背景则从恒星形成率密度分出去走自己的路。局限在它假定光子瞬时产生、逃逸分数取常数、且不区分星族光谱的细节——真实的逃逸随环境变化、光子谱也随金属性与星族不同，这些都被折进那两个有效因子。

$$\dot n_{\rm ion}(z)=f_{\rm esc}N_{\rm ion}\,\dot\rho_\star(z)$$

### 代码解析

`HaloBox.c` 里有两处给出这个量。一处在算全盒平均时：逃逸加权的积分乘上光子产额系数，再加上 mini-halo 那一份，两者相加就是平均发射率。另一处是逐格点的版本 `EvaluateNion_Conditional`，按格点密度查条件积分表，取出来的就是这一格的光子产额。

两处共用同一组系数，所以平均与逐格点走的是同一套换算——这也是"体积平均值与空间结构从同一步出来"在代码里的样子：先有逐格点的场，平均只是它的一次求和。

### 工程

- `src/py21cmfast/src/HaloBox.c:153-154`

```c
    averages_out->n_ion =
        (intgrl_fesc_weighted * prefactor_nion) + (intgrl_fesc_weighted_mini * prefactor_nion_mini);
```

- `src/py21cmfast/src/HaloBox.c:259-263`

```c
    // n_ion --> F_esc integral ACG
    // fescweighted_sfr --> F_esc integral MCG
    // halo_xray --> Xray integral
    // halo_mass --> total mass
    properties->n_ion = EvaluateNion_Conditional(dens, l10_mturn_a, growth_z, M_min, M_max, M_cell,
```

- 输入：$f_{\rm esc}N_{\rm ion}$、$\dot\rho_\star$、$\zeta$ 与 $v_{cb}$；上游为 source_grid、zeta、fstar、rho_star
- 产出：电离光子发射率 $\dot n_{\rm ion}(z)$

### 参数语境

这一篇与 `rho_star` 共用同一把积分核，区别是这个核在这里**不置零**：逃逸分数与每重子的光子数都进被积函数。所以同样一批参数，在 `rho_star` 里空转的，在这里起作用。下面逐条说明。

#### ALPHA_ESC

逃逸分数随质量的幂指数。在这一篇它真正进入被积函数：低质量晕的逃逸分数随它抬高或压平，于是低质量端的贡献被放大或削减。改动它直接改电离光子率，进而改整个再电离的时点。

#### ALPHA_STAR

恒星形成效率低质量端的斜率。它先改逐晕的恒星形成率，再乘上逃逸分数与光子数进积分——在这条链上是"源有多亮"的第一个旋钮，对积分结果是非线性响应。

#### ALPHA_STAR_MINI

分子冷却支的同一个斜率，只在打开迷你晕时用于第二支。那一支在低质量端权重更大，因此它对本篇的影响比在 `rho_star` 里更显著。

#### A_LW

莱曼-维尔纳反馈的幅度系数，经分子冷却支的转折质量抬升积分下限。反馈一强，能电离的晕变少，电离光子率随之下调，再电离被推迟。

#### A_VCB

相对速度反馈的幅度系数，与 `A_LW` 并联进同一个转折质量。

#### BETA_LW

莱曼-维尔纳反馈的幂指数，定反馈随背景强度变化的快慢。它在"电离发生得越快、背景越强、反馈越强"这条自我压制链上定的是斜率。

#### BETA_VCB

相对速度反馈的幂指数，作用方式相同、变量换成 $v_{\rm cb}$。

#### FIXED_VAVG

只在打开 `FIX_VCB_AVG` 时被读：用固定值代替逐点平均的相对速度，反馈不再带空间涨落，电离光子率的空间分布随之变平滑。

#### F_ESC10

在 $10^{10}M_\odot$ 处锚定逃逸分数线的归一。在本篇它直接乘在每组源上：它与 `POP2_ION`、`F_STAR10` 的乘积就是综合电离效率，三者单独都约束不到，只能靠紫外光度分布与 21 厘米观测联立拆开。把这个乘积调大一倍，电离光子率整体翻倍，再电离相应提前。

#### F_ESC7_MINI

分子冷却支的逃逸分数锚点，只管低质量那一支，且只在打开迷你晕时存在。

#### F_STAR10

恒星形成效率的归一。它在这条乘积里的位置与 `F_ESC10` 对称，两者在观测上简并。

#### F_STAR7_MINI

分子冷却支的恒星形成效率归一，管第二支的水平。它在"迷你晕是否主导早期电离"这个问题上是关键旋钮。

#### INHOMO_RECO

非均匀再复合的总开关。打开时，逐格点的电离度反馈会压制源强（`src/py21cmfast/src/HaloBox.c:179`、`226` 一带的加权），本篇的光子率因此带上"被自己电离出来的气体反压"这一项；关闭时源强只由标度关系与质量函数给出。

#### INTEGRATION_METHOD_ATOMIC

原子冷却支积分的求积方法。换方法只带来小的数值差异，物理不变。

#### INTEGRATION_METHOD_MINI

分子冷却支的求积方法，与上一项各管一支，可以取不同方法。

#### L_X

单位恒星形成率的比 X 射线光度。它不进这一篇的积分（被积函数里只有恒星形成率与电离光子数）；把它列在这里是因为它与本篇的几个旋钮同源、在参数扫描时通常一起动，但它的作用面在下游加热。

#### L_X_MINI

分子冷却支的对应量，同样不在本篇的积分里，只在打开迷你晕时被加热一侧读。

#### M_TURN

恒星形成的截断质量，定积分下限与低质量端的抑制。它随红移由反馈移动，所以本篇的源强对红移演化比任何指数都敏感——再电离时点对它的响应通常最直接。

#### OMb

重子密度。它既经重子比例进恒星质量（改源强），又定数密度口径（改"每单位体积有多少源"）。它是整体乘数，与恒星形成效率归一简并。

#### OMm

总物质密度。它同时动质量函数的归一与塌缩阈值，以及重子比例，因此不是单纯的缩放；调它会把源强随红移的整条曲线改变形状。

#### PHOTON_CONS_TYPE

光子守恒修正的类型（`src/py21cmfast/wrapper/photoncons.py`）。打开时电离历史被按累积光子数重标定，本篇算出的光子率因此不再是直接采信的那一版，而是被校准量改过的版本；关闭时不做这层修正。它与 `PHOTONCONS_CALIBRATION_END` 一起用。

#### POP2_ION

每重子的电离光子数。它在本篇直接进被积函数，与 `F_STAR10`、`F_ESC10` 组成电离效率，是本篇三个并列旋钮中的一个。

#### POP3_ION

分子冷却支的同一个量，只在打开迷你晕时用于第二支。

#### SIGMA_LX

X 射线光度关系的对数正态散射，属于加热那一条链，不在本篇积分里。

#### SIGMA_SFR_INDEX

恒星质量-恒星形成率关系的散射随质量变化的幂指数（参数面文档串给出的含义）。本仓 C 端不读它——全仓搜索只出现在参数面文档串里，本篇没有它的作用面。

#### SIGMA_SFR_LIM

恒星质量-恒星形成率关系在高质量端的对数正态散射（参数面文档串给出的含义），同样在本仓 C 端没有落点。

#### SIGMA_STAR

晕质量-恒星质量关系的对数正态散射。集平均这条路上它以 $e^{-\sigma_\star^2/2}$ 压低有效归一，于是同样的参数下电离光子率略低；逐晕记录那一路另外逐晕抽样，同一个红移会出现多条源强史。

#### UPPER_STELLAR_TURNOVER_INDEX

高质量端附加幂律的指数（`USE_UPPER_STELLAR_TURNOVER` 打开时生效）。大质量晕对积分权重小，所以它对电离光子率的影响远小于低质量端指数。

#### UPPER_STELLAR_TURNOVER_MASS

上面那段附加幂律的拐点质量，定"从多大质量开始压"。

#### USE_MINI_HALOS

迷你晕总开关。打开时源项多一支（第 3 族恒星），早期电离可能由它主导，电离光子率在 $z\gtrsim 10$ 明显抬高；关闭时 `F_STAR7_MINI`、`F_ESC7_MINI`、`POP3_ION`、`ALPHA_STAR_MINI` 等一组参数在本篇全部失去作用面。

#### USE_TS_FLUCT

自旋温度涨落的总开关，决定逐格点路径还是全宇宙平均路径被采用。它不改本篇的积分，改的是这次计算要不要为自旋温度准备逐格点框架。

## ζ · 综合电离效率因子

### 物理

综合电离效率因子是把塌缩分数直接折成电离光子率的那一个数：它不描述新的物理过程，本身只是恒星形成效率、逃逸分数与每个重子的电离光子数三者的乘积；在把源项写成塌缩分数的倍数时，它承担全部天体物理的不确定性。

公式只有一步乘法，前提是三个因子都能用与质量、红移无关的常数代表——这正是它作为简化口径被使用的方式。同一场合若改用逐晕的标度关系，这个乘积就由各自的量现算，此参数不再进入链条，两条口径给的是同一种源项、不同的分辨率。

它由参数面直接读入，不依赖链上任何量，因此它是整条电离支的幅度旋钮。因为它只以乘积出现，观测拿到的永远是这个乘积：把它调大，与把质量下限调低、把源项的形状改陡，在观测量上高度简并。

数学上它是常数缩放，线性、局域、无记忆，也没有红移依赖——红移演化全部由塌缩分数与恒星形成率密度提供。它约束的是源的幅度而不是形状，所以单靠 21 厘米无法把它与恒星形成效率、逃逸分数分开。

它与恒星形成率密度一起给出电离光子发射率，进而决定再电离历史的早晚；紫外光度函数用来把乘积拆成两个因子。局限在把三个因子压成一个数的做法只在平均意义上成立，真实的逃逸与产额随晕质量与红移变化，这种变化只能由改用标度关系的口径来体现。

$$\zeta=f_\star\,f_{\rm esc}N_{\rm ion}$$

### 变量名与 LaTeX 符号对照表

| 公式符号 | 含义 | 代码名（默认值） | 进 C 的换算 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| $\zeta$ | 把塌缩分数直接折成电离光子率的综合效率：$f_\star f_{\rm esc}N_{\rm ion}$ 的乘积口径，要拆分三个因子得另外吃紫外光度函数；`SOURCE_MODEL` 大于 0 时改由 `pop2_ion`、`fstar_10`、`fesc_10` 现算，这个参数不进链 | HII_EFF_FACTOR（30） | 原样（`src/py21cmfast/wrapper/inputs.py:1279-1280`） | `src/py21cmfast/src/IonisationBox.c:167-167` |

### 代码解析

它按参数名 `HII_EFF_FACTOR` 从参数面读入，在电离场那一支里参与把源项折成电离光子率。

读这个参数要注意它与另一套口径互斥：源模型档位大于 0 之后，电离光子率由恒星形成率、逃逸分数与光子产额各自现算，这个参数就不再进链。写参数组合时若忽略这一点，会以为调它总能改变结果，实际上在一部分档位下它是个死参数。

### 工程

- 参数名：`HII_EFF_FACTOR`

- 输入：参数表（HII_EFF_FACTOR）
- 产出：标量 $\zeta$，把塌缩分数直接折成电离光子率

### 参数语境

#### HII_EFF_FACTOR

这一篇就是它：在 `SOURCE_MODEL == 0` 的口径下，综合电离效率 $\zeta$ 与 `HII_EFF_FACTOR` 是同一个数，塌缩分数乘上它直接给出电离光子率。它是这条简并路线上的唯一旋钮——没有逐晕的逃逸分数与光子数分解，只有一个总效率；正因为只有一个数，它无法与恒星形成效率分开约束，这也是分项参数化存在的原因。调大它，再电离整体提前，电离历史的所有下游量跟着挪。

## 参数

本模块携带 32 个参数（与画布上这块的「参数」卡同一份清单；类别是 `inputs.py` 里的结构名）。前 8 个在「把源项的积分算出来」那一步就起作用，其余 24 个在这一篇里**真正进入被积函数**——它与恒星形成率密度那篇共用同一把积分核，区别是这个核在这里不置零：逃逸分数与每重子的光子数都留在里面（`Nion_General`）。所以同一批参数，在恒星形成率密度那一篇空转的，在这里起作用。下面逐条写它在代码里做什么；同一个参数**在某个成员那一步里**的语境与落点，写在那个成员节的「参数语境」里。

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `HII_EFF_FACTOR` | `AstroParams` | 综合电离效率（默认 30.0）。`SOURCE_MODEL == 0` 时它与 $\zeta$ 是同一个数，塌缩分数乘上它直接给出电离光子率，是这条简并路线上唯一的旋钮——正因为只有一个数，它无法与恒星形成效率分开约束，这也是分项参数化存在的原因。 |
| `INHOMO_RECO` | `AstroOptions` | 非均匀再复合的总开关（默认打开）。打开时源项权重会按局部电离度改写（`HaloBox.c` 里 `whalo_sfr` 那条支），网格上的源因此带上「被自己电离出来的气体反压」这一项；关闭时网格只由密度场与标度关系决定。 |
| `INTEGRATION_METHOD_ATOMIC` | `AstroOptions` | 原子冷却支积分的求积方法，决定每个格点的塌缩分数怎么积出来。换方法只带来小的数值差异，物理不变。 |
| `INTEGRATION_METHOD_MINI` | `AstroOptions` | 分子冷却支的求积方法，与上一项各管一支，可以取不同方法。 |
| `M_TURN` | `AstroParams` | 恒星形成的截断质量，经坍缩分数进源项。它随红移由反馈移动，是这张网格上最主要的红移依赖——同一个格点在相邻两个快照上的源强差异，多半来自它。 |
| `OMm` | `CosmoParams` | 总物质密度。它进坍缩分数与密度因子 $(1+\delta)$（阈值与归一都随它变），因此它改的不只是网格整体高低，还有网格里对比度的大小。 |
| `USE_MINI_HALOS` | `AstroOptions` | 迷你晕总开关。打开时网格上多一整套迷你晕权重（`halo_sfr_mini`、与之配套的转折质量场等），下游的滤波要对它们各滤一遍；关闭时这些格子在内存里根本不出现。 |
| `USE_TS_FLUCT` | `AstroOptions` | 自旋温度涨落的总开关，决定这张网格要不要附带与逐格点自旋温度配套的量，以及这次计算走逐格点还是平均路径。 |
| `ALPHA_ESC` | `AstroParams` | 逃逸分数随质量的幂指数。在这一篇它真正进入被积函数：低质量晕的逃逸分数随它抬高或压平，于是低质量端的贡献被放大或削减。它直接改电离光子率，进而改整个再电离的时点。 |
| `ALPHA_STAR` | `AstroParams` | 恒星形成效率低质量端的斜率。它先改逐晕的恒星形成率，再乘上逃逸分数与光子数进积分——在这条链上是「源有多亮」的第一个旋钮，对积分结果是非线性响应。 |
| `ALPHA_STAR_MINI` | `AstroParams` | 分子冷却支的同一个斜率，只在打开迷你晕时用于第二支。那一支在低质量端权重更大，因此它对本篇的影响比在恒星形成率密度那一篇里更显著。 |
| `A_LW` | `AstroParams` | 莱曼-维尔纳反馈的幅度系数，经分子冷却支的转折质量抬升积分下限。反馈一强，能电离的晕变少，电离光子率随之下调，再电离被推迟。 |
| `A_VCB` | `AstroParams` | 相对速度反馈的幅度系数，与 `A_LW` 并联进同一个转折质量。 |
| `BETA_LW` | `AstroParams` | 莱曼-维尔纳反馈的幂指数，定反馈随背景强度变化的快慢。它在「电离发生得越快、背景越强、反馈越强」这条自我压制链上定的是斜率。 |
| `BETA_VCB` | `AstroParams` | 相对速度反馈的幂指数，作用方式相同、变量换成 $v_{\rm cb}$。 |
| `FIXED_VAVG` | `AstroParams` | 只在打开 `FIX_VCB_AVG` 时被读：用固定值代替逐点平均的相对速度，反馈不再带空间涨落，电离光子率的空间分布随之变平滑。 |
| `F_ESC10` | `AstroParams` | 在 $10^{10}M_\odot$ 处锚定逃逸分数线的归一。在本篇它直接乘在每组源上：它与 `POP2_ION`、`F_STAR10` 的乘积就是综合电离效率，三者单独都约束不到，只能靠紫外光度分布与 21 厘米观测联立拆开。把这个乘积调大一倍，电离光子率整体翻倍，再电离相应提前。 |
| `F_ESC7_MINI` | `AstroParams` | 分子冷却支的逃逸分数锚点，只管低质量那一支，且只在打开迷你晕时存在。 |
| `F_STAR10` | `AstroParams` | 恒星形成效率的归一。它在这条乘积里的位置与 `F_ESC10` 对称，两者在观测上简并。 |
| `F_STAR7_MINI` | `AstroParams` | 分子冷却支的恒星形成效率归一，管第二支的水平。它在「迷你晕是否主导早期电离」这个问题上是关键旋钮。 |
| `L_X` | `AstroParams` | 单位恒星形成率的比 X 射线光度。它不进这一篇的积分（被积函数里只有恒星形成率与电离光子数）；把它列在这里是因为它与本篇的几个旋钮同源、在参数扫描时通常一起动，但它的作用面在下游加热。 |
| `L_X_MINI` | `AstroParams` | 分子冷却支的对应量，同样不在本篇的积分里，只在打开迷你晕时被加热那一侧读。 |
| `OMb` | `CosmoParams` | 重子密度。它既经重子比例进恒星质量（改源强），又定数密度口径（改「每单位体积有多少源」）。它是整体乘数，与恒星形成效率归一简并。 |
| `PHOTON_CONS_TYPE` | `AstroOptions` | 光子守恒修正的类型（`wrapper/photoncons.py`）。打开时电离历史被按累积光子数重标定，本篇算出的光子率因此不再是直接采信的那一版，而是被校准量改过的版本；它与 `PHOTONCONS_CALIBRATION_END` 一起用。 |
| `POP2_ION` | `AstroParams` | 每重子的电离光子数（默认 5000）。它在本篇直接进被积函数，与 `F_STAR10`、`F_ESC10` 组成电离效率，是本篇三个并列旋钮中的一个。 |
| `POP3_ION` | `AstroParams` | 分子冷却支的同一个量，只在打开迷你晕时用于第二支。 |
| `SIGMA_LX` | `AstroParams` | X 射线光度关系的对数正态散射，属于加热那一条链的随机来源，不在本篇积分里。 |
| `SIGMA_SFR_INDEX` | `AstroParams` | 恒星质量-恒星形成率关系的散射随质量变化的幂指数。本仓 C 端不读它——全仓搜索只出现在参数面文档串里，本篇没有它的作用面。 |
| `SIGMA_SFR_LIM` | `AstroParams` | 恒星质量-恒星形成率关系在高质量端的对数正态散射，同样在本仓 C 端没有落点。 |
| `SIGMA_STAR` | `AstroParams` | 晕质量-恒星质量关系的对数正态散射。集平均这条路上它以 $e^{-\sigma_\star^2/2}$ 压低有效归一，于是同样的参数下电离光子率略低；逐晕记录那一路另外逐晕抽样，同一个红移会出现多条源强史。 |
| `UPPER_STELLAR_TURNOVER_INDEX` | `AstroParams` | 高质量端附加幂律的指数（`USE_UPPER_STELLAR_TURNOVER` 打开时生效）。大质量晕对积分权重小，所以它对电离光子率的影响远小于低质量端指数。 |
| `UPPER_STELLAR_TURNOVER_MASS` | `AstroParams` | 上面那段附加幂律的拐点质量，定「从多大质量开始压」。 |

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**源项的实现 · 把源项的积分算出来**

本对象没有登记的论文出处：论文综述里没有对应节号，代码注释里也没有引用。

**Ṅ_ion(z) · 电离光子发射率**

- 论文节号：§3.3（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

**ζ · 综合电离效率因子**

- 论文节号：§3.3 H II 区的增长（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| $\zeta$：电离效率（常数模型） | Greig+2015（Eq. 2） | The ionizing efficiency of high-z galaxies (zeta, from Eq. 2 of Greig+2015). | `src/py21cmfast/wrapper/inputs.py:1164-1164` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：$\zeta$：电离效率（常数模型）。
