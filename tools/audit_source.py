#!/usr/bin/env python3
"""전사 감사: data/source 의 숫자가 인용한 보고서 PDF 쪽의 본문에 실제로 있는지 대조합니다.

    python -I tools/audit_source.py            → data/audit_report.md

보고서 PDF 는 저장소에 없습니다(.gitignore). 저장소 폴더(또는 --pdf-dir)에 아래 이름으로 두고 실행합니다.
    2025년 학교환경교육 현황조사 결과보고서.pdf / 2025년 환경교육 실태조사_기술통계보고서.pdf / 2024년 환경교육실태조사_250331.pdf
PDF 글자 추출에는 poppler 의 pdftotext 가 필요합니다.

판정
  본문 확인   : 인용 쪽(앞뒤 쪽 포함) 본문에 같은 숫자가 있음
  0("-")      : 값이 0 — 보고서는 "-"로 인쇄
  다른 쪽     : 사례 수(n) 등이 보고서의 다른 쪽에 인쇄되어 있음
  계산값      : 인쇄된 숫자로 계산한 값(전사 메모에 계산식이 있음)
  그림        : 그래프 안의 숫자라 글자로 추출되지 않음 → 쪽 이미지로 사람이 확인해야 함
  미분류      : 위 어디에도 해당하지 않음 → 반드시 확인

이 도구는 "숫자가 그 쪽에 있다"까지만 보장합니다. 숫자가 올바른 칸에 들어갔는지는 쪽 이미지 대조(사람·검증자)로 확인합니다.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "source"
SETS = [
    ("2025 현황조사", "2025년 학교환경교육 현황조사 결과보고서.pdf", sorted(SRC.glob("s1_*.json"))),
    ("2025 실태조사", "2025년 환경교육 실태조사_기술통계보고서.pdf", sorted(SRC.glob("s2_*.json"))),
    ("2024 실태조사", "2024년 환경교육실태조사_250331.pdf", sorted((SRC / "2024").glob("s2_*.json"))),
]
NUM = re.compile(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?")
DERIVED = re.compile(r"계산|산출|도출|합산|환산|= ?100 ?-|합계|역산|÷|/ ?\d")
CATS = ["본문 확인", '0("-")', "다른 쪽", "계산값", "그림", "미분류"]
SKIP = {"by", "key", "note", "notes", "label", "nHq", "nOther"}


def pdf_pages(pdf):
    out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), "-"], capture_output=True)
    return out.stdout.decode("utf-8", "replace").split("\f")


def tokens(text):
    s = set()
    for m in NUM.finditer(text):
        try:
            s.add(round(float(m.group(0).replace(",", "")), 6))
        except ValueError:
            pass
    return s


def leaves(row):
    for k, v in row.items():
        if k in SKIP or v is None or isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            yield k, float(v)
        elif isinstance(v, list):
            for x in v:
                if isinstance(x, (int, float)) and not isinstance(x, bool):
                    yield k, float(x)


def audit_file(path, pages, doc_tokens):
    c = Counter()
    todo = []
    doc = json.loads(path.read_text(encoding="utf-8"))
    for t in doc["tables"]:
        pgs = sorted({s["pdf"] for s in t.get("source", []) if s.get("pdf")})
        span = set()
        for p in pgs:
            span |= {p - 1, p, p + 1, p + 2}
        pool = set()
        for p in span:
            if 1 <= p <= len(pages):
                pool |= tokens(pages[p - 1])
        notes = t.get("notes") or ""
        if isinstance(notes, list):
            notes = " ".join(map(str, notes))
        refs = " ".join(s["ref"] for s in t.get("source", []))
        has_fig = "그림" in refs
        rows = list(t.get("rows") or [])
        for v in (t.get("itemRows") or {}).values():
            rows += v
        for r in rows:
            for k, v in leaves(r):
                c["전체"] += 1
                rv = round(v, 6)
                if rv in pool:
                    c["본문 확인"] += 1
                elif v == 0.0:
                    c['0("-")'] += 1
                elif k in ("n", "wn") and rv in doc_tokens:
                    c["다른 쪽"] += 1
                elif DERIVED.search(notes) or (k == "positive" and r.get("pct")) or (k in ("pct", "positive") and v == 100.0 and r.get("n") in (1, None) and r.get("by") != "all"):
                    c["계산값"] += 1
                elif has_fig:
                    c["그림"] += 1
                    todo.append((t["qid"], "그림", pgs))
                elif rv in doc_tokens:
                    c["다른 쪽"] += 1
                else:
                    c["미분류"] += 1
                    todo.append((t["qid"], f"미분류 {k}={v:g} [{r.get('by')}={r.get('key')}]", pgs))
    return c, todo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", default=str(ROOT))
    ap.add_argument("--out", default=str(ROOT / "data" / "audit_report.md"))
    args = ap.parse_args()
    lines = ["# 전사 감사 보고서 — 전사 숫자가 보고서 본문에 있는가", "",
             "`python -I tools/audit_source.py` 로 다시 만들 수 있습니다. 판정 기준은 `tools/audit_source.py` 머리말 참고.", "",
             "| 보고서 | 파일 | 숫자 | " + " | ".join(CATS) + " |", "|---|---|---:|" + "---:|" * len(CATS)]
    detail = []
    bad = 0
    for name, pdfname, files in SETS:
        pdf = Path(args.pdf_dir) / pdfname
        if not pdf.exists():
            lines.append(f"| {name} | (PDF 없음: {pdfname}) | | " + " | ".join("" for _ in CATS) + " |")
            continue
        pages = pdf_pages(pdf)
        doc_tokens = tokens("\n".join(pages))
        tot = Counter()
        for f in files:
            c, todo = audit_file(f, pages, doc_tokens)
            tot += c
            lines.append(f"| {name} | {f.name} | {c['전체']:,} | " + " | ".join(f"{c[k]:,}" for k in CATS) + " |")
            figs = sorted({(q, tuple(p)) for q, kind, p in todo if kind == "그림"})
            unk = [(q, kind, p) for q, kind, p in todo if kind != "그림"]
            bad += len(unk)
            if figs:
                detail.append(f"- **{name} · {f.name}** 그림에서 읽은 값이 있는 문항({len(figs)}개): " + ", ".join(f"{q}(p.{'·'.join(map(str, p))})" for q, p in figs))
            for q, kind, p in unk:
                detail.append(f"- **{name} · {f.name}** {q}: {kind} (p.{'·'.join(map(str, p))})")
        pct = 100 * tot["본문 확인"] / max(1, tot["전체"])
        lines.append(f"| **{name} 합계** | | **{tot['전체']:,}** | " + " | ".join(f"**{tot[k]:,}**" for k in CATS) + f" | ← 본문 확인 {pct:.1f}%")
    lines += ["", "## 사람이 쪽 이미지로 확인해야 하는 것", ""] + (detail or ["없음"])
    Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[4:4 + 40]))
    print(f"→ {Path(args.out).relative_to(ROOT)} (미분류 {bad}건)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
