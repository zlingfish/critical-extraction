import { spawn } from 'node:child_process';

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
await sleep(3500);
const initial = await command('Runtime.evaluate', { expression: `JSON.stringify({
  ready: Boolean(window.__criticalExtraction),
  runtimeError: !document.getElementById('runtime-error-screen')?.hidden,
  deployDisabled: document.getElementById('deploy-button')?.disabled,
  title: document.title,
})`, returnByValue: true });
await command('Runtime.evaluate', { expression: `document.getElementById('deploy-button')?.click()` });
await sleep(8000);
const active = await command('Runtime.evaluate', { expression: `JSON.stringify({
  phase: window.__criticalExtraction?.getRun?.().phase,
  runtimeError: !document.getElementById('runtime-error-screen')?.hidden,
  canvas: Boolean(document.querySelector('canvas')),
})`, returnByValue: true });

console.log(JSON.stringify({
  initial: JSON.parse(initial.result?.result?.value ?? '{}'),
  active: JSON.parse(active.result?.result?.value ?? '{}'),
  events: events.slice(-20),
  gpuErrors: debugLog.split('\n').filter((line) => /ERROR|FATAL|crash/i.test(line)).slice(-10),
}, null, 2));

socket.close();
child.kill('SIGTERM');
