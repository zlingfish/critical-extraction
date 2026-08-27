import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = `/tmp/critical-extraction-maps-${Date.now()}`;
const port = 9337;
const child = spawn(chrome, [
  '--headless=new',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-extensions',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1440,900',
  'http://127.0.0.1:4173/play.html',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let chromeLog = '';
child.stderr.on('data', (chunk) => { chromeLog += String(chunk); });

async function getJson(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.ok) return response.json();
    } catch { /* Browser is still starting. */ }
    await sleep(100);
  }
  throw new Error('无法连接浏览器测试端口');
}

const targets = await getJson('/json/list');
const target = targets.find((entry) => entry.type === 'page');
if (!target) throw new Error('浏览器没有创建游戏页面');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const events = [];
let sequence = 0;

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    events.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    events.push(message.params.args?.map((argument) => argument.value ?? argument.description).join(' '));
  }
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.result?.exceptionDetails) {
    const details = response.result.exceptionDetails;
    throw new Error(details.exception?.description ?? details.text);
  }
  return response.result?.result?.value;
}

await command('Runtime.enable');
await command('Page.enable');
for (let attempt = 0; attempt < 80; attempt += 1) {
  if (await evaluate(`Boolean(window.__criticalExtraction?.extendedMaps)`)) break;
  await sleep(100);
}

const initial = JSON.parse(await evaluate(`JSON.stringify({
  ready: Boolean(window.__criticalExtraction?.extendedMaps),
  gameReady: Boolean(window.__criticalExtraction?.game),
  options: [...document.querySelectorAll('#map-options [data-map]')].map((element) => element.dataset.map),
  runtimeError: !document.querySelector('#runtime-error-screen')?.hidden,
})`));

if (!initial.ready) {
  socket.close();
  child.kill('SIGTERM');
  throw new Error(`地图扩展未启动: ${JSON.stringify({ initial, events })}`);
}

const reports = [];
for (const mapId of ['shipyard', 'highlands']) {
  await evaluate(`window.__criticalExtraction.extendedMaps.select('${mapId}')`);
  await evaluate(`document.querySelector('#deploy-button')?.click()`);
  await sleep(5000);
  await evaluate(`
    document.querySelector('#menu-screen').hidden = true;
    document.querySelector('#topbar').hidden = true;
    document.querySelector('#hud').hidden = false;
  `);
  reports.push(JSON.parse(await evaluate(`JSON.stringify((() => {
    const api = window.__criticalExtraction;
    const game = api.game;
    const player = game.playerBody.translation();
    return {
      mapId: '${mapId}',
      activeName: game.activeOperation.name,
      phase: api.getRun().phase,
      player: { x: player.x, y: player.y, z: player.z },
      enemyCount: game.enemies.filter((enemy) => enemy.alive).length,
      visibleRoot: api.extendedMaps.roots['${mapId}'].visible,
      otherRootHidden: !api.extendedMaps.roots['${mapId === 'shipyard' ? 'highlands' : 'shipyard'}'].visible,
      runtimeError: !document.querySelector('#runtime-error-screen')?.hidden,
    };
  })())`)));
}

const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const screenshotPath = '/tmp/critical-extraction-extended-maps.png';
await writeFile(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));

const result = {
  initial,
  reports,
  screenshotPath,
  events,
  gpuErrors: chromeLog.split('\n').filter((line) => /FATAL|crash/i.test(line)),
};
console.log(JSON.stringify(result, null, 2));

socket.close();
child.kill('SIGTERM');

const names = ['深潮船坞', '霜岭前哨'];
if (
  !initial.ready
  || initial.runtimeError
  || !initial.options.includes('shipyard')
  || !initial.options.includes('highlands')
  || reports.some((report, index) => (
    report.activeName !== names[index]
    || !['deploying', 'active', 'extracting'].includes(report.phase)
    || report.player.y < 0
    || report.enemyCount < 8
    || !report.visibleRoot
    || !report.otherRootHidden
    || report.runtimeError
  ))
  || events.length > 0
) {
  process.exitCode = 1;
}
