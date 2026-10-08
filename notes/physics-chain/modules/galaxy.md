# 晕到星系属性

这块是"晕 → 星系"的换算层：把晕质量与红移折成星系属性——恒星质量、恒星形成率、逃逸分数、金属性与 X 射线亮度；再把逐晕的属性按质量函数积成体积平均量，最后给出紫外光度函数供观测比对。上一块给的是晕的数目与质量，下一块要把这些质量变成光、电离光子与 X 射线，转换就发生在这里。

这一层的全部信息来自参数化的拟合关系，核心是恒星形成效率，其余属性都从它派生。原子与分子两条冷却支各有一套效率与 $M_{\rm turn}$，后者又被莱曼-维尔纳反馈与重子-暗物质相对速度放大——这是本块唯一带环境依赖的地方：同一质量、同一红移的晕，所处环境的背景强度不同，能量化成恒星的份额也不同。

五个成员的分工也在这里定下。标度关系与恒星形成效率是同一件事的两个侧面：前者是逐晕的整套代数链，后者是其中被单独拎出来的那一条曲线；X 射线比光度是这条链末尾的一个系数。恒星形成率密度把逐晕的量按质量函数压成体积平均，紫外光度函数则把同一套换算换到星等轴上——它是解开简并的那把钥匙，把效率与逃逸分数的乘积拆成两个因子。局限也在这里：整套关系是拟合出来的平均链，散射、时标与环境依赖都被折成常数或幂指数，真实的星系形成过程比这更碎。

这篇文档先讲它在链上做什么与依据的物理，再按"逐晕的代数链、一层质量函数积分、一次换元到星等轴"的次序落到代码上，然后是参数与陷阱；文末五节逐个交代五个成员的定位与落点，代码地图与论文出处收在末尾。公式、系数与行号均取自本仓当前源码。

## 一、这块在链上做什么

**一句话**：把晕质量与红移折成星系属性——恒星质量、恒星形成率、逃逸分数、金属性与 X 射线亮度——再按质量函数积成体积平均量、换元到星等轴给出光度函数。

| | 内容 |
| :--- | :--- |
| 输入 | 晕质量与红移、质量函数、一组标度关系参数；分子支另要莱曼-维尔纳背景强度与重子-暗物质相对速度 |
| 输出 | 每个晕的 $M_\star$、$\dot M_\star$、$f_{\rm esc}$、$Z$、$L_X$；体积平均的 $\dot\rho_\star(z)$ 与 $\dot N_{\rm ion}(z)$；$\phi(M_{1500},z)$ |
| 下游 | 网格化源项、X 射线历史卷积、电离场；紫外光度函数直接对观测 |
| 参数 | 31 个（§四） |

**物理图像**：星系属性不是从第一性原理算出来的，而是用一组拟合关系从晕质量上"读"出来的。恒星质量是重子质量乘上一个效率，恒星形成率是恒星质量除以一个由哈勃时间给出的时标，逃逸分数是同一个自变量上的另一条曲线，X 射线亮度是恒星形成率乘一个比光度。这条链的任何一段一改，下游的光、电离光子与热量一起变，所以链上所有源项最终都归到这一块。

**为什么是独立一块**：上一块的产物是晕的数目与质量，一个统计量；下一块要把这些质量变成光、电离光子与 X 射线，源项。统计量到源强之间需要一条"每个晕产出多少"的换算，这条换算只发生在这一块。它同时是链上唯一能做观测比对的地方——紫外光度函数把效率与逃逸分数的乘积拆开，别的块给的都是电离之后的结果，简并早已成形。

## 二、物理骨架

### 2.1 恒星标度关系：从晕质量到整套星系属性

这是把晕属性折成星系属性的那条换算链：从晕质量出发，依次给出恒星质量、恒星形成率、逃逸分数、金属性与 X 射线亮度。它是一条确定性的代数链，给定晕质量与红移就给出全套星系属性；参数逐红移演化一次，快照内部不再变，于是同一条关系在每个红移上就是一套固定常数。

核心两步是恒星质量与恒星形成率：恒星质量取重子比例乘恒星形成效率，恒星形成率取恒星质量除以恒星形成时标；时标以哈勃时间的一个分数给出，所以恒星形成率与哈勃膨胀同步演化。效率本身按双幂律随质量上升、在低质量端被指数截断，并允许对数正态的散射，这一段散布是晕与晕之间唯一的随机来源，金属性与 X 射线都跟着它走。前提是这些关系对整个晕成立，且原子与分子两支共用同一套效率口径。

驱动它的是晕质量、红移与参数面上的一组归一和指数；红移通过哈勃时间、冷却阈值与反馈项进入，不通过谱形。分子冷却支的 $M_{\rm turn}$ 由无反馈的基准质量乘上两个因子得到——一个随莱曼-维尔纳背景强度按幂律放大，一个随重子-暗物质相对速度按幂律放大；原子支的 $M_{\rm turn}$ 只由反馈与气体吸积不足给出。两支各自截断在原子冷却阈值附近，不互相穿透。

数学上它对质量是分段幂律，对反馈强度与相对速度也是幂律——指数的取值决定反馈有多强，因而这条链上几个指数彼此简并：放大反馈强度与压低电离效率可以让源项落在同一水平。它逐晕局域、无记忆，却也不含积分：星系属性只由当前的晕质量与红移决定，晕的并合历史与做过的恒星形成次数都不进入。局限在于这套关系是拟合出来的平均链：金属性只由恒星质量、恒星形成率与红移三个量现算，且只为 X 射线关系服务，不反过来影响恒星形成；有限分辨与散粒效应也只在下游的网格校准里补。

$$M_\star=\frac{\Omega_b}{\Omega_m}\,f_\star M,\qquad \dot M_\star=\frac{M_\star}{t_\star\,t_H(z)}$$

### 2.2 恒星形成率密度：一层质量函数积分

恒星形成率密度是单位体积内所有晕的恒星形成率之和：把逐晕的恒星形成率按质量函数加权，从能形成恒星的最小质量积到上限。它是体积平均量，量纲是单位体积单位时间的质量，直接刻画源在整个盒子里有多亮。

公式就是一层积分：被积函数是质量函数乘逐晕的恒星形成率，下限是能形成恒星的最小质量，上限取到积分表的顶端。前提是质量函数与恒星形成率两项都已知、且可以分别处理——积分只把两者的乘积做加权，晕的成团与并合对平均量的贡献被略去。它对恒星形成效率是精确线性的：效率整体缩放多少，积分结果就缩放多少，所以源项的强度对这一个因子是处处相同的乘数。

进它的是质量函数与逐晕恒星形成率，二者又分别来自质量方差与标度关系；红移同时从三处进入——质量函数的塌缩阈值、标度关系的时标与冷却阈值。最小质量一挪，积分的下限就跟着动，而质量函数在阈值附近是陡降的，所以下限的微小变化会被放大成积分的成倍改变。数学上它是线性积分、无记忆，却落在整条质量轴上：一个红移给一个数，不携带空间信息，真正需要空间分辨的部分留给源项网格去做。它与电离光子率共用同一个积分核，只把逃逸分数置一、每重子光子数置零，这使两者只差一个常数因子，也意味着恒星形成效率与逃逸分数在平均量里仍是简并的。

它是源项的骨架：电离光子发射率、X 射线与莱曼-$\alpha$ 背景都正比于它，所以它一改，加热与电离的强度一起变。局限在这层积分只取体积平均——质量函数与恒星形成率之间的关联、以及再电离反馈对源的自洽压制都不在这里，只能靠下游把反馈折成阈值的移动再叠上去。

$$\dot\rho_\star(z)=\int_{M_{\min}(z)}^{\infty}\frac{\mathrm dn}{\mathrm dM}\,\dot M_\star(M,z)\,\mathrm dM$$

### 2.3 UV 光度函数：一次换元到星等轴

紫外光度函数是观测侧的星系光度分布：单位体积、单位星等区间里有多少星系。实现不拟合解析的 Schechter 形式，而是把晕质量函数整体换元到绝对星等轴——先按恒星形成效率算出恒星形成率，乘一个紫外转换系数折成星等，再在星等轴上取质量函数除以换算因子，并乘上截断质量的抑制因子与一个占空比。

它的关键作用不是进物理链，而是解简并：观测到的光度分布把恒星形成效率与逃逸分数的乘积拆开，因此能把综合电离效率因子里的那条简并打破。前提是恒星形成率到紫外光度是一条定值换算、且质量到星等的映射单调——当效率的低质量端斜率过陡时换元不再成立，那是这条方法的适用边界。

它对参数是分段响应：换元把质量轴的非线性斜率搬到星等轴上，星等越亮对应的质量越大，两端各由效率与截断质量主导。局限在它只到平均关系为止——紫外尘埃衰减、金属性与爆发式恒星形成都不在换算里，与观测对比时要靠额外的选择效应修正补齐。

$$\phi(M_{1500},z)=\left|\frac{{\rm d}M_{1500}}{{\rm d}M_h}\right|^{-1}\,\frac{{\rm d}n}{{\rm d}M_h}\,\exp\!\left(-\frac{M_{\rm turn}}{M_h}\right)f_{\rm duty}$$

### 2.4 恒星形成效率：三段拼成的一条曲线

恒星形成效率回答"一个晕里的重子有多少能变成恒星"：它是无量纲的比例，低质量端随晕质量上升，在几十亿到一百亿太阳质量的量级上落在千分之几到百分之几，再往大质量端被反馈压回来。这条曲线是晕与星系之间唯一的换算，链上所有源项都从它出发；它没有独立的代码入口，只作为 §2.1 那条链的第一个乘数、以及 §2.2 被积函数里的一个因子出现。

公式由三段拼成：低质量端一条斜率为正的幂律，高质量端在拐点质量处换成一条更陡的负幂律，两段在拐点处按归一接通，使该处的取值不随两段如何衔接而变；低质量端再乘一个随质量倒数衰减的指数，压住留不住气体的小晕；最后按对数正态在给定散射宽度内逐晕抽一次，并硬截断在一以内。前提是恒星质量与晕质量之间存在平均关系、且星系的恒星形成在时标上稳恒，爆发式的短时标事件不在其中。

进它的是晕质量与红移；归一、两段指数、拐点质量与截断质量都从参数面读入，红移只通过截断质量随反馈变化。散射那一档在逐晕记录上逐条抽样，集平均那一路不带抽样，只把均值按半方差修正回来——这是链上晕与晕之间唯一的随机来源，金属性与 X 射线都跟着它走。硬截断在一以内则保证不出现恒星质量超过重子质量的非物理取值。

数学上它对参数是幂律响应：归一是指数上的乘数，两个指数分别定两端的斜率，拐点只改曲线的弯折位置。它与逃逸分数、每个重子的电离光子数在源项里只以乘积出现，三者两两简并，单独一个都约束不到，得靠紫外光度分布与 21 厘米两种观测联立把乘积拆开。它把晕质量换成恒星质量与恒星形成率，供恒星形成率密度、电离光子率与 X 射线三处共用；分子冷却支另有一条同形的单幂律，只多一项高质量端的压制。局限在它是条件分布的平均关系：真实的恒星形成散布更大、时标更短、还受体相与并合的瞬时影响，这些不在这条代数式里，只能靠散射那一项与下游的有效时标近似吸收。

$$f_\star=f_{\star,10}\,\frac{\left(\frac{M_{\rm up}}{10^{10}M_\odot}\right)^{\alpha_\star}+\left(\frac{M_{\rm up}}{10^{10}M_\odot}\right)^{\alpha_{\rm up}}}{\left(\frac{M}{M_{\rm up}}\right)^{-\alpha_\star}+\left(\frac{M}{M_{\rm up}}\right)^{-\alpha_{\rm up}}}\exp\!\left(-\frac{M_{\rm turn}}{M}+s\,\sigma_\star-\frac{\sigma_\star^2}{2}\right)\le 1$$

### 2.5 X 射线比光度：链末尾的一个系数

单位恒星形成率的 X 射线光度描述恒星形成活动以 X 射线形式输出多少能量：X 射线来自恒星形成区的双星与超新星遗迹，强度按金属性定，再乘该处的恒星形成率就得到 X 射线亮度。它是加热里最主要的外源，比光度在每太阳质量每年十的四十次方尔格每秒的量级。

公式是一个乘积：金属性依赖的比光度乘恒星形成率；实现默认把比光度取成常数，只有打开特定口径才走随金属性先升后降的双幂律，那条曲线在约百分之五太阳金属性处拐弯。前提是 X 射线只跟恒星形成活动的累积有关、不跟瞬时状态有关，因此它随恒星形成率的历史卷积进入加热，而非直接跟着某一刻的恒星形成率。

它是输入参数，也是 X 射线加热的强度来源；下游的加热率正比于恒星形成率的历史卷积与这个系数的乘积，所以这个归一整体平移到加热的幅度，并与电离效率在观测量里彼此简并。局限在金属性依赖默认被略去、金属性本身也只由恒星质量与红移现算，这条比光度在全参数空间里因此只是一个常数。

$$L_X=\left(\frac{L_X}{\rm SFR}\right)(Z)\,\dot M_\star$$

## 三、代码：一套常数、一次逐晕换算、一层积分

### 3.1 `set_scaling_constants`：按红移装配一套常数

落点 `scaling_relations.c:36-103`。开头先把参数面的数一次搬进 C（`:44-63`）：`fstar_10`、`alpha_star`、`sigma_star`、`alpha_upper`、`pivot_upper`、`fstar_7`、`alpha_star_mini`、`t_star`、`alpha_esc`、`fesc_10`、`fesc_7`、`pop2_ion`、`pop3_ion`、`sigma_xray` 等。其中两处换了单位或换了形状：X 射线比光度乘 `1e-38` 存成以 $10^{38}\,{\rm erg\,s^{-1}}$ 为单位的浮点数（`:60-61`，注释直说这是为了塞进 float）；拐点质量与两个指数被折成一个比值 `upper_pivot_ratio`（`:48-51`），之后双幂律只用这个比值，省掉一次幂运算。

哈勃时间在这里由 `t_hubble(redshift)` 现算一次（`:56`），$\dot M_\star$ 的时标分母就此定死，本快照内不再变。`PHOTON_CONS_TYPE` 取 2 或 3 时，`alpha_esc` 或 `fesc_10` 会被 `get_fesc_fit(redshift)` 覆盖（`:69-74`）——这是这条链上唯一会改逃逸分数曲线的外部修正。

然后是质量下限：`acg_thresh` 由 `atomic_cooling_threshold` 现算，`mturn_a_nofb` 先取 `M_TURN`，开迷你晕时再与原子冷却阈值取大者（`:79-82`）。分子支的无反馈阈值由 `lyman_werner_threshold(redshift, 0., vcb_norel)` 给（`:85-88`）；`FIX_VCB_AVG` 打开时相对速度取 `FIXED_VAVG`、关闭时取零，也就是说这个函数只给"不含相对速度涨落"的基准值，真正的空间依赖由逐格点传进来的 $v_{\rm cb}$ 补上。

```c
    consts->t_h = t_hubble(redshift);
    consts->t_star = astro_params_global->t_STAR;
    consts->sigma_sfr_lim = astro_params_global->SIGMA_SFR_LIM;
    consts->sigma_sfr_idx = astro_params_global->SIGMA_SFR_INDEX;
    // setting units to 1e38 erg s -1 so we can store in float
    consts->l_x = astro_params_global->L_X * 1e-38;
    consts->l_x_mini = astro_params_global->L_X_MINI * 1e-38;
    consts->sigma_xray = astro_params_global->SIGMA_LX;

    consts->alpha_esc = astro_params_global->ALPHA_ESC;
    consts->fesc_10 = astro_params_global->F_ESC10;
    consts->fesc_7 = astro_params_global->F_ESC7_MINI;

    if (use_photoncons) {
        if (astro_options_global->PHOTON_CONS_TYPE == 2)
            consts->alpha_esc = get_fesc_fit(redshift);
        else if (astro_options_global->PHOTON_CONS_TYPE == 3)
            consts->fesc_10 = get_fesc_fit(redshift);
    }

    consts->pop2_ion = astro_params_global->POP2_ION;
    consts->pop3_ion = astro_params_global->POP3_ION;

    consts->acg_thresh = atomic_cooling_threshold(redshift);
    consts->mturn_a_nofb = astro_params_global->M_TURN;
    if (astro_options_global->USE_MINI_HALOS)
        consts->mturn_a_nofb = fmax(consts->acg_thresh, consts->mturn_a_nofb);
```

（`:56-82`。）收尾是二分反解出四个质量限（`:90-102`）：使 $f_\star$ 或 $f_{\rm esc}$ 达到 1 的质量。这四个数不是物理边界，是积分口径用的工具量——有了它们，积分上限才能按"效率还没饱和到 1"的位置来定。`fix_mean` 与 `scaling_median` 也在开头定下（`:39-42`）：前者在固定网格档位（`HMF` 为 2 或 3）下打开，因为那一档缺了格子质量以上的晕；后者决定这套常数给中值还是给条件分布的均值。

```c
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
    }
```

### 3.2 `get_halo_stellarmass` 与 `get_halo_sfr`：逐晕的换算核

落点 `scaling_relations.c:311-361` 与 `:363-395`，两者都由 §3.4 的 `set_halo_properties` 调用。

`get_halo_stellarmass` 按开关决定用单幂律还是带高质量端附加幂律的双幂律，再乘低质量端的指数截断与逐晕抽样项 `star_rng * sigma_star`，硬截断在 1 以内；均值修正项 `stoc_adjustment_term` 取 `sigma_star^2/2`，中值口径下归零。分子支同形另抽一份，并多一项 `-halo_mass/acg_thresh` 的高质量端压制。**注意两次抽样用的是同一个随机数**：原子支与分子支在同一行里共享 `star_rng`。

`get_halo_sfr` 里藏着本块最容易被漏掉的两条参数：散射宽度不是一个常数，而是按恒星质量（原子支与分子支之和）线性算出——`SIGMA_SFR_INDEX` 给斜率、`SIGMA_SFR_LIM` 给下限，且结果被夹到不低于 `SIGMA_SFR_LIM`；`SIGMA_SFR_LIM` 为零时散射整体关闭、抽样退化为取均值。

```c
    double sigma_sfr = 0.;

    if (sigma_sfr_lim > 0.) {
        sigma_sfr =
            sigma_sfr_idx * log10((stellar_mass + stellar_mass_mini) / 1e10) + sigma_sfr_lim;
        if (sigma_sfr < sigma_sfr_lim) sigma_sfr = sigma_sfr_lim;
    }
    sfr_mean = stellar_mass / (consts->t_star * consts->t_h);

    // adjustment to the mean for lognormal scatter
    double stoc_adjustment_term = consts->scaling_median ? 0 : sigma_sfr * sigma_sfr / 2.;
    sfr_sample = sfr_mean * exp(sfr_rng * sigma_sfr - stoc_adjustment_term);
    *sfr = sfr_sample;
```

（`:373-385`。）分子支的恒星形成率同形另算一份，用同一个 $\sigma_{\rm SFR}$ 与同一个随机数。

### 3.3 `get_halo_metallicity` 与 `get_halo_xray`：X 射线那一侧的末段

落点 `scaling_relations.c:397-417` 与 `:419-438`。金属性那段带 6 个硬编码系数，注释写明尚未参数化；分母带 `sfr * s_per_yr` 的幂，注释专门解释了为什么必须避开分母为零——`sfr` 为零时金属性只服务 X 射线、跳过即可，而"有恒星质量却零恒星形成率"在拟合关系里本不该出现，只是浮点下溢的产物。跳过时金属性取默认的 $1.23$ 乘红移因子。

比光度的分岔在 `get_lx_on_sfr`（`:300-309`）：默认直接返回常数 `lx_constant`，只有开 `USE_UPPER_STELLAR_TURNOVER` 才走 `lx_on_sfr_doublePL`。另外三个模型（`lx_on_sfr_Lehmer` `:236-259`、`lx_on_sfr_PL_Kaur` `:272-287`、`lx_on_sfr_Schechter` `:288-298`）都在函数头被注释掉——它们是同一件事的其它口径，在当前代码里不可达。`get_halo_xray` 最后乘上散射因子 `exp(xray_rng * sigma_xray - sigma_xray^2/2)`，并把恒星形成率从太阳质量每年换成每秒（乘 `physconst.s_per_yr`）。

```c
double get_lx_on_sfr(double sfr, double metallicity, double lx_constant) {
    // Future TODO: experiment more with these models and parameterise properly
    //  return lx_on_sfr_Lehmer(metallicity);
    //  return lx_on_sfr_Schechter(metallicity, lx_constant);
    //  return lx_on_sfr_PL_Kaur(sfr,metallicity, lx_constant);
    // HACK: new/old model switch with upperstellar flag
    if (astro_options_global->USE_UPPER_STELLAR_TURNOVER)
        return lx_on_sfr_doublePL(metallicity, lx_constant);
    return lx_constant;
}
```

（`:300-309`。）

### 3.4 逐晕总装：`convert_halo_props` 与 `set_halo_properties`

块锚是 `ComputePerturbedHaloCatalog`（`PerturbedHaloCatalog.c:25-150`）：它把晕按速度场挪位之后，把属性换算整段交给 `convert_halo_props`（`HaloBox.c:792-891`）。后者先调 `set_scaling_constants`（传 `use_photoncons=true`），再用 `get_log10_turnovers`（`:464-516`）把本红移的两个阈值铺成场；然后逐晕从 `star_rng`、`sfr_rng`、`xray_rng` 三条随机数序列取值，开迷你晕时用 CIC 从阈值场读出该晕自己的 $M_{\rm turn}$（`:843-844`）——**阈值因此是逐晕逐格点的量，不是全盒一个常数**——最后交给 `set_halo_properties`（`:62-101`）算完并写进目录（`:856-871`）。

`set_halo_properties` 里三件事值得单独点出。一是逃逸分数在这条路上是解析式、不带随机数：$f_{\rm esc}=\min(f_{\rm esc,10}(M_h/10^{10})^{\alpha_{\rm esc}},1)$，分子支以 $10^7$ 为归一、指数与原子支共用同一个 `alpha_esc`（注释写明"还没有逃逸分数的随机数"）。二是电离光子数与逃逸加权恒星形成率都由两支相加：$N_{\rm ion}=M_{\star}\nu_2 f_{\rm esc}+M_{\star,\rm mini}\nu_3 f_{\rm esc,mini}$，加权那一路把恒星质量换成恒星形成率。三是金属性与 X 射线只在 `USE_TS_FLUCT` 打开时才算，关闭时输出里的 `xray_emissivity` 与 `metallicity` 保持零值。

```c
    double metallicity = 0;
    double xray_lum = 0;
    if (astro_options_global->USE_TS_FLUCT) {
        get_halo_metallicity(sfr + sfr_mini, stellar_mass + stellar_mass_mini, consts->redshift,
                             &metallicity);
        get_halo_xray(sfr, sfr_mini, metallicity, input_rng[2], consts, &xray_lum);
    }

    // no rng for escape fraction yet
    fesc = fmin(consts->fesc_10 * pow(halo_mass / 1e10, consts->alpha_esc), 1);
    if (astro_options_global->USE_MINI_HALOS)
        fesc_mini = fmin(consts->fesc_7 * pow(halo_mass / 1e7, consts->alpha_esc), 1);

    n_ion_sample =
        stellar_mass * consts->pop2_ion * fesc + stellar_mass_mini * consts->pop3_ion * fesc_mini;
    wsfr_sample = sfr * consts->pop2_ion * fesc + sfr_mini * consts->pop3_ion * fesc_mini;
```

（`:75-90`。）写回目录那一侧还有一条门槛：`fesc_sfr` 只在 `INHOMO_RECO` 打开时才被写出去（`:867-868`），`xray_emissivity` 只在 `USE_TS_FLUCT` 打开时才写（`:870-871`）。

### 3.5 固定网格、集平均与查表：同一套换算的三条出口

同一套常数有三个出口，用途不同。

**逐晕**：§3.4 那条，产物是 `PerturbedHaloCatalog` 的逐晕记录。

**固定网格**：`set_fixed_grids`（`HaloBox.c:296-435`）在质量函数分档的档位下，逐格点用格点自己的质量与阈值算属性，不再需要逐晕目录。

**集平均**：`get_uhmf_averages`（`HaloBox.c:105-162`）那条路。它先把六个前因子一次算好（恒星形成率的、电离光子的、逃逸加权的，各带 mini 支一份），再算塌缩分数、逃逸加权的电离光子、只留恒星的那一份；只有开自旋温度涨落时才多算一条 X 射线。这里就是正文那句"它与电离光子率共用同一个积分核"的代码样子：同一个 `Nion_General` 调两次，一次带逃逸权重、一次不带；不带的那一次用的是 `evolve_scaling_constants_sfr`（`scaling_relations.c:106-115`）造出来的常数副本，副本里逃逸分数被置 1、每重子光子数被置 0。

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
```

（`HaloBox.c:118-143`。）集平均这一侧还要补一次散射的均值修正：`mimic_scatter_in_consts`（`scaling_relations.c:155-184`）把两个效率归一与两个 X 射线比光度各乘 $e^{+\sigma^2/2}$——中值到均值的抬升——同时把 `t_star` 除以 $e^{+\sigma_{\rm SFR}^2/2}$（等价于把恒星形成率的均值压回），并按改过的归一重算质量限。注释点明这只是散射对恒星形成率影响的**下界**，因为真实的散射宽度随恒星质量变化，要完整应用得换一个积分核。

查表口径在 `interp_tables.c:931-952`：`EvaluateSFRD` 沿红移网格逐点把上面这套积分填进表里（`initialise_SFRD_spline` `:106-169`），源模型档位大于 0 时走电离积分核，否则退回塌缩分数——注释写明两处同源。

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

（`:941-951`。）还有一处值得留意：`HaloBox.c:104` 那几个盒平均诊断量上标着未校准（原文直说这些平均值是错的）。它们是调试输出，读数时不要当成可信的平均。

### 3.6 换元到星等轴：`ComputeLF`

落点 `LuminosityFunction.c:73-274`。`initialise_ComputeLF`（`:42-61`）先把质量到星等的换算建一条样条，主循环再对它求导：对每个质量格取相邻两点做中心差分得到雅可比 ${\rm d}M_{1500}/{\rm d}M_h$，再乘截断质量的抑制因子与占空比，取对数得到该红移、该格点的 `log10 phi`，低于 $-30$ 的截断。占空比在原子支直接记 1，分子支按 $e^{-M/M_{\rm crit,atom}}$ 衰减。同一个函数里还有第二条出口（`:253-265`），表达式与主循环同形，可以互相对照。

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

（`:253-265`。）适用边界写在注释里（`:161-171`）：这段平滑换元在 `ALPHA_STAR < -0.5` 时失效，注释同时说明那个参数区间本身不物理。

### 3.7 分子支的阈值与两个工具量

分子支的阈值在 `thermochem.c:282-299`：从无反馈的基准 $3.314\times10^7(1+z)^{-1.5}$ 出发，乘上 LW 反馈因子与相对速度因子。这个函数里还留着 Schauer+20 联合拟合的另一版实现，被注释掉摆在旁边——两版给的是同类拟合的不同写法，比对口径版本时看的就是这几行。

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

（`:289-299`。）两个冷却阈值是同一个反解工具的两行调用（`thermochem.c:278` 与 `:280`）：把维里温度 $10^4\,{\rm K}$（原子，气体份额 0.59）与 $600\,{\rm K}$（分子，份额 1.22）交给 `TtoM` 得到质量。二分反解本身在 `Mass_limit_bisection`（`hmf.c:1216-1256`），用来找"效率或逃逸分数达到 1"的质量；积分下限的入口则是 `minimum_source_mass`（`hmf.c:1261-1289`）。

```c
double atomic_cooling_threshold(float z) { return TtoM(z, 1e4, 0.59); }

double molecular_cooling_threshold(float z) { return TtoM(z, 600, 1.22); }
```

（`thermochem.c:278-280`。）

## 四、参数

本模块 31 个参数，按"它在这块里改什么"分成八组（与画布上这块的「参数」卡同一份清单；类别是 `inputs.py` 里的结构名）。

### 4.1 恒星效率的归一与形状：`F_STAR10`、`ALPHA_STAR`、`F_STAR7_MINI`、`ALPHA_STAR_MINI`

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `F_STAR10` | `AstroParams` | 恒星质量的归一（默认 -1.3，log10），即 $10^{10}M_\odot$ 处的取值，进 §2.1 里 $M_\star=\frac{\Omega_b}{\Omega_m}f_\star M$ 的 $f_\star$（`scaling_relations.c:44`）。它是这套常数最主要的乘数：整套产出（恒星形成率、逃逸分数、X 射线亮度）都对它是线性的。它与逃逸分数、每重子光子数在观测量上简并，三者只能靠紫外光度分布与 21 厘米观测联立拆开。 |
| `ALPHA_STAR` | `AstroParams` | 恒星形成效率低质量端的斜率（默认 0.5），式子里那个 $\alpha_\star$（`:45`）。它定这条曲线在拐点以下的上升速度，于是恒星形成率、X 射线亮度、逃逸分数那几段全部跟着它走——它是这套常数里最能改形状的一个数。 |
| `F_STAR7_MINI` | `AstroParams` | 分子冷却支的恒星质量归一，管低质量那一支的水平（`:53`）。它没有写死的默认值，缺省时由 `F_STAR10 - 3·ALPHA_STAR` 推出（`inputs.py:1391-1393`），即让两支在 $10^7$ 与 $10^{10}$ 两个归一之间按同一斜率接通。它与 `F_STAR10` 是同一件事在两个质量段上的取值，两支叠加才是全部的源；在"迷你晕是否主导早期电离"这个问题上它是关键旋钮。 |
| `ALPHA_STAR_MINI` | `AstroParams` | 分子冷却支的同一个斜率，缺省时取 `ALPHA_STAR`（`inputs.py:1395-1397`；进 C 的落点 `scaling_relations.c:54`）。打开迷你晕后这套常数要按两支各算一份，而这一支在低质量端权重更大，因此它对本块的影响比原子支的那个斜率更显著。 |

### 4.2 高质量端附加幂律：`UPPER_STELLAR_TURNOVER_MASS`、`UPPER_STELLAR_TURNOVER_INDEX`

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `UPPER_STELLAR_TURNOVER_MASS` | `AstroParams` | 附加幂律的拐点质量（默认 11.447，log10；`scaling_relations.c:49`）。它挪的是曲线弯折的位置：调小它，大质量晕更早进入被压制的区段。 |
| `UPPER_STELLAR_TURNOVER_INDEX` | `AstroParams` | 上面那段附加幂律的指数（默认 -0.6；`:48`）。它把大质量端的效率压回，并与 `ALPHA_STAR` 一起折进 `upper_pivot_ratio`，保证 $f_\star$ 在拐点以上不上翘；它同时是 X 射线比光度切到双幂律的那条开关所依据的口径。 |

两条都只在 `USE_UPPER_STELLAR_TURNOVER` 打开时生效。关掉它，`get_halo_stellarmass` 退回单幂律、`get_lx_on_sfr` 退回常数比光度（§3.3），这是本块里一个开关同时改两条式子的一例。

### 4.3 散射：`SIGMA_STAR`、`SIGMA_SFR_LIM`、`SIGMA_SFR_INDEX`、`SIGMA_LX`

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `SIGMA_STAR` | `AstroParams` | 晕质量-恒星质量关系的对数正态散射（默认 0.25，dex，进 C 时换成 nats；`scaling_relations.c:46`）。逐晕记录那条路上每个晕在指数里抽一个 $s\sigma_\star$，集平均那条路不抽样、只留下 $-\sigma_\star^2/2$ 的均值修正（`mimic_scatter_in_consts` 反过来把归一乘 $e^{+\sigma^2/2}$）。它是晕与晕之间唯一的随机来源，金属性与 X 射线都跟着这份抽样走。 |
| `SIGMA_SFR_LIM` | `AstroParams` | 恒星质量-恒星形成率关系的散射宽度下限（默认 0.19，dex→nats；`:58`）。它进 `get_halo_sfr`：散射宽度按恒星质量从它起算并夹在它以上（§3.2）；取零则散射整体关闭、恒星形成率退化为取均值。它还进 `mimic_scatter_in_consts`，把 `t_star` 除以 $e^{+\sigma_{\rm SFR}^2/2}$——集平均那一侧散射对恒星形成率的压缩最低这么多。 |
| `SIGMA_SFR_INDEX` | `AstroParams` | 散射宽度随恒星质量变化的斜率（默认 -0.12；`:59`）。它只出现在 `get_halo_sfr` 那一行里（`scaling_relations.c:377`）：负值意味着恒星质量越大散射越窄，与下限一起把"低质量晕散布更大"这个倾向写进关系里。 |
| `SIGMA_LX` | `AstroParams` | X 射线光度关系的对数正态散射（默认 0.5，dex→nats，全晕全红移统一；`:63`）。逐晕采样时它给每个晕一个 X 射线亮度上的随机偏移，是加热侧唯一的随机来源；集平均那条路按半方差修正均值（`mimic_scatter_in_consts` 把比光度乘 $e^{+\sigma^2/2}$）。 |

### 4.4 截断质量与两支的阈值：`M_TURN`、`A_LW`、`BETA_LW`、`A_VCB`、`BETA_VCB`、`FIXED_VAVG`

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `M_TURN` | `AstroParams` | 恒星形成的截断质量（默认 8.7，log10→线性；`scaling_relations.c:80`），落在指数项 $e^{-M_{\rm turn}/M}$ 里，同时给出本红移的质量下限 `mturn_a_nofb`。它随反馈逐红移变化，是这套常数里唯一带红移演化的形状量。 |
| `A_LW` | `AstroParams` | 莱曼-维尔纳反馈的幅度系数（默认 2.0），进分子冷却支的 $M_{\rm turn}$（`thermochem.c:290`）。它不直接出现在恒星质量的式子里，而是经"能形成恒星的最低质量"改这一支的积分下限：反馈一强，能形成恒星的晕变少，源项被压下去。 |
| `BETA_LW` | `AstroParams` | 莱曼-维尔纳反馈的幂指数（默认 0.6；`:290`），定反馈强度随背景强度变化的快慢。指数越大，背景一涨阈值就抬得越猛，源被压得越早。 |
| `A_VCB` | `AstroParams` | 相对速度反馈的幅度系数（默认 1.0），与 `A_LW` 并联进同一个 $M_{\rm turn}$（`:293`）。$v_{\rm cb}$ 以代码里写死的 `SIGMAVCB`（29 km/s，`thermochem.c:17`）归一，两者各自乘一个幂律因子，合起来抬高或压低分子冷却阈值。 |
| `BETA_VCB` | `AstroParams` | 相对速度反馈的幂指数（默认 1.8；`:293`），作用方式与 `BETA_LW` 相同，变量换成 $v_{\rm cb}$。 |
| `FIXED_VAVG` | `AstroParams` | 只在打开 `FIX_VCB_AVG` 时被读（`scaling_relations.c:86`）：用这个固定值（默认 25.86，km/s）代替逐点平均的相对速度，于是这套常数里反馈那一支不再带空间涨落，阈值与积分下限在全盒统一。它属于数值简化档，常用于需要压低计算量的扫描。 |

### 4.5 逃逸分数：`F_ESC10`、`ALPHA_ESC`、`F_ESC7_MINI`

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `F_ESC10` | `AstroParams` | 在 $10^{10}M_\odot$ 处锚定逃逸分数线（默认 -1.0，log10；`scaling_relations.c:66`）。它按二分反解出本红移的 `Mlim_Fesc`（逃逸分数等于基准值的那个质量），再由它把整条曲线钉住；逐晕那一路直接用它算 $f_{\rm esc}$（`HaloBox.c:84`）。它与 `F_STAR10`、`POP2_ION` 的乘积就是综合电离效率。 |
| `ALPHA_ESC` | `AstroParams` | 逃逸分数随质量的幂指数（默认 -0.5；`:65`）。它不改恒星形成，只改"有多少电离光子能出晕"，所以第一次起作用在下游的电离支；两条冷却支共用同一个指数（原子支以 $10^{10}$ 为归一、分子支以 $10^7$）。 |
| `F_ESC7_MINI` | `AstroParams` | 分子冷却支的逃逸分数锚点（默认 -2.0；`:67`）。只在打开迷你晕时用于第二支，与 `F_ESC10` 一起定这份光子产额的高、低质量两段。 |

### 4.6 X 射线与电离光子产额：`L_X`、`L_X_MINI`、`POP2_ION`、`POP3_ION`

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `L_X` | `AstroParams` | 单位恒星形成率的比 X 射线光度（默认 40.5，log10；C 里乘 `1e-38` 以 $10^{38}\,{\rm erg\,s^{-1}}$ 为单位存，`scaling_relations.c:61`）。它在这条链末尾乘上恒星形成率给出 X 射线亮度，是加热强度的直接来源，改它等于整体缩放加热率；它与电离效率在 21 厘米观测量上彼此简并。 |
| `L_X_MINI` | `AstroParams` | 分子冷却支的同一个量，缺省时取 `L_X`（`inputs.py:1399-1401`；进 C 的落点 `:62`）。只在打开迷你晕时被读，给那一支再加一份 X 射线。 |
| `POP2_ION` | `AstroParams` | 每重子的电离光子数（默认 5000；`:76`）。它不属于这套常数的作用面，而在 `set_halo_properties` 里与恒星质量相乘（`HaloBox.c:88`）；放在这一组是因为它与 `F_STAR10`、`F_ESC10` 高度简并。 |
| `POP3_ION` | `AstroParams` | 分子冷却支的同一个量（默认 44021；`:77`），作用面同样在电离支，且只在打开迷你晕时存在。 |

### 4.7 迷你晕、再复合与光子守恒：`USE_MINI_HALOS`、`INHOMO_RECO`、`PHOTON_CONS_TYPE`

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `USE_MINI_HALOS` | `AstroOptions` | 迷你晕总开关。打开时这套常数按两支各算一份，`F_STAR7_MINI`、`F_ESC7_MINI`、`L_X_MINI`、`ALPHA_STAR_MINI` 这一组才被读；同时它把原子支的下限抬到不低于原子冷却阈值（`fmax`，`scaling_relations.c:82`）。关闭时这一组参数在本块全部空转，被积函数只剩一支。 |
| `INHOMO_RECO` | `AstroOptions` | 非均匀再复合的总开关。打开时集平均量里多一项按局部电离度加权的源（`HaloBox.c:179` 累加的 `mean_wsfr`），也就是再电离反馈压制源那条路；逐晕目录里也只有在打开时才写出逃逸加权的恒星形成率（`HaloBox.c:867`）。 |
| `PHOTON_CONS_TYPE` | `AstroOptions` | 光子守恒修正的类型。它作用在下游电离（`wrapper/photoncons.py`），但取 2 或 3 时会在这里把 `alpha_esc` 或 `fesc_10` 覆盖成 `get_fesc_fit(redshift)`（`scaling_relations.c:69-74`）——这是本块唯一会改逃逸分数曲线的外部修正。 |

### 4.8 宇宙学与数值口径：`OMb`、`OMm`、`USE_TS_FLUCT`、`INTEGRATION_METHOD_ATOMIC`、`INTEGRATION_METHOD_MINI`

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `OMb` | `CosmoParams` | 重子密度。它经重子比例 $\Omega_b/\Omega_m$ 进恒星质量（`scaling_relations.c:331`），是整体乘数；它与 `OMm` 在这条链上总是成对出现，单独的取值不能与恒星形成效率归一分开。 |
| `OMm` | `CosmoParams` | 总物质密度。它同时动两处：质量函数的归一与塌缩阈值（进积分的核），以及重子比例（进被积函数）。因此它不是单纯的缩放，调它会把积分的形状也改掉。 |
| `USE_TS_FLUCT` | `AstroOptions` | 自旋温度涨落的总开关。它决定逐晕记录里要不要算金属性与 X 射线（`HaloBox.c:77`）：打开时这两项才被算并写回目录，关闭时对应字段是零。它不改变标度关系本身。 |
| `INTEGRATION_METHOD_ATOMIC` | `AstroOptions` | 原子冷却支积分的求积方法。换方法只带来小的数值差异，物理不变；属于数值选项，扫描时一般不动。 |
| `INTEGRATION_METHOD_MINI` | `AstroOptions` | 分子冷却支的求积方法，与上一项各管一支，可以取不同方法；关掉迷你晕时它不参与。 |

本块没有"列在清单里却不生效"的参数：31 条都在 §三 的算式、分支或开关里真实生效。反过来还有一条不在清单里的量：恒星形成时标 `t_STAR`（默认 0.5，`scaling_relations.c:57`）也进这条链——它是 $\dot M_\star$ 分母上的 `t_star`，改它等于整体缩放恒星形成率——但它没有登记进这份清单。

## 五、陷阱

**一、两套口径只差一个开关，却差半方差。** `HALO_SCALING_RELATIONS_MEDIAN` 打开时关系给中值，关闭时给条件分布的均值。逐晕抽样那一侧靠 `stoc_adjustment_term` 把 $\sigma^2/2$ 减掉，集平均那一侧靠 `mimic_scatter_in_consts` 把归一乘 $e^{+\sigma^2/2}$——**两处的符号相反、方向一致**（都把中值抬成均值）。比较两次运行的结果前先对齐这个开关。

**二、参数面按对数存，C 里是线性值。** `F_STAR10` 存的是 $-1.3$、`M_TURN` 存的是 $8.7$、`UPPER_STELLAR_TURNOVER_MASS` 存的是 $11.447$，进 C 之前一律要换算（§3.1）；`SIGMA_STAR`、`SIGMA_SFR_LIM`、`SIGMA_LX` 按 dex 存，进 C 时换算成 nats。把参数面上的数直接当 C 里的数用，会差好几个数量级。

**三、`SIGMA_SFR_LIM` 与 `SIGMA_SFR_INDEX` 真的生效。** 两个量在 `set_scaling_constants` 里被读（`scaling_relations.c:58-59`），散射宽度在 `get_halo_sfr` 里按恒星质量从它们算出并夹住下限（§3.2），`SIGMA_SFR_LIM` 还进 `mimic_scatter_in_consts` 压 `t_star`。它们不是空转参数。

**四、X 射线与金属性只在自旋温度涨落打开时才算。** `set_halo_properties` 里那一段包在 `USE_TS_FLUCT` 判断内（§3.4），关闭时目录里的 `xray_emissivity` 与 `metallicity` 就是零，`get_halo_xray` 根本没被调用。想研究加热却把这个开关关掉，会拿到全零的 X 射线源。

**五、`fesc_sfr` 只在 `INHOMO_RECO` 打开时才落盘。** 同理，逐晕目录里那个逃逸加权的恒星形成率在关闭时不存在（`HaloBox.c:867`）。按字段名去读一个不存在的量，得到的不是零而是一整块没填过的内存。

**六、四个质量限不是物理边界。** `Mlim_Fstar`、`Mlim_Fesc` 与两个 mini 版本是二分反解出来的工具量，用来定积分的上限，跟"晕能不能形成恒星"没有关系。它们随归一与指数变动，调 `F_STAR10` 会连带改它们（§3.1、§3.5 的重算）。

**七、`M_TURN` 只在它高于原子冷却阈值时才说话。** 开迷你晕时原子支的下限取 $\max(M_{\rm acg},M_{\rm TURN})$（`scaling_relations.c:79-82`），所以在高红移段 `M_TURN` 可能被冷却阈值顶掉、显得"调了没反应"。

**八、阈值是逐晕逐格点的量。** 开迷你晕时 `M_turn` 由 CIC 从阈值场读出（`HaloBox.c:843-844`），不是全盒一个常数；而它里面的相对速度项又由 `FIX_VCB_AVG` 决定有没有涨落。把它当常数看，会漏掉低质量端最要紧的那部分空间依赖。

**九、金属性不是输入参数。** 它由恒星质量、恒星形成率与红移用 6 个硬编码系数现算（`scaling_relations.c:397-417`），既不进参数表，也只服务 X 射线比光度、不反过来影响恒星形成。

**十、换元在陡斜率下失效。** 紫外光度函数是把质量函数换元到星等轴（§3.6），`ALPHA_STAR < -0.5` 时这段平滑不再成立，注释直接标出了这个区间（`LuminosityFunction.c:168`）。

### 一份最小检查清单

- 比对效率相关的结果：先确认两次运行的 `HALO_SCALING_RELATIONS_MEDIAN` 一致（§五 第一条）。
- 想要 X 射线源：确认 `USE_TS_FLUCT` 是打开的，否则目录里那一列是零（§五 第四条）。
- 追源强：`F_STAR10`、`F_ESC10`、`POP2_ION` 三个一起看，它们在观测量上高度简并；拆开要靠紫外光度函数。
- 想调加热：`L_X` 是整体乘数，`SIGMA_LX` 决定它在晕与晕之间的散布（§4.6、§4.3）。
- 用迷你晕：分子支那一组参数（`F_STAR7_MINI`、`ALPHA_STAR_MINI`、`L_X_MINI`）不填也会跑——它们分别跟着 `F_STAR10`、`ALPHA_STAR`、`L_X` 走——只填 `F_ESC7_MINI` 就等于只改了这一支的逃逸分数（§4.1、§4.6）。
- 读逐晕目录：先查 `INHOMO_RECO`，`fesc_sfr` 可能整列不存在（§五 第五条）。

## 六、标度关系(M_h) · 恒星标度关系（晕属性 → 星系属性）

它是本块的主干：从晕质量出发，依次给出恒星质量、恒星形成率、逃逸分数、金属性与 X 射线亮度（§2.1）。给定晕质量与红移就定下这一整套，参数逐红移演化一次、快照内部不再变，所以同一条关系在每个红移上就是一套固定常数。链上所有源项都从这一步出发。

代码上它的落点分三处：装配常数在 `set_scaling_constants`（`scaling_relations.c:36-103`），逐晕的两个换算核在 `get_halo_stellarmass`（`:311-361`）与 `get_halo_sfr`（`:363-395`），X 射线那一侧在 `get_halo_metallicity`（`:397-417`）与 `get_halo_xray`（`:419-438`）；总装由 `set_halo_properties`（`HaloBox.c:62-101`）完成。

**它的位置在整块的上游，局限在是一条拟合出来的平均链。** 确定性、无记忆、不含积分，但真实星系形成比这更碎，金属性只为 X 射线服务、不反过来影响恒星形成。**名下 25 个参数**（§四）：恒星效率的归一与形状（§4.1）、高质量端附加幂律（§4.2）、散射（§4.3）、截断质量与两支的阈值（§4.4）、逃逸分数（§4.5）、X 射线与光子产额（§4.6）、迷你晕与光子守恒开关（§4.7）都在这条链上起作用；`OMb`、`OMm`、`USE_TS_FLUCT`、两个求积方法也经它进下游（§4.8）。论文出处：见文末同名一节。

## 七、ρ̇*(z) · 恒星形成率密度

它是源项的骨架：单位体积内所有晕的恒星形成率之和，量纲是单位体积单位时间的质量（§2.2）。电离光子发射率、X 射线与莱曼-$\alpha$ 背景都正比于它，所以它一改，加热与电离的强度一起变。

代码上它的落点是集平均那条路：`get_uhmf_averages`（`HaloBox.c:105-162`）算前因子与四个积分，`EvaluateSFRD`（`interp_tables.c:931-952`）沿红移填表取值。它与电离光子率共用同一个积分核 `Nion_General`，只把逃逸分数置一、每重子光子数置零（§3.5）。

**它的位置是体积平均，局限在只取平均。** 它不携带空间信息，质量函数与恒星形成率之间的关联、再电离反馈对源的自洽压制都被略去，只能靠下游把反馈折成阈值的移动再叠上去。它还是本块唯一会把宇宙学参数拉进来的出口：`OMb` 经重子比例进被积函数、`OMm` 同时动质量函数与重子比例。**名下 31 个参数**（§四）——它是五个成员里参数面覆盖最广的一个，八个分组都经它落入下游（§4.8 里五个只在集平均这一侧生效）。论文出处：见文末同名一节。

## 八、φ(M_1500, z) · UV 光度函数

它是观测侧的星系光度分布：单位体积、单位星等区间里有多少星系（§2.3）。它的关键作用不在物理链上，而在解简并——观测到的光度分布把恒星形成效率与逃逸分数的乘积拆成两个因子。

代码上的落点是 `ComputeLF`（`LuminosityFunction.c:73-274`）：`initialise_ComputeLF`（`:42-61`）建质量到星等的样条，主循环（`:186-199`）做中心差分换元，第二条出口在 `:253-262`（§3.6）。这里不拟合 Schechter 形式，拿论文的拟合式来比，比的是两条不同的路。

**它的位置在分析侧，局限在只到平均关系为止。** 紫外尘埃衰减、金属性与爆发式恒星形成都不在换算里；换元本身在 `ALPHA_STAR < -0.5` 时失效，那是这条方法的适用边界。**名下 3 个参数**（§四）：`M_TURN` 与 `USE_MINI_HALOS` 定亮端抑制与占空比（§4.4、§4.7），`OMm` 经恒星形成率进星等换算（§4.8）；31 条里其余的散射与形状参数都经恒星形成率间接进入（§4.1）。论文出处：见文末同名一节。

## 九、f* · 恒星形成效率

它回答"一个晕里的重子有多少能变成恒星"，是晕与星系之间唯一的换算，链上所有源项都从它出发（§2.4）。它没有独立的计算入口：在实现里它就是 §2.1 那条链的第一个乘数、以及 §3.2 两个换算核里被读的那几个常数。

代码上的落点因此分散在常数装配与两个换算核里：归一与斜率在 `set_scaling_constants`（`scaling_relations.c:44-54`），逐晕抽样在 `get_halo_stellarmass`（`:334-358`），集平均那一侧的均值修正与质量限重算在 `mimic_scatter_in_consts`（`:155-184`）。

**它的位置是链上最上游的乘数，局限在是条件分布的平均关系。** 真实的恒星形成散布更大、时标更短，还受体相与并合的瞬时影响；这些只能靠散射那一项与下游的有效时标近似吸收。它与逃逸分数、每重子光子数在源项里只以乘积出现，三者两两简并。**名下没有参数**（§四）：它是上游的因、不是被调的对象——改它的是 `F_STAR10` 与 `ALPHA_STAR` 定原子支（§4.1）、`SIGMA_STAR` 定它的散射（§4.3）、`M_TURN` 定低质量端的截断（§4.4）；开迷你晕时再加 `F_STAR7_MINI` 与 `ALPHA_STAR_MINI`（§4.1）。论文出处：见文末同名一节。

## 十、L_X · X 射线光度（每单位恒星形成率）

它描述恒星形成活动以 X 射线形式输出多少能量：比光度乘该处的恒星形成率（§2.5）。它是加热里最主要的外源，下游的加热率正比于恒星形成率的历史卷积与这个系数的乘积。

代码上它的落点在标度关系那一侧：比光度在 `set_scaling_constants` 里被读一次并换成 $10^{38}\,{\rm erg\,s^{-1}}$ 的单位（`scaling_relations.c:61-62`），金属性依赖的分岔在 `get_lx_on_sfr`（`:300-309`），逐晕的乘积在 `get_halo_xray`（`:419-438`）——而且只在 `USE_TS_FLUCT` 打开时才被调用（`HaloBox.c:77`）。四个比光度模型里只有常数与双幂律两条可达，其余三个在函数头被注释掉。

**它的位置在链的末尾、且被一条开关把门，局限在金属性依赖默认被略去。** 默认口径下它就是一个常数，金属性不进强度；打开 `USE_UPPER_STELLAR_TURNOVER` 才切到随金属性先升后降的双幂律，而金属性本身也只是由恒星质量、恒星形成率与红移现算的拟合值。它与电离效率在观测量里彼此简并。**名下没有参数**（§四）：改它的是 `L_X` 与分子支的 `L_X_MINI`，这两条是关系的归一（§4.6）；`SIGMA_LX` 定它在晕与晕之间的散射（§4.3）；要不要切到那条双幂律由 `UPPER_STELLAR_TURNOVER_INDEX` 决定（§4.2）。论文出处：见文末同名一节。

## 十一、代码地图

| 位置 | 是什么 |
| :--- | :--- |
| `PerturbedHaloCatalog.c:25-150` | `ComputePerturbedHaloCatalog`：晕挪位后把属性换算整段交出去（块锚） |
| `HaloBox.c:792-891` | `convert_halo_props`：逐晕总装（读阈值场 → 三条随机数 → 写回目录） |
| `HaloBox.c:62-101` | `set_halo_properties`：逐晕算完 $M_\star$、$\dot M_\star$、$f_{\rm esc}$、$N_{\rm ion}$、$Z$、$L_X$（成员落点） |
| `HaloBox.c:105-162` | `get_uhmf_averages`：集平均的六个前因子与四个积分（成员落点） |
| `HaloBox.c:163-201` | `get_halobox_averages`：盒平均诊断量（紧挨一行注释标明未校准） |
| `HaloBox.c:296-435` | `set_fixed_grids`：固定网格档位的逐格点属性（成员落点） |
| `HaloBox.c:464-516` | `get_log10_turnovers`：把本红移两个阈值铺成场 |
| `HaloBox.c:843-844` | 从阈值场 CIC 读出该晕自己的 $M_{\rm turn}$ |
| `HaloBox.c:856-871` | 逐晕写回目录（`fesc_sfr` 只随 `INHOMO_RECO`、`xray_emissivity` 只随 `USE_TS_FLUCT`） |
| `scaling_relations.c:36-103` | `set_scaling_constants`：逐红移装配常数与四个质量限（成员落点） |
| `scaling_relations.c:106-115` | `evolve_scaling_constants_sfr`：逃逸置一、每重子光子数置零的常数副本 |
| `scaling_relations.c:118-153` | `evolve_scaling_constants_to_redshift`：换红移的常数副本 |
| `scaling_relations.c:155-184` | `mimic_scatter_in_consts`：散射的均值修正与质量限重算 |
| `scaling_relations.c:196-235` | 四个单/双幂律小工具（log 与线性两版，供被积函数用） |
| `scaling_relations.c:236-259` | `lx_on_sfr_Lehmer`（默认不可达） |
| `scaling_relations.c:262-268` | `lx_on_sfr_doublePL`（开 `USE_UPPER_STELLAR_TURNOVER` 时可达） |
| `scaling_relations.c:272-287` | `lx_on_sfr_PL_Kaur`（不可达） |
| `scaling_relations.c:288-298` | `lx_on_sfr_Schechter`（不可达） |
| `scaling_relations.c:300-309` | `get_lx_on_sfr`：常数比光度与双幂律的分岔 |
| `scaling_relations.c:311-361` | `get_halo_stellarmass`：$M_h\to M_\star$（原子支与分子支各一份） |
| `scaling_relations.c:363-395` | `get_halo_sfr`：$M_\star\to\dot M_\star$，散射宽度按恒星质量算出 |
| `scaling_relations.c:397-417` | `get_halo_metallicity`：6 个硬编码系数的拟合式 |
| `scaling_relations.c:419-438` | `get_halo_xray`：比光度 × 恒星形成率 × 散射因子 |
| `LuminosityFunction.c:42-61` | `initialise_ComputeLF`：质量到星等的样条 |
| `LuminosityFunction.c:73-274` | `ComputeLF`：UV 光度函数主循环与第二条出口（成员落点） |
| `interp_tables.c:106-169` | `initialise_SFRD_spline`：逐行填恒星形成率密度表（成员落点） |
| `interp_tables.c:931-952` | `EvaluateSFRD`：沿红移网格取值 |
| `thermochem.c:278` / `:280` | `atomic_cooling_threshold` / `molecular_cooling_threshold`：两个维里温度反解成质量 |
| `thermochem.c:282-299` | `lyman_werner_threshold`：分子支 $M_{\rm turn}$ 的 LW 与 $v_{\rm cb}$ 反馈 |
| `hmf.c:1216-1256` | `Mass_limit_bisection`：四个质量限的二分反解 |
| `hmf.c:1261-1289` | `minimum_source_mass`：积分下限的入口 |
| `_outputstructs_wrapper.h:30-45` | `PerturbedHaloCatalog` 的字段（逐晕记录） |
| `_outputstructs_wrapper.h:47-65` | `HaloBox` 的字段（网格化后的源项） |

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**标度关系(M_h) · 恒星标度关系（晕属性 → 星系属性）**

- 论文节号：真源未登记（这个成员的 `reviewSection` 为空）；它落的式子是 `docs/论文/21cm_physics_derivation.pdf` 的 Eq.1 与 Eq.4。

**ρ̇*(z) · 恒星形成率密度**

- 论文节号：§3.6（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）
- 推导式子：Eq.1（第 3 页，`docs/论文/21cm_physics_derivation.pdf`）

**φ(M_1500, z) · UV 光度函数**

- 论文节号：§3.6（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）
- 推导式子：Eq.12–Eq.14（第 7 页，`docs/论文/21cm_physics_derivation.pdf`）——论文给的是 Schechter 形式，代码走的是把质量函数换元到星等轴，两者不是同一条式子（§3.6）。

**f* · 恒星形成效率**

- 论文节号：§3.6 天体物理源与历史（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）
- 推导式子：Eq.1（`docs/论文/21cm_physics_derivation.pdf`）

**L_X · X 射线光度（每单位恒星形成率）**

- 论文节号：§3.4 加热与电离（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

代码注释里还挂着两处外部拟合的出处，逐条列在这里：

| 公式或拟合律 | 原论文与作者 | 代码里的说法 | 代码位置 | 本地有无 |
| :--- | :--- | :--- | :--- | :--- |
| 分子冷却阈值（LW 与 $v_{\rm cb}$ 的联合拟合） | Schauer+20 | "correction follows Schauer+20" | `thermochem.c:283-285` | 无正文（本地只有代码注释） |
| 分子冷却阈值（代码采用的版本） | Visbal+15，取自 Fialkov+12 的最优拟合 | "this follows Visbal+15, which is taken as the optimal fit from Fialkov+12" | `thermochem.c:287-288` | 有：`docs/论文/Fialkov+12_MNRAS424-1335_relative-velocity-cooling.pdf`；Visbal+15 无正文 |
| 被注释掉的另一版阈值 | Schauer+20 Eq.12、Eq.9 | "Eq. (12) in Schauer+20"、"Eq. (9)" | `thermochem.c:295-297` | 无正文（本地只有代码注释） |

金属性那条拟合（`scaling_relations.c:397-417`）与 X 射线比光度的参数化在代码注释里都没有给出处。
