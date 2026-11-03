// GitHub Pages용 정적 사이트(docs/)를 만든다. API 키는 이 PC에서만 쓰고 결과 파일에는 넣지 않는다.
// 사용: node scripts/build-pages.js
const fs = require('fs');
const path = require('path');
const { ROOT, getTransactions, getRebSeries, getBuyerResidence, MISA_DONGS } = require('../lib/sources');
const { analyze } = require('../lib/location');

const OUT = path.join(ROOT, 'docs');
const DATA = path.join(OUT, 'data');
const FROM = '2023-01-01';

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', name), 'utf8'));
const writeData = (name, value) => fs.writeFileSync(path.join(DATA, `${name}.json`), JSON.stringify(value));

async function marketFor(weekly) {
  const load = (table, region) => getRebSeries(table, region);
  const sale = weekly ? 'saleWeekly' : 'saleMonthly';
  const jeonse = weekly ? 'jeonseWeekly' : 'jeonseMonthly';
  return {
    saleH: await load(sale, '하남시'),
    saleG: await load(sale, '경기'),
    jeonseH: await load(jeonse, '하남시'),
    jeonseG: await load(jeonse, '경기'),
    ratioH: await load('jeonseRatio', '하남시'),
    ratioG: await load('jeonseRatio', '경기'),
    volume: await load('volume', '하남시'),
    unsold: await load('unsold', '하남시'),
    demand: await load('demandWeekly', '동부1권'),
    rentH: await load('rentMonthly', '하남시'),
    rentG: await load('rentMonthly', '경기'),
    presaleG: await load('presale', '경기'),
    presaleM: await load('presale', '수도권'),
  };
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  const today = new Date().toISOString().slice(0, 10);
  const complexes = readJson('complexes.json');
  writeData('meta', { dongs: MISA_DONGS, complexes, development: readJson('development.json') });
  writeData('listings', readJson('listings.json'));
  writeData('transactions', await getTransactions(FROM, today));
  writeData('market_week', await marketFor(true));
  writeData('market_month', await marketFor(false));
  writeData('outlook', { buyers: await getBuyerResidence(), outlook: readJson('outlook.json') });

  const location = {};
  for (const c of complexes) if (c.lat) location[`${c.lat},${c.lon}`] = analyze(c.lat, c.lon);
  writeData('location', location);
  writeData('site', { builtAt: today, from: FROM });

  const indexFile = path.join(OUT, 'index.html');
  const html = fs.readFileSync(indexFile, 'utf8').replace('<head>', '<head>\n<script>window.STATIC_SITE = true; document.documentElement.classList.add(\'static-site\');</script>');
  fs.writeFileSync(indexFile, html);

  const leaked = [process.env.DATA_GO_KR_KEY, process.env.REB_KEY].filter(Boolean);
  for (const name of fs.readdirSync(DATA).concat(['index.html'])) {
    const file = name === 'index.html' ? indexFile : path.join(DATA, name);
    const text = fs.readFileSync(file, 'utf8');
    if (leaked.some((k) => text.includes(k))) throw new Error(`API 키가 ${name}에 포함되었습니다`);
  }
  const size = fs.readdirSync(DATA).reduce((a, n) => a + fs.statSync(path.join(DATA, n)).size, 0);
  console.log(`완료: docs/ (데이터 ${Math.round(size / 1024)}KB, ${FROM} ~ ${today})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
