#!/usr/bin/env python
"""
_common.py - generate.py 和 generate_fdm.py 的共享函数库

提取了重复的: 配置加载、功率谱计算、模拟运行、绘图、命令行入口。
通过 model_label 参数控制 CDM/FDM 之间的微小差异。
"""

import logging
import os
import sys
import warnings
from pathlib import Path

# 确保使用本地的 py21cmfast，而非系统安装的旧版
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

import matplotlib.pyplot as plt
import numpy as np
import yaml

import py21cmfast as p21c

# warnings are NOT suppressed — let them surface for debugging

logger = logging.getLogger("py21cmfast")
logger.setLevel(logging.INFO)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


# ============================================================================
# 配置加载
# ============================================================================

def load_config(config_name: str = "config.yaml") -> dict:
    """从 scripts/ 目录加载 YAML 配置"""
    path = Path(__file__).parent / config_name
    with open(path, "r") as f:
        config = yaml.safe_load(f)
    print(f"已从 {path} 加载配置")
    return config


# ============================================================================
# 功率谱计算
# ============================================================================

def _compute_power_spectrum(
    brightness_temp: np.ndarray,
    box_len: float,
    n_bins: int = 50,
    k_min: float = 0.01,
    k_max: float = 10.0,
) -> tuple:
    """
    计算21cm无量纲功率谱 Δ²₂₁(k)

    方法：先按离散 FFT 网格的自然 |k| 壳层平均 3D 功率谱 P(k)，
    再转换为 Δ²(k) = k³/(2π²) · P(k)。直接在壳层尺度上返回结果，
    避免对数 bin 过窄导致的 NaN。
    k_min/k_max 自动钳制到 [k_fund*1.05, k_nyq*0.8] 区间。
    n_bins 参数保留用于调用兼容，内部不使用。
    """
    N = brightness_temp.shape[0]
    cell_size = box_len / N

    # --- 建立 k 网格 ---
    k = np.fft.fftfreq(N, d=cell_size) * 2 * np.pi
    k[N // 2] = 0
    kx, ky, kz = np.meshgrid(k, k, k, indexing="ij")
    k_mag = np.sqrt(kx**2 + ky**2 + kz**2)

    # --- FFT 和 3D 功率谱 ---
    fft_bt = np.fft.fftn(brightness_temp)
    ps3d = np.abs(fft_bt) ** 2 / (N**6) * box_len**3

    # --- 钳制 k 范围到物理有效区间 ---
    k_fund = 2 * np.pi / box_len          # k_min 不低于基频
    k_nyq = np.pi / cell_size             # k_max 不高于 Nyquist
    k_min = max(k_min, k_fund * 1.05)
    k_max = min(k_max, k_nyq * 0.8)

    # --- 壳层平均：按 |k| 分组，每个壳层独立计算 mean ---
    k_rounded = np.round(k_mag, 6)
    unique_k_vals = np.unique(k_rounded[k_rounded > 0])
    shell_power = np.array([np.mean(ps3d[k_rounded == uk]) for uk in unique_k_vals])

    # 裁剪到 [k_min, k_max]
    shell_mask = (unique_k_vals >= k_min) & (unique_k_vals <= k_max)
    shell_k = unique_k_vals[shell_mask]
    shell_p = shell_power[shell_mask]

    # --- 按壳层返回 Δ²(k) ---
    delta_squared = (shell_k**3 / (2 * np.pi**2)) * shell_p
    return shell_k, delta_squared


# ============================================================================
# 功率谱重 bin —— 壳层 → 固定 N 点
# ============================================================================

def rebin_power_spectrum(
    k_shell: np.ndarray,
    delta_sq_shell: np.ndarray,
    n_bins: int = 256,
    k_min: float = None,
    k_max: float = None,
) -> np.ndarray:
    """将自然壳层功率谱对数插值到均匀对数间隔的 n_bins 个点。"""
    if k_min is None:
        k_min = k_shell.min()
    if k_max is None:
        k_max = k_shell.max()

    k_edges = np.logspace(np.log10(k_min), np.log10(k_max), n_bins + 1)
    k_centers = np.sqrt(k_edges[:-1] * k_edges[1:])

    log_k_src = np.log10(k_shell)
    log_ds_src = np.log10(np.maximum(delta_sq_shell, 1e-20))
    log_k_dst = np.log10(k_centers)

    delta_sq_rebinned = 10 ** np.interp(log_k_dst, log_k_src, log_ds_src)
    return delta_sq_rebinned


# ============================================================================
# 模拟运行
# ============================================================================

def run_simulation(config: dict, seed: int = None, model_label: str = "CDM",
                   quiet: bool = False, regenerate: bool = False,
                   write_cache: bool = True) -> dict:
    """
    运行21cmFAST模拟。

    Parameters
    ----------
    config : dict
        YAML 解析后的配置字典。
    seed : int, optional
        随机种子。
    model_label : str
        "CDM" 或 "FDM"，控制打印标签。
    """
    sim = config["simulation"]
    astro = config.get("astro_params", {})
    template_name = config.get("template", "simple")

    if seed is None:
        seed = sim.get("random_seed", 42)

    z_min = sim["z_min"]
    z_max = sim["z_max"]
    n_redshift = sim["n_redshift"]
    redshifts = np.linspace(z_min, z_max, n_redshift).tolist()

    HII_DIM = sim["HII_DIM"]
    BOX_LEN = sim["BOX_LEN"]

    astro_label = "天体物理参数 (含FDM)" if model_label == "FDM" else "天体物理参数"

    if not quiet:
        print(f"\n{'='*60}")
        print(f"运行21cmFAST {model_label}模拟  (template: {template_name})")
        print(f"{'='*60}")
        print(f"网格: {HII_DIM}³, 盒子大小: {BOX_LEN} Mpc")
        print(f"{astro_label}:")
        for key, val in astro.items():
            print(f"  {key} = {val}")
        print(f"红移: {z_min} → {z_max} (共{n_redshift}个点)")
        print(f"随机种子: {seed}")
        print(f"{'='*60}")

    # 收集额外模拟参数（N_THREADS 等）
    extra_opts = {}
    for key in ("N_THREADS",):
        if key in sim:
            extra_opts[key] = sim[key]

    inputs = p21c.InputParameters.from_template(
        template_name,
        BOX_LEN=BOX_LEN,
        HII_DIM=HII_DIM,
        **astro,
        random_seed=seed,
        **extra_opts,
    )

    coevals = p21c.run_coeval(
        inputs=inputs,
        out_redshifts=redshifts,
        regenerate=regenerate,
        write=write_cache,
    )

    results = {
        "redshifts": [],
        "k_values": None,
        "power_spectra": [],
        "brightness_temp_mean": [],
    }

    if not quiet:
        print(f"\n计算功率谱...")
    for coeval in coevals:
        bt = coeval.brightness_temp
        k, delta_squared = _compute_power_spectrum(
            bt,
            BOX_LEN,
            n_bins=sim.get("n_k_bins", 256),
            k_min=sim.get("k_min", 0.01),
            k_max=sim.get("k_max", 10.0),
        )

        if results["k_values"] is None:
            results["k_values"] = k
        results["redshifts"].append(coeval.redshift)
        results["power_spectra"].append(delta_squared)
        results["brightness_temp_mean"].append(float(np.mean(bt)))
        if not quiet:
            print(f"  z = {coeval.redshift:6.2f}  |  <δTb> = {results['brightness_temp_mean'][-1]:8.2f} mK")

    if not quiet:
        print(f"\n模拟完成! 成功处理 {len(results['redshifts'])}/{n_redshift} 个红移点")
    return results


# ============================================================================
# 绘图
# ============================================================================

def plot_power_spectrum_evolution(
    results: dict,
    config: dict,
    output_dir: str = None,
    model_label: str = "CDM",
):
    """绘制功率谱随红移的演化（双图）。

    Parameters
    ----------
    model_label : str
        "CDM" 或 "FDM"，控制标题和输出文件名。
    """
    if output_dir is None:
        output_dir = SCRIPT_DIR

    redshifts = np.array(results["redshifts"])
    k_values = results["k_values"]
    power_spectra = np.array(results["power_spectra"])
    k_targets = config["simulation"].get("k_targets", [0.1, 0.42, 1.0])

    # 根据模型生成文件名
    filename = f"power_spectrum_{model_label.lower()}_vs_redshift.png"
    if model_label == "CDM":
        filename = "power_spectrum_vs_redshift.png"

    prefix = f"{model_label} " if model_label == "FDM" else ""

    fig, axes = plt.subplots(1, 2, figsize=(14, 5.5))

    # ---- 左图: Δ²(k) vs 红移 ----
    ax = axes[0]
    colors = ["#e41a1c", "#377eb8", "#4daf4a"]

    for i, k_tgt in enumerate(k_targets):
        k_idx = np.argmin(np.abs(k_values - k_tgt))
        k_actual = k_values[k_idx]

        delta2_vs_z = power_spectra[:, k_idx]
        valid = ~np.isnan(delta2_vs_z)

        ax.semilogy(
            redshifts[valid],
            delta2_vs_z[valid],
            "o-",
            color=colors[i % len(colors)],
            markersize=4,
            linewidth=1.5,
            label=f"k ≈ {k_actual:.2f} Mpc⁻¹",
        )

    ax.set_xlabel("Redshift z", fontsize=12)
    ax.set_ylabel("Δ²₂₁(k)", fontsize=12)
    ax.set_title(f"{prefix}Power Spectrum vs Redshift", fontsize=13)
    ax.legend(fontsize=10)
    ax.grid(True, alpha=0.3)

    # ---- 右图: Δ²(k) vs k ----
    ax = axes[1]
    n_z = len(redshifts)
    z_indices = [0, n_z // 3, 2 * n_z // 3, n_z - 1]
    z_indices = [i for i in z_indices if i < n_z and i < len(power_spectra)]

    for idx in z_indices:
        ps = power_spectra[idx]
        valid = ~np.isnan(ps)
        ax.loglog(
            k_values[valid],
            ps[valid],
            "-",
            linewidth=1.3,
            label=f"z = {redshifts[idx]:.1f}",
        )

    ax.set_xlabel("k [Mpc⁻¹]", fontsize=12)
    ax.set_ylabel("Δ²₂₁(k)", fontsize=12)
    ax.set_title(f"{prefix}Power Spectrum at Selected Redshifts", fontsize=13)
    ax.legend(fontsize=10)
    ax.grid(True, alpha=0.3)

    plt.tight_layout()

    plot_path = os.path.join(output_dir, filename)
    fig.savefig(plot_path, dpi=150, bbox_inches="tight")
    print(f"\n图像已保存: {plot_path}")

    return fig, axes


# ============================================================================
# 命令行入口
# ============================================================================

def main(config_name: str = "config.yaml", model_label: str = "CDM"):
    """统一的命令行入口

    Parameters
    ----------
    config_name : str
        配置文件名 (如 "config.yaml", "config_fdm.yaml")。
    model_label : str
        "CDM" 或 "FDM"。
    """
    import argparse

    astro_label = "天体物理参数 (含FDM)" if model_label == "FDM" else "天体物理参数"

    parser = argparse.ArgumentParser(
        description=f"21cmFAST {model_label} 功率谱随红移演化生成工具"
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="随机种子 (默认: 从配置读取)",
    )
    parser.add_argument(
        "--show-config",
        action="store_true",
        help="显示当前配置并退出",
    )

    args = parser.parse_args()
    config = load_config(config_name)

    if args.show_config:
        print("\n" + "=" * 60)
        print(f"当前配置 ({config_name})")
        print("=" * 60)
        print(f"\n模板: {config.get('template', 'simple')}")
        print(f"\n模拟配置:")
        for key, val in config["simulation"].items():
            print(f"  {key}: {val}")
        print(f"\n{astro_label}:")
        for key, val in config["astro_params"].items():
            print(f"  {key}: {val}")
        return

    results = run_simulation(config, seed=args.seed, model_label=model_label)
    plot_power_spectrum_evolution(results, config, model_label=model_label)
    print("\n完成!")
