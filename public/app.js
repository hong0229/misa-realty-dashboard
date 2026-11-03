/* global L, Chart */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PY = 3.3058;
const DAY = 86400000;

const state = {
  dong: '전체', mode: 'week', cycle: 'week', from: '', to: '', preset: '12주', deal: '매매', metric: 'unit',
  selectedId: null, listingId: null,
};
let meta = { dongs: [], complexes: [], development: { items: [] } };
let complexById = new Map();
let tx = { trade: [], rent: [] };
let prevTx = { trade: [], rent: [] };
let history = { trade: [], rent: [] };
let market = {};
let listings = [];
let requestNo = 0;

// ---- 날짜 ----
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(new Date(s + 'T00:00:00').getTime() + n * DAY));
function addMonths(s, n) {
  const d = new Date(s + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return iso(d);
}
const today = () => iso(new Date());
const PRESETS = {
  week: [['4주', (t) => addDays(t, -27)], ['12주', (t) => addDays(t, -83)], ['26주', (t) => addDays(t, -181)]],
  month: [['6개월', (t) => `${addMonths(t, -6).slice(0, 7)}-01`], ['12개월', (t) => `${addMonths(t, -12).slice(0, 7)}-01`], ['24개월', (t) => `${addMonths(t, -24).slice(0, 7)}-01`]],
};
const defaultPreset = { week: '12주', month: '12개월' };

// ---- 표기 ----
function won(v) {
  v = Math.round(v);
  if (v >= 10000) {
    const uk = Math.floor(v / 10000);
    const rest = v % 10000;
    return rest ? `${uk}억 ${rest.toLocaleString()}` : `${uk}억`;
  }
  return v.toLocaleString();
}
const wonUnit = (v) => (v >= 10000 ? won(v) : `${won(v)}만`);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const idOf = (r) => `${r.dong}|${r.jibun}`;
const inDong = (r) => state.dong === '전체' || r.dong === state.dong;
const isJeonse = (r) => r.rent === 0;
const dist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`);
const pyArea = (a) => Math.round(a / PY);
const rentLabel = (r) => (isJeonse(r) ? won(r.deposit) : `${won(r.deposit)} / ${r.rent}`);

// ---- 데이터 ----
// GitHub Pages에서는 서버가 없으므로 미리 만들어 둔 파일에서 같은 형태로 돌려준다
const staticCache = new Map();
function staticFile(name) {
  if (!staticCache.has(name)) {
    staticCache.set(name, fetch(`data/${name}.json`).then((res) => {
      if (!res.ok) throw new Error(`자료를 불러오지 못했습니다 (${res.status})`);
      return res.json();
    }));
  }
  return staticCache.get(name);
}
async function staticApi(path) {
  const url = new URL(path, location.href);
  const q = url.searchParams;
  const route = url.pathname.split('/').pop();
  if (route === 'transactions') {
    const all = await staticFile('transactions');
    const inRange = (r) => r.d >= q.get('from') && r.d <= q.get('to');
    return { trade: all.trade.filter(inRange), rent: all.rent.filter(inRange) };
  }
  if (route === 'market') return staticFile(q.get('cycle') === 'week' ? 'market_week' : 'market_month');
  if (route === 'location') return (await staticFile('location'))[`${q.get('lat')},${q.get('lon')}`];
  return staticFile(route);
}

async function api(path, opt) {
  if (window.STATIC_SITE) return staticApi(path);
  const res = await fetch(path, opt);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `서버 오류 (${res.status})`);
  return body;
}

function showBanner(msg) {
  const b = $('#banner');
  b.hidden = !msg;
  b.textContent = msg || '';
}

async function loadAll() {
  const no = ++requestNo;
  $('#rankList').innerHTML = '<li class="empty">데이터를 불러오는 중입니다…</li>';
  try {
    const span = Math.round((new Date(state.to) - new Date(state.from)) / DAY) + 1;
    const prevTo = addDays(state.from, -1);
    const prevFrom = addDays(prevTo, -(span - 1));
    const [cur, prev, mk] = await Promise.all([
      api(`/api/transactions?from=${state.from}&to=${state.to}`),
      api(`/api/transactions?from=${prevFrom}&to=${prevTo}`),
      api(`/api/market?cycle=${state.cycle}`),
    ]);
    if (no !== requestNo) return;
    tx = cur;
    prevTx = prev;
    market = mk;
    showBanner('');
    renderData();
  } catch (e) {
    if (no !== requestNo) return;
    showBanner(`데이터를 불러오지 못했습니다: ${e.message}`);
    $('#rankList').innerHTML = '<li class="empty">데이터가 없습니다.</li>';
  }
}

const MODE_NAMES = { week: '주간', month: '월간', quarter: '최근 3개월', custom: '직접지정' };
function renderSummary() {
  const scope = state.dong === '전체' ? '미사지구 전체' : state.dong;
  $('#reportSummary').textContent = `조회 기준: ${scope} · ${MODE_NAMES[state.mode]} · ${state.from} ~ ${state.to} · 출력일 ${today()}`;
}

function renderData() {
  renderSummary();
  renderKpis();
  renderRank();
  renderCharts();
}

// ---- 핵심 지표 ----
function deltaHtml(cur, prev, suffix = '') {
  if (!prev || !cur) return '<span>이전 기간 자료 없음</span>';
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return `<span>이전 기간과 비슷${suffix}</span>`;
  const up = pct > 0;
  return `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span> 이전 기간 대비${suffix}`;
}
const unitPrice = (rows) => median(rows.filter((r) => r.area).map((r) => r.price / (r.area / PY)));

function renderKpis() {
  const t = tx.trade.filter(inDong);
  const pt = prevTx.trade.filter(inDong);
  const r = tx.rent.filter(inDong);
  const pr = prevTx.rent.filter(inDong);
  const jeonse = r.filter(isJeonse);
  const pj = pr.filter(isJeonse);
  const wol = r.filter((x) => !isJeonse(x));
  const pw = pr.filter((x) => !isJeonse(x));
  const scope = state.dong === '전체' ? '미사지구' : state.dong;

  const idx = rangeSeries(market.saleH);
  const idxLast = idx[idx.length - 1];
  const idxChange = idx.length > 1 ? ((idxLast.v - idx[0].v) / idx[0].v) * 100 : null;
  const unsold = (market.unsold || []).at(-1);

  const tiles = [
    { label: `${scope} 매매 거래량`, value: `${t.length.toLocaleString()}건`, sub: deltaHtml(t.length, pt.length) },
    { label: '매매 평당가 (전용 3.3㎡, 중위)', value: t.length ? `${wonUnit(unitPrice(t))}` : '–', sub: deltaHtml(unitPrice(t), unitPrice(pt)) },
    { label: `전세 보증금 중위 (${jeonse.length.toLocaleString()}건)`, value: jeonse.length ? wonUnit(median(jeonse.map((x) => x.deposit))) : '–', sub: deltaHtml(median(jeonse.map((x) => x.deposit)), median(pj.map((x) => x.deposit))) },
    { label: `월세 중위 (${wol.length.toLocaleString()}건, 임대단지 포함)`, value: wol.length ? `${Math.round(median(wol.map((x) => x.rent)))}만` : '–', sub: deltaHtml(median(wol.map((x) => x.rent)), median(pw.map((x) => x.rent))) },
    {
      label: '하남시 매매가격지수',
      value: idxLast ? idxLast.v.toFixed(2) : '–',
      sub: idxChange === null ? '기간 내 자료 부족' : `<span class="delta ${idxChange >= 0 ? 'up' : 'down'}">${idxChange >= 0 ? '▲' : '▼'} ${Math.abs(idxChange).toFixed(2)}%</span> 조회 기간 변동`,
    },
    { label: '하남시 미분양', value: unsold ? `${unsold.v.toLocaleString()}호` : '–', sub: unsold ? `${esc(unsold.label)} 기준` : '자료 없음' },
  ];
  $('#kpis').innerHTML = tiles.map((k) => `<div class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.sub}</div></div>`).join('');
}

// ---- Top 10 ----
const METRICS = {
  매매: [['unit', '평당가'], ['max', '최고가'], ['count', '거래량']],
  전세: [['unit', '평당 전세가'], ['max', '최고 보증금'], ['count', '거래량']],
  월세: [['unit', '중위 월세'], ['max', '최고 월세'], ['count', '거래량']],
};
function dealRows() {
  if (state.deal === '매매') return tx.trade.filter(inDong);
  return tx.rent.filter(inDong).filter((r) => (state.deal === '전세' ? isJeonse(r) : !isJeonse(r)));
}

function computeRank() {
  const groups = new Map();
  for (const r of dealRows()) {
    const id = idOf(r);
    if (!groups.has(id)) groups.set(id, { id, apt: r.apt, dong: r.dong, rows: [] });
    groups.get(id).rows.push(r);
  }
  const amount = (r) => (state.deal === '매매' ? r.price : state.deal === '전세' ? r.deposit : r.rent);
  const list = [...groups.values()].map((g) => {
    const amounts = g.rows.map(amount);
    const unit = state.deal === '월세' ? median(amounts) : median(g.rows.filter((r) => r.area).map((r) => amount(r) / (r.area / PY)));
    return { ...g, n: g.rows.length, unit, max: Math.max(...amounts), med: median(amounts), topRow: g.rows.find((r) => amount(r) === Math.max(...amounts)) };
  });
  const key = state.metric === 'count' ? 'n' : state.metric;
  let pool = list;
  // 평당가는 한 건짜리 거래로 순위가 뒤집히지 않도록 2건 이상 단지를 우선한다
  if (state.metric === 'unit') {
    const solid = list.filter((g) => g.n >= 2);
    if (solid.length >= 10) pool = solid;
  }
  return pool.sort((a, b) => b[key] - a[key] || b.max - a.max).slice(0, 10);
}

function rankValue(g) {
  const fmt = state.deal === '월세' ? (v) => `${Math.round(v)}만` : wonUnit;
  if (state.metric === 'count') return { main: `${g.n}건`, sub: `중위 ${fmt(g.med)}` };
  if (state.metric === 'max') {
    const r = g.topRow;
    return { main: fmt(g.max), sub: `${r.area}㎡ · ${r.floor}층` };
  }
  return { main: fmt(g.unit), sub: state.deal === '월세' ? `${g.n}건` : `3.3㎡당 · ${g.n}건` };
}

let rankData = [];
function renderRank() {
  $('#metricChips').innerHTML = METRICS[state.deal].map(([v, label]) => `<button data-v="${v}" class="${state.metric === v ? 'on' : ''}">${label}</button>`).join('');
  rankData = computeRank();
  const box = $('#rankList');
  if (!rankData.length) {
    box.innerHTML = '<li class="empty">이 기간에 신고된 거래가 없습니다. 기간을 넓혀 보세요.</li>';
  } else {
    box.innerHTML = rankData.map((g, i) => {
      const v = rankValue(g);
      const c = complexById.get(g.id);
      return `<li class="${g.id === state.selectedId ? 'on' : ''}"><button data-id="${esc(g.id)}">
        <span class="rank-no">${i + 1}</span>
        <span><span class="rank-name">${esc(c ? c.name : g.apt)}</span><span class="rank-sub">${esc(g.dong)}${c && c.build ? ` · ${c.build}년 준공` : ''}</span></span>
        <span class="rank-value">${v.main}<small>${v.sub}</small></span></button></li>`;
    }).join('');
  }
  const note = { unit: state.deal === '월세' ? '단지별 월세 중위값 기준입니다.' : '전용면적 3.3㎡당 단지별 중위값 기준이며, 거래가 2건 이상인 단지를 우선합니다.', max: '조회 기간 중 단지별 최고 거래금액 기준입니다.', count: '조회 기간 중 단지별 신고 건수 기준입니다.' };
  $('#rankFoot').textContent = `${state.from} ~ ${state.to} · ${note[state.metric]}`;
  if (!state.selectedId) showOverview();
}

// ---- 지도 ----
let map;
let layer;
const OFFICE = { name: '센트럴자이 미사금호부동산', lookup: '미사강변센트럴자이' };

function initMap() {
  map = L.map('map', { scrollWheelZoom: false }).setView([37.5605, 127.19], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    crossOrigin: true, // PDF 캡처에 필요
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
}

const pin = (cls, html, size) => L.divIcon({ className: '', html: `<div class="pin ${cls}">${html}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });

function addOfficePin() {
  const c = meta.complexes.find((x) => x.name === OFFICE.lookup);
  if (!c || !c.lat) return;
  // 사무소는 단지 상가에 있어 단지 중심에서 살짝 비켜 표시한다
  L.marker([c.lat - 0.0012, c.lon + 0.0014], { icon: pin('office', '<img src="logo.svg" alt="">', 30), zIndexOffset: -100 })
    .bindTooltip(`${OFFICE.name}<br>Tel. 031-795-1149`).addTo(layer);
}

function showOverview() {
  layer.clearLayers();
  $('#mapTitle').textContent = `${state.deal} Top 10 위치`;
  $('#resetMap').hidden = true;
  const pts = [];
  rankData.forEach((g, i) => {
    const c = complexById.get(g.id);
    if (!c || !c.lat) return;
    pts.push([c.lat, c.lon]);
    const m = L.marker([c.lat, c.lon], { icon: pin(i < 3 ? 'top' : '', i + 1, 28), zIndexOffset: 500 - i })
      .bindTooltip(`${i + 1}. ${esc(c.name)} · ${rankValue(g).main}`);
    m.on('click', () => selectComplex(g.id));
    m.addTo(layer);
  });
  addOfficePin();
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
}

const POI_STYLE = {
  subway: ['subway', '역'], bus: ['bus', '버'], elem: ['school', '초'], mid: ['school', '중'], high: ['school', '고'],
  mart: ['shop', '마'], dept: ['shop', '백'], cafe: ['shop', '카'], public: ['public', '관'],
};

function latestRows(id) {
  const t = history.trade.filter((r) => idOf(r) === id).sort((a, b) => b.d.localeCompare(a.d));
  const r = history.rent.filter((x) => idOf(x) === id).sort((a, b) => b.d.localeCompare(a.d));
  return { trade: t, jeonse: r.filter(isJeonse), wol: r.filter((x) => !isJeonse(x)) };
}

function popupHtml(c, rows) {
  const row = (label, x, val) => (x ? `<div class="pop-row"><span>${label} ${esc(x.d.slice(2).replace(/-/g, '.'))} · ${x.area}㎡</span><b>${val}</b></div>` : '');
  return `<div class="pop-title">${esc(c.name)}</div><div class="pop-sub">하남시 ${esc(c.dong)} ${esc(c.jibun)}${c.build ? ` · ${c.build}년` : ''}</div>
    ${row('매매', rows.trade[0], rows.trade[0] && won(rows.trade[0].price))}
    ${rows.trade[1] ? row('매매', rows.trade[1], won(rows.trade[1].price)) : ''}
    ${row('전세', rows.jeonse[0], rows.jeonse[0] && won(rows.jeonse[0].deposit))}
    ${row('월세', rows.wol[0], rows.wol[0] && rentLabel(rows.wol[0]))}
    ${!rows.trade.length && !rows.jeonse.length && !rows.wol.length ? '<div class="pop-row">최근 2년 거래 없음</div>' : ''}`;
}

function renderDetail(c, rows) {
  const col = (title, list, val) => `<div class="tx-col"><h4>${title}</h4>${list.length ? `<table>${list.slice(0, 6).map((x) => `<tr><td class="d">${esc(x.d.slice(2).replace(/-/g, '.'))}</td><td>${x.area}㎡ ${x.floor}층</td><td>${val(x)}</td></tr>`).join('')}</table>` : '<div class="none">최근 2년 거래 없음</div>'}</div>`;
  const li = state.listingId && listings.find((x) => x.id === state.listingId);
  const box = $('#detail');
  box.hidden = false;
  box.innerHTML = `<div class="detail-head"><h3>${esc(c.name)} 최근 실거래</h3><span>하남시 ${esc(c.dong)} ${esc(c.jibun)}${c.build ? ` · ${c.build}년 준공` : ''} · 금액 단위 만원</span></div>
    ${li ? `<div class="listing-note">${li.isSample ? '<span class="badge sample">샘플</span>' : ''}<b>추천 매물</b> ${esc(li.dealType)} ${listingPrice(li)} · ${+Number(li.area).toFixed(2)}㎡${li.floor ? ` · ${esc(li.floor)}` : ''}${li.memo ? `<br>${esc(li.memo)}` : ''}</div>` : ''}
    <div class="tx-grid">${col('매매', rows.trade, (x) => won(x.price))}${col('전세', rows.jeonse, (x) => won(x.deposit))}${col('월세 (보증금/월세)', rows.wol, rentLabel)}</div>`;
}

async function selectComplex(id, listingId = null) {
  const c = complexById.get(id);
  state.selectedId = id;
  state.listingId = listingId;
  document.querySelectorAll('#rankList li').forEach((li) => li.classList.toggle('on', li.firstElementChild?.dataset.id === id));
  renderListings();
  if (!c) return;
  $('#resetMap').hidden = false;
  $('#mapTitle').textContent = `${c.name} 위치`;
  const rows = latestRows(id);
  renderDetail(c, rows);
  layer.clearLayers();
  addOfficePin();
  if (!c.lat) {
    showBanner(`${c.name}의 지도 좌표를 찾지 못해 입지분석을 표시할 수 없습니다.`);
    $('#location').hidden = true;
    return;
  }
  showBanner('');
  const marker = L.marker([c.lat, c.lon], { icon: pin('sel', '단지', 36), zIndexOffset: 1000 }).bindPopup(popupHtml(c, rows), { autoPan: true }).addTo(layer);
  map.setView([c.lat, c.lon], 15);
  marker.openPopup();
  try {
    const loc = await api(`/api/location?lat=${c.lat}&lon=${c.lon}`);
    if (state.selectedId !== id) return;
    for (const [kind, [cls, ch]] of Object.entries(POI_STYLE)) {
      (loc[kind] || []).slice(0, kind === 'bus' ? 2 : 3).forEach((p) => {
        L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<div class="poi ${cls}">${ch}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
          .bindTooltip(`${esc(p.n)} · ${dist(p.m)}`).addTo(layer);
      });
    }
    renderLocation(c, loc);
  } catch (e) {
    showBanner(`입지분석을 불러오지 못했습니다: ${e.message}`);
  }
}

function clearSelection() {
  state.selectedId = null;
  state.listingId = null;
  $('#detail').hidden = true;
  $('#location').hidden = true;
  document.querySelectorAll('#rankList li.on').forEach((li) => li.classList.remove('on'));
  renderListings();
  showOverview();
}

// ---- 입지분석 ----
function renderLocation(c, loc) {
  const walk = (p) => `<div class="loc-item"><b>${esc(p.n)}</b><span>${dist(p.m)} · 도보 ${p.walk}분</span></div>`;
  const drive = (p) => `<div class="loc-item"><b>${esc(p.n)}</b><span>${dist(p.m)} · 차량 ${p.drive}분</span></div>`;
  const near = (p) => (p.m > 1500 ? drive(p) : walk(p));
  const group = (title, list, fn, none = '주변 자료 없음') => `<div class="loc-group"><h4>${title}</h4>${list && list.length ? list.map(fn).join('') : `<div class="loc-none">${none}</div>`}</div>`;
  const dev = meta.development;
  const box = $('#location');
  box.hidden = false;
  box.innerHTML = `
    <div class="loc-head"><h2>${esc(c.name)} 입지분석</h2><span>하남시 ${esc(c.dong)} ${esc(c.jibun)}${c.road ? ` · ${esc(c.road)}` : ''}</span></div>
    <div class="loc-grid">
      <div class="loc-col"><h3>교통</h3>
        ${group('지하철', loc.subway, near)}
        ${group('KTX · SRT', loc.ktx, drive)}
        ${group('GTX', loc.gtx, drive)}
        ${group('버스 정류장', loc.bus, near)}
      </div>
      <div class="loc-col"><h3>학군</h3>
        ${group('초등학교', loc.elem, near)}
        ${group('중학교', loc.mid, near)}
        ${group('고등학교', loc.high, near)}
        <p class="foot">실제 배정 학교는 학구도안내서비스와 교육지원청에서 확인해 주세요.</p>
      </div>
      <div class="loc-col"><h3>상권 · 생활</h3>
        ${group('마트', loc.mart, near)}
        ${group('백화점 · 복합몰', loc.dept, near)}
        ${group('커피숍', loc.cafe, near)}
        ${group('관공서', loc.public, near)}
        ${group('병원', loc.hospital, near)}
        ${group('공원', loc.park, near)}
      </div>
      <div class="loc-col"><h3>주변 개발계획</h3>
        ${(dev.items || []).map((d) => `<div class="dev"><div class="dev-name"><span class="badge ${esc(d.statusLevel)}">${esc(d.status)}</span>${esc(d.name)}</div><p>${esc(d.desc)}</p>${d.caution ? `<p class="caution">${esc(d.caution)}</p>` : ''}<a href="${esc(d.source)}" target="_blank" rel="noopener">출처 보기</a></div>`).join('')}
        <p class="foot">${esc(dev.asOf)} 기준. ${esc(dev.note)}</p>
      </div>
    </div>
    <div class="loc-foot">거리는 단지 중심에서의 직선거리이며, 시간은 도보 분속 75m, 차량 시속 35km와 우회계수 1.3으로 계산한 추정치입니다. 주변시설은 OpenStreetMap 등록 자료 기준이라 일부 누락될 수 있습니다.</div>`;
}

// ---- 추천 매물 ----
function listingPrice(l) {
  if (l.dealType === '매매') return won(l.price);
  if (l.dealType === '전세') return won(l.deposit);
  return `${won(l.deposit)} / ${l.rent}`;
}

function renderListings() {
  const box = $('#listings');
  if (!listings.length) {
    box.innerHTML = '<div class="empty">등록된 매물이 없습니다. [+ 매물 추가]로 등록해 주세요.</div>';
    return;
  }
  box.innerHTML = listings.map((l) => {
    const c = complexById.get(l.complexId);
    return `<article class="card ${state.listingId === l.id ? 'on' : ''}">
      <button class="card-open" data-open="${esc(l.id)}">
        <div class="card-type">${l.isSample ? '<span class="badge sample">샘플</span>' : ''}${esc(l.dealType)}</div>
        <div class="card-price">${listingPrice(l)}${l.dealType === '월세' ? '<small style="font-size:12px;font-weight:500"> 만원</small>' : ''}</div>
        <div class="card-apt">${esc(c ? c.name : '단지 정보 없음')}</div>
        <div class="card-meta">${esc(c ? c.dong : '')} · 전용 ${+Number(l.area).toFixed(2)}㎡ (${pyArea(l.area)}평)${l.floor ? ` · ${esc(l.floor)}` : ''}</div>
        <div class="card-title">${esc(l.title)}</div>
      </button>
      <div class="card-actions no-print"><button data-edit="${esc(l.id)}">수정</button><button data-del="${esc(l.id)}">삭제</button></div>
    </article>`;
  }).join('');
}

function syncDealFields() {
  const form = $('#listingForm');
  const type = form.dealType.value;
  form.querySelectorAll('label[data-for]').forEach((el) => { el.hidden = !el.dataset.for.split(',').includes(type); el.style.display = el.hidden ? 'none' : ''; });
}

function openListingForm(item) {
  const form = $('#listingForm');
  form.reset();
  form.dataset.id = item ? item.id : '';
  $('#dialogTitle').textContent = item ? '매물 수정' : '매물 추가';
  $('#formError').hidden = true;
  if (item) for (const k of ['complexId', 'title', 'dealType', 'area', 'price', 'deposit', 'rent', 'floor', 'memo']) form[k].value = item[k] ?? '';
  syncDealFields();
  $('#listingDialog').showModal();
}

async function saveListing(e) {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form).entries());
  const id = form.dataset.id;
  try {
    if (id) await api(`/api/listings/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    else await api('/api/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    listings = await api('/api/listings');
    renderListings();
    $('#listingDialog').close();
  } catch (err) {
    const box = $('#formError');
    box.hidden = false;
    box.textContent = err.message;
  }
}

// ---- 차트 ----
const COLORS = { a: '#2a78d6', b: '#eb6834', c: '#1baf7a', grid: '#e8ebf0', zero: '#8d97a5', text: '#5a6573' };
const SERIES = [COLORS.a, COLORS.b, COLORS.c, '#eda100'];
const chartPool = new Map();

function rangeSeries(series, minMonths = 0) {
  if (!series) return [];
  const from = minMonths ? [state.from, addMonths(state.to, -minMonths)].sort()[0] : state.from;
  return series.filter((p) => {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(p.label) ? p.label : `${p.t.slice(0, 4)}-${p.t.slice(4, 6)}-15`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.label)) return d >= from && d <= state.to;
    return d.slice(0, 7) >= from.slice(0, 7) && d.slice(0, 7) <= state.to.slice(0, 7);
  });
}
const shortLabel = (p) => (/^\d{4}-\d{2}-\d{2}$/.test(p.label) ? p.label.slice(5).replace('-', '/') : `${p.t.slice(2, 4)}.${p.t.slice(4, 6)}`);

function bucketKey(d) {
  if (state.cycle === 'month') return d.slice(0, 7);
  const dt = new Date(d + 'T00:00:00');
  return addDays(d, -((dt.getDay() + 6) % 7)); // 해당 주 월요일
}
function bucketsInRange() {
  const out = [];
  if (state.cycle === 'month') {
    let k = state.from.slice(0, 7);
    while (k <= state.to.slice(0, 7)) {
      out.push(k);
      k = addMonths(`${k}-01`, 1).slice(0, 7);
    }
    return out;
  }
  let k = bucketKey(state.from);
  while (k <= state.to) {
    out.push(k);
    k = addDays(k, 7);
  }
  return out;
}
const bucketLabel = (k) => (state.cycle === 'month' ? `${k.slice(2, 4)}.${k.slice(5, 7)}` : k.slice(5).replace('-', '/'));

function drawChart(def) {
  const canvasId = `c-${def.id}`;
  const prev = chartPool.get(def.id);
  if (prev) prev.destroy();
  chartPool.delete(def.id);
  const box = document.getElementById(`box-${def.id}`);
  const hasData = def.datasets.some((d) => d.data.some((v) => v !== null && v !== undefined));
  if (!hasData) {
    box.innerHTML = '<div class="chart-empty">이 기간에 자료가 없습니다</div>';
    return;
  }
  box.innerHTML = `<canvas id="${canvasId}" role="img" aria-label="${esc(def.title)}"></canvas>`;
  const fmt = def.fmt || ((v) => v.toLocaleString());
  chartPool.set(def.id, new Chart(document.getElementById(canvasId), {
    type: def.type || 'line',
    data: {
      labels: def.labels,
      datasets: def.datasets.map((d, i) => ({
        label: d.label,
        data: d.data,
        type: d.type,
        borderDash: d.dashed ? [6, 4] : undefined,
        order: d.type === 'line' ? 0 : 1,
        borderColor: d.color || (def.stacked ? '#fff' : SERIES[i]),
        backgroundColor: d.color || SERIES[i],
        borderWidth: def.stacked ? 1 : (d.type || def.type) === 'bar' ? 0 : 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderColor: '#fff',
        pointHoverBorderWidth: 2,
        cubicInterpolationMode: 'monotone',
        spanGaps: true,
        borderRadius: def.stacked ? 2 : def.type === 'bar' ? { topLeft: 4, topRight: 4 } : 0,
        maxBarThickness: def.barWidth || 18,
        borderSkipped: 'bottom',
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: def.datasets.length > 1 ? { align: 'start', labels: { boxWidth: 12, boxHeight: 3, color: COLORS.text, font: { size: 12 } } } : { display: false },
        tooltip: {
          backgroundColor: '#16202e', padding: 9, cornerRadius: 8, displayColors: def.datasets.length > 1, boxWidth: 8, boxHeight: 8,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
            footer: def.stacked && !def.noTotal ? (items) => `합계: ${fmt(items.reduce((a, x) => a + x.parsed.y, 0))}` : undefined,
          },
        },
      },
      scales: {
        x: { stacked: Boolean(def.stacked), grid: { display: false }, border: { color: COLORS.grid }, ticks: { color: COLORS.text, autoSkip: !def.allTicks, maxTicksLimit: def.allTicks ? undefined : 6, maxRotation: 0, font: { size: 11 } } },
        y: { max: def.max, stacked: Boolean(def.stacked), beginAtZero: def.type === 'bar', grid: { color: def.zeroLine ? (c) => (c.tick.value === 0 ? COLORS.zero : COLORS.grid) : COLORS.grid }, border: { display: false }, ticks: { color: COLORS.text, maxTicksLimit: 5, precision: def.type === 'bar' ? 0 : undefined, font: { size: 11 }, callback: (v) => (def.tickFmt ? def.tickFmt(v) : v.toLocaleString()) } },
      },
    },
  }));
}

// 1년 전 같은 시점 대비 변동률(%) 시계열
function yearlyChange(series) {
  if (!series || !series.length) return [];
  const weekly = /^\d{4}-\d{2}-\d{2}$/.test(series[0].label);
  const byT = new Map(series.map((p) => [p.t, p.v]));
  const out = [];
  series.forEach((p, i) => {
    let base;
    if (weekly) {
      const b = series[i - 52];
      const gap = b ? (new Date(p.label) - new Date(b.label)) / DAY : 0;
      if (gap >= 357 && gap <= 371) base = b.v;
    } else {
      base = byT.get(String(Number(p.t) - 100));
    }
    if (base) out.push({ t: p.t, label: p.label, v: ((p.v - base) / base) * 100, base, cur: p.v });
  });
  return out;
}

function lastUpTo(series) {
  const list = series.filter((p) => (/^\d{4}-\d{2}-\d{2}$/.test(p.label) ? p.label : `${p.t.slice(0, 4)}-${p.t.slice(4, 6)}-01`) <= state.to);
  return list[list.length - 1];
}

function renderYearly() {
  const cycleName = state.cycle === 'week' ? '주간' : '월간';
  const items = [
    ['매매가격지수', market.saleH, market.saleG, cycleName],
    ['전세가격지수', market.jeonseH, market.jeonseG, cycleName],
    ['월세가격지수', market.rentH, market.rentG, '월간'],
  ];
  const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  $('#yoyCards').innerHTML = items.map(([name, h, g, cyc]) => {
    const a = lastUpTo(yearlyChange(h));
    const b = lastUpTo(yearlyChange(g));
    if (!a) return `<div class="yoy-card"><h3>${name} 1년 변동률</h3><div class="empty">자료가 없습니다</div></div>`;
    const max = Math.max(Math.abs(a.v), b ? Math.abs(b.v) : 0, 0.01);
    const bar = (label, r) => (r ? `<div class="yoy-row"><span>${label}</span><span class="yoy-track"><span class="yoy-bar ${r.v >= 0 ? 'up' : 'down'}" style="width:${(Math.abs(r.v) / max) * 100}%"></span></span><b>${signed(r.v)}</b></div>` : '');
    return `<div class="yoy-card"><h3>${name} 1년 변동률 (${cyc})</h3>
      <div class="yoy-main ${a.v >= 0 ? 'up' : 'down'}">${a.v >= 0 ? '▲' : '▼'} ${Math.abs(a.v).toFixed(2)}%<small>하남시</small></div>
      ${bar('하남시', a)}${bar('경기', b)}
      <div class="yoy-foot">${esc(a.label)} 기준 지수 ${a.cur.toFixed(2)} (1년 전 ${a.base.toFixed(2)})</div></div>`;
  }).join('');
}

function renderDongStatus(cycleName) {
  const stat = (dong) => {
    const of = (list) => (dong ? list.filter((r) => r.dong === dong) : list);
    const t = of(tx.trade);
    const pt = of(prevTx.trade);
    const r = of(tx.rent);
    const j = r.filter(isJeonse);
    const w = r.filter((x) => !isJeonse(x));
    return { t, pt, j, w, unit: unitPrice(t), prevUnit: unitPrice(pt) };
  };
  const change = (cur, prev) => {
    if (!cur || !prev) return '<span class="sub">–</span>';
    const p = ((cur - prev) / prev) * 100;
    return `<span class="sub delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}%</span>`;
  };
  const row = (label, s, cls) => `<tr class="${cls}"><td>${label}</td>
    <td>${s.t.length.toLocaleString()}${change(s.t.length, s.pt.length)}</td>
    <td>${s.t.length ? wonUnit(s.unit) : '–'}${change(s.unit, s.prevUnit)}</td>
    <td>${s.j.length.toLocaleString()}</td>
    <td>${s.j.length ? wonUnit(median(s.j.map((x) => x.deposit))) : '–'}</td>
    <td>${s.w.length.toLocaleString()}</td>
    <td>${s.w.length ? `${Math.round(median(s.w.map((x) => x.rent)))}만` : '–'}</td>
    <td>${(s.t.length + s.j.length + s.w.length).toLocaleString()}</td></tr>`;
  const stats = meta.dongs.map((d) => [d, stat(d)]);
  $('#dongTable').innerHTML = `<thead><tr><th>법정동</th><th>매매 건수</th><th>매매 평당가</th><th>전세 건수</th><th>전세 중위</th><th>월세 건수</th><th>월세 중위</th><th>합계</th></tr></thead><tbody>
    ${stats.map(([d, s]) => row(`<button data-dong="${esc(d)}">${esc(d)}</button>`, s, state.dong === d ? 'on' : '')).join('')}
    ${row('미사지구 전체', stat(null), 'total')}</tbody>`;
  $('#dongFoot').textContent = `${state.from} ~ ${state.to} · ▲▼는 바로 앞 같은 길이 기간 대비입니다. 평당가는 전용 3.3㎡ 중위값이며, 동 이름을 누르면 해당 동으로 전체 화면이 바뀝니다.`;

  drawChart({
    id: 'dongBar', type: 'bar', title: '동별 거래량 비교', labels: meta.dongs, barWidth: 34,
    datasets: [{ label: '매매', data: stats.map(([, s]) => s.t.length) }, { label: '전세', data: stats.map(([, s]) => s.j.length) }, { label: '월세', data: stats.map(([, s]) => s.w.length) }],
    fmt: (v) => `${v.toLocaleString()}건`,
  });
  const buckets = bucketsInRange();
  if (buckets.length > 1 && !tx.trade.some((r) => bucketKey(r.d) === buckets.at(-1))) buckets.pop();
  document.getElementById('t-dongTrend').textContent = `동별 매매 거래량 추이 (${cycleName})`;
  drawChart({
    id: 'dongTrend', title: '동별 매매 거래량 추이', labels: buckets.map(bucketLabel),
    datasets: meta.dongs.map((d) => ({
      label: d,
      data: buckets.map((b) => tx.trade.filter((r) => r.dong === d && bucketKey(r.d) === b).length),
    })),
    fmt: (v) => `${v.toLocaleString()}건`,
  });
}

function renderCharts() {
  const cycleName = state.cycle === 'week' ? '주간' : '월간';
  const scope = state.dong === '전체' ? '미사지구' : state.dong;
  const dual = (id, title, sub, a, b, nameA, nameB, fmt) => {
    const merged = new Map();
    a.forEach((p) => merged.set(p.t, { p, a: p.v, b: null }));
    b.forEach((p) => { const m = merged.get(p.t) || { p, a: null, b: null }; m.b = p.v; merged.set(p.t, m); });
    const keys = [...merged.keys()].sort();
    return { id, title, sub, labels: keys.map((k) => shortLabel(merged.get(k).p)), datasets: [{ label: nameA, data: keys.map((k) => merged.get(k).a) }, { label: nameB, data: keys.map((k) => merged.get(k).b) }], fmt };
  };
  const num2 = (v) => v.toFixed(2);

  const buckets = bucketsInRange();
  const trades = tx.trade.filter(inDong);
  const byBucket = new Map(buckets.map((b) => [b, []]));
  trades.forEach((r) => { const k = bucketKey(r.d); if (byBucket.has(k)) byBucket.get(k).push(r); });
  if (buckets.length > 1 && !byBucket.get(buckets.at(-1)).length) buckets.pop(); // 아직 신고가 없는 마지막 구간 제외

  const defs = [
    dual('sale', `아파트 매매가격지수 (${cycleName})`, '한국부동산원 · 하남시와 경기 비교', rangeSeries(market.saleH), rangeSeries(market.saleG), '하남시', '경기', num2),
    dual('jeonse', `아파트 전세가격지수 (${cycleName})`, '한국부동산원 · 하남시와 경기 비교', rangeSeries(market.jeonseH), rangeSeries(market.jeonseG), '하남시', '경기', num2),
    {
      id: 'volume', type: 'bar', title: `${scope} 매매 거래량 (${cycleName})`, sub: '국토부 실거래 신고 건수', labels: buckets.map(bucketLabel),
      datasets: [{ label: '거래량', data: buckets.map((b) => byBucket.get(b).length) }], fmt: (v) => `${v}건`,
    },
    {
      id: 'unit', title: `${scope} 평당 실거래가 (${cycleName})`, sub: '전용 3.3㎡당 중위값, 거래 없는 구간은 연결', labels: buckets.map(bucketLabel),
      datasets: [{ label: '평당가', data: buckets.map((b) => (byBucket.get(b).length ? Math.round(unitPrice(byBucket.get(b))) : null)) }], fmt: (v) => `${won(v)}만`, tickFmt: (v) => (v >= 10000 ? `${(v / 10000).toFixed(1)}억` : v.toLocaleString()),
    },
    dual('ratio', '전세가율 (월간)', '중위 매매가 대비 전세가, 최소 12개월 표시', rangeSeries(market.ratioH, 12), rangeSeries(market.ratioG, 12), '하남시', '경기', (v) => `${v.toFixed(1)}%`),
    (() => {
      const s = rangeSeries(market.volume, 12);
      return { id: 'hanamVol', type: 'bar', title: '하남시 아파트 매매 거래량 (월간)', sub: '한국부동산원, 최소 12개월 표시', labels: s.map(shortLabel), datasets: [{ label: '거래량', data: s.map((p) => p.v) }], fmt: (v) => `${v.toLocaleString()}호` };
    })(),
    (() => {
      const s = rangeSeries(market.unsold, 12);
      return { id: 'unsold', type: 'bar', title: '하남시 미분양 주택 (월간)', sub: '한국부동산원, 최소 12개월 표시', labels: s.map(shortLabel), datasets: [{ label: '미분양', data: s.map((p) => p.v) }], fmt: (v) => `${v.toLocaleString()}호` };
    })(),
    (() => {
      const s = rangeSeries(market.demand);
      return { id: 'demand', title: '매매수급동향 (동부1권, 주간)', sub: '100보다 크면 매수세 우위. 동부1권은 하남시 포함 권역', labels: s.map(shortLabel), datasets: [{ label: '수급지수', data: s.map((p) => p.v) }], fmt: (v) => v.toFixed(1) };
    })(),
  ];

  const rents = tx.rent.filter(inDong);
  const countBy = (rows) => {
    const m = new Map(buckets.map((b) => [b, 0]));
    rows.forEach((r) => { const k = bucketKey(r.d); if (m.has(k)) m.set(k, m.get(k) + 1); });
    return buckets.map((b) => m.get(b));
  };
  const jeonseRows = rents.filter(isJeonse);
  const wolRows = rents.filter((r) => !isJeonse(r));
  const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const toPyeong = (s) => s.map((p) => ({ ...p, v: Math.round((p.v * PY) / 10) })); // 천원/㎡ → 만원/3.3㎡
  defs.push(
    dual('rent', '아파트 월세가격지수 (월간)', '한국부동산원 · 주간 자료 없음, 최소 12개월 표시', rangeSeries(market.rentH, 12), rangeSeries(market.rentG, 12), '하남시', '경기', num2),
    { ...dual('yoy', `하남시 지수 1년 변동률 추이 (${cycleName})`, '1년 전 같은 시점 대비 상승률. 0% 위면 상승', rangeSeries(yearlyChange(market.saleH)), rangeSeries(yearlyChange(market.jeonseH)), '매매', '전세', pct), zeroLine: true, tickFmt: (v) => `${v}%` },
    {
      id: 'allVol', type: 'bar', stacked: true, title: `${scope} 기간 내 거래량 (${cycleName})`,
      sub: `합계 ${(trades.length + rents.length).toLocaleString()}건 · 매매 ${trades.length.toLocaleString()} · 전세 ${jeonseRows.length.toLocaleString()} · 월세 ${wolRows.length.toLocaleString()}`,
      labels: buckets.map(bucketLabel),
      datasets: [{ label: '매매', data: countBy(trades) }, { label: '전세', data: countBy(jeonseRows) }, { label: '월세', data: countBy(wolRows) }],
      fmt: (v) => `${v.toLocaleString()}건`,
    },
    dual('presale', '평당 분양가 (월간)', '시·도 단위 월간 자료를 3.3㎡당으로 환산 (주간 없음)', toPyeong(rangeSeries(market.presaleG, 12)), toPyeong(rangeSeries(market.presaleM, 12)), '경기', '수도권', (v) => `${v.toLocaleString()}만`),
  );
  const order = ['sale', 'jeonse', 'rent', 'yoy', 'allVol', 'volume', 'unit', 'presale', 'ratio', 'hanamVol', 'unsold', 'demand'];
  defs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  renderYearly();
  renderDongStatus(cycleName);

  const wrap = $('#charts');
  if (!wrap.children.length) {
    wrap.innerHTML = defs.map((d) => `<div class="chart"><h3 id="t-${d.id}"></h3><div class="chart-sub" id="s-${d.id}"></div><div class="chart-box" id="box-${d.id}"></div></div>`).join('');
  }
  defs.forEach((d) => {
    document.getElementById(`t-${d.id}`).textContent = d.title;
    document.getElementById(`s-${d.id}`).textContent = d.sub;
    drawChart(d);
  });
}

// ---- 조회 조건 ----
function renderPresets() {
  const hasPresets = Boolean(PRESETS[state.mode]);
  $('#presetField').style.display = hasPresets ? '' : 'none';
  if (!hasPresets) return;
  $('#presets').innerHTML = PRESETS[state.cycle].map(([name]) => `<button data-v="${name}" class="${state.preset === name ? 'on' : ''}">${name}</button>`).join('');
}
function applyPreset(name) {
  const t = today();
  const found = PRESETS[state.cycle].find(([n]) => n === name);
  state.preset = name;
  state.to = t;
  state.from = found[1](t);
  $('#from').value = state.from;
  $('#to').value = state.to;
  renderPresets();
}
// 직접지정은 기간이 6개월 안팎까지면 주 단위, 그보다 길면 월 단위로 묶는다
const autoCycle = () => ((new Date(state.to) - new Date(state.from)) / DAY <= 190 ? 'week' : 'month');
function setMode(mode) {
  state.mode = mode;
  state.preset = '';
  $('#cycleSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === mode));
  renderPresets();
}

function onDatesChanged() {
  let f = $('#from').value;
  let t = $('#to').value;
  if (!f || !t) return;
  if (t > today()) t = today();
  if (f > t) [f, t] = [t, f];
  $('#from').value = f;
  $('#to').value = t;
  state.from = f;
  state.to = t;
  setMode('custom');
  state.cycle = autoCycle();
  loadAll();
}

function bindEvents() {
  $('#dongSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.dong = b.dataset.v;
    $('#dongSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    if (state.selectedId && state.dong !== '전체' && !state.selectedId.startsWith(`${state.dong}|`)) clearSelection();
    renderData();
  });
  $('#cycleSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || state.mode === b.dataset.v) return;
    const mode = b.dataset.v;
    if (mode === 'custom') {
      setMode('custom');
      state.cycle = autoCycle();
      renderSummary();
      $('#from').focus();
      return loadAll();
    }
    setMode(mode);
    if (mode === 'quarter') {
      state.cycle = 'week';
      state.to = today();
      state.from = addMonths(state.to, -3);
      $('#from').value = state.from;
      $('#to').value = state.to;
    } else {
      state.cycle = mode;
      applyPreset(defaultPreset[mode]);
    }
    loadAll();
  });
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    applyPreset(b.dataset.v);
    loadAll();
  });
  $('#from').addEventListener('change', onDatesChanged);
  $('#to').addEventListener('change', onDatesChanged);
  $('#dealTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.deal = b.dataset.v;
    $('#dealTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderRank();
  });
  $('#metricChips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.metric = b.dataset.v;
    renderRank();
  });
  $('#rankList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) selectComplex(b.dataset.id);
  });
  $('#dongTable').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-dong]');
    if (b) document.querySelector(`#dongSeg button[data-v="${b.dataset.dong}"]`).click();
  });
  $('#printReport').addEventListener('click', printReport);
  $('#savePdf').addEventListener('click', savePdf);
  $('#resetMap').addEventListener('click', clearSelection);
  $('#addListing').addEventListener('click', () => openListingForm(null));
  $('#cancelListing').addEventListener('click', () => $('#listingDialog').close());
  $('#listingForm').addEventListener('submit', saveListing);
  $('#listingForm').dealType.addEventListener('change', syncDealFields);
  $('#listings').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const l = listings.find((x) => x.id === open.dataset.open);
      if (l) {
        await selectComplex(l.complexId, l.id);
        document.querySelector('.top-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) return openListingForm(listings.find((x) => x.id === edit.dataset.edit));
    const del = e.target.closest('[data-del]');
    if (del && confirm('이 매물을 삭제할까요?')) {
      try {
        await api(`/api/listings/${del.dataset.del}`, { method: 'DELETE' });
        listings = await api('/api/listings');
        renderListings();
      } catch (err) {
        showBanner(err.message);
      }
    }
  });
}

async function init() {
  initMap();
  bindEvents();
  if (window.STATIC_SITE) {
    const site = await staticFile('site');
    $('#from').min = site.from;
    $('#to').min = site.from;
    $('#siteNote').hidden = false;
    $('#siteNote').textContent = `공개용 화면입니다. 자료 기준일 ${site.builtAt}, 실거래는 ${site.from.slice(0, 4)}년 1월부터 제공합니다. 최근 자료는 다시 게시해야 갱신됩니다.`;
  }
  applyPreset(defaultPreset[state.cycle]);
  try {
    [meta, listings] = await Promise.all([api('/api/meta'), api('/api/listings')]);
  } catch (e) {
    showBanner(`서버에 연결하지 못했습니다: ${e.message}`);
    return;
  }
  complexById = new Map(meta.complexes.map((c) => [c.id, c]));
  $('#dongSeg').innerHTML = ['전체', ...meta.dongs].map((d) => `<button data-v="${d}" class="${d === state.dong ? 'on' : ''}">${d === '전체' ? '미사지구 전체' : d}</button>`).join('');
  const sel = $('#listingForm').complexId;
  sel.innerHTML = [...meta.complexes].filter((c) => c.lat).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.dong)})</option>`).join('');
  renderListings();
  renderOutlook();
  const end = today();
  const [hist] = await Promise.all([api(`/api/transactions?from=${addMonths(end, -24)}&to=${end}`).catch(() => null), loadAll()]);
  if (hist) history = hist;
}

init();
