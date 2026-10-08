# 网格化源项

源项是物理链上第一次出现空间结构的地方。在这之前每个量只讲体积平均：全宇宙共用一个塌缩分数、一个电离光子发射率；从这里开始，源被铺到三维格点上，恒星形成率、电离光子与 X 射线各得一张场，下游按格点取用。"源在哪里"这条信息就是这一步注入的。

这篇文档顺着计算真实发生的顺序写：先讲这块要解决的问题与它依据的物理，再逐段落到 `HaloBox.c` 与 `map_mass.c` 的代码上，然后是平均校准与两个反馈回流，最后给参数读法与陷阱清单。文末的四个同名小节逐个交代本块四个对象的定位与落点，论文出处收在末尾。公式、系数与行号均取自本仓当前源码。

## 一、这块在链上做什么

**一句话**：把"哪些晕、有多少、在哪里、发多少光"折算成三张格点场。

| | 内容 |
| :--- | :--- |
| 输入（链上） | 密度场 $\delta$、相对速度场 $v_{\rm cb}$、离散晕目录或质量函数、上一快照的自旋温度与电离场（$J_{21}^{\rm LW}$、$\Gamma_{12}$、$z_{\rm re}$） |
| 输入（参数） | 本模块 32 个参数：恒星形成效率、逃逸分数、每条星族的光子产额、四条反馈系数，以及若干开关（见 §六） |
| 主输出 | `halo_sfr`、`n_ion`；开迷你晕时加 `halo_sfr_mini`，开自旋温度涨落时加 `halo_xray`，开非均匀复合时加 `whalo_sfr` |
| 诊断输出 | `count`、`halo_mass`、`halo_stars`（`EXTRA_HALOBOX_FIELDS` 打开时才有），不进任何物理链条 |
| 下游 | 电离场取 `n_ion` 当唯一源项；加热取 `halo_xray`；莱曼-$\alpha$ 背景与莱曼-维尔纳反馈从 `halo_sfr` 分支出去走自己的路 |

**物理图像**：宇宙里每个体元都含有一小段质量函数。体元密度高，它内部的空间就更能容纳大质量晕，能塌缩成恒星的那部分物质就更多。于是"本格有多亮"完全由"本格的局部密度"决定——这就是把连续密度场变成离散源场的全部思想。剩下的工作是把塌缩分数、恒星质量、电离光子与 X 射线各自按不同的权重积出来。

**为什么必须有这一步**：平均量只能给出全球信号；要算 21 厘米涨落，就必须知道电离泡长在哪里、加热从哪里开始。源的空间分布是这些结构的种子，它错了，下游再精确也只是在一个错的骨架上做精细活。

## 二、物理骨架

### 2.1 条件质量函数与塌缩分数

判据是塌缩分数：一个体元里已经塌缩成晕的物质占该体元总物质的比例。

$$f_{\rm coll}(\rho)=\frac{1}{\rho_m}\int_{M_{\min}}^{M_{\rm cell}(\rho)}\mathrm dM\,M\,\frac{\mathrm dn}{\mathrm dM}$$

三个要素：

- **积分上下限**。下限 $M_{\min}$ 是全局可分辨的最小晕质量（由采样器下限与参数共同定）；上限 $M_{\rm cell}(\rho)$ 是**本格**能容纳的最大塌缩质量。
- **数密度** $\mathrm dn/\mathrm dM$ 由质量函数给出（口径由 `HMF` 选择），带红移演化的生长因子。
- **条件性**。上限依赖本格密度，所以 $f_{\rm coll}$ 是密度的函数，不是常数。这就是空间结构的来源。

`M_cell` 不是物理尺度，而是**分辨率尺度**：把密度涨落在体元尺度上抹平，反解出对应的质量，代码里就是

```c
M_cell = RtoM(physconst.l_factor * BOX_LEN / DIM);
```

`l_factor` 是把体元折成等效球半径的几何系数。体元越大，格内能"看见"的质量越大，漏掉的结构也越多——这是这块的固有局限，不是数值选择。

配套的还有格内涨落幅度 $\sigma_{\rm cell}=\sigma_{z=0}(M_{\rm cell})$，它决定条件分布的宽度。有一个特例：只算全球信号时（`HII_DIM == 1` 且盒长大于 `1e5`），体元本质上无限大，代码直接把 $\sigma_{\rm cell}$ 置零：

```c
if (simulation_options_global->HII_DIM == 1 && simulation_options_global->BOX_LEN > 1e5) {
    // When simulating only the global signal, the box/cell size should be infinite, so the
    // conditional sigma is 0
    consts->sigma_cell = 0.;
} else {
    consts->sigma_cell = sigma_z0(M_cell);
}
```

（`src/py21cmfast/src/HaloBox.c`，`set_integral_constants`。全盒只算平均信号时，源场退化成一张常数场，条件积分的散射也跟着消失——这两件事是同一个开关的两面。）

### 2.2 两类源，两套标度关系

格内的恒星形成有两支，参数各一套，下游也各走一张场：

| | 原子冷却支（ACG） | 分子冷却支（MCG / 迷你晕） |
| :--- | :--- | :--- |
| 触发条件 | 氢原子冷却 | $\mathrm H_2$ 冷却，只在 `USE_MINI_HALOS` 打开时存在 |
| 恒星形成效率 | `F_STAR10` + `ALPHA_STAR`（在 $10^{10}M_\odot$ 锚定） | `F_STAR7_MINI` + `ALPHA_STAR_MINI` |
| 逃逸分数 | `F_ESC10` + `ALPHA_ESC` | `F_ESC7_MINI` |
| 每重子电离光子数 | `POP2_ION` | `POP3_ION` |
| $M_{\rm turn}$ | $M_{\rm turn}^{\rm a}$ | $M_{\rm turn}^{\rm m}$ |
| 落到的场 | `halo_sfr`、`n_ion` | `halo_sfr_mini`，以及并入 `n_ion` 的第二份 |

两支的处理方式值得说明：代码**不把迷你晕当成独立的晕**，而是把它当作恒星形成效率曲线在低质量端的一次位移，每一朵晕同时带两份贡献（见 `set_halo_properties` 上方的注释）。这样做的好处是质量从低到高是平滑过渡，不会在某个质量处出现台阶。它们的和正好复现默认的双指数形式

$$\dot N_{\rm ion}(M)\propto N_{\rm ion}^{\rm a}e^{-M/M_a}+N_{\rm ion}^{\rm m}e^{-M/M_m-M_a/M}$$

两个 $M_{\rm turn}$ 随红移移动，移动的方式在 §五 讲，那是这块最主要的红移依赖。

## 三、代码：两条铺场路线

### 3.1 总装：`ComputeHaloBox` 的次序

整块的入口是 `HaloBox.c` 的 `ComputeHaloBox`，读它的调用次序比读任何说明都清楚：

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
```

（`src/py21cmfast/src/HaloBox.c:628-645`。）

四件事，按顺序：

1. **铺两张 $M_{\rm turn}$ 场**。`get_log10_turnovers`（见 §五）先给出每个格点的 $M_{\rm turn}^{\rm a}$、$M_{\rm turn}^{\rm m}$（算法见 §五），两张对数场带着走。
2. **离散晕那一支**，只在 `SOURCE_MODEL > 2` 时执行。原因是档位 0–2 的语义是"只吃条件平均"，没有逐晕位置可取。
3. **定条件积分的上限** `M_max_integral`，三种口径：
   - `SOURCE_MODEL == 4`：用采样器的最小质量。此时离散晕覆盖了整个可分辨区间，条件积分几乎不做事。
   - `SOURCE_MODEL == 3`：用格点能分辨的质量 $M_{\rm cell}$。这是"离散晕加上格内平均"的混合口径，也是默认档位。
   - 其余（0–2）：用一个固定的 `M_MAX_INTEGRAL`。
4. **只有当 $M_{\min}<M_{\rm max}^{\rm integral}$ 才做条件积分**。否则这一段空着——说明源全部由离散晕提供，条件积分没有插手的空间。

这一段的条件判断是理解档位的关键：`SOURCE_MODEL` 不是"用哪种方法"的开关，而是"两种方法在哪个质量处交接"的刻度。

### 3.2 路线一：按离散晕逐个摊（保留散粒噪声）

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

（`src/py21cmfast/src/map_mass.c:421-433`，`move_halo_galprops`。）

逐个晕读出它的质量与位置，用标度关系现算这一朵晕的属性，再按云中云（CIC）权重摊到相邻格点上。这条路线的价值在**散粒噪声**：晕是离散的，一个格点里可能有两朵也可能一朵都没有，这种离散性被原样保留下来。源场的小尺度图案因此是"颗粒状"的，而不是光滑的密度纹理。

注意 `set_halo_properties` 返回的是**完整的物理量**，不再乘星等换算系数——换算已经在标度关系内部做完了。这与下一条路线不同。

摊完之后还有一道体积归一，用的是输出格点的体元倒数：

```c
        for (unsigned long long int i_cell = 0; i_cell < HII_TOT_NUM_PIXELS; i_cell++) {
            boxes->n_ion[i_cell] *= cell_vol_inv;
            boxes->halo_sfr[i_cell] *= cell_vol_inv;
```

（`src/py21cmfast/src/map_mass.c:458-460`，`cell_vol_inv = (out_dim[0]/BOX_LEN)^3`。）逐晕量是"每一朵晕给多少"，累计到格点上是"每个格点有多少"，乘体元倒数才是密度口径——这一步不能省，也不能挪到下一条路线里去做。

### 3.3 路线二：按条件积分表逐格算（平滑）

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

（`src/py21cmfast/src/HaloBox.c:398-417`，`set_fixed_grids`。）

先在"密度 × $M_{\rm turn}$"的二维网格上建四张表——恒星形成率密度、含再电离反馈的电离光子、质量函数、以及开自旋温度涨落时的 X 射线；再用 `move_grid_galprops` 按每格密度查表，整段 $[M_{\min},M_{\rm max}^{\rm integral}]$ 的贡献一次铺上格。逐格取用的那一步是：

```c
                    get_cell_integrals(curr_dens, l10_mturn_a, l10_mturn_m, consts, integral_cond,
                                       &properties);

                    // using the properties struct:
                    // stellar_mass --> no F_esc integral ACG
                    // stellar_mass_mini --> no F_esc integral MCG
                    // n_ion --> F_esc integral ACG
                    // fescweighted_sfr --> F_esc integral MCG
                    // halo_xray --> Xray integral
                    // halo_mass --> total mass
                    do_cic_interpolation(boxes->n_ion, pos, out_dim,
                                         properties.n_ion * prefactor_nion +
                                             properties.fescweighted_sfr * prefactor_nion_mini);
                    // ... 其余各路 CIC 同形，系数见表 §3.4
```

（`src/py21cmfast/src/map_mass.c:300-334`，此处为节选。）

表里的一段注释就是这块最容易踩的坑，值得原样记住：**同一个 `properties` 结构里，装着含逃逸分数与不含逃逸分数的两种积分**。恒星质量那一支没有乘 $f_{\rm esc}$，电离光子那一支乘了。把 `stellar_mass` 当成电离光子的来源，是这个模块最常见的读错。

### 3.4 权重从哪来：一张必须记住的系数表

所有换算系数都在 `get_uhmf_averages` 的头部定义（`src/py21cmfast/src/HaloBox.c:113-123`）：

```c
    double prefactor_mass = RHOcrit * cosmo_params_global->OMm;
    double prefactor_stars = RHOcrit * cosmo_params_global->OMb * consts->fstar_10;
    double prefactor_stars_mini = RHOcrit * cosmo_params_global->OMb * consts->fstar_7;
    double prefactor_xray = RHOcrit * cosmo_params_global->OMm;
    double prefactor_sfr = prefactor_stars / consts->t_star / t_h;
    double prefactor_sfr_mini = prefactor_stars_mini / consts->t_star / t_h;
    double prefactor_nion = prefactor_stars * consts->fesc_10 * consts->pop2_ion;
    double prefactor_nion_mini = prefactor_stars_mini * consts->fesc_7 * consts->pop3_ion;
    double prefactor_wsfr = prefactor_sfr * consts->fesc_10 * consts->pop2_ion;
    double prefactor_wsfr_mini = prefactor_sfr_mini * consts->fesc_7 * consts->pop3_ion;
```

把它读成物理量，这张表就全部落地了：

| 场 | 被积的物理量 | 含 $f_{\rm esc}$ | 系数 |
| :--- | :--- | :--- | :--- |
| `halo_mass` | $\int M\,\frac{\mathrm dn}{\mathrm dM}\mathrm dM$ | 否 | $\rho_c\,{\rm OMm}$ |
| `halo_stars` | $\int f_\star(M)M\,\frac{\mathrm dn}{\mathrm dM}\mathrm dM$ | 否 | $\rho_c\,{\rm OMb}\,f_{\star,10}$ |
| `halo_sfr` | 恒星质量 / $t_\star$ / $t_h$ | 否 | 上式 $/t_\star/t_h$ |
| `n_ion` | $\int f_{\rm esc}N_{\rm ion}f_\star M\,\frac{\mathrm dn}{\mathrm dM}\mathrm dM$ | **是** | ${\rm prefactor}_{\rm stars}\cdot f_{{\rm esc},10}\cdot N^{\rm POP2}_{\rm ion}$ |
| `halo_sfr_mini` | 分子冷却支的恒星形成率 | 否 | 同 `halo_sfr`，换 $f_{\star,7}$ |
| `whalo_sfr` | $f_{\rm esc}$ 加权的恒星形成率 | **是** | ${\rm prefactor}_{\rm sfr}\cdot f_{{\rm esc},10}\cdot N^{\rm POP2}_{\rm ion}$ |

`halo_xray` 的系数是 $\rho_c\,{\rm OMm}$，与质量同形；它的光度关系在标度关系内部再乘上去。

三个可以立刻用上的观察：

- **恒星形成率与恒星质量只差一个时间尺度** $t_\star t_h$（`t_star` 是恒星形成时间尺度，`t_h` 是哈勃时间）。所以两者在形状上永远同步，差别只是一次乘除。
- **$f_\star\times f_{\rm esc}\times N_{\rm ion}$ 只以乘积出现**。表中 `n_ion` 的系数同时含 `fstar_10`、`fesc_10`、`pop2_ion`，三者单独都约束不到，换任一个得到同一张场。这就是综合电离效率 $\zeta=f_\star f_{\rm esc}N_{\rm ion}$ 简并的来源（`SOURCE_MODEL == 0` 时干脆只留一个 `HII_EFF_FACTOR`）。
- **迷你晕那一支没有独立的位置信息**，它是靠 `properties.fescweighted_sfr * prefactor_nion_mini` 并进 `n_ion` 的，与原子支相加后才成为下游看到的源。

在逐格路线里这套系数还要多乘一个体积比 `vol_ratio_out = (out_dim/dens_dim)^3`（`src/py21cmfast/src/map_mass.c:230-239`），因为密度网格与输出网格的像素尺度可以不同，CIC 重采样时要按体积归一。逐晕路线不需要这一步：它拿到的已经是逐晕物理量，体积归一是摊完之后统一乘体元倒数（§3.2 末尾）。**两条路线的归一账长得不像，但结果同一个量纲**；把其中一条的写法照搬到另一条，会差整整一个体积比。

## 四、平均校准：为什么要把均值拉回去

### 4.1 问题

铺场是有限分辨的。大于体元的晕可以当离散源摊上去，**体元以内的结构却看不见**：格点只能用一个平均密度代表整块体元，体元里本来还会有的小尺度成团、以及刚好落在体元尺度附近的那部分质量函数尾巴，都在离散化中丢了。结果是网格场的全域平均与解析算出的平均**对不上**，误差随分辨率恶化。

平均校准做的就是这件事：算一次解析平均，算一次盒内平均，把后者的每个格点按前者的幅度整体缩放回去。

```c
void mean_fix_grids(double M_min, double M_max, HaloBox *grids, ScalingConstants *consts) {
    HaloProperties averages_global;
    // NOTE: requires the mean mcrits to be set on the grids
    double M_turn_a_global = pow(10, grids->log10_Mcrit_ACG_ave);
    double M_turn_m_global = pow(10, grids->log10_Mcrit_MCG_ave);
    get_uhmf_averages(M_min, M_max, M_turn_a_global, M_turn_m_global, consts, &averages_global);
    HaloProperties averages_hbox;
    averages_hbox = get_halobox_averages(grids);

    unsigned long long int idx;
#pragma omp parallel for num_threads(simulation_options_global->N_THREADS) private(idx)
    for (idx = 0; idx < HII_TOT_NUM_PIXELS; idx++) {
        grids->halo_sfr[idx] *= averages_global.halo_sfr / averages_hbox.halo_sfr;
        grids->n_ion[idx] *= averages_global.n_ion / averages_hbox.n_ion;
        if (astro_options_global->USE_MINI_HALOS) {
            grids->halo_sfr_mini[idx] *= averages_global.sfr_mini / averages_hbox.sfr_mini;
        }
        if (astro_options_global->USE_TS_FLUCT) {
            grids->halo_xray[idx] *= averages_global.halo_xray / averages_hbox.halo_xray;
        }
        if (astro_options_global->INHOMO_RECO) {
            grids->whalo_sfr[idx] *=
                averages_global.fescweighted_sfr / averages_hbox.fescweighted_sfr;
        }

        if (config_settings.EXTRA_HALOBOX_FIELDS) {
            grids->count[idx] *= averages_global.count / averages_hbox.count;
            grids->halo_mass[idx] *= averages_global.halo_mass / averages_hbox.halo_mass;
            grids->halo_stars[idx] *= averages_global.stellar_mass / averages_hbox.stellar_mass;
            if (astro_options_global->USE_MINI_HALOS) {
                grids->halo_stars_mini[idx] *=
                    averages_global.stellar_mass_mini / averages_hbox.stellar_mass_mini;
            }
        }
    }
}
```

（`src/py21cmfast/src/HaloBox.c:206-242`。）

### 4.2 三条必须知道的性质

**一、它乘的是全场同一个数。** 每个格点乘的比例相同，所以校准**只改幅度、不改图案**：空间对比度、结构的形状、亮暗的相对关系全部原样保留。这句话确定了它的能力边界——它修的是"总量对不上"，修不了"图案错了"。

**二、解析平均用的是网格记录下的平均 $M_{\rm turn}$。** `get_uhmf_averages` 需要一组 $M_{\rm turn}$，而网格上带着的 `log10_Mcrit_*_ave` 就是逐格 $M_{\rm turn}$ 的均值（见 §五）。也就是说，解析平均是在"平均红移 + 平均反馈状态"下算的，用的是均值而非逐格值。这一步隐含了"平均的源等于源的分布平均"这个假设——在 $M_{\rm turn}$ 的空间涨落很弱时成立，涨落强时不成立。

**三、全是裸乘除，没有保护。** 如果某个场在盒内的和为零（该快照下这一类源完全没有，或该开关恰好把场清空），比例就是零除零。前面 §六 会看到，某些场确实会在特定开关组合下整块为零。

### 4.3 什么时候执行

触发条件不是独立参数，而是随质量函数口径定下的：

```c
    // Set on for the fixed grid case since we are missing halos above the cell mass
    consts->fix_mean = matter_options_global->HMF == 2 || matter_options_global->HMF == 3;
```

（`src/py21cmfast/src/scaling_relations.c:40`，`set_scaling_constants`；调用点在 `HaloBox.c:432`。）

代码注释把理由写明了：固定格点这条路线本来就把"体元之上的晕"漏掉了，所以要校准。注意电离场另有一套同名字段（`IonisationBox.c:154`，取 `lagrangian_source_grids` 的反），两个 `fix_mean` 不是同一个东西，读代码时别混。

### 4.4 被校准的场

| 场 | 是否校准 | 附加条件 |
| :--- | :--- | :--- |
| `halo_sfr` | 是 | 无 |
| `n_ion` | 是 | 无 |
| `halo_sfr_mini` | 是 | `USE_MINI_HALOS` |
| `halo_xray` | 是 | `USE_TS_FLUCT` |
| `whalo_sfr` | 是 | `INHOMO_RECO` |
| `count`、`halo_mass`、`halo_stars`、`halo_stars_mini` | 是 | `EXTRA_HALOBOX_FIELDS`（纯诊断） |

这张表同时说明了开关的连带效应：**关掉 `USE_TS_FLUCT`，`halo_xray` 既不被铺也不被校准**；关掉 `USE_MINI_HALOS`，两张迷你晕场根本不在内存里。参数扫描时如果两组开关一起动，源场幅度的变化里会同时含有"物理改变"与"校准路径改变"两种成分，读结果时要分开。

## 五、$M_{\rm turn}$：两个回流与一张只能逐格看的场

### 5.1 它在做什么

恒星形成只发生在足够大的晕里，够不够大由 $M_{\rm turn}$ 判定。它不是常数，被两件事顶起来：

- **莱曼-维尔纳反馈**：恒星发出的紫外背景把 $\mathrm H_2$ 解离，低质量晕失去冷却剂，能形成恒星的下限抬高。强度取决于局部背景 $J_{21}^{\rm LW}$ 与相对速度 $v_{\rm cb}$。
- **再电离反馈**：周围气体已被电离，声速升高，低质量晕里的气体被光致蒸发，下限抬高。强度取决于局部电离率 $\Gamma_{12}$ 与该点的再电离红移 $z_{\rm re}$。

两条反馈都读**上一快照**，所以这是一个逐红移的闭环：这一代星照亮环境，下一代星的起始质量被抬高——电离得越快，后面的源越弱，也就是"自我压制"。这条回路是再电离历史不会一路暴走的原因。

### 5.2 代码的两个关键事实

```c
    averages[0] = log10(consts->mturn_a_nofb);
    averages[1] = log10(consts->mturn_m_nofb);
    if (!astro_options_global->USE_MINI_HALOS) {
        return;
    }
```

（`src/py21cmfast/src/HaloBox.c:467-471`，`get_log10_turnovers`。）

**事实一：整套逐格反馈只在打开迷你晕时才算。** 关掉 `USE_MINI_HALOS`，函数立刻返回，两张 $M_{\rm turn}$ 场不写、两个平均值就是无反馈值——莱曼-维尔纳与再电离反馈在那条口径下等于不存在。这是"关迷你晕"远不止关掉一支源的第二个后果。

**事实二：上一快照的读取有红移门槛。**

```c
            J21_val = Gamma12_val = zre_val = 0.;
            if (consts->redshift < simulation_options_global->Z_HEAT_MAX) {
                J21_val = previous_spin_temp->J_21_LW[i];
                Gamma12_val = previous_ionize_box->ionisation_rate_G12[i];
                zre_val = previous_ionize_box->z_reion[i];
            }
```

高红移端（$z\ge$ `Z_HEAT_MAX`）一律置零：那里还没有值得谈的加热与电离背景，反馈自然为零。三个量分别来自自旋温度盒与电离盒，也就是说这一步**同时依赖两个下游模块的上一快照**——源项并非只依赖上游，它有一条向后的腿。

相对速度那一支：

```c
            if (!astro_options_global->FIX_VCB_AVG &&
                matter_options_global->USE_RELATIVE_VELOCITIES) {
                curr_vcb = ini_boxes->lowres_vcb[i];
            }
```

默认 `curr_vcb` 取 `consts->vcb_norel`（不考虑相对速度的等效值）；只有同时开了相对速度与"不固定平均值"，才逐格读 `lowres_vcb`。`FIX_VCB_AVG` 的作用正是把逐格涨落压成一个平均值。

### 5.3 一张只能逐格看、但看得要小心的场

```c
        double curr_vcb = consts->vcb_norel;
        double M_turn_m;
        double M_turn_a = consts->mturn_a_nofb;
        double M_turn_r;
...
            M_turn_m = lyman_werner_threshold(consts->redshift, J21_val, curr_vcb);
            M_turn_r = reionization_feedback(consts->redshift, Gamma12_val, zre_val);
            M_turn_a = fmax(M_turn_a, fmax(M_turn_r, astro_params_global->M_TURN));
            M_turn_m = fmax(M_turn_m, fmax(M_turn_r, astro_params_global->M_TURN));

            mturn_a_grid[i] = log10(M_turn_a);
            log10_mturn_a_avg += log10(M_turn_a);
            mturn_m_grid[i] = log10(M_turn_m);
            log10_mturn_m_avg += log10(M_turn_m);
```

三个量最终都是**取大**得到：无反馈值、再电离反馈值、以及参数 `M_TURN`，谁大听谁的。所以 `M_TURN` 是一条硬地板：把参数设高，任何反馈都不可能把下限压到它之下。

这里有一处必须知道的不对称：`M_turn_m` 在每格里都由 `lyman_werner_threshold` 重新赋值，是真正的逐格量；`M_turn_a` 只在循环外（并行区里）被初始化一次，循环内只做单调的取大。因此 `mturn_a_grid` 写出的**不是逐格值**，而是一条随遍历单调抬高的下界，具体数值还取决于线程划分——读这张场、或拿它做 §四 的平均校准时，不能把它当成逐个格点的物理 $M_{\rm turn}$。

两个平均值最后被除成体积平均并按对数口径存下：

```c
    // NOTE: This average log10 Mturn will be passed onto the spin temperature calculations where
    // It is used to perform the frequency integrals (over tau, dependent on <XHI>), and possibly
    // for mean fixing. It is the volume-weighted mean of LOG10 Mturn, although we could do another
    // weighting or use Mturn directly None of these are a perfect representation due to the
    // nonlinear way turnover mass affects N_ion
    log10_mturn_a_avg /= HII_TOT_NUM_PIXELS;
    log10_mturn_m_avg /= HII_TOT_NUM_PIXELS;
```

注释自己说明了它的局限：$M_{\rm turn}$ 进入 $N_{\rm ion}$ 是非线性的，因此"对数均值"只是权宜；这个值同时供给自旋温度的频率积分与平均校准两处使用。

## 六、参数

本模块 32 个参数，按"它在这块里改什么"分成五组，比按字母顺序读有用得多。

### 6.1 效率三旋钮：它们只以乘积出现

| 参数 | 含义 | 在代码里的位置 |
| :--- | :--- | :--- |
| `F_STAR10` | 在 $10^{10}M_\odot$ 处锚定恒星形成效率 | `prefactor_stars`（`HaloBox.c:114`） |
| `F_ESC10` | 在 $10^{10}M_\odot$ 处锚定逃逸分数 | `prefactor_nion`（`HaloBox.c:120`） |
| `POP2_ION` | 每重子的电离光子数 | 同上 |

三者乘在一起才是电离光子率，所以在 §3.4 那张系数表里它们是同一个系数 `prefactor_nion` 的三个因子。**任一个单独都约束不到**：把 `F_ESC10` 加倍与把 `POP2_ION` 加倍，给出完全相同的源场。要把它们拆开，只能请外部的独立信息——紫外光度函数约束恒星形成效率，光子产额靠星族合成模型，剩下的给逃逸分数。

分子冷却支同构：`F_STAR7_MINI`、`F_ESC7_MINI`、`POP3_ION`，只走 `prefactor_nion_mini`。

还有一条更彻底的简并路线：`SOURCE_MODEL == 0` 时三因子被压成一个数 `HII_EFF_FACTOR`，即综合电离效率 $\zeta$。此时改 `F_STAR10` 之类的分项参数**完全无效**——它们不进链。写参数组合时若忽略这一点，会以为调它总能改结果。

### 6.2 形状：改斜率还是改幅度

| 参数 | 改什么 |
| :--- | :--- |
| `ALPHA_STAR` | 恒星形成效率低质量端的斜率 |
| `ALPHA_STAR_MINI` | 分子冷却支的同一斜率 |
| `ALPHA_ESC` | 逃逸分数随质量的幂指数，直接改低质量端谁贡献得多 |
| `UPPER_STELLAR_TURNOVER_INDEX` / `UPPER_STELLAR_TURNOVER_MASS` | 高质量端附加幂律的指数与拐点（仅 `USE_UPPER_STELLAR_TURNOVER`） |

**形状与幅度在观测量上高度简并**：把低质量端斜率改陡与把整体归一调大，都能让源项变多。区别在于改斜率会同时改红移演化的形状（因为 $M_{\rm turn}$ 在动，不同红移处被"切"到的质量区间不同），而改归一不改变形状。想区分它们，至少要有一条能定形状的红移序列。

高质量端那两个参数影响很小：大质量晕在 $M\,\mathrm dn/\mathrm dM$ 下权重本来就低，动它改不了多少。

### 6.3 反馈：只在地板上抬，且只在开迷你晕时逐格生效

| 参数 | 改什么 |
| :--- | :--- |
| `M_TURN` | $M_{\rm turn}$ 的硬地板，与反馈值取大 |
| `A_LW` / `BETA_LW` | 莱曼-维尔纳反馈的幅度与幂指数 |
| `A_VCB` / `BETA_VCB` | 相对速度反馈的幅度与幂指数 |
| `FIXED_VAVG` | 只在 `FIX_VCB_AVG` 打开时被读：用固定值代替逐点 $v_{\rm cb}$ |

读这组参数之前必须先确认 `USE_MINI_HALOS` 是开的——§5.2 已经说明，关掉它，`get_log10_turnovers` 直接返回，四个系数全部失去逐格作用面。这是这块最容易被误读的一组参数。

`A_LW`、`BETA_LW` 定的是"电离越快、背景越强、反馈越强、后面源越弱"这条自我压制链的斜率；`A_VCB`、`BETA_VCB` 只把自变量换成 $v_{\rm cb}$。它们一起进 `lyman_werner_threshold`。

### 6.4 散射

`SIGMA_STAR` 是晕质量—恒星质量关系的对数正态散射。集平均这条路上它以 $e^{-\sigma_\star^2/2}$ 压低有效归一，于是同类参数下电离光子率略低；逐晕记录那一路则对每朵晕单独抽样，同一个红移会出现多条源强史（这一步是散粒噪声的另一个来源，与 §3.2 的位置离散不同，它散的是"亮度"）。

### 6.5 开关：改的是"算不算"而不是"算多少"

| 开关 | 打开时发生什么 |
| :--- | :--- |
| `USE_MINI_HALOS` | 多一整套分子冷却支；**并且**逐格反馈才开始算 |
| `USE_TS_FLUCT` | 多一张 `halo_xray`（被铺、被校准），源项走逐格路径而非全宇宙平均 |
| `INHOMO_RECO` | 多一张 `whalo_sfr`（逃逸加权的恒星形成率），供下游算非均匀复合 |
| `PHOTON_CONS_TYPE` | 光子守恒修正（`wrapper/photoncons.py`）：电离历史按累积光子数重标定，这块算出的光子率是被校准量改过的版本 |
| `INTEGRATION_METHOD_ATOMIC` / `INTEGRATION_METHOD_MINI` | 条件积分的求积方法，各管一支；只带来小的数值差异 |

`PHOTON_CONS_TYPE` 值得单独强调：它**不改这张场本身**，改的是下游怎么用它。所以拿网格直方图去看光子守恒的效果是看不到的，必须看电离历史的输出。

### 6.6 在这块里空转的五项

| 参数 | 为什么在这里没作用 |
| :--- | :--- |
| `L_X`、`L_X_MINI` | 单位恒星形成率的比 X 射线光度，作用面在下游加热 |
| `SIGMA_LX` | X 射线光度关系的散射，同样在加热那条链上 |
| `SIGMA_SFR_INDEX`、`SIGMA_SFR_LIM` | 本仓 C 端不读；全仓搜索只出现在参数面文档串里 |

把这几个与 `F_STAR10` 之类混在同一组里扫描，会得到"调了没反应"或"反应来自别处"的错觉，所以单列出来。

### 6.7 宇宙学与口径

- `OMb`（重子密度）是整体乘数：经重子比例进恒星质量，同时定数密度口径。它与恒星形成效率归一简并。
- `OMm`（总物质密度）**不是**简单缩放：它同时动质量函数归一、塌缩阈值与重子比例，所以会改变源强随红移的**整条曲线形状**。
- `HII_EFF_FACTOR` 是 `SOURCE_MODEL == 0` 口径下的 $\zeta$ 本身（默认 30）；档位大于 0 后由分项参数现算，它变成死参数。

## 七、陷阱

**一、分辨率的账要记在源头。** 体元以下的结构、体元尺度附近的晕、晕在体元内的成团，都不被分辨。`M_cell = RtoM(l_factor·BOX_LEN/DIM)` 就是这条天花板的公式，它与 `SOURCE_MODEL == 3` 取的上限是同一个式子——换句话说，档位 3 的"交接处"就是分辨率本身。大尺度图案可信，小尺度细节取决于分辨率。

**二、平均校准修幅度，不修图案。** 全场乘同一个数，对比度分毫不动（§4.2）。看到"源场整体偏高/偏低"可以用它解释；看到"亮暗分布不对"，它帮不上忙。

**三、平均校准没有零除保护。** 若某个场在盒内求和为零，比例无定义。

**四、关掉 `USE_MINI_HALOS` 有两层后果。** 少的不是一个场，而是两样东西：分子冷却支整套权重，**以及**逐格的莱曼-维尔纳与再电离反馈（`get_log10_turnovers` 提前返回）。把"关迷你晕"当成"早期电离少一点"会低估它的影响范围。

**五、关掉 `USE_TS_FLUCT`，加热的上游就断了。** `halo_xray` 不被铺、也不被校准，下游 X 射线加热拿不到源。这是块与块之间最容易断的一根线。

**六、`fix_mean` 有两个同名不同物的字段。** 源格里那个随 `HMF` 定（`scaling_relations.c:40`），电离场那个取 `lagrangian_source_grids` 的反（`IonisationBox.c:154`）。不要因为名字一样就当成同一个开关。

**七、`mturn_a_grid` 不是逐格的物理量。** 见 §5.3：原子支那张场是单调抬高的下界，且依赖线程划分；分子支那张才是逐格值。

**八、诊断场不是物理量。** `count`、`halo_mass`、`halo_stars`（以及迷你晕版）只在 `EXTRA_HALOBOX_FIELDS` 打开时铺，不进任何下游。它们可以拿去和晕目录做交叉检查，但不要拿它们算加热或电离。

**九、`halo_sfr` 与 `halo_stars` 只差一个时间尺度。** 前者是后者除以 $t_\star t_h$（§3.4）。两条曲线形状永远一样，如果观测上需要它们不同，得回标度关系里改，而不是在这里。

**十、两条路线的量纲口径不同。** 逐晕路线（`set_halo_properties`）返回已经算好的物理量；逐格路线（`get_cell_integrals`）返回的是待乘系数的积分。混读两段代码会以为系数丢了一个。

### 一份最小检查清单

- 改完参数先确认 `SOURCE_MODEL`：它决定 `HII_EFF_FACTOR`、`F_STAR10` 这些参数到底进不进链。
- 看源场之前先看两个开关：`USE_MINI_HALOS`（决定第二支与反馈）与 `USE_TS_FLUCT`（决定 X 射线场）。
- 对比两个红移的源场，先怀疑 $M_{\rm turn}$，再怀疑别处。
- 怀疑幅度就查平均校准有没有执行（`HMF`），怀疑图案就去查分辨率与 `SOURCE_MODEL`。

## 八、源项的实现 · 条件积分与铺场算法

本块四个对象里，只有它不是一个物理量，而是**这件事本身**：条件质量函数积分的算法与铺场。之所以单独列出来，是因为链条上每一个量都挂在某个物理对象上，而"铺场"这个过程没有自己的符号，却又确实是一个可以单独出错的地方——分辨率、`SOURCE_MODEL` 档位、体积归一、平均校准，全在这一层。

它在代码里没有单一函数，而是两条并列的路径：

- `set_halo_properties`（`HaloBox.c:62-104`）逐晕算属性，`sum_halos_onto_grid` / `move_halo_galprops` 负责摊到格点；
- `get_cell_integrals`（`HaloBox.c:244-295`）逐格算积分，`set_fixed_grids` / `move_grid_galprops` 负责摊到格点。

两条路径的接口是同一个 `HaloProperties` 结构，这是最容易被误读的地方：从 `set_halo_properties` 出来的是**物理量**，从 `get_cell_integrals` 出来的是**待乘系数的积分**。同一个字段名，两条路线含义不同，混读会以为系数丢了一个（§七 第十条）。

积分的上下限也不是纯物理量：下限由采样器与参数定，上限在 `SOURCE_MODEL == 3` 时干脆就是分辨率尺度 $M_{\rm cell}$（§3.1）。所以这一层"算得对不对"要先问"积到哪儿"——档位不同，同一个公式积出的东西不一样。

论文综述里没有对应的节号，代码注释里也没有引用：它是实现层，不是文献层。

## 九、Ṅ_ion(z) · 电离光子发射率

它是本块的头号输出，也是整条电离链唯一的源项。单位体积、单位时间放出的电离光子数：

$$\dot n_{\rm ion}(z)=\int \mathrm dM\,\frac{\mathrm dn}{\mathrm dM}\,f_{\rm esc}(M)N_{\rm ion}(M)\,f_\star(M)M$$

代码里它由 `get_uhmf_averages`（`HaloBox.c:105-202`）给出，系数就是 §3.4 表里的 `prefactor_nion`：$\rho_c\,{\rm OMb}\,f_{\star,10}\cdot f_{{\rm esc},10}\cdot N^{\rm POP2}_{\rm ion}$。分子冷却支另加一份 `prefactor_nion_mini`，两支相加才是这个数。

**它是这个模块所有简并的集中体现。** 三个因子 $f_\star$、$f_{\rm esc}$、$N_{\rm ion}$ 只以乘积进入，因此单独调任一个都得到同一个 $\dot n_{\rm ion}$；`SOURCE_MODEL == 0` 时它们更进一步被压成一个 `HII_EFF_FACTOR`。要拆开只能靠外部信息（§6.1）。

**它与逐格场的关系是"平均与分布"，不是"近似与精确"。** 两者由同一套权重产生，因此只调乘积时两者同步等比例移动；反过来，两者之比若有变化，说明动的是空间结构（分辨率、`SOURCE_MODEL` 档位、反馈），不是幅度。

**平均与场分岔的路口在自旋温度涨落开关上。** 开 `USE_TS_FLUCT` 时下游要逐格取用，源项走逐格路径；关掉它，源项可以只算全宇宙平均——此时"逐格点电离光子发射率场"退化成常数场，而本对象仍是那个数。读下游结果时若发现电离历史对空间结构不敏感，先回头看这个开关。

论文出处：§3.3（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）。

## 十、Ṅ_ion(x, z) · 逐格点电离光子发射率场

同一个电离光子发射率的第二种呈现：Ṅ_ion(z) 是一个数（全盒平均），Ṅ_ion(x, z) 是一张场（每个格点各一个数）。物理内容完全一样，差别只在要不要空间信息——下游的电离判据要拿它去和局部复合、局部密度比较，所以必须有场。

两条铺场路线各写一次，都写进同一个数组 `boxes->n_ion`：逐格路线在 `map_mass.c:309-313` 把 `properties.n_ion * prefactor_nion + properties.fescweighted_sfr * prefactor_nion_mini` 摊上去；逐晕路线在 `map_mass.c:423-424` 摊完之后，再用 `:458-460` 的 `cell_vol_inv` 统一归一。

**迷你晕不单独成场。** 分子冷却支的贡献靠 `properties.fescweighted_sfr * prefactor_nion_mini` 并进同一张 `n_ion`，与原子支相加之后才是下游看到的源。所以这张场里分不出"哪些光子来自 POP III"——要分开看，只能关掉 `USE_MINI_HALOS` 做两次。

**量纲与用法。** 它是发射率（光子数 /（体元体积 · 时间）），不是累积量、也不是光度。下游把它折成塌缩分数的倍数以定出电离效率：`IonisationBox.c:1161-1162` 的 `res_xH = 1 - curr_fcoll * ion_eff_factor - ...` 里，`ion_eff_factor` 就是 $\zeta$ 的代码化身。

**同一段里还有一处易漏的派生**：`INHOMO_RECO` 时 `whalo_sfr` 直接由 `n_ion` 生成——

```c
    double prefactor_wsfr = 1 / consts->t_h / consts->t_star;
    if (astro_options_global->INHOMO_RECO) {
        for (int i = 0; i < HII_TOT_NUM_PIXELS; i++) {
            boxes->whalo_sfr[i] = boxes->n_ion[i] * prefactor_wsfr;
        }
```

（`src/py21cmfast/src/map_mass.c:341-347`。）也就是说，非均匀复合那一路用的"逃逸加权恒星形成率"，在逐格路线里不是独立求出的，而是 `n_ion` 除以 $t_\star t_h$。物理上成立的依据是两者都正比于 $f_\star\times f_{\rm esc}$ 的乘积，只差一个时间尺度；但这也意味着**这一路没有独立的散粒成分**。

**顺序上的一个后果。** 平均校准（`mean_fix_grids`）在这张场铺完之后执行，乘的是全场同一个数，所以它只修幅度不修图案。若拿校准前后的 `n_ion` 相除，得到的是常数；若得到结构，说明看的不是这一路。

论文出处：§3.3（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）。Pritchard & Loeb 只给平均量，逐格场是本仓在实现层上的扩展。

## 十一、ζ · 综合电离效率因子

一个把所有天体物理不确定性打包在一个数里的参数：

$$\zeta=f_\star\,f_{\rm esc}\,N_{\rm ion}$$

代码里它就是 `SOURCE_MODEL == 0` 口径下的 `HII_EFF_FACTOR`（`wrapper/inputs.py`，默认 30），此时 $\dot n_{\rm ion}\propto \zeta f_{\rm coll}$，电离判据写成 $x_{\rm HI}=1-\zeta f_{\rm coll}$（§3.3 那段 `res_xH`）。档位大于 0 之后，同一个 $\zeta$ 不再是一个参数，而由 `F_STAR10`、`F_ESC10`、`POP2_ION` 现算——三个分项参数此时才进链，而 `HII_EFF_FACTOR` 变成死参数。**判断一个参数扫描有没有生效，先看档位。**

它的价值与代价是同一件事：电离历史只依赖这个乘积，所以再电离红移主要由它定；也正因为只依赖乘积，三个因子各自无法被约束。分子冷却支有它自己的对应物 `ion_eff_factor_mini`，同样是一个打包的数。

参数档位之外还有一层：`PHOTON_CONS_TYPE` 打开时，电离历史会按累积光子数再校准一次，等于在 $\zeta$ 之外又叠一层重标定——那层不改源场本身，改的是下游怎么用它（§6.5）。

论文出处：§3.3 H II 区的增长（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）；常数模型下 $\zeta$ 的取值口径另见 Greig+2015 Eq. 2（本地只有代码注释与 docstring）。

## 十二、代码地图

| 位置 | 是什么 |
| :--- | :--- |
| `HaloBox.c:29-51` | `set_integral_constants`：几何量、生长因子、$\sigma_{\rm cell}$ |
| `HaloBox.c:62-104` | `set_halo_properties`：由晕质量与标度关系算逐晕属性 |
| `HaloBox.c:105-202` | `get_uhmf_averages`：解析平均，全部换算系数的定义处 |
| `HaloBox.c:206-242` | `mean_fix_grids`：平均校准 |
| `HaloBox.c:244-295` | `get_cell_integrals`：条件积分，含"哪个量乘了 $f_{\rm esc}$"的注释 |
| `HaloBox.c:296-435` | `set_fixed_grids`：建四张条件积分表并铺场 |
| `HaloBox.c:432` | 平均校准的调用点 |
| `HaloBox.c:464-516` | `get_log10_turnovers`：两个反馈回流 |
| `HaloBox.c:518-562` | `sum_halos_onto_grid`：逐晕累加，`INHOMO_RECO` 时多一份 `whalo_sfr` |
| `HaloBox.c:563-666` | `ComputeHaloBox`：总装与档位分支 |
| `map_mass.c:217-334` | `move_grid_galprops`：逐格路线（查表 + 系数 + CIC） |
| `map_mass.c:341-347` | `whalo_sfr` 由 `n_ion` 派生的那一小段 |
| `map_mass.c:421-433` | 逐晕路线：`set_halo_properties` + CIC |
| `map_mass.c:458-460` | 逐晕路线的体元归一 |
| `scaling_relations.c:38-40` | `fix_mean` 的判定（源格那套） |
| `IonisationBox.c:154` | 电离场那套 `fix_mean`（与上不同物） |

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**源项的实现 · 条件积分与铺场算法**

本对象没有登记的论文出处：论文综述里没有对应节号，代码注释里也没有引用。

**Ṅ_ion(z) · 电离光子发射率**

- 论文节号：§3.3（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

**Ṅ_ion(x, z) · 逐格点电离光子发射率场**

- 论文节号：§3.3（`docs/论文/Pritchard & Loeb 2012 Review.pdf`；论文只给平均量，逐格场为本仓实现层扩展）

**ζ · 综合电离效率因子**

- 论文节号：§3.3 H II 区的增长（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| $\zeta$：电离效率（常数模型） | Greig+2015（Eq. 2） | The ionizing efficiency of high-z galaxies (zeta, from Eq. 2 of Greig+2015). | `src/py21cmfast/wrapper/inputs.py:1164-1164` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：$\zeta$：电离效率（常数模型）。
