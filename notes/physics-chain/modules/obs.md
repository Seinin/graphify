# 亮温与观测

这一块是链的出口：把前面算出的中性氢份额、自旋温度与密度折成差分亮温，再把盒子统计成功率谱。另一个成员属于观测侧——汤姆逊光深。整条链上，模型参数最后都要靠这里的亮温与功率谱去约束。

两个观测量的分工也在这里定下：亮温（与它的功率谱）带空间信息，能分辩"电离到哪一步、气体热不热"；汤姆逊光深只有一个数，量的是微波背景光子被自由电子散射的累积概率，只能用全宇宙平均的电离历史去算。两者一起用，才能把再电离的时点和形状拆开。

## δT_b(z) · 21cm 平均亮温

### 物理

21 厘米亮温是差分亮温：它衡量在宇宙微波背景上叠出来的那一点吸收或发射，数值由三个因子相乘——中性氢份额、自旋温度与光子温度的相对差，以及按宇宙学参数与红移算出的前因子。自旋温度低于光子温度时为吸收（亮温为负），高于时为发射，量级在几十毫开尔文。

公式是一个乘积：中性氢份额、$(1-T_\gamma/T_S)$ 与红移的前因子；前因子由重子与暗物质密度、哈勃常数与红移定出，物理上有两种等价写法——按自旋温度写，或按光深与两个温度之差写。前提是光学厚度在分辨率以下被视为局域、且气体温度与自旋温度已由上游自洽求出，取温也用到了瑞利-金斯近似。

进它的是逐格点的中性氢份额、自旋温度、光子温度与密度扰动；前者来自电离场，后者来自气体热。实现默认用第一条闭式式，打开自旋温度涨落之后改走光深式——先把预因子折成光深，再用饱和形式写回亮温；两条路在光深很小时一致，在光深大时后者把饱和处理得更稳。

它有两个零点：自旋温度与光子温度相等时信号被抵消；中性氢份额为零（完全电离）时信号消失——再电离的结束因此在亮温上表现为信号消失而不是变号。亮温对自旋温度的依赖是非线性的：自旋温度越接近光子温度，同样大小的温度变动给出的信号越小，所以信号最深的那一段出现在耦合刚把自旋温度拉下来的时候，而不是自旋温度最低的地方。

它是整条链唯一的观测量：气体热、电离与源的变化最终都要经过它才能和观测对比，涨落盒再做统计就得到功率谱。局限在它按格点局部计算、不做沿视线的辐射转移积分——真实的观测是沿光锥累积的，光锥与演化效应的差别留给下游的光锥拼接。

$$\delta T_b(z)=27\,x_{\rm HI}(z)\left(1-\frac{T_\gamma}{T_S}\right)\left(\frac{1+z}{10}\right)^{1/2}\frac{\Omega_b h^{2}}{0.023}\left(\frac{0.15}{\Omega_m h^{2}}\right)^{1/2}\ \mathrm{mK}$$

### 代码解析

`BrightnessTemperatureBox.c` 的 `ComputeBrightnessTemp`（72–86 行）把正文里两条等价写法都实现了，分支条件就是那个开关。默认那一支只有一行乘积：前因子 `const_factor`（循环外按红移与宇宙学参数算好）乘中性氢份额、乘密度扰动。

打开自旋温度涨落之后，同一行被拆成两步：先把乘积折成光深 `tau_21`——乘上 $(1+z)/(1000\,T_S)$，其中 1000 是把自旋温度从开尔文换成毫开尔文；再按饱和形式 $(1-e^{-\tau})\cdot 1000\cdot(T_S-T_\gamma)/(1+z)$ 写回亮温。两处 1000 容易被当成同一个换算，其实一处是量纲、一处是前因子里的温度比例，代码注释专门点明了这一点。同一趟循环里还把逐格点的值累加出全盒平均，标量 $\delta T_b$ 就是从这里出来的。

### 工程

- `src/py21cmfast/src/BrightnessTemperatureBox.c:72-86`

```c
                        box->brightness_temp[index] =
                            const_factor * pixel_x_HI * (1 + pixel_deltax);

                        if (astro_options_global->USE_TS_FLUCT) {
                            // Converting the prefactors into the optical depth, tau. Factor of 1000
                            // is the conversion of spin temperature from K to mK
                            box->brightness_temp[index] *=
                                (1. + redshift) / (1000. * spin_temp->spin_temperature[index]);
                            box->tau_21[index] = box->brightness_temp[index];
                            box->brightness_temp[index] =
                                (1. - exp(-box->brightness_temp[index])) * 1000. *
                                (spin_temp->spin_temperature[index] - T_rad) / (1. + redshift);
                        }

                        ave += box->brightness_temp[index];
```

#### ComputeBrightnessTemp
- `src/py21cmfast/src/BrightnessTemperatureBox.c:72-83`——逐格算 `dTb = const_factor · x_HI · (1+delta)`；开 `USE_TS_FLUCT` 时先把预因子折成光深 `tau_21`，再按 `(1-exp(-tau)) · 1000 · (TS-Trad)/(1+z)` 写回亮温，并累出全盒平均。

```c
                        box->brightness_temp[index] =
                            const_factor * pixel_x_HI * (1 + pixel_deltax);

                        if (astro_options_global->USE_TS_FLUCT) {
                            // Converting the prefactors into the optical depth, tau. Factor of 1000
                            // is the conversion of spin temperature from K to mK
                            box->brightness_temp[index] *=
                                (1. + redshift) / (1000. * spin_temp->spin_temperature[index]);
                            box->tau_21[index] = box->brightness_temp[index];
                            box->brightness_temp[index] =
                                (1. - exp(-box->brightness_temp[index])) * 1000. *
                                (spin_temp->spin_temperature[index] - T_rad) / (1. + redshift);
```

- 输入：$x_{\rm HI}$、$T_s$、$T_\gamma$、$\delta$ 与宇宙学参数；上游为 q_hii、ts、tgamma、perturb_field
- 产出：21 cm 平均亮温 $\delta T_b(z)$ 与涨落盒

### 参数语境

#### OMb

重子密度。亮温正比于中性氢的数密度，因此它直接进幅度（经 $n_{\rm H}\propto\Omega_b h^2$）；同时它经上游源项改电离历史，也就是改 $x_{\rm HI}$ 随红移的曲线。两个作用方向相同地压低或抬高信号。

#### OMm

总物质密度。它进膨胀率与密度扰动的归一，因此改亮温随红移的演化形状以及涨落盒的对比度——它改的不是整体高度，而是曲线怎么弯。

#### USE_TS_FLUCT

自旋温度涨落的总开关。打开时盒子里每个格点取自己的自旋温度，亮温涨落里因此含自旋温度那一份贡献（黎明段这一份往往是主导）；关闭时全盒只有一个自旋温度，涨落只剩密度与电离度的贡献。这是决定"亮温涨落盒长什么样"的最主要开关。

#### hlittle

无量纲哈勃常数。亮温正比于 $1/H(z)$、又正比于重子数密度（$\propto\Omega_bh^2$），两个方向同时作用；它还把波数与物理尺度的换算改掉，因此分析侧的尺度读数也随之变。

## P_21(k,z) · 21cm 功率谱

### 物理

21 厘米功率谱是分析侧的统计量：把亮温的盒子在波数空间做统计得出，振幅是亮温平均值的平方乘上三项组合——密度自功率、密度与中性氢份额的交叉项、中性氢份额的自功率。

公式就是这三项的加权和：权重由波矢与视线夹角的余弦给出，四次的给密度自功率、二次的给交叉项、常数项给中性氢份额的自功率；视线方向的速度梯度以红移空间畸变的形式进到密度项里。前提是亮温涨落相对平均足够小、可以做线性分解，且各向异性的来源只有速度梯度这一项。

波矢与视线夹角的余弦决定各项的权重：垂直于视线时中性氢份额的自功率主导，沿视线时密度与速度梯度的贡献放大，所以不同角度对应不同物理主导的尺度，同一张谱在不同角度上给出不同信息。

它是与观测直接对比的那一层，也是把模型参数约束住的地方：三项的相对幅度分别对源、电离与气体热敏感，因此联合不同红移与不同角度可以把几个简并的因子拆开。局限在实现只做均匀盒的统计，光锥几何、有限带宽与仪器噪声都要在观测侧另加，盒子里的模式离散也会在小波数端造成采样误差。

$$\Delta^{2}_{21}(k,z)=\frac{k^{3}}{2\pi^{2}}P_{21}(k,z),\qquad P_{21}=\delta T_b^{2}\left[\mu^{4}P_{\delta\delta}+2\mu^{2}P_{\delta x}+P_{xx}\right]$$

### 代码解析

统计本身由通用的功率谱库做，链上这段代码在 `cli.py`（718–734 行）：它沿光锥切片，逐片调用 `powerbox.get_power` 求亮温的功率谱，两条光锥各扫一遍，用来逐段对比。代码注释里还留着对库版本差异的兼容说明——早期版本只返回功率谱与波数，新版还要多两项。

看这一段要定位清楚它的身份：它属于分析脚本，不参与模拟推进；同一份统计在别的入口（对演化盒直接变换）也能做，这里走光锥只是为了更贴近观测。

### 工程

- `src/py21cmfast/cli.py:718-734`

```python
    while start + ncells <= lc_new.shape[-1]:
        # Note that earlier versions of powerbox would only return (p,k) but newer
        # versions always return (p,k,var,nsamples) even if the latter are None.
        # So we need to slice the output to get just (p,k) for compatibility with both versions.
        pd, k = powerbox.get_power(
            lc_default.lightcones["brightness_temp"][:, :, start : start + ncells],
            (*lc_default.lightcone_dimensions[:2], chunk_size),
            bins_upto_boxlen=True,
        )[:2]
        p_default.append(pd)

        pn, k = powerbox.get_power(
            lc_new.lightcones["brightness_temp"][:, :, start : start + ncells],
            (*lc_new.lightcone_dimensions[:2], chunk_size),
            bins_upto_boxlen=True,
        )[:2]
        p_new.append(pn)
```

- 输入：$\delta T_b$ 盒（波数取在分析侧选定）；上游为 dtb、q_hii
- 产出：$P_{21}(k,z)$（分析侧统计）

### 参数语境

#### OMb

重子密度。功率谱正比于亮温的平方，所以这个参数以平方级别的权重进幅度——它是分析侧"把观测幅度与模型对上"时最先被牵动的量。

#### OMm

总物质密度。它改亮温随红移的演化、密度扰动的归一，以及波数到物理尺度的换算，因此它改的是功率谱的形状随时间的漂移。

#### USE_TS_FLUCT

自旋温度涨落的总开关。打开时功率谱里含自旋温度涨落那一份（黎明段在中等尺度上是主要贡献），关闭时这部分消失，只剩密度主导的谱形——同一个模型在两种口径下给出形状明显不同的 $P_{21}$，比较结果前必须先对齐这条开关。

#### hlittle

无量纲哈勃常数。它进亮温幅度（经 $1/H$ 与重子密度）与波数的物理尺度换算，幅度与横轴都随它变。

## τ_e · 汤姆森光深（标量）

### 物理

汤姆逊光深量的是微波背景光子被自由电子散射的累积概率：沿整段红移历史对自由电子积分，被积函数是电离份额、红移平方与膨胀率的组合。它是微波背景侧对再电离唯一的直接约束量。

公式是一层红移积分，被积项为电离份额乘红移平方再除以膨胀率；完全电离的红移区间以及氦的再电离也按各段的电子份额分段处理。前提是均匀电离：被积函数只用全宇宙平均的电离份额，电离泡的形态与增长历史都不进入积分。

信息极度压缩：整条电离历史被压成一个标量，所以不同的电离历史可以给出同一个光深——这也是光深不能单独定出再电离红移的原因。它与 21 厘米一起用，才能把再电离的时点与形状分开。

$$\tau_e=\sigma_T\,\bar n_{\rm H,0}\,c\int_{0}^{\infty}\mathrm dz\,\frac{(1-Q_{\rm HII})\,(1+z)^{2}}{H(z)}$$

### 代码解析

`thermochem.c` 的 `dtau_e_dz`（161–191 行）是被积函数，读它主要看两个边界情形怎么处理。一是红移数组为空、或目标红移高于数组起点（表示再电离还没开始），被积函数直接取完全电离的值——这就是正文里"完全电离的红移区间按段处理"落在代码里的样子。二是在数组区间内，中性份额按红移线性插值再取补得电离份额；插值结果越界会被夹回 $[0,1]$ 并告警，因为一次非物理的插值会被积分成系统性偏差，而不是一个可以忽略的局部错误。

积分收尾在 269–272 行：结果乘上汤姆逊截面与氢、氦的柱密度组合——其中氦的电子数用再电离红移前后两套值，这就是分段处理里的另一段。

### 工程

- `src/py21cmfast/src/thermochem.c:161-191`

```c
double dtau_e_dz(double z, void *params) {
    float xH, xi;
    int i = 1;
    tau_e_params p = *(tau_e_params *)params;

    if ((p.len == 0) || !(p.z)) {
        return (1 + z) * (1 + z) * drdz(z);
    } else {
        // find where we are in the redshift array
        if (p.z[0] > z)  // ionization fraction is 1 prior to start of array
            return (1 + z) * (1 + z) * drdz(z);
        while ((i < p.len) && (p.z[i] < z)) {
            i++;
        }
        if (i == p.len) return 0;

        // linearly interpolate in redshift
        xH = p.xH[i - 1] + (p.xH[i] - p.xH[i - 1]) / (p.z[i] - p.z[i - 1]) * (z - p.z[i - 1]);
        xi = 1.0 - xH;
        if (xi < 0) {
            LOG_WARNING("in taue: funny business xi=%e, changing to 0.", xi);
            xi = 0;
        }
        if (xi > 1) {
            LOG_WARNING("in taue: funny business xi=%e, changing to 1", xi);
            xi = 1;
        }

        return xi * (1 + z) * (1 + z) * drdz(z);
    }
}
```

- `src/py21cmfast/src/thermochem.c:269-272`

```c
    gsl_integration_workspace_free(w);

    return physconst.sigma_T * ((N_b0 + He_No) * prehelium + N_b0 * posthelium);
}
```

#### ComputeTau
- `src/py21cmfast/src/thermochem.c:274-276`——把整条 `x_HI(z)` 与红移网格交给 `tau_e` 沿视线积分（含 HeII 再电离红移 `z_re_HeII`），得汤姆森光深。

```c
float ComputeTau(int NPoints, float *redshifts, float *global_xHI, float z_re_HeII) {
    return tau_e(0, redshifts[NPoints - 1], redshifts, global_xHI, NPoints, z_re_HeII);
}
```

- 输入：$Q_{\rm HII}(z)$ 与 $H(z)$；上游为 q_hii
- 产出：汤姆逊光深 $\tau_e$

### 参数语境

这一篇名下没有参数标签：$\tau_e$ 是电离历史与膨胀率的积分，式子本身不含自由参数。凡是能改它的量都在上游——电离分数随红移的曲线（由电离支的效率、截断质量、复合那一组参数决定）与宇宙学参数（经 $H(z)$ 与数密度进入）。因此把 $\tau_e$ 当约束用时，它约束的是整条电离历史，而不是某一个参数；这也是它常与再电离时点一起被引用的原因。

## 参数

本模块携带 4 个参数（与画布上这块的「参数」卡同一份清单；类别是 `inputs.py` 里的结构名）。下面逐条写它在代码里做什么；同一个参数**在某个成员那一步里**的语境与落点，写在那个成员节的「参数语境」里。

| 参数 | 类别 | 在代码里做什么 |
| :--- | :--- | :--- |
| `OMb` | `CosmoParams` | 重子密度。亮温正比于中性氢的数密度（经 $n_{\rm H}\propto\Omega_b h^2$），所以它直接进幅度；同时又经上游源项改电离历史，也就是改 $x_{\rm HI}$ 随红移的曲线。两个作用方向相同地压低或抬高信号；到功率谱那一级，它正比于亮温的平方，以平方级别的权重进幅度。 |
| `OMm` | `CosmoParams` | 总物质密度。它进膨胀率与密度扰动的归一，因此改亮温随红移的演化形状以及涨落盒的对比度——改的不是整体高度，而是曲线怎么弯；到功率谱那一级，它还改波数到物理尺度的换算，于是形状随时间的漂移也跟着变。 |
| `USE_TS_FLUCT` | `AstroOptions` | 自旋温度涨落的总开关。打开时盒子里每个格点取自己的自旋温度，亮温涨落里因此含自旋温度那一份贡献（黎明段这一份往往是主导），功率谱在中等尺度上以它为主；关闭时全盒只有一个自旋温度，涨落只剩密度与电离度的贡献。同一个模型在两种口径下给出形状明显不同的结果，比较前必须先对齐这条开关。 |
| `hlittle` | `CosmoParams` | 无量纲哈勃常数。亮温正比于 $1/H(z)$、又正比于重子数密度（$\propto\Omega_bh^2$），两个方向同时作用；它还把波数与物理尺度的换算改掉，因此分析侧的尺度读数也随之变。 |

## 论文出处

本模块各成员名下登记的论文出处，逐成员一组，次序与成员次序一致。

**δT_b(z) · 21cm 平均亮温**

- 论文节号：§3 全局 21cm 信号（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

**P_21(k,z) · 21cm 功率谱**

- 论文节号：§4 涨落与功率谱（§4.1 红移空间畸变、§4.2 电离涨落）（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）

**τ_e · 汤姆森光深（标量）**

- 论文节号：§3.2 全局信号的演化（`docs/论文/Pritchard & Loeb 2012 Review.pdf`）
