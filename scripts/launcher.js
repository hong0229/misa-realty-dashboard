// 실행 파일(.exe)의 시작점. 실행 파일만 따로 복사해도 열리도록 다음 순서로 실행할 폴더를 정한다.
// 1) 실행 파일 옆에 프로젝트 파일이 있으면 그 폴더
// 2) 빌드한 PC의 원래 프로젝트 폴더가 있으면 그 폴더 (바탕화면에 복사한 경우)
// 3) 둘 다 없으면 내장된 파일을 사용자 폴더에 풀어 실행. API 키(.env)가 없으면 공개용 고정 자료로 연다
const { createRequire } = require('module');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EXE_DIR = path.dirname(process.execPath);
const APP_DIR = path.join(process.env.LOCALAPPDATA || EXE_DIR, 'MisaDashboard');
const KEEP_FILES = ['.env', 'data/listings.json']; // 다시 풀 때 덮어쓰지 않는 사용자 파일

function loadBundle() {
  try {
    const sea = require('node:sea');
    return JSON.parse(sea.getAsset('bundle.json', 'utf8'));
  } catch {
    return null; // node로 직접 실행하는 경우
  }
}

const hasProject = (dir) => fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, '.env'));

function extract(bundle) {
  const stamp = path.join(APP_DIR, '.version');
  const current = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8') : '';
  if (current === bundle.version) return;
  for (const [rel, b64] of Object.entries(bundle.files)) {
    const file = path.join(APP_DIR, rel);
    if (KEEP_FILES.includes(rel) && fs.existsSync(file)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  }
  fs.writeFileSync(stamp, bundle.version);
}

function readPort(root) {
  try {
    const m = fs.readFileSync(path.join(root, '.env'), 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
    if (m) return Number(m[1]);
  } catch { /* 기본 포트 사용 */ }
  return 8787;
}

const openBrowser = (url) => spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();

function failAndWait(message) {
  console.error(`\n[오류] ${message}\n`);
  console.error('이 창은 30초 뒤에 닫힙니다.');
  setTimeout(() => process.exit(1), 30000);
}

async function isRunning(url) {
  try {
    const res = await fetch(`${url}/logo.svg`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

// API 키가 없을 때: 공개 사이트와 같은 고정 자료(docs)를 그대로 보여 준다
function serveStatic(dir, port) {
  http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  }).listen(port, '127.0.0.1');
}

async function main() {
  const bundle = loadBundle();
  let root = null;
  if (fs.existsSync(path.join(EXE_DIR, 'server.js'))) root = EXE_DIR;
  else if (bundle && bundle.projectRoot && hasProject(bundle.projectRoot)) root = bundle.projectRoot;
  else if (bundle) {
    extract(bundle);
    root = APP_DIR;
  } else {
    return failAndWait('실행에 필요한 파일을 찾지 못했습니다.');
  }

  const live = fs.existsSync(path.join(root, '.env'));
  const port = readPort(root);
  const url = `http://localhost:${port}`;
  if (await isRunning(url)) {
    // 이미 켜져 있으면 서버를 또 띄우지 않고 화면만 연다
    openBrowser(url);
    return;
  }
  process.on('uncaughtException', (err) => {
    failAndWait(err.code === 'EADDRINUSE' ? `${port}번 포트를 다른 프로그램이 사용 중입니다.` : err.message);
  });
  console.log('센트럴자이 미사금호부동산 · 미사지구 부동산 대시보드');
  console.log('이 창을 닫으면 대시보드가 종료됩니다.\n');
  if (live) {
    console.log(`실행 폴더: ${root}`);
    process.chdir(root);
    createRequire(path.join(root, 'server.js'))('./server.js');
  } else {
    console.log('API 키(.env)가 없어 저장된 고정 자료로 엽니다.');
    console.log(`최신 자료를 쓰려면 .env 파일을 다음 폴더에 넣고 다시 실행하세요:\n${APP_DIR}\n`);
    serveStatic(path.join(root, 'docs'), port);
  }
  openBrowser(url);
}

main();
