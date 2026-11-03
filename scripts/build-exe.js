// 실행 파일을 만든다. 사용: node scripts/build-exe.js <빌드 도구 폴더> [아이콘.ico]
// 빌드 도구 폴더에는 postject와 rcedit이 npm으로 설치되어 있어야 한다
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const [toolDir, icon] = process.argv.slice(2);
if (!toolDir) throw new Error('빌드 도구 폴더를 지정해 주세요');

const work = path.join(toolDir, 'work');
fs.mkdirSync(work, { recursive: true });
const config = path.join(work, 'sea-config.json');
const blob = path.join(work, 'sea.blob');
const tmpExe = path.join(work, 'app.exe');
const output = path.join(ROOT, '미사지구 대시보드.exe');

fs.writeFileSync(config, JSON.stringify({
  main: path.join(__dirname, 'launcher.js'),
  output: blob,
  disableExperimentalSEAWarning: true,
}));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });
fs.copyFileSync(process.execPath, tmpExe);

// 아이콘과 파일 정보는 데이터 주입보다 먼저 넣는다
const rcedit = path.join(toolDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
const args = [tmpExe, '--set-version-string', 'FileDescription', '미사지구 부동산 대시보드', '--set-version-string', 'ProductName', '센트럴자이 미사금호부동산 대시보드'];
if (icon) args.push('--set-icon', icon);
execFileSync(rcedit, args, { stdio: 'inherit' });

execFileSync(process.execPath, [
  path.join(toolDir, 'node_modules', 'postject', 'dist', 'cli.js'),
  tmpExe, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
], { stdio: 'inherit' });

fs.copyFileSync(tmpExe, output);
console.log(`완료: ${output} (${Math.round(fs.statSync(output).size / 1048576)}MB)`);
