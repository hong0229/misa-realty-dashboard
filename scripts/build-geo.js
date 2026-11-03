// 단지 좌표(data/complexes.json)와 주변시설(data/poi.json)을 만든다. 한 번 실행하면 된다.
// 사용: node scripts/build-geo.js
const fs = require('fs');
const path = require('path');
const { ROOT, getTransactions } = require('../lib/sources');

const BBOX = '37.525,127.15,37.60,127.26'; // 미사지구와 생활권
const VIEWBOX = '127.165,37.585,127.235,37.54';
const UA = { 'User-Agent': 'misa-realty-dashboard/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(q) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(170000),
      });
      const text = await res.text();
      if (text.trim().startsWith('{')) return JSON.parse(text).elements;
      console.log('overpass 재시도', res.status);
    } catch (e) {
      console.log('overpass 재시도', e.message);
    }
    await sleep(15000);
  }
  throw new Error('Overpass 실패');
}

const norm = (s) => s.replace(/\s+/g, '').replace(/엔에이치에프|아파트|\(.*?\)/g, '').replace('이편한세상', 'e편한세상').toLowerCase();
const coord = (e) => (e.center ? [e.center.lat, e.center.lon] : [e.lat, e.lon]);

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(q)}`;
  await sleep(1200);
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  const list = await res.json();
  return list[0] ? [Number(list[0].lat), Number(list[0].lon)] : null;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const from = `${Number(today.slice(0, 4)) - 3}-01-01`;
  console.log('실거래 수집', from, today);
  const { trade, rent } = await getTransactions(from, today);
  console.log('매매', trade.length, '전월세', rent.length);

  const complexes = {};
  const add = (r) => {
    const id = `${r.dong}|${r.jibun}`;
    const c = (complexes[id] = complexes[id] || { id, dong: r.dong, jibun: r.jibun, names: {}, build: r.build, road: '' });
    c.names[r.apt] = (c.names[r.apt] || 0) + 1;
    if (r.road) c.road = r.road;
  };
  trade.forEach(add);
  rent.forEach(add);

  console.log('OSM 단지 조회');
  const res = await overpass(`[out:json][timeout:150];(nwr["name"]["landuse"="residential"](${BBOX});nwr["name"]["building"="apartments"](${BBOX});nwr["name"]["building"="yes"]["name"~"아파트|단지"](${BBOX}););out center tags;`);
  const osm = res.filter((e) => !/^\d+동$/.test(e.tags.name)).map((e) => ({ n: norm(e.tags.name), c: coord(e) }));

  const out = [];
  for (const c of Object.values(complexes)) {
    const name = Object.entries(c.names).sort((a, b) => b[1] - a[1])[0][0];
    const keys = Object.keys(c.names).map(norm);
    let hit = osm.find((o) => keys.includes(o.n));
    let src = 'osm';
    let at = hit && hit.c;
    if (!at) {
      src = 'nominatim';
      for (const q of [name, name.replace(/엔에이치에프/, ''), c.road && `${c.road} 하남시`, `${c.dong} ${c.jibun} 하남시`].filter(Boolean)) {
        try { at = await nominatim(q); } catch { at = null; }
        if (at) { src = `nominatim:${q}`; break; }
      }
    }
    out.push({ id: c.id, dong: c.dong, jibun: c.jibun, name, build: c.build, road: c.road, lat: at ? at[0] : null, lon: at ? at[1] : null, src: at ? src : 'none' });
    console.log(at ? 'OK ' : 'NO ', c.dong, name, c.jibun, c.road, at ? at.map((x) => x.toFixed(4)).join(',') : '', src);
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'complexes.raw.json'), JSON.stringify(out, null, 1));

  console.log('주변시설 조회');
  const poi = await overpass(`[out:json][timeout:150];(
    nwr["amenity"="school"](${BBOX});
    nwr["railway"="station"](${BBOX});
    node["station"="subway"](${BBOX});
    node["highway"="bus_stop"]["name"](${BBOX});
    nwr["shop"~"^(supermarket|department_store|mall)$"]["name"](${BBOX});
    nwr["amenity"="cafe"]["name"](${BBOX});
    nwr["amenity"~"^(townhall|police|post_office|library|hospital|fire_station|community_centre|public_building)$"]["name"](${BBOX});
    nwr["office"="government"]["name"](${BBOX});
    nwr["leisure"="park"]["name"](${BBOX});
  );out center tags;`);
  const pois = [];
  const seen = new Set();
  for (const e of poi) {
    const t = e.tags || {};
    const n = t.name;
    if (!n) continue;
    let k = null;
    if (t.amenity === 'school') k = /초등/.test(n) ? 'elem' : /중학/.test(n) ? 'mid' : /고등/.test(n) ? 'high' : null;
    else if (t.railway === 'station' || t.station === 'subway') k = 'subway';
    else if (t.highway === 'bus_stop') k = 'bus';
    else if (t.shop === 'supermarket') k = 'mart';
    else if (t.shop === 'department_store' || t.shop === 'mall') k = 'dept';
    else if (t.amenity === 'cafe') k = 'cafe';
    else if (t.leisure === 'park') k = 'park';
    else if (t.amenity === 'hospital') k = 'hospital';
    else k = 'public';
    if (!k) continue;
    const [lat, lon] = coord(e);
    const key = `${k}|${n}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pois.push({ k, n, lat: +lat.toFixed(6), lon: +lon.toFixed(6) });
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'poi.json'), JSON.stringify(pois));
  const count = {};
  pois.forEach((p) => (count[p.k] = (count[p.k] || 0) + 1));
  console.log(count);
}

main().catch((e) => { console.error(e); process.exit(1); });
