#!/usr/bin/env python3
"""FDM 两条判据的 m_crit(z) 曲线：同一 m22 用同一颜色。

两条判据（docs/FDM_mcrit_report.md §6.1、§7.6）:
  (i)  温度判据（气体侧）:  m_crit^T(z) = 3.314e7 (1+z)^{-1.5}   [T_vir >= 1e3 K]
       —— 与 m22 无关（DM-blind），故五个 m22 的曲线重合。
  (ii) 密度判据（剖面侧）:  rho_c(m22, M_h) >= rho_crit(T_vir, x_H2)
       孤子标度 rho_c = C_rho m22^2 (M_h/1e9)^{4/3} 反解 (§8.2):
           M_cap(m22) = 1e9 * [ rho_crit / (C_rho m22^2) ]^{3/4}
       —— 固定 T_vir 分支下 rho_crit 不含 z，故 M_cap 与 z 无关。

合成: m_crit^FDM = max( (i), (ii) )，再按 §8.7 与原子通道取 min。

图:
  (a) 两条判据同图，按 m22 配色（虚线=温度判据，实线=密度判据，同色=同 m22）
  (b) 合成后的 FDM 阈值 max 曲线，同一配色

输出: testplots/fdm_mcrit_two_criteria.{png,pdf}
"""

import os
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
import compare_fdm_mcrit as cm  # noqa: E402  注册中文字体 + rcParams

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

# ---------------------------------------------------------------- constants
G = 6.674e-8          # cm^3 g^-1 s^-2
kB = 1.3807e-16       # erg/K
mp = 1.6726e-24       # g
MU_H = 1.30           # rho_gas / (n_H m_p) = 1/X
FB = 0.16             # 重子分数
GCM3_PER_MSUNPC3 = 6.770e-23  # 1 Msun/pc^3 -> g/cm^3
C_RHO = 5.9e-3        # Msun/pc^3, rho_c = C_rho m22^2 (Mh/1e9)^{4/3}
A_MOL = 3.314e7       # Fialkov+12 归一 (T_vir = 1e3 K)
T_REF = 1.0e3         # K
XH2_REF = 1.0e-4


def rho_crit_gcc(T=T_REF, xH2=XH2_REF, L_LTE=None):
    """§3.2 解析密度阈值 [g/cm^3]（判据 t_cool = t_ff 的解）。"""
    if L_LTE is None:
        L_LTE = 1e-24 * (T / 1.0e3) ** 3   # Galli & Palla 98 低密度近似
    Lam_eff = xH2 * L_LTE
    A = 1.5 * (MU_H * mp / FB) * (kB * T / Lam_eff) * np.sqrt(32.0 * G / (3.0 * np.pi))
    return A ** 2


def m_temperature(z, A=A_MOL):
    """温度判据: T_vir >= 1e3 K 的维里质量（Fialkov+12 基线）。"""
    return A * (1.0 + z) ** (-1.5)


def m_atomic(z):
    """原子通道 (T_vir = 1e4 K, mu = 0.59)。"""
    ratio = ((1.0e4 / 0.59) / (T_REF / 1.22)) ** 1.5
    return ratio * m_temperature(z)


def m_cap(m22, rho_c):
    """密度判据闭式解 (§8.2)。"""
    rho_pc3 = rho_c / GCM3_PER_MSUNPC3
    return 1.0e9 * (rho_pc3 / (C_RHO * np.asarray(m22, dtype=float) ** 2)) ** 0.75


def main():
    m22_list = [0.5, 1.0, 2.0, 5.0, 10.0]
    z = np.linspace(6.0, 30.0, 200)

    rho_c = rho_crit_gcc()
    print(f"rho_crit(T=1e3 K, x_H2={XH2_REF:g}) = {rho_c:.4e} g/cm^3 "
          f"= {rho_c/GCM3_PER_MSUNPC3:.4g} Msun/pc^3")

    m_temp = m_temperature(z)
    m_atom = m_atomic(z)
    caps = {m: m_cap(m, rho_c) * np.ones_like(z) for m in m22_list}
    maxima = {m: np.maximum(m_temp, caps[m]) for m in m22_list}
    mult = {m: np.array([cm.mcrit_FDM(m, zz) for zz in z]) for m in m22_list}

    print("\n z=10 [Msun]:")
    print(f"  {'m22':>5} {'温度判据':>12} {'密度判据':>12} {'max':>12} {'乘性路由':>12}")
    i = int(np.argmin(np.abs(z - 10.0)))
    for m in m22_list:
        print(f"  {m:>5.2f} {m_temp[i]:>12.3e} {caps[m][i]:>12.3e} "
              f"{maxima[m][i]:>12.3e} {mult[m][i]:>12.3e}")
    print(f"  (原子通道: {m_atom[i]:.3e})")

    colors = {m: c for m, c in zip(m22_list, plt.cm.viridis(np.linspace(0.05, 0.85, len(m22_list))))}

    fig, axes = plt.subplots(1, 2, figsize=(12.6, 5.2), sharey=True)

    # ---------------- (a) 两条判据，同色 = 同 m22
    ax = axes[0]
    for m in m22_list:
        ax.plot(z, m_temp, ls='--', lw=2.4, color=colors[m], alpha=0.35)
        ax.plot(z, caps[m], ls='-', lw=2.2, color=colors[m])
    ax.annotate(r'五条虚线重合：温度判据与 $m_{22}$ 无关',
                xy=(27.0, m_temp[-1] * 1.06), xytext=(13.0, 3.2e5),
                arrowprops=dict(arrowstyle='->', lw=0.9, color='0.4',
                                connectionstyle='arc3,rad=-0.15'),
                fontsize=8.2, color='0.35')
    handles = [
        Line2D([], [], ls='--', color='0.35', lw=2.4,
               label=r'温度判据 $T_{\rm vir}\geq10^3$ K（$m_{22}$-盲）'),
        Line2D([], [], ls='-', color='0.35', lw=2.2,
               label=r'密度判据 $\rho_c(m_{22})\geq\rho_{\rm crit}$'),
    ] + [Line2D([], [], ls='-', color=colors[m], lw=2.4, label=rf'$m_{{22}}={m:g}$')
         for m in m22_list]
    ax.legend(handles=handles, fontsize=7.2, loc='center left', framealpha=1.0, ncol=1)
    ax.set_title(r'(a) 两条判据（同色 $=$ 同 $m_{22}$）')

    # ---------------- (b) 合成: max
    ax = axes[1]
    ax.plot(z, m_temp, 'k--', lw=1.6, label=r'CDM 基线 $3.314\times10^7(1+z)^{-1.5}$')
    ax.plot(z, m_atom, color='0.45', ls=':', lw=1.5, label=r'原子通道 $T_{\rm vir}=10^4$ K')
    for m in m22_list:
        ax.plot(z, maxima[m], ls='-', lw=2.2, color=colors[m], label=rf'$m_{{22}}={m:g}$')
        ax.plot(z, mult[m], ls='-.', lw=1.3, color=colors[m], alpha=0.85)
    ax.plot([], [], 'k-.', lw=1.3, label='乘性路由（对照）')
    ax.legend(fontsize=7.2, loc='lower left', framealpha=1.0)
    ax.set_title(r'(b) 合成 $\max$(温度, 密度) 与乘性路由对照')

    for ax in axes:
        ax.axvspan(9.9, 10.1, color='k', alpha=0.06)
        ax.set_yscale('log')
        ax.set_ylim(1e3, 2e12)
        ax.set_xlabel('z')
        ax.grid(alpha=0.25, which='both')
    axes[0].set_ylabel(r'$m_{\rm crit}\ [M_\odot]$')

    fig.suptitle(r'FDM 冷却阈值的两条判据与合成：$m_{22}$ 同色', fontsize=12.5)
    fig.tight_layout(rect=(0, 0, 1, 0.95))

    out = os.path.join(_HERE, '..', 'testplots')
    os.makedirs(out, exist_ok=True)
    for ext in ('png', 'pdf'):
        fig.savefig(os.path.join(out, f'fdm_mcrit_two_criteria.{ext}'), bbox_inches='tight')
    print(f"\nSaved: {os.path.abspath(os.path.join(out, 'fdm_mcrit_two_criteria.png'))}")


if __name__ == '__main__':
    main()
