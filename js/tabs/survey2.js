/**
 * 환경교육 실태조사 탭 — 전체 개요 + 9종 기관유형.
 * 기관유형 화면은 세 가지 보기: 추이(2024→2025, 보고서 공표값) / 2025년(합성 큐브, 필터·패널) / 2024년(보고서 공표값).
 * 주소: #status/overview, #status/<pop>/<trend|2025|2024>
 */
import { chartOn, optionIndicatorHeatmap } from "../charts.js";
import { fmt, fmtInt } from "../aggregate.js";
import { createPanel, esc } from "../panel.js";
import { viewState } from "../state.js";
import { PubStore, kindOf, reportRenderer } from "../published.js";
import { createPubCard } from "../pubcard.js";

const SURVEY = "status_survey";
const MODES = [["trend", "추이 2024→2025"], ["2025", "2025년"], ["2024", "2024년"]];
let storeP = null;
let cards = [];

function getStore(app) {
  if (!storeP) {
    storeP = PubStore.load().then(store => {
      app.reportRenderers = { ...(app.reportRenderers || {}), pub: (a, cfg) => reportRenderer(store, cfg) };
      return store;
    }).catch(err => { storeP = null; throw err; });
  }
  return storeP;
}
/** 보고서 탭이 실태조사 탭을 거치지 않고 열려도 공표값 항목을 그릴 수 있게 한다 */
export function ensurePublished(app) { return getStore(app); }

export async function render({ main, sub, app, params }) {
  await app.ensureSurvey(SURVEY);
  const cb = app.codebooks[SURVEY];
  const store = await getStore(app);
  const pops = Object.keys(cb.populations);
  const view = params[0] && (params[0] === "overview" || pops.includes(params[0])) ? params[0] : "overview";
  let mode = MODES.some(m => m[0] === params[1]) ? params[1] : viewState.get("status:mode", "trend");
  if (view !== "overview" && !store.hasYear(view, 2024) && mode !== "2025") mode = "2025";
  if (params[1] && MODES.some(m => m[0] === params[1])) viewState.set("status:mode", params[1]);
  sub.innerHTML = `<div class="wrap"><div class="subtabs">
      <button type="button" data-id="overview" class="${view === "overview" ? "active" : ""}">전체 개요</button>
      ${cb.areas.map(a => `<span class="area-label">${a.label}</span>${a.pops.map(p => `<button type="button" data-id="${p}" class="${view === p ? "active" : ""}">${cb.populations[p].label}</button>`).join("")}`).join("")}
    </div>
    ${view === "overview" ? "" : `<div class="seg" role="tablist" aria-label="보기">${MODES.map(([id, label]) => `<button type="button" role="tab" data-mode="${id}" class="${mode === id ? "active" : ""}" ${id !== "2025" && !store.hasYear(view, 2024) ? "disabled" : ""}>${label}</button>`).join("")}</div>`}
    <div class="fhost"></div></div>`;
  sub.querySelectorAll(".subtabs button").forEach(b => (b.onclick = () => (location.hash = b.dataset.id === "overview" ? "#status/overview" : `#status/${b.dataset.id}/${mode}`)));
  sub.querySelectorAll(".seg button").forEach(b => (b.onclick = () => { viewState.set("status:mode", b.dataset.mode); location.hash = `#status/${view}/${b.dataset.mode}`; }));
  for (const c of cards) c.destroy();
  cards = [];
  if (view === "overview") return renderOverview({ main, app, cb, store });
  if (mode === "trend") return renderTrend({ main, cb, store, pop: view });
  if (mode === "2024") return renderYear({ main, cb, store, pop: view, year: 2024 });
  return renderPop({ main, sub, app, cb, pop: view, area: cb.areas.find(a => a.pops.includes(view)) });
}
export function destroy() { for (const c of cards) c.destroy(); cards = []; }

/* ───────────── 전체 개요 ───────────── */
function partRows(cb, store) {
  const metas = store.index.years;
  const rows = [];
  for (const pid of Object.keys(cb.populations)) {
    const area = cb.areas.find(a => a.pops.includes(pid)).label;
    const ps = metas.map(m => m.participation?.[pid] || null);
    const details = ps.map(p => p?.detail || null);
    const sameDetail = details.every(d => d) && details.every(d => d.map(x => x.label).join("|") === details[0].map(x => x.label).join("|"));
    if (sameDetail) details[0].forEach((d, i) => rows.push({ area, label: `${cb.populations[pid].label} · ${d.label}`, vals: details.map(dd => dd[i]) }));
    else rows.push({ area, label: cb.populations[pid].label, vals: ps, derived: ps.map(p => !!p?.derived) });
  }
  return rows;
}

async function renderOverview({ main, app, cb, store }) {
  const pops = Object.keys(cb.populations);
  const years = store.years;
  const docs = {};
  for (const y of years) { docs[y] = {}; for (const p of pops) docs[y][p] = await store.doc(y, p); }
  const metas = store.index.years;
  const rows = partRows(cb, store);
  const cell = v => (v ? `<td>${fmtInt(v.population)}</td><td>${fmtInt(v.responded)}</td><td>${fmt(v.rate, 1)}%</td>` : `<td>–</td><td>–</td><td>–</td>`);
  main.innerHTML = `
    <div class="page-head"><h2>${esc(cb.shortTitle)} — 전체 개요</h2><span class="desc">9종 기관의 조사 참여 현황과 공통 지표 · ${metas.map(m => `${m.label}(${m.refLabel})`).join(" → ")}</span></div>
    <p class="notice">두 해 값은 모두 보고서에 인쇄된 공표값입니다. 조사 연도와 기준 시점이 한 해씩 다릅니다(${metas.map(m => `${m.year}년 조사 = ${m.refLabel}`).join(", ")}). 유아·초중등교육기관은 2024년 보고서가 가중치 없이, 2025년 보고서가 가중 추정으로 발표되어 '전체' 값은 잇지 않고 학교급·기관구분별로만 비교합니다.</p>
    <div class="grid">
      <section class="panel span-12 compact"><header><div class="ttl"><h3>조사 참여 현황</h3><div class="sub">모집단 · 응답 기관 수 · 응답률(목표 표본 대비)</div></div></header>
        <div class="table-wrap" style="max-height:none"><table class="data"><thead>
          <tr><th rowspan="2">영역</th><th rowspan="2">기관</th>${metas.map(m => `<th colspan="3" style="text-align:center">${m.label}</th>`).join("")}</tr>
          <tr>${metas.map(() => `<th>모집단</th><th>응답</th><th>응답률</th>`).join("")}</tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.area)}</td><td>${esc(r.label)}</td>${r.vals.map(cell).join("")}</tr>`).join("")}</tbody></table></div>
        <footer><span class="src">출처: ${metas.map(m => `${m.year}년 ${m.participationSource}`).join(" · ")} · 유아·초중등·고등의 2024년 합계 행은 세부 행을 더한 값</span></footer></section>
      <section class="panel span-12"><header><div class="ttl"><h3>공통 지표 × 기관유형</h3><div class="sub hm-sub"></div></div>
          <div class="acts"><div class="seg hm-seg">${[...years.map(y => [String(y), `${y}년`]), ["delta", "증감"]].map(([id, label]) => `<button type="button" data-v="${id}">${label}</button>`).join("")}</div></div></header>
        <div class="body"><div class="chart hm" style="height:520px"></div></div>
        <footer><span class="src">각 기관유형에서 해당 지표의 대표 문항(코드북 지정) · 정확한 문항은 각 기관 화면의 출처 참고</span><span class="badges"><span class="badge pubval">보고서 공표값</span></span></footer></section>
    </div>
    <div class="section-head"><h3>지역 비교 (2025년)</h3><div class="rule"></div><span class="n">17개 시도 타일맵 — 지표를 골라 보세요 · 합성 데이터</span></div>
    <div class="grid region"></div>`;

  // 히트맵: 지표별 대표 문항의 '전체' 행 공표값
  const inds = cb.indicators;
  const xs = pops.map(p => cb.populations[p].label);
  const ys = inds.map(i => i.label);
  const pick = (doc, ind) => { if (!doc) return null; for (const qid of doc.order) { const q = doc.questions[qid]; if (q.indicator === ind) return q; } return null; };
  const valOf = q => {
    if (!q) return null;
    const r = (q.rows || []).find(x => x.by === "all");
    if (!r) return null;
    const n = r.n ?? r.wn ?? null;
    const k = kindOf(q);
    if (k === "positive") { const cnt = r.counts && r.counts.length === 2 ? r.counts[1] : (n != null && r.positive != null ? Math.round(r.positive * n / 100) : null); return { v: r.positive, n, cnt, q }; }
    if (k === "dist" && q.type === "multi" && r.pct) return { v: null, n, q, text: `가장 높은 보기 ${fmt(Math.max(...r.pct.filter(x => x != null)), 1)}%` };
    return { v: null, n, q, text: r.mean != null ? `평균 ${fmt(r.mean, 2)}` : r.total != null ? `합계 ${fmtInt(r.total)}` : "여부형이 아닌 문항" };
  };
  const small = (pid, x) => !!cb.populations[pid].census || (x.n != null && x.n <= 17);
  const drawHeat = which => {
    viewState.set("status:heat", which);
    main.querySelectorAll(".hm-seg button").forEach(b => b.classList.toggle("active", b.dataset.v === which));
    const cells = [];
    pops.forEach((pid, x) => inds.forEach((ind, y) => {
      if (which === "delta") {
        const q25 = pick(docs[2025]?.[pid], ind.id);
        if (!q25) return;
        const it = store.item(pid, q25.qid);
        const a = valOf(docs[2024]?.[pid]?.questions[q25.qid]), b = valOf(q25);
        if (!a) return cells.push({ x, y, blank: true, short: "", text: `${esc(q25.short)}: 2024년에는 조사되지 않음` });
        if (!store.isLinked(pid, q25.qid)) return cells.push({ x, y, blank: true, short: "×", text: `${esc(q25.short)}: 잇지 않음 — ${esc(store.index.statusLabels[it.status])}${it.reason ? ` (${esc(it.reason)})` : ""}` });
        if (!it.all) return cells.push({ x, y, blank: true, short: "집단별", text: `${esc(q25.short)}: '전체' 값은 잇지 않고 집단별로만 비교합니다(기관 화면의 추이 참고)` });
        if (a.v == null || b.v == null) return cells.push({ x, y, blank: true, short: "", text: `${esc(q25.short)}: ${a.text || ""} → ${b.text || ""}` });
        const d = b.v - a.v;
        const sm = small(pid, b);
        cells.push({ x, y, value: Math.max(-30, Math.min(30, d)), short: sm ? (a.n === b.n ? `${a.cnt}→${b.cnt}` : `${a.cnt}/${a.n}→${b.cnt}/${b.n}`) : `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmt(Math.abs(d), 1)}`,
          text: `${esc(q25.short)}: ${fmt(a.v, 1)}% → ${fmt(b.v, 1)}% (${d >= 0 ? "+" : "−"}${fmt(Math.abs(d), 1)}%p)${sm ? ` · ${a.cnt}/${a.n} → ${b.cnt}/${b.n}` : ` · n ${fmtInt(a.n)} → ${fmtInt(b.n)}`}` });
      } else {
        const r = valOf(pick(docs[which]?.[pid], ind.id));
        if (!r) return;
        if (r.v == null) return cells.push({ x, y, blank: true, short: "", text: `${esc(r.q.short)}: ${r.text}${r.n != null ? ` (n=${fmtInt(r.n)})` : ""}` });
        const sm = small(pid, r);
        cells.push({ x, y, value: r.v, short: sm && r.cnt != null ? `${r.cnt}/${r.n}` : `${fmt(r.v, 1)}%`, text: `${esc(r.q.short)}: ${fmt(r.v, 1)}%${sm && r.cnt != null ? ` (${r.cnt}/${r.n})` : r.n != null ? ` (n=${fmtInt(r.n)})` : ""}` });
      }
    }));
    main.querySelector(".hm-sub").textContent = which === "delta"
      ? "2024→2025 증감(%p). 문항이 같은 지표만 표시 · ×는 문항이 달라 잇지 않은 지표 · 기관 수가 17 이하면 '갖춘 기관 수'의 변화"
      : `${which}년 — 각 기관유형에서 해당 요건을 갖춘 비율. 기관 수가 17 이하인 유형은 '갖춘 기관 수/전체' · 빈 칸은 여부형이 아니거나 조사하지 않은 지표`;
    chartOn(main.querySelector(".hm"), optionIndicatorHeatmap(xs, ys, cells, which === "delta"
      ? { min: -30, max: 30, colors: ["#b5532a", "#f0c8b4", "#f4f6f5", "#b0d6ce", "#1f6c60"], text: ["+30%p 이상", "−30%p 이하"] } : {}));
  };
  main.querySelectorAll(".hm-seg button").forEach(b => (b.onclick = () => drawHeat(b.dataset.v)));
  const saved = viewState.get("status:heat", "2025");
  drawHeat(["2024", "2025", "delta"].includes(saved) && (saved === "2025" || docs[2024]) ? saved : "2025");

  // 지역 비교 패널(시도 축을 가진 모집단의 yes/no·수치 문항) — 2025 합성 큐브
  await app.ensureCubes(SURVEY, pops);
  const regionPops = pops.filter(p => app.cubes[p].hasAxis("sido"));
  const choices = [];
  for (const p of regionPops) for (const q of cb.questions.filter(q => q.pop === p && ["binary", "numeric"].includes(q.type) && !q.base)) choices.push({ pop: p, key: q.cubeKeys[0], label: `${cb.populations[p].label} · ${q.short}` });
  const host = main.querySelector(".region");
  if (!host) return;
  const sel = document.createElement("div");
  sel.className = "span-12";
  sel.innerHTML = `<label class="field"><span>지표 선택</span><select class="pick">${choices.map((c, i) => `<option value="${i}" ${c.key === "SCH_PLAN_YN" ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>`;
  host.appendChild(sel);
  let pair = [];
  const draw = () => {
    for (const p of pair) { p.destroy(); const i = app.activePanels.indexOf(p); if (i >= 0) app.activePanels.splice(i, 1); }
    const c = choices[+sel.querySelector(".pick").value];
    const q = cb.questions.find(x => x.cubeKeys[0] === c.key);
    const measure = q.type === "numeric" ? "mean" : "positive";
    pair = [["tile", "시도별"], ["bar", "시도별 막대"]].map(([chart, suffix]) => {
      const p = createPanel({ survey: SURVEY, pop: c.pop, key: c.key, by: ["sido"], chart, measure, span: 6, title: `${c.label} — ${suffix}` }, app.ctx(SURVEY, { allowRemove: false }));
      host.appendChild(p.el); app.activePanels.push(p); p.update();
      return p;
    });
  };
  sel.querySelector(".pick").onchange = draw;
  draw();
}

/* ───────────── 추이(2024→2025) ───────────── */
function sectionOrder(docA, docB) {
  const out = [];
  for (const d of [docB, docA]) if (d) for (const qid of d.order) { const s = d.questions[qid].section; if (!out.includes(s)) out.push(s); }
  return out;
}
function headHTML(store, pdef, pop, title, years) {
  const parts = years.map(y => { const p = store.yearMeta(y).participation?.[pop]; return p ? `${y}년 응답 ${fmtInt(p.responded)}곳` : null; }).filter(Boolean);
  return `<div class="page-head"><h2>${esc(pdef.label)} — ${title}</h2><span class="desc">${parts.join(" · ")}</span></div>`;
}

async function renderTrend({ main, cb, store, pop }) {
  const pinfo = store.pop(pop);
  const [d24, d25] = [await store.doc(2024, pop), await store.doc(2025, pop)];
  const items = pinfo.items;
  const linked = Object.keys(items).filter(q => store.isLinked(pop, q));
  const unlinked = Object.keys(items).filter(q => !store.isLinked(pop, q));
  const nWording = linked.filter(q => items[q].status === "wording").length;
  const metas = store.index.years;
  main.innerHTML = `${headHTML(store, pinfo, pop, "2024 → 2025 추이", [2024, 2025])}
    <p class="notice">두 해의 문항이 같은 것만 이었습니다. 값은 두 보고서에 인쇄된 공표값 그대로이며, ${metas.map(m => `${m.year}년 조사는 ${m.refLabel}`).join(", ")}입니다.
      응답 기관이 두 해에 완전히 같지는 않으므로 사례 수를 함께 보세요.${pinfo.note ? ` <b>${esc(pinfo.note)}</b>` : ""}</p>
    <div class="trend-sum"><span class="chip on">이은 문항 ${linked.length}개</span>${nWording ? `<span class="chip">그중 문구만 다른 문항 ${nWording}개(카드에 두 해 문구 표시)</span>` : ""}<span class="chip">잇지 않은 문항 ${unlinked.length}개 — 아래 표에 이유</span></div>
    <div class="trend-body"></div>
    <div class="section-head"><h3>잇지 않은 문항과 이유</h3><div class="rule"></div><span class="n">각 연도 보기에서 그 해의 값을 볼 수 있습니다</span></div>
    <div class="table-wrap unlinked" style="max-height:none"></div>`;
  const body = main.querySelector(".trend-body");
  if (!linked.length) body.innerHTML = `<p class="loading">이을 수 있는 문항이 없습니다.</p>`;
  for (const s of sectionOrder(d24, d25)) {
    const qs = linked.filter(q => items[q].section === s);
    if (!qs.length) continue;
    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = `<h3>${esc(s)}</h3><div class="rule"></div><span class="n">${qs.length}개 문항</span>`;
    body.appendChild(head);
    const g = document.createElement("div");
    g.className = "grid";
    body.appendChild(g);
    for (const qid of qs) { const c = createPubCard(store, { pop, key: qid, years: [2024, 2025] }); g.appendChild(c.el); cards.push(c); }
  }
  const sl = store.index.statusLabels;
  main.querySelector(".unlinked").innerHTML = unlinked.length ? `<table class="data"><thead><tr><th>영역</th><th>문항</th><th>구분</th><th>이유</th><th>조사 연도</th></tr></thead><tbody>
    ${unlinked.map(q => { const it = items[q]; return `<tr><td>${esc(it.section)}</td><td>${esc(it.short)}</td><td>${esc(sl[it.status] || it.status)}</td><td style="white-space:normal">${esc(it.reason || "")}</td><td>${it.years.join(", ")}</td></tr>`; }).join("")}</tbody></table>` : `<p class="loading">모든 문항을 이었습니다.</p>`;
}

/* ───────────── 한 해 보기(공표값) ───────────── */
async function renderYear({ main, cb, store, pop, year }) {
  const pinfo = store.pop(pop);
  const doc = await store.doc(year, pop);
  const m = store.yearMeta(year);
  main.innerHTML = `${headHTML(store, pinfo, pop, `${year}년 조사 결과`, [year])}
    <p class="notice">${esc(m.sourceDoc)}에 인쇄된 표를 그대로 옮긴 값입니다(${esc(m.refLabel)}). ${esc(m.weighting || "")} 필터·교차분석은 2025년 보기에서만 됩니다.</p>
    <div class="year-body"></div>`;
  const body = main.querySelector(".year-body");
  if (!doc) { body.innerHTML = `<p class="loading">${year}년 자료가 없습니다.</p>`; return; }
  const sections = [];
  for (const qid of doc.order) { const s = doc.questions[qid].section; if (!sections.includes(s)) sections.push(s); }
  for (const s of sections) {
    const qs = doc.order.filter(q => doc.questions[q].section === s);
    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = `<h3>${esc(s)}</h3><div class="rule"></div><span class="n">${qs.length}개 문항</span>`;
    body.appendChild(head);
    const g = document.createElement("div");
    g.className = "grid";
    body.appendChild(g);
    for (const qid of qs) { const c = createPubCard(store, { pop, key: qid, years: [year] }); g.appendChild(c.el); cards.push(c); }
  }
}

/* ───────────── 2025년(합성 큐브: 필터·패널) ───────────── */
async function renderPop({ main, sub, app, cb, pop, area }) {
  await app.ensureCube(SURVEY, pop);
  const pdef = cb.populations[pop];
  const fhost = sub.querySelector(".fhost");
  app.renderFilterBar(fhost, SURVEY, pop, () => app.refreshPanels());
  const tabId = `status/${pop}`;
  const pt = pdef.participation || {};
  main.innerHTML = `
    <div class="page-head"><h2>${esc(pdef.label)} — 2025년 조사 결과</h2><span class="desc">${esc(area?.label || "")} · 응답 ${fmtInt(pt.responded ?? pdef.n)}곳${pt.population && pt.population !== pt.responded ? ` / 모집단 ${fmtInt(pt.population)}` : ""}${pdef.weighted ? " · 가중 추정" : ""}</span>
      <div class="right"><button class="btn small b-add">＋ 패널 추가</button><button class="btn small ghost b-reset">기본 구성으로</button></div></div>
    <p class="notice">${esc(pdef.ui?.note || "")}</p>
    <div class="section-head"><h3>핵심 패널</h3><div class="rule"></div><span class="n">⚙로 바꿀 수 있습니다</span></div>
    <div class="panels"></div>
    <div class="section-head"><h3>전체 문항</h3><div class="rule"></div><span class="n">보고서의 모든 수치 표 · 표가 먼저 보이고, 차트 버튼으로 전환</span></div>
    <div class="auto"></div>`;
  const grid = await app.mountPanels(main.querySelector(".panels"), tabId, SURVEY);
  main.querySelector(".b-reset").onclick = () => { grid.reset(); location.reload(); };
  main.querySelector(".b-add").onclick = async () => {
    const first = cb.questions.find(q => q.pop === pop);
    const p = await grid.add({ survey: SURVEY, pop, key: first.cubeKeys[0], by: [pdef.ui?.defaultBy].filter(Boolean), chart: "auto" });
    p.openConfig();
  };
  // 자동 패널: 섹션별, 표 우선
  const auto = main.querySelector(".auto");
  const qs = cb.questions.filter(q => q.pop === pop);
  const sections = [...new Set(qs.map(q => q.section))];
  const ctx = app.ctx(SURVEY, { allowRemove: false, tableFirst: true });
  const defaultBy = pdef.census ? [pdef.unitDim] : [pdef.ui?.defaultBy].filter(Boolean);
  for (const s of sections) {
    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = `<h3 style="font-size:.92rem;color:var(--ink-2)">${esc(s)}</h3><div class="rule"></div>`;
    auto.appendChild(head);
    const g = document.createElement("div");
    g.className = "grid";
    auto.appendChild(g);
    for (const q of qs.filter(x => x.section === s)) {
      const key = q.type.startsWith("item_") ? q.qid : q.cubeKeys[0];
      const p = createPanel({ survey: SURVEY, pop, key, by: pdef.census && q.type !== "multi" && q.type !== "events" ? defaultBy : (q.type === "multi" || q.type === "events" || q.type === "rank" || q.type === "single" ? [] : defaultBy), chart: "auto", span: 6 }, ctx);
      g.appendChild(p.el);
      app.activePanels.push(p);
      p.update();
    }
  }
}
