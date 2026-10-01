"""
Method 1 (NUMBER-LIMITED / Poisson) halo sampling visualization.

Layout:
  Top row (Panel A): Conditional HMF heatmap + 3 highlighted δ columns
                      showing expected ⟨N⟩ vs actual sampled N.
  Bottom-left (Panel B): 1D conditional HMF curves + Poisson inset.
  Bottom-right (Panel C): Inverse CDF sampling illustration.

Uses analytic EPS conditional HMF with a σ(M) fit to Planck 2018.
Self-contained — no py21cmfast dependency.
"""

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
from scipy.stats import poisson as pois

# ─── Parameters ───
z = 10.0
delta_c = 1.686
D_z = 0.08
M_cond = 1e12
M_min = 1e8
lnM_min, lnM_cond = np.log(M_min), np.log(M_cond)

# ─── σ(M): analytic fit to Planck 2018 ───
def sigma(M):
    u = np.log10(M) - 10.0
    return 18.0 * 10.0 ** (-0.16 * u - 0.01 * u**2)

def dsigma2_dM(M):
    h = M * 1e-6
    return (sigma(M + h) ** 2 - sigma(M - h) ** 2) / (2 * h)

sigma_cond = sigma(M_cond)

# ─── Conditional EPS HMF ───
def conditional_hmf(lnM, delta):
    M = np.exp(lnM)
    s2 = sigma(M) ** 2
    sc2 = sigma_cond**2
    sigdiff = np.maximum(s2 - sc2, 1e-20)
    del_eff = (delta_c - delta) / D_z
    dsdm = dsigma2_dM(M)
    cmf = (
        -del_eff * dsdm * sigdiff ** (-1.5)
        * np.exp(-del_eff**2 / (2 * sigdiff))
        / np.sqrt(2 * np.pi)
    )
    valid = (s2 > sc2) & (del_eff > 0)
    return np.where(valid, cmf, 0.0)

# ─── Integration grid ───
N_GRID = 1000
lnm = np.linspace(lnM_min, lnM_cond, N_GRID)
dlnm = lnm[1] - lnm[0]
logm = np.log10(np.exp(lnm))

# ─── Highlighted δ values ───
deltas_show = [-0.5, 0.0, 1.0]
colors = ["#e74c3c", "#f39c12", "#2ecc71"]

# ─── Sample halos ───
rng = np.random.default_rng(42)
delta_cells = np.linspace(-0.8, 1.5, 50)
samples = []
cell_info = {}  # δ -> (n_exp, n_draw, masses)

for dv in delta_cells:
    cmf = conditional_hmf(lnm, dv)
    n_exp = M_cond * np.sum(cmf * dlnm)
    n_draw = rng.poisson(max(n_exp, 0))

    if n_draw == 0:
        cell_info[dv] = (n_exp, 0, [])
        continue

    cdf = np.cumsum(cmf)
    if cdf[-1] <= 0:
        cell_info[dv] = (n_exp, 0, [])
        continue
    cdf /= cdf[-1]

    u = rng.uniform(0, 1, n_draw)
    masses = np.interp(u, cdf, np.exp(lnm))
    cell_info[dv] = (n_exp, n_draw, np.log10(masses))
    for lm in np.log10(masses):
        samples.append((dv, lm))

samples = np.array(samples)

# ══════════════════════════════════════════════════════════
# FIGURE
# ══════════════════════════════════════════════════════════
fig = plt.figure(figsize=(16, 10))
gs = GridSpec(2, 2, height_ratios=[1.4, 1], hspace=0.28, wspace=0.25)

# ══════════════════════════════════════════════════════════
# Panel A: Heatmap + highlighted columns (spans full top row)
# ══════════════════════════════════════════════════════════
axA = fig.add_subplot(gs[0, :])

delta_ax = np.linspace(-1, 1.65, 300)
logm_ax = np.linspace(7.5, 12.5, 300)
ZZ = np.zeros((len(logm_ax), len(delta_ax)))
for i, dv in enumerate(delta_ax):
    ZZ[:, i] = M_cond * conditional_hmf(np.log(10**logm_ax), dv)

ZZ_log = np.log10(np.maximum(ZZ, 1e-15))
pcm = axA.pcolormesh(
    delta_ax, logm_ax, ZZ_log, cmap="inferno", shading="auto",
    vmin=-2, vmax=ZZ_log.max(),
)

# All sampled halos as faint dots
axA.scatter(
    samples[:, 0], samples[:, 1],
    s=0.8, c="white", alpha=0.25, edgecolors="none", rasterized=True,
)

# Highlight 3 specific cells
for dv, col in zip(deltas_show, colors):
    idx = np.argmin(np.abs(delta_cells - dv))
    actual_dv = delta_cells[idx]
    n_exp, n_draw, masses = cell_info[actual_dv]

    # Wider highlighted strip
    axA.axvspan(actual_dv - 0.05, actual_dv + 0.05,
                alpha=0.12, color=col, lw=0)
    # Vertical guide lines
    for edge in [actual_dv - 0.05, actual_dv + 0.05]:
        axA.axvline(edge, color=col, lw=0.8, alpha=0.6, ls=":")

    # This cell's halos as colored dots
    if len(masses) > 0:
        axA.scatter(
            np.full_like(masses, actual_dv), masses,
            s=2, c=col, alpha=0.8, edgecolors="none", rasterized=True,
        )

    # Text box — placed at top of strip, inside the plot
    label = (
        f"$\\delta={dv:.1f}$:  "
        f"$\\langle N\\rangle={n_exp:.0f}$  "
        f"$N={n_draw}$"
    )
    axA.text(
        actual_dv, 12.85, label,
        ha="center", va="center", fontsize=8.5, color=col, fontweight="bold",
        bbox=dict(
            boxstyle="round,pad=0.3", facecolor="black",
            edgecolor=col, alpha=0.85,
        ),
    )

axA.set_ylim(7.5, 13.2)
axA.axvline(0, color="white", ls="--", lw=0.6, alpha=0.4)
axA.set_xlabel(r"$\delta$  (density contrast of cell)", fontsize=13)
axA.set_ylabel(r"$\log_{10}(M/M_\odot)$", fontsize=13)
axA.set_title(
    "A)  Each column = one cell.  Brightness = expected halos per $\\ln M$.\n"
    "White dots = all sampled halos.  "
    "Colored strips = zoom-in on 3 cells.",
    fontsize=11,
)
cb = fig.colorbar(pcm, ax=axA, shrink=0.85, pad=0.01)
cb.set_label("$\\log_{10}\\langle N \\rangle$ per $\\ln M$", fontsize=11)

# ══════════════════════════════════════════════════════════
# Panel B: 1D conditional HMF + Poisson inset
# ══════════════════════════════════════════════════════════
axB = fig.add_subplot(gs[1, 0])

for dv, col in zip(deltas_show, colors):
    cmf_1d = conditional_hmf(lnm, dv)
    n_exp = M_cond * np.sum(cmf_1d * dlnm)
    axB.plot(
        logm, M_cond * cmf_1d, color=col, lw=2.5,
        label=f"$\\delta={dv:.1f}$, $\\langle N\\rangle={n_exp:.0f}$",
    )
    axB.fill_between(logm, 1e-3, M_cond * cmf_1d, alpha=0.15, color=col)

axB.set_yscale("log")
axB.set_ylim(1e-3, 5e3)
axB.set_xlim(7.5, 12.5)
axB.set_xlabel(r"$\log_{10}(M/M_\odot)$", fontsize=13)
axB.set_ylabel(r"$M_{\rm cond}\,dn/d\ln M$", fontsize=13)
axB.set_title(
    "B) Conditional HMF at fixed $\\delta$\n"
    "Shaded area = $\\langle N\\rangle$",
    fontsize=11,
)
axB.legend(fontsize=9, loc="upper right")

# Poisson inset
ax_in = axB.inset_axes([0.52, 0.50, 0.44, 0.46])
for dv, col in zip(deltas_show, colors):
    cmf_1d = conditional_hmf(lnm, dv)
    n_exp = M_cond * np.sum(cmf_1d * dlnm)
    k = np.arange(
        max(0, int(n_exp - 5 * np.sqrt(n_exp))),
        int(n_exp + 5 * np.sqrt(n_exp)) + 1,
    )
    pk = pois.pmf(k, n_exp)
    ax_in.bar(k, pk, color=col, alpha=0.4,
              width=max(np.sqrt(n_exp) * 0.15, 0.8))
ax_in.set_xlabel("$N$", fontsize=8)
ax_in.set_ylabel("$P(N)$", fontsize=8)
ax_in.set_title("Step 1: Poisson($\\langle N\\rangle$)", fontsize=8)
ax_in.tick_params(labelsize=7)

# ══════════════════════════════════════════════════════════
# Panel C: Inverse CDF
# ══════════════════════════════════════════════════════════
axC = fig.add_subplot(gs[1, 1])

for dv, col in zip(deltas_show, colors):
    cmf_1d = conditional_hmf(lnm, dv)
    cdf = np.cumsum(cmf_1d)
    if cdf[-1] <= 0:
        continue
    cdf /= cdf[-1]
    axC.plot(logm, cdf, color=col, lw=2, label=f"$\\delta={dv:.1f}$")

    for ui in [0.2, 0.4, 0.6, 0.8]:
        mi = np.interp(ui, cdf, logm)
        axC.annotate(
            "", xy=(mi, ui), xytext=(7.5, ui),
            arrowprops=dict(arrowstyle="->", color=col, lw=0.9, alpha=0.6),
        )
        axC.plot(mi, ui, "o", color=col, ms=4.5, alpha=0.8)

axC.set_xlim(7.5, 12.5)
axC.set_ylim(0, 1)
axC.set_xlabel(r"$\log_{10}(M/M_\odot)$", fontsize=13)
axC.set_ylabel(r"$F(M\,|\,\delta)$", fontsize=13)
axC.set_title(
    "C) Step 2: Inverse CDF sampling\n"
    "$u\\sim U(0,1)\\;\\rightarrow\\;M=F^{-1}(u)$",
    fontsize=11,
)
axC.legend(fontsize=9, loc="upper left")

fig.suptitle(
    f"Method 1: NUMBER-LIMITED (Poisson) Sampling — "
    f"$z={z:.0f}$, $M_{{\\rm cond}}=10^{{{int(np.log10(M_cond))}}}M_\\odot$, "
    f"$M_{{\\rm min}}=10^{{{int(np.log10(M_min))}}}M_\\odot$",
    fontsize=14, fontweight="bold", y=1.00,
)

plt.savefig(
    "/home/dministrat/21cmFAST_fork/scripts/method1_poisson_visualization.png",
    dpi=200, bbox_inches="tight",
)
print("Saved: scripts/method1_poisson_visualization.png")
