import {
  Archive,
  Coins,
  PackageOpen,
  Play,
  RotateCcw,
  X,
  createIcons,
} from 'lucide';
import './styles.css';
import {
  PROFILE_KEY,
  createDefaultProfile,
  createRunState,
  formatTime,
  inventoryValue,
  parseProfile,
  sellAll,
  sellItem,
  settleExtraction,
} from './domain';
import { CriticalExtractionGame } from './game';
import type {
  ExtractionResult,
  InventoryItem,
  PersistentProfile,
  RunState,
} from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

app.innerHTML = `
  <main class="game-shell" aria-label="临界撤离游戏">
    <canvas id="scene" class="scene-canvas" aria-label="临界撤离三维战区"></canvas>
    <div class="scene-vignette"></div>
    <header id="topbar" class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span>CE</span></div>
        <div>
          <div class="brand-title">临界撤离</div>
          <div class="brand-subtitle">CRITICAL EXTRACTION</div>
        </div>
      </div>
      <div class="credits"><i data-lucide="coins" aria-hidden="true"></i><span id="credits">0</span></div>
    </header>

    <section id="menu-screen" class="screen">
      <div class="briefing">
        <div class="eyebrow">行动代号 K-17</div>
        <h1>港区断联</h1>
        <p class="mission-copy">潜入废弃物流港，在仓库内回收加密硬盘，从东南侧应急集结区撤离。港区仍有武装人员活动，控制交战距离。</p>
        <div class="mission-grid" aria-label="行动信息">
          <div class="mission-stat"><span class="stat-label">区域</span><span class="stat-value">九号物流港</span></div>
          <div class="mission-stat"><span class="stat-label">威胁</span><span class="stat-value">中等</span></div>
          <div class="mission-stat"><span class="stat-label">窗口</span><span class="stat-value">08:00</span></div>
        </div>
        <div class="actions">
          <button id="deploy-button" class="button button-primary" type="button"><i data-lucide="play" aria-hidden="true"></i>进入战区</button>
          <button id="stash-button" class="button" type="button"><i data-lucide="archive" aria-hidden="true"></i>仓库</button>
        </div>
      </div>
    </section>

    <section id="stash-screen" class="stash-screen" hidden>
      <div class="panel">
        <div class="panel-header">
          <div><div class="eyebrow">后勤终端</div><h2>行动仓库</h2></div>
          <button id="stash-close" class="icon-button" type="button" aria-label="关闭仓库" data-tooltip="关闭"><i data-lucide="x" aria-hidden="true"></i></button>
        </div>
        <div class="panel-body">
          <div class="stash-summary">
            <div><span class="meta-label">库存估值</span><div id="stash-total" class="stat-value">0</div></div>
            <button id="sell-all" class="button" type="button">全部出售</button>
          </div>
          <div id="stash-list" class="stash-list"></div>
        </div>
      </div>
    </section>

    <section id="hud" class="hud" hidden>
      <div class="hud-top">
        <div id="compass" class="compass">N&nbsp;&nbsp; 000° &nbsp;&nbsp;E</div>
        <div id="objective" class="objective">潜入仓库，取得加密硬盘</div>
      </div>
      <div class="hud-left">
        <div class="vital-row"><span>生命</span><div class="bar bar-health"><span id="health-bar"></span></div><b id="health-value">100</b></div>
        <div class="vital-row"><span>护甲</span><div class="bar bar-armor"><span id="armor-bar"></span></div><b id="armor-value">50</b></div>
        <div class="vital-row"><span>体力</span><div class="bar bar-stamina"><span id="stamina-bar"></span></div><b id="stamina-value">100</b></div>
        <div id="medkits" class="medkits">医疗包 × 2</div>
      </div>
      <div class="hud-right">
        <div class="weapon-name">KR-56 突击步枪</div>
        <div class="ammo"><span id="ammo-mag" class="ammo-mag">30</span><span class="ammo-reserve">/ <span id="ammo-reserve">90</span></span></div>
      </div>
      <div id="crosshair" class="crosshair"><span></span></div>
      <div id="hitmarker" class="hitmarker"></div>
      <div id="interaction-prompt" class="interaction-prompt" hidden><span class="keycap">E</span><span id="prompt-text"></span></div>
      <div id="toast" class="toast" hidden></div>
      <div id="extraction-progress" class="extraction-progress" hidden>
        <div id="extraction-label">撤离信号确认 0.0 / 6.0</div>
        <div class="bar"><span id="extraction-bar"></span></div>
      </div>
      <div id="inventory-panel" class="inventory-panel" hidden>
        <div class="inventory-title"><strong>战术背包</strong><span id="inventory-value">估值 0</span></div>
        <div id="inventory-grid" class="inventory-grid"></div>
      </div>
    </section>

    <div id="deploying" class="deploying" hidden>
      <div class="deploying-inner"><div class="eyebrow">K-17 / 九号物流港</div><h2>正在进入行动区域</h2><div class="deploying-line"><span></span></div></div>
    </div>
    <div id="damage-flash" class="damage-flash"></div>

    <section id="pause-screen" class="pause-screen" hidden>
      <div class="pause-panel">
        <div class="eyebrow">行动暂停</div><h2>保持警戒</h2>
        <div class="actions actions-center">
          <button id="resume-button" class="button button-primary" type="button"><i data-lucide="play" aria-hidden="true"></i>继续行动</button>
          <button id="abort-button" class="button button-danger" type="button">放弃行动</button>
        </div>
      </div>
    </section>

    <section id="result-screen" class="result-screen" hidden>
      <div class="result-panel">
        <div id="result-eyebrow" class="eyebrow">行动完成</div>
        <h2 id="result-title">成功撤离</h2>
        <div id="result-grade" class="result-grade">A</div>
        <div class="result-stats">
          <div class="result-stat"><span class="result-label">战利品</span><span id="result-value" class="result-value">0</span></div>
          <div class="result-stat"><span class="result-label">击杀</span><span id="result-kills" class="result-value">0</span></div>
          <div class="result-stat"><span class="result-label">用时</span><span id="result-time" class="result-value">00:00</span></div>
        </div>
        <div class="actions actions-center">
          <button id="retry-button" class="button button-primary" type="button"><i data-lucide="rotate-ccw" aria-hidden="true"></i>再次部署</button>
          <button id="result-stash-button" class="button" type="button"><i data-lucide="package-open" aria-hidden="true"></i>查看仓库</button>
        </div>
      </div>
    </section>

    <section class="mobile-blocker">
      <div><div class="eyebrow">桌面行动终端</div><h1>临界撤离</h1><p>当前行动需要桌面浏览器、键盘与鼠标。请在电脑上打开以进入战区。</p></div>
    </section>
  </main>
`;

createIcons({ icons: { Archive, Coins, PackageOpen, Play, RotateCcw, X } });

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

let profile: PersistentProfile = parseProfile(localStorage.getItem(PROFILE_KEY));
let latestRun: RunState = createRunState();
let toastTimer = 0;

const menuScreen = byId<HTMLElement>('menu-screen');
const topbar = byId<HTMLElement>('topbar');
const hud = byId<HTMLElement>('hud');
const stashScreen = byId<HTMLElement>('stash-screen');
const pauseScreen = byId<HTMLElement>('pause-screen');
const resultScreen = byId<HTMLElement>('result-screen');
const deploying = byId<HTMLElement>('deploying');
const inventoryPanel = byId<HTMLElement>('inventory-panel');

function saveProfile(): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  renderProfile();
}

function renderProfile(): void {
  byId('credits').textContent = profile.credits.toLocaleString('zh-CN');
  byId('stash-total').textContent = inventoryValue(profile.stash).toLocaleString('zh-CN');
  const list = byId('stash-list');
  list.innerHTML = '';
  if (profile.stash.length === 0) {
    list.innerHTML = '<div class="empty-state">暂无已撤离物资</div>';
  } else {
    for (const item of profile.stash) {
      const row = document.createElement('div');
      row.className = 'stash-item';
      row.dataset.rarity = item.rarity;
      row.innerHTML = `<div><div class="stash-item-name">${item.name} × ${item.quantity}</div><div class="loot-kind">${item.kind}</div></div><div class="stash-value">${(item.value * item.quantity).toLocaleString('zh-CN')}</div><button class="button sell-item" type="button" data-item-id="${item.id}">出售</button>`;
      list.append(row);
    }
  }
  byId<HTMLButtonElement>('sell-all').disabled = profile.stash.length === 0;
}

function renderInventory(items: InventoryItem[]): void {
  const grid = byId('inventory-grid');
  grid.innerHTML = '';
  for (let index = 0; index < 6; index += 1) {
    const item = items[index];
    const slot = document.createElement('div');
    if (!item) {
      slot.className = 'inventory-slot is-empty';
      slot.textContent = String(index + 1).padStart(2, '0');
    } else {
      slot.className = 'inventory-slot';
      slot.innerHTML = `<div class="loot-kind">${item.rarity}</div><strong>${item.name}</strong><div class="stash-value">${(item.value * item.quantity).toLocaleString('zh-CN')}</div>`;
    }
    grid.append(slot);
  }
  byId('inventory-value').textContent = `估值 ${inventoryValue(items).toLocaleString('zh-CN')}`;
}

function renderRun(run: RunState): void {
  latestRun = run;
  const { player } = run;
  byId('health-value').textContent = String(player.health);
  byId('armor-value').textContent = String(player.armor);
  byId('stamina-value').textContent = String(Math.round(player.stamina));
  byId<HTMLElement>('health-bar').style.width = `${player.health}%`;
  byId<HTMLElement>('armor-bar').style.width = `${player.armor * 2}%`;
  byId<HTMLElement>('stamina-bar').style.width = `${player.stamina}%`;
  byId('medkits').textContent = `医疗包 × ${player.medkits}`;
  byId('ammo-mag').textContent = player.weapon.reloading ? '··' : String(player.weapon.magazine);
  byId('ammo-reserve').textContent = String(player.weapon.reserve);
  byId('objective').textContent = run.objectiveText;
  const progress = byId('extraction-progress');
  progress.hidden = run.extractionProgress <= 0;
  byId('extraction-label').textContent = `撤离信号确认 ${run.extractionProgress.toFixed(1)} / 6.0`;
  byId<HTMLElement>('extraction-bar').style.width = `${Math.min(100, run.extractionProgress / 6 * 100)}%`;
  renderInventory(run.backpack);
}

function showToast(message: string, tone: 'info' | 'danger' = 'info'): void {
  const toast = byId('toast');
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 1800);
}

function flash(id: string, className: string): void {
  const element = byId(id);
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function showMenu(): void {
  menuScreen.hidden = false;
  topbar.hidden = false;
  hud.hidden = true;
  stashScreen.hidden = true;
  pauseScreen.hidden = true;
  resultScreen.hidden = true;
  deploying.hidden = true;
}

function showResult(run: RunState, successful: boolean): void {
  hud.hidden = true;
  pauseScreen.hidden = true;
  topbar.hidden = false;
  resultScreen.hidden = false;
  let result: ExtractionResult;
  if (successful) {
    const settlement = settleExtraction(profile, run);
    profile = settlement.profile;
    result = settlement.result;
  } else {
    profile = {
      ...profile,
      totalRuns: profile.totalRuns + 1,
      totalKills: profile.totalKills + run.kills,
    };
    result = { grade: 'C', value: 0, timeSeconds: run.elapsedSeconds, kills: run.kills };
  }
  saveProfile();
  byId('result-eyebrow').textContent = successful ? '行动完成' : '行动失败';
  byId('result-title').textContent = successful ? '成功撤离' : '人员失联';
  byId('result-grade').textContent = successful ? result.grade : '—';
  byId('result-value').textContent = result.value.toLocaleString('zh-CN');
  byId('result-kills').textContent = String(result.kills);
  byId('result-time').textContent = formatTime(result.timeSeconds);
}

const game = new CriticalExtractionGame(byId<HTMLCanvasElement>('scene'), {
  onUpdate: renderRun,
  onPrompt: (message) => {
    const prompt = byId('interaction-prompt');
    prompt.hidden = message === null;
    if (message) byId('prompt-text').textContent = message;
  },
  onToast: showToast,
  onHit: (headshot) => {
    byId('hitmarker').style.setProperty('--hit-color', headshot ? '#f0d879' : '#f8f9f5');
    flash('hitmarker', 'is-visible');
  },
  onDamage: () => flash('damage-flash', 'is-visible'),
  onCompass: (heading) => { byId('compass').textContent = heading; },
  onDeploying: (active) => { deploying.hidden = !active; },
  onPause: () => {
    if (latestRun.phase === 'active' || latestRun.phase === 'extracting') {
      pauseScreen.hidden = false;
    }
  },
  onEnd: showResult,
});

await game.initialize();
renderProfile();
renderRun(latestRun);
showMenu();

byId('deploy-button').addEventListener('click', () => {
  menuScreen.hidden = true;
  topbar.hidden = true;
  resultScreen.hidden = true;
  hud.hidden = false;
  game.startRun();
});

byId('stash-button').addEventListener('click', () => { stashScreen.hidden = false; });
byId('stash-close').addEventListener('click', () => { stashScreen.hidden = true; });
byId('sell-all').addEventListener('click', () => { profile = sellAll(profile); saveProfile(); });
byId('stash-list').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('.sell-item');
  if (!target?.dataset.itemId) return;
  profile = sellItem(profile, target.dataset.itemId);
  saveProfile();
});

byId('resume-button').addEventListener('click', () => {
  pauseScreen.hidden = true;
  game.resume();
});

byId('abort-button').addEventListener('click', () => {
  pauseScreen.hidden = true;
  game.abortRun();
});

byId('retry-button').addEventListener('click', () => {
  resultScreen.hidden = true;
  topbar.hidden = true;
  hud.hidden = false;
  game.startRun();
});

byId('result-stash-button').addEventListener('click', () => {
  resultScreen.hidden = true;
  menuScreen.hidden = false;
  stashScreen.hidden = false;
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Tab' && !hud.hidden) {
    event.preventDefault();
    inventoryPanel.hidden = !inventoryPanel.hidden;
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'Tab') inventoryPanel.hidden = true;
});

if (import.meta.env.DEV) {
  Object.assign(window, {
    __criticalExtraction: {
      game,
      getRun: () => latestRun,
      getProfile: () => profile,
      resetProfile: () => {
        profile = createDefaultProfile();
        saveProfile();
      },
    },
  });
}
