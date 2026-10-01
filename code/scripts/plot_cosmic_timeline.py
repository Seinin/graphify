"""21cm 宇宙学时间线图(PL2012 §3.1):一条长线 + 时期色带 + 特征红移事件。

输出: docs/images/cosmic_timeline.png
横轴: log10(宇宙年龄/Gyr), 主刻度标红移 z(非均匀, 由 z->age 换算)。
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyArrow
from matplotlib import font_manager

from astropy.cosmology import Planck18

# ---------- 中文字体 ----------
font_manager.fontManager.addfont(
    "/home/dministrat/.fonts/NotoSansCJKsc-Regular.otf"
)
plt.rcParams["font.family"] = "Noto Sans CJK SC"
plt.rcParams["axes.unicode_minus"] = False

cosmo = Planck18

def z_to_logage(z):
    """z -> log10(age/Gyr)"""
    return np.log10(cosmo.age(z).to_value("Gyr"))

# ---------- 时期(按 z 边界切分, 含颜色/名称/信号状态/说明) ----------
periods = [
    # (z_lo, z_hi, 名称, 颜色, 主导机制, 21cm信号)
    (200, 1100, "CMB 热耦合", "#374e7a", "Compton 散射\n碰撞耦合", "无信号"),
    (40, 200, "暗时代吸收", "#4c6db3", "绝热冷却\n碰撞耦合", "吸收"),
    (30, 40, "耦合空窗", "#8ea2c9", "碰撞耦合失效\nT_s→T_γ", "无信号"),
    (25, 30, "宇宙黎明\n(WF)", "#2e9e8f", "Lyα 耦合\n拉向冷气体", "深吸收谷"),
    (20, 25, "加热期", "#e8833a", "X-ray 加热\nT_k→T_γ", "吸收转发射"),
    (17, 20, "发射期", "#c74d2c", "T_k>T_γ\nT_s 饱和", "发射峰"),
    (0, 17, "再电离", "#a14a8a", "UV 电离\nHII 区膨胀", "信号消失"),
]

# ---------- 特征事件(用于刻度) ----------
events = [
    # (z, 标签, 主/次)
    (1100, "复合\nCMB 退耦", "main"),
    (200, "暗时代\n开始", "main"),
    (40, "碰撞耦合\n失效", "sub"),
    (30, "第一代源点亮\n$z_\\star$ (宇宙黎明)", "main"),
    (25, "Lyα 耦合饱和\n$z_\\alpha$", "sub"),
    (20, "T_k = T_γ\n吸收→发射 $z_h$", "main"),
    (17, "T_s 饱和\n$z_T$", "sub"),
    (10, "再电离完成\n$z_r$", "main"),
    (0, "今天", "main"),
]

# ---------- 布局 ----------
fig, ax = plt.subplots(figsize=(17, 8.2), dpi=150)

x0, x1 = z_to_logage(1100), z_to_logage(0) + 0.02
ax.set_xlim(x0, x1)
ax.set_ylim(-2.3, 3.6)

# ---- 主时间线 ----
ax.plot([x0, x1], [0, 0], color="#222222", lw=4, solid_capstyle="round", zorder=5)
for xend, a in ((x0, 180), (x1, 0)):
    ax.annotate("", xy=(xend, 0), xytext=(xend + (-1 if a else 1) * (x1 - x0) * 0.004, 0),
                arrowprops=dict(arrowstyle="-|>", color="#222222", lw=4))

# ---- 时期色带 ----
for i, (zlo, zhi, name, color, mech, sig) in enumerate(periods):
    w = z_to_logage(zlo) - z_to_logage(zhi)
    rect = Rectangle((z_to_logage(zhi), 0), w, 1.9,
                     facecolor=color, alpha=0.85, edgecolor="white", lw=1.5, zorder=2)
    ax.add_patch(rect)
    cx = z_to_logage(zhi) + w / 2
    # 名称: 宽色带横排, 窄色带竖排
    if w > 0.30:
        ax.text(cx, 1.28, name, ha="center", va="center", fontsize=12,
                color="white", fontweight="bold", zorder=4)
        ax.text(cx, 0.62, f"{mech}", ha="center", va="center", fontsize=8.5,
                color="white", alpha=0.95, zorder=4)
        ax.text(cx, 0.28, f"21cm: {sig}", ha="center", va="center", fontsize=8.5,
                color="white", alpha=0.9, zorder=4)
    else:
        ax.text(cx, 0.95, name.replace("\n", "\n"), ha="center", va="center",
                fontsize=9.5, color="white", fontweight="bold", rotation=90, zorder=4)
    # 红移范围标在色带顶
    ax.text(cx, 2.02, f"z = {zlo}–{zhi}", ha="center", va="bottom", fontsize=8,
            color="#444444", zorder=4)

# 加热期高亮(X-ray 主角)
zh_hi, zh_lo = 20, 25
w_h = z_to_logage(zh_lo) - z_to_logage(zh_hi)
rect = Rectangle((z_to_logage(zh_hi), 0), w_h, 1.9, fill=False,
                 edgecolor="#7a1f1f", lw=2.5, linestyle=(0, (6, 3)), zorder=6)
ax.add_patch(rect)
ax.text(z_to_logage(zh_hi) + w_h / 2, 3.35, "★ X-ray 主角", ha="center", va="center",
        fontsize=10.5, color="#7a1f1f", fontweight="bold", zorder=7)

# ---- 事件刻度(下方锯齿两行) ----
for z, label, kind in events:
    x = z_to_logage(z)
    ax.plot([x, x], [0, -0.45], color="#333333", lw=1.4, zorder=5)
    if kind == "main":
        ax.plot(x, 0, "o", ms=7, color="#111111", zorder=6)
        y = -0.75
    else:
        ax.plot(x, 0, "o", ms=4.5, color="#555555", zorder=6)
        y = -2.05
    ax.text(x, y, label, ha="center", va="top", fontsize=9.5, color="#222222", zorder=6,
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#bbbbbb", lw=0.6, alpha=0.92))

# ---- x 轴刻度(标 z, 用 z_to_logage 定位) ----
zticks = [1100, 200, 40, 10, 0]
ax.set_xticks([z_to_logage(z) for z in zticks])
ax.set_xticklabels([f"z = {z}" for z in zticks], fontsize=11)
# 次刻度: 事件红移
ztick2 = [30, 25, 20, 17]
ax.set_xticks([z_to_logage(z) for z in ztick2], minor=True)
ax.tick_params(axis="x", which="minor", length=8, width=1.2, color="#666666")
ax.set_xlabel("宇宙年龄 (Gyr, 对数刻度; 上方标红移 z)", fontsize=12)

# ---- 隐藏 y 轴, 加注释 ----
ax.set_yticks([])
for s in ("top", "right", "left"):
    ax.spines[s].set_visible(False)
ax.spines["bottom"].set_color("#222222")
ax.spines["bottom"].set_linewidth(1.2)

# 底部说明
fig.text(0.5, 0.015,
         "时间轴: 从复合(CMB 退耦)到再电离完成。虚线框 = X-ray 加热主导期(本手册主角)。",
         ha="center", va="bottom", fontsize=10, color="#555555")

ax.set_title("21cm 宇宙学时间线 (PL2012 §3.1 参考模型)",
             fontsize=16, fontweight="bold", pad=16)

out = "/home/dministrat/21cmFAST_fork/docs/images/cosmic_timeline.png"
import os
os.makedirs(os.path.dirname(out), exist_ok=True)
plt.savefig(out, dpi=150, bbox_inches="tight", facecolor="white")
print("saved:", out)
