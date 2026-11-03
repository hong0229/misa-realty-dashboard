/* 외지인 수요와 향후 5년 공급·수요 시나리오 (app.js의 api, esc, drawChart, meta 사용) */
const OUTSIDER_FROM = 2017;

function yearlyBuyers(rows) {
  const years = new Map();
  rows.forEach((r) => {
    const y = Number(r.ym.slice(0, 4));
    const a = years.get(y) || { year: y, months: 0, total: 0, local: 0, gyeonggi: 0, seoul: 0, other: 0 };
    a.months++;
    for (const k of ['total', 'local', 'gyeonggi', 'seoul', 'other']) a[k] += r[k];
    years.set(y, a);
  });
  return [...years.values()].sort((a, b) => a.year - b.year);
}
const outsiderPct = (a) => (a.total ? ((a.total - a.local) / a.total) * 100 : 0);
const sharePct = (v, a) => (a.total ? (v / a.total) * 100 : 0);

function sumBuyers(rows) {
  return rows.reduce((a, r) => {
    for (const k of ['total', 'local', 'gyeonggi', 'seoul', 'other']) a[k] += r[k];
    return a;
  }, { total: 0, local: 0, gyeonggi: 0, seoul: 0, other: 0 });
}

function renderOutsiderTiles(rows, years) {
  const shown = years.filter((a) => a.year >= OUTSIDER_FROM);
  const span = sumBuyers(rows.filter((r) => Number(r.ym.slice(0, 4)) >= OUTSIDER_FROM));
  const recent = rows.slice(-12);
  const r12 = sumBuyers(recent);
  const peak = shown.reduce((m, a) => (outsiderPct(a) > outsiderPct(m) ? a : m), shown[0]);
  const low = shown.reduce((m, a) => (outsiderPct(a) < outsiderPct(m) ? a : m), shown[0]);
  const last = rows[rows.length - 1];
  const lastLabel = `${last.ym.slice(0, 4)}년 ${Number(last.ym.slice(4))}월`;
  const tiles = [
    { label: `${OUTSIDER_FROM}년 이후 외지인 매수 비율`, value: `${outsiderPct(span).toFixed(1)}%`, sub: `하남시 ${span.total.toLocaleString()}건 중 하남시 외 거주자` },
    { label: '최근 12개월 외지인 비율', value: `${outsiderPct(r12).toFixed(1)}%`, sub: `${lastLabel}까지 · ${r12.total.toLocaleString()}건` },
    { label: '최근 12개월 서울 거주자 비율', value: `${sharePct(r12.seoul, r12).toFixed(1)}%`, sub: `경기 타지역 ${sharePct(r12.gyeonggi, r12).toFixed(1)}% · 기타 ${sharePct(r12.other, r12).toFixed(1)}%` },
    { label: '연간 최고 · 최저', value: `${outsiderPct(peak).toFixed(1)}% · ${outsiderPct(low).toFixed(1)}%`, sub: `${peak.year}년 최고, ${low.year}년 최저` },
  ];
  document.getElementById('outsiderTiles').innerHTML = tiles.map((k) => `<div class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div><div class="kpi-sub">${k.sub}</div></div>`).join('');
}

function renderOutsiderCharts(rows, years) {
  const shown = years.filter((a) => a.year >= OUTSIDER_FROM);
  const label = (a) => (a.months < 12 ? `${a.year}(~${a.months}월)` : String(a.year));
  drawChart({
    id: 'buyerMix', type: 'bar', stacked: true, noTotal: true, max: 100, title: '연도별 매수자 거주지 구성', labels: shown.map(label), barWidth: 44, allTicks: true,
    datasets: [
      { label: '하남시', data: shown.map((a) => +sharePct(a.local, a).toFixed(1)) },
      { label: '서울', data: shown.map((a) => +sharePct(a.seoul, a).toFixed(1)) },
      { label: '경기 타지역', data: shown.map((a) => +sharePct(a.gyeonggi, a).toFixed(1)) },
      { label: '기타 지역', data: shown.map((a) => +sharePct(a.other, a).toFixed(1)) },
    ],
    fmt: (v) => `${v}%`, tickFmt: (v) => `${v}%`,
  });

  // 월별 변동이 커서 최근 12개월 합계로 흐름을 본다
  const trail = rows.map((r, i) => {
    if (i < 11) return null;
    const win = sumBuyers(rows.slice(i - 11, i + 1));
    return { ym: r.ym, out: outsiderPct(win), seoul: sharePct(win.seoul, win) };
  }).filter((p) => p && Number(p.ym.slice(0, 4)) >= OUTSIDER_FROM);
  drawChart({
    id: 'outsiderTrend', title: '외지인 비율 추이', labels: trail.map((p) => `${p.ym.slice(2, 4)}.${p.ym.slice(4)}`),
    datasets: [{ label: '외지인 전체', data: trail.map((p) => +p.out.toFixed(1)) }, { label: '서울 거주자', data: trail.map((p) => +p.seoul.toFixed(1)) }],
    fmt: (v) => `${v}%`, tickFmt: (v) => `${v}%`,
  });

  const counts = new Map();
  meta.complexes.forEach((c) => counts.set(c.build, (counts.get(c.build) || 0) + 1));
  const known = [...counts.keys()].filter(Boolean);
  const buildYears = [];
  for (let y = Math.min(...known); y <= Math.max(...known); y++) buildYears.push(y); // 단지가 없는 해도 표시
  drawChart({
    id: 'moveIn', type: 'bar', title: '건축연도별 미사지구 단지 수', labels: buildYears.map(String), barWidth: 30, allTicks: true,
    datasets: [{ label: '단지 수', data: buildYears.map((y) => counts.get(y) || 0) }],
    fmt: (v) => `${v}개 단지`,
  });
}

function renderCohortTable(years) {
  const byYear = new Map(years.map((a) => [a.year, a]));
  const groups = new Map();
  meta.complexes.forEach((c) => {
    if (!groups.has(c.build)) groups.set(c.build, []);
    groups.get(c.build).push(c);
  });
  const rows = [...groups.keys()].filter(Boolean).sort((a, b) => a - b).map((y) => {
    const a = byYear.get(y);
    const names = groups.get(y).map((c) => esc(c.name)).sort((p, q) => p.localeCompare(q, 'ko')).join(', ');
    return `<tr><td>${y}년</td><td class="names">${names}</td><td>${groups.get(y).length}</td><td>${a ? `${outsiderPct(a).toFixed(1)}%` : '–'}</td><td>${a ? `${sharePct(a.seoul, a).toFixed(1)}%` : '–'}</td></tr>`;
  }).join('');
  document.getElementById('cohortTable').innerHTML = `<thead><tr><th>건축연도</th><th class="names">단지</th><th>단지 수</th><th>그 해 하남시 외지인 비율</th><th>그 해 서울 거주자 비율</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderForecast(o) {
  const demand = Math.round(o.population.value * o.demandRate);
  const [a, b] = o.scenarios;
  drawChart({
    id: 'supplyDemand', type: 'bar', title: '하남시 향후 5년 공급과 적정 수요', labels: o.years.map((y) => `${y}년`), barWidth: 30, allTicks: true,
    datasets: [
      { label: a.name, data: a.supply },
      { label: b.name, data: b.supply },
      { label: '적정 수요', type: 'line', color: '#16202e', dashed: true, data: o.years.map(() => demand) },
    ],
    fmt: (v) => `${v.toLocaleString()}호`,
  });

  const sum = (s) => s.reduce((x, y) => x + y, 0);
  const total = demand * o.years.length;
  const cells = (list) => list.map((v) => `<td>${v ? v.toLocaleString() : '확인 물량 없음'}</td>`).join('');
  const ratio = (s) => `${(sum(s) / total).toFixed(1)}배`;
  document.getElementById('supplyTable').innerHTML = `<thead><tr><th>구분 (호)</th>${o.years.map((y) => `<th>${y}</th>`).join('')}<th>5년 합계</th><th>수요 대비</th></tr></thead><tbody>
    ${o.scenarios.map((s) => `<tr><td>${esc(s.name)}</td>${cells(s.supply)}<td><b>${sum(s.supply).toLocaleString()}</b></td><td><b>${ratio(s.supply)}</b></td></tr>`).join('')}
    <tr class="total"><td>적정 수요 (인구 × 0.5%)</td>${o.years.map(() => `<td>${demand.toLocaleString()}</td>`).join('')}<td>${total.toLocaleString()}</td><td>–</td></tr></tbody>`;

  const icon = { up: ['▲', '상승 요인', 'up'], down: ['▼', '하락 요인', 'down'], flat: ['■', '중립', 'flat'], mixed: ['◆', '혼재', 'flat'] };
  const line = (name, v) => {
    const [ch, word, cls] = icon[v.dir];
    return `<div class="phase-line"><span class="phase-name">${name}</span><span class="delta ${cls}">${ch} ${word}</span><p>${esc(v.text)}</p></div>`;
  };
  document.getElementById('phases').innerHTML = o.phases.map((p) => `<div class="phase"><div class="phase-period">${esc(p.period)}</div><h3>${esc(p.title)}</h3><p class="phase-supply">${esc(p.supply)}</p>${line('전세', p.jeonse)}${line('매매', p.sale)}${line('외지인', p.outsider)}</div>`).join('');

  document.getElementById('outlookNotes').innerHTML = `
    <li>적정 수요: 하남시 인구 ${o.population.value.toLocaleString()}명(${esc(o.population.asOf)}) × 0.5% = 연 ${demand.toLocaleString()}호. ${esc(o.demandNote)}</li>
    ${o.scenarios.map((s) => `<li>${esc(s.name)}: ${esc(s.basis)}</li>`).join('')}
    ${o.limits.map((l) => `<li>${esc(l)}</li>`).join('')}
    <li>자료: ${o.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(', ')} (${esc(o.asOf)} 기준).</li>`;
}

async function renderOutlook() {
  const box = document.getElementById('outlookError');
  try {
    const { buyers, outlook } = await api('/api/outlook');
    if (!buyers.length) throw new Error('매수자 거주지 자료가 없습니다');
    const years = yearlyBuyers(buyers);
    renderOutsiderTiles(buyers, years);
    renderOutsiderCharts(buyers, years);
    renderCohortTable(years);
    renderForecast(outlook);
    box.hidden = true;
  } catch (e) {
    box.hidden = false;
    box.textContent = `외지인·전망 자료를 불러오지 못했습니다: ${e.message}`;
  }
}
