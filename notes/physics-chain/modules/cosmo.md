# 宇宙学背景与物质功率谱

这块是整条链的底料。它把原初那条近似尺度不变的曲率扰动谱搬到物质时代：进视界早的小尺度模被辐射拖住、长得慢，于是功率谱在大尺度保留原初斜率、在小尺度转成更陡的下降，再按今天的振幅归一。转移函数负责形状，归一常数负责高度，红移只把整条谱乘上生长因子的平方，不碰形状。

两个成员一横一纵：转移函数是一维的 $T(k)$；功率谱 $P_m(k)$ 与它积出的 $\sigma(R)$ 是下游真正要用的那张表。它们的位置在链上很特殊——初始密度场按这份谱抽样（振幅由谱给、相位随机），晕质量函数与后面所有源项的尺度依赖都从 $\sigma(R)$ 出发；而这块只描述线性区，波数更大、已经进入非线性的那一段由引力与塌缩接手。

这篇文档顺着计算真实发生的顺序写：先讲这块要解决的问题与它依据的物理，再逐段落到 `cosmology.c` 与 `interp_tables.c` 的代码上，然后是参数读法与陷阱清单，文末两节逐个交代本块两个对象的定位与落点，代码地图与论文出处收在末尾。公式、系数与行号均取自本仓当前源码。

## 一、这块在链上做什么

**一句话**：把原初那条近似尺度不变的曲率扰动谱，折算成物质密度场的功率谱与平滑方差两张表。

| | 内容 |
| :--- | :--- |
| 输入（链上） | 无。这块在链的最上游，只吃参数，不吃任何上游盒 |
| 输入（参数） | 本模块 1 个参数 $A_s$（原初曲率扰动振幅）；谱形所依赖的宇宙学量与谱指数在这块不挂标签（见 §四） |
| 主输出 | $P_m(k,z=0)$，以及 $\sigma(M)$ 与 $\mathrm d\sigma^{2}/\mathrm dM$ 两张插值表 |
| 诊断输出 | FDM 打开时并行填一份 CDM 参照表（`Sigma_InterpTable_CDM`），只用于把 FDM 压制写成相对 CDM 的比值 |
| 下游 | `InitialConditions` 按它抽样初始密度场；晕质量函数与坍缩分数用 $\sigma(M)$ 定尺度依赖；引力演化按生长因子把谱推进到各红移 |

**物理图像**：原初扰动是所有结构的种子，但它铺在辐射时代的曲率里，不是今天看到的物质密度。从那时到现在隔着两件事：不同尺度的模进视界的时间不同，早进的被辐射压拖住、增长得更慢，于是谱的形状被重新刻过一遍；整体振幅则随时间一起长大。把形状（转移函数）与振幅（归一常数 × 生长因子）分开，就是这块的全部结构。

**为什么必须有这一步**：它给整条链定"结构有多少、在哪个尺度上"这个基准。初始密度场、晕丰度、坍缩分数、源项的尺度依赖，全部从这两张表出发。它错了，下游再精确也只是在错的骨架上做精细活；它只覆盖线性区这一点也决定了后面的分工——非线性那一段必须由引力求解接手，而不是在这里硬算。

## 二、物理骨架

### 2.1 从原初谱到物质谱

原初扰动的无量纲曲率谱是一个幂律，枢纽波数写死在 0.05：

$$\mathcal{P}_\zeta(k)=A_s\left(\frac{k}{k_{\rm pivot}}\right)^{n_s-1},\qquad k_{\rm pivot}=0.05\ \mathrm{Mpc}^{-1}$$

物质谱由三段相乘得到：原初谱、转移函数的平方、归一常数，再除以 $k^{3}$：

$$P_m(k)=\frac{\sigma_{\rm norm}}{k^{3}}\,\mathcal{P}_\zeta(k)\,T^{2}(k)$$

$T(k)$ 在这里的定义是 $\delta(k)/\zeta(k)$（CLASS 的口径），所以 $k\to0$ 时它趋于 $k^{2}$ 而不是 1。非 CLASS 的那几条拟合式在 $k\to0$ 时趋于 1，用它们时必须补乘一个 $k^{2}$ 才与这条式子对齐——这是块内最容易读错的一处约定，代码里也是这么做的。

除以 $k^{3}$ 不是物理压制，只是把"曲率谱"的约定换成"密度谱"的约定：同一份扰动，用不同的量去描述，单位与幂次跟着换。

### 2.2 σ(R) 与质量方差

把谱在球面窗上积分，得到半径 $R$ 内的平滑密度方差：

$$\sigma^{2}(R)=\int_0^\infty\frac{k^{2}\mathrm dk}{2\pi^{2}}P_m(k)W^{2}(kR)$$

窗函数 $W$ 由 `matter_options.FILTER` 选（球面顶帽或高斯），质量与半径用同一条口径互相换算。方差一律在 $z=0$ 算出来，红移的部分交给生长因子：

$$\sigma(M,z)=\sigma_{z=0}(M)\,D(z),\qquad D(0)=1$$

质量函数还要用到方差的导数 $\mathrm d\sigma^{2}/\mathrm dM$，所以这块一次产出两张表，而不是只产出 $\sigma(M)$ 一张。

### 2.3 生长因子

时间演化全部压在 $D(z)$ 这一个乘数里，所以块内只算一次 $D$，下游把它乘到任意红移。代码里的 $D$ 只覆盖三种宇宙：$\Omega_m=1$ 的 Einstein–de Sitter、平直且 $w=-1$ 的 $\Lambda$ 宇宙、以及零 $\Lambda$ 的开宇宙。其余情形（含 $w\neq-1$ 的 quintessence）不走近似式，而是直接抛错——注释里引了 quintessence 的文献，但那条分支没有实现。

## 三、代码：从参数到三张表

### 3.1 总装：`init_ps` 的次序

整块的入口是 `cosmology.c` 的 `init_ps`。它只做初始化、不做求值——求值留到下游随时调用。前五分之四是这样：

```c
void init_ps() {
    cosmo_consts.omhh =
        cosmo_params_global->OMm * cosmo_params_global->hlittle * cosmo_params_global->hlittle;
    cosmo_consts.theta_cmb = physconst.T_cmb / 2.7;

    cosmo_consts.f_nu = fmax(cosmo_params_global->OMn / cosmo_params_global->OMm, 1e-10);
    cosmo_consts.f_baryon = fmax(cosmo_params_global->OMb / cosmo_params_global->OMm, 1e-10);

    // NOTE: even if we use the CLASS transfer function, we still need to call the function below in
    // order to initialize the parameters for the EH transfer function, since the EH transfer
    // function is used for extrapolating the transfer function at high k.
    TFset_parameters();

    if (matter_options_global->POWER_SPECTRUM == 5) {
        // We start the interpolator if using CLASS:
        LOG_DEBUG("Setting CLASS Transfer Function inits.");
        transfer_function_CLASS(1.0, 0, 0);
    }
```

（`src/py21cmfast/src/cosmology.c:536-553`；末段定归一常数，留给 §4.3。）

1. **组装无量纲化常数**：`omhh` 是 $\Omega_m h^{2}$；`theta_cmb` 是今天的 CMB 温度除以 2.7 K。
2. **取中微子与重子的质量份额**，并**兜一个 $10^{-10}$ 的下限**。这一手是防零：$\Omega_\nu$ 或 $\Omega_b$ 取零时，后面 EH 拟合式里的 $\ln$ 与除法会立刻出问题，用一个极小值代替零，比在每条分支上判零省事。
3. **无条件算 EH 转移函数的常数**。这一步即使在用 CLASS 时也照做：CLASS 那张表只覆盖到预计算的 $k_{\max}$，再往上的高 $k$ 要靠 EH 外推（§3.3），没有这些常数就外推不了。
4. **用 CLASS 时初始化插值器**，把外部预计算的转移函数读成样条。
5. **定归一常数** $\sigma_{\rm norm}$——两种归一方式在这里分岔（§4.3）。

块外的调用点在 `InitialConditions.c:619`：这份谱只在初始条件那一步被真正坐下来。

### 3.2 `power_in_k`：三段相乘与两处约定

```c
double power_in_k(double k) {
    double p, T, primordial;

    if (k == 0.) {
        return 0.;
    } else {
        T = transfer_function(k);
        if (matter_options_global->POWER_SPECTRUM < 5) {
            // In non-CLASS transfer functions (EH, BBKS, etc), the convention is that the transfer
            // function approches unity as k->0. We therefore have to multiply by k^2 in order to
            // match with the CLASS notation that is used below.
            T *= k * k;
        }

        primordial = primordial_curvature_power_spectrum(k);
        p = cosmo_consts.sigma_norm * primordial * T * T / pow(k, 3);

        // NOTE: USE_RELATIVE_VELOCITIES is only allowed if using CLASS
        if (matter_options_global->POWER_SPECTRUM == 5 &&
            matter_options_global->USE_RELATIVE_VELOCITIES) {
            // jbm:Add average relvel suppression
            p *= 1.0 - A_VCB_PM * exp(-pow(log(k / KP_VCB_PM), 2.0) /
                                      (2.0 * SIGMAK_VCB_PM * SIGMAK_VCB_PM));
        }
```

（`src/py21cmfast/src/cosmology.c:273-296`。）

两处必须知道的细节：

- **$k=0$ 直接返回零**。$1/k^{3}$ 在那里发散，而整盒的平均密度本来就不贡献方差——返回零不是取巧，是物理上正确的那一端。
- **乘不乘 $k^{2}$ 由转移函数的约定决定**。`POWER_SPECTRUM < 5`（非 CLASS）时才补 $k^{2}$；CLASS 的表自带 $\delta/\zeta$ 的约定，补了反而错。所以同一套宇宙学参数换一个转移函数口径，$P(k)$ 的形状基准一致，但对齐动作只在非 CLASS 那一侧发生。

再往后还有两条附加压制，都单独乘在最后、不改谱形：

- **相对速度**：只在用 CLASS 且开了 `USE_RELATIVE_VELOCITIES` 时生效，形状是一个对数高斯——中心波数 300 Mpc$^{-1}$、宽度 0.9、幅度 0.24（`cosmology.c:28-30` 的三个宏）。它在 $v_{\rm cb}$ 相干尺度对应的那段小尺度上削掉几个百分点，整体归一不动。
- **FDM**：`p *= T_F(k)^2`（`cosmology.c:298-300`），$T_F$ 来自 `fdm.c` 的 Hu–Barkana–Gruzinov 截断，只依赖粒子质量 $m_{22}$。同一个文件里还有 `power_in_k_cdm`（`:310-332`），形状完全相同但**不乘** $T_F$，专门给 FDM 模式算 CDM 参照用。

原初谱那一项在 `primordial_curvature_power_spectrum`（`cosmology.c:237-249`）里：$k_{\rm pivot}=0.05$ 写死在函数体内，幂指数就是 `POWER_INDEX`。

### 3.3 转移函数的六条实现

```c
double transfer_function(double k) {
    switch (matter_options_global->POWER_SPECTRUM) {
        case 0:
            return transfer_function_EH(k);
        case 1:
            return transfer_function_BBKS(k);
        case 2:
            return transfer_function_Efstathiou(k);
        case 3:
            return transfer_function_Peebles(k);
        case 4:
            return transfer_function_White(k);
        case 5:
            return transfer_function_CLASS(k, 1, 0);
        default:
            LOG_ERROR("No such power spectrum defined: %i", matter_options_global->POWER_SPECTRUM);
            Throw(ValueError);
    }
}
```

（`src/py21cmfast/src/cosmology.c:213-231`。）

这是一个分发器，没有"通用"的转移函数：

| 选项 | 实现 | 位置 | 重子修正 |
| :--- | :--- | :--- | :--- |
| 0（默认） | Eisenstein & Hu | `cosmology.c:53-73` | 拟合式自带重子与中微子项 |
| 1 | BBKS | `cosmology.c:76-84` | 有（Sugiyama 1995） |
| 2 | Efstathiou | `cosmology.c:89-97` | 无 |
| 3 | Peebles | `cosmology.c:101-110` | 有（Sugiyama 1995） |
| 4 | White（Davies 等 1985） | `cosmology.c:114-123` | 有（Sugiyama 1995） |
| 5 | CLASS | `cosmology.c:131-211` | 读外部预计算表 |

选哪一支，等于选定小尺度端被压掉多少。五条解析拟合式都只依赖 $\Omega_m$、$\Omega_b h^{2}$、$h$ 与声学尺度一类的量，形态类似（对数因子乘幂律），差别在幂律的系数；CLASS 那一支完全不同，它把波数交给预计算样条，真正的物理早在上游的玻尔兹曼求解里算完了。

CLASS 那一支还有一处外推，值得单独记：

```c
    if (k > kclass[size_density - 1]) {  // k>kmax
        ...
        if (flag_dv == 0) {  // output is density
            return eh_ratio_at_kmax * transfer_function_EH(k) * k * k;
        }
```

（`src/py21cmfast/src/cosmology.c:179-193`。）超出预计算表最大波数时，用 EH 折回并乘一个在 $k_{\max}$ 处对齐的比值，密度一侧还要补 $k^{2}$——又把 §3.2 那条约定用了一次。相对速度一侧改用对数-对数线性外推。也就是说，**CLASS 模式下 EH 并没有被真正弃用**，它在高 $k$ 端始终是后备。

### 3.4 $\sigma$ 表怎么采

$\sigma(R)$ 不走解析式，而是逐点积分后采成表：

```c
        for (i = 0; i < N_MASS_INTERP; i++) {
            Mass = exp(Sigma_InterpTable.x_min + i * Sigma_InterpTable.x_width);
            Sigma_InterpTable.y_arr[i] = sigma_z0(Mass);
            dSigmasqdm_InterpTable.y_arr[i] = log10(-dsigmasqdm_z0(Mass));
            // FDM: build CDM-reference σ and dsigmadm tables in parallel
            if (matter_options_global->FDM) {
                Sigma_InterpTable_CDM.y_arr[i] = sigma_z0_pre(Mass);
                dSigmasqdm_InterpTable_CDM.y_arr[i] = log10(-dsigmasqdm_z0_pre(Mass));
            }
        }
```

（`src/py21cmfast/src/interp_tables.c:1172-1181`；函数是 `initialiseSigmaMInterpTable`，`:1143-1197`。）

三件事：

- **质量轴是对数均匀的**（`x_width = (ln M_max - ln M_min)/(N_MASS_INTERP-1)`，`:1158`）。质量跨好几个量级，线性取点会把小质量端挤成一堆。
- **方差导数取对数存放**（`log10(-dσ²/dM)`）。导数物理上是负数（$\sigma^{2}$ 随 $M$ 单调下降），先取负号再取对数，插值回小质量端才不丢精度。取用时必须把符号与指数还原。
- **FDM 时并行填一份 CDM 参照**，把 FDM 的压制写成相对 CDM 的比值，而不是绝对量。这样压制因子与归一方式解耦。

表填完还有一道体检：任何一点出现 Inf 或 NaN 就抛 `TableGenerationError`（`interp_tables.c:1184-1196`）。指望"插值会把坏点抹平"是不行的。

逐点积分的口径在 `sigma_z0`（`cosmology.c:398-433`）：GSL 的 `qag` 自适应求积、61 点高斯规则，下限 $10^{-99}/R$、上限 $350/R$，相对容差取 `FRACT_FLOAT_ERR * 10`。上下限都跟着 $R$ 缩放，意味着不同质量点的积分区间是同一段对数区间平移过去的。

### 3.5 生长因子与其余宇宙学函数

`dicke(z)`（`cosmology.c:699-737`）归一成 $D(0)=1$，按宇宙模型分三支：

| 分支 | 条件 | 形式 |
| :--- | :--- | :--- |
| Einstein–de Sitter | $\lvert\Omega_m-1\rvert<10^{-4}$ | $1/(1+z)$ |
| 平直 $\Lambda$ | $\Omega_\Lambda>0$、$\Omega_m+\Omega_\Lambda+\Omega_r\approx1$、$w=-1$ | Liddle 等的拟合式，再按 $D(0)$ 归一 |
| 零 $\Lambda$ 开宇宙 | $\Omega_{\rm tot}\le1$、$\Omega_\Lambda\approx0$ | Peebles 的解析式 |
| 其余 | 含 $w\neq-1$ | 抛错（注释里的 quintessence 分支没有实现） |

围绕它的一圈辅助函数各自带一个"只对某类模型成立"的前提，列在一起看比较清楚：

| 函数 | 位置 | 要注意的地方 |
| :--- | :--- | :--- |
| `ddicke_dz` | `cosmology.c:615-619` | 前向差分，步长 $10^{-10}$ |
| `dtdz` | `cosmology.c:740-749` | 含 $\sqrt{\Omega_\Lambda/\Omega_m}$，$\Omega_\Lambda=0$ 时除零 |
| `ddickedt` | `cosmology.c:753-796` | 当前走数值差分（`:759` 提前返回）；其后的解析式是不可达的死代码 |
| `hubble` | `cosmology.c:799-802` | 和里**没有** $\Omega_k(1+z)^{2}$ 项，曲率不进哈勃率 |
| `omega_mz` | `cosmology.c:648-652` | 分母含 $\Omega_r(1+z)^{4}$ 与 $\Omega_k(1+z)^{2}$，与 `hubble` 口径不完全一致 |
| `deltac_nonlinear` | `cosmology.c:658-662` | Bryan & Norman 1998 拟合式 |
| `TtoM` | `cosmology.c:671-687` | 温度到质量的换算，内部调 `omega_mz` 与 `deltac_nonlinear` |
| `M_J_WDM` | `cosmology.c:600-613` | 粒子质量 2 keV、$g_x=1.5$、$fudge=60$ 全写死；不受任何参数驱动 |
| `MtoR` / `RtoM` | `cosmology.c:622-645` | 只认 `FILTER` 0（顶帽）与 2（高斯），其余抛错 |

`MtoR` 与 `RtoM` 只写两支不是遗漏：`matter_options.FILTER` 在参数侧就被限定成 `spherical-tophat` 与 `gaussian`，`sharp-k` 被校验器挡在外面（`wrapper/inputs.py:670-673`）。C 端的两支正好对应参数侧的两支。

## 四、参数

### 4.1 画布上唯一的参数：$A_s$

本模块的参数卡上只有 $A_s$：原初曲率扰动的振幅，也就是功率谱的整体高度。它往下走两条路——一条直接定 $\sigma(R)$，从而定晕质量函数与坍缩分数的绝对水平；另一条定初始密度场的涨落幅度，经引力演化传到速度场与电离场。它与 $\sigma_8$ 表达的是同一个自由度，输入侧两者只能取一（`wrapper/inputs.py:460-466` 会在同时给定时报错）。幅度调大，全链的源都跟着变强，所以它在参数面上通常被宇宙学观测钉住，不参与天文参数的扫描。

### 4.2 定谱形却不挂标签的宇宙学量

下面这些量确实改这块的输出，但按参数归属表它们落到的成员不在本块——它们挂在晕质量函数或更下游的量上。读这块的结果时要知道它们在场：

| 量 | 在这块改什么 |
| :--- | :--- |
| `OMm` | 同时进 `omhh`、质量份额、窗函数与生长因子，改的是整条 $\sigma(M)$ 的斜率与形状 |
| `OMb` | 进 EH 的重子项与各拟合式的重子修正，主要动转折附近 |
| `OMn` | 进 EH 的中微子项（`f_nu`），压制小尺度 |
| `hlittle` | 出现在 $h$、$\Omega h^{2}$ 与 $M\leftrightarrow R$ 的换算里，是口径量，改了要整体重读 |
| `POWER_INDEX` | 原初谱的斜率 $n_s$，直接改大尺度端 |
| `m22` | FDM 模式下经 $T_F(k)$ 截断小尺度；不开 FDM 时完全不进链 |
| `OMk`、`OMr`、`OMtot`、`wl` | 只经生长因子进入；前三个也出现在各分支的判定条件里 |

$m_{22}$ 值得强调一句：它**不是**在 `cosmology.c` 里读的，而是在 `fdm.c` 的 `T_F` 里读，再作为乘数进 `power_in_k`。在本块做代码检索找不到它，容易误判它没用。

### 4.3 归一方式：由 `USE_SIGMA_8` 决定

$A_s$ 与 $\sigma_8$ 是同一个自由度的两种写法，选哪一种由 `matter_options.USE_SIGMA_8` 定，落点就是 `init_ps` 的最后一步：

```c
    if (cosmo_tables_global->USE_SIGMA_8) {
        ...
        cosmo_consts.sigma_norm = 1;
        cosmo_consts.sigma_norm = pow(cosmo_tables_global->ps_norm / sigma_z0(RtoM(Radius_8)), 2);
    } else {
        ...
        cosmo_consts.sigma_norm = 2.0 * M_PI * M_PI;
    }
```

（`src/py21cmfast/src/cosmology.c:557-583`。）

- **用 $\sigma_8$ 时**，先令 $\sigma_{\rm norm}=1$，用它算一次 $R_8=8/h$ Mpc 处的方差，再反解 $\sigma_{\rm norm}=[\sigma_8/\sigma_{z=0}(R_8)]^{2}$。**第一步把 $\sigma_{\rm norm}$ 置 1 是必须的**：这一步里的 `sigma_z0` 会调 `power_in_k`，而 `power_in_k` 又乘 $\sigma_{\rm norm}$；不先置 1，反解出的归一就是错的。这是自洽性要求，不是随手写的初值。
- **用 $A_s$ 时**直接取 $2\pi^{2}$，原初曲率谱在枢纽尺度上精确等于 $A_s$。

同一套参数换归一方式，$\sigma(M)$ 的数值会变，谱形不变；反过来，两种方式给出同一个物理谱时，$A_s$ 与 $\sigma_8$ 之间存在一一对应。

### 4.4 在这块不起作用的东西

- **相对速度**的压制系数（300、0.24、0.9）是写死的宏，不受参数控制；开关只有 `USE_RELATIVE_VELOCITIES`，而它要求 `POWER_SPECTRUM == 5`（`wrapper/inputs.py:697` 的校验器强制这一点），所以非 CLASS 口径下这条压制根本不会执行。
- **`M_J_WDM`** 里的粒子质量与自由度都写死，不随 $m_{22}$ 变——名字里带 WDM，参数面上却没有驱动它的旋钮。
- **`ddickedt` 的解析分支**不可达（§3.5），所以"解析式与数值差分不一致"这类猜测不成立，当前就是数值差分。

## 五、陷阱

**一、$k^{2}$ 只在非 CLASS 一侧补。** 见 §3.2、§3.3：非 CLASS 的拟合式趋于 1、CLASS 的表趋于 $k^{2}$，两处约定不同。手写比较或另写一份功率谱时漏掉这个因子，小尺度端会差一个 $k^{2}$。

**二、归一常数不是"用了 $\sigma_8$ 就取 $\sigma_8$"。** 它是由 $\sigma_8$ 反解出的平方比值（§4.3）；代码里那个先置 1 的初值是自洽性的前提，删掉会静默给出错的归一。

**三、生长因子只认三种宇宙。** $w\neq-1$ 直接抛错，注释里的 quintessence 分支没有实现（§2.3、§3.5）。改 `wl` 不一定得到"另一种生长"，可能只是报错。

**四、`hubble` 里没有曲率项。** 与 `omega_mz` 的分母口径不一致（§3.5）。走非平直宇宙时，两个函数给出的膨胀率不是同一件事。

**五、`dtdz` 需要 $\Omega_\Lambda\neq0$。** 它含 $\sqrt{\Omega_\Lambda/\Omega_m}$；零 $\Lambda$ 的宇宙在这一支上除零。

**六、FDM 的压制是相对 CDM 的比值。** $\sigma$ 表同时存两份（§3.4），下游取哪一份决定了压制有没有被算进去。只看见一份表就断言"FDM 没生效"，是看错了对象。

**七、$\mathrm d\sigma^{2}/\mathrm dM$ 存的不是原值。** 表里是 `log10(-dσ²/dM)`，符号与指数都要还原（§3.4）。

**八、$m_{22}$ 不在本块的文件里。** 它由 `fdm.c` 读（§4.2），在本块检索不到。

**九、`sigma_z0` 的积分上下限随 $R$ 缩放。** 换了 `FILTER` 或改了 $M\leftrightarrow R$ 口径，积分区间跟着动；截断位置的变化会以非平凡的方式改小质量端的 $\sigma$。

**十、表的体检会拦下坏点。** 出现 Inf/NaN 直接抛错（§3.4），不会悄悄算下去。看到 `TableGenerationError`，先查参数是否落到了极端值。

### 一份最小检查清单

- 看谱之前先确认 `POWER_SPECTRUM`：它决定要不要补 $k^{2}$、以及相对速度压制会不会执行。
- 归一方式看 `USE_SIGMA_8`：它决定 $A_s$ 是直接进链，还是被 $\sigma_8$ 反解替代。
- 改了 `OMm`、`POWER_INDEX`、`hlittle` 这类量，先怀疑谱形，再怀疑别处。
- 怀疑小尺度被压过头，先看是不是开了 FDM（$m_{22}$）或相对速度，再看转移函数口径。
- 拿到 `TableGenerationError`，先查有没有把某个份额设到零，或质量区间取到了极端。

## 六、σ(R) / Δ²(k) · 物质功率谱与 σ(R)

它是这块的头号输出，也是下游真正要用的那张表。物理上是物质密度对比按波数的分布；写成无量纲形式，$\Delta^{2}(k)=k^{3}P_m(k)/2\pi^{2}$ 就是每单位对数波数贡献的方差，在 $k\sim0.1\,h\,\mathrm{Mpc}^{-1}$ 附近达到峰值，往两端都下降。把它在球面窗上积分，就得到尺度 $R$ 内的平滑方差 $\sigma(R)$。

代码里有两条并行的求值路径：

- `power_in_k`（`cosmology.c:273-303`）给逐点的 $P_m(k)$；
- `initialiseSigmaMInterpTable`（`interp_tables.c:1143-1197`）在对数质量轴上逐点调 `sigma_z0`（`:398-433`）与 `dsigmasqdm_z0`（`:450-484`），把结果采成 $\sigma(M)$ 与 $\mathrm d\sigma^{2}/\mathrm dM$ 两张表，供晕质量函数反复插值取用。

**它是全链唯一一处"线性理论直接给答案"的量。** 归一常数把它整体定标（`sigma_norm`），其余全由宇宙学参数与转移函数定下；红移只以 $D^{2}(z)$ 进入，不参与形状。所以任意红移的谱都只是同一条谱的倍数——看不到形状随时间演化，要形状变化必须改参数。

**它的局限是线性区。** 波数更大、已经进入非线性的一段，这条谱只是线性外推，真实功率在那里的形态由引力与塌缩改写。下游把非线性当作一个独立的物理过程处理（引力演化那一块），而不是在这里塞进去。

论文出处：本对象没有登记的论文节号；它依赖的 EH、BBKS 等转移函数的文献出处见文末表，全部来自代码注释。

## 七、T(k) · 物质转移函数

它给的是谱形，不给振幅、也不给红移演化。物理上是辐射-物质等密度之后各尺度增长的差异：进视界早、被辐射拖住的模长得慢，于是物质功率谱在大尺度保留原初斜率、在小尺度被压低并转成更陡的下降。整条信息压进一条一维函数 $T(k)$，与红移无关——时间演化全留给生长因子。

代码上它是一个分发器（`cosmology.c:213-231`），把波数转给六条实现之一（§3.3）。选哪一支，等于选定小尺度端被压掉多少；大尺度斜率由宇宙学参数与 `POWER_INDEX` 另定，非线性尺度完全不在它的描述范围内。

**两处口径要记牢。** 其一，非 CLASS 的拟合式在 $k\to0$ 时趋于 1、CLASS 的表趋于 $k^{2}$，所以调用方要按口径补 $k^{2}$（§3.2）。其二，CLASS 模式并不是"完全不碰解析式"——超出预计算表最大波数时，它用 EH 折回并乘一个对齐比值（§3.3），EH 的常数因此在 `init_ps` 里无条件算好。

论文出处：本对象没有登记的论文节号；六条实现的文献出处见文末表，全部来自代码注释。

## 八、代码地图

| 位置 | 是什么 |
| :--- | :--- |
| `cosmology.c:53-73` | `transfer_function_EH`：Eisenstein & Hu 拟合式（默认口径） |
| `cosmology.c:76-123` | BBKS / Efstathiou / Peebles / White 四条拟合式 |
| `cosmology.c:131-211` | `transfer_function_CLASS`：读预计算样条，含高 $k$ 的 EH 外推 |
| `cosmology.c:213-231` | `transfer_function`：按 `POWER_SPECTRUM` 的六路分发器 |
| `cosmology.c:237-249` | `primordial_curvature_power_spectrum`：$k_{\rm pivot}=0.05$ 写死在这里 |
| `cosmology.c:273-303` | `power_in_k`：三段相乘、$k^{2}$ 约定、相对速度与 FDM 两条附加压制 |
| `cosmology.c:310-332` | `power_in_k_cdm`：同形但不乘 $T_F$，FDM 的 CDM 参照 |
| `cosmology.c:339-361` | `power_in_vcb`：相对速度的谱，只支持 CLASS |
| `cosmology.c:385-433` | `dsigma_dk` / `sigma_z0`：GSL 求积得 $\sigma(R)$ |
| `cosmology.c:439-484` | `dsigmasq_dm` / `dsigmasqdm_z0`：方差的导数 |
| `cosmology.c:487-531` | `TFset_parameters`：EH 的常数（声学尺度、`alpha_nu`、`beta_c`） |
| `cosmology.c:536-586` | `init_ps`：总装与归一（块锚） |
| `cosmology.c:589-596` | `free_ps`：释放 CLASS 的插值器 |
| `cosmology.c:600-613` | `M_J_WDM`：写死参数的金斯质量 |
| `cosmology.c:622-645` | `MtoR` / `RtoM`：质量与半径的换算，只认两支 `FILTER` |
| `cosmology.c:648-687` | `omega_mz` / `deltac_nonlinear` / `TtoM` |
| `cosmology.c:699-737` | `dicke`：生长因子的三支实现 |
| `cosmology.c:740-796` | `dtdz` / `ddickedt` |
| `cosmology.c:799-808` | `hubble` / `t_hubble` / `drdz` |
| `interp_tables.c:1143-1197` | `initialiseSigmaMInterpTable`：$\sigma$ 两张表（含 FDM 参照与体检） |
| `fdm.c:35-41` | `T_F`：FDM 截断，读 $m_{22}$ |
| `InitialConditions.c:619` | `init_ps` 的调用点 |

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**σ(R) / Δ²(k) · 物质功率谱与 σ(R)**

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| 气体 WDM 类比的有效金斯质量 | Barkana+2001（Eq. 10） | corresponding to the gas analog of WDM ; eq. 10 in Barkana+ 2001 | `src/py21cmfast/src/cosmology.c:598-599` | 无正文（本地只有代码注释与 docstring） |
| 非线性过密度 $\Delta_{\rm vir}$ 的拟合式 | Bryan & Norman 1998 | fitting formula from Bryan & Norman 1998 | `src/py21cmfast/src/cosmology.c:657-657` | 无正文（本地只有代码注释与 docstring） |
| 维里温度与质量的换算 $T \leftrightarrow M$ | Barkana & Loeb 2001 | from Barkana & Loeb 2001 | `src/py21cmfast/src/cosmology.c:665-666` | 无正文（本地只有代码注释与 docstring） |
| Dicke 生长函数（含 $\Lambda$ 与 quintessence 情形） | Peebles 1980（pg.53, eq. 11.16）；Liddle et al（astro-ph/9512102, eqs. 6-8）；Wang et al（astro-ph/9804015） | References: Peebles, "Large-Scale...", pg.53 (eq. 11.16). Includes omega<=1 / Nonzero Lambda case from Liddle et al, astro-ph/9512102, eqs. 6-8. / and quintessence case from Wang et al, astro-ph/9804015 | `src/py21cmfast/src/cosmology.c:693-695` | 无正文（本地只有代码注释与 docstring） |
| 平直 $\Lambda$ 宇宙里的 $\Omega_m(z)$ 分支 | Liddle et al（astro-ph/9512102） | it is taken from liddle et al. | `src/py21cmfast/src/cosmology.c:710-710`（`:768` 同句） | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：气体 WDM 类比的有效金斯质量；非线性过密度 $\Delta_{\rm vir}$ 的拟合式；维里温度与质量的换算 $T \leftrightarrow M$；Dicke 生长函数（含 $\Lambda$ 与 quintessence 情形）；平直 $\Lambda$ 宇宙里的 $\Omega_m(z)$ 分支。

**T(k) · 物质转移函数**

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| EH 转移函数 | Eisenstein & Hu 1999（ApJ 511, 5） | FUNCTION TFmdm is the power spectrum transfer function from Eisenstein & Hu ApJ, 1999, 511, 5 | `src/py21cmfast/src/cosmology.c:52-52` | 无正文（本地只有代码注释与 docstring） |
| BBKS 转移函数 | Bardeen et al 1986（ApJ 304, 15）；Sugiyama 1995（ApJS 100, 281） | Bardeen et al 1986 ApJ, 304, 15 / with baryon correction from Sugiyama 1995 ApJS 100, 281 | `src/py21cmfast/src/cosmology.c:74-75` | 无正文（本地只有代码注释与 docstring） |
| Efstathiou 转移函数 | Efstathiou et al 1992（MNRAS 258, 1）；Bond & Efstathiou 1984（对照） | Efstathiou et al 1992 MNRAS 258, 1 / NOTE: different from Bond & Efstathiou 1984 | `src/py21cmfast/src/cosmology.c:86-87` | 无正文（本地只有代码注释与 docstring） |
| Peebles 转移函数 | Peebles 1980（p.626）；Sugiyama 1995 | Peebles 1980 p.626 / with baryon correction from Sugiyama 1995 ApJS 100, 281 | `src/py21cmfast/src/cosmology.c:99-100` | 无正文（本地只有代码注释与 docstring） |
| 白噪声（White）转移函数 | Davies, Efstathiou, Frenk & White 1985（ApJ 292, 371）；Sugiyama 1995 | Actually from Davies, Efstathiou, Frenk & White 1985 ApJ 292, 371 / with baryon correction from Sugiyama 1995 ApJS 100, 281 | `src/py21cmfast/src/cosmology.c:112-113` | 无正文（本地只有代码注释与 docstring） |
| FDM/WDM 转移函数的三个系数 | Bode et al. 2000 | Epsilon parameter in Bode et al. 2000 trans. funct. | `src/py21cmfast/src/cosmology.c:23-25` | 无正文（本地只有代码注释与 docstring） |
| FDM 转移函数的截断 | Hu, Barkana & Gruzinov 2000（PRL 85, 1158, Eq. 8-9） | FDM transfer function -- Hu, Barkana & Gruzinov (2000) / Reference: Hu, Barkana & Gruzinov (2000), Eq. (8)-(9). | `src/py21cmfast/src/fdm.h:4-4`；`src/py21cmfast/src/fdm.c:8-10, 32-32` | 无正文（本地只有代码注释与 docstring） |
| 转移函数选项的 docstring | Eisenstein & Hu 1999；Bardeen et al. 1986；Efstathiou et al. 1992；Peebles 1980；White 1985 | EH : Eisenstein & Hu 1999 / BBKS: Bardeen et al. 1986 / EFSTATHIOU: Efstathiou et al. 1992 / PEEBLES: Peebles 1980 / WHITE: White 1985 | `src/py21cmfast/wrapper/inputs.py:581-585` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：EH 转移函数；BBKS 转移函数；Efstathiou 转移函数；Peebles 转移函数；白噪声（White）转移函数；FDM/WDM 转移函数的三个系数；FDM 转移函数的截断；转移函数选项的 docstring。