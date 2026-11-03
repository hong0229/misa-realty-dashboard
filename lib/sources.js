// 국토부 실거래가·한국부동산원 R-ONE 수집 + 파일 캐시
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const LAWD_CD = '41450'; // 경기도 하남시
const MISA_DONGS = ['망월동', '풍산동', '선동'];
// 법정동은 풍산동이지만 미사강변도시 밖(세미로 일대)인 단지
const EXCLUDED_NAME = /하남힐즈파크푸르지오/;
const isExcluded = (r) => EXCLUDED_NAME.test(r.apt || r.name || '');

const HOUR = 3600 * 1000;
const RECENT_TTL = 12 * HOUR;

function readCache(name) {
  try {
    const file = path.join(CACHE_DIR, name + '.json');
    return { data: JSON.parse(fs.readFileSync(file, 'utf8')), mtime: fs.statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

function writeCache(name, data) {
  fs.writeFileSync(path.join(CACHE_DIR, name + '.json'), JSON.stringify(data));
}

// ttl이 null이면 한 번 받은 뒤 다시 받지 않는다. 원본 API가 실패하면 오래된 캐시라도 돌려준다.
async function cached(name, ttl, loader) {
  const hit = readCache(name);
  if (hit && (ttl === null || Date.now() - hit.mtime < ttl)) return hit.data;
  try {
    const data = await loader();
    writeCache(name, data);
    return data;
  } catch (err) {
    if (hit) {
      console.warn(`[캐시 사용] ${name}: ${err.message}`);
      return hit.data;
    }
    throw err;
  }
}

const tag = (xml, key) => {
  const m = xml.match(new RegExp(`<${key}>([^<]*)</${key}>`));
  return m ? m[1].trim() : '';
};
const num = (s) => Number(String(s).replace(/,/g, '')) || 0;
const pad = (n) => String(n).padStart(2, '0');

async function fetchMolit(api, op, ym) {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new Error('.env에 DATA_GO_KR_KEY가 없습니다');
  const items = [];
  for (let page = 1; page < 20; page++) {
    const url = `https://apis.data.go.kr/1613000/${api}/${op}?serviceKey=${key}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&pageNo=${page}&numOfRows=1000`;
    let res;
    let xml;
    for (let attempt = 0; attempt < 5; attempt++) {
      res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      xml = await res.text();
      if (res.status !== 429 && !xml.includes('LIMITED_NUMBER_OF_SERVICE')) break;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); // 호출 속도 제한 대기
    }
    const code = tag(xml, 'resultCode');
    if (code !== '000') throw new Error(`공공데이터포털 오류 ${code || res.status}: ${tag(xml, 'resultMsg') || xml.slice(0, 120)}`);
    const found = [...xml.matchAll(/<item>(.*?)<\/item>/gs)].map((m) => m[1]);
    items.push(...found);
    if (found.length < 1000) break;
  }
  return items;
}

const dateOf = (s) => `${tag(s, 'dealYear')}-${pad(num(tag(s, 'dealMonth')))}-${pad(num(tag(s, 'dealDay')))}`;

// 최근 3개월은 신고기한(30일) 때문에 계속 늘어나므로 12시간마다 갱신, 그 이전 달은 고정
function ttlForMonth(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  const now = new Date();
  const age = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  return age <= 3 ? RECENT_TTL : null;
}

function getTrades(ym) {
  return cached(`trade_${ym}`, ttlForMonth(ym), async () => {
    const items = await fetchMolit('RTMSDataSvcAptTrade', 'getRTMSDataSvcAptTrade', ym);
    const rows = [];
    for (const s of items) {
      const dong = tag(s, 'umdNm');
      if (!MISA_DONGS.includes(dong)) continue;
      if (tag(s, 'cdealType')) continue; // 해제된 거래 제외
      rows.push({
        d: dateOf(s),
        apt: tag(s, 'aptNm'),
        dong,
        jibun: tag(s, 'jibun'),
        area: num(tag(s, 'excluUseAr')),
        floor: num(tag(s, 'floor')),
        price: num(tag(s, 'dealAmount')),
        build: num(tag(s, 'buildYear')),
        via: tag(s, 'dealingGbn'),
      });
    }
    return rows;
  });
}

function getRents(ym) {
  return cached(`rent_${ym}`, ttlForMonth(ym), async () => {
    const items = await fetchMolit('RTMSDataSvcAptRent', 'getRTMSDataSvcAptRent', ym);
    const rows = [];
    for (const s of items) {
      const dong = tag(s, 'umdNm');
      if (!MISA_DONGS.includes(dong)) continue;
      rows.push({
        d: dateOf(s),
        apt: tag(s, 'aptNm'),
        dong,
        jibun: tag(s, 'jibun'),
        area: num(tag(s, 'excluUseAr')),
        floor: num(tag(s, 'floor')),
        deposit: num(tag(s, 'deposit')),
        rent: num(tag(s, 'monthlyRent')),
        build: num(tag(s, 'buildYear')),
        road: tag(s, 'roadnm'),
        contract: tag(s, 'contractType'),
      });
    }
    return rows;
  });
}

function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4));
  const endM = Number(to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}${pad(m)}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  }));
  return out;
}

async function getTransactions(from, to) {
  const months = monthsBetween(from, to);
  const inRange = (r) => r.d >= from && r.d <= to && !isExcluded(r);
  const trade = (await mapLimit(months, 2, getTrades)).flat().filter(inRange);
  const rent = (await mapLimit(months, 2, getRents)).flat().filter(inRange);
  return { trade, rent };
}

// ---- 한국부동산원 R-ONE ----
const REB_TABLES = {
  saleWeekly: { id: 'T244183132827305', cycle: 'WK', cls: { 하남시: 50108, 경기: 50016 } },
  jeonseWeekly: { id: 'T247713133046872', cycle: 'WK', cls: { 하남시: 50108, 경기: 50016 } },
  demandWeekly: { id: 'T248163133074619', cycle: 'WK', cls: { 동부1권: 50020, 경기: 50016 } },
  saleMonthly: { id: 'A_2024_00045', cycle: 'MM', cls: { 하남시: 520038, 경기: 500009 } },
  jeonseMonthly: { id: 'A_2024_00050', cycle: 'MM', cls: { 하남시: 520038, 경기: 500009 } },
  demandMonthly: { id: 'A_2024_00076', cycle: 'MM', cls: {} },
  rentMonthly: { id: 'A_2024_00055', cycle: 'MM', cls: { 하남시: 520038, 경기: 500009 } },
  presale: { id: 'T249233134451237', cycle: 'MM', cls: { 경기: 50038, 수도권: 50006 } }, // 시·도 단위까지만 제공
  jeonseRatio: { id: 'A_2024_00073', cycle: 'MM', cls: { 하남시: 520038, 경기: 500009 } },
  volume: { id: 'A_2024_00554', cycle: 'MM', cls: { 하남시: 510105 }, itm: 100001 },
  unsold: { id: 'T237973129847263', cycle: 'MM', cls: { 하남시: 50255 } },
};

async function fetchReb(params) {
  const key = process.env.REB_KEY;
  if (!key) throw new Error('.env에 REB_KEY가 없습니다');
  const rows = [];
  for (let page = 1; page < 30; page++) {
    const qs = new URLSearchParams({ KEY: key, Type: 'json', pSize: '1000', pIndex: String(page), ...params });
    const res = await fetch(`https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?${qs}`, { signal: AbortSignal.timeout(30000) });
    const json = await res.json();
    const body = json.SttsApiTblData;
    if (!body) {
      if (json.RESULT && json.RESULT.CODE === 'INFO-200') break;
      throw new Error(`한국부동산원 오류: ${JSON.stringify(json).slice(0, 160)}`);
    }
    const found = body[1].row;
    rows.push(...found);
    if (rows.length >= body[0].head[0].list_total_count || !found.length) break;
  }
  return rows;
}

// 지역별 전체 시계열을 받아 캐시한다. 기간 필터는 응답 단계에서 처리
function getRebSeries(tableKey, region) {
  const t = REB_TABLES[tableKey];
  const clsId = t.cls[region];
  return cached(`reb_${tableKey}_${clsId}`, RECENT_TTL, async () => {
    const rows = await fetchReb({ STATBL_ID: t.id, DTACYCLE_CD: t.cycle, CLS_ID: String(clsId) });
    return rows
      .filter((r) => !t.itm || r.ITM_ID === t.itm)
      .map((r) => ({ t: r.WRTTIME_IDTFR_ID, label: r.WRTTIME_DESC, v: r.DTA_VAL }))
      .sort((a, b) => a.t.localeCompare(b.t));
  });
}

// 하남시 아파트 매수자 거주지별 거래(월). 부동산원은 시·군·구까지만 제공한다
function getBuyerResidence() {
  return cached('reb_buyerResidence', RECENT_TTL, async () => {
    const rows = await fetchReb({ STATBL_ID: 'A_2024_00609', DTACYCLE_CD: 'MM', GRP_ID: '910105', ITM_ID: '100001', START_WRTTIME: '201401', END_WRTTIME: '209912' });
    const key = { 500001: 'total', 500002: 'local', 500003: 'gyeonggi', 500004: 'seoul', 500005: 'other' };
    const months = new Map();
    for (const r of rows) {
      const k = key[r.CLS_ID];
      if (!k) continue;
      const m = months.get(r.WRTTIME_IDTFR_ID) || { ym: r.WRTTIME_IDTFR_ID, total: 0, local: 0, gyeonggi: 0, seoul: 0, other: 0 };
      m[k] = r.DTA_VAL || 0;
      months.set(r.WRTTIME_IDTFR_ID, m);
    }
    return [...months.values()].sort((a, b) => a.ym.localeCompare(b.ym));
  });
}

module.exports = {
  getBuyerResidence,
  ROOT, MISA_DONGS, REB_TABLES, isExcluded, getTransactions, getRebSeries, monthsBetween, mapLimit, cached, RECENT_TTL,
};
