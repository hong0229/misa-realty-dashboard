// 실행 파일(.exe)의 시작점. 같은 폴더의 server.js를 불러와 서버를 켜고 브라우저를 연다
const { createRequire } = require('module');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(process.execPath);

function readPort() {
  try {
    const m = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
    if (m) return Number(m[1]);
  } catch { /* .env가 없으면 아래에서 안내한다 */ }
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
    const res = await fetch(`${url}/api/meta`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const missing = ['server.js', '.env', 'public', 'data', 'lib'].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) return failAndWait(`실행 파일과 같은 폴더에 다음 항목이 없습니다: ${missing.join(', ')}\n폴더 전체를 함께 옮겨 주세요.`);

  const url = `http://localhost:${readPort()}`;
  if (await isRunning(url)) {
    // 이미 켜져 있으면 서버를 또 띄우지 않고 화면만 연다
    openBrowser(url);
    return;
  }
  process.chdir(ROOT);
  process.on('uncaughtException', (err) => {
    failAndWait(err.code === 'EADDRINUSE' ? `${url.split(':').pop()}번 포트를 다른 프로그램이 사용 중입니다.` : err.message);
  });
  console.log('센트럴자이 미사금호부동산 · 미사지구 부동산 대시보드');
  console.log('이 창을 닫으면 대시보드가 종료됩니다.\n');
  createRequire(path.join(ROOT, 'server.js'))('./server.js');
  openBrowser(url);
}

main();
