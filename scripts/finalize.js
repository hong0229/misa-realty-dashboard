// complexes.raw.json → complexes.json, 샘플 매물 생성. 사용: node scripts/finalize.js
const fs = require('fs');
const path = require('path');
const { ROOT, getTransactions, isExcluded } = require('../lib/sources');
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

(async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'complexes.raw.json'), 'utf8'));
  const complexes = raw.filter((c) => !isExcluded(c)).map(({ src, ...c }) => c);
  fs.writeFileSync(path.join(ROOT, 'data', 'complexes.json'), JSON.stringify(complexes, null, 1));

  const file = path.join(ROOT, 'data', 'listings.json');
  if (fs.existsSync(file)) return console.log('listings.json 유지');
  const now = new Date().toISOString().slice(0, 10);
  const from = `${Number(now.slice(0, 4)) - 1}${now.slice(4)}`;
  const { trade, rent } = await getTransactions(from, now);
  const pick = (name) => complexes.find((c) => c.name === name);
  const round = (v, unit) => Math.round(v / unit) * unit;
  // 해당 단지에서 거래가 가장 많은 면적을 기준으로 샘플 가격을 잡는다
  const rows = (list, c, f = () => true) => {
    const l = list.filter((r) => `${r.dong}|${r.jibun}` === c.id && f(r));
    const cnt = {};
    l.forEach((r) => (cnt[r.area] = (cnt[r.area] || 0) + 1));
    const top = Number(Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]);
    return l.filter((r) => r.area === top);
  };
  const areaOf = (list) => Math.round(median(list.map((r) => r.area)) * 100) / 100;
  const out = [];
  const add = (id, name, dealType, title, floor, memo, build) => {
    const c = pick(name);
    if (!c) return console.log('단지 없음', name);
    out.push({ id, complexId: c.id, dealType, title, floor, memo, isSample: true, ...build(c) });
  };
  add('S1', '미사강변센트럴자이', '매매', '남향 중층, 5호선 생활권', '중층', '샘플 매물입니다. 실제 매물로 수정해 주세요.', (c) => {
    const l = rows(trade, c); return { area: areaOf(l), price: round(median(l.map((r) => r.price)), 500) };
  });
  add('S2', '미사역파라곤', '매매', '미사역 도보권 대형 평형', '고층', '샘플 매물입니다. 실제 매물로 수정해 주세요.', (c) => {
    const l = rows(trade, c); return { area: areaOf(l), price: round(median(l.map((r) => r.price)), 500) };
  });
  add('S3', '미사강변리버뷰자이', '전세', '입주 일정 협의 가능', '중층', '샘플 매물입니다. 실제 매물로 수정해 주세요.', (c) => {
    const l = rows(rent, c, (r) => r.rent === 0); return { area: areaOf(l), deposit: round(median(l.map((r) => r.deposit)), 500) };
  });
  add('S4', '미사강변푸르지오', '월세', '보증금 조정 가능', '저층', '샘플 매물입니다. 실제 매물로 수정해 주세요.', (c) => {
    const l = rows(rent, c, (r) => r.rent > 0); return { area: areaOf(l), deposit: round(median(l.map((r) => r.deposit)), 500), rent: round(median(l.map((r) => r.rent)), 5) };
  });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(out);
})();
