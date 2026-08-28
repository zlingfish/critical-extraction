import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = `/tmp/critical-extraction-smoke-${Date.now()}`;
const port = 9222;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let debugLog = '';
child.stderr.on('data', (chunk) => { debugLog += String(chunk); });

async function getJson(path) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.ok) return response.json();
    } catch { /* Chrome is still starting. */ }
    await sleep(100);
  }
  throw new Error(`无法连接浏览器调试端口: ${path}`);
}

const targets = await getJson('/json/list');
const target = targets.find((entry) => entry.type === 'page');
if (!target) throw new Error('浏览器未创建页面目标');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
const events = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') events.push({ type: 'exception', value: message.params.exceptionDetails?.text });
  if (message.method === 'Runtime.consoleAPICalled') events.push({ type: 'console', value: message.params.args?.map((arg) => arg.value ?? arg.description).join(' ') });
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

await command('Runtime.enable');
await command('Log.enable');
await command('Page.enable');
await sleep(3500);
const initial = await command('Runtime.evaluate', { expression: `JSON.stringify({
  ready: Boolean(window.__criticalExtraction),
  runtimeError: !document.getElementById('runtime-error-screen')?.hidden,
  deployDisabled: document.getElementById('deploy-button')?.disabled,
  title: document.title,
  mapOptions: [...document.querySelectorAll('[data-map]')].map((option) => option.dataset.map),
  administrationRoute: window.__criticalExtraction?.game?.__administrationRouteOpened,
  administrationRouteBlocked: (() => {
    const game = window.__criticalExtraction?.game;
    if (!game?.raycaster || !game?.camera || !game?.blockers) return true;
    const origin = game.camera.position.clone().set(165, 1.52, -37);
    const target = game.camera.position.clone().set(218, 1.52, 75);
    const distance = origin.distanceTo(target);
    game.raycaster.set(origin, target.sub(origin).normalize());
    return game.raycaster.intersectObjects(game.blockers, false).some((hit) => hit.distance < distance);
  })(),
})`, returnByValue: true });
await command('Runtime.evaluate', { expression: `document.querySelector('[data-boss-mode="none"]')?.click()` });
await command('Runtime.evaluate', { expression: `document.getElementById('deploy-button')?.click()` });
await sleep(8000);
const beforeInput = await command('Runtime.evaluate', { expression: `JSON.stringify((() => {
  const game = window.__criticalExtraction.game;
  return { x: game.camera.position.x, y: game.camera.position.y, z: game.camera.position.z, yaw: game.yaw, pitch: game.pitch };
})())`, returnByValue: true });
await command('Runtime.evaluate', { expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))` });
await sleep(700);
await command('Runtime.evaluate', { expression: `window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))` });
await command('Runtime.evaluate', { expression: `window.dispatchEvent(new MouseEvent('mousemove', { clientX: innerWidth / 2 + 90, clientY: innerHeight / 2 - 24, bubbles: true }))` });
await sleep(120);
const afterInput = await command('Runtime.evaluate', { expression: `JSON.stringify((() => {
  const game = window.__criticalExtraction.game;
  return { x: game.camera.position.x, y: game.camera.position.y, z: game.camera.position.z, yaw: game.yaw, pitch: game.pitch };
})())`, returnByValue: true });
const active = await command('Runtime.evaluate', { expression: `JSON.stringify({
  phase: window.__criticalExtraction?.getRun?.().phase,
  runtimeError: !document.getElementById('runtime-error-screen')?.hidden,
  canvas: Boolean(document.querySelector('canvas')),
  bossMode: window.__criticalExtraction?.game?.activeBossMode,
  bosses: window.__criticalExtraction?.game?.enemies?.filter((enemy) => enemy.boss).length,
  enemies: window.__criticalExtraction?.game?.enemies?.length,
  missionTasks: [...document.querySelectorAll('#mission-tracker .mission-task b')].map((item) => item.textContent),
})`, returnByValue: true });
const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const screenshotPath = '/tmp/critical-extraction-no-boss-smoke.png';
await writeFile(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));
const screenshotSignalResult = await command('Runtime.evaluate', {
  expression: `(async () => {
    const image = new Image();
    image.src = 'data:image/png;base64,${screenshot.result.data}';
    await image.decode();
    const sample = document.createElement('canvas');
    sample.width = 24;
    sample.height = 24;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let signal = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 24) signal += 1;
    }
    return signal;
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
const screenshotSignal = screenshotSignalResult.result?.result?.value ?? 0;
const removedMapGuardsResult = await command('Runtime.evaluate', {
  expression: `JSON.stringify((() => {
    const game = window.__criticalExtraction.game;
    const supplies = { armor: 0, ammo: 0, medkits: 0 };
    game.startRun('reservoir', 'recruit', supplies, 'single', 'extraction');
    const directRequest = game.activeOperation.id;
    game.startRun('administration', 'recruit', supplies, 'single', 'continuous');
    game.advanceContinuousOperation();
    return { directRequest, continuousNext: game.activeOperation.id };
  })())`,
  returnByValue: true,
});
const removedMapGuards = JSON.parse(removedMapGuardsResult.result?.result?.value ?? '{}');

const result = {
  initial: JSON.parse(initial.result?.result?.value ?? '{}'),
  active: JSON.parse(active.result?.result?.value ?? '{}'),
  input: {
    before: JSON.parse(beforeInput.result?.result?.value ?? '{}'),
    after: JSON.parse(afterInput.result?.result?.value ?? '{}'),
  },
  screenshotPath,
  screenshotSignal,
  removedMapGuards,
  events: events.slice(-20),
  gpuErrors: debugLog.split('\n').filter((line) => /ERROR|FATAL|crash/i.test(line)).slice(-10),
};
console.log(JSON.stringify(result, null, 2));

socket.close();
child.kill('SIGTERM');

if (
  !result.initial.ready
  || result.initial.runtimeError
  || result.initial.mapOptions.includes('reservoir')
  || result.initial.administrationRoute?.walls !== 3
  || result.initial.administrationRoute?.colliders !== 3
  || result.initial.administrationRouteBlocked
  || result.active.runtimeError
  || Math.hypot(result.input.after.x - result.input.before.x, result.input.after.z - result.input.before.z) < 0.01
  || Math.abs(result.input.after.yaw - result.input.before.yaw) < 0.01
  || result.active.phase !== 'active'
  || !(result.screenshotSignal > 0)
  || result.active.bossMode !== 'none'
  || result.active.bosses !== 0
  || !(result.active.enemies > 0)
  || result.active.missionTasks.some((task) => task.includes('首领'))
  || result.removedMapGuards.directRequest !== 'harbor'
  || result.removedMapGuards.continuousNext !== 'harbor'
) {
  process.exitCode = 1;
}
