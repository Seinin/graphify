#!/usr/bin/env python3
"""Convert a two-column PDF (e.g. a journal review) to Markdown using PyMuPDF.

Offline fallback: no HuggingFace model download needed.
Usage: python scripts/pdf_to_md.py <input.pdf> [output.md]

Handles MathType (MTEX/MTMI) embedded equations: those fonts carry no ToUnicode
CMap, so PyMuPDF returns control characters. The real byte->glyph mapping is
read from each font's /Encoding /Differences array and applied per font.
"""
import re
import sys

import fitz

LIGATURES = {
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi",
    "\ufb04": "ffl", "\ufb05": "ft", "\ufb06": "st",
    "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-",
    "\u00a0": " ", "\u202f": " ",
}

BOLD_HINTS = ("bold", "bd", "black")

# Byte -> unicode fixes for MathType fonts (from the PDF /Encoding /Differences
# arrays; non-AGL glyph names come out as control chars).
MTEX_FIX = {
    0x01: "\u222b",  # integraltext
    0x02: "\u222b",  # integraldisplay
    0x03: "(", 0x04: ")", 0x05: "[", 0x06: "]", 0x07: "[", 0x08: "]",
    0x09: "\u2211",  # summationdisplay
    0x0A: "\u221a",  # radicalBig
    0x0B: "[", 0x0C: "]", 0x0D: "{", 0x0E: "}",
    0x0F: "\u2211",  # summationtext
    0x10: "[", 0x11: "(", 0x12: ")", 0x13: "]",
    0x14: "\u221a",  # radicalbig
    0x15: "(", 0x16: ")",
    0x17: "\u221a",  # radicalBigg
}
MTMI_FIX = {
    0x01: "\u03b1", 0x02: "\u039b", 0x03: "\u03a9", 0x04: "\u03c3",
    0x05: "\u0394", 0x06: "\u03bd", 0x07: "\u03c4", 0x08: "\u2605",
    0x09: "\u03bb", 0x0A: "\u03c6", 0x0B: "\u03c0", 0x0C: "\u03b4",
    0x0D: "\u2202", 0x0E: "\u03b3", 0x0F: "\u03ba", 0x10: "\u03c7",
    0x11: "\u03b7", 0x12: "\u2113", 0x13: "\u0393", 0x14: "\u03b2",
    0x15: "\u03b5", 0x16: "\u03c1", 0x17: "\u03b6",
    0x28: "(", 0x29: ")", 0x2C: ",", 0x2E: ".", 0x2F: "/",
    0x3C: "<", 0x3E: ">", 0xB5: "\u03bc",
}


def clean(s: str) -> str:
    for k, v in LIGATURES.items():
        s = s.replace(k, v)
    s = s.replace("\xad", "")  # soft hyphen
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def fix_chars(span: dict) -> str:
    """Rebuild a span's text with per-font MathType glyph fixes."""
    fname = (span.get("font") or "").upper()
    fix = MTEX_FIX if "MTEX" in fname else (MTMI_FIX if "MTMI" in fname else None)
    out = []
    for ch in span.get("chars", []):
        c = ch["c"]
        if fix is not None:
            code = ord(c)
            if code < 32 or 0xE000 <= code <= 0xF8FF:
                c = fix.get(code, c)
        out.append(c)
    return "".join(out)


def block_style(blk: dict):
    """Return (max_size, is_bold, text) for a text block (font-aware)."""
    lines, sizes, bolds, texts = [], [], [], []
    for ln in blk["lines"]:
        txt, sz, bd = "", 0.0, False
        for sp in ln["spans"]:
            t = fix_chars(sp)
            txt += t
            sz = max(sz, sp["size"])
            name = (sp["font"] or "").lower()
            if any(h in name for h in BOLD_HINTS):
                bd = True
        sizes.append(sz)
        bolds.append(bd)
        texts.append(txt)
    return (max(sizes, default=0.0), any(bolds), texts)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else src.rsplit(".", 1)[0] + ".md"

    doc = fitz.open(src)
    out_lines = [
        "# Pritchard & Loeb (2012), Rep. Prog. Phys. 75 086901 — “21 cm cosmology in the 21st century”",
        "",
        "> Auto-converted from PDF with PyMuPDF (offline, no layout/OCR models). "
        "`<!-- page N -->` markers refer to pages of the original PDF.",
        "",
    ]

    for pno, page in enumerate(doc):
        d = page.get_text("rawdict")  # "dict" has no per-char info; rawdict does
        bands: list[dict] = []  # {'y0': float, 'blocks': [...]}

        for blk in d["blocks"]:
            if blk["type"] != 0:
                continue
            x0, y0, x1, y1 = blk["bbox"]
            # drop running headers (journal name / authors) and page-number footers
            if (pno == 0 and y1 < 95) or (pno > 0 and y1 < 62):
                continue
            if y0 > 788:
                continue

            maxsz, is_bold, lines = block_style(blk)
            text = "\n".join(lines)
            if not text.strip():
                continue
            t = text.strip()
            if re.fullmatch(r"\d+", t):  # bare page number
                continue

            # banding: group blocks that share a horizontal band (reading order)
            if not bands or y0 - bands[-1]["y0"] > 12:
                bands.append({"y0": y0, "blocks": []})
            bands[-1]["blocks"].append((x0, maxsz, is_bold, text))

        if not bands:
            continue
        out_lines.append(f"<!-- page {pno + 1} -->")
        for band in bands:
            for x0, maxsz, is_bold, text in sorted(band["blocks"], key=lambda b: b[0]):
                clean_lines = [clean(l) for l in text.split("\n")]
                clean_lines = [l for l in clean_lines if l]
                if not clean_lines:
                    continue
                joined = " ".join(clean_lines)  # reflow into a paragraph
                if maxsz >= 10.5 and is_bold:
                    out_lines.append(f"## {joined}")
                else:
                    out_lines.append(joined)
                out_lines.append("")

    md = "\n".join(out_lines)
    md = re.sub(r"\n{3,}", "\n\n", md)
    # drop stray bullet glyphs from the journal sidebar ("Related content" etc.)
    md = re.sub(r"^-\n", "", md, flags=re.M)
    # re-attach integral signs split onto their own extracted lines
    md = re.sub(r"\n∫\n", " ∫ ", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    # strip any remaining control chars / private-use chars
    md = "".join(
        ch for ch in md
        if (ord(ch) >= 32 or ch in "\n\t") and not 0xE000 <= ord(ch) <= 0xF8FF
    )
    with open(out, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"wrote {out} ({len(md)} chars, {len(doc)} pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
