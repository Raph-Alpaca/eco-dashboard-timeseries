/**
 * "화면값 = 보고서값" 검사.
 * 2025년 공표값 저장소의 모든 행(전체·공표 축)에 대해, 화면이 쓰는 집계(큐브 집계 + 공표값 덮어쓰기)가
 * 인쇄된 값을 그대로 내는지 확인한다. 큐브에 없는 축처럼 짝지을 수 없는 행은 세어서 알려 준다.
 * 실행: node --test tests/pubmerge.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { CubeIndex } from "../js/aggregate.js";
import { mergePublished, filtersAllowPublished, publishedCovers } from "../js/pubmerge.js";

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf-8"));
const codebooks = { school_survey: read("../data/codebook/school_survey.json"), status_survey: read("../data/codebook/status_survey.json") };
const pops = readdirSync(new URL("../data/published/2025/", import.meta.url)).map(f => f.replace(".json", ""));

test("공표된 집단의 화면값은 보고서 인쇄값과 같다", () => {
  let checked = 0, rowsMatched = 0;
  const unmatched = [];
  for (const pop of pops) {
    const pub = read(`../data/published/2025/${pop}.json`);
    const cube = new CubeIndex(read(`../data/cubes/${pop}.json`), codebooks[pub.survey]);
    for (const [qid, pq] of Object.entries(pub.questions)) {
      const q = cube.questions[qid];
      if (!q) { unmatched.push(`${pop} ${qid}: 큐브에 없는 문항`); continue; }
      const sets = q.type.startsWith("item_")
        ? Object.entries(pq.itemRows || {}).map(([item, rows]) => ({ keys: [`${qid}_${item}`], rows }))
        : [{ keys: q.cubeKeys, rows: pq.rows || [] }];
      for (const { keys, rows } of sets) for (const key of keys) {
        for (const r of rows) {
          const by = r.by === "all" ? [] : [r.by];
          if (by.length && !cube.hasAxis(r.by)) { unmatched.push(`${pop} ${qid} [${r.by}=${r.key}]: 큐브에 없는 축`); continue; }
          const agg = mergePublished(cube.aggregate(key, { by }), pq, { filters: {}, by });
          const g = agg.groups.find(x => (by.length ? String(x.keys[0]) : "all") === String(r.key));
          if (!g) { unmatched.push(`${pop} ${qid} [${r.by}=${r.key}]: 큐브에 없는 코드`); continue; }
          rowsMatched++;
          const dist = agg.rank ? r[agg.rank] : r.pct;
          if (Array.isArray(dist) && dist.length === agg.k) { assert.deepEqual(g.pct, dist, `${pop} ${key} ${r.by}=${r.key} pct`); checked += dist.length; }
          if (r.positive != null) { assert.equal(g.positive, r.positive, `${pop} ${key} ${r.by}=${r.key} positive`); checked++; }
          if (r.mean != null) { assert.equal(g.mean, r.mean, `${pop} ${key} ${r.by}=${r.key} mean`); checked++; }
          if (r.n != null) { assert.equal(g.n, r.n, `${pop} ${key} ${r.by}=${r.key} n`); checked++; }
          if (r.wn != null) { assert.equal(g.base, r.wn, `${pop} ${key} ${r.by}=${r.key} wn`); checked++; }
        }
      }
    }
  }
  console.log(`확인한 값 ${checked}개 · 짝지은 행 ${rowsMatched}개 · 짝짓지 못한 행 ${unmatched.length}개`);
  for (const u of unmatched.slice(0, 20)) console.log("  ·", u);
  assert.ok(checked > 10000, "확인한 값이 너무 적음");
  assert.ok(unmatched.length <= 40, `짝짓지 못한 행이 많음(${unmatched.length})`);
});

test("필터를 걸거나 두 축을 교차하면 공표값을 쓰지 않는다", () => {
  const pub = read("../data/published/2025/inst_school.json");
  const cube = new CubeIndex(read("../data/cubes/inst_school.json"), codebooks.status_survey);
  const pq = pub.questions.SCH_PLAN_YN;
  const plain = mergePublished(cube.aggregate("SCH_PLAN_YN", { by: ["level"] }), pq, { filters: {}, by: ["level"] });
  assert.equal(plain.pubAll, true);
  assert.equal(publishedCovers(plain, "positive"), true);
  assert.deepEqual(plain.groups.map(g => g.positive), [93.1, 85.0, 77.8]);   // 2025 보고서 표 4-44 (PDF p.266)
  const filtered = mergePublished(cube.aggregate("SCH_PLAN_YN", { by: ["level"], filters: { region5: ["cap"] } }), pq, { filters: { region5: ["cap"] }, by: ["level"] });
  assert.equal(filtered.pubAll, false);
  assert.equal(publishedCovers(filtered, "positive"), false);
  const crossed = mergePublished(cube.aggregate("SCH_PLAN_YN", { by: ["level", "region5"] }), pq, { filters: {}, by: ["level", "region5"] });
  assert.equal(crossed.pubAll, false);
  assert.equal(filtersAllowPublished({ base: { dim: "coord", eq: 1 } }, { coord: ["1"] }), true);
  assert.equal(filtersAllowPublished({ base: { dim: "coord", eq: 1 } }, { coord: ["1"], level: ["E"] }), false);
});
