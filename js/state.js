/**
 * state.js — 화면 상태 저장(localStorage). 필터·패널 구성·보고서 담기.
 * 저장소가 막힌 환경(사생활 보호 모드, 기관 PC의 사이트 데이터 차단 등)에서도 동작하도록
 * 모든 값을 메모리에도 함께 두고, 저장 실패는 storageWorks() 로 알 수 있게 한다.
 */
// 기존 사이트(/eco-dashboard/)와 같은 출처(raph-alpaca.github.io)를 쓰므로 저장 키를 분리한다.
// 접두어가 같으면 두 사이트가 서로의 패널 구성·보고서 담기 목록을 덮어쓴다.
const PREFIX = "eco-dashboard:v2:";

const mem = new Map();   // 저장소가 막혔을 때의 대체 저장(탭을 닫으면 사라짐)
let storageOk = true;

function read(key, def) {
  if (storageOk) {
    // 저장소가 살아 있으면 항상 저장소에서 읽는다(다른 탭에서 바꾼 내용도 보이도록)
    try { const s = localStorage.getItem(PREFIX + key); return s ? JSON.parse(s) : def; } catch { storageOk = false; }
  }
  return mem.has(key) ? clone(mem.get(key)) : def;
}
function write(key, val) {
  mem.set(key, clone(val));
  try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); storageOk = true; } catch { storageOk = false; }
}
function remove(key) {
  mem.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch { storageOk = false; }
}
function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

/** 브라우저 저장소에 실제로 기록되는가(false면 이 탭을 닫을 때 상태가 사라진다) */
export function storageWorks() { return storageOk; }

/** 모집단별 필터 {axis: [codes]} */
export const filterState = {
  get(pop) { return read(`filters:${pop}`, {}); },
  set(pop, filters) { write(`filters:${pop}`, filters); },
  clear(pop) { remove(`filters:${pop}`); },
};

/** 탭별 패널 구성(기본 구성 대비 사용자가 바꾼 것만 저장) */
export const layoutState = {
  get(tabId) { return read(`layout:${tabId}`, null); },
  set(tabId, panels) { write(`layout:${tabId}`, panels); },
  reset(tabId) { remove(`layout:${tabId}`); },
};

/** 화면 선택값(실태조사 보기 방식 등) */
export const viewState = {
  get(key, def) { return read(`view:${key}`, def); },
  set(key, val) { write(`view:${key}`, val); },
};

function today() {
  const d = new Date();   // 기기 현지 날짜(UTC 기준으로 하면 오전 9시 전에 전날이 찍힌다)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 보고서 담기. 항목 = { id, cfg, memo } — 제목·사례 수·출처는 보고서를 그릴 때 cfg 로 다시 계산한다. */
export const reportState = {
  items() { return read("report:items", []); },
  meta() { return read("report:meta", { title: "환경교육 조사 결과 요약", subtitle: "", author: "", date: today() }); },
  setMeta(m) { write("report:meta", m); },
  has(id) { return this.items().some(it => it.id === id); },
  add(item) {
    const items = this.items();
    if (items.some(it => it.id === item.id)) return false;
    items.push({ memo: "", ...item });
    write("report:items", items);
    notify();
    return true;
  },
  remove(id) { write("report:items", this.items().filter(it => it.id !== id)); notify(); },
  /** silent: 목록·시트를 다시 그리지 않고 값만 저장(메모 입력 중 포커스를 잃지 않도록) */
  update(id, patch, { silent = false } = {}) {
    write("report:items", this.items().map(it => (it.id === id ? { ...it, ...patch } : it)));
    if (!silent) notify();
  },
  move(id, dir) {
    const items = this.items();
    const i = items.findIndex(it => it.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    write("report:items", items);
    notify();
  },
  clear() { remove("report:items"); notify(); },
};

const listeners = new Set();
export function onReportChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) fn(reportState.items()); }

/** 패널 구성 → 안정적인 id (같은 구성·같은 필터는 같은 id) */
export function panelId(cfg) {
  const filters = Object.entries(cfg.filters || {}).filter(([, v]) => v && v.length)
    .sort(([a], [b]) => a.localeCompare(b)).map(([a, v]) => `${a}=${[...v].sort().join(".")}`).join(";");
  const parts = [cfg.mode || "", cfg.year || "", cfg.survey, cfg.pop, cfg.key, (cfg.by || []).join("+"), cfg.measure || "", cfg.chart || "", cfg.cat ?? "", filters];
  return "p_" + parts.join("|").replace(/[^\w|+:;=.-]/g, "_");
}

let toastEl;
export function toast(msg, ms = 2200) {
  if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), ms);
}
