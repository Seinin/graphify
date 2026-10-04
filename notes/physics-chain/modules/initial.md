# 初始条件

这块给整条链定起点：盒子里物质分布的随机实现、它引起的第一批运动，以及重子与暗物质之间那条速度差。后面的引力演化、晕目录、电离与加热都从这几张场长出来——起点一定，整条链的空间结构就跟着定。

几样东西的性质并不相同。密度场是零均值的高斯随机场，全部统计信息压在一条功率谱里，相位随机；两条位移场不是独立信息，而是同一张密度场的加权梯度（一阶）与它的自耦合修正（二阶）——密度场一改，位移场跟着改。相对速度场与密度场同相位，也取自同一套初始条件，但它是本块里唯一被当作外部输入读入的场。

它们都只算一次，不随红移重算：位移场记的是初始时刻的位移，而不是任意时刻解出来的速度，之后的演化交给引力那一段。这也划出了本块的边界——初始红移以下的非线性演化不归这里管。

## v_cb · 重子-暗物质相对速度

### 物理

重子与暗物质在复合前后的受力不同：暗物质只受引力，重子还被光子拖住，于是两者之间留下一条随空间变化的相对速度。它在复合时刻以几十千米每秒的均方根铺满整盒，相干长度是几个百万秒差距量级，之后随尺度因子反比衰减，但到宇宙黎明仍有可观振幅。

它就是两个速度场之差，与密度扰动取自同一套初始条件、同相位，所以它并非一条独立的随机场，而是随初始条件一起给出的非均匀场，逐格点、无筛选。它不由链上任何别的量算出，只被读入。

它的作用是对小质量晕的恒星形成额外界定一个局部门槛：相对速度大的地方，气体在塌缩前就被推走，成核与冷却被压后，那里的源形成更晚、更少。局限在于它只在大尺度上有意义——相对速度的相干尺度有限，小尺度上早被非线性演化抹平，那里真正起作用的是密度与电离的局部结构。

$$\mathbf v_{cb}(\mathbf x)=\mathbf v_c(\mathbf x)-\mathbf v_b(\mathbf x)$$

### 代码解析

`compute_relative_velocities` 是它的全部实现。它不重新抽一套随机相位，而是在那条已经存好的初始密度场上做替换：把每条模的振幅换成相对速度功率谱与密度功率谱之比的平方根，再乘上 $ik_i/k$ 逐步构出三个方向，单位换算成千米每秒。同一份相位、换一套振幅，这正是正文那句"与密度扰动同相位"在代码里的样子。

循环末尾的处理值得留意：直流模（$k=0$）被单独置零——那里要除以波数，除零没有意义，物理上盒子的整体速度也不带信息。

三个方向依次做完之后才是输出：先按低分辨的奈奎斯特尺度滤掉高频（高分辨与低分辨相同时跳过），变换回实空间，再把三分量的平方在低分辨格点上累加、开方，得到一张**速率**的场——下游读到的不是矢量的某个分量，而是相对速度的大小。

调用点由开关守着，不开就整项跳过，相对速度对源项门槛的那部分修正也就不生效。

### 工程

- `src/py21cmfast/src/InitialConditions.c:176-190`

```c
                        p = power_in_k(k_mag);
                        p_vcb = power_in_vcb(k_mag);

                        kvec[0] = k_x;
                        kvec[1] = k_y;
                        kvec[2] = k_z;

                        // now set the velocities
                        if ((n_x == 0) && (n_y == 0) && (n_z == 0)) {  // DC mode
                            box[0] = 0;
                        } else {
                            index = grid_index_fftw_c(n_x, n_y, n_z, hi_dim);
                            box[index] = box_saved[index] * I * kvec[ii] / k_mag * sqrt(p_vcb / p) *
                                         physconst.c_kms;
                        }
```

- `src/py21cmfast/src/InitialConditions.c:734-736`

```c
        if (matter_options_global->USE_RELATIVE_VELOCITIES) {
            compute_relative_velocities(HIRES_box, HIRES_box_saved, boxes->lowres_vcb);
        }
```

- 输入：$P_{vcb}(k)/P(k)$ 的相对功率与随机种子
- 产出：DM 与重子的相对速度场 $v_{cb}$（低分辨）

### 参数语境

生成这张场本身不读任何参数标签：输入只有相对速度与密度的功率比以及随机种子，所以它的统计性质由宇宙学与种子定，而不是由天文参数定。

作用在它上面的参数在下游：`A_VCB` 与 `BETA_VCB` 用它算分子冷却阈值（放大与幂指数），`FIXED_VAVG` 配 `FIX_VCB_AVG` 把逐格点的值换成固定平均值。也就是说这一篇提供的是"输入数据"，那几个参数决定的是"怎么用它"——扫描时想改相对速度的影响，要动的是下游那两个参数，改种子只会换一张实现。

## δ_i(x) · 线性初始密度场

### 物理

初始密度场是线性高斯随机场在模拟盒里的一个实现：谐波空间里每条模的振幅按物质功率谱抽样、相位随机，变换回实空间后就是当时的物质密度起伏。它是一张无量纲的密度对比图，以零为中心；在盒尺度上平滑之后，均方根通常只有千分之几到百分之一，越小的尺度起伏越强。

它由两件事相乘给出——谐波空间各不相同的高斯实现，与把这条实现外推到初始红移的线性生长。前提是初始红移仍落在物质主宰的线性区、扰动波长远在视界之内：初始红移取得越高，线性外推越干净；取得越低，初始时刻就已进入非线性的尺度就越多，而这一步不管它们。

功率谱本身来自宇宙学的传输函数，红移那一端由生长因子承接，两者都不在模拟盒里现算；真正驱动这条场的是随机种子的实现与初始红移。它读入的是一张连续、无界、无筛选的场——不截断，也不按晕或按源加权，记的就是该时刻仍在线性区内的全部起伏。

数学上它是线性齐次、零均值高斯的，没有参数简并：场的全部统计信息压进一条两点功率谱。相位随机意味着单点分布与功率谱就足以描述它，高阶矩不携带额外信息，而它对振幅是精确线性的——功率谱放大多少倍，场就放大同样的倍数。

它在链上的位置是起点：引力演化把起伏放大到非线性，重子密度按同一张场缩放，晕目录与电离场里的密度都由它平滑或生长得到，所以它一旦定下，整条链的空间结构就跟着定下。局限也在同一处——初始红移以下的非线性演化不归它管，那部分由引力与塌缩承担。

$$\delta_i(\mathbf x)=D(z_i)\,\delta(\mathbf x),\qquad \langle\delta_{\mathbf k}\delta^{*}_{\mathbf k^{\prime}}\rangle=V\,P(k)\,\delta_{\mathbf k\mathbf k^{\prime}}$$

### 代码解析

这一段代码落点在高分辨盒到低分辨网格的降采样：逐格点按分辨率之比算出对应的高分辨像素序号，直接取那一个像素的值，除以体积归一到密度对比，写进低分辨密度场。降采样是**取值**而不是平均——没有任何窗口平滑，一个低分辨格点拿的就是它中心附近那一个高分辨像素。

抽取随机数、按功率谱赋振幅那一步发生在上游同一个文件里，作用在高分辨盒上；这一段只负责把它搬到下游实际使用的那张网格。看这段要记住两件事：归一约定（除体积）与分辨率比，同一个场在不同分辨或不同盒长下数值不同，比较前先对齐这两者。

初始红移与生长因子也不在这一段：外推到初始时刻由生长因子完成，代码里是另一处的一步乘法。

### 工程

- `src/py21cmfast/src/InitialConditions.c:715-732`

```c
#pragma omp parallel shared(boxes, HIRES_box, dim_ratio_hi_lo) private(i, j, k) \
    num_threads(simulation_options_global -> N_THREADS)
        {
            unsigned long long int index_r, index_f;
            int resampled_index[3];
#pragma omp for
            for (i = 0; i < lo_dim[0]; i++) {
                for (j = 0; j < lo_dim[1]; j++) {
                    for (k = 0; k < lo_dim[2]; k++) {
                        index_r = grid_index_general(i, j, k, lo_dim);
                        resample_index((int[3]){i, j, k}, dim_ratio_hi_lo, resampled_index);
                        index_f = grid_index_fftw_r(resampled_index[0], resampled_index[1],
                                                    resampled_index[2], hi_dim);
                        boxes->lowres_density[index_r] = *((float *)HIRES_box + index_f) / VOLUME;
                    }
                }
            }
        }
```

- 输入：$P(k)$、初始红移 $z_i$、生长因子 $D(z_i)$ 与随机种子
- 产出：初始密度场 $\delta_i$（高分辨网格）

### 参数语境

本篇名下没有参数标签：$\delta_i$ 是从功率谱抽出来的一张实现，输入只有功率谱、初始红移、生长因子与随机种子。能改它的上游选择也就这几处——归一（$A_s$ 或 $\sigma_8$）定整体幅度、初始红移定抽取的时点、种子定具体实现。同一套参数换种子会得到不同但统计相同的场，因此涉及随机种子的比较必须固定它。

## v_1LPT(x) · 一阶拉格朗日位移速度场

### 物理

一阶拉格朗日位移（Zel'dovich 近似）把结构形成写成一场位移：粒子不是停在原地慢慢聚集，而是从均匀的初始位置被一个位移场整体搬走。位移势与初始密度场由同一个泊松方程挂钩，位移沿密度梯度方向——密度高的地方，物质被拉向更密处。

速度不是独立自由度，就是位移的时间变化率，两者只差一个由生长率与哈勃率合成的系数；在物质主宰时期这个系数接近哈勃率本身，位移随时间大致随生长因子增长。它成立的前提是位移场只有纵模：横向分量在膨胀中按 $1/a$ 衰减，到宇宙黎明已可忽略，所以整条速度场可以由一个标量势的梯度完全表达。

驱动它的是初始密度场、生长因子与生长率——密度场在哪里起伏，位移就往哪指，场的大小与它所在的时刻由生长因子给出。它是随初始条件一次性算出的场，之后不随红移重算，因此它记的是初始时刻的位移，而不是任意时刻解出来的速度。

数学结构上它是线性的，却不局域：位移是一步逆拉普拉斯卷积，一个点上的速度取决于整条密度场的分布。它本身没有参数简并，但与密度场写在同一份初始条件里——两者不是独立信息，密度场一改，位移场跟着改。

它把物质从线性区搬到准线性区，是引力推动粒子、以及红移空间畸变的起点。局限在它只对位移保留一阶：密度对比接近或超过 1 之后，位移与密度的非线性映射失准，小尺度速度会偏，这时要靠更高阶的拉格朗日修正补。

$$\mathbf v_{1\mathrm{LPT}}=-f(z)\,H(z)\,D(z)\,\nabla\nabla^{-2}\delta$$

### 代码解析

三个方向各做一遍，每遍两步。第一步在频率空间做那个算子：拿输入场的每条模乘上 $ik_i/k^2$——逆拉普拉斯与梯度一次做完，正是"一个标量势的梯度"的写法。直流模同样被单独置零，那里要除以 $k^2$。

第二步是分辨率处理：只在低分辨网格上做扰动时，先按低分辨的奈奎斯特尺度滤掉高频，变换回实空间，再按分辨率之比取值降到低分辨网格，除以体积归一，写进三个速度分量。三个分量来自同一份输入场，只有方向指标不同——这是"速度不是独立自由度"在代码里最直接的体现。

### 工程

- `src/py21cmfast/src/InitialConditions.c:325-362`

```c
    for (ii = 0; ii < 3; ii++) {
        // Now let's set the velocity field/dD/dt (in comoving Mpc)
        compute_f_gradient(box_saved, box, hi_dim, box_len, ii);

        // Filter only if we require perturbing on the low-res grid
        if (!matter_options_global->PERTURB_ON_HIGH_RES) {
            if (simulation_options_global->DIM != simulation_options_global->HII_DIM) {
                filter_box(box, hi_dim, 0,
                           physconst.l_factor * simulation_options_global->BOX_LEN /
                               (simulation_options_global->HII_DIM + 0.0),
                           0.);
            }
        }

        dft_c2r_cube(matter_options_global->USE_FFTW_WISDOM, simulation_options_global->DIM, D_PARA,
                     simulation_options_global->N_THREADS, box);

        // now sample to lower res
        // now sample the filtered box
#pragma omp parallel private(i, j, k) num_threads(simulation_options_global -> N_THREADS)
        {
            unsigned long long int index, index_f;
            int resampled_index[3];
#pragma omp for
            for (i = 0; i < pt_dim[0]; i++) {
                for (j = 0; j < pt_dim[1]; j++) {
                    for (k = 0; k < pt_dim[2]; k++) {
                        index = grid_index_general(i, j, k, pt_dim);
                        resample_index((int[3]){i, j, k}, dim_ratio_hi_pt, resampled_index);
                        index_f = grid_index_fftw_r(resampled_index[0], resampled_index[1],
                                                    resampled_index[2], hi_dim);
                        vel_pointers[ii][index] = *((float *)box + index_f) / VOLUME;
                    }
                }
            }
        }
    }

```

- `src/py21cmfast/src/InitialConditions.c:593-595`

```c
            vel_pointers[0] = boxes->lowres_vx;
            vel_pointers[1] = boxes->lowres_vy;
            vel_pointers[2] = boxes->lowres_vz;
```

- 输入：$\delta_i$、$D(z)$ 与生长率 $f=\mathrm{d}\ln D/\mathrm{d}\ln a$
- 产出：一阶位移场三分量 $-D\nabla\phi_1$

### 参数语境

本篇名下没有参数标签：位移场由初始密度场、生长因子与生长率 $f$ 定出，输入全是上游量。生长率随宇宙学参数变，因此"位移随时间怎么长"这一条对宇宙学敏感；对天文参数与开关则不敏感——它不读任何一个天文旋钮。

## v_2LPT(x) · 二阶 LPT 速度场

### 物理

二阶拉格朗日位移场补的是一阶铺位移时漏掉的自耦合：一阶把"位移正比于密度"这一步写对，但一阶位移场自身也带引力，会让密度演化偏慢；二阶项把这一阶残缺补回来，在塌缩刚起步的尺度上修正最明显——大尺度上它几乎不动，小尺度上它是主要的改正项。

二阶位移势由一个平方型源项解泊松方程给出：源项由一阶位移势的二阶导数两两组合而成，解出势后再用固定的系数归到速度上。它与一阶同前提——位移仍无旋；这一项比一阶多压一个生长因子，所以越晚、生长因子越大，二阶项才越重要。

它是高阶修正，非线性、非局域，符号按波数反演后的形状双向偏：谱的重端被压、小尺度被抬，正好补上 Zel'dovich 近似的偏差。它不改变场的起点，只改变位移的精度；链条若不含二阶修正就整项缺失，含它时给引力一套更准的初始速度。

$$\nabla^{2}\phi_2=\sum_{i>j}\left[(\partial_i^{2}\phi_1)(\partial_j^{2}\phi_1)-(\partial_i\partial_j\phi_1)^{2}\right],\qquad \mathbf v_{2\mathrm{LPT}}=-\tfrac{3}{7}D^{2}\,\nabla\!\left(\nabla^{-2}\mu_2\right)$$

### 代码解析

源项那个平方组合是一格一格直接写出来的：两个同方向的二阶导数之积（对角线导数由预先算好的存储数组提供），减去混合导数的平方。循环里那句话说明这种写法是为了与旧实现的舍入保持一致——两项分开做加与减，不是笔误，改写成一行会在低位上变数。

源项算完后再做一次归一（整盒除以 $V^2 N$，两次频率空间运算叠起来之后的约定），随后与一阶同路：按方向做梯度算子、按需要滤波、变换回实空间再降采样进三个二阶速度分量。两个方向分量都来自这一份源项场，二阶项之所以"补精度而不改起点"，看的就是这里——它只改位移的补偿项，不改初值。

### 工程

- `src/py21cmfast/src/InitialConditions.c:465-498`

```c
#pragma omp for
            for (i = 0; i < hi_dim[0]; i++) {
                for (j = 0; j < hi_dim[1]; j++) {
                    for (k = 0; k < hi_dim[2]; k++) {
                        index = grid_index_general(i, j, k, hi_dim);
                        index_f = grid_index_fftw_r(i, j, k, hi_dim);
                        component_ii = diag_storage_pt[phi_i][index];
                        component_jj = diag_storage_pt[phi_j][index];
                        component_ij = *((float *)phi_1 + index_f);

                        // Kept in this form to maintain similar (possible) rounding errors
                        *((float *)box + index_f) += (component_ii * component_jj);
                        *((float *)box + index_f) -= (component_ij * component_ij);
                    }
                }
            }
        }
    }
    // deallocate the supplementary boxes
    fftwf_free(phi_1);

#pragma omp parallel private(i, j, k) num_threads(simulation_options_global -> N_THREADS)
    {
        unsigned long long int index;
#pragma omp for
        for (i = 0; i < hi_dim[0]; i++) {
            for (j = 0; j < hi_dim[1]; j++) {
                for (k = 0; k < hi_dim[2]; k++) {
                    index = grid_index_fftw_r(i, j, k, hi_dim);
                    *((float *)box + index) /= VOLUME * VOLUME * TOT_NUM_PIXELS;
                }
            }
        }
    }
```

- `src/py21cmfast/src/InitialConditions.c:596-599`

```c
            vel_pointers_2LPT[0] = boxes->lowres_vx_2LPT;
            vel_pointers_2LPT[1] = boxes->lowres_vy_2LPT;
            vel_pointers_2LPT[2] = boxes->lowres_vz_2LPT;
        }
```

- 输入：$\delta_i$、$D$ 与二阶核 $D_2=-\tfrac{3}{7}D^{2}$
- 产出：二阶 LPT 位移三分量

### 参数语境

本篇名下没有参数标签：二阶位移由初始密度场与生长因子定出（二阶核取 $-\tfrac37D^2$），输入全是上游量。天文参数与开关都不读它；能间接改它的只有功率谱归一、初始红移与宇宙学参数。

## 参数

本模块不携带参数：这里生成的每一张场都只读上游输入——功率谱、初始红移、生长因子与随机种子，不读天文旋钮、也不读任何开关。作用在重子—暗物质相对速度上的那几个（`A_VCB`、`BETA_VCB` 用它算分子冷却阈值，`FIXED_VAVG` 配 `FIX_VCB_AVG` 把逐格点的值换成固定平均）决定的是怎么用它；那一组参数的语境记在下游。扫描时想改相对速度的影响要动的是那几个，改种子只会换一张统计相同的实现。

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**v_cb · 重子-暗物质相对速度**

本对象没有登记的论文出处：论文综述里没有对应节号，代码注释里也没有引用。

**δ_i(x) · 线性初始密度场**

本对象没有登记的论文出处：论文综述里没有对应节号，代码注释里也没有引用。

**v_1LPT(x) · 一阶拉格朗日位移速度场**

本对象没有登记的论文出处：论文综述里没有对应节号，代码注释里也没有引用。

**v_2LPT(x) · 二阶 LPT 速度场**

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| 二阶拉格朗日微扰修正（对角分量 $\phi_1$） | Scoccimarro 1998（MNRAS 299, 1097-1118, Appendix D） | ZA reference: Scoccimarro R., 1998, MNRAS, 299, 1097-1118 Appendix D | `src/py21cmfast/src/InitialConditions.c:746-747` | 无正文（本地只有代码注释与 docstring） |
| ZA / 2LPT / 线性三个速度场选项 | Scoccimarro 1998（MNRAS 299, 1097-1118, Appendix D） | Reference: Scoccimarro R., 1998, MNRAS, 299, 1097-1118 Appendix D. | `src/py21cmfast/wrapper/inputs.py:604-605` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：二阶拉格朗日微扰修正（对角分量 $\phi_1$）；ZA / 2LPT / 线性三个速度场选项。
