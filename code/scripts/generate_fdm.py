#!/usr/bin/env python
"""
generate_fdm.py - 21cmFAST FDM (Fuzzy Dark Matter) 功率谱随红移演化生成工具

与 generate.py 功能一致，但额外引入 M_TURN 参数模拟模糊暗物质的效应。
M_TURN 是临界质量 (log10(Msun))，低于此质量的 halo 会受到 FDM 的抑制。

Usage:
    python generate_fdm.py
    python generate_fdm.py --seed 123
"""

from _common import main

if __name__ == "__main__":
    main(config_name="config_fdm.yaml", model_label="FDM")
