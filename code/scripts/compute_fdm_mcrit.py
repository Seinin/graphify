#!/usr/bin/env python3
"""
FDM 分子冷却阈值计算 v2
=======================

⚠⚠ 弃用警告：本脚本的定量输出不可用 (DEPRECATED — quantitative results are INVALID)
================================================================================

本脚本基于**静态 DM 势**的二分查找，**不含气体动力学收缩**，
因而对 FDM 严重高估 M_crit，误差达 **10^2 – 10^4 倍**。

已知失效证据（详见 docs/FDM_mcrit_algorithm.md 附录 A.3）：
  - 与 Tocher+2026 模拟实测直接矛盾：静态模型判「不冷却」时，
    实测 M_h = 3e9 M_sun 处仍有 46% 恒星形成效率。
  - m_a ≲ 5e-22 eV 时完全失效（返回 inf）。

保留本脚本仅供理解算法结构与缺陷成因，**勿用于任何定量结论**。

推荐替代方案
------------
解析方案（docs/FDM_mcrit_algorithm.md 正文 §5–§7）：

    m_crit_FDM(m22, z) = sqrt( m_crit_CDM(z)^2 + M_sol(m22)^2 )
    M_sol(m22) = 1.54e7 * m22^(-3/2) M_sun

由 scripts/calibrate_fdm_mcrit.py 实现，可直接复算文档 §6 表格：

    .venv/bin/python scripts/calibrate_fdm_mcrit.py

--------------------------------------------------------------------------------

原始说明（历史保留）
--------------------
对比 CDM (NFW) 和 FDM (soliton+NFW) 下分子氢冷却的最低晕质量。

方法：计算核心区 DM 密度，由其决定气体特征密度，再基于 H2 冷却条件
判断恒星形成能否发生。

输出：~~用于替换 thermochem.c 中 mcrit_noLW 和 A_LW/BETA_LW 的 FDM 参数~~
      （此用途已废弃，见上方警告）

物理说明
-------
- thermochem.c 中 mcrit_noLW 来自 CDM 分子冷却（Fialkov+12）
- thermochem.c 中 reionization_feedback 来自 SM13（再电离光致蒸发）
- 本脚本只处理前者（分子冷却 + LW 反馈）
- SM13 再电离反馈需要单独的 1D Lagrangian hydro 计算

参考文献
--------
- Schive+14    : soliton density profile + core-halo mass relation
- Fialkov+12   : CDM mcrit baseline = 3.314e7 (1+z)^-1.5
- Muñoz+21     : CDM LW feedback A=2.0, B=0.6
- Tegmark+97   : molecular cooling criterion
- Trenti & Stiavelli 2009 : semi-analytic cooling threshold
"""

import numpy as np
from scipy.integrate import quad
from scipy.optimize import bisect
import warnings
warnings.filterwarnings("ignore", category=RuntimeWarning)

# ============================================================================
# Physical constants (cgs)
# ============================================================================
G  = 6.67430e-8    # cm^3/g/s^2
kB = 1.380649e-16  # erg/K
mp = 1.6726e-24    # g
Msun = 1.989e33    # g
kpc = 3.086e21     # cm
Myr = 3.15576e13   # s

# Planck 2018
Om0 = 0.315; Ob0 = 0.049; OL = 0.685; H0 = 67.4
h = H0 / 100.0
fb = Ob0 / Om0

# Gas composition
X_H = 0.76       # hydrogen mass fraction
mu  = 1.22       # mean molecular weight (neutral primordial)

# ============================================================================
# Cosmology
# ============================================================================

def Hz(z):
    """Hubble parameter [1/s]."""
    # H0 in 1/s = 67.4 km/s/Mpc * 1e5 cm/km / (1e3 kpc/Mpc * kpc)
    H0_s = H0 * 1e5 / (1e3 * kpc)
    return H0_s * np.sqrt(Om0*(1+z)**3 + OL)

def t_hubble(z):
    """Hubble time [Myr]."""
    return 1.0 / Hz(z) / Myr

def Deltavir(z):
    """Virial overdensity (Bryan & Norman 1998)."""
    x = Om0*(1+z)**3 / (Om0*(1+z)**3 + OL) - 1.0
    return 18*np.pi**2 + 82*x - 39*x**2

def rhocrit(z):
    """Critical density [g/cm^3]."""
    return 3 * Hz(z)**2 / (8*np.pi*G)

def rvir(Mh, z):
    """Virial radius [kpc]."""
    rhov = Deltavir(z) * rhocrit(z)
    return (3*Mh*Msun / (4*np.pi*rhov))**(1/3) / kpc

def Tvir(Mh, z):
    """Virial temperature [K]."""
    rv = rvir(Mh, z) * kpc
    return mu*mp*G*Mh*Msun / (2*kB*rv)

def concentration(Mh, z):
    """Dutton & Maccio 2014 mass-concentration."""
    c = 10.0 * (Mh / 5e12 * h)**(-0.101) * (1+z)**(-1.0)
    return max(min(c, 30.0), 2.5)

# ============================================================================
# CDM & FDM characteristic central DM density
# ============================================================================

def nfw_central_rho(Mh, z):
    """
    Effective central DM density for CDM NFW [g/cm^3].
    Use ρ at r = r_s/10 as proxy for the 'core' density.
    (NFW formally diverges at r→0 but baryonic physics regulates it.)
    """
    c = concentration(Mh, z)
    rv = rvir(Mh, z)
    rs = rv / c
    fc = np.log(1+c) - c/(1+c)
    rhos = Mh * Msun / (4*np.pi * (rs*kpc)**3 * fc)  # g/cm^3

    x = 0.1  # r / r_s
    return rhos / (x * (1+x)**2)  # NFW density at 0.1 r_s


def fdm_soliton_central_rho(Mh, z, ma=2e-22):
    """
    FDM soliton central density [g/cm^3].

    Soliton profile: ρ(r) = ρ_c / [1 + (r/r_c)^2]^8  (Schive+14)

    Core-halo mass relation:
      M_core = 0.031 × 10^9 * (ma/2e-22)^-1 * (Mh/1e9)^(1/3)  [Msun]
      (Schive+14 Eq.35, ζ factor ≈ 1 at high z)

    Core radius:
      r_c = 1.6 * (ma/2e-22)^-1 * (Mh/1e9)^(-1/3)  [kpc]
      (from Schive+14 core density-radius-mass relation)
    """
    # Soliton mass from core-halo relation
    Mcore = 0.031e9 * (ma/2e-22)**(-1) * (Mh/1e9)**(1/3)

    # Core radius [kpc]
    rc_kpc = 1.6 * (ma/2e-22)**(-1) * (Mh/1e9)**(-1/3)

    # Integral I = ∫_0^∞ x^2/(1+x^2)^8 dx
    I, _ = quad(lambda x: x**2/(1+x**2)**8, 0, 100, limit=200)

    # ρ_c = M_core / (4π r_c^3 I)
    rho_c = Mcore * Msun / (4*np.pi * (rc_kpc*kpc)**3 * I)  # g/cm^3

    return rho_c, rc_kpc, Mcore


# ============================================================================
# H2 chemistry & cooling (simplified but physical)
# ============================================================================

def H2_abundance_equilibrium(n_H, T, x_e=2e-4, J_21=0.0, N_H2=None):
    """
    Equilibrium H2 abundance n_H2/n_H.

    Formation via H- channel: H + e- → H- + γ  (rate ∝ T^0.88)
                              H- + H → H2 + e- (fast associative detachment)

    Destruction: photodissociation by LW photons (if J_21 > 0)
                 + collisional dissociation (negligible at low T)

    Self-shielding when N_H2 > 10^14 cm^-2.
    """
    # H- formation rate coefficient (Tegmark+97, Galli&Palla 98)
    k_Hm = 1.0e-18 * T**0.88  # cm^3/s

    # Formation rate: dn_H2/dt = k_Hm * n_H * n_e
    n_e = x_e * n_H
    form_rate_per_H2 = k_Hm * n_e  # per unit n_H → n_H2

    # Destruction
    if J_21 > 0 and N_H2 is not None and N_H2 > 0:
        # Draine & Bertoldi 1996 self-shielding
        x = N_H2 / 5e14
        f_shield = 0.965 / (1 + x/1.1)**1.1 + \
                   0.035 / np.sqrt(1 + x) * np.exp(-8.5e-4 * np.sqrt(1 + x))
        k_dest = 1.1e8 * J_21 * f_shield  # s^-1
    else:
        k_dest = 0.0

    # No destruction: fraction = min(formation_rate * t_Hubble, 1)
    # With destruction: steady-state n_H2/n_H = form_rate / k_dest
    if k_dest > 0:
        nH2_over_nH = form_rate_per_H2 / k_dest
    else:
        # Limited by Hubble time: at most this much H2 can form
        tau_H = 1.0 / Hz(Tvir(Mh, z)) if 'z' in dir() else 3e16  # fallback
        nH2_over_nH = min(form_rate_per_H2 * 1e16, 1.0)

    return min(nH2_over_nH, 0.5)  # cap at 50%


def H2_cooling_rate(n_H, T, x_H2):
    """
    H2 cooling rate per unit volume [erg/cm^3/s].

    Uses the standard low-density H2 rotational cooling approximation
    from Galli & Palla 1998 / Tegmark+97:

      L_LTE(T) ≈ 10^(-24.0) * (T/1000K)^3  [erg cm^3/s]  (per H2 per H)

    with critical density correction: Λ = n_H2 * n_H * L/(1 + n_crit/n_H)

    Valid for T ~ 120-2000 K (rotational/vibrational H2 lines).
    """
    if T < 10 or n_H < 1e-10 or x_H2 < 1e-20:
        return 0.0

    n_H2 = x_H2 * n_H
    T_kK = T / 1000.0

    # H2 LTE cooling coefficient [erg cm^3/s]
    # Galli & Palla 1998 low-density approximation:
    #   log10(L_LTE) ≈ -24 + 3*log10(T/1000) for T < 2000K (rotational)
    #   log10(L_LTE) ≈ -22 + 2*log10(T/1000) for T > 2000K (vibrational)
    if T <= 600:
        L_LTE = 10**(-24.5) * T_kK**3
    elif T <= 2000:
        L_LTE = 10**(-24.0) * T_kK**3
    else:
        L_LTE = 10**(-22.0) * T_kK**2

    # Critical density for H2 rotational lines [cm^-3]
    # Scaling: n_crit ≈ 10^4 (T/100K)^0.5
    n_crit = 1e4 * (T / 100.0)**0.5

    # Cooling rate per unit volume with sub-thermal correction
    Lambda = n_H2 * n_H * L_LTE / (1.0 + n_crit / max(n_H, 1e-10))

    return max(Lambda, 1e-40)


# H2 cooling minimum temperature: below this, H2 rotational/vibrational
# lines are not excited → no radiative cooling
T_H2_MIN = 120.0  # K (H2 J=2→0 line at 510K / 4 for sub-thermal excitation)

def cooling_condition(Mh, z, dm_type='CDM', ma=2e-22, J_21=0.0):
    """
    Check if molecular cooling is efficient enough for star formation.

    Physics:
      CDM: Threshold set by T_vir > T_H2_MIN (gas too cold to excite H2 lines
           below this). Above threshold, the NFW cusp concentrates gas to high
           density → H2 forms quick → cooling runaway. The exact M_crit from
           full 3D sims is Fialkov+12: 3.3e7 (1+z)^-1.5.

      FDM: In addition to T_vir > T_H2_MIN, the soliton core caps the central
           gas density at a value that scales strongly with Mh (∝Mh^(4/3)).
           At low Mh, the soliton density is too low for H2 to form within
           a free-fall time → cooling fails → requires larger Mh.

    This function computes the SOLITON-CORE contribution to the FDM threshold.
    The CDM path returns a simple T_vir-based flag.
    """
    T_v = Tvir(Mh, z)

    # ---- Hard floor: T_vir must exceed H2 excitation threshold ----
    if T_v < T_H2_MIN:
        return False, 1e30, 1e30, {"reason": f"Tvir={T_v:.0f}K < {T_H2_MIN}K"}

    # ---- CDM: above T_vir threshold, cooling always works ----
    # (NFW cusp provides unlimited central compression)
    if dm_type == 'CDM':
        # In reality the exact value comes from 3D sims (Fialkov+12).
        # Our model just says: if T_vir > T_H2_MIN, it cools.
        return True, 1e-6, 1e-3, {"reason": "CDM cusp → efficient cooling"}

    # ---- FDM: soliton core limits central density ----
    rho_c, rc_kpc, Mcore = fdm_soliton_central_rho(Mh, z, ma)

    if rho_c < 1e-35:
        return False, 1e30, 1e30, {"reason": "soliton ρ_c too small"}

    # Gas density in soliton core (n_H ≈ fb * ρ_c * X_H / (μ mp))
    n_H = fb * rho_c * X_H / (mu * mp)

    # Temperature for cooling check:
    # Physics: gas cools from T_vir toward the H2 effective range.
    # H2 rotational cooling peaks around 200-500K, vibrational above 2000K.
    # Using T_vir directly is wrong: (a) very high T_vir → vibrational H2
    # is too weak at low density; (b) T ~ 1000K hits singularity in fit.
    # The temperature that matters is where H2 operates (~500K, rotational).
    # Use capped T_vir = min(T_vir, 800K) to stay safely in rotational regime.
    T = min(T_v, 800.0)
    # Also ensure minimum: H2 lines need T > T_H2_MIN to be excited
    T = max(T, T_H2_MIN)

    # H2 abundance: formation-limited (no destruction without LW)
    k_Hm = 1.0e-18 * T**0.88    # H- formation rate coeff [cm^3/s]
    x_e = 2.0e-4                 # residual ionization

    if J_21 > 0:
        # With LW: destruction competes with formation
        N_H2_init = 1e10
        x_H2 = 1e-10
        for _ in range(8):
            N_H2 = x_H2 * n_H * rc_kpc * kpc
            # Self-shielding
            x = N_H2 / 5e14
            f_shield = 0.965/(1+x/1.1)**1.1 + \
                       0.035/np.sqrt(1+x)*np.exp(-8.5e-4*np.sqrt(1+x))
            k_dest = 1.1e8 * J_21 * f_shield  # s^-1
            form_rate = k_Hm * x_e * n_H       # cm^-3 s^-1
            if k_dest > 0:
                x_H2_new = form_rate / (k_dest * n_H)
            else:
                x_H2_new = form_rate * t_hubble(z) * Myr
            x_H2_new = min(x_H2_new, 0.5)
            if abs(x_H2_new - x_H2) / max(x_H2, 1e-15) < 0.01:
                break
            x_H2 = x_H2_new
    else:
        # No LW: H2 forms freely, limited by Hubble time
        t_form_H2 = 1.0 / max(k_Hm * x_e, 1e-30)  # s, time to convert one H to H2
        t_H = t_hubble(z) * Myr
        x_H2 = min(t_H / t_form_H2, 0.5)

    x_H2 = max(x_H2, 0.0)
    if x_H2 < 1e-15:
        return False, 1e30, 1e30, {
            "reason": f"x_H2={x_H2:.1e} too small",
            "n_H": n_H, "T": T, "rho_c": rho_c
        }

    # Cooling rate
    Lambda = H2_cooling_rate(n_H, T, x_H2)
    if Lambda < 1e-38:
        return False, 1e30, 1e30, {
            "reason": "Lambda=0", "n_H": n_H, "T": T, "x_H2": x_H2
        }

    # Timescales
    eth = 1.5 * n_H * kB * T
    t_cool_s = eth / Lambda
    t_ff_s = np.sqrt(3*np.pi/(32*G*rho_c))
    t_cool_Myr = t_cool_s / Myr
    t_ff_Myr  = t_ff_s / Myr

    can_cool = t_cool_Myr < t_ff_Myr

    details = {
        "rho_c": rho_c, "n_H": n_H, "T": T, "Tvir": T_v,
        "x_H2": x_H2, "rc_kpc": rc_kpc, "Mcore": Mcore,
        "t_cool_Myr": t_cool_Myr, "t_ff_Myr": t_ff_Myr,
        "t_hubble_Myr": t_hubble(z),
    }

    return can_cool, t_cool_Myr, t_ff_Myr, details


# ============================================================================
# Find M_crit via binary search
# ============================================================================

def find_mcrit_vir(z):
    """
    CDM M_crit from T_vir == T_H2_MIN.
    This is the baseline mass threshold from virial temperature alone.
    """
    # Tvir ∝ Mh^(2/3) (1+z)
    # M_crit_VIR = M_ref * (T_H2_MIN/T_ref(z))^(3/2)
    # where T_ref = Tvir(M_ref, z)

    # Binary search for M where Tvir(M, z) = T_H2_MIN
    if Tvir(1e4, z) > T_H2_MIN:
        return 1e4
    if Tvir(1e12, z) < T_H2_MIN:
        return np.inf

    M_crit = bisect(lambda M: Tvir(M, z) - T_H2_MIN, 1e4, 1e12, xtol=1e3)
    return M_crit


def find_mcrit_fdm(z, ma=2e-22, J_21=0.0, M_lo=1e5, M_hi=1e12):
    """
    Find minimum halo mass for FDM soliton-core cooling.

    Uses binary search on the cooling_condition function.
    Also applies the T_vir > T_H2_MIN floor.
    """
    # Floor: T_vir must exceed H2 minimum
    M_Tvir = find_mcrit_vir(z)

    def cools(Mh):
        ok, _, _, _ = cooling_condition(Mh, z, dm_type='FDM', ma=ma, J_21=J_21)
        return ok

    if M_Tvir > 1e11:
        return np.inf

    M_lo_eff = max(M_lo, M_Tvir * 0.5)

    if cools(M_lo_eff):
        return M_lo_eff
    if not cools(M_hi):
        return np.inf

    try:
        mc = bisect(lambda M: not cools(M), M_lo_eff, M_hi, xtol=1e4, maxiter=200)
        return max(mc, M_Tvir)  # never go below T_vir floor
    except Exception:
        return np.inf


# ============================================================================
# Fit mcrit_noLW = M0 * (1+z)^α
# ============================================================================

def fit_powerlaw(z_arr, mcrit_arr):
    """Fit log10(mcrit) = log10(M0) + α * log10(1+z)."""
    mask = np.isfinite(mcrit_arr) & (mcrit_arr > 0)
    if mask.sum() < 3:
        return 1e10, 0.0, {"error": "too few points"}
    logM = np.log10(mcrit_arr[mask])
    log1pz = np.log10(1 + z_arr[mask])
    coeffs = np.polyfit(log1pz, logM, 1)
    alpha = coeffs[0]
    M0 = 10**coeffs[1]
    mc_fit = M0 * (1 + z_arr)**alpha
    err = np.abs(mcrit_arr[mask] - mc_fit[mask]) / mcrit_arr[mask]
    return M0, alpha, {"max_err": np.max(err), "mean_err": np.mean(err)}


def fit_LW(J_arr, mc_arr, mc_0):
    """Fit mc(J)/mc(0) - 1 = A * J^B."""
    y = mc_arr / mc_0 - 1.0
    ok = (J_arr > 0) & (y > 0)
    if ok.sum() < 3:
        return 2.0, 0.6, {}
    logJ = np.log10(J_arr[ok])
    logy = np.log10(y[ok])
    c = np.polyfit(logJ, logy, 1)
    B = c[0]; A = 10**c[1]
    return A, B, {}


# ============================================================================
# MAIN
# ============================================================================

def main():
    print("="*72)
    print("FDM Molecular Cooling Threshold Calculator v2")
    print("for thermochem.c: lyman_werner_threshold() parameters")
    print("="*72)

    z_list = np.array([5, 8, 10, 12, 15, 20, 25, 30])
    ma_list = [1e-22, 2e-22, 5e-22, 1e-21]
    J_LW_test = [0.0, 0.01, 0.1, 1.0, 10.0]

    # --- Part 1: CDM baseline (Fialkov+12, hardcoded) ---
    print("\n" + "-"*50)
    print("1. CDM mcrit_noLW (Fialkov+12)  [not computed, taken as reference]")
    print("-"*50)
    print(f"{'z':>6s}  {'Fialkov+12':>16s}  {'Tvir threshold':>18s}")
    mc_cdm = []
    for z in z_list:
        fialk = 3.314e7 * (1+z)**(-1.5)
        mc_cdm.append(fialk)
        M_Tvir = find_mcrit_vir(z)
        print(f"{z:6.1f}  {fialk:16.2e}  {M_Tvir:18.2e}")
    print(f"\n  CDM baseline: mcrit_noLW = 3.314e7 * (1+z)^(-1.5)")

    # --- Part 2: FDM thresholds ---
    print("\n" + "-"*50)
    print("2. FDM mcrit (from soliton-core cooling model)")
    print("-"*50)

    fdm_all = {}
    for ma in ma_list:
        print(f"\n  m_a = {ma:.1e} eV:")
        print(f"  {'z':>6s}  {'M_crit_FDM':>16s}  {'Tvir_floor':>14s}  "
              f"{'ratio_FDM/CDM':>16s}")
        mc_arr = []
        for i, z in enumerate(z_list):
            mc = find_mcrit_fdm(z, ma=ma)
            mc_arr.append(mc)
            M_Tvir = find_mcrit_vir(z)
            if np.isfinite(mc):
                ratio = mc / mc_cdm[i]
            else:
                ratio = np.inf
            print(f"  {z:6.1f}  {mc:16.2e}  {M_Tvir:14.2e}  {ratio:16.2f}")

        # Fit
        finite = np.array([np.isfinite(m) for m in mc_arr])
        if finite.sum() >= 3:
            M0, alpha, info = fit_powerlaw(z_list[finite],
                                           np.array(mc_arr)[finite])
            fdm_all[ma] = {"M0": M0, "alpha": alpha, "mc_arr": np.array(mc_arr)}
            print(f"  Fit:  M0={M0:.3e},  alpha={alpha:.3f}")
            if "max_err" in info:
                print(f"  Fit errors:  max={info['max_err']:.1%},  "
                      f"mean={info['mean_err']:.1%}")
        else:
            print("  INSUFFICIENT finite points for fit")
            # Use the average ratio as a rough estimate
            finite_ratios = []
            for j, mc in enumerate(mc_arr):
                if np.isfinite(mc) and mc > 0:
                    finite_ratios.append(mc / mc_cdm[j])
            if finite_ratios:
                avg_r = np.mean(finite_ratios)
                fdm_all[ma] = {
                    "M0": 3.314e7 * avg_r,
                    "alpha": -1.5,
                    "ratio": avg_r,
                    "mc_arr": np.array(mc_arr)
                }
                print(f"  Rough estimate: ratio = {avg_r:.2f}")

    # --- Part 3: LW recalibration for FDM ---
    print("\n" + "-"*50)
    print("3. LW feedback: effect of J_21 on FDM mcrit @ z=10")
    print("-"*50)

    zref = 10.0
    for ma in ma_list:
        mc0 = find_mcrit_fdm(zref, ma=ma, J_21=0.0)
        if not np.isfinite(mc0):
            print(f"\n  m_a={ma:.1e}: no cooling baseline → skip LW")
            continue
        print(f"\n  m_a = {ma:.1e} eV:")
        print(f"  {'J_21':>8s}  {'M_crit':>16s}  {'f_LW':>10s}")
        mc_J = []
        for J in J_LW_test:
            mc = find_mcrit_fdm(zref, ma=ma, J_21=J)
            mc_J.append(mc)
            f = mc / mc0 if (np.isfinite(mc) and mc0 > 0) else np.inf
            print(f"  {J:8.3f}  {mc:16.2e}  {f:10.3f}")
        A, B, _ = fit_LW(np.array(J_LW_test), np.array(mc_J), mc0)
        print(f"  Fit:  A_LW={A:.3f},  BETA_LW={B:.3f}")

    # --- Part 4: Diagnostic ---
    print("\n" + "-"*50)
    print("4. Diagnostic: characteristic densities at z=10, Mh=1e8")
    print("-"*50)
    M_diag = 1e8

    # CDM central at 0.1 rs
    rho_cdm = nfw_central_rho(M_diag, 10.0)
    n_cdm = fb * rho_cdm * X_H / (mu * mp)
    T_cdm = Tvir(M_diag, 10.0)
    print(f"  CDM NFW:  ρ(0.1rs)={rho_cdm:.2e} g/cm³,  n_H≈{n_cdm:.2e} cm⁻³,  "
          f"Tvir={T_cdm:.0f} K")

    for ma in ma_list:
        rho_fdm, rc, Mc = fdm_soliton_central_rho(M_diag, 10.0, ma)
        n_fdm = fb * rho_fdm * X_H / (mu * mp)
        print(f"  FDM ma={ma:.1e}: ρ_c={rho_fdm:.2e} g/cm³,  "
              f"n_H≈{n_fdm:.1e} cm⁻³,  rc={rc:.2f}kpc,  "
              f"Mcore={Mc:.1e}Msun")

        # Show if this halo cools
        ok, tc, tf, det = cooling_condition(M_diag, 10.0, 'FDM', ma)
        if 'reason' in det:
            status = det['reason']
        else:
            status = f"t_cool={tc:.2e} Myr, t_ff={tf:.2e} Myr"
        print(f"          Cooling? {'YES' if ok else 'NO'}  [{status}]")

    # --- Part 5: Summary for thermochem.c ---
    print("\n" + "="*72)
    print("SUMMARY: Suggested thermochem.c parameter ranges")
    print("="*72)
    print()
    print("/* Current CDM (lyman_werner_threshold):")
    print("   mcrit_noLW = 3.314e7 * pow(1.+z, -1.5);")
    print("   f_LW       = 1 + 2.0 * pow(J_21, 0.6);")
    print("   f_vcb      = pow(1 + 1.0*vcb/29.0, 1.8);")
    print("*/")
    print()
    for ma in ma_list:
        if ma in fdm_all:
            r = fdm_all[ma]
            print(f"/* --- m_a = {ma:.1e} eV --- */")
            if 'ratio' in r:
                print(f"/* [rough] mcrit_noLW ≈ {r['M0']:.2e} * pow(1.+z, {r['alpha']:.1f});"
                      f"  (ratio ≈ {r['ratio']:.1f} × CDM) */")
            else:
                print(f"/* mcrit_noLW ≈ {r['M0']:.2e} * pow(1.+z, {r['alpha']:.3f}); */")
        else:
            print(f"/* --- m_a = {ma:.1e} eV: no finite mcrit found --- */")
    print()
    print("/* IMPORTANT CAVEATS:")
    print("   - This is a first-order estimate from a static 1D model.")
    print("   - The CDM baseline is Fialkov+12 (not computed by this model).")
    print("   - FDM M_crit is computed from soliton core density + H2 chemistry.")
    print("   - For precision, use the ratio (FDM/CDM) as a multiplicative")
    print("     correction to the Fialkov+12 CDM baseline.")
    print("   - A_VCB, BETA_VCB assumed unchanged (VCB physics ≈ independent of")
    print("     inner DM profile).")
    print("   - reionization_feedback (SM13) needs separate 1D Lagrangian hydro.")
    print("*/")


if __name__ == "__main__":
    main()
