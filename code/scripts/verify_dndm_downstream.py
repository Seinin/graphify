#!/usr/bin/env python
"""
verify_dndm_downstream.py - FDM 下游积分验证（change: verify-dndm-downstream-integrals）

在 FDM 宇宙学下对 P0 改动（条件路径不再乘 `dndm_FDM`、条件路径第二变量改取 FDM sigma）
的下游后果给出曲线级证据，产出：

  1. 电离光子发射率  `evaluate_Nion_z`                 -> nion_acg / nion_mcg
  2. 恒星形成率密度  `evaluate_SFRD_z`                 -> sfrd_acg / sfrd_mcg
  3. 紫外光度函数    `compute_luminosity_function`     -> Muv / Mh / log10phi (acg/mcg/both)

外加三项自洽性断言与 CDM 参考模型的汇总指纹（回归锚点）。

约定（见 openspec/changes/verify-dndm-downstream-integrals/design.md）：
* D6 非数即失败：定义域内应为正却非数/非正 -> 本次运行判失败并返回非零退出码。
* D7 逐红移调用：`evaluate_Nion_z` / `evaluate_SFRD_z` 的缩放常数按传入数组**首个**红移
  确定，整条数组一次传入会让整条曲线用单一红移的缩放常数、形状失真；LF 同样逐红移。
* 结果只依赖版本控制中的代码：脚本把 `src/` 置前，使用入库的 `src/py21cmfast`，
  而非被 `.gitignore` 忽略的构建副本 `./py21cmfast/`。

口径：
* Nion/SFRD 的 `log10mturns` = log10(周转质量/M_sun)，取 CDM 冷却阈值
  `mcrit_cdm(z) = 3.314e7*(1+z)^-1.5`，ACG 与 MCG 共用同一张表（与 docs/ACG_MCG_manual.md 一致）。
* LF 的 `mturnovers`/`mturnovers_mini` 为**线性**质量（C 侧期望线性值）。
* `Muv = 51.63 - 2.5*log10(SFR*Luv_over_SFR)`，`Luv_over_SFR = 1/1.15e-28`。

用法：
    .venv/bin/python scripts/verify_dndm_downstream.py --quick
    .venv/bin/python scripts/verify_dndm_downstream.py --tag baseline
    .venv/bin/python scripts/verify_dndm_downstream.py --switch on --tag p0_after
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

# 使用入库的 src/py21cmfast（而非被忽略的构建副本 ./py21cmfast/），保证干净检出可复现。
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_SRC_DIR = _PROJECT_ROOT / "src"
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

os.environ.setdefault("MPLBACKEND", "Agg")
import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

import py21cmfast as p21c  # noqa: E402
from py21cmfast.wrapper import cfuncs as _cfuncs  # noqa: E402

# 包内非公共句柄：仅用于 P0 对照开关（design D3）。开关未引入时属性不存在。
from py21cmfast.c_21cmfast import lib as _lib  # noqa: E402

SCRIPT_DIR = Path(__file__).resolve().parent
OUTDIR_DEFAULT = SCRIPT_DIR / "verify_dndm_downstream_out"

_trapz = getattr(np, "trapezoid", None) or getattr(np, "trapz")  # numpy 2.x / 1.x 兼容

# ---------------------------------------------------------------------------
# 常量与默认口径（全部写入结果文件，便于复核）
# ---------------------------------------------------------------------------

HMF_FINDEX = -1.1                 # MatterOptions.HMF_FINDEX（Schive+2016 Table 1）
A_M0 = 1.6e10                     # M0 = A_M0 * m22^(-4/3)，src/py21cmfast/src/fdm.c
A_MCRIT_CDM = 3.314e7             # mcrit_cdm(z) = A_MCRIT_CDM * (1+z)^SLOPE_CDM
SLOPE_CDM = -1.5
LUV_OVER_SFR = 1.0 / 1.15e-28     # src/py21cmfast/src/LuminosityFunction.c
MUV_ZEROPOINT = 51.63

Z_MIN_DEFAULT, Z_MAX_DEFAULT, N_Z_DEFAULT = 6.0, 15.0, 11
M22_DEFAULT = (0.1, 1.0, 10.0)

# 自洽性断言容差（可用 CLI 覆盖；实际使用值随断言写入结果文件）
TOL_SUPPRESSION_QUADRATURE = 1e-6
TOL_SUPPRESSION_SLOPE = 0.15
TOL_LF_VS_SFRD = 0.25
TOL_COMPONENT_CLOSURE = 1e-6

SUPPRESSION_MASS_RANGE = (1e5, 1e11)
SUPPRESSION_N_GRID = 4096
SUPPRESSION_SLOPE_N_GRID = 256

# 上游已知差异量级（spec「P0 前后偏移必须量化并按量级判据分流」）
UPSTREAM_SCALE_THRESHOLD = {0.1: 1.5e-2, 1.0: 4.0e-4, 10.0: 4.0e-4}

ASTRO_PARAMS = {
    "F_STAR10": -1.25, "F_STAR7_MINI": -2.5, "F_ESC10": -1.35, "F_ESC7_MINI": -1.35,
    "ALPHA_STAR": 0.5, "ALPHA_STAR_MINI": 0.0, "ALPHA_ESC": -0.3, "M_TURN": 5.0,
    "t_STAR": 0.5, "L_X": 40.5, "L_X_MINI": 40.5, "X_RAY_SPEC_INDEX": 1.0,
    "NU_X_THRESH": 500.0,
}
# 仅影响 InputParameters 校验（下游三者为均匀积分，与盒尺寸无关）
SIM_OPTIONS = {"HII_DIM": 64, "BOX_LEN": 200.0, "Z_HEAT_MAX": 35.0, "N_THREADS": 1}
RANDOM_SEED = 42

SWITCH_SETTER = "set_dndm_downstream_legacy_path"
SWITCH_GETTER = "get_dndm_downstream_legacy_path"


def log(msg: str = "") -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# 物理量口径
# ---------------------------------------------------------------------------


def mcrit_cdm(z):
    """CDM 冷却阈值 [M_sun]。"""
    return A_MCRIT_CDM * (1.0 + np.asarray(z, dtype=float)) ** SLOPE_CDM


def m0_fdm(m22: float) -> float:
    """FDM 半质量尺度 `M0 = 1.6e10 * m22^(-4/3)` [M_sun]。"""
    return A_M0 * float(m22) ** (-4.0 / 3.0)


def dndm_fdm(M, m22: float):
    """FDM 相对修正因子 `(1 + (M/M0)^HMF_FINDEX)^(-2.2)`。"""
    M = np.asarray(M, dtype=float)
    return (1.0 + (M / m0_fdm(m22)) ** HMF_FINDEX) ** (-2.2)


def uv_luminosity_from_muv(Muv):
    """`L_uv = 10**((51.63 - Muv)/2.5)` [erg/s/Hz]。"""
    return 10.0 ** ((MUV_ZEROPOINT - np.asarray(Muv, dtype=float)) / 2.5)


def build_inputs(fdm: bool, m22: float) -> p21c.InputParameters:
    """构造下游积分所需的最小输入集。"""
    return p21c.InputParameters(
        simulation_options=p21c.SimulationOptions(**SIM_OPTIONS),
        matter_options=p21c.MatterOptions(HMF="ST", FDM=bool(fdm), HMF_FINDEX=HMF_FINDEX),
        cosmo_params=p21c.CosmoParams(m22=float(m22)),
        astro_options=p21c.AstroOptions(
            USE_MINI_HALOS=True, USE_TS_FLUCT=True, INHOMO_RECO=True, USE_X_RAY_HEATING=False
        ),
        astro_params=p21c.AstroParams(**ASTRO_PARAMS),
        random_seed=RANDOM_SEED,
    )


def switch_state() -> dict:
    """P0 对照开关能力探测（任务 2 引入前为不可用）。"""
    available = hasattr(_lib, SWITCH_SETTER)
    state = {"setter": SWITCH_SETTER, "available": bool(available), "enabled": None}
    if available and hasattr(_lib, SWITCH_GETTER):
        state["enabled"] = bool(getattr(_lib, SWITCH_GETTER)())
    return state


def set_switch(enabled: bool) -> None:
    """切换 P0 对照开关（`True` = 走 P0 之前的旧条件路径）。"""
    getattr(_lib, SWITCH_SETTER)(1 if enabled else 0)


# ---------------------------------------------------------------------------
# 逐红移采集（D7）
# ---------------------------------------------------------------------------


def collect_per_redshift(inputs, z: float, log10mturn: float, nbins: int) -> dict:
    """对单个红移采集三条下游曲线。"""
    z_arr = np.array([z], dtype=float)
    mt_arr = np.array([log10mturn], dtype=float)
    mturn_linear = np.array([10.0**log10mturn], dtype=float)

    nion_acg, nion_mcg = _cfuncs.evaluate_Nion_z(
        inputs=inputs, redshifts=z_arr, log10mturns=mt_arr
    )
    sfrd_acg, sfrd_mcg = _cfuncs.evaluate_SFRD_z(
        inputs=inputs, redshifts=z_arr, log10mturns=mt_arr
    )

    # ACG 的周转质量口径必须与 `evaluate_SFRD_z` 的 ACG 分量一致：C 侧非 mini 分支用
    # `10**M_TURN`（见 wrapper/cfuncs.py），而 MCG 用传入的 mcrit_cdm 表。
    mturn_acg = np.array([10.0 ** ASTRO_PARAMS["M_TURN"]], dtype=float)

    lf = {}
    for comp in ("acg", "mcg", "both"):
        Muv, Mh, log10phi = p21c.compute_luminosity_function(
            redshifts=[z], inputs=inputs, nbins=nbins,
            mturnovers=mturn_acg, mturnovers_mini=mturn_linear, component=comp,
        )
        lf[comp] = {
            "Muv": np.asarray(Muv, dtype=float)[0],
            "Mh": np.asarray(Mh, dtype=float)[0],
            "log10phi": np.asarray(log10phi, dtype=float)[0],
        }

    return {
        "z": float(z), "log10mturn": float(log10mturn),
        "nion_acg": float(nion_acg[0]), "nion_mcg": float(nion_mcg[0]),
        "sfrd_acg": float(sfrd_acg[0]), "sfrd_mcg": float(sfrd_mcg[0]),
        "lf": lf,
    }


def collect_curves(inputs, redshifts, nbins: int, label: str) -> dict:
    """逐红移采集整条曲线（红移网格顺序即传入顺序）。"""
    per_z = []
    t0 = time.time()
    for z in redshifts:
        rec = collect_per_redshift(inputs, float(z), float(np.log10(mcrit_cdm(z))), nbins)
        per_z.append(rec)
        log("    z=%5.2f  nion_mcg=%.6e  sfrd_mcg=%.6e  (%.1fs)"
            % (z, rec["nion_mcg"], rec["sfrd_mcg"], time.time() - t0))
    return {
        "label": label,
        "redshifts": [p["z"] for p in per_z],
        "log10mturns": [p["log10mturn"] for p in per_z],
        "nion_acg": [p["nion_acg"] for p in per_z],
        "nion_mcg": [p["nion_mcg"] for p in per_z],
        "sfrd_acg": [p["sfrd_acg"] for p in per_z],
        "sfrd_mcg": [p["sfrd_mcg"] for p in per_z],
        "lf": {c: {k: [p["lf"][c][k] for p in per_z] for k in ("Muv", "Mh", "log10phi")}
               for c in ("acg", "mcg", "both")},
        "per_z": per_z,
    }


# ---------------------------------------------------------------------------
# 有限性与符号检查（D6）
# ---------------------------------------------------------------------------


def check_finite_positive(curves: dict) -> list:
    """检查曲线中「定义域内应为正」的量，返回失败描述列表（空 = 通过）。

    * `nion_*` / `sfrd_*`：全部红移点上必须有限且 > 0。
    * LF `log10phi`：允许 `-inf`（该 bin 无对应质量，属定义域外），但每个红移点上必须
      存在有限 bin；`Muv` / `Mh` 必须全有限。
    """
    failures = []
    zs = curves["redshifts"]

    for key in ("nion_acg", "nion_mcg", "sfrd_acg", "sfrd_mcg"):
        for i, val in enumerate(curves[key]):
            if not np.isfinite(val) or val <= 0.0:
                failures.append(f"{curves['label']}: {key} 在 z={zs[i]} 非有限正值 ({val!r})")

    for comp in ("acg", "mcg", "both"):
        Muv = np.asarray(curves["lf"][comp]["Muv"], dtype=float)
        Mh = np.asarray(curves["lf"][comp]["Mh"], dtype=float)
        lphi = np.asarray(curves["lf"][comp]["log10phi"], dtype=float)
        for i in range(lphi.shape[0]):
            # C 侧对「该星等无对应晕质量」的 bin 填非数，属定义域外，允许出现在两端；
            # 但有效区间内不允许出现非数，且每次调用至少要有 2 个有效 bin 才能积分。
            finite = np.isfinite(lphi[i])
            n_finite = int(finite.sum())
            if n_finite < 2:
                failures.append(
                    f"{curves['label']}: LF[{comp}] 在 z={zs[i]} 的有效 bin 不足 2 个"
                    f"（{n_finite}/{lphi.size}）"
                )
                continue
            idx = np.where(finite)[0]
            if idx[-1] - idx[0] + 1 != n_finite:
                failures.append(
                    f"{curves['label']}: LF[{comp}] 在 z={zs[i]} 的有效 bin 不连续"
                    f"（区间 [{idx[0]}, {idx[-1]}] 内含非数）"
                )
            if not np.isfinite(Muv[i][finite]).all():
                failures.append(f"{curves['label']}: LF[{comp}] 在 z={zs[i]} 的有效 bin 中 Muv 含非数")
            if not np.isfinite(Mh[i][finite]).all():
                failures.append(f"{curves['label']}: LF[{comp}] 在 z={zs[i]} 的有效 bin 中 Mh 含非数")
    return failures


# ---------------------------------------------------------------------------
# 自洽性断言（design D4：每项记录观测量/参照量/相对偏差/容差）
# ---------------------------------------------------------------------------


def check_suppression_integral(m22: float, tol: float) -> dict:
    """(i) FDM 抑制因子在质量区间上的积分 vs 独立高精度求积。

    `dndm_FDM` 是相对修正因子、没有归一化恒等式（design Context），因此只与独立参照
    对照；另附单调性与大质量端渐近检查，避免把「数值有限」当作断言。
    """
    lo, hi = SUPPRESSION_MASS_RANGE
    M = np.logspace(np.log10(lo), np.log10(hi), SUPPRESSION_N_GRID)
    dndm = dndm_fdm(M, m22)
    observed = float(_trapz(dndm, np.log(M)))

    reference, reference_kind = None, "unavailable"
    try:
        from scipy.integrate import quad

        reference = float(
            quad(lambda lnM: float(dndm_fdm(np.exp(lnM), m22)), np.log(lo), np.log(hi),
                 epsabs=1e-14, epsrel=1e-13, limit=500)[0]
        )
        reference_kind = "scipy.integrate.quad(epsabs=1e-14, epsrel=1e-13)"
    except ImportError:
        pass

    rel_dev = abs(observed - reference) / abs(reference) if reference else float("nan")

    # 尾部幂律斜率：抑制量 `1 - dndm` 在 M >> M0 时应正比于 (M0/M)^|HMF_FINDEX|，
    # 故 dln(1-dndm)/dlnM -> HMF_FINDEX = -1.1。这是独立于数值求积的解析行为检查。
    # 该检查必须在 M/M0 >> 1 的区间上做：一阶展开 `1-(1+x)^-2.2 ≈ 2.2x` 仅在 x << 1
    # 成立，否则拟合斜率随 M/M0 漂移（积分区间 (1e5, 1e11) 对 m22=0.1 并不满足条件，
    # 因为此时 M0 = 3.4e11 > 区间上限）。故另取 [1e3*M0, 1e6*M0] 作斜率区。
    m0 = m0_fdm(m22)
    M_slope = np.logspace(np.log10(m0 * 1e3), np.log10(m0 * 1e6), SUPPRESSION_SLOPE_N_GRID)
    supp = 1.0 - dndm_fdm(M_slope, m22)
    slope = (
        float(np.polyfit(np.log(M_slope), np.log(supp), 1)[0])
        if np.all(supp > 0) else float("nan")
    )
    checks = {
        "finite": bool(np.isfinite(dndm).all()),
        "monotone_increasing": bool(np.all(np.diff(dndm) >= 0.0)),
        "bounded_by_one": bool(np.all(dndm <= 1.0 + 1e-12)),
        "tail_powerlaw_slope": slope,
        "tail_powerlaw_slope_deviation": abs(slope - HMF_FINDEX) if np.isfinite(slope) else float("nan"),
        "tail_slope_mass_range": [float(M_slope[0]), float(M_slope[-1])],
        "tail_slope_mass_over_m0": [1e3, 1e6],
        "m0_fdm": float(m0),
        "large_m_value": float(dndm[-1]),
    }
    failed = [k for k in ("finite", "monotone_increasing", "bounded_by_one") if not checks[k]]
    if not (np.isfinite(slope) and abs(slope - HMF_FINDEX) <= TOL_SUPPRESSION_SLOPE):
        failed.append("tail_powerlaw_slope")
    if reference is None:
        failed.append("reference_available")
    elif not (np.isfinite(rel_dev) and rel_dev <= tol):
        failed.append("quadrature_deviation")
    return {
        "name": "suppression_integral",
        "description": "dndm_FDM 质量积分 vs 独立高精度求积（含单调性/上界/尾部幂律斜率检查）",
        "m22": float(m22), "mass_range": [lo, hi], "n_grid": SUPPRESSION_N_GRID,
        "observed": observed, "reference": reference, "reference_kind": reference_kind,
        "relative_deviation": rel_dev, "tolerance": float(tol),
        "checks": checks, "failed_checks": failed, "passed": not failed,
    }


def integrate_lf_rho_uv(lf_comp: dict) -> dict:
    """由 LF 的 `log10phi` 对星等积分得到 `rho_uv` [erg/s/Hz/Mpc^3]。

    只使用有限 `log10phi` 的 bin。同时报告两端 bin 对积分的贡献占比，作为星等区间
    截断残差的可执行度量（spec：截断残差须单独报告，不得靠收窄区间掩盖）。
    """
    Muv = np.asarray(lf_comp["Muv"], dtype=float)
    lphi = np.asarray(lf_comp["log10phi"], dtype=float)
    valid = np.isfinite(lphi)
    n_valid = int(valid.sum())
    if n_valid < 2:
        return {"rho_uv": float("nan"), "n_valid_bins": n_valid, "n_total_bins": int(lphi.size)}
    order = np.argsort(Muv[valid])
    Muv_v, lphi_v = Muv[valid][order], lphi[valid][order]
    contrib = (10.0**lphi_v) * uv_luminosity_from_muv(Muv_v)
    rho_uv = float(_trapz(contrib, Muv_v))
    n_edge = max(1, int(round(0.1 * n_valid)))
    edge_frac = float(
        (_trapz(contrib[:n_edge], Muv_v[:n_edge]) + _trapz(contrib[-n_edge:], Muv_v[-n_edge:]))
        / rho_uv
    )
    return {
        "rho_uv": rho_uv, "n_valid_bins": n_valid, "n_total_bins": int(lphi.size),
        "muv_span": [float(Muv_v[0]), float(Muv_v[-1])],
        "edge_bin_contribution_fraction": edge_frac,
        "log10phi_muv_span": [float(lphi_v[0]), float(lphi_v[-1])],
    }


def check_lf_vs_sfrd(curves: dict, tol: float) -> dict:
    """(ii) LF 积分 `rho_uv` 与 SFRD 按 `Luv_over_SFR = 1/1.15e-28` 的换算一致性。"""
    per_z = []
    worst = 0.0
    for i, z in enumerate(curves["redshifts"]):
        entry = {"z": float(z), "components": {}}
        for comp, sfrd_key in (("mcg", "sfrd_mcg"), ("acg", "sfrd_acg")):
            integ = integrate_lf_rho_uv({
                "Muv": curves["lf"][comp]["Muv"][i],
                "log10phi": curves["lf"][comp]["log10phi"][i],
            })
            sfrd_obs = float(curves[sfrd_key][i])
            sfrd_pred = integ["rho_uv"] * 1.15e-28 if np.isfinite(integ["rho_uv"]) else float("nan")
            rel_dev = (
                abs(sfrd_pred - sfrd_obs) / sfrd_obs
                if np.isfinite(sfrd_pred) and sfrd_obs > 0 else float("nan")
            )
            # 截断残差单列：LF 覆盖的最小晕质量 vs SFRD 积分的质量下限
            Mh = np.asarray(curves["lf"][comp]["Mh"][i], dtype=float)
            lphi = np.asarray(curves["lf"][comp]["log10phi"][i], dtype=float)
            finite = np.isfinite(lphi)
            truncation = {
                "lf_min_halo_mass": float(Mh[finite].min()) if finite.any() else None,
                "lf_max_halo_mass": float(Mh[finite].max()) if finite.any() else None,
                "sfrd_lower_mass_limit": _sfrd_lower_mass_limit(z),
            }
            entry["components"][comp] = {
                "rho_uv": integ["rho_uv"],
                "sfrd_predicted": sfrd_pred,
                "sfrd_observed": sfrd_obs,
                "relative_deviation": rel_dev,
                "n_valid_bins": integ["n_valid_bins"],
                "n_total_bins": integ["n_total_bins"],
                "muv_span": integ.get("muv_span"),
                "edge_bin_contribution_fraction": integ.get("edge_bin_contribution_fraction"),
                "truncation_residual": truncation,
            }
            if np.isfinite(rel_dev):
                worst = max(worst, rel_dev)
        per_z.append(entry)
    return {
        "name": "lf_vs_sfrd",
        "description": "LF 积分 rho_uv 与 SFRD 的 Luv_over_SFR=1/1.15e-28 换算一致性",
        "observed": "rho_uv * 1.15e-28 (LF 积分)",
        "reference": "evaluate_SFRD_z 的 MCG/ACG 分量",
        "relative_deviation": float(worst),
        "tolerance": float(tol),
        "per_redshift": per_z,
        "passed": bool(np.isfinite(worst) and worst <= tol),
    }


def _sfrd_lower_mass_limit(z: float):
    """SFRD 积分的质量下限（`minimum_source_mass`；不可用时返回 None）。"""
    for use_xi in (True, 1, False, 0):
        try:
            return float(_lib.minimum_source_mass(float(z), use_xi))
        except Exception:  # noqa: BLE001 - 签名/类型不确定时降级
            continue
    return None


def check_component_closure(curves: dict, tol: float) -> dict:
    """(iii) `both` 与「ACG + MCG（对数空间线性相加）」的分量闭合。

    合成规则与 `wrapper/cfuncs.py` 的 `component="both"` 一致：共同网格取两端极值间的
    线性等距网格，各分量以 `fill_value="extrapolate"` 插值后在对数空间的线性量上相加。
    由区间外推主导的 bin 单独标注，不并入内插区统计。
    """
    per_z = []
    worst_interp = 0.0
    for i, z in enumerate(curves["redshifts"]):
        Muv_acg = np.asarray(curves["lf"]["acg"]["Muv"][i], dtype=float)
        lphi_acg = np.asarray(curves["lf"]["acg"]["log10phi"][i], dtype=float)
        Muv_mcg = np.asarray(curves["lf"]["mcg"]["Muv"][i], dtype=float)
        lphi_mcg = np.asarray(curves["lf"]["mcg"]["log10phi"][i], dtype=float)
        Muv_both = np.asarray(curves["lf"]["both"]["Muv"][i], dtype=float)
        lphi_both = np.asarray(curves["lf"]["both"]["log10phi"][i], dtype=float)

        # 与 C 侧一致：使用对数空间的线性量相加，边界外推。
        from scipy.interpolate import interp1d

        def _sum_at(grid):
            vals = []
            for muv, lphi in ((Muv_acg, lphi_acg), (Muv_mcg, lphi_mcg)):
                order = np.argsort(muv)
                f = interp1d(muv[order], lphi[order], fill_value="extrapolate")
                vals.append(10.0 ** f(grid))
            return np.log10(vals[0] + vals[1])

        grid = np.linspace(min(Muv_acg.min(), Muv_mcg.min()),
                           max(Muv_acg.max(), Muv_mcg.max()), Muv_both.size)
        order_b = np.argsort(Muv_both)

        extrapolated = ~(
            (grid >= Muv_acg.min()) & (grid <= Muv_acg.max())
            & (grid >= Muv_mcg.min()) & (grid <= Muv_mcg.max())
        )
        rel_dev_bins = np.full(grid.size, np.nan)
        try:
            summed = _sum_at(grid)
            ref = interp1d(Muv_both[order_b], lphi_both[order_b],
                           fill_value="extrapolate")(grid)
            with np.errstate(invalid="ignore", divide="ignore"):
                rel_dev_bins = np.abs(10.0**summed - 10.0**ref) / np.abs(10.0**ref)
        except Exception as exc:  # noqa: BLE001 - 记录而非静默
            per_z.append({"z": float(z), "error": f"{type(exc).__name__}: {exc}"})
            continue

        interior = ~extrapolated & np.isfinite(rel_dev_bins)
        worst_bin = float(np.nanmax(rel_dev_bins[interior])) if interior.any() else float("nan")
        if np.isfinite(worst_bin):
            worst_interp = max(worst_interp, worst_bin)
        per_z.append({
            "z": float(z),
            "n_bins": int(grid.size),
            "n_extrapolated_bins": int(extrapolated.sum()),
            "relative_deviation_interior": worst_bin,
            "relative_deviation_all_bins": float(np.nanmax(rel_dev_bins)),
            "extrapolated_bin_indices": np.where(extrapolated)[0].tolist(),
        })
    return {
        "name": "component_closure",
        "description": "LF 的 `both` 与 ACG+MCG 分量之和的闭合（外推 bin 单独标注）",
        "observed": "component='both' 的 log10phi",
        "reference": "ACG 与 MCG 插值到共同网格后在对数空间线性相加",
        "relative_deviation": float(worst_interp),
        "tolerance": float(tol),
        "per_redshift": per_z,
        "passed": bool(np.isfinite(worst_interp) and worst_interp <= tol),
    }


# ---------------------------------------------------------------------------
# 汇总指纹与逐位比较
# ---------------------------------------------------------------------------

FINGERPRINT_KEYS = ("nion_acg", "nion_mcg", "sfrd_acg", "sfrd_mcg")


def compute_fingerprint(curves: dict) -> dict:
    """CDM 参考模型的汇总指纹。

    算法：把红移网格与四条曲线（`nion_acg/nion_mcg/sfrd_acg/sfrd_mcg`）按 float64 小端
    连续内存原始字节依次喂入 md5。不做任何舍入，因此指纹语义等价于逐位比较；指纹随结果
    文件写入，供后续对照与「默认路径逐位不变」的回归锚点使用。
    """
    h = hashlib.md5()
    h.update(np.asarray(curves["redshifts"], dtype="<f8").tobytes())
    for key in FINGERPRINT_KEYS:
        h.update(np.asarray(curves[key], dtype="<f8").tobytes())
    return {"value": h.hexdigest(), "algorithm": "md5(float64<).update([redshifts] + "
            f"{list(FINGERPRINT_KEYS)})", "keys": list(FINGERPRINT_KEYS)}


def compare_curves(a: dict, b: dict) -> dict:
    """逐位比较两条曲线（用于「默认路径逐位不变」的证据）。"""
    out = {"identical": True, "per_key": {}}
    if list(a["redshifts"]) != list(b["redshifts"]):
        out["identical"] = False
        out["redshift_grid_mismatch"] = True
    for key in FINGERPRINT_KEYS:
        x = np.asarray(a[key], dtype="<f8")
        y = np.asarray(b[key], dtype="<f8")
        same = x.shape == y.shape and bool(np.array_equal(x, y))
        out["per_key"][key] = {
            "bitwise_equal": same,
            "max_abs_difference": float(np.max(np.abs(x - y))) if x.shape == y.shape else None,
            "max_rel_difference": float(np.max(np.abs(x - y) / np.abs(y)))
            if x.shape == y.shape and np.all(y != 0) else None,
        }
        out["identical"] &= same
    return out


def to_jsonable(obj):
    """把 numpy 标量/数组递归转成 JSON 可序列化对象。"""
    if isinstance(obj, dict):
        return {k: to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.floating, np.integer)):
        return obj.item()
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


# ---------------------------------------------------------------------------
# 绘图
# ---------------------------------------------------------------------------

RUN_COLORS = {0.1: "#d62728", 1.0: "#1f77b4", 10.0: "#2ca02c"}


def plot_curves(runs: dict, outpath: Path, tag: str) -> Path:
    """三条曲线随红移的演化；ACG 虚线、MCG 实线，每个 m22 / CDM 一色。"""
    fig, axes = plt.subplots(1, 3, figsize=(16.5, 5.0))

    for label, curves in runs.items():
        m22 = curves.get("m22")
        color = RUN_COLORS.get(m22, "#7f7f7f")
        style = "--" if curves.get("fdm") else "-"
        z = np.asarray(curves["redshifts"], dtype=float)
        axes[0].semilogy(z, curves["nion_mcg"], style, marker="o", ms=3.5, color=color,
                         label=f"{label} (MCG)")
        axes[0].semilogy(z, curves["nion_acg"], ":", marker="s", ms=3.0, color=color,
                         label=f"{label} (ACG)")
        axes[1].semilogy(z, curves["sfrd_mcg"], style, marker="o", ms=3.5, color=color,
                         label=f"{label} (MCG)")
        axes[1].semilogy(z, curves["sfrd_acg"], ":", marker="s", ms=3.0, color=color,
                         label=f"{label} (ACG)")

        iz = len(z) // 2
        Muv = np.asarray(curves["lf"]["mcg"]["Muv"][iz], dtype=float)
        lphi = np.asarray(curves["lf"]["mcg"]["log10phi"][iz], dtype=float)
        finite = np.isfinite(lphi)
        axes[2].plot(Muv[finite], lphi[finite], style, marker="o", ms=3.5, color=color,
                     label=f"{label} MCG z={z[iz]:.1f}")

    axes[0].set_xlabel("redshift z")
    axes[0].set_ylabel(r"$\dot{n}_{\rm ion}$  [s$^{-1}$ Mpc$^{-3}$]")
    axes[0].set_title("Ionising emissivity")
    axes[1].set_xlabel("redshift z")
    axes[1].set_ylabel(r"SFRD  [M$_\odot$ yr$^{-1}$ Mpc$^{-3}$]")
    axes[1].set_title("Star formation rate density")
    axes[2].set_xlabel(r"$M_{\rm UV}$")
    axes[2].set_ylabel(r"$\log_{10}\phi$  [Mpc$^{-3}$ mag$^{-1}$]")
    axes[2].set_title("UV luminosity function (MCG)")
    for ax in axes:
        ax.grid(True, alpha=0.3)
        ax.legend(fontsize=7)
    fig.suptitle(f"FDM downstream integrals — {tag}", fontsize=13)
    fig.tight_layout()
    fig.savefig(outpath, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return outpath


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="FDM 下游积分验证（曲线级证据 + 自洽性断言 + CDM 回归指纹）"
    )
    p.add_argument("--m22", type=float, nargs="+", default=list(M22_DEFAULT),
                   help="FDM 粒子质量参数列表（单位 1e-22 eV）")
    p.add_argument("--z-min", type=float, default=Z_MIN_DEFAULT)
    p.add_argument("--z-max", type=float, default=Z_MAX_DEFAULT)
    p.add_argument("--n-z", type=int, default=N_Z_DEFAULT)
    p.add_argument("--quick", action="store_true",
                   help="快速模式：最小红移网格（3 点）且只跑 m22=1")
    p.add_argument("--nbins", type=int, default=100, help="LF 星等 bin 数")
    p.add_argument("--tag", type=str, default="run", help="结果文件标签")
    p.add_argument("--outdir", type=str, default=str(OUTDIR_DEFAULT))
    p.add_argument("--skip-cdm", action="store_true", help="跳过 CDM 参考（不产出指纹）")
    p.add_argument("--switch", choices=("auto", "on", "off"), default="auto",
                   help="P0 对照开关：on=走 P0 之前的旧条件路径（任务 2 引入）")
    p.add_argument("--tol-suppression", type=float, default=TOL_SUPPRESSION_QUADRATURE)
    p.add_argument("--tol-lf-sfrd", type=float, default=TOL_LF_VS_SFRD)
    p.add_argument("--tol-closure", type=float, default=TOL_COMPONENT_CLOSURE)
    p.add_argument("--compare-baseline", type=str, default=None,
                   help="与既有结果 JSON 逐位比较")
    p.add_argument("--compare-mode", choices=("identical", "different"), default="identical",
                   help="比较模式：identical=要求逐位相同；different=要求存在非零差异")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    redshifts = np.linspace(args.z_min, args.z_max, 3 if args.quick else args.n_z)
    m22_list = [1.0] if args.quick else list(args.m22)

    sw = switch_state()
    failures: list = []
    log("=" * 72)
    log("FDM 下游积分验证 | tag=%s | z=%d 点 [%.1f, %.1f] | m22=%s | nbins=%d"
        % (args.tag, redshifts.size, args.z_min, args.z_max, m22_list, args.nbins))
    log("对照开关: available=%s%s" % (sw["available"], "" if sw["available"] else "（任务 2 引入）"))
    log("=" * 72)

    if args.switch != "auto":
        if not sw["available"]:
            failures.append(f"请求 --switch {args.switch} 但 C 侧开关不存在（{SWITCH_SETTER}）")
            sw["requested"] = args.switch
        else:
            set_switch(args.switch == "on")
            sw = switch_state()
            sw["requested"] = args.switch
            log("已设置对照开关: enabled=%s（True=旧条件路径）" % sw["enabled"])

    runs: dict = {}
    fingerprint = None

    if not args.skip_cdm:
        log("\n[CDM 参考] FDM=False, m22=1.0（回归锚点）")
        cdm_curves = collect_curves(build_inputs(False, 1.0), redshifts, args.nbins, "CDM")
        cdm_curves["fdm"] = False
        cdm_curves["m22"] = 1.0
        failures += check_finite_positive(cdm_curves)
        fingerprint = compute_fingerprint(cdm_curves)
        log("  CDM 汇总指纹: %s" % fingerprint["value"])
        runs["CDM"] = cdm_curves

    for m22 in m22_list:
        log("\n[FDM] m22=%g" % m22)
        curves = collect_curves(build_inputs(True, m22), redshifts, args.nbins, "FDM_m22_%g" % m22)
        curves["fdm"] = True
        curves["m22"] = float(m22)
        failures += check_finite_positive(curves)
        runs[curves["label"]] = curves

    log("\n[自洽性断言]")
    checks = {"suppression_integral": [], "lf_vs_sfrd": [], "component_closure": []}
    for m22 in m22_list:
        c = check_suppression_integral(m22, args.tol_suppression)
        checks["suppression_integral"].append(c)
        log("  (i)   抑制因子积分 m22=%g: rel_dev=%.3e tol=%.1e passed=%s%s"
            % (m22, c["relative_deviation"], c["tolerance"], c["passed"],
               "" if c["passed"] else " 失败子检查=%s" % ",".join(c["failed_checks"])))
        if not c["passed"]:
            failures.append(
                f"断言失败 suppression_integral(m22={m22}): 失败子检查={c['failed_checks']}"
                f" rel_dev={c['relative_deviation']:.3e} (tol={c['tolerance']:.1e})"
                f" slope={c['checks']['tail_powerlaw_slope']}"
                f" (tol={TOL_SUPPRESSION_SLOPE})"
            )
    for label, curves in runs.items():
        c = check_lf_vs_sfrd(curves, args.tol_lf_sfrd)
        c["run"] = label
        checks["lf_vs_sfrd"].append(c)
        log("  (ii)  LF->rho_uv vs SFRD %s: rel_dev=%.3e tol=%.1e passed=%s"
            % (label, c["relative_deviation"], c["tolerance"], c["passed"]))
        if not c["passed"]:
            failures.append(f"断言失败 lf_vs_sfrd({label}): rel_dev={c['relative_deviation']:.3e}"
                            f" > tol={c['tolerance']:.1e}")
        c2 = check_component_closure(curves, args.tol_closure)
        c2["run"] = label
        checks["component_closure"].append(c2)
        log("  (iii) 分量闭合 %s: rel_dev(内插区)=%.3e tol=%.1e passed=%s"
            % (label, c2["relative_deviation"], c2["tolerance"], c2["passed"]))
        if not c2["passed"]:
            failures.append(f"断言失败 component_closure({label}): rel_dev="
                            f"{c2['relative_deviation']:.3e} > tol={c2['tolerance']:.1e}")

    result = {
        "meta": {
            "script": str(Path(__file__).resolve().relative_to(_PROJECT_ROOT)),
            "tag": args.tag,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "py21cmfast": getattr(p21c, "__version__", "unknown"),
            "py21cmfast_path": p21c.__file__,
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "arguments": vars(args),
            "redshift_grid": redshifts.tolist(),
            "redshift_grid_note": "逐红移调用（design D7）",
            "mturn_formula": f"mcrit_cdm(z) = {A_MCRIT_CDM} * (1+z)^{SLOPE_CDM}",
            "luv_over_sfr": LUV_OVER_SFR,
            "uv_zeropoint": MUV_ZEROPOINT,
            "hmf_findex": HMF_FINDEX, "a_m0": A_M0,
            "astro_params": ASTRO_PARAMS, "sim_options": SIM_OPTIONS, "random_seed": RANDOM_SEED,
        },
        "switch": sw,
        "runs": {k: {kk: vv for kk, vv in v.items() if kk != "per_z"} for k, v in runs.items()},
        "checks": checks,
        "fingerprint": fingerprint,
        "failures": failures,
    }

    if args.compare_baseline:
        base = json.loads(Path(args.compare_baseline).read_text())
        comparison = {"baseline_file": args.compare_baseline,
                      "baseline_tag": base.get("meta", {}).get("tag"),
                      "mode": args.compare_mode, "per_run": {}}
        if fingerprint and base.get("fingerprint"):
            comparison["fingerprint"] = {
                "baseline": base["fingerprint"]["value"],
                "current": fingerprint["value"],
                "equal": base["fingerprint"]["value"] == fingerprint["value"],
            }
        else:
            comparison["fingerprint"] = {"baseline": None, "current": None, "equal": None}
        all_same = None
        for label, curves in runs.items():
            if label in base.get("runs", {}):
                cmp = compare_curves(curves, base["runs"][label])
                comparison["per_run"][label] = cmp
                all_same = cmp["identical"] if all_same is None else (all_same and cmp["identical"])
        comparison["all_runs_identical"] = all_same
        expect_identical = args.compare_mode == "identical"
        ok = (comparison["fingerprint"]["equal"] is not False) and (
            (all_same is True) if expect_identical else (all_same is False)
        )
        comparison["mode_satisfied"] = bool(ok)
        if not ok:
            failures.append(
                f"与基线比较未满足 --compare-mode {args.compare_mode}: "
                f"fingerprint_equal={comparison['fingerprint']['equal']}, all_runs_identical={all_same}"
            )
        result["baseline_comparison"] = comparison
        log("\n[基线比较] mode=%s fingerprint_equal=%s all_runs_identical=%s"
            % (args.compare_mode, comparison["fingerprint"]["equal"], all_same))

    result["failures"] = failures
    result = to_jsonable(result)

    json_path = outdir / f"verify_dndm_downstream_{args.tag}.json"
    json_path.write_text(json.dumps(result, indent=2))
    log("\n结果 JSON: %s" % json_path)

    png_path = outdir / f"verify_dndm_downstream_{args.tag}.png"
    plot_curves(runs, png_path, args.tag)
    log("图: %s" % png_path)

    if failures:
        log("\n失败 %d 项:" % len(failures))
        for f in failures:
            log("  - %s" % f)
        return 1

    log("\n全部检查通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
