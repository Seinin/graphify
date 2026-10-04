# 引力扰动

初始条件那张场记的是复合前后的图案，而塌缩、电离与辐射转移都发生在晚得多的红移上。这一块把图案接成随时间演化的物质场：密度按生长因子整体缩放，再在低分辨体元的尺度上做顶帽平均——缩放给出振幅，平均给出这张场实际能被下游使用的分辨率。速度场不是另一份独立信息，它由同一批扰动经线性连续性方程给出，纵向部分完全跟着密度走。

分工也很清楚：密度场是所有偏晚环节的底场（塌缩分数、电离与加热的源项、红移空间畸变都按它加权），速度场只管把视线方向的速度折进观测到的密度。代价写在用途里——体元尺度以下的起伏在这里完全不可见，下游拿到的是大尺度图案；真要用到小尺度速度，得另找一条路。

## δ(x) · 扰动密度场

### 物理

这是交给下游的密度场：同一批初始扰动先在低分辨体元的尺度上做顶帽平均，再随红移整体缩放，得到一张每个体元一个值的物质密度对比图。平滑把体元尺度以下的起伏抹掉，留下的只有大尺度部分，所以塌缩分数、电离场与红移空间畸变拿到的都是这一张图。

公式只有两步——按生长因子之比把初始场缩放到目标红移，再与体元窗卷积；初始场里已经并进位移效应的部分随之一起缩放。前提是体元尺度仍落在准线性区：只要平滑尺度大于非线性尺度，整张场就还是线性倍数的叠加，不必逐红移重做动力学。

驱动它的是初始密度场、生长因子与体元尺度。模型若纳入重子-暗物质相对速度，那条场作为同一份初始条件里的第二条非均匀量一并读入，压制的是成核与冷却，并不改写密度本身；密度场随红移只变振幅、不变图案。

数学上它是线性的、逐体元局域的，一个格点的值只由该体元的平均给出，没有参数简并。唯一的非线性动作是总密度为负处截断到零——只为挡掉物理上不可能出现的负质量，代价是空腔区被削平，因此这张场在偏高密度区准确、在空腔里是被压平的。

它把初始扰动接到所有偏晚的环节上：塌缩分数、电离与加热的源项都按它加权，红移空间畸变也以它为底场。局限在平滑本身——体元尺度以下的结构在这里完全不可见，下游用它的平均值近似源项，得到的只能是大尺度图案。

$$\delta(\mathbf x,z)=\frac{D(z)}{D(z_i)}\,\delta_{\rm hi}(\mathbf x)\ \ast\ W_{\rm cell},\qquad 1+\delta\ge 0$$

### 代码解析

写出这张场的那段在 `PerturbedField.c` 的 `ComputePerturbedField`（446–460 行）：它把已经存好的低分辨密度 `LOWRES_density_perturb` 逐格点抄进 `perturbed_field->density`，索引走 `grid_index_general` 的实空间顺序。缩放与平滑不在这几行里，而在写出之前的同一条函数中——生长因子之比与体元窗卷积先作用在一张高分辨的场上，降采样之后才轮到这段搬运。

看这段要分清"算在哪"与"抄在哪"：能查到位置的是搬运，物理发生在被搬的那份数组生成的时候。负值截断同样在生成时做掉，所以下面每一张场都满足 $1+\delta\ge 0$。

### 工程

- `src/py21cmfast/src/PerturbedField.c:446-460`

```c
#pragma omp parallel num_threads(simulation_options_global->N_THREADS)
        {
            unsigned long long int index_r, index_f;
#pragma omp for
            for (int i = 0; i < lo_dim[0]; i++) {
                for (int j = 0; j < lo_dim[1]; j++) {
                    for (int k = 0; k < lo_dim[2]; k++) {
                        index_r = grid_index_general(i, j, k, lo_dim);
                        index_f = grid_index_fftw_r(i, j, k, lo_dim);
                        *((float *)perturbed_field->density + index_r) =
                            *((float *)LOWRES_density_perturb + index_f);
                    }
                }
            }
        }
```

- 输入：$\delta_i$、位移场、$D(z)/D(z_i)$ 与相对速度 $v_{cb}$
- 产出：低分辨扰动密度场 $\delta(\mathbf x,z)$（负值截断后）

### 参数语境

本篇名下没有参数标签：$\delta(\mathbf x,z)$ 由初始密度场乘生长因子再叠加位移与相对速度得到，式子里的输入都是上游量。能改它的只有几处上游选择——初始红移（经 $D(z)/D(z_i)$ 定增长了多少）、功率谱归一（$A_s$ 或 $\sigma_8$，定涨落幅度）、随机种子（定实现），以及相对速度那一份所属的开关。因此它是一张"给定条件就唯一确定"的场，参数扫描改的是它的统计性质而不是它的算法。

## v(x) · 低分辨速度场

### 物理

低分辨速度场由线性连续性方程给出：速度的纵向部分完全由密度的增长决定，横向部分在一阶为零，所以这条场本质上就是密度场的梯度。它有三个分量、逐格点，给出每个体元中心处的流速。

在波数空间速度正比于波数除以波数平方再乘密度的增长率，转到实空间就是一步逆拉普拉斯卷积；前提是一阶微扰与无旋流，横向模在膨胀中早已衰减到可忽略。

它供红移空间畸变把视线方向的速度折进观测到的密度，也供源项取用，因此与密度场同源、不是独立信息。局限在低分辨与线性两端：体元尺度以下的速度结构与晕内的非线性运动都不在其中，真要用到小尺度速度时得另算。

$$\mathbf v_{\mathbf k}=i\,\frac{\mathbf k}{k^{2}}\,\frac{\dot D}{D}\,\delta_{\mathbf k},\qquad \mathbf v=\frac{\dot D}{D}\,\nabla\nabla^{-2}\delta$$

### 代码解析

三个分量由 `compute_perturbed_velocities`（336–375 行）一次一个地算，一次调用只处理一个方向。核心动作在波数空间：密度的变换结果被就地乘上 $\dot D/D$ 与 $k_i/k^2$（代码里是 `dDdt_over_D * kvec[axis] * I / k_sq`），也就是完成那步逆拉普拉斯。里面有一个必须的特判：零模直接置零——$k=0$ 处 $1/k^2$ 发散，而整盒的平均密度本来就不该带来任何流动。

乘完转回实空间，再按 `resample_index` 降到低分辨，逐格点写进对应的分量数组。算几个分量由 `ComputePerturbedField` 在 464–471 行决定：开了三维速度就把三个方向都算一遍，否则只算沿视线的那一个（最后一个分量），因为红移空间畸变只需要视线方向的速度。

### 工程

- `src/py21cmfast/src/PerturbedField.c:336-375`

```c
                    // now set the velocities
                    if ((n_x == 0) && (n_y == 0) && (n_z == 0)) {  // DC mode
                        velocity_fft_grid[grid_index] = 0.0 + 0.0 * I;
                    } else {
                        velocity_fft_grid[grid_index] *=
                            dDdt_over_D * kvec[axis] * I / k_sq / n_r_pixels;
                    }
                }
            }
        }
    }

    LOG_SUPER_DEBUG("density_perturb after modification by dDdt: ");
    debugSummarizeBoxComplex((float complex *)velocity_fft_grid, box_dim[0], box_dim[1],
                             box_dim[2] / 2 + 1, "  ");

    if (matter_options_global->PERTURB_ON_HIGH_RES &&
        simulation_options_global->DIM != simulation_options_global->HII_DIM) {
        filter_box(velocity_fft_grid, box_dim, 0,
                   physconst.l_factor * simulation_options_global->BOX_LEN /
                       (simulation_options_global->HII_DIM + 0.0),
                   0.);
    }

    dft_c2r_cube(matter_options_global->USE_FFTW_WISDOM, box_dim[0], box_dim[2],
                 simulation_options_global->N_THREADS, velocity_fft_grid);

#pragma omp parallel private(i, j, k) num_threads(simulation_options_global -> N_THREADS)
    {
        unsigned long long int grid_index_f, grid_index_r;
        int grid_ipos[3];
#pragma omp for
        for (i = 0; i < lo_dim[0]; i++) {
            for (j = 0; j < lo_dim[1]; j++) {
                for (k = 0; k < lo_dim[2]; k++) {
                    grid_index_r = grid_index_general(i, j, k, lo_dim);
                    resample_index((int[3]){i, j, k}, dim_ratio, grid_ipos);
                    grid_index_f =
                        grid_index_fftw_r(grid_ipos[0], grid_ipos[1], grid_ipos[2], box_dim);
                    velocity[grid_index_r] = *((float *)velocity_fft_grid + grid_index_f);
```

- `src/py21cmfast/src/PerturbedField.c:464-471`

```c
        if (matter_options_global->KEEP_3D_VELOCITIES) {
            compute_perturbed_velocities(0, redshift, density_perturb_saved, fft_density_grid,
                                         perturbed_field->velocity_x);
            compute_perturbed_velocities(1, redshift, density_perturb_saved, fft_density_grid,
                                         perturbed_field->velocity_y);
        }
        compute_perturbed_velocities(2, redshift, density_perturb_saved, fft_density_grid,
                                     perturbed_field->velocity_z);
```

- 输入：$\delta(\mathbf x)$、$\dot D/D$ 与相对速度分量
- 产出：低分辨速度场 $\mathbf v$ 的三个分量

### 参数语境

本篇名下没有参数标签：速度场由密度场乘 $\dot D/D$ 再叠加相对速度分量得到，全部输入来自上游。能间接改它的仍是那几处——功率谱归一、初始红移、随机种子，以及宇宙学参数经生长率进入的那一项。它的作用面在下游：速度场进亮温的红移空间畸变，因此它的幅度（也就是生长的快慢）会显形在功率谱上。

## 参数

本模块不携带参数：扰动密度场与低分辨速度场都由上游量定出——初始密度场、生长因子与生长率、位移与相对速度分量，式子本身不含自由参数。能间接改它们的是功率谱归一（$A_s$ 或 $\sigma_8$）、初始红移、随机种子，以及宇宙学参数经生长因子进入的那一项；参数扫描改的是这两张场的统计性质，不是它们的算法。

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**δ(x) · 扰动密度场**

本对象没有登记的论文出处：论文综述里没有对应节号，代码注释里也没有引用。

**v(x) · 低分辨速度场**

本对象没有登记的论文出处：论文综述里没有对应节号，代码注释里也没有引用。
