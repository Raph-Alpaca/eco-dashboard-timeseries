/**
 * 보고서 탭 — 담은 패널을 A4 시트로 모아 PDF 저장(브라우저 인쇄)·CSV 내보내기.
 *
 * 담긴 항목은 { id, cfg, memo } 뿐이고, 제목·사례 수·출처·그림·표는 여기서 cfg(고정된 필터 포함)로 다시 계산한다.
 * 그래서 캡션의 사례 수와 그림이 항상 같은 조건을 가리킨다.
 * 인쇄용 그림은 화면 폭과 무관하게 고정 폭으로 따로 그린 PNG 를 쓴다(휴대폰에서 만들어도 같은 PDF).
 */
import { reportState, onReportChange, panelId, toast, storageWorks } from "../state.js";
import { chartOn, disposeChart, renderToImage, downloadCSV } from "../charts.js";
import { esc, ICONS, computePanel, captionOf, optionOfPanel, chartHeightOf, tableOfPanel } from "../panel.js";

const PRINT_W = 720;          // 인쇄용 그림 폭(px) — A4 본문 폭(182mm)에 맞춰 축소된다
const MAX_ROWS = 40;          // 시트에 넣는 표의 최대 행 수(전체는 CSV)
const SAMPLE = [
  { survey: "school_survey", pop: "student", key: "S01", by: ["level"], chart: "auto" },
  { survey: "status_survey", pop: "inst_school", key: "SCH_PLAN_YN", by: ["level"], measure: "positive", chart: "auto" },
  { survey: "status_survey", pop: "inst_local", key: "LOC_ORD_YN", by: ["metro"], chart: "auto" },
];

let unsub = null;
let liveCharts = [];

/** 항목 하나를 그릴 재료로 바꾼다. 다른 화면(추이 등)의 항목은 app.reportRenderers[cfg.mode] 가 처리한다. */
async function resolveItem(app, it) {
  const cfg = it.cfg;
  const custom = cfg.mode && app.reportRenderers?.[cfg.mode];
  if (custom) return custom(app, cfg);
  await app.ensureCubes(cfg.survey, [cfg.pop]);
  const cube = app.cubes[cfg.pop];
  const cb = app.codebooks[cfg.survey];
  if (!cube || !cb) throw new Error("데이터를 찾지 못했습니다");
  const sup = app.config.suppression || {};
  const res = computePanel(cfg, cube, cb, { filters: {}, suppression: { minN: sup.person?.minN ?? 30, unstableN: sup.weighted?.unstableN ?? 10 } });
  const groups = res && (res.battery ? res.aggs[0]?.groups : res.agg.groups);
  if (!res || !groups || !groups.length) throw new Error("표시할 데이터가 없습니다");
  return { ...captionOf(cfg, cube, cb, res), option: optionOfPanel(cfg, res), height: chartHeightOf(cfg, res), table: tableOfPanel(cfg, cb, res), csv: csvRows(cfg, cube, cb, res) };
}

/** 전체 CSV 용 긴 형식 행: [큐브 키, 항목, 집단, n, 지표, 값] */
function csvRows(cfg, cube, cb, res) {
  const out = [];
  const num = (v, d) => (v == null || Number.isNaN(v) ? "" : Number(v).toFixed(d));
  for (const agg of res.battery ? res.aggs : [res.agg]) {
    for (const g of agg.groups) {
      const base = [agg.key, agg.item?.label || "", g.labels.join(" | ") || "전체", g.n];
      const hide = g.suppressed || g.empty;
      agg.categories.forEach((c, j) => out.push([...base, c, hide ? "" : num(g.pct[j], 2)]));
      if (g.mean != null) out.push([...base, "평균", hide ? "" : num(g.mean, 3)]);
      if (g.positive != null) out.push([...base, "긍정/해당 비율", hide ? "" : num(g.positive, 2)]);
    }
  }
  return out;
}

export async function render({ main, sub, app, params, alive = () => true }) {
  sub.innerHTML = `<div class="wrap"><div class="subtabs"><span class="report-hint">각 조사 화면에서 패널의 ＋ 버튼으로 담은 항목이 여기에 모입니다. 순서를 바꾸고 메모를 적은 뒤 'PDF로 저장'을 누르세요.</span></div></div>`;
  main.innerHTML = `
    <div class="page-head"><h2>보고서 만들기</h2><span class="desc">담은 패널 → 메모 → A4 인쇄(PDF 저장)</span>
      <div class="right"><button class="btn b-csv">전체 CSV</button><button class="btn primary b-print">PDF로 저장(인쇄)</button></div></div>
    <div class="report-layout">
      <aside class="report-side">
        <label class="field"><span>제목</span><input type="text" name="title"></label>
        <label class="field"><span>부제</span><input type="text" name="subtitle" placeholder="예: 2025년 조사 결과 중 학교급별 비교"></label>
        <div class="field"><div class="row"><label class="field"><span>작성자</span><input type="text" name="author"></label><label class="field"><span>기준일</span><input type="text" name="date"></label></div></div>
        <div class="field"><span>담은 항목 <span class="cnt"></span></span><div class="report-items"></div></div>
        <button class="btn ghost small b-clear">모두 비우기</button>
        <p class="report-note">'PDF로 저장'을 누르면 인쇄 창이 열립니다. 대상(프린터)을 <b>PDF로 저장</b>으로 고르세요. 창이 열리지 않으면 Chrome·Edge에서 이 주소를 열어 주세요(메신저 안의 브라우저는 인쇄를 지원하지 않는 경우가 있습니다).</p>
        ${storageWorks() ? "" : `<p class="report-note warn">이 브라우저는 저장이 막혀 있어, 창을 닫으면 담은 목록과 메모가 사라집니다.</p>`}
      </aside>
      <div class="report-print-root"><div class="sheet"></div></div>
    </div>`;

  const $ = s => main.querySelector(s);
  const sheet = $(".sheet");
  const list = $(".report-items");
  const meta = reportState.meta();

  const coverHTML = m => `<h1>${esc(m.title || "환경교육 조사 결과 요약")}</h1>${m.subtitle ? `<div class="by">${esc(m.subtitle)}</div>` : ""}<div class="by">${[m.author, m.date, app.config.dataLabel].filter(Boolean).map(esc).join(" · ")}</div>`;
  for (const k of ["title", "subtitle", "author", "date"]) {
    const inp = $(`[name=${k}]`);
    inp.value = meta[k] || "";
    // 표지 글자만 바꾼다(그림을 다시 그리지 않는다)
    inp.oninput = () => { meta[k] = inp.value; reportState.setMeta(meta); const c = sheet.querySelector(".cover"); if (c) c.innerHTML = coverHTML(meta); };
  }
  $(".b-clear").onclick = () => { if (confirm("담은 항목을 모두 비울까요?")) reportState.clear(); };
  $(".b-csv").onclick = () => exportAll();
  $(".b-print").onclick = () => {
    if (!reportState.items().length) return toast("담은 항목이 없습니다");
    if (typeof window.print !== "function") return toast("이 브라우저는 인쇄를 지원하지 않습니다. Chrome·Edge에서 열어 주세요", 5000);
    sheet.querySelectorAll(".memo-in").forEach(t => t.dispatchEvent(new Event("input")));   // 메모 최신값 반영
    window.print();
  };

  const drawList = titles => {
    const items = reportState.items();
    $(".cnt").textContent = `(${items.length})`;
    list.innerHTML = items.map((it, i) => `<div class="report-item" data-id="${esc(it.id)}"><span class="t" title="${esc(titles?.[it.id] || "")}">${i + 1}. ${esc(titles?.[it.id] || "…")}</span>
      <button class="icon-btn" data-a="up" title="위로" aria-label="위로">${ICONS.up}</button><button class="icon-btn" data-a="down" title="아래로" aria-label="아래로">${ICONS.downArrow}</button><button class="icon-btn" data-a="rm" title="빼기" aria-label="빼기">${ICONS.close}</button></div>`).join("");
    list.querySelectorAll("button").forEach(b => (b.onclick = () => {
      const id = b.closest(".report-item").dataset.id;
      if (b.dataset.a === "up") reportState.move(id, -1);
      if (b.dataset.a === "down") reportState.move(id, 1);
      if (b.dataset.a === "rm") reportState.remove(id);
    }));
  };

  let drawGen = 0;
  let resolved = [];   // [{it, r}] — CSV 내보내기에 재사용
  const drawSheet = async () => {
    const gen = ++drawGen;
    const items = reportState.items();
    for (const el of liveCharts) disposeChart(el);
    liveCharts = [];
    if (!items.length) {
      resolved = [];
      drawList({});
      sheet.innerHTML = `<div class="report-empty"><p><b>아직 담은 항목이 없습니다.</b></p>
        <ol><li>위 메뉴의 <b>학교환경교육 현황조사</b>나 <b>환경교육 실태조사</b>로 갑니다.</li>
        <li>넣고 싶은 그래프(패널) 오른쪽 위의 <b>＋</b> 버튼을 누릅니다. 필터를 건 상태로 담으면 그 조건 그대로 담깁니다.</li>
        <li>이 화면으로 돌아와 순서·메모를 정리하고 <b>PDF로 저장</b>을 누릅니다.</li></ol>
        <button class="btn b-sample">예시 항목 3개 담아 보기</button></div>`;
      sheet.querySelector(".b-sample").onclick = addSample;
      return;
    }
    sheet.innerHTML = `<p class="loading">보고서를 그리는 중…</p>`;
    const out = [];
    for (const it of items) {
      try { out.push({ it, r: await resolveItem(app, it) }); }
      catch (err) { console.error(err); out.push({ it, err }); }
      if (gen !== drawGen || !alive()) return;   // 그리는 사이에 목록이 바뀌었거나 탭을 떠남
    }
    resolved = out;
    drawList(Object.fromEntries(out.map(o => [o.it.id, o.r?.title || "표시할 수 없는 항목"])));
    const m = reportState.meta();
    sheet.innerHTML = `<div class="cover">${coverHTML(m)}</div>
      ${out.map((o, i) => o.err
        ? `<div class="fig bad no-print" data-id="${esc(o.it.id)}"><h3>${i + 1}. 표시할 수 없는 항목</h3><div class="cap">${esc(o.err.message || String(o.err))} — 왼쪽 목록에서 ✕로 빼 주세요. (인쇄에는 포함되지 않습니다)</div></div>`
        : `<div class="fig" data-id="${esc(o.it.id)}"><h3>${i + 1}. ${esc(o.r.title)}</h3><div class="cap">${esc(o.r.sub)}</div>
          <div class="chart screen-only" role="img" aria-label="${esc(o.r.title)} 차트" style="height:${o.r.height}px"></div><img class="chart-img print-only" alt="${esc(o.r.title)} 차트">
          <div class="tbl"></div>
          <textarea class="memo-in screen-only" placeholder="이 그림에 대한 메모(보고서에 함께 인쇄됩니다)" rows="2">${esc(o.it.memo || "")}</textarea>
          <div class="memo print-only"${o.it.memo ? "" : " hidden"}>${esc(o.it.memo || "")}</div>
          <div class="cap src">${esc(o.r.src)}</div></div>`).join("")}
      <div class="foot">${esc(app.config.dataLabel || "")}${app.config.synthetic ? " · 본 자료의 수치는 보고서 공표값에 맞춘 합성 데이터이며 실제 응답 자료가 아닙니다." : ""} 생성: 환경교육 조사 결과 대시보드</div>`;
    for (const o of out) {
      if (o.err) continue;
      const fig = sheet.querySelector(`.fig[data-id="${CSS.escape(o.it.id)}"]`);
      const option = { ...o.r.option, animation: false };
      const chartEl = fig.querySelector(".chart");
      chartOn(chartEl, option);
      liveCharts.push(chartEl);
      try { fig.querySelector(".chart-img").src = renderToImage(option, { width: PRINT_W, height: o.r.height }); }
      catch (err) { console.error(err); }
      const t = o.r.table;
      const rows = t.rows.slice(0, MAX_ROWS);
      fig.querySelector(".tbl").innerHTML = `<table class="data"><thead><tr>${t.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(r => `<tr class="${r.total ? "total" : ""}">${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
        ${t.rows.length > MAX_ROWS ? `<div class="cap">표는 처음 ${MAX_ROWS}행만 실었습니다(전체 ${t.rows.length}행은 '전체 CSV'로 내려받을 수 있습니다).</div>` : ""}`;
      const ta = fig.querySelector(".memo-in");
      const memo = fig.querySelector(".memo");
      // 입력할 때마다 저장만 한다(시트를 다시 그리면 입력 중인 칸이 사라진다)
      ta.addEventListener("input", () => { reportState.update(o.it.id, { memo: ta.value }, { silent: true }); memo.textContent = ta.value; memo.hidden = !ta.value; });
    }
  };

  const addSample = () => {
    for (const c of SAMPLE) { const cfg = { ...c, filters: {} }; reportState.add({ id: panelId(cfg), cfg }); }
  };

  const exportAll = () => {
    const ok = resolved.filter(o => o.r);
    if (!ok.length) return toast("담은 항목이 없습니다");
    const out = [];
    for (const o of ok) for (const row of o.r.csv || []) out.push([o.r.title, ...row]);
    downloadCSV("보고서_전체_데이터.csv", ["패널", "큐브 키", "항목", "집단", "n", "지표", "값"], out);
    toast("전체 CSV를 내려받았습니다");
  };

  unsub?.();
  unsub = onReportChange(() => { if (alive()) drawSheet(); });
  if (params?.[0] === "sample" && !reportState.items().length) addSample();   // #report/sample — 점검·시연용
  else await drawSheet();
}

export function destroy() {
  unsub?.(); unsub = null;
  for (const el of liveCharts) disposeChart(el);
  liveCharts = [];
}
