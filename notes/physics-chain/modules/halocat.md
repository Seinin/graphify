# 晕目录与质量函数

这一块回答两个问题：多大的晕才配算源，以及每个质量区间里有多少个这样的晕。回答分三步——物质功率谱经窗积分变成质量方差，多重数口径把它折成数目，再把"气体要被引力留住并开始原子冷却"的温度门槛换算成质量下限。它只给出目录与门槛，晕有多亮留给下一块。

简并也集中在这里：质量下限、多重数口径与塌缩阈值在对着观测量调参时互相纠缠——门槛抬高可以让电离效率调低来部分抵消，单看观测量分不开两者。所以这一块的量几乎都不是"算出来就一定对"的物理量，而是带着口径选择与参数权衡的约定，读的时候要连着口径一起看。

## 质量函数的算法 · 把 dn/dM 算出来

### 物理

这一条不是新物理，而是"把晕质量函数算出来"的实现口径：先把物质功率谱按所选转移函数造出来，做窗积分得质量方差，再按选定的多重数公式取指数骨架；塌缩阈值取球塌缩值并叠上椭圆塌缩的修正。

口径一换，多重数只换形状因子，量纲骨架（单位质量区间的数目正比于平均密度除以质量、再乘对数质量的对数斜率）不变，同一张方差表供所有口径共用。所以它改变的是"源有多少"这条线的具体形状，而不是它的物理来源。

选择哪套口径等于同时定了小尺度与大质量端的数目，因此它和塌缩阈值、最小晕质量在对着观测量调参时是简并的。它本身不含时间积分，红移只通过生长因子与阈值进入。

$$\nu f(\nu)=A\sqrt{\frac{2a\nu}{\pi}}\left[1+(a\nu)^{-p}\right]e^{-a\nu/2}$$

### 代码解析

`hmf.c` 的 `unconditional_hmf`（502–524 行）是一处分发：按 `HMF` 选项在 Press–Schechter、Sheth–Tormen、Watson FOF（两个版本）、Delos 五条实现里挑一条（编号 0–4），挑完再乘 FDM 的压制因子。接口统一在 $\ln M$ 上求值，代码注释写了原因——多数口径本来按 $M$ 定义，而积分与查表都走对数质量，统一到 $\ln M$ 省掉每次的换算。

值得记住的是这个分发位置：它决定了上游所有"源有多少"的调用都从这里过，换口径不需要改调用方。开 FDM 时那个压制因子与宇宙学那一块填的 CDM 参照表是配套的，压制是按相对 CDM 的比值给的。

### 工程

#### 一处分发把五套口径收在一处：`unconditional_hmf`

- 落点：`src/py21cmfast/src/hmf.c:502-524`

```c
double unconditional_hmf(double growthf, double lnM, double z, int HMF) {
    // most of the UMFs are defined with M, but we integrate over lnM
    // NOTE: HMF > 4 or < 0 gets caught earlier, so unless some strange change is made this is fine
    double result;
    if (HMF == 0) {
        result = dNdlnM_PS(growthf, lnM);
    } else if (HMF == 1) {
        result = dNdlnM_st(growthf, lnM);
    } else if (HMF == 2) {
        result = dNdlnM_WatsonFOF(growthf, lnM);
    } else if (HMF == 3) {
        result = dNdlnM_WatsonFOF_z(z, growthf, lnM);
    } else if (HMF == 4) {
        result = dNdlnM_Delos(growthf, lnM);
    } else {
        LOG_ERROR("Invalid HMF %d", HMF);
        Throw(ValueError);
    }
    // FDM: apply Schive+2016 HMF suppression factor
    if (matter_options_global->FDM) {
        result *= dndm_FDM(exp(lnM));
    }
    return result;
}
```

逐段看：

1. **分发**：`HMF` 是选项编号，0–4 依次是 Press–Schechter、Sheth–Tormen、Watson FOF（按质量那版）、Watson FOF（按红移那版）、Delos。五个分支各自一个函数、各自一套常数，调用方只认这个统一入口——换口径不用改任何调用点，这是"实现口径"这一条能被单独画成一个对象的原因。
2. **为什么在 $\ln M$ 上求值**：函数头那行注释写了原因——多数口径本来按 $M$ 定义，而积分与查表都走对数质量，统一到 $\ln M$ 省掉每次调用处的换算。`dNdlnM_st` 这种名字里的 `lnM` 就是这条约定的落点。
3. **越界怎么处理**：注释说明非法编号在上游已被挡掉，所以这里不设静默兜底，真出现就抛错——口径选择写错时不许悄悄按某一套算下去。
4. **FDM 的压制**：最后一项乘的是 Schive+2016 那套半解析压制因子，输入是把 `lnM` 取指数换回质量（那个因子按 $M$ 定义）。`FDM` 打开时它作用在**无条件**质量函数上；条件质量函数那一支**不乘**（`hmf.c` 里那段长注释写了理由：条件路径的 FDM 效应由 $\sigma$ 表与阈值的环境调制承担，再乘一次会重复扣减）。

这张表的来源在别处：$\sigma(M)$ 与 $\mathrm d\sigma^{2}/\mathrm d\ln M$ 由物质功率谱经窗积分造出来，供上面五个分支查用。所以这一条的两端是——上游给谱与表，下游按口径查表出数目。

- 输入：$P(k)$（或由宇宙学参数现造）、所选质量函数口径与塌缩阈值
- 产出：$\sigma(M)$ 表与 $\mathrm{d}n/\mathrm{d}M$ 的求值路径

### 参数语境

这一条是算法本身，名下没有自己的参数：下面的宇宙学项都是经 $\sigma(M)$ 表进来的。

#### OMm
物质密度参数（默认 0.31）。它在这条量里的语境是"表的自变量与幅度"：功率谱的归一与窗积分里的平均密度都带它，于是同一套多重数在不同的 OMm 下给出不同的数目。参数矩阵把它挂在这里，是因为 $\sigma$ 表在这段代码的扫描窗口里——实际上它作用在造表那一步（宇宙学与物质功率谱那一块），不在这处分发里。

#### OMb
重子密度参数（默认 0.04897）。经转移函数的形状进表：重子比例改谱的拐点与斜率，$\sigma(M)$ 曲线跟着倾斜。它不改变这处分发的逻辑，换口径与换它的效果因此是可分的——一个改形状因子，一个改表。

#### OMk / OMn / OMr / OMtot
这四个是同一组的一致性项：曲率（默认 0）、中微子（默认 0）、辐射（默认 $9\times10^{-5}$）与总密度（默认 1）。它们各自经几何、自由流与初始条件改 $\sigma(M)$ 表，而在这条量的代码里都看不到；参数矩阵把它们挂上来，是因为扫描窗口覆盖了造表那一段。真要动它们，先动的是功率谱那一块（`matter_power`），这一条只是随之换个表。

#### hlittle
无量纲哈勃常数（默认 0.6774）。同样经表进来：临界密度正比于 $h^{2}$，谱的归一与质量—长度换算都带它。对这条量而言它是一处单位口径，不是一个物理旋钮。

#### POWER_INDEX
原初谱指数（默认 0.965）。它改的是表在小尺度端的倾斜，与上面几项一样不在此处出现。换多重数口径（这里的分发）与换谱指数（表）是两条互不干扰的调节路径，这一点在对着观测量调参时有用。

#### wl
暗能量状态方程（默认 $-1$）。它只改生长因子随红移的演化，而生长因子是这张表在每次调用时乘上去的缩放（`dNdlnM_st` 里那两行），所以它的影响随红移累积。分发这一段本身对它是透明的。

## dn/dM(M,z) · 晕质量函数

### 物理

晕质量函数回答"单位质量区间里有多少个晕"：平均密度除以质量给出量纲，对数区间里的数目由多重数乘上多重数对质量的对数斜率给出。它在源尺度附近是陡降的——质量越大，数目掉得越快。

多重数只依赖塌缩阈值平方与质量方差之比 $\nu$，于是它把宇宙学（方差）与红移（阈值）合成一个变量；指数骨架来自高斯涨落的尾部，形状因子来自所选口径。前提是高斯初始涨落与解析的塌缩阈值，且质量与平滑尺度一一对应。

驱动它的是质量方差 $\sigma(M)$、塌缩阈值与红移。方差由功率谱经窗积分给出，同一张表被所有口径反复查用；红移只通过阈值与生长因子进入，不改变谱形。

在结构上它对阈值与方差是强非线性的——$\nu$ 待在指数里，阈值稍动，数目就指数级改变；但它是局域、无记忆的代数式，也没有参数简并：换口径只换形状因子，量纲骨架不变。

它与最小晕质量一起决定电离光子数与恒星形成率积分的上下限与权重，是"源有多少"里的数目那一半。局限在高斯分布与解析阈值的近似：大质量端的成团、低红移的非线性与重子效应都不在函数形式里，只能靠口径选择与后续反馈吸收。

$$\frac{\mathrm dn}{\mathrm dM}=\frac{\rho_m}{M}\,\nu f(\nu)\,\frac{\mathrm d\ln\nu}{\mathrm d\ln M},\qquad \nu=\frac{\delta_c^{2}(z)}{\sigma^{2}(M)}$$

### 代码解析

`hmf.c` 的 `dNdlnM_st`（269–281 行，Sheth–Tormen 那一支）把公式拆成两步，看代码时值得对照。第一步是从表里取 $\sigma$ 与 $\mathrm d\sigma^2/\mathrm d\ln M$ 并按生长因子缩放：$\sigma\to\sigma D$、导数按 $D^2/(2\sigma)$ 一起换，于是红移只在这两行里进来，谱形本身不动。第二步用塌缩阈值与 $a$ 组成 $\hat\nu$，最后一串乘除就是"多重数 × 量纲骨架"的展开——里面那个 $-\mathrm d\sigma/\mathrm d\ln M$ 正是 $\mathrm d\ln\nu/\mathrm d\ln M$，代码只是没把对数导数写成一个符号。

同一函数在紫外光度函数那边换个用法：`LuminosityFunction.c` 的 `ComputeLF`（259–262 行）先把质量函数乘回 $M$、换成按质量计的密度，再乘上顶帽抑制与占空比、除以换元导数，得到沿绝对星等的分布——物理没变，只是换了自变量。

### 工程

#### 把平方方差与生长因子折进多重数：`dNdlnM_st`

- 落点：`src/py21cmfast/src/hmf.c:269-281`

```c
double dNdlnM_st(double growthf, double lnM) {
    double sigma, dsigmadm, nuhat;
    sigma = EvaluateSigma(lnM);
    dsigmadm = EvaluatedSigmasqdm(lnM);

    sigma = sigma * growthf;
    dsigmadm = dsigmadm * (growthf * growthf / (2. * sigma));

    nuhat = sqrt(SHETH_a) * physconst.delta_c_sph / sigma;

    return -(dsigmadm / sigma) * sqrt(2. / M_PI) * SHETH_A * (1 + pow(nuhat, -2 * SHETH_p)) *
           nuhat * exp(-nuhat * nuhat / 2.0);
}
```

这是 Sheth–Tormen 那一支（口径编号 1）。逐段看：

1. **两张表各查一次**：`EvaluateSigma(lnM)` 取 $\sigma$，`EvaluatedSigmasqdm(lnM)` 取的是 $\mathrm d\sigma^{2}/\mathrm d\ln M$。$\sigma$ 那张表由物质功率谱经窗积分造出来（宇宙学那一块填的），质量函数只查表、不现算积分——所以参数对这条量的影响全部先经过那张表。
2. **红移只在这两行里进来**：$\sigma\to\sigma D$ 与 $\mathrm d\sigma^{2}/\mathrm d\ln M\to(\mathrm d\sigma^{2}/\mathrm d\ln M)D^{2}$ 就是线性生长因子对它们的缩放。表里存的是 $z=0$ 的方差，代码用 `growthf` 把它挪到当前红移；谱形本身没有被改动，这也是"红移只通过生长因子与阈值进入"那句话的落点。注意第二行还顺手除了一个 $2\sigma$：把表里的平方方差的对数导数换回 $\mathrm d\sigma/\mathrm d\ln M$（$\mathrm d\sigma/\mathrm d\ln M=\mathrm d\sigma^{2}/\mathrm d\ln M/(2\sigma)$），后面那一行正好需要这个量。
3. **组出 $\hat\nu$**：`sqrt(SHETH_a)*delta_c_sph/sigma`，即 $\hat\nu=\sqrt{a}\,\delta_c/\sigma=\sqrt{a\nu}$。塌缩阈值取 `physconst` 里的球塌缩值，椭圆塌缩的修正由常数 $a$ 承担——这就是正文里"阈值取球塌缩值再叠椭圆塌缩修正"的写法。
4. **一行就是正文那条式子**：`sqrt(2/π)`、`SHETH_A`、`(1+ν̂^{-2p})` 与 `exp(-ν̂²/2)` 合起来正是 $f(\nu)$（把 $\hat\nu=\sqrt{a\nu}$ 代回去即得 $A\sqrt{2a\nu/\pi}\,[1+(a\nu)^{-p}]e^{-a\nu/2}$）；乘在前面的 $-(\mathrm d\sigma/\mathrm d\ln M)/\sigma$ 是 $\mathrm d\ln\nu/\mathrm d\ln M$ 的一半（$\nu\propto\sigma^{-2}$ 带出来的那个 2 由这半支吸收）。量纲那一半（$\rho_m/M$）不在这个函数里，由调用方乘上来——下面那条落点就是它的调用方。

`hmf.c` 里的 `SHETH_a`、`SHETH_A`、`SHETH_p` 三个常数就是这套口径的 $a$、$A$、$p$；换口径（编号 0、2、3、4）只是把这一个函数换掉，调用方与表都不动。

#### 换个自变量再乘一次：紫外光度函数那一侧的用法

- 落点：`src/py21cmfast/src/LuminosityFunction.c:259-262`

```c
                    dndm = unconditional_hmf(growthf, log(Mhalo_param[i]), z_LF[i_z], mf) *
                           (cosmo_params_global->OMm * RHOcrit) / Mhalo_param[i];
                    log10phi[i + i_z * nbins] = log10(dndm * exp(-(M_TURNs[i_z] / Mhalo_param[i])) *
                                                      f_duty_upper / deriv[i]);
```

同一张质量函数在这里被换个用法，逐段看：

1. **量纲补上**：`unconditional_hmf` 给的是多重数那一半，这里乘 `OMm * RHOcrit / M`，把 $\rho_m/M$ 补成"每单位质量、每单位共动体积里的数目"（`RHOcrit` 是临界密度，$\rho_m={\rm OMm}\cdot\rho_{\rm crit}$）。
2. **两处压制**：`exp(-M_TURNs/M)` 是那个转折质量带来的指数截断（`M_TURNs` 是按红移预抽好的 $M_{\rm TURN}$），`f_duty_upper` 是占空比——原子冷却那一支按 $\exp(-M/M_{\rm crit})$ 算，迷你晕那一支直接取 1。
3. **换成沿绝对星等的分布**：除以 `deriv[i]`（质量对绝对星等的换元导数）之后取 $\log_{10}$，得到 $\log_{10}\phi(M_{UV})$。物理没变，只是自变量从质量换成了星等；下游拟合用的正是这张表，因此质量函数的口径选择最终会体现在紫外光度函数的形状上。

- 输入：$\sigma(M)$、红移 $z$ 与质量函数口径；上游为 hmf_impl、matter_power、initial_density
- 产出：每个质量格的 $\mathrm{d}n/\mathrm{d}M(M,z)$

### 参数语境

#### POWER_INDEX
原初功率谱的谱指数（默认 0.965），在 $\sigma(M)$ 那张表的积分核里出现。它在这条量里的语境是"从很远的地方进来"：质量函数只查表，谱指数影响的是表本身——它把功率谱在小尺度那一段的斜率挪一点，$\sigma(M)$ 曲线随之整体倾斜，于是 $\nu=\delta_c^2/\sigma^2$ 的取值改变，数目按指数响应。改它不需要动质量函数那段代码，但会同时动到所有查这张表的量。

#### OMm
物质密度参数（默认 0.31），在这条量里出两次：一次在 $\sigma(M)$ 表里（功率谱的幅度与形状都带它），一次在调用处补量纲的 $\rho_m/M=\mathrm{OMm}\cdot\rho_{\rm crit}/M$。它同时定 $\nu$ 里的方差与整体归一化，所以调它会成倍地挪动数目。它与 $h$、$\Omega_b$ 一起被宇宙学观测钉得较紧，通常不是这条链上的自由参数。

#### OMb
重子密度参数（默认 0.04897）。它在这条量里不直接出现，作用经功率谱的形状进来：重子比例改变转移函数的拐点位置，$\sigma(M)$ 在源尺度那一带的斜率跟着变，于是同样质量区间的晕数改变。它的调整幅度受原初核合成与大尺度结构约束，实际常用它来微调谱形而不是无量纲幅度。

#### OMk
曲率密度参数（默认 0）。它不改变谱的形状，改的是几何与距离—红移关系、以及生长因子的归一，于是 $\nu$ 里的方差随红移演化的方式被挪动。默认取平坦宇宙（0），只有在做曲率测试时才动它。

#### OMn
中微子密度参数（默认 0）。非零时会在转移函数里压小尺度功率——中微子自由流把 $\sigma(M)$ 在小质量端压下去，于是小晕数目减少。它在这条量里的语境与 $m_{22}$ 类似：改的是谱在小尺度端的幅度，而不是多重数的形状。

#### OMr
辐射密度参数（默认 $9\times10^{-5}$）。它进转移函数的初始条件（辐射—物质相等时刻），改变谱的拐点位置。数值很小，一般由 CMB 温度定住，不单独调。

#### OMtot
总密度参数（默认 1.0，即 OMm + OMk + OMr + OMn 之和）。它在这条量里当一致性约束用：参数组合必须是自洽的（校验会检查各项之和与它相符），所以它不是一个独立旋钮，而是"这套宇宙学闭合"的声明。它若被改，几何与生长因子都会跟着改，影响面与 OMk 一样宽。

#### hlittle
无量纲哈勃常数（默认 0.6774）。它在这条量里管量纲：临界密度正比于 $h^2$，调用处补的 $\rho_m$ 与质量—长度的换算都带它。数密度按 $h^3$ 缩放是这一层的常见约定，所以改它时看上去像"整体平移"，其实是单位换了个口径。

#### wl
暗能量状态方程参数（默认 $-1$）。它改的是暗能量密度随红移的演化，于是生长因子 $D(z)$ 与 $\delta_c$ 的那条缩放不再按 LCDM 走——质量函数里红移的入口只有这两处，所以它的影响随红移单调累积：红移越高，与 LCDM 的差别越大。CMB 与大尺度结构通常把它限定在 $-1$ 附近。

#### ION_Tvir_MIN
电离侧的维里温度门槛（参数面按 $\log_{10}$ 给，默认 4.69897 → $5\times10^4\ \mathrm K$）。它不在质量函数的代码里，而是从**积分的下限**进来：源项那边把 $\mathrm dn/\mathrm dM$ 从 $M_{\min}(z)$ 往上积分，而这个下限由最小晕质量那一篇算出、温度门槛是它的输入。所以它对这条量的语境是"哪一段质量区间参与积分"，而不是改变函数形式。

#### M_TURN
抑制恒星形成的转折质量。在质量函数本身里它不出现，出现在下游的源项里当指数的转折尺度（上面那条落点里 `exp(-M_TURNs/M)` 就是这个因子），以及"质量下限直接取它"的那个开关分支里。对我们这条量来说，它的语境是"分布被拿来用的时候从哪个质量开始被压下去"。

#### USE_MINI_HALOS
迷你晕总开关。它在这条量里同样不进函数体，而是换掉参与积分的下限（下限取 `M_MIN_INTEGRAL` 那张表的下界，同时 $\sigma$ 表的构建范围也跟着换）。开着它时，被积分起来的质量区间向下扩到迷你晕尺度，源那一侧的数目按量级变化。

#### m22
暗物质粒子质量（单位 $10^{-22}\ \mathrm{eV}$，默认 1.6），只在 FDM 模型下起作用。它在这条量里有两条路径：一条换掉 $\sigma(M)$ 表（FDM 的转移函数在小尺度截断，谱的幅度被压），另一条在质量函数返回前乘一个压制因子——那个因子用一个特征质量 $M_0=1.6\times10^{10}m_{22}^{-4/3}M_\odot$ 与一个幂律把高 $m_{22}$ 一侧的数目抬回来。两条一起效果是：$m_{22}$ 越小，小质量端的晕越少。

## M_min(z) · 最小晕质量

### 物理

最小晕质量是"多大的晕才配算源"的那道门槛：气体要被引力留住并开始原子冷却，晕的维里温度得够高；把这道温度门槛换成质量就得到质量下限。它对温度与红移都是幂律——门槛温度高一点、红移高一点，能成核的晕就更重，所以它随红移升高而变小。

公式由维里平衡反解而来：三分之三次方来自温度、质量与维里半径三者的组合，平均分子量那一项反映气体是否已经分子化。前提是维里平衡与单一的气体温度，非球形塌缩与冷却时标带来的散布不在这里；算出的下限还要与网格能分辨的最小质量取较大者——分辨率不足时，实际门槛由网格而非物理定。

驱动它的是最小维里温度、红移与平均分子量：温度下限按电离侧还是按加热侧取不同的值，平均分子量随之切换，于是门槛高度对输入是敏感的幂律响应。它没有记忆、也没有非局域性，只是一条代数式。

它对下游却强非线性：它当积分的下限出现，而多重数在阈值附近指数下降，所以下限一动，积分出的源数目与恒星形成率就成倍改变；这也是这条链上参数简并最重的地方——下限抬高可以用电离效率调低来部分抵消，单看观测量分不开两者。

它定的是电离光子率与恒星形成率积分的下限，也对应功率谱里源的最小质量。局限在门槛只按维里温度画一条线：真实成核还受相对速度、分子冷却与反馈影响，这些不在这一步，而在后续环节以额外压制叠上去。

$$M_{\min}(z)=10^{8}M_\odot\left(\frac{T_{\rm vir}^{\min}}{1.98\times10^{4}\ \mathrm K}\right)^{3/2}\left(\frac{1+z}{10}\right)^{-3/2}\left(\frac{\mu}{0.6}\right)^{-3/2}$$

### 代码解析

`hmf.c` 的 `minimum_source_mass`（1262–1288 行）读下来，会发现门槛是几个选项拼出来的，而不是一条公式算到底。开着 mini-halo 时直接取 `M_MIN_INTEGRAL` 并覆盖其余选项；开了 `M_MIN_in_Mass` 就取 `M_TURN`；两条都不走时，才按维里温度换算（`TtoM`），而且平均分子量按门槛温度是否低于 $10^4\ \mathrm K$ 在 1.22 与 0.6 之间切换——这正是正文里"气体是否已经分子化"那句话在代码里的落点。取哪个温度下限也分两条路：X 射线那一侧用 `X_RAY_Tvir_MIN`，电离这一侧用 `ION_Tvir_MIN`。

最后一步除法容易被忽略：源模型非零且不开 mini-halo 时，结果再除以 50。这不是物理，是数值上的保险——把积分下限放到远低于转折点的地方，免得积分区间切在数目陡降的那一段上把总量算少。

### 工程

#### 门槛是拼出来的：`minimum_source_mass`

- 落点：`src/py21cmfast/src/hmf.c:1262-1288`

```c
double minimum_source_mass(double redshift, bool xray) {
    double Mmin, min_factor, mu_factor, t_vir_min;
    if (matter_options_global->SOURCE_MODEL > 0 && !astro_options_global->USE_MINI_HALOS)
        min_factor = 50.;  // small lower bound to cover far below the turnover
    else
        min_factor = 1.;  // sharp cutoff

    if (astro_options_global->USE_MINI_HALOS) {
        Mmin = M_MIN_INTEGRAL;  // overrides the rest of the options
    } else if (astro_options_global->M_MIN_in_Mass) {
        // NOTE: previously this divided Mturn by 50 in spin temperature, but not in the ionised box
        //      which I think is a bug with M_MIN_in_Mass, since there is a sharp cutoff
        Mmin = astro_params_global->M_TURN;
    } else {
        // if the virial temp minimum is set below ionisation we need to set mu accordingly
        t_vir_min = xray ? astro_params_global->X_RAY_Tvir_MIN : astro_params_global->ION_Tvir_MIN;
        mu_factor = t_vir_min < 9.99999e3 ? 1.22 : 0.6;
        Mmin = TtoM(redshift, t_vir_min, mu_factor);
    }

    // Unused WDM model
    //  if(P_CUTOFF){
    //      Mmin = fmax(Mmin,M_J_WDM());
    //  }

    Mmin /= min_factor;

    return Mmin;
}
```

这个函数把正文那条公式和几个开关拼在一起，读的时候按它的判断顺序分四段：

1. **先定数值保险**：源模型非零、又没开 mini-halo 时取 `min_factor = 50`，否则取 1。它不参与门槛本身，只在函数末尾把结果除掉——积分下限因此被放到转折点以下约两个数量级，免得质量函数在陡降那一段被截断、把总数算少。这一半和 `hmf.c` 里给 $\sigma$ 表设下界的注释是配套的：表的下限、积分的下限要一起挪，只挪一个就会出现"表里查不到"的空段。
2. **mini-halo 分支优先**：开着 `USE_MINI_HALOS` 时直接取 `M_MIN_INTEGRAL`，把下面两条分支整个覆盖——迷你晕那一侧的下限不由维里温度定，而由那张 $\sigma$ 表的下界定。代码注释写的就是这层意思（"overrides the rest of the options"）。
3. **参数面直接钉住**：开着 `M_MIN_in_Mass` 时取 `M_TURN`，门槛不再经过温度换算。旁边那条注释记着一处旧差异：自旋温度那边曾把 `M_TURN` 除以 50、电离盒子那边没有除，作者在注释里判定后者才是对的（既然这里是硬截断，就不该再往下放），留下的是不除的这一支。
4. **按温度换算**：两条都不走时才回到正文那条幂律。温度下限分两路取——X 射线那一侧读 `X_RAY_Tvir_MIN`，电离这一侧读 `ION_Tvir_MIN`；平均分子量按门槛温度是否低于 $10^4\ \mathrm K$ 在 1.22（分子化）与 0.6（原子化）之间切换，`9.99999e3` 这个写法是为了让 $10^4\ \mathrm K$ 恰好落在边界外侧。系数 $\mu$ 的切换就是正文里"气体是否已经分子化"那句话在代码里的落点。

换算本身在 `cosmology.c` 的 `TtoM` 里，就是正文那条维里平衡反解：

```c
double TtoM(double z, double T, double mu) {
    return 7030.97 / (cosmo_params_global->hlittle) *
           sqrt(omega_mz(z) / (cosmo_params_global->OMm * deltac_nonlinear(z))) *
           pow(T / (mu * (1 + z)), 1.5);
}
```

- 落点：`src/py21cmfast/src/cosmology.c:671-681`

系数 7030.97 把 $\mu$、质子质量、$G$、$k_B$ 与维里半径里的 $4\pi/3$ 一起收成一个数；$T^{3/2}$ 与 $(1+z)^{-3/2}$ 就是正文那条幂律的两端，中间那个根号来自维里半径对背景密度的依赖。函数上方的注释标了出处（Barkana & Loeb 2001）与单位约定（温度 K、质量 $M_\odot$）；下面被注释掉的三段是"自屏蔽"那套更细的处理，本仓不用。

函数里还有一块注释掉的 WDM 代码，位置就在返回之前：本该在那里把质量下限与金斯质量取较大者。现在这段不生效，暗物质在小质量端的切断改由质量函数那一侧的压制因子承担。

- 输入：$T_{\rm vir}^{\min}$、红移 $z$、$T_{\rm vir}\leftrightarrow M$ 换算与网格可分辨质量；上游为 tvir_min
- 产出：最小晕质量 $M_{\min}(z)$，反馈修正叠在它上面

### 参数语境

#### ION_Tvir_MIN
电离侧那道维里温度门槛：参数面按 $\log_{10}$ 给（默认 4.69897 → $5\times10^4\ \mathrm K$），进 C 前转成线性值。它在这条量里的作用是最后一跳的输入——只要没开 mini-halo、也没开 `M_MIN_in_Mass`，质量下限就是 `TtoM(z, ION_Tvir_MIN, μ)`；它同时决定 $\mu$ 取 0.6 还是 1.22。往下的影响成幂律放大：门槛抬高，下限随 $T^{3/2}$ 上升，电离光子率与恒星形成率的积分下限跟着往上挪，而多重数在门槛附近的陡降会把这一步放大成成倍的差别。改动它等于把"哪些晕算源"这条线整体平移，代价是要与恒星形成效率、逃逸分数一起重调——三者在这一侧的简并最重。

#### M_TURN
抑制恒星形成的转折质量（参数面按 $\log_{10}$ 给，默认 8.7 → $5\times10^8\,M_\odot$）。它在这条量里有两处出现：开了 `M_MIN_in_Mass` 时它就是质量下限本身（门槛由参数面直接钉住，不再走温度换算）；没开时它不决定下限，而是在下游的源项里当抑制尺度用（源项的积分核里那个 $M_{\rm TURN}/M$ 的指数截断）。所以同一个参数在"哪些晕算源"与"每个晕产多少"这两处都出手，调它时两处会一起动。

#### USE_MINI_HALOS
迷你晕（第三代恒星）总开关。它在这条量里管的是分支优先级：开着时质量下限直接取 `M_MIN_INTEGRAL`，维里温度那条路整个不执行，$\mu$ 的切换也不再发生。于是它对下游的影响不是"多算一点"，而是换了一套源——下限掉到迷你晕那一侧的质量尺度，源数目按数量级增加，电离光子率与 Ly-$\alpha$ 背景跟着换量级。它与 `M_TURN`、`ION_Tvir_MIN` 的联合约束由参数面自己挡：`M_TURN > 8` 又开 mini-halo 时输入校验会报错。

#### m22
暗物质粒子的质量（单位 $10^{-22}\ \mathrm{eV}$，默认 1.6），只在 FDM 模型下起作用。它在这条量里的语境是一个**空位**：函数末尾那段被注释掉的 WDM 代码本该放"质量下限与金斯质量取较大者"的处理，现在不生效，小质量端的切断改由质量函数那一侧的压制因子承担——压制用一个特征质量 $M_0=1.6\times10^{10}m_{22}^{-4/3}\,M_\odot$ 与一个幂律把 $\mathrm dn/\mathrm dM$ 在高 $m_{22}$ 一侧抬起来。读这条量时该记住的正是这层分工：门槛归门槛，谱的切断归质量函数。

## T_vir^min · 能形成恒星的最小晕维里温度

### 物理

能形成恒星的最小晕维里温度不是算出来的量，而是输入：气体在原子冷却生效前无法把引力势能辐射掉，这道温度门槛就是恒星形成与电离积分的下限高度。它定的是"哪些晕算源"，而不是某一刻的源有多强。

温度与质量由维里平衡互换：温度正比于质量除以维里半径，维里半径又由质量与当时的背景密度定出，所以两者是一对可以互推的量。前提是维里平衡与单一的平均分子量；真实晕的形态与温度分布带来的散布不在这条换算里，它只给一条平均的线。

它独立于链上其余量，只从参数面按对数读入，因此改它等于整体平移质量下限；而质量下限在下游按幂律放大，所以这条参数在源那一侧杠杆很大，并且与电离效率、恒星形成效率彼此简并——门槛抬高可以用效率调低部分抵消。

它把"哪些晕算源"钉在温度上，供最小晕质量、电离光子率与恒星形成率共用。局限在这种简化：相对速度、分子冷却与反馈都会挪动真实的门槛，这些要靠后续环节的额外压制补，而它本身不含红移与环境的依赖。

$$T_{\rm vir}=\frac{\mu m_p}{2k_B}\frac{GM}{R_{\rm vir}},\qquad R_{\rm vir}=\left(\frac{3M}{4\pi\Delta_c\rho_m(z)}\right)^{1/3}$$

### 变量名与 LaTeX 符号对照表

| 公式符号 | 含义 | 代码名（默认值） | 进 C 的换算 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| $T_{\rm vir}^{\min}$ | 能形成恒星的最小晕维里温度：参数面按 $\log_{10}$ 给，反解成质量后当恒星形成与电离积分的下限 | ION_Tvir_MIN（4.69897） | 对数转线性（`src/py21cmfast/wrapper/inputs.py:1320-1324`） | `src/py21cmfast/src/hmf.c:1276-1278` |

### 代码解析

这个量在 C 里没有计算位置：它从参数面 `ION_Tvir_MIN` 按 $\log_{10}$ 读入，Python 侧转成线性值后交给 `hmf.c` 的 `minimum_source_mass`（1276–1278 行）当 `TtoM` 的输入，X 射线那一侧对应 `X_RAY_Tvir_MIN`。上面那条维里平衡的反解正是 `TtoM` 做的事，代码里只需要一个温度和一个红移就能换出质量。

读这一条要认准它是输入而不是推导结果：链上所有"哪些晕算源"的判断都从这里出发，改它相当于把整条源线的门槛整体平移。

### 工程

- 参数名：`ION_Tvir_MIN`

这个量的实现位置就是上面那条维里平衡的反解：`cosmology.c` 的 `TtoM`。

- 落点：`src/py21cmfast/src/cosmology.c:671-681`

```c
double TtoM(double z, double T, double mu) {
    return 7030.97 / (cosmo_params_global->hlittle) *
           sqrt(omega_mz(z) / (cosmo_params_global->OMm * deltac_nonlinear(z))) *
           pow(T / (mu * (1 + z)), 1.5);
}
```

逐段看：

1. **系数是一个打包**：7030.97 把 $\mu m_p/(2k_B)$、$G$ 与维里半径里的 $4\pi/3$ 收成一个数，所以正文那条式子写成 $10^{8}M_\odot$ 作前缀、把 $\mu$ 与 $T$ 的相对值放进括号里——两处是同一条式子换了个写法。
2. **中间的根号**：$\sqrt{\rho_m(z)/\Delta_c}$ 来自维里半径对背景密度的依赖（背景越密，同样质量的晕越小、$T_{\rm vir}$ 越高）；除以 `hlittle` 是把长度单位换算对齐。
3. **幂律那一端**：`pow(T/(mu*(1+z)), 1.5)` 就是 $T^{3/2}(1+z)^{-3/2}\mu^{-3/2}$，即正文里"门槛温度高一点、红移高一点，能成核的晕更重"那句话的全部内容。
4. **谁来调它**：函数本身只认三个入参。调用方在 `hmf.c` 的 `minimum_source_mass`（1276–1278 行）——先按 X 射线侧还是电离侧挑一个温度下限，再按门槛是否低于 $10^4\ \mathrm K$ 选平均分子量（1.22 或 0.6），然后才调这个换算。另有 `thermochem.c` 的两处调用：原子冷却阈值（$10^4\ \mathrm K$、$\mu=0.59$）与分子冷却阈值（600 K、$\mu=1.22$）——同样是"温度换质量"，只是门槛值与分子量不同。
5. **函数上方那段注释**：标了出处（Barkana & Loeb 2001）与单位约定（温度 K、质量 $M_\odot$），还留着一套被注释掉的自屏蔽分支（按 $z$ 与阈值切换），本仓不走那一路。

- 输入：参数表（旧参数化 ION_Tvir_MIN）
- 产出：标量 $T_{\rm vir}^{\min}$，与 $M_{\rm TURN}$ 一起定质量下限

### 参数语境

#### ION_Tvir_MIN
这道门槛的数值本身，参数面按 $\log_{10}$ 给（默认 4.69897 → $5\times10^4\ \mathrm K$），转成线性后进 C。它的语境分两头；**进来的那一头**是参数面与校验——正数、按对数，改动只在输入那一层，代码里没有第二个副本；**出去的那一头**有三处：最小晕质量那里当 `TtoM` 的温度入参（并且参与"$\mu$ 取 0.6 还是 1.22"的判定），以及热化学里两条冷却阈值的参照值。往下游走，它先把质量下限按 $T^{3/2}$ 平移，再被源项的积分与质量函数的陡降放大成成倍的源数目差别；所以虽然这条量不带红移依赖、也不带环境依赖，它对最终观测量的杠杆很大，并且与恒星形成效率、逃逸分数在这一侧简并——调它时必须连着那两条一起动。

## 参数

本模块携带 13 个参数（与画布上这块的「参数」卡同一份清单；类别是 `inputs.py` 里的结构名）。下面逐条写它在代码里做什么；同一个参数**在某个成员那一步里**的语境与落点，写在那个成员节的「参数语境」里。

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `OMm` | `CosmoParams` | 物质密度（默认 0.31）。在这块里出两次：一次在 $\sigma(M)$ 那张表里（功率谱的幅度与形状都带它），一次在调用处补量纲的 $\rho_m/M=\mathrm{OMm}\cdot\rho_{\rm crit}/M$。它同时定 $\nu=\delta_c^2/\sigma^2$ 里的方差与整体归一，所以调它会成倍地挪动晕数。 |
| `OMb` | `CosmoParams` | 重子密度（默认 0.04897）。它不直接出现在这条量的代码里，作用经转移函数的形状进来：重子比例改谱的拐点位置，$\sigma(M)$ 在源尺度那一带的斜率跟着变。 |
| `OMk` | `CosmoParams` | 曲率密度（默认 0）。不改变谱的形状，改的是几何与距离—红移关系以及生长因子的归一，于是 $\nu$ 里的方差随红移演化的方式被挪动。平坦宇宙取 0，只有做曲率测试时才动它。 |
| `OMn` | `CosmoParams` | 中微子密度（默认 0）。非零时中微子自由流在转移函数里压小尺度功率，$\sigma(M)$ 在小质量端被压下去，小晕数目因此减少。 |
| `OMr` | `CosmoParams` | 辐射密度（默认 $9\times10^{-5}$）。它进转移函数的初始条件（辐射—物质相等时刻），挪动谱的拐点位置；数值很小，一般由 CMB 温度钉住。 |
| `OMtot` | `CosmoParams` | 总密度（默认 1.0，即 `OMm` + `OMk` + `OMr` + `OMn` 之和）。它在这里当一致性约束用：参数组合必须自洽（输入校验会检查各项之和与它相符），所以它不是独立旋钮，而是「这套宇宙学闭合」的声明。 |
| `hlittle` | `CosmoParams` | 无量纲哈勃常数（默认 0.6774）。它管量纲：临界密度正比于 $h^2$，调用处补的 $\rho_m$ 与质量—长度的换算都带它，于是改它看上去像整体平移，其实是单位换了个口径。 |
| `POWER_INDEX` | `CosmoParams` | 原初谱指数（默认 0.965），在 $\sigma(M)$ 那张表的积分核里出现。它从很远的地方进来：把功率谱在小尺度那一段的斜率挪一点，$\sigma(M)$ 曲线整体倾斜，$\nu$ 的取值随之改变，晕数按指数响应。 |
| `wl` | `CosmoParams` | 暗能量状态方程（默认 $-1$）。它只改生长因子随红移的演化（`dNdlnM_st` 里乘上去的那两行），影响随红移累积：红移越高，与 $\Lambda$CDM 的差别越大。 |
| `ION_Tvir_MIN` | `AstroParams` | 电离侧的维里温度门槛，参数面按 $\log_{10}$ 给（默认 4.69897 → $5\times10^4\ \mathrm K$），进 C 前转成线性值。它不在质量函数的代码里，而是从**积分的下限**进来：源项把 $\mathrm dn/\mathrm dM$ 从 $M_{\min}(z)$ 往上积，这个下限由最小晕质量那一篇算出，门槛是它的输入。 |
| `M_TURN` | `AstroParams` | 抑制恒星形成的转折质量，参数面按 $\log_{10}$ 给（默认 8.7 → $5\times10^8\,M_\odot$）。它在质量函数本身里不出现：开了 `M_MIN_in_Mass` 时它就是质量下限本身，没开时在下游源项里当指数截断的转折尺度（$M_{\rm TURN}/M$）。 |
| `USE_MINI_HALOS` | `AstroOptions` | 迷你晕（第三代恒星）总开关，默认关。它在这块里管的是分支优先级：开着时积分下限直接取 `M_MIN_INTEGRAL`，维里温度那条路整个不执行，$\sigma$ 表的构建范围也跟着换，于是源那一侧的数目按量级变化。 |
| `m22` | `CosmoParams` | 暗物质粒子质量（单位 $10^{-22}\ \mathrm{eV}$，默认 1.6），只在 FDM 模型下起作用。它在这块里有两条路径：一条换掉 $\sigma(M)$ 表（FDM 转移函数在小尺度截断），一条在质量函数返回前乘一个压制因子（特征质量 $M_0=1.6\times10^{10}m_{22}^{-4/3}M_\odot$ 配一条幂律）。两条合起来的效果是：$m_{22}$ 越小，小质量端的晕越少。 |

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**质量函数的算法 · 把 dn/dM 算出来**

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| Universal FOF 质量函数（含红移演化）的 13 个拟合参数 | Watson et al. 2013 | Universal FOF HMF (Watson et al. 2013)（`Watson_A/alpha/beta/gamma` 与带红移演化的 `*_z_*`） | `src/py21cmfast/src/hmf.c:25-45` | 无正文（本地只有代码注释与 docstring） |
| Sheth–Tormen 质量函数的 $a$、$p$、$A$ 参数 | Jenkins et al. 2001 | Sheth and Tormen a parameter (from Jenkins et al. 2001) | `src/py21cmfast/src/hmf.c:59-61` | 无正文（本地只有代码注释与 docstring） |
| 欧拉过密度 → 拉格朗日过密度的换算拟合 | Mo & White 1996 | Mo & White 1996 fit | `src/py21cmfast/src/hmf.c:141-141` | 无正文（本地只有代码注释与 docstring） |
| 移动势垒的固定化版本（DexM 拟合） | 代码注释未给出处（只说 DexM 用拟合逼近 ST 的质量函数） | DexM uses a fit to this barrier to acheive MF similar to ST, Here I use the fixed version for the sampler | `src/py21cmfast/src/hmf.c:125-126` | 无正文（本地只有代码注释与 docstring） |
| 条件质量函数（CMF）的 Sheth–Tormen 形式 | Sheth & Tormen 2002 | Sheth Tormen 2002 fit for the CMF, while the moving barrier does not allow for a simple rescaling | `src/py21cmfast/src/hmf.c:199-201` | 无正文（本地只有代码注释与 docstring） |
| CMF 对应到 Sheth–Mo–Tormen 质量函数 | Sheth+ 2002 | CMF Corresponding to the Sheth Mo Tormen HMF (Sheth+ 2002) | `src/py21cmfast/src/hmf.c:237-237` | 无正文（本地只有代码注释与 docstring） |
| Delos 随机游走质量函数 | Delos 2023（arXiv:2311.17986） | Unconditional Mass function from Delos 2023 (https://arxiv.org/pdf/2311.17986.pdf) | `src/py21cmfast/src/hmf.c:150-150` | 无正文（本地只有代码注释与 docstring） |
| Delos 随机游走模型的临界过密度 | Delos 2025 | critical overdensity in Delos 2025 random walk model | `src/py21cmfast/src/Constants.h:62-62` | 无正文（本地只有代码注释与 docstring） |
| FDM 的质量函数压制因子 | Schive et al. 2016（PRL 116, 201302）；Liu et al. 2025（PRD 112, 103534, Eq. 3） | FDM HMF suppression factor -- Schive et al. (2016) / Reference: Schive et al. (2016), Eq. (7); Liu et al. (2025), Eq. (3). | `src/py21cmfast/src/fdm.h:7-7`；`src/py21cmfast/src/fdm.c:50-51` | 无正文（本地只有代码注释与 docstring） |
| 扩展 Press–Schechter 的修正（`SAMPLE_METHOD==3`） | Parkinson et al. 2008 | used in Parkinson et al. 2008 | `src/py21cmfast/wrapper/inputs.py:800-807` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：Universal FOF 质量函数的 13 个拟合参数；Sheth–Tormen 质量函数的 $a$、$p$、$A$ 参数；欧拉过密度 → 拉格朗日过密度的换算拟合；移动势垒的固定化版本；条件质量函数的 Sheth–Tormen 形式；CMF 对应到 Sheth–Mo–Tormen 质量函数；Delos 随机游走质量函数；Delos 随机游走模型的临界过密度；FDM 的质量函数压制因子；扩展 Press–Schechter 的修正。

**dn/dM(M,z) · 晕质量函数**

- 论文节号：§3.6（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| 晕质量函数的 Sheth–Mo–Tormen 实现 | Sheth, Mo, Tormann 2001 | Reference: Sheth, Mo, Torman 2001 | `src/py21cmfast/src/hmf.c:267-267`（落点 `hmf.c:269-281`） | 无正文（本地只有代码注释与 docstring） |
| UV 光度函数里的质量函数调用与换元 | Sun & Furlanetto 2016（MNRAS 417, 33） | G. Sun and S. R. Furlanetto (2016) MNRAS, 417, 33 | `src/py21cmfast/src/LuminosityFunction.c:2-2`（落点在 `:259-262`） | 无正文（本地只有代码注释与 docstring） |
| 条件 σ(M) 的 FDM 版算法 | Liu et al. 2025（PRD 112, 103534, Eq. 5） | Reference: Liu et al. 2025, PRD 112, 103534, Eq. (5). | `src/py21cmfast/src/interp_tables.c:1244-1249` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：晕质量函数的 Sheth–Mo–Tormen 实现；UV 光度函数里的质量函数调用与换元；条件 σ(M) 的 FDM 版算法。

**M_min(z) · 最小晕质量**

- 论文节号：§3.6（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

**T_vir^min · 能形成恒星的最小晕维里温度**

- 论文节号：§3.6 天体物理源与历史（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| $T_{\rm vir}^{\min}$：恒星形成晕的最低维里温度 | Greig+2015（Sec 2.1.3） | Minimum virial temperature of star-forming haloes (Sec 2.1.3 of Greig+2015). | `src/py21cmfast/wrapper/inputs.py:1217-1217` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：$T_{\rm vir}^{\min}$：恒星形成晕的最低维里温度。
