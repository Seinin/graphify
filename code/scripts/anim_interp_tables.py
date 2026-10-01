#!/usr/bin/env python3
"""
interp_tables 建表过程的"逻辑动画"（不模拟物理，只复刻计算流程与变量流）
======================================================================

动画化的不是物理，而是 `src/py21cmfast/src/interp_tables.c` 里
`initialise_Nion_Ts_spline()` 这段计算的**结构、调度与变量流**：

    代码里的东西                                      动画里对应的东西
    ----------------------------------------------    ------------------------------------------
    static RGTable2D ... = {.allocated=false}         便签纸出厂为空（第 0 幕）
    if (!table.allocated) allocate_RGTable2D(...)     只在第一次分配；allocated 变 true（第 1 幕）
    x_min/x_width/y_min/y_width                       写网格元数据（第 2 幕，灰=表级）
    #pragma omp parallel private(i, j)                线程 + 每线程私有的 (i, j)（第 3 幕，橙=私有）
    #pragma omp for  for (i = 0; i < Nbin; i++)       线程按列分工：列主人 = i % N_THREADS
      z_val   = x_min + i * x_width                   由【列】反算红移（蓝）
      sc_z    = evolve_scaling_constants_to_redshift(z_val, sc)  每列演化一次标度常数（蓝）
      lnMmin  = log(minimum_source_mass(z_val, true)) 积分下限；mini 打开时它直接返回 M_MIN_INTEGRAL
      内层 for (j = 0; j < NMTURN; j++)
        mturn_mcg = pow(10, y_min + j * y_width)      由【行】反算 Mturn（绿）
        z_arr[i][j] = Nion_General_MINI(z_val, lnMmin, lnMmax, mturn_mcg, &sc_z)
    Nion_z_table.y_arr[i] = Nion_General(...)         某列最后一档做完 → 写一维表
    串行 isfinite() 校验 + Throw(...)                  第 4 幕；--inject-nan 演示失败
    EvaluateNionTs(z) / _MINI(...)                    第 5 幕：只插值，不再积分
    值每次调用被重填，allocated 只管内存                第 6 幕：第 2 次调用擦掉重填

真实常数（取自 hmf.h）：M_MIN_INTEGRAL = 1e5、M_MAX_INTEGRAL = 1e16。

面板说明：
  左上  表格网格：列 = 红移（蓝），行 = log10 Mturn（绿）——**这两条是参数轴**
  左中  质量轴：lnMmin 到 lnMmax 之间的求积节点与 w_k·f(x_k)——**这两条才是积分限**
  左下  一维表 Nion_z_table
  右    变量监视：按作用域上色 + 每线程私有的 (i, j) + 计数器

用法：
    python3 scripts/anim_interp_tables.py                  # 写 scripts/anim_interp_tables.gif
    python3 scripts/anim_interp_tables.py --show
    python3 scripts/anim_interp_tables.py --mini-off       # USE_MINI_HALOS=False 的分支
    python3 scripts/anim_interp_tables.py --inject-nan     # 演示校验失败（Throw）
    python3 scripts/anim_interp_tables.py --fps 12 --out /tmp/t.gif --png
"""

from __future__ import annotations

import argparse
import math
import os

import numpy as np

import matplotlib

if "--show" not in os.sys.argv:
    matplotlib.use("Agg")

import matplotlib.font_manager as fm
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, PillowWriter
from matplotlib.patches import Rectangle

# ----------------------------------------------------------------------------
# 与代码同构的参数
# ----------------------------------------------------------------------------
NBIN = 12        # 红移方向格数（代码：Nbin / zpp_interp_points_SFR）
NMTURN = 5       # log10(Mturn) 档数（代码：NMTURN）
N_THREADS = 4    # 线程数（代码：simulation_options_global->N_THREADS）

ZMIN, ZMAX = 5.0, 30.0                  # determine_zpp_min / _max
LOGMTURN_MIN, LOGMTURN_MAX = 5.0, 9.0   # LOG10_MTURN_MIN / LOG10_MTURN_MAX

M_MIN_INTEGRAL, M_MAX_INTEGRAL = 1e5, 1e16      # hmf.h：积分下限/上限（真实值）
LNMMIN_MINI = math.log(M_MIN_INTEGRAL)          # mini 打开时 minimum_source_mass 直接返回它
LNMMAX = math.log(M_MAX_INTEGRAL)               # = log(M_MAX_INTEGRAL)，与两条参数轴无关
M_TURN_A_NOFB = 3.5e8                           # 代码：sc->mturn_a_nofb（示意数值）

MINI_HALOS = True   # astro_options_global->USE_MINI_HALOS
NROWS = NMTURN      # 二维表实际行数；关掉 mini 时二维表不分配


def set_mini(enabled: bool) -> None:
    """对应 USE_MINI_HALOS：关掉后二维表不分配，且积分下限改由 TtoM(z) 给出。"""
    global MINI_HALOS, NROWS
    MINI_HALOS = bool(enabled)
    NROWS = NMTURN if MINI_HALOS else 1


# 作用域配色：说清"这个变量是谁的"
C_TABLE = "#6b6b6b"   # 表级 / 出厂常量
C_COL = "#1f6fb2"     # 随列（红移）变
C_ROW = "#2e8b45"     # 随行（Mturn）变
C_LOCAL = "#d2691e"   # 线程私有局部
C_CNT = "#333333"
THREAD_COLORS = ["#e4572e", "#2e86ab", "#3fa34d", "#8a4fbf"][:N_THREADS]
EMPTY_FACE = "#e9e9e9"


# ----------------------------------------------------------------------------
# 中文字体检测
# ----------------------------------------------------------------------------
def _pick_cjk_font() -> str | None:
    want = ["Noto Sans CJK SC", "Noto Sans CJK JP", "Source Han Sans SC", "Source Han Sans",
            "WenQuanYi Zen Hei", "WenQuanYi Micro Hei", "Microsoft YaHei", "SimHei",
            "PingFang SC", "Heiti SC", "Droid Sans Fallback", "AR PL UMing CN"]
    have = {f.name for f in fm.fontManager.ttflist}
    return next((n for n in want if n in have), None)


CJK = _pick_cjk_font()
if CJK:
    plt.rcParams["font.sans-serif"] = [CJK, "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False


def L(en: str, zh: str) -> str:
    return zh if CJK else en


# ----------------------------------------------------------------------------
# 坐标反算
# ----------------------------------------------------------------------------
def z_of(i: int) -> float:
    return ZMIN + i * (ZMAX - ZMIN) / (NBIN - 1)


def mturn_of(j: int) -> float:
    return LOGMTURN_MIN + j * (LOGMTURN_MAX - LOGMTURN_MIN) / (NMTURN - 1)


def lnmmin_of(z: float) -> float:
    """对应 minimum_source_mass(z, true)：USE_MINI_HALOS 时它直接 return M_MIN_INTEGRAL（与 z 无关）。"""
    if MINI_HALOS:
        return LNMMIN_MINI
    return math.log(1e5 * (1.0 + z) ** 1.5)   # 示意：非 mini 时由 TtoM(z, ION_Tvir_MIN, mu) 给出


# ----------------------------------------------------------------------------
# 占位计算（代替 Nion_General / Nion_General_MINI）
# ----------------------------------------------------------------------------
def fake_integral(z: float, log10_mturn: float) -> float:
    """每次调用 = 一个格子的值（真实的是一次 GSL 积分）。"""
    return 1.0 / (1.0 + 0.12 * z) * (1.0 + 0.10 * (log10_mturn - LOGMTURN_MIN))


def mass_terms(z: float, log10_mturn: float, nnode: int = 8):
    """把同一件事画成"质量轴上的节点 × 权重"（节点示意；真实节点由 QAG 自适应或 GL 固定节点给出）。"""
    lo, hi = lnmmin_of(z), LNMMAX
    edges = np.linspace(lo, hi, nnode + 1)
    lnm = 0.5 * (edges[:-1] + edges[1:])
    w = (hi - lo) / nnode
    M = np.exp(lnm)
    mturn = 10.0 ** log10_mturn
    # 示意被积函数 dn/dlnM · f* · f_esc · M · e^{-Mturn/M}：
    # 低质量端被窗口 e^{-Mturn/M} 压住，整体随 M 抬升后被 dn/dlnM 的下降拉回
    integ = np.exp(-mturn / M) * np.exp(-0.09 * lnm)
    return lnm, w * integ


# ----------------------------------------------------------------------------
# 调度
# ----------------------------------------------------------------------------
def omp_column_owner(i: int) -> int:
    """静态分块：线程 k 认领 i = k, k+N_THREADS, k+2*N_THREADS ..."""
    return i % N_THREADS


def build_choreography(inject_nan: bool) -> list[dict]:
    frames: list[dict] = []
    values = np.full((NMTURN, NBIN), np.nan)
    one_d = np.full(NBIN, np.nan)
    counters = {"calls": 0, "allocs": 0, "integrals": 0}
    nan_cell = (min(2, NROWS - 1), NBIN - 5) if inject_nan else None
    thread_pos: list[tuple[int, int] | None] = [None] * N_THREADS   # private(i, j)

    def snap(phase: str, caption: str, **kw) -> None:
        frames.append(dict(phase=phase, caption=caption, values=values.copy(),
                           one_d=one_d.copy(), counters=dict(counters),
                           thread_pos=list(thread_pos), **kw))

    def cur(j, i, t, z, mturn):
        return dict(j=j, i=i, t=t, z_val=z, mturn=mturn,
                    lnMmin=lnmmin_of(z), lnMmax=LNMMAX)

    # ---- 第 0 幕：出厂状态 ----
    snap(L("0 | factory state", "0｜出厂状态"),
         L("Static buffer, one per process. allocated = false: nothing is allocated, nobody may read it.",
           "一块 static 缓冲区，进程内一份。allocated = false：还没分配，也不该有人读它。"),
         allocated=False, axes_ready=False, outline=False)
    snap(L("0 | factory state", "0｜出厂状态"),
         L("Colour key: grey = table-level, blue = per-column(z), green = per-row(Mturn), orange = thread-private.",
           "先认颜色：灰＝表级、蓝＝随列(红移)、绿＝随行(Mturn)、橙＝线程私有。"),
         allocated=False, axes_ready=False, outline=False)

    # ---- 第 1 幕：惰性分配 ----
    counters["calls"] += 1
    counters["allocs"] += 1
    snap(L("1 | allocate", "1｜分配内存"),
         L("Call #1 -> if (!table.allocated) allocate_RGTable2D(Nbin, NMTURN): allocated becomes true.",
           "第 1 次调用 → if (!table.allocated) allocate_RGTable2D(Nbin, NMTURN)：allocated 变 true。"),
         allocated=True, axes_ready=False, outline=True)
    if not MINI_HALOS:
        snap(L("1 | allocate", "1｜分配内存"),
             L("USE_MINI_HALOS = false -> the 2D table is never allocated: rows 2..NMTURN have no memory.",
               "USE_MINI_HALOS = false → 二维表根本不分配：第 2 行起的 Mturn 档没有内存，只剩一维表。"),
             allocated=True, axes_ready=False, outline=True)

    # ---- 第 2 幕：写网格元数据 ----
    for _ in range(2):
        snap(L("2 | grid metadata", "2｜写网格元数据"),
             L("x_min/x_width and y_min/y_width are only PARAMETERS (the axes) - the integral limits are lnMmin/lnMmax.",
               "写 x_min/x_width 与 y_min/y_width。注意：这两条只是**参数**（两条轴）；积分限是 lnMmin / lnMmax。"),
             allocated=True, axes_ready=True, outline=True)

    # ---- 第 3 幕：并行填充 ----
    for j in range(NROWS):
        for i in range(NBIN):
            t = omp_column_owner(i)
            counters["integrals"] += 1
            value = fake_integral(z_of(i), mturn_of(j))
            if nan_cell is not None and (j, i) == nan_cell:
                value = np.nan
            values[j, i] = value
            if j == NROWS - 1:
                one_d[i] = float(np.nansum(values[:, i]))
            thread_pos[t] = (i, j)
            snap(L("3 | omp parallel fill", "3｜并行填充"),
                 L(f"T{t}: i={i} -> z_val={z_of(i):.2f} (also fixes lnMmin={lnmmin_of(z_of(i)):.2f}); "
                   f"j={j} -> mturn={mturn_of(j):.2f}; integrate lnM over "
                   f"[{lnmmin_of(z_of(i)):.2f}, {LNMMAX:.2f}]",
                   f"T{t}：i={i} → z_val={z_of(i):.2f}（同时定下 lnMmin={lnmmin_of(z_of(i)):.2f}）；"
                   f"j={j} → mturn={mturn_of(j):.2f}；对 lnM 从 "
                   f"[{lnmmin_of(z_of(i)):.2f}, {LNMMAX:.2f}] 积分"),
                 allocated=True, axes_ready=True, outline=True,
                 computing=cur(j, i, t, z_of(i), mturn_of(j)))

    # ---- 第 4 幕：串行校验 ----
    snap(L("4 | serial validation", "4｜串行校验"),
         L("Parallel region joined. Now a plain serial loop: isfinite() on every cell.",
           "并行段结束、汇合之后，改成一个普通的串行循环：逐格 isfinite() 检查。"),
         allocated=True, axes_ready=True, outline=True)
    aborted = False
    for j in range(NROWS):
        if aborted:
            break
        for i in range(NBIN):
            bad = nan_cell is not None and (j, i) == nan_cell
            snap(L("4 | serial validation", "4｜串行校验"),
                 (L(f"cell (i={i}, j={j}) is NaN -> LOG_ERROR + Throw(TableGenerationError)",
                    f"第 (i={i}, j={j}) 格是 NaN → LOG_ERROR + Throw(TableGenerationError)")
                  if bad else L(f"cell (i={i}, j={j}) : finite OK", f"第 (i={i}, j={j}) 格：finite，通过")),
                 allocated=True, axes_ready=True, outline=True,
                 validate_cell=(j, i), failed=bad)
            if bad:
                aborted = True
                break

    # ---- 第 5 幕：使用（插值，不再积分） ----
    for step in range(13):
        zi = ZMIN + (ZMAX - ZMIN) * step / 12.0
        snap(L("5 | use: interpolate", "5｜使用：查表插值"),
             L(f"EvaluateNionTs(z={zi:.2f}) -> interpolate between two columns. No integral, counters frozen.",
               f"EvaluateNionTs(z={zi:.2f}) → 在相邻两列之间插值取值。不再积分，计数器不动。"),
             allocated=True, axes_ready=True, outline=True, eval_z=zi)
    if MINI_HALOS:
        for step in range(9):
            zi = ZMIN + (ZMAX - ZMIN) * step / 8.0
            snap(L("5 | use: interpolate", "5｜使用：查表插值"),
                 L(f"EvaluateNionTs_MINI(z={zi:.2f}, log10 Mturn) -> pick one cell in the 2D table.",
                   f"EvaluateNionTs_MINI(z={zi:.2f}, log10 Mturn) → 在二维表里定到一格，同样不积分。"),
                 allocated=True, axes_ready=True, outline=True, eval_z=zi, eval_2d=True)

    # ---- 第 6 幕：第 2 次调用 = 擦掉重填 ----
    counters["calls"] += 1
    snap(L("6 | call #2 : refill", "6｜第 2 次调用：擦掉重填"),
         L("Call #2 -> allocated is already true, so NO new allocation. Only the values are recomputed.",
           "第 2 次调用 → allocated 已为 true，不再分配内存；只有数值被重算覆盖。"),
         allocated=True, axes_ready=True, outline=True, wipe=True)
    values[:] = np.nan
    one_d[:] = np.nan
    snap(L("6 | call #2 : refill", "6｜第 2 次调用：擦掉重填"),
         L("Same code path, same variables, new contents: the buffer is reused, the values are not.",
           "同一段代码、同一批变量，内容全新：复用是的缓冲区，不是结果。"),
         allocated=True, axes_ready=True, outline=True)
    for j in range(NROWS):
        for i in range(NBIN):
            t = omp_column_owner(i)
            counters["integrals"] += 1
            values[j, i] = fake_integral(z_of(i), mturn_of(j))
            if j == NROWS - 1:
                one_d[i] = float(np.nansum(values[:, i]))
            thread_pos[t] = (i, j)
            snap(L("6 | call #2 : refill", "6｜第 2 次调用：擦掉重填"),
                 L(f"T{t} recomputes (i={i}, j={j}) — the integral counter keeps rising",
                   f"T{t} 重算 (i={i}, j={j}) —— 积分次数继续累加"),
                 allocated=True, axes_ready=True, outline=True,
                 computing=cur(j, i, t, z_of(i), mturn_of(j)))
    snap(L("done", "结束"),
         L(f"allocations={counters['allocs']}  calls={counters['calls']}  integrals={counters['integrals']} "
           f"-> a reused scratch pad, not a cross-snapshot cache.",
           f"分配次数={counters['allocs']}  调用次数={counters['calls']}  积分次数={counters['integrals']} "
           f"→ 被反复擦写的便签纸，不是跨快照缓存。"),
         allocated=True, axes_ready=True, outline=True)
    return frames


# ----------------------------------------------------------------------------
# 渲染
# ----------------------------------------------------------------------------
def wrap(text: str, width: int) -> list[str]:
    out, cur, w = [], "", 0
    for ch in text:
        cw = 2 if ord(ch) > 0x2000 else 1
        # 不在数字中间断行（否则 "36.84" 会被拆成 "3" / "6.84"）
        if w + cw > width and not (cur and cur[-1].isdigit() and ch.isdigit()):
            out.append(cur)
            cur, w = "", 0
        cur += ch
        w += cw
    if cur:
        out.append(cur)
    return out


def render(ax2d, axmass, ax1d, axw, frame, total, idx):
    for ax in (ax2d, axmass, ax1d, axw):
        ax.clear()

    vmax = max(1e-9, float(fake_integral(0.0, LOGMTURN_MAX)))
    cmap = plt.get_cmap("viridis")
    comp = frame.get("computing")

    # ---------------- 左上：表格网格（两条参数轴） ----------------
    for j in range(NROWS):
        for i in range(NBIN):
            v = frame["values"][j, i]
            face = EMPTY_FACE if np.isnan(v) else cmap(min(1.0, v / vmax) * 0.9)
            ax2d.add_patch(Rectangle((i, j), 1, 1, facecolor=face,
                                     edgecolor="#bbbbbb", linewidth=0.8))
    if not MINI_HALOS:
        for j in range(NROWS, NMTURN):
            ax2d.add_patch(Rectangle((0, j), NBIN, 1, facecolor="#f7f7f7",
                                     edgecolor="#dddddd", linewidth=0.8, hatch="///"))
        ax2d.text(NBIN / 2, (NROWS + NMTURN) / 2, L("not allocated", "未分配"),
                  ha="center", va="center", fontsize=9, color="#999999")
    if frame.get("outline"):
        ax2d.add_patch(Rectangle((0, 0), NBIN, NROWS, fill=False,
                                 edgecolor="#333333", linewidth=1.6))
    if comp:
        ax2d.add_patch(Rectangle((comp["i"], 0), 1, NROWS, fill=False,
                                 edgecolor=C_COL, linewidth=2.2, linestyle=":"))
        ax2d.add_patch(Rectangle((0, comp["j"]), NBIN, 1, fill=False,
                                 edgecolor=C_ROW, linewidth=2.2, linestyle=":"))
        ax2d.add_patch(Rectangle((comp["i"], comp["j"]), 1, 1, fill=False,
                                 edgecolor=THREAD_COLORS[comp["t"]], linewidth=5.0, alpha=0.40))
        ax2d.add_patch(Rectangle((comp["i"], comp["j"]), 1, 1, fill=False,
                                 edgecolor=C_LOCAL, linewidth=3.0))
    if "validate_cell" in frame:
        j, i = frame["validate_cell"]
        ax2d.add_patch(Rectangle((i, j), 1, 1, fill=False,
                                 edgecolor=("#d62728" if frame.get("failed") else "#1f9e3d"),
                                 linewidth=3.0))
    if frame.get("wipe"):
        ax2d.add_patch(Rectangle((0, 0), NBIN, NROWS, fill=False,
                                 edgecolor="#d62728", linewidth=3.5, linestyle="--"))
    if frame.get("eval_z") is not None:
        zx = (frame["eval_z"] - ZMIN) / (ZMAX - ZMIN) * (NBIN - 1) + 0.5
        ax2d.plot([zx], [NROWS / 2], marker="o", markersize=10, color="#d62728",
                  markeredgecolor="white", zorder=5)
    for i in range(NBIN):
        t = omp_column_owner(i)
        ax2d.plot([i + 0.5, i + 0.5], [NROWS, NROWS + 0.42], color=THREAD_COLORS[t],
                  linewidth=(2.8 if comp and comp["i"] == i else 1.0),
                  alpha=(1.0 if comp and comp["i"] == i else 0.4), solid_capstyle="butt")
    ax2d.set_xlim(-0.4, NBIN + 0.4)
    ax2d.set_ylim(-0.4, NMTURN + 0.75)
    ax2d.set_xticks(np.arange(NBIN) + 0.5)
    ax2d.set_xticklabels([f"{z_of(i):.0f}" for i in range(NBIN)], fontsize=7, color=C_COL)
    ax2d.set_yticks(np.arange(NMTURN) + 0.5)
    ax2d.set_yticklabels([f"{mturn_of(j):.1f}" for j in range(NMTURN)], fontsize=7, color=C_ROW)
    ax2d.set_xlabel(L("redshift z  <-- PARAMETER axis (drives the integrand, and lnMmin)",
                      "红移 z　←　参数轴（驱动被积函数，并决定 lnMmin）"), fontsize=8.5, color=C_COL)
    ax2d.set_ylabel(L("log10 Mturn  <-- PARAMETER axis", "log10 Mturn　←　参数轴"),
                    fontsize=8.5, color=C_ROW)
    ax2d.set_title(L("table grid: one cell = one whole integral",
                     "表的网格：一个格子 = 一次完整积分"), fontsize=10)

    # ---------------- 左中：质量轴（这两条才是积分限） ----------------
    if frame.get("allocated") and frame.get("axes_ready"):
        if comp:
            lnm, terms = mass_terms(comp["z_val"], comp["mturn"])
            tot = float(np.sum(terms))
            lmax = max(1e-300, float(np.max(terms)))
            heights = np.log10(np.maximum(terms, 1e-300) / lmax)
            axmass.bar(lnm, heights + 5.0, bottom=-5.0,
                       width=(LNMMAX - lnmmin_of(comp["z_val"])) / (len(terms) * 1.7),
                       color=C_COL, alpha=0.55)
            axmass.axvline(comp["lnMmin"], color=C_COL, linewidth=2.0)
            axmass.axvline(LNMMAX, color=C_TABLE, linewidth=2.0)
            axmass.text(comp["lnMmin"] + 0.4, -4.75,
                        L(f"lnMmin = {comp['lnMmin']:.2f}\n(lower limit)",
                          f"lnMmin = {comp['lnMmin']:.2f}\n（下限）"),
                        fontsize=8, color=C_COL, va="bottom")
            axmass.text(LNMMAX - 0.4, -4.75,
                        L(f"lnMmax = {LNMMAX:.2f}\n(constant, upper limit)",
                          f"lnMmax = {LNMMAX:.2f}\n（常数，上限）"),
                        fontsize=8, color=C_TABLE, va="bottom", ha="right")
            axmass.text(0.01, 0.96,
                        L(f"sum of w_k*f(x_k) = {tot:.3e}\n-> z_arr[i={comp['i']}][j={comp['j']}]",
                          f"Σ w_k·f(x_k) = {tot:.3e}\n→ 写入 z_arr[i={comp['i']}][j={comp['j']}]"),
                        transform=axmass.transAxes, va="top", fontsize=9, color="#111111")
        else:
            axmass.text(0.5, 0.5, L("mass axis: the integral happens here",
                                    "质量轴：积分发生在这里"),
                        transform=axmass.transAxes, ha="center", va="center",
                        fontsize=10, color="#999999")
    axmass.set_xlim(min(lnmmin_of(ZMAX), LNMMIN_MINI) - 1.0, LNMMAX + 1.0)
    axmass.set_ylim(-5.0, 0.4)
    axmass.set_yticks([-4, -2, 0])
    axmass.tick_params(labelsize=7)
    axmass.set_ylabel(L("log10(w_k f) / max", "log10(w_k·f) / max"), fontsize=8)
    axmass.set_xlabel(L("ln M   (integration variable; bars = schematic nodes)",
                        "ln M（积分变量；柱＝示意节点）"), fontsize=8.5)
    axmass.set_title(L("inside one cell: sum over nodes between lnMmin and lnMmax",
                       "一个格子内部：在 lnMmin 与 lnMmax 之间按节点累加"), fontsize=9.5)

    # ---------------- 左下：一维表 ----------------
    for i in range(NBIN):
        v = frame["one_d"][i]
        face = EMPTY_FACE if np.isnan(v) else cmap(min(1.0, v / (vmax * NROWS)) * 0.9)
        ax1d.add_patch(Rectangle((i, 0), 1, 1, facecolor=face,
                                 edgecolor="#bbbbbb", linewidth=0.8))
    ax1d.add_patch(Rectangle((0, 0), NBIN, 1, fill=False, edgecolor="#333333", linewidth=1.4))
    if frame.get("eval_z") is not None:
        zx = (frame["eval_z"] - ZMIN) / (ZMAX - ZMIN) * (NBIN - 1) + 0.5
        ax1d.plot([zx], [1.25], marker="v", markersize=9, color="#d62728",
                  markeredgecolor="white", zorder=5, clip_on=False)
    ax1d.set_xlim(-0.4, NBIN + 0.4)
    ax1d.set_ylim(-0.15, 1.35)
    ax1d.set_xticks([])
    ax1d.set_yticks([])
    ax1d.set_title(L("1D table: Nion_z_table  (written when a column finishes all Mturn bins)",
                     "一维表：Nion_z_table（某列把全部 Mturn 档做完后写入）"), fontsize=9)

    # ---------------- 右侧：变量监视（按行均匀排版，不会重叠/溢出） ----------------
    axw.axis("off")
    c = frame["counters"]
    items: list[tuple[str, str, float, str]] = []
    items.append((frame["phase"], "#111111", 11.5, "bold"))
    items.append((L("-- table-level (grey)", "-- 表级（灰）"), "#888888", 8.5, "normal"))
    items.append((f"allocated = {str(frame.get('allocated', False)).lower()}",
                  C_TABLE if frame.get("allocated") else "#b0b0b0", 9.5, "normal"))
    if frame.get("axes_ready"):
        items.append((f"x_min={ZMIN:.2f}  x_width={(ZMAX - ZMIN) / (NBIN - 1):.2f}", C_TABLE, 9.5, "normal"))
        items.append((f"y_min={LOGMTURN_MIN:.2f}  y_width={(LOGMTURN_MAX - LOGMTURN_MIN) / (NMTURN - 1):.2f}",
                      C_TABLE, 9.5, "normal"))
        items.append((f"lnMmax={LNMMAX:.2f} (fixed)", C_TABLE, 9.5, "normal"))
    else:
        items.append(("(grid metadata not written yet)", "#b0b0b0", 9.5, "normal"))
    items.append((L("-- thread-private: (i, j)", "-- 线程私有：(i, j)"), "#888888", 8.5, "normal"))
    for k in range(N_THREADS):
        p = frame["thread_pos"][k]
        items.append((f"T{k}: " + ("--" if p is None else f"i={p[0]}  j={p[1]}"),
                      THREAD_COLORS[k], 9.5, "normal"))
    items.append((L("-- current cell locals", "-- 当前格局部量"), "#888888", 8.5, "normal"))
    if comp:
        items += [
            (f"i={comp['i']}  ->  z_val = {comp['z_val']:.2f}", C_COL, 9.5, "normal"),
            (f"lnMmin = {comp['lnMmin']:.2f}"
             + (L("  (= ln M_MIN_INTEGRAL)", "  （= ln M_MIN_INTEGRAL）") if MINI_HALOS else "  (from z_val)"),
             C_COL, 9.5, "normal"),
            (f"j={comp['j']}  ->  mturn = {comp['mturn']:.2f}", C_ROW, 9.5, "normal"),
            (f"lnMmax = {comp['lnMmax']:.2f}  (fixed)", C_TABLE, 9.5, "normal"),
            (f"sc_z.mturn_a_nofb = {M_TURN_A_NOFB:.1e}", C_COL, 9.5, "normal"),
            ("-> z_arr[i][j]", C_LOCAL, 9.5, "normal"),
        ]
    else:
        items.append(("--", "#b0b0b0", 9.5, "normal"))
    items.append((L("-- counters", "-- 计数"), "#888888", 8.5, "normal"))
    items.append((f"calls={c['calls']}  allocs={c['allocs']}  integrals={c['integrals']}", C_CNT, 9.5, "normal"))

    cap = wrap(frame["caption"], 48)[:7]
    items.append((L("-- what just happened", "-- 这一帧在做什么"), "#888888", 8.5, "normal"))
    items += [(chunk, "#0b3d91", 9.5, "normal") for chunk in cap]
    items.append((f"frame {idx + 1}/{total}", "#888888", 8.0, "normal"))

    dy = min(0.052, 0.94 / max(1, len(items)))
    y = 0.985
    for text, color, size, weight in items:
        axw.text(0.0, y, text, fontsize=size, color=color, fontweight=weight,
                 transform=axw.transAxes, va="top", family="monospace")
        y -= dy


def main() -> None:
    p = argparse.ArgumentParser(description="Animate the interp_tables build logic (variables included).")
    here = os.path.dirname(os.path.abspath(__file__))
    p.add_argument("--out", default=os.path.join(here, "anim_interp_tables.gif"))
    p.add_argument("--fps", type=int, default=9)
    p.add_argument("--show", action="store_true")
    p.add_argument("--mini-off", action="store_true", help="演示 USE_MINI_HALOS=False")
    p.add_argument("--inject-nan", action="store_true", help="演示校验失败路径（Throw）")
    p.add_argument("--png", action="store_true", help="额外保存末帧 PNG")
    args = p.parse_args()

    set_mini(not args.mini_off)
    frames = build_choreography(inject_nan=args.inject_nan)
    total = len(frames)

    fig = plt.figure(figsize=(13.4, 7.8), dpi=92)
    gs = fig.add_gridspec(3, 3, width_ratios=[1.1, 1.1, 1.0], height_ratios=[2.9, 1.5, 0.8],
                          hspace=0.80, wspace=0.30)
    ax2d = fig.add_subplot(gs[0, 0:2])
    axmass = fig.add_subplot(gs[1, 0:2])
    ax1d = fig.add_subplot(gs[2, 0:2])
    axw = fig.add_subplot(gs[:, 2])
    fig.suptitle(L("interp_tables: how one table is built on a grid — and how the variables flow",
                   "interp_tables：一张表在网格上怎么建起来 —— 以及变量怎么流动"), fontsize=12.5)
    if not CJK:
        fig.text(0.5, 0.004, "no CJK font found -> English labels", ha="center",
                 fontsize=7, color="#999999")

    def draw(i: int):
        render(ax2d, axmass, ax1d, axw, frames[i], total, i)
        return []

    anim = FuncAnimation(fig, draw, frames=total, interval=1000 // max(1, args.fps), blit=False)
    if args.show:
        plt.show()
        return
    anim.save(args.out, writer=PillowWriter(fps=args.fps))
    print(f"[ok] frames={total} -> {args.out}  ({os.path.getsize(args.out) / 1e6:.1f} MB)")
    if args.png:
        png = os.path.splitext(args.out)[0] + "_lastframe.png"
        fig.savefig(png, dpi=110)
        print(f"[ok] last frame -> {png}")


if __name__ == "__main__":
    main()
