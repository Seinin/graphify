# 气体热与自旋温度

这块管两件事：气体怎么被加热，以及 21 厘米信号由什么温度决定。它是链上唯一含时间导数的部分——气体温度按膨胀、加热与康普顿交换逐红移演化；自旋温度则由三个温度竞争得出，而竞争的三条通道（光子、气体、莱曼-$\alpha$ 散射给出的色温）都要先各自算出来。

两个温度的分工要分清：气体温度是真实的动力学量，由 X 射线加热与绝热冷却决定；自旋温度不是真实温度，只描述两个自旋态上各有多少原子，是它决定了信号的正负与幅度。前者算错会改信号出现的早晚，后者算错会直接改信号的方向。

它的输入是源（恒星形成率场与 X 射线光度），输出是气体温度、各路耦合系数与自旋温度，最后交给亮温公式。这也是整条链里唯一需要迭代的地方：莱曼-$\alpha$ 的色温依赖自旋温度，自旋温度又依赖耦合，只能迭代到自洽。局限在它把气体当成单相介质、把能量沉积压成平均份额、把莱曼-$\alpha$ 的多次散射折叠进一个修正项。

## ε_heat(z) · X 射线加热率

### 物理

X 射线加热率是气体热账上唯一的加热项：X 射线从源出发沿视线被中性氢吸收，沉积下来的能量先按电离度分摊——一部分进加热、一部分进电离、一部分转成莱曼-$\alpha$ 光子——剩下的部分折成单位体积、单位时间的加热量。它在整段历史上积分，并带一个中性氢份额的因子：电离度越高，同样的 X 射线留给加热的能量越少。

公式分两层：内层把源的能量按频率积成沉积份额，外层沿红移把历史各层的贡献按时间间隔与光程衰减累加。前提是吸收只由中性氢提供、且源谱取平均形状，气体温度不高、复合可忽略也是这层折算的隐含假设。它随电离历史变化，因此加热与再电离不是两条独立的线——电离得越彻底，留给加热的份额越小。

它是空间非局域的：某个格点的加热率由它上游整段历史上的 X 射线源共同决定，所以强弱同时被源的演化与吸收光程调节。它是自旋温度的间接来源——气体温度被它抬高之后，自旋温度才会重新偏离光子温度；局限在这一步只给平均份额，真实的能量沉积随能量与电离度分布，被压成一条平均曲线后，加热的空间对比会比逐频率的结果更平滑。

$$\varepsilon_{\rm heat}(z)=(1-x_e)\,\frac{L_X}{E_X}\,\bar n_{\rm H}\int_{z}^{\infty}\mathrm dz^{\prime}\,\frac{(1+z^{\prime})^{3}}{H(z^{\prime})}\,e^{-\tau_X(z,z^{\prime})}$$

### 代码解析

累加在按格点的循环里只有一行：滤过的 X 射线源乘一张按频率积好的沉积表，加进该格点的加热率。这就是正文"内层按频率积分"的落点——频率那一层的积分在初始化时就算好、摊进表里，循环里只剩查表与累加，所以加热这一步很轻，重活都在上游。

沉积表按电离度分档：同一份能量在加热、电离与莱曼-$\alpha$ 三路之间怎么分，由当时的电离度决定。这就是"电离得越彻底、留给加热的份额越小"的机制所在——它让加热率与电离历史互相牵住，而不是各走各的。

源的强弱不在这一段：恒星形成率场要先按自由程做环状滤波、再在每个尺度上取平均，恒星形成率密度或从网格现算或查预计算表——这些都归 X 射线源那一块。读这条链时把两件事分开：源有多大由上游定，加热这一步只做能量分配。

### 工程

- `src/py21cmfast/src/SpinTemperatureBox.c:1703-1707`

```c
                    if (astro_options_global->USE_X_RAY_HEATING) {
                        dxheat_dt_box[box_ct] +=
                            xray_sfr * (freq_int_heat_tbl_diff[xidx][R_ct] * ival +
                                        freq_int_heat_tbl[xidx][R_ct]);
                    }
```

这一行就是这一篇的产出。`xray_sfr` 是恒星形成率乘上 `L_X` 之后的结果（单位体积的 X 射线源强度），乘号后面那张二维表 `freq_int_heat_tbl[xidx][R_ct]` 是"该能量格、该半径层上已经按光程衰减积好的加热份额"，带 `_diff` 的那张是它在能量方向的差商。三个下标各有分工：`xidx` 是能量分档、`R_ct` 是滤波半径层、`ival` 是当前能量落在格内的相对位置，所以这里的取值只是线性插值——真正的积分（沿红移的光程衰减、按频率的能量沉积）都在建表阶段做掉了。

`if (astro_options_global->USE_X_RAY_HEATING)` 是这段唯一的开关，关掉它时 `dxheat_dt_box` 保持为零，气体温度那一步就少掉最大的一个加热项。写成 `+=` 是因为同一个格点会在每个半径层上被投一次贡献：不同距离的环带各算各的，最后在这里汇拢。

#### UpdateXraySourceBox
- `src/py21cmfast/src/SpinTemperatureBox.c:762-776`——在每个滤波半径 `R_ct` 上对 `halo_sfr` 与 `halo_xray` 各做一次环状滤波（`one_annular_filter`），把该尺度的平均恒星形成率记进 `mean_sfr`；开 mini-halo 时连 `halo_sfr_mini` 一起滤，并记下 `mean_log10_Mcrit_LW`。

```c
        one_annular_filter(halobox->halo_sfr,
                           &(source_box->filtered_sfr[R_ct * HII_TOT_NUM_PIXELS]), R_inner, R_outer,
                           &sfr_avg, &fsfr_avg);
        one_annular_filter(halobox->halo_xray,
                           &(source_box->filtered_xray[R_ct * HII_TOT_NUM_PIXELS]), R_inner,
                           R_outer, &xray_avg, &fxray_avg);

        source_box->mean_sfr[R_ct] = fsfr_avg;
        if (astro_options_global->USE_MINI_HALOS) {
            one_annular_filter(halobox->halo_sfr_mini,
                               &(source_box->filtered_sfr_mini[R_ct * HII_TOT_NUM_PIXELS]), R_inner,
                               R_outer, &sfr_avg_mini, &fsfr_avg_mini);

            source_box->mean_sfr_mini[R_ct] = fsfr_avg_mini;
            source_box->mean_log10_Mcrit_LW[R_ct] = halobox->log10_Mcrit_MCG_ave;
```

每个半径层上要滤两样东西：恒星形成率（给电离与莱曼-$\alpha$ 用）与 X 射线源（给加热用），滤完各自存进 `filtered_sfr` / `filtered_xray` 的对应层。`mean_sfr[R_ct]` 存的是这一层的平均恒星形成率，供全宇宙平均那条路径取用——它是局域量与全局量之间的桥。开迷你晕时多滤一次 `halo_sfr_mini`，并记下该尺度上用于迷你晕反馈的 `log10_Mcrit_LW` 平均值（取自 `halobox->log10_Mcrit_MCG_ave`）：莱曼-维尔纳反馈的强度跟着源的环境走，所以这个量必须与半径层绑定。

#### one_annular_filter
- `src/py21cmfast/src/SpinTemperatureBox.c:686-710`——把源盒变换到 k 空间，按 `[R_inner, R_outer]` 这一环对应的尺度截断（`HII_DIM > 1` 才真滤），再变换回实空间——出来的就是该平均自由程下被平滑过的源。

```c
        dft_r2c_cube(matter_options_global->USE_FFTW_WISDOM, simulation_options_global->HII_DIM,
                     HII_D_PARA, simulation_options_global->N_THREADS, unfiltered_box);

// remember to add the factor of VOLUME/TOT_NUM_PIXELS when converting from real space to k-space
// Note: we will leave off factor of VOLUME, in anticipation of the inverse FFT below
#pragma omp parallel num_threads(simulation_options_global->N_THREADS)
        {
#pragma omp for
            for (ct = 0; ct < HII_KSPACE_NUM_PIXELS; ct++) {
                unfiltered_box[ct] /= (float)HII_TOT_NUM_PIXELS;
            }
        }

        // Smooth the density field, at the same time store the minimum and maximum densities for
        // their usage in the interpolation tables copy over unfiltered box
        memcpy(filtered_box, unfiltered_box, sizeof(fftwf_complex) * HII_KSPACE_NUM_PIXELS);

        // Don't filter on the cell scale
        if (R_inner > 0) {
            filter_box(filtered_box, box_dim, 4, R_inner, R_outer);
        }

        // now fft back to real space
        dft_c2r_cube(matter_options_global->USE_FFTW_WISDOM, simulation_options_global->HII_DIM,
                     HII_D_PARA, simulation_options_global->N_THREADS, filtered_box);
```

滤波在 k 空间做：先正变换，把格子值除以总像素数（注释说明这是为了省掉逆变换时该乘的那个体积因子——正逆两次变换的归一化约定不同），再复制一份并对 `[R_inner, R_outer]` 这一环截断，最后逆变换回实空间。`if (R_inner > 0)` 的判据让最小的一层不滤波：`R_inner == 0` 时这一层的意义就是"不滤"，也就是本格点自己的源。

用环状而不是球状滤波，是因为每一层代表的是"在这个平均自由程尺度上被平滑过的源"：比这个尺度小的结构被抹平，比它大的部分留给外层处理，逐层的源在后面的循环里按光程权重叠加。

#### global_reion_properties
- `src/py21cmfast/src/SpinTemperatureBox.c:961-980`——取全宇宙平均电离光子数（`EvaluateNionTs`，开 mini-halo 时外加 `EvaluateNionTs_MINI`），乘由 `f_star`、`f_esc`、`N_ion` 组成的总电离效率，给出未做非均匀再电离时的 `Q_HI`。

```c
    sum_nion = EvaluateNionTs(zp, &sc);
    if (astro_options_global->USE_MINI_HALOS) {
        sum_nion_mini = EvaluateNionTs_MINI(zp, log10_Mcrit_LW_ave[0], &sc);
    }

    LOG_DEBUG("nion zp = %.3e (%.3e MINI)", sum_nion, sum_nion_mini);

    double ION_EFF_FACTOR, ION_EFF_FACTOR_MINI;
    if (matter_options_global->SOURCE_MODEL > 0) {
        ION_EFF_FACTOR = astro_params_global->F_STAR10 * astro_params_global->F_ESC10 *
                         astro_params_global->POP2_ION;
        ION_EFF_FACTOR_MINI = astro_params_global->F_STAR7_MINI * astro_params_global->F_ESC7_MINI *
                              astro_params_global->POP3_ION;
    } else {
        // no mini-halos when SOURCE_MODEL=0 (constant ionization efficiency)
        ION_EFF_FACTOR = astro_params_global->HII_EFF_FACTOR;
    }

    // NOTE: only used without MASS_DEPENDENT_ZETA
    *Q_HI = 1 - (ION_EFF_FACTOR * sum_nion + ION_EFF_FACTOR_MINI * sum_nion_mini) / (1.0 - x_e_ave);
```

这一段给出"不考虑非均匀再电离"时的平均电离度：`EvaluateNionTs` 是单位体积的电离光子产生率（开迷你晕时另加 `EvaluateNionTs_MINI`，传进去的 `log10_Mcrit_LW_ave[0]` 取第一个半径层的值），乘上电离效率再除以剩余中性氢的份额（`1.0 - x_e_ave`），得到被电离的比例。

电离效率的取法在这里分岔：`SOURCE_MODEL > 0` 时按三条天文参数现乘（`F_STAR10 * F_ESC10 * POP2_ION`，迷你晕支用 `F_STAR7_MINI * F_ESC7_MINI * POP3_ION`），`SOURCE_MODEL == 0` 时直接用 `HII_EFF_FACTOR` 这个综合参数、且不启用迷你晕支（注释写明 `no mini-halos when SOURCE_MODEL=0`）。这条分岔是旧参数化（一个综合电离效率）与新参数化（分项乘出来）在本仓里的交界，看到 `HII_EFF_FACTOR` 与 `POP2_ION` 并列出现时，原因就在这里。末尾那个 `Q_HI` 只在这一路被用到（注释 `only used without MASS_DEPENDENT_ZETA`），它是后面做光子守恒修正的输入之一。

#### initialise_SFRD_spline
- `src/py21cmfast/src/interp_tables.c:137-152`——沿红移网格逐点演化解锁常数（`evolve_scaling_constants_to_redshift`）、取该红移的最小源质量，用 `Nion_General` 把单位体积的光子产生率填进 `SFRD_z_table`；开 mini-halo 时另填 `SFRD_z_table_MINI`（每个 `mturn` 一列）。

```c
        for (i = 0; i < Nbin; i++) {
            z_val = SFRD_z_table.x_min +
                    i * SFRD_z_table.x_width;  // both tables will have the same values here
            sc_sfrd = evolve_scaling_constants_to_redshift(z_val, &sc_sfrd, false);
            lnMmin = log(minimum_source_mass(z_val, true));

            if (astro_options_global->USE_MINI_HALOS) {
                for (j = 0; j < NMTURN; j++) {
                    mturn_mcg = pow(10, SFRD_z_table_MINI.y_min + j * SFRD_z_table_MINI.y_width);
                    SFRD_z_table_MINI.z_arr[i][j] =
                        Nion_General_MINI(z_val, lnMmin, lnMmax, mturn_mcg, &sc_sfrd);
                }
            }
            SFRD_z_table.y_arr[i] =
                Nion_General(z_val, lnMmin, lnMmax, sc_sfrd.mturn_a_nofb, &sc_sfrd);
        }
```

这是表的构建过程：红移网格逐点走过去，每点先把与红移相关的标度关系更新一次（`evolve_scaling_constants_to_redshift`），再取该点对应的最小源质量（电离用途那一档），然后用 `Nion_General` 把单位体积的光子产生率写进样条表。开迷你晕时同一红移上还要对每个 `mturn` 值各算一列，因为迷你晕的反馈强度是随环境变动的量，一条标度关系代表不了。

每点都重新更新标度关系、而不是在循环外算一次，是因为标度关系里那些量（最小源质量、逃逸分数之类）本身随红移演化；建表时把它们钉在网格点上，运行时才只剩插值。

#### calculate_sfrd_from_grid
- `src/py21cmfast/src/SpinTemperatureBox.c:1034-1057`——逐格算共动 SFRD：`SOURCE_MODEL == 1` 走条件 SFRD（`EvaluateSFRD_Conditional`，mini-halo 用格自身的 `Mcrit`），`SOURCE_MODEL == 2` 走塌缩分数对红移的导数；同时累出全盒平均。

```c
        for (box_ct = 0; box_ct < HII_TOT_NUM_PIXELS; box_ct++) {
            curr_dens = dens_R_grid[box_ct] * zpp_growth[R_ct];
            if (astro_options_global->USE_MINI_HALOS) curr_mcrit = Mcrit_R_grid[box_ct];

            if (matter_options_global->SOURCE_MODEL == 1) {
                fcoll = EvaluateSFRD_Conditional(curr_dens, zpp_growth[R_ct], M_min_R[R_ct],
                                                 M_max_R[R_ct], M_max_R[R_ct], sigma_max[R_ct], sc);
                sfrd_grid[box_ct] = (1. + curr_dens) * fcoll;

                if (astro_options_global->USE_MINI_HALOS) {
                    fcoll_MINI = EvaluateSFRD_Conditional_MINI(
                        curr_dens, curr_mcrit, zpp_growth[R_ct], M_min_R[R_ct], M_max_R[R_ct],
                        M_max_R[R_ct], sigma_max[R_ct], sc);
                    sfrd_grid_mini[box_ct] = (1. + curr_dens) * fcoll_MINI;
                }
            } else {
                fcoll = EvaluateFcoll_delta(curr_dens, zpp_growth[R_ct], sigma_min[R_ct],
                                            sigma_max[R_ct]);
                dfcoll = EvaluatedFcolldz(curr_dens, zpp_for_evolve_list[R_ct], sigma_min[R_ct],
                                          sigma_max[R_ct]);
                sfrd_grid[box_ct] = (1. + curr_dens) * dfcoll;
            }
            ave_sfrd_buf += fcoll;
            ave_sfrd_buf_mini += fcoll_MINI;
```

逐格点的恒星形成率密度在这里算出来，并在同一个循环里累出全盒平均。两条分支对应两种源模型：`SOURCE_MODEL == 1` 用条件质量函数给出的塌缩分数 `fcoll`（开迷你晕时另算一支，并让每个格点用它自己的 `Mcrit`），`SOURCE_MODEL == 2` 用塌缩分数对红移的导数 `dfcoll`（对应"恒星形成率正比于塌缩率"那一类参数化）；`(1. + curr_dens)` 把密度的局部增强写进源强。

累加到 `ave_sfrd_buf` 的是 `fcoll` 而不是已经乘过密度因子的 `sfrd_grid`：两者差一个密度因子，在第二条分支下还差一个对红移的导数，读这段时不要把两个口径混起来——平均那一支要的是塌缩分数本身。`ave_sfrd_buf_mini` 同理累的是迷你晕支的 `fcoll_MINI`，它在没开迷你晕的运行时保持为零（`fcoll_MINI` 在那一支里没有被赋值，循环末尾的累加等于空转）。

- 输入：$L_X$ 网格、光程 $\tau(\nu)$ 与能量份额表；上游为 lx 与 filtered_xray
- 产出：X 射线加热率 $\varepsilon_{\rm heat}(z)$

### 参数语境

#### F_ESC10

逃逸分数（默认 -1.0，log10）。它不进 X 射线光度那一项——X 射线源强由 `L_X` 直接乘恒星形成率给出——所以对加热率的作用是绕经电离历史的：逃逸分数越大，气体被电离得越彻底，中性氢份额越低，`(1-x_e)` 因子与吸收光程都跟着变，X 射线沉积到哪一层、留多少能量进热也跟着变。

#### F_ESC7_MINI

迷你晕支的逃逸分数（默认 -2.0）。只在打开 `USE_MINI_HALOS` 时有作用面：那时第 3 族源的 X 射线与电离光子都按它缩放，加热率里多出来的那一份随它走。关掉迷你晕时它不参与任何计算。

#### F_STAR10

恒星形成效率（默认 -1.3，log10），是这一篇最直接的杠杆：`xray_sfr` 正比于恒星形成率密度，而这个密度由它定。它是整体缩放——改它等于把加热曲线整段抬高或压低，加热开始生效的红移也跟着前后挪。

#### F_STAR7_MINI

迷你晕的恒星形成效率。打开迷你晕时 X 射线源多一支（`sfr_term_mini * L_X_MINI`，`SpinTemperatureBox.c:1694`），这一支的幅度由它定；关掉迷你晕时不参与。它与 `F_STAR10` 的关系是"同一件事在两个质量段上的取值"，两条支的叠加才是总的 X 射线源。

#### HII_EFF_FACTOR

综合电离效率（默认 30.0）。公式里那个 `(1-x_e)` 因子由它决定：调大它，同样的源把气体电离得更彻底，留给加热的能量按比例减少——这是"加热与电离互相牵制"在参数上的形态。在 `SOURCE_MODEL == 0` 的那条路上它是唯一的电离效率参数，在分项参数化的路子上它与 `POP2_ION`、`F_ESC10`、`F_STAR10` 的乘积等效（见 `heating_helper_progs.c:989` 的 `ion_eff`）。

#### INTEGRATION_METHOD_ATOMIC

原子晕条件质量函数的积分方法（取值是几种求积法的名字）。它决定恒星形成率密度怎么积出来，因此决定进 `xray_sfr` 的那个数；换方法只带来小的数值差异，物理不变。它属于数值选项，扫描时一般不动。

#### INTEGRATION_METHOD_MINI

同上，管迷你晕那一支的积分。开迷你晕时两支积分法各自生效（可以取不同方法），关掉时它不参与。

#### NU_X_BAND_MAX

X 射线波段的能量上界（默认 2000 eV）：谱的归一化积分积到它为止（`SpinTemperatureBox.c:1096-1105`），也就是说超过这个能量的光子不计入"每单位光度折出多少光子"这一步。调大它等于把高能尾巴纳进归一化，源强的含义随之变。

#### NU_X_MAX

整条 X 射线谱的截断能量（默认 10000 eV）：沉积份额的数值积分上界（`heating_helper_progs.c:843-849`）。它与 `NU_X_BAND_MAX` 是两件事——前者管"谱积到多高"，后者管"归一化窗口开多宽"，写参数时很容易混。

#### NU_X_THRESH

能量下限，同时也是谱的归一化能量（默认 500 eV）。光子能量低于它的 X 射线不算进这条加热积分（`SpinTemperatureBox.c:832-836`、`1107-1121` 的换算都以它作基准）。调高它等于把软 X 射线从加热账上划掉：软光子穿透差、多在本地被吸收，所以这是一个近似的选择。

#### N_STEP_TS

自旋温度演化的层数（默认 40），同时是滤波半径的分档数：`R_factor = pow(R_MAX_TS / R, 1/N_STEP_TS)`（`SpinTemperatureBox.c:330`）。它决定加热率在多少张半径层上与源卷积，层数少则半径方向的分辨变粗，加热率的空间对比被抹平。

#### OMb

重子密度，定氢核数密度 `No`。加热率正比于气体数密度，因此它整体缩放加热率；与 `hlittle` 一起进这个组合（`No ∝ OMb h²`）。在参数几乎被宇宙学测量钉死的今天，它更多是"密度基准"的角色。

#### POP2_ION

每重子的电离光子数（默认 5000）。它不在加热率的式子里，而是在源侧与 `F_STAR10`、`F_ESC10` 一起组成电离效率，因此改的是电离历史；加热率只经 `(1-x_e)` 与吸收光程受它影响。光子本身的能量来源仍是 `L_X`，这条界线在扫描里要分清：调 `POP2_ION` 动的是电离，不是注入能量。

#### POP3_ION

迷你晕支的同一个量（默认 44021）。作用路径与 `POP2_ION` 相同、作用面只在打开迷你晕时存在。

#### R_MAX_TS

自旋温度场的滤波半径上界（默认 500 Mpc）。源盒按从小到 `R_MAX_TS` 的半径层逐级滤波，加热率就是这些层上的源按光程权重叠出来的；超出这个尺度的源被当成平均背景，不再贡献空间对比。它是"X 射线能看多远"的数值上限。

#### USE_LYA_HEATING

莱曼-$\alpha$ 加热的开关（默认打开）。它与 X 射线加热并列，是外来加热的另一条通道：打开时气体温度更新里多出两项，同样的温度收到两份能量。关掉它，X 射线就成了唯一的加热来源，黎明段的气体温度会低一截。

#### USE_MINI_HALOS

迷你晕总开关（默认关闭）。打开后 X 射线源多一支（第 3 族恒星，经 `L_X_MINI`），加热率的幅度与空间分布都变；关掉时 `F_STAR7_MINI`、`L_X_MINI`、`F_ESC7_MINI`、`POP3_ION` 在这一条链上全部失去作用面。它还会改电离历史，因此间接影响 `(1-x_e)` 因子。

#### USE_X_RAY_HEATING

这一篇的总开关（默认打开）。只有它为真，`dxheat_dt_box` 才累加（`SpinTemperatureBox.c:1703-1707`）；关掉它，本页的产出恒为零，气体温度只剩绝热降温与康普顿交换两项可用。

#### X_RAY_SPEC_INDEX

X 射线谱的幂律指数（默认 1.0）。它决定能量按频率怎么摊，也决定代码走哪条归一化分支：等于 1.0 时有专门写好的解析式（用对数差，`SpinTemperatureBox.c:1094-1098`），否则用幂律差（`1101-1104`）；谱强度本身也按 `nu^{-index}` 缩放（`heating_helper_progs.c:774-775`）。指数越小谱越硬，高能光子越多，沉积位置越深、空间分布越平滑。

#### Y_He

氦丰度。它进总粒子数 `n_tot`（温度更新的分母）与电子数密度：加热率给的是单位体积的能量，折成温升要除以粒子数，氦多了同样的能量摊到更多粒子上，温度抬升变小；同时它改变 `N_b0` 与中性氢的数密度口径。

#### hlittle

无量纲哈勃常数。它与 `OMb` 一起定数密度（`No ∝ OMb h²`），又出现在积分权重里的 `H(z)` 与光程上；改它等于同时动源强与几何。因为这两个作用方向不同，它对加热率曲线的影响不是单纯的整体缩放。

## T_K(z) · 气体动力学温度

### 物理

气体动力学温度按绝热膨胀加受热演化：膨胀项以两倍哈勃率降温，加热项把 X 射线沉积的能量按总粒子数摊进温度，另加与光子温度之间的康普顿耦合——电子与光子散射交换能量，把气体拉向光子温度。它是链上少数几条含时间导数的方程之一。

公式左边是温度的时间变化率，右边三项分别是绝热冷却、加热与康普顿交换；前提是气体被视为单一温度的单相介质，密度扰动只通过绝热项与加热项进入。演化在整段红移上做，每个格点带自己的密度，因此温度场随密度场一起起伏。

高红移时康普顿耦合把温度钉在光子温度上；复合之后耦合退居次要，气体按绝热膨胀自由降温；再往后 X 射线加热把它重新抬起来。这条曲线的最低点，就是 21 厘米吸收信号最深处的取温来源。局限在方程是一维、逐格点演化的：流体动力学、激波与并合造成的加热都不在其中，只能靠密度扰动与外部加热近似。

$$\frac{\mathrm dT_K}{\mathrm dt}=-2HT_K+\frac{2}{3}\frac{\varepsilon_{\rm heat}}{k_B\\,n_{\rm tot}}+\Gamma_{\rm Compton}\\,(T_\gamma-T_K)$$

### 代码解析

温度更新是一个快照一步的显式推进：取出上一快照的温度，把各项变化率一起乘红移步长加上去——绝热项、X 射线加热、康普顿交换，外加几项谱线与连续谱的贡献都写在同一行里，只在温度低于上限时才推进。各项单独打出来的调试输出就挂在旁边，读曲线出现异常时，靠它区分是哪一项在推。

紧跟着有一条兜底：温度被积成负值时直接压回光子温度。代码注释说明这是梯形积分在欠密区容易过冷导致的——看到低温端的异常值，先想到这条兜底。

两个辅助函数在别处：复合系数用 Abel 等人的九阶多项式拟合（自变量是温度的常用对数），在电离度那一支里用；能量沉积份额的插值先在能量方向做两次线性插值、再按电离度在两条结果之间插一次。它们都不含物理选择，只是把拟合式与表搬进主循环。

### 工程

- `src/py21cmfast/src/SpinTemperatureBox.c:1293-1311`——温度快照的更新：把本步算出的各项导数按同一个红移步长加到 `Tk` 上，再连带把 `x_e` 与 `Tk` 写进输出。

```c
    Tk = rad->prev_Tk;
    if (Tk < MAX_TK) {
        if (debug_printed == 0 && omp_get_thread_num() == 0)
            LOG_SUPER_DEBUG(
                "Heating Terms: T %.4e | X %.4e | c %.4e | S %.4e | A %.4e | c %.4e | lc %.4e | li "
                "%.4e | dz %.4e",
                Tk, dxheat_dzp, dcomp_dzp, dspec_dzp, dadia_dzp, dCMBheat_dzp, eps_Lya_cont,
                eps_Lya_inj, dzp);

        Tk += (dxheat_dzp + dcomp_dzp + dspec_dzp + dadia_dzp + dCMBheat_dzp + eps_Lya_cont +
               eps_Lya_inj) *
              dzp;
        if (debug_printed == 0 && omp_get_thread_num() == 0) LOG_SUPER_DEBUG("--> T %.4e", Tk);
    }
    // spurious bahaviour of the trapazoidalintegrator. generally overcooling in underdensities
    if (Tk < 0) Tk = consts->Trad;

    output.x_e = x_e;
    output.Tk = Tk;
```

这一步是显式欧拉，不是解微分方程：加号右边那七个量每一项都是"每单位积分变量的温度变化率"，乘上本层的步长 `dzp` 之后直接相加，温度的历史被摊成逐层的增量。积分变量就是代码铺表用的那个（`zpp_*` 那一族数组，每层存一个红移、一个生长因子与一个步长），所以乘数是 `dzp` 而不是物理时间 `dt`——上一节那个 $\mathrm dt$ 形式的方程在这里被换成对红移的等效形式，是数值实现上的改写，不是物理项变多。

七个量对应五个物理通道：`dxheat_dzp` 是 X 射线加热，`dcomp_dzp` 是与光子温度的康普顿交换，`dspec_dzp` 是谱畸变那一支的贡献，`dadia_dzp` 是绝热膨胀（方程式里的 $-2HT_K$ 项），`dCMBheat_dzp` 只在打开 CMB 加热时才非零，最后两项 `eps_Lya_cont` 与 `eps_Lya_inj` 是莱曼-$\alpha$ 加热的连续谱与注入部分——它们在公式里没有单独列出来，是莱曼-$\alpha$ 加热这条次要通道加进来之后多出的两项。

调试打印把七项连同步长按 `LOG_SUPER_DEBUG` 输出，用意是让"温度在这个红移为什么突然抬头"能直接读数对上账：只要有哪一项比其余项大出一两个量级，曲线拐点的责任就在那一项上。`if (Tk < MAX_TK)` 是代价保护——温度已经跑到上限值就不再算这一步；末尾 `if (Tk < 0) Tk = consts->Trad;` 是兜底，注释写明原因是梯形积分器在欠密区会过度冷却（原注 `spurious bahaviour ... generally overcooling in underdensities`），把温度摁回光子温度止损，这不是物理模型的一部分。同一段末尾把 `x_e` 与 `Tk` 一起写进 `output`，是因为自旋温度那一步要同时取这两个量。

#### alpha_A

- `src/py21cmfast/src/thermochem.c:67-76`——A 型复合系数 `alpha_A(T)`：Abel et al. 1997 的九阶多项式拟合，自变量是 `log(T/1.1605e4)`，单位 cm^3 s^-1。

```c
double alpha_A(double T) {
    double logT, ans;
    logT = log(T / (double)1.1604505e4);
    ans = exp(-28.6130338 - 0.72411256 * logT - 2.02604473e-2 * pow(logT, 2) -
              2.38086188e-3 * pow(logT, 3) - 3.21260521e-4 * pow(logT, 4) -
              1.42150291e-5 * pow(logT, 5) + 4.98910892e-6 * pow(logT, 6) +
              5.75561414e-7 * pow(logT, 7) - 1.85676704e-8 * pow(logT, 8) -
              3.07113524e-9 * pow(logT, 9));
    return ans;
}
```

它是温度到"复合快慢"的换算器，本身不推进任何东西。归一化温度 `1.1604505e4` K 就是 1 eV 折算成温度的值，所以自变量 `logT` 是"以 eV 为单位的温度"取对数；返回值的量纲是 cm³ s⁻¹，乘上电子与质子数密度就是单位时间内的复合率。九阶多项式在低温端不收敛——拟合族在几千开尔文以下的误差会涨起来，但那段温度上碰撞耦合与莱曼-$\alpha$ 都还没起来，对亮温的影响有限。

它在链上出现的场合是电离演化的复合汇项：`dxion_sink_dt` 那一支要乘上 $\alpha_A(T_K)$（`SpinTemperatureBox.c:1220`），也就是说气体越热、复合越快；同一个调用点还要乘上亚网格团簇因子 `CLUMPING_FACTOR` 与残留电子分数。因此它虽然挂在气体温度这一篇下，真正被消费的地方在电离度那一支——温度一动，复合率跟着变，残留电子分数与 $x_c$ 也就跟着变。

#### interp_fheat

- `src/py21cmfast/src/elec_interp.c:149-164`——在能量与电离度两个方向上做双线性插值：先在相邻能量格上各插一次，再按 `xHII` 在两条结果之间插值，得该 `(E, xHII)` 处的 X 射线加热分数 `f_heat`。

```c
    n_low = locate_energy_index(En);
    n_high = n_low + 1;

    m_xHII_low = locate_xHII_index(xHII_call);
    m_xHII_high = m_xHII_low + 1;

    // First linear interpolation in energy
    elow_result = ((x_int_fheat[m_xHII_low][n_high] - x_int_fheat[m_xHII_low][n_low]) /
                   (x_int_Energy[n_high] - x_int_Energy[n_low]));
    elow_result *= (En - x_int_Energy[n_low]);
    elow_result += x_int_fheat[m_xHII_low][n_low];

    // Second linear interpolation in energy
    ehigh_result = ((x_int_fheat[m_xHII_high][n_high] - x_int_fheat[m_xHII_high][n_low]) /
                    (x_int_Energy[n_high] - x_int_Energy[n_low]));
    ehigh_result *= (En - x_int_Energy[n_low]);
```

`f_heat` 回答的是"注入的能量里有多大比例最终变成热"，它没有解析式，只有一张按能量与电离度排好的表，这里负责在表上取数。两个下标各用一次二分查找（`locate_energy_index` 找能量格、`locate_xHII_index` 找电离度格），然后先固定电离度沿能量插两次、再沿电离度插一次——顺序反过来结果一样，写成这样是为了让中间量 `elow_result` / `ehigh_result` 各自对应一条等电离度曲线，读起来能对上表的两根轴。

这段是 X 射线加热那一支的查表接口，被上游用来把"每个能量格上沉积多少能量"折算成"其中多少进热"。它的两个自变量都不是常量：能量来自 X 射线谱与光程（取决于 $L_X$ 与谱指数 `X_RAY_SPEC_INDEX`），电离度来自当时的自由电子分数。也就是说加热分数随电离历史浮动，这正是 X 射线加热与电离两条通道互相牵制的地方——气体越电离，同样的能量里进热的那一份越少。

- 输入：$\varepsilon_{\rm heat}$、$T_\gamma$、$\delta$ 与上一快照 $T_K$；上游为 eps_heat、tgamma、perturb_field
- 产出：气体动力学温度 $T_K(z)$

### 参数语境

本对象名下没有参数标签。$T_K$ 只被上游送进来的能量项推动，参数矩阵把管这些项的开关（`USE_X_RAY_HEATING`、`USE_LYA_HEATING`、`USE_CMB_HEATING`）挂在自旋温度那一篇下——它们打开的正是这里这段更新里的几项。要查某个参数怎么动这条温度曲线，从自旋温度那篇的参数语境进。

## J_α(z) · Ly-α 辐射场强度

### 物理

莱曼-$\alpha$ 背景强度是 Wouthuysen–Field 效应的强度来源：恒星发出的更高能级莱曼光子最终都会级联退化成莱曼-$\alpha$ 光子，把每个能级的贡献按回收分数加权、再沿光程累加，就得到该红移处的背景强度。它一旦够强，自旋温度就从被光子温度钉住转向被气体温度钉住。

公式是一层红移积分：被积函数是各能级发射率乘回收分数的和，权重是光程元；前提是莱曼级联的回收分数已由原子物理定好、且光子在本地被反复散射到饱和——真正输运的细节被压成这一层积分。回收分数对低能级是 1，对刚好落在莱曼-$\alpha$ 上的能级是 0，更高级次按表给出，这一条分档决定了背景强度的整体幅度。

它对上依赖恒星形成率密度（也就是恒星形成效率与最小源质量），对下与气体温度、中性氢份额一起决定莱曼-$\alpha$ 耦合系数。它是历史积分、带记忆，在观测量里与 X 射线加热、电离效率彼此简并——三条线的强度都随源的整体幅度一起动，单看 21 厘米信号很难把它们分开。

$$J_\alpha(z)=\frac{c}{4\pi}\int_{z}^{\infty}\frac{\mathrm dz^{\prime}}{H(z^{\prime})(1+z^{\prime})}\sum_{n\ge 2}f_{\rm recycle}(n)\\,\epsilon_{n}(z^{\prime})$$

### 代码解析

逐格点求值时取的是两个累加量之和——代码注释专门说明它们并非真正的 $\mathrm d/\mathrm dz$，就是莱曼-$\alpha$ 通量；红移那一层的积分是在演化过程中一层一层累上去的，到用时只做一次相加。

能级求和那一段（`SpinTemperatureBox.c:416-434`）从最高能级往下走，把回收分数与谱发射率乘起来相加；红移到莱曼-$\alpha$ 的那部分与红移到莱曼-维纳阈以下的那部分各累一条，后者只在开 mini-halo 时才需要，还要乘上分子氢屏蔽的补偿因子。循环里那句越界检查决定了某些能级在低红移处直接跳过——不是优化，是因为那里的光子已经红移到阈下了。

回收分数本身是一张表：能级不高于 2 记 1、恰好为 3 记 0，更高能级查表。谱发射率则把每支星族的幂律谱在相邻频率格上积成分段光子数密度，结果非正时压到一个正的下限——这一步是防负数进对数与除零，不是物理。

### 工程

- `src/py21cmfast/src/SpinTemperatureBox.c:1314-1335`——莱曼-$\alpha$ 通量在这里作为一个中间量算出来（两项相加），并顺手给出自旋温度迭代要用的 `xc_fast`、`xi_power` 与 `xa_tilde_fast_arg`。

```c
    double J_alpha_tot = rad->dstarlya_dt + rad->dxlya_dt;  // not really d/dz, but the lya flux

    // JD: I'm leaving these as comments in case I'm wrong, but there's NO WAY a compiler doesn't
    // know the fastest way to invert a number
    //  T_inv = expf((-1.)*logf(Tk));
    //  T_inv_sq = expf((-2.)*logf(Tk));
    double T_inv, T_inv_sq;
    double xc_fast, xi_power, xa_tilde_fast_arg, xa_tilde_fast = 0.;
    double TS_fast, TSold_fast;
    T_inv = 1 / Tk;
    T_inv_sq = T_inv * T_inv;

    xc_fast = (1.0 + rad->delta) * consts->xc_inverse *
              ((1.0 - x_e) * No * kappa_10(Tk, 0) + x_e * N_b0 * kappa_10_elec(Tk, 0) +
               x_e * No * kappa_10_pH(Tk, 0));

    xi_power = consts->Ts_prefactor * cbrt((1.0 + rad->delta) * (1.0 - x_e) * T_inv_sq);

    xa_tilde_fast_arg = consts->xa_tilde_prefactor * J_alpha_tot *
                        pow(1.0 + 2.98394 * xi_power + 1.53583 * xi_power * xi_power +
                                3.85289 * xi_power * xi_power * xi_power,
                            -1.);
```

第一行就是这一篇的产出，值得注意的是它名不副实：变量叫 `dstarlya_dt`、`dxlya_dt`，注释却写明 `not really d/dz, but the lya flux`——存的是通量本身，不是对红移的导数。$J_\alpha$ 在代码里没有独立函数，它是演化循环里就地算出的一个数，紧接着被 `xa_tilde_fast_arg` 用掉：`consts->xa_tilde_prefactor` 里已经含了原子常数与光子温度，`J_alpha_tot` 乘上去，再除以一个随 $\xi$(由密度、电离度与气体温度合成的无量纲量 `xi_power`) 增长的多项式—这个多项式是"散射不完全热化"的修正，也就是把上面物理节里那个 $S_\alpha$ 折成可算的形式。

同一段里 `xc_fast` 与 `xi_power` 也一并算好：前者是碰撞耦合（氢原子、电子、质子三种碰撞体各自的 `kappa_10*` 查表值按密度加权），后者进自旋温度那一步的多项式拟合。把这几件事挤在一个循环里，是因为它们共享同一批"每层每格点"的中间量（`T_inv`、`rad->delta`、`x_e`），分开算就等于重复取数。代码里留着的两行注释（`JD: I'm leaving these as comments ... no way a compiler doesn't know the fastest way to invert a number`）是针对 `1/Tk` 的写法：原作者试过用 `expf(-logf(Tk))` 之类的手工优化，最后确认没必要。

#### calculate_spectral_factors

- `src/py21cmfast/src/SpinTemperatureBox.c:416-434`——对 Lyman 级次 `n >= 3` 逐级累加 `frecycle(n)` 加权后的谱积分：高能级红移到 Ly-alpha 的那部分走 2->2、mini-halo 走 2->3；开 mini-halo 时另累红移到 `nu_LW` 阈以下的 LW 通量。

```c
        for (n_ct = NSPEC_MAX; n_ct >= 3; n_ct--) {
            if (zpp > zmax(zp, n_ct)) continue;

            nuprime = nu_n(n_ct) * (1 + zpp) / (1.0 + zp);
            sum_lynto2_val += frecycle(n_ct) * spectral_emissivity(nuprime, 0, 2);
            if (astro_options_global->USE_MINI_HALOS) {
                sum_lynto2_val_MINI += frecycle(n_ct) * spectral_emissivity(nuprime, 0, 3);

                if (nuprime < physconst.nu_LW_thresh / physconst.nu_ion_HI)
                    nuprime = physconst.nu_LW_thresh / physconst.nu_ion_HI;
                if (nuprime >= nu_n(n_ct + 1)) continue;
                sum_lyLW_val +=
                    (1. - astro_params_global->F_H2_SHIELD) * spectral_emissivity(nuprime, 2, 2);
                sum_lyLW_val_MINI +=
                    (1. - astro_params_global->F_H2_SHIELD) * spectral_emissivity(nuprime, 2, 3);
            }
        }
        sum_lyn_val = sum_ly2_val + sum_lynto2_val;
        sum_lyn_val_MINI = sum_ly2_val_MINI + sum_lynto2_val_MINI;
```

这一段就是公式里那个内层求和。循环从最高能级 `NSPEC_MAX` 往下降到 3（级次 2 及以下单独在前面累，见 `sum_ly2_val`），每一级先做两件事：`zpp > zmax(zp, n_ct)` 判掉"这一层红移还没降到该级次能被散射的位置"的层——高能级的莱曼光子只有在红移到对应共振频率之后才参与；然后用 `nuprime = nu_n(n_ct) * (1 + zpp) / (1.0 + zp)` 把发射时刻的频率换算到观察时刻，把红移效应放进被积函数的自变量里，而不是放进积分权重。

权重 `frecycle(n_ct)` 就是公式里的回收分数：越高能级越大，往莱曼-$\alpha$ 回收的比例不同。开迷你晕时（`USE_MINI_HALOS`）循环体里多做两件事：一支用第 3 族谱累 `sum_lynto2_val_MINI`，另一支把 `nuprime` 抬高到 `nu_LW_thresh / nu_ion_HI` 之上（低于这个能量不产生 LW 反馈），若已经越过本级次的频率上界（`nuprime >= nu_n(n_ct + 1)`）就跳过——这两支算的 `sum_lyLW_val` 是莱曼-维尔纳通量，喂给迷你晕的自屏蔽反馈，不是 $J_\alpha$ 的一部分。`(1. - F_H2_SHIELD)` 只乘在 LW 通量上（源码注释 `moved (1. - F_H2_SHIELD) outside` 说的是这个因子从 `spectral_emissivity` 里挪到外面），$J_\alpha$ 的求和里没有它。

#### frecycle

- `src/py21cmfast/src/heating_helper_progs.c:200-211`——`Ly-n` 光子最终退化成 `Ly-alpha` 的回收分数：`n <= 2` 记 1、`n = 3` 记 0，更高能级查表（Pritchard & Furlanetto）。

```c
double frecycle(int n) {
    switch (n) {
        case 0:
            return 1;
        case 1:
            return 1;
        case 2:
            return 1;
        case 3:
            return 0;
        case 4:
            return 0.2609;
```

这是一个查表函数，没有计算：级次 0、1、2 都返回 1，级次 3 返回 0，从 4 起给出逐级递减的回收分数（`0.2609` 是 4 级的值，更高级次在下面的 `case` 里继续列）。级次 3 记 0 是这一族系数的分档——落在莱曼-$\beta$ 上的光子不按"必然回收到莱曼-$\alpha$"处理；级次 2 及以下记 1 则是约定：这些光子已经在莱曼-$\alpha$ 或更低处，散射后不再逃出共振。

它在链上的位置是 `calculate_spectral_factors` 的乘数，因此这一张表直接决定 $J_\alpha$ 的幅度：把某两级的分档改掉，整条曲线的水平就跟着平移。这类数值来自 Pritchard & Furlanetto 的级联计算，是外部原子物理输入，代码没有提供开关去改它——要改只能改这张表本身。

#### spectral_emissivity

- `src/py21cmfast/src/heating_helper_progs.c:286-300`——把该星族（`Population`）的幂律谱 `N0 · nu^-alpha_S` 在相邻频率格 `[nu_n, nu_n+1]` 上积分，得这一段里的光子数密度；结果非正时压到 `1e-40`。

```c
            for (i = 1; i < (NSPEC_MAX - 1); i++) {
                if ((nu_norm >= nu_n[i]) && (nu_norm < nu_n[i + 1])) {
                    // We are in the correct spectral region
                    if (Population == 2) {
                        // moved (1. - F_H2_SHIELD) outside
                        result =
                            N0_2[i] / (alpha_S_2[i] + 1) *
                            (pow(nu_n[i + 1], alpha_S_2[i] + 1) - pow(nu_norm, alpha_S_2[i] + 1));
                        return result > 0 ? result : 1e-40;
                    } else {
                        result =
                            N0_3[i] / (alpha_S_3[i] + 1) *
                            (pow(nu_n[i + 1], alpha_S_3[i] + 1) - pow(nu_norm, alpha_S_3[i] + 1));
                        return result > 0 ? result : 1e-40;
                    }
```

函数体是"先定位频率落在哪两个格之间，再解析积分"：`N0 / (alpha_S + 1) * (nu_上界^{alpha_S+1} - nu^{alpha_S+1})` 就是幂律谱 $N_0\nu^{-\alpha_S}$ 从当前频率到该格上界的积分，闭式给出，不用数值积分。两个星族各用自己的一组系数：`Population == 2` 取 `N0_2/alpha_S_2`（第二代），否则取 `N0_3/alpha_S_3`（第三族，也就是迷你晕那一支）——这一组系数是从 `stellar_spectra.dat` 读进来的（同一函数 `case 1:` 分支），读入后立刻乘上 `POP2_ION` / `POP3_ION`（`heating_helper_progs.c:326-332`），所以"每个电离光子折出多少 Ly-$n$ 光子"的归一由那两个参数决定。

函数按 `flag` 分档：`flag == 0` 是常规的那一支，`flag == 1` 才去读恒星谱文件、`flag == 2` 是专供 LW 通量的一支（源码注释 `For LW calculation. New in v1.5`），`calculate_spectral_factors` 里两个调用分别传 0 与 2，就看得出哪一支是给 $J_\alpha$、哪一支是给 LW 反馈。返回值末尾那个 `result > 0 ? result : 1e-40` 是把非正的插值结果压成一个极小数——避免下游对它取对数或做除法时报错，同时也是在频率落表外的兜底。

- 输入：各源的 Ly-$n$ 发射率（由 $\dot\rho_\star$ 折出）；上游为 rho_star
- 产出：Ly-$\alpha$ 背景强度 $J_\alpha(z)$

### 参数语境

#### F_H2_SHIELD

分子氢自屏蔽因子（默认 0.0，即不屏蔽）。它以 `(1. - F_H2_SHIELD)` 的权重只乘在莱曼-维尔纳通量上（`SpinTemperatureBox.c:410-430`，源码注释特意标明这个因子是"挪到外面"乘的），不进 $J_\alpha$ 的求和。它对 $J_\alpha$ 的影响是间接的：LW 通量决定迷你晕的恒星形成率，源一动，$J_\alpha$ 跟着动。在扫描里它是迷你晕那一支的反馈强度旋钮。

#### N_STEP_TS

自旋温度演化的层数（默认 40）。代码按它在红移方向分配 `zpp_for_evolve_list` 一族数组（`SpinTemperatureBox.c:120-124`），也就是 $J_\alpha$ 的累积与取用都铺在这些层上。它改的是数值分辨率：层数少，历史积分在曲线上留下阶梯，亮温曲线的细节会被抹平；层数多的代价是逐层的插值表变大。

#### POP2_ION

第二代恒星每重子的电离光子数（默认 5000）。它不出现在这一段代数式里，作用在谱的归一上：初始化时把整张星谱的 `N0_2` 系数乘上它（`heating_helper_progs.c:326-332`），也就是定"每形成一单位恒星质量、谱里有多少光子"。$J_\alpha$ 的幅度随之整体缩放，而它的谱形由谱指数 `alpha_S_2` 管。

#### POP3_ION

第三族（迷你晕）对应的同一个量（默认 44021）。对 $J_\alpha$ 的作用只在打开 `USE_MINI_HALOS` 之后出现：那时 `calculate_spectral_factors` 会多累一支用第 3 族谱的求和，归一就是它。关掉迷你晕时，把它调大不会改变任何结果。

#### USE_LYA_HEATING

它不改 $J_\alpha$ 的数值，改的是这些能量在下游的用法：打开时莱曼-$\alpha$ 加热的两项（`eps_Lya_cont`、`eps_Lya_inj`）参与气体温度更新。也就是说 $J_\alpha$ 一样大，但气体温度被抬高，自旋温度与气体温度的分岔位置随之改变——同一条源谱折出来的两个观测量因此被解耦。

#### USE_MINI_HALOS

迷你晕总开关。打开后这一段循环多算两支：第 3 族谱对 $J_\alpha$ 的贡献，以及莱曼-维尔纳通量（供迷你晕的自屏蔽反馈）。$J_\alpha$ 因此多一份来自迷你晕的份额，权重的另一半——由 `F_STAR7_MINI` 与反馈强度决定——也在这条支上。关掉它时，`sum_*_MINI` 那几支完全不参与，`POP3_ION` 与 `F_H2_SHIELD` 都失去作用面。

## x_α · Ly-α 耦合系数

### 物理

莱曼-$\alpha$ 耦合系数把 Wouthuysen–Field 效应折成一个无量纲的耦合强度：由背景强度乘上跃迁的振子强度与光子温度给出的系数得到，中间还带一个散射不完全热化的修正——把散射色温与气体温度的差别折进去。

公式是一个乘积，前面的系数由原子常数与光子温度定死，可调的只有背景强度与色温修正；前提是散射达到统计平衡、色温能用一个有效值代表，而这个有效值本身又依赖自旋温度，所以这一条要迭代求解。它与碰撞耦合一起进自旋温度那本账，两者相加后与光子项做调和加权。

红移较高时碰撞主导，中间一段莱曼-$\alpha$ 主导，而这一段的宽度与位置决定了自旋温度跟随气体温度的早晚。局限在它假定莱曼-$\alpha$ 光子只在本地散射、输运被抹平——真实的多次散射会改色温，这一步用修正项近似它。

$$x_\alpha=\frac{16\pi^{2}\\,T_\star\\,f_{12}}{27\\,A_{10}\\,T_\gamma}\\,S_\alpha\\,J_\alpha(z)$$

### 代码解析

快速求解里它分两步：先按背景强度与一个含光子温度、气体温度之比的因子算出未修正的值——那个三次多项式因子就是散射不完全热化的整体形状；再在迭代里乘上一个只依赖 $1/T_K$ 与 $1/T_S$ 的修正，把色温与气体温度的差别折进去。

修正项里出现 $T_S$，正是迭代存在的原因：耦合依赖自旋温度，自旋温度又依赖耦合。收敛判据是相对变化小于千分之一；背景强度低于阈值时整个循环被跳过，只留碰撞那一支——那时不再需要自洽，因为色温项不起作用。

### 工程

- `src/py21cmfast/src/SpinTemperatureBox.c:1332-1346`——先算"不含热化修正"的主项 `xa_tilde_fast_arg`（原子常数因子乘 $J_\alpha$，再除以 $\xi$ 的多项式），然后在自旋温度的迭代里逐步乘上温度相关的四个系数。

```c
    xa_tilde_fast_arg = consts->xa_tilde_prefactor * J_alpha_tot *
                        pow(1.0 + 2.98394 * xi_power + 1.53583 * xi_power * xi_power +
                                3.85289 * xi_power * xi_power * xi_power,
                            -1.);

    if (J_alpha_tot > 1.0e-20) {  // Must use WF effect
        TS_fast = consts->Trad;
        TSold_fast = 0.0;
        while (fabs(TS_fast - TSold_fast) / TS_fast > 1.0e-3) {
            TSold_fast = TS_fast;

            xa_tilde_fast =
                (1.0 - 0.0631789 * T_inv + 0.115995 * T_inv_sq -
                 0.401403 * T_inv * pow(TS_fast, -1.) + 0.336463 * T_inv_sq * pow(TS_fast, -1.)) *
                xa_tilde_fast_arg;
```

`consts->xa_tilde_prefactor` 就是公式前面那一串 $16\pi^{2}T_\star f_{12}/(27A_{10}T_\gamma)$：常数表在初始化时把原子量算好，因此这里只剩一次乘法。乘上 `J_alpha_tot` 之后并不是最终结果，还要除以 `1 + 2.98394·ξ + 1.53583·ξ² + 3.85289·ξ³`——这个三阶多项式是公式里那个 $S_\alpha$ 在代码里的形态，$\xi$ 由局域密度、中性氢份额与气体温度合成（上一段 `xi_power` 那行），所以"散射不完全热化"在这里被写成一个只依赖 $\xi$ 的平台型衰减因子，而不是论文里那个通用写法。

真正的 $x_\alpha$ 是 `xa_tilde_fast`，它与 `xa_tilde_fast_arg` 差一个乘数：循环体里那四个系数（`0.0631789`、`0.115995`、`0.401403`、`0.336463`）分别挂着 $T_K^{-1}$、$T_K^{-2}$ 与它们和 $T_S^{-1}$ 的组合，随温度与自旋温度变化。这也解释了为什么它必须放在自旋温度的迭代循环里：`xa_tilde_fast` 依赖 $T_S$，而 $T_S$ 又依赖 `xa_tilde_fast`，两者一步套一步，只能迭代到相对变化小于 `1e-3`。

阈值 `J_alpha_tot > 1.0e-20` 决定的不是精度而是分支：背景弱到这个量级以下时 $x_\alpha$ 被当作 0，自旋温度退化成只有光子项与碰撞项的闭合式。高红移格点普遍走这一支，既省迭代，也避免在完全没有莱曼-$\alpha$ 源的格点上反复乘一个接近零的数。

- 输入：$J_\alpha$、$T_K$、$T_s$ 与 $T_\gamma$；上游为 jalpha 与 tgamma
- 产出：Ly-$\alpha$ 耦合系数 $x_\alpha$（含色温 $T_c$）

### 参数语境

#### F_H2_SHIELD

分子氢自屏蔽因子（默认 0.0，即不屏蔽）。本页的乘积里没有任何位置放它，它通过源那一侧绕进来：屏蔽因子压低莱曼-维尔纳通量，改变迷你晕的恒星形成率，$J_\alpha$ 的幅度随之变化——因为 $x_\alpha$ 与 $J_\alpha$ 成正比，这条链上的每一个源侧参数最终都以整体缩放的形式落在 $x_\alpha$ 上。

#### N_STEP_TS

自旋温度演化的层数（默认 40）。$J_\alpha$、$T_K$、$x_c$ 与 $x_\alpha$ 都是在这套红移层上依次算出来的，层数改的是它们之间的同步精度：层太稀，$x_\alpha$ 用的背景强度与温度可能来自相邻的一段历史，耦合起来的时刻就被抹开。它不动代数式，只动分辨率。

#### POP2_ION

第二代恒星每重子的电离光子数（默认 5000）。它定的是星谱的归一（见莱曼-$\alpha$ 背景那页的 `spectral_emissivity`），$J_\alpha$ 随之整体缩放，$x_\alpha$ 因为正比关系也跟着缩放。结果是自旋温度从"被光子温度钉住"过渡到"被气体温度钉住"的那段红移整体前移或后移——幅度参数在信号上的表现就是一个时间平移。

#### POP3_ION

第三族（迷你晕）对应的同一个量（默认 44021）。只在打开 `USE_MINI_HALOS` 时有作用面：那时 $J_\alpha$ 里多一份迷你晕的份额，$x_\alpha$ 的幅度也随之多一份。关掉迷你晕时调它不产生任何效果。

#### USE_LYA_HEATING

打开时才有莱曼-$\alpha$ 加热（气体温度更新里多出 `eps_Lya_cont` 与 `eps_Lya_inj` 两项）。$x_\alpha$ 的数值不受它影响，但它改变了 $x_\alpha$ 与 $x_c$ 竞争的那个背景：气体被加热后碰撞耦合的幅度与自旋温度的位置都会移，于是同一个 $x_\alpha$ 折出来的亮温不同。这是本仓里"耦合强度"与"加热"两条通路互相纠缠的地方。

#### USE_MINI_HALOS

迷你晕总开关。打开后 $J_\alpha$ 多一支第 3 族谱的贡献（$x_\alpha$ 增大），但影响不止于此：迷你晕把电离历史整体推早，而 $\xi$ 里含中性氢份额，$S_\alpha$ 那个修正多项式因此也跟着变。所以这个开关对 $x_\alpha$ 的作用同时走"幅度"与"修正因子"两条路。

## x_c · 碰撞耦合系数

### 物理

碰撞耦合系数是碰撞激发率与自发跃迁率之比：它是自旋温度与气体温度之间的第三条通道，不需光子参与，靠氢原子之间、原子与电子、原子与质子的碰撞直接翻转自旋。数值上它由各条碰撞道的数密度乘各自的速率再除以自发跃迁率给出。

公式是一个比值：分子是三条碰撞道贡献之和，分母是自发跃迁率；中性氢、电子与质子三条道各按自己的数密度与温度决定的碰撞率进入。前提是碰撞率取热平衡下的拟合值、且气体被视为单一温度——非热速度分布与激波不在这里。它只依赖气体温度与各类粒子的数密度，因此在气体密度高、温度低的地方最强。

它随红移演化完全由密度与温度决定：宇宙膨胀使密度按三次方下降、温度按绝热冷却下降，两者一起让碰撞耦合很快退居次要。它对密度扰动是线性放大的——同样温度下密度高的格点耦合更强，因此它在低红移的空腔区几乎消失、在过密区还能留住一些。

数学上它是局域、无记忆的代数式，对密度与碰撞率是乘积关系；它与莱曼-$\alpha$ 耦合在自旋温度里是相加的，两者彼此竞争也彼此简并——在信号里都表现为自旋温度被拉向气体温度。它与气体温度非线性耦合：碰撞率对温度是幂律，所以温度一改，耦合强度会跟着改。

它与莱曼-$\alpha$ 耦合一起把自旋温度从光子温度上拉下来，是宇宙黎明早期耦合的唯一通道。局限在它只计入三条熟知的碰撞道、碰撞率取拟合值，且不区分自旋态的非平衡分布——这些在高精度比对时要另作修正。

$$x_c=\frac{T_{21}}{T_\gamma}\\,\frac{n_{\rm HI}\kappa_{\rm HI}+n_e\kappa_e+n_p\kappa_p}{A_{10}}$$

### 代码解析

快速求解里它就是一行：密度扰动因子、一个预先算好的倒数系数，与三条道相乘后相加。三条道的数密度都从电离度换算——中性氢走 $1-x_e$，电子与质子走 $x_e$——所以这一行同时把电离历史带进了碰撞耦合：电离越彻底，中性氢那一条越弱，碰撞耦合整体越小。

预先算好的那个系数把 $T_{21}/(T_\gamma A_{10})$ 这类常数合在一起，每快照算一次即可；碰撞率本身是温度的函数，靠原子物理的拟合调用。老代码路径另有一个按同一公式写成的函数，两者给的量一致，只是入口不同。

### 工程

- `src/py21cmfast/src/SpinTemperatureBox.c:1326-1328`——碰撞耦合的闭式：三条碰撞道各按数密度加权后求和，再乘上密度扰动因子与常数表里预先算好的逆因子。

```c
    xc_fast = (1.0 + rad->delta) * consts->xc_inverse *
              ((1.0 - x_e) * No * kappa_10(Tk, 0) + x_e * N_b0 * kappa_10_elec(Tk, 0) +
               x_e * No * kappa_10_pH(Tk, 0));
```

括号里三个乘积就是公式分子上的三条道，各自对应一类碰撞体：中性氢按 `(1-x_e) * No`、电子按 `x_e * N_b0`、质子按 `x_e * No`（`N_b0` 是电子数密度的基准值，与 `No` 的区别在氦的贡献上）。`kappa_10`、`kappa_10_elec`、`kappa_10_pH` 都是查表率的函数，进去的是当前气体温度——所以三条道对温度的依赖不同，温度一动，它们的相对权重就变。

`consts->xc_inverse` 把公式里剩下的常数（$T_{21}/T_\gamma$ 与 $A_{10}$）合成一个因子在初始化时算好，逐格点重复的只留乘法；`(1.0 + rad->delta)` 是局域密度扰动因子，把"过密区碰撞更频繁"这一条显式写出来。整式没有任何迭代或积分，逐格点算完就是答案，这也意味着它必然跟着温度与电离度的当前值走——温度更新一改，这里下一层就变。

与 $J_\alpha$ 那一路的关系在自旋温度那一步合上：两者相加后与光子项做调和加权（`SpinTemperatureBox.c:1348-1356`），谁大就把自旋温度往谁的对应温度上拉。在代码里它们甚至是在同一段里被算出来的（`xc_fast` 与 `xa_tilde_fast_arg` 之间只隔几行），共享同一个 `T_inv` 与 `rad->delta`。

- 输入：$T_K$、$T_\gamma$、$n_{\rm HI}$、$n_e$、$n_p$ 与碰撞率；上游为 tk
- 产出：碰撞耦合系数 $x_c$

### 参数语境

#### CLUMPING_FACTOR

亚网格团簇因子（默认 2.0）。它不在上面这段式子里，乘在同文件的复合率上（`SpinTemperatureBox.c:1220`）。对碰撞耦合的作用绕经电离度：复合被加强后残留电子分数降低，`(1.0 - x_e)` 变大而 `x_e` 变小，于是氢原子那道碰撞加强、电子与质子两道减弱，净效果通常是把 $x_c$ 抬一点。

#### USE_CMB_HEATING

打开时气体温度更新里多一项 CMB 加热（默认即打开）。$x_c$ 通过温度感知：三条碰撞率都是温度的查表函数，且方向不同，所以气体被加热以后三条道的相对权重跟着挪——这也是"温度一动、耦合跟着动"那句在代码里的落点。

#### USE_LYA_HEATING

莱曼-$\alpha$ 加热的开关（默认打开），作用路径与 CMB 加热相同：它只改气体温度，$x_c$ 再经碰撞率随之变。它对 $x_c$ 的影响一般比不过它直接对 $\varepsilon_{\rm heat}$ 与自旋温度那一步的影响。

#### USE_MINI_HALOS

迷你晕总开关（默认关闭）。它不在这段式子里，而是换掉源侧的整条谱，从而改电离历史与气体温度：前者动 `x_e`（三条道的权重），后者动碰撞率。也就是说 $x_c$ 是被间接推动的，幅度通常小于它对 $J_\alpha$ 的影响。

#### USE_X_RAY_HEATING

X 射线加热的开关（默认打开）。打开时气体温度在绝热降温见底后被抬起来，碰撞率随之增大，$x_c$ 在低红移不会衰减到可以忽略；关掉它，$x_c$ 就纯粹由绝热冷却后的低温与残余电子密度决定，莱曼-$\alpha$ 会更早接管自旋温度。

## T_S(z) · 自旋温度

### 物理

自旋温度由三处耦合竞争给出：光子温度、莱曼-$\alpha$ 散射的色温、气体温度各按自己的耦合系数加权，加权形式是调和平均——系数越大，自旋温度越被拉向对应的那个温度。它是 21 厘米亮温公式里唯一需要自洽解出来的量，也是整条链的终点。

公式把三个温度按耦合系数做加权调和平均；前提是自旋态与三个热源都达到统计平衡，而色温与莱曼-$\alpha$ 耦合本身又依赖自旋温度，所以要迭代到收敛。红移较高、密度较大时碰撞耦合主导；莱曼-$\alpha$ 背景起来后它接管；两者都弱时康普顿散射把自旋温度钉在光子温度上，亮温趋于零。

三种极限都能从它读出：只有康普顿散射时自旋温度等于光子温度，信号为零；莱曼-$\alpha$ 耦合足够强时自旋温度等于气体温度，发射或吸收最强；中间过渡里自旋温度介于两者之间，决定了亮温随红移的整条曲线形状。耦合系数都由上游给出，自旋温度本身则是逐格点、逐红移迭代的局域量。

数学上它是隐式方程——右边的色温与耦合都含自旋温度，只能迭代，且对输入非线性响应：气体温度微调、或者莱曼-$\alpha$ 背景跨过一个阈值，曲线的拐点位置就会明显移动。它对气体温度与光子温度的依赖方式不同，因此两者之间的差——也就是信号的正负与幅度——在这本账里被放得很大。

它交给亮温公式，与气体温度、电离度一起给出 21 厘米信号；链条到此结束，观测侧的亮温把它折成实际的观测温度。局限在平衡假设：自旋态的非平衡分布、莱曼-$\alpha$ 的多次散射与 X 射线对自旋的直接扰动都不在这套三温度加权里，只能靠上游的有效修正项近似。

$$T_S^{-1}=\frac{T_\gamma^{-1}+x_\alpha\\,T_\alpha^{-1}+x_c\\,T_K^{-1}}{1+x_\alpha+x_c}$$

### 代码解析

快速求解与正文那条调和平均式逐项对应：分子是三个耦合系数之和，分母里光子项用预存的温度倒数、气体项用 $1/T_K$、莱曼-$\alpha$ 项则由一个含 $1/T_K$ 与 $1/T_S$ 的多项式代替色温倒数。前一步先更新耦合、后一步更新自旋温度，两步交替到相对变化小于千分之一。

背景强度低于阈值时不需要迭代：那时只有光子与碰撞两项，一遍算完——因为不再有未知的色温项进来。这正是"两者都弱时康普顿把自旋温度钉在光子温度上"的代码形态：分子分母里只剩光子与碰撞，解出来自然趋向光子温度。

旧代码路径（`heating_helper_progs.c` 的 `get_Ts`）用显式色温函数与同一套加权做同样的事，并把算出来的耦合回传供调用方使用。两条路解的是同一个方程，差别只在色温用多项式拟合还是用显式函数，比对新旧版本时它们本该一致。

### 工程

- `src/py21cmfast/src/SpinTemperatureBox.c:1348-1356`——自旋温度的迭代更新：`xa_tilde_fast` 由多项式给出，代入调和平均式后用相对变化小于 `1e-3` 判收敛；没有莱曼-$\alpha$ 背景时走只含碰撞项的两项闭合式。

```c
            TS_fast = (xCMB + xa_tilde_fast + xc_fast) *
                      pow(xCMB * consts->Trad_inv +
                              xa_tilde_fast * (T_inv + 0.405535 * T_inv * pow(TS_fast, -1.) -
                                               0.405535 * T_inv_sq) +
                              xc_fast * T_inv,
                          -1.);
        }
    } else {  // Collisions only
        TS_fast = (xCMB + xc_fast) / (xCMB * consts->Trad_inv + xc_fast * T_inv);
```

上一节那个公式在这里被写成"左右两边都含 $T_S$"的隐式形式：等式右边括号里的第二项带着 $T_S^{-1}$ 与 $T_S^{-2}$（系数 `0.405535` 是把色温与自旋温度之间的换算展开后留下的常数），所以每次代入都要重算，代码用 `while` 迭代到相对变化小于 `1e-3` 为止。`xCMB` 是光子温度那一项的权重，`consts->Trad_inv` 是光子温度的倒数——两者成对出现，对应公式里的 $T_\gamma^{-1}$。

`else` 那一支是同一公式的退化情形：莱曼-$\alpha$ 背景弱到阈值（`J_alpha_tot > 1.0e-20`）以下时 $x_\alpha=0$，加权式退化成只有光子与碰撞两项的和式，不必迭代就有解析解。这一支在高红移很常见，省下的迭代量是实打实的。阈值 `1e-20` 是代码约定：比这更小的 $J_\alpha$ 视为零，避免在完全没有源的格点上空转。

#### get_Ts

- `src/py21cmfast/src/heating_helper_progs.c:725-741`——先取碰撞耦合 `xc`；有 Ly-alpha（`J_alpha > 1e-20`）时对 `TS = (1 + xa_tilde + xc) / (1/Trad + xa_tilde/Tceff + xc/TK)` 迭代到相对变化小于 `1e-3`，并把 `xa_tilde` 回传；否则只留碰撞项。

```c
    Trad = physconst.T_cmb * (1.0 + z);
    xc = xcoll(z, TK, delta, xe);
    if (Jalpha > 1.0e-20) {  // * Must use WF effect * //
        TS = Trad;
        // TODO: changed to do-while so we never use uninitialised variables
        //       Make sure it didn't effect anything
        do {
            TSold = TS;
            xa_tilde = xalpha_tilde(z, Jalpha, TK, TS, delta, xe);
            Tceff = Tc_eff(1. / TK, 1. / TS);
            TS = (1.0 + xa_tilde + xc) / (1.0 / Trad + xa_tilde / Tceff + xc / TK);
        } while (fabs(TS - TSold) / TS > 1.0e-3);
        *curr_xalpha = xa_tilde;
    } else {  // * Collisions only * //
        TS = (1.0 + xc) / (1.0 / Trad + xc / TK);
        *curr_xalpha = 0;
    }
```

这是同一方程的慢速版，也是可以逐字对上物理公式的版本：迭代体里每一步都显式地调 `xalpha_tilde`（色温相关的那部分耦合）与 `Tc_eff`（莱曼-$\alpha$ 有效色温），再代入三温度调和平均式。它比 `get_Ts_fast` 贵在每次迭代要做几次函数调用与幂运算，换来的是不用担心拟合区间——分析用途或核对快速版时用它。

两个版本共用同一个收敛判据 `fabs(TS - TSold) / TS > 1.0e-3`，也共用同一个退化分支：没有莱曼-$\alpha$ 背景时就只剩碰撞项。回传 `*curr_xalpha` 是给调用者留账：自旋温度算出来的同时把当时用的 $x_\alpha$ 一并交出去，下游做诊断时不必重算。文件里留着的 `TODO` 说明这段原来可能读到未初始化的变量，改成先给 `TS = Trad` 再进入循环，注释要求改动后结果不受影响——初值取光子温度是"从最保守的一头开始迭代"的意思。

#### get_Ts_fast

- `src/py21cmfast/src/SpinTemperatureBox.c:1337-1356`——同一方程的快速解：用 `xi = Trad/TK` 的多项式拟合代替 `Tceff` 与 `xa_tilde`，同样迭代到 `1e-3`；`J_alpha` 很小时退化为碰撞项的解析式。

```c
    if (J_alpha_tot > 1.0e-20) {  // Must use WF effect
        TS_fast = consts->Trad;
        TSold_fast = 0.0;
        while (fabs(TS_fast - TSold_fast) / TS_fast > 1.0e-3) {
            TSold_fast = TS_fast;

            xa_tilde_fast =
                (1.0 - 0.0631789 * T_inv + 0.115995 * T_inv_sq -
                 0.401403 * T_inv * pow(TS_fast, -1.) + 0.336463 * T_inv_sq * pow(TS_fast, -1.)) *
                xa_tilde_fast_arg;

            TS_fast = (xCMB + xa_tilde_fast + xc_fast) * pow(xCMB * consts->Trad_inv +
                              xa_tilde_fast * (T_inv + 0.405535 * T_inv * pow(TS_fast, -1.) -
                                               0.405535 * T_inv_sq) +
                              xc_fast * T_inv,
                          -1.);
        }
    } else {  // Collisions only
        TS_fast = (xCMB + xc_fast) / (xCMB * consts->Trad_inv + xc_fast * T_inv);
```

快速版把"色温"整条支线折叠成 $x_\alpha$ 上的一个修正因子：`xa_tilde_fast_arg` 是上一轮算好的主项，括号里那四个系数（`0.0631789`、`0.115995`、`0.401403`、`0.336463`）按 $T_K^{-1}$、$T_K^{-2}$ 与 $T_S^{-1}$ 的组合展开，等价于把 `xalpha_tilde` 与 `Tc_eff` 两步合成一次多项式求值。代价是只在拟合区间内可信，收益是每个格点每层少掉两个函数调用——它被用在逐格点演化的主循环里，正是为这个理由。

`0.405535` 这个常数在快速版与慢速版里出现的是同一个位置（色温到自旋温度的换算项），两版对得上；`TS_fast` 的初值同样取 `consts->Trad`，收敛判据同样按相对变化 `1e-3`。区别只在 `while` 与 `do-while` 的写法：这里用 `while` 并把 `TSold_fast` 预置为 `0.0`，保证第一轮一定进循环。

#### xcoll_HI

- `src/py21cmfast/src/heating_helper_progs.c:679-683`——氢原子的碰撞耦合系数 `x_c^HI`：中性氢数密度 `(1-xe) · nH · (1+z)^3 · (1+delta)` 乘 `kappa_10(TK)` 的自旋交换率，再乘 `T_21/Trad/A10` 化成无量纲的耦合。

```c
    Trad = physconst.T_cmb * (1.0 + z);
    nH = (1.0 - xe) * No * pow(1.0 + z, 3.0) * (1.0 + delta);
    krate = kappa_10(TK, 0);
    xcoll = physconst.T_21 / Trad * nH * krate / physconst.A10;
    return xcoll;
```

碰撞耦合就是"碰撞把自旋态翻过来的速率"与"自发跃迁速率"之比：`kappa_10(TK)` 是温度相关的自旋交换率（查表得到，第二个参数 `0` 表示氢原子），乘上中性氢数密度得到单位时间的碰撞率，再除以爱因斯坦系数 `A10`（`physconst.A10`）得到无量纲的 $x_c$；前面的 `T_21 / Trad` 来自 21 厘米跃迁与背景光子温度之比，是公式里那个系数在代码里的形态。

密度按 `No * (1+z)^3 * (1+delta)` 算，`No` 是今天的氢数密度、`(1+delta)` 是局域过密或欠密——这一项让碰撞耦合逐格点不同，也是密度扰动进入自旋温度的主要通道。`(1.0 - xe)` 把已经被电离掉的那部分气体扣除：电离场上来的 $x_e$ 越大，中性氢越少，碰撞耦合越弱，自旋温度就越早交给莱曼-$\alpha$。

- 输入：$T_\gamma$、$x_\alpha$、$x_c$、$T_K$ 与 $v_{cb}$；上游为 tgamma、xalpha、xc、tk
- 产出：自旋温度 $T_s(z)$

### 参数语境

#### CLUMPING_FACTOR

亚网格团簇因子（默认 2.0，即按两倍团聚算复合）。它不在这段温度更新里，出现在同一文件的电离汇项上（`SpinTemperatureBox.c:1220` 的 `dxion_sink_dt`，与 $\alpha_A(T_K)$、`prev_xe` 相乘），代表网格分辨不出来的小尺度团聚对复合的额外加成。对自旋温度的作用是绕一圈的：复合被加强 → 残留电子分数压低 → 碰撞耦合的密度因子变小 → 自旋温度更早脱离光子温度。扫描里把它调大，高红移那一段的自旋温度会偏高。

#### USE_CMB_HEATING

打开时温度更新里才会多出 `dCMBheat_dzp` 那一项（`SpinTemperatureBox.c:1248` 是它的开关处），也就是把 CMB 加热计入气体升温。自旋温度是通过 $T_K$ 感知这件事的：气体被抬高，三温度加权里的 $T_K^{-1}$ 变小，自旋温度在莱曼-$\alpha$ 起来了之后不会再被压得太低。它主要改的是复合之前那段曲线的形状。

#### USE_LYA_HEATING

打开时才有莱曼-$\alpha$ 加热：造表阶段多出 `eps_Lya_cont` 与 `eps_Lya_inj` 两项（`SpinTemperatureBox.c:156-175` 建表、`252-260` 取用），温度更新里把它们与其余项一起累加。关掉时气体只靠 X 射线与康普顿撑温度，黎明段的自旋温度会偏低，吸收信号偏深。它与 `USE_X_RAY_HEATING` 并列，是两条外来加热通道各自的开关。

#### USE_MINI_HALOS

迷你晕总开关。它换掉源那一侧的整条谱（第四代恒星的恒星形成率、莱曼-维尔纳反馈、`F_STAR7_MINI`），因此同时改 $J_\alpha$ 与 $T_K$：前者进 $x_\alpha$、后者进三温度加权的权重。在自旋温度这一层看到的结果是权重的强弱变化，不是公式本身变样。

#### USE_X_RAY_HEATING

X 射线加热的总开关（`SpinTemperatureBox.c:150`、`267`、`1242`、`1536`、`1703` 都按它分支）。打开时 `dxheat_dzp` 参与温度更新，气体在绝热降温见底之后被重新抬起来，自旋温度跟着脱离光子温度，21 厘米信号才会由吸收翻成发射。关掉它，这条链上就没有任何机制把气体重新加热，亮温曲线在高红移之后几乎是一条平线。

## 参数

本模块携带 24 个参数（与画布上这块的「参数」卡同一份清单；类别是 `inputs.py` 里的结构名）。下面逐条写它在代码里做什么；同一个参数**在某个成员那一步里**的语境与落点，写在那个成员节的「参数语境」里。

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `F_ESC10` | `AstroParams` | 逃逸分数（默认 -1.0，log10）。它不进 X 射线光度那一项——X 射线源强由 `L_X` 直接乘恒星形成率给出——对加热率的作用是绕经电离历史的：逃逸分数越大，气体被电离得越彻底，中性氢份额越低，`(1-x_e)` 因子与吸收光程都跟着变。 |
| `F_ESC7_MINI` | `AstroParams` | 迷你晕支的逃逸分数（默认 -2.0）。只在打开 `USE_MINI_HALOS` 时有作用面：那时第 3 族源的 X 射线与电离光子都按它缩放；关掉迷你晕时它不参与任何计算。 |
| `F_STAR10` | `AstroParams` | 恒星形成效率（默认 -1.3，log10），是这一块最直接的杠杆：`xray_sfr` 正比于恒星形成率密度，而这个密度由它定，于是改它等于把加热曲线整段抬高或压低，加热开始生效的红移也跟着前后挪。 |
| `F_STAR7_MINI` | `AstroParams` | 迷你晕的恒星形成效率。打开迷你晕时 X 射线源多一支（`sfr_term_mini * L_X_MINI`，`SpinTemperatureBox.c:1694`），这一支的幅度由它定；它与 `F_STAR10` 是同一件事在两个质量段上的取值，两条支的叠加才是总的 X 射线源。 |
| `HII_EFF_FACTOR` | `AstroParams` | 综合电离效率（默认 30.0）。公式里那个 `(1-x_e)` 因子由它决定：调大它，同样的源把气体电离得更彻底，留给加热的能量按比例减少。在 `SOURCE_MODEL == 0` 那条路上它是唯一的电离效率参数；在分项参数化的路子上，它与 `POP2_ION`、`F_ESC10`、`F_STAR10` 的乘积等效（`heating_helper_progs.c:989` 的 `ion_eff`）。 |
| `INTEGRATION_METHOD_ATOMIC` | `AstroOptions` | 原子晕条件质量函数的积分方法（取值是几种求积法的名字，默认 `GAUSS-LEGENDRE`）。它决定恒星形成率密度怎么积出来，因此决定进 `xray_sfr` 的那个数；换方法只带来小的数值差异，物理不变。 |
| `INTEGRATION_METHOD_MINI` | `AstroOptions` | 同上，管迷你晕那一支的积分。开迷你晕时两支积分法各自生效（可以取不同方法），关掉时它不参与。 |
| `NU_X_BAND_MAX` | `AstroParams` | X 射线波段的能量上界（默认 2000 eV）：谱的归一化积分积到它为止（`SpinTemperatureBox.c:1096-1105`），也就是超过这个能量的光子不计入「每单位光度折出多少光子」这一步。调大它等于把高能尾巴纳进归一化，源强的含义随之变。 |
| `NU_X_MAX` | `AstroParams` | 整条 X 射线谱的截断能量（默认 10000 eV）：沉积份额的数值积分上界（`heating_helper_progs.c:843-849`）。它与 `NU_X_BAND_MAX` 是两件事——前者管谱积到多高，后者管归一化窗口开多宽。 |
| `NU_X_THRESH` | `AstroParams` | 能量下限，同时也是谱的归一化能量（默认 500 eV）：光子能量低于它的 X 射线不算进这条加热积分（`SpinTemperatureBox.c:832-836`、`1107-1121` 的换算都以它作基准）。调高它等于把软 X 射线从加热账上划掉——软光子穿透差、多在本地被吸收，所以这是一个近似的选择。 |
| `N_STEP_TS` | `AstroParams` | 自旋温度演化的层数（默认 40），同时是滤波半径的分档数（`R_factor = pow(R_MAX_TS / R, 1/N_STEP_TS)`，`SpinTemperatureBox.c:330`）与红移方向的数组长度（`zpp_for_evolve_list`，`120-124`）。它决定加热率在多少张半径层上与源卷积：层数少则半径方向的分辨变粗，加热率的空间对比被抹平，历史积分也会在曲线上留下阶梯。 |
| `OMb` | `CosmoParams` | 重子密度，定氢核数密度 `No`。加热率正比于气体数密度，因此它整体缩放加热率；与 `hlittle` 一起进这个组合（`No ∝ OMb h^2`）。 |
| `POP2_ION` | `AstroParams` | 每重子的电离光子数（默认 5000）。它不在加热率的式子里，而在源侧与 `F_STAR10`、`F_ESC10` 一起组成电离效率（初始化时把整张星谱的 `N0_2` 系数乘上它，`heating_helper_progs.c:326-332`），因此它改的是电离历史；加热率只经 `(1-x_e)` 与吸收光程受它影响。光子本身的能量来源仍是 `L_X`，这条界线在扫描里要分清：调它动的是电离，不是注入能量。 |
| `POP3_ION` | `AstroParams` | 迷你晕支的同一个量（默认 44021）。作用路径与 `POP2_ION` 相同，作用面只在打开迷你晕时存在。 |
| `R_MAX_TS` | `AstroParams` | 自旋温度场的滤波半径上界（默认 500 Mpc）。源盒按从小到 `R_MAX_TS` 的半径层逐级滤波，加热率就是这些层上的源按光程权重叠出来的；超出这个尺度的源被当成平均背景，不再贡献空间对比。 |
| `USE_LYA_HEATING` | `AstroOptions` | 莱曼-$\alpha$ 加热的开关（默认打开）。它与 X 射线加热并列，是外来加热的另一条通道：打开时温度更新里多出 `eps_Lya_cont`、`eps_Lya_inj` 两项（`SpinTemperatureBox.c:156-175` 建表、`252-260` 取用），关掉它，X 射线就成了唯一的热源，黎明段的自旋温度会低一截。 |
| `USE_MINI_HALOS` | `AstroOptions` | 迷你晕（第三代恒星）总开关（默认关闭）。打开后 X 射线源多一支（经 `L_X_MINI`），$J_\alpha$ 也多一份第 3 族谱的贡献，加热率的幅度与空间分布都变；关掉时 `F_STAR7_MINI`、`L_X_MINI`、`F_ESC7_MINI`、`POP3_ION`、`F_H2_SHIELD` 在这一条链上全部失去作用面。 |
| `USE_X_RAY_HEATING` | `AstroOptions` | 这一块的总开关（默认打开）。只有它为真，`dxheat_dt_box` 才累加（`SpinTemperatureBox.c:1703-1707`）；关掉它，本块的产出恒为零，气体温度只剩绝热降温与康普顿交换两项可用，亮温曲线在高红移之后几乎是一条平线。 |
| `X_RAY_SPEC_INDEX` | `AstroParams` | X 射线谱的幂律指数（默认 1.0）。它决定能量按频率怎么摊，也决定代码走哪条归一化分支：等于 1.0 时有专门写好的解析式（用对数差，`SpinTemperatureBox.c:1094-1098`），否则用幂律差（`1101-1104`）；谱强度本身也按 `nu^{-index}` 缩放（`heating_helper_progs.c:774-775`）。指数越小谱越硬，高能光子越多，沉积位置越深、空间分布越平滑。 |
| `Y_He` | `CosmoParams` | 氦丰度。它进总粒子数 `n_tot`（温度更新的分母）与电子数密度：加热率给的是单位体积的能量，折成温升要除以粒子数，氦多了同样的能量摊到更多粒子上，温度抬升变小；它同时改 `N_b0` 与中性氢的数密度口径。 |
| `hlittle` | `CosmoParams` | 无量纲哈勃常数。它与 `OMb` 一起定数密度（`No ∝ OMb h^2`），又出现在积分权重里的 `H(z)` 与光程上；两个作用方向不同，所以它对加热率曲线的影响不是单纯的整体缩放。 |
| `F_H2_SHIELD` | `AstroParams` | 分子氢自屏蔽因子（默认 0.0，即不屏蔽）。它以 `(1. - F_H2_SHIELD)` 的权重只乘在莱曼-维尔纳通量上（`SpinTemperatureBox.c:410-430`，源码注释标明这个因子是挪到外面乘的），不进 $J_\alpha$ 的求和；对 $J_\alpha$ 的影响是间接的——LW 通量决定迷你晕的恒星形成率，源一动，$J_\alpha$ 跟着动。扫描里它是迷你晕那一支的反馈强度旋钮。 |
| `CLUMPING_FACTOR` | `AstroParams` | 亚网格团簇因子（默认 2.0）。它不在温度式子里，乘在同一文件的复合率上（`dxion_sink_dt`，`SpinTemperatureBox.c:1220`），代表网格分辨不出来的小尺度团聚对复合的额外加成。对自旋温度的作用是绕一圈的：复合被加强 → 残留电子分数压低 → 碰撞耦合的密度因子变小 → 自旋温度更早脱离光子温度。 |
| `USE_CMB_HEATING` | `AstroOptions` | CMB 加热的开关（默认打开）。打开时温度更新里多出 `dCMBheat_dzp` 那一项（开关处 `SpinTemperatureBox.c:1248`）；气体被抬高之后，三温度加权里的 $T_K^{-1}$ 变小，自旋温度在莱曼-$\alpha$ 起来之后不会再被压得太低。它主要改的是复合之前那段曲线的形状。 |

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**ε_heat(z) · X 射线加热率**

- 论文节号：§3.4 加热与电离（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

**T_K(z) · 气体动力学温度**

- 论文节号：§3.4（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| A 型氢复合系数 $\alpha_A(T)$ 的九阶多项式拟合 | Abel et al. 1997 | returns the case A hydrogen recombination coefficient (Abel et al. 1997) in cm^3 s^-1 | `src/py21cmfast/src/thermochem.c:66-66`（`thermochem.h:14` 同句） | 无正文（本地只有代码注释与 docstring） |
| B 型氢复合系数 $\alpha_B(T)$ | Spitzer 1978 | returns the case B hydrogen recombination coefficient (Spitzer 1978) in cm^3 s^-1 | `src/py21cmfast/src/thermochem.c:78-78`（`thermochem.h:16` 同句） | 无正文（本地只有代码注释与 docstring） |
| He I 电离截面 | Verner et al. 1996 | function HeI_ion_crosssec returns the HI ionization cross section at parameter frequency (taken from Verner et al (1996) | `src/py21cmfast/src/thermochem.c:113-114` | 无正文（本地只有代码注释与 docstring） |
| 再电离反馈 | Sobacchi & Mesinger 2013 | For reionization_feedback, reference Sobacchi & Mesinger 2013 | `src/py21cmfast/src/thermochem.c:21-21` | 无正文（本地只有代码注释与 docstring） |
| 演化电离盒方程的复合项 | McQuinn 2015（Eq. 6） | evolving ionized box eq. 6 of McQuinn 2015, ignored the dependency of density at ionization | `src/py21cmfast/src/thermochem.c:44-45` | 无正文（本地只有代码注释与 docstring） |
| CMB 加热率 | Meiksin et al. 2021 | Meiksin et al. 2021 | `src/py21cmfast/src/SpinTemperatureBox.c:1249-1249` | 无正文（本地只有代码注释与 docstring） |
| CMB 加热的正确表达式 | Meiksin 2021（arXiv:2105.14516, Eq. 4） | Whether to include CMB heating. (cf Eq.4 of Meiksin 2021, arxiv.org/abs/2105.14516) | `src/py21cmfast/wrapper/inputs.py:1026-1026` | 无正文（本地只有代码注释与 docstring） |
| Ly-α 加热的开关与出处 | Reis+2021（Sec. 3, DOI:10.1093/mnras/stab2089） | Whether to use Lyman-alpha heating. (cf Sec. 3 of Reis+2021, doi.org/10.1093/mnras/stab2089) | `src/py21cmfast/wrapper/inputs.py:1028-1028` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：A 型氢复合系数 $\alpha_A(T)$ 的九阶多项式拟合；B 型氢复合系数 $\alpha_B(T)$；He I 电离截面；再电离反馈；演化电离盒方程的复合项；CMB 加热率；CMB 加热的正确表达式；Ly-α 加热的开关与出处。

**J_α(z) · Ly-α 辐射场强度**

- 论文节号：§2.3 Wouthuysen–Field 效应（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| Pop 2 / Pop 3 恒星谱的分段幂律拟合 | Barkana（注释未给年份与篇名） | Reads in and constructs table of the piecewise power-law fits to Pop 2 and Pop 3 stellar spectra, from Barkana | `src/py21cmfast/src/heating_helper_progs.c:269-270` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：Pop 2 / Pop 3 恒星谱的分段幂律拟合。

**x_α · Ly-α 耦合系数**

- 论文节号：§2.3（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

**x_c · 碰撞耦合系数**

- 论文节号：§2.2 碰撞耦合（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

**T_S(z) · 自旋温度**

- 论文节号：§2.2 碰撞耦合、§3.5 耦合（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）
