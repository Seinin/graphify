# 晕到星系属性

这块是"晕 → 星系"的换算层：把晕质量与红移折成星系属性——恒星质量、恒星形成率、逃逸分数、金属性与 X 射线亮度；再把逐晕的属性按质量函数积成体积平均量，最后给出紫外光度函数供观测比对。上一块给的是晕的数目与质量，下一块要把这些质量变成光、电离光子与 X 射线，转换就发生在这里。

这一层的全部信息来自参数化的拟合关系，核心是恒星形成效率，其余属性都从它派生。原子与分子两条冷却支各有一套效率与转折质量，转折质量又被莱曼-维纳反馈与重子-暗物质相对速度放大——这是本块唯一带环境依赖的地方：同一质量、同一红移的晕，所处环境的背景强度不同，能量化成恒星的份额也不同。

三个量各有分工：效率与逃逸分数决定源有多强，恒星形成率密度把逐晕的量压成平均，紫外光度函数则是解开简并的那把钥匙——它把效率与逃逸分数的乘积拆成两个因子。局限也在这里：整套关系是拟合出来的平均链，散射、时标与环境依赖都被折成常数或幂指数，真实的星系形成过程比这更碎。

## 标度关系(M_h) · 恒星标度关系（晕属性 → 星系属性）

### 物理

这是把晕属性折成星系属性的那条换算链：从晕质量出发，依次给出恒星质量、恒星形成率、逃逸分数、金属性与 X 射线亮度。它是一条确定性的代数链，给定晕质量与红移就给出全套星系属性；参数逐红移演化一次，快照内部不再变，于是同一条关系在每个红移上就是一套固定常数。

核心两步是恒星质量与恒星形成率：恒星质量取重子比例乘恒星形成效率，恒星形成率取恒星质量除以恒星形成时标；时标以哈勃时间的一个分数给出，所以恒星形成率与哈勃膨胀同步演化。效率本身按双幂律随质量上升、在低质量端被指数截断，并允许对数正态的散射，这一段散布是晕与晕之间唯一的随机来源，金属性与 X 射线都跟着它走。前提是这些关系对整个晕成立，且原子与分子两支共用同一套效率口径。

驱动它的是晕质量、红移与参数面上的一组归一和指数；红移通过哈勃时间、冷却阈值与反馈项进入，不通过谱形。分子冷却支的转折质量由无反馈的基准质量乘上两个因子得到——一个随莱曼-维纳背景强度按幂律放大，一个随重子-暗物质相对速度按幂律放大；原子支的转折质量只由反馈与气体吸积不足给出。两支各自截断在原子冷却阈值附近，不互相穿透。

数学上它对质量是分段幂律，对反馈强度与相对速度也是幂律——指数的取值决定反馈有多强，因而这条链上几个指数彼此简并：放大反馈强度与压低电离效率可以让源项落在同一水平。它逐晕局域、无记忆，却也不含积分：星系属性只由当前的晕质量与红移决定，晕的并合历史与做过的恒星形成次数都不进入。

它产出恒星质量、恒星形成率、逃逸分数、金属性与 X 射线亮度，全部交给源项网格；恒星形成率密度与电离光子率再由这些量按质量函数积分。局限在于这套关系是拟合出来的平均链：金属性只由恒星质量、恒星形成率与红移三个量现算，且只为 X 射线关系服务，不反过来影响恒星形成；有限分辨与散粒效应也只在下游的网格校准里补。

$$M_\star=\frac{\Omega_b}{\Omega_m}\,f_\star M,\qquad \dot M_\star=\frac{M_\star}{t_\star\,t_H(z)}$$

### 变量名与 LaTeX 符号对照表

| 公式符号 | 含义 | 代码名（默认值） | 进 C 的换算 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| $A_{\rm LW}$ | Lyman-Werner 反馈强度：$M_{\rm turn}$ 随 LW 比强度 $J_{21}$ 的幂律放大系统的归一 | A_LW（2） | 原样（`src/py21cmfast/wrapper/inputs.py:1344-1344`） | `src/py21cmfast/src/thermochem.c:289-290` |
| $\beta_{\rm LW}$ | LW 反馈的幂指数（默认 0.6 取自最新模拟；Machacek+01 的口径是 0.47） | BETA_LW（0.6） | 原样（`src/py21cmfast/wrapper/inputs.py:1345-1345`） | `src/py21cmfast/src/thermochem.c:290-290` |
| $A_{v_{\rm cb}}$ | DM-重子相对速度对 $M_{\rm turn}$ 的影响强度；$v_{\rm cb}$ 以 `SIGMAVCB` 归一 | A_VCB（1） | 原样（`src/py21cmfast/wrapper/inputs.py:1346-1346`） | `src/py21cmfast/src/thermochem.c:292-293` |
| $\beta_{v_{\rm cb}}$ | 相对速度反馈的幂指数 | BETA_VCB（1.8） | 原样（`src/py21cmfast/wrapper/inputs.py:1347-1347`） | `src/py21cmfast/src/thermochem.c:293-293` |
| $t_\star$ | 恒星形成时标（以哈勃时间 $t_H$ 为单位）：$\dot M_\star=M_\star/(t_\star t_H)$ 的分母 | t_STAR（0.5） | 原样（`src/py21cmfast/wrapper/inputs.py:1343-1343`） | `src/py21cmfast/src/scaling_relations.c:57-57` |
| $t_H(z)$ | 哈勃时间 $1/H(z)$：给 $\dot M_\star$ 的时标当分母，装配常数时按当前红移现算一次 | t_hubble | 原样（`src/py21cmfast/src/cosmology.c:805-805`） | `src/py21cmfast/src/scaling_relations.c:56-56` |
| $\sigma_{\rm SFR}$ | 恒星质量到恒星形成率关系的对数正态散射（dex），$M_\star\ge10^{10}M_\odot$ 取这一档 | SIGMA_SFR_LIM（0.19） | dex 转 nats（`src/py21cmfast/wrapper/inputs.py:1358-1360`） | `src/py21cmfast/src/scaling_relations.c:58-58` |
| $\alpha_{\rm SFR}$ | 散射随恒星质量变化的幂指数：$M_\star<10^{10}M_\odot$ 段的斜率，取到下限为止 | SIGMA_SFR_INDEX（-0.12） | 原样（`src/py21cmfast/wrapper/inputs.py:1361-1361`） | `src/py21cmfast/src/scaling_relations.c:59-59` |
| — | 选口径：标度关系给中值（打开）还是条件分布的均值（关掉，减 $\sigma_\star^2/2$） | HALO_SCALING_RELATIONS_MEDIAN（false） | 原样（`src/py21cmfast/wrapper/inputs.py:1104-1104`） | `src/py21cmfast/src/scaling_relations.c:42-42` |
| $s$ | 逐晕散射抽样（标准正态）；集平均路不含这一项，散射只经 $\sigma_\star^2/2$ 修正回来 | star_rng | 原样（`src/py21cmfast/src/scaling_relations.c:342-343`） | `src/py21cmfast/src/scaling_relations.c:343-343` |
| $M_{\rm turn}^{\rm acg}$ | 原子冷却阈值对应的质量：$T_{\rm vir}=10^4\,{\rm K}$ 反解出来的质量下限 | atomic_cooling_threshold | 原样（`src/py21cmfast/src/thermochem.c:278-278`） | `src/py21cmfast/src/scaling_relations.c:79-79` |
| $M_{\rm turn}^{\rm mcg}$ | 分子冷却支的质量下限：先给无 LW 的临界质量，再按 LW 比强度与相对速度两项各自幂律放大 | lyman_werner_threshold | 原样（`src/py21cmfast/src/thermochem.c:289-293`） | `src/py21cmfast/src/scaling_relations.c:87-87` |

### 代码解析

装配常数的那一段（`scaling_relations.c:84-101`）先给分子支的无反馈临界质量（由 `lyman_werner_threshold` 现算），再用二分反解出两个质量限——使恒星形成效率、逃逸分数各自达到 1 的质量，另给 mini 支的两个同类下限。这四个数不是物理边界，是积分口径用的工具量：有了它们，积分上限才能按"效率还没饱和到 1"的位置来定。

转折质量本身在 `thermochem.c:289-299`：从无 LW 的基准 $3.314\times10^7(1+z)^{-1.5}$ 出发，乘上 LW 反馈因子与相对速度因子。这个函数里还留着 Schauer+20 联合拟合的另一版实现，被注释掉摆在旁边——两版给的是同类拟合的不同写法，比对口径版本时看的就是这几行。

抽样那一处（`scaling_relations.c:336-360`）落在 $f_\star$ 上：按开关决定用单幂律还是带高质量端附加幂律的双幂律，再乘低质量端的指数截断与逐晕抽样项，硬截断在 1 以内；分子支同形另抽一份，并多一项高质量端的压制。集平均那一路不带抽样，只把均值按半方差修正回来。同一段代码两种用法，读数前先看那个开关。

### 工程

- `src/py21cmfast/src/scaling_relations.c:336-360`

```c
    if (astro_options_global->USE_UPPER_STELLAR_TURNOVER && (f_a > fu_a)) {
        fstar_mean = scaling_double_PL(halo_mass, f_a, consts->upper_pivot_ratio, fu_a, fu_p);
    } else {
        fstar_mean = scaling_single_PL(halo_mass, consts->alpha_star, 1e10);  // PL term
    }
    // 1e10 normalisation of stellar mass
    f_sample = f_10 * fstar_mean *
               exp(-mturn_acg / halo_mass + star_rng * sigma_star - stoc_adjustment_term);
    if (f_sample > 1.) f_sample = 1.;

    sm_sample = f_sample * halo_mass * baryon_ratio;
    *star_acg = sm_sample;

    if (!astro_options_global->USE_MINI_HALOS) {
        *star_mcg = 0.;
        return;
    }

    f_sample_mini = scaling_single_PL(halo_mass, f_a_mini, 1e7) * f_7;
    f_sample_mini *= exp(-mturn_mcg / halo_mass - halo_mass / consts->acg_thresh +
                         star_rng * sigma_star - stoc_adjustment_term);
    if (f_sample_mini > 1.) f_sample_mini = 1.;

    sm_sample_mini = f_sample_mini * halo_mass * baryon_ratio;
    *star_mcg = sm_sample_mini;
```

#### set_scaling_constants
- `src/py21cmfast/src/scaling_relations.c:84-101`——按二分反解出本红移的 `Mlim_Fstar` / `Mlim_Fesc`（`Mass_limit_bisection`，锚在 `fstar_10` / `fesc_10` 上），并把 `M_TURN` 落成恒星形成下限 `mturn_a_nofb`；开 mini-halo 时另取 `mturn_m_nofb` 与两个 mini 下限。

```c
    consts->mturn_m_nofb = 0.;
    if (astro_options_global->USE_MINI_HALOS) {
        consts->vcb_norel = astro_options_global->FIX_VCB_AVG ? astro_params_global->FIXED_VAVG : 0;
        consts->mturn_m_nofb = lyman_werner_threshold(redshift, 0., consts->vcb_norel);
    }

    consts->Mlim_Fstar =
        Mass_limit_bisection(M_MIN_INTEGRAL, M_MAX_INTEGRAL, consts->alpha_star, consts->fstar_10);
    consts->Mlim_Fesc =
        Mass_limit_bisection(M_MIN_INTEGRAL, M_MAX_INTEGRAL, consts->alpha_esc, consts->fesc_10);

    if (astro_options_global->USE_MINI_HALOS) {
        consts->Mlim_Fstar_mini =
            Mass_limit_bisection(M_MIN_INTEGRAL, M_MAX_INTEGRAL, consts->alpha_star_mini,
                                 consts->fstar_7 * pow(1e3, consts->alpha_star_mini));
        consts->Mlim_Fesc_mini =
            Mass_limit_bisection(M_MIN_INTEGRAL, M_MAX_INTEGRAL, consts->alpha_esc,
                                 consts->fesc_7 * pow(1e3, consts->alpha_esc));
```

#### lyman_werner_threshold
- `src/py21cmfast/src/thermochem.c:289-299`——以无反馈的 `mcrit_noLW = 3.314e7 · (1+z)^-1.5` 起算，乘 LW 反馈因子 `f_LW(J_21_LW)` 与相对速度因子 `f_vcb(v_cb)`，得该红移的原子冷却阈值（Schauer+20 对两者的联合拟合）。

```c
    double mcrit_noLW = 3.314e7 * pow(1. + z, -1.5);
    double f_LW = 1.0 + astro_params_global->A_LW * pow(J_21_LW, astro_params_global->BETA_LW);

    double f_vcb =
        pow(1.0 + astro_params_global->A_VCB * vcb / SIGMAVCB, astro_params_global->BETA_VCB);

    // double mcrit_LW = mcrit_noLW * (1.0 + 10. * sqrt(J_21_LW)); //Eq. (12) in Schauer+20
    // return pow(10.0, log10(mcrit_LW) + 0.416 * vcb/SIGMAVCB ); //vcb and sigmacb in km/s, from
    // Eq. (9)

    return (mcrit_noLW * f_LW * f_vcb);
```

- 输入：晕质量 $M$、红移 $z$ 与标度关系参数；上游为 fstar 与 mmin
- 产出：$M_\star$、$\dot M_\star$、$f_{\rm esc}$、金属性 $Z$ 与 $L_X$

#### 口径分野

| 对象 | 论文式 | 代码式 | 判据 |
| :--- | :--- | :--- | :--- |
| 分子冷却支的转折质量 | $M_{\rm turn}=M_{\rm turn,0}f_{\rm LW}f_{v_{\rm cb}}$：LW 比强度与相对速度各自按幂律放大 | 同式，另加高质量端的 $-M_h/M_{\rm acg}$ 压制，且 $M_{\rm turn}$ 不低于原子冷却阈值 $M_{\rm acg}$ | 同一算法的细化版 |

### 参数语境

这一篇产出的是按红移算好的一套常数：恒星质量、恒星形成率、逃逸分数、金属性与 X 射线亮度。下面逐条说明每个参数进哪一段、动它哪些量跟着变。

#### ALPHA_ESC

逃逸分数随质量的幂指数，进这套常数里 f_esc 那一段。它不改恒星形成，只改"有多少电离光子能出晕"，因此它第一次起作用在下游的电离支。它与 `F_ESC10` 一起定逃逸分数线的形状与水平。

#### ALPHA_STAR

恒星形成效率低质量端的斜率，直接进恒星质量的幂律段，于是恒星形成率、X 射线亮度、逃逸分数那几段全部跟着它走。它是这套常数里最能改形状的一个数。

#### ALPHA_STAR_MINI

分子冷却支的同一个斜率。不填时按原子支的值延用，打开迷你晕后这套常数要按两支各算一份。

#### A_LW

莱曼-维尔纳反馈的幅度系数，进分子冷却支的转折质量（见本页口径分野那一行）。它不直接出现在恒星质量的式子里，而是经"能形成恒星的最低质量"改这一支的积分下限。

#### A_VCB

相对速度反馈的幅度系数，与 `A_LW` 并联进同一个转折质量。两者各自乘一个幂律因子，合起来抬高或压低分子冷却阈值。

#### BETA_LW

莱曼-维尔纳反馈的幂指数，定反馈随背景强度变化的快慢。

#### BETA_VCB

相对速度反馈的幂指数，作用方式相同、变量换成 $v_{\rm cb}$。

#### FIXED_VAVG

只在打开 `FIX_VCB_AVG` 时被读：用这个固定值代替逐点平均的相对速度，于是这套常数里反馈那一支不再带空间涨落。

#### F_ESC10

在 $10^{10}M_\odot$ 处锚定逃逸分数线。实现里用它按二分反解出本红移的 `Mlim_Fesc`（见本页 `set_scaling_constants` 那一处落点），也就是"逃逸分数等于基准值的那个质量"，再由它把整条逃逸分数曲线钉住；调它等于把这条曲线整体平移。

#### F_ESC7_MINI

分子冷却支的逃逸分数锚点，只在打开迷你晕时用于第二支；不填时沿用原子支。

#### F_STAR10

恒星质量的归一，进 $M_\star=\frac{\Omega_b}{\Omega_m}f_\star M$ 里的 $f_\star$。它是这套常数最主要的乘数：整套产出（恒星形成率、逃逸分数、X 射线亮度）都对它是线性的。

#### F_STAR7_MINI

分子冷却支的恒星质量归一。打开迷你晕后两支各有一套常数，它管低质量那一支的水平。

#### L_X

单位恒星形成率的比 X 射线光度，在这条链末尾乘上恒星形成率给出 X 射线亮度（`src/py21cmfast/src/scaling_relations.c:61`）。它是加热强度的直接来源，改它等于整体缩放加热率。

#### L_X_MINI

分子冷却支的同一个量（`scaling_relations.c:62`）。只在打开迷你晕时被读，给那一支再加一份 X 射线。

#### M_TURN

恒星形成的截断质量，落成本红移的恒星形成下限 `mturn_a_nofb`，同时进恒星效率的指数抑制项。它随反馈逐红移变化，因此是这套常数里唯一带红移演化的形状量。

#### PHOTON_CONS_TYPE

光子守恒修正的类型，作用在下游电离（`src/py21cmfast/wrapper/photoncons.py`）。标度关系这一步不读它，产出不受它影响。

#### POP2_ION

每重子的电离光子数。它不属于这套常数，作用面在电离支的源项上（与 `F_STAR10`、`F_ESC10` 组成电离效率）；放在这里是因为它与那两个量高度简并。

#### POP3_ION

分子冷却支的同一个量，作用面同样在电离支，且只在打开迷你晕时存在。

#### SIGMA_LX

X 射线光度关系的对数正态散射（dex，全晕全红移统一）。逐晕采样时它给每个晕一个 X 射线亮度上的随机偏移，是加热侧唯一的随机来源；集平均那条路只按半方差修正均值。

#### SIGMA_SFR_INDEX

恒星质量-恒星形成率关系的散射随质量变化的幂指数（参数面文档串给出的含义）。本仓 C 端不读它——全仓搜索只出现在参数面文档串里，这套常数里没有它的作用面。

#### SIGMA_SFR_LIM

恒星质量-恒星形成率关系在高质量端的对数正态散射（参数面文档串给出的含义），同样在本仓 C 端没有落点。

#### SIGMA_STAR

晕质量-恒星质量关系的对数正态散射。逐晕采样时每个晕在恒星质量上抽一个偏移，金属性与 X 射线亮度都跟着这份抽样走；集平均那条路把它折算成 $e^{-\sigma_\star^2/2}$ 的均值修正。

#### UPPER_STELLAR_TURNOVER_INDEX

高质量端附加幂律的指数（`USE_UPPER_STELLAR_TURNOVER` 打开时生效）。它改的是大质量晕的效率，同时把 X 射线那条比光度切成随金属性变化的双幂律。

#### UPPER_STELLAR_TURNOVER_MASS

上面那段附加幂律的拐点质量，定"从多大质量开始压"。

#### USE_MINI_HALOS

迷你晕总开关。打开时这一套常数要按两支各算一份，`F_STAR7_MINI`、`F_ESC7_MINI`、`L_X_MINI`、`ALPHA_STAR_MINI`、`A_LW`、`A_VCB`、`BETA_LW`、`BETA_VCB` 这一组只在这条支上有作用面；关闭时这一组参数在本篇全部空转。

## ρ̇*(z) · 恒星形成率密度

### 物理

恒星形成率密度是单位体积内所有晕的恒星形成率之和：把逐晕的恒星形成率按质量函数加权，从能形成恒星的最小质量积到上限。它是体积平均量，量纲是单位体积单位时间的质量，直接刻画源在整个盒子里有多亮。

公式就是一层积分：被积函数是质量函数乘逐晕的恒星形成率，下限是能形成恒星的最小质量，上限取到积分表的顶端。前提是质量函数与恒星形成率两项都已知、且可以分别处理——积分只把两者的乘积做加权，晕的成团与并合对平均量的贡献被略去。它对恒星形成效率是精确线性的：效率整体缩放多少，积分结果就缩放多少，所以源项的强度对这一个因子是处处相同的乘数。

进它的是质量函数与逐晕恒星形成率，二者又分别来自质量方差与标度关系；红移同时从三处进入——质量函数的塌缩阈值、标度关系的时标与冷却阈值。最小质量一挪，积分的下限就跟着动，而质量函数在阈值附近是陡降的，所以下限的微小变化会被放大成积分的成倍改变。

数学上它是线性积分、无记忆，却落在整条质量轴上：一个红移给一个数，不携带空间信息，真正需要空间分辨的部分留给源项网格去做。它与电离光子率共用同一个积分核，只把逃逸分数置一，这使两者只差一个常数因子，也意味着恒星形成效率与逃逸分数在平均量里仍是简并的。

它是源项的骨架：电离光子发射率、X 射线与莱曼-$\alpha$ 背景都正比于它，所以它一改，加热与电离的强度一起变。局限在这层积分只取体积平均——质量函数与恒星形成率之间的关联、以及再电离反馈对源的自洽压制都不在这里，只能靠下游把反馈折成阈值的移动再叠上去。

$$\dot\rho_\star(z)=\int_{M_{\min}(z)}^{\infty}\frac{\mathrm dn}{\mathrm dM}\,\dot M_\star(M,z)\,\mathrm dM$$

### 变量名与 LaTeX 符号对照表

| 公式符号 | 含义 | 代码名（默认值） | 进 C 的换算 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| $\dot M_\star^{\rm int}$ | 积分核：集平均恒星形成率密度复用 N_ion 的积分，只把逃逸分数置 1、幂指数置 0 | evolve_scaling_constants_sfr | 原样（`src/py21cmfast/src/scaling_relations.c:106-109`） | `src/py21cmfast/src/interp_tables.c:950-950` |
| $\dot\rho_\star(z)$ | 晕质量函数积出来的平均恒星形成率密度；`USE_INTERPOLATION_TABLES` 大于 1 时改查表（同名两义：逐晕记录里的恒星形成率与体积平均的恒星形成率密度；另一义见 $\dot M_\star(M_h)$） | averages_out->halo_sfr | 原样（`src/py21cmfast/src/interp_tables.c:944-945`） | `src/py21cmfast/src/HaloBox.c:150-150` |
| $\Omega_b/\Omega_m$ | 重子比例：把晕质量换成重子质量的那一步；`OMm` 与 `OMb` 取 Planck18 的 Om0 与 Ob0，前因子再乘 `RHOcrit` | baryon_ratio | 原样（`src/py21cmfast/src/scaling_relations.c:331-331`） | `src/py21cmfast/src/HaloBox.c:114-118` |
| $\bar{\dot M}_\star$ | 积分里的恒星形成率本身：$M_\star/(t_\star t_h)$，$t_h$ 由红移定 | prefactor_sfr | 原样（`src/py21cmfast/src/scaling_relations.c:380-380`） | `src/py21cmfast/src/HaloBox.c:118-118` |
| $M_{\rm turn}^{a}$ | 积分用的两个转折质量：原子支与分子支；分子支由 `A_LW`／`BETA_LW`／`A_VCB`／`BETA_VCB` 经 `lyman_werner_threshold` 定 | M_turn_a 与 M_turn_m | 原样（`src/py21cmfast/src/thermochem.c:292-293`） | `src/py21cmfast/src/HaloBox.c:134-143` |
| — | 选项：是否算自洽自旋温度（决定这条集平均积分要不要连 X 射线一起算） | USE_TS_FLUCT（false） | 原样（`src/py21cmfast/wrapper/inputs.py:1093-1093`） | `src/py21cmfast/src/HaloBox.c:131-143` |
| $\dot M_\star(M_h)$ | 逐晕路：那个晕自己的恒星形成率，写进每晕记录（同名两义：逐晕记录里的恒星形成率与体积平均的恒星形成率密度；另一义见 $\dot\rho_\star(z)$） | output->halo_sfr | 原样（`src/py21cmfast/src/scaling_relations.c:380-385`） | `src/py21cmfast/src/HaloBox.c:95-95` |
| $M_{\rm lim}^{f_\star}$ | 二分反解出的 $f_\star$ 达到 1 的质量：当电离积分上限与常数演化用，不是物理边界；$f_{\rm esc}$ 同法反解得 `Mlim_Fesc` | Mlim_Fstar | 原样（`src/py21cmfast/src/scaling_relations.c:90-93`） | `src/py21cmfast/src/hmf.c:910-910` |

### 代码解析

`HaloBox.c` 的 118 行起那一段先把几个前因子一次算好：恒星形成率的、电离光子的（恒星形成率前因子再乘逃逸分数与每重子的光子产额）、以及逃逸加权的版本与 mini 支的两份。之后才是积分：塌缩分数、逃逸加权的电离光子、只留恒星的那一份，只有开自旋温度涨落时才多算一条 X 射线。

这一段就是正文那句"它与电离光子率共用同一个积分核、只差一个常数因子"的代码样子：同一个 `Nion_General` 调两次，一次带逃逸权重、一次不带；不带的那一次用的是 `evolve_scaling_constants_sfr` 造出来的常数副本，副本里逃逸分数被置 1。

查表口径在 `interp_tables.c:941-951`：沿红移网格逐点把上面这套积分填进表里，源模型档位大于 0 时走电离积分核，否则退回塌缩分数——注释写明两处同源，这就是"同一个积分核两种入口"。

还有一处值得留意的注释：`HaloBox.c` 里那几个盒平均诊断量上标着未校准（原文直说这些平均值是错的）。它们是调试输出，读数时不要当成可信的平均。

### 工程

- `src/py21cmfast/src/HaloBox.c:118-150`

```c
    double prefactor_sfr = prefactor_stars / consts->t_star / t_h;
    double prefactor_sfr_mini = prefactor_stars_mini / consts->t_star / t_h;
    double prefactor_nion = prefactor_stars * consts->fesc_10 * consts->pop2_ion;
    double prefactor_nion_mini = prefactor_stars_mini * consts->fesc_7 * consts->pop3_ion;
    double prefactor_wsfr = prefactor_sfr * consts->fesc_10 * consts->pop2_ion;
    double prefactor_wsfr_mini = prefactor_sfr_mini * consts->fesc_7 * consts->pop3_ion;

    double mass_intgrl;
    double intgrl_fesc_weighted, intgrl_stars_only;
    double intgrl_fesc_weighted_mini = 0., intgrl_stars_only_mini = 0., integral_xray = 0.;

    // NOTE: we use the atomic method for all halo mass/count here
    mass_intgrl = Fcoll_General(consts->redshift, lnMmin, lnMmax);
    ScalingConstants consts_sfrd = evolve_scaling_constants_sfr(consts);

    intgrl_fesc_weighted = Nion_General(consts->redshift, lnMmin, lnMmax, M_turn_a, consts);
    intgrl_stars_only = Nion_General(consts->redshift, lnMmin, lnMmax, M_turn_a, &consts_sfrd);
    if (astro_options_global->USE_MINI_HALOS) {
        intgrl_fesc_weighted_mini =
            Nion_General_MINI(consts->redshift, lnMmin, lnMmax, M_turn_m, consts);

        intgrl_stars_only_mini =
            Nion_General_MINI(consts->redshift, lnMmin, lnMmax, M_turn_m, &consts_sfrd);
    }
    if (astro_options_global->USE_TS_FLUCT) {
        integral_xray = Xray_General(consts->redshift, lnMmin, lnMmax, M_turn_a, M_turn_m, consts);
    }

    averages_out->count = Nhalo_General(consts->redshift, lnMmin, lnMmax) * prefactor_mass *
                          VOLUME / HII_TOT_NUM_PIXELS;
    averages_out->halo_mass = mass_intgrl * prefactor_mass;
    averages_out->stellar_mass = intgrl_stars_only * prefactor_stars;
    averages_out->halo_sfr = intgrl_stars_only * prefactor_sfr;
```

- `src/py21cmfast/src/interp_tables.c:941-951`

```c
    double lnMmin = log(minimum_source_mass(redshift, true));
    double lnMmax = log(M_MAX_INTEGRAL);

    // The SFRD calls the same function as N_ion but sets escape fractions to unity
    // NOTE: since this only occurs on integration, the struct copy shouldn't be a bottleneck
    ScalingConstants sc_sfrd = evolve_scaling_constants_sfr(sc);
    sc_sfrd = evolve_scaling_constants_to_redshift(redshift, &sc_sfrd, false);

    if (matter_options_global->SOURCE_MODEL > 0)
        return Nion_General(redshift, lnMmin, lnMmax, sc_sfrd.mturn_a_nofb, &sc_sfrd);
    return Fcoll_General(redshift, lnMmin, lnMmax);
```

- 输入：$\dot M_\star(M)$ 与 $\mathrm{d}n/\mathrm{d}M$；上游为 dn_dm 与 scaling_relations
- 产出：恒星形成率密度 $\dot\rho_\star(z)$（体积平均）

#### 口径分野

| 对象 | 论文式 | 代码式 | 判据 |
| :--- | :--- | :--- | :--- |
| 平均恒星形成率密度的积分 | $\dot\rho_\star=\int \frac{{\rm d}n}{{\rm d}M}\dot M_\star\,{\rm d}M$，与电离积分 $\int \frac{{\rm d}n}{{\rm d}M}f_{\rm esc}\dot M_\star\,{\rm d}M$ 并列 | 两个积分共用同一个积分核 `Nion_General`：算 $\dot\rho_\star$ 时只把 $f_{\rm esc}$ 置 1、幂指数置 0 | 同一算法的细化版 |

### 参数语境

先写一条分界：这一篇用的是电离积分那把核（`Nion_General`）的去电离版——逃逸分数被置一、每重子光子数被置零。凡在别处管"有多少光子跑出来"的参数，在这里都不进入被积函数，下面各自注明它们真正的作用面。

#### ALPHA_ESC

逃逸分数随质量的幂指数。本式的核把逃逸分数置一，这一篇不看它；它的作用面在电离支的光子积分上，改的是电离历史的形状。

#### ALPHA_STAR

恒星形成效率低质量端的斜率，进被积函数 $\dot M_\star(M)$ 的幂律段。积分对它是非线性响应：斜率抬高一点，积分下限附近的贡献被放大一截，结果的变化远大于线性。

#### ALPHA_STAR_MINI

分子冷却支的同一个斜率，只在打开迷你晕时参与第二支积分；关掉迷你晕时被积函数只剩一支，它不进入。

#### A_LW

莱曼-维尔纳反馈的幅度系数。它抬高分子冷却晕的转折质量，于是积分下限上移；质量函数在阈值附近陡降，下限一动，积分跟着成倍变化，它是"反馈压制源"的主通道之一。

#### A_VCB

重子-暗物质相对速度反馈的幅度系数，经同一个转折质量进入积分下限。它与 `A_LW` 共用下游的调制路径，两者在平均量上部分简并。

#### BETA_LW

莱曼-维尔纳反馈的幂指数，定的是反馈强度随背景强度变化的快慢。指数越大，背景一涨阈值就抬得越猛，源被压得越早。

#### BETA_VCB

相对速度反馈的幂指数，作用方式与 `BETA_LW` 相同、变量换成 $v_{\rm cb}$。

#### FIXED_VAVG

只在打开 `FIX_VCB_AVG` 时被读：用这个固定的平均相对速度代替逐格点值，于是反馈强度不再带空间涨落，积分下限在全盒统一。它属于数值简化档，常用于需要压低计算量的扫描。

#### F_ESC10

在 $10^{10}M_\odot$ 处锚定逃逸分数线的归一。本式的核把它置一，这一篇不读它；它在上游的标度关系里定出逃逸分数随质量与红移的曲线（`set_scaling_constants` 一侧）。

#### F_ESC7_MINI

分子冷却支的逃逸分数归一。同样被本式的核置一，且只在打开迷你晕时才有作用面。

#### F_STAR10

恒星形成效率的归一，是本式最直接的乘数：整体缩放多少，$\dot\rho_\star$ 就缩放多少，对质量与红移处处相同。它与逃逸分数、每重子光子数在观测量上简并。

#### F_STAR7_MINI

分子冷却支的恒星形成效率归一，只缩放第二支积分。它和 `F_STAR10` 是"同一件事在两个质量段上的取值"，两支叠加才是全部源。

#### INHOMO_RECO

非均匀再复合的总开关。打开时平均量里多一项按局部电离度加权的源（`src/py21cmfast/src/HaloBox.c:179` 累加的 `mean_wsfr`），也就是再电离反馈压制源那条路，本篇的平均积分因此与再复合历史耦合；关闭时源强只由标度关系与质量函数决定。

#### INTEGRATION_METHOD_ATOMIC

原子冷却支积分的求积方法。它决定这个积分怎么算出来，换方法只带来小的数值差异，物理不变；属于数值选项，扫描时一般不动。

#### INTEGRATION_METHOD_MINI

分子冷却支的求积方法，与 `INTEGRATION_METHOD_ATOMIC` 各管一支，可以取不同方法；关掉迷你晕时它不参与。

#### L_X

单位恒星形成率的比 X 射线光度。被积函数里只有恒星形成率，它不进入这一篇的积分；它的作用面在下游的 X 射线加热（见本块 `thermal`）。

#### L_X_MINI

分子冷却支的对应量，同样不在这一篇的积分里；只在打开迷你晕时被加热那一侧读。

#### M_TURN

恒星形成的截断质量。它定出积分的下限与低质量端的抑制：低于这个质量的晕几乎不贡献，下限附近的形状由它把着。它随红移由反馈移动，所以这个积分对本篇里的红移演化比对任何指数都敏感。

#### OMb

重子密度。它经恒星质量的重子比例 $\Omega_b/\Omega_m$ 进入被积函数，是整体乘数；它与 `OMm` 在这条链上总是成对出现，单独的取值不能与恒星形成效率归一分开。

#### OMm

总物质密度。它同时动两处：质量函数的归一与塌缩阈值（进积分核），以及重子比例（进被积函数）。因此它不是单纯的缩放，调它会把积分的形状也改掉。

#### PHOTON_CONS_TYPE

光子守恒修正的类型，作用在下游电离（`src/py21cmfast/wrapper/photoncons.py`）。这一篇的积分不看它。

#### POP2_ION

每重子的电离光子数。本式的核把幂指数置零，它不进入这一篇；它的作用面在电离支的光子源上，与 `F_STAR10`、`F_ESC10` 一起组成电离效率。

#### POP3_ION

分子冷却支的同一个量，作用面同样在电离支，且只在打开迷你晕时存在。

#### SIGMA_LX

X 射线光度关系的对数正态散射。它属于加热那一条链的随机来源，不在本篇积分里。

#### SIGMA_SFR_INDEX

恒星质量-恒星形成率关系的散射随质量变化的幂指数（参数面文档串给出的含义）。本仓 C 端不读它——全仓搜索只出现在参数面文档串里，因此在这条积分上没有作用面。它是一例"参数面里有、代码里没落地"的量，写扫描配置时不要指望它改结果。

#### SIGMA_SFR_LIM

恒星质量-恒星形成率关系在高恒星质量端的对数正态散射（参数面文档串给出的含义）。与 `SIGMA_SFR_INDEX` 一样，本仓 C 端不读它。

#### SIGMA_STAR

晕质量-恒星质量关系的对数正态散射。集平均这条路上它以 $e^{-\sigma_\star^2/2}$ 的形式把有效归一压低；逐晕记录那一路另外逐晕抽样，于是同一个红移上域会出现多条源强史，本篇给出的是它们的平均。

#### UPPER_STELLAR_TURNOVER_INDEX

恒星质量-晕质量关系里高质量端那段附加幂律的指数（`USE_UPPER_STELLAR_TURNOVER` 打开时生效）。它把大质量晕的效率压回，因此改的是被积函数高端那一侧——在积分里高端权重本来就小，所以它对平均量的影响远小于低质量端指数。

#### UPPER_STELLAR_TURNOVER_MASS

上面那段附加幂律的拐点质量，定"从多大质量开始压"。调小它，大质量晕更早进入被压制区段。

#### USE_MINI_HALOS

迷你晕总开关。关掉时被积函数只有原子支、下限取原子冷却阈值，同时 `F_STAR7_MINI`、`F_ESC7_MINI`、`L_X_MINI`、`ALPHA_STAR_MINI` 等一整组参数在本篇全部失去作用面；打开时多一支积分，源强在低质量端明显增强。

#### USE_TS_FLUCT

自旋温度涨落的总开关。它决定这次计算走逐格点那条路还是全宇宙平均那条路（`src/py21cmfast/src/HaloBox.c:77` 起多处分岔）：打开时逐格点走、并配套额外网格量，关闭时只剩平均量可用。它不改变积分本身，改的是"这个平均量在哪种框架下被用"。

## φ(M_1500, z) · UV 光度函数

### 物理

紫外光度函数是观测侧的星系光度分布：单位体积、单位星等区间里有多少星系。实现不拟合解析的 Schechter 形式，而是把晕质量函数整体换元到绝对星等轴——先按恒星形成效率算出恒星形成率，乘一个紫外转换系数折成星等，再在星等轴上取质量函数除以换算因子，并乘上截断质量的抑制因子与一个占空比。

它的关键作用不是进物理链，而是解简并：观测到的光度分布把恒星形成效率与逃逸分数的乘积拆开，因此能把综合电离效率因子里的那条简并打破。前提是恒星形成率到紫外光度是一条定值换算、且质量到星等的映射单调——当效率的低质量端斜率过陡时换元不再成立，那是这条方法的适用边界。

它对参数是分段响应：换元把质量轴的非线性斜率搬到星等轴上，星等越亮对应的质量越大，两端各由效率与截断质量主导。局限在它只到平均关系为止——紫外尘埃衰减、金属性与爆发式恒星形成都不在换算里，与观测对比时要靠额外的选择效应修正补齐。

$$\phi(M_{1500},z)=\left|\frac{{\rm d}M_{1500}}{{\rm d}M_h}\right|^{-1}\,\frac{{\rm d}n}{{\rm d}M_h}\,\exp\!\left(-\frac{M_{\rm turn}}{M_h}\right)f_{\rm duty}$$

### 变量名与 LaTeX 符号对照表

| 公式符号 | 含义 | 代码名（默认值） | 进 C 的换算 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| $L_{\rm UV}/{\rm SFR}$ | 单位恒星形成率的紫外光度：$1/1.15\times10^{-28}$ [M_sun yr^-1 erg^-1 s Hz]（Sun & Furlanetto 2016） | Luv_over_SFR | 原样（`src/py21cmfast/src/LuminosityFunction.c:24-24`） | `src/py21cmfast/src/LuminosityFunction.c:147-147` |
| $M_{1500}$ | 绝对紫外星等：51.63 是太阳的绝对星等基准，$\dot M_\star$ 先由 $\Omega_b/\Omega_m$ 与 $t_\star$ 定出 | Muv_param | 原样（`src/py21cmfast/src/LuminosityFunction.c:141-145`） | `src/py21cmfast/src/LuminosityFunction.c:151-151` |
| ${\rm d}M_{\rm UV}/{\rm d}M_h$ | 换元的雅可比：把晕质量轴换成紫外星等轴（中心差分，插值后逐点算） | dMuvdMhalo | 原样（`src/py21cmfast/src/LuminosityFunction.c:206-221`） | `src/py21cmfast/src/LuminosityFunction.c:262-262` |
| $f_{\rm duty}$ | 占空因子：只有 $M_h>M_{\rm crit}$ 的晕才点亮（原子支的阈值用 `Mcrit_atom`） | f_duty_upper | 原样（`src/py21cmfast/src/LuminosityFunction.c:199-199`） | `src/py21cmfast/src/LuminosityFunction.c:262-262` |
| $\phi(M_{\rm UV},z)$ | 紫外光度函数（单位 dex、单位 Mpc^3）：晕质量函数乘占空因子再除以雅可比 | log10phi | 原样（`src/py21cmfast/src/LuminosityFunction.c:197-199`） | `src/py21cmfast/src/LuminosityFunction.c:199-199` |
| ${\rm d}n/{\rm d}M_h$ | 无条件的晕质量函数；$\Omega_m\rho_{\rm crit}$ 的前因子在调用处补上 | unconditional_hmf | 原样（`src/py21cmfast/src/LuminosityFunction.c:259-260`） | `src/py21cmfast/src/LuminosityFunction.c:197-197` |

### 代码解析

主循环在 `ComputeLF`（`LuminosityFunction.c:186-199`）：对每个质量格，用质量到星等样条的导数把质量函数换算到星等轴上——导数取相邻两点做中心差分——再乘截断质量的抑制因子与占空比，取对数得到该红移、该格点的 `log10 phi`。占空比在原子支直接记 1，分子支按 $e^{-M/M_{\rm crit}}$ 衰减。另一个函数（253–262 行）给出的是同一形状的另一条出口，两处的表达式可以互相对照。

口径上要点明一句：论文里常写的 Schechter 三参数形式在代码里不存在，这里是质量函数换元到星等轴，所以拿论文拟合式来比这里的输出，比的是两条不同的路。

适用边界也写在注释里：这条换元在低质量端斜率过陡时会失效，注释直接标出参数区间——它同时说明这个区间本身不物理。看到"换元"两个字就该想到这一条限制。

### 工程

- `src/py21cmfast/src/LuminosityFunction.c:253-262`

```c
                for (i = 0; i < nbins; i++) {
                    if (component == 1)
                        f_duty_upper = 1.;
                    else
                        f_duty_upper = exp(-(Mhalo_param[i] / Mcrit_atom));

                    dndm = unconditional_hmf(growthf, log(Mhalo_param[i]), z_LF[i_z], mf) *
                           (cosmo_params_global->OMm * RHOcrit) / Mhalo_param[i];
                    log10phi[i + i_z * nbins] = log10(dndm * exp(-(M_TURNs[i_z] / Mhalo_param[i])) *
                                                      f_duty_upper / deriv[i]);
```

#### ComputeLF
- `src/py21cmfast/src/LuminosityFunction.c:186-199`——对每个质量格：用 `M_UV(M_h)` 的样条导数把质量函数换算到 `M_UV` 空间，乘 `M_TURN` 截断与占空比（原子冷却记 1、分子冷却记 `exp(-M/Mcrit_atom)`），得 `log10 phi`，低于 `-30` 截断。

```c
                    Muv_1 = gsl_spline_eval(LF_spline, lnMhalo_i - delta_lnMhalo, LF_spline_acc);
                    Muv_2 = gsl_spline_eval(LF_spline, lnMhalo_i + delta_lnMhalo, LF_spline_acc);

                    dMuvdMhalo = (Muv_2 - Muv_1) / (2. * delta_lnMhalo * exp(lnMhalo_i));

                    if (component == 1)
                        f_duty_upper = 1.;
                    else
                        f_duty_upper = exp(-(Mhalo_param[i] / Mcrit_atom));

                    log10phi[i + i_z * nbins] = log10(
                        unconditional_hmf(growthf, lnMhalo_i, z_LF[i_z], mf) / Mhalo_param[i] *
                        exp(-(M_TURNs[i_z] / Mhalo_param[i])) *
                        (cosmo_params_global->OMm * RHOcrit) * f_duty_upper / fabs(dMuvdMhalo));
```

- 输入：$M_{1500}(M_h)$ 的换算链（恒星形成率乘紫外转换系数折成星等）与晕质量函数；上游为 fstar、mmin、rho_star
- 产出：每个红移一条 $\phi(M_{1500},z)$（单位星等内的数密度）

#### 口径分野

| 对象 | 论文式 | 代码式 | 判据 |
| :--- | :--- | :--- | :--- |
| 紫外光度函数的解析形式 | Schechter 三参数形式：$\phi^\star(M_{\rm UV}/M^\star)^{\alpha}e^{-M_{\rm UV}/M^\star}$ | 把晕质量函数换元到紫外星等轴：$\phi=\frac{{\rm d}n}{{\rm d}M_h}f_{\rm duty}\big/\lvert{\rm d}M_{\rm UV}/{\rm d}M_h\rvert$；三个 Schechter 参数在代码里不存在 | 两码事 |

### 参数语境

#### M_TURN

与恒星效率里同一个截断质量，在这里进亮端抑制因子 $e^{-M_{\rm turn}/M_h}$，把低于截断质量的晕从光度分布里压出去，定的是光度函数暗端的拐点。改它动暗端整段：调大截断质量，能算作星系的晕变少，暗端下移；亮端对应质量远高于截断，几乎不动。这条曲线上截断质量与效率归一简并——同一段暗端可以由"效率低、截断质量小"或"效率高、截断质量大"两种组合拼出来，要靠与 21 厘米观测联立才能把两者拆开。

#### OMm

它经恒星形成率进入星等换算：恒星形成率先由重子比例 $\Omega_b/\Omega_m$ 与恒星形成时标定出，再折成绝对星等（`src/py21cmfast/src/LuminosityFunction.c:141-145`、`151-151`）。它是整体乘数，在光度函数上等价于把星等轴平移，与恒星形成效率的归一简并。

#### USE_MINI_HALOS

打开时占空比多一条分子冷却支，记 $e^{-M/M_{\rm crit,atom}}$：分子冷却晕的存活概率随质量指数衰减，暗端形状随之改变；关闭时只剩原子支、占空比恒为一。这条开关同时让上游源项多一支，所以光度函数的暗端与 21 厘米的源强会一起变。

## f* · 恒星形成效率

### 物理

恒星形成效率回答"一个晕里的重子有多少能变成恒星"：它是无量纲的比例，低质量端随晕质量上升，在几十亿到一百亿太阳质量的量级上落在千分之几到百分之几，再往大质量端被反馈压回来。这条曲线是晕与星系之间唯一的换算，链上所有源项都从它出发。

公式由三段拼成：低质量端一条斜率为正的幂律，高质量端在拐点质量处换成一条更陡的负幂律，两段在拐点处按归一接通，使该处的取值不随两段如何衔接而变；低质量端再乘一个随质量倒数衰减的指数，压住留不住气体的小晕；最后按对数正态在给定散射宽度内逐晕抽一次，并硬截断在一以内。前提是恒星质量与晕质量之间存在平均关系、且星系的恒星形成在时标上稳恒，爆发式的短时标事件不在其中。

进它的是晕质量与红移；归一、两段指数、拐点质量与截断质量都从参数面读入，红移只通过截断质量随反馈变化。散射那一档在逐晕记录上逐条抽样，集平均那一路不带抽样，只把均值按半方差修正回来——这是链上晕与晕之间唯一的随机来源，金属性与 X 射线都跟着它走。

数学上它对参数是幂律响应：归一是指数上的乘数，两个指数分别定两端的斜率，拐点只改曲线的弯折位置。它与逃逸分数、每个重子的电离光子数在源项里只以乘积出现，三者两两简并，单独一个都约束不到，得靠紫外光度分布与 21 厘米两种观测联立把乘积拆开。硬截断在一以内则保证不出现恒星质量超过重子质量的非物理取值。

它把晕质量换成恒星质量与恒星形成率，供恒星形成率密度、电离光子率与 X 射线三处共用；分子冷却支另有一条同形的单幂律，只多一项高质量端的压制。局限在它是条件分布的平均关系：真实的恒星形成散布更大、时标更短、还受体相与并合的瞬时影响，这些不在这条代数式里，只能靠散射那一项与下游的有效时标近似吸收。

$$f_\star=f_{\star,10}\,\frac{\left(\frac{M_{\rm up}}{10^{10}M_\odot}\right)^{\alpha_\star}+\left(\frac{M_{\rm up}}{10^{10}M_\odot}\right)^{\alpha_{\rm up}}}{\left(\frac{M}{M_{\rm up}}\right)^{-\alpha_\star}+\left(\frac{M}{M_{\rm up}}\right)^{-\alpha_{\rm up}}}\exp\!\left(-\frac{M_{\rm turn}}{M}+s\,\sigma_\star-\frac{\sigma_\star^2}{2}\right)\le 1$$

### 变量名与 LaTeX 符号对照表

| 公式符号 | 含义 | 代码名（默认值） | 进 C 的换算 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| $f_{\star,10}$ | $10^{10}M_\odot$ 晕里的恒星质量分数：参数面按 $\log_{10}$ 存，进 C 才换算成线性值 `fstar_10`（两者不是同一个数）；也是 `HII_EFF_FACTOR` 的替代口径之一 | F_STAR10（-1.3） | 对数转线性（`src/py21cmfast/wrapper/inputs.py:1282-1285`） | `src/py21cmfast/src/scaling_relations.c:44-44` |
| $\alpha_\star$ | 恒星质量分数的低质量端幂指数，1e10 M_sun 为归一质量 | ALPHA_STAR（0.5） | 原样（`src/py21cmfast/wrapper/inputs.py:1288-1288`） | `src/py21cmfast/src/scaling_relations.c:45-45` |
| $\sigma_\star$ | 晕质量到恒星质量关系的对数正态散射（dex），全质量与全红移统一 | SIGMA_STAR（0.25） | dex 转 nats（`src/py21cmfast/wrapper/inputs.py:1352-1353`） | `src/py21cmfast/src/scaling_relations.c:46-46` |
| $f_\star(M_h)$ | 抽样后截断在 1：$f_\star$ 取 exp(-M_turn/M_h + 散射) 的乘积上限 | f_sample | 原样（`src/py21cmfast/src/scaling_relations.c:342-343`） | `src/py21cmfast/src/scaling_relations.c:344-344` |
| $M_{\rm turn}$ | 反馈（SNe、光致加热、气体吸积不足）压制恒星形成的特征质量；开 mini 时不低于原子冷却阈值 $M_{\rm acg}$ | M_TURN（8.7） | 对数转线性（`src/py21cmfast/wrapper/inputs.py:1308-1309`） | `src/py21cmfast/src/scaling_relations.c:80-80` |
| $f_{\star,7}$ | MCG 支的 1e7 M_sun 归一与幂指数：$f_{\star,7}$（`F_STAR7_MINI`，必填无默认）与 `ALPHA_STAR_MINI`（同样必填） | F_STAR7_MINI（必填，无默认） | 对数转线性（`src/py21cmfast/wrapper/inputs.py:1292-1292`） | `src/py21cmfast/src/scaling_relations.c:354-354` |
| $M_{\rm pivot}^{\rm up}$ | 高质量端附加幂律的拐点质量（`USE_UPPER_STELLAR_TURNOVER` 打开时生效） | UPPER_STELLAR_TURNOVER_MASS（11.447） | 对数转线性（`src/py21cmfast/wrapper/inputs.py:1348-1349`） | `src/py21cmfast/src/scaling_relations.c:49-49` |
| $\alpha_{\rm up}$ | 高质量端附加幂律的指数；与 $\alpha_\star$ 一起进 `upper_pivot_ratio`，保证 $f_\star$ 不上翘 | UPPER_STELLAR_TURNOVER_INDEX（-0.6） | 原样（`src/py21cmfast/wrapper/inputs.py:1351-1351`） | `src/py21cmfast/src/scaling_relations.c:48-48` |
| $\alpha_{\star,7}$ | 分子冷却支恒星形成效率的幂指数：与 $f_{\star,7}$ 一起给那条支路的质量依赖 | ALPHA_STAR_MINI（必填，无默认） | 原样（`src/py21cmfast/wrapper/inputs.py:1293-1293`） | `src/py21cmfast/src/scaling_relations.c:54-54` |

### 代码解析

它没有独立的计算入口，是参数面上的一组数：归一 `F_STAR10`、斜率 `ALPHA_STAR`、散射 `SIGMA_STAR`、可选的高质量端拐点与指数，以及截断质量 `M_TURN`。前两个按 10 的幂存、散射按 dex 存，进 C 之前一律要换算，别把参数面上的数与 C 里的数当成同一个。

看这块代码时要认准一点：那条式子在 `scaling_relations.c` 里被两条路共用——逐晕抽样与集平均，差别只在是否带那一档随机数、以及均值要不要按半方差修正回来，由开关 `HALO_SCALING_RELATIONS_MEDIAN` 决定。

口径分野也体现在这里：论文常见的写法是单幂律加指数截断，代码默认还要再乘一段高质量端的附加幂律，所以直接拿论文式反推这里的参数会系统性偏。开关关掉之后两者才重合。

### 工程

- 参数名：`ALPHA_STAR`、`F_STAR10`、`SIGMA_STAR`、`UPPER_STELLAR_TURNOVER_MASS`、`UPPER_STELLAR_TURNOVER_INDEX`、`M_TURN`

- 输入：参数表（F_STAR10、ALPHA_STAR、SIGMA_STAR、UPPER_STELLAR_TURNOVER_MASS、UPPER_STELLAR_TURNOVER_INDEX、M_TURN）；F_STAR10 与 UPPER_STELLAR_TURNOVER_MASS 按 10 的幂给出，SIGMA_STAR 按 dex 给出
- 产出：每个晕的 $f_\star$；乘晕质量与重子比例得到恒星质量，再逐格点累加进网格

这段是这条曲线的实现：给定质量与红移取出效率，红移只通过截断质量与常数项进来。所有系数在标度关系那一步（见本块 `scaling_relations`）按红移算一次，之后在本快照内不再变——同一快照里各晕、各质量共用同一套常数，质量依赖全部由式子本身承担。

#### 口径分野

| 对象 | 论文式 | 代码式 | 判据 |
| :--- | :--- | :--- | :--- |
| 恒星质量分数的质量依赖 | 单幂律加指数截断：$f_\star = f_{\star,10}(M_h/10^{10})^{\alpha_\star}e^{-M_{\rm turn}/M_h}$ | 低质量端单幂律，高质量端再乘一段附加幂律（`USE_UPPER_STELLAR_TURNOVER` 默认开），并对数正态散射、均值另乘 $e^{-\sigma_\star^2/2}$；同样截断在 1 | 同一算法的细化版 |

### 参数语境

#### ALPHA_STAR

低质量端的幂指数，式子里的 $\alpha_\star$。它定曲线在拐点以下的上升速度，是这条链上最能改形状的一个数：调大它，同样的归一在小晕处给出更高的效率，源项在低质量端的权重随之上升。

#### F_STAR10

归一 $f_{\star,10}$，即 $10^{10}M_\odot$ 处的取值。它对整条曲线是统一乘数，因此对恒星形成率、电离光子率与 X 射线是共同的整体缩放；它与逃逸分数、每重子光子数在观测量上简并，三者只能靠紫外光度分布与 21 厘米观测联立拆开。

#### M_TURN

指数项里的截断质量 $M_{\rm turn}$，默认取原子冷却阈值那一档。它的作用集中在 $M\lesssim M_{\rm turn}$ 的小晕：把这些晕的效率压向零，给曲线一个低质量端的硬掉头。它随红移由反馈移动，是本篇唯一带红移演化的形状量——同一个晕在不同红移上的效率差异，多半来自它。

#### SIGMA_STAR

晕质量-恒星质量关系的对数正态散射宽度（dex），式子里的 $\sigma_\star$。逐晕那一路上每个晕在指数里抽一个 $s\sigma_\star$，集平均那一路不带抽样、只留下 $-\sigma_\star^2/2$ 的均值修正，也就是把平均效率压低一个固定比例。它是晕与晕之间唯一的随机来源，金属性与 X 射线都跟着这份抽样走。

#### UPPER_STELLAR_TURNOVER_INDEX

高质量端附加幂律的指数（`USE_UPPER_STELLAR_TURNOVER` 打开时生效），式子里 $\alpha_{\rm up}$ 那一支的指数。它只改拐点以上部分：把大质量端的效率压回，同时保证两端在拐点处按归一接通、取值连续。关闭这条开关时这一支不出现，整条曲线退回单幂律加截断。

#### UPPER_STELLAR_TURNOVER_MASS

上面那段附加幂律的拐点质量 $M_{\rm up}$，定"从多大质量开始压"。它挪动曲线弯折的位置：调小它，大质量晕更早进入被压制的区段。

## L_X · X 射线光度（每单位恒星形成率）

### 物理

单位恒星形成率的 X 射线光度描述恒星形成活动以 X 射线形式输出多少能量：X 射线来自恒星形成区的双星与超新星遗迹，强度按金属性定，再乘该处的恒星形成率就得到 X 射线亮度。它是加热里最主要的外源，比光度在每太阳质量每年十的四十次方尔格每秒的量级。

公式是一个乘积：金属性依赖的比光度乘恒星形成率；实现默认把比光度取成常数，只有打开特定口径才走随金属性先升后降的双幂律，那条曲线在约百分之五太阳金属性处拐弯。前提是 X 射线只跟恒星形成活动的累积有关、不跟瞬时状态有关，因此它随恒星形成率的历史卷积进入加热，而非直接跟着某一刻的恒星形成率。

它是输入参数，也是 X 射线加热的强度来源；下游的加热率正比于恒星形成率的历史卷积与这个系数的乘积，所以这个归一整体平移到加热的幅度，并与电离效率在观测量里彼此简并。局限在金属性依赖默认被略去、金属性本身也只由恒星质量与红移现算，这条比光度在全参数空间里因此只是一个常数。

$$L_X=\left(\frac{L_X}{\rm SFR}\right)(Z)\,\dot M_\star$$

### 变量名与 LaTeX 符号对照表

| 公式符号 | 含义 | 代码名（默认值） | 进 C 的换算 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| $L_X/{\rm SFR}$ | 单位恒星形成率发出的比 X 射线光度；C 里以 1e38 erg/s 为单位存储 | L_X（40.5） | 对数转线性（`src/py21cmfast/wrapper/inputs.py:1326-1329`） | `src/py21cmfast/src/scaling_relations.c:61-61` |
| $L_X^{\rm mini}/{\rm SFR}$ | MCG 支的对应量（`USE_MINI_HALOS` 打开时按 mini 支再加一份 X 射线） | L_X_MINI（必填，无默认） | 对数转线性（`src/py21cmfast/wrapper/inputs.py:1332-1332`） | `src/py21cmfast/src/scaling_relations.c:62-62` |
| $\sigma_{L_X}$ | X 射线光度关系的对数正态散射（dex），全晕属性与全红移统一 | SIGMA_LX（0.5） | dex 转 nats（`src/py21cmfast/wrapper/inputs.py:1355-1356`） | `src/py21cmfast/src/scaling_relations.c:63-63` |
| $\left(L_X/{\rm SFR}\right)(Z)$ | 金属性依赖的双幂律（拐点 $Z=0.05$、高金属端指数 -0.64）；默认不启用，只有开 `USE_UPPER_STELLAR_TURNOVER` 才走这条 | lx_on_sfr_doublePL | 原样（`src/py21cmfast/src/scaling_relations.c:261-263`） | `src/py21cmfast/src/scaling_relations.c:306-307` |
| $Z(M_\star,\dot M_\star,z)$ | 晕金属性：由恒星质量、恒星形成率与红移现算（6 个硬编码拟合系数），只为 X 射线关系服务 | get_halo_metallicity | 原样（`src/py21cmfast/src/scaling_relations.c:397-397`） | `src/py21cmfast/src/scaling_relations.c:416-416` |
| $L_X$ | 晕的 X 射线光度：$L_X=\left(L_X/{\rm SFR}\right)\dot M_\star$，再乘对数正态散射因子；开 mini 时对 MCG 支再加一份 | get_halo_xray | 原样（`src/py21cmfast/src/scaling_relations.c:425-425`） | `src/py21cmfast/src/scaling_relations.c:433-434` |

### 代码解析

同样是参数面上的数：比光度 `L_X`（按 10 的幂存，C 里以 $10^{38}\,\mathrm{erg\,s^{-1}}$ 为单位）、分子支的对应量与散射宽度。它们只出现在标度关系的那一份常数表里，没有别的入口。

金属性那条依赖要认准默认状态：常数路径完全不看金属性，比光度就是一个数；只有打开高质量端转折那个开关才切到双幂律，随金属性先升后降。金属性本身也不是输入量，而是由恒星质量、恒星形成率与红移现算出来的，用的是 6 个硬编码系数（注释里说明尚未参数化），且它只为这条关系服务、不反过来影响恒星形成。

由此得到一条使用上的提醒：不要以为金属性是自由参数——在默认口径下它既不进参数表，也不改变 X 射线的强度。

### 工程

- 参数名：`L_X`

- 输入：参数表（L_X）
- 产出：标量 $L_X/{\rm SFR}$，进 X 射线加热

这一条在实现里只有一个动作：给出单位恒星形成率的 X 射线比光度。代码默认返回一个常数，只有当 `USE_UPPER_STELLAR_TURNOVER` 打开时才换成随金属性先升后降的双幂律；金属性本身由恒星质量、恒星形成率与红移现算，不来自额外的观测输入。

#### 口径分野

| 对象 | 论文式 | 代码式 | 判据 |
| :--- | :--- | :--- | :--- |
| X 射线光度与金属性的关系 | 双幂律：$L_X/{\rm SFR}$ 随金属性先升后降，拐点在 $0.05\,Z_\odot$ | 默认路径完全不看金属性（`get_lx_on_sfr` 直接返回常数），只有开 `USE_UPPER_STELLAR_TURNOVER` 才切到 `lx_on_sfr_doublePL` | 两码事 |

### 参数语境

#### L_X

单位恒星形成率的比 X 射线光度（默认 40.5，log10，代码里以 $10^{38}\,{\rm erg\,s^{-1}}$ 为单位存）。它是加热那一条链最上游的强度：加热率正比于它，它在标度关系里被读一次（`src/py21cmfast/src/scaling_relations.c:61`），之后经恒星形成率的历史卷积传到加热率，因此调它等于把整条加热曲线按比例抬高。它与电离效率在 21 厘米观测量上彼此简并——加热把气体加热得多、电离把气体电离得多，都能让同一个红移上的亮温落在同一位置。

同一批里还有两个量不在本篇名下：`L_X_MINI`（分子冷却支的对应量，只在打开迷你晕时被读）与 `SIGMA_LX`（这条关系的对数正态散射），两者的作用面都记在标度关系那一篇。

## 参数

本模块携带 31 个参数（与画布上这块的「参数」卡同一份清单；类别是 `inputs.py` 里的结构名）。下面逐条写它在代码里做什么；同一个参数**在某个成员那一步里**的语境与落点，写在那个成员节的「参数语境」里。

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `ALPHA_STAR` | `AstroParams` | 恒星形成效率低质量端的幂指数（默认 0.5），式子里那个 $\alpha_\star$。它定这条曲线在拐点以下的上升速度，是整条链上最能改形状的一个数：调大它，同样的归一在小晕处给出更高效率，恒星形成率、逃逸分数、X 射线亮度那几段常数一起跟着走。 |
| `F_STAR10` | `AstroParams` | 恒星形成效率的归一（默认 -1.3，log10），即 $10^{10}M_\odot$ 处的取值，进 $M_\star=\frac{\Omega_b}{\Omega_m}f_\star M$ 里的 $f_\star$。它对整条曲线是统一乘数：恒星形成率密度对它是线性的，电离光子率与 X 射线亮度同样缩放。它与逃逸分数、每重子光子数在观测量上简并，三者只能靠紫外光度分布与 21 厘米观测联立拆开。 |
| `M_TURN` | `AstroParams` | 恒星形成的截断质量（默认 8.7，log10），落在指数项 $e^{-M_{\rm turn}/M}$ 里，同时给出本红移的质量下限。它的作用集中在小晕：把这些晕的效率压向零，给曲线一个低质量端的硬掉头。它随红移由反馈移动，是这套常数里唯一带红移演化的形状量——同一个晕在不同红移上的效率差异，多半来自它。 |
| `SIGMA_STAR` | `AstroParams` | 晕质量-恒星质量关系的对数正态散射宽度（默认 0.5，dex），式子里那个 $\sigma_\star$。逐晕记录那条路上每个晕在指数里抽一个 $s\sigma_\star$，集平均那条路不抽样、只留下 $-\sigma_\star^2/2$ 的均值修正，把平均效率压低一个固定比例。它是晕与晕之间唯一的随机来源，金属性与 X 射线亮度都跟着这份抽样走。 |
| `UPPER_STELLAR_TURNOVER_INDEX` | `AstroParams` | 高质量端附加幂律的指数，只在 `USE_UPPER_STELLAR_TURNOVER` 打开时出现。它把大质量端的效率压回，并保证两端在拐点处按归一接通、取值连续；关掉那条开关，整条曲线退回单幂律加截断。 |
| `UPPER_STELLAR_TURNOVER_MASS` | `AstroParams` | 上面那段附加幂律的拐点质量（默认 11.5，log10）。它挪的是曲线弯折的位置：调小它，大质量晕更早进入被压制的区段。 |
| `L_X` | `AstroParams` | 单位恒星形成率的比 X 射线光度（默认 40.5，log10，代码里以 $10^{38}\,{\rm erg\,s^{-1}}$ 为单位存）。它在标度关系里被读一次（`scaling_relations.c:61`），乘上恒星形成率给出 X 射线亮度，是加热那条链最上游的强度：调它等于把整条加热曲线按比例抬高。它与电离效率在 21 厘米观测量上彼此简并。 |
| `ALPHA_ESC` | `AstroParams` | 逃逸分数随质量的幂指数。它进这套常数里逃逸分数那一段，与 `F_ESC10` 一起定这条线的形状与水平；它不改恒星形成，只改「有多少电离光子能出晕」，所以第一次起作用在下游的电离支。 |
| `ALPHA_STAR_MINI` | `AstroParams` | 分子冷却支的同一个斜率（不填时按原子支的值延用）。打开迷你晕后这套常数要按两支各算一份，而这一支在低质量端权重更大，因此它对本篇的影响比原子支的那个斜率更显著。 |
| `A_LW` | `AstroParams` | 莱曼-维尔纳反馈的幅度系数，进分子冷却支的转折质量。它不直接出现在恒星质量的式子里，而是经「能形成恒星的最低质量」改这一支的积分下限：反馈一强，能形成恒星的晕变少，源项被压下去。 |
| `A_VCB` | `AstroParams` | 相对速度反馈的幅度系数，与 `A_LW` 并联进同一个转折质量，两者各乘一个幂律因子。它与 `A_LW` 共用下游的调制路径，在平均量上部分简并。 |
| `BETA_LW` | `AstroParams` | 莱曼-维尔纳反馈的幂指数，定反馈强度随背景强度变化的快慢。指数越大，背景一涨阈值就抬得越猛，源被压得越早。 |
| `BETA_VCB` | `AstroParams` | 相对速度反馈的幂指数，作用方式与 `BETA_LW` 相同，变量换成 $v_{\rm cb}$。 |
| `FIXED_VAVG` | `AstroParams` | 只在打开 `FIX_VCB_AVG` 时被读：用这个固定值代替逐点平均的相对速度，反馈强度不再带空间涨落，转折质量与积分下限在全盒统一。它属于数值简化档，常用于需要压低计算量的扫描。 |
| `F_ESC10` | `AstroParams` | 在 $10^{10}M_\odot$ 处锚定逃逸分数线的归一（默认 -1.0，log10）。实现里按二分反解出本红移的 `Mlim_Fesc`（逃逸分数等于基准值的那个质量），再由它把整条曲线钉住；调它等于把这条线整体平移。它与 `F_STAR10`、`POP2_ION` 的乘积就是综合电离效率。 |

| `F_ESC7_MINI` | `AstroParams` | 分子冷却支的逃逸分数锚点（默认 -2.0），不填时沿用原子支。只在打开迷你晕时用于第二支。 |
| `F_STAR7_MINI` | `AstroParams` | 分子冷却支的恒星质量归一，管低质量那一支的水平。它与 `F_STAR10` 是同一件事在两个质量段上的取值，两支叠加才是全部的源；在「迷你晕是否主导早期电离」这个问题上它是关键旋钮。 |
| `L_X_MINI` | `AstroParams` | 分子冷却支的对应量（`scaling_relations.c:62`）。只在打开迷你晕时被读，给那一支再加一份 X 射线；关掉迷你晕时它在这个模块里没有作用面。 |
| `PHOTON_CONS_TYPE` | `AstroOptions` | 光子守恒修正的类型。它作用在下游电离（`wrapper/photoncons.py`）：标度关系这一步不读它，产出不受它影响。列在这里是因为它与电离支的一组旋钮同源、扫描时通常一起动。 |
| `POP2_ION` | `AstroParams` | 每重子的电离光子数（默认 5000）。它不属于这套常数，作用面在电离支的源项上（与 `F_STAR10`、`F_ESC10` 一起组成电离效率）；放在这一篇是因为它与那两个量高度简并。 |
| `POP3_ION` | `AstroParams` | 分子冷却支的同一个量（默认 44021），作用面同样在电离支，且只在打开迷你晕时存在。 |
| `SIGMA_LX` | `AstroParams` | X 射线光度关系的对数正态散射（默认 0.0，dex，全晕全红移统一）。逐晕采样时它给每个晕一个 X 射线亮度上的随机偏移，是加热侧唯一的随机来源；集平均那条路只按半方差修正均值。 |
| `SIGMA_SFR_INDEX` | `AstroParams` | 恒星质量-恒星形成率关系的散射随质量变化的幂指数。本仓 C 端不读它——全仓搜索只出现在参数面文档串里，这套常数里没有它的作用面。它是一例「参数面里有、代码里没落地」的量，写扫描配置时不要指望它改结果。 |
| `SIGMA_SFR_LIM` | `AstroParams` | 恒星质量-恒星形成率关系在高质量端的对数正态散射，同样在本仓 C 端没有落点。 |
| `USE_MINI_HALOS` | `AstroOptions` | 迷你晕总开关。打开时这一套常数要按两支各算一份，`F_STAR7_MINI`、`F_ESC7_MINI`、`L_X_MINI`、`ALPHA_STAR_MINI`、`A_LW`、`A_VCB`、`BETA_LW`、`BETA_VCB` 这一组只在这条支上有作用面；关闭时这一组在本篇全部空转。 |
| `INHOMO_RECO` | `AstroOptions` | 非均匀再复合的总开关。打开时平均量里多一项按局部电离度加权的源（`HaloBox.c:179` 累加的 `mean_wsfr`），也就是再电离反馈压制源那条路；关闭时源强只由标度关系与质量函数决定。 |
| `INTEGRATION_METHOD_ATOMIC` | `AstroOptions` | 原子冷却支积分的求积方法。换方法只带来小的数值差异，物理不变；属于数值选项，扫描时一般不动。 |
| `INTEGRATION_METHOD_MINI` | `AstroOptions` | 分子冷却支的求积方法，与上一项各管一支，可以取不同方法；关掉迷你晕时它不参与。 |
| `OMb` | `CosmoParams` | 重子密度。它经恒星质量的重子比例 $\Omega_b/\Omega_m$ 进被积函数，是整体乘数；同时又定数密度口径。它与 `OMm` 在这条链上总是成对出现，单独的取值不能与恒星形成效率归一分开。 |
| `OMm` | `CosmoParams` | 总物质密度。它同时动两处：质量函数的归一与坍缩阈值（进积分核），以及重子比例（进被积函数）。因此它不是单纯的缩放，调它会把积分的形状也改掉。 |
| `USE_TS_FLUCT` | `AstroOptions` | 自旋温度涨落的总开关（默认打开）。它决定这次计算走逐格点那条路还是全宇宙平均那条路（`HaloBox.c:77` 起多处分岔）：打开时逐格点走并配套额外网格量，关闭时只剩平均量可用。它不改变积分本身，改的是这个平均量在哪种框架下被用。 |

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**标度关系(M_h) · 恒星标度关系（晕属性 → 星系属性）**

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| LW 反馈对 $M_{\rm turn}$ 的修正（默认 22.8685 / 0.47） | Machacek+01（默认值）；Muñoz+21（Sec 2） | Impact of the LW feedback on Mturn for minihaloes. Default is 22.8685 and 0.47 following Machacek+01, respectively. Latest simulations suggest 2.0 and 0.6. See Sec 2 of Muñoz+21 (2110.13919). | `src/py21cmfast/wrapper/inputs.py:1245-1245` | 有正文（`docs/论文/The impact of the first galaxies on cosmic dawn and reionization.pdf`） |
| 相对速度对 $M_{\rm turn}$ 的修正（默认 1.0 / 1.8） | Muñoz+21（Sec 2） | Impact of the DM-baryon relative velocities on Mturn for minihaloes. Default is 1.0 and 1.8, and agrees between different sims. See Sec 2 of Muñoz+21 (2110.13919). | `src/py21cmfast/wrapper/inputs.py:1247-1247` | 有正文（`docs/论文/The impact of the first galaxies on cosmic dawn and reionization.pdf`） |
| $M_{\rm turn}$ 修正的拟合形式 | Visbal+15（取 Fialkov+12 的最优拟合） | this follows Visbal+15, which is taken as the optimal fit from Fialkov+12 | `src/py21cmfast/src/thermochem.c:287-287` | 有正文（`docs/论文/Fialkov+12_MNRAS424-1335_relative-velocity-cooling.pdf`） |
| LW 与相对速度的联合拟合 | Schauer+20 | correction follows Schauer+20, fit jointly to LW feedback and relative velocities. | `src/py21cmfast/src/thermochem.c:283-283` | 无正文（本地只有代码注释与 docstring） |
| 分子氢屏蔽因子的取值 | Qin+2020（Eq. 12）；Machacek+01 | Cf. Eq. 12 of Qin+2020. Consistently included in A_LW fit from sims. | `src/py21cmfast/wrapper/inputs.py:1239-1239` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：LW 与相对速度的联合拟合；分子氢屏蔽因子的取值。

**ρ̇*(z) · 恒星形成率密度**

- 论文节号：§3.6（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| $\dot\rho_\star$ 复用 $\dot N_{\rm ion}$ 的积分核（逃逸分数置 1） | 代码注释未给出处 | The SFRD calls the same function as N_ion but sets escape fractions to unity | `src/py21cmfast/src/interp_tables.c:944-944` | 无正文（本地只有代码注释与 docstring） |
| 晕质量函数 $dn/dM$（Universal FOF） | Watson+13 | Universal FOF HMF (Watson et al. 2013) | `src/py21cmfast/src/hmf.c:25-25` | 无正文（本地只有代码注释与 docstring） |
| Sheth–Tormen 质量函数的 $A$ 参数 | Jenkins+01 | Sheth and Tormen A parameter (from Jenkins et al. 2001) | `src/py21cmfast/src/hmf.c:61-61` | 无正文（本地只有代码注释与 docstring） |
| 盒平均量的诊断口径 | 注释自陈未校准（原文写 THESE AVERAGE BOXES ARE WRONG） | WARNING: THESE AVERAGE BOXES ARE WRONG, CHECK THEM | `src/py21cmfast/src/HaloBox.c:104-104` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：$\dot\rho_\star$ 复用 $\dot N_{\rm ion}$ 的积分核（逃逸分数置 1）；晕质量函数 $dn/dM$（Universal FOF）；Sheth–Tormen 质量函数的 $A$ 参数；盒平均量的诊断口径。

**φ(M_1500, z) · UV 光度函数**

- 论文节号：§3.6（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| $L_{\rm UV}$–${\rm SFR}$ 转换常数 | Sun & Furlanetto 2016（MNRAS 417, 33） | G. Sun and S. R. Furlanetto (2016) MNRAS, 417, 33 | `src/py21cmfast/src/LuminosityFunction.c:2-2` | 无正文（本地只有代码注释与 docstring） |
| 质量函数到星等轴的平滑换元的适用边界 | 代码注释未给出处（只标了参数范围限制） | NOTE: This method does NOT work in cases with ALPHA_STAR < -0.5. But, this parameter range is unphysical given that the | `src/py21cmfast/src/LuminosityFunction.c:167-167` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：$L_{\rm UV}$–${\rm SFR}$ 转换常数；质量函数到星等轴的平滑换元的适用边界。

**f* · 恒星形成效率**

- 论文节号：§3.6 天体物理源与历史（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| $f_\star(M_h)=f_{\star,10}\,(M_h/10^{10}M_\odot)^{\alpha_\star}\,\exp(-M_{\rm turn}/M_h)$ | Greig+2018（Eq. 11）；Park+2018（Sec 2.1） | This is used along with `F_ESC10` to determine `HII_EFF_FACTOR` (which is then unused). See Eq. 11 of Greig+2018 and Sec 2.1 of Park+2018. | `src/py21cmfast/wrapper/inputs.py:1169-1169` | 无正文（本地只有代码注释与 docstring） |
| $f_\star$ 的低质量端幂指数 $\alpha_\star$ | Park+2018（Sec 2.1） | Power-law index of fraction of galactic gas in stars as a function of halo mass. See Sec 2.1 of Park+2018. | `src/py21cmfast/wrapper/inputs.py:1180-1180` | 无正文（本地只有代码注释与 docstring） |
| $M_{\rm turn}$：$\exp(-M_{\rm turn}/M_h)$ 的转折质量 | Park+2018（Sec 2.1） | Turnover mass (in log10 solar mass units) for quenching of star formation in halos, due to SNe or photo-heating feedback, or inefficient gas accretion. See Sec 2.1 of Park+2018. | `src/py21cmfast/wrapper/inputs.py:1210-1210` | 无正文（本地只有代码注释与 docstring） |
| $t_\star$：恒星形成时标（哈勃时间的分数） | Park+2018（Sec 2.1、Eq. 3） | Fractional characteristic time-scale (fraction of hubble time) defining the star-formation rate of galaxies. See Sec 2.1, Eq. 3 of Park+2018. | `src/py21cmfast/wrapper/inputs.py:1242-1242` | 无正文（本地只有代码注释与 docstring） |
| 高质量端附加幂律：拐点质量与指数 | 代码注释未给出处（只标了开关名） | The pivot mass associated with the optional upper mass power-law of the stellar-halo mass relation (see AstroOptions.USE_UPPER_STELLAR_TURNOVER) | `src/py21cmfast/wrapper/inputs.py:1249-1249` | 无正文（本地只有代码注释与 docstring） |
| $f_{\star,7}$（MCG 支）的幂律归一 | Qin+2020（Eq. 8） | determine `HII_EFF_FACTOR_MINI` (which is then unused). See Eq. 8 of Qin+2020. | `src/py21cmfast/wrapper/inputs.py:1176-1176` | 无正文（本地只有代码注释与 docstring） |
| $f_{\star,7}$ 的幂指数 $\alpha_{\star,7}$ | Muñoz+21（Sec 2） | for MCGs. See Sec 2 of Muñoz+21 (2110.13919). If the MCG scaling relations are | `src/py21cmfast/wrapper/inputs.py:1184-1184` | 有正文（`docs/论文/The impact of the first galaxies on cosmic dawn and reionization.pdf`） |

本地缺正文的条目：$f_\star(M_h)=f_{\star,10}\,(M_h/10^{10}M_\odot)^{\alpha_\star}\,\exp(-M_{\rm turn}/M_h)$；$f_\star$ 的低质量端幂指数 $\alpha_\star$；$M_{\rm turn}$：$\exp(-M_{\rm turn}/M_h)$ 的转折质量；$t_\star$：恒星形成时标（哈勃时间的分数）；高质量端附加幂律：拐点质量与指数；$f_{\star,7}$（MCG 支）的幂律归一。

**L_X · X 射线光度（每单位恒星形成率）**

- 论文节号：§3.4 加热与电离（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

| 公式或拟合律 | 原论文与作者 | 出处原文 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| $L_X/{\rm SFR}$ 的一阶幂律（含金属性交叉项） | Kaur+22 | first order power law Lx with cross-term (e.g Kaur+22) | `src/py21cmfast/src/scaling_relations.c:270-270` | 无正文（本地只有代码注释与 docstring） |
| 晕金属性拟合式的 6 个系数 | 代码注释未给出处（硬编码，未参数化） | Hardcoded for now: 6 extra fit parameters in the equation | `src/py21cmfast/src/scaling_relations.c:398-398` | 无正文（本地只有代码注释与 docstring） |
| 低红移 $L_X/{\rm SFR}$ 拟合式（对双幂律 + 指数截断光度函数积分） | Lehmer+2021 | The mean Lx_over_SFR given by Lehmer+2021, by integrating analyitically over their double power-law + exponential Luminosity function / LF parameters from Lehmer+2021 | `src/py21cmfast/src/scaling_relations.c:232-239` | 无正文（本地只有代码注释与 docstring） |

本地缺正文的条目：$L_X/{\rm SFR}$ 的一阶幂律（含金属性交叉项）；晕金属性拟合式的 6 个系数；低红移 $L_X/{\rm SFR}$ 拟合式（对双幂律 + 指数截断光度函数积分）。
