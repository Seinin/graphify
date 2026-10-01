"""Figure: rho_CDM(r) and rho_FDM(r) vs the threshold rho_crit -> r_cool.

CDM  : NFW cusp            -> intersects rho_crit  -> r_cool      (doc S4)
FDM  : soliton core + NFW  -> may miss  rho_crit   -> no r_cool   (doc S6)

Common halo: z=20, Delta_vir=200, C=10, x_H2=1e-4, m22=1, T_vir=1e3 K.
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

G, kB, mp, Msun, kpc, pc = 6.674e-8, 1.381e-16, 1.673e-24, 1.989e33, 3.086e21, 3.086e18
H0, Om0, OL = 67.4, 0.315, 0.685
mu, mu_H, fb = 1.22, 1.3, 0.16
z, Deltavir, x_H2, T_vir, C, m22 = 20.0, 200.0, 1.0e-4, 1.0e3, 10.0, 1.0
Mm1n0 = 3.1e7          # doc S2.2  M_min,0


def Hz(z):
    return H0 * 1e5 / (1e3 * kpc) * np.sqrt(Om0 * (1 + z) ** 3 + OL)


rho_bar_vir = Deltavir * 3 * Hz(z) ** 2 / (8 * np.pi * G)

# --- rho_crit (doc S3), r-independent ---
Lam_eff = x_H2 * 1e-24 * (T_vir / 1e3) ** 3
rho_crit = ((1.5 * mu_H * mp / fb) * (kB * T_vir / Lam_eff)
            * np.sqrt(32 * G / (3 * np.pi))) ** 2

# --- halo that gives T_vir at this z ---
Mg = np.logspace(4, 10, 3000)
rv_of = lambda M: (3 * M * Msun / (4 * np.pi * rho_bar_vir)) ** (1 / 3)
Tv_of = lambda M: mu * mp * G * M * Msun / (2 * kB * rv_of(M))
Mh = float(np.interp(T_vir, Tv_of(Mg), Mg))
rv, rs = rv_of(Mh), rv_of(Mh) / C
mu_c = np.log(1 + C) - C / (1 + C)
rho_s = Mh * Msun / (4 * np.pi * rs ** 3 * mu_c)

# --- NFW ---
rho_nfw = lambda r: rho_s / ((r / rs) * (1 + r / rs) ** 2)

# --- FDM soliton (doc S2.1 / S2.2 / S6); r_c, rho_c self-consistently via M_core ---
a = 1.0 / (1 + z)
rc = 1.6 * m22 ** -1 * a ** 0.5 * (Mh / 1e9) ** (-1 / 3) * kpc          # cm
Mcore = 0.25 * a ** -0.5 * (Mh / Mm1n0) ** (1 / 3) * Mm1n0 * Msun        # doc S2.2
Mcore = min(Mcore, Mh * Msun)                                            # pure-soliton cap
u = np.linspace(0, 60, 200000)
I = np.trapz(u ** 2 * (1 + 0.091 * u ** 2) ** (-8), u)
rho_c = Mcore / (4 * np.pi * rc ** 3 * I)
rho_sol = lambda r: rho_c * (1 + 0.091 * (r / rc) ** 2) ** (-8)

# --- CDM intersection: x_c(1+x_c)^2 = rho_s/rho_crit ---
y = rho_s / rho_crit
lo, hi = 1e-8, 1.0
while hi * (1 + hi) ** 2 < y:
    hi *= 2
for _ in range(200):
    mid = 0.5 * (lo + hi)
    lo, hi = (mid, hi) if mid * (1 + mid) ** 2 < y else (lo, mid)
xc = 0.5 * (lo + hi)
r_cool = xc * rs

# --- FDM intersection: rho_c[1+0.091(r/rc)^2]^-8 = rho_crit  (needs rho_c > rho_crit) ---
if rho_c > rho_crit:
    r_cool_fdm = np.sqrt(((rho_c / rho_crit) ** 0.125 - 1) / 0.091) * rc
else:
    r_cool_fdm = None

# ======================= figure =======================
fig, ax = plt.subplots(figsize=(8.0, 5.6))
r = np.logspace(np.log10(1e-3 * rv), np.log10(60 * rv), 1200)

ax.loglog(r / rv, rho_nfw(r), "k-", lw=2.2,
          label=r"CDM: $\rho_{\rm NFW}(r)$  ($r_s=r_{\rm vir}/C$)")
ax.loglog(r / rv, rho_sol(r), "C0-", lw=2.2,
          label=r"FDM: $\rho_c[1+0.091(r/r_c)^2]^{-8}$")
ax.axhline(rho_crit, color="crimson", ls="--", lw=2.0,
           label=r"$\rho_{\rm crit}$   ($\Leftrightarrow n_H=n_{\rm min}$)")

ymin, ymax = rho_c / 6.0, rho_crit * 1e3
ax.set_ylim(ymin, ymax)
ax.set_xlim(1e-3, 60)

# CDM marker
ax.plot([r_cool / rv], [rho_crit], "o", color="k", ms=8, zorder=6)
ax.axvline(r_cool / rv, color="k", ls=":", lw=1.2)
ax.annotate(r"CDM: $x_c(1+x_c)^2=\rho_s/\rho_{\rm crit}$" "\n"
            r"$x_c=%.2f\ \Rightarrow\ r_{\rm cool}^{\rm CDM}=%.3f\,r_{\rm vir}$"
            % (xc, r_cool / rv),
            xy=(r_cool / rv, rho_crit),
            xytext=(r_cool / rv * 5.0, rho_crit * 40),
            arrowprops=dict(arrowstyle="->", lw=1.2), fontsize=11)

# FDM marker / statement
ax.axvline(rc / rv, color="C0", ls=":", lw=1.2)
ax.plot([rc / rv], [rho_c], "o", color="C0", ms=8, zorder=6)
ax.annotate(r"FDM: $\rho_c/\rho_{\rm crit}=%.1e<1$" "\n"
            r"no crossing with $\rho_{\rm crit}$"
            % (rho_c / rho_crit),
            xy=(rc / rv, rho_c), xytext=(0.9, ymin * 1.6),
            arrowprops=dict(arrowstyle="->", lw=1.2, color="C0"),
            color="C0", fontsize=11)
ax.text(1.5e-3, rho_c * 1.35, r"FDM soliton: $r_c=%.1f\,r_{\rm vir}$" % (rc / rv),
        color="C0", fontsize=11)

ax.axvspan(1e-3, r_cool / rv, color="crimson", alpha=0.07)
ax.text(1.3e-3, ymax * 0.06, r"$t_{\rm cool}<t_{\rm ff}$", color="crimson", fontsize=11.5)

ax.set_xlabel(r"$r/r_{\rm vir}$", fontsize=13)
ax.set_ylabel(r"$\rho\ \,[{\rm g\,cm^{-3}}]$", fontsize=13)
ax.set_title(r"$z=20,\ m_{22}=1,\ T_{\rm vir}=10^3\,{\rm K},\ C=%d,\ x_{{\rm H}_2}=10^{-4}$"
             "\n" r"$M_h=%.1f\times10^5\,M_\odot\ (<M_{\rm sol}=%.1f\times10^7)$"
             % (int(C), Mh / 1e5, 5.47 * (1 + z) ** 0.75 / 1e7), fontsize=11.5)
ax.legend(fontsize=10.5, loc="lower left", framealpha=0.95)
ax.grid(alpha=0.25, which="both")
fig.tight_layout()
out = "docs/figures/fdm_rcool_intersection.png"
fig.savefig(out, dpi=180)

print(f"Mh={Mh:.3e} Mo  rv={rv/kpc:.4f} kpc  Tvir={Tv_of(Mh):.0f} K")
print(f"rho_crit={rho_crit:.4e}  ratio to rho_bar_vir = {rho_crit/rho_bar_vir:.1f}")
print(f"CDM: rho_s/rho_crit={y:.3f}  x_c={xc:.4f}  r_cool={r_cool/rv:.4f} r_vir")
print(f"FDM: rc={rc/kpc:.3f} kpc = {rc/rv:.1f} r_vir  rho_c={rho_c:.4e}"
      f"  rho_c/rho_crit={rho_c/rho_crit:.3f}")
print(f"FDM r_cool = {'none' if r_cool_fdm is None else f'{r_cool_fdm/rv:.3f} r_vir'}")
print("saved", out)
