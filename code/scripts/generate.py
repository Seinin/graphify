#!/usr/bin/env python
"""
generate.py - 21cmFAST (CDM) 功率谱随红移演化生成工具

使用 template='simple' 快速运行21cmFAST模拟，计算不同红移下的功率谱。

simple 模板关闭了 USE_EXP_FILTER, CELL_RECOMB, USE_MINI_HALOS, USE_TS_FLUCT, INHOMO_RECO 等
复杂特性，仅保留基本的再电离物理，运行速度更快。

Usage:
    python generate.py
    python generate.py --seed 123
"""

from _common import main

if __name__ == "__main__":
    main(config_name="config.yaml", model_label="CDM")
