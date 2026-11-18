"""공표값 저장소·문항 대응표 검사.

    python -m unittest tests/test_published.py

핵심 보장
  1. 공표값 저장소의 숫자는 전사본(data/source)의 숫자와 한 글자도 다르지 않다(다시 계산하지 않는다).
  2. 두 해를 잇는 문항은 유형·보기가 같고, 잇기로 한 집단은 두 해 모두 공표되어 있다.
  3. '문구만 다름' 문항에는 두 해의 설문 문구가 들어 있다.
  4. 유아·초중등은 '전체'를 잇지 않는다(가중 방식이 다름) — 한 학교급만 묻는 문항은 예외.
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import build_published as bp  # noqa: E402

PUB = ROOT / "data" / "published"


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


class PublishedStore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = load(PUB / "index.json")
        cls.docs = {(y, p): load(PUB / str(y) / f"{p}.json") for p, d in cls.index["pops"].items() for y in d["years"]}

    def test_builder_passes(self):
        self.assertEqual(bp.build(check_only=True), 0)

    def test_numbers_equal_source(self):
        n = 0
        for (y, pop), doc in self.docs.items():
            src = {t["qid"]: t for t in load(bp.source_path(y, pop))["tables"]}
            self.assertEqual(list(src), doc["order"])
            for qid, q in doc["questions"].items():
                for a, b in zip(src[qid].get("rows") or [], q.get("rows") or []):
                    for k in bp.ROW_KEYS:
                        if k == "positive" and k not in a:
                            continue   # 인쇄된 보기 비율에서 그대로 가져온 값(아래에서 따로 검사)
                        self.assertEqual(a.get(k), b.get(k), f"{y} {pop} {qid} {a.get('by')}={a.get('key')} {k}")
                        n += 1
                    if "positive" not in a and b.get("positive") is not None:
                        self.assertIn(b["positive"], a["pct"], f"{y} {pop} {qid}: positive 는 인쇄된 pct 중 하나여야 함")
        self.assertGreater(n, 20000)

    def test_linked_items_are_comparable(self):
        linked = 0
        for pop, pdef in self.index["pops"].items():
            for qid, it in pdef["items"].items():
                if it["status"] not in self.index["linked"]:
                    continue
                linked += 1
                a, b = self.docs[(2024, pop)]["questions"][qid], self.docs[(2025, pop)]["questions"][qid]
                self.assertEqual(a["type"], b["type"], f"{pop} {qid}")
                if a["type"] != "binary":
                    self.assertEqual([bp.norm_text(x) for x in a.get("categories") or []], [bp.norm_text(x) for x in b.get("categories") or []], f"{pop} {qid}")
                self.assertTrue(it["all"] or it["axes"], f"{pop} {qid}: 이을 집단이 없음")
                for axis in it["axes"]:
                    self.assertIn(axis, a["axes"]); self.assertIn(axis, b["axes"])
                if it["all"]:
                    self.assertTrue(a["hasAll"] and b["hasAll"], f"{pop} {qid}")
        self.assertGreater(linked, 100)

    def test_wording_items_carry_both_texts(self):
        for pop, pdef in self.index["pops"].items():
            for qid, it in pdef["items"].items():
                if it["status"] == "wording":
                    w = it.get("wording") or {}
                    self.assertTrue(w.get("2024") and w.get("2025") and w.get("diff"), f"{pop} {qid}")

    def test_unlinked_items_have_reason(self):
        for pop, pdef in self.index["pops"].items():
            for qid, it in pdef["items"].items():
                if it["status"] in ("changed", "base", "cats", "unit", "struct"):
                    self.assertTrue(it.get("reason"), f"{pop} {qid}: 잇지 않는 이유가 비어 있음")

    def test_weighted_pops_do_not_link_totals(self):
        for pop in ("inst_early", "inst_school"):
            pdef = self.index["pops"][pop]
            for qid, it in pdef["items"].items():
                if it["status"] not in self.index["linked"]:
                    continue
                self.assertNotIn("region5", it["axes"], f"{pop} {qid}")
                if it["all"]:   # 한 학교급만 묻는 문항만 허용
                    self.assertRegex(qid, r"^SCH_[EMH]_", f"{pop} {qid}: '전체'를 이으면 안 됨")


if __name__ == "__main__":
    unittest.main()
