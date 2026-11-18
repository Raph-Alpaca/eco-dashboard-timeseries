/**
 * published.js — 공표값 저장소(보고서에 인쇄된 수치 그대로)를 읽어 한 해 또는 두 해를 나란히 보여 줄 재료를 만든다.
 *
 * 합성 큐브와 달리 여기 값은 다시 집계하지 않는다. 보고서 표의 행(전체·기관유형·권역 …)을 그대로 쓰고,
 * 두 해를 잇는 것은 대응 색인(index.json)에서 same·wording 으로 판정된 문항의, 두 해 모두 공표된 집단뿐이다.
 */
import { loadPublishedIndex, loadPublished } from "./data.js";
import { optionDumbbell, optionGroupBars, optionCategoryBars } from "./charts.js";
import { fmt, fmtInt } from "./aggregate.js";

export const SURVEY = "status_survey";

export class PubStore {
  constructor(index) { this.index = index; this.docs = new Map(); }
  static async load() { return new PubStore(await loadPublishedIndex()); }
  get years() { return this.index.years.map(y => y.year); }
  yearMeta(year) { return this.index.years.find(y => y.year === +year); }
  pop(pop) { return this.index.pops[pop]; }
  item(pop, qid) { return this.index.pops[pop]?.items[qid]; }
  isLinked(pop, qid) { return this.index.linked.includes(this.item(pop, qid)?.status); }
  hasYear(pop, year) { return !!this.index.pops[pop]?.years.includes(+year); }
  async doc(year, pop) {
    const k = `${year}/${pop}`;
    if (!this.docs.has(k)) this.docs.set(k, this.hasYear(pop, year) ? await loadPublished(year, pop) : null);
    return this.docs.get(k);
  }
  /** 축 코드의 표시 이름(연도에 따라 부처명 등이 다를 수 있다) */
  codeLabel(axis, code, year) {
    const over = this.yearMeta(year)?.dimLabels?.[axis]?.[code];
    if (over) return over;
    const hit = (this.index.dims[axis]?.codes || []).find(c => c[0] === code);
    return hit ? hit[1] : code;
  }
  axisLabel(axis) { return this.index.dims[axis]?.label || axis; }
  codeOrder(axis) { return (this.index.dims[axis]?.codes || []).map(c => c[0]); }
}

/** 문항이 어떤 값으로 요약되는가: 'positive'(있음·해당 비율) | 'mean'(평균·합계) | 'dist'(보기별 비율) */
export function kindOf(q) {
  if (q.type === "numeric") return "mean";
  if (q.type === "binary") return "positive";
  if (q.type === "single" && q.positive && q.positive.length === 1) return "positive";
  return "dist";
}
function rowOf(q, by, key) { return (q?.rows || []).find(r => r.by === by && r.key === key) || null; }
function nOf(row) { return row ? (row.n ?? row.wn ?? null) : null; }
function scalarOf(q, row, kind) {
  if (!row) return null;
  if (kind === "positive") return row.positive ?? null;
  if (row.mean != null) return row.mean;
  return null;
}
/** 인쇄값이 합계뿐인 수치 문항(인원 수 등) */
function totalOnly(q) { return q.type === "numeric" && (q.rows || []).every(r => r.mean == null) && (q.rows || []).some(r => r.total != null); }
function distOf(q, row) {
  if (!row) return null;
  return row.pct || row.r1 || row.r123 || row.r12 || null;
}
function fmtVal(v, kind, q) {
  if (v == null) return "–";
  if (kind === "mean") return fmt(v, Math.abs(v) >= 100 ? 0 : 2);
  return `${fmt(v, 1)}%`;
}
function fmtDelta(a, b, kind) {
  if (a == null || b == null) return "–";
  const d = b - a;
  const s = d > 0 ? "+" : d < 0 ? "−" : "±";
  return kind === "mean" ? `${s}${fmt(Math.abs(d), Math.abs(d) >= 100 ? 0 : 2)}` : `${s}${fmt(Math.abs(d), 1)}%p`;
}
function srcText(store, year, q) {
  const s = (q?.source || []).map(x => `${x.ref} (PDF p.${x.pdf})`).join(", ");
  return s ? `${year}년 ${s}` : "";
}
function yearTag(store, year) { const m = store.yearMeta(year); return `${m.label}(${m.refLabel})`; }

/**
 * 카드 하나의 재료를 만든다.
 * spec = { pop, key(qid), years:[2024]|[2025]|[2024,2025], group?: "axis:code" }  (group 은 보기별 비율 문항에서 볼 집단)
 * 반환 = { title, sub, src, kind, groups, group, option, height, table, csv, status, wording, notes, empty }
 */
export async function buildPubView(store, spec) {
  const { pop, key: qid } = spec;
  const years = [...spec.years].sort();
  const trend = years.length === 2;
  const qs = {};
  for (const y of years) qs[y] = (await store.doc(y, pop))?.questions[qid] || null;
  const q = qs[years[years.length - 1]] || qs[years[0]];
  if (!q || years.some(y => !qs[y])) throw new Error("이 연도에는 조사되지 않은 문항입니다");
  const item = store.item(pop, qid) || {};
  const pdef = store.pop(pop);
  if (trend && !store.isLinked(pop, qid)) throw new Error("두 해의 문항이 같지 않아 잇지 않는 문항입니다");
  const kind = totalOnly(q) ? "total" : kindOf(q);
  const lastYear = years[years.length - 1];

  // 보여 줄 집단: 추이는 두 해 모두 공표되고 잇기로 한 집단만, 한 해 보기는 그 해에 공표된 집단 전부
  const useAll = trend ? !!item.all : !!q.hasAll;
  const axes = trend ? (item.axes || []) : (q.axes || []);
  const groups = [];
  if (useAll) groups.push({ axis: "all", code: "all", label: "전체" });
  for (const axis of axes) {
    const present = new Set(years.flatMap(y => (qs[y].rows || []).filter(r => r.by === axis).map(r => r.key)));
    const ordered = [...store.codeOrder(axis).filter(c => present.has(c)), ...[...present].filter(c => !store.codeOrder(axis).includes(c))];
    for (const code of ordered) {
      if (trend && !years.every(y => rowOf(qs[y], axis, code))) continue;
      // 부처명처럼 해마다 이름이 다른 집단은 두 이름을 함께 적는다
      const l1 = store.codeLabel(axis, code, lastYear), l0 = store.codeLabel(axis, code, years[0]);
      groups.push({ axis, code, label: trend && l0 !== l1 ? `${l1} (${years[0]}년 ${l0})` : l1, axisLabel: store.axisLabel(axis) });
    }
  }
  const popLabel = pdef.label;
  const title = q.short || q.label;
  const src = years.map(y => srcText(store, y, qs[y])).filter(Boolean).join(" · ");
  const base = { title, src: src ? `출처: 환경교육 실태조사 ${src}` : "", kind, groups, status: item.status, wording: trend ? item.wording : null,
    notes: Object.fromEntries(years.map(y => [y, qs[y].notes || ""])), years, q, qs, trend, popLabel };
  if (!groups.length) return { ...base, sub: `${popLabel} · ${years.map(y => `${y}년`).join(" → ")}`, empty: "표시할 공표 집단이 없습니다" };
  const yl = y => `${y}년`;
  const nText = g => years.map(y => { const r = rowOf(qs[y], g.axis, g.code); const n = nOf(r); return n == null ? null : `${trend ? `${y} ` : ""}${r.n == null && r.wn != null ? "가중 " : ""}n=${fmtInt(n)}`; }).filter(Boolean).join(" / ");

  if (kind === "dist") {
    // 보기별 비율: 집단 하나를 골라 보기(가로) × 연도(계열)
    const g = groups.find(x => `${x.axis}:${x.code}` === spec.group) || groups[0];
    const cats = q.categories || [];
    const per = years.map(y => ({ y, row: rowOf(qs[y], g.axis, g.code) }));
    const agg = { q, categories: cats, k: cats.length, ordered: false,
      groups: per.map(p => ({ keys: [String(p.y)], labels: [yl(p.y)], n: nOf(p.row) ?? 0, pct: (distOf(qs[p.y], p.row) || cats.map(() => null)), empty: !p.row, suppressed: false })) };
    const option = optionCategoryBars(agg, { by: ["year"] });
    const cols = ["보기", ...years.map(y => `${yl(y)} (%)`)];
    if (trend) cols.push("증감");
    const rows = cats.map((c, j) => {
      const vs = per.map(p => (distOf(qs[p.y], p.row) || [])[j] ?? null);
      return { cells: [c, ...vs.map(v => (v == null ? "–" : fmt(v, 1))), ...(trend ? [fmtDelta(vs[0], vs[1], "pct")] : [])] };
    });
    rows.push({ cells: [q.baseKind && q.baseKind !== "기관" && q.baseKind !== "가중 기관 수" ? `기준 수(${q.baseKind})` : "사례 수", ...per.map(p => { const r = p.row; const v = r ? (r.events ?? nOf(r)) : null; return v == null ? "–" : fmtInt(v); }), ...(trend ? [""] : [])], total: true });
    if (per.some(p => p.row?.mean != null)) rows.push({ cells: ["기관당 평균 건수", ...per.map(p => (p.row?.mean == null ? "–" : fmt(p.row.mean, 2))), ...(trend ? [fmtDelta(per[0].row?.mean, per[1].row?.mean, "mean")] : [])], total: true });
    const csv = [];
    cats.forEach((c, j) => per.forEach(p => csv.push([qid, g.label, p.y, c, (distOf(qs[p.y], p.row) || [])[j] ?? ""])));
    return { ...base, group: `${g.axis}:${g.code}`, option, height: Math.max(220, 26 * cats.length * years.length + 70),
      sub: `${popLabel} · ${g.label} · ${trend ? years.map(yl).join(" → ") : yl(years[0])} · 보기별 비율(%)${q.multi || q.type === "multi" ? " · 복수응답" : ""}`,
      table: { columns: cols, rows }, csv };
  }

  // 한 값으로 요약되는 문항(있음 비율·평균·합계): 집단(세로) × 연도
  const valOf = (y, g) => {
    const r = rowOf(qs[y], g.axis, g.code);
    if (!r) return null;
    return kind === "total" ? (r.total ?? null) : scalarOf(qs[y], r, kind);
  };
  const vkind = kind === "positive" ? "positive" : "mean";
  // 전수 기관(중앙·광역·교육청)의 여부형은 기관별 값이 0/100 이라 그림에는 '전체'만 싣고 기관별은 표에 싣는다
  const chartGroups = (pdef.census && kind === "positive" && groups.some(g => g.axis === "all")) ? groups.filter(g => g.axis === "all") : groups;
  let option, height;
  if (trend) {
    option = optionDumbbell(chartGroups.map(g => ({ label: g.label, a: valOf(years[0], g), b: valOf(years[1], g) })),
      { aName: yl(years[0]), bName: yl(years[1]), measure: kind === "positive" ? "positive" : "mean", ordered: false });
    height = Math.max(150, 34 * chartGroups.length + 80);
  } else {
    const agg = { q, ordered: false, categories: [], groups: chartGroups.map(g => ({ keys: [g.code], labels: [g.label], n: nOf(rowOf(q, g.axis, g.code)) ?? 0, positive: valOf(years[0], g), mean: valOf(years[0], g), pct: [] })) };
    option = optionGroupBars(agg, { by: ["group"], measure: kind === "positive" ? "positive" : "mean" });
    height = 260;
  }
  const unit = kind === "positive" ? "비율(%)" : kind === "total" ? `합계${q.unit ? ` (${q.unit})` : ""}` : `평균${q.unit ? ` (${q.unit})` : ""}`;
  const cols = ["구분", ...years.map(yl)];
  if (trend) cols.push("증감");
  cols.push(...years.map(y => `${trend ? `${y} ` : ""}사례 수`));
  const cell = (y, g) => {
    const v = valOf(y, g); const r = rowOf(qs[y], g.axis, g.code);
    if (v == null) return "–";
    if (kind === "positive" && pdef.census && g.axis !== "all" && nOf(r) === 1) return v >= 50 ? "○" : "×";
    let s = kind === "total" ? fmtInt(v) : fmtVal(v, vkind, q);
    if (kind === "positive" && r?.counts && r.counts.length === 2 && nOf(r) != null && nOf(r) <= 30) s += ` (${fmtInt(r.counts[1])}/${fmtInt(nOf(r))})`;
    return s;
  };
  const rows = groups.map(g => ({ cells: [g.label, ...years.map(y => cell(y, g)),
    ...(trend ? [(pdef.census && kind === "positive" && g.axis !== "all") ? "" : fmtDelta(valOf(years[0], g), valOf(years[1], g), vkind === "positive" ? "pct" : "mean")] : []),
    ...years.map(y => { const n = nOf(rowOf(qs[y], g.axis, g.code)); return n == null ? "–" : fmtInt(n); })] }));
  const csv = [];
  for (const g of groups) for (const y of years) csv.push([qid, g.label, y, unit, valOf(y, g) ?? "", nOf(rowOf(qs[y], g.axis, g.code)) ?? ""]);
  const first = groups[0];
  return { ...base, option, height, table: { columns: cols, rows }, csv,
    sub: `${popLabel} · ${trend ? years.map(yl).join(" → ") : yl(years[0])} · ${unit}${q.base ? " · 조건부 문항" : ""}${first ? ` · ${first.label} ${nText(first)}` : ""}` };
}

/** 보고서 탭이 쓰는 렌더러: cfg = { mode:"pub", pop, key, years, group } */
export async function reportRenderer(store, cfg) {
  const v = await buildPubView(store, cfg);
  if (v.empty) throw new Error(v.empty);
  const tags = cfg.years.map(y => yearTag(store, y)).join(" → ");
  return { title: `${v.title}${cfg.years.length === 2 ? " — 2024→2025" : ` — ${cfg.years[0]}년`}`, sub: `${v.sub} · ${tags} · 보고서 공표값`, src: v.src,
    option: v.option, height: v.height, table: v.table, csv: v.csv.map(r => [r[0], "", r[1], r[5] ?? "", `${r[2]}년 ${r[3]}`, r[4]]) };
}
