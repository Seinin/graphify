#!/usr/bin/env python3
"""21cmFAST 主模块流程可视化：模块对象化 + 数据流动 + 调度依赖。

为什么不用 MCP 出图：本仓库挂载的 MCP（scicomp-molecular / quantum / neural / math、
codewiki / deepwiki）里没有图论或流程图渲染能力——能渲染的都是科学模拟类，且都必须先
有领域对象（trajectory_id / potential_id / experiment_id / model_id），渲染出来的是粒子
轨迹、势能景观、训练曲线，**没有"边 / 箭头 / 标签"的概念**。拿它们画模块流程图只会得到
一坨没有连接的点和没有标注的场。因此这里用本地已有的 matplotlib 出图（不需要额外安装）。

画法约定：
  · 功能模块对象化   → 每个调用者/被调者一个方框，按层着色（入口/编排/备料/循环/输出/可选/支路）；
  · 数据在节点间流动 → 产物画在箭头上的青色标签里，箭头方向即数据流向；
  · 调度依赖清晰     → 实线 = 调度顺序；虚线 = 可选；跨轮依赖（上一红移的状态）写进各方框的输入行，
                        不画成线——横跨整带、不接方框的线读者无从判断它连谁；
  · 画布不放图例     → 线型/读法一律写进 README，画布上只放模块、产物与代码位置；
  · 总览 + 剖分      → 图1 总览；图2、图3 把图1 里某个方框再剖一层；旁支末节不画。

输出：同目录下 fig1..fig4 的 .svg（矢量）与 .png（位图）；归档图（legacy-fig*）落在 legacy/。
用法：
    python3 docs/notes/atlas/figures/gen_module_flow.py              # 默认四张
    python3 docs/notes/atlas/figures/gen_module_flow.py fig1 fig3    # 只出其中几张
    python3 docs/notes/atlas/figures/gen_module_flow.py legacy-fig2  # 归档图

脚本自带几何自检：把每个方框的矩形登记下来做两两相交检测，并在渲染时捕获"缺字"警告，
两者都会打印出来（所以布局错误不会靠肉眼看图才发现）。
"""

from __future__ import annotations

import re
import sys
import warnings
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent
LEGACY_DIR = OUT_DIR / "legacy"  # 归档图的产物目录

_CJK_FONTS = (
    "/home/dministrat/.fonts/NotoSansCJKsc-Regular.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
)


def setup_font() -> str:
    """注册系统里的中文字体；否则中文会渲染成方框。"""
    for path in _CJK_FONTS:
        if Path(path).exists():
            font_manager.fontManager.addfont(path)
            name = font_manager.FontProperties(fname=path).get_name()
            plt.rcParams["font.family"] = [name]
            plt.rcParams["axes.unicode_minus"] = False
            return name
    for path in font_manager.findSystemFonts():
        if any(k in path for k in ("NotoSansCJK", "NotoSerifCJK", "wqy", "WenQuanYi")):
            font_manager.fontManager.addfont(path)
            name = font_manager.FontProperties(fname=path).get_name()
            plt.rcParams["font.family"] = [name]
            plt.rcParams["axes.unicode_minus"] = False
            return name
    raise RuntimeError("找不到可用的中文字体")


# 每一类模块一个固定配色：(浅底, 深边)
PALETTE = {
    "entry": ("#e8eaf6", "#3949ab"),
    "driver": ("#e3f2fd", "#1e88e5"),
    "prep": ("#e8f5e9", "#2e7d32"),
    "loop": ("#fff8e1", "#ef6c00"),
    "out": ("#f3e5f5", "#7b1fa2"),
    "opt": ("#f5f5f5", "#9e9e9e"),
    "branch": ("#fce4ec", "#c2185b"),
}
INK, MUTED, CHIP = "#1f2328", "#5f6672", "#0891b2"
# 标题是否转全大写：默认关——转成 COMPUTE_HALO_GRID 就不是真函数名了（与源码不一致）。
# 要"字面大写"就把这里改成 True（改完请跑一次脚本，看"文字溢出"是否为 0）。
TITLE_UPPER = False


class Canvas:
    """极简手排画布：方框 / 箭头 / 产物标签 / 分组框 + 几何自检。"""

    def __init__(self, width: float, height: float, title: str, pad_top: float = 5.5):
        # pad_top：标题与副标题的专属 header 带。内容坐标一律从 0 起算，所以只要把 y 上限
        # 抬高，图注就永远压在内容上方，不会出现"副标题被方框盖住"这种只有看图才发现的毛病。
        top = height + pad_top
        self.fig, self.ax = plt.subplots(figsize=(width / 10, top / 10))
        self.ax.set_xlim(0, width)
        self.ax.set_ylim(0, top)
        self.ax.axis("off")
        self.width, self.height = width, height
        self._rects: list[tuple[str, tuple[float, float, float, float]]] = []
        self._box_texts: list[tuple[str, tuple[float, float, float, float], object]] = []
        self._arrow_ends: list[tuple[float, float]] = []
        self._standalone: set[str] = set()
        self.ax.text(width / 2, top - 2.2, title, ha="center", va="top",
                     fontsize=15, weight="bold", color=INK)

    def box(self, cx, cy, w, h, text, kind="prep", fs=8.6, ls="-", weight="normal",
            standalone=False):
        """方框内**首行是标题**：加粗 + 放大（TITLE_UPPER=True 时再转大写），其余行是说明正文。"""
        face, edge = PALETTE[kind]
        self.ax.add_patch(FancyBboxPatch(
            (cx - w / 2, cy - h / 2), w, h,
            boxstyle="round,pad=0,rounding_size=1.0",
            facecolor=face, edgecolor=edge, linewidth=1.4, linestyle=ls, zorder=3))
        lines = text.split("\n")
        title, body_lines = lines[0], lines[1:]
        title = title.upper() if TITLE_UPPER else title
        fs_t = fs * 1.15                     # 标题字号：比正文大一档
        unit = 1.55 / 7.2                     # 1 单位 = 7.2pt，行高 ≈ fs · 1.55
        h_t = fs_t * unit * 1.5               # 标题行 + 与正文的额外间距
        h_b = fs * unit * len(body_lines)
        total = h_t + h_b
        rect = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        title_artist = self.ax.text(cx, cy + total / 2 - h_t / 2, title, ha="center", va="center",
                                    fontsize=fs_t, color=INK, zorder=4, linespacing=1.55,
                                    weight="bold")
        self._rects.append((title, rect))
        if standalone:
            self._standalone.add(title)
        self._box_texts.append((title, rect, title_artist))
        if body_lines:
            body_artist = self.ax.text(cx, cy - total / 2 + h_b / 2, "\n".join(body_lines),
                                       ha="center", va="center", fontsize=fs, color=INK,
                                       zorder=4, linespacing=1.55, weight=weight)
            self._box_texts.append((title + "〔正文〕", rect, body_artist))
        return cx, cy

    def chip(self, cx, cy, text, fs=7.5):
        """产物标签：贴在箭头上，白底避免压住线。"""
        self.ax.text(cx, cy, text, ha="center", va="center", fontsize=fs, color="#0e7490",
                     zorder=6, linespacing=1.35,
                     bbox=dict(boxstyle="round,pad=0.40", fc="white", ec=CHIP, lw=0.9, alpha=0.98))

    def arrow(self, p1, p2, label=None, color=MUTED, ls="-", lw=1.4, rad=0.0,
              arrowstyle="-|>", zorder=2, label_xy=None, label_fs=7.8, label_color=None):
        self.ax.add_patch(FancyArrowPatch(
            p1, p2, arrowstyle=arrowstyle, mutation_scale=12, color=color, linewidth=lw,
            linestyle=ls, shrinkA=0, shrinkB=0, connectionstyle=f"arc3,rad={rad}", zorder=zorder))
        self._arrow_ends += [tuple(p1), tuple(p2)]
        if label:
            lx, ly = label_xy or ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
            self.ax.text(lx, ly, label, ha="center", va="center", fontsize=label_fs,
                         color=label_color or color, zorder=7, linespacing=1.35,
                         bbox=dict(boxstyle="round,pad=0.22", fc="white", ec="none", alpha=0.92))

    def group(self, x0, y0, x1, y1, title="", fc="#ffffff", ec="#c4c9d0", ls="--", lw=1.2,
              title_xy=None, title_fs=9.8):
        self.ax.add_patch(FancyBboxPatch(
            (x0, y0), x1 - x0, y1 - y0,
            boxstyle="round,pad=0,rounding_size=1.4", facecolor=fc, edgecolor=ec,
            linewidth=lw, linestyle=ls, zorder=1, alpha=0.55))
        if title:
            tx, ty = title_xy or (x0 + 3.0, y1 - 1.8)
            # zorder 必须高于 box（box=3）：否则方框圆角会盖住标题末字
            self.ax.text(tx, ty, title, ha="left", va="top", fontsize=title_fs,
                         weight="bold", color="#3a3f47", zorder=6,
                         bbox=dict(boxstyle="round,pad=0.16", fc="white", ec="none", alpha=0.85))

    def text(self, x, y, s, fs=7.8, color=MUTED, ha="left", va="center", weight="normal",
             z=5, box=False):
        """box=True 给文字垫一层白底：写在箭头上时防止线条把字划穿。"""
        extra = {}
        if box:
            extra["bbox"] = dict(boxstyle="round,pad=0.22", fc="white", ec="none", alpha=0.95)
        self.ax.text(x, y, s, fontsize=fs, color=color, ha=ha, va=va, zorder=z,
                     linespacing=1.55, weight=weight, **extra)

    def check_overlaps(self, name: str) -> list[str]:
        hits = []
        for i in range(len(self._rects)):
            for j in range(i + 1, len(self._rects)):
                (n1, a), (n2, b) = self._rects[i], self._rects[j]
                if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                    hits.append(f"{name}: 方框重叠 → 「{n1}」×「{n2}」")
        return hits

    def check_text_fit(self, name: str) -> list[str]:
        """方框内的文字必须落在方框里——几何自检只看方框相交，管不到文字外溢（踩过两次）。"""
        self.fig.canvas.draw()
        renderer = self.fig.canvas.get_renderer()
        inv = self.ax.transData.inverted()
        hits = []
        for label, (x0, y0, x1, y1), artist in self._box_texts:
            bb = artist.get_window_extent(renderer=renderer)
            (dx0, dy0), (dx1, dy1) = inv.transform([[bb.x0, bb.y0], [bb.x1, bb.y1]])
            over = []
            if dx0 < x0 - 0.3 or dx1 > x1 + 0.3:
                over.append("横向 %0.1f..%0.1f vs 框 %0.1f..%0.1f" % (dx0, dx1, x0, x1))
            if dy0 < y0 - 0.3 or dy1 > y1 + 0.3:
                over.append("纵向 %0.1f..%0.1f vs 框 %0.1f..%0.1f" % (dy0, dy1, y0, y1))
            if over:
                hits.append("%s: 文字溢出方框 → 「%s」（%s）" % (name, label, "；".join(over)))
        return hits

    def check_markdown(self, name: str) -> list[str]:
        """画布上不该出现 markdown 记号：matplotlib 不解析，会原样画出来（踩过一次：副标题里的 **交替**）。"""
        bad = []
        for artist in self.ax.texts:
            for pat, what in ((r"\*\*[^*\n]+\*\*", "加粗记号"), (r"`[^`\n]+`", "反引号")):
                m = re.search(pat, artist.get_text())
                if m:
                    bad.append("%s: 画布上出现 %s → %r" % (name, what, m.group(0)))
        return bad

    def check_isolated(self, name: str) -> list[str]:
        """每个方框至少要有一条箭头搭在它边上；纯对照用的框请用 box(standalone=True) 声明。"""
        bad = []
        for label, (x0, y0, x1, y1) in self._rects:
            if label in self._standalone:
                continue
            hit = False
            for ax_, ay_ in self._arrow_ends:
                if x0 - 1.6 <= ax_ <= x1 + 1.6 and y0 - 1.6 <= ay_ <= y1 + 1.6:
                    hit = True
                    break
            if not hit:
                bad.append("%s: 方框与箭头脱节 → 「%s」" % (name, label))
        return bad

    def save(self, stem: str, out_dir: Path | None = None) -> list[Path]:
        target = out_dir or OUT_DIR
        target.mkdir(parents=True, exist_ok=True)
        out = []
        for ext in ("svg", "png"):
            p = target / f"{stem}.{ext}"
            self.fig.savefig(p, format=ext, dpi=170, bbox_inches="tight", facecolor="white")
            out.append(p)
        plt.close(self.fig)
        return out


# ===========================================================================
# 图 1：主调度链总览
# ===========================================================================
def fig1() -> None:
    c = Canvas(
        170, 128,
        "图1 主调度链：模块对象、数据流动与调度依赖",
pad_top=5.5)

    # ① 入口层
    c.group(3, 111, 167, 126, "① 入口层", fc="#f7f8fa")
    # 左边界（13）必须让开层标题（6..10.6），否则标题被方框圆角盖住
    c.box(85, 118.5, 144, 9.5,
          "命令行：21cmfast run coeval | lightcone | ics          "
          "Python API：import py21cmfast → run_coeval / run_lightcone / run_global_evolution\n"
          "cli.py:63 ｜ py21cmfast/__init__.py",
          kind="entry", fs=8.2)

    # ② 编排层
    c.group(3, 88, 167, 109, "② 编排层（选一条）")
    c.box(34, 98.5, 50, 13, "入口 A：21cmfast run ics\n只造 ICs 就结束（已有则跳过，:418-428）\n"
                            "不进备料层其余步骤、不进红移循环\ncli.py:393",
          kind="opt", fs=7.2)
    c.box(112, 104.5, 100, 8.5,
          "入口 B：三个顶层驱动（跑完整流水线）\nrun_coeval / run_lightcone / run_global_evolution\n"
          "coeval.py:632 ｜ lightcone.py:691 ｜ global_evolution.py:230",
          kind="driver", fs=7.8)
    c.box(112, 93.5, 100, 8.5,
          "_setup_ics_and_pfs_for_scrolling（三条流水线共用同一份实现）\ncoeval.py:837",
          kind="driver", fs=8.2)
    c.arrow((34, 113.7), (34, 105.2))
    c.arrow((112, 113.7), (112, 108.9))
    c.arrow((112, 100.1), (112, 97.9))

    # ③ 备料层
    c.group(3, 70, 167, 87, "③ 备料层（只做一次，与红移无关）", fc="#f6fbf6")
    c.box(20, 78.5, 30, 9, "compute_initial_conditions\nsingle_field.py:37", kind="prep", fs=7.4)
    c.box(62, 78.5, 30, 9, "setup_photon_cons\n【可选，虚线】\nphotoncons.py:202",
          kind="opt", fs=7.4, ls="--")
    c.box(104, 78.5, 30, 9, "perturb_field\n× len(all_redshifts)\nsingle_field.py:112",
          kind="prep", fs=7.4)
    c.box(148, 78.5, 30, 9, "evolve_halos\n（仅 has_discrete_halos）\ncoeval.py:390",
          kind="prep", fs=7.2)
    c.arrow((30, 91.9), (22, 83.4))          # 候选入口 A → 备料第一步
    c.arrow((112, 89.2), (112, 87.2))        # 候选入口 B（备料函数）→ 整个备料层
    c.arrow((35, 78.5), (47, 78.5))
    c.chip(41, 78.5, "ICs")
    c.arrow((77, 78.5), (89, 78.5))
    c.chip(83, 78.5, "校准曲线")
    c.arrow((119, 78.5), (133, 78.5))
    c.chip(126, 78.5, "晕目录[]")
    c.arrow((62, 74.0), (62, 63.0), ls="--", color="#9e9e9e")
    c.chip(62, 68.0, "循环里每红移读取")
    c.text(166, 85.0, "每步之后按 CacheConfig\n决定落盘与裁内存", ha="right")

    # ④ 红移循环
    c.group(3, 17, 167, 66, "", fc="#fffdf5", ec="#ef6c00", ls="-", lw=1.8)
    c.text(8, 64.6, "④ 红移循环 _redshift_loop_generator（每个红移重复执行，z 由高到低）", fs=10,
           color="#b45309", weight="bold")
    c.text(163, 64.6, "× len(all_redshifts)　coeval.py:691", fs=8.6, color="#b45309", ha="right")

    # 三条跨层入参落在「每轮入口」上（它们不属于任何单个步骤）；框宽只取容纳这三条箭头所需
    c.arrow((104, 74.0), (104, 63.0))
    c.chip(104, 68.0, "微扰场[iz]")
    c.arrow((148, 74.0), (148, 63.0))
    c.chip(148, 68.0, "晕目录[iz]")
    c.box(106, 59.3, 94, 7,
          "每轮入口（iz）：this_perturbed_field = perturbed_field[iz]、load_all()（coeval.py:736-737）\n"
          "＋（仅离散晕）this_halofield = halofield_list[iz]、load_all()（:741-742）",
          kind="loop", fs=6.6)
    c.arrow((60, 55.8), (36, 51.6))          # 入口 → ①（其余输入见各方框输入行）

    # 两排各 3 格、共用同一列网格；框宽按内容定（48 / 40 / 34），两侧留边不铺满
    # 编号 = 执行顺序；位置行 = 调用点 → 定义处（调用点行号本身也编码了顺序）
    c.box(36, 45, 48, 12.5,
          "① compute_halo_grid\n输入：微扰场[iz]、晕目录[iz]、上一红移 Ts·电离\n"
          "（仅 lagrangian 源模型）\ncoeval.py:743 → single_field.py:285",
          ls="--", kind="loop", fs=7.0)
    c.box(92, 45, 40, 12.5,
          "② compute_xray_source_field\n输入：累计 HaloBox 列表 [z, zmax]\n"
          "（仅 USE_TS_FLUCT 且 lagrangian）\ncoeval.py:756 → single_field.py:460",
          ls="--", kind="loop", fs=6.8)
    c.box(141, 45, 34, 12.5,
          "③ compute_spin_temperature\n输入：微扰场、上一红移 TsBox\n"
          "＋XrayBox（仅 lagrangian）\n（仅 USE_TS_FLUCT）\ncoeval.py:763 → single_field.py:588",
          ls="--", kind="loop", fs=6.4)
    c.box(36, 26, 48, 12.5,
          "④ compute_ionization_field\n输入：微扰场、TsBox\n"
          "＋HaloBox（仅 lagrangian 源模型，\n否则传 None）＋上一红移电离·微扰场\n"
          "coeval.py:776 → single_field.py:662",
          kind="loop", fs=6.6)
    c.box(92, 26, 40, 12.5,
          "⑤ brightness_temperature\n输入：微扰场、TsBox、IonizedBox\n"
          "coeval.py:788 → single_field.py:783", kind="loop", fs=6.8)
    c.box(141, 26, 34, 12.5,
          "⑥ Coeval 装配与收尾\ncoeval.py:800-834\n（装配 7 样 / purge / 推进 prev_coeval / yield）",
          kind="loop", fs=6.4)

    c.arrow((60, 45), (71.5, 45), ls="--")   # ①→②（仅 lagrangian 源模型）
    c.chip(65.5, 45, "HaloBox")
    c.arrow((112, 45), (123.5, 45), ls="--")  # ②→③（XrayBox 仅 lagrangian 时有）
    c.chip(117.5, 45, "XrayBox")
    c.arrow((36, 38.75), (36, 32.25), ls="--")   # ①→④：HaloBox 也进电离（仅 lagrangian）
    c.chip(36, 35.5, "HaloBox")
    c.arrow((140, 38.75), (95, 32.5), ls="--")  # ③→⑤：TsBox（非 USE_TS_FLUCT 时为 None）
    c.chip(117, 35.5, "TsBox")
    c.arrow((60, 26), (71.5, 26))            # ④→⑤
    c.chip(65.5, 26, "IonizedBox")
    c.arrow((112, 26), (123.5, 26))          # ⑤→⑥
    c.chip(117.5, 26, "BrightnessTemp")

    c.text(86, 18.4, "内存：XraySourceBox 算完立刻 purge(force=True)（coeval.py:774）",
           fs=7.0, ha="center")
    c.text(120, 18.4, "虚线 = 条件不满足时该步/该数据不存在（①② 需 lagrangian；②③ 需 USE_TS_FLUCT）",
           fs=6.4, ha="left")

    # ⑤ 输出层
    c.group(3, 1, 167, 14, "⑤ 输出层", fc="#faf7fc")
    c.box(58, 7.5, 84, 8.5, "Coeval 快照 / LightCone 光锥 / GlobalEvolution 全局历史\n"
                            "coeval.py:61 ｜ lightcone.py:49 ｜ global_evolution.py:110",
          kind="out", fs=7.4)
    c.box(137, 7.5, 56, 8.5, "OutputCache 落盘（按 CacheConfig 分类开关）\nio/caching.py:31",
          kind="out", fs=7.6)
    c.arrow((92, 17.0), (92, 11.9))
    c.chip(92, 15.4, "每红移一个 Coeval", fs=7.2)
    c.arrow((100, 7.5), (109, 7.5))

    _finish(c, "fig1-module-flow")


# ===========================================================================
# 图 2：三条高层流水线的分叉与合流
# ===========================================================================
def legacy_fig2() -> None:
    c = Canvas(
        150, 92,
        "图2 三条高层流水线：分叉在入口，合流在备料",
pad_top=5.0)

    c.box(24, 76, 40, 10, "run_coeval / generate_coeval\ncoeval.py:632 / :478",
          kind="driver", fs=8.0)
    c.box(24, 55, 40, 10, "run_lightcone\nlightcone.py:691", kind="driver", fs=8.2)
    c.box(24, 34, 40, 10, "run_global_evolution\nglobal_evolution.py:230", kind="driver", fs=7.8)

    # 备料与循环统一放 x=70：给右侧留出 22 单位的走廊放边标签
    c.box(70, 65, 44, 12,
          "_setup_ics_and_pfs_for_scrolling\n备料：ICs → 校准 → 微扰场 → 晕\ncoeval.py:837",
          kind="prep", fs=7.4)
    c.box(70, 35, 44, 12,
          "_redshift_loop_generator\n循环：源 → 自旋温度 → 电离 → 亮温\ncoeval.py:691",
          kind="loop", fs=7.4)
    c.box(130, 65, 32, 12, "Coeval\n快照\ncoeval.py:61", kind="out", fs=8.0)
    c.box(130, 45, 32, 12, "LightCone\n光锥\nlightcone.py:49", kind="out", fs=8.0)
    c.box(130, 25, 32, 12, "GlobalEvolution\n全局历史\nglobal_evolution.py:110",
          kind="out", fs=7.4)

    c.arrow((44, 76), (48, 68.5))
    c.arrow((44, 55), (48, 62.5))
    c.arrow((44, 34), (48, 38.5))
    c.arrow((70, 59), (70, 41))
    c.chip(70, 50, "ICs / 微扰场 / 晕", fs=7.2)
    # 三个出口容器都由「循环逐红移 yield 出的 Coeval」包装而来，故箭头起点在循环而不是备料
    c.arrow((92, 39), (114, 66))
    c.text(103, 54, "E1：直接 yield", fs=7.2, ha="center", box=True)
    c.arrow((92, 37), (114, 46))
    c.text(103, 41.5, "E2：切片包装", fs=7.2, ha="center", box=True)
    c.arrow((92, 33), (114, 26))
    c.text(103, 29, "E3：累积成均值", fs=7.2, ha="center", box=True)
    c.text(48, 25.0,
           "三条路径不各写一套循环：循环逐红移 yield 出 Coeval；\n"
           "E2 把快照切片进 LightCone，E3 把快照累积成均值历史。\n"
           "E3 的 ICs 在 Python 里就短路了（DIM=HII_DIM=1），红移循环照样调 C，只是每维 1 格。", fs=7.4)

    c.text(6, 19.5, "四条差异（其余流程完全相同）", fs=9.4, color=INK, weight="bold")
    rows = [
        ("入口", "允许注入 ICs", "读缓存", "写盘", "ICs 进 C"),
        ("run_coeval", "是", "是", "按 CacheConfig", "是"),
        ("run_lightcone", "是", "是", "按 CacheConfig", "是"),
        ("run_global_evolution", "否（写死 None）", "否（cache=None）", "否（off）", "否（DIM=1 短路）"),
    ]
    xs = [6, 38, 68, 96, 128]
    for r, row in enumerate(rows):
        y = 14.0 - r * 3.4
        for x, cell in zip(xs, row):
            c.text(x, y, cell, fs=7.6, color=INK if r else MUTED,
                   weight="bold" if r == 0 else "normal")
    c.ax.plot([6, 146], [11.9, 11.9], color="#c4c9d0", lw=0.9, zorder=4)

    _finish(c, "fig2-three-pipelines", LEGACY_DIR)


# ===========================================================================
# 图 2：剖分① 三个顶层驱动
# ===========================================================================
def fig2() -> None:
    c = Canvas(
        226, 92,
        "图2 剖分①：三个顶层驱动（放大 fig1 ② 编排层）",
pad_top=5.5)

    W, H, G = 27.0, 11.5, 5.0          # 框宽 / 框高 / 间距：按文字量定，不铺满

    def lane(cy, label, cells):
        c.text(6, cy + 9.5, label, fs=7.4, color=INK, weight="bold")
        x = 6 + W / 2
        prev = None
        for fs, text, kind in cells:
            c.box(x, cy, W, H, text, kind=kind, fs=fs)
            if prev is not None:
                c.arrow((prev + W / 2, cy), (x - W / 2 - 0.5, cy))
            prev = x
            x += W + G

    lane(76, "E1  run_coeval（coeval.py:632，薄壳 :639）→ generate_coeval（:478）", [
        (6.8, "① 红移表\n_get_required_redshifts_coeval（:572）", "driver"),
        (6.4, "② 备料（三条共用）\n" + "_setup_ics_and_pfs_for_scrolling\ncoeval.py:837", "prep"),
        (6.4, "③ 断点续算\n_obtain_starting_point_for_scrolling（:598）", "driver"),
        (6.4, "④ 循环（三条共用）\n" + "_redshift_loop_generator\ncoeval.py:691", "loop"),
        (6.4, "⑤ yield 过滤\nredshift in out_redshifts（:624）\n→ Coeval 列表", "out"),
    ])
    lane(52, "E2  run_lightcone（lightcone.py:691，薄壳 :698）→ generate_lightcone（:575）", [
        (6.2, "① lightconer 校验\nvalidate_options（:644）\n_check_desired_arrays_exist（:652）", "driver"),
        (6.4, "② 备料（三条共用）\n" + "_setup_ics_and_pfs_for_scrolling\ncoeval.py:837", "prep"),
        (6.4, "③ 建 LightCone\nsetup_lightcone_instance（:430）", "driver"),
        (6.4, "④ 断点续算\n_obtain_starting_point_for_scrolling（:443）", "driver"),
        (6.4, "⑤ 循环（三条共用）\n" + "_redshift_loop_generator\ncoeval.py:691", "loop"),
        (6.4, "⑥ 每红移切片\nmake_lightcone_slices（:508）\n→ LightCone", "out"),
    ])
    lane(28, "E3  run_global_evolution（global_evolution.py:230，唯一不是薄壳的）", [
        (6.6, "① source_model 校验\n（:285-296）", "driver"),
        (6.4, "② 单格参数\nevolve_input_structs（:309-324）", "driver"),
        (6.4, "③ 建容器\nGlobalEvolution（:326-333）", "driver"),
        (6.4, "④ 备料（三条共用）\n" + "_setup_ics_and_pfs_for_scrolling\ncoeval.py:837", "prep"),
        (6.4, "⑤ 循环（三条共用）\n" + "_redshift_loop_generator\ncoeval.py:691", "loop"),
        (6.4, "⑥ 逐红移均值\nquantities[q][iz] = mean（:368）", "driver"),
        (6.4, "⑦ return（:376）\n→ GlobalEvolution", "out"),
    ])

    _finish(c, "fig2-top-drivers")


# ===========================================================================
# 图 3：剖分② 备料函数
# ===========================================================================
def fig3() -> None:
    c = Canvas(
        152, 132,
        "图3 剖分②：备料函数 _setup_ics_and_pfs_for_scrolling（放大 fig1 ③ 第一格）",
pad_top=5.5)

    c.box(46, 120, 86, 10,
          "入口：all_redshifts、initial_conditions、inputs、write、progressbar、\n"
          "overdensity_z0、**iokw          （coeval.py:837-845）",
          kind="entry", fs=6.8)
    c.arrow((46, 115), (46, 109.0))
    c.chip(46, 112.0, "overdensity_z0 只有 E3 传非 None", fs=6.4)

    c.box(46, 102, 86, 13,
          "① ICs：只有 initial_conditions is None 才算（:846）\n"
          "compute_initial_conditions(inputs, write=write.initial_conditions,\n"
          "initial_density=overdensity_z0, **iokw)（:847）",
          kind="prep", fs=6.4)
    c.arrow((46, 95.5), (46, 89.8))
    c.chip(46, 92.6, "ICs", fs=6.8)
    c.box(46, 84, 86, 11,
          "② if write.initial_conditions → prepare_for_perturb()（:856）\n"
          "（裁内存：只留微扰场要的；无缓存时不裁，怕丢信息）",
          kind="prep", fs=6.4)
    c.arrow((46, 78.5), (46, 73.0))
    c.box(46, 66, 86, 14,
          "③ if PHOTON_CONS_TYPE != no-photoncons（:863）\n"
          "setup_photon_cons(inputs=inputs, **kw)（:867）\n"
          "（直传 inputs：避免用 ICs 里兼容但不同的参数集）",
          kind="opt", fs=6.4, ls="--")
    c.arrow((46, 59.0), (46, 53.0))
    c.chip(46, 56.0, "校准数据", fs=6.8)
    c.box(46, 46, 86, 12,
          "⑤ for z in all_redshifts（:886）\n"
          "perturb_field(redshift=z, inputs, write, **kw)（:887）\n"
          "MINIMIZE_MEMORY 且要写盘 → p.purge()（:894）",
          kind="prep", fs=6.2)
    c.arrow((46, 40.0), (46, 34.0))
    c.chip(46, 37.0, "微扰场[]", fs=6.8)
    c.box(46, 28, 86, 11,
          "⑥ evolve_halos(inputs, all_redshifts, write, **kw)（:898）\n"
          "（不是 has_discrete_halos → 直接返回 []）", kind="prep", fs=6.2)
    c.arrow((46, 22.5), (46, 18.5))
    c.chip(46, 20.5, "晕目录[]（可为空）", fs=6.4)
    c.box(46, 12, 86, 12,
          "⑦ if write.initial_conditions → prepare_for_spin_temp()（:906）\n"
          "⑧ return (ICs, 微扰场[], 晕目录[], 校准数据)（:912）", kind="prep", fs=6.2)

    # ④ 是挂在③右侧的支路（不是主链的一步）
    c.box(122, 66, 52, 14,
          "④ 前置检查（:869，支路）\n"
          "z-photoncons 且\nmin(all_redshifts)\n< PHOTONCONS_CALIBRATION_END\n"
          "→ raise（fail fast，给修法）", kind="branch", fs=5.8)
    c.arrow((89, 66), (96, 66), ls="--", color="#c2185b")

    _finish(c, "fig3-ics-prep")


# ===========================================================================
# 图 4：代码文件结构（主干 / 功能库）
# ===========================================================================
def fig4() -> None:
    c = Canvas(
        252, 204,
        "图4 代码文件结构：上半=主干五层的层内调用；下半=主干×功能库 协同矩阵",
        pad_top=8.0)

    # ============ 上半：主干五层 · 层内结构 ============
    c.group(4, 182, 248, 196, "① 入口层", fc="#f7f8fa")
    c.group(4, 144, 248, 176, "② 编排层", fc="#eef4fb")
    c.group(4, 112, 248, 138, "③ 桥接层（Python 对象 ↔ C 结构体）", fc="#f6fbf6")
    c.group(4, 66, 248, 108, "④ 计算层（src/ 的 C 计算单元）", fc="#fffdf5")
    c.group(4, 50, 248, 62, "⑤ 落地层", fc="#faf7fc")

    c.box(80, 188, 56, 9, "cli.py\ncoeval.py:63 为入口点", kind="entry", fs=6.6)
    c.box(170, 188, 64, 9, "__init__.py\n公共 API 再导出", kind="entry", fs=6.6)
    c.arrow((80, 183.5), (90, 172.5))
    c.arrow((170, 183.5), (160, 172.5))

    c.box(40, 168, 44, 9, "_param_config.py\n装饰器 single_field_func", kind="driver", fs=6.2)
    c.box(90, 168, 52, 9, "single_field.py\n12 个单场入口", kind="driver", fs=6.6)
    c.box(160, 168, 60, 9, "coeval.py\n备料 + 红移循环 + Coeval", kind="driver", fs=6.6)
    c.box(90, 150, 46, 9, "lightcone.py\n消费同一个循环", kind="driver", fs=6.4)
    c.box(160, 150, 52, 9, "global_evolution.py\n改成单格后取均值", kind="driver", fs=6.2)
    c.arrow((62, 168), (64, 168))
    c.arrow((130, 168), (116, 168))
    c.arrow((110, 154.5), (140, 163.5))
    c.arrow((160, 154.5), (160, 163.5))
    c.arrow((160, 145.5), (160, 135.5))

    c.box(70, 131, 56, 9, "inputs.py\nInputParameters + 校验器", kind="prep", fs=6.6)
    c.box(160, 131, 72, 9, "outputs.py\n每个输出一类，绑 lib.ComputeXxx", kind="prep", fs=6.2)
    c.box(115, 118, 72, 9, "photoncons.py\n光子守恒校准（备料层调用）", kind="prep", fs=6.4)
    c.arrow((124, 131), (98, 131))
    c.arrow((95, 122.5), (78, 126.5))
    c.arrow((135, 122.5), (152, 126.5))
    c.arrow((152, 126.5), (152, 105),
            label="参数 / 结构体传入各 C 单元", label_xy=(181, 116), label_fs=6.0)

    c.box(26, 101, 30, 8, "InitialConditions.c\n:547", kind="loop", fs=6.0)
    c.box(64, 101, 34, 8, "PerturbedField.c\n:385", kind="loop", fs=6.0)
    c.box(108, 101, 36, 8, "HaloCatalog.c\n:38", kind="loop", fs=6.0)
    c.box(152, 101, 34, 8, "HaloBox.c\n:200", kind="loop", fs=6.0)
    c.box(206, 101, 48, 8, "SpinTemperatureBox.c\n:87（Ts）", kind="loop", fs=6.0)
    c.box(64, 86, 40, 8, "PerturbedHaloCatalog.c\n:25", kind="loop", fs=5.8)
    c.box(108, 86, 34, 8, "Stochasticity.c\n晕采样", kind="loop", fs=6.0)
    c.box(152, 86, 36, 8, "IonisationBox.c\n:1315", kind="loop", fs=6.0)
    c.box(206, 86, 50, 8, "BrightnessTemperatureBox.c\n:22", kind="loop", fs=5.8)
    c.box(206, 71, 36, 8, "photoncons.c\n校准状态", kind="loop", fs=6.0)
    c.arrow((41, 101), (47, 101))
    c.arrow((81, 101), (90, 101))
    c.arrow((126, 101), (135, 101))
    c.arrow((169, 101), (182, 101))
    c.arrow((64, 97), (64, 90))
    c.arrow((108, 90), (108, 97))
    c.arrow((91, 86), (84, 86))
    c.arrow((80, 90), (140, 97))
    c.arrow((152, 97), (152, 90))
    c.arrow((206, 97), (206, 90))
    c.arrow((182, 97), (172, 91))
    c.arrow((170, 86), (181, 86))
    c.arrow((196, 75), (172, 84), rad=-0.12)

    c.box(85, 56, 64, 9, "io/caching.py\nRunCache / OutputCache", kind="out", fs=6.6)
    c.box(175, 56, 64, 9, "io/h5.py\nHDF5 后端（可换类）", kind="out", fs=6.4)
    c.arrow((117, 56), (143, 56))
    c.arrow((186, 82), (178, 60.5))

    # ============ 下半：主干 × 功能库 协同矩阵 ============
    c.text(4, 48.4, "上半 ｜ 主干五层 · 层内调用（箭头=真实 import / 调用关系）",
           fs=8.5, weight="bold", color=INK)
    c.text(4, 45.8, "下半 ｜ 主干 × 功能库 协同矩阵（行=主干层，列=功能库组）",
           fs=8.5, weight="bold", color=INK)
    c.text(4, 43.4, "有色格=存在真实依赖（Python 取 import 行、C 取 #include 行），"
                    "格内写文件级关系；空格=无直接依赖", fs=6.2)

    col_x = [30 + i * 31.14 for i in range(8)]
    headers = [
        ("A 数据结构/桥接", ["arrays→arraystate", "structs→arrays", "cfuncs、_utils",
                             "exceptions", "InputParameters.c", "+3 个 _*_wrapper.h"]),
        ("B 参数与配置", ["_cfg.py", "_templates.py", "yaml.py", "input_serialization.py"]),
        ("C I/O 与运维", ["io/h5.py", "management.py"]),
        ("D 观测与几何", ["lightconers→rsds", "plotting.py", "（plotting 反向→", "主干，见粉格）"]),
        ("E 数值工具 (C)", ["rng、dft、indexing", "filtering→dft", "interp_tables",
                            "→interpolation", "map_mass、fdm", "integral_wrappers"]),
        ("F 物理辅助 (C)", ["cosmology→hmf", "→scaling_relations", "thermochem",
                            "→recombinations", "elec_interp→heating", "bubble_helper、LF(离线)"]),
        ("G 基础设施/外部", ["_logging、utils", "Constants/logger", "cexcept、debugging",
                             "classy_interface", "(CLASS 外部码)"]),
    ]
    for i, (name, lines) in enumerate(headers):
        x0, x1 = col_x[i] + 0.8, col_x[i + 1] - 0.8
        c.ax.add_patch(FancyBboxPatch(
            (x0, 31), x1 - x0, 11.2, boxstyle="round,pad=0,rounding_size=0.8",
            facecolor="#f2f4f7", edgecolor="#c4c9d0", linewidth=1.0, zorder=1.5))
        c.ax.text((x0 + x1) / 2, 41.0, name, ha="center", va="top",
                  fontsize=6.8, weight="bold", color=INK, zorder=3)
        c.ax.text((x0 + x1) / 2, 39.0, "\n".join(lines), ha="center", va="top",
                  fontsize=5.3, color=MUTED, zorder=3, linespacing=1.45)

    rows = [("① 入口", "cli / __init__"), ("② 编排", "5 个驱动文件"),
            ("③ 桥接", "inputs/outputs"), ("④ 计算", "10 个 C 单元"),
            ("⑤ 落地", "caching / h5")]
    row_top, rh = 30.6, 4.2
    for r, (nm, sub) in enumerate(rows):
        y1 = row_top - r * rh
        y0 = y1 - rh
        if r % 2 == 0:
            c.ax.add_patch(FancyBboxPatch(
                (30, y0), 218, rh, boxstyle="square,pad=0",
                facecolor="#f7f8fa", edgecolor="none", alpha=0.6, zorder=0.5))
        c.ax.text(17, (y0 + y1) / 2 + 0.8, nm, ha="center", va="center",
                  fontsize=7.2, weight="bold", color=INK, zorder=3)
        c.ax.text(17, (y0 + y1) / 2 - 1.1, sub, ha="center", va="center",
                  fontsize=5.2, color=MUTED, zorder=3)

    BLUE = ("#e3f2fd", "#1e88e5")
    PINK = ("#fce4ec", "#c2185b")
    YEL = ("#fff8e1", "#ef6c00")
    cells = [
        (0, 1, "cli.py→\n_templates.py", BLUE),
        (0, 3, "cli.py→\nplotting.py", BLUE),
        (1, 0, "coeval/single_field\n→arrays/inputs\n/outputs", BLUE),
        (1, 2, "coeval→io.caching\n/io.h5", BLUE),
        (1, 3, "lightconers/rsds\n反向：plotting\n→drivers", PINK),
        (2, 0, "outputs→structs\n/arrays/exceptions", BLUE),
        (2, 1, "outputs→_cfg", BLUE),
        (2, 6, "inputs→\nclassy_interface", BLUE),
        (3, 4, "rng/dft/filtering\n/interp_tables\n/map_mass", BLUE),
        (3, 5, "cosmology/hmf\n/thermochem\n↔photoncons.c", YEL),
        (4, 0, "h5.py→\nH5Backend(arrays)", BLUE),
        (4, 2, "io/h5.py", BLUE),
    ]
    for r, ci, txt, (fc, ec) in cells:
        y1 = row_top - r * rh
        y0 = y1 - rh
        x0, x1 = col_x[ci] + 1.0, col_x[ci + 1] - 1.0
        c.ax.add_patch(FancyBboxPatch(
            (x0, y0 + 0.4), x1 - x0, rh - 0.8, boxstyle="round,pad=0,rounding_size=0.6",
            facecolor=fc, edgecolor=ec, linewidth=1.1, zorder=2))
        c.ax.text((x0 + x1) / 2, (y0 + y1) / 2, txt, ha="center", va="center",
                  fontsize=5.6, color=INK, zorder=3, linespacing=1.4)

    c.text(30, 7.6, "库间边：D→G rsds.py→classy_interface.py ｜ G 被各层普遍依赖，不逐格填 ｜ "
                    "④↔F 双向见黄格（photoncons.c↔scaling_relations.c）", fs=6.2)
    for x, (fc, ec), lab in ((30, BLUE, "主干 → 库"), (80, PINK, "含反向（库 → 主干）"),
                             (152, YEL, "双向依赖")):
        c.ax.add_patch(FancyBboxPatch(
            (x, 4.2), 3.6, 2.2, boxstyle="round,pad=0,rounding_size=0.5",
            facecolor=fc, edgecolor=ec, linewidth=1.0, zorder=2))
        c.text(x + 5, 5.3, lab, fs=6.2)

    c.text(4, 1.6, "判据：文件自己决定下一步做什么的就是主干；只被调用的能力提供者是功能库。"
                   "层内链与格内关系全部实测，不凭印象。", fs=6.2)

    _finish(c, "fig4-code-structure")


# ===========================================================================
# 归档图（不再默认生成）：图 A 源模型歧路
# ===========================================================================
def legacy_fig3() -> None:
    c = Canvas(
        150, 88,
        "图3 歧路一：SOURCE_MODEL 决定调度形状",
pad_top=5.5)

    src = {"CONST-ION-EFF": 16, "E-INTEGRAL": 44, "L-INTEGRAL": 72,
           "DEXM-ESF": 100, "CHMF-SAMPLER": 128}
    for name, x in src.items():
        label = name + "\n（默认）" if name == "CHMF-SAMPLER" else name
        # CONST-ION-EFF / E-INTEGRAL 属 False 分支，本图按设计不给它们画箭头
        c.box(x, 76, 24, 8, label + "\ninputs.py:682", kind="branch", fs=7.2,
              standalone=name in ("CONST-ION-EFF", "E-INTEGRAL"))

    c.box(36, 58, 50, 9, "lagrangian_source_grid = True\n（L-INTEGRAL / DEXM-ESF / CHMF-SAMPLER）\n"
                         "inputs.py:727", kind="driver", fs=7.0)
    c.box(112, 58, 50, 9, "has_discrete_halos = True\n（DEXM-ESF / CHMF-SAMPLER）\ninputs.py:722",
          kind="driver", fs=7.0)
    for name, tx in (("L-INTEGRAL", 28), ("DEXM-ESF", 36), ("CHMF-SAMPLER", 44)):
        c.arrow((src[name], 72), (tx, 62.6))
    for name, tx in (("DEXM-ESF", 104), ("CHMF-SAMPLER", 120)):
        c.arrow((src[name], 72), (tx, 62.6))

    c.text(4, 45.5, "False 分支（CONST-ION-EFF / E-INTEGRAL）：红移循环里 compute_halo_grid 与 "
                    "compute_xray_source_field 整步不执行，电离直接用微扰场（halobox=None）", fs=7.4)

    c.box(36, 30, 60, 10, "红移循环里\ncompute_halo_grid 执行\ncoeval.py:743", kind="loop", fs=7.8)
    c.box(112, 30, 52, 10, "备料阶段 determine_halo_catalog\n+ 循环里 load_all() 晕场\n"
                           "coeval.py:455 / :741",
          kind="prep", fs=7.4)
    c.arrow((36, 53.5), (36, 35.1))
    c.arrow((112, 53.5), (112, 35.1))

    c.box(36, 14, 60, 10, "电离拿 halobox\n（非 lagrangian 时 halobox=None，只用微扰场）\n"
                          "coeval.py:776", kind="out", fs=7.2)
    # 灰色框是 has_discrete_halos 的「另一取值」对照，不是 True 的下游 → 不画箭头（画了就成假因果）
    c.box(112, 14, 52, 10, "对照：另一取值 has_discrete_halos=False（仅 L-INTEGRAL）\n"
                           "无晕目录 → halo_catalog=None 传入，\n内部换成 HaloCatalog.dummy()\n"
                           "single_field.py:327",
          kind="opt", fs=6.8, standalone=True)   # 对照框，故意不连线
    c.arrow((36, 25.0), (36, 19.1))

    c.text(4, 4.8, "另：lagrangian 源模型与 z-photoncons 互斥（validator 报错，见 图4）；"
                   "has_discrete_halos=True 时 halo_catalog 传 None 会直接 raise。\n"
                   "不画的：SOURCE_MODEL 还影响 mass_dependent_zeta 等标度细节——那是参数细节，"
                   "不是调度形状。", fs=7.4)

    _finish(c, "fig3-source-model", LEGACY_DIR)


# ===========================================================================
# 归档图：图 B 光子守恒歧路
# ===========================================================================
def legacy_fig4() -> None:
    c = Canvas(
        140, 86,
        "图4 歧路二：PHOTON_CONS_TYPE 决定「要不要提前校准」",
pad_top=5.5)

    c.box(24, 74, 34, 8, "no-photoncons\n（默认）\ninputs.py:1097", kind="branch", fs=7.4)
    c.box(74, 74, 30, 8, "z-photoncons\ninputs.py:1097", kind="branch", fs=7.6)
    c.box(110, 74, 30, 8, "alpha-photoncons\ninputs.py:1097", kind="branch", fs=7.2)
    c.box(110, 62, 30, 8, "f-photoncons\ninputs.py:1097", kind="branch", fs=7.6)

    c.box(24, 48, 40, 10, "跳过校准\nphoton_nonconservation_data = {}\ncoeval.py:862",
          kind="opt", fs=7.4)
    c.box(84, 40, 62, 16, "setup_photon_cons\n（备料层，必须在 perturb_field 之前）\n"
                          "→ 写 C 侧全局校准状态\nphotoncons.py:202", kind="prep", fs=7.4)

    c.arrow((24, 70), (24, 53.1))          # no-photoncons：跳过校准
    c.arrow((74, 70), (76, 48.1))          # z-photoncons
    c.arrow((98, 70), (84, 48.1))          # alpha-photoncons
    c.arrow((108, 58), (98, 48.1))         # f-photoncons：从 f 方框底边出发
    c.arrow((84, 32), (84, 22.1))

    c.box(84, 16, 76, 12,
          "红移循环：每个红移读校准曲线\n（z-photoncons 还每红移更新一次数据）\ncoeval.py:798",
          kind="loop", fs=7.4)
    c.box(24, 16, 34, 12, "前置检查（仅 z-photoncons）\n最低红移 ≥\nCALIBRATION_END\ncoeval.py:869",
          kind="branch", fs=6.8)
    c.arrow((53, 31.8), (35, 22.3), ls="--", color="#c2185b")
    c.text(24, 6.5, "违反则进循环前直接报错（fail fast，并给出修法）", fs=7.2, ha="center")
    c.text(138, 52, "z-photoncons 的两条互斥（validator 报错）：\n"
                    "· USE_MINI_HALOS = True（inputs.py:1131）\n"
                    "· lagrangian 源模型（inputs.py:1627）", fs=7.0,
           color="#c2185b", ha="right")
    c.text(4, 30, "alpha- 调 α_esc 幂律斜率、f- 调 f_esc 归一（inputs.py:1044 / :1046）", fs=7.0)

    _finish(c, "fig4-photoncons", LEGACY_DIR)


# ---------------------------------------------------------------------------
def _finish(c: Canvas, stem: str, out_dir: Path | None = None) -> None:
    hits = c.check_overlaps(stem)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        fits = c.check_text_fit(stem) + c.check_markdown(stem) + c.check_isolated(stem)
        paths = c.save(stem, out_dir)
    missing = [str(w.message) for w in caught if "glyph" in str(w.message).lower()]
    sizes = "  ".join(f"{p.name}:{p.stat().st_size // 1024}KB" for p in paths)
    print(f"[{stem}] {sizes} · 缺字 {len(missing)} · 重叠 {len(hits)} · 文字/记号问题 {len(fits)}")
    for line in hits + fits:
        print("   ⚠", line)
    for line in missing[:5]:
        print("   ⚠", line)


# 当前维护：fig1 总览 + 两张剖分图
FIGURES = {"fig1": fig1, "fig2": fig2, "fig3": fig3, "fig4": fig4}
# 已归档（不默认生成，显式点名才跑；产物落在 figures/legacy/）
LEGACY = {"legacy-fig2": legacy_fig2, "legacy-fig3": legacy_fig3, "legacy-fig4": legacy_fig4}
ALL = {**FIGURES, **LEGACY}


def main() -> None:
    print(f"中文字体：{setup_font()}")
    asked = [a for a in sys.argv[1:] if a in ALL]
    if asked:
        wanted = asked
    elif sys.argv[1:]:
        raise SystemExit(f"未知图名：{sys.argv[1:]}；可选 {sorted(ALL)}")
    else:
        wanted = list(FIGURES)
    for key in wanted:
        ALL[key]()


if __name__ == "__main__":
    main()
