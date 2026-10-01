#!/usr/bin/env python
"""calibrate_fdm_uvlf.py -- Calibrate D-class astrophysical parameters for FDM.

Matches 21cmFAST UV luminosity function predictions to Bouwens+2015
observational data by adjusting F_STAR10, ALPHA_STAR, M_TURN, and F_ESC10.

Usage:
    python calibrate_fdm_uvlf.py                  # plot CDM defaults vs data
    python calibrate_fdm_uvlf.py --fdm             # plot FDM defaults vs data
    python calibrate_fdm_uvlf.py --fdm --optimize  # scipy auto-fit D-class params
    python calibrate_fdm_uvlf.py --fdm --grid      # 3D grid search
    python calibrate_fdm_uvlf.py --help

Data: Bouwens et al. 2015, ApJ 803, 34, Table 5 (stepwise UVLF).
      Verify against the paper: doi.org/10.1088/0004-637X/803/1/34
"""

import argparse
import sys
from itertools import product

import matplotlib
matplotlib.use("Agg")  # non-interactive backend, use --show to open GUI

import matplotlib.pyplot as plt
import numpy as np
from scipy.optimize import minimize

from py21cmfast import (
    AstroOptions,
    AstroParams,
    CosmoParams,
    InputParameters,
    MatterOptions,
    SimulationOptions,
    compute_luminosity_function,
)

# ============================================================================
# Bouwens+2015 UVLF observational data  (ApJ 803, 34, Table 5)
#
# These are approximate values.  Exact data should be obtained from the
# published tables at doi.org/10.1088/0004-637X/803/1/34
# ============================================================================

BOUWENS2015 = {
    6: {
        "M_UV": np.array(
            [-22.27, -21.77, -21.27, -20.77, -20.27, -19.77,
             -19.27, -18.77, -18.27, -17.77, -17.27]
        ),
        "log10_phi": np.array(
            [-5.27, -4.51, -3.99, -3.62, -3.32, -2.99,
             -2.84, -2.68, -2.59, -2.54, -2.84]
        ),
        "sigma_plus": np.array(
            [0.22, 0.10, 0.07, 0.05, 0.07, 0.07,
             0.09, 0.12, 0.17, 0.23, 0.29]
        ),
        "sigma_minus": np.array(
            [0.22, 0.10, 0.07, 0.06, 0.07, 0.07,
             0.09, 0.12, 0.17, 0.23, 0.29]
        ),
    },
    7: {
        "M_UV": np.array(
            [-22.32, -21.82, -21.32, -20.82, -20.32, -19.82,
             -19.32, -18.82, -18.32, -17.82, -17.32]
        ),
        "log10_phi": np.array(
            [-5.74, -4.80, -4.22, -3.85, -3.54, -3.18,
             -3.12, -2.88, -2.69, -2.58, -2.56]
        ),
        "sigma_plus": np.array(
            [0.28, 0.11, 0.08, 0.07, 0.08, 0.08,
             0.11, 0.14, 0.19, 0.25, 0.25]
        ),
        "sigma_minus": np.array(
            [0.28, 0.12, 0.08, 0.07, 0.08, 0.09,
             0.12, 0.15, 0.21, 0.30, 0.30]
        ),
    },
    8: {
        "M_UV": np.array(
            [-22.02, -21.52, -21.02, -20.52, -20.02, -19.52,
             -19.02, -18.52, -18.02, -17.52]
        ),
        "log10_phi": np.array(
            [-5.82, -5.11, -4.52, -4.10, -3.76, -3.43,
             -3.37, -3.06, -2.72, -2.69]
        ),
        "sigma_plus": np.array(
            [0.44, 0.22, 0.15, 0.14, 0.16, 0.18,
             0.24, 0.31, 0.44, 0.62]
        ),
        "sigma_minus": np.array(
            [0.31, 0.15, 0.11, 0.10, 0.12, 0.14,
             0.18, 0.25, 0.36, 0.49]
        ),
    },
    10: {
        "M_UV": np.array(
            [-22.83, -21.83, -20.83, -19.83, -18.83, -17.83]
        ),
        "log10_phi": np.array(
            [-6.05, -5.02, -4.24, -3.97, -3.73, -3.84]
        ),
        "sigma_plus": np.array(
            [0.78, 0.21, 0.20, 0.30, 0.49, 0.68]
        ),
        "sigma_minus": np.array(
            [0.60, 0.16, 0.16, 0.28, 0.46, 0.72]
        ),
    },
}

# Redshifts to calibrate at
CALIB_Z = [6, 7, 8, 10]


# ============================================================================
# 21cmFAST forward model setup
# ============================================================================

def make_inputs(f_star10, alpha_star, m_turn, f_esc10, fdm=False, m22=1.6):
    """Build InputParameters for UVLF computation."""
    cosmo = CosmoParams(m22=m22)

    matter = MatterOptions(
        HMF="ST",
        FDM=fdm,
        HMF_FINDEX=-1.1,
    )

    sim = SimulationOptions(
        HII_DIM=32,
        BOX_LEN=200.0,
        Z_HEAT_MAX=35.0,
    )

    astro_opts = AstroOptions(
        USE_MINI_HALOS=False,
        USE_TS_FLUCT=False,
        INHOMO_RECO=False,
    )

    astro_params = AstroParams(
        F_STAR10=f_star10,
        ALPHA_STAR=alpha_star,
        M_TURN=m_turn,
        F_ESC10=f_esc10,
        t_STAR=0.5,
        ALPHA_ESC=-0.5,
        L_X=40.5,
        NU_X_THRESH=500.0,
        X_RAY_SPEC_INDEX=1.0,
    )

    return InputParameters(
        random_seed=42,
        cosmo_params=cosmo,
        matter_options=matter,
        simulation_options=sim,
        astro_options=astro_opts,
        astro_params=astro_params,
    )


def compute_uvlf_at_redshifts(inputs, nbins=200):
    """Compute UVLF at calibration redshifts. Returns dict z->arrays."""
    z_arr = np.array(CALIB_Z, dtype=np.float32)

    Muv, Mh, lfunc = compute_luminosity_function(
        redshifts=z_arr,
        inputs=inputs,
        nbins=nbins,
        component="acg",
    )

    results = {}
    for i, z in enumerate(CALIB_Z):
        mask = (lfunc[i] > -29.5) & (Muv[i] > -25) & (Muv[i] < -15)
        muv = Muv[i][mask]
        phi = lfunc[i][mask]
        # np.interp requires ascending x; M_UV output is descending (bright→faint)
        order = np.argsort(muv)
        results[z] = {
            "M_UV": muv[order],
            "log10_phi": phi[order],
        }
    return results


# ============================================================================
# Chi2 calculation
# ============================================================================

def chi2_for_params(params, fdm=False):
    """Total chi2 across all calibration redshifts."""
    f_star10, alpha_star, m_turn, f_esc10 = params
    inputs = make_inputs(f_star10, alpha_star, m_turn, f_esc10, fdm=fdm)
    model = compute_uvlf_at_redshifts(inputs)

    total = 0.0
    for z in CALIB_Z:
        obs = BOUWENS2015[z]
        phi_interp = np.interp(obs["M_UV"], model[z]["M_UV"], model[z]["log10_phi"],
                               left=-30, right=-30)
        sigma = 0.5 * (obs["sigma_plus"] + obs["sigma_minus"])
        total += np.sum(((phi_interp - obs["log10_phi"]) / sigma) ** 2)
    return total


# ============================================================================
# Optimization
# ============================================================================

def optimize_d_params(fdm=False):
    """Use scipy to find best-fit D-class parameters."""
    # Initial guess: Park+2018 CDM best-fit
    x0 = [-1.35, 0.5, np.log10(5e8), -1.0]

    bounds = [
        (-3.0, 0.0),      # F_STAR10 (log10)
        (-1.0, 2.0),      # ALPHA_STAR
        (7.0, 10.5),      # M_TURN (log10 M_sun)
        (-3.0, 1.0),      # F_ESC10 (log10)
    ]

    print(f"\nOptimizing D-class params {'for FDM' if fdm else 'for CDM'}...")
    print(f"Initial: F_STAR10={x0[0]:.3f}, ALPHA_STAR={x0[1]:.3f}, "
          f"M_TURN={x0[2]:.2f}, F_ESC10={x0[3]:.3f}")
    print(f"Initial chi2: {chi2_for_params(x0, fdm=fdm):.2f}\n")

    result = minimize(
        chi2_for_params,
        x0,
        args=(fdm,),
        method="L-BFGS-B",
        bounds=bounds,
        options={"maxiter": 200, "ftol": 1e-4},
    )

    print(f"Final: F_STAR10={result.x[0]:.3f}, ALPHA_STAR={result.x[1]:.3f}, "
          f"M_TURN={result.x[2]:.2f}, F_ESC10={result.x[3]:.3f}")
    print(f"Final chi2: {result.fun:.2f}")
    print(f"Success: {result.success}, message: {result.message}")

    return result.x


# ============================================================================
# Grid search
# ============================================================================

def grid_search(fdm=False):
    """3D grid search over F_STAR10, ALPHA_STAR, M_TURN at finer resolution."""
    f_star_vals = np.linspace(-1.8, -0.8, 8)        # 8 points, centered on CDM best
    alpha_vals = np.linspace(0.0, 1.0, 5)           # 5 points
    m_turn_vals = np.linspace(7.5, 10.5, 8)         # 8 points

    best_chi2 = np.inf
    best_params = None

    print(f"Grid search: {len(f_star_vals)}x{len(alpha_vals)}x{len(m_turn_vals)} = "
          f"{len(f_star_vals)*len(alpha_vals)*len(m_turn_vals)} points")
    print(f"{'F_STAR10':>10} {'ALPHA':>8} {'M_TURN':>8} {'chi2':>10}")
    print("-" * 40)

    for i, (fstar, alpha, mt) in enumerate(product(f_star_vals, alpha_vals, m_turn_vals)):
        c2 = chi2_for_params([fstar, alpha, mt, -1.0], fdm=fdm)
        if c2 < best_chi2:
            best_chi2 = c2
            best_params = (fstar, alpha, mt)
        if i % 20 == 0:
            print(f"{fstar:10.3f} {alpha:8.3f} {mt:8.2f} {c2:10.2f}")

    print(f"\nBest grid: F_STAR10={best_params[0]:.3f}, ALPHA_STAR={best_params[1]:.3f}, "
          f"M_TURN={best_params[2]:.2f}, chi2={best_chi2:.2f}")
    return best_params


# ============================================================================
# Plotting
# ============================================================================

def plot_uvlf(model_cdm=None, model_fdm=None, title=None, save=None):
    """Plot model UVLFs against Bouwens+2015 data."""
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    axes = axes.flatten()

    for i, z in enumerate(CALIB_Z):
        ax = axes[i]
        obs = BOUWENS2015[z]

        # Data
        ax.errorbar(
            obs["M_UV"], obs["log10_phi"],
            yerr=[obs["sigma_minus"], obs["sigma_plus"]],
            fmt="o", ms=6, capsize=3, color="black",
            label=f"Bouwens+15 (z={z})",
        )

        # CDM model
        if model_cdm and z in model_cdm:
            ax.plot(
                model_cdm[z]["M_UV"], model_cdm[z]["log10_phi"],
                "b-", lw=2, alpha=0.8, label="CDM",
            )

        # FDM model
        if model_fdm and z in model_fdm:
            ax.plot(
                model_fdm[z]["M_UV"], model_fdm[z]["log10_phi"],
                "r--", lw=2, alpha=0.8, label="FDM",
            )

        ax.set_xlabel(r"$M_{\rm UV}$ (AB mag)")
        ax.set_ylabel(r"$\log_{10} \Phi$ (Mpc$^{-3}$ mag$^{-1}$)")
        ax.set_ylim(-8, -1.5)
        ax.set_xlim(-24, -16)
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.3)

    fig.suptitle(title or "21cmFAST UVLF vs Bouwens+2015", fontsize=14)
    plt.tight_layout()

    if save:
        plt.savefig(save, dpi=150, bbox_inches="tight")
        print(f"Saved to {save}")
    else:
        plt.show()


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Calibrate D-class astrophysical params for FDM via UVLF."
    )
    parser.add_argument("--fdm", action="store_true",
                        help="Use FDM HMF (default: CDM)")
    parser.add_argument("--optimize", action="store_true",
                        help="Run scipy optimizer")
    parser.add_argument("--grid", action="store_true",
                        help="Run grid search over F_STAR10, ALPHA_STAR, M_TURN")
    parser.add_argument("--cdm-compare", action="store_true",
                        help="Also compute CDM reference LF for comparison")
    parser.add_argument("--save", type=str, default=None,
                        help="Save figure to file")
    parser.add_argument("--f-star10", type=float, default=-1.35,
                        help="F_STAR10 (log10) [default: Park+2018]")
    parser.add_argument("--alpha-star", type=float, default=0.5,
                        help="ALPHA_STAR [default: Park+2018]")
    parser.add_argument("--m-turn", type=float, default=np.log10(5e8),
                        help="M_TURN (log10 Msun) [default: Park+2018]")
    parser.add_argument("--f-esc10", type=float, default=-1.0,
                        help="F_ESC10 (log10) [default: Park+2018]")
    parser.add_argument("--m22", type=float, default=1.6,
                        help="FDM particle mass in 10^-22 eV [default: 1.6]")

    args = parser.parse_args()

    mode_label = "FDM" if args.fdm else "CDM"

    if args.optimize:
        best = optimize_d_params(fdm=args.fdm)
        fstar, alpha, mt, fesc = best
    elif args.grid:
        best = grid_search(fdm=args.fdm)
        fstar, alpha, mt = best
        fesc = args.f_esc10
    else:
        fstar, alpha, mt, fesc = args.f_star10, args.alpha_star, args.m_turn, args.f_esc10
        print(f"\n[{mode_label}] User parameters:")
        print(f"  F_STAR10 = {fstar:.3f}")
        print(f"  ALPHA_STAR = {alpha:.3f}")
        print(f"  M_TURN = {mt:.2f} (log10 M_sun)")
        print(f"  F_ESC10 = {fesc:.3f}")
        print(f"  chi2 = {chi2_for_params([fstar, alpha, mt, fesc], fdm=args.fdm):.2f}")

    # Compute models for plotting
    inputs = make_inputs(fstar, alpha, mt, fesc, fdm=args.fdm, m22=args.m22)
    model = compute_uvlf_at_redshifts(inputs)

    model_cdm = None
    if args.cdm_compare and args.fdm:
        inputs_cdm = make_inputs(fstar, alpha, mt, fesc, fdm=False, m22=args.m22)
        model_cdm = compute_uvlf_at_redshifts(inputs_cdm)

    title = f"UVLF Calibration ({mode_label}): "
    title += f"F*={fstar:.2f}, α={alpha:.2f}, "
    title += f"M_T={mt:.1f}, f_esc={fesc:.2f}"

    plot_uvlf(
        model_cdm=model_cdm,
        model_fdm=model if args.fdm else None,
        title=title,
        save=args.save,
    )


if __name__ == "__main__":
    main()
