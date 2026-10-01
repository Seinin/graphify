# 21cmFAST ACG/MCG

---

## 1. 概览

21cmFAST 的核心任务是：给定密度场，计算每个位置的 **电离光子产率**。

暗物质晕按气体冷却能力分两类：

- **ACG（Atomic Cooling Galaxies）**：$M > M_{\rm acg}$，Lyα 原子冷却打开，形成 Pop II 恒星
- **MCG（Molecular Cooling Galaxies）**：$M < M_{\rm acg}$，仅靠微量 $\rm H_2$ 分子冷却，形成 Pop III 恒星

二者有独立的 $f_\star, f_{\rm esc}, N_\gamma/M_\star$，但共用同一套积分/采样框架。

---

## 2. 核心公式

整个体系围绕下面公式展开。电离光子总产率 = 将所有质量区间内晕的贡献积起来：

$$
\boxed{N_{\rm ion} = \int_{\ln M_{\rm min}}^{\ln M_{\rm max}} \underbrace{\frac{dn}{d\ln M}}_{\rm HMF} \;\cdot\; \underbrace{M \cdot f_\star(M) \cdot f_{\rm esc}(M) \cdot N_{\gamma/\rm baryon} \cdot \frac{\Omega_b}{\Omega_m}}_{\text{单晕产额}} \; d\ln M}
$$

被积函数的形状由幂律 $\times$ 指数截断控制：

$$
\frac{dN_{\rm ion}}{d\ln M} \;\propto\; f_\star(M) \cdot f_{\rm esc}(M) \cdot M \cdot e^{-M_{\rm turn}/M}
$$

其中：

- **$dn/d\ln M$**（质量函数）— 宇宙学决定每个质量区间有多少晕，§3 给出两种计算方式
- **$f_\star(M), f_{\rm esc}(M)$**（标度关系）— 天体物理决定每个晕产出多少光子，§5 给出具体形式
- **$e^{-M_{\rm turn}/M}$**（低质量指数截断）— 反馈物理决定小晕被抑制多少，$M_{\rm turn}$ 的取值见 §4
- MCG 多一个 $e^{-M/M_{\rm acg}}$ 高质量端截断，以及 LW 反馈对 $M_{\rm turn}$ 的修正（§4.3）

**结构**：§3 解决"用积分还是用抽样来算"；§4 确定积分边界 $[M_{\rm min}, M_{\rm max}]$；§5 确定 $f_\star(M), f_{\rm esc}(M)$ 的函数形状；§6 把前面各部件组装成可调用的被积函数，送入 GSL 引擎；§7 解释参数如何从 Python 传入 C 结构体；§8 讲离散抽样这条路径；§9 给出一个时步的完整调用链。

### 2.1 ζ 的三种处理方式

把上式"单晕产额"中除 HMF 外的天体物理因子合并为单个电离效率：

$$
\zeta(M) \;\equiv\; \frac{\Omega_b}{\Omega_m} \cdot f_\star(M) \cdot f_{\rm esc}(M) \cdot N_{\gamma/\rm baryon}
$$

$\zeta$ 的物理含义是"每单位重子物质最终贡献出多少可逃逸的电离光子"。代码中用 `SOURCE_MODEL` 在三种处理方式间切换：

| `SOURCE_MODEL`                                              | 名称                  | ζ 的形态                                                                                                                                                                                                                                                              | 核心逻辑                                                        |
| ------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `"CONST-ION-EFF"`（0）                                      | 常量电离效率          | $\zeta = {\rm HII\_EFF\_FACTOR}$（常数，默认 30）                                                                                                                                                                                                                    | 单参数吸收模型：无质量依赖、无 mini-halos                       |
| `"E-INTEGRAL"`（1）                                         | Eulerian 全局均值归一 | $\zeta(M) = \zeta_{10} \cdot \tilde{f}_\star(M)\, \tilde{f}_{\rm esc}(M)$，其中 $\zeta_{10} = 10^{F\_STAR10} \cdot 10^{F\_ESC10} \cdot {\rm POP2\_ION} \cdot \frac{\Omega_b}{\Omega_m}$ | 形状随$M$ 变化；整体归一固定为 $10^{10}\,M_\odot$ 基准晕的全局平均值 |                                                                 |
| `"L-INTEGRAL"` / `"DEXM-ESF"` / `"CHMF-SAMPLER"`（≥2） | Lagrangian 逐晕       | 每个晕单独：$M \cdot f_\star(M) \cdot f_{\rm esc}(M) \cdot N_{\gamma/\rm baryon} \cdot \frac{\Omega_b}{\Omega_m}$                                                                                                                                                    | 源网格离散化为晕样本，逐晕计算，保留 Poisson 散粒噪声（见 §8） |

**方式 1（常量，`SOURCE_MODEL=0`）的逻辑**：Mesinger+2011 的原始单参数模型。$f_\star$、$f_{\rm esc}$、$N_{\gamma/\rm baryon}$ 的全部信息被吸收进一个常数 $\zeta = {\rm HII\_EFF\_FACTOR}$，与晕质量、红移均无关。于是 $\zeta$ 可以提出积分号，电离判据退化为 $N_{\rm ion} = \zeta \cdot f_{\rm coll}$（条件版为 $\zeta \cdot f_{\rm coll}(\delta, R)$）。代码中：`IonisationBox.c` 置 `ion_eff_factor_gl = HII_EFF_FACTOR`、`ion_eff_factor_mini_gl = 0`；`SpinTemperatureBox.c` 计算全局 $Q_{\rm HI}$ 初值时置 `ION_EFF_FACTOR = HII_EFF_FACTOR`，并注释 *"no mini-halos when SOURCE_MODEL=0"*。即方式 1 下 mini-halos 一律关闭，`mass_dep_zeta = (SOURCE_MODEL > 0)` 为假，$f_\star(M)$ 不随质量变化。

**方式 2（全局均值归一，`SOURCE_MODEL=1`）的逻辑**：Park+2019 的质量依赖参数化。三个自由参数取 $10^{10}\,M_\odot$ 晕处的基准值：$f_{\star,10}=10^{F\_STAR10}$（`F_STAR10` 默认 $-1.3$，log10 单位）、$f_{{\rm esc},10}=10^{F\_ESC10}$（默认 $-1.0$）、$N_{\gamma/\rm baryon}={\rm POP2\_ION}$。"全局均值归一"体现在两步：

1. **形状部分**：`scaling_relations.c` 输出相对标度 $f_{\rm rel}(M)$——幂律/双幂律形状，在基准质量 $M_{\rm piv}=10^{10}\,M_\odot$ 处归一为 1（§5）。Path A 的 GSL 积分对 $f_{\rm rel}(M)$ 逐质量积分（§6.1）；
2. **整体归一部分**：积分结果再乘全局均值因子 ${\rm ION\_EFF\_FACTOR} = F\_STAR10_{\rm lin}\cdot F\_ESC10_{\rm lin}\cdot {\rm POP2\_ION}$。C 端直接相乘（`SpinTemperatureBox.c`、`IonisationBox.c:164`、`heating_helper_progs.c`）；等价于 Python 端 $10^{F\_STAR10}\cdot 10^{F\_ESC10}\cdot {\rm POP2\_ION}$（`global_evolution.py`，那里读到的仍是 log10 原始值）。`F_STAR10`/`F_ESC10` 在 Python 层以 log10 存储，由 `logtransformer`（`inputs.py`）转成线性后才进入 C 结构体。

于是任意质量处 $\zeta(M) = \zeta_{10} \cdot f_{\rm rel}(M)$：在基准质量 $M_{\rm piv}$ 处退化为与方式 1 同构的单一常数 $\zeta_{10}$，其余质量按形状缩放。**全局平均电离历史不再逐点积分**，直接用 $Q_{\rm HI} = 1 - \frac{{\rm ION\_EFF\_FACTOR}\cdot n_{\rm ion} + {\rm ION\_EFF\_FACTOR\_MINI}\cdot n_{\rm ion,mini}}{1-x_e}$（`SpinTemperatureBox.c`），这正是"全局均值归一"一词的来源。若 `USE_MINI_HALOS`，mini-halos 用第二组基准 $F\_STAR7\_MINI \cdot F\_ESC7\_MINI \cdot {\rm POP3\_ION}$。

**方式 3（逐晕，`SOURCE_MODEL≥2`）的逻辑**：见 §8。`lagrangian_source_grids = (SOURCE_MODEL > 1)`（`IonisationBox.c`），源网格按 Lagrangian 方式离散化为晕样本，每个晕独立调用 scaling 关系得 $f_\star(M), f_{\rm esc}(M)$（§8.3）后逐晕累加产额，保留 Poisson 散粒噪声；全局 $Q_{\rm HI}$ 仍用期望值（`EvaluateNionTs`）。

---

## 3. 两条计算路径

核心公式可以用两种策略实现：

|      | Path A（HMF 积分）        | Path B（离散采样）      |
| ---- | ------------------------- | ----------------------- |
| 用途 | 全局均值 + 子格点条件积分 | 大质量晕的 Poisson 抽样 |
| 方法 | GSL 数值积分              | 条件 HMF 逆 CDF 抽样    |
| 优势 | 精确期望值                | 保留 Poisson 散粒噪声   |
| 代价 | 丢失离散涨落              | 每晕一次 scaling 调用   |

**分工逻辑**：大质量晕数量少但每个贡献大 → Path B 保留 Poisson 涨落才准确；小质量晕数量多 → Path A 积分避免逐晕开销。

质量函数分两种：

- **无条件 HMF**：$\sigma(M)$ 取全局平均，计算宇宙平均电离历史
- **条件 HMF**：改用格点密度 $\delta$ 和相应 $\sigma(M|\delta,R)$，计算该格点内的晕分布

---

## 4. 质量阈值

决定哪些质量的晕纳入计算。ACG/MCG 的质量界限不是固定数，而是红移和局部环境的函数。

### 4.1 从维里温度到晕质量

统一转换函数（`cosmology.c:671`）：

$$
M(T_{\rm vir}, z) = \frac{7030.97}{h} \cdot \sqrt{\frac{\Omega_m(z)}{\Omega_{m,0} \cdot \Delta_c(z)}} \cdot \left(\frac{T}{\mu \cdot (1+z)}\right)^{3/2}
$$

### 4.2 ACG：$T=10^4$ K 原子冷却线

$$
M_{\rm acg}(z) = {\rm TtoM}(z, T{=}10^4{\rm K}, \mu{=}0.59)
$$

代码：`thermochem.c:278`。物理：$T>10^4$ K 时 Lyα 冷却打开，恒星形成模式从 Pop III 过渡到 Pop II。

### 4.3 MCG：LW 反馈 + 相对速度

MCG 靠 $\rm H_2$ 冷却，$\rm H_2$ 丰度极易被外部 LW 辐射光解离，同时 DM-重子相对速度 $v_{\rm cb}$ 阻碍气体聚集。$M_{\rm crit}$ 因此是 **红移 + 局部环境** 的函数：

$$
M_{\rm crit}(z, J_{\rm LW}, v_{\rm cb}) = \underbrace{3.314\times10^7 \cdot (1+z)^{-1.5}}_{\text{Fialkov+12 基线}} \times \underbrace{(1 + A_{\rm LW} \cdot J_{\rm LW}^{B_{\rm LW}})}_{\text{LW 抑制}} \times \underbrace{\left(1 + A_{\rm VCB} \cdot \frac{v_{\rm cb}}{\sigma_{\rm vcb}}\right)^{B_{\rm VCB}}}_{\text{VCB 抑制}}
$$

默认 $A_{\rm LW}{=}2.0, B_{\rm LW}{=}0.6, A_{\rm VCB}{=}1.0, B_{\rm VCB}{=}1.8$。代码：`thermochem.c:282`。

**$M_{\rm crit}$ 不是全局常数**——它随 $J_{\rm LW}({\bf x})$ 和 $v_{\rm cb}({\bf x})$ 逐格点变化。这意味着 Low-Mass 星系产生的 LW 辐射会反过来抑制附近其他 minihalo 的形成——这是 21cmFAST 中 LW 反馈闭环的核心机制（§9 给出完整闭环流程）。

### 4.4 积分区间（硬边界）与翻转质量（软截断）

§4.1–4.3 推导的是**物理截断质量**，它们进入被积函数后表现为指数软截断（§6.1）；

**4.4.1 硬边界：GSL 积分上下限**

积分变量为 $\ln M$，区间为 $[\ln M_{\min}^{\rm eff},\ \ln M_{\max}]$。上限是固定常量：

$$
M_{\max} = 10^{16}\,M_\odot \qquad (\texttt{hmf.h:11})
$$

高质量端 HMF 指数下降，$10^{16}\,M_\odot$ 之上贡献可忽略，故写死。

下限 `Mmin = minimum_source_mass(z, xray)` 按优先级三分支：

| 分支                | $M_{\min}$                                                                                                                                          | 触发条件                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| ① mini-halos       | $10^{5}\,M_\odot$（`M_MIN_INTEGRAL`）                                                                                                             | `USE_MINI_HALOS=True`，覆盖其余选项 |
| ② 手动指定         | $M_{\rm TURN}$（默认 $10^{8.7}$）                                                                                                                 | `M_MIN_in_Mass=True`                |
| ③ 默认（维里温度） | $M_{\min}(z) = {\rm TtoM}\!\left(z,\ T_{\rm vir}{=}10^{4.69897}\,{\rm K},\ \mu\right)$，$\mu = 1.22\ (T_{\rm vir}{<}10^4\,{\rm K})$，否则 $0.6$ | 其余情况                              |

得到 $M_{\min}$ 后再乘一个缩放因子（`hmf.c:1250`）：

$$
M_{\min}^{\rm eff} = \frac{M_{\min}}{\rm min\_factor},\qquad
{\rm min\_factor} = \begin{cases} 50, & {\rm SOURCE\_MODEL}>0 \ \wedge\ \neg{\rm USE\_MINI\_HALOS}\\[2pt] 1, & \text{其他} \end{cases}
$$

即方式 2（质量依赖、无 mini-halos）把下限再**下探 50 倍**，其余情况硬切。原因见 4.4.4。

**4.4.2 三个问题**

**(a) 开 mini-halos 时，下限为什么是 $10^5\,M_\odot$？**

$10^5$ 是硬编码常量 `M_MIN_INTEGRAL`（`hmf.h:10`），**不是**由某条温度线算出的物理质量，而是量级上对应"高红移端 $\rm H_2$ 分子冷却所需最低 mini-halo 质量"的数值下限。

$\rm H_2$ 冷却要求 $T_{\rm vir}\gtrsim 400\text{-}600\,{\rm K}$，用 §4.1 的 TtoM 换算（$z{=}20$）：

$$
M(T_{\rm vir}{=}600\,{\rm K},\, z{=}20) = \frac{7030.97}{h}\sqrt{\frac{\Omega_m(z)}{\Omega_{m,0}\,\Delta_c}}\left(\frac{600}{\mu(1{+}z)}\right)^{3/2} \approx 10^5\,M_\odot
$$

同时 §4.3 的 MCG 临界质量基线在最高红移处取最小值：

$$
M_{\rm crit}(z{=}30) \approx 3.3\times10^7 \cdot 31^{-1.5} \approx 2\times10^5\,M_\odot
$$

故 $10^5$ 比 $M_{\rm crit}$ 的最小可能值还低，是**保守下限**：保证 MCG 积分区间 $[10^5,\, M_{\rm acg}]$ 被完整覆盖，再由软截断 $e^{-M_{\rm crit}/M}$（§4.4.3）在区间内压掉 $M<M_{\rm crit}$ 的部分。

注意：开 mini-halos 时 `min_factor=1`（`hmf.c:1252-1253`），即 $10^5$ 是绝对硬切、不再下探。原因有二：① 下限已低于 $M_{\rm crit}$ 的量级，继续下探收益极小；② MCG 被积函数有双重指数 $e^{-M_{\rm crit}/M}\cdot e^{-M/M_{\rm acg}}$（`hmf.c:403`），衰减比 ACG 的单指数更陡，尾部天然可忽略。

**(b) 不开 mini-halos 时，$M_{\rm TURN}$ 为什么默认 8.7？**

$8.7$ 是**自由参数的默认值**（`inputs.py:1308-1313`，log10 单位），不是硬编码常量：

$$
M_{\rm TURN} = 10^{8.7} \approx 5\times10^8\,M_\odot
$$

物理含义：**ACG 星系恒星形成被反馈（SN 爆发、光加热）抑制的特征质量**——$M<M_{\rm TURN}$ 的小晕气体被吹走/加热，无法有效形成恒星。默认值来自高红移（$z\approx6\text{-}10$）UV 光度函数的观测拟合（Park+2019 等）。

它身兼两职：

- **主角色——软截断**：`mturn_a_nofb = M_TURN`（所有质量依赖模式，`scaling_relations.c:80`），即 §4.4.3 表中 $M_{\rm turn,acg}$ 的默认来源；
- **次角色——积分下限**：仅 `M_MIN_in_Mass=True` 时兼作硬边界（本表分支②）。

与 $M_{\rm acg}$、$M_{\rm crit}$ 的根本区别：后两者由温度物理**算出来**（$10^4\,{\rm K}$ 原子冷却线、$J_{\rm LW}$/$v_{\rm cb}$ 反馈），$M_{\rm TURN}$ 是**用户可调的自由参数**。

**(c) 分支②（`M_MIN_in_Mass`）与分支③（默认）的物理对比**

两者描述**同一件物理**——"低于某个尺度的小晕不产星"——只是参数化方式不同：

|              | ②`M_MIN_in_Mass=True`                                                                                       | ③ 默认                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 下限来源     | $M_{\min} = M_{\rm TURN}$（直接指定质量）                                                                    | $M_{\min} = {\rm TtoM}(z,\, T_{\rm vir,min},\, \mu)$（温度→质量）                                                |
| 物理图像     | 已知明确的质量截断（如解析模型标定），不想绕道温度                                                             | 恒星形成要求气体达到最低维里温度$T_{\rm vir,min}=10^{4.69897}\approx5\times10^4\,{\rm K}$（Mesinger+2011 参数化） |
| 红移依赖     | 与$z$ 无关（固定质量）                           | 随$z$ 自适应：同一 $T_{\rm vir}$ 在高红移对应更低质量 |                                                                                                                     |
| $\mu$ 因子 | 无                                                                                                             | $\mu=1.22$（中性 IGM）/ $0.6$（电离 IGM）                                                                       |

分支③的 $\mu$ 选择逻辑（`hmf.c:1263-1264`）：$T_{\rm vir,min}<10^4\,{\rm K}$ 时气体以中性 H 为主（$\mu=1.22$）；$\ge10^4\,{\rm K}$ 时 H 电离（$\mu=0.6$）——电离使同温度下对应质量更低。

两者数值上互相印证：默认参数下分支③在 $z\approx10$ 给出 $M_{\min}\approx {\rm TtoM}(10^{4.69897}\,{\rm K})\approx5\times10^8\,M_\odot$，恰与 $M_{\rm TURN}=10^{8.7}$ 同一量级——说明两种写法表达的是同一条物理截断。历史注释（`hmf.c:1258-1259`）亦指出分支②与③曾因"是否除以 min_factor"不一致而存在已知偏差。

**4.4.3 软截断：翻转质量在区间内的角色**

ACG/MCG 阈值**不是积分端点**，而是被积函数内部的指数因子（`hmf.c:389-404`）：

$$
\frac{{\rm d}N_{\rm ion}^{\rm Pop\,II}}{{\rm d}\ln M} \;\propto\; \exp\!\left(-\frac{M_{\rm turn,acg}}{M}\right) \qquad\qquad
\frac{{\rm d}N_{\rm ion}^{\rm Pop\,III}}{{\rm d}\ln M} \;\propto\; \exp\!\left(-\frac{M_{\rm turn,mcg}}{M} - \frac{M}{M_{\rm acg}}\right)
$$

| 参数                 | 定义                                                                                                                                                                                                                | 物理                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| $M_{\rm turn,acg}$ | `M_TURN`（默认 $10^{8.7}$）；`USE_MINI_HALOS` 时钳为 $\max\!\big(M_{\rm acg}(z),\, M_{\rm TURN}\big)$（`scaling_relations.c:79-82`） | 低质量端软截断：$M\ll M_{\rm turn,acg}$ 时 Pop II 星形成指数归零 |                                                  |
| $M_{\rm turn,mcg}$ | $M_{\rm crit}(z, J_{\rm LW}, v_{\rm cb})$（§4.3）                                                                                                                                                                | 低质量端软截断：LW 光解离 + 相对速度抑制 Pop III |
| $M_{\rm acg}$      | ${\rm TtoM}(z, 10^4\,{\rm K}, 0.59)$（§4.2）                                                                                                                                                                     | 高质量端衰减：超过原子冷却线后 Pop III 关闭      |

**4.4.4 为什么下限要低于翻转点**

软截断 $e^{-M_{\rm turn}/M}$ 在 $\ln M$ 坐标下衰减比直觉慢，要低到 $M_{\rm turn}$ 以下一个量级以上才真正归零：

$$
e^{-1} \approx 0.37\ \ (M{=}M_{\rm turn}), \qquad
e^{-10} \approx 4.5\times10^{-5}\ \ (M{=}M_{\rm turn}/10), \qquad
e^{-50} \approx 2\times10^{-22}\ \ (M{=}M_{\rm turn}/50).
$$

而低质量端 HMF 在 ${\rm d}\ln M$ 权重下单调上升（PS 近似 ${\rm d}n/{\rm d}\ln M\propto M^{-0.68}$，向 $M\to0$ 发散——截断正是防止 $f_{\rm coll}$ 发散的关键）。被积函数是"上升的 HMF × 衰减的软截断"，峰值位于

$$
M_{\rm peak} \approx \frac{M_{\rm turn}}{0.68} \approx 1.5\,M_{\rm turn},
$$

即有效积分区间横跨 $M_{\rm turn}$ 两侧。若把下限硬切在 $M_{\rm turn}$（min_factor=1 的情形），$M<M_{\rm turn}$ 一侧的贡献（约占总量的 $\gamma(0.68,1)/\Gamma(0.68)\sim 0.7$，$\gamma,\Gamma$ 为不完全/完全伽马函数）被一刀切掉，$N_{\rm ion}$ 系统性偏低。方式 2 取 $M_{\min}^{\rm eff}=M_{\min}/50$ 后，下限处贡献 $\sim e^{-50}$，GSL 结果与下限取法无关（数值收敛）。

> **结论**：软截断负责"物理上压低低质量端"，硬下限只负责"数值上让尾部可忽略"，两者解耦。方式 2 必须下探 50 倍以覆盖尾部；方式 1（常量 $\zeta$）的软截断已由 $e^{-M_{\rm turn}/M}$ 提供，故可硬切（min_factor=1）。

**4.4.5 格点依赖与易混淆量**

- **Path A**：区间 $[\ln M_{\min}^{\rm eff},\ \ln 10^{16}]$ 只依赖 $z$，全网格共用；`sigma_minmass = σ_z0(M_min)`（`IonisationBox.c:198`）把下限质量对应的 σ 传给条件 HMF，衔接"区间下限"与 excursion set。
- **Path B / 插值表**：翻转质量按格点密度存储为 `log10_mturns_acg/mcg`（`integral_wrappers.c:266-283`），因为条件 HMF 中 $M_{\rm turn}$ 随局部 $\delta$ 变化——区间是全局的，截断是局部的。
- **易混淆量**：`Mlim_Fstar`/`Mlim_Fesc`（`scaling_relations.c:90-93`）解的是 $f_\star(M)=1$/$f_{\rm esc}(M)=1$ 的质量，用于幂律饱和 clamp，**不是**积分限。

---

## 5. 标度关系（Scaling Relations）

现在填 $f_\star(M)$ 和 $f_{\rm esc}(M)$ 的具体函数形式。代码中所有 `scaling_*` 函数返回 **相对值** $f_{\rm rel}(M)=f(M)/f(M_{\rm piv})$，绝对值在调用方最后乘。

### 5.1 单幂律（Single Power-Law）

最基础的形式，也是 MCG 和大部分参数使用的形式：

| 函数                      | 算式                                       | 用在哪                                 |
| ------------------------- | ------------------------------------------ | -------------------------------------- |
| `scaling_single_PL`     | $(M/M_{\rm piv})^\alpha$                 | Path B 调用                            |
| `log_scaling_single_PL` | $\alpha \cdot (\ln M - \ln M_{\rm piv})$ | Path A 调用（对数空间加法，省`pow`） |

**pivot 质量**：ACG 取 $10^{10}M_\odot$，MCG 取 $10^7M_\odot$。两个族群冷却物理完全不同，pivot 必须放在各自典型质量附近才有局部解释力。

### 5.2 带饱和截断（PL with Saturation）

幂律向高质量方向无限增长会突破 $f_\star \le 1$。低质量方向同理。解决方案：超出 $M_{\rm lim}$ 后 clamp 到常数值。

函数 `scaling_PL_limit` / `log_scaling_PL_limit`，用法与单幂律一致，仅多了饱和判断。

### 5.3 双幂律（Double Power-Law）

仅 ACG $f_\star$ 使用、仅 Path B 走这条。在转折质量 $M_{\rm hi}$ 处从 $\alpha_{\rm lo}$ 平滑过渡到 $\alpha_{\rm hi}$（$\alpha_{\rm hi} < \alpha_{\rm lo}$，即高质端下降更快）：

$$
\boxed{f_{\rm rel}(M) = \frac{{\rm pivot\_ratio}}{(M/M_{\rm hi})^{-\alpha_{\rm lo}} + (M/M_{\rm hi})^{-\alpha_{\rm hi}}}}
$$

**物理溯源**：$\gtrsim 10^{11}M_\odot$ 时 AGN 反馈、维里激波加热打破自相似星际介质模型，$f_\star$ 下降更快。

**激活条件**：`USE_UPPER_STELLAR_TURNOVER=True` 且 $\alpha_\star > \alpha_{\rm upper}$ 时走双幂律，否则回退到 §5.1 单幂律。两个默认值（`True`, $0.5 > -0.6$）均满足，因此**默认启用**。

**自由参数**（用户指定，全部在 `AstroParams`）：

| 参数                | 字段                             | 默认值                 | 含义             |
| ------------------- | -------------------------------- | ---------------------- | ---------------- |
| $\alpha_{\rm lo}$ | `ALPHA_STAR`                   | 0.5                    | 低质量端幂律指数 |
| $\alpha_{\rm hi}$ | `UPPER_STELLAR_TURNOVER_INDEX` | -0.6                   | 高质量端幂律指数 |
| $M_{\rm hi}$      | `UPPER_STELLAR_TURNOVER_MASS`  | $10^{11.447}M_\odot$ | 双幂律转折质量   |

> **注意**：$M_{\rm hi}$ 不是离散采样的质量下限。采样下限是 $M_{\rm min}={\rm SAMPLER\\_MIN\\_MASS}/{\rm SAMPLER\\_BUFFER\\_FACTOR}$（§4.1），默认 $10^8/2=5\times10^7 M_\odot$。$M_{\rm hi}$ 是 $f_\star$ 高质端形状的转折点，两个参数在不同层级，互不干扰。

**pivot_ratio** 不是自由参数，由上述三者自动算出（`scaling_relations.c:50-51`）：

$$
\boxed{{\rm pivot\_ratio} \equiv \left(\frac{M_{\rm hi}}{10^{10}}\right)^{\alpha_{\rm lo}} + \left(\frac{M_{\rm hi}}{10^{10}}\right)^{\alpha_{\rm hi}}}
$$

这正是分母在 $M = 10^{10}M_\odot$（ACG 标准 pivot）处的值，代入公式可得：

$$
f_{\rm rel}(10^{10}) = \frac{\rm pivot\_ratio}{(M_{\rm hi}/10^{10})^{\alpha_{\rm lo}} + (M_{\rm hi}/10^{10})^{\alpha_{\rm hi}}} = \frac{\rm pivot\_ratio}{\rm pivot\_ratio} = 1
$$

这样 $f_\star(10^{10}M_\odot) = {\tt F\\_STAR10}$ 恒成立——**双幂律只管高质端怎么弯，不碰 pivot 处的归一化**。代码中预计算 `pivot_ratio` 也是为了避免每次评估分母时多做两次 `pow()` 调用。

### 5.4 指数截断

幂律描述光滑趋势，指数截断描述**阈值型反馈**（如 SN 吹走小晕气体）。两者在代码中独立——`scaling_*` 只负责幂律部分，截断在调用方加乘：

| 截断项                        | 物理来源               | 施加位置     |
| ----------------------------- | ---------------------- | ------------ |
| $e^{-M_{\rm turn}/M}$ (ACG) | SN 反馈 + 光致加热小晕 | 低质量端衰减 |
| $e^{-M_{\rm turn}/M}$ (MCG) | 同上 + LW + VCB        | 低质量端衰减 |
| $e^{-M/M_{\rm acg}}$ (MCG)  | MCG → ACG 过渡        | 高质量端衰减 |

### 5.5 调度路径一览

标度关系是前几章各概念的**汇合点**——质量阈值（§4）决定了截断位置，两条路径（§3）决定了调用哪个函数版本：

```
Path A（积分）：nion_fraction ──→ log_scaling_PL_limit
Path B（采样）：get_halo_stellarmass ──┬─ ACG f_star → scaling_double_PL 或 scaling_single_PL
                                       └─ MCG f_star → scaling_single_PL
```

Path A 全部走对数版幂律，因为积分核要求标度关系能以 $\alpha(\ln M-\ln M_{\rm piv})$ 的加法形式进入 `exp()`；双幂律的分母含 $M$ 的非多项式项，无法对数化，所以仅 Path B 能用。

---

## 6. 积分引擎

标度关系（§5）和质量函数（§3）都具备了，现在**组装成被积函数**并送入 GSL 积分器。

### 6.1 被积函数：HMF × 标度关系

核心公式（§2）的被积函数由两部分拼成：

- **质量函数部分** — `mf_integrand`，即 $dn/d\ln M$，由宇宙学决定有多少晕
- **标度关系部分** — `nion_fraction`，即 $M \cdot f_\star(M) \cdot f_{\rm esc}(M)$，由 §5 的幂律+截断决定

代码中先分别包装成函数指针，再相乘组装。$2\times2=4$ 种组合对应以下调用：

```
                            HMF 部分              标度关系部分
                   ─────────────────────────────────────────────────────────────
  u_nion_integrand       = u_mf_integrand      × nion_fraction       (ACG, 无条件)
  u_nion_integrand_mini  = u_mf_integrand      × nion_fraction_mini  (MCG, 无条件)
  c_nion_integrand       = c_mf_integrand      × nion_fraction       (ACG, 条件)
  c_nion_integrand_mini  = c_mf_integrand      × nion_fraction_mini  (MCG, 条件)
```

**前缀命名规则**：

- `u_` = 无条件（unconditional），函数签名 `f(lnM, params)` — 用全局 σ(M)
- `c_` = 条件（conditional），函数签名 `f(lnM, params)` — 额外含格点密度 δ 的修正
- `_mini` 后缀 = MCG 版本，比 ACG 多一道 $e^{-M/M_{\rm acg}}$ 截断和 LW 反馈对 $M_{\rm turn}$ 的修正

举例：`nion_fraction`（`hmf.c:389`）内部把所有标度关系组合进 `exp()` 内，实现：

$$
\texttt{nion\_fraction } \propto \exp\!\Big(\ln f_\star + \ln f_{\rm esc} - \frac{M_{\rm turn}}{M} + \ln M\Big)
$$

MCG 版 `nion_fraction_mini` 额外乘以 $e^{-M/M_{\rm acg}}$，并在 $M_{\rm turn}$ 中纳入 LW 反馈修正。

## 7. 参数初始化

在进入积分或采样之前，每一步红移需要把 Python 参数写入 C 结构体（`set_scaling_constants`，`scaling_relations.c:36`）：

| 组             | 关键变量                       | Python 参数                         |
| -------------- | ------------------------------ | ----------------------------------- |
| ACG$f_\star$ | `fstar_10, alpha_star`       | `F_STAR10, ALPHA_STAR`            |
| MCG$f_\star$ | `fstar_7, alpha_star_mini`   | `F_STAR7_MINI, ALPHA_STAR_MINI`   |
| 逃逸率         | `fesc_10, fesc_7, alpha_esc` | `F_ESC10, F_ESC7_MINI, ALPHA_ESC` |
| 高质量端反馈   | `alpha_upper, pivot_upper`   | `ALPHA_STAR_HIGH, M_TURNOVER`     |
| 光子产率       | `pop2_ion, pop3_ion`         | `N_ION_POP2, N_ION_POP3`          |
| 质量截断       | `mturn_a_nofb, mturn_m_nofb` | 来自温度阈值函数计算                |
| 饱和限         | `Mlim_Fstar, Mlim_Fesc, ...` | 二分法预求解                        |

启用 MCG 时 `mturn_a_nofb` 被 clamp 到 `max(acg_thresh, M_TURN)`，避免 ACG 截断侵入 MCG 质量区间。

---

## 8. 离散采样（Path B）

Path A（§6）用 GSL 积分得到期望值，精确但不保留 Poisson 噪声。大质量晕稀少且贡献大，需要 Path B —— 把格点视为有限体积 patch，用条件质量函数抽样出离散晕。

> **混合实现**：实际代码中 `ComputeHaloBox`（`HaloBox.c:608-644`）把两种路径合并进同一个源网格，而不是二选一：
>
> - **低质量端** $[M_{\min},\ M_{\max}^{\rm int}]$：`set_fixed_grids` 做 Path A 积分（期望值，`HaloBox.c:641-644`）；
> - **大质量端** $>M_{\max}^{\rm int}$：`sum_halos_onto_grid` 从晕表做 Path B 离散采样（`HaloBox.c:628-631`）。
>
> 积分上限 $M_{\max}^{\rm int}$ 依 `SOURCE_MODEL` 而定（`HaloBox.c:633-640`）：
>
> | `SOURCE_MODEL`       | $M_{\max}^{\rm int}$                | 含义                     |
> | ---------------------- | ------------------------------------- | ------------------------ |
> | `=4`（CHMF-SAMPLER） | `SAMPLER_MIN_MASS`                  | 低于采样下限的晕全部积分 |
> | `=3`（DEXM-ESF）     | $M(R_{\rm cell})$，格点半径对应质量 | 积分到格点尺度为止       |
> | 其余（含`=2`）       | $10^{16}M_\odot$                    | 纯积分，无采样部分       |
>
> 即"低质量晕积分、大质量晕采样"的分界线由 `SAMPLER_MIN_MASS`（或格点尺度）控制；§5.3 所述"采样下限 $M_{\min}={\rm SAMPLER\_MIN\_MASS}/{\rm SAMPLER\_BUFFER\_FACTOR}$"正是这条分界线的缓冲版本。

### 8.1 条件质量函数

先定义 **格点暗物质质量**（`Stochasticity.c:142`）：

$$
M_{\rm cond} \equiv \rho_{\rm crit,0} \, \Omega_m \, \frac{V_{\rm sim}}{N_{\rm pixels}}
$$

该格点的 Lagrangian 体积 $V_{\rm cell} = M_{\rm cond}/\bar{\rho}$。

代码中 `conditional_hmf`（即 `dNdM_conditional_EPS`，`hmf.c:285`）**不是**标准宇宙学记号下的 $dn/d\ln M$，而是**除以父质量的版本**：

$$
dNdM_{\rm conditional} \equiv \frac{1}{M_{\rm cond}} \cdot \frac{dn}{d\ln M}\Big|_\delta \qquad (\text{量纲 } [M_\odot^{-1}])
$$

因此对 $\ln M$ 积分后得到的是"每单位父质量的晕数"（$[M_\odot^{-1}]$），必须乘回 $M_{\rm cond}$ 才得到格点内的期望晕数：

**期望晕数**：

$$
\boxed{\langle N \rangle = M_{\rm cond} \cdot \int_{\ln M_{\rm min}}^{\ln M_{\rm cond}} dNdM_{\rm conditional}(\ln M | \delta) \; d\ln M}
$$

**量纲验算**（逐行对应代码）：

| 步骤                                      | 代码位置                         |        量纲        |
| ----------------------------------------- | -------------------------------- | :-----------------: |
| `dNdM_conditional_EPS` 返回值           | `hmf.c:296`                    | $[M_\odot^{-1}]$ |
| $\int dNdM_{\rm conditional} \; d\ln M$ | `IntegratedNdM`, `hmf.c:828` | $[M_\odot^{-1}]$ |
| `Nhalo_Conditional` 返回值              | `hmf.c:973`                    | $[M_\odot^{-1}]$ |
| `expected_N = n_exp * M_cond`           | `Stochasticity.c:210`          | **无量纲** ✓ |

**边界交叉验证**：$\delta > 0.99\delta_c$ 时 `Nhalo_Conditional` 直接返回 `1.0/M_cond`（`hmf.c:968`），则 $\langle N \rangle = (1/M_{\rm cond}) \times M_{\rm cond} = 1$，量纲和物理含义（全塌缩 → 恰好 1 个晕）同时闭合 ✓。

特殊情况：

| 条件                            | $\langle N \rangle$ | 含义                   |
| ------------------------------- | :-------------------: | ---------------------- |
| $\delta > 0.99\delta_c$       |           1           | 全塌缩                 |
| $\delta \le \delta_{\rm min}$ |           0           | 空洞                   |
| $M_{\rm cond} < M_{\rm min}$  |           0           | 格点太小，装不下最小晕 |

代码调用链：`set_consts_cond` → `EvaluateNhalo` → `Nhalo_Conditional` → `IntegratedNdM`。

### 8.2 Poisson 抽样

1. 抽晕数：$N \sim {\rm Poisson}(\langle N \rangle)$
2. 对每个晕抽质量：$M_i = F^{-1}(U_i | \delta) \cdot M_{\rm cond}$，其中 $F$ 是条件 CDF，$U_i \sim U(0,1)$

$F^{-1}$ 通过预建插值查找表实现（`initialise_dNdM_inverse_table`）。

### 8.3 单晕恒星质量

从抽出的晕质量 $M$，逐晕计算（`scaling_relations.c:311-359`）：

**对数正态 scatter**（偏差修正 $-\sigma_\star^2/2$ 保证路径间 SFRD 均值一致）：

$$
f_\star(M) = \overline{f_\star}(M) \cdot \exp\!\big(r \cdot \sigma_\star - \tfrac{\sigma_\star^2}{2}\big),\qquad r \sim \mathcal{N}(0,1)
$$

**ACG**：

$$
f_\star^{\rm ACG}(M) = \min\!\Big(1,\; F_{\star}^{10} \cdot f_{\rm rel}^{\rm ACG}(M) \cdot e^{-M_{\rm turn}^{\rm acg}/M + r\sigma_\star - \sigma_\star^2/2}\Big)
$$

$$
M_\star^{\rm ACG} = f_\star^{\rm ACG} \cdot M \cdot \tfrac{\Omega_b}{\Omega_m}
$$

**MCG**：

$$
f_\star^{\rm MCG}(M) = \min\!\Big(1,\; F_{\star}^{7} \cdot (\tfrac{M}{10^7})^{\alpha_{\rm mini}} \cdot e^{-M_{\rm turn}^{\rm mcg}/M - M/M_{\rm acg} + r\sigma_\star - \sigma_\star^2/2}\Big)
$$

$$
M_\star^{\rm MCG} = f_\star^{\rm MCG} \cdot M \cdot \tfrac{\Omega_b}{\Omega_m}
$$

单个晕的总 $M_\star = M_\star^{\rm ACG} + M_\star^{\rm MCG}$。

### 8.4 格点 SFRD

汇总该格点所有 $N$ 个抽出的晕：

$$
\boxed{{\rm SFRD}_{\rm cell} = \frac{\sum_{i=1}^{N} M_{\star,i} / t_*}{V_{\rm cell}}}
$$

其中 $V_{\rm cell} = M_{\rm cond}/\bar{\rho}$，$t_*$ 为恒星形成的特征时标。

---

## 9. 可能要修改的位置（备用）

| 修改目标                             | 文件                              | 位置                                                                  |
| ------------------------------------ | --------------------------------- | --------------------------------------------------------------------- |
| LW 反馈$A_{\rm LW}, B_{\rm LW}$    | `thermochem.c:290`              | 硬编码常量                                                            |
| VCB 反馈$A_{\rm VCB}, B_{\rm VCB}$ | `thermochem.c:292-293`          | 硬编码常量                                                            |
| Fialkov+12 基线系数                  | `thermochem.c:289`              | 硬编码常量                                                            |
| MCG$f_\star$ 归一化                | Python 参数`F_STAR7_MINI`       | →`scaling_relations.c:53`                                          |
| MCG 幂律指数                         | Python 参数`ALPHA_STAR_MINI`    | →`scaling_relations.c:54`                                          |
| ACG 温度阈值                         | `thermochem.c:278`              | `1e4` K                                                             |
| 禁用 MCG                             | Python:`USE_MINI_HALOS = False` | —                                                                    |
| MCG pivot 质量 ($10^7$)            | 3 处                              | `hmf.c:399`, `scaling_relations.c:354`, `set_scaling_constants` |
