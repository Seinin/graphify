#!/usr/bin/env python3
"""
FDM theory landscape: multi-channel comparison for m_crit paper
===============================================================

Mature FDM frameworks compared against our molecular cooling m_crit^FDM model:

  Channel 1 — HMF suppression (Hu+2000 / Schive+16)
    FDM Jeans scale suppresses low-mass halo formation.
    M_hm = 1.6e10 * m22^(-4/3)  Msun   (Schive+16 Eq.7)
    Already in 21cmFAST's fdm.c via transfer function T_FDM(k).

  Channel 2 — Cooling threshold elevation (THIS WORK)
    Soliton flat core lowers central gas density → higher m_crit.
    M_sol = 1.54e7 * m22^(-1.5)  Msun   (Schive+14 core-halo)
    m_crit^FDM = sqrt(m_crit^CDM^2 + M_sol^2)

  Channel 3 — Wave-mechanics turbulence (Tocher+2026)
    Schroedinger-Poisson fluctuations inject angular momentum.
    Suppression > soliton geometry alone in ACG-mass halos.

Observational constraints overlaid:
  Lyman-alpha forest:  Iršič+17, Armengaud+17, Rogers & Peiris+21
  Galaxy UVLF (HST/JWST):  Schive+16
  CMB: Hlozek+17
  Milky Way streams:  Nadler+21 (subhalo bounds)

Output:
  Fig A — 6-panel FDM theory landscape (paper-ready)
  Fig B — m22 parameter space with all constraints
  Fig C — Relative suppression comparison: HMF vs cooling
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
from matplotlib.lines import Line2D
import os

# ---- Matplotlib style ----
plt.rcParams.update({
    'figure.dpi': 150, 'savefig.dpi': 200,
    'font.size': 9.5, 'axes.titlesize': 11.5, 'axes.labelsize': 10.5,
    'legend.fontsize': 7.8, 'font.family': 'DejaVu Sans',
    'mathtext.fontset': 'dejavuserif', 'axes.unicode_minus': False,
})

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
FIG_DIR = os.path.join(OUTPUT_DIR, "..", "testplots")
os.makedirs(FIG_DIR, exist_ok=True)

# ================================================================
# Core physics formulae
# ================================================================

def mcrit_CDM(z):
    """CDM molecular cooling threshold  [Msun] (Fialkov+12 / Visbal+15)."""
    return 3.314e7 * (1.0 + z) ** (-1.5)

def M_sol(m22):
    """Soliton-halo transition mass  [Msun] (Schive+14, 21cmFAST convention)."""
    return 1.54e7 * m22 ** (-1.5)

def M_hm(m22):
    """Half-mode mass (HMF cutoff)  [Msun] (Schive+16 Eq.7)."""
    return 1.6e10 * m22 ** (-4.0 / 3.0)

def mcrit_FDM(m22, z, k=2.0):
    """FDM molecular cooling threshold (geometric-mean interpolation)."""
    mc = mcrit_CDM(z)
    ms = M_sol(m22)
    if np.isinf(k):
        return np.maximum(mc, ms)
    return (mc ** k + ms ** k) ** (1.0 / k)

# ================================================================
# HMF suppression: FDM / CDM halo abundance ratio
# ================================================================

def hmf_suppression_factor(M_h, m22, alpha=1.1, beta=2.2):
    """FDM/CDM halo number density ratio.

    Mature fitting form from N-body simulations:
      n_FDM / n_CDM = [1 + (M_hm / M)^alpha]^(-beta)

    Parameters (from Schive+16, May+21, Dentler+22):
      alpha ~ 1.0-1.2   (steepness of transition)
      beta  ~ 2.0-2.5   (depth of suppression below M_hm)

    Default alpha=1.1, beta=2.2 follow Schive+16 calibration.
    """
    x = M_hm(m22) / M_h
    return (1.0 + x ** alpha) ** (-beta)

# ================================================================
# Observational constraints on m22
# ================================================================

def lyalpha_bounds():
    """Lyman-alpha forest lower bounds on m22.

    Returns list of (m22_min, label, style_dict).

    Sources (multiple independent analyses):
      - Iršič+17 (PRD 96, 023523): wavelet analysis of MIKE+HIRES data
      - Armengaud+17 (MNRAS 471, 4605): 1D flux power spectrum
      - Rogers & Peiris+21 (PRL 126, 071302): Bayesian re-analysis
      - Goldstein+23 (MNRAS 526, 660): latest, most conservative

    Important caveat (widely discussed in literature):
      Intergalactic medium (IGM) temperature and thermal history
      uncertainties can weaken Ly-alpha bounds by factor ~2-5.
      The "aggressive" bound is m22 > 21; "conservative" is m22 > 2-3.
    """
    return [
        # (m22_min, label, style)
        (21.0,  "Iršič+17 ($2\\sigma$)",     dict(ls='-',  lw=1.8, color='C0', alpha=0.55)),
        (29.0,  "Armengaud+17 (95% CL)",     dict(ls='--', lw=1.5, color='C0', alpha=0.45)),
        (3.0,   "Goldstein+23 (baryon-pess.)",dict(ls=':',  lw=1.5, color='C0', alpha=0.35)),
    ]

def uvlf_bounds():
    """Galaxy UV luminosity function bounds on m22.

    Sources:
      - Schive+16 (PRL 116, 201302): HST UVLF at z~4-8 → m22 > 1.2 (2σ)
      - Bozek+15 (MNRAS 450, 209): similar, m22 > 0.5
      - JWST era: ongoing, no definitive FDM bounds yet
    """
    return [
        (1.2,  "Schive+16 UVLF ($2\\sigma$)",  dict(ls='-',  lw=1.8, color='C3', alpha=0.55)),
    ]

def cmb_bounds():
    """CMB bounds (very weak compared to Ly-alpha)."""
    return [
        (0.01, "Hložek+17 Planck ($2\\sigma$)", dict(ls='-.', lw=1.5, color='C5', alpha=0.45)),
    ]

def subhalo_bounds():
    """Subhalo / strong lensing / stellar stream bounds."""
    return [
        (0.5,  "Nadler+21 stream ($2\\sigma$)",  dict(ls='--', lw=1.5, color='C4', alpha=0.45)),
    ]

# ================================================================
# Grids
# ================================================================
Z_GRID  = np.linspace(4, 40, 200)
M22_FINE = np.logspace(np.log10(0.15), np.log10(60), 150)
M22_LIST = [0.3, 0.5, 1.0, 2.0, 5.0, 10.0, 50.0]
M_HALO  = np.logspace(4.0, 10, 120)
Z_REF = np.array([5, 8, 10, 15, 20, 25, 30])

COLORS = plt.cm.viridis(np.linspace(0.05, 0.95, len(M22_LIST)))

# ================================================================
# FIGURE A: 6-panel comprehensive theory landscape (paper figure)
# ================================================================

def make_figure_A():
    """6-panel figure for paper:
    (a) m_crit curves: CDM, FDM, HMF cutoff
    (b) m22 parameter space with observ. constraints
    (c) Relative suppression: HMF vs cooling at z=10
    (d) Which channel dominates? — (m22, M_h) regime map
    (e) Cumulative SFE suppression: CDM vs FDM
    (f) Physical scale hierarchy: M_sol vs M_hm vs M_J
    """
    fig = plt.figure(figsize=(17, 11))
    gs = GridSpec(2, 3, figure=fig, hspace=0.33, wspace=0.28,
                  top=0.945, bottom=0.06, left=0.065, right=0.975)

    # -- (a) m_crit curves: CDM | FDM | M_hm --------------------------
    ax = fig.add_subplot(gs[0, 0])
    ax.plot(Z_GRID, mcrit_CDM(Z_GRID), 'k-', lw=3.2,
            label=r'$m_{\rm crit}^{\rm CDM}$ (Fialkov+12)', zorder=10)
    for i, m22 in enumerate(M22_LIST):
        mc = mcrit_FDM(m22, Z_GRID, k=2)
        ax.plot(Z_GRID, mc, color=COLORS[i], lw=1.7,
                label=rf'$m_{{{{22}}}}={m22}$')
    # also plot M_hm for each m22 as horizontal reference
    for m22, c in [(0.5, COLORS[1]), (1.0, COLORS[2]), (5.0, COLORS[4])]:
        ax.axhline(y=M_hm(m22), color=c, ls=':', lw=0.7, alpha=0.35)
    ax.annotate(r'$M_{\rm hm}$ ref.', xy=(36, M_hm(0.5)*0.4), fontsize=7,
                color='gray', alpha=0.6)
    ax.set(xlabel='$z$', ylabel=r'$m_{\rm crit}\;[M_\odot]$',
           title='(a) Cooling thresholds')
    ax.set_yscale('log'); ax.set_xlim(4, 40); ax.set_ylim(3e4, 5e9)
    ax.legend(fontsize=7, loc='lower left', ncol=2, framealpha=0.85)
    ax.grid(True, alpha=0.2, ls='--')

    # -- (b) m22 parameter space with all observ. constraints ----------
    ax = fig.add_subplot(gs[0, 1])
    m22_2d, z_2d = np.meshgrid(
        np.logspace(np.log10(0.15), np.log10(60), 120),
        np.linspace(4, 40, 110))
    ratio_2d = mcrit_FDM(m22_2d, z_2d, k=2) / mcrit_CDM(z_2d)
    cm = ax.pcolormesh(m22_2d, z_2d, np.log10(ratio_2d),
                        cmap='RdYlBu_r', shading='auto', vmin=0, vmax=3.0)
    cs = ax.contour(m22_2d, z_2d, np.log10(ratio_2d),
                     levels=np.log10([2, 5, 10, 50, 100]),
                     colors='k', linewidths=0.7, alpha=0.45)
    ax.clabel(cs, inline=True, fontsize=7, fmt=lambda x: f'{10**x:.0f}x')
    plt.colorbar(cm, ax=ax, pad=0.02,
                 label=r'$\log_{10}(m_{\rm crit}^{\rm FDM}\,/\,m_{\rm crit}^{\rm CDM})$')

    # Overlay observational constraints
    for m22_min, label, sty in lyalpha_bounds():
        ax.axvline(x=m22_min, **sty)
    for m22_min, label, sty in uvlf_bounds():
        ax.axvline(x=m22_min, **sty)
    for m22_min, label, sty in cmb_bounds():
        ax.axvline(x=m22_min, **sty)
    for m22_min, label, sty in subhalo_bounds():
        ax.axvline(x=m22_min, **sty)

    # Shade Ly-alpha excluded region
    ax.axvspan(0.15, 2.0, ymin=0, ymax=1, color='C0', alpha=0.06, zorder=0)
    ax.text(0.3, 37, r'Ly-$\alpha$ excluded', fontsize=7.5, color='C0',
            rotation=90, alpha=0.65, va='top', ha='center')

    ax.set(xlabel=r'$m_{22}\;[10^{-22}\,{\rm eV}]$', ylabel='$z$',
           title='(b) m_crit ratio + observational bounds')
    ax.set_xscale('log')

    # -- (c) Two independent FDM channels at z=10 -----------------
    #   Physics:
    #     solid line  = SFE fraction f_cool = exp(-m_crit^FDM / M_h)
    #                   → fraction of halos of mass M_h that CAN cool
    #     dashed line = abundance fraction f_abund = n_FDM(M_h) / n_CDM(M_h)
    #                   → how many halos of mass M_h EXIST relative to CDM
    #   The total SFRD modulation at mass M_h is f_abund * f_cool.
    ax = fig.add_subplot(gs[0, 2])
    z_plot = 10
    m22_plot = [0.5, 1.0, 2.0, 5.0, 10.0]
    colors_plot = [COLORS[1], COLORS[2], COLORS[3], COLORS[4], COLORS[5]]

    for m22, c in zip(m22_plot, colors_plot):
        # Cooling efficiency (SFE suppression within halos that exist)
        sf_cool = np.exp(-mcrit_FDM(m22, z_plot, k=2) / M_HALO)
        ax.plot(M_HALO, sf_cool, color=c, lw=2.0, ls='-',
                label=rf'SFE, $m_{{{22}}}={m22}$')
        # Halo abundance (how many halos exist)
        sf_hmf = hmf_suppression_factor(M_HALO, m22, alpha=1.1, beta=2.2)
        ax.plot(M_HALO, sf_hmf, color=c, lw=1.2, ls='--', alpha=0.55)

    # CDM reference: abundance = 1 (no HMF suppression), cooling = exp(-mcrit_CDM/M)
    ax.plot(M_HALO, np.exp(-mcrit_CDM(z_plot)/M_HALO), 'k-', lw=3.0, label='CDM SFE')
    # Legend for line styles
    custom_lines = [
        Line2D([0],[0], color='gray', lw=2.0, ls='-',  label=r'SFE frac. $\exp(-m_{\rm crit}/M_h)$'),
        Line2D([0],[0], color='gray', lw=1.5, ls='--', label=r'Abundance frac. $n_{\rm FDM}/n_{\rm CDM}$'),
    ]
    leg1 = ax.legend(handles=custom_lines, fontsize=7.2, loc='lower right',
                     framealpha=0.85)
    ax.add_artist(leg1)
    ax.set(xlabel=r'$M_h\;[M_\odot]$', ylabel='Fraction relative to CDM',
           title=rf'(c) SFE fraction (solid) vs halo abundance (dashed), $z={z_plot}$')
    ax.set_xscale('log'); ax.set_ylim(-0.04, 1.06)
    ax.grid(True, alpha=0.2, ls='--')

    # -- (d) Regime map: which channel dominates? ---------------------
    ax = fig.add_subplot(gs[1, 0])
    m22_map, mh_map = np.meshgrid(
        np.logspace(np.log10(0.15), np.log10(60), 120),
        np.logspace(4, 10, 120))
    z_map = 10

    cool_supp = 1.0 - np.exp(-mcrit_FDM(m22_map, z_map, k=2) / mh_map)
    hmf_supp  = 1.0 - hmf_suppression_factor(mh_map, m22_map, alpha=1.1, beta=2.2)

    # dominance metric: 0 = cooling dominates, 1 = HMF dominates
    dominance = hmf_supp / (cool_supp + hmf_supp + 1e-30)

    cm2 = ax.pcolormesh(m22_map, mh_map, dominance,
                         cmap='coolwarm', shading='auto', vmin=0, vmax=1)
    plt.colorbar(cm2, ax=ax, pad=0.02,
                 label=r'$f_{\rm abund} / (f_{\rm cool}+f_{\rm abund})$')

    # contour lines at 0.25, 0.5, 0.75
    ax.contour(m22_map, mh_map, dominance, levels=[0.25, 0.5, 0.75],
               colors='k', linewidths=1.0, alpha=0.6)
    ax.text(5, 1.2e9, 'Abundance dominates\n(HMF cutoff)', fontsize=7.8,
            color='C3', alpha=0.7, ha='center')
    ax.text(0.4, 2e6, 'Efficiency dominates\n(m_crit threshold)', fontsize=7.8,
            color='C0', alpha=0.7, ha='center')

    # Overlay M_sol line
    ax.plot(M22_FINE, M_sol(M22_FINE), 'k--', lw=1.2, alpha=0.6, label=r'$M_{\rm sol}$')
    ax.plot(M22_FINE, M_hm(M22_FINE), 'k:', lw=1.2, alpha=0.6, label=r'$M_{\rm hm}$')
    ax.legend(fontsize=7.5, loc='lower left', framealpha=0.85)
    ax.set(xlabel=r'$m_{22}\;[10^{-22}\,{\rm eV}]$', ylabel=r'$M_h\;[M_\odot]$',
           title=rf'(d) Dominant FDM channel: abundance vs SFE ($z={z_map}$)')
    ax.set_xscale('log'); ax.set_yscale('log')

    # -- (e) Total SFRD modulation: abundance * efficiency -------------
    ax = fig.add_subplot(gs[1, 1])
    # Physics: d(SFRD)/dlnM ∝ n(M) * f_cool(M) * M
    #   n_FDM(M) / n_CDM(M)  = f_abund  (halo abundance fraction)
    #   f_cool_FDM / f_cool_CDM = exp(-mcrit_FDM/M) / exp(-mcrit_CDM/M)
    #   total SFRD modulation @ mass M = f_abund * f_cool_FDM / f_cool_CDM
    #
    # N.B. This is NOT "star formation efficiency" — it is the product
    #      of halo number density suppression AND cooling efficiency
    #      suppression, i.e., the total modulation of star formation
    #      RATE DENSITY contributed by halos of mass M_h.
    m22_ex = [0.5, 1.0, 5.0]
    c_ex = [COLORS[1], COLORS[2], COLORS[4]]
    z_ex = 10

    for m22, c in zip(m22_ex, c_ex):
        sf_cool = np.exp(-mcrit_FDM(m22, z_ex, k=2) / M_HALO)
        sf_hmf  = hmf_suppression_factor(M_HALO, m22)
        # Total SFRD modulation = abundance * (FDM cooling / CDM cooling)
        total = sf_hmf * sf_cool / np.exp(-mcrit_CDM(z_ex) / M_HALO)
        ax.plot(M_HALO, total, color=c, lw=2.0,
                label=rf'Total (abund$\times$SFE), $m_{{{22}}}={m22}$')
        ax.plot(M_HALO, sf_cool / np.exp(-mcrit_CDM(z_ex) / M_HALO),
                color=c, lw=1.0, ls='--', alpha=0.45)
        ax.plot(M_HALO, sf_hmf, color=c, lw=1.0, ls=':', alpha=0.45)

    # CDM: abundance=1, cooling=exp(-mcrit_CDM/M) → total factor ≡ 1
    ax.axhline(y=1.0, color='k', lw=2.5, ls='--', alpha=0.5, label='CDM (=1)')

    ax.set(xlabel=r'$M_h\;[M_\odot]$',
           ylabel=r'SFRD modulation (FDM / CDM)',
           title=rf'(e) Total SFRD modulation = abund $\\times$ SFE ($z={z_ex}$)')
    ax.set_xscale('log'); ax.set_ylim(-0.04, 1.06)
    ax.legend(fontsize=7, loc='lower right', framealpha=0.85)
    ax.grid(True, alpha=0.2, ls='--')

    # -- (f) Physical scale hierarchy ---------------------------------
    ax = fig.add_subplot(gs[1, 2])
    ms = M_sol(M22_FINE)
    mh = M_hm(M22_FINE)

    # Compute Jeans mass for FDM (Hui+17 review, Marsh 2016)
    # M_J_FDM ~ 2e7 * m22^(-3/2) * (1+z)^(3/2)  (from de Broglie wavelength argument)
    mj_10 = 2.0e7 * M22_FINE ** (-1.5) * (11.0) ** 0.75   # at z=10
    mj_20 = 2.0e7 * M22_FINE ** (-1.5) * (21.0) ** 0.75   # at z=20

    ax.fill_between(M22_FINE, 1e3, ms, alpha=0.07, color='C0')
    ax.fill_between(M22_FINE, ms, mj_10, alpha=0.04, color='C2')
    ax.fill_between(M22_FINE, mj_10, mh, alpha=0.03, color='orange')

    ax.plot(M22_FINE, ms, 'C0-', lw=2.5, label=r'$M_{\rm sol}$ (cooling)')
    ax.plot(M22_FINE, mh, 'C1-', lw=2.5, label=r'$M_{\rm hm}$ (HMF cutoff)')
    ax.plot(M22_FINE, mj_10, 'C2--', lw=1.5, alpha=0.7,
            label=r'$M_J^{\rm FDM}\;(z{=}10)$')
    ax.plot(M22_FINE, mj_20, 'C2:', lw=1.2, alpha=0.5,
            label=r'$M_J^{\rm FDM}\;(z{=}20)$')

    # Annotations
    ax.text(0.18, 1.2e11, 'HMF cutoff', fontsize=7.5, color='C1', alpha=0.65)
    ax.text(0.18, 1.5e8,  'FDM Jeans', fontsize=7.5, color='C2', alpha=0.6)
    ax.text(0.18, 1.8e5,  'Soliton cooling', fontsize=7.5, color='C0', alpha=0.65)

    ax.set(xlabel=r'$m_{22}\;[10^{-22}\,{\rm eV}]$',
           ylabel=r'Mass scale $[M_\odot]$',
           title='(f) Physical scale hierarchy')
    ax.set_xscale('log'); ax.set_yscale('log')
    ax.set_xlim(0.15, 60); ax.set_ylim(3e3, 5e11)
    ax.legend(fontsize=8, loc='lower left', framealpha=0.9)
    ax.grid(True, alpha=0.2, ls='--')

    fig.suptitle(
        'FDM Theory Landscape: two independent channels — abundance (HMF) & efficiency (m_crit)',
        fontsize=14, fontweight='bold', y=0.985)

    for fmt in ['pdf', 'png']:
        fig.savefig(os.path.join(FIG_DIR, f'fdm_theory_landscape.{fmt}'),
                    dpi=200, bbox_inches='tight')
    print(f"  Fig A -> {FIG_DIR}/fdm_theory_landscape.*")
    plt.close(fig)


# ================================================================
# FIGURE B: m22 parameter space with ALL constraints
# ================================================================

def make_figure_B():
    """Single large panel: (m22, z) space with all FDM physics and
    observational constraints overlaid."""
    fig, ax = plt.subplots(figsize=(11, 7.5))

    m22_2d, z_2d = np.meshgrid(
        np.logspace(np.log10(0.12), np.log10(70), 140),
        np.linspace(2, 45, 130))
    ratio_2d = mcrit_FDM(m22_2d, z_2d, k=2) / mcrit_CDM(z_2d)
    cm = ax.pcolormesh(m22_2d, z_2d, np.log10(ratio_2d),
                        cmap='RdYlBu_r', shading='auto', vmin=0, vmax=3.0)
    cs = ax.contour(m22_2d, z_2d, np.log10(ratio_2d),
                     levels=np.log10([1.5, 2, 3, 5, 10, 30, 100, 300]),
                     colors='k', linewidths=0.6, alpha=0.4)
    ax.clabel(cs, inline=True, fontsize=7, fmt=lambda x: f'{10**x:.0f}x')
    plt.colorbar(cm, ax=ax, pad=0.015,
                 label=r'$\log_{10}R = \log_{10}(m_{\rm crit}^{\rm FDM}\,/\,m_{\rm crit}^{\rm CDM})$')

    # ---- Observational constraints ----
    # Ly-alpha
    for m22_min, label, sty in lyalpha_bounds():
        ax.axvline(x=m22_min, **sty)
    # UVLF
    for m22_min, label, sty in uvlf_bounds():
        ax.axvline(x=m22_min, **sty)
    # CMB
    for m22_min, label, sty in cmb_bounds():
        ax.axvline(x=m22_min, **sty)
    # Subhalo
    for m22_min, label, sty in subhalo_bounds():
        ax.axvline(x=m22_min, **sty)

    # Shade regions
    ax.axvspan(0.12, 2.0, color='C0', alpha=0.06, zorder=0)
    ax.text(0.3, 43, r'Ly-$\alpha$ forest', fontsize=8, color='C0',
            rotation=90, alpha=0.6, ha='center', va='top')
    ax.axvspan(0.12, 1.0, color='C3', alpha=0.04, zorder=0)
    ax.text(0.55, 43, 'UVLF', fontsize=8, color='C3',
            rotation=90, alpha=0.5, ha='center', va='top')

    # ---- FDM physics regions ----
    # M_sol > m_crit^CDM boundary
    z_sol = np.linspace(2, 45, 100)
    m22_sol_eq = np.array([np.interp(1.0, M_sol(M22_FINE)/mcrit_CDM(z), M22_FINE)
                           for z in z_sol])
    # approximate: where M_sol = m_crit^CDM
    # M_sol = 1.54e7 * m22^(-1.5), m_crit^CDM = 3.314e7 * (1+z)^(-1.5)
    # → 1.54e7 * m22^(-1.5) = 3.314e7 * (1+z)^(-1.5)
    # → m22 = (1.54/3.314)^(-2/3) * (1+z)
    # → m22 ≈ 1.7 * (1+z)  (approximately)

    # M_hm = m_crit^CDM boundary
    z_hm = np.linspace(2, 45, 100)
    m22_hm_eq = np.array([np.interp(1.0, M_hm(M22_FINE)/mcrit_CDM(z), M22_FINE)
                           for z in z_sol])

    # Physical regime annotations
    ax.text(0.25, 7, 'FDM dominant\n(cooling + HMF)', fontsize=8.5, color='C0',
            ha='left', va='bottom', fontweight='bold', alpha=0.75)
    ax.text(8, 6, 'CDM-like regime', fontsize=8.5, color='C3',
            ha='left', va='bottom', fontweight='bold', alpha=0.75)
    ax.text(3, 38, 'High-z molecular\ncooling domain\n(this work)', fontsize=8,
            color='k', ha='center', va='top', alpha=0.6)

    # ---- Comparison with Mocz+2019 and Nori&Baldi ----
    ax.annotate('Mocz+19: first-star\ncooling delay (3D sim)',
                xy=(2.5, 27), fontsize=7, color='darkgreen', alpha=0.7,
                ha='left')
    ax.annotate('Nori&Baldi 21/22:\nSFR suppression\n(cosmo. hydro sims)',
                xy=(1.0, 18), fontsize=7, color='darkgreen', alpha=0.7,
                ha='left')
    ax.annotate('Tocher+26:\nwave dynamics\n(ACG halos)',
                xy=(0.25, 16), fontsize=7, color='darkgreen', alpha=0.7,
                ha='left')

    ax.set(xlabel=r'$m_{22}\;[10^{-22}\,{\rm eV}]$', ylabel='Redshift $z$',
           title='FDM parameter space: m_crit cooling model + observational constraints + related work')
    ax.set_xscale('log')
    ax.set_xlim(0.12, 70); ax.set_ylim(2, 45)

    fig.tight_layout()
    for fmt in ['pdf', 'png']:
        fig.savefig(os.path.join(FIG_DIR, f'fdm_m22_parameter_space.{fmt}'),
                    dpi=200, bbox_inches='tight')
    print(f"  Fig B -> {FIG_DIR}/fdm_m22_parameter_space.*")
    plt.close(fig)


# ================================================================
# FIGURE C: Direct model comparison — cooling vs HMF vs CDM
# ================================================================

def make_figure_C():
    """3x3 grid: for 3 m22 values and 3 redshifts, show TWO
    independent FDM channels relative to CDM:

      abundance ratio:  n_FDM(M_h) / n_CDM(M_h)   (halo number density)
      efficiency ratio: f_cool^FDM / f_cool^CDM    (SFE within halos)
      total SFRD ratio: abundance × efficiency     (final observable)

    Key physical distinction:
      - Abundance = how many halos EXIST (HMF cutoff)
      - Efficiency = what fraction of existing halos COOL (m_crit)
      - Total = observable SFRD modulation at that mass
    """
    m22_list = [0.5, 1.0, 5.0]
    z_list = [8, 15, 25]
    colors_3 = ['C0', 'C2', 'C4']

    fig, axes = plt.subplots(3, 3, figsize=(16, 13), sharex=True, sharey=True)

    for i, m22 in enumerate(m22_list):
        for j, z in enumerate(z_list):
            ax = axes[j, i]
            f_cdm  = np.exp(-mcrit_CDM(z) / M_HALO)          # CDM SFE
            f_fdm  = np.exp(-mcrit_FDM(m22, z, k=2) / M_HALO) # FDM SFE
            f_hmf  = hmf_suppression_factor(M_HALO, m22)      # FDM abundance

            # All plotted relative to CDM
            ax.plot(M_HALO, np.ones_like(M_HALO), 'k-', lw=2.5, alpha=0.5,
                    label='CDM (=1)')
            ax.plot(M_HALO, f_fdm / f_cdm, lw=2.0, color=colors_3[i], ls='-',
                    label=r'SFE ratio $f_{\rm cool}^{\rm FDM}/f_{\rm cool}^{\rm CDM}$')
            ax.plot(M_HALO, f_hmf,  lw=1.5, color=colors_3[i], ls='--', alpha=0.6,
                    label=r'Halo abund. $n_{\rm FDM}/n_{\rm CDM}$')
            ax.plot(M_HALO, f_hmf * f_fdm / f_cdm, lw=2.2, color=colors_3[i],
                    ls='-', alpha=0.85,
                    label=r'Total SFRD $n\times f_{\rm cool}$', zorder=5)

            ax.axhline(y=0.5, color='gray', ls=':', lw=0.6, alpha=0.4)
            ax.set_xscale('log'); ax.set_ylim(-0.04, 1.06)
            ax.grid(True, alpha=0.15, ls='--')

            if j == 2:
                ax.set_xlabel(r'$M_h\;[M_\odot]$')
            if i == 0:
                ax.set_ylabel(r'Ratio relative to CDM')
            ax.set_title(rf'$m_{{{22}}}={m22},\; z={z}$', fontsize=11,
                         fontweight='bold')
            ax.legend(fontsize=6.5, loc='lower right', framealpha=0.8)

    fig.suptitle(
        'FDM multi-channel: halo abundance (HMF) vs star formation efficiency (m_crit)',
        fontsize=14, fontweight='bold', y=1.008)
    fig.tight_layout()

    for fmt in ['pdf', 'png']:
        fig.savefig(os.path.join(FIG_DIR, f'fdm_channel_comparison.{fmt}'),
                    dpi=200, bbox_inches='tight')
    print(f"  Fig C -> {FIG_DIR}/fdm_channel_comparison.*")
    plt.close(fig)


# ================================================================
# Numeric summary table
# ================================================================

def print_summary_table():
    print("\n" + "="*78)
    print("FDM Theory Landscape — Numerical Summary")
    print("="*78)
    print()
    print("Comparing mature FDM channels with our m_crit model:")
    print()

    z_list = [5, 10, 15, 20, 25]
    m22_list = [0.3, 0.5, 1.0, 2.0, 5.0, 10.0, 50.0]

    print(f"{'m22':>6s}  {'M_sol':>10s}  {'M_hm':>10s}  "
          f"{'M_sol/M_hm':>10s}  " +
          "  ".join([f"{'R(z='+str(z)+')':>9s}" for z in z_list]))
    print("-"*78)

    for m22 in m22_list:
        ms = M_sol(m22)
        mh = M_hm(m22)
        ratios = [f"{mcrit_FDM(m22, z, k=2)/mcrit_CDM(z):.0f}x" for z in z_list]
        print(f"{m22:6.1f}  {ms:10.2e}  {mh:10.2e}  "
              f"{ms/mh:10.2e}  " +
              "  ".join([f"{r:>9s}" for r in ratios]))

    print()
    print("--- Channel dominance at z=10 ---")
    print(f"{'m22':>6s}  {'M_h range: cool > HMF':>25s}  "
          f"{'M_h range: HMF > cool':>25s}  {'Transition M_h':>15s}")
    print("-"*78)

    for m22 in [0.5, 1.0, 2.0, 5.0, 10.0]:
        cool = 1 - np.exp(-mcrit_FDM(m22, 10, k=2) / M_HALO)
        hmf_s = 1 - hmf_suppression_factor(M_HALO, m22)
        cool_dom = cool > hmf_s
        hmf_dom = hmf_s > cool

        cool_range = f"{M_HALO[cool_dom][0]:.1e}–{M_HALO[cool_dom][-1]:.1e}" if np.any(cool_dom) else "—"
        hmf_range = f"{M_HALO[hmf_dom][0]:.1e}–{M_HALO[hmf_dom][-1]:.1e}" if np.any(hmf_dom) else "—"
        # transition where they cross
        diff = np.abs(cool - hmf_s)
        if np.min(diff) < 0.1:
            m_trans = M_HALO[np.argmin(diff)]
            trans_str = f"{m_trans:.1e}"
        else:
            trans_str = "no crossing"
        print(f"{m22:6.1f}  {cool_range:>25s}  {hmf_range:>25s}  {trans_str:>15s}")

    print()
    print("--- Observational m22 bounds ---")
    print(f"  {'Constraint':<30s}  {'m22 min':>8s}  {'Ref':>30s}")
    print(f"  {'Lyman-alpha (aggressive)':<30s}  {'21':>8s}  {'Iršič+17':>30s}")
    print(f"  {'Lyman-alpha (conservative)':<30s}  {'3':>8s}  {'Goldstein+23':>30s}")
    print(f"  {'Galaxy UVLF (HST)':<30s}  {'1.2':>8s}  {'Schive+16':>30s}")
    print(f"  {'CMB (Planck)':<30s}  {'0.01':>8s}  {'Hložek+17':>30s}")
    print(f"  {'Stellar streams':<30s}  {'0.5':>8s}  {'Nadler+21':>30s}")

    print()
    print("--- Related numerical work ---")
    print(f"  {'Mocz+19':<30s}  {'First-star cooling in 3D FDM sims':<55s}")
    print(f"  {'Nori&Baldi 21/22':<30s}  {'SFR suppression in cosmo FDM hydro':<55s}")
    print(f"  {'May+21':<30s}  {'Core-halo relation refinement (AxiREPO)':<55s}")
    print(f"  {'Dentler+22':<30s}  {'Comprehensive FDM constraint compilation':<55s}")
    print()


# ================================================================
# Main
# ================================================================

def main():
    print("FDM Theory Landscape Comparison")
    print("="*60)
    print("Comparing our m_crit model with mature FDM frameworks:")
    print()

    make_figure_A()
    make_figure_B()
    make_figure_C()
    print_summary_table()

    print("Done. All figures in:", os.path.abspath(FIG_DIR))
    print("  fdm_theory_landscape.{pdf,png}       (6-panel comprehensive)")
    print("  fdm_m22_parameter_space.{pdf,png}     (constraints + regime map)")
    print("  fdm_channel_comparison.{pdf,png}      (3x3 cooling vs HMF)")


if __name__ == "__main__":
    main()
