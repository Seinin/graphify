# 21cmFAST X-ray 工程手册

---

## E-pre:X-ray 经验拟合模型

### 顶层:X-ray 链条上的四个"外包件"

X-ray 从源到加热的完整链条(对应物理编[P3](XRAY_physics_manual.md#p3x-ray-加热电离速率物理核心)–[P5](XRAY_physics_manual.md#p5x-ray-源场从光晕到发射率)):

```text
① 源:SFR ──L_X/SFR 标度──> L_X ──② SED 谱形──> L_ν
                                                  │
                                       ③ σ_i(ν) 光电离截面
                                                  ↓
                                     初级光电子(能量 hν − hν_ion)
                                                  │
                                       ④ 次级电子能量分配
                                                  ↓
                                 加热 / Lyα / 电离 三个出口 → ε_X
```

四个环节各自对应一个来自外部论文的拟合:

| #  | 环节                        | 拟合对象                                    | 来源文献                                      | 代码落点                                    | 形态                 |
| -- | --------------------------- | ------------------------------------------- | --------------------------------------------- | ------------------------------------------- | -------------------- |
| ① | SFR → X-ray 光度           | $L_X/\mathrm{SFR}$ 随金属丰度、SFR 的依赖 | Lehmer+2021、Kaur+22                          | `scaling_relations.c`                     | 解析公式(多数未启用) |
| ② | X-ray SED                   | 谱形(单幂律)与归一化                        | Greig+2018 §4.1 惯例                         | `SpinTemperatureBox.c`                    | 唯象假设 + 解析积分  |
| ③ | 光电离截面$\sigma_i(\nu)$ | 各物种截面随频率                            | **Verner+96**(HeI)、Osterbrock(HI/HeII) | `thermochem.c`                            | 经验拟合 / 解析式    |
| ④ | 次级电子能量分配            | 电子能量三分:加热 / Lyα / 电离             | **Shull & van Steenberg 1985**          | `elec_interp.c` + `_data/x_int_tables/` | 数值表 14×258       |

### ① SFR → X-ray 光度:$L_X/\mathrm{SFR}$ 标度关系

**默认行为:常数。** `get_lx_on_sfr`(`scaling_relations.c:300`)默认直接返回 `lx_constant`,即参数 `L_X`(默认 $10^{40.5}\ \mathrm{erg\,s^{-1}\,(M_\odot\,yr^{-1})^{-1}}$),假设 X-ray 光度与 SFR 严格成正比、与金属丰度无关——零阶模型。

代码里其实写了四个备选模型:

| 模型              | 函数                    | 当前状态                              |
| ----------------- | ----------------------- | ------------------------------------- |
| 常数              | —                      | **默认启用**                    |
| 金属丰度双幂律    | `lx_on_sfr_doublePL`  | `USE_UPPER_STELLAR_TURNOVER` 时启用 |
| Lehmer+2021       | `lx_on_sfr_Lehmer`    | 注释掉                                |
| Kaur+22 幂律      | `lx_on_sfr_PL_Kaur`   | 注释掉                                |
| Kaur+22 Schechter | `lx_on_sfr_Schechter` | 注释掉                                |

**双幂律(当前唯一可启用的非平凡模型)**

$$
\frac{L_X}{\mathrm{SFR}}=\frac{L_{X,0}}{1+(Z/Z_{\rm pivot})^{0.64}},\qquad Z_{\rm pivot}=0.05\,Z_\odot
$$

其中 $L_{X,0}\equiv\texttt{lx\_constant}$ 是**外乘常数**(低金属丰度极限下的基准效率),并不属于通用函数本身。通用函数 `scaling_double_PL(M, α_lo, pivot_ratio, α_hi, pivot_hi)` 只返回无量纲的标度因子:

$$
f(M)=\frac{\texttt{pivot\_ratio}}{(M/\texttt{pivot\_hi})^{-\alpha_{\rm lo}}+(M/\texttt{pivot\_hi})^{-\alpha_{\rm hi}}}
$$

取 $\alpha_{\rm lo}=0$、$\alpha_{\rm hi}=-0.64$、$\texttt{pivot\_ratio}=1$,且自变量 $M\to Z$(金属丰度)时,通用函数化简为

$$
f(Z)=\frac{1}{1+(Z/Z_{\rm pivot})^{-0}+(Z/Z_{\rm pivot})^{0.64}}
=\frac{1}{1+(Z/Z_{\rm pivot})^{0.64}}
$$

——**注意右边没有 $L_{X,0}$**。完整的 `lx_on_sfr_doublePL` 调用是 `lx_constant * scaling_double_PL(metallicity, 0., 1., -0.64, 0.05)`,即把上面的 $f(Z)$ 再乘以外乘常数 $L_{X,0}=\texttt{lx\_constant}$,才得到首行的全式。$Z\to0$ 时 $f\to1$,故 $L_X/\mathrm{SFR}\to L_{X,0}$(低金属丰度星系的 X 射线双星效率高);$Z\gg Z_{\rm pivot}$ 时按 $Z^{-0.64}$ 衰减;在 $Z=Z_{\rm pivot}$ 处恰为 $L_{X,0}/2$。

### ② X-ray SED:单幂律 + 解析归一化

**唯象假设**(Greig+2018 §4.1 的惯例)。② 只回答两件事:**谱形长什么样**($\nu^{-\alpha_X}$)、**总量是多少**(由 $L_X$ 归一化)。

**谱形**(`AstroParams`,`_inputparams_wrapper.h:115/137-138`):$L_\nu\propto\nu^{-\alpha_X}$,指数 `X_RAY_SPEC_INDEX`,默认 1.0。三个能量界的默认值都**以 eV 存储**,进频率积分前要乘 `eV_to_Hz`:

| 参数              | 默认值   | 作用域      | 含义                                              |
| ----------------- | -------- | ----------- | ------------------------------------------------- |
| `NU_X_THRESH`   | 500 eV   | SED 归一化  | $\nu_0$:归一参考频率 + 宿主星系自吸收能量下限   |
| `NU_X_BAND_MAX` | 2000 eV  | SED 归一化  | $\nu_1$:观测 $L_X$ 定义能带上限(光度积分上限) |
| `NU_X_MAX`      | 10000 eV | E3 频率积分 | $\nu_{\max}$:频率积分数值上限(不参与归一化!)    |

**归一化推导(相对参考频率写法,与代码和 E3 配套)**:代码给 E3 的权是 $(\nu/\nu_0)^{-\alpha_X-1}$,在 $\nu_0$ 处为 1;因此谱也按同一参考点写——设

$$
L_\nu=A\left(\frac{\nu}{\nu_0}\right)^{-\alpha_X}
$$

($A$ 即 $\nu_0$ 处的 $L_\nu$ 值),要求能带 $[\nu_0,\nu_1]$ 内积分等于观测的 $L_X$:

$$
L_X=\int_{\nu_0}^{\nu_1}A\left(\frac{\nu}{\nu_0}\right)^{-\alpha_X}\mathrm d\nu
=A\,\nu_0^{\alpha_X}\,\frac{\nu_1^{1-\alpha_X}-\nu_0^{1-\alpha_X}}{1-\alpha_X}
\;\Longrightarrow\;
\frac{A}{L_X}=\frac{(1-\alpha_X)\,\nu_0^{-\alpha_X}}{\nu_1^{1-\alpha_X}-\nu_0^{1-\alpha_X}}
$$

这就是代码里 `luminosity_converstion_factor` 的数学身份($A/L_X$):**分子 $(1-\alpha_X)\nu_0^{-\alpha_X}$,分母 $\nu_1^{1-\alpha_X}-\nu_0^{1-\alpha_X}$**——所以代码才在分母之外另乘 $\nu_0^{-\alpha_X}$。若坚持写成绝对谱 $L_\nu=A'\nu^{-\alpha_X}$ 则 $A=A'\,\nu_0^{-\alpha_X}$(只是把 $(\nu/\nu_0)^{-\alpha_X}$ 拆成 $\nu_0^{\alpha_X}\nu^{-\alpha_X}$,归一化后常数互相抵消),P5 的写法即 $A'$;本文与代码都用相对式,只为让 $\nu_0$ 处权为 1。

**代码落点 `set_zp_consts`**(`SpinTemperatureBox.c:1086`,每红移快照算一次)。注意变量名拼写:源码是 `luminosity_converstion_factor`(conversion 误拼成 converstion):

```c
// SpinTemperatureBox.c:1094——α_X=1 单独分支(0/0 型不定式,直接代值得 NaN)
if (fabs(astro_params_global->X_RAY_SPEC_INDEX - 1.0) < 1e-6) {
    luminosity_converstion_factor =
        (NU_X_THRESH) * physconst.eV_to_Hz *
        log(NU_X_BAND_MAX / NU_X_THRESH);        // ln(ν1/ν0):两个 eV 相除,eV_to_Hz 约掉
    luminosity_converstion_factor = 1. / luminosity_converstion_factor;
} else {
    luminosity_converstion_factor =
        pow(NU_X_BAND_MAX * physconst.eV_to_Hz, 1. - X_RAY_SPEC_INDEX)
        - pow(NU_X_THRESH * physconst.eV_to_Hz, 1. - X_RAY_SPEC_INDEX);  // 上式分母
    luminosity_converstion_factor = 1. / luminosity_converstion_factor;
    luminosity_converstion_factor *=
        pow(NU_X_THRESH * physconst.eV_to_Hz, -X_RAY_SPEC_INDEX)
        * (1. - X_RAY_SPEC_INDEX);                // 上式分子
}
luminosity_converstion_factor /= physconst.h_p;   // ÷h_p:源码注释"divide by eV→erg"(L_X 按 erg/s 定义)
// 拼 xray_prefactor 时再 ÷ν0、×c、×(1+zp)^{α_X+3},完整推导见 E5
```

**$\alpha_X=1$ 的特判是数值必需,不是可选的**:上面 $A/L_X$ 的表达式在 $\alpha_X\to1$ 时分子分母**同时趋于 0**(不定式 $\frac{0}{0}$),直接代值得 NaN,故代码单列分支(把上式取极限 $\lim_{\alpha\to1}\frac{1-\alpha}{\nu_1^{1-\alpha}-\nu_0^{1-\alpha}}=\frac{1}{\ln(\nu_1/\nu_0)}$,注意还留着 $\nu_0^{-\alpha}\to\nu_0^{-1}$):

$$
\alpha_X=1:\qquad \frac{A}{L_X}=\frac{1}{\nu_0\,\ln(\nu_1/\nu_0)}
\quad\Longleftrightarrow\quad
A=\frac{L_X}{\nu_0\ln(\nu_1/\nu_0)}
$$

这也是代码分支第一行要写 `NU_X_THRESH * eV_to_Hz * log(...)` 的原因——它正是 $\nu_0\ln(\nu_1/\nu_0)$。

**默认值走查**(用默认参数 $\alpha_X=1$、$E_0=500\ \mathrm{eV}$、$E_1=2000\ \mathrm{eV}$ 手动算一遍,与代码对上):$\nu_0 = 500\times 2.418\times10^{14}=1.209\times10^{17}\ \mathrm{Hz}$,$\ln(\nu_1/\nu_0)=\ln(2000/500)=\ln4=1.386$,于是

$$
\frac{A}{L_X}=\frac{1}{\nu_0\ln(\nu_1/\nu_0)}=\frac{1}{1.209\times10^{17}\times1.386}\approx5.97\times10^{-18}\ \mathrm{Hz^{-1}}
$$

这就是 `set_zp_consts` 第一分支算出的量级——谱越"软"($\alpha_X$ 大)或归一能带越窄,$A/L_X$ 越大(同样的 $L_X$ 需要更强的 $\nu_0$ 处谱值)。

> **坑**:`NU_X_THRESH` 把"宿主星系自吸收"压成一个硬阈值,是**唯象处理**(Greig+2018 §4.1),并非真正的辐射转移;它同时充当 SED 归一化点与积分下限,改动它会连带影响 E4 的 $\nu_{\tau=1}$ 下限——E3 里 `lower_int_limit = max(nu_tau_one, NU_X_THRESH)`。

### ③ 光电离截面 $\sigma_i(\nu)$

| 物种          | 来源                         | 形态               |
| ------------- | ---------------------------- | ------------------ |
| HI            | Osterbrock(氢样原子精确解)   | 解析式             |
| HeII          | 同上,取$Z=2$               | 解析式             |
| **HeI** | **Verner et al. 1996** | **经验拟合** |

**HI / HeII(Osterbrock)**

$$
\sigma(\nu)=\frac{6.3\times10^{-18}}{Z^2}\left(\frac{\nu_{\rm ion}}{\nu}\right)^{4}
\frac{\exp\!\left[4-\dfrac{4\arctan\epsilon}{\epsilon}\right]}{1-\exp(-2\pi/\epsilon)},
\qquad \epsilon\equiv\sqrt{\nu/\nu_{\rm ion}-1}
$$

**HeI(Verner+96 拟合)**:令

$$
x=\frac{h\nu}{13.61\ \mathrm{eV}}-0.4434,\qquad y=\sqrt{x^2+2.136^2}
$$

则

$$
\sigma_{\rm HeI}=9.492\times10^{-16}\Big[(x-1)^2+2.039^2\Big]\,y^{\,3.188/2-5.5}
\left(1+\sqrt{y/1.469}\right)^{-3.188}\ \mathrm{cm^2}
$$

**物种加权**

$$
\bar\sigma(\nu,x_e)=f_{\rm H}(1-x_e)\sigma_{\rm HI}+f_{\rm He}(1-x_e)\sigma_{\rm HeI}+f_{\rm He}\,x_e\,\sigma_{\rm HeII}
$$

(`species_weighted_x_ray_cross_section`,`heating_helper_progs.c:871`)

### ④ 次级电子能量分配:Shull & van Steenberg (1985) 数值表

这是 X-ray 链条上**最贵、最不可替代**的外来件,也是 E3 被积函数的核心。

**物理**:X 射线光电离打出的初级电子携带 $E=h\nu-h\nu_{\rm ion}$,它在 IGM 中继续碰撞损失能量,去向有三——加热气体、激发 HI(退激发发 Lyα)、再电离别的原子。三者比例同时依赖**电子能量 $E$** 与**电离分数 $x_e$**,没有廉价解析式,故直接采用 S&S85 的数值计算结果。 

## E0:半解析框架与 X-ray 的处理策略

21cmFAST 是**半解析(semi-numeric)模拟**:不在每个网格点解完整辐射转移方程,而是用**解析缩放关系 + 蒙特卡洛式滤波**近似。X-ray 处理的核心难点是:**X-ray 光子的平均自由程远大于电离光子**(可达数百 Mpc),因此不能像 UV 那样局部处理,必须考虑**源到目标点的频率演化(宇宙学红移)和沿途吸收(光学深度)**——这决定了 21cmFAST 用"频率积分表 + 环形滤波"来近似,而非逐光子追踪。

> **主线**:让"长程、频率演化、非局部的 X-ray 加热"在 256³ 网格上算得快?答案拆成三步:E3(频率积分做成查表)+ E4(空间传播做成 FFT 环形滤波)+ E5(源场用解析缩放关系)。E1、E2 是物理编[P1](XRAY_physics_manual.md#p121cm-亮温公式x-ray-作用的终点)、[P2](XRAY_physics_manual.md#p2自旋温度-ts-与动力学温度-tk)的代码落地。

## E1:亮温合成与 X-ray 在链上的位置

```text
X-ray 源场 → 加热/电离速率 → Tk 演化 → Ts(=Tk 加耦合修正) → δT21
```

21cmFAST 中亮温在 `BrightnessTemperatureBox.c` 计算(基于 TsBox、IonisationBox、density 扰动场)。X-ray 不直接出现在亮温公式里,而是通过 **Tk 和 x_e** 间接进入(对应物理编[P1](XRAY_physics_manual.md#p121cm-亮温公式x-ray-作用的终点))。

## E2:Tk 与 Ts 的演化(`get_Ts_fast`)

**自顶向下:先看全貌。** 物理编[P2](XRAY_physics_manual.md#p2自旋温度-ts-与动力学温度-tk)的式(15) 讲的是"$T_k$ 的变化 = 体积做功 + 各加热/冷却源";工程上 `get_Ts_fast`(`SpinTemperatureBox.c`)把它做成**红移步进**的离散更新:对每个网格单元,从上一步的 `prev_Tk` 出发,把各加热/冷却项对红移步长 $dz_p<0$ 积分一步。**全貌只有一行**——就是最终更新那一行代码:

```c
// get_Ts_fast 内部,每个网格单元、每个红移步执行一次:
Tk += (dxheat_dzp + dcomp_dzp + dspec_dzp + dadia_dzp + dCMBheat_dzp + eps_Lya_cont + eps_Lya_inj) * dzp;
```

即 $T_k^{\mathrm{new}} = T_k^{\mathrm{old}} + \sum_i \Delta T_k^{(i)}$,求和遍及七个物理项。**自顶向下的分解树**(树顶是这一行,每往下钻一层都有对应的物理来源与代码变量):

```text
T_k 演化(每网格、每红移步 dz_p < 0)              ← 树顶:一行求和
│
├─ ① 绝热项   dadia_dzp        膨胀做功 + 结构形成压缩      → 式(15) 第 1 项 (2T_k/3n)(dn/dt)
├─ ② 物种项   dspec_dzp        电离摊薄每粒子平均动能       → 式(15) 第 1 项的"电离"来源(P2 第 5 步)
├─ ③ Compton  dcomp_dzp        CMB 光子 ↔ 残余电子 ↔ 重子   → 式(15) 第 2 项 ε_Compton
├─ ④ X-ray    dxheat_dzp       光电离 + 次级电子沉积(主线) → 式(15) 第 2 项 ε_X
├─ ⑤ CMB 加热 dCMBheat_dzp     CMB 直接加热(Meiksin+21,默认关) → 附加项
└─ ⑥ Lyα 加热 eps_Lya_cont / eps_Lya_inj  Lyα 散射反冲沉积    → 式(15) 第 2 项 ε_Lyα
```

> **主线——这七项是同一物理过程的分解,不是七个独立过程。** 树顶那一行求和是**结果**而非**源头**,真正的因果链只有一条:
>
> 1. **一个能量沉积,两个出口。** X-ray/CMB/UV 光子的能量是"同一笔钱",同时付给加热(→ ④,变成气体动能)与电离(`dxion_dt`,打出电子)。代码里 `dxheat_dt_box` 与 `dxion_source_dt_box` 出自 E3 **同一次频率积分**,只是按不同比例分配给两个出口。
> 2. **电离是"果"而非"因"。** 分解树里的 ②③ 都由电离引起,而电离本身又由 ④(以及 CMB/UV)驱动:电离把每 H 核粒子数从 1 摊到 $1+x_e$,总动能不变 → 每粒子平均动能下降(②);电离产生的自由电子才让 Compton 率 ∝ $x_e/(1+x_e+f_{\mathrm{He}})$ 有东西可转(③)。**所以 ②③ 的前因是 ④,不是它们自己**。
> 3. **T_k 再反馈成环。** 加热抬高 $T_k$ → 碰撞速率 $\kappa_{10}(T_k)$ 变 → $x_{\mathrm{col}}$ 变 → $T_s$;电离抬高 $x_e$ → 进插值表与 $(1+x_e)$ 分母 → 改变下一时步的 ε_X。
>
> 工程上耦合靠"带着 $x_e$ 走"实现:每步先算 `dxe_dzp` 再算七项求和,`prev_xe` 同时出现在 ②③④ 与插值表里。拆项只为数值稳定与性能(插值表只依赖 $(x_e,R)$);唯一近似是步内用步首状态线性外推(显式积分)——**那是数值近似,不是物理解耦**。

下面**从树顶往树叶**逐层展开:第 1 层把七项逐一对照代码与物理;第 2 层钻进主线 X-ray 项的实现;第 3 层看 Tk 与 x_e 的耦合推进。

**第 1 层:七项逐项拆解(代码 ↔ 物理)。**

| 代码变量                           | 物理项                           | 对应式(15)                              |
| ---------------------------------- | -------------------------------- | --------------------------------------- |
| `dadia_dzp`                      | 绝热加热/冷却(膨胀 + 结构形成)   | $\dfrac{2T_k}{3n}\dfrac{dn}{dt}$      |
| `dspec_dzp`                      | 电离改变粒子数导致的温度变化     | $-\dfrac{T_k}{1+x_e}\dfrac{dx_e}{dz}$ |
| `dcomp_dzp`                      | Compton 加热(CMB ↔ 残余电子)    | $\epsilon_{\mathrm{Compton}}$ 项      |
| `dxheat_dzp`                     | **X-ray 加热**(本手册主线) | $\epsilon_X$ 项                       |
| `dCMBheat_dzp`                   | CMB 加热(Meiksin+21,默认关)      | 附加项                                  |
| `eps_Lya_cont` / `eps_Lya_inj` | Lyα 连续谱/注入加热             | $\epsilon_{\mathrm{Ly}\alpha}$ 项     |

**(a) 绝热项与物种项**(核心,最容易混的两个非 X-ray 项):

```c
// 绝热项:对应式(15) 第一项 (2T_k/3n)(dn/dt)
dadia_dzp = 3 / (1.0 + zp);                   // 均匀膨胀:n ∝ (1+z)^3 → (1/n)(dn/dz) = 3/(1+z)
if (fabs(rad->delta) > FRACT_FLOAT_ERR)       // 结构形成:过密区 δ 随 growth 生长,额外修正 n
    dadia_dzp += consts->dgrowth_dzp / (consts->growth_zp * (1.0 / rad->delta + 1.0));
dadia_dzp *= (2.0 / 3.0) * rad->prev_Tk;      // 乘上 (2/3)T_k,与式(15) 第一项系数一致

// 物种项:对应 P2 第 5 步(电离稀释粒子数)
dspec_dzp = -dxe_dzp * rad->prev_Tk / (1 + rad->prev_xe);
```

逐行核对:红移步进 `dzp < 0` 而 `dadia_dzp > 0`,乘积为负 → 膨胀冷却 ✓;结构形成项等于 $\frac{d\ln\delta}{dz}\cdot\frac{\delta}{1+\delta}$,即过密区 $\delta$ 生长带来的额外密度变化;`dxe_dzp > 0`(电离增加)时 `dspec_dzp < 0` → 电离把粒子数摊薄、温度下降 ✓。式(15) 第一项里"任意 $n$ 变化"在代码中被明确拆成膨胀 + 结构形成 + 物种三块,物理来源不同、分开步进更稳。

**(b) Compton 项**(核心):

```c
// Compton 加热:物理节式(24-25) 的工程形式
dcomp_dzp = consts->dcomp_dzp_prefactor * (rad->prev_xe / (1.0 + rad->prev_xe + HE_FRAC)) *
            (consts->Trad - rad->prev_Tk);
```

`dcomp_dzp_prefactor` 在 `set_radiative_transfer_consts` 里一次性算好(∝ $T_\gamma^4/(1+z)/H(z)$ 等红移因子,数值约 $-1.5\times10^{-4}$ 量级),运行时只需乘两个因子——**电子丰度占比** $x_e/(1+x_e+f_{\mathrm{He}})$ 与**温差** $T_\gamma - T_k$。这与物理节式(24-25) 的 $x_e$ 依赖、$(T_\gamma-T_k)$ 线性依赖逐项对应(`Trad` 即 $T_\gamma$)。**$z\gtrsim150$ 时该项主导,把 $T_k$ 钉在 $T_\gamma$ 上;更低红移衰减后让位给绝热冷却**。

**(c) CMB 加热与 Lyα 加热**(次要,默认关):

```c
// CMB 加热(USE_CMB_HEATING,默认关):Meiksin et al. 2021
// eps_CMB ∝ (T_γ/T_21) A10 (1+2T_k/T_21),再乘每粒子换算因子 2/(3k_B(1+x_e))
// Lyα 加热(USE_LYA_HEATING):
// eps_Lya_cont = -Ndot_alpha_cont × E_continuum × 2/(3k_B(1+x_e))
// eps_Lya_inj  = -Ndot_alpha_inj  × E_injected  × 2/(3k_B(1+x_e))
```

两者的结构一致:都是"反冲能量沉积 × 每粒子换算因子 $2/(3k_B(1+x_e))$"。**注意这个换算因子在所有加热项里反复出现**——它正是式(15) 第二项的统一系数 $\frac{2}{3k_B n}$,在代码里因为每 H 核粒子数为 $1+x_e$ 而写成 $2/(3k_B(1+x_e))$。

**第 2 层:X-ray 项(主线)的两段式实现。** `dxheat_dzp` 在代码里由两段相乘拼出:

```c
// 第一段:UpdateXraySourceBox 里,频率积分表 × 空间滤波,按网格预存
if (astro_options_global->USE_X_RAY_HEATING) {
    rad.dxheat_dt = dxheat_dt_box[box_ct] * zp_consts.xray_prefactor * zp_consts.volunit_inv;
}
rad.dxion_dt = dxion_source_dt_box[box_ct] * zp_consts.xray_prefactor * zp_consts.volunit_inv;

// 第二段:get_Ts_fast 里,乘红移步长与"能量 → 温度"因子
dxheat_dzp = rad->dxheat_dt * consts->dt_dzp * 2.0 / 3.0 / physconst.k_B / (1.0 + rad->prev_xe);
```

各因子分工:

- `dxheat_dt_box[box_ct]`:E3 频率积分表 × E4 环形滤波的空间求和——**网格依赖**部分,按点预存
- `xray_prefactor`:源发射率 → 能量沉积率的**谱归一/红移因子**(SED 归一化与 $(1+z_p)^{\alpha_X+3}$,见 E5),不依赖空间位置
- `volunit_inv`:体积单位换算(per cm⁻³;默认模式含重子质量密度因子)
- `dt_dzp`:`dt/dz` 红移步长(即 `dtdz(zp)`,同样在 `set_radiative_transfer_consts` 预存);$2/(3k_B(1+x_e))$:每 H 核粒子数 $1+x_e$ 下的"能量 → 温度"换算

**为什么这样拆(性能动机)**:频率积分(昂贵)只依赖 $(x_e,R)$,与网格点密度无关 → 做成插值表只算一次;空间滤波(昂贵)单独作用在源场上 → 各壳层预存。两件昂贵的事各做一遍,`get_Ts_fast` 里只是查表 + 相乘一行——这是 21cmFAST 能跑 256³ 网格的工程前提。

**第 3 层:Tk 与 x_e 耦合推进。** 同一函数里同步更新 $x_e$:

```c
dxe_dzp = consts->dt_dzp * (rad->dxion_dt - dxion_sink_dt);   // 电离 − 复合
```

X-ray 经 `dxion_dt`(E3 电离积分)推高 $x_e$,$x_e$ 又反馈进 `dxheat_dzp` 分母的 $(1+x_e)$ 与 E3 插值表的 $x_e$ 维——加热与电离的耦合,正是物理编[P3](XRAY_physics_manual.md#p3x-ray-加热电离速率物理核心)"X-ray 加热与再电离正反馈"一说的工程落点。

**收尾:自顶向下回到树顶。** 把第 1–3 层全部装回去,树顶那一行代码就是式(15) 的完整工程实现:

$$
T_k^{\mathrm{new}} = T_k^{\mathrm{old}} + dz_p\,\Big[\underbrace{\frac{2T_k}{3n}\frac{dn}{dt}}_{\text{绝热+物种}}
+ \underbrace{\frac{2}{3k_B n}\big(\varepsilon_{\mathrm{Compton}} + \varepsilon_X + \varepsilon_{\mathrm{Ly}\alpha} + \varepsilon_{\mathrm{CMB}}\big)}_{\text{各加热源}}\Big]
$$

每个 $dz_p<0$ 使"加热项为正 → 温度升高"的符号自洽;另有一道保险:梯形积分器在低密区可能过冷,`if (Tk < 0) Tk = consts->Trad;` 把非物理的负温度钳回 $T_\gamma$。

## E3:频率积分表(被积函数 → 插值表)

**(1) 被积函数**(`integrand_in_nu_heat_integral`,heating_helper_progs.c L755):

三个物种指 **HI（中性氢）、HeI（中性氦）、HeII（单次电离氦）**,即 IGM 中仅有的三种可被 X-ray 光电离、从而产生次级电子的靶（电离边分别为 13.6 / 24.6 / 54.4 eV；HeIII 丰度极低，不计）。一个 X-ray 光子打到介质上，可能电离其中任意一种，三种贡献同时存在，因此加热被积函数必须同时包含三条通道。

三条通道各自独立（电离边 $\nu_i$、截面 $\sigma_i$、可被电离的比例 $n_i$ 均不同）。三个物种的"可被电离比例"分别为：

$$
n_{\rm HI}=1-x_e,\qquad n_{\rm HeI}=1-x_e,\qquad n_{\rm HeII}=x_e
$$

注意 HeII 是已电离一次的产物，其存量随电离程度 $x_e$ 增大，故用 $x_e$ 而非 $1-x_e$。三通道写出：

$$
\begin{aligned}
\frac{d\varepsilon_{\rm heat}^{\rm HI}}{d\nu}
&= \left(\frac{\nu}{\nu_0}\right)^{-\alpha_X-1} f_{\rm heat}\!\left(\tfrac{h(\nu-\nu_{\rm HI})}{\mathrm{eV}},x_e\right)\,h(\nu-\nu_{\rm HI})\,X_{\rm H}\,n_{\rm HI}\,\sigma_{\rm HI}(\nu) \\[4pt]
\frac{d\varepsilon_{\rm heat}^{\rm HeI}}{d\nu}
&= \left(\frac{\nu}{\nu_0}\right)^{-\alpha_X-1} f_{\rm heat}\!\left(\tfrac{h(\nu-\nu_{\rm HeI})}{\mathrm{eV}},x_e\right)\,h(\nu-\nu_{\rm HeI})\,X_{\rm He}\,n_{\rm HeI}\,\sigma_{\rm HeI}(\nu) \\[4pt]
\frac{d\varepsilon_{\rm heat}^{\rm HeII}}{d\nu}
&= \left(\frac{\nu}{\nu_0}\right)^{-\alpha_X-1} f_{\rm heat}\!\left(\tfrac{h(\nu-\nu_{\rm HeII})}{\mathrm{eV}},x_e\right)\,h(\nu-\nu_{\rm HeII})\,X_{\rm He}\,n_{\rm HeII}\,\sigma_{\rm HeII}(\nu)
\end{aligned}
$$

代码里三通道在 `integrand_in_nu_heat_integral` 内逐行累加成一个 `species_sum` 后乘 SED 权返回（即 `species_sum +=` 三步合成一个返回值）。E3 (3) 的高斯积分 `freq_int_heat_tbl = ∫ dν (被积函数)` 积分的就是这个**已经求和后的整体**，输出表 `freq_int_heat_tbl[x_e][R]` 存的是三物种的总加热效率。折叠写法即三通道之和:

$$
\frac{d\varepsilon_{\rm heat}}{d\nu} = \frac{d\varepsilon_{\rm heat}^{\rm HI}}{d\nu} + \frac{d\varepsilon_{\rm heat}^{\rm HeI}}{d\nu} + \frac{d\varepsilon_{\rm heat}^{\rm HeII}}{d\nu}
$$

上式仅是代码 `species_sum +=` 的显式表达，不对应任何额外计算步骤。三条通道结构相同，但各自有独立的电离边 $\nu_i$、截面 $\sigma_i(\nu)$ 与中性比例（HeII 例外用 $x_e$ 而非 $1-x_e$）。

**Lyα 通道（FLAG=2）**:与上述加热/电离通道同属"X-ray 光电离产生次级电子 → 能量分配"的同一批过程,只是次级电子的能量分配给 **Lyα 光子数** 而非加热或电离。被积函数由 `integrand_in_nu_lya_integral`(L804) 实现,结构与前三条通道完全同构——同样三个物种各一行,只是把能量分配表换成 $n_{\rm Lya}(E,x_e)$(`interp_n_Lya`),且**无 +1**(Lyα 计的是光子数,不是电离次数):

$$
\begin{aligned}
\frac{dN_{\rm Lya}^{\rm HI}}{d\nu}
&= \left(\frac{\nu}{\nu_0}\right)^{-\alpha_X-1} n_{\rm Lya}\!\left(\tfrac{h(\nu-\nu_{\rm HI})}{\mathrm{eV}},x_e\right)\,X_{\rm H}\,(1-x_e)\,\sigma_{\rm HI}(\nu) \\[4pt]
\frac{dN_{\rm Lya}^{\rm HeI}}{d\nu}
&= \left(\frac{\nu}{\nu_0}\right)^{-\alpha_X-1} n_{\rm Lya}\!\left(\tfrac{h(\nu-\nu_{\rm HeI})}{\mathrm{eV}},x_e\right)\,X_{\rm He}\,(1-x_e)\,\sigma_{\rm HeI}(\nu) \\[4pt]
\frac{dN_{\rm Lya}^{\rm HeII}}{d\nu}
&= \left(\frac{\nu}{\nu_0}\right)^{-\alpha_X-1} n_{\rm Lya}\!\left(\tfrac{h(\nu-\nu_{\rm HeII})}{\mathrm{eV}},x_e\right)\,X_{\rm He}\,x_e\,\sigma_{\rm HeII}(\nu)
\end{aligned}
$$

E3 (3) 对其积分得 `freq_int_lya_tbl[x_e][R]`(每单位 X-ray 光度的 Lyα 光子数);运行时尚需额外乘角度平均与红移因子 $c/(4\pi)/\nu_{\rm Ly\alpha}/H(z)$ 才得真实 Lyα 通量。注意 Lyα 通道与加热/电离通道共享同一套三物种、同一 SED 权、同一 $(x_e,R)$ 网格,区别仅在能量分配表( $n_{\rm Lya}$ vs $f_{\rm heat}$ vs $1+n_{\rm ion}$)与最终单位(光子数 vs 能量 vs 电离数)。

逐符号落点:

| 符号                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 代码落点                                      | 含义                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------- |
| $\nu$                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `nu`                                        | 积分变量                                           |
| $\nu_{\rm HI},\nu_{\rm HeI},\nu_{\rm HeII}$                                                                                                                                                                                                                                                                                                                                                                                                                                              | `physconst.nu_ion_HI/HeI/HeII`              | 三物种电离边频率:13.6 / 24.6 / 54.4 eV(各通道独立) |
| $h(\nu-\nu_i)$                                                                                                                                                                                                                                                                                            | `physconst.h_p*(nu-nu_ion_X)`               | 次级电子动能$E=h(\nu-\nu_i)$,各通道因 $\nu_i$ 不同而不同(除以 `eV_to_Hz` 转 eV)                                        |                                               |                                                    |
| $f_{\rm heat}(E,x_e)$                                                                                                                                                           | `interp_fheat`                              | S&S85 加热份额,$E=h(\nu-\nu_i)$ 随 $\nu$ 变 → **留在积分内**                                                                                                                                                                                |                                               |                                                    |
| $X_{\rm H},X_{\rm He}$                                                                                                                                                                                                                                                                                    | `H_FRAC`=0.76、`HE_FRAC`=0.24             | 质量丰度(HI/HeI 用$X_{\rm H}$;HeII 用 $X_{\rm He}$)                                                                      |                                               |                                                    |
| $n_{\rm HI},n_{\rm HeI},n_{\rm HeII}$                                                                                                                                                                                                                                                                        | HI/HeI:`(1-x_e)`;HeII:`x_e`               | 各物种可被电离的比例:$n_{\rm HI}=n_{\rm HeI}=1-x_e$(中性部分);$n_{\rm HeII}=x_e$(HeII 为电离产物,存量随 $x_e$ 增大) |                                               |                                                    |
| $\sigma_{\rm HI}(\nu),\sigma_{\rm HeI}(\nu),\sigma_{\rm HeII}(\nu)$                                                                                                                                                                                                                                                                                                                                                                                                                      | `HI_ion_crosssec` 等                        | 三物种光电离截面(Verner+96),各通道独立             |
| $\alpha_X,\nu_0$                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `X_RAY_SPEC_INDEX`,`NU_X_THRESH*eV_to_Hz` | SED 指数、归一频率(500 eV)                         |
| $x_e$                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `params` 传入                               | 当地电子分数,积分中为常数                          |

**(2) FLAG 与三张表**:同一频率积分结构,FLAG 选能量分配插值表与输出表:

| FLAG   | 插值表(S&S85)                   | 输出表                        | 物理量                                         |
| ------ | ------------------------------- | ----------------------------- | ---------------------------------------------- |
| 0 加热 | `interp_fheat`                | `freq_int_heat_tbl[x_e][R]` | 沉积能量                                       |
| 1 电离 | `interp_nion_*`(三表求和 + 1) | `freq_int_ion_tbl[x_e][R]`  | 净电离数                                       |
| 2 Lyα | `interp_n_Lya`                | `freq_int_lya_tbl[x_e][R]`  | Lyα 光子数(三物种同构,无 +1;见 (1) Lyα 通道) |

**插值表输入**:S&S85 表以 $(E/\mathrm{eV},\,x_e)$ 双参数查(`elec_interp.c`),其中 $E=h(\nu-\nu_i)$ 是次级电子动能、$x_e$ 是当地电离分数。每个物种、每种物理量各一张表:

- 加热: $f_{\rm heat}(E,x_e)$(一张)
- 电离: $n_{\rm ion}^{\rm HI}(E,x_e)$、$n_{\rm ion}^{\rm HeI}(E,x_e)$、$n_{\rm ion}^{\rm HeII}(E,x_e)$(三张,即 `interp_nion_*`)
- Lyα: $n_{\rm Lya}(E,x_e)$(一张)

**"三表 + 1"的含义(电离 FLAG)**:次级电子在三个物种上各自打出电离数,三者相加后再加 **1**——这 +1 是光子自身的**初级光电离**(每发生一次光电离事件本身就贡献 1 次电离,不来自 S&S85 表):

$$
n_{\rm ion}^{\rm sec}(E,x_e) = n_{\rm ion}^{\rm HI}(E,x_e) + n_{\rm ion}^{\rm HeI}(E,x_e) + n_{\rm ion}^{\rm HeII}(E,x_e)
$$

$$
\boxed{\text{单次光电离总电离数} = 1 + n_{\rm ion}^{\rm sec}(E,x_e)}
$$

对应代码 `interp_nion_*(三表求和) + 1`。

**从插值表到输出表的完整链条**(以电离为例):

$$
\mathrm{freq\_int\_ion\_tbl}[x_e][R]
= \int_{\nu_{\rm lo}}^{\nu_{\max}}\! d\nu\,
\underbrace{\left(\frac{\nu}{\nu_0}\right)^{-\alpha_X-1}}_{\text{SED 权}}
\underbrace{\sum_{i={\rm HI,HeI,HeII}} \big[1 + n_{\rm ion}^{(i)}(E,x_e)\big]\,h(\nu-\nu_i)\,X_i\,(1-x_e^{(i)})\,\sigma_i(\nu)}_{\text{三物种通道,各含 }(+1)}
$$

其中 $E=h(\nu-\nu_i)$,方括号里的 $1+n_{\rm ion}^{(i)}$ 就是"初级光电离(+1) + 次级电离($n_{\rm ion}$ 表)"在每个物种通道内的体现。积分把 $\nu$ 积掉,对 $(x_e,R)$ 存成输出表。加热/Lyα 通道同理,只是把 $1+n_{\rm ion}^{(i)}$ 换成 $f_{\rm heat}^{(i)}$ / $n_{\rm Lya}^{(i)}$(无 +1)。

**(3) 高斯积分**:

$$
\mathrm{freq\_int\_heat\_tbl}[x_e][R] = \int_{\nu_{\rm lo}}^{\nu_{\max}}\! \frac{d\varepsilon_{\rm heat}}{d\nu}\,d\nu,\qquad \nu_{\rm lo}=\max(\nu_{\tau=1},\,\nu_0),\ \nu_{\max}=\texttt{NU\_X\_MAX}
$$

(`integrate_over_nu` 对每个 $(x_e,R)$ 调 `gsl_integration_qag`;$\nu_{\tau=1}$ 见 E4。)

**(4) 积分内外量分解**:唯一积分变量是 $\nu$。

- **积分内**(随 $\nu$):$f_{\rm heat}(E(\nu),x_e)$、$h(\nu-\nu_i)$、$\sigma_i(\nu)$、$(\nu/\nu_0)^{-\alpha_X-1}$。
- **提出积分外**(常数):$x_e$、$X_i$、$1-x_e^{(i)}$、$A/(h\nu_0)$。

积分后残留变量即 $(x_e,R)$ —— 输出表以此两轴建表。

**(5) 与 `xray_prefactor` 衔接**:输出表存的是"每单位 $A/(h\nu_0)$ 的沉积",运行时由 E5 预因子补绝对大小与红移演化。两项不在积分内、不依赖 $(x_e,R)$,作全局标量提出:

- $c$:源发射率(per cm³)→ 到达通量(per cm²)的面积换算。
- $(1+z_p)^{\alpha_X+3}$:红移缩放三次 $(1+z)$(光子数密度、频率区间拉伸、共动 SFR 匹配)叠加谱形 $+\alpha_X$ 次,取发射红移 $z_p$。

**Lyα 特例**:FLAG=2 额外乘 $c/(4\pi)/\nu_{\mathrm{Ly\alpha}}/H(z)$。

## E4:环形滤波与光学深度(`nu_tau_one`)

对应物理编[P4](XRAY_physics_manual.md#p4x-ray-传播光学深度与自吸收)两段:沿途吸收(`nu_tau_one`)+ 空间传播(环形滤波)。

**(1) 沿途吸收:光学深度与自吸收下限**(`nu_tau_one`,heating_helper_progs.c L1162)

光学深度沿视线,对三物种的吸收概率求和(氦未被忽略,只是折进综合截面):

$$
\tau_X(\nu)=\int_0^R n(r)\,\bar\sigma_X(\nu)\,dr,\qquad \bar\sigma_X(\nu)=\sum_{i={\rm HI,HeI,HeII}} X_i\,n_i\,\sigma_i(\nu)
$$

其中 $n(r)$ 为总重子数密度,各物种可被电离的比例为 $n_{\rm HI}=1-x_e$、$n_{\rm HeI}=1-x_e$、$n_{\rm HeII}=x_e$(HeII 为电离产物)。综合截面 $\bar\sigma_X$ 即 `species_weighted_x_ray_cross_section`(P3 谱平均版),氦的三项已含在内;提公因子 $n$ 后写作 $n\,\bar\sigma_X$ 与代码 `n * sigma_tilde` 一致。

**自吸收下限 $\nu_{\tau=1}$ 是什么**:一个 X-ray 光子从源出发向目标点传播,沿途被 IGM 吸收,光学深度 $\tau_X(\nu)$ 随频率升高而下降(高频截面小、穿透远)。$\nu_{\tau=1}$ 就是**使得沿途光学深度恰好等于 1 的那个频率**——低于它的软光子在到达目标点前就已被吸收殆尽,对目标点的加热/电离没有贡献;只有高于 $\nu_{\tau=1}$ 的光子能"漏"到目标点。因此它叫"自吸收下限":是有效光子能穿透的**最低频率门槛**。

求法:解 $\tau_X(\nu)=1$ 的根(`nu_tau_one`,Brent 法,区间 $[\nu_{\mathrm{ion,HeI}},10^6\,\mathrm{eV}]$,相对误差 2%):

$$
\tau_X(\nu_{\tau=1})=1
$$

为什么用作积分下限:下一节 E3 的频率积分只需积"能到达目标点的光子",所以积分下限取 $\max(\nu_{\tau=1},\,\nu_0)$(后者来自 `NU_X_THRESH` 的星系自屏蔽,见 E5)。$\nu_{\tau=1}$ 正是这条下限的物理来源——它把"源到目标点的沿途吸收"压成了一个频率截断。

两个特例:

- 完全电离 $x_e>0.9999$(无中性氢可吸收)→ 直接返回 $\nu_{\mathrm{thresh}}$,积分从星系自屏蔽阈值开始;
- 若 $\tau_X(\nu_{\mathrm{ion,HeI}})<1$(即使最低电离边处都处处透明)→ 返回 $\nu_{\mathrm{ion,HeI}}$,积分可从 HeI 边开始。

中性物质(氢与氦)只存在于再电离泡之外,由填充因子统一压减(泡内 $x_e\approx1$ 时氢氦一同被排除):

$$
f_{\rm HI}^{\rm fill}=\max\!\left(1-\frac{\zeta_{\rm ion}f_{\rm coll}}{1-x_{e,\rm ave}},\,10^{-4}\right)
$$

频率映射 `nu_cross = nu_0·(1+z_hat)` 即 $\nu_0(1+\tilde z)$。

**(2) 空间传播:环形滤波(壳层卷积)**

视线积分的完整解需三维辐射转移;21cmFAST 假设源场各向同性统计、仅依赖到源距离 $R$,分解为球壳层(`N_PROF_GRID` 层)。目标点处的场 = 各壳层源 × 层效率的卷积:

$$
\Phi(\mathbf{x}) = \sum_{R_{ct}} \rho_{\rm src}(R_{ct})\, w(R_{ct},\,|\mathbf{x}|)
$$

其中 $w$ 为壳层权重(含 $\nu_{\tau=1}$ 截断的效率,由 E3 输出表给出)。对三维场做 FFT、逐层乘 $w$、IFFT 反演:

```c
one_annular_filter(fourier_SFR_box, fourier_xray_box, mask, box_ct, ...);  // 每层 FFT 环形滤波
```

代价:直接求和 $O(N^6)$;FFT 环形滤波 $O(N^3\log N)$。

**两层近似小结**:

| 近似     | 物理             | 代码                      | 频率       |
| -------- | ---------------- | ------------------------- | ---------- |
| 视线积分 | 频率依赖沿途吸收 | `tauX` + `nu_tau_one` | 每红移一次 |
| 壳层滤波 | 三维空间传播     | 环形滤波(FFT)             | 每红移一次 |

合并图像:X-ray 从源出发,沿途红移衰减、低能部分被吸收,到达目标点频率 $\nu$ 的加热效率由 E3 输出表按 $(x_e,R)$ 查得。

## E5:源场构建与 `xray_prefactor`

**这一步干的事**：前面 E3 算出了"每单位 X-ray 光度能沉积多少加热/电离/Lyα"（输出表），E4 管"从源到目标点怎么传"。E5 是把**真实的源强度**和**绝对大小**补上，得到每个网格点实际感受的加热率。函数 `UpdateXraySourceBox`（`SpinTemperatureBox.c`）按六步走：

1. **拿源场**：从 HaloBox 取 `halo_sfr_box`（恒星形成率场）、`halo_xray_box`（X-ray 光度场）。
2. **算红移因子**：`z_edge_factor` 把每个格点的 SFR 折算成"本红移步内实际发射的光子数"。
3. **算 X-ray 光度 `xray_sfr`**：对每个壳层、每个网格点，把恒星形成率换成 X-ray 光度。两种模式做法不同、结果同一量：

   - **Eulerian**（SOURCE_MODEL 0/1）：`xray_sfr = sfr_term * L_X * xray_R_factor * s_per_yr`。`L_X` 是"SFR → X-ray 光度"的换算系数（每单位 SFR 出多少 X-ray），`xray_R_factor = (1+z)^(-α_X)` 是红移软硬度修正，`s_per_yr` 把年换成秒。
   - **Lagrangian**（SOURCE_MODEL 2/3/4）：HaloBox 阶段已直接给出 X-ray 源场 `filtered_xray[R_ct]`，这里直接取用（含 s→yr 与 mini 晕贡献），不再乘 `L_X`。

   **第 3 步公式**（先定义符号）：

   $$
   z_{\rm edge} \equiv \frac{|\Delta z_p|\,(dt/dz)\,h(z_{\rm pp})}{t_\star}\ \text{（或 SM=0 时 }z_{\rm edge}=\Delta z_p\text{）},\qquad
   r_z \equiv (1+z_{\rm pp})^{-\alpha_X},\qquad
   c_{\rm yr}\equiv \text{s}\cdot\text{yr}^{-1}
   $$

   $z_{\rm edge}$ 把红移步长 $\Delta z_p$ 折成该步内实际发射的恒星质量率（含哈勃时间 $t_\star$ 归一）；$r_z$ 是 X-ray 谱形随发射红移的演化；$c_{\rm yr}$ 仅做年→秒单位换算。

   Eulerian（SOURCE_MODEL 0/1）：

   $$
   \mathrm{xray\_sfr} = \dot M_\star\, L_X\, r_z\, c_{\rm yr},\qquad \dot M_\star = f_{\rm coll}\, z_{\rm edge}\, f_{\star,10}
   $$

   $\dot M_\star$ 是把"坍缩分数 $f_{\rm coll}$ 经红移因子 $z_{\rm edge}$ 折成恒星质量率"；再乘 $L_X$ 即把恒星质量率换成 X-ray 光度，$r_z$ 是谱形随红移的演化，$c_{\rm yr}$ 把年换算成秒。

   Lagrangian（SOURCE_MODEL 2/3/4）：

   $$
   \mathrm{xray\_sfr} = \dot S_{\rm X,src}\, z_{\rm edge}\, r_z\, c_{\rm cgs}
   $$

   源场 $\dot S_{\rm X,src}$ 已在 HaloBox 阶段把 $L_X$、mini 晕折算进去，故此处只补 $z_{\rm edge}$、$r_z$ 与 CGS 常数 $c_{\rm cgs}$。两式本质相同：都是"恒星/X-ray 源强度 × 红移演化"。

   开 `USE_MINI_HALOS` 时两种模式均加 mini 晕项（参数换 $L_{X,\rm mini},\,f_{\star,7}$）：

   $$
   \mathrm{xray\_sfr} \mathrel{+}= \dot M_{\star,\rm mini}\, L_{X,\rm mini}\, r_z\, c_{\rm yr}
   $$

   即把小质量晕（MCG）的 X-ray 贡献按同一结构叠加到 ACG 项上。
4. **逐壳层传播**（E4）：第 3 步的 X-ray 光度经 E4 的环形滤波，得到每个距离壳层 `R_ct` 上到达目标点的强度。
5. **查表得沉积率**：`dxheat_dt_box += xray_sfr * (freq_int_heat_tbl 插值)`（代码行 1704–1706），同理得电离率、Lyα 率。即"X-ray 光度 × E3 输出表"。
6. **乘预因子进 E2**：`dxheat_dt = dxheat_dt_box × xray_prefactor × volunit_inv`，送进 E2 的 Tk/Ts 演化。

三个真正能调的自由参数（`L_X` 强度、`X_RAY_SPEC_INDEX` 软硬、`NU_X_THRESH` 自吸收下限）控制的就是第 3、5、6 步。

**`xray_prefactor` 是什么**

它是个全局标量（不依赖空间位置，算一次全员共用），作用是把"波段总光度"换算成"实际能沉积的能量率"。公式：

$$
\mathrm{xray\_prefactor} = \frac{A}{h_p\,\nu_0}\cdot c\cdot(1+z_p)^{\alpha_X+3}
$$

三个因子各管一件事：

| 因子                                                                                                                                                                                       | 管什么                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| $A/(h\nu_0)$           | 把总光度$L_X$ 归一成"参考频率 $\nu_0$ 处的光子数谱"（代码 `luminosity_converstion_factor / (NU_X_THRESH·eV_to_Hz)`，变量名拼错成 `converstion`）       |                                                             |
| $c$                                                                                                                                                                                      | 单位换算：源的"发射率（每体积）"→ 到达点的"通量（每面积）" |
| $(1+z_p)^{\alpha_X+3}$ | 红移演化：频率红移、源区间拉伸、共动体积匹配各贡献一个$(1+z)$，再加谱形自身的 $+\alpha_X$ 次，合计 $\alpha_X+3$（代码 `(1+zp)^(X_RAY_SPEC_INDEX+3.0)`） |                                                             |

它与 E3 的衔接：E3 的积分存的是"每单位 $A/(h\nu_0)$ 的沉积"，运行时由这个预因子补上绝对大小和红移演化。

**完整公式**（E3 输出表 × 源强度 × 预因子）：

$$
\frac{d\varepsilon_{\rm heat}}{dt}\bigg|_{\rm grid}
= \mathtt{filtered\_xray}[R]\times
\left[\int_{\nu_{\rm lo}}^{\nu_{\max}}\!\! d\nu\,\left(\frac{\nu}{\nu_0}\right)^{-\alpha_X-1}\!\sum_i f_{\rm heat}(E(\nu),x_e)\,h(\nu\!-\!\nu_i)\,X_i(1\!-\!x_e^{(i)})\sigma_i(\nu)\right]
\times c\,(1+z_p)^{\alpha_X+3}
$$

方括号就是 E3 存进 `freq_int_heat_tbl[x_e][R]` 的积分；乘 `filtered_xray[R]`（含 `L_X` 的源强度）和上面的 `xray_prefactor` 即得每个网格点的加热率。

---

## 参数表

### 全局参数

| 参数                  | 默认              | 含义                                                                                                                                  | 归属        |
| --------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `SIGMA_8`           | 0.8102            | RMS 质量方差(功率谱归一);项目模板`planck2020.toml` 用 0.82                                                                          | CosmoParams |
| `hlittle`           | 0.6766            | 哈勃常数 h = H0/100;planck2020 模板用 0.68                                                                                            | CosmoParams |
| `OMm`               | 0.3097            | **无量纲**物质密度 Ω_m(注意不是 Ω_m h²);planck2020 用 0.31                                                                   | CosmoParams |
| `OMb`               | 0.0493            | **无量纲**重子密度 Ω_b(注意不是 Ω_b h²);planck2020 用 0.049                                                                  | CosmoParams |
| `POWER_INDEX`       | 0.9665            | 原初标量谱指数 n_s                                                                                                                    | CosmoParams |
| `X_RAY_SPEC_INDEX`  | 1.0               | X-ray 能量谱指数$\alpha_X$,$L_\nu\propto\nu^{-\alpha_X}$;越小越硬、越大越软                                                       | AstroParams |
| `L_X`               | 40.5              | 每单位 SFR 的 X-ray 光度$\log_{10}L_X^{\rm norm}$(erg/s per M☉/yr),定义波段 $[\mathrm{NU\_X\_THRESH},\mathrm{NU\_X\_BAND\_MAX}]$ | AstroParams |
| `L_X_MINI`          | =`L_X`          | 微晕(minihalo)的 X-ray 光度–SFR 缩放;不提供时沿用`L_X`                                                                             | AstroParams |
| `NU_X_THRESH`       | 500 eV            | 宿主星系内 X-ray 自吸收阈值;低于它的软 X-ray 在源内部被吸收,不进入 IGM                                                                | AstroParams |
| `NU_X_BAND_MAX`     | 2000 eV           | `L_X` 定义波段上限(0.5–2 keV)                                                                                                      | AstroParams |
| `NU_X_MAX`          | 10000 eV          | E3 频率积分上限;>10 keV 光子对加热贡献 <1%,忽略                                                                                       | AstroParams |
| `X_RAY_Tvir_MIN`    | =`ION_Tvir_MIN` | 产 X-ray 晕的最低维里温度(log10 K)                                                                                                    | AstroParams |
| `USE_X_RAY_HEATING` | True              | 是否开启 X-ray 加热                                                                                                                   | AstroParams |
| `F_STAR10`          | -1.3              | log10 恒星形成效率(归一在 10^10 M☉)                                                                                                  | AstroParams |
| `ALPHA_STAR`        | 0.5               | 恒星形成效率–晕质量斜率                                                                                                              | AstroParams |
| `F_ESC10`           | -1.0              | log10 电离光子逃逸分数(10^10 M☉ 处)                                                                                                  | AstroParams |
| `M_TURN`            | 8.7               | 恒星形成晕的质量阈值(log10 M☉)                                                                                                       | AstroParams |
| `ION_Tvir_MIN`      | 4.699             | 恒星形成晕的最低维里温度(log10 K ≈ 5×10^4 K)                                                                                        | AstroParams |
| `POP2_ION`          | 5000              | Pop II 恒星每个重子产生的电离光子数                                                                                                   | AstroParams |
| `POP3_ION`          | 44021             | Pop III 恒星每个重子产生的电离光子数                                                                                                  | AstroParams |
| `CLUMPING_FACTOR`   | 2.0               | 亚网格团簇因子(仅用于 X-ray 部分电离)                                                                                                 | AstroParams |
| `t_STAR`            | 0.5               | 恒星形成特征时间尺度(哈勃时间分数)                                                                                                    | AstroParams |

### 内部常数(代码硬编码,不可调)

| 常数                     | 值              | 含义                                                               |
| ------------------------ | --------------- | ------------------------------------------------------------------ |
| `NU_X_THRESH`          | 500 eV          | 宿主星系自吸收阈值(与参数同名同值)                                 |
| `NU_X_BAND_MAX`        | 2000 eV         | **光度归一化**积分上限(0.5–2 keV 波段;`L_X` 定义于此波段) |
| `NU_X_MAX`             | 10000 eV        | **加热/电离频率积分**上限:>10 keV 的光子忽略(对加热贡献 <1%) |
| `A10`                  | 2.85e-15 s⁻¹  | 21cm 自发辐射系数                                                  |
| `ν21`                 | 1420.4 MHz      | 21cm 线频率                                                        |
| `T*`                   | 0.068 K         | hν21/kB                                                           |
| `f_osc`(Lyα)          | 0.4162          | Lyα 振子强度                                                      |
| `eV_to_Hz`             | 2.418e14 Hz/eV  | 能量→频率换算                                                     |
| `H_FRAC` / `HE_FRAC` | 0.76 / 0.24     | 氢/氦质量分数                                                      |
| `c`                    | 2.998e10 cm/s   | 光速                                                               |
| `k_B`                  | 1.38e-16 erg/K  | 玻尔兹曼常数                                                       |
| `h_p`                  | 6.63e-27 erg·s | 普朗克常数                                                         |

**为什么 `NU_X_THRESH` 与 `NU_X_MAX` 同时存在**:下限是"源内部屏蔽"(低于阈值的光子根本出不了源),上限是"贡献忽略"(>10 keV 的光子截面太小,对 IGM 加热/电离贡献可忽略)。积分区间 $[\max(\nu_{\tau=1},\nu_{\mathrm{thresh}}), \nu_{\max}]$ 就是 E3 的频率积分范围。

---

## 附录 A:完整数据流图

```text
                        ┌────────────────────────────────────────────┐
                        │      L5 源场 (HaloBox + 参数)               │
                        │  M → SFR → L_X(SFR) → SED(α_X, ν0)         │
                        │  → xray_prefactor(z) → 源发射率场          │
                        └──────────────────┬─────────────────────────┘
                                           │ 源发射率场
                                           ▼
                        ┌────────────────────────────────────────────┐
                        │      L4 传播                                │
                        │  tauX: 沿途吸收 → nu_tau_one (积分下限)    │
                        │  环形滤波: 壳层卷积 (FFT)                  │
                        └───────┬──────────────────┬─────────────────┘
                                │ nu_tau_one(下限)  │ 滤波后的源场
                                ▼                  ▼
                        ┌────────────────────────────────────────────┐
                        │      L3 频率积分 (查表)                     │
                        │  ∫_{ν_tau1}^{ν_max} f_heat·h(ν-ν_i)·       │
                        │    X_i(1-x_e)·σ_i·ν^{-α-1} dν              │
                        │  → freq_int_{heat,ion,lya}_tbl[x_e][R]     │
                        └──────────────┬─────────────────────────────┘
                                       │  × 滤波源场 × xray_prefactor
                                       ▼
                        ┌────────────────────────────────────────────┐
                        │      L2 演化 (get_Ts_fast)                 │
                        │  dxheat_dzp → dTk/dz (加热项)              │
                        │  dxion_dzp  → dxe/dz (电离项)              │
                        │  dxlya_dzp  → x_α (Lyα 耦合)               │
                        │  Tk, xe 推进一步 → 1/Ts 加权 → Ts          │
                        └──────────────┬─────────────────────────────┘
                                       ▼
                        ┌────────────────────────────────────────────┐
                        │      L1 亮温 (BrightnessTemperatureBox)    │
                        │  δT21 = 27·x_HI·(1+δ)·√((1+z)/10)          │
                        │         × (Ts - T_CMB)/Ts  mK              │
                        └────────────────────────────────────────────┘
```

**时间方向**:E2 的 $T_k$、$x_e$ 随红移推进(从高红移往低红移),E3–E5 在每个 z 重新计算(表 + 滤波),E1 合成最终观测信号。数据流图中 L1–L5 即物理编[P1](XRAY_physics_manual.md#p121cm-亮温公式x-ray-作用的终点)–[P5](XRAY_physics_manual.md#p5x-ray-源场从光晕到发射率)与工程编[E1](#e1亮温合成与-x-ray-在链上的位置)–[E5](#e5源场构建与-xray_prefactor)的对应层。

---

## 附录 B:关键代码索引

### B1:按文件

| 文件                           | 内容                                                                                                                                                                                                                               | 本章节      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `SpinTemperatureBox.c`       | `get_Ts_fast`(Ts/Tk 演化)、`UpdateXraySourceBox`(滤波)、`fill_freqint_tables`(插值表)、`set_radiative_transfer_consts`(xray_prefactor)、`nu_tau_one` 调用                                                                | E2/E3/E4/E5 |
| `heating_helper_progs.c`     | `integrand_in_nu_heat_integral`(加热被积函数)、`integrand_in_nu_ion_integral`、`integrand_in_nu_lya_integral`、`integrate_over_nu`(GSL 积分)、`tauX`(光学深度)、`species_weighted_x_ray_cross_section`、`nu_tau_one` | E3/E4       |
| `elec_interp.c`              | `interp_fheat`、`interp_nion_*`、`interp_n_Lya`(Shull & van Steenberg 1985 插值表)                                                                                                                                           | E3          |
| `IonisationBox.c`            | `determine_ionisation_rates` 中的 X-ray 电离项(与加热共用预因子)                                                                                                                                                                 | E3 链接     |
| `BrightnessTemperatureBox.c` | 亮温合成                                                                                                                                                                                                                           | E1          |
| `HaloBox.c`                  | 源场(SFR、X-ray 光度)                                                                                                                                                                                                              | E5          |
| `filter.c`                   | `one_annular_filter`(环形滤波核心)                                                                                                                                                                                               | E4          |
| `scaling_relations.c`        | `get_lx_on_sfr` 及四个 $L_X$/SFR 标度模型(常数、`lx_on_sfr_doublePL`、Lehmer+2021、Kaur+22)、`get_halo_xray`(对数正态散射)                                                                                                 | E-pre ①    |
| `thermochem.c`               | `HI_ion_crosssec` / `HeII_ion_crosssec`(Osterbrock 解析式)、`HeI_ion_crosssec`(**Verner+96 拟合**)                                                                                                                     | E-pre ③    |
| `elec_interp.c`(补充)        | `initialize_interp_arrays`(读入 `_data/x_int_tables/` 的 14×258 表)                                                                                                                                                           | E-pre ④    |

### B2:按函数

| 函数                                                               | 位置                   | 作用                                                     |
| ------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------- |
| `get_Ts_fast`                                                    | SpinTemperatureBox.c   | 推进 Tk、xe,合成 Ts                                      |
| `set_radiative_transfer_consts`                                  | SpinTemperatureBox.c   | 计算`xray_prefactor`、`volunit_inv` 等红移依赖预因子 |
| `fill_freqint_tables`                                            | SpinTemperatureBox.c   | 填充三张频率积分插值表                                   |
| `UpdateXraySourceBox`                                            | SpinTemperatureBox.c   | 源场 × 环形滤波 →`dxheat_dt_box` 等                  |
| `integrate_over_nu`                                              | heating_helper_progs.c | GSL 高斯积分,FLAG 区分 加热/电离/Lyα                    |
| `tauX`                                                           | heating_helper_progs.c | 光学深度积分                                             |
| `nu_tau_one`                                                     | heating_helper_progs.c | 求光学深度=1 的频率(自吸收下限)                          |
| `interp_fheat` 等                                                | elec_interp.c          | 次级电子能量分配插值                                     |
| `initialize_interp_arrays`                                       | elec_interp.c          | 读入 S&S85 的 14 个电离分数 × 258 能量点数据表          |
| `get_lx_on_sfr`                                                  | scaling_relations.c    | 分发$L_X$/SFR 标度模型(默认常数)                       |
| `HI_ion_crosssec` / `HeI_ion_crosssec` / `HeII_ion_crosssec` | thermochem.c           | 光电离截面(HeI 为 Verner+96 拟合)                        |
| `spectral_emissivity`                                            | heating_helper_progs.c | Pop2/Pop3 恒星光谱分段幂律拟合                           |
| `one_annular_filter`                                             | filter.c               | FFT 环形滤波                                             |

---

## 附录 C:调试速查

### 常见问题与排查

| 现象                 | 可能原因                                                            | 排查位置                    |
| -------------------- | ------------------------------------------------------------------- | --------------------------- |
| 21cm 信号无吸收谷    | X-ray 加热过强(Tk 过早高于 CMB)→ 检查`L_X`、`X_RAY_SPEC_INDEX` | E2 的 dxheat_dzp            |
| 吸收谷太深/太久      | X-ray 加热过弱或谱太硬                                              | E3 插值表、E4 的 nu_tau_one |
| 加热 vs 电离比例异常 | `X_RAY_SPEC_INDEX` 偏软(低能多→电离多)或偏硬                     | E3 被积函数                 |
| Lyα 耦合异常        | `dxlya_dt_box` 相关,检查 WF 耦合是否饱和                          | E2 的 x_α                  |
| 运行极慢             | 频率积分表未缓存 → 检查`fill_freqint_tables` 调用次数            | L3 工程节                   |

### 快速验证数值(辅食级 sanity check)

- 默认宇宙学 + 默认源模型,$z=10$ 处 $\tau_{21}\sim 0.03$,$\delta T_{21}\sim -150$ mK(吸收谷深度量级)
- 默认 `L_X=40.5` 时,$z_h$(吸收转发射红移)约 15–20;$L_X$ 每提高 1 dex,$z_h$ 升高约 2–3
- $f_{\mathrm{heat}}$:中性介质($x_e\to0$)约 0.15–0.3;完全电离($x_e\to1$)→1

---

## 参考文献

1. **Pritchard, J. R., & Loeb, A. 2012**, *Rep. Prog. Phys.* 75, 086901, "21-cm cosmology in the 21st century" —— 本手册物理主线
2. **Shull, J. M., & van Steenberg, M. E. 1985**, *ApJ* 298, 599 —— 次级电子能量分配(加热/电离/Lyα 份额)
3. **Furlanetto, S. R., Peng Oh, S., & Briggs, F. H. 2006**, *Phys. Rep.* 433, 181, "Cosmology at low frequencies: The 21 cm transition and the high-redshift Universe" —— 亮温/光学深度推导经典综述
4. **Verner, D. A., et al. 1996**, *ApJ* 465, 487 —— 光电离截面拟合
5. **Sreetharan, ... (SRE 2010)** / **Furlanetto et al. 2006** 中关于 $L_X$–SFR 关系的讨论 —— L5 源模型依据
6. **Mesinger, A., Furlanetto, S., & Cen, R. 2011**, *MNRAS* 411, 955 —— 21cmFAST 原始论文(算法与近似)
7. **Park, J., et al. 2019**, *ApJ* 887, 147 —— 21cmFAST v3 的 TsBox 实现(含 X-ray 加热细节)

---
