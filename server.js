// 미사지구 부동산 대시보드 로컬 서버 (의존성 없음)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT, MISA_DONGS, getTransactions, getRebSeries, getBuyerResidence } = require('./lib/sources');
const { analyze } = require('./lib/location');

const PORT = Number(process.env.PORT) || 8787;
const HOST = '127.0.0.1'; // 매물 수정 API가 있어 이 PC에서만 접속되도록 한다
const PUBLIC = path.join(ROOT, 'public');
const LISTINGS = path.join(ROOT, 'data', 'listings.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon' };

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 100000) { reject(new Error('요청이 너무 큽니다')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('JSON 형식 오류')); }
    });
  });
}

const LISTING_FIELDS = ['complexId', 'title', 'dealType', 'price', 'deposit', 'rent', 'area', 'floor', 'memo', 'isSample', 'building', 'supply', 'direction', 'confirmed', 'naverId', 'source'];
function cleanListing(body) {
  const out = {};
  for (const k of LISTING_FIELDS) if (body[k] !== undefined) out[k] = body[k];
  for (const k of ['price', 'deposit', 'rent', 'area']) if (out[k] !== undefined) out[k] = Number(out[k]) || 0;
  if (!out.complexId || !['매매', '전세', '월세'].includes(out.dealType)) throw new Error('단지와 거래유형을 선택해 주세요');
  return out;
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (p === '/api/meta') {
    const complexes = readJson(path.join(ROOT, 'data', 'complexes.json'), []);
    return send(res, 200, { dongs: MISA_DONGS, complexes, development: readJson(path.join(ROOT, 'data', 'development.json'), {}) });
  }
  if (p === '/api/transactions') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!isDate(from) || !isDate(to) || from > to) return send(res, 400, { error: '날짜를 확인해 주세요' });
    return send(res, 200, await getTransactions(from, to));
  }
  if (p === '/api/market') {
    const weekly = url.searchParams.get('cycle') === 'week';
    const sale = weekly ? 'saleWeekly' : 'saleMonthly';
    const jeonse = weekly ? 'jeonseWeekly' : 'jeonseMonthly';
    const load = async (table, region) => {
      try { return await getRebSeries(table, region); } catch (e) { console.warn(table, region, e.message); return []; }
    };
    const [saleH, saleG, jeonseH, jeonseG, ratioH, ratioG, volume, unsold, rentH, rentG, presaleG, presaleM] = await Promise.all([
      load(sale, '하남시'), load(sale, '경기'), load(jeonse, '하남시'), load(jeonse, '경기'),
      load('jeonseRatio', '하남시'), load('jeonseRatio', '경기'), load('volume', '하남시'), load('unsold', '하남시'),
      load('rentMonthly', '하남시'), load('rentMonthly', '경기'), load('presale', '경기'), load('presale', '수도권'),
    ]);
    const demand = await load('demandWeekly', '동부1권');
    return send(res, 200, { saleH, saleG, jeonseH, jeonseG, ratioH, ratioG, volume, unsold, demand, rentH, rentG, presaleG, presaleM });
  }
  if (p === '/api/outlook') {
    return send(res, 200, { buyers: await getBuyerResidence(), outlook: readJson(path.join(ROOT, 'data', 'outlook.json'), {}) });
  }
  if (p === '/api/location') {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!lat || !lon) return send(res, 400, { error: '좌표가 없습니다' });
    return send(res, 200, analyze(lat, lon));
  }
  if (p === '/api/listings' && req.method === 'GET') return send(res, 200, readJson(LISTINGS, []));
  if (p === '/api/listings' && req.method === 'POST') {
    const list = readJson(LISTINGS, []);
    const item = { id: `L${Date.now()}`, ...cleanListing(await readBody(req)), isSample: false };
    list.unshift(item);
    fs.writeFileSync(LISTINGS, JSON.stringify(list, null, 2));
    return send(res, 201, item);
  }
  const m = p.match(/^\/api\/listings\/([\w-]+)$/);
  if (m && (req.method === 'PUT' || req.method === 'DELETE')) {
    const list = readJson(LISTINGS, []);
    const i = list.findIndex((x) => x.id === m[1]);
    if (i < 0) return send(res, 404, { error: '매물을 찾을 수 없습니다' });
    if (req.method === 'DELETE') list.splice(i, 1);
    else list[i] = { ...list[i], ...cleanListing(await readBody(req)), isSample: false };
    fs.writeFileSync(LISTINGS, JSON.stringify(list, null, 2));
    return send(res, 200, list[i] || { ok: true });
  }
  return send(res, 404, { error: '없는 경로입니다' });
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
  try {
    await handleApi(req, res, url);
  } catch (err) {
    console.error(err);
    send(res, 502, { error: err.message });
  }
}).listen(PORT, HOST, () => console.log(`미사지구 대시보드 실행 중: http://localhost:${PORT}`));
