/* 단지별 실거래가와 최근 시세 현황 (app.js의 history, meta, complexById, state 등 사용) */
/* global Chart */
const priceState = { complexId: '', deal: '매매', months: 12, area: '', quoteMonths: 3 };
const PRICE_MONTHS = [3, 6, 12, 24];
const DEAL_TYPES = ['매매', '전세', '월세'];

const areaKey = (a) => String(Math.round(a));
const areaLabel = (k) => `${k}㎡ (${pyArea(Number(k))}평)`;
const shortDate = (d) => d.slice(2).replace(/-/g, '.');
const fa = (a) => +Number(a).toFixed(2); // 신고 자료의 긴 소수점 정리
const sinceMonths = (n) => addMonths(today(), -n);

function dealRowsOf(id, deal) {
  if (deal === '매매') return history.trade.filter((r) => idOf(r) === id);
  return history.rent.filter((r) => idOf(r) === id && (deal === '전세' ? isJeonse(r) : !isJeonse(r)));
}
const amountOf = (deal, r) => (deal === '매매' ? r.price : deal === '전세' ? r.deposit : r.rent);
const amountText = (deal, r) => (deal === '월세' ? rentLabel(r) : won(amountOf(deal, r)));

function complexesSorted() {
  return [...meta.complexes].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

// ---- 단지별 실거래가 ----
function renderTxControls() {
  const sel = $('#txComplex');
  sel.innerHTML = complexesSorted().map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.dong)})</option>`).join('');
  sel.value = priceState.complexId;
  $('#txDeal').innerHTML = DEAL_TYPES.map((d) => `<button data-v="${d}" class="${priceState.deal === d ? 'on' : ''}">${d}</button>`).join('');
  $('#txMonths').innerHTML = PRICE_MONTHS.map((m) => `<button data-v="${m}" class="${priceState.months === m ? 'on' : ''}">${m < 12 ? `${m}개월` : `${m / 12}년`}</button>`).join('');
}

function renderTxSection() {
  if (!meta.complexes.length) return;
  if (!complexById.has(priceState.complexId)) priceState.complexId = (complexesSorted().find((c) => c.name === '미사강변센트럴자이') || complexesSorted()[0]).id;
  renderTxControls();
  const deal = priceState.deal;
  const from = sinceMonths(priceState.months);
  const all = dealRowsOf(priceState.complexId, deal).filter((r) => r.d >= from);

  const counts = new Map();
  all.forEach((r) => counts.set(areaKey(r.area), (counts.get(areaKey(r.area)) || 0) + 1));
  const areas = [...counts.keys()].sort((a, b) => a - b);
  if (priceState.area && !counts.has(priceState.area)) priceState.area = '';
  $('#txArea').innerHTML = `<option value="">전체 평형 (${all.length}건)</option>` + areas.map((k) => `<option value="${k}">${areaLabel(k)} · ${counts.get(k)}건</option>`).join('');
  $('#txArea').value = priceState.area;

  const rows = (priceState.area ? all.filter((r) => areaKey(r.area) === priceState.area) : all).sort((a, b) => b.d.localeCompare(a.d));
  const c = complexById.get(priceState.complexId);
  $('#txTitle').textContent = `${c.name} ${deal} 실거래`;

  // 요약
  const amounts = rows.map((r) => amountOf(deal, r));
  const fmt = (v) => (deal === '월세' ? `${Math.round(v)}만` : wonUnit(v));
  const stat = (label, value, sub = '') => `<div class="price-stat"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  if (!rows.length) {
    $('#txStats').innerHTML = '';
  } else {
    const latest = rows[0];
    const unit = deal === '매매' ? median(rows.map((r) => r.price / (r.area / PY))) : 0;
    const extra = deal === '월세' ? `보증금 중위 ${wonUnit(median(rows.map((r) => r.deposit)))}` : '';
    $('#txStats').innerHTML = [
      stat('최근 거래', amountText(deal, latest), `${shortDate(latest.d)} · ${fa(latest.area)}㎡ · ${latest.floor}층`),
      stat(deal === '월세' ? '월세 평균' : '평균', fmt(amounts.reduce((a, b) => a + b, 0) / amounts.length), `${rows.length}건${extra ? ` · ${extra}` : ''}`),
      stat('최고', fmt(Math.max(...amounts))),
      stat('최저', fmt(Math.min(...amounts))),
      deal === '매매' ? stat('평당가 (전용, 중위)', wonUnit(unit)) : stat('기간', `최근 ${priceState.months < 12 ? `${priceState.months}개월` : `${priceState.months / 12}년`}`),
    ].join('');
  }

  // 거래 목록
  const kind = (r) => (deal === '매매' ? (r.via === '직거래' ? '직거래' : '') : (r.contract || ''));
  $('#txTable').innerHTML = rows.length
    ? `<thead><tr><th>계약일</th><th>전용면적</th><th>층</th><th>${deal === '월세' ? '보증금 / 월세' : deal === '전세' ? '보증금' : '거래금액'}</th><th>비고</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${shortDate(r.d)}</td><td>${fa(r.area)}㎡ (${pyArea(r.area)}평)</td><td>${r.floor}층</td><td><b>${amountText(deal, r)}</b></td><td>${esc(kind(r))}</td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="empty">이 기간에 신고된 거래가 없습니다. 기간을 늘려 보세요.</td></tr></tbody>';

  drawTxScatter(rows, deal);
}

function drawTxScatter(rows, deal) {
  const prev = chartPool.get('txScatter');
  if (prev) prev.destroy();
  chartPool.delete('txScatter');
  const box = $('#box-txScatter');
  if (!rows.length) {
    box.innerHTML = '<div class="chart-empty">거래가 없습니다</div>';
    return;
  }
  box.innerHTML = '<canvas id="c-txScatter" role="img" aria-label="단지 실거래가 추이"></canvas>';
  // 거래가 많은 평형부터 최대 4개 색으로 구분하고 나머지는 '기타'로 묶는다
  const byArea = new Map();
  rows.forEach((r) => { const k = areaKey(r.area); if (!byArea.has(k)) byArea.set(k, []); byArea.get(k).push(r); });
  const groups = [...byArea].sort((a, b) => b[1].length - a[1].length);
  const main = groups.slice(0, 3);
  const rest = groups.slice(3).flatMap(([, list]) => list);
  const sets = main.map(([k, list]) => ({ label: `${k}㎡`, list }));
  if (rest.length) sets.push({ label: '기타 평형', list: rest });
  const fmt = (v) => (deal === '월세' ? `${Math.round(v)}만` : wonUnit(v));
  chartPool.set('txScatter', new Chart(document.getElementById('c-txScatter'), {
    type: 'scatter',
    data: {
      datasets: sets.map((s, i) => ({
        label: s.label,
        data: s.list.map((r) => ({ x: new Date(r.d + 'T00:00:00').getTime(), y: amountOf(deal, r), r })),
        backgroundColor: SERIES[i],
        borderColor: '#fff',
        borderWidth: 1,
        pointRadius: 5,
        pointHoverRadius: 7,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { align: 'start', labels: { boxWidth: 10, boxHeight: 10, color: COLORS.text, font: { size: 12 } } },
        tooltip: {
          backgroundColor: '#16202e', padding: 9, cornerRadius: 8,
          callbacks: { label: (ctx) => { const r = ctx.raw.r; return `${shortDate(r.d)} · ${fa(r.area)}㎡ ${r.floor}층 · ${amountText(deal, r)}`; } },
        },
      },
      scales: {
        x: { type: 'linear', grid: { display: false }, border: { color: COLORS.grid }, ticks: { color: COLORS.text, maxTicksLimit: 6, maxRotation: 0, font: { size: 11 }, callback: (v) => { const d = new Date(v); return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}`; } } },
        y: { grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: COLORS.text, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => fmt(v) } },
      },
    },
  }));
}

// ---- 최근 시세 현황 ----
function renderQuotes() {
  if (!meta.complexes.length) return;
  $('#quoteMonths').innerHTML = [3, 6, 12].map((m) => `<button data-v="${m}" class="${priceState.quoteMonths === m ? 'on' : ''}">${m < 12 ? `최근 ${m}개월` : '최근 1년'}</button>`).join('');
  const from = sinceMonths(priceState.quoteMonths);
  const avg = (list, f) => list.reduce((a, r) => a + f(r), 0) / list.length;
  const rows = [];
  for (const c of complexesSorted()) {
    if (state.dong !== '전체' && c.dong !== state.dong) continue;
    const groups = new Map();
    const add = (r, type) => {
      if (r.d < from || idOf(r) !== c.id) return;
      const k = areaKey(r.area);
      if (!groups.has(k)) groups.set(k, { trade: [], jeonse: [], wol: [] });
      groups.get(k)[type].push(r);
    };
    history.trade.forEach((r) => add(r, 'trade'));
    history.rent.forEach((r) => add(r, isJeonse(r) ? 'jeonse' : 'wol'));
    [...groups].sort((a, b) => a[0] - b[0]).forEach(([k, g]) => rows.push({ c, k, ...g }));
  }
  const cnt = (n) => `<small>${n}건</small>`;
  const body = rows.map(({ c, k, trade, jeonse, wol }) => {
    const latest = trade.slice().sort((a, b) => b.d.localeCompare(a.d))[0];
    const tAvg = trade.length ? avg(trade, (r) => r.price) : 0;
    const jAvg = jeonse.length ? avg(jeonse, (r) => r.deposit) : 0;
    const ratio = tAvg && jAvg ? `${Math.round((jAvg / tAvg) * 100)}%` : '–';
    return `<tr>
      <td class="name"><button data-complex="${esc(c.id)}">${esc(c.name)}</button><small>${esc(c.dong)}</small></td>
      <td>${areaLabel(k)}</td>
      <td>${latest ? `<b>${won(latest.price)}</b><small>${shortDate(latest.d)} · ${latest.floor}층</small>` : '–'}</td>
      <td>${trade.length ? `${won(tAvg)}${cnt(trade.length)}` : '–'}</td>
      <td>${jeonse.length ? `${won(jAvg)}${cnt(jeonse.length)}` : '–'}</td>
      <td>${wol.length ? `${won(median(wol.map((r) => r.deposit)))} / ${Math.round(median(wol.map((r) => r.rent)))}${cnt(wol.length)}` : '–'}</td>
      <td>${ratio}</td></tr>`;
  }).join('');
  $('#quoteTable').innerHTML = `<thead><tr><th>단지</th><th>전용면적</th><th>매매 최근 거래</th><th>매매 평균</th><th>전세 평균</th><th>월세 중위 (보증금/월세)</th><th>전세가율</th></tr></thead>
    <tbody>${body || '<tr><td class="empty" colspan="7">이 기간에 신고된 거래가 없습니다.</td></tr>'}</tbody>`;
  const scope = state.dong === '전체' ? '미사지구 전체' : state.dong;
  $('#quoteNote').textContent = `${scope} · ${from} 이후 실거래 기준 · ${rows.length}개 평형`;
}

function renderPrices() {
  renderTxSection();
  renderQuotes();
}

function syncPriceComplex(id) {
  if (!complexById.has(id) || priceState.complexId === id) return;
  priceState.complexId = id;
  priceState.area = '';
  renderTxSection();
}

function bindPriceEvents() {
  $('#txComplex').addEventListener('change', (e) => { priceState.complexId = e.target.value; priceState.area = ''; renderTxSection(); });
  $('#txArea').addEventListener('change', (e) => { priceState.area = e.target.value; renderTxSection(); });
  $('#txDeal').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { priceState.deal = b.dataset.v; priceState.area = ''; renderTxSection(); }
  });
  $('#txMonths').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { priceState.months = Number(b.dataset.v); renderTxSection(); }
  });
  $('#quoteMonths').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { priceState.quoteMonths = Number(b.dataset.v); renderQuotes(); }
  });
  $('#quoteTable').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-complex]');
    if (!b) return;
    priceState.complexId = b.dataset.complex;
    priceState.area = '';
    renderTxSection();
    $('#txSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
