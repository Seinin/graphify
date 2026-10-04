# 宇宙学背景与物质功率谱

这一块是整条链的底料：把原初那条近似尺度不变的曲率扰动谱搬到物质时代，得到物质密度对比按波数的分布，再把它积成任意尺度内的平滑方差。转移函数负责形状——进视界早的模被辐射拖住、长得慢，于是小尺度端被压低；振幅则靠一个归一常数一次给定，红移只把整条谱乘上生长因子的平方，不碰形状。

两个成员一横一纵：转移函数是一维的 $T(k)$，功率谱 $P_m(k)$ 与它积出的 $\sigma(R)$ 是下游真正要用的那张表。它们的地位在链上很特殊——初始密度场按这份谱抽样（振幅由谱给、相位随机），晕质量函数与后面所有源项的尺度依赖都从 $\sigma(R)$ 出发；而它只描述线性区，波数更大、已经进入非线性的那一段由引力与塌缩接手。

## σ(R) / Δ²(k) · 物质功率谱与 σ(R)

### 物理

物质功率谱把原初曲率扰动的近似尺度不变谱搬到物质时代：乘上转移函数对各尺度的压制，再按今天的振幅归一，得到的是物质密度对比按波数的分布。写成无量纲形式，$\Delta^{2}(k)$ 就是每单位对数波数贡献的方差，它在 $\sim 0.1\,h\,\mathrm{Mpc}^{-1}$ 附近达到峰值，往大尺度与小尺度两端都下降。

公式是三段相乘——原初谱的幂律、转移函数的平方与归一常数，除以 $k^{3}$ 只是把曲率谱的约定换成密度谱。前提是线性理论下的物质功率谱：转移函数只带辐射-物质等密度之后的重力增长，相对速度这类额外压制是单独乘上去的，不进转移函数本身，也不在这里现算。

驱动它的是宇宙学参数、原初谱与归一方式；红移不改变谱形，只让整条谱乘上生长因子的平方。同一份谱在球面窗上积分给出尺度 $R$ 内的平滑方差 $\sigma(R)$，那是质量方差与质量函数唯一的物理输入，它还会被采成插值表供下游反复查用。

数学上它是精确线性的：对振幅齐次，换归一方式只是一个乘数，谱形则由转移函数与宇宙学参数完全定下，没有参数简并。它也不是随时间演化的量，红移只以生长因子的平方进入，所以任意红移的谱都只是同一条谱的倍数。

它是这条链上所有结构的起点：初始密度场按它抽样，晕质量函数、滤过的恒星形成率与电离、加热的源项都从它导出的方差出发。局限在它只描述线性区——波数更大、已经进入非线性的那一段由引力与塌缩改写，谱在那里只是线性外推。

$$P_m(k)=\frac{\sigma_{\rm norm}}{k^{3}}\,\mathcal{P}_\zeta(k)\,T^{2}(k),\qquad \Delta^{2}(k)=\frac{k^{3}}{2\pi^{2}}P_m(k)$$

### 代码解析

求值入口是 `cosmology.c` 的 `power_in_k`（273–296 行），它把三段乘起来：原初谱、转移函数的平方、归一常数，再除 $k^3$。两处细节值得留意。其一是 $k=0$ 直接返回零——$1/k^3$ 在那里发散，而整盒的平均密度本来就不贡献方差。其二是转移函数的**约定**：非 CLASS 的几条拟合式在 $k\to0$ 时趋于 1，要补乘 $k^2$ 才能与 CLASS 的归一约定对上（代码注释写了缘由），所以同一套宇宙学参数换一个转移函数口径，$P(k)$ 的数值形状不变、但归一基准要对齐一次。

相对速度的压制单独乘在最后：只在用 CLASS 且开启相对速度时生效，形状是一个对数高斯——中心波数与宽度各一个常数，作用是在 $v_{cb}$ 相干尺度对应的那一段小尺度上削掉几个百分点，整体归一不动。

$\sigma(R)$ 不走积分公式，而是采成表：`interp_tables.c` 的 `initialiseSigmaMInterpTable`（1172–1181 行）在质量的对数轴上均匀取点，一次把 $\sigma(M)$ 与 $\mathrm d\sigma^2/\mathrm dM$ 两张表都填好，后者取对数存放——它跨好几个量级，取对数再插值才不至于在小质量端丢精度。开 FDM 时还会并行填一份 CDM 参照值，为的是把 FDM 的压制写成相对 CDM 的比值，而不是绝对量。

### 工程

- `src/py21cmfast/src/cosmology.c:273-296`

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

- `src/py21cmfast/src/interp_tables.c:1172-1181`

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

- 输入：$T(k)$、原初谱与归一方式（$\sigma_8$ 或 $A_s$）、红移 $z$
- 产出：$P_m(k)$ 与无量纲的 $\Delta^{2}(k)$，并给出 $\sigma^{2}(R)$ 的积分输入

### 参数语境

#### A_s

原初曲率扰动的振幅，是功率谱的整体高度。它经两条路往下走：一是直接定 $\sigma(R)$，从而定晕质量函数的归一与坍缩分数（源项的绝对水平）；二是定初始密度场的涨落幅度，经引力演化传到速度场与电离场。它与 $\sigma_8$ 表达的是同一个自由度——本页的输入就是"归一方式（$\sigma_8$ 或 $A_s$）"，两者取一；归一调大，全链的源都跟着变强，因此它在参数面上通常被宇宙学观测钉住、不参与天文参数的扫描。

## T(k) · 物质转移函数

### 物理

转移函数描述辐射-物质等密度之后各尺度增长的差异：进视界早、被辐射拖住的模长得慢，于是物质功率谱在大尺度保留原初斜率、在小尺度被压低并转成更陡的下降。它本身只依赖波数，与红移无关——时间演化全部留给生长因子。

拟合式是一个对数因子乘一个多项式幂：无量纲化的 $q$ 把波数按形状参数折算，多项式那一段负责小尺度端的压制斜率。前提是线性、无重子压力的无碰撞物质：转移函数不区分重子与暗物质，重子声学振荡只在更精细的口径里才出现；取解析拟合还是直接读外部预计算表，给的是同一条 $T(k)$。

它只给谱形，不给振幅、也不给红移演化，全部信息压进一条一维函数，既无参数简并也无非局域性。下游的功率谱靠它定小尺度端，所以选哪套转移函数等于选定小尺度功率的多少；大尺度斜率与整体归一由宇宙学参数与谱指数另定，非线性尺度则完全不在它的描述范围内。

$$T(k)=\frac{\ln(1+2.34q)}{2.34q}\left[1+3.89q+(16.1q)^{2}+(5.46q)^{3}+(6.71q)^{4}\right]^{-1/4},\qquad q=\frac{k}{\Gamma\,h\ \mathrm{Mpc}^{-1}}$$

### 代码解析

`cosmology.c` 的同名函数（213–231 行）是一个分发器，没有"通用"的转移函数：它按 `POWER_SPECTRUM` 选项把波数转给六条实现之一——Eisenstein–Hu、BBKS、Efstathiou、Peebles、White 五条解析拟合，以及 CLASS 那条（读外部预计算表）。上面写的公式是 BBKS 那一支的形状，其余各支的多项式系数不同、对数因子相同。

看这段的意义在于口径而非算法：选哪一支，等于选定小尺度端被压掉多少；走 CLASS 那一支时这条函数只是把波数交给预计算表，真正的物理早在上游的玻尔兹曼求解里算完了。

### 工程

- `src/py21cmfast/src/cosmology.c:213-231`

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

- 输入：宇宙学参数、原初谱振幅与指数、所选转移函数口径（或外部预计算表）
- 产出：$T(k)$ 表：$k$ 网格与逐点的值

### 参数语境

本篇名下没有参数标签：$T(k)$ 由宇宙学参数、原初谱指数与所选转移函数口径决定，或者直接读入外部预计算表。这些量在参数面里属于宇宙学一节（不是天文参数），也不被任何开关影响；换口径会让 $k$ 转折附近的形状变化，进而改 $\sigma(R)$ 与晕质量函数。

## 参数

本模块携带 1 个参数（与画布上这块的「参数」卡同一份清单；类别是 `inputs.py` 里的结构名）。下面逐条写它在代码里做什么；同一个参数**在某个成员那一步里**的语境与落点，写在那个成员节的「参数语境」里。

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `A_s` | `CosmoParams` | 原初曲率扰动的振幅，也就是功率谱的整体高度。它经两条路往下走：一条直接定 $\sigma(R)$，从而定晕质量函数的归一与坍缩分数，也就是所有源项的绝对水平；另一条定初始密度场的涨落幅度，经引力演化传到速度场与电离场。它与 $\sigma_8$ 表达的是同一个自由度——输入侧的「归一方式」两者取一，因此它在参数面上通常被宇宙学观测钉住、不参与天文参数的扫描。 |

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
