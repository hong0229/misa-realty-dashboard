// 좌표 기준 입지분석: OSM 주변시설과 주요 광역거점까지의 거리 계산
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./sources');

const poiFile = path.join(ROOT, 'data', 'poi.json');
let pois = null;

// 하남 구간 5호선만 사용 (한강 북쪽 경의중앙선 역은 직선거리만 가까워 제외)
const SUBWAY = { 미사: '미사역 (5호선)', 강일: '강일역 (5호선)', 하남풍산: '하남풍산역 (5호선)', 하남시청: '하남시청역 (5호선)', 하남검단산: '하남검단산역 (5호선)', 상일동: '상일동역 (5호선)', 고덕: '고덕역 (5호선)' };
const KEEP = {
  mart: /이마트|E-?Mart|홈플러스|트레이더스|롯데마트|코스트코|GS더프레시|노브랜드|하나로마트|H마트/i,
  dept: /스타필드|현대.*아울렛|스페이스원|백화점/,
  cafe: /커피|카페|스타벅스|starbucks|이디야|투썸|메가|컴포즈|빽다방|폴바셋|엔제리너스|할리스|파스쿠찌|coffee|cafe/i,
  public: /행정복지센터|시청|우체국|경찰서|파출소|지구대|소방서|119안전센터|보건소|시립.*도서관|선거관리위원회/,
  hospital: /병원|의원|보건소/,
  park: /공원/,
};
const DROP = {
  cafe: /노래|만화|키즈|ex카페/,
  public: /남양주|구리|서울|고덕|상일|강일|와부/,
  hospital: /^병원$|^한의원$|마트|구급/,
  mart: /편의점/,
};
const RENAME = [[/^E-?Mart$/i, '이마트'], [/^Starbucks$/i, '스타벅스'], [/^하남스타필드$/, '스타필드 하남']];
const SCHOOL_KINDS = ['elem', 'mid', 'high'];
// 서울 강동구 소재 학교는 하남 학군이 아니므로 제외
const SEOUL_SCHOOL = /^서울|^강명|^강동|^강일|^고덕|^상일|^배재|^한영|^명일|^광문|^한국애니메이션/;

function keepPoi(p) {
  if (p.lat > 37.5785) return false; // 한강 북쪽(남양주)
  if (p.k === 'subway') return Boolean(SUBWAY[p.n]);
  if (SCHOOL_KINDS.includes(p.k)) return p.lon >= 127.165 && !/후문|정문|데크/.test(p.n) && !SEOUL_SCHOOL.test(p.n);
  if (KEEP[p.k] && !KEEP[p.k].test(p.n)) return false;
  if (DROP[p.k] && DROP[p.k].test(p.n)) return false;
  return true;
}

function loadPois() {
  if (pois) return pois;
  const extraFile = path.join(ROOT, 'data', 'poi.extra.json');
  const extra = fs.existsSync(extraFile) ? JSON.parse(fs.readFileSync(extraFile, 'utf8')) : [];
  pois = [...JSON.parse(fs.readFileSync(poiFile, 'utf8')), ...extra].filter(keepPoi).map((p) => {
    let n = p.k === 'subway' ? SUBWAY[p.n] : p.n;
    for (const [re, to] of RENAME) n = n.replace(re, to);
    return { ...p, n };
  });
  return pois;
}

// 지하철 외 광역 거점. 차량 시간은 직선거리 기준 추정치
const HUBS = {
  ktx: [
    { n: '청량리역 (KTX 강릉·중앙선)', lat: 37.5803, lon: 127.0488 },
    { n: '서울역 (KTX 경부·호남)', lat: 37.5547, lon: 126.9707 },
    { n: '수서역 (SRT)', lat: 37.4873, lon: 127.1016 },
  ],
  gtx: [
    { n: '수서역 (GTX-A 운행 중)', lat: 37.4873, lon: 127.1016 },
    { n: '삼성역 (GTX-A 정차 예정)', lat: 37.5088, lon: 127.0631 },
  ],
};

function distM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 도보: 직선거리에 우회계수 1.3, 분속 75m / 차량: 우회계수 1.3, 시속 35km
const walkMin = (m) => Math.max(1, Math.round((m * 1.3) / 75));
const driveMin = (m) => Math.max(1, Math.round(((m * 1.3) / 35000) * 60));

function nearest(kinds, lat, lon, limit, exclude) {
  const seen = new Set();
  return loadPois()
    .filter((p) => kinds.includes(p.k) && !(exclude && exclude.test(p.n)))
    .map((p) => ({ ...p, m: Math.round(distM(lat, lon, p.lat, p.lon)) }))
    .sort((a, b) => a.m - b.m)
    .filter((p) => {
      const key = p.n.replace(/\s/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((p) => ({ n: p.n, m: p.m, walk: walkMin(p.m), drive: driveMin(p.m), lat: p.lat, lon: p.lon, k: p.k }));
}

function analyze(lat, lon) {
  const hub = (h) => {
    const m = Math.round(distM(lat, lon, h.lat, h.lon));
    return { n: h.n, m, drive: driveMin(m), lat: h.lat, lon: h.lon };
  };
  return {
    subway: nearest(['subway'], lat, lon, 3),
    bus: nearest(['bus'], lat, lon, 4),
    ktx: HUBS.ktx.map(hub),
    gtx: HUBS.gtx.map(hub),
    elem: nearest(['elem'], lat, lon, 3),
    mid: nearest(['mid'], lat, lon, 3),
    high: nearest(['high'], lat, lon, 3),
    mart: nearest(['mart'], lat, lon, 3),
    dept: nearest(['dept'], lat, lon, 3),
    cafe: nearest(['cafe'], lat, lon, 3),
    public: nearest(['public'], lat, lon, 4),
    hospital: nearest(['hospital'], lat, lon, 2),
    park: nearest(['park'], lat, lon, 2),
  };
}

module.exports = { analyze };
