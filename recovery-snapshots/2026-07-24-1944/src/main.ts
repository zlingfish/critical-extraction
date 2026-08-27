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
import type { DifficultyId, MapId } from './game';
import type {
  ExtractionResult,
  InventoryItem,
  PersistentProfile,
  RunState,
} from './types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

app.innerHTML = `
  <main id="game-shell" class="game-shell" aria-label="临界撤离游戏">
    <canvas id="scene" class="scene-canvas" tabindex="-1" aria-label="临界撤离三维战区"></canvas>
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
        <h1 id="mission-title">港区断联</h1>
        <p id="mission-copy" class="mission-copy">潜入大型物流港，在主仓库回收任务物品，并前往标记区域撤离。</p>
        <div class="operation-options">
          <div>
            <span class="stat-label">行动地图</span>
            <div id="map-options" class="option-row">
              <button class="option-chip is-selected" type="button" data-map="harbor">九号物流港</button>
              <button class="option-chip" type="button" data-map="radar">长风雷达站</button>
              <button class="option-chip" type="button" data-map="refinery">赤湾炼化区</button>
            </div>
          </div>
          <div>
            <span class="stat-label">调试难度</span>
            <div id="difficulty-options" class="option-row">
              <button class="option-chip" type="button" data-difficulty="recruit">新兵</button>
              <button class="option-chip is-selected" type="button" data-difficulty="standard">标准</button>
              <button class="option-chip" type="button" data-difficulty="veteran">老兵</button>
            </div>
          </div>
        </div>
        <div class="mission-grid" aria-label="行动信息">
          <div class="mission-stat"><span class="stat-label">区域</span><span id="mission-region" class="stat-value">九号物流港</span></div>
          <div class="mission-stat"><span class="stat-label">威胁</span><span id="mission-threat" class="stat-value">中等</span></div>
          <div class="mission-stat"><span class="stat-label">窗口</span><span class="stat-value">20:00</span></div>
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
        <div id="weapon-name" class="weapon-name">KR-56 突击步枪</div>
        <div class="ammo"><span id="ammo-mag" class="ammo-mag">30</span><span class="ammo-reserve">/ <span id="ammo-reserve">90</span></span></div>
        <div class="weapon-slots" aria-label="武器栏">
          <div class="weapon-slot is-active" data-weapon-slot="1"><kbd>1</kbd><span>KR-56</span></div>
          <div class="weapon-slot" data-weapon-slot="2"><kbd>2</kbd><span>V9</span></div>
          <div class="weapon-slot" data-weapon-slot="3"><kbd>3</kbd><span>SG-12</span></div>
        </div>
      </div>
      <div id="crosshair" class="crosshair"><span></span></div>
      <div id="scope-view" class="scope-view" aria-hidden="true"><span></span></div>
      <button id="capture-controls" class="capture-controls" type="button">
        <strong>点击进入游戏控制</strong>
        <span>鼠标将固定在中央 · 滑动触控板转动视角 · Esc 退出</span>
      </button>
      <div id="hitmarker" class="hitmarker" aria-hidden="true"></div>
      <div id="interaction-prompt" class="interaction-prompt" hidden><span class="keycap">E</span><span id="prompt-text"></span></div>
      <div id="loot-panel" class="loot-panel" data-phase="searching" hidden>
        <div class="loot-panel-header">
          <span id="loot-panel-status">容器检索</span>
          <span id="loot-panel-rarity">未识别</span>
        </div>
        <div class="loot-panel-body">
          <div class="loot-scan-icon" aria-hidden="true"><span></span></div>
          <div class="loot-panel-copy">
            <strong id="loot-panel-name">正在分析物资</strong>
            <span id="loot-panel-kind">等待扫描结果</span>
            <b id="loot-panel-value">---</b>
          </div>
        </div>
        <div id="loot-results" class="loot-results"></div>
        <div class="loot-search-track"><span id="loot-search-progress"></span></div>
        <div id="loot-panel-action" class="loot-panel-action">正在检索容器内容</div>
      </div>
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
let selectedMap: MapId = 'harbor';
let selectedDifficulty: DifficultyId = 'standard';

const menuScreen = byId<HTMLElement>('menu-screen');
const gameShell = byId<HTMLElement>('game-shell');
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
  for (let index = 0; index < 12; index += 1) {
    const item = items[index];
    const slot = document.createElement('div');
    if (!item) {
      slot.className = 'inventory-slot is-empty';
      slot.textContent = String(index + 1).padStart(2, '0');
    } else {
      slot.className = 'inventory-slot';
      slot.dataset.rarity = item.rarity;
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
  if (activeCorpseLootView) renderCorpseLoot(activeCorpseLootView);
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
  settingsScreen.hidden = true;
  deploying.hidden = true;
}

function showResult(run: RunState, successful: boolean): void {
  hud.hidden = true;
  pauseScreen.hidden = true;
  topbar.hidden = false;
  resultScreen.hidden = false;
  settingsScreen.hidden = true;
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

function deployWithSupplies(): void {
  const supplies = {
    armor: profile.nextRunArmorBonus,
    ammo: profile.nextRunAmmoBonus,
    medkits: profile.nextRunMedkitBonus,
  };
  profile = {
    ...profile,
    nextRunArmorBonus: 0,
    nextRunAmmoBonus: 0,
    nextRunMedkitBonus: 0,
  };
  saveProfile();
  game.startRun(selectedMap, selectedDifficulty, supplies);
}

const game = new CriticalExtractionGame(byId<HTMLCanvasElement>('scene'), {
  onUpdate: renderRun,
  onPrompt: (message) => {
    const prompt = byId('interaction-prompt');
    prompt.hidden = message === null;
    if (message) byId('prompt-text').textContent = message;
  },
  onToast: showToast,
  onHit: (zone) => {
    const marker = byId('hitmarker');
    marker.dataset.zone = zone;
    marker.style.setProperty('--hit-color', zone === 'head' ? '#f2df9c' : zone === 'armor' ? '#b9d5d1' : '#f3f3ec');
    flash('hitmarker', 'is-visible');
  },
  onDamage: () => flash('damage-flash', 'is-visible'),
  onCompass: (heading) => { byId('compass').textContent = heading; },
  onAiming: (active) => { gameShell.classList.toggle('is-aiming', active); },
  onWeaponChange: (weapon) => {
    byId('weapon-name').textContent = weapon.name;
    for (const slot of gameShell.querySelectorAll<HTMLElement>('[data-weapon-slot]')) {
      slot.classList.toggle('is-active', slot.dataset.weaponSlot === String(weapon.slot));
    }
  },
  onControlCapture: (active) => {
    gameShell.classList.toggle('is-controlling', active);
    byId('capture-controls').hidden = active;
  },
  onLootSearch: (state) => {
    const panel = byId('loot-panel');
    panel.hidden = state === null;
    if (!state) return;
    const highestItem = [...state.items].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity))[0];
    const rarityLabel = highestItem ? rarityName(highestItem.rarity) : '空';
    panel.dataset.phase = state.phase;
    panel.dataset.rarity = highestItem?.rarity ?? 'black';
    byId('loot-panel-status').textContent = state.phase === 'searching' ? '容器检索' : '物资确认';
    byId('loot-panel-rarity').textContent = state.phase === 'searching' ? '识别中' : rarityLabel;
    byId('loot-panel-name').textContent = state.phase === 'searching' ? `正在搜索${state.containerName}` : `${state.items.length} 件物资`;
    byId('loot-panel-kind').textContent = state.phase === 'searching' ? '内容未知' : '搜索结果';
    byId('loot-panel-value').textContent = state.phase === 'searching' ? '???' : `${inventoryValue(state.items).toLocaleString('zh-CN')} 金币`;
    const results = byId('loot-results');
    results.innerHTML = state.phase === 'searching' ? '' : state.items.map((item) => `<div class="loot-result" data-rarity="${item.rarity}"><span>${rarityName(item.rarity)}</span><strong>${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ''}</strong><b>${(item.value * item.quantity).toLocaleString('zh-CN')}</b></div>`).join('');
    byId<HTMLElement>('loot-search-progress').style.width = `${Math.round(state.progress * 100)}%`;
    byId('loot-panel-action').textContent = state.message;
  },
  onDeploying: (active) => { deploying.hidden = !active; },
  onPause: () => {
    if (latestRun.phase === 'active' || latestRun.phase === 'extracting') {
      pauseScreen.hidden = false;
    }
  },
  onEnd: showResult,
});
game.applySettings(gameSettings);
renderSettings();

function rarityRank(rarity: InventoryItem['rarity']): number {
  return ['black', 'white', 'green', 'blue', 'purple', 'gold', 'red'].indexOf(rarity);
}

function rarityName(rarity: InventoryItem['rarity']): string {
  return ({ black: '黑色', white: '白色', green: '绿色', blue: '蓝色', purple: '紫色', gold: '金色', red: '红色' })[rarity];
}

await game.initialize();
renderProfile();
renderRun(latestRun);
showMenu();

const corpsePreview = new URLSearchParams(window.location.search).get('previewCorpseLoot');
if (window.location.hostname === '127.0.0.1' && (corpsePreview === 'soldier' || corpsePreview === 'boss')) {
  selectedMap = corpsePreview === 'boss' ? 'administration' : 'harbor';
  selectedDifficulty = 'recruit';
  menuScreen.hidden = true;
  topbar.hidden = true;
  resultScreen.hidden = true;
  hud.hidden = false;
  deployWithSupplies();
  window.setTimeout(() => game.debugPreviewCorpseLoot(corpsePreview === 'boss'), 1100);
}

const impactFeedbackPreview = new URLSearchParams(window.location.search).get('previewImpactFeedback');
if (window.location.hostname === '127.0.0.1' && impactFeedbackPreview === '1') {
  selectedMap = 'harbor';
  selectedDifficulty = 'recruit';
  menuScreen.hidden = true;
  topbar.hidden = true;
  resultScreen.hidden = true;
  hud.hidden = false;
  deployWithSupplies();
  window.setTimeout(() => game.debugPreviewImpactFeedback(), 1100);
}

const containerPreview = new URLSearchParams(window.location.search).get('previewContainer');
if (window.location.hostname === '127.0.0.1' && containerPreview === 'safe') {
  selectedMap = 'harbor';
  selectedDifficulty = 'recruit';
  menuScreen.hidden = true;
  topbar.hidden = true;
  resultScreen.hidden = true;
  hud.hidden = false;
  deployWithSupplies();
  window.setTimeout(() => game.debugPreviewContainer(), 1100);
}

const mapPreview = new URLSearchParams(window.location.search).get('previewMapSpot');
const mapPreviewSpots: Record<string, { map: MapId; x: number; z: number; groundY: number; yaw: number }> = {
  equipment: { map: 'reservoir', x: 310, z: 42, groundY: -3.62, yaw: 0 },
  drainage: { map: 'reservoir', x: 390, z: 42, groundY: -3.62, yaw: Math.PI / 2 },
  northExit: { map: 'reservoir', x: 438, z: 92, groundY: -3.62, yaw: Math.PI },
  ridge: { map: 'reservoir', x: 305, z: -83, groundY: 2.7, yaw: Math.PI / 2 },
  checkpointBuilding: { map: 'harbor', x: 43, z: 4, groundY: 0, yaw: 0 },
  radarBuilding: { map: 'radar', x: -72, z: -20, groundY: 0, yaw: Math.PI },
  refineryBuilding: { map: 'refinery', x: 72, z: -12, groundY: 0, yaw: 0 },
};
const mapPreviewSpot = mapPreview ? mapPreviewSpots[mapPreview] : null;
if (gameReady && window.location.hostname === '127.0.0.1' && mapPreviewSpot) {
  selectedMap = mapPreviewSpot.map;
  selectedDifficulty = 'recruit';
  menuScreen.hidden = true;
  topbar.hidden = true;
  resultScreen.hidden = true;
  hud.hidden = false;
  deployWithSupplies();
  window.setTimeout(() => game.debugPreviewLocation(
    mapPreviewSpot.x,
    mapPreviewSpot.z,
    mapPreviewSpot.groundY,
    mapPreviewSpot.yaw,
  ), 1100);
}

if (window.location.protocol === 'file:') {
  const controlStatus = byId('control-status');
  controlStatus.dataset.error = 'true';
  controlStatus.textContent = '你打开的是旧文件版 · 请关闭本页，双击“启动游戏.command”';
}

if (window.location.protocol === 'file:') {
  byId('control-status').textContent = '你打开的是旧文件版 · 请关闭本页，双击“启动游戏.command”';
}

byId('deploy-button').addEventListener('click', () => {
  menuScreen.hidden = true;
  topbar.hidden = true;
  resultScreen.hidden = true;
  hud.hidden = false;
  deployWithSupplies();
});

byId('map-options').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-map]');
  if (!target?.dataset.map) return;
  selectedMap = target.dataset.map as MapId;
  for (const button of byId('map-options').querySelectorAll('button')) button.classList.toggle('is-selected', button === target);
  const details = {
    harbor: ['港区断联', '九号物流港', '潜入大型物流港，在主仓库回收加密硬盘，并前往南部码头撤离。'],
    radar: ['长风静默', '长风雷达站', '穿过山地雷达设施，夺取频谱记录器，并从南侧山口撤离。'],
    refinery: ['赤湾封锁', '赤湾炼化区', '进入大型炼化设施，取得反应堆密钥，并从南部装卸区撤离。'],
  }[selectedMap];
  byId('mission-title').textContent = details[0];
  byId('mission-region').textContent = details[1];
  byId('mission-copy').textContent = details[2];
});

byId('difficulty-options').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-difficulty]');
  if (!target?.dataset.difficulty) return;
  selectedDifficulty = target.dataset.difficulty as DifficultyId;
  for (const button of byId('difficulty-options').querySelectorAll('button')) button.classList.toggle('is-selected', button === target);
  byId('mission-threat').textContent = ({ recruit: '较低', standard: '中等', veteran: '极高' })[selectedDifficulty];
});

// A normal click is accepted by more Mac browsers for FPS-style cursor locking.
byId('capture-controls').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  game.captureControls();
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
  deployWithSupplies();
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
