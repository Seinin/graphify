#!/usr/bin/env python3
"""
plot_k_redshift.py - 绘制特定k值时功率谱随红移的演化曲线

从 config.yaml 读取配置参数
"""

import numpy as np
import matplotlib.pyplot as plt
import pandas as pd
import sys
import os

# 添加父目录以便导入
sys.path.insert(0, os.path.dirname(__file__))

from generate import (
    run_cdm_simulation_for_params,
    run_simulation_for_params,
    get_redshift_evolution_config,
    get_model_config,
    get_k_values
)


def find_k_index(k_values, k_target, tol=0.05):
    """找到最接近目标k值的索引"""
    idx = np.argmin(np.abs(k_values - k_target))
    if np.abs(k_values[idx] - k_target) > tol:
        print(f"警告: k={k_target} 不在范围内，最近的k值是 {k_values[idx]:.4f}")
    return idx


def get_k_values_from_config():
    """从默认配置获取k值"""
    k_min = 0.01
    k_max = 10.0
    n_bins = 256
    k_edges = np.logspace(np.log10(k_min), np.log10(k_max), n_bins + 1)
    k_centers = 10**(0.5 * (np.log10(k_edges[:-1]) + np.log10(k_edges[1:])))
    return k_centers


def plot_delta21_vs_redshift(redshifts, power_spectra, k_values, 
                              k_targets=[0.10, 0.42, 1.00],  # k=0.09区域数据不稳定，使用0.10
                              save_path='delta21_vs_z.png'):
    """
    绘制特定k值时Δ²₂₁随红移的演化曲线
    
    Parameters
    ----------
    redshifts : list
        红移数组
    power_spectra : list
        功率谱列表 (每个元素是对应红移的256个功率谱值)
    k_values : array
        k值数组
    k_targets : list
        目标k值列表
    save_path : str
        保存路径
    """
    plt.figure(figsize=(10, 7))
    plt.rcParams['font.size'] = 12
    
    colors = ['#e41a1c', '#377eb8', '#4daf4a']  # 红、蓝、绿
    markers = ['o', 's', '^']  # 圆、方、三角
    
    for i, k_target in enumerate(k_targets):
        k_idx = find_k_index(k_values, k_target)
        k_actual = k_values[k_idx]
        
        # 提取该k值对应的功率谱
        delta21 = [ps[k_idx] if k_idx < len(ps) else np.nan for ps in power_spectra]
        
        plt.plot(redshifts, delta21, marker=markers[i], markersize=8,
                linewidth=2, color=colors[i], 
                label=f'$k = {k_actual:.2f}$ Mpc$^{{-1}}$')
    
    plt.xlabel(r'Redshift $z$', fontsize=14)
    plt.ylabel(r'$\Delta^2_{21}(k)$ [mK$^2$]', fontsize=14)
    plt.title(r'$\Delta^2_{21}$ vs Redshift at Different $k$', fontsize=16)
    plt.legend(loc='best', fontsize=12)
    plt.grid(True, alpha=0.3)
    plt.gca().invert_xaxis()  # 红移从大到小
    plt.tight_layout()
    
    plt.savefig(save_path, dpi=150, bbox_inches='tight')
    print(f"图表已保存: {save_path}")
    plt.show()
    
    return plt.gcf()


def generate_and_plot_cdm():
    """从配置文件读取参数生成CDM数据并绘图"""
    from scipy.interpolate import interp1d
    
    # 从配置文件读取参数
    evo_config = get_redshift_evolution_config()
    model_config = get_model_config('CDM')
    default_params = model_config['default_params']
    
    z_min = evo_config['z_min']
    z_max = evo_config['z_max']
    n_redshift = evo_config['n_redshift']
    n_points = evo_config['n_plot_points']
    k_targets = evo_config['k_targets']
    
    print("=" * 60)
    print("生成CDM功率谱数据并绘制 Δ²₂₁ vs z")
    print("=" * 60)
    
    # 使用配置文件中的默认参数
    alpha = default_params['alpha']
    zeta = default_params['zeta']
    Tvir = default_params['Tvir']
    L_X = default_params['L_X']
    
    # 模拟红移点 (均分)
    sim_redshifts = np.linspace(z_min, z_max, n_redshift).tolist()
    
    print(f"\n模拟参数 (来自 config.yaml):")
    print(f"  α = {alpha}")
    print(f"  ζ = {zeta}")
    print(f"  Tvir = {Tvir}")
    print(f"  L_X = {L_X}")
    print(f"  红移范围: {z_min} - {z_max}")
    print(f"  模拟点数: {len(sim_redshifts)}")
    print(f"  绘图点数: {n_points}")
    print(f"  目标k值: {k_targets}")
    print()
    
    # 运行模拟
    print("运行21cmFAST模拟...")
    result = run_cdm_simulation_for_params(
        alpha=alpha,
        zeta=zeta,
        Tvir=Tvir,
        L_X=L_X,
        random_seed=42,
        redshifts=sim_redshifts
    )
    
    k_values = result['k']
    power_spectra = result['power_spectra']
    
    print(f"模拟完成! ({len(sim_redshifts)} 个红移点)")
    print(f"k值范围: {k_values[0]:.4f} - {k_values[-1]:.4f} Mpc^-1")
    
    # 对每个k值进行插值，获得平滑曲线
    print(f"\n插值到 {n_points} 个采样点...")
    
    target_redshifts = np.linspace(z_min, z_max, n_points)
    interpolated_data = {k: [] for k in k_targets}
    
    for k_target in k_targets:
        k_idx = find_k_index(k_values, k_target)
        
        delta21_sim = [ps[k_idx] if k_idx < len(ps) else np.nan for ps in power_spectra]
        
        valid_mask = ~np.isnan(delta21_sim)
        if np.sum(valid_mask) > 1:
            interp_func = interp1d(
                np.array(sim_redshifts)[valid_mask],
                np.array(delta21_sim)[valid_mask],
                kind='cubic',
                fill_value='extrapolate'
            )
            delta21_interp = interp_func(target_redshifts)
        else:
            delta21_interp = np.full(n_points, np.nan)
        
        interpolated_data[k_target] = delta21_interp
    
    # 绘制
    print("绘制图表...")
    fig, ax = plt.subplots(figsize=(10, 7))
    plt.rcParams['font.size'] = 12
    
    colors = ['#e41a1c', '#377eb8', '#4daf4a']
    markers = ['o', 's', '^']
    
    for i, k_target in enumerate(k_targets):
        k_idx = find_k_index(k_values, k_target)
        k_actual = k_values[k_idx]
        
        ax.plot(target_redshifts, interpolated_data[k_target], 
               marker=markers[i], markersize=5, markevery=5,
               linewidth=2, color=colors[i], 
               label=f'$k = {k_actual:.2f}$ Mpc$^{{-1}}$')
        
        ax.scatter(sim_redshifts, [ps[k_idx] for ps in power_spectra],
                  s=20, color=colors[i], alpha=0.5, marker='x')
    
    ax.set_xlabel(r'Redshift $z$', fontsize=14)
    ax.set_ylabel(r'$\Delta^2_{21}(k)$ [mK$^2$]', fontsize=14)
    ax.set_title(r'$\Delta^2_{21}$ vs Redshift at Different $k$', fontsize=16)
    ax.legend(loc='best', fontsize=12)
    ax.grid(True, alpha=0.3)
    ax.invert_xaxis()
    ax.set_xlim(z_max + 0.5, z_min - 0.5)
    plt.tight_layout()
    
    save_path = 'CDM_delta21_vs_z.png'
    plt.savefig(save_path, dpi=150, bbox_inches='tight')
    print(f"图表已保存: {save_path}")
    plt.show()
    
    return fig


def plot_from_csv(csv_path, k_targets=[0.09, 0.42, 1.00]):
    """从CSV文件绘制"""
    print(f"从 {csv_path} 加载数据...")
    
    df = pd.read_csv(csv_path)
    print(f"加载了 {len(df)} 条记录")
    
    # 获取红移列表
    redshifts = sorted(df['redshift'].unique())
    
    # 获取k值
    k_cols = [col for col in df.columns if col.startswith('ps_k')]
    k_values = get_k_values_from_config()
    
    # 计算每个红移的平均功率谱
    power_spectra = []
    for z in redshifts:
        z_df = df[df['redshift'] == z]
        ps_mean = z_df[k_cols].mean().values
        power_spectra.append(ps_mean)
    
    # 绘制
    save_path = csv_path.replace('.csv', '_delta21_vs_z.png')
    plot_delta21_vs_redshift(
        redshifts=redshifts,
        power_spectra=power_spectra,
        k_values=k_values,
        k_targets=k_targets,
        save_path=save_path
    )


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(
        description='绘制特定k值时功率谱随红移的演化'
    )
    parser.add_argument(
        '-i', '--input',
        type=str,
        default=None,
        help='CSV数据文件路径 (可选，不提供则运行新模拟)'
    )
    parser.add_argument(
        '-k', '--k_values',
        type=float,
        nargs=3,
        default=[0.09, 0.42, 1.00],
        help='k值列表 (默认: 0.09 0.42 1.00)'
    )
    parser.add_argument(
        '-o', '--output',
        type=str,
        default='delta21_vs_z.png',
        help='输出图片路径'
    )
    
    args = parser.parse_args()
    
    if args.input and os.path.exists(args.input):
        # 从CSV绘制
        plot_from_csv(args.input, k_targets=args.k_values)
    else:
        # 运行新模拟并绘制
        generate_and_plot_cdm()
