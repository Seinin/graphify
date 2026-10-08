# 晕目录与质量函数

这一块回答两个问题：多大的晕才配算源，以及每个质量区间里有多少个这样的晕。回答分三步——物质功率谱经窗积分变成质量方差，多重数口径把它折成数目，再把"气体要被引力留住并开始原子冷却"的温度门槛换算成质量下限。它只给出目录与门槛，晕有多亮留给下一块。

三种量在这里的分工要分清：质量方差是唯一的物理输入，由宇宙学与功率谱定死；多重数与塌缩阈值是口径，换一个就换掉一整条源数目曲线的形状；质量下限是门槛，决定哪些晕进得了积分。后两样都是可以调的约定，参数面上的旋钮几乎都拧在这两处。

简并也集中在这里：质量下限、多重数口径与塌缩阈值在对着观测量调参时互相纠缠——门槛抬高可以让电离效率调低来部分抵消，单看观测量分不开两者。所以这一块的量几乎都不是"算出来就一定对"的物理量，而是带着口径选择与参数权衡的约定。

本篇按"这块在链上做什么 → 逐个成员讲物理 → 代码怎么走 → 参数 → 陷阱 → 成员索引卡 → 代码地图 → 论文出处"排。物理骨架按成员次序讲它依据的物理（不出现代码标识）；代码那一节按函数讲实现，一条代码落点只印一次；成员节是索引卡，给定位与落点、在链上的位置与局限、名下参数的去处，不重述算法。

## 一、这块在链上做什么

**一句话**：把物质功率谱折成"每个质量区间里有多少个晕"，再定一条"多大的晕才算源"的质量下限，一起交给下游的源项。

| | 内容 |
| :--- | :--- |
| 输入 | 初始条件盒子给出的线性过密度场与物质功率谱（$\sigma(M)$ 表由它造出）、目标红移、宇宙学参数与参数面的门槛设置 |
| 输出 | 晕质量函数 $\mathrm dn/\mathrm dM(M,z)$、最小晕质量 $M_{\min}(z)$、能形成恒星的最小维里温度 |
| 下游 | 网格化的源项：电离光子率、恒星形成率、X 射线源与莱曼-维尔纳背景的积分上下限与权重；紫外光度函数 |
| 参数 | 13 个（宇宙学背景与谱形、一致性项与演化、门槛与开关），§四 |

**物理图像**：这一块是一条"从涨落到目录"的折算链。初始涨落的功率谱经窗积分变成不同质量尺度上的方差，尺度越大方差越小、越容易越过塌缩阈值；多重数口径把"越过阈值的概率"折成"每个质量区间里有多少个晕"。另一头是门槛：气体要被引力留住并开始原子冷却，需要足够的维里温度，把这道温度门槛反解成质量，就得到"多大的晕才配算源"。两头合起来——数目与下限——才是下游源项真正要的东西。

**为什么是独立一块**：它不产生新场、不演化时间，只在每个红移把"源有多少"折算出来；独立性在于它是链上唯一处理"体积元里有多少个晕"的地方，再往下的每一块都假定晕已经数好了。它也是简并最集中的地方，口径与门槛的选择会整体平移整条源数目曲线，而这条曲线对下游是指数级敏感的。局限也跟着来：它假定涨落是高斯、塌缩阈值是解析的、质量与平滑尺度一一对应，而大质量端的成团、低红移的非线性与重子效应都不在函数形式里。

## 二、物理骨架

### 2.1 窗积分：从功率谱到质量方差

这一条把物质功率谱折成"某个质量尺度上涨落的典型幅度"。功率谱在一个滤波窗内加权积分：

$$\sigma^{2}(R)=\int_{0}^{\infty}\frac{\mathrm dk}{k}\,\Delta^{2}(k)\,W^{2}(kR)$$

其中 $\Delta^{2}(k)=k^{3}P(k)/(2\pi^{2})$ 是无量纲功率，$W$ 是滤波窗。前提是线性演化与高斯初始涨落：方差只是线性功率谱的加权积分，不含任何非线性修正。局限在窗的选择——同一个功率谱配不同的窗给出不同的方差，本仓默认取真实空间顶帽窗。质量与平滑尺度由 $M=\frac{4}{3}\pi R^{3}\rho_{m}$ 互推，因此"质量尺度"与"平滑尺度"是一一对应的。

红移不进这条式子：表里存的是 $z=0$ 的方差，任一红移的值由线性生长因子乘上去。

### 2.2 质量函数：多重数与数目

晕质量函数回答"单位质量区间里有多少个晕"：平均密度除以质量给出量纲，对数区间里的数目由多重数乘上多重数对质量的对数斜率给出。

$$\frac{\mathrm dn}{\mathrm dM}=\frac{\rho_{m}}{M}\,\nu f(\nu)\,\frac{\mathrm d\ln\nu}{\mathrm d\ln M},\qquad \nu=\frac{\delta_{c}^{2}(z)}{\sigma^{2}(M)}$$

它在源尺度附近是陡降的——质量越大，数目掉得越快。多重数只依赖塌缩阈值平方与质量方差之比 $\nu$，于是它把宇宙学（方差）与红移（阈值）合成一个变量；指数骨架来自高斯涨落的尾部，形状因子来自所选口径：

$$\nu f(\nu)=A\sqrt{\frac{2a\nu}{\pi}}\left[1+(a\nu)^{-p}\right]e^{-a\nu/2}$$

前提是高斯初始涨落与解析的塌缩阈值，且质量与平滑尺度一一对应。在结构上它对阈值与方差是强非线性的——$\nu$ 待在指数里，阈值稍动，数目就指数级改变；但它是局域、无记忆的代数式。局限在高斯分布与解析阈值的近似：大质量端的成团、低红移的非线性与重子效应都不在函数形式里，只能靠口径选择与后续反馈吸收。

### 2.3 最小晕质量：维里门槛与幂律

最小晕质量是"多大的晕才配算源"的那道门槛：气体要被引力留住并开始原子冷却，晕的维里温度得够高；把这道温度门槛换成质量就得到质量下限。

$$M_{\min}(z)=10^{8}M_\odot\left(\frac{T_{\rm vir}^{\min}}{1.98\times10^{4}\ \mathrm K}\right)^{3/2}\left(\frac{1+z}{10}\right)^{-3/2}\left(\frac{\mu}{0.6}\right)^{-3/2}$$

它对温度与红移都是幂律——门槛温度高一点、红移高一点，能成核的晕就更重，所以它随红移升高而变小。平均分子量那一项反映气体是否已经分子化。前提是维里平衡与单一的气体温度，非球形塌缩与冷却时标带来的散布不在这里；算出的下限还要与网格能分辨的最小质量取较大者——分辨率不足时，实际门槛由网格而非物理定。

### 2.4 维里温度与质量的换算

温度与质量由维里平衡互换：温度正比于质量除以维里半径，维里半径又由质量与当时的背景密度定出。

$$T_{\rm vir}=\frac{\mu m_p}{2k_B}\frac{GM}{R_{\rm vir}},\qquad R_{\rm vir}=\left(\frac{3M}{4\pi\Delta_c\rho_m(z)}\right)^{1/3}$$

所以两者是一对可以互推的量：门槛温度给一个，就换一个质量下限出来；反过来，一个质量也能换出它对应的维里温度。前提是维里平衡与单一的平均分子量；真实晕的形态与温度分布带来的散布不在这条换算里，它只给一条平均的线。

## 三、代码怎么走

### 3.1 块的入口：`ComputeHaloCatalog`（晕目录那一半）

这一半才是"晕目录"：它不去查质量函数，而是在初始条件给出的线性过密度场上，按从大到小的平滑尺度走一遍，把每个尺度上越过阈值的格点标成晕，顺带定下下游源项看到的晕在哪儿、有多重。

- 落点：`src/py21cmfast/src/HaloCatalog.c:38-439`（块锚 `ComputeHaloCatalog`）

按它的次序读：

1. **备料**：`init_ps()` 造功率谱，`dicke(redshift)` 取生长因子（`:81-83`），再按 `[M_MIN, M_MAX_INTEGRAL]` 建 $\sigma(M)$ 插值表（`:125`）；最小平滑质量取"一个格子的质量"（采样器那一支取 HII 格子的质量，`:92-98`）。
2. **搬到 k 空间并存副本**：把 `boxes->hires_density` 逐格抄进 k 空间盒子（`:133-147`），变换后**留一份副本**（`:152-153`）。后面每个尺度都从这份副本重新滤波，所以滤波不累积、可重复。
3. **定尺度序列**：从 `MtoR(M_MIN*1.01)` 起把 $R$ 乘到一个盒长以上（`:164-169`），再从那个最大尺度往回除 `DELTA_R_FACTOR`（`:306`），一直走到半个格长、或 `RtoM(R)` 掉到 $M_{\min}$ 以下（`:183-184`）。也就是先看大质量、再看小质量。
4. **逐尺度四件事**：先算塌缩阈值（`:194-195`，用把移动势垒拟合固定化的那一支）；太稀的尺度直接跳过（`:197-204`，7σ 以外不滤波，注释指向 Mesinger et al. 05 的做法）；从副本拷回来、在 k 空间按 `HALO_FILTER` 滤波、再变换回实空间（`:206-214`）；扫一遍盒子，把过密度超过阈值的格点标成晕，并把这个球内的格点写进 `in_halo`，免得下一个更小的尺度在同一个位置再放一个（`:258-301`）。
5. **收尾**：把网格上的质量与位置（取格心）抄进 `HaloCatalog` 结构（`:318-339`），补上晕的其它属性（`:341`）。

两处容易读错：滤波后的密度场带着 k 空间的归一，读出来时要除以格点总数、再乘生长因子才是过密度（`:263-264`）；这一半的滤波窗由 `HALO_FILTER` 决定，与 $\sigma$ 表用的 `FILTER` 是两个独立选项，默认都取真实空间顶帽窗。

### 3.2 一处分发把五套口径收在一处：`unconditional_hmf`

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
4. **FDM 的压制**：最后一项乘的是 Schive+2016 那套半解析压制因子，输入是把 `lnM` 取指数换回质量（那个因子按 $M$ 定义）。`FDM` 打开时它只作用在**无条件**质量函数上；条件质量函数那一支**不乘**——`conditional_hmf` 上方的注释记着这层口径：与 Liu+25 的参考实现保持一致，而 FDM 的效应在条件路径里已经由方差与阈值的环境调制承担（条件 EPS 里的 $\sigma_1$ 取不含切断的 CDM 参照表，条件方差 $\sigma_2$ 取 FDM 表，分子里的阈值也按 FDM 取），再乘一次等于把同一份压低扣两遍。

这张表的来源在别处：$\sigma(M)$ 与 $\mathrm d\sigma^{2}/\mathrm d\ln M$ 由物质功率谱经窗积分造出来，供上面五个分支查用（§3.6）。

### 3.3 一个口径的内部：`dNdlnM_st`

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
3. **组出 $\hat\nu$**：`sqrt(SHETH_a)*delta_c_sph/sigma`，即 $\hat\nu=\sqrt{a}\,\delta_c/\sigma=\sqrt{a\nu}$。塌缩阈值取 `physconst` 里的球塌缩值，椭圆塌缩的修正由常数 $a$ 承担——这就是"阈值取球塌缩值再叠椭圆塌缩修正"的写法。
4. **一行就是正文那条式子**：`sqrt(2/π)`、`SHETH_A`、`(1+ν̂^{-2p})` 与 `exp(-ν̂²/2)` 合起来正是 $f(\nu)$（把 $\hat\nu=\sqrt{a\nu}$ 代回去即得 $A\sqrt{2a\nu/\pi}\,[1+(a\nu)^{-p}]e^{-a\nu/2}$）；乘在前面的 $-(\mathrm d\sigma/\mathrm d\ln M)/\sigma$ 是 $\mathrm d\ln\nu/\mathrm d\ln M$ 的一半（$\nu\propto\sigma^{-2}$ 带出来的那个 2 由这半支吸收）。量纲那一半（$\rho_m/M$）不在这个函数里，由调用方乘上来。

`hmf.c` 里的 `SHETH_a`（0.73）、`SHETH_p`（0.175）、`SHETH_A`（0.353）三个常数就是这套口径的 $a$、$p$、$A$（`:59-61`）；换口径（编号 0、2、3、4）只是把这一个函数换掉，调用方与表都不动。

### 3.4 换个自变量再乘一次：紫外光度函数那一侧的用法

- 落点：`src/py21cmfast/src/LuminosityFunction.c:259-262`

```c
                    dndm = unconditional_hmf(growthf, log(Mhalo_param[i]), z_LF[i_z], mf) *
                           (cosmo_params_global->OMm * RHOcrit) / Mhalo_param[i];
                    log10phi[i + i_z * nbins] = log10(dndm * exp(-(M_TURNs[i_z] / Mhalo_param[i])) *
                                                      f_duty_upper / deriv[i]);
```

同一张质量函数在这里被换个用法，逐段看：

1. **量纲补上**：`unconditional_hmf` 给的是多重数那一半，这里乘 `OMm * RHOcrit / M`，把 $\rho_m/M$ 补成"每单位质量、每单位共动体积里的数目"（`RHOcrit` 是临界密度，$\rho_m={\rm OMm}\cdot\rho_{\rm crit}$）。
2. **两处压制**：`exp(-M_TURNs/M)` 是 $M_{\rm TURN}$ 带来的指数截断（`M_TURNs` 是按红移预抽好的 $M_{\rm TURN}$），`f_duty_upper` 是占空比——原子冷却那一支按 $\exp(-M/M_{\rm crit})$ 算，迷你晕那一支直接取 1。
3. **换成沿绝对星等的分布**：除以 `deriv[i]`（质量对绝对星等的换元导数）之后取 $\log_{10}$，得到 $\log_{10}\phi(M_{UV})$。物理没变，只是自变量从质量换成了星等；下游拟合用的正是这张表，因此质量函数的口径选择最终会体现在紫外光度函数的形状上。

### 3.5 门槛是拼出来的：`minimum_source_mass` 与 `TtoM`

- 落点：`src/py21cmfast/src/hmf.c:1261-1288`

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

这个函数把正文那条公式和几个开关拼在一起，按它的判断顺序分四段：

1. **先定数值保险**：源模型非零、又没开 mini-halo 时取 `min_factor = 50`，否则取 1。它不参与门槛本身，只在函数末尾把结果除掉——积分下限因此被往下放约 50 倍，免得质量函数在陡降那一段被截断、把总数算少。函数上方的注释记着一处旧口径：表曾按 `M_MIN_INTEGRAL/50` 建、积分却从 `M_MIN_INTEGRAL` 起，两边对不上；现在的做法是把积分下限往下放。表的下界与积分的下界要一起挪，只挪一个就会出现"表里查不到"的空段。
2. **mini-halo 分支优先**：开着 `USE_MINI_HALOS` 时直接取 `M_MIN_INTEGRAL`，把下面两条分支整个覆盖——迷你晕那一侧的下限不由维里温度定，而由这个常数钉死（`hmf.h:10`，$10^{5}M_{\odot}$）。代码注释写的就是这层意思（"overrides the rest of the options"）。
3. **参数面直接钉住**：开着 `M_MIN_in_Mass` 时取 `M_TURN`，门槛不再经过温度换算。旁边那条注释记着一处旧差异：自旋温度那边曾把 `M_TURN` 除以 50、电离盒子那边没有除，作者在注释里判定后者才是对的（既然这里是硬截断，就不该再往下放），留下的是不除的这一支。
4. **按温度换算**：两条都不走时才回到正文那条幂律。温度下限分两路取——X 射线那一侧读 `X_RAY_Tvir_MIN`，电离这一侧读 `ION_Tvir_MIN`；平均分子量按门槛温度是否低于 $10^4\ \mathrm K$ 在 1.22（分子化）与 0.6（原子化）之间切换，`9.99999e3` 这个写法是为了让 $10^4\ \mathrm K$ 恰好落在边界外侧。系数 $\mu$ 的切换就是"气体是否已经分子化"那句话在代码里的落点。

换算本身在另一个文件里，就是正文那条维里平衡反解：

- 落点：`src/py21cmfast/src/cosmology.c:671-687`

```c
double TtoM(double z, double T, double mu) {
    return 7030.97 / (cosmo_params_global->hlittle) *
           sqrt(omega_mz(z) / (cosmo_params_global->OMm * deltac_nonlinear(z))) *
           pow(T / (mu * (1 + z)), 1.5);
}
```

系数 7030.97 把 $\mu$、质子质量、$G$、$k_B$ 与维里半径里的 $4\pi/3$ 一起收成一个数；$T^{3/2}$ 与 $(1+z)^{-3/2}$ 就是正文那条幂律的两端，中间那个根号来自维里半径对背景密度的依赖（背景越密，同样质量的晕越小、$T_{\rm vir}$ 越高，于是同样温度能换到更小的质量）。函数上方的注释标了出处（Barkana & Loeb 2001）与单位约定（温度 K、质量 $M_\odot$）；下面被注释掉的三段是"自屏蔽"那套更细的处理，本仓不用。

`minimum_source_mass` 的末尾还有一块注释掉的 WDM 代码，位置就在返回之前（`hmf.c:1281-1284`）：本该在那里把质量下限与金斯质量取较大者。现在这段不生效，暗物质在小质量端的切断改由质量函数那一侧的压制因子承担（§3.2 第 4 条）。

### 3.6 σ(M) 表怎么建、红移从哪里进来

这一块的两半（数目与门槛）都从同一张方差表出发，表在别处造，这里只查：

- **功率谱**：`cosmology.c:536` 的 `init_ps` 按 `POWER_SPECTRUM` 选项造 $P(k)$，转移函数的参数由 `TFset_parameters`（`:487`）传进去。
- **窗积分**：`cosmology.c:398` 的 `sigma_z0` 就是 §2.1 那条式子，积分核写成 `dsigma_dk`（`:385`），上下限按半径缩放。它用 `FILTER` 选项选窗，与目录那一半的 `HALO_FILTER` 相互独立。
- **对数导数**：`dsigmasqdm_z0`（`:450`）给 $\mathrm d\sigma^{2}/\mathrm d\ln M$，质量函数里那一行除 $2\sigma$ 就是把它换回 $\mathrm d\sigma/\mathrm d\ln M$。
- **质量—尺度换算**：`MtoR`（`:622`）与 `RtoM`（`:635`）。
- **插值表**：表由 `initialiseSigmaMInterpTable`（`interp_tables.c:1143-1197`）建，范围由调用方给；查用 `EvaluateSigma`（`:1206`）与 `EvaluatedSigmasqdm`（`:1219`）。FDM 打开时会同时建一张不含转移函数切断的 CDM 参照表（`:95-99`），`EvaluateSigma` 便改读它；条件路径另有 `EvaluateSigmaConditional`（`:1252`），按 Liu+25 的做法读含切断的那张，于是条件 EPS 里的 $\sigma_1$ 是 CDM 值、条件方差 $\sigma_2$ 是 FDM 值。
- **红移**：表里只有 $z=0$ 的值，红移在查询处由生长因子乘进来（§3.3 第 2 条）。

表的构建范围跟着调用方的积分下限走：晕目录那一半用 `M_MIN`（`HaloCatalog.c:125`）；源项那一侧取 `M_min/2`（`HaloBox.c:614`），电离盒子在积分方式选到 2 时改取 `fmin(MMIN_FAST, M_min)`（`IonisationBox.c:1446-1449`）。下限越低，表就得往下多铺一截。

## 四、参数

本块名下登记 13 个参数，分三组，清单与画布上这块的「参数」卡一致（类别是 `inputs.py` 里的结构名）。

### 4.1 宇宙学背景与谱形

`OMm`（默认取 Planck18 的 0.3097）、`OMb`（0.04897）、`hlittle`（0.6766）、`POWER_INDEX`（0.9665）。前三个经 $\sigma(M)$ 表的幅度、形状与单位进来（`OMm` 还额外在调用处补一次量纲 $\rho_m/M$），`POWER_INDEX` 改的是表在小尺度端的倾斜。这一组的共同特点是：它们不在这块的正交逻辑里，动它们等于换一张表。

### 4.2 一致性项与演化

`OMk`（0）、`OMn`（0）、`OMr`（$8.6\times10^{-5}$）、`OMtot`（1.0）、`wl`（$-1$）、`m22`（1.6）。这一组里真正进公式的只有前三个：`OMn` 以中微子分数 `f_nu` 进转移函数（`cosmology.c:541`），`OMk` 与 `OMr` 进 $\Omega_m(z)$ 的膨胀史（`:650-651`），三者合起来改的是 $\sigma(M)$ 表。`OMtot` 与 `wl` 只当判据用：`dicke` 按 $\Omega_{\rm tot}$ 是否等于 1 在平坦支与开宇宙支之间选（`:720-732`），并且只在 $w=-1$ 时才算得下去——$w\neq-1$ 那条精质支在本仓未实现，走到就抛错（`:728-732`）；`OMtot` 目前也不强制等于各项之和，`inputs.py` 里留着一条待办（`inputs.py:449-451`）。`m22` 只在 FDM 模型下起作用，有两条路径：换掉 $\sigma(M)$ 表，以及在质量函数返回前乘一个压制因子（§3.2 第 4 条）。

### 4.3 门槛与开关

`ION_Tvir_MIN`（参数面按 $\log_{10}$ 给，默认 4.69897 → $5\times10^4\ \mathrm K$）、`M_TURN`（默认 8.7 → 约 $5\times10^8\,M_\odot$）、`USE_MINI_HALOS`（默认关）。两个门槛是这一块真正"拧得动"的旋钮：前者经 `TtoM` 定质量下限，后者既能在 `M_MIN_in_Mass` 打开时直接当质量下限，也能在下游源项里当指数截断的尺度。开关改的是"算不算"，它一开就把下限换成 `M_MIN_INTEGRAL`，维里温度那条路整个不执行。

## 五、陷阱

**一、质量函数只查表、不现算积分。** 参数对 $\mathrm dn/\mathrm dM$ 的影响全部先经过 $\sigma(M)$ 表（§3.6）。要动谱，先动的是造表那一段（`matter_power`），这里只是随之换个表。

**二、表里存的是 $z=0$ 的方差。** 红移由生长因子在查询处乘进来（§3.3 第 2 条），谱形本身不随红移变；把"随红移演化"读到 $\sigma(M)$ 曲线的形状上就错了。

**三、表的下界与积分下界要一起挪。** 调用方给的 `M_min` 决定表铺到多低（§3.6）。只把积分下限往下放、不重建表，会出现查不到的空段。

**四、滤波窗有两个。** $\sigma$ 表用 `FILTER`，晕目录那一半用 `HALO_FILTER`，是独立选项（§3.1、§3.6）。默认都是真实空间顶帽窗，改一个不会带动另一个。

**五、条件质量函数不乘 FDM 压制因子。** `unconditional_hmf` 里那一项只作用在无条件路径上（§3.2 第 4 条）；条件路径的 FDM 效应由 $\sigma$ 表与阈值的环境调制承担。

**六、门槛是拼出来的，不是一个公式。** `USE_MINI_HALOS` 与 `M_MIN_in_Mass` 两个开关都会整个接管质量下限，维里温度那条路根本不执行（§3.5）。查门槛之前先确认走的是哪一支。

**七、`min_factor = 50` 不是物理。** 它是为了让积分下限躲开质量函数陡降段的数值保险（§3.5 第 1 条）；把它当成"真实门槛被放低了 50 倍"会读错。

**八、$\mu$ 的切换看的是门槛温度是否低于 $10^4\ \mathrm K$。** 低于取 1.22（分子化），否则取 0.6（原子化）；那个边界写成 `9.99999e3`，差一点点就换了分支（§3.5 第 4 条）。

**九、晕目录那一半跑在线性密度场上。** `ComputeHaloCatalog` 读的是初始条件盒子里的场，不是引力演化之后的密度场；目录记录的"位置"因此是初始场上的位置（§3.1）。

**十、被注释掉的 WDM 分支不生效。** `minimum_source_mass` 里那段"与金斯质量取较大者"是死代码（`hmf.c:1281-1284`），小质量端的切断在质量函数那一侧（§3.5）。

### 一份最小检查清单

- 要看源有多少：先确认 `HMF` 选的是哪一支（§3.2），再看积分下限走的是哪条分支（§3.5）。
- 要改源数目：动的是门槛（`ION_Tvir_MIN`、`M_TURN`）与口径（`HMF`、`POWER_SPECTRUM`），不是 $\mathrm dn/\mathrm dM$ 的函数形式。
- 要单格点验证：先确认 $\sigma$ 表的范围盖住了积分下限，并从不开 `USE_MINI_HALOS` 的那一支试起。
- 要读紫外光度函数：那里已经乘过 $\rho_m/M$、指数截断与换元导数（§3.4），不要再乘一次。

## 六、质量函数的算法 · 窗积分与多重数公式

它是 $\mathrm dn/\mathrm dM$ 的算法口径，不是新物理（§2.1、§2.2）：先把物质功率谱按所选转移函数造出来，做窗积分得质量方差，再按选定的多重数公式取指数骨架；塌缩阈值取球塌缩值并叠上椭圆塌缩的修正。它改变的是"源有多少"这条线的具体形状，而不是它的物理来源。

代码上它落在两个选项对应的两条路径：造表那段在 `cosmology.c` 的 `init_ps` 与 `sigma_z0`，口径分发在 `hmf.c` 的 `unconditional_hmf`（`:502-524`），单支的内部以 `dNdlnM_st`（`:269-281`）为例，FDM 压制因子在 `fdm.c:54-59`（出处注释在 `fdm.h:7`）（§3.2、§3.3、§3.6）。

**它在这条链上的位置是"源有多少"里所有口径的入口，局限在参数简并。** 选择哪套口径等于同时定了小尺度与大质量端的数目，因此它和塌缩阈值、最小晕质量在对着观测量调参时是简并的；它本身不含时间积分，红移只通过生长因子与阈值进入。与它配套的接口约定是"统一在对数质量上求值"，于是所有调用方都不必知道某一支是按 $M$ 还是按 $\ln M$ 定义的。**名下参数**是 §4.1 与 §4.2 两组：谱形与宇宙学项都先经 $\sigma(M)$ 表，再折成数目，改它们等于换那张表。论文出处：见文末第一组（没有 P&L 节号，只有代码注释里的出处）。

## 七、dn/dM(M,z) · 晕质量函数

它是"单位质量区间里有多少个晕"这张表（§2.2）：平均密度除以质量给量纲，多重数给形状。它在源尺度附近陡降，也是下游源项积分的被积函数——积分上下限由最小晕质量定，权重由它给。

代码上它的求值在 `hmf.c` 的 `dNdlnM_st`（`:269-281`），先从表里取 $\sigma$ 与 $\mathrm d\sigma^{2}/\mathrm d\ln M$ 并按生长因子缩放，再组出 $\hat\nu$ 与多重数；换个自变量再乘一次的用法在 `LuminosityFunction.c:259-262`（§3.3、§3.4）。

**它在这条链上的位置是源项的积分核，局限在高斯与解析阈值。** 大质量端的成团、低红移的非线性与重子效应都不在函数形式里；它在阈值附近是指数敏感的，所以下游的源数目对门槛与方差的响应是成倍的。它与最小晕质量一起决定电离光子数与恒星形成率积分的上下限与权重，是"源有多少"里的数目那一半。**名下参数**：它自己不带参数，改它的是 §4.1、§4.2、§4.3 三组（谱形、宇宙学、门槛）。论文出处：§3.6（见文末）。

## 八、M_min(z) · 最小晕质量

它是"多大的晕才配算源"那道门槛（§2.3）：由维里温度门槛经维里平衡反解成质量。它对温度与红移都是幂律，随红移升高而变小。

代码上它由 `hmf.c` 的 `minimum_source_mass`（`:1261-1288`）拼出来：先按开关选分支（mini-halo 直接取 `M_MIN_INTEGRAL`、`M_MIN_in_Mass` 取 `M_TURN`），两条都不走才按温度换算，温度与平均分子量分两路取；换算本身在 `cosmology.c` 的 `TtoM`（`:671-687`），末尾还有一道 `min_factor` 的数值保险（§3.5）。

**它在这条链上的位置是源项积分的下限，局限在门槛只按维里温度画一条线。** 真实成核还受相对速度、分子冷却与反馈影响，这些不在这一步，而在后续环节以额外压制叠上去；算出的下限还要与网格能分辨的最小质量取较大者，分辨率不足时实际门槛由网格定。它对下游强非线性：下限一动，积分出的源数目与恒星形成率就成倍改变，也是这条链上参数简并最重的地方。**名下参数**是 §4.3 一组（`ION_Tvir_MIN`、`M_TURN`、`USE_MINI_HALOS`）加 §4.2 里的 `m22`。论文出处：§3.6（见文末）。

## 九、T_vir^min · 能形成恒星的最小晕维里温度

它是门槛那一侧的输入，不是算出来的量（§2.4）：气体在原子冷却生效前无法把引力势能辐射掉，这道温度门槛就是恒星形成与电离积分的下限高度。温度与质量由维里平衡互换，所以它只需要一个红移就能换出一个质量。

代码上它在 C 里没有计算位置：从参数面按 $\log_{10}$ 读入 `ION_Tvir_MIN`，Python 侧转成线性值后交给 `minimum_source_mass`（`hmf.c:1276-1278`）当 `TtoM` 的输入；X 射线那一侧对应 `X_RAY_Tvir_MIN`（§3.5）。

**它在这条链上的位置是"哪些晕算源"这条判断的起点，局限在它是一条不随环境变的常数线。** 它本身不含红移与环境的依赖，也不含真实晕的形态散布；相对速度、分子冷却与反馈都会挪动真实的门槛，要靠后续环节的额外压制补。**名下参数**就是它自己（`ION_Tvir_MIN`，§4.3），另有 `M_TURN` 与它同组配合。论文出处：§3.6 天体物理源与历史（见文末）。

## 十、代码地图

| 位置 | 是什么 |
| :--- | :--- |
| `HaloCatalog.c:38-439` | `ComputeHaloCatalog`：块的入口（块锚，线性密度场上的目录查找） |
| `HaloCatalog.c:81-83` | `init_ps` 与 `dicke`：功率谱表与生长因子 |
| `HaloCatalog.c:92-98` | 最小平滑质量取格子质量（采样器那一支取 HII 格子的质量） |
| `HaloCatalog.c:125` | `initialiseSigmaMInterpTable(M_MIN, M_MAX_INTEGRAL)`：表的范围 |
| `HaloCatalog.c:133-153` | 密度场搬进 k 空间并留一份副本 |
| `HaloCatalog.c:161-169`、`:183-184`、`:306` | 尺度序列：起始 $R$、循环条件与步长 |
| `HaloCatalog.c:194-204` | 塌缩阈值与 7σ 跳过 |
| `HaloCatalog.c:206-214` | 按 `HALO_FILTER` 滤波并变换回实空间 |
| `HaloCatalog.c:258-301` | 扫盒标记晕（过密度、`in_halo` 与半径重叠） |
| `HaloCatalog.c:318-341` | 目录落结构与补属性 |
| `HaloCatalog.c:443-533` | `check_halo`：重叠判定与球内格点标记 |
| `HaloCatalog.c:535-545` | `init_halo_coords`：分配质量与坐标数组 |
| `HaloCatalog.c:557-608` | `pixel_in_halo`：单点是否落在晕内 |
| `filtering.c:118-195` | `filter_box`：k 空间滤波（`FILTER` 与 `HALO_FILTER` 共用） |
| `hmf.c:502-524` | `unconditional_hmf`：口径分发与 FDM 压制（成员落点） |
| `hmf.c:269-281` | `dNdlnM_st`：Sheth–Tormen 那一支（成员落点） |
| `hmf.c:313`、`:338`、`:365`、`:156` | `dNdlnM_PS`、`dNdlnM_WatsonFOF`、`dNdlnM_WatsonFOF_z`、`dNdlnM_Delos`（口径 0、2、3、4） |
| `hmf.c:53-61` | DexM 势垒拟合常数与 `SHETH_a`/`SHETH_p`/`SHETH_A` |
| `hmf.h:10-11` | `M_MIN_INTEGRAL`（$10^5M_\odot$）与 `M_MAX_INTEGRAL`（$10^{16}M_\odot$）：积分与 σ 表的默认上下界 |
| `hmf.c:120`、`:142` | `sheth_delc_dexm`、`euler_to_lagrangian_delta` |
| `hmf.c:438-474` | `conditional_hmf`：条件路径（不乘 FDM 压制因子） |
| `hmf.c:676-697`、`:841-880` | `Fcollapprox`、`MFIntegral_Approx`、`IntegratedNdM`、`FgtrM`：解析近似与积分封装 |
| `hmf.c:900`、`:937` | `Nion_General`、`Xray_General`：源项的积分壳（把上限下限与权重拼在一起） |
| `hmf.c:1261-1288` | `minimum_source_mass`：门槛的拼装（成员落点） |
| `LuminosityFunction.c:259-262` | `ComputeLF` 里的质量函数用法（成员落点） |
| `cosmology.c:385`、`:398` | `dsigma_dk`、`sigma_z0`：窗积分 |
| `cosmology.c:450` | `dsigmasqdm_z0`：平方方差的对数导数 |
| `cosmology.c:487` | `TFset_parameters`：转移函数参数 |
| `cosmology.c:536` | `init_ps`：造功率谱 |
| `cosmology.c:622`、`:635` | `MtoR`、`RtoM`：质量—尺度换算 |
| `cosmology.c:541` | `init_ps` 里的中微子分数 `f_nu`（`OMn` 的落点） |
| `cosmology.c:648`、`:658` | `omega_mz`、`deltac_nonlinear` |
| `cosmology.c:699-737` | `dicke`：生长因子（`:720-732` 是 `OMtot` 与 `wl` 的判据支） |
| `cosmology.c:671-687` | `TtoM`：维里平衡反解（成员落点） |
| `interp_tables.c:1143-1197` | `initialiseSigmaMInterpTable`：σ 表与导数表的构建 |
| `interp_tables.c:95-99` | FDM 模式下另建的 CDM 参照表 |
| `interp_tables.c:1206`、`:1219`、`:1252` | `EvaluateSigma`、`EvaluatedSigmasqdm`、`EvaluateSigmaConditional` |
| `fdm.c:54-59`、`fdm.h:7`、`fdm.c:51` | `dndm_FDM`：FDM 压制因子与出处注释 |
| `Constants.h:62` | Delos 随机游走模型的临界过密度 |
| `HaloBox.c:614`、`IonisationBox.c:1446-1449` | 源项那一侧的 σ 表下界 |
| `wrapper/inputs.py:1320-1325` | `ION_Tvir_MIN` 的定义与对数换算 |
| `wrapper/inputs.py:1217` | `ION_Tvir_MIN` 的出处注释 |

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**质量函数的算法 · 窗积分与多重数公式**

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