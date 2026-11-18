/**
 * pubmerge.js — "화면값 = 보고서값" 보장.
 *
 * 합성 큐브를 다시 집계한 값은 공표값과 소수점 수준에서(소집단·평균은 그보다 크게) 어긋날 수 있다.
 * 그래서 보고서에 그 집단의 값이 인쇄되어 있으면(전체, 또는 공표된 축 하나) 인쇄값으로 덮어쓴다.
 * 필터를 걸었거나 두 축을 교차한 경우처럼 보고서에 없는 조합에는 손대지 않는다(합성값 그대로).
 *
 * 덮어쓰는 것은 인쇄된 필드뿐이다: 보기별 비율(pct), 있음·긍정 비율(positive), 평균(mean), 합계(sum), 사례 수(n / 가중 사례 수).
 * 각 group 에 pub = {pct, positive, mean, n} (덮어쓴 필드) 를 남겨 화면이 '보고서 공표값' 표시를 붙일 수 있게 한다.
 */

/** 이 필터 상태에서 공표값을 써도 되는가: 필터가 없거나, 문항의 응답 대상 조건(base.dim)과 같은 필터뿐일 때 */
export function filtersAllowPublished(q, filters) {
  const active = Object.entries(filters || {}).filter(([, v]) => v && v.length);
  if (!active.length) return true;
  const b = q?.base;
  if (b && b.dim && active.length === 1) {
    const [axis, codes] = active[0];
    return axis === b.dim && codes.length === 1 && String(codes[0]) === String(b.eq);
  }
  return false;
}

function rowsFor(agg, pq) {
  if (!pq) return null;
  if (agg.item) return (pq.itemRows || {})[agg.item.id] || null;
  return pq.rows || null;
}

/**
 * @param agg  CubeIndex.aggregate() 결과(직접 고친다)
 * @param pq   공표값 저장소의 같은 문항(qid) — 없으면 아무것도 하지 않음
 * @param opt  {filters, by}
 * @returns agg (agg.pubAll: 모든 집단이 공표 행과 짝지어졌는가)
 */
export function mergePublished(agg, pq, { filters = {}, by = [] } = {}) {
  if (!agg || !pq) return agg;
  agg.pubAll = false;
  if (by.length > 1 || !filtersAllowPublished(agg.q, filters)) return agg;
  const rows = rowsFor(agg, pq);
  if (!rows) return agg;
  const axis = by[0] || "all";
  const posIdx = agg.q?.positive && agg.q.positive.length ? agg.q.positive : (["binary", "item_binary"].includes(agg.q?.type) ? [1] : null);
  let matched = 0, live = 0;
  for (const g of agg.groups) {
    const key = by.length ? String(g.keys[0]) : "all";
    const r = rows.find(x => x.by === axis && String(x.key) === key);
    if (!g.empty) live++;
    if (!r) continue;
    const pub = {};
    const dist = agg.rank ? r[agg.rank] : r.pct;
    if (Array.isArray(dist) && dist.length === g.pct.length) { g.pct = dist.slice(); pub.pct = true; }
    if (r.positive != null) { g.positive = r.positive; pub.positive = true; }
    else if (pub.pct && posIdx && posIdx.every(j => g.pct[j] != null)) { g.positive = posIdx.reduce((a, j) => a + g.pct[j], 0); pub.positive = true; }
    if (r.mean != null) { g.mean = r.mean; pub.mean = true; }
    if (r.total != null) { g.sum = r.total; pub.sum = true; }
    if (r.n != null) { g.n = r.n; pub.n = true; }
    if (r.wn != null) { g.base = r.wn; pub.n = true; }
    if (Object.keys(pub).length) {
      g.pub = pub;
      g.empty = false;
      if (pub.pct || pub.positive || pub.mean) g.suppressed = false;   // 보고서가 인쇄한 값은 그대로 보인다
      matched++;
    }
  }
  agg.pubAll = live > 0 && matched >= live;
  return agg;
}

/** 지금 보여 주는 값(measure)이 모든 집단에서 공표값인가 */
export function publishedCovers(agg, measure) {
  if (!agg || !agg.groups.length) return false;
  const f = measure === "mean" || measure === "value" ? "mean" : measure === "positive" ? "positive" : "pct";
  return agg.groups.every(g => g.empty || (g.pub && g.pub[f]));
}
