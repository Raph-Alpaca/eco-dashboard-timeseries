#!/usr/bin/env python3
"""공표값 저장소 생성기.

보고서 공표 수치 전사본(data/source)을 화면이 바로 읽는 형태로 정리하고,
연도 간 문항 대응표(data/link/status_survey.json)를 검사해 붙입니다.

    입력  data/source/s2_*.json          2025년 실태조사 전사본
          data/source/2024/s2_*.json     2024년 실태조사 전사본
          data/source/2024/_meta.json    2024년 조사 개요·참여 현황
          data/codebook/base_status.json 축·기관 정의, 2025년 조사 개요
          data/link/status_survey.json   사람이 정한 대응 판정(없으면 자동 판정만)
    출력  data/published/<연도>/<pop>.json
          data/published/index.json      연도·기관·문항별 대응 상태

원칙
  · 숫자는 전사본 그대로 옮깁니다(여기서 새 숫자를 만들지 않습니다).
    예외: 여부형 문항의 '있음 비율'이 비어 있으면 인쇄된 보기 비율에서 그대로 가져옵니다.
  · 두 해를 잇는 것은 대응 상태가 same(동일)·wording(문구만 다름)인 문항뿐입니다.
  · 사람이 same/wording 으로 정한 문항이라도 유형·보기·기준이 다르면 오류로 멈춥니다.

사용: python -I tools/build_published.py [--check]   (--check: 파일을 쓰지 않고 검사만)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "source"
OUT = ROOT / "data" / "published"
LINK = ROOT / "data" / "link" / "status_survey.json"
BASE = ROOT / "data" / "codebook" / "base_status.json"

SURVEY = "status_survey"
YEARS = [2024, 2025]
LINKED = ("same", "wording")
STATUSES = ("same", "wording", "changed", "base", "cats", "unit", "struct", "only2024", "only2025")
STATUS_LABEL = {
    "same": "동일 문항", "wording": "문구만 다름", "changed": "묻는 범위·정의가 달라짐",
    "base": "응답 기준(분모)이 다름", "cats": "보기 구성이 다름", "unit": "단위·산출 기준이 다름",
    "struct": "표 구성이 다름", "only2024": "2024년에만 조사", "only2025": "2025년에만 조사",
}
ROW_KEYS = ("by", "key", "n", "wn", "pct", "positive", "mean", "sd", "rse", "counts", "total", "events",
            "r1", "r12", "r123", "bins")
Q_KEYS = ("qid", "label", "short", "section", "indicator", "type", "scale", "categories", "items", "positive",
          "base", "baseKind", "source", "notes", "multi", "unit")
# 2024는 가중치 미적용이라 '기관', 2025는 '가중 기관 수'로 적었지만 같은 기준(기관 단위)이다.
BASEKIND_EQ = {"가중 기관 수": "기관"}


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def source_path(year, pop):
    name = "s2_" + pop.replace("inst_", "") + ".json"
    return (SRC / name) if year == 2025 else (SRC / str(year) / name)


def norm_text(s):
    return re.sub(r"[\s·ㆍ․\.,/()\[\]‘’'\"“”-]", "", str(s or ""))


def norm_row(row, q):
    r = {k: row[k] for k in ROW_KEYS if k in row}
    t = q["type"]
    pct = r.get("pct")
    if r.get("positive") is None and isinstance(pct, list):
        # 인쇄된 보기 비율에서 '있음/해당' 비율을 그대로 가져온다(새로 계산하는 값이 아님)
        if t == "binary" and len(pct) == 2 and pct[1] is not None:
            r["positive"] = pct[1]
        elif t == "single" and q.get("positive") and len(q["positive"]) == 1 and pct[q["positive"][0]] is not None:
            r["positive"] = pct[q["positive"][0]]
    return r


def norm_question(t):
    q = {k: t[k] for k in Q_KEYS if k in t and t[k] is not None}
    if isinstance(q.get("notes"), list):
        q["notes"] = " ".join(map(str, q["notes"]))
    if "rows" in t:
        q["rows"] = [norm_row(r, t) for r in t["rows"]]
    if "itemRows" in t:
        q["itemRows"] = {k: [norm_row(r, t) for r in v] for k, v in t["itemRows"].items()}
    rows = q.get("rows") or [r for v in (q.get("itemRows") or {}).values() for r in v]
    q["axes"] = sorted({r["by"] for r in rows if r.get("by") and r["by"] != "all"})
    q["hasAll"] = any(r.get("by") == "all" for r in rows)
    return q


def auto_status(a, b):
    """두 해 문항의 형식이 맞는지 본다. 반환 (status, reason) — 문제없으면 ('same', '')."""
    if a["type"] != b["type"]:
        return "struct", f"문항 형식이 다름(2024 {a['type']} / 2025 {b['type']})"
    ca, cb = a.get("categories") or [], b.get("categories") or []
    # 여부형은 보기가 [아니오, 예] 두 개로 고정이고 표기(있음/제정함/수립함 …)만 해마다 다르므로 문구는 비교하지 않는다
    if a["type"] != "binary" and [norm_text(x) for x in ca] != [norm_text(x) for x in cb]:
        return "cats", f"보기 구성이 다름(2024 {len(ca)}개 / 2025 {len(cb)}개)"
    ka, kb = BASEKIND_EQ.get(a.get("baseKind"), a.get("baseKind")), BASEKIND_EQ.get(b.get("baseKind"), b.get("baseKind"))
    if ka != kb:
        return "base", f"집계 기준이 다름(2024 {a.get('baseKind')} / 2025 {b.get('baseKind')})"
    if bool(a.get("base")) != bool(b.get("base")):
        return "base", "한 해는 전체 기관, 다른 해는 조건에 해당하는 기관만 응답"
    return "same", ""


def build(check_only=False):
    base = load(BASE)
    link = load(LINK) if LINK.exists() else {"pops": {}}
    meta24 = load(SRC / "2024" / "_meta.json")
    errors, warns = [], []
    years_meta = [
        {"year": 2024, "refDate": meta24["refDate"], "title": meta24["title"], "sourceDoc": meta24["sourceDoc"],
         "publisher": meta24.get("publisher"), "fieldwork": meta24["fieldwork"], "weighting": meta24["weighting"],
         "label": "2024년 조사", "refLabel": "2023년 말 기준", "participation": meta24["participation"],
         "participationSource": "표1-14 (PDF p.61)", "dimLabels": meta24.get("dimLabels", {})},
        {"year": 2025, "refDate": "2024-12-31", "title": base["title"], "sourceDoc": base["sourceDoc"],
         "publisher": base.get("publisher"), "fieldwork": base["fieldwork"],
         "weighting": "유아·초중등교육기관은 층화계통추출 표본에 모집단 기준 가중치를 적용한 추정값(표의 사례 수는 가중 사례 수).",
         "label": "2025년 조사", "refLabel": "2024년 말 기준",
         "participation": {p: d.get("participation") for p, d in base["populations"].items()},
         "participationSource": "표 1-10 (PDF p.47)", "dimLabels": {}},
    ]
    index = {"schemaVersion": 1, "survey": SURVEY, "years": years_meta, "statusLabels": STATUS_LABEL, "linked": list(LINKED),
             "dims": {k: {"label": v["label"], "codes": v["codes"]} for k, v in base["dims"].items()},
             "areas": base["areas"], "indicators": base["indicators"], "pops": {}, "summary": {}}
    docs = {}
    for pop, pdef in base["populations"].items():
        qs = {}
        for y in YEARS:
            p = source_path(y, pop)
            if not p.exists():
                warns.append(f"{pop} {y}: 전사본 없음({p.relative_to(ROOT)})")
                qs[y] = None
                continue
            doc = load(p)
            if doc.get("pop") != pop:
                errors.append(f"{p.name}: pop '{doc.get('pop')}' ≠ {pop}")
            qmap = {}
            for t in doc["tables"]:
                qmap[t["qid"]] = norm_question(t)
            qs[y] = qmap
            docs[(y, pop)] = {"schemaVersion": 1, "survey": SURVEY, "pop": pop, "year": y,
                              "order": [t["qid"] for t in doc["tables"]], "questions": qmap}
        lp = (link.get("pops") or {}).get(pop, {})
        manual = lp.get("items", {})
        items, counts = {}, {s: 0 for s in STATUSES}
        q24, q25 = qs.get(2024) or {}, qs.get(2025) or {}
        for qid in list(dict.fromkeys(list(q25) + list(q24))):
            a, b = q24.get(qid), q25.get(qid)
            m = manual.get(qid, {})
            if a is None or b is None:
                status, reason = ("only2025" if a is None else "only2024"), m.get("reason", "")
                if qs.get(2024) is None:
                    status, reason = "only2025", "2024년 전사 전"
            else:
                auto, areason = auto_status(a, b)
                status, reason = m.get("status", auto), m.get("reason", areason)
                if status in LINKED and auto != "same":
                    errors.append(f"{pop} {qid}: 대응표는 '{status}'인데 형식이 맞지 않음 — {areason}")
                if status == "wording" and not (m.get("wording") or {}).get("2024"):
                    errors.append(f"{pop} {qid}: wording 판정에는 두 해의 문항 문구(wording)가 필요")
            if status not in STATUSES:
                errors.append(f"{pop} {qid}: 알 수 없는 상태 '{status}'")
                continue
            it = {"status": status, "years": [y for y, q in ((2024, a), (2025, b)) if q is not None],
                  "short": (b or a)["short"], "section": (b or a)["section"], "type": (b or a)["type"]}
            if reason:
                it["reason"] = reason
            for k in ("wording", "note", "evidence"):
                if m.get(k):
                    it[k] = m[k]
            if status in LINKED:
                # 두 해 모두 공표된 축만 잇는다. 기관 유형에 따라 '전체'나 일부 축은 잇지 않는다(가중 방식 차이 등).
                # 문항별 지정(all/axes)이 있으면 그것을 따른다(예: 한 학교급만 묻는 문항은 '전체'가 곧 그 학교급).
                allowed = m["axes"] if "axes" in m else lp.get("trendAxes")
                axes = [x for x in a["axes"] if x in b["axes"] and (allowed is None or x in allowed)]
                it["axes"] = axes
                all_ok = m["all"] if "all" in m else (lp.get("trendAxes") is None or "all" in lp["trendAxes"])
                it["all"] = bool(a["hasAll"] and b["hasAll"] and all_ok)
                if not it["all"] and not axes:
                    warns.append(f"{pop} {qid}: 이을 수 있는 공통 집단이 없음")
            items[qid] = it
            counts[status] += 1
        for qid in manual:
            if qid not in items:
                errors.append(f"{pop} {qid}: 대응표에 있으나 전사본에 없는 문항")
        index["pops"][pop] = {"label": pdef["label"], "census": bool(pdef.get("census")), "unitDim": pdef.get("unitDim"),
                              "note": lp.get("note", ""), "trendAxes": lp.get("trendAxes"),
                              "years": [y for y in YEARS if qs.get(y) is not None], "items": items}
        index["summary"][pop] = counts
    # 현황조사(단년도): 추이는 없지만 2025년 화면이 공표값을 그대로 쓰도록 같은 형태로 내보낸다
    school = load(ROOT / "data" / "codebook" / "base_school.json")
    for pop, pdef in school["populations"].items():
        order, qmap = [], {}
        for name in pdef.get("sources", []):
            for t in load(SRC / name)["tables"]:
                order.append(t["qid"])
                qmap[t["qid"]] = norm_question(t)
        docs[(2025, pop)] = {"schemaVersion": 1, "survey": "school_survey", "pop": pop, "year": 2025, "order": order, "questions": qmap}
    for e in errors:
        print("[오류]", e)
    for w in warns:
        print("[경고]", w)
    print("기관 | " + " | ".join(STATUS_LABEL[s] for s in STATUSES))
    for pop, c in index["summary"].items():
        print(f"{pop} | " + " | ".join(str(c[s]) for s in STATUSES))
    if errors:
        return 1
    if not check_only:
        for (y, pop), doc in docs.items():
            out = OUT / str(y) / f"{pop}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"→ {OUT.relative_to(ROOT)} 에 {len(docs)}개 파일 + index.json")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    sys.exit(build(ap.parse_args().check))
