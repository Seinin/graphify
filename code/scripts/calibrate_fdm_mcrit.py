#!/usr/bin/env python3
"""
FDM mcrit_noLW 校准方案
=========================

物理动机
--------
CDM 中 mcrit_noLW = 3.314e7 (1+z)^-1.5 是分子冷却截断质量,
在 scaling_relations.c 中以 exp(-mturn_mcg/M) 形式出现.

FDM 对该参数的影响有两个独立通道:
  1. 晕丰度通道 (已实现): dndm_FDM(M) 压低小质量晕的数量
    → Schive+16: M0 = 1.6e10 m22^(-4/3)
  2. 晕内部结构通道 (待实现): soliton 平核降低中心气体密度
    → 本方案: 修改 mcrit_noLW 的数值

方案: Soliton 质量等式 + 二次合成
------------------------------------
Schive+14 核心-晕关系 (Nature Phys 10, 496):
  M_core = 3.1e7 × (ma / 2e-22 eV)^(-1) × (M_h / 1e9 Msun)^(1/3)  Msun

其中 ma 为轴子质量, m22 = ma / 1e-22 eV 是本 codebase 的惯例.
注意 Schive+14 以 2e-22 eV 为参照, 必须正确转换:
  ma / 2e-22 = (m22 × 1e-22) / 2e-22 = m22 / 2
  → (ma/2e-22)^(-1) = 2 / m22

因此:
  M_core = 3.1e7 × 2 / m22 × (M_h / 1e9)^(1/3)
         = 6.2e7 / m22 × (M_h / 1e9)^(1/3)  Msun

当 M_core = M_halo 时, 整个晕就是一个孤子, NFW 外包层消失.
此时孤子平核完全取代 NFW 尖点, 冷却能力本质性改变.

求解 M_core = M_h:
  M_h = 6.2e7 / m22 × (M_h / 1e9)^(1/3)
  (M_h / 1e9)^(2/3) = 0.062 / m22
  M_h = (0.062 / m22)^(3/2) × 1e9
      = 0.062^(3/2) × 1e9 × m22^(-3/2)
  0.062^(3/2) = 0.062 × √0.062 = 0.01544

得孤子-only 质量:
  M_sol = 1.54e7 × m22^(-3/2)  Msun

  其中 m22 = ma / 1e-22 eV (与 codebase 中 cosmo_params_global->m22 一致)

FDM 冷却阈值: 隐式方程 (1) 的精确解 —— 中心值
--------------------------------------------
本脚本此前用「二次合成」作为中心值:
  mcrit_FDM = sqrt( mcrit_CDM(z)^2 + M_sol(m22)^2 )        ← 已废弃
该式只是 m_k 族在 k = 2 处的一个成员, 而 k 没有独立物理含义.

现在中心值由自洽条件决定. 把 Hill 型抑制因子 η_p 的自变量取为
u = m_crit^FDM / M_sol (晕质量以孤子尺度为单位), 并要求

  eq.(1):  η_p(u) · (u/r)^γ = 1,    r = mcrit_CDM(z) / M_sol(m22)
           η_p(x) = x^p / (1 + x^p)

左侧在 u 上严格单调递增 (两个正递增函数之积), 从 0 升到
η_p(1)·r^(-γ) > 1, 故根唯一且有限 —— 用 log 空间等比倍增定界 + brentq
求解. γ ≤ 0 时左侧有上界 η_p(u) ≤ 1, 方程退化, 显式返回「无解」标记.
中心参数: p = 1.0, γ = 0.10 (先验区间 γ ∈ [0.05, 0.15], p ∈ [0.5, 2]).

对照族 (保留, 仅作对照):
  m_k = [ (mcrit_CDM)^k + M_sol^k ]^(1/k),   k ∈ [1, ∞]
该族在 k 上单调递减: k → 0+ 发散, k → ∞ 趋于 max(mcrit_CDM, M_sol)
(下确界, 取不到), 上界为 m_1 = mcrit_CDM + M_sol.
所以 k ∈ [1, ∞] 只能覆盖 [max, a+b] 这一窄带. 脚本用 k_eff 反解
「精确解等效于哪个 k」, 并输出偏差因子 m_exact / m(k=2).

渐近行为:
  m22 >> 1 (重轴子):  M_sol → 0,  r ≫ 1,  mcrit_FDM → mcrit_CDM
  m22 << 1 (轻轴子):  M_sol → ∞,  r ≪ 1,  精确解远小于 M_sol (η_p 未饱和),
                      与 §5.6 的 mcrit_FDM/M_sol ≫ 1 假设矛盾
  z → 高:             mcrit_CDM 小, FDM 效应最强
  z → 低:             mcrit_CDM 大, FDM 效应减弱

参考
----
- Schive+14 (Nature Phys 12, 191): soliton core-halo relation
- Fialkov+12 (MNRAS 424, 1335): mcrit_noLW CDM 校准
- Schive+16 (PRL 116, 201302): FDM HMF suppression
- Tocher+26 (arXiv:2603.25546): FDM 3D 模拟 (波动力学效应, 本方案未含)
"""

import numpy as np
from scipy.optimize import brentq

# ============================================================================
# Core functions
# ============================================================================

# 隐式方程 (1) 的中心参数 (先验区间: gamma in [0.05, 0.15], p in [0.5, 2])
P_REF = 1.0
GAMMA_REF = 0.10

# gamma <= 0 时 eq.(1) 退化, 用显式「无解」标记, 绝不返回数值
NO_SOLUTION = None

# 求根的等比倍增上界: u 超过此值仍无符号变化即判为无解
U_MAX = 1e14


def mcrit_CDM(z):
    """CDM molecular cooling threshold (Fialkov+12)."""
    return 3.314e7 * (1 + z) ** (-1.5)


def M_sol(m22):
    """
    Soliton-only mass: M_core = M_halo from Schive+14.

    Below this mass, the entire FDM halo is a self-gravitating soliton
    with a flat core (no NFW envelope).  The central gas density is
    fundamentally limited by quantum pressure support.

    Parameters
    ----------
    m22 : float
        Axion mass in units of 1e-22 eV (matches codebase m22 convention).

    Returns
    -------
    float
        Soliton-only mass [Msun].
    """
    return 1.54e7 * m22 ** (-1.5)


def eta_hill(x, p=P_REF):
    """Hill 型抑制因子 eta_p(x) = x^p / (1 + x^p) (docs/FDM.md §5.5)."""
    xp = float(x) ** p
    return xp / (1.0 + xp)


def mcrit_implicit(m22, z, p=P_REF, gamma=GAMMA_REF, f_wave=1.0):
    """
    eq.(1) 的精确数值解 —— 中心值.

        eta_p(u) * (u/r)^gamma = 1,
        u = m_crit^FDM / M_sol,   r = mcrit_CDM(z) / M_sol

    左侧在 u 上严格单调递增 (两个正递增函数之积), 从 0 升到
    eta_p(1) * r^(-gamma) > 1, 故根唯一且有限. 在 log 空间用等比倍增
    定界, 对残差函数做 brentq.

    Parameters
    ----------
    m22 : float
        Axion mass / 1e-22 eV.
    z : float
        Redshift.
    p : float
        Hill 指数 (先验区间 [0.5, 2]).
    gamma : float
        eq.(1) 幂指数 (先验区间 [0.05, 0.15]); gamma <= 0 时方程退化.
    f_wave : float, optional
        孤子尺度上的波动力学增强因子 (>= 1), 等价于 M_sol -> f_wave*M_sol.
        Default 1.0 = 保守 (仅孤子几何). 该项是次主导的可选项, 不改变
        中心值的确定方式.

    Returns
    -------
    float or None
        mcrit_FDM [Msun]; gamma <= 0 或超出搜索上界时返回 NO_SOLUTION.
    """
    if gamma <= 0.0:
        return NO_SOLUTION
    ms = f_wave * float(M_sol(m22))
    log_r = np.log(float(mcrit_CDM(z)) / ms)

    def f(u):
        lu = np.log(u)
        log_eta = p * lu - np.logaddexp(0.0, p * lu)
        return np.expm1(log_eta + gamma * (lu - log_r))

    hi = 1.0                       # 等比倍增上界
    while f(hi) <= 0.0:
        hi *= 2.0
        if hi > U_MAX:
            return NO_SOLUTION
    u = brentq(f, 1e-30, hi, xtol=1e-15, rtol=1e-15)
    return u * ms


def mcrit_FDM(m22, z, p=P_REF, gamma=GAMMA_REF, f_wave=1.0):
    """
    FDM 分子冷却阈值 —— 即 eq.(1) 的精确解 (中心值).

    保留此名以兼容旧调用点; 内部委托 mcrit_implicit. 拿到 NO_SOLUTION
    说明参数已退化, 这里直接报错而不是把「无解」当数值用.
    """
    m = mcrit_implicit(m22, z, p=p, gamma=gamma, f_wave=f_wave)
    if m is NO_SOLUTION:
        raise ValueError(
            f"eq.(1) 在 p={p}, gamma={gamma} 下退化、无解 (m22={m22}, z={z}); "
            "「无解」标记不能当作数值使用, 请改用 gamma > 0."
        )
    return m


def mcrit_k(k, m22, z):
    """
    对照族 m_k = [ (mcrit_CDM)^k + M_sol^k ]^(1/k) —— 仅作对照.

    该族在 k 上单调递减: k -> 0+ 发散, k -> inf 趋于下确界
    max(mcrit_CDM, M_sol) (取不到), k = 1 为上界 a + b. 因此 k >= 1 段只覆盖
    [max, a+b] 这一窄带, 既不构成误差包络, 也够不到 eq.(1) 的解
    (后者高于 a + b, 需 k ~ 0.4; 见 k_eff_from_mcrit).

    Returns
    -------
    float
        族成员值; 超出 float64 可表示范围时返回 +inf (不静默截断).
    """
    a = float(mcrit_CDM(z))
    b = float(M_sol(m22))
    if np.isinf(k):
        return max(a, b)
    la, lb = k * np.log(a), k * np.log(b)
    m = max(la, lb)
    d = abs(la - lb)
    if d < 708.0:                  # exp(-d) 在 float64 中仍有贡献
        m = m + np.log1p(np.exp(-d))
    log_m = m / k
    if log_m > 700.0:              # exp(700) 已逼近 float64 上限
        return float(np.inf)
    return float(np.exp(log_m))


def k_eff_from_mcrit(m_exact, m22, z, k_min=1e-3, k_max=60.0):
    """
    反解等效 k, 使 m_k(k_eff) = m_exact (docs/FDM.md §5.13).

    族在 k 上单调递减, 有效区间为 [max(a,b), m(k_min)]. 三态返回:
      * nan  : 精确解 <= max(a, b) —— 低于族的下确界, 族无法表示
      * -1.0 : 精确解 > m(k_min) —— 需要 k < k_min, 超出搜索上界
      * 数值 : [k_min, k_max] 内的唯一根
    静默把边界值当结果会制造假样本, 故必须在接口层面区分.
    """
    a = float(mcrit_CDM(z))
    b = float(M_sol(m22))
    if m_exact <= max(a, b) * (1.0 + 1e-12):
        return np.nan
    la, lb = k_min * np.log(a), k_min * np.log(b)
    log_m_kmin = (max(la, lb) + np.log1p(np.exp(-abs(la - lb)))) / k_min
    if np.log(m_exact) >= log_m_kmin:
        return -1.0

    def g(k):
        la, lb = k * np.log(a), k * np.log(b)
        m = max(la, lb)
        d = abs(la - lb)
        if d < 708.0:
            m = m + np.log1p(np.exp(-d))
        return m / k - np.log(m_exact)

    return brentq(g, k_min, k_max, xtol=1e-12, rtol=1e-12)


def deviation_ratio(m_exact, m22, z, k=2.0):
    """偏差因子 m_exact / m_k(k): 以该 k 作中心值时低估 (或高估) 的倍数."""
    return float(m_exact) / mcrit_k(k, m22, z)


def M_hmf_suppress(m22):
    """FDM HMF suppression scale (Schive+16, already in fdm.c)."""
    return 1.6e10 * m22 ** (-4.0 / 3.0)


# ============================================================================
# Tabulation
# ============================================================================

def main():
    print("=" * 78)
    print("FDM mcrit_noLW 校准方案")
    print("=" * 78)
    print()
    print("中心值: eq.(1) 的精确解   η_p(u)·(u/r)^γ = 1")
    print("  u = mcrit_FDM/M_sol,  r = mcrit_CDM(z)/M_sol(m22)")
    print("  η_p(x) = x^p/(1+x^p)                [Hill 型, §5.5]")
    print("  mcrit_CDM(z) = 3.314e7 (1+z)^-1.5   [Fialkov+12]")
    print("  M_sol(m22)  = 1.54e7 m22^(-3/2)     [Schive+14]")
    print(f"  中心参数 p = {P_REF}, γ = {GAMMA_REF}")
    print("对照族(仅作对照): m_k = [(mcrit_CDM)^k + M_sol^k]^(1/k),  k ∈ [1, ∞]")
    print()

    zs = np.array([5, 8, 10, 12, 15, 20, 25, 30, 35, 40])
    m22s = np.array([0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 50.0, 100.0])

    # --- Table 1: 精确解 R(z) + 等效 k_eff + 偏差因子 ---
    print("─" * 100)
    print("表1: M_sol(m22)、精确解比值 R(z)、等效 k_eff 与偏差因子 m_exact/m(k=2)")
    print("─" * 100)
    print(f"{'m22':>6s}  {'M_sol':>10s}  {'M_hmf':>10s}", end="")
    for z in [10, 20, 30]:
        print(f"  {'R(z=' + str(z) + ')':>8s}", end="")
    print(f"  {'k_eff@10':>9s}  {'m_ex/m(2)':>10s}")
    print(f"{'':>6s}  {'[Msun]':>10s}  {'[Msun]':>10s}")
    print("-" * 100)

    n_below = n_above = 0
    for m22 in m22s:
        ms = M_sol(m22)
        mh = M_hmf_suppress(m22)
        print(f"{m22:6.1f}  {ms:10.2e}  {mh:10.2e}", end="")
        for z in [10, 20, 30]:
            ratio = mcrit_FDM(m22, z) / mcrit_CDM(z)
            print(f"  {ratio:8.2f}", end="")
        me = mcrit_FDM(m22, 10)
        ke = k_eff_from_mcrit(me, m22, 10)
        if np.isnan(ke):
            n_below += 1
            ke_s = "nan"
        elif ke < 0:
            n_above += 1
            ke_s = "<kmin"
        else:
            ke_s = f"{ke:.3f}"
        print(f"  {ke_s:>9s}  {deviation_ratio(me, m22, 10):10.3f}")

    print()
    print("  R = mcrit_FDM(精确解) / mcrit_CDM")
    print("  k_eff: 反解 [(a)^k+(b)^k]^(1/k) = 精确解;")
    print("         nan = 低于族下确界(族无法表示), <kmin = 需 k < 1e-3(超搜索上界)")
    print("  m_ex/m(2): 偏差因子; >1 表示用 k=2 中心值会低估 mcrit_FDM 该倍数")
    print(f"  本表 k_eff 判负计数: nan={n_below}, <kmin={n_above}")
    print("  M_hmf = HMF suppression scale (Schive+16, 已实现于 fdm.c)")
    print("  注: M_sol << M_hmf → 冷却是 FDM 抑制恒星形成的主导通道")

    # --- Table 2: mcrit_FDM absolute values ---
    print()
    print("─" * 78)
    print("表2: mcrit_FDM(m22, z) [Msun] — eq.(1) 精确解 (中心值)")
    print("─" * 78)
    header = f"{'z':>4s}  {'CDM':>10s}"
    for m22 in [0.5, 1.0, 2.0, 5.0, 10.0]:
        header += f"  {'m22=' + str(m22):>10s}"
    print(header)
    print("-" * 78)

    for z in zs:
        row = f"{z:4.0f}  {mcrit_CDM(z):10.3e}"
        for m22 in [0.5, 1.0, 2.0, 5.0, 10.0]:
            row += f"  {mcrit_FDM(m22, z):10.3e}"
        print(row)

    # --- Table 2b: 偏差因子 m_exact / m(k=2) ---
    print()
    print("─" * 78)
    print("表2b: 偏差因子 m_exact / m(k=2) — 用 k=2 作中心值的低估倍数")
    print("─" * 78)
    header = f"{'z':>4s}"
    for m22 in [0.5, 1.0, 2.0, 5.0, 10.0]:
        header += f"  {'m22=' + str(m22):>10s}"
    print(header)
    print("-" * 78)
    for z in zs:
        row = f"{z:4.0f}"
        for m22 in [0.5, 1.0, 2.0, 5.0, 10.0]:
            row += f"  {deviation_ratio(mcrit_FDM(m22, z), m22, z):10.2f}"
        print(row)
    print()
    print("  值 > 1 ⇒ k=2 把阈值定低该倍数 ⇒ 恒星形成被高估")

    # --- Table 3: Effect on exp(-Mturn/M) ---
    print()
    print("─" * 78)
    print("表3: 对 exp(-Mturn/M) 截断因子的影响 @ z=10")
    print("    (MCG 恒星形成效率, 取 J_21=0, vcb=0；阈值取 eq.(1) 精确解)")
    print("─" * 78)
    masses = [1e5, 3e5, 1e6, 3e6, 1e7, 3e7, 1e8]
    header = f"{'M_h':>10s}  {'CDM':>8s}"
    for m22 in [0.5, 1.0, 2.0, 5.0, 10.0]:
        header += f"  {'m22=' + str(m22):>8s}"
    print(header)
    print("-" * 78)

    mc_cdm = mcrit_CDM(10)
    for Mh in masses:
        row = f"{Mh:10.1e}  {np.exp(-mc_cdm / Mh):8.4f}"
        for m22 in [0.5, 1.0, 2.0, 5.0, 10.0]:
            mc_fdm = mcrit_FDM(m22, 10)
            row += f"  {np.exp(-mc_fdm / Mh):8.4f}"
        print(row)

    print()
    print("  值 = exp(-Mturn/M): 1=完全恒星形成, 0=完全抑制")

    # --- Table 4: Consistency with Tocher+2026 ---
    print()
    print("─" * 78)
    print("表4: 与 Tocher+2026 的一致性检查")
    print("─" * 78)
    print()
    print("  Tocher+2026 模拟的是原子冷却晕 (Tvir > 1e4 K),")
    print("  mcrit_noLW 针对分子冷却 (Tvir > 120 K), 质量范围不同.")
    print("  但可检验趋势是否一致:")
    print()
    print(f"  {'m22':>4s}  {'M_sol':>10s}  {'Tocher Mh':>10s}  {'Tocher抑制':>10s}  "
          f"{'M_sol/Mh':>10s}  {'一致性':>20s}")
    print("  " + "-" * 70)

    tocher_data = [
        # (m22, Mh, suppression%, note)
        (1.0, 3e9,  54, "M_sol<<Mh, 抑制来自波动"),
        (2.0, 8e8,  84, "M_sol<<Mh, 抑制来自波动"),
        (3.0, 3e8, 100, "M_sol<<Mh, 完全抑制"),
        (7.0, 3e8,  58, "M_sol<<Mh, 波动+几何"),
        (2.0, 3e9,   8, "M_sol<<Mh, 几乎无效应"),
        (7.0, 8e8,   8, "M_sol<<Mh, 几乎无效应"),
    ]
    for m22, Mh, supp, note in tocher_data:
        ms = M_sol(m22)
        ratio = ms / Mh
        consistency = ("几何效应可忽略" if ratio < 0.01 else
                       "几何效应边缘" if ratio < 0.1 else
                       "几何效应应可见")
        print(f"  {m22:4.1f}  {ms:10.2e}  {Mh:10.1e}  {supp:9d}%  "
              f"{ratio:10.4f}  {consistency:>20s}")

    print()
    print("  结论: Tocher 的晕质量 (3e8-8e9) 远大于 M_sol (1e6-1e7),")
    print("        其观测到的抑制主要来自波动力学, 非孤子几何.")
    print("        本方案捕获孤子几何效应, 与 Tocher 互补.")

    # --- Table 5: Wave dynamics correction ---
    print()
    print("─" * 78)
    print("表5: 波动力学修正因子 f_wave (可选, 基于 Tocher+2026 外推)")
    print("─" * 78)
    print()
    print(f"  {'m22':>4s}  {'f_wave':>8s}  {'mcrit(z=10)':>12s}  {'vs 无修正':>10s}  {'说明':>30s}")
    print("  " + "-" * 70)

    f_wave_map = {
        0.5: 4.0,   # strong wave dynamics for very light axions
        1.0: 3.0,
        2.0: 2.0,
        5.0: 1.3,
        10.0: 1.0,  # negligible wave dynamics for heavy axions
    }
    for m22, fw in f_wave_map.items():
        mc_base = mcrit_FDM(m22, 10, f_wave=1.0)
        mc_wave = mcrit_FDM(m22, 10, f_wave=fw)
        ratio = mc_wave / mc_base
        note = ("Tocher: 抑制以波动力学为主" if fw > 1.5 else
                "Tocher: 波动力学次要" if fw > 1.0 else
                "Tocher: 波动力学可忽略")
        print(f"  {m22:4.1f}  {fw:8.1f}  {mc_wave:12.3e}  {ratio:10.2f}  {note:>30s}")

    print()
    print("  建议: 默认 f_wave=1 (保守). 待 Tocher+26 拟合公式发布后更新.")

    # --- C code snippet ---
    print()
    print("=" * 78)
    print("C 端现状: 本方案尚未接入模拟")
    print("=" * 78)
    print("""
本脚本只回答"给定 (p, γ) 下 mcrit_FDM 应该是多少", **不改 C 端**.
当前 MCG turnover 仍取 Lyman-Werner 阈值:
    double mcrit_noLW = 3.314e7 * pow(1. + z, -1.5);   <- 现状, 无 FDM 项
出现位置:
    HaloBox.c:495 (及 :744)、scaling_relations.c:87、IonisationBox.c:430
    (均为 lyman_werner_threshold(z, J21, vcb)).
FDM 目前在模拟中只以 dndm_FDM (fdm.c:54) 的形式出现 —— 那是 HMF 压制
通道 (晕丰度), 与晕内部冷却通道是两回事.

把 eq.(1) 接进 C 端属独立的物理改动 (会改变模拟输出), 其前置条件是
η_p 的形状与 γ 被模拟校准. 详见 docs/FDM.md「现状缺口」节.
""")

    # --- Physical justification ---
    print("=" * 78)
    print("方案物理自洽性论证")
    print("=" * 78)
    print("""
1. 从 CDM 校准的含义出发:
   mcrit_CDM 是这样一个质量: 在此质量, NFW 晕的中心气体密度
   刚好足以让 H2 冷却在 Hubble 时标内触发失控坍缩.
   该校准来自 Stacy+11 & Greif+11 的 3D 模拟 (经 Fialkov+12 拟合).

2. FDM 改变了什么:
   Schive+14 表明 FDM 晕的内核不是 NFW 尖点, 而是孤子平核.
   当 M_h >> M_sol: 孤子仅占据中心极小区域, NFW 外包层主导
                    → 冷却过程与 CDM 几乎相同
   当 M_h ~ M_sol:  孤子与晕质量相当, 平核延伸到 NFW 尺度半径
                    → 中心气体密度显著降低, 冷却效率下降
   当 M_h < M_sol:  整个晕就是一个孤子, 无 NFW 尖点
                    → 气体密度被量子压强限制在极低水平
                    → H2 冷却物理上不可能在此类晕中触发

3. 为什么用 eq.(1) 而不是二次合成:
   二次合成 m = sqrt(mcrit_CDM^2 + M_sol^2) 只是 m_k 族在 k=2 处的成员.
   该族在 k 上单调递减, 其 k >= 1 段只覆盖 [max(a,b), a+b] 的窄带, 而 k 本身
   没有独立物理含义 —— 取 k=2 作中心值等于引入一个无依据的自由度.
   实测表明它会系统性低估阈值: 偏差因子 m_exact/m(k=2) 在 1.1-3.9 之间
   (见表2b), 即恒星形成被高估. eq.(1) 的解位于 a+b 之上, 对应 k_eff ~ 0.4,
   即落在通常引用的 [1, inf] 区间之外.
   eq.(1) 改把 u = mcrit_FDM/M_sol 作为 Hill 因子 η_p 的自变量, 让阈值
   由"抑制因子达到 1"这一自洽条件决定, 不含待定自由度.

4. 与已有 FDM 基础设施的关系:
   fdm.c 已实现: dndm_FDM(M) → 晕数量抑制 (结构形成)
   本方案新增:   mcrit_FDM(m22,z) → 冷却效率抑制 (晕内部物理)
   两者互补, 共同决定 FDM 宇宙中的恒星形成率.

5. 局限性 (诚实声明):
   - 不含波动力学效应 (Tocher+26 Dyn-Fro 差值 ~10-80%)
   - Schive+14 关系有因子 ~2 不确定性
   - 1D 球对称假设, 不含角动量/碎裂
   - f_wave 因子为外推估计, 待精确校准
""")


if __name__ == "__main__":
    main()
