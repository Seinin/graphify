#!/usr/bin/env python3
"""
FDM mcrit_noLW comparison script

Compares the FDM-modified molecular cooling threshold with the original
CDM mcrit_noLW.

Core formulas:
  m_crit^CDM(z)     = 3.314e7 * (1+z)^{-1.5}              (Fialkov+12)
  M_sol(m22)        = 1.54e7 * m22^{-1.5}                 (Schive+14)
  m_crit^FDM(m22,z) = eq.(1) 的数值解 (中心值):
                        eta_p(u) * (u/r)^gamma = 1
                        u = m_crit^FDM / M_sol,  r = m_crit^CDM / M_sol
                        eta_p(x) = x^p / (1 + x^p)
                      中心参数 p = 1.0, gamma = 0.10

对照族 (仅作对照, 不是中心值, 也不构成误差包络):
  m_k(m22,z) = [ (m_crit^CDM)^k + M_sol^k ]^(1/k),  k in [1, inf]
该族在 k 上单调递减, 其 k >= 1 段只覆盖 [max(a,b), a+b] 这一窄带, 够不到 eq.(1) 的解 (需 k ~ 0.4)
的解 —— 详见 docs/FDM.md §5.6 / §5.8 / §5.13.

Output figures:
  Fig 1: 4-panel main comparison (curves, ratio, m22-scan, suppression)
  Fig 2: Physical scale separation + 2D (m22, z) parameter space
  Fig 3: Suppression factor panels at key redshifts
  Fig 4: 6-panel comprehensive numerical comparison
"""

import numpy as np
from scipy.optimize import brentq
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as _fm
from matplotlib.gridspec import GridSpec
import os

# ---- Matplotlib style ----
def _register_cjk_font():
    """注册系统中文字体。

    matplotlib 默认只扫描 /usr/share/fonts, 不会发现装在 ~/.fonts 下的
    Noto Sans CJK 等中文字体; 不注册的话图中中文全部渲染成方框。
    """
    import glob
    pats = ('~/.fonts/*.otf', '~/.fonts/*.ttf', '~/.fonts/**/*.otf',
            '/usr/share/fonts/**/*CJK*.otf', '/usr/share/fonts/**/*CJK*.ttf',
            '/usr/share/fonts/**/*wqy*.ttf')
    for pat in pats:
        for p in sorted(glob.glob(os.path.expanduser(pat), recursive=True)):
            try:
                _fm.fontManager.addfont(p)
                nm = _fm.FontProperties(fname=p).get_name()
            except Exception:
                continue
            if 'CJK' in nm or 'WenQuanYi' in nm:
                return nm
    return None


_CJK_FONT = _register_cjk_font()

plt.rcParams.update({
    'figure.dpi': 150,
    'savefig.dpi': 200,
    'font.size': 10,
    'axes.titlesize': 12,
    'axes.labelsize': 11,
    'legend.fontsize': 8,
    # 若系统无中文字体则回落 DejaVu Sans (中文会显示为方框, 不影响其余图元)
    'font.family': 'sans-serif',
    'font.sans-serif': ([_CJK_FONT] if _CJK_FONT else []) + ['DejaVu Sans'],
    'mathtext.fontset': 'dejavuserif',
    'axes.unicode_minus': False,
})

# Output directory
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
FIG_DIR = os.path.join(OUTPUT_DIR, "..", "testplots")
os.makedirs(FIG_DIR, exist_ok=True)

# ================================================================
# Core formulae
# ================================================================

def mcrit_CDM(z):
    """CDM molecular cooling threshold (Fialkov+12; Visbal+15 calib)."""
    return 3.314e7 * (1.0 + z) ** (-1.5)

def M_sol(m22):
    """FDM soliton-halo transition mass (Schive+14)."""
    return 1.54e7 * m22 ** (-1.5)

P_REF = 1.0
GAMMA_REF = 0.10

def eta_hill(x, p=P_REF):
    """Hill suppression factor eta_p(x) = x^p / (1 + x^p)."""
    xp = np.asarray(x, dtype=float) ** p
    return xp / (1.0 + xp)

def _mcrit_exact_scalar(m22, z, p, gamma):
    """eq.(1) 在单点 (m22, z) 上的数值解. gamma <= 0 时退化, 直接报错."""
    if gamma <= 0.0:
        raise ValueError(
            f"eq.(1) 在 gamma={gamma} 下退化、无解 —— 「无解」标记不能当数值用"
        )
    mc = float(mcrit_CDM(z))
    ms = float(M_sol(m22))
    log_r = np.log(mc / ms)

    def res(u):
        lu = np.log(u)
        log_eta = p * lu - np.logaddexp(0.0, p * lu)
        return np.expm1(log_eta + gamma * (lu - log_r))

    hi = 1.0
    while res(hi) <= 0.0:
        hi *= 2.0
        if hi > 1e14:
            raise ValueError(
                f"eq.(1) 求根超出搜索上界 (m22={m22}, z={z}, p={p}, gamma={gamma})"
            )
    u = brentq(res, 1e-30, hi, xtol=1e-15, rtol=1e-15)
    return u * ms

def mcrit_FDM(m22, z, k=None, p=P_REF, gamma=GAMMA_REF):
    """FDM MCG cooling threshold -- eq.(1) 的数值解 (中心值).

        eta_p(u) * (u/r)^gamma = 1,
        u = mcrit_FDM / M_sol,   r = mcrit_CDM(z) / M_sol

    左侧在 u 上严格单调递增 (两个正递增函数之积), 从 0 升到
    eta_p(1) * r^(-gamma) > 1, 故根唯一且有限. 这里在 log 空间用等比
    倍增定界, 再对残差函数做 brentq.

    Parameters
    ----------
    m22 : float or ndarray    Axion mass [10^-22 eV]
    z   : float or ndarray    Redshift
    k   : float or None       仅作**对照**用: 传入 k 时返回对照族成员
                              m_k = [(mc)^k + (ms)^k]^(1/k), 而不是中心值.
                              k=None (默认) = eq.(1) 的精确解.
    p   : float               Hill 指数 (默认 1.0)
    gamma : float             eq.(1) 幂指数 (默认 0.10); gamma <= 0 时退化
    """
    if k is not None:
        return mcrit_k(k, m22, z)
    m22a, za = np.broadcast_arrays(
        np.asarray(m22, dtype=float), np.asarray(z, dtype=float))
    if m22a.ndim == 0:
        return _mcrit_exact_scalar(float(m22a), float(za), p, gamma)
    out = np.empty(m22a.shape, dtype=float)
    for idx in np.ndindex(m22a.shape):
        out[idx] = _mcrit_exact_scalar(float(m22a[idx]), float(za[idx]), p, gamma)
    return out

def mcrit_k(k, m22, z):
    """对照族 m_k = [(mcrit_CDM)^k + M_sol^k]^(1/k) -- **仅作对照曲线**.

    在 k 上单调递减, 只覆盖 [max(a,b), a+b] 这一窄带, 不是误差包络,
    也不含 eq.(1) 的解 (详见 docs/FDM.md §5.6 / §5.8 / §5.13).
    """
    mc = np.asarray(mcrit_CDM(z), dtype=float)
    ms = np.asarray(M_sol(m22), dtype=float)
    if np.isinf(k):
        return np.maximum(mc, ms)
    return (mc ** k + ms ** k) ** (1.0 / k)

def r1_inf_analytic(m22, z):
    """族内展宽的解析式 R_1inf = 1 + min(a,b)/max(a,b) in (1, 2] (不依赖求根)."""
    a = np.asarray(mcrit_CDM(z), dtype=float)
    b = np.asarray(M_sol(m22), dtype=float)
    return 1.0 + np.minimum(a, b) / np.maximum(a, b)

def suppression_factor(m_crit, M_halo):
    """exp(-m_crit / M_h) star-formation efficiency cutoff."""
    return np.exp(-np.outer(1.0 / np.atleast_1d(M_halo),
                             np.atleast_1d(m_crit)).T)

def M_hm(m22):
    """HMF half-mode mass (Schive+16 Eq. 7)."""
    return 1.6e10 * m22 ** (-4.0 / 3.0)

# ================================================================
# Parameter grids
# ================================================================
Z_GRID = np.linspace(5, 40, 200)
M22_LIST = [0.3, 0.5, 1.0, 2.0, 5.0, 10.0, 50.0]
M22_FINE = np.logspace(np.log10(0.1), np.log10(100), 120)
M_HALO = np.logspace(4.5, 9, 100)
Z_REF = np.array([5, 10, 15, 20, 25, 30, 35])

COLORS = plt.cm.viridis(np.linspace(0.05, 0.95, len(M22_LIST)))

# ================================================================
# Figure 1: 4-panel main comparison
# ================================================================
def make_figure_1():
    fig = plt.figure(figsize=(14, 11))
    gs = GridSpec(2, 2, figure=fig, hspace=0.30, wspace=0.28,
                  top=0.94, bottom=0.07, left=0.09, right=0.97)

    # (a) m_crit vs redshift
    ax = fig.add_subplot(gs[0, 0])
    ax.plot(Z_GRID, mcrit_CDM(Z_GRID), 'k-', lw=2.8,
            label=r'CDM: $m_{\rm crit}^{\rm CDM}$', zorder=10)
    for i, m22 in enumerate(M22_LIST):
        ax.plot(Z_GRID, mcrit_FDM(m22, Z_GRID), color=COLORS[i], lw=1.9,
                label=rf'$m_{{{{22}}}}={m22}$: eq.(1) 精确解')
        ax.plot(Z_GRID, mcrit_FDM(m22, Z_GRID, k=2), color=COLORS[i],
                lw=0.7, ls='-.', alpha=0.35)
        ax.plot(Z_GRID, mcrit_FDM(m22, Z_GRID, k=1), color=COLORS[i],
                lw=0.5, ls='--', alpha=0.30)
        ax.plot(Z_GRID, mcrit_FDM(m22, Z_GRID, k=np.inf), color=COLORS[i],
                lw=0.5, ls=':', alpha=0.30)
    ax.plot([], [], 'k-.', lw=0.7, alpha=0.5, label=r'对照族: $k=2$')
    ax.plot([], [], 'k--', lw=0.5, alpha=0.5, label=r'对照族: $k=1$ (上界)')
    ax.plot([], [], 'k:', lw=0.5, alpha=0.5,
            label=r'对照族: $k=\infty$ (下确界)')
    ax.set(xlabel='Redshift $z$', ylabel=r'$m_{\rm crit}\;[M_\odot]$',
           title='(a) 中心值 eq.(1) 精确解 vs. 对照族 $m_k$')
    ax.set_yscale('log'); ax.set_xlim(5, 40); ax.set_ylim(1e4, 1e9)
    ax.legend(fontsize=7.5, loc='lower left', ncol=2, framealpha=0.85)
    ax.grid(True, alpha=0.25, linestyle='--')

    # Annotate Msol plateaus
    for m22, c in [(0.5, COLORS[1]), (1.0, COLORS[2]), (5.0, COLORS[4])]:
        ms = M_sol(m22)
        ax.annotate(r'$M_{\rm sol}($' + str(m22) + r'$)$', xy=(14, ms),
                    xytext=(7, ms * 1.8), fontsize=7.5, color=c, alpha=0.7,
                    arrowprops=dict(arrowstyle='->', color=c, alpha=0.45, lw=0.7))

    # (b) Ratio m_crit^FDM / m_crit^CDM
    ax = fig.add_subplot(gs[0, 1])
    for i, m22 in enumerate(M22_LIST):
        ratio = mcrit_FDM(m22, Z_GRID) / mcrit_CDM(Z_GRID)
        ax.plot(Z_GRID, ratio, color=COLORS[i], lw=1.9,
                label=rf'$m_{{{{22}}}}={m22}$')
        # 对照族几何展宽 (解析式, 不依赖求根): 从 k=inf (下确界) 到 k=1 (上界)
        ax.fill_between(Z_GRID, 1.0, r1_inf_analytic(m22, Z_GRID),
                        color=COLORS[i], alpha=0.10)
    ax.axhline(y=1.0, color='k', ls='--', lw=0.8, alpha=0.5)
    ax.set(xlabel='Redshift $z$',
           ylabel=r'$R \equiv m_{\rm crit}^{\rm FDM}\,/\,m_{\rm crit}^{\rm CDM}$',
           title='(b) 精确解比值 + 对照族窄带（阴影为 $R_{1\\infty}$）')
    ax.set_yscale('log'); ax.set_xlim(5, 40); ax.set_ylim(0.9, 5000)
    ax.legend(fontsize=8, loc='upper right', ncol=2, framealpha=0.85)
    ax.grid(True, alpha=0.25, linestyle='--')
    ax.annotate(r'$m_{22}=50$: CDM-like', xy=(35, 1.02), fontsize=8,
                color='gray', ha='right')

    # (c) m_crit vs m22 at fixed z
    ax = fig.add_subplot(gs[1, 0])
    for i, z in enumerate(Z_REF):
        mc_fine = mcrit_FDM(M22_FINE, z)          # eq.(1) 精确解
        c = plt.cm.RdYlBu_r(i / (len(Z_REF) - 1))
        ax.plot(M22_FINE, mc_fine, color=c, lw=1.6, label=rf'$z={z}$')
        ax.plot(M22_FINE, mcrit_FDM(M22_FINE, z, k=2), color=c,
                lw=0.6, ls='-.', alpha=0.35)
    ax.plot([], [], 'k-.', lw=0.6, alpha=0.5, label=r'对照族 $k=2$')
    ms_fine = M_sol(M22_FINE)
    ax.plot(M22_FINE, ms_fine, 'k--', lw=1.3, alpha=0.5,
            label=r'$M_{\rm sol}$ (flat regime)')
    ax.set(xlabel=r'$m_{22}\;[10^{-22}\,{\rm eV}]$',
           ylabel=r'$m_{\rm crit}^{\rm FDM}\;[M_\odot]$',
           title=r'(c) $m_{\rm crit}^{\rm FDM}(m_{22})$: 精确解 vs. 对照')
    ax.set_xscale('log'); ax.set_yscale('log')
    ax.legend(fontsize=7.5, loc='upper right', framealpha=0.85)
    ax.grid(True, alpha=0.25, linestyle='--')

    # (d) Suppression factor at z=15
    ax = fig.add_subplot(gs[1, 1])
    z_plot = 15
    sf_cdm = np.exp(-mcrit_CDM(z_plot) / M_HALO)
    ax.plot(M_HALO, sf_cdm, 'k-', lw=3.0, label='CDM', zorder=10)
    for i, m22 in enumerate(M22_LIST):
        mc_fdm = mcrit_FDM(m22, z_plot)           # eq.(1) 精确解
        sf_fdm = np.exp(-mc_fdm / M_HALO)
        ax.plot(M_HALO, sf_fdm, color=COLORS[i], lw=1.9,
                label=rf'$m_{{{{22}}}}={m22}$')
        sf_k2 = np.exp(-mcrit_FDM(m22, z_plot, k=2) / M_HALO)
        ax.plot(M_HALO, sf_k2, color=COLORS[i], lw=0.6, ls='-.', alpha=0.35)
    ax.plot([], [], 'k-.', lw=0.6, alpha=0.5, label=r'对照族 $k=2$')
    ax.set(xlabel=r'$M_h\;[M_\odot]$',
           ylabel=r'$\exp(-m_{\rm crit}/M_h)$',
           title=rf'(d) 恒星形成抑制因子（精确解 vs. 对照，$z={z_plot}$）')
    ax.set_xscale('log'); ax.set_ylim(-0.02, 1.02)
    ax.legend(fontsize=7.5, loc='lower right', ncol=2, framealpha=0.85)
    ax.grid(True, alpha=0.25, linestyle='--')

    fig.suptitle(
        r'FDM $m_{\rm crit}$: 中心值 = eq.(1) 精确解；细线为对照族 $m_k$',
        fontsize=14, fontweight='bold', y=0.98)

    for fmt in ['pdf', 'png']:
        fig.savefig(os.path.join(FIG_DIR, f'fdm_mcrit_panel1.{fmt}'),
                    dpi=200, bbox_inches='tight')
    print(f"  Fig 1 -> {FIG_DIR}/fdm_mcrit_panel1.*")
    plt.close(fig)


# ================================================================
# Figure 2: Physical scale separation + 2D parameter space
# ================================================================
def make_figure_2():
    fig = plt.figure(figsize=(14, 6))
    gs = GridSpec(1, 2, figure=fig, hspace=0.28, wspace=0.28,
                  top=0.92, bottom=0.15, left=0.08, right=0.97)

    # (a) Msol and Mhm vs m22
    ax = fig.add_subplot(gs[0, 0])
    ms = M_sol(M22_FINE); mh = M_hm(M22_FINE)
    ax.fill_between(M22_FINE, 1e4, ms, alpha=0.08, color='C0')
    ax.fill_between(M22_FINE, ms, mh, alpha=0.05, color='orange')
    ax.fill_between(M22_FINE, mh, 1e13, alpha=0.03, color='green')
    ax.plot(M22_FINE, ms, 'C0-', lw=2.2, label=r'$M_{\rm sol}$ (cooling suppression)')
    ax.plot(M22_FINE, mh, 'C1-', lw=2.2, label=r'$M_{\rm hm}$  (HMF cutoff)')
    for m22_x, label_y in [(0.3, 0.25), (1.0, 0.45), (3.0, 0.62)]:
        ratio = M_hm(m22_x) / M_sol(m22_x)
        ax.annotate(r'$M_{\rm hm}/M_{\rm sol}\approx' + f'{ratio:.0f}' + r'\times$',
                    xy=(m22_x, M_sol(m22_x)),
                    xytext=(m22_x*0.22, M_hm(m22_x)*20),
                    fontsize=8.5, color='gray',
                    arrowprops=dict(arrowstyle='->', color='gray', alpha=0.5, lw=0.7))
    ax.set(xlabel=r'$m_{22}\;[10^{-22}\,{\rm eV}]$',
           ylabel=r'Mass scale $[M_\odot]$',
           title=r'(a) Physical scale separation: $M_{\rm sol} \ll M_{\rm hm}$')
    ax.set_xscale('log'); ax.set_yscale('log')
    ax.set_xlim(0.1, 100); ax.set_ylim(3e3, 1e12)
    ax.legend(fontsize=9.5, loc='lower left', framealpha=0.9)
    ax.grid(True, alpha=0.25, linestyle='--')
    ax.text(0.18, 8e10, r'$\leftarrow$ HMF cutoff dominant', fontsize=8, color='green', alpha=0.6)
    ax.text(0.18, 4e8,  r'$\leftarrow$ Mixed regime', fontsize=8, color='orange', alpha=0.6)
    ax.text(0.18, 3e5,  r'$\leftarrow$ Cooling dominant', fontsize=8, color='C0', alpha=0.6)

    # (b) 2D colour map
    ax = fig.add_subplot(gs[0, 1])
    m22_grid, z_grid = np.meshgrid(
        np.logspace(np.log10(0.1), np.log10(100), 100),
        np.linspace(5, 40, 105))
    ratio_2d = mcrit_FDM(m22_grid, z_grid) / mcrit_CDM(z_grid)
    cm = ax.pcolormesh(m22_grid, z_grid, np.log10(ratio_2d),
                        cmap='RdYlBu_r', shading='auto', vmin=0, vmax=3.5)
    cs = ax.contour(m22_grid, z_grid, np.log10(ratio_2d),
                     levels=np.log10([2, 5, 10, 50, 100, 500]),
                     colors='k', linewidths=0.8, alpha=0.5)
    ax.clabel(cs, inline=True, fontsize=7, fmt=lambda x: f'{10**x:.0f}x')
    plt.colorbar(cm, ax=ax, pad=0.02,
                 label=r'$\log_{10}R = \log_{10}(m_{\rm crit}^{\rm FDM}/m_{\rm crit}^{\rm CDM})$')
    for m22 in [0.3, 0.5, 1.0, 2.0, 5.0, 10.0, 50.0]:
        ax.axvline(x=m22, color='white', ls='--', lw=0.4, alpha=0.4)
    ax.set(xlabel=r'$m_{22}\;[10^{-22}\,{\rm eV}]$', ylabel='$z$',
           title='(b) 精确解比值 $R(m_{22}, z)$ 参数平面')
    ax.set_xscale('log')

    fig.suptitle('FDM MCG cooling: Physical scales & parameter space',
                 fontsize=14, fontweight='bold')
    for fmt in ['pdf', 'png']:
        fig.savefig(os.path.join(FIG_DIR, f'fdm_mcrit_parameterspace.{fmt}'),
                    dpi=200, bbox_inches='tight')
    print(f"  Fig 2 -> {FIG_DIR}/fdm_mcrit_parameterspace.*")
    plt.close(fig)


# ================================================================
# Figure 3: Suppression factor at key redshifts
# ================================================================
def make_figure_3():
    z_list = [8, 15, 25]
    m22_subset = [0.5, 1.0, 2.0, 5.0, 10.0]
    colors_fdm = plt.cm.plasma(np.linspace(0.1, 0.9, len(m22_subset)))

    fig, axes = plt.subplots(1, 3, figsize=(16, 5.5), sharey=True)

    for i, z in enumerate(z_list):
        ax = axes[i]
        sf_cdm = np.exp(-mcrit_CDM(z) / M_HALO)
        ax.plot(M_HALO, sf_cdm, 'k-', lw=3.0, label='CDM', zorder=10)
        for j, m22 in enumerate(m22_subset):
            sf_fdm = np.exp(-mcrit_FDM(m22, z) / M_HALO)      # eq.(1) 精确解
            ax.plot(M_HALO, sf_fdm, color=colors_fdm[j], lw=1.8,
                    label=rf'$m_{{{22}}}={m22}$')
            sf_k2 = np.exp(-mcrit_FDM(m22, z, k=2) / M_HALO)
            ax.plot(M_HALO, sf_k2, color=colors_fdm[j],
                    lw=0.6, ls='-.', alpha=0.35)
        ax.plot([], [], 'k-.', lw=0.6, alpha=0.5, label=r'对照 $k=2$')
        ax.axhline(y=0.5, color='gray', ls=':', alpha=0.35)
        ax.set_xscale('log'); ax.set_xlim(M_HALO[0], M_HALO[-1])
        ax.set_ylim(-0.03, 1.05)
        ax.set_xlabel(r'$M_h\;[M_\odot]$')
        if i == 0:
            ax.set_ylabel(r'$\exp(-m_{\rm crit}/M_h)$')
        ax.set_title(rf'$z={z}$', fontsize=13, fontweight='bold')
        ax.grid(True, alpha=0.2, linestyle='--')
        ax.legend(fontsize=7.5, loc='lower right', framealpha=0.85)

    fig.suptitle(
        r'Molecular-cooling SFE suppression: $\exp(-m_{\rm crit}^{\rm FDM}/M_h)$ vs. CDM',
        fontsize=14, fontweight='bold')
    fig.tight_layout(rect=[0, 0, 1, 0.94])

    for fmt in ['pdf', 'png']:
        fig.savefig(os.path.join(FIG_DIR, f'fdm_mcrit_suppression.{fmt}'),
                    dpi=200, bbox_inches='tight')
    print(f"  Fig 3 -> {FIG_DIR}/fdm_mcrit_suppression.*")
    plt.close(fig)


# ================================================================
# Figure 4: 6-panel comprehensive
# ================================================================
def make_figure_4():
    fig, axes = plt.subplots(2, 3, figsize=(17, 10))
    axes = axes.flatten()

    # (1) m_crit vs z, all m22
    ax = axes[0]
    ax.plot(Z_GRID, mcrit_CDM(Z_GRID), 'k-', lw=3.0, label='CDM')
    for i, m22 in enumerate(M22_LIST):
        ax.plot(Z_GRID, mcrit_FDM(m22, Z_GRID), color=COLORS[i],
                lw=1.8, label=rf'$m_{{{22}}}={m22}$')
        ax.plot(Z_GRID, mcrit_FDM(m22, Z_GRID, k=2), color=COLORS[i],
                lw=0.6, ls='-.', alpha=0.35)
    ax.plot([], [], 'k-.', lw=0.6, alpha=0.5, label=r'对照 $k=2$')
    ax.set(xlabel='$z$', ylabel=r'$m_{\rm crit}\;[M_\odot]$',
           title=r'(1) $m_{\rm crit}^{\rm FDM}(z)$: 精确解 vs. CDM')
    ax.set_yscale('log')
    ax.legend(fontsize=7, loc='lower left', ncol=2)
    ax.grid(True, alpha=0.25, linestyle='--')

    # (2) m_crit vs m22 at ref z
    ax = axes[1]
    for z in Z_REF:
        ax.plot(M22_FINE, mcrit_FDM(M22_FINE, z), lw=1.6, label=rf'$z={z}$')
    ax.plot(M22_FINE, M_sol(M22_FINE), 'k--', lw=1.5, alpha=0.6,
            label=r'$M_{\rm sol}$')
    ax.set(xlabel=r'$m_{22}$', ylabel=r'$m_{\rm crit}^{\rm FDM}\;[M_\odot]$',
           title=r'(2) $m_{\rm crit}^{\rm FDM}(m_{22})$: 精确解')
    ax.set_xscale('log'); ax.set_yscale('log')
    ax.legend(fontsize=7, loc='upper right')
    ax.grid(True, alpha=0.25, linestyle='--')

    # (3) Ratio vs z
    ax = axes[2]
    for i, m22 in enumerate(M22_LIST):
        ratio = mcrit_FDM(m22, Z_GRID) / mcrit_CDM(Z_GRID)
        ax.plot(Z_GRID, ratio, color=COLORS[i], lw=1.8,
                label=rf'$m_{{{22}}}={m22}$')
        ax.fill_between(Z_GRID, 1.0, r1_inf_analytic(m22, Z_GRID),
                        color=COLORS[i], alpha=0.10)
    ax.axhline(y=1, color='k', ls='--', alpha=0.4)
    ax.set(xlabel='$z$',
           ylabel=r'$R = m_{\rm crit}^{\rm FDM}/m_{\rm crit}^{\rm CDM}$',
           title='(3) 精确解比值 $R(z)$（阴影：对照族窄带）')
    ax.set_yscale('log')
    ax.legend(fontsize=7, loc='upper right', ncol=2)
    ax.grid(True, alpha=0.25, linestyle='--')

    # (4) SFE suppression ratio for key halo masses at z=15
    ax = axes[3]
    z_demo = 15
    Mh_demo = np.array([3e5, 1e6, 3e6, 1e7])
    x_pos = np.arange(len(M22_LIST))
    bar_width = 0.18

    for j_idx, Mh in enumerate(Mh_demo):
        sf_fdm = np.array([np.exp(-mcrit_FDM(m22, z_demo) / Mh)
                           for m22 in M22_LIST])
        ratio_sf = sf_fdm / np.exp(-mcrit_CDM(z_demo) / Mh)
        ax.bar(x_pos + j_idx * bar_width, ratio_sf, bar_width,
               label=rf'$M_h = {Mh:.0e}\;M_\odot$' if Mh >= 1e6
                     else rf'$M_h = {Mh/1e5:.1f}\times10^5$',
               alpha=0.80)
    ax.axhline(y=1.0, color='k', ls='--', alpha=0.5, lw=0.8)
    ax.set(xlabel=r'$m_{22}$', ylabel=r'$f_{\rm FDM}/f_{\rm CDM}$',
           title=rf'(4) SFE compression ratio（精确解，$z={z_demo}$）')
    ax.set_xticks(x_pos + 1.5 * bar_width)
    ax.set_xticklabels([str(m) for m in M22_LIST])
    ax.legend(fontsize=7, loc='lower left')
    ax.grid(True, alpha=0.2, linestyle='--', axis='y')

    # (5) 2D SFE ratio map (m_h, z) for m22=1
    ax = axes[4]
    m22_ex = 1.0
    Mh_grid, z_grid_5 = np.meshgrid(
        np.logspace(5, 9, 80), np.linspace(5, 40, 80))
    mc_fdm_2d = mcrit_FDM(m22_ex, z_grid_5)        # eq.(1) 精确解
    mc_cdm_2d = mcrit_CDM(z_grid_5)
    sf_ratio = np.exp(-mc_fdm_2d / Mh_grid) / np.exp(-mc_cdm_2d / Mh_grid)
    cm5 = ax.pcolormesh(Mh_grid, z_grid_5, sf_ratio,
                         cmap='RdYlBu_r', shading='auto', vmin=0, vmax=1)
    cs5 = ax.contour(Mh_grid, z_grid_5, sf_ratio,
                      levels=[0.1, 0.3, 0.5, 0.7, 0.9],
                      colors='k', linewidths=0.8, alpha=0.5)
    ax.clabel(cs5, inline=True, fontsize=7, fmt='%.1f')
    plt.colorbar(cm5, ax=ax, pad=0.02, label=r'SFE ratio $f_{\rm FDM}/f_{\rm CDM}$')
    ax.set(xlabel=r'$M_h\;[M_\odot]$', ylabel='$z$',
           title=r'(5) SFE ratio map: $f_{\rm FDM}/f_{\rm CDM}$ ($m_{22}=$' + f'{m22_ex})')
    ax.set_xscale('log')

    # (6) Summary: R(m22) at key z
    ax = axes[5]
    z_summ = np.array([5, 10, 20, 30])
    colors_summ = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728']
    for i_z, z in enumerate(z_summ):
        ax.plot(M22_FINE, mcrit_FDM(M22_FINE, z) / mcrit_CDM(z),
                color=colors_summ[i_z], lw=1.8, label=rf'$z={z}$')
        ax.plot(M22_FINE, mcrit_FDM(M22_FINE, z, k=2) / mcrit_CDM(z),
                color=colors_summ[i_z], lw=0.6, ls='-.', alpha=0.35)
    ax.axhline(y=2.0, color='gray', ls=':', alpha=0.4)
    ax.axhline(y=10.0, color='gray', ls=':', alpha=0.4)
    ax.fill_between(M22_FINE, 1, 2, alpha=0.04, color='green')
    ax.fill_between(M22_FINE, 2, 10, alpha=0.04, color='orange')
    ax.text(0.8, 1.3, 'Moderate', fontsize=8, color='green', alpha=0.6, ha='center')
    ax.text(0.4, 4.5, 'Strong suppression', fontsize=8, color='orange', alpha=0.6, ha='center')
    ax.set(xlabel=r'$m_{22}$', ylabel=r'$R = m_{\rm crit}^{\rm FDM}\,/\,m_{\rm crit}^{\rm CDM}$',
           title='(6) Summary: $R(m_{22})$（精确解；细线为对照 $k=2$）')
    ax.set_xscale('log'); ax.set_yscale('log')
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.25, linestyle='--')

    fig.suptitle(
        r'$m_{\rm crit}^{\rm FDM}$: 中心值 = eq.(1) 精确解（细点划线为对照族）',
        fontsize=15, fontweight='bold')
    fig.tight_layout(rect=[0, 0, 1, 0.95])

    for fmt in ['pdf', 'png']:
        fig.savefig(os.path.join(FIG_DIR, f'fdm_mcrit_comprehensive.{fmt}'),
                    dpi=200, bbox_inches='tight')
    print(f"  Fig 4 -> {FIG_DIR}/fdm_mcrit_comprehensive.*")
    plt.close(fig)


# ================================================================
# Numerical tables
# ================================================================
def print_tables():
    print("\n" + "=" * 100)
    print("Table 1:  m_crit^FDM (eq.(1) 精确解) vs. m_crit^CDM")
    print("=" * 100)
    hdr = (f"{'m22':>6s}  {'M_sol [Msun]':>14s}  {'R(z=5)':>8s}  {'R(z=10)':>8s}"
           f"  {'R(z=20)':>8s}  {'R(z=30)':>8s}  {'dev@z=10':>9s}")
    print(hdr); print("-" * 100)
    for m22 in M22_LIST:
        ms = M_sol(m22)
        R = [mcrit_FDM(m22, z) / mcrit_CDM(z) for z in [5, 10, 20, 30]]
        dev = mcrit_FDM(m22, 10) / mcrit_FDM(m22, 10, k=2)
        print(f"{m22:6.1f}  {ms:14.2e}  {R[0]:8.2f}  {R[1]:8.2f}  "
              f"{R[2]:8.2f}  {R[3]:8.2f}  {dev:9.2f}")
    print("  R = m_exact / m_crit^CDM;  dev = m_exact / m(k=2)")
    print("  dev > 1 ⇒ 用 k=2 作中心值会低估 m_crit^FDM 该倍数")

    print("\nTable 2:  exp(-m_crit/M_h) suppression factor at z=10 (精确解)")
    print("-" * 85)
    z_t = 10
    mc_t = mcrit_CDM(z_t)
    mh_t = [1e5, 3e5, 1e6, 3e6, 1e7, 3e7, 1e8]
    parts = [f"{'M_h':>12s}  {'CDM':>8s}"]
    for m22 in M22_LIST:
        parts.append(f"{f'm22={m22}':>10s}")
    print("  ".join(parts))
    print("-" * (30 + len(M22_LIST)*13))
    for Mh in mh_t:
        row = [f"{Mh:12.2e}  {np.exp(-mc_t/Mh):8.4f}"]
        for m22 in M22_LIST:
            row.append(f"{np.exp(-mcrit_FDM(m22, z_t)/Mh):10.4f}")
        print("  ".join(row))

    print("\nTable 3:  Physical scale hierarchy")
    print("-" * 85)
    print(f"{'m22':>6s}  {'M_sol':>14s}  {'M_hm':>14s}  {'M_hm/M_sol':>12s}  {'Regime':>20s}")
    print("-" * 85)
    for m22 in M22_LIST:
        ms, mh = M_sol(m22), M_hm(m22)
        ratio = mh / ms
        regime = ('Cooling-dominated' if ratio > 500 else
                  'Mixed' if ratio > 10 else 'HMF-dominated')
        print(f"{m22:6.1f}  {ms:14.2e}  {mh:14.2e}  {ratio:12.1f}  {regime:>20s}")
    print("=" * 85)


# ================================================================
if __name__ == "__main__":
    print("=" * 60)
    print("  FDM m_crit comparison script")
    print("  中心值 = eq.(1) 精确解；细点划线为对照族 m_k")
    print("  Reference: docs/FDM.md §5.12 / §5.13")
    print("=" * 60)

    print_tables()

    print("\nGenerating figures ...")
    make_figure_1()
    make_figure_2()
    make_figure_3()
    make_figure_4()

    print(f"\nAll figures saved to: {os.path.abspath(FIG_DIR)}/")
    print("  fdm_mcrit_panel1.{pdf,png}        4-panel main comparison")
    print("  fdm_mcrit_parameterspace.{pdf,png}  Scales + 2D parameter map")
    print("  fdm_mcrit_suppression.{pdf,png}     SFE suppression panels")
    print("  fdm_mcrit_comprehensive.{pdf,png}   6-panel full comparison")
    print("\nDone.")
