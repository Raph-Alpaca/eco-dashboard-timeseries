/**
 * pubcard.js — 공표값 카드. 보고서에 인쇄된 값을 한 해 또는 두 해(추이)로 보여 준다.
 * spec = { pop, key, years:[...], group? }
 */
import { buildPubView, SURVEY } from "./published.js";
import { chartOn, disposeChart, downloadCSV } from "./charts.js";
import { esc, ICONS } from "./panel.js";
import { reportState, onReportChange, panelId, toast, storageWorks } from "./state.js";

const observer = new IntersectionObserver(entries => {
  for (const e of entries) {
    const c = e.target.__card;
    if (!c) continue;
    c.visible = e.isIntersecting;
    if (c.visible && c.dirty) c.drawChart();
  }
}, { rootMargin: "240px 0px" });

export function reportCfgOf(spec) {
  const years = [...spec.years].sort();
  return { mode: "pub", year: years.join("-"), survey: SURVEY, pop: spec.pop, key: spec.key, years, group: spec.group || "", by: [], filters: {} };
}

export function createPubCard(store, spec, { span = 6 } = {}) {
  const card = { spec: { ...spec }, visible: false, dirty: false, view: null };
  const el = document.createElement("section");
  el.className = `panel span-${span} pub`;
  el.__card = card;
  card.el = el;
  el.innerHTML = `
    <header>
      <div class="ttl"><h3>…</h3><div class="sub"></div></div>
      <div class="acts">
        <button class="icon-btn b-dl" title="표 CSV 내려받기" aria-label="표 CSV 내려받기">${ICONS.down}</button>
        <button class="icon-btn b-rep" title="보고서에 담기" aria-label="보고서에 담기">${ICONS.plus}</button>
      </div>
    </header>
    <div class="pub-pick" hidden></div>
    <div class="body"><div class="chart" role="img"></div></div>
    <div class="table-wrap"></div>
    <div class="pub-extra"></div>
    <footer><span class="src"></span><span class="badges"></span></footer>`;
  const $ = s => el.querySelector(s);

  const syncRep = () => {
    const b = $(".b-rep");
    const on = reportState.has(panelId(reportCfgOf(card.spec)));
    b.classList.toggle("on", on);
    b.innerHTML = on ? ICONS.check : ICONS.plus;
    b.title = on ? "보고서에 담김 (클릭하면 뺌)" : "보고서에 담기";
  };
  $(".b-rep").onclick = () => {
    const cfg = reportCfgOf(card.spec);
    const id = panelId(cfg);
    if (reportState.has(id)) { reportState.remove(id); toast("보고서에서 뺐습니다"); }
    else {
      reportState.add({ id, cfg });
      toast(storageWorks() ? "보고서에 담았습니다 · 상단 '보고서' 탭에서 확인" : "담았습니다. 다만 이 브라우저는 저장이 막혀 있어 창을 닫으면 담은 목록이 사라집니다", storageWorks() ? 2200 : 5000);
    }
    syncRep();
  };
  $(".b-dl").onclick = () => {
    const v = card.view;
    if (!v?.table) return;
    downloadCSV(`${v.title}_${card.spec.years.join("-")}.csv`.replace(/[\\/:*?"<>|]/g, "_"), v.table.columns, v.table.rows.map(r => r.cells));
    toast("CSV를 내려받았습니다");
  };
  const unsub = onReportChange(syncRep);

  card.drawChart = () => {
    const v = card.view;
    if (!v || v.empty || !v.option) return;
    const chartEl = $(".chart");
    chartEl.style.height = `${v.height}px`;
    chartOn(chartEl, v.option);
    chartEl.setAttribute("aria-label", `${v.title} 차트. 아래 표에서 수치를 확인할 수 있습니다.`);
    card.dirty = false;
  };

  card.update = async () => {
    let v;
    try { v = await buildPubView(store, card.spec); }
    catch (err) {
      $("h3").textContent = card.spec.key;
      $(".body").innerHTML = `<div class="empty" style="position:static;padding:18px">${esc(err.message || String(err))}</div>`;
      return;
    }
    card.view = v;
    card.spec.group = v.group || card.spec.group;
    $("h3").textContent = v.title;
    $(".sub").textContent = v.sub;
    $(".src").textContent = v.src;
    const badges = [];
    if (v.trend) badges.push(v.status === "wording" ? `<span class="badge wording" title="두 해의 문항 내용은 같고 문구만 다릅니다">문구 다름</span>` : `<span class="badge neutral" title="두 해의 문항이 같습니다">동일 문항</span>`);
    badges.push(`<span class="badge pubval" title="보고서에 인쇄된 값을 그대로 보여 줍니다(다시 집계하지 않음)">보고서 공표값</span>`);
    $(".badges").innerHTML = badges.join(" ");
    // 보기별 비율 문항: 볼 집단 고르기
    const pick = $(".pub-pick");
    if (v.kind === "dist" && v.groups.length > 1) {
      pick.hidden = false;
      pick.innerHTML = `<label>집단 <select>${v.groups.map(g => `<option value="${esc(`${g.axis}:${g.code}`)}" ${`${g.axis}:${g.code}` === v.group ? "selected" : ""}>${esc(g.axis === "all" ? "전체" : `${g.axisLabel} · ${g.label}`)}</option>`).join("")}</select></label>`;
      pick.querySelector("select").onchange = e => { card.spec.group = e.target.value; card.update(); };
    } else { pick.hidden = true; pick.innerHTML = ""; }
    const body = $(".body");
    if (v.empty) { body.innerHTML = `<div class="empty" style="position:static;padding:18px">${esc(v.empty)}</div>`; $(".table-wrap").innerHTML = ""; }
    else {
      if (!body.querySelector(".chart")) body.innerHTML = `<div class="chart" role="img"></div>`;
      const t = v.table;
      $(".table-wrap").innerHTML = `<table class="data"><thead><tr>${t.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r => `<tr class="${r.total ? "total" : ""}">${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      card.dirty = true;
      if (card.visible) card.drawChart();
    }
    // 문구가 다른 문항은 두 해의 문구를 함께 보여 준다. 전사 메모(계산값·분모 설명)는 접어서 둔다.
    const extra = [];
    if (v.wording) extra.push(`<div class="wording">${v.years.map(y => (v.wording[y] ? `<div><b>${y}년 문항</b> ${esc(v.wording[y])}</div>` : "")).join("")}${v.wording.diff ? `<div class="diff">달라진 점: ${esc(v.wording.diff)}</div>` : ""}</div>`);
    const notes = v.years.filter(y => v.notes[y]).map(y => `<div><b>${y}년</b> ${esc(v.notes[y])}</div>`).join("");
    if (notes) extra.push(`<details class="pub-notes"><summary>전사 메모(분모·계산값 설명)</summary>${notes}</details>`);
    $(".pub-extra").innerHTML = extra.join("");
    syncRep();
  };

  card.destroy = () => { observer.unobserve(el); unsub(); const ch = el.querySelector(".chart"); if (ch) disposeChart(ch); el.remove(); };
  observer.observe(el);
  card.update();
  return card;
}
