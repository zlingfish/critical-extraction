import {
  Archive,
  BookOpen,
  Backpack,
  BriefcaseMedical,
  Activity,
  ChevronUp,
  Coins,
  Crosshair,
  Dumbbell,
  HardHat,
  PackageOpen,
  Play,
  Radio,
  RotateCcw,
  Settings,
  Shield,
  Warehouse,
  Wind,
  Wrench,
  Zap,
  Target,
  X,
  createIcons,
} from 'lucide';
import './styles.css';
import {
  PROFILE_KEY,
  AMMO_PACKS,
  createDefaultProfile,
  createRunState,
  formatTime,
  inventoryValue,
  backpackUsedSlots,
  parseProfile,
  buyMarketItem,
  buyAmmoPack,
  buyGear,
  buyWeaponModification,
  buySupply,
  selectKeycard,
  equipGear,
  equipWeaponModification,
  sellAll,
  sellItem,
  removeWeaponModification,
  settleExtraction,
  settleFailure,
  insureItem,
  collectInsuranceReturns,
  gearDurabilityPercent,
  gearRepairCost,
  persistRunDurability,
  repairGear,
  upgradeFacility,
  withdrawSelectedKeycardForRun,
  dispatchDeployment,
  stageDeploymentItem,
  unstageDeploymentItem,
} from './domain';
import { CriticalExtractionGame } from './game';
import {
  FACILITIES,
  GEAR_CATALOG,
  GEAR_CATEGORIES,
  equippedItem,
  facilityUpgradeCost,
  gearPrice,
  resolveLoadout,
} from './gear';
import {
  GUNSMITH_WEAPONS,
  WEAPON_MODIFICATIONS,
  WEAPON_MOD_SLOTS,
  resolveAllWeaponBuilds,
  resolveWeaponBuild,
  weaponModificationPrice,
} from './gunsmith';
import { LOOT_CATALOG, LOOT_CATALOG_SIZE } from './loot';
import type { AbilityView, BossMode, DifficultyId, FieldMarketView, GameModeId, LootSearchView, MapId, OperationStatusView, TacticalMapView } from './game';
import { GAME_MODE_DEFINITIONS } from './game-modes';
import { KEYCARD_OFFERS } from './keycards';
import { equipLootToProfile, isEquipableLoot } from './run-challenges';
import type {
  ExtractionResult,
  FacilityId,
  GearCategory,
  InventoryItem,
  PersistentProfile,
  RunState,
  WeaponModSlot,
} from './types';
import type { GunsmithWeaponId, WeaponModification } from './gunsmith';
import { BASE_MAX_LEVEL } from './types';
import {
  SETTINGS_ACTION_LABELS,
  SETTINGS_KEY,
  createDefaultSettings,
  keyLabel,
  parseSettings,
  saveSettings,
} from './settings';
import type { GameAction, GameSettings, QualityLevel } from './settings';
import { readStoredValue, writeStoredValue } from './storage';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

const CORE_MARKET_CATALOG: Array<{ item: InventoryItem; price: number }> = [
  { item: { id: 'market-magnetic-bomb', name: '磁吸炸弹', kind: 'supplies', rarity: 'blue', value: 720, quantity: 1, description: '装入胸挂后可按 Q 投掷；贴附墙面、地面或敌人，两秒后爆炸。' }, price: 1080 },
  { item: { id: 'market-bandage', name: '军用止血带', kind: 'medical', rarity: 'green', value: 420, quantity: 1 }, price: 680 },
  { item: { id: 'market-stamina-injector', name: '战术体力针', kind: 'medical', rarity: 'green', value: 980, quantity: 1, description: '短时间恢复冲刺耐力，适合长距离转移。' }, price: 1480 },
  { item: { id: 'market-adrenaline-injector', name: '肾上腺素注射针', kind: 'medical', rarity: 'blue', value: 2100, quantity: 1, description: '应急注射剂，缓解伤势并提升行动状态。' }, price: 3150 },
  { item: { id: 'market-nutrition-gel', name: '高能营养凝胶', kind: 'supplies', rarity: 'white', value: 260, quantity: 1, description: '轻量高热量补给，适合持续搜索行动。' }, price: 390 },
  { item: { id: 'market-field-meal', name: '战地恢复餐', kind: 'supplies', rarity: 'green', value: 760, quantity: 1, description: '密封恢复餐，补充体力并稳定状态。' }, price: 1140 },
  { item: { id: 'market-signal-decoder', name: '便携信号解码器', kind: 'intel', rarity: 'purple', value: 4100, quantity: 1, description: '可交易的特殊情报设备，来源不明。' }, price: 6150 },
  { item: { id: 'market-black-box', name: '失事无人机黑匣', kind: 'electronics', rarity: 'gold', value: 9300, quantity: 1, description: '记录关键航线数据的特殊设备。' }, price: 13950 },
  { item: { id: 'market-command-seal', name: '战区指挥密印', kind: 'intel', rarity: 'red', value: 22400, quantity: 1, description: '极稀有特殊物品，适合收藏或高价回收。' }, price: 33600 },
  { item: { id: 'market-toolkit', name: '便携维修组件', kind: 'supplies', rarity: 'blue', value: 860, quantity: 1 }, price: 1380 },
  { item: { id: 'market-radio', name: '战术通信模块', kind: 'electronics', rarity: 'blue', value: 1120, quantity: 1 }, price: 1780 },
  { item: { id: 'market-intel', name: '区域通行情报', kind: 'intel', rarity: 'purple', value: 2200, quantity: 1 }, price: 3400 },
  { item: { id: 'market-optics', name: '高分辨率光学组', kind: 'electronics', rarity: 'purple', value: 2600, quantity: 1 }, price: 3980 },
  { item: { id: 'market-alloy', name: '航空级合金板', kind: 'supplies', rarity: 'gold', value: 5200, quantity: 1 }, price: 7600 },
];

// 商城展示物也要与搜刮物资采用同一估值倍率，避免同名物品出现两套价格。
for (const offer of CORE_MARKET_CATALOG) offer.item.value *= 7;

// Each page load publishes a different public batch from the full catalog.
const marketRotationStart = Math.floor(Math.random() * LOOT_CATALOG.length);
const ROTATING_MARKET_CATALOG: Array<{ item: InventoryItem; price: number }> = Array.from({ length: 8 }, (_, index) => {
      const source = LOOT_CATALOG[(marketRotationStart + index * 157) % LOOT_CATALOG.length];
  return { item: { ...source, quantity: 1 }, price: Math.round(source.value * 1.35) };
});
const MARKET_CATALOG = [...CORE_MARKET_CATALOG, ...ROTATING_MARKET_CATALOG];

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
        <p id="mission-copy" class="mission-copy">击败港区首领「灰鲨」，回收任务物品，并前往标记区域撤离。</p>
        <div class="operation-options">
          <div>
            <span class="stat-label">行动地图</span>
            <div id="map-options" class="option-row">
              <button class="option-chip is-selected" type="button" data-map="harbor">九号物流港</button>
              <button class="option-chip" type="button" data-map="radar">长风雷达站</button>
              <button class="option-chip" type="button" data-map="refinery">赤湾炼化区</button>
              <button class="option-chip option-chip-danger" type="button" data-map="administration">行政辖区</button>
              <button class="option-chip option-chip-large" type="button" data-map="reservoir">黑峡水库</button>
            </div>
          </div>
          <div class="operation-settings">
            <div>
              <span class="stat-label">调试难度</span>
              <div id="difficulty-options" class="option-row">
                <button class="option-chip" type="button" data-difficulty="recruit">新兵</button>
                <button class="option-chip is-selected" type="button" data-difficulty="standard">标准</button>
                <button class="option-chip" type="button" data-difficulty="veteran">老兵</button>
              </div>
            </div>
            <div>
              <span class="stat-label">首领模式</span>
              <div id="boss-mode-options" class="option-row">
                <button class="option-chip is-selected" type="button" data-boss-mode="single">单首领</button>
                <button class="option-chip" type="button" data-boss-mode="double">双首领</button>
              </div>
            </div>
            <div class="game-mode-setting">
              <span class="stat-label">游戏模式</span>
              <div id="game-mode-options" class="option-row">
                <button class="option-chip is-selected" type="button" data-game-mode="extraction">标准撤离</button>
                <button class="option-chip" type="button" data-game-mode="clear">热区清剿</button>
                <button class="option-chip" type="button" data-game-mode="survival">计时突围</button>
                <button class="option-chip" type="button" data-game-mode="intel">情报回收</button>
                <button class="option-chip" type="button" data-game-mode="night">夜战潜入</button>
                <button class="option-chip" type="button" data-game-mode="zero">零装突袭</button>
                <button class="option-chip" type="button" data-game-mode="boss-hunt">首领追猎</button>
                <button class="option-chip" type="button" data-game-mode="random-extract">随机撤离</button>
                <button class="option-chip" type="button" data-game-mode="escort">高价值押运</button>
                <button class="option-chip" type="button" data-game-mode="red-zone">红区封锁</button>
                <button class="option-chip" type="button" data-game-mode="continuous">连续行动</button>
                <button class="option-chip" type="button" data-game-mode="weapon-lock">武器限定</button>
                <button class="option-chip" type="button" data-game-mode="training">射击训练场</button>
              </div>
            </div>
          </div>
        </div>
        <div class="mission-grid" aria-label="行动信息">
          <div class="mission-stat"><span class="stat-label">区域</span><span id="mission-region" class="stat-value">九号物流港</span></div>
          <div class="mission-stat"><span class="stat-label">威胁</span><span id="mission-threat" class="stat-value">单首领 · 高</span></div>
          <div class="mission-stat"><span class="stat-label">窗口</span><span id="mission-window" class="stat-value">20:00</span></div>
        </div>
        <div id="deployment-loadout" class="deployment-loadout" hidden></div>
        <div class="actions">
          <button id="deploy-button" class="button button-primary" type="button"><i data-lucide="play" aria-hidden="true"></i>进入战区</button>
          <button id="deployment-stash-button" class="button" type="button"><i data-lucide="backpack" aria-hidden="true"></i>行动仓库</button>
          <button id="stash-button" class="button" type="button"><i data-lucide="archive" aria-hidden="true"></i>交易行</button>
          <button id="requisition-button" class="button" type="button"><i data-lucide="package-open" aria-hidden="true"></i>军需处</button>
          <button id="analysis-button" class="button" type="button"><i data-lucide="radio" aria-hidden="true"></i>分析处</button>
          <button id="arsenal-button" class="button" type="button"><i data-lucide="shield" aria-hidden="true"></i>装备库</button>
          <button id="gunsmith-button" class="button" type="button"><i data-lucide="wrench" aria-hidden="true"></i>改枪台</button>
          <button id="insurance-button" class="button" type="button"><i data-lucide="warehouse" aria-hidden="true"></i>保险库</button>
          <button id="codex-button" class="button" type="button"><i data-lucide="book-open" aria-hidden="true"></i>图鉴</button>
          <button id="settings-button" class="button" type="button"><i data-lucide="settings" aria-hidden="true"></i>游戏设置</button>
        </div>
      </div>
    </section>

    <section id="stash-screen" class="stash-screen" hidden>
      <div class="panel market-panel">
        <div class="panel-header">
          <div><div class="eyebrow">后勤终端 / 交易中心</div><h2>行动仓库</h2></div>
          <div class="market-wallets">
            <div class="market-balance"><span>可用金币</span><strong><i data-lucide="coins" aria-hidden="true"></i><b id="stash-credits">0</b></strong></div>
          </div>
          <button id="stash-close" class="icon-button" type="button" aria-label="关闭仓库" data-tooltip="关闭"><i data-lucide="x" aria-hidden="true"></i></button>
        </div>
        <div class="market-tabs" aria-label="后勤功能">
          <button class="market-tab is-active" type="button" data-logistics-tab="market">交易行</button>
          <button class="market-tab" type="button" data-logistics-tab="buy">购买物资</button>
          <button class="market-tab" type="button" data-logistics-tab="requisition">军需处</button>
          <button class="market-tab" type="button" data-logistics-tab="analysis">分析处</button>
          <button class="market-tab" type="button" data-logistics-tab="gear">装备库</button>
          <button class="market-tab" type="button" data-logistics-tab="gunsmith">枪械改装</button>
          <button class="market-tab" type="button" data-logistics-tab="facilities">基地升级</button>
          <span id="logistics-description">出售已撤离物资，金币立即到账</span>
        </div>
        <div class="market-layout">
          <aside id="market-inventory" class="market-inventory">
            <div class="stash-summary">
              <div><span class="meta-label">库存估值</span><div class="stash-total-line"><span id="stash-total" class="stat-value">0</span><small>金币</small></div></div>
              <button id="sell-all" class="button button-danger-soft" type="button">全部出售</button>
            </div>
            <div class="market-categories" aria-label="物资分类">
              <button class="category-button is-active" type="button" data-stash-filter="all">全部</button>
              <button class="category-button" type="button" data-stash-filter="supplies">物资</button>
              <button class="category-button" type="button" data-stash-filter="electronics">电子</button>
              <button class="category-button" type="button" data-stash-filter="intel">情报</button>
              <button class="category-button" type="button" data-stash-filter="medical">医疗</button>
              <button class="category-button" type="button" data-stash-filter="helmet">头盔</button>
              <button class="category-button" type="button" data-stash-filter="armor">护甲</button>
              <button class="category-button" type="button" data-stash-filter="weapon">武器</button>
            </div>
            <div id="stash-list" class="stash-list"></div>
          </aside>
          <section id="market-detail" class="market-detail">
            <div id="market-item-visual" class="market-item-visual" data-rarity="white"><span>CE</span></div>
            <div class="market-detail-copy">
              <div id="market-rarity" class="eyebrow">选择物资</div>
              <h3 id="market-item-name">后勤交易终端</h3>
              <p id="market-item-description">从左侧仓库选择一件物资，查看估值并出售。</p>
              <div class="market-stats">
                <div><span>单件价格</span><strong id="market-unit-price">—</strong></div>
                <div><span>持有数量</span><strong id="market-quantity">—</strong></div>
                <div><span>全部价值</span><strong id="market-stack-price">—</strong></div>
              </div>
              <div class="market-item-actions">
                <button id="equip-loot" class="button" type="button" disabled>直接装备</button>
                <button id="sell-selected" class="button button-primary market-sell" type="button" disabled>出售 1 件</button>
              </div>
              <div id="sale-feedback" class="sale-feedback" aria-live="polite"></div>
            </div>
          </section>
          <section id="market-buy-detail" class="market-detail market-buy-detail" hidden>
            <div class="eyebrow">交易行 / 采购</div>
            <h3>物资采购目录</h3>
            <p>使用金币购买物资，购买后直接进入行动仓库。本次随机上架 8 件型号，数据库共 ${LOOT_CATALOG_SIZE.toLocaleString('zh-CN')} 种物资。</p>
            <div id="market-catalog" class="market-catalog"></div>
            <div id="purchase-feedback" class="sale-feedback" aria-live="polite"></div>
          </section>
          <section id="requisition-detail" class="market-detail requisition-detail" hidden>
            <div class="requisition-hero">
              <div><div class="eyebrow">军需处 / 行动补给</div><h3>使用金币购买行动补给</h3><p>军需处与交易行共用金币。购买的补给会在下一次部署时自动装入装备。</p></div>
              <div class="token-display"><span>可用金币</span><strong id="requisition-credit-large">0</strong></div>
            </div>
            <div class="supply-grid">
              <article class="supply-card"><span>防护</span><h4>复合护甲板</h4><p>下一局额外获得 30 护甲</p><b>1,600 金币</b><button class="button" type="button" data-buy-supply="armor">购买</button></article>
              <article class="supply-card"><span>弹药</span><h4>制式弹药箱</h4><p>下一局每把武器增加 30 发备弹</p><b>1,100 金币</b><button class="button" type="button" data-buy-supply="ammo">购买</button></article>
              <article class="supply-card"><span>医疗</span><h4>战地医疗组</h4><p>下一局额外携带 1 个医疗包</p><b>1,800 金币</b><button class="button" type="button" data-buy-supply="medical">购买</button></article>
            </div>
            <section class="ammo-shop" aria-labelledby="ammo-shop-title">
              <div class="ammo-shop-heading"><div><span>弹药配发</span><h4 id="ammo-shop-title">选择下一局弹药等级</h4></div><small>每次行动只能装载一种等级</small></div>
              <div id="ammo-pack-grid" class="ammo-pack-grid"></div>
            </section>
            <div id="loadout-preview" class="loadout-preview"></div>
            <div id="requisition-feedback" class="sale-feedback" aria-live="polite"></div>
          </section>
          <section id="analysis-detail" class="market-detail market-buy-detail analysis-detail" hidden>
            <div class="eyebrow">情报分析处 / 特殊通行权限</div>
            <h3>隐藏房间钥匙卡</h3>
            <p>购买后存入行动仓库。选择“装入下局”后，进入对应地图时会带进背包；刷门消耗一次，失败时会随背包丢失。</p>
            <div id="keycard-catalog" class="market-catalog"></div>
            <div id="keycard-feedback" class="sale-feedback" aria-live="polite"></div>
          </section>
          <section id="gear-detail" class="market-detail gear-detail" hidden>
            <div class="gear-hero">
              <div><div class="eyebrow">装备库 / 行动配置</div><h3>个人战术装备</h3><p>购买后选择穿戴，进入战区即属于本局携行。成功撤离会带回；死亡会遗失，安全箱不能保护穿戴装备。</p></div>
              <div id="gear-summary" class="gear-summary"></div>
            </div>
            <div id="gear-categories" class="gear-categories" aria-label="装备分类"></div>
            <div id="gear-grid" class="gear-grid"></div>
            <div id="gear-feedback" class="sale-feedback" aria-live="polite"></div>
          </section>
          <section id="gunsmith-detail" class="market-detail gunsmith-detail" hidden>
            <header class="gunsmith-header">
              <div><div class="eyebrow">战备工坊 / 枪械改装</div><h3 id="gunsmith-title">KR-56 突击步枪</h3></div>
              <div class="gunsmith-build-value"><span>已安装配件</span><strong id="gunsmith-installed-count">0 / 6</strong></div>
            </header>
            <div id="gunsmith-weapons" class="gunsmith-weapons" aria-label="选择武器"></div>
            <div class="gunsmith-workspace">
              <section class="gunsmith-blueprint" aria-label="武器改装部位">
                <div id="gunsmith-slots" class="gunsmith-slots"></div>
                <div id="gunsmith-weapon-model" class="gunsmith-weapon-model" data-weapon="rifle" aria-hidden="true">
                  <i class="gun-barrel"></i><i class="gun-handguard"></i><i class="gun-body"></i><i class="gun-stock"></i><i class="gun-grip"></i><i class="gun-magazine"></i><i class="gun-optic"></i>
                </div>
              </section>
              <aside id="gunsmith-stats" class="gunsmith-stats" aria-label="改装后武器属性"></aside>
            </div>
            <div class="gunsmith-catalog-heading"><div><span>当前部位</span><strong id="gunsmith-slot-title">枪口</strong></div><button id="gunsmith-remove" class="button" type="button" data-remove-mod>恢复标准配置</button></div>
            <div id="gunsmith-catalog" class="gunsmith-catalog"></div>
            <div id="gunsmith-feedback" class="sale-feedback" aria-live="polite"></div>
          </section>
          <section id="facility-detail" class="market-detail facility-detail" hidden>
            <div class="gear-hero">
              <div><div class="eyebrow">基地 / 永久建设</div><h3>设施升级</h3><p>升级长期保留，并持续改善装备采购和每次行动的初始补给。</p></div>
              <div class="facility-total"><span>基地等级</span><strong id="facility-progress">6 / 100</strong></div>
            </div>
            <div id="facility-grid" class="facility-grid"></div>
            <div id="facility-feedback" class="sale-feedback" aria-live="polite"></div>
          </section>
        </div>
      </div>
    </section>

    <section id="hud" class="hud" hidden>
      <div class="minimap-shell" aria-label="战术小地图">
        <canvas id="minimap" class="minimap" width="360" height="360"></canvas>
        <div id="minimap-name" class="minimap-name">九号物流港</div>
        <div id="mission-tracker" class="mission-tracker" aria-label="当前任务"></div>
      </div>
      <div class="hud-top">
        <div id="compass" class="compass">N&nbsp;&nbsp; 000° &nbsp;&nbsp;E</div>
        <div id="objective" class="objective">潜入仓库，取得加密硬盘</div>
      </div>
      <div id="operation-status" class="operation-status" hidden></div>
      <div class="hud-left">
        <div class="vital-row"><span>生命</span><div class="bar bar-health"><span id="health-bar"></span></div><b id="health-value">100</b></div>
        <div class="vital-row"><span>护甲</span><div class="bar bar-armor"><span id="armor-bar"></span></div><b id="armor-value">50</b></div>
        <div class="vital-row"><span>体力</span><div class="bar bar-stamina"><span id="stamina-bar"></span></div><b id="stamina-value">100</b></div>
        <div id="medkits" class="medkits">医疗包 × 2 · H 使用</div>
        <div id="injury-status" class="injury-status">身体状态正常</div>
        <div class="ability-bar" aria-label="战术技能">
          <div id="smoke-ability" class="ability-chip" data-state="ready">
            <i data-lucide="wind" aria-hidden="true"></i><kbd id="smoke-key">G</kbd><strong>烟幕</strong><span id="smoke-status">就绪</span>
          </div>
          <div id="magnetic-ability" class="ability-chip" data-state="ready">
            <i data-lucide="target" aria-hidden="true"></i><kbd>Q</kbd><strong>磁吸炸弹</strong><span id="magnetic-status">0 / 2</span>
          </div>
          <div id="adrenaline-ability" class="ability-chip" data-state="ready">
            <i data-lucide="activity" aria-hidden="true"></i><kbd id="adrenaline-key">V</kbd><strong>肾上腺素</strong><span id="adrenaline-status">就绪</span>
          </div>
          <div id="run-ability" class="ability-chip" data-state="ready">
            <i data-lucide="zap" aria-hidden="true"></i><kbd id="run-key">R</kbd><strong>快速冲刺</strong><span id="run-status">就绪</span>
          </div>
        </div>
      </div>
      <div class="hud-right">
        <div id="weapon-name" class="weapon-name">KR-56 突击步枪</div>
        <div class="ammo"><span id="ammo-level" class="ammo-level" title="当前弹药穿透等级">弹药 1 级</span><span id="ammo-mag" class="ammo-mag">30</span><span class="ammo-reserve">/ <span id="ammo-reserve">90</span></span></div>
        <div class="weapon-slots" aria-label="武器栏">
          <div class="weapon-slot is-active" data-weapon-slot="1"><kbd>1</kbd><span>KR-56</span></div>
          <div class="weapon-slot" data-weapon-slot="2"><kbd>2</kbd><span>V9</span></div>
          <div class="weapon-slot" data-weapon-slot="3"><kbd>3</kbd><span>SG-12</span></div>
          <div class="weapon-slot" data-weapon-slot="4"><kbd>4</kbd><span>AS VAL</span></div>
          <div class="weapon-slot" data-weapon-slot="5"><kbd>5</kbd><span>AWM</span></div>
          <div class="weapon-slot" data-weapon-slot="6"><kbd>6</kbd><span>M7</span></div>
        </div>
        <div id="aim-hint" class="aim-hint">1–6 切枪 · X 换弹 · 鼠标右键瞄准 · Q 磁吸炸弹 · H 医疗包</div>
      </div>
      <div id="crosshair" class="crosshair"><span></span></div>
      <div id="scope-view" class="scope-view" aria-hidden="true"><span></span></div>
      <button id="capture-controls" class="capture-controls" type="button">
        <strong>点击进入游戏控制</strong>
        <span>鼠标将固定在中央 · 移动鼠标转动视角 · Esc 退出</span>
      </button>
      <div id="control-status" class="control-status">视角控制：等待进入</div>
      <div id="boss-hud" class="boss-hud" hidden>
        <div><span>BOSS</span><strong id="boss-name">区域首领</strong><b id="boss-health-text">100%</b></div>
        <div class="boss-health-track"><span id="boss-health-bar"></span></div>
      </div>
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
      <section id="corpse-loot-panel" class="corpse-loot-panel" data-phase="searching" hidden>
        <header class="corpse-loot-header">
          <div>
            <span id="corpse-loot-eyebrow">敌方携行具</span>
            <strong id="corpse-loot-name">武装守卫的战术背包</strong>
          </div>
          <div class="corpse-loot-total"><span>可回收价值</span><b id="corpse-loot-value">识别中</b></div>
          <button id="corpse-loot-close" class="icon-button" type="button" aria-label="关闭搜刮界面"><i data-lucide="x" aria-hidden="true"></i></button>
        </header>
        <div class="corpse-loot-columns">
          <section class="corpse-loot-pane corpse-loot-source">
            <div class="corpse-pane-heading"><span id="loot-source-label">容器物资</span><b id="corpse-loot-capacity">0 / 6</b></div>
            <div id="corpse-equipment-strip" class="corpse-equipment-strip">
              <div><span>容器</span><b>物资储存单元</b></div>
              <div><span>物资偏向</span><b>综合物资</b></div>
              <div><span>搜索方式</span><b>逐格识别</b></div>
            </div>
            <div id="corpse-loot-grid" class="corpse-loot-grid"></div>
          </section>
          <section class="corpse-loot-pane corpse-player-pane">
            <div class="corpse-pane-heading"><span>我的战术背包</span><b id="corpse-player-capacity">0 / 12</b></div>
            <div class="player-loadout-strip">
              <div><span>当前武器</span><b id="corpse-player-weapon">KR-56 突击步枪</b></div>
              <div><span>背包估值</span><b id="corpse-player-value">0 金币</b></div>
            </div>
            <div id="corpse-player-grid" class="corpse-loot-grid corpse-player-grid"></div>
          </section>
        </div>
        <footer class="corpse-loot-footer">
          <div class="corpse-search-state">
            <span id="corpse-loot-message">正在检查携行具</span>
            <div class="corpse-search-track"><i id="corpse-search-progress"></i></div>
          </div>
          <div class="loot-footer-actions">
            <button id="loot-sort-backpack" class="button" type="button">整理背包</button>
            <button id="corpse-loot-take-all" class="button button-primary" type="button" disabled>全部拿取</button>
          </div>
        </footer>
      </section>
      <section id="field-market" class="field-market" hidden aria-label="战区黑市">
        <div class="field-market-panel">
          <header class="field-market-header">
            <div><div class="eyebrow">战区黑市 / 临时交换终端</div><h2>现场物资交换</h2></div>
            <button id="field-market-close" class="icon-button" type="button" aria-label="关闭黑市" data-tooltip="关闭"><i data-lucide="x" aria-hidden="true"></i></button>
          </header>
          <p id="field-market-summary" class="field-market-summary">可交换物资 0 件</p>
          <div class="field-market-trades">
            <button class="field-market-trade" type="button" data-field-trade="ammo"><strong>补充弹药</strong><span>物资换 30 发备弹</span></button>
            <button class="field-market-trade" type="button" data-field-trade="medical"><strong>医疗补给</strong><span>物资换 1 个医疗包</span></button>
            <button class="field-market-trade" type="button" data-field-trade="intel"><strong>撤离情报</strong><span>物资换取撤离点情报</span></button>
          </div>
          <small class="field-market-note">武器、防具和头盔不能直接交换；每次交易消耗 1 件普通战区物资。</small>
        </div>
      </section>
      <div id="toast" class="toast" hidden></div>
      <div id="extraction-progress" class="extraction-progress" hidden>
        <div id="extraction-label">撤离信号确认 0.0 / 6.0</div>
        <div class="bar"><span id="extraction-bar"></span></div>
      </div>
      <div id="inventory-panel" class="inventory-panel" hidden>
        <div class="inventory-title"><strong>战术背包</strong><span id="inventory-value">估值 0</span><span id="inventory-selection-count" class="inventory-selection-count">未选择</span><button id="inventory-discard" class="button" type="button" disabled>丢弃</button><button id="inventory-destroy" class="button button-danger" type="button" disabled>销毁</button><button id="inventory-sort" type="button">整理</button><button id="inventory-close" type="button">关闭</button></div>
        <div class="secure-container-heading"><strong>安全箱</strong><span id="secure-container-count">0 / 2</span><small>箱内物资失败后仍会保留</small></div>
        <div id="secure-container-grid" class="secure-container-grid"></div>
        <div id="inventory-grid" class="inventory-grid"></div>
      </div>
    </section>

    <div id="deploying" class="deploying" hidden>
      <div class="deploying-inner"><div id="deploying-region" class="eyebrow">K-17 / 九号物流港</div><h2>正在进入行动区域</h2><div class="deploying-line"><span></span></div></div>
    </div>
    <div id="damage-flash" class="damage-flash"></div>

    <section id="pause-screen" class="pause-screen" hidden>
      <div class="pause-panel">
        <div class="eyebrow">行动暂停</div><h2>保持警戒</h2>
        <div class="actions actions-center">
          <button id="resume-button" class="button button-primary" type="button"><i data-lucide="play" aria-hidden="true"></i>继续行动</button>
          <button id="pause-settings-button" class="button" type="button"><i data-lucide="settings" aria-hidden="true"></i>游戏设置</button>
          <button id="abort-button" class="button button-danger" type="button">放弃行动</button>
        </div>
      </div>
    </section>

    <section id="settings-screen" class="settings-screen" hidden aria-label="游戏设置">
      <div class="settings-panel">
        <header class="settings-header">
          <div><div class="eyebrow">系统 / 个性化</div><h2>游戏设置</h2></div>
          <button id="settings-close" class="icon-button" type="button" aria-label="关闭设置" data-tooltip="关闭"><i data-lucide="x" aria-hidden="true"></i></button>
        </header>
        <div class="settings-body">
          <section class="settings-section">
            <div class="settings-section-title"><h3>操作与视角</h3><span>滑动后立即生效</span></div>
            <label class="setting-slider"><span>鼠标灵敏度 <b id="mouse-sensitivity-value">1.00</b></span><input data-setting="mouseSensitivity" type="range" min="0.2" max="3" step="0.05"></label>
            <label class="setting-slider"><span>触控板灵敏度 <b id="trackpad-sensitivity-value">1.00</b></span><input data-setting="trackpadSensitivity" type="range" min="0.2" max="3" step="0.05"></label>
            <label class="setting-slider"><span>视野大小 <b id="fov-value">74°</b></span><input data-setting="fieldOfView" type="range" min="60" max="100" step="1"></label>
            <label class="setting-slider"><span>总音量 <b id="volume-value">65%</b></span><input data-setting="volume" type="range" min="0" max="1" step="0.01"></label>
            <div class="setting-row setting-quality"><span>画质</span><div id="quality-options" class="quality-options">
              <button type="button" data-quality="low">流畅</button><button type="button" data-quality="medium">均衡</button><button type="button" data-quality="high">高清</button><button type="button" data-quality="ultra">极致</button>
            </div></div>
          </section>
          <section class="settings-section crosshair-settings">
            <div class="settings-section-title"><h3>准星</h3><span>右侧实时预览</span></div>
            <div class="crosshair-preview" aria-label="准星预览"><div class="preview-crosshair"><span></span></div></div>
            <div class="color-controls">
              <label>颜色 <input id="crosshair-color" data-setting="crosshairColor" type="color"></label>
              <div class="color-swatches" aria-label="常用准星颜色">
                <button type="button" data-crosshair-color="#f4f7f0" style="--swatch:#f4f7f0" aria-label="白色"></button>
                <button type="button" data-crosshair-color="#d3e468" style="--swatch:#d3e468" aria-label="黄绿色"></button>
                <button type="button" data-crosshair-color="#52e3ff" style="--swatch:#52e3ff" aria-label="青色"></button>
                <button type="button" data-crosshair-color="#ff4d4d" style="--swatch:#ff4d4d" aria-label="红色"></button>
              </div>
            </div>
            <label class="setting-slider"><span>准星大小 <b id="crosshair-size-value">28</b></span><input data-setting="crosshairSize" type="range" min="16" max="46" step="1"></label>
            <label class="setting-slider"><span>准星透明度 <b id="crosshair-opacity-value">90%</b></span><input data-setting="crosshairOpacity" type="range" min="0.2" max="1" step="0.05"></label>
          </section>
          <section class="settings-section key-settings">
            <div class="settings-section-title"><h3>按键设置</h3><span>点击按键后，再按下你想使用的新键</span></div>
            <div id="key-bindings" class="key-bindings"></div>
            <div id="key-binding-feedback" class="key-binding-feedback" aria-live="polite"></div>
          </section>
        </div>
        <footer class="settings-footer">
          <button id="settings-reset" class="button" type="button"><i data-lucide="rotate-ccw" aria-hidden="true"></i>恢复默认</button>
          <button id="settings-done" class="button button-primary" type="button">完成</button>
        </footer>
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
        <div id="result-details" class="result-details"></div>
        <div class="actions actions-center">
          <button id="retry-button" class="button button-primary" type="button"><i data-lucide="rotate-ccw" aria-hidden="true"></i>再次部署</button>
          <button id="result-stash-button" class="button" type="button"><i data-lucide="package-open" aria-hidden="true"></i>查看仓库</button>
        </div>
      </div>
    </section>

    <section id="codex-screen" class="stash-screen" hidden aria-label="行动图鉴">
      <div class="panel market-panel codex-panel">
        <div class="panel-header"><div><div class="eyebrow">情报库 / 长期收藏</div><h2>行动图鉴</h2></div><button id="codex-close" class="icon-button" type="button" aria-label="关闭图鉴"><i data-lucide="x" aria-hidden="true"></i></button></div>
        <div class="codex-summary"><strong id="codex-progress">0 / 0</strong><span>已发现物资与秘密</span></div>
        <div id="codex-grid" class="codex-grid"></div>
      </div>
    </section>

    <section id="runtime-error-screen" class="runtime-error-screen" hidden role="alert">
      <div class="runtime-error-panel">
        <div class="eyebrow">运行保护已启动</div>
        <h2>游戏已安全暂停</h2>
        <p>画面遇到临时问题，系统已经停止本局，避免白屏或页面卡死。</p>
        <button id="runtime-reload-button" class="button button-primary" type="button"><i data-lucide="rotate-ccw" aria-hidden="true"></i>重新载入游戏</button>
      </div>
    </section>

    <section class="mobile-blocker">
      <div><div class="eyebrow">桌面行动终端</div><h1>临界撤离</h1><p>当前行动需要桌面浏览器、键盘与鼠标。请在电脑上打开以进入战区。</p></div>
    </section>
  </main>
`;

const ICONS = {
  Activity, Archive, BookOpen, Backpack, BriefcaseMedical, ChevronUp, Coins, Crosshair, Dumbbell,
  HardHat, PackageOpen, Play, Radio, RotateCcw, Settings, Shield, Target, Warehouse, Wind, Wrench, X, Zap,
};
createIcons({ icons: ICONS });

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};

const storedProfile = readStoredValue(PROFILE_KEY);
const storedSettings = readStoredValue(SETTINGS_KEY);
let profile: PersistentProfile = parseProfile(storedProfile.value);
let gameSettings: GameSettings = parseSettings(storedSettings.value);
let latestRun: RunState = createRunState();
let toastTimer = 0;
let storageWarningShown = false;
let storageWarningPending = !storedProfile.available || !storedSettings.available;
let selectedMap: MapId = 'harbor';
let selectedDifficulty: DifficultyId = 'standard';
let selectedBossMode: BossMode = 'single';
let selectedGameMode: GameModeId = 'extraction';
let selectedStashItemId: string | null = null;
let stashFilter: InventoryItem['kind'] | 'all' = 'all';
let gearFilter: GearCategory | 'all' = 'all';
let selectedGunsmithWeapon: GunsmithWeaponId = 'rifle';
let selectedGunsmithSlot: WeaponModSlot = 'muzzle';
let activeBackpackSlots = 12;
let activeExtractionTarget = 6;
let activeCorpseLootView: LootSearchView | null = null;
let lastMissionTaskSignature = '';
let lastInventorySignature = '';
const selectedInventoryItemIds = new Set<string>();
let lastCorpseLootSignature = '';
let draggedLootItem: { id: string; origin: 'loot' | 'backpack' } | null = null;
let pointerLootDrag: { id: string; origin: 'loot' | 'backpack'; startX: number; startY: number; active: boolean; element: HTMLElement } | null = null;
let suppressLootClick = false;
let pendingKeyAction: GameAction | null = null;
let settingsReturnToPause = false;
let deploymentStashOpen = false;
let deploymentPanelOpen = false;

const menuScreen = byId<HTMLElement>('menu-screen');
const gameShell = byId<HTMLElement>('game-shell');
const topbar = byId<HTMLElement>('topbar');
const hud = byId<HTMLElement>('hud');
const stashScreen = byId<HTMLElement>('stash-screen');
const pauseScreen = byId<HTMLElement>('pause-screen');
const resultScreen = byId<HTMLElement>('result-screen');
const runtimeErrorScreen = byId<HTMLElement>('runtime-error-screen');
const deploying = byId<HTMLElement>('deploying');
const inventoryPanel = byId<HTMLElement>('inventory-panel');
const settingsScreen = byId<HTMLElement>('settings-screen');
const codexScreen = byId<HTMLElement>('codex-screen');
const fieldMarket = byId<HTMLElement>('field-market');

function applyCrosshairSettings(): void {
  gameShell.style.setProperty('--crosshair-color', gameSettings.crosshairColor);
  gameShell.style.setProperty('--crosshair-size', `${gameSettings.crosshairSize}px`);
  gameShell.style.setProperty('--crosshair-opacity', String(gameSettings.crosshairOpacity));
}

function renderSettings(): void {
  const values: Array<[keyof GameSettings, string]> = [
    ['mouseSensitivity', String(gameSettings.mouseSensitivity)],
    ['trackpadSensitivity', String(gameSettings.trackpadSensitivity)],
    ['fieldOfView', String(gameSettings.fieldOfView)],
    ['volume', String(gameSettings.volume)],
    ['crosshairSize', String(gameSettings.crosshairSize)],
    ['crosshairOpacity', String(gameSettings.crosshairOpacity)],
  ];
  for (const [name, value] of values) {
    const input = settingsScreen.querySelector<HTMLInputElement>(`[data-setting="${name}"]`);
    if (input) input.value = value;
  }
  byId<HTMLInputElement>('crosshair-color').value = gameSettings.crosshairColor;
  byId('mouse-sensitivity-value').textContent = gameSettings.mouseSensitivity.toFixed(2);
  byId('trackpad-sensitivity-value').textContent = gameSettings.trackpadSensitivity.toFixed(2);
  byId('fov-value').textContent = `${Math.round(gameSettings.fieldOfView)}°`;
  byId('volume-value').textContent = `${Math.round(gameSettings.volume * 100)}%`;
  byId('crosshair-size-value').textContent = String(Math.round(gameSettings.crosshairSize));
  byId('crosshair-opacity-value').textContent = `${Math.round(gameSettings.crosshairOpacity * 100)}%`;
  for (const button of settingsScreen.querySelectorAll<HTMLButtonElement>('[data-quality]')) {
    button.classList.toggle('is-selected', button.dataset.quality === gameSettings.quality);
  }
  for (const button of settingsScreen.querySelectorAll<HTMLButtonElement>('[data-crosshair-color]')) {
    button.classList.toggle('is-selected', button.dataset.crosshairColor?.toLowerCase() === gameSettings.crosshairColor.toLowerCase());
  }
  byId('key-bindings').innerHTML = (Object.keys(SETTINGS_ACTION_LABELS) as GameAction[]).map((action) => `
    <div class="key-binding-row"><span>${SETTINGS_ACTION_LABELS[action]}</span><button type="button" data-key-action="${action}" class="key-binding-button${pendingKeyAction === action ? ' is-listening' : ''}">${pendingKeyAction === action ? '请按键…' : keyLabel(gameSettings.keyBindings[action])}</button></div>
  `).join('');
  const weaponActions: GameAction[] = ['weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5', 'weapon6'];
  weaponActions.forEach((action, index) => {
    const label = gameShell.querySelector<HTMLElement>(`[data-weapon-slot="${index + 1}"] kbd`);
    if (label) label.textContent = keyLabel(gameSettings.keyBindings[action]);
  });
  byId('smoke-key').textContent = keyLabel(gameSettings.keyBindings.smoke);
  byId('adrenaline-key').textContent = keyLabel(gameSettings.keyBindings.adrenaline);
  byId('run-key').textContent = keyLabel(gameSettings.keyBindings.run);
  byId('aim-hint').textContent = `1–6 切枪 · ${keyLabel(gameSettings.keyBindings.reload)} 换弹 · ${keyLabel(gameSettings.keyBindings.run)} 冲刺 · ${keyLabel(gameSettings.keyBindings.inspect)} 检视 · 鼠标右键瞄准 · Q 磁吸炸弹 · ${keyLabel(gameSettings.keyBindings.heal)} 医疗包`;
  applyCrosshairSettings();
}

function saveProfile(): void {
  if (!writeStoredValue(PROFILE_KEY, JSON.stringify(profile))) showStorageWarning();
  renderProfile();
}

function renderProfile(): void {
  byId('credits').textContent = profile.credits.toLocaleString('zh-CN');
  byId('stash-credits').textContent = profile.credits.toLocaleString('zh-CN');
  byId('requisition-credit-large').textContent = profile.credits.toLocaleString('zh-CN');
  byId('stash-total').textContent = inventoryValue(profile.stash).toLocaleString('zh-CN');
  const list = byId('stash-list');
  list.innerHTML = '';
  const visibleItems = stashFilter === 'all'
    ? profile.stash
    : profile.stash.filter((item) => item.kind === stashFilter);
  if (!visibleItems.some((item) => item.id === selectedStashItemId)) {
    selectedStashItemId = visibleItems[0]?.id ?? null;
  }
  if (visibleItems.length === 0) {
    list.innerHTML = '<div class="empty-state">暂无已撤离物资</div>';
  } else {
    for (const item of visibleItems) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'stash-item';
      row.dataset.rarity = item.rarity;
      row.dataset.itemId = item.id;
      row.classList.toggle('is-selected', item.id === selectedStashItemId);
      row.innerHTML = `<span class="stash-item-icon" data-rarity="${item.rarity}">${item.name.slice(0, 1)}</span><span><span class="stash-item-name">${item.name}</span><span class="loot-kind">${kindLabel(item.kind)} · 数量 ${item.quantity}</span></span><span class="stash-value">${(item.value * item.quantity).toLocaleString('zh-CN')}</span>`;
      list.append(row);
    }
  }
  byId<HTMLButtonElement>('sell-all').disabled = profile.stash.length === 0;
  renderMarketDetail();
  renderMarketCatalog();
  renderRequisitionDetail();
  renderKeycardCatalog();
  renderGearCatalog();
  renderGunsmith();
  renderFacilities();
  renderCodex();
  renderDeploymentLoadout();
  createIcons({ icons: ICONS });
}

function renderCodex(): void {
  const entries = LOOT_CATALOG.map((item) => ({ id: item.id, name: item.name, rarity: item.rarity, value: item.value, kind: item.kind, found: profile.collectionItemIds.includes(item.id) }));
  const found = entries.filter((entry) => entry.found).length;
  byId('codex-progress').textContent = `${found} / ${entries.length}`;
  byId('codex-grid').innerHTML = entries.map((entry) => `<article class="codex-entry${entry.found ? ' is-found' : ''}" data-rarity="${entry.rarity}"><span>${entry.found ? entry.name.slice(0, 1) : '?'}</span><strong>${entry.found ? entry.name : '未发现物资'}</strong><small>${entry.found ? `${rarityLabel(entry.rarity)} · ${entry.value.toLocaleString('zh-CN')} 金币` : '在战区搜索并成功带出后解锁'}</small></article>`).join('');
}

function kindLabel(kind: InventoryItem['kind']): string {
  const labels: Record<InventoryItem['kind'], string> = {
    supplies: '战备物资',
    electronics: '电子设备',
    intel: '情报文件',
    medical: '医疗用品',
    helmet: '头盔装备',
    armor: '防护装备',
    weapon: '武器装备',
  };
  return labels[kind];
}

function rarityLabel(rarity: InventoryItem['rarity']): string {
  return { black: '损坏', white: '普通', green: '优良', blue: '稀有', purple: '史诗', gold: '高价值', red: '绝密' }[rarity];
}

function renderMarketDetail(): void {
  const item = profile.stash.find((entry) => entry.id === selectedStashItemId);
  const sellButton = byId<HTMLButtonElement>('sell-selected');
  const equipButton = byId<HTMLButtonElement>('equip-loot');
  const visual = byId('market-item-visual');
  if (!item) {
    visual.dataset.rarity = 'white';
    visual.innerHTML = '<span>CE</span>';
    byId('market-rarity').textContent = '选择物资';
    byId('market-item-name').textContent = '后勤交易终端';
    byId('market-item-description').textContent = '从左侧仓库选择一件物资，查看估值并出售。';
    byId('market-unit-price').textContent = '—';
    byId('market-quantity').textContent = '—';
    byId('market-stack-price').textContent = '—';
    sellButton.disabled = true;
    equipButton.disabled = true;
    equipButton.textContent = '直接装备';
    return;
  }
  visual.dataset.rarity = item.rarity;
  visual.innerHTML = `<span>${item.name.slice(0, 1)}</span><small>${kindLabel(item.kind)}</small>`;
  byId('market-rarity').textContent = `${rarityLabel(item.rarity)}物资 / ${kindLabel(item.kind)}`;
  byId('market-item-name').textContent = item.name;
  byId('market-item-description').textContent = item.description ?? '行动中回收的物资，可由后勤交易终端立即收购。出售所得会直接存入你的金币余额。';
  byId('market-unit-price').textContent = `${item.value.toLocaleString('zh-CN')} 金币`;
  byId('market-quantity').textContent = `${item.quantity} 件`;
  byId('market-stack-price').textContent = `${(item.value * item.quantity).toLocaleString('zh-CN')} 金币`;
  sellButton.disabled = false;
  sellButton.textContent = `出售 1 件 · +${item.value.toLocaleString('zh-CN')}`;
  const equipable = isEquipableLoot(item);
  const equipped = Object.values(profile.equippedGear).includes(item.id);
  equipButton.disabled = !equipable || equipped;
  equipButton.textContent = equipped ? '当前已装备' : equipable ? '直接装备' : '不可装备';
}

function renderRequisitionDetail(): void {
  const gear = resolveLoadout(profile);
  const activeAmmoLevel = gear.ammoLevel;
  byId('loadout-preview').textContent = `装备提供：护甲 +${gear.armor} · ${gear.backpackSlots} 格背包 · 医疗 +${gear.medkits} · 武器基础备弹 +${gear.ammo}。弹药包需要购买后装进胸挂，行动失败会遗失。`;
  const hasAmmoPack = false;
  byId('ammo-pack-grid').innerHTML = AMMO_PACKS.map((pack) => {
    const selected = profile.nextRunAmmoLevel === pack.level;
    const unavailable = hasAmmoPack && !selected;
    const disabled = selected || unavailable || profile.credits < pack.cost;
    const buttonText = selected ? '已装载' : unavailable ? '已有配发' : profile.credits < pack.cost ? '金币不足' : '购买';
    return `<article class="ammo-pack-card${selected ? ' is-selected' : ''}" data-ammo-level="${pack.level}">
      <div class="ammo-pack-level"><span>${pack.level}</span><small>级</small></div>
      <div><h5>${pack.name}</h5><p>${pack.description}</p><small>${pack.rounds} 发 · ${pack.cost.toLocaleString('zh-CN')} 金币</small></div>
      <button class="button" type="button" data-buy-ammo-level="${pack.level}"${disabled ? ' disabled' : ''}>${buttonText}</button>
    </article>`;
  }).join('');
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-buy-supply]')) {
    const supply = button.dataset.buySupply;
    const costs = supply === 'armor' ? 1600 : supply === 'ammo' ? 1100 : 1800;
    button.disabled = profile.credits < costs;
  }
}

function renderMarketCatalog(): void {
  const catalog = byId('market-catalog');
  catalog.innerHTML = MARKET_CATALOG.map(({ item, price }) => `
    <article class="catalog-card" data-rarity="${item.rarity}">
      <span class="catalog-icon">${item.name.slice(0, 1)}</span>
      <div><small>${rarityLabel(item.rarity)} · ${kindLabel(item.kind)}</small><h4>${item.name}</h4><p>购买后存入行动仓库</p></div>
      <strong>${price.toLocaleString('zh-CN')} 金币</strong>
      <button class="button" type="button" data-buy-market="${item.id}" ${profile.credits < price ? 'disabled' : ''}>购买</button>
    </article>`).join('');
}

function renderKeycardCatalog(): void {
  byId('keycard-catalog').innerHTML = KEYCARD_OFFERS.map((offer) => {
    const ownedCards = profile.stash.filter((item) => item.id === offer.item.id);
    const ownedCount = ownedCards.reduce((sum, item) => sum + item.quantity, 0);
    const selected = ownedCount > 0 && profile.selectedKeycardId === offer.item.id;
    const currentUses = ownedCards[0]?.keyUses ?? offer.item.keyUses ?? 1;
    const action = ownedCount === 0 ? 'buy' : selected ? 'clear' : 'select';
    const disabled = action === 'buy' && profile.credits < offer.price;
    const buttonText = action === 'buy'
      ? `${offer.price.toLocaleString('zh-CN')} 金币`
      : selected ? '取消装入' : '装入下局';
    return `
      <article class="catalog-card keycard-card${selected ? ' is-selected' : ''}" data-rarity="${offer.item.rarity}">
        <span class="catalog-icon">卡</span>
        <div><small>${rarityLabel(offer.item.rarity)}房卡 · ${offer.mapName}</small><h4>${offer.item.name}</h4><p>开启${offer.roomName} · ${offer.item.maxKeyUses ?? 1} 次耐久</p></div>
        <strong>${ownedCount > 0 ? `持有 ${ownedCount} 张 · 当前剩余 ${currentUses} 次` : '分析处限量供应'}</strong>
        <button class="button" type="button" data-keycard-action="${action}" data-keycard-id="${offer.item.id}" ${disabled ? 'disabled' : ''}>${buttonText}</button>
      </article>`;
  }).join('');
}

function gearStatText(item: (typeof GEAR_CATALOG)[number]): string {
  if (item.armorBonus) return `护甲 +${item.armorBonus}`;
  if (item.backpackSlots) return `${item.backpackSlots} 格容量`;
  if (item.medkitBonus) return `医疗包 +${item.medkitBonus}`;
  if (item.weaponId) return item.ammoBonus ? `备弹 +${item.ammoBonus}` : '制式主武器';
  return '基础配置';
}

function renderGearCatalog(): void {
  const categories = byId('gear-categories');
  categories.innerHTML = GEAR_CATEGORIES.map((category) => `
    <button class="gear-category${gearFilter === category.id ? ' is-active' : ''}" type="button" data-gear-filter="${category.id}">${category.label}</button>
  `).join('');
  const visible = gearFilter === 'all' ? GEAR_CATALOG : GEAR_CATALOG.filter((item) => item.category === gearFilter);
  byId('gear-grid').innerHTML = visible.map((item) => {
    const owned = profile.ownedGear.includes(item.id);
    const equipped = profile.equippedGear[item.category] === item.id;
    const price = gearPrice(profile, item);
    const action = owned ? 'equip' : 'buy';
    const disabled = equipped || (!owned && profile.credits < price);
    const policy = profile.insurancePolicies.find((entry) => entry.itemId === item.id && (entry.status === 'covered' || entry.status === 'active'));
    const durability = gearDurabilityPercent(profile, item.id);
    const repairCost = gearRepairCost(profile, item.id, price);
    return `
      <article class="gear-card${equipped ? ' is-equipped' : ''}" data-rarity="${item.rarity}">
        <div class="gear-card-heading"><span>${rarityLabel(item.rarity)} · ${GEAR_CATEGORIES.find((entry) => entry.id === item.category)?.label}</span><strong>${item.name}</strong></div>
        <div class="gear-art" data-category="${item.category}"><i data-lucide="${item.icon}" aria-hidden="true"></i><span></span></div>
        <div class="gear-card-stats"><b>${gearStatText(item)}</b><span>${item.weight.toFixed(1)} KG</span></div>
        ${owned ? `<div class="gear-card-condition" data-condition="${durability < 25 ? 'critical' : durability < 60 ? 'worn' : 'good'}"><span>装备耐久</span><strong>${durability}%</strong><i><em style="width:${durability}%"></em></i></div>` : ''}
        <p>${item.description}</p>
        <button class="button" type="button" data-gear-action="${action}" data-gear-id="${item.id}" ${disabled ? 'disabled' : ''}>
          ${equipped ? '已装备' : owned ? '装备' : `${price.toLocaleString('zh-CN')} 金币`}
        </button>
        ${owned ? `<button class="button button-soft" type="button" data-insure-gear="${item.id}" ${policy ? 'disabled' : ''}>${policy ? (policy.status === 'active' ? '保险返还处理中' : '本件已投保') : `投保 · ${Math.max(100, Math.round(price * 0.08)).toLocaleString('zh-CN')} 金币`}</button>` : ''}
        ${owned && durability < 100 ? `<button class="button button-soft" type="button" data-repair-gear="${item.id}" ${profile.credits < repairCost ? 'disabled' : ''}>维修至 100% · ${repairCost.toLocaleString('zh-CN')} 金币</button>` : ''}
      </article>`;
  }).join('');
  const loadout = resolveLoadout(profile);
  byId('gear-summary').innerHTML = `<span>当前加成</span><strong>护甲 +${loadout.armor}</strong><b>${loadout.backpackSlots} 格 · 医疗 +${loadout.medkits} · 备弹 +${loadout.ammo}</b>`;
}

function modificationEffectText(modification: WeaponModification): string {
  const effects = modification.effects;
  const labels: string[] = [];
  if (effects.recoilMultiplier !== undefined) labels.push(`后坐力 ${effects.recoilMultiplier <= 1 ? '-' : '+'}${Math.round(Math.abs(1 - effects.recoilMultiplier) * 100)}%`);
  if (effects.spreadMultiplier !== undefined) labels.push(`散布 ${effects.spreadMultiplier <= 1 ? '-' : '+'}${Math.round(Math.abs(1 - effects.spreadMultiplier) * 100)}%`);
  if (effects.reloadMultiplier !== undefined) labels.push(`换弹 ${effects.reloadMultiplier <= 1 ? '-' : '+'}${Math.round(Math.abs(1 - effects.reloadMultiplier) * 100)}%`);
  if (effects.noiseMultiplier !== undefined) labels.push(`枪声 ${effects.noiseMultiplier <= 1 ? '-' : '+'}${Math.round(Math.abs(1 - effects.noiseMultiplier) * 100)}%`);
  if (effects.magazineBonus) labels.push(`弹匣 +${effects.magazineBonus}`);
  if (effects.reserveBonus) labels.push(`备弹 +${effects.reserveBonus}`);
  if (effects.aimFovDelta) labels.push(effects.aimFovDelta < 0 ? `倍率 +${Math.abs(effects.aimFovDelta)}` : `视野 +${effects.aimFovDelta}`);
  return labels.join(' · ');
}

function renderGunsmith(): void {
  const weapon = GUNSMITH_WEAPONS.find((entry) => entry.id === selectedGunsmithWeapon) ?? GUNSMITH_WEAPONS[0];
  const build = profile.weaponBuilds[selectedGunsmithWeapon] ?? {};
  const effects = resolveWeaponBuild(profile, selectedGunsmithWeapon);
  const installedCount = Object.values(build).filter(Boolean).length;
  byId('gunsmith-title').textContent = weapon.name;
  byId('gunsmith-installed-count').textContent = `${installedCount} / ${WEAPON_MOD_SLOTS.length}`;
  byId('gunsmith-weapons').innerHTML = GUNSMITH_WEAPONS.map((entry) => `
    <button class="gunsmith-weapon-tab${entry.id === selectedGunsmithWeapon ? ' is-active' : ''}" type="button" data-gunsmith-weapon="${entry.id}">
      <span>${entry.shortName}</span><b>${Object.values(profile.weaponBuilds[entry.id] ?? {}).filter(Boolean).length} / 6</b>
    </button>`).join('');
  byId('gunsmith-slots').innerHTML = WEAPON_MOD_SLOTS.map((slot) => {
    const installed = WEAPON_MODIFICATIONS.find((entry) => entry.id === build[slot.id]);
    return `<button class="gunsmith-slot${slot.id === selectedGunsmithSlot ? ' is-active' : ''}" type="button" data-gunsmith-slot="${slot.id}" data-slot="${slot.id}">
      <span>${slot.mark}</span><small>${slot.label}</small><strong>${installed?.name ?? '标准配置'}</strong>
    </button>`;
  }).join('');
  byId('gunsmith-weapon-model').dataset.weapon = selectedGunsmithWeapon;
  const statRows = [
    ['后坐控制', Math.round(58 / effects.recoilMultiplier), `${Math.round((1 - effects.recoilMultiplier) * 100)}%`],
    ['射击精度', Math.round(58 / effects.spreadMultiplier), `${Math.round((1 - effects.spreadMultiplier) * 100)}%`],
    ['换弹速度', Math.round(58 / effects.reloadMultiplier), `${Math.round((1 - effects.reloadMultiplier) * 100)}%`],
    ['隐蔽性能', Math.round(46 / effects.noiseMultiplier), `${Math.round((1 - effects.noiseMultiplier) * 100)}%`],
    ['弹匣容量', 48 + effects.magazineBonus * 2, `+${effects.magazineBonus}`],
    ['备弹储量', 48 + Math.round(effects.reserveBonus / 2), `+${effects.reserveBonus}`],
  ] as const;
  byId('gunsmith-stats').innerHTML = `<div class="gunsmith-stats-title"><span>武器性能</span><strong>${installedCount === 0 ? '原厂' : `改装 ${installedCount} 项`}</strong></div>${statRows.map(([label, value, delta]) => `
    <div class="gunsmith-stat"><div><span>${label}</span><b>${delta}</b></div><i><em style="width:${Math.max(8, Math.min(100, value))}%"></em></i></div>`).join('')}`;
  const selectedSlot = WEAPON_MOD_SLOTS.find((entry) => entry.id === selectedGunsmithSlot)!;
  byId('gunsmith-slot-title').textContent = selectedSlot.label;
  byId<HTMLButtonElement>('gunsmith-remove').disabled = !build[selectedGunsmithSlot];
  byId('gunsmith-catalog').innerHTML = WEAPON_MODIFICATIONS.filter((entry) => entry.slot === selectedGunsmithSlot).map((modification) => {
    const owned = profile.ownedWeaponMods.includes(modification.id);
    const installed = build[selectedGunsmithSlot] === modification.id;
    const price = weaponModificationPrice(profile, modification);
    return `<article class="gunsmith-part${installed ? ' is-installed' : ''}" data-rarity="${modification.rarity}">
      <div class="gunsmith-part-art"><span>${selectedSlot.mark}</span><i></i></div>
      <div><small>${rarityLabel(modification.rarity)} · ${selectedSlot.label}</small><h4>${modification.name}</h4><p>${modification.description}</p><b>${modificationEffectText(modification)}</b></div>
      <button class="button" type="button" data-mod-action="${owned ? 'equip' : 'buy'}" data-mod-id="${modification.id}" ${installed || (!owned && profile.credits < price) ? 'disabled' : ''}>
        ${installed ? '已安装' : owned ? '安装' : `${price.toLocaleString('zh-CN')} 金币`}
      </button>
    </article>`;
  }).join('');
}

function renderFacilities(): void {
  const totalLevel = FACILITIES.reduce((sum, facility) => sum + (profile.facilityLevels[facility.id] ?? 1), 0);
  byId('facility-progress').textContent = `${totalLevel} / ${BASE_MAX_LEVEL}`;
  byId('facility-grid').innerHTML = FACILITIES.map((facility) => {
    const level = profile.facilityLevels[facility.id] ?? 1;
    const cost = facilityUpgradeCost(facility, level);
    return `
      <article class="facility-card" data-level="${level}">
        <div class="facility-icon"><i data-lucide="${facility.icon}" aria-hidden="true"></i></div>
        <div class="facility-copy"><span>等级 ${level} / ${facility.maxLevel}</span><h4>${facility.name}</h4><p>${facility.description}</p><b>${facility.effect}</b></div>
        <div class="facility-levels" aria-label="当前等级 ${level}，最高 ${facility.maxLevel}"><i style="width: ${(level / facility.maxLevel) * 100}%"></i></div>
        <button class="button" type="button" data-upgrade-facility="${facility.id}" ${cost === null || profile.credits < cost ? 'disabled' : ''}>
          ${cost === null ? '已满级' : `<span>${cost.toLocaleString('zh-CN')} 金币</span><i data-lucide="chevron-up" aria-hidden="true"></i>`}
        </button>
      </article>`;
  }).join('');
}

function renderDeploymentLoadout(): void {
  const deploymentPanel = byId<HTMLElement>('deployment-loadout');
  deploymentPanel.hidden = !deploymentPanelOpen;
  const categories: GearCategory[] = ['helmet', 'armor', 'backpack', 'medical', 'weapon'];
  const loadout = resolveLoadout(profile);
  const selectedKeycard = KEYCARD_OFFERS.find((offer) => offer.item.id === profile.selectedKeycardId);
  const hasSelectedKeycard = selectedKeycard
    && profile.stash.some((item) => item.id === selectedKeycard.item.id && (item.keyUses ?? 0) > 0);
  const keycardSlot = hasSelectedKeycard
    ? `<span data-rarity="${selectedKeycard.item.rarity}"><i data-lucide="radio" aria-hidden="true"></i><b>${selectedKeycard.item.name}</b></span>`
    : '';
  const equipment = categories.map((category) => {
    const item = equippedItem(profile, category);
    return `<span data-rarity="${item?.rarity ?? 'white'}"><i data-lucide="${item?.icon ?? 'shield'}" aria-hidden="true"></i><b>${item?.name ?? '未装备'}</b></span>`;
  }).join('');
  const slot = (item: InventoryItem, zone: 'rig' | 'backpack' | 'secure') => {
    const width = item.slotWidth ?? 1;
    const height = item.slotHeight ?? 1;
    const footprint = width * height;
    return `<button class="deployment-item" style="--item-w:${width};--item-h:${height}" type="button" data-deployment-action="unstage" data-deployment-zone="${zone}" data-deployment-item="${item.id}" data-rarity="${item.rarity}" title="占用 ${footprint} 格（${width}×${height}）">
      <i data-lucide="minus" aria-hidden="true"></i><b>${item.name}</b><small>×${item.quantity} · ${footprint}格</small>
    </button>`;
  };
  const section = (title: string, zone: 'rig' | 'backpack' | 'secure', items: InventoryItem[], capacity: number, hint: string) => `
    <section class="deployment-zone" data-zone="${zone}"><header><b>${title}</b><span>${backpackUsedSlots(items)} / ${capacity}</span></header>
      <p>${hint}</p><div class="deployment-slots">${items.map((item) => slot(item, zone)).join('')}${Array.from({ length: Math.max(0, capacity - backpackUsedSlots(items)) }, (_, index) => `<span class="deployment-empty-slot">${String(index + 1).padStart(2, '0')}</span>`).join('')}</div></section>`;
  const deployableSource = profile.stash;
  const deploymentSource = deployableSource.map((item) => {
    const equipment = isEquipableLoot(item);
    return `
      <div class="deployment-source-row" data-rarity="${item.rarity}"><span><b>${item.name}</b><small>${kindLabel(item.kind)} · ×${item.quantity}</small></span>
        ${equipment
          ? `<button type="button" data-deployment-action="equip" data-deployment-item="${item.id}">${item.kind === 'weapon' ? '放入武器格' : '穿戴装备'}</button>`
          : `<button type="button" data-deployment-action="stage" data-deployment-zone="rig" data-deployment-item="${item.id}">胸挂</button>
             <button type="button" data-deployment-action="stage" data-deployment-zone="backpack" data-deployment-item="${item.id}">背包</button>
             <button type="button" data-deployment-action="stage" data-deployment-zone="secure" data-deployment-item="${item.id}">安全箱</button>`}
      </div>`;
  }).join('');
  deploymentPanel.innerHTML = `
    <div class="deployment-equipment">${equipment}${keycardSlot}</div>
    <div class="deployment-heading"><div><b>出战整备</b><small>购买物资后，在下方选择武器格、胸挂、背包或安全箱。</small></div><span>配装 ${loadout.loadoutValue.toLocaleString('zh-CN')} 金币</span><button type="button" data-deployment-action="close-panel">收起</button></div>
    <div class="deployment-zones">
      ${section('胸挂', 'rig', profile.deploymentRig, 6, '弹药、医疗和投掷物；死亡会遗失。')}
      ${section('背包', 'backpack', profile.deploymentBackpack, loadout.backpackSlots, '行动物资与战利品；死亡会遗失。')}
      ${section('安全箱', 'secure', profile.deploymentSecure, loadout.secureContainerCapacity, '死亡后唯一会回到仓库的物资。')}
    </div>
    <div class="deployment-stash${deploymentStashOpen ? ' is-open' : ''}">
      <button class="deployment-stash-toggle" type="button" data-deployment-action="toggle-stash" aria-expanded="${deploymentStashOpen}">
        <span><b>行动仓库</b><small>点击查看已购买和撤离带回的物品</small></span><strong>${deployableSource.length} 种物资</strong>
      </button>
      <div class="deployment-source" ${deploymentStashOpen ? '' : 'hidden'}>${deployableSource.length ? deploymentSource : '<em>仓库为空；可先去交易行或军需处购买。</em>'}</div>
    </div>
    <div class="deployment-risk"><b>死亡规则：安全箱外的枪、护甲、背包、胸挂和背包物资都会遗失</b><small>成功撤离则全部带回仓库。零装突袭可免费进场，但不会有默认枪械。</small></div>`;
}

type LogisticsTab = 'market' | 'buy' | 'requisition' | 'analysis' | 'gear' | 'gunsmith' | 'facilities';

function switchLogisticsTab(tab: LogisticsTab): void {
  for (const button of document.querySelectorAll<HTMLElement>('[data-logistics-tab]')) {
    button.classList.toggle('is-active', button.dataset.logisticsTab === tab);
  }
  byId('market-detail').hidden = tab !== 'market';
  byId('market-buy-detail').hidden = tab !== 'buy';
  byId('requisition-detail').hidden = tab !== 'requisition';
  byId('analysis-detail').hidden = tab !== 'analysis';
  byId('gear-detail').hidden = tab !== 'gear';
  byId('gunsmith-detail').hidden = tab !== 'gunsmith';
  byId('facility-detail').hidden = tab !== 'facilities';
  byId('market-inventory').hidden = tab === 'analysis' || tab === 'gear' || tab === 'gunsmith' || tab === 'facilities';
  byId('logistics-description').textContent = tab === 'market'
    ? '出售已撤离物资，金币立即到账'
    : tab === 'buy' ? '使用金币采购物资，直接进入仓库'
      : tab === 'requisition' ? '使用金币购买下一局行动补给'
        : tab === 'analysis' ? '购买房卡并选择下一局携带的隐藏门权限'
          : tab === 'gear' ? '购买并穿戴本局战术装备；死亡会遗失'
            : tab === 'gunsmith' ? '购买配件并保存每把武器的改装方案' : '升级永久生效的基地设施';
  renderProfile();
}

function renderInventory(items: InventoryItem[], secureItems: InventoryItem[], secureCapacity: number): void {
  for (const id of [...selectedInventoryItemIds]) {
    if (!items.some((item) => item.id === id)) selectedInventoryItemIds.delete(id);
  }
  const signature = `${activeBackpackSlots}:${items.map((item) => `${item.id}:${item.quantity}`).join('|')}::${secureItems.map((item) => `${item.id}:${item.quantity}`).join('|')}::${[...selectedInventoryItemIds].sort().join('|')}`;
  if (signature === lastInventorySignature) return;
  lastInventorySignature = signature;
  const grid = byId('inventory-grid');
  grid.innerHTML = '';
  for (const item of items) {
    const slot = document.createElement('div');
    slot.className = 'inventory-slot';
    slot.dataset.rarity = item.rarity;
    slot.draggable = true;
    slot.dataset.backpackItem = item.id;
    slot.dataset.selectItem = item.id;
    slot.classList.toggle('is-selected', selectedInventoryItemIds.has(item.id));
    const footprint = (item.slotWidth ?? 1) * (item.slotHeight ?? 1);
    slot.style.gridColumn = `span ${item.slotWidth ?? 1}`;
    slot.style.gridRow = `span ${item.slotHeight ?? 1}`;
    slot.title = `占用 ${footprint} 格（${item.slotWidth ?? 1}×${item.slotHeight ?? 1}）`;
    slot.innerHTML = `<div class="loot-kind">${rarityName(item.rarity)}${item.quantity > 1 ? ` · × ${item.quantity}` : ''} · ${footprint}格</div><strong>${item.name}</strong><small class="inventory-unit-value">单件 ${item.value.toLocaleString('zh-CN')}</small><div class="inventory-slot-footer"><span class="stash-value">${(item.value * item.quantity).toLocaleString('zh-CN')}</span><button class="inventory-secure" type="button" data-secure-item="${item.id}" title="失败后保留">放入安全箱</button></div>`;
    grid.append(slot);
  }
  const usedSlots = backpackUsedSlots(items);
  for (let index = usedSlots; index < activeBackpackSlots; index += 1) {
    const slot = document.createElement('div');
    slot.className = 'inventory-slot is-empty';
    slot.textContent = String(index + 1).padStart(2, '0');
    grid.append(slot);
  }
  byId('inventory-value').textContent = `估值 ${inventoryValue(items).toLocaleString('zh-CN')}`;
  byId('inventory-selection-count').textContent = selectedInventoryItemIds.size > 0 ? `已选 ${selectedInventoryItemIds.size} 件` : '未选择';
  byId<HTMLButtonElement>('inventory-discard').disabled = selectedInventoryItemIds.size === 0;
  byId<HTMLButtonElement>('inventory-destroy').disabled = selectedInventoryItemIds.size === 0;
  byId('secure-container-count').textContent = `${secureItems.length} / ${secureCapacity}`;
  byId('secure-container-grid').innerHTML = Array.from({ length: secureCapacity }, (_, index) => {
    const item = secureItems[index];
    return item
      ? `<button class="secure-container-item" type="button" data-rarity="${item.rarity}" data-unsecure-item="${item.id}"><strong>${item.name}</strong><span>${item.value.toLocaleString('zh-CN')} · 点击取回</span></button>`
      : '<div class="secure-container-item is-empty">空安全格</div>';
  }).join('');
}

function corpseLootSlot(item: InventoryItem, origin: 'loot' | 'backpack', comparisonValue: number | null, fresh = false, locked = false): string {
  const value = (item.value * item.quantity).toLocaleString('zh-CN');
  const footprint = (item.slotWidth ?? 1) * (item.slotHeight ?? 1);
  const interactive = origin === 'loot' && !locked;
  const tag = interactive ? 'button' : 'div';
  const difference = comparisonValue === null ? null : item.value * item.quantity - comparisonValue;
  const comparison = difference === null ? '' : `<em class="loot-value-compare" data-direction="${difference >= 0 ? 'up' : 'down'}">${difference >= 0 ? '+' : ''}${difference.toLocaleString('zh-CN')} 对比最低格</em>`;
  const durability = item.durability !== undefined && item.maxDurability !== undefined
    ? `<small class="loot-durability">耐久 ${item.durability}/${item.maxDurability}</small>`
    : '';
  return `<${tag} class="corpse-loot-item${fresh ? ' is-fresh' : ''}" data-rarity="${item.rarity}" data-kind="${item.kind}" data-loot-origin="${origin}" data-loot-item-id="${item.id}" draggable="${locked ? 'false' : 'true'}" ${interactive ? 'type="button"' : ''} title="${item.description ?? item.name}">
    <span class="corpse-item-mark">${item.kind === 'armor' ? '甲' : item.kind === 'helmet' ? '盔' : item.kind === 'weapon' ? '枪' : item.name.slice(0, 1)}</span>
    <small>${rarityName(item.rarity)} · ${kindLabel(item.kind)} · ${footprint}格</small>
    <strong>${item.name}</strong>
    <b>${item.quantity > 1 ? `× ${item.quantity} · ` : ''}${value}</b>
    ${durability}
    ${comparison}
  </${tag}>`;
}

function containerBiasLabel(name: string): string {
  if (/医疗/.test(name)) return '医疗用品';
  if (/电脑|服务器/.test(name)) return '电子设备 / 情报';
  if (/弹药|武器/.test(name)) return '枪械与战备物资';
  if (/保险|金库|手提/.test(name)) return '高价值情报';
  if (/工具/.test(name)) return '工业与维修物资';
  return '综合行动物资';
}

function corpseEquipmentSlot(state: LootSearchView, slot: 'helmet' | 'armor' | 'weapon', label: string): string {
  if (state.phase !== 'revealed') {
    return `<div class="corpse-equipment-item is-locked"><span>${label}</span><b>搜索后可带走</b></div>`;
  }
  const item = (state.equipment ?? []).find((entry) => entry.equipmentSlot === slot);
  if (!item) return `<div class="corpse-equipment-item is-taken"><span>${label}</span><b>已拿取</b></div>`;
  const durability = item.durability !== undefined && item.maxDurability !== undefined
    ? ` · 耐久 ${item.durability}/${item.maxDurability}`
    : '';
  return `<button class="corpse-equipment-item" type="button" data-rarity="${item.rarity}" data-loot-origin="loot" data-loot-item-id="${item.id}" draggable="true" title="${item.description ?? item.name}">
    <span>${label} · ${rarityName(item.rarity)}</span>
    <b>${item.name}</b>
    <small>${item.value.toLocaleString('zh-CN')} 金币${durability}</small>
  </button>`;
}

function renderCorpseLoot(state: LootSearchView): void {
  const panel = byId('corpse-loot-panel');
  panel.dataset.phase = state.phase;
  panel.classList.toggle('is-boss', state.boss);
  panel.classList.toggle('is-container', state.source === 'container');
  byId('corpse-loot-eyebrow').textContent = state.source === 'container'
    ? '环境容器 · 逐格搜刮'
    : state.boss ? '高威胁目标 · 指挥携行具' : '敌方携行具';
  byId('corpse-loot-name').textContent = state.containerName;
  const visibleItems = state.items.slice(0, Math.min(state.items.length, state.revealedSlots));
  const equipment = state.equipment ?? [];
  const visibleEquipment = state.phase === 'revealed' ? equipment : [];
  byId('corpse-loot-value').textContent = state.revealedSlots > 0
    ? `${inventoryValue([...visibleEquipment, ...visibleItems]).toLocaleString('zh-CN')} 金币`
    : '识别中';
  byId('corpse-loot-capacity').textContent = `${state.revealedSlots} / ${state.capacity}`;
  byId('corpse-player-capacity').textContent = `${backpackUsedSlots(latestRun.backpack)} / ${activeBackpackSlots}`;
  byId('corpse-player-value').textContent = `${inventoryValue(latestRun.backpack).toLocaleString('zh-CN')} 金币`;
  byId('corpse-player-weapon').textContent = byId('weapon-name').textContent ?? '当前武器';
  byId('corpse-loot-message').textContent = state.message;
  byId<HTMLElement>('corpse-search-progress').style.width = `${Math.round(state.progress * 100)}%`;
  byId<HTMLButtonElement>('corpse-loot-take-all').disabled = state.phase !== 'revealed' || (state.items.length === 0 && equipment.length === 0);
  byId('loot-source-label').textContent = state.source === 'corpse' ? '敌方背包' : '容器物资';
  byId('corpse-equipment-strip').innerHTML = state.source === 'corpse'
    ? `${corpseEquipmentSlot(state, 'helmet', '头盔')}${corpseEquipmentSlot(state, 'armor', '护甲')}${corpseEquipmentSlot(state, 'weapon', '武器')}`
    : `<div><span>容器</span><b>${state.containerName}</b></div><div><span>物资偏向</span><b>${containerBiasLabel(state.containerName)}</b></div><div><span>搜索方式</span><b>逐格识别</b></div>`;

  const signature = [
    state.phase,
    state.capacity,
    state.revealedSlots,
    state.justRevealedSlot,
    equipment.map((item) => `${item.id}:${item.quantity}`).join('|'),
    state.items.map((item) => `${item.id}:${item.quantity}`).join('|'),
    activeBackpackSlots,
    latestRun.backpack.map((item) => `${item.id}:${item.quantity}`).join('|'),
  ].join('::');
  if (signature !== lastCorpseLootSignature) {
    lastCorpseLootSignature = signature;
    const sourceGrid = byId('corpse-loot-grid');
    const lowestBackpackValue = latestRun.backpack.length === 0
      ? null
      : Math.min(...latestRun.backpack.map((item) => item.value * item.quantity));
    sourceGrid.innerHTML = Array.from({ length: state.capacity }, (_, index) => {
      if (index >= state.revealedSlots) return `<div class="corpse-loot-item is-unknown"><span>?</span><small>${state.phase === 'searching' ? '搜索中' : '未知物品'}</small><b>${String(index + 1).padStart(2, '0')}</b></div>`;
      const item = state.items[index];
      return item
        ? corpseLootSlot(item, 'loot', lowestBackpackValue, index === state.justRevealedSlot, state.phase !== 'revealed')
        : `<div class="corpse-loot-item is-empty is-scanned">空格 ${String(index + 1).padStart(2, '0')}</div>`;
    }).join('');

    const playerGrid = byId('corpse-player-grid');
    playerGrid.innerHTML = latestRun.backpack.map((item) => corpseLootSlot(item, 'backpack', null)).join('')
      + Array.from({ length: Math.max(0, activeBackpackSlots - backpackUsedSlots(latestRun.backpack)) }, (_, index) => `<div class="corpse-loot-item is-empty">${String(backpackUsedSlots(latestRun.backpack) + index + 1).padStart(2, '0')}</div>`).join('');
  }
}

function renderAbilityState(id: 'smoke' | 'adrenaline' | 'run', active: number, cooldown: number): void {
  const ability = byId(`${id}-ability`);
  const status = byId(`${id}-status`);
  if (active > 0) {
    ability.dataset.state = 'active';
    status.textContent = `生效 ${active.toFixed(1)}`;
  } else if (cooldown > 0) {
    ability.dataset.state = 'cooldown';
    status.textContent = `冷却 ${Math.ceil(cooldown)}`;
  } else {
    ability.dataset.state = 'ready';
    status.textContent = '就绪';
  }
}

function renderAbilities(state: AbilityView): void {
  renderAbilityState('smoke', state.smokeActive, state.smokeCooldown);
  renderAbilityState('adrenaline', state.adrenalineActive, state.adrenalineCooldown);
  renderAbilityState('run', state.runActive, state.runCooldown);
  const magnetic = byId('magnetic-ability');
  const magneticStatus = byId('magnetic-status');
  magnetic.dataset.state = state.magneticCharges > 0 ? (state.magneticCooldown > 0 ? 'cooldown' : 'ready') : 'empty';
  magneticStatus.textContent = state.magneticCooldown > 0
    ? `准备 ${state.magneticCooldown.toFixed(1)}`
    : `${state.magneticCharges} / 2`;
  gameShell.classList.toggle('is-adrenaline-active', state.adrenalineActive > 0);
}

function renderOperationStatus(state: OperationStatusView): void {
  activeExtractionTarget = state.extraction.title === '等待直升机' ? 45 : 6;
  const panel = byId('operation-status');
  panel.hidden = false;
  const eventText = state.event.active
    ? `${state.event.title} · ${state.event.remainingSeconds} 秒`
    : state.event.description;
  const taskState = state.task.failed ? '失败' : state.task.completed ? '完成' : `${state.task.progress}/${state.task.required}`;
  const challengeState = state.challenge.failed ? '失败' : state.challenge.completed ? '完成' : `${state.challenge.progress}/${state.challenge.target}`;
  panel.innerHTML = `
    <span data-risk="${state.risk.high ? 'high' : 'normal'}">${state.risk.label}</span>
    <span class="operation-threat" data-threat-level="${state.threat.level}">${state.threat.label}</span>
    <span class="operation-event">${eventText}</span>
    <span>任务：${state.task.title} ${taskState}</span>
    <span>撤离：${state.extraction.title}${state.extraction.completed ? ' · 已解锁' : ''}</span>
    <span>每日挑战：${state.challenge.title} ${challengeState}</span>`;
}

function renderRun(run: RunState): void {
  latestRun = run;
  const { player } = run;
  byId('health-value').textContent = String(Math.ceil(player.health));
  byId('armor-value').textContent = String(player.armor);
  byId('stamina-value').textContent = String(Math.round(player.stamina));
  byId<HTMLElement>('health-bar').style.width = `${player.health}%`;
  byId<HTMLElement>('armor-bar').style.width = `${Math.min(100, player.armor / 140 * 100)}%`;
  byId<HTMLElement>('stamina-bar').style.width = `${player.stamina}%`;
  byId('medkits').textContent = `医疗包 ${player.medkits} · 绷带 ${player.bandages} · 夹板 ${player.splints} · ${keyLabel(gameSettings.keyBindings.heal)} 使用`;
  const injuryLabels = [
    player.injuries.bleeding > 0 ? '流血' : '',
    player.injuries.leftLeg + player.injuries.rightLeg > 0 ? '腿伤减速' : '',
    player.injuries.leftArm + player.injuries.rightArm > 0 ? '手伤晃动' : '',
  ].filter(Boolean);
  const injuryStatus = byId('injury-status');
  injuryStatus.textContent = injuryLabels.length > 0 ? injuryLabels.join(' · ') : '身体状态正常';
  injuryStatus.dataset.injured = injuryLabels.length > 0 ? 'true' : 'false';
  byId('ammo-mag').textContent = player.weapon.reloading ? '··' : String(player.weapon.magazine);
  byId('ammo-reserve').textContent = String(player.weapon.reserve);
  byId('ammo-level').textContent = `弹药 ${player.ammoLevel} 级`;
  byId('objective').textContent = run.objectiveText;
  const progress = byId('extraction-progress');
  progress.hidden = run.extractionProgress <= 0;
  byId('extraction-label').textContent = `撤离信号确认 ${run.extractionProgress.toFixed(1)} / ${activeExtractionTarget.toFixed(1)}`;
  byId<HTMLElement>('extraction-bar').style.width = `${Math.min(100, run.extractionProgress / activeExtractionTarget * 100)}%`;
  renderInventory(run.backpack, player.secureContainer, player.secureContainerCapacity);
  if (activeCorpseLootView) renderCorpseLoot(activeCorpseLootView);
}

function renderMiniMap(state: TacticalMapView): void {
  const canvas = byId<HTMLCanvasElement>('minimap');
  const context = canvas.getContext('2d');
  if (!context) return;
  const size = 180;
  const padding = 14;
  const innerSize = size - padding * 2;
  const rangeX = Math.max(1, state.bounds.maxX - state.bounds.minX);
  const rangeZ = Math.max(1, state.bounds.maxZ - state.bounds.minZ);
  const toMap = (x: number, z: number): [number, number] => [
    padding + (x - state.bounds.minX) / rangeX * innerSize,
    padding + (z - state.bounds.minZ) / rangeZ * innerSize,
  ];

  context.setTransform(2, 0, 0, 2, 0, 0);
  context.clearRect(0, 0, size, size);
  context.fillStyle = 'rgba(8, 16, 14, 0.92)';
  context.fillRect(0, 0, size, size);
  context.strokeStyle = 'rgba(151, 190, 168, 0.13)';
  context.lineWidth = 1;
  for (let index = 1; index < 4; index += 1) {
    const line = padding + innerSize * index / 4;
    context.beginPath();
    context.moveTo(line, padding);
    context.lineTo(line, size - padding);
    context.stroke();
    context.beginPath();
    context.moveTo(padding, line);
    context.lineTo(size - padding, line);
    context.stroke();
  }
  context.strokeStyle = 'rgba(166, 209, 183, 0.32)';
  context.strokeRect(padding, padding, innerSize, innerSize);

  for (const zone of state.riskZones) {
    const [zoneX, zoneY] = toMap(zone.x, zone.z);
    const radius = zone.radius * innerSize / Math.max(rangeX, rangeZ);
    context.beginPath();
    context.arc(zoneX, zoneY, radius, 0, Math.PI * 2);
    context.fillStyle = 'rgba(190, 48, 39, 0.14)';
    context.fill();
    context.strokeStyle = 'rgba(255, 92, 76, 0.62)';
    context.setLineDash([4, 3]);
    context.stroke();
    context.setLineDash([]);
  }

  const drawArea = (x1: number, z1: number, x2: number, z2: number, fill: string, stroke = 'rgba(185, 214, 193, 0.22)'): void => {
    const [left, top] = toMap(Math.min(x1, x2), Math.min(z1, z2));
    const [right, bottom] = toMap(Math.max(x1, x2), Math.max(z1, z2));
    context.fillStyle = fill;
    context.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    context.strokeStyle = stroke;
    context.strokeRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  };
  const drawMapLabel = (label: string, x: number, z: number, color = 'rgba(219, 232, 220, 0.64)'): void => {
    const [labelX, labelY] = toMap(x, z);
    context.fillStyle = color;
    context.font = '700 7px sans-serif';
    context.textAlign = 'center';
    context.fillText(label, labelX, labelY);
  };

  if (state.mapId === 'administration') {
    const onUpperFloor = state.floorLabel === '2F';
    drawArea(111, 126, 135, 152, 'rgba(100, 116, 105, 0.55)');
    drawArea(195, 119, 219, 149, 'rgba(100, 116, 105, 0.55)');
    drawArea(123, -56, 141, 36, onUpperFloor ? 'rgba(137, 117, 61, 0.56)' : 'rgba(96, 112, 103, 0.52)');
    drawArea(189, -56, 207, 36, onUpperFloor ? 'rgba(137, 117, 61, 0.56)' : 'rgba(96, 112, 103, 0.52)');
    drawArea(141, -58, 189, -40, 'rgba(120, 132, 123, 0.58)');
    drawArea(145, -34, 185, 30, 'rgba(73, 91, 82, 0.24)');
    drawArea(110, -143, 136, -115, 'rgba(100, 116, 105, 0.55)');
    drawArea(195, -141, 219, -113, 'rgba(100, 116, 105, 0.55)');
    drawArea(148, -150, 182, -132, 'rgba(87, 99, 92, 0.62)');
    drawMapLabel('北部警戒区', 165, 158);
    drawMapLabel('办公楼', 123, 139, '#d9e8da');
    drawMapLabel('宿舍楼', 207, 134, '#d9e8da');
    drawMapLabel(onUpperFloor ? '2F 行政办公区' : '1F 行政主楼', 165, -47, onUpperFloor ? '#f0c958' : '#d9e8da');
    drawMapLabel('1F 中央庭院', 165, 2);
    drawMapLabel('后勤区', 165, -151);
    for (const [stairX, stairZ] of [[136, 17], [194, 17]] as const) {
      const [markerX, markerY] = toMap(stairX, stairZ);
      context.fillStyle = '#f0c958';
      context.fillRect(markerX - 3, markerY - 4, 6, 8);
      context.fillStyle = '#1a211d';
      context.font = '900 6px sans-serif';
      context.textAlign = 'center';
      context.fillText('↑', markerX, markerY + 2);
    }
    if (state.secretRoom) {
      const roomColor = state.secretRoom.unlocked ? '#83e49b' : '#ff7465';
      drawArea(
        124.3,
        -53.8,
        139.7,
        -34,
        state.secretRoom.unlocked ? 'rgba(91, 178, 108, 0.36)' : 'rgba(185, 65, 51, 0.34)',
        roomColor,
      );
      const [secretX, secretY] = toMap(state.secretRoom.x, state.secretRoom.z);
      context.fillStyle = roomColor;
      context.beginPath();
      context.arc(secretX, secretY, 4, 0, Math.PI * 2);
      context.fill();
      drawMapLabel(
        `${state.secretRoom.floor}密室`,
        state.secretRoom.x + 11,
        state.secretRoom.z,
        state.secretRoom.unlocked ? '#83e49b' : '#ff8b7e',
      );
    }
  } else if (state.mapId === 'reservoir') {
    drawArea(331, -77, 419, 58, 'rgba(39, 102, 112, 0.5)', 'rgba(87, 173, 181, 0.5)');
    drawArea(329, -83, 421, -73, 'rgba(142, 150, 141, 0.66)');
    drawArea(430, -63, 469, -33, 'rgba(97, 111, 103, 0.6)');
    const [tunnelStartX, tunnelY] = toMap(260, 78);
    const [tunnelEndX] = toMap(454, 78);
    context.setLineDash([3, 2]);
    context.strokeStyle = 'rgba(239, 190, 73, 0.82)';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(tunnelStartX, tunnelY);
    context.lineTo(tunnelEndX, tunnelY);
    context.stroke();
    const drawTunnelBranch = (x1: number, z1: number, x2: number, z2: number): void => {
      const [startX, startY] = toMap(x1, z1);
      const [endX, endY] = toMap(x2, z2);
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
    };
    drawTunnelBranch(310, 78, 310, 15);
    drawTunnelBranch(390, 78, 390, 42);
    drawTunnelBranch(310, 42, 403, 42);
    drawTunnelBranch(438, 78, 438, 115);
    context.setLineDash([]);
    drawArea(299, 33, 321, 51, 'rgba(214, 170, 56, 0.2)', 'rgba(239, 190, 73, 0.5)');
    drawArea(377, 32, 403, 52, 'rgba(42, 119, 127, 0.28)', 'rgba(91, 181, 185, 0.5)');
    drawMapLabel('水库', 375, -5, '#a7dce2');
    drawMapLabel('大坝', 375, -78, '#e1e8dd');
    drawMapLabel('发电站', 449, -48, '#d9e8da');
    drawMapLabel('地下管道', 360, 75, '#f0c958');
    drawMapLabel('设备间', 310, 40, '#f0c958');
    drawMapLabel('排水区', 390, 40, '#8edce0');
  }

  const [objectiveX, objectiveY] = toMap(state.objective.x, state.objective.z);
  context.save();
  context.translate(objectiveX, objectiveY);
  context.rotate(Math.PI / 4);
  context.fillStyle = state.objective.active ? '#f1d562' : 'rgba(241, 213, 98, 0.28)';
  context.fillRect(-4, -4, 8, 8);
  context.restore();

  if (state.extraction.revealed !== false) {
    const [extractionX, extractionY] = toMap(state.extraction.x, state.extraction.z);
    context.beginPath();
    context.arc(extractionX, extractionY, state.extraction.active ? 5.5 : 4, 0, Math.PI * 2);
    context.strokeStyle = state.extraction.active ? '#baff61' : 'rgba(186, 255, 97, 0.3)';
    context.lineWidth = state.extraction.active ? 2 : 1;
    context.stroke();
  }

  if (state.checkpoint) {
    const [checkpointX, checkpointY] = toMap(state.checkpoint.x, state.checkpoint.z);
    context.fillStyle = state.checkpoint.active ? '#f0b84c' : 'rgba(240, 184, 76, 0.3)';
    context.fillRect(checkpointX - 3, checkpointY - 3, 6, 6);
  }

  if (state.highValueTask?.target) {
    const [highTaskX, highTaskY] = toMap(state.highValueTask.target.x, state.highValueTask.target.z);
    context.save();
    context.translate(highTaskX, highTaskY);
    context.rotate(Math.PI / 4);
    context.fillStyle = '#ff4136';
    context.shadowColor = '#ff241a';
    context.shadowBlur = 10;
    context.fillRect(-5, -5, 10, 10);
    context.fillStyle = '#fff4ef';
    context.fillRect(-2, -2, 4, 4);
    context.restore();
  }

  const [targetX, targetY] = toMap(state.target.x, state.target.z);
  context.beginPath();
  context.arc(targetX, targetY, state.target.type === 'boss' ? 8 : 7, 0, Math.PI * 2);
  context.strokeStyle = state.target.type === 'boss' ? '#ff5f4d' : state.target.type === 'extract' ? '#baff61' : '#ffd55e';
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = '#f5f8ef';
  context.font = '800 8px sans-serif';
  context.textAlign = 'center';
  context.fillText(state.target.label, targetX, Math.max(10, targetY - 9));

  if (state.bonusTarget) {
    const [bonusX, bonusY] = toMap(state.bonusTarget.x, state.bonusTarget.z);
    context.beginPath();
    context.arc(bonusX, bonusY, 6, 0, Math.PI * 2);
    context.strokeStyle = '#d58cff';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = '#f0cfff';
    context.font = '800 7px sans-serif';
    context.fillText(state.bonusTarget.label, bonusX, Math.max(10, bonusY - 8));
  }

  for (const enemy of state.enemies) {
    const [enemyX, enemyY] = toMap(enemy.x, enemy.z);
    context.beginPath();
    context.arc(enemyX, enemyY, enemy.boss ? 5 : enemy.elite ? 3.5 : 2.7, 0, Math.PI * 2);
    context.fillStyle = enemy.boss ? '#ffb13b' : enemy.elite ? '#ff5548' : '#dc675d';
    context.fill();
  }

  const [playerX, playerY] = toMap(state.player.x, state.player.z);
  context.save();
  context.translate(playerX, playerY);
  context.rotate(state.player.yaw);
  context.beginPath();
  context.moveTo(0, -8);
  context.lineTo(5.5, 6);
  context.lineTo(0, 3.5);
  context.lineTo(-5.5, 6);
  context.closePath();
  context.fillStyle = '#efffb3';
  context.shadowColor = '#dfff72';
  context.shadowBlur = 7;
  context.fill();
  context.restore();

  context.shadowBlur = 0;
  context.fillStyle = 'rgba(226, 239, 222, 0.76)';
  context.font = '700 10px sans-serif';
  context.textAlign = 'center';
  context.fillText('N', size / 2, 10);
  const highTask = state.highValueTask;
  byId('minimap-name').textContent = state.secretRoom
    ? `${state.mapName} · ${state.floorLabel} · 2F密室${state.secretRoom.unlocked ? '已开启' : '已锁定'}`
    : `${state.mapName}${state.floorLabel ? ` · ${state.floorLabel}` : ''} · ${state.target.label}`;
  const taskSignature = `${state.tasks.map((task) => `${task.id}:${task.status}:${task.label}`).join('|')}|${highTask?.stage ?? 'none'}:${highTask?.steps.map((task) => `${task.id}:${task.status}:${task.label}`).join('|') ?? ''}`;
  if (taskSignature !== lastMissionTaskSignature) {
    lastMissionTaskSignature = taskSignature;
    byId('mission-tracker').innerHTML = `
      <div class="mission-task-title mission-task-title-main"><span>主线任务</span><strong>${state.target.label}</strong></div>
      ${state.tasks.map((task) => `
        <div class="mission-task" data-status="${task.status}">
          <span>${task.status === 'complete' ? '✓' : task.status === 'active' ? '◆' : '·'}</span>
          <b>${task.label}</b>
        </div>
      `).join('')}
      ${highTask ? `
        <div class="mission-task-title mission-task-title-high"><span>高价值任务</span><strong>${highTask.title}</strong></div>
        ${highTask.steps.map((task) => `
          <div class="mission-task" data-status="${task.status}">
            <span>${task.status === 'complete' ? '✓' : task.status === 'active' ? '◆' : '·'}</span>
            <b>${task.label}</b>
          </div>
        `).join('')}
        <div class="mission-task-reward"><span>奖励</span><strong>${highTask.reward.name} · ${highTask.reward.value.toLocaleString('zh-CN')}</strong></div>
      ` : ''}
    `;
  }
}

function showToast(message: string, tone: 'info' | 'danger' = 'info'): void {
  const toast = byId('toast');
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 1800);
}

function showStorageWarning(): void {
  storageWarningPending = false;
  if (storageWarningShown) return;
  storageWarningShown = true;
  showToast('浏览器禁止了本地存档，本次进度无法保存', 'danger');
}

function flash(id: string, className: string): void {
  const element = byId(id);
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function showMenu(): void {
  game.showMenuPreview();
  menuScreen.hidden = false;
  topbar.hidden = false;
  hud.hidden = true;
  stashScreen.hidden = true;
  pauseScreen.hidden = true;
  resultScreen.hidden = true;
  settingsScreen.hidden = true;
  codexScreen.hidden = true;
  deploying.hidden = true;
  inventoryPanel.hidden = true;
  fieldMarket.hidden = true;
  gameShell!.classList.remove('is-inventory-open');
}

function showResult(run: RunState, successful: boolean): void {
  hud.hidden = true;
  inventoryPanel.hidden = true;
  fieldMarket.hidden = true;
  gameShell!.classList.remove('is-inventory-open');
  pauseScreen.hidden = true;
  topbar.hidden = false;
  resultScreen.hidden = false;
  settingsScreen.hidden = true;
  let result: ExtractionResult;
  if (selectedGameMode === 'training') {
    result = { grade: 'A', value: 0, timeSeconds: run.elapsedSeconds, kills: run.kills };
  } else if (successful) {
    profile = persistRunDurability(profile, run);
    const settlement = settleExtraction(profile, run);
    profile = settlement.profile;
    result = settlement.result;
  } else {
    const settlement = settleFailure(profile, run);
    profile = settlement.profile;
    result = { grade: 'C', value: inventoryValue(settlement.retained), timeSeconds: run.elapsedSeconds, kills: run.kills };
  }
  saveProfile();
  byId('result-eyebrow').textContent = successful ? '行动完成' : '行动失败';
  byId('result-title').textContent = successful ? '成功撤离' : '人员失联';
  byId('result-grade').textContent = successful ? result.grade : '—';
  byId('result-value').textContent = result.value.toLocaleString('zh-CN');
  byId('result-kills').textContent = String(result.kills);
  byId('result-time').textContent = formatTime(result.timeSeconds);
  const dealt = run.combatLog.filter((record) => record.direction === 'dealt');
  const received = run.combatLog.filter((record) => record.direction === 'received');
  const bodyPartNames = { head: '头部', torso: '躯干', leftArm: '左臂', rightArm: '右臂', leftLeg: '左腿', rightLeg: '右腿' } as const;
  const hitSummary = Object.entries(dealt.reduce<Record<string, number>>((summary, record) => {
    summary[record.bodyPart] = (summary[record.bodyPart] ?? 0) + 1;
    return summary;
  }, {})).map(([part, count]) => `${bodyPartNames[part as keyof typeof bodyPartNames]} ${count}`).join(' · ') || '无命中记录';
  const ammoSummary = [...new Set(dealt.map((record) => `${record.ammoLevel} 级弹`))].join('、') || '未开火';
  const damageDealt = dealt.reduce((sum, record) => sum + record.healthDamage, 0);
  const damageReceived = received.reduce((sum, record) => sum + record.healthDamage, 0);
  const origins = [...new Set([...run.backpack, ...run.player.secureContainer].map((item) => item.origin).filter(Boolean))].join('、') || '战区搜索';
  const route = run.routeLog.length > 0 ? run.routeLog.join(' → ') : '出生点 → 任务区 → 撤离区';
  byId('result-details').innerHTML = `
    <div><span>命中部位</span><b>${hitSummary}</b></div>
    <div><span>使用弹药</span><b>${ammoSummary}</b></div>
    <div><span>伤害统计</span><b>造成 ${Math.round(damageDealt)} · 承受 ${Math.round(damageReceived)}</b></div>
    <div><span>物资来源</span><b>${origins}</b></div>
    <div><span>行动路线</span><b>${route}</b></div>`;
}

let runtimeErrorShown = false;
function showRuntimeError(error: unknown): void {
  if (runtimeErrorShown) return;
  runtimeErrorShown = true;
  console.error('游戏运行已安全停止', error);
  hud.hidden = true;
  deploying.hidden = true;
  pauseScreen.hidden = true;
  inventoryPanel.hidden = true;
  fieldMarket.hidden = true;
  runtimeErrorScreen.hidden = false;
  gameShell.classList.remove('is-inventory-open', 'is-controlling', 'is-aiming', 'is-looting-corpse');
}

window.addEventListener('error', (event) => {
  if (event.error) showRuntimeError(event.error);
});
window.addEventListener('unhandledrejection', (event) => {
  showRuntimeError(event.reason);
});

function deployWithSupplies(): void {
  const mapNames: Record<MapId, string> = {
    harbor: '九号物流港',
    radar: '长风雷达站',
    refinery: '赤湾炼化区',
    administration: '行政辖区',
    reservoir: '黑峡水库',
  };
  const modeNames = Object.fromEntries(Object.values(GAME_MODE_DEFINITIONS).map((mode) => [mode.id, mode.name])) as Record<GameModeId, string>;
  byId('deploying-region').textContent = `K-17 / ${mapNames[selectedMap]} / ${modeNames[selectedGameMode]}`;
  const loadout = resolveLoadout(profile);
  const hasWeapon = Boolean(profile.equippedGear.weapon);
  const hasArmor = Boolean(profile.equippedGear.armor || profile.equippedGear.helmet);
  const hasMedical = Boolean(profile.equippedGear.medical);
  const armorDurabilityPercent = Math.min(
    ...(['helmet', 'armor'] as const).map((category) => {
      const gearId = profile.equippedGear[category];
      return gearId ? gearDurabilityPercent(profile, gearId) : 100;
    }),
  );
  const weaponGearId = profile.equippedGear.weapon;
  const weaponDurabilityPercent = weaponGearId ? gearDurabilityPercent(profile, weaponGearId) : 100;
  const selectedOffer = KEYCARD_OFFERS.find((offer) =>
    offer.item.id === profile.selectedKeycardId && offer.mapId === selectedMap);
  const preparedKeycard = selectedOffer
    ? withdrawSelectedKeycardForRun(profile, selectedOffer.item.id)
    : { profile, item: null };
  profile = preparedKeycard.profile;
  const rigItems = profile.deploymentRig.map((item) => ({ ...item }));
  const backpackItems = profile.deploymentBackpack.map((item) => ({ ...item }));
  const secureItems = profile.deploymentSecure.map((item) => ({ ...item }));
  const allStartingItems = [...rigItems, ...backpackItems, ...(preparedKeycard.item ? [preparedKeycard.item] : [])];
  const ammoItems = rigItems.filter((item) => item.variant?.startsWith('ammo:'));
  const ammoData = ammoItems.reduce<{ rounds: number; level: number }>((total, item) => {
    const [, levelText, roundsText] = item.variant!.split(':');
    return { rounds: total.rounds + Math.max(0, Number(roundsText) || 0), level: Math.max(total.level, Number(levelText) || 0) };
  }, { rounds: 0, level: 0 });
  const magneticBombs = rigItems.filter((item) => item.id === 'market-magnetic-bomb')
    .reduce((total, item) => total + item.quantity, 0);
  const supplies = {
    armor: profile.nextRunArmorBonus + loadout.armor,
    ammo: profile.nextRunAmmoBonus + loadout.ammo + ammoData.rounds,
    medkits: profile.nextRunMedkitBonus + loadout.medkits,
    backpackSlots: loadout.backpackSlots,
    weapon: loadout.weapon,
    weaponTunings: resolveAllWeaponBuilds(profile),
    armorLevel: loadout.armorLevel,
    ammoLevel: (profile.nextRunAmmoLevel ?? (ammoData.rounds > 0 ? ammoData.level : loadout.ammoLevel)) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    loadoutValue: loadout.loadoutValue,
    secureContainerCapacity: loadout.secureContainerCapacity,
    continuousStage: selectedGameMode === 'continuous' ? profile.operationChainStage : 0,
    startingItems: allStartingItems,
    secureItems,
    magneticBombs: Math.min(2, magneticBombs),
    hasArmor,
    hasMedical,
    armorDurabilityPercent,
    weaponDurabilityPercent,
  };
  activeBackpackSlots = loadout.backpackSlots;
  profile = dispatchDeployment({
    ...profile,
    nextRunArmorBonus: 0,
    nextRunAmmoBonus: 0,
    nextRunAmmoLevel: null,
    nextRunMedkitBonus: 0,
  });
  saveProfile();
  game.startRun(selectedMap, selectedDifficulty, {
    ...supplies,
    weapon: hasWeapon ? supplies.weapon : 'smg',
    hasWeapon,
  }, selectedBossMode, selectedGameMode);
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
  onMiniMap: renderMiniMap,
  onAiming: (active) => { gameShell.classList.toggle('is-aiming', active); },
  onWeaponChange: (weapon) => {
    byId('weapon-name').textContent = weapon.name;
    gameShell.dataset.activeWeapon = weapon.id;
    for (const slot of gameShell.querySelectorAll<HTMLElement>('[data-weapon-slot]')) {
      slot.classList.toggle('is-active', slot.dataset.weaponSlot === String(weapon.slot));
    }
  },
  onControlCapture: (active) => {
    gameShell.classList.toggle('is-controlling', active);
    byId('capture-controls').hidden = active;
  },
  onControlStatus: (message) => { byId('control-status').textContent = message; },
  onBossUpdate: (state) => {
    const bossHud = byId('boss-hud');
    bossHud.hidden = state === null;
    bossHud.classList.toggle('is-enraged', Boolean(state?.enraged));
    if (!state) return;
    const percentage = Math.max(0, state.health / state.maxHealth * 100);
    byId('boss-name').textContent = state.enraged ? `${state.name} · 狂暴` : state.name;
    byId('boss-health-text').textContent = `${Math.ceil(percentage)}%`;
    byId<HTMLElement>('boss-health-bar').style.width = `${percentage}%`;
  },
  onAbilities: renderAbilities,
  onOperationStatus: renderOperationStatus,
  onSpendCredits: (amount) => {
    if (profile.credits < amount) return false;
    profile = { ...profile, credits: profile.credits - amount };
    saveProfile();
    return true;
  },
  onLootSearch: (state) => {
    const panel = byId('loot-panel');
    const corpsePanel = byId('corpse-loot-panel');
    activeCorpseLootView = state;
    if (!state) {
      lastCorpseLootSignature = '';
      corpsePanel.hidden = true;
      panel.hidden = true;
      gameShell.classList.remove('is-looting-corpse');
      return;
    }
    panel.hidden = true;
    corpsePanel.hidden = false;
    gameShell.classList.add('is-looting-corpse');
    renderCorpseLoot(state);
  },
  onFieldMarket: (state: FieldMarketView | null) => {
    fieldMarket.hidden = state === null;
    if (!state) return;
    byId('field-market-summary').textContent = `可交换物资 ${state.itemCount} 件 · 备弹 ${state.ammo} · 医疗包 ${state.medkits}${state.hasExtractionIntel ? ' · 撤离情报已掌握' : ''}`;
    for (const button of fieldMarket.querySelectorAll<HTMLButtonElement>('[data-field-trade]')) {
      button.disabled = state.itemCount <= 0 || (button.dataset.fieldTrade === 'intel' && state.hasExtractionIntel);
    }
  },
  onDeploying: (active) => { deploying.hidden = !active; },
  onPause: () => {
    if (latestRun.phase === 'active' || latestRun.phase === 'extracting') {
      pauseScreen.hidden = false;
    }
  },
  onEnd: showResult,
  onFatalError: showRuntimeError,
});
game.applySettings(gameSettings);
renderSettings();

function rarityName(rarity: InventoryItem['rarity']): string {
  return ({ black: '黑色', white: '白色', green: '绿色', blue: '蓝色', purple: '紫色', gold: '金色', red: '红色' })[rarity];
}

const isLocalFilePreview = window.location.protocol === 'file:';
let gameReady = false;
if (!isLocalFilePreview) {
  try {
    await game.initialize();
    gameReady = true;
    renderProfile();
    renderRun(latestRun);
    showMenu();
    if (storageWarningPending) showStorageWarning();
  } catch (error) {
    console.error('游戏画面启动失败', error);
    showRuntimeError(error);
  }
} else {
  renderProfile();
  renderRun(latestRun);
  menuScreen.hidden = false;
  topbar.hidden = false;
  hud.hidden = true;
  const deployButton = byId<HTMLButtonElement>('deploy-button');
  deployButton.disabled = true;
  deployButton.textContent = '请使用 127.0.0.1 预览链接';
  if (storageWarningPending) showStorageWarning();
}

const corpsePreview = new URLSearchParams(window.location.search).get('previewCorpseLoot');
if (window.location.hostname === '127.0.0.1' && (corpsePreview === 'soldier' || corpsePreview === 'boss')) {
  const openCorpseLoot = new URLSearchParams(window.location.search).get('previewDeathOnly') !== '1';
  selectedMap = corpsePreview === 'boss' ? 'administration' : 'harbor';
  selectedDifficulty = 'recruit';
  menuScreen.hidden = true;
  topbar.hidden = true;
  resultScreen.hidden = true;
  hud.hidden = false;
  deployWithSupplies();
  window.setTimeout(() => game.debugPreviewCorpseLoot(corpsePreview === 'boss', openCorpseLoot), 1100);
}

const enemyModelPreview = new URLSearchParams(window.location.search).get('previewEnemyModel');
if (window.location.hostname === '127.0.0.1' && (enemyModelPreview === 'soldier' || enemyModelPreview === 'boss')) {
  selectedMap = enemyModelPreview === 'boss' ? 'administration' : 'harbor';
  selectedDifficulty = 'recruit';
  menuScreen.hidden = true;
  topbar.hidden = true;
  resultScreen.hidden = true;
  hud.hidden = false;
  deployWithSupplies();
  const previewWalking = new URLSearchParams(window.location.search).get('previewEnemyWalk') === '1';
  window.setTimeout(() => game.debugPreviewEnemyModel(enemyModelPreview === 'boss', previewWalking), 1100);
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

const abilityPreview = new URLSearchParams(window.location.search).get('previewAbilities');
if (gameReady && window.location.hostname === '127.0.0.1' && abilityPreview === '1') {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  showMenu();
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
  adminCourtyard: { map: 'administration', x: 165, z: 42, groundY: 0, yaw: Math.PI },
  adminLeftStair: { map: 'administration', x: 136, z: 11.5, groundY: 0, yaw: Math.PI },
  adminRightStair: { map: 'administration', x: 194, z: 22.5, groundY: 0, yaw: 0 },
  adminUpper: { map: 'administration', x: 136, z: 24, groundY: 4.39, yaw: Math.PI },
  adminSecret: { map: 'administration', x: 134.7, z: -33.3, groundY: 4.39, yaw: 0 },
  adminNorth: { map: 'administration', x: 165, z: 156, groundY: 0, yaw: Math.PI },
  adminSouth: { map: 'administration', x: 165, z: -118, groundY: 0, yaw: Math.PI },
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
  if (mapPreview === 'adminSecret') {
    window.setTimeout(() => game.debugGiveAdministrationAccessCard(), 1120);
  }
}

if (window.location.protocol === 'file:') {
  const controlStatus = byId('control-status');
  controlStatus.dataset.error = 'true';
  controlStatus.textContent = '你打开的是旧文件版 · 请关闭本页，双击“启动游戏.command”';
}

byId('deploy-button').addEventListener('click', () => {
  if (!gameReady) return;
  menuScreen.hidden = true;
  topbar.hidden = true;
  resultScreen.hidden = true;
  codexScreen.hidden = true;
  hud.hidden = false;
  inventoryPanel.hidden = true;
  gameShell!.classList.remove('is-inventory-open');
  deployWithSupplies();
});

byId('deployment-loadout').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-deployment-action]');
  const action = button?.dataset.deploymentAction;
  if (action === 'close-panel') {
    deploymentPanelOpen = false;
    renderDeploymentLoadout();
    return;
  }
  if (action === 'toggle-stash') {
    deploymentStashOpen = !deploymentStashOpen;
    renderDeploymentLoadout();
    return;
  }
  if (action === 'equip') {
    const item = profile.stash.find((entry) => entry.id === button?.dataset.deploymentItem);
    if (!item || !isEquipableLoot(item)) return;
    profile = equipLootToProfile(profile, item);
    saveProfile();
    showToast(item.kind === 'weapon' ? `已放入武器格 · ${item.name}` : `已穿戴 · ${item.name}`);
    return;
  }
  const zone = button?.dataset.deploymentZone as 'rig' | 'backpack' | 'secure' | undefined;
  const itemId = button?.dataset.deploymentItem;
  if (!button || !action || !zone || !itemId) return;
  const capacity = zone === 'rig' ? 6 : zone === 'secure'
    ? resolveLoadout(profile).secureContainerCapacity
    : resolveLoadout(profile).backpackSlots;
  const previous = profile;
  profile = action === 'stage'
    ? stageDeploymentItem(profile, itemId, zone, capacity)
    : unstageDeploymentItem(profile, itemId, zone);
  if (profile === previous) {
    showToast(action === 'stage' ? '这个分区已经放不下了' : '未找到要取回的物资', 'danger');
    return;
  }
  saveProfile();
  showToast(action === 'stage' ? '已装入出战整备' : '已退回行动仓库');
});

byId('deployment-stash-button').addEventListener('click', () => {
  deploymentPanelOpen = !deploymentPanelOpen;
  if (deploymentPanelOpen) deploymentStashOpen = true;
  renderDeploymentLoadout();
  if (deploymentPanelOpen) byId('deployment-loadout').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

byId('runtime-reload-button').addEventListener('click', () => window.location.reload());

if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener('keydown', onGlobalKeyDown, { capture: true });
  game.dispose();
});

function missionThreat(difficulty: DifficultyId, bossMode: BossMode, mode: GameModeId): string {
  const modeLabel = GAME_MODE_DEFINITIONS[mode].name;
  const threat = bossMode === 'single'
    ? ({ recruit: '较低', standard: '高', veteran: '极高' })[difficulty]
    : ({ recruit: '高', standard: '极高', veteran: '致命' })[difficulty];
  return `${modeLabel} · ${threat}`;
}

function renderSelectedOperation(): void {
  const details: Record<MapId, { title: string; region: string; bosses: [string, string]; objective: string }> = {
    harbor: { title: '港区断联', region: '九号物流港', bosses: ['「铁锚」', '「灰鲨」'], objective: '在主仓库回收加密硬盘，并前往南部码头撤离。' },
    radar: { title: '长风静默', region: '长风雷达站', bosses: ['「天线」', '「白噪」'], objective: '夺取频谱记录器后撤离。' },
    refinery: { title: '赤湾封锁', region: '赤湾炼化区', bosses: ['「赤炉」', '「火墙」'], objective: '取得反应堆密钥后撤离。' },
    administration: { title: '辖区攻坚', region: '行政辖区', bosses: ['「铁幕」', '「壁垒」'], objective: '搜刮高价值金库并取得中央档案。' },
    reservoir: { title: '黑峡断流', region: '黑峡水库', bosses: ['「洪峰」', '「暗流」'], objective: '穿越山地水利枢纽和地下检修管道，取得主控芯片后撤离。' },
  };
  const selected = details[selectedMap];
  const bossText = selectedBossMode === 'single'
    ? `击败区域首领${selected.bosses[1]}`
    : `击败${selected.bosses[0]}与${selected.bosses[1]}`;
  const modeCopy: Record<GameModeId, string> = {
    extraction: `${bossText}，${selected.objective}`,
    clear: '清空地图内全部敌人，再进入撤离区等待信号。',
    survival: '在敌人持续搜索下坚守 120 秒，倒计时结束后前往撤离。',
    intel: '从容器和敌方背包搜集 3 件情报物资，再前往撤离。',
    night: `夜间潜入，使用手电筒与夜视仪避开巡逻，${selected.objective}`,
    zero: '不携带护甲、药品和枪械入场，先搜索附近物资箱获得第一把武器。',
    'boss-hunt': `${bossText}。首领会在区域中巡逻，并掉落专属红色物品。`,
    'random-extract': `完成主目标后寻找地图情报，解锁本局撤离坐标。`,
    escort: '取得高价值货箱后必须手持运送，无法开枪且移动速度下降。',
    'red-zone': '敌军封锁区域，物资品质提高，行动窗口为 20 分钟。',
    continuous: '连续完成三张地图，剩余生命、护甲、药品、弹药和战利品全部继承。',
    'weapon-lock': '本局只允许使用 V9、SG-12 与 AWM 完成行动。',
    training: '进入射击训练场，测试不同距离与护甲，不消耗装备、弹药和金币。',
  };
  byId('mission-title').textContent = selected.title;
  byId('mission-region').textContent = selected.region;
  byId('mission-copy').textContent = modeCopy[selectedGameMode];
  byId('mission-threat').textContent = missionThreat(selectedDifficulty, selectedBossMode, selectedGameMode);
  byId('mission-window').textContent = formatTime(GAME_MODE_DEFINITIONS[selectedGameMode].timeLimit);
}

byId('map-options').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-map]');
  if (!target?.dataset.map) return;
  selectedMap = target.dataset.map as MapId;
  for (const button of byId('map-options').querySelectorAll('button')) button.classList.toggle('is-selected', button === target);
  renderSelectedOperation();
});

for (const tab of gameShell.querySelectorAll<HTMLButtonElement>('[data-logistics-tab]')) {
  tab.addEventListener('click', () => {
    switchLogisticsTab(tab.dataset.logisticsTab as LogisticsTab);
  });
}

byId('difficulty-options').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-difficulty]');
  if (!target?.dataset.difficulty) return;
  selectedDifficulty = target.dataset.difficulty as DifficultyId;
  for (const button of byId('difficulty-options').querySelectorAll('button')) button.classList.toggle('is-selected', button === target);
  renderSelectedOperation();
});

byId('boss-mode-options').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-boss-mode]');
  if (!target?.dataset.bossMode) return;
  selectedBossMode = target.dataset.bossMode as BossMode;
  for (const button of byId('boss-mode-options').querySelectorAll('button')) button.classList.toggle('is-selected', button === target);
  renderSelectedOperation();
});

byId('game-mode-options').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-game-mode]');
  if (!target?.dataset.gameMode) return;
  selectedGameMode = target.dataset.gameMode as GameModeId;
  for (const button of byId('game-mode-options').querySelectorAll('button')) button.classList.toggle('is-selected', button === target);
  renderSelectedOperation();
});

function commitSettings(): void {
  if (!saveSettings(gameSettings)) showStorageWarning();
  game.applySettings(gameSettings);
  renderSettings();
}

function openSettings(returnToPause: boolean): void {
  settingsReturnToPause = returnToPause;
  pendingKeyAction = null;
  byId('key-binding-feedback').textContent = '';
  if (document.pointerLockElement) document.exitPointerLock();
  if (returnToPause) pauseScreen.hidden = true;
  settingsScreen.hidden = false;
  renderSettings();
}

function closeSettings(): void {
  settingsScreen.hidden = true;
  pendingKeyAction = null;
  if (settingsReturnToPause) pauseScreen.hidden = false;
}

byId('settings-button').addEventListener('click', () => openSettings(false));
byId('pause-settings-button').addEventListener('click', () => openSettings(true));
byId('settings-close').addEventListener('click', closeSettings);
byId('settings-done').addEventListener('click', closeSettings);
byId('settings-reset').addEventListener('click', () => {
  gameSettings = createDefaultSettings();
  pendingKeyAction = null;
  commitSettings();
  byId('key-binding-feedback').textContent = '已恢复默认设置';
});

settingsScreen.addEventListener('input', (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-setting]');
  if (!input?.dataset.setting) return;
  const setting = input.dataset.setting as keyof GameSettings;
  if (setting === 'crosshairColor') gameSettings = { ...gameSettings, crosshairColor: input.value };
  else if (setting === 'mouseSensitivity' || setting === 'trackpadSensitivity' || setting === 'fieldOfView'
    || setting === 'volume' || setting === 'crosshairSize' || setting === 'crosshairOpacity') {
    gameSettings = { ...gameSettings, [setting]: Number(input.value) };
  }
  commitSettings();
});

settingsScreen.addEventListener('click', (event) => {
  const qualityButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-quality]');
  if (qualityButton?.dataset.quality) {
    gameSettings = { ...gameSettings, quality: qualityButton.dataset.quality as QualityLevel };
    commitSettings();
    return;
  }
  const colorButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-crosshair-color]');
  if (colorButton?.dataset.crosshairColor) {
    gameSettings = { ...gameSettings, crosshairColor: colorButton.dataset.crosshairColor };
    commitSettings();
    return;
  }
  const keyButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-key-action]');
  if (!keyButton?.dataset.keyAction) return;
  pendingKeyAction = keyButton.dataset.keyAction as GameAction;
  byId('key-binding-feedback').textContent = `正在修改“${SETTINGS_ACTION_LABELS[pendingKeyAction]}”`;
  renderSettings();
});

// A normal click is accepted by more Mac browsers for FPS-style cursor locking.
byId('capture-controls').addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  game.captureControls();
});

byId('stash-button').addEventListener('click', () => {
  stashScreen.hidden = false;
  switchLogisticsTab('market');
});
byId('requisition-button').addEventListener('click', () => {
  stashScreen.hidden = false;
  switchLogisticsTab('requisition');
});
byId('analysis-button').addEventListener('click', () => {
  stashScreen.hidden = false;
  switchLogisticsTab('analysis');
});
byId('arsenal-button').addEventListener('click', () => {
  stashScreen.hidden = false;
  switchLogisticsTab('gear');
});
byId('gunsmith-button').addEventListener('click', () => {
  const loadout = resolveLoadout(profile);
  selectedGunsmithWeapon = loadout.weapon;
  stashScreen.hidden = false;
  switchLogisticsTab('gunsmith');
});
byId('insurance-button').addEventListener('click', () => {
  const result = collectInsuranceReturns(profile, Date.now());
  profile = result.profile;
  saveProfile();
  showToast(result.returned.length > 0 ? `保险返还 ${result.returned.length} 件装备` : '暂无到期保险装备');
});
byId('codex-button').addEventListener('click', () => { codexScreen.hidden = false; renderCodex(); });
byId('codex-close').addEventListener('click', () => { codexScreen.hidden = true; });
byId('stash-close').addEventListener('click', () => { stashScreen.hidden = true; });
byId('sell-all').addEventListener('click', () => {
  const gained = inventoryValue(profile.stash);
  if (gained <= 0) return;
  profile = sellAll(profile);
  selectedStashItemId = null;
  saveProfile();
  byId('sale-feedback').textContent = `全部出售成功，金币 +${gained.toLocaleString('zh-CN')}`;
  showToast(`出售成功 · 金币 +${gained.toLocaleString('zh-CN')}`);
});
byId('stash-list').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('.stash-item');
  if (!target?.dataset.itemId) return;
  selectedStashItemId = target.dataset.itemId;
  renderProfile();
});
byId('sell-selected').addEventListener('click', () => {
  const item = profile.stash.find((entry) => entry.id === selectedStashItemId);
  if (!item) return;
  const oldCredits = profile.credits;
  profile = sellItem(profile, item.id);
  saveProfile();
  const gained = profile.credits - oldCredits;
  byId('sale-feedback').textContent = `已出售 ${item.name} × 1，金币 +${gained.toLocaleString('zh-CN')}`;
  showToast(`金币已到账 · +${gained.toLocaleString('zh-CN')}`);
});
byId('equip-loot').addEventListener('click', () => {
  const item = profile.stash.find((entry) => entry.id === selectedStashItemId);
  if (!item || !isEquipableLoot(item)) return;
  profile = equipLootToProfile(profile, item);
  saveProfile();
  showToast(`已装备 · ${item.name}`);
});
byId('market-catalog').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-buy-market]');
  if (!target?.dataset.buyMarket) return;
  const product = MARKET_CATALOG.find(({ item }) => item.id === target.dataset.buyMarket);
  if (!product) return;
  const oldCredits = profile.credits;
  profile = buyMarketItem(profile, product.item, product.price);
  if (profile.credits === oldCredits) {
    showToast('金币不足', 'danger');
    return;
  }
  saveProfile();
  byId('purchase-feedback').textContent = `购买成功：${product.item.name} 已存入仓库`;
  showToast(`已购买 ${product.item.name}`);
});
byId('analysis-detail').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-keycard-action]');
  const offer = KEYCARD_OFFERS.find((entry) => entry.item.id === button?.dataset.keycardId);
  if (!button || !offer) return;
  if (button.dataset.keycardAction === 'buy') {
    const previousCredits = profile.credits;
    profile = buyMarketItem(profile, offer.item, offer.price);
    if (profile.credits === previousCredits) {
      showToast('金币不足', 'danger');
      return;
    }
    profile = selectKeycard(profile, offer.item.id);
    saveProfile();
    byId('keycard-feedback').textContent = `购买成功：${offer.item.name}已存入仓库并装入下一局配置。`;
    showToast(`已购买并装入 · ${offer.item.name}`);
    return;
  }
  profile = selectKeycard(profile, button.dataset.keycardAction === 'clear' ? null : offer.item.id);
  saveProfile();
  byId('keycard-feedback').textContent = button.dataset.keycardAction === 'clear'
    ? '已取消携带，房卡继续保存在仓库。'
    : `${offer.item.name}将在进入${offer.mapName}时装入背包。`;
  showToast(button.dataset.keycardAction === 'clear' ? '已取消携带房卡' : '房卡已装入下局配置');
});
for (const button of gameShell.querySelectorAll<HTMLButtonElement>('[data-buy-supply]')) {
  button.addEventListener('click', () => {
    const supplyId = button.dataset.buySupply as 'armor' | 'ammo' | 'medical';
    const previousCredits = profile.credits;
    profile = buySupply(profile, supplyId);
    if (profile.credits === previousCredits) {
      showToast('金币不足或已达到携带上限', 'danger');
      return;
    }
    saveProfile();
    byId('requisition-feedback').textContent = '补给兑换成功，将在下一次部署时自动装载。';
    showToast('军需补给已装入下局配置');
  });
}
byId('ammo-pack-grid').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-buy-ammo-level]');
  const level = Number(button?.dataset.buyAmmoLevel);
  if (!button || !Number.isInteger(level) || level < 0 || level > 6) return;
  const previousProfile = profile;
  profile = buyAmmoPack(profile, level as 0 | 1 | 2 | 3 | 4 | 5 | 6);
  if (profile === previousProfile) {
    showToast('金币不足', 'danger');
    return;
  }
  const pack = AMMO_PACKS.find((entry) => entry.level === level)!;
  saveProfile();
  byId('requisition-feedback').textContent = `${pack.level} 级 ${pack.name}已存入行动仓库；请在出战整备中装进胸挂。`;
  showToast(`已购买 ${pack.level} 级 ${pack.name} · ${pack.rounds} 发`);
});
byId('gear-detail').addEventListener('click', (event) => {
  const filter = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-gear-filter]');
  if (filter?.dataset.gearFilter) {
    gearFilter = filter.dataset.gearFilter as GearCategory | 'all';
    renderProfile();
    return;
  }
  const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-gear-action]');
  const insure = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-insure-gear]');
  const repair = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-repair-gear]');
  if (repair?.dataset.repairGear) {
    const gear = GEAR_CATALOG.find((entry) => entry.id === repair.dataset.repairGear);
    if (!gear) return;
    const previousCredits = profile.credits;
    profile = repairGear(profile, gear.id, gearPrice(profile, gear));
    if (profile.credits === previousCredits) {
      showToast('金币不足或装备无需维修', 'danger');
      return;
    }
    saveProfile();
    byId('gear-feedback').textContent = `${gear.name} 已完成维修，耐久恢复到 100%。`;
    showToast(`维修完成 · ${gear.name}`);
    return;
  }
  if (insure?.dataset.insureGear) {
    const insuredGear = GEAR_CATALOG.find((entry) => entry.id === insure.dataset.insureGear);
    if (!insuredGear) return;
    const insuredItem: InventoryItem = {
      id: insuredGear.id,
      name: insuredGear.name,
      kind: insuredGear.category === 'weapon' ? 'weapon' : insuredGear.category === 'armor' ? 'armor' : insuredGear.category === 'helmet' ? 'helmet' : 'supplies',
      rarity: insuredGear.rarity,
      value: insuredGear.price,
      quantity: 1,
      equipmentSlot: insuredGear.category === 'backpack' || insuredGear.category === 'medical' ? undefined : insuredGear.category,
    };
    const previousCredits = profile.credits;
    profile = insureItem(profile, insuredItem, Math.max(100, Math.round(insuredGear.price * 0.08)));
    if (profile.credits === previousCredits) {
      showToast('金币不足或该装备已经投保', 'danger');
      return;
    }
    saveProfile();
    showToast(`${insuredGear.name} 已投保，行动失败后等待返还`);
    return;
  }
  if (!action?.dataset.gearId) return;
  const item = GEAR_CATALOG.find((entry) => entry.id === action.dataset.gearId);
  if (!item) return;
  if (action.dataset.gearAction === 'buy') {
    const price = gearPrice(profile, item);
    const previousCredits = profile.credits;
    profile = buyGear(profile, item.id, item.category, price);
    if (profile.credits === previousCredits) {
      showToast('金币不足或装备已经拥有', 'danger');
      return;
    }
    byId('gear-feedback').textContent = `购买成功：${item.name} 已加入行动装备库`;
    showToast(`已购买 ${item.name}`);
  } else {
    profile = equipGear(profile, item.id, item.category);
    byId('gear-feedback').textContent = `已装备 ${item.name}，下次部署生效`;
    showToast(`已装备 ${item.name}`);
  }
  saveProfile();
});
byId('gunsmith-detail').addEventListener('click', (event) => {
  const weaponButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-gunsmith-weapon]');
  if (weaponButton?.dataset.gunsmithWeapon) {
    selectedGunsmithWeapon = weaponButton.dataset.gunsmithWeapon as GunsmithWeaponId;
    renderGunsmith();
    return;
  }
  const slotButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-gunsmith-slot]');
  if (slotButton?.dataset.gunsmithSlot) {
    selectedGunsmithSlot = slotButton.dataset.gunsmithSlot as WeaponModSlot;
    renderGunsmith();
    return;
  }
  const removeButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-mod]');
  if (removeButton) {
    profile = removeWeaponModification(profile, selectedGunsmithWeapon, selectedGunsmithSlot);
    saveProfile();
    byId('gunsmith-feedback').textContent = '已恢复该部位的标准配置';
    return;
  }
  const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mod-action]');
  if (!action?.dataset.modId) return;
  const modification = WEAPON_MODIFICATIONS.find((entry) => entry.id === action.dataset.modId);
  if (!modification) return;
  if (action.dataset.modAction === 'buy') {
    const price = weaponModificationPrice(profile, modification);
    const previousCredits = profile.credits;
    profile = buyWeaponModification(profile, modification.id, price);
    if (profile.credits === previousCredits) {
      showToast('金币不足或配件已经拥有', 'danger');
      return;
    }
  }
  profile = equipWeaponModification(profile, selectedGunsmithWeapon, modification.slot, modification.id);
  saveProfile();
  byId('gunsmith-feedback').textContent = `${modification.name} 已安装到 ${GUNSMITH_WEAPONS.find((entry) => entry.id === selectedGunsmithWeapon)?.shortName}`;
  showToast(`改装完成 · ${modification.name}`);
});
byId('facility-detail').addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-upgrade-facility]');
  if (!target?.dataset.upgradeFacility) return;
  const facility = FACILITIES.find((entry) => entry.id === target.dataset.upgradeFacility);
  if (!facility) return;
  const currentLevel = profile.facilityLevels[facility.id] ?? 1;
  const cost = facilityUpgradeCost(facility, currentLevel);
  if (cost === null) return;
  const previousCredits = profile.credits;
  profile = upgradeFacility(profile, facility.id as FacilityId, cost, facility.maxLevel);
  if (profile.credits === previousCredits) {
    showToast('金币不足或设施已经满级', 'danger');
    return;
  }
  saveProfile();
  byId('facility-feedback').textContent = `${facility.name} 已升级至 ${currentLevel + 1} 级`;
  showToast(`${facility.name} 升级完成`);
});
byId('corpse-loot-grid').addEventListener('click', (event) => {
  if (suppressLootClick) return;
  const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-loot-origin="loot"][data-loot-item-id]');
  if (!item?.dataset.lootItemId) return;
  game.takeLootItem(item.dataset.lootItemId);
});
byId('corpse-equipment-strip').addEventListener('click', (event) => {
  if (suppressLootClick) return;
  const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-loot-origin="loot"][data-loot-item-id]');
  if (!item?.dataset.lootItemId) return;
  game.takeLootItem(item.dataset.lootItemId);
});
byId('corpse-loot-take-all').addEventListener('click', () => { game.takeAllCorpseLoot(); });
byId('corpse-loot-close').addEventListener('click', () => { game.closeCorpseLoot(); });
byId('loot-sort-backpack').addEventListener('click', () => { game.sortBackpack(); });

gameShell.addEventListener('dragstart', (event) => {
  if (pointerLootDrag) {
    event.preventDefault();
    return;
  }
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-loot-item-id], [data-backpack-item]');
  if (!target) return;
  const id = target.dataset.lootItemId ?? target.dataset.backpackItem;
  if (!id) return;
  draggedLootItem = { id, origin: target.dataset.lootOrigin === 'loot' ? 'loot' : 'backpack' };
  event.dataTransfer?.setData('text/plain', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  target.classList.add('is-dragging');
});

gameShell.addEventListener('dragend', (event) => {
  (event.target as HTMLElement).closest<HTMLElement>('.is-dragging')?.classList.remove('is-dragging');
  draggedLootItem = null;
  for (const target of gameShell.querySelectorAll('.is-drop-target')) target.classList.remove('is-drop-target');
});

gameShell.addEventListener('dragover', (event) => {
  const dropZone = (event.target as HTMLElement).closest<HTMLElement>('#corpse-player-grid, #corpse-loot-grid, #corpse-equipment-strip, #inventory-grid');
  if (!dropZone || !draggedLootItem) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropZone.classList.add('is-drop-target');
});

gameShell.addEventListener('drop', (event) => {
  const dropZone = (event.target as HTMLElement).closest<HTMLElement>('#corpse-player-grid, #corpse-loot-grid, #corpse-equipment-strip, #inventory-grid');
  if (!dropZone || !draggedLootItem) return;
  event.preventDefault();
  const targetItem = (event.target as HTMLElement).closest<HTMLElement>('[data-loot-origin="backpack"], [data-backpack-item]');
  const targetId = targetItem?.dataset.lootItemId ?? targetItem?.dataset.backpackItem ?? null;
  completeLootDrop(dropZone, targetId, draggedLootItem);
  draggedLootItem = null;
  dropZone.classList.remove('is-drop-target');
});

function completeLootDrop(
  dropZone: HTMLElement,
  targetId: string | null,
  dragged: { id: string; origin: 'loot' | 'backpack' },
): void {
  if (dropZone.id === 'corpse-player-grid') {
    if (dragged.origin === 'loot') game.takeLootItem(dragged.id);
    else game.moveBackpackItem(dragged.id, targetId);
  } else if ((dropZone.id === 'corpse-loot-grid' || dropZone.id === 'corpse-equipment-strip') && dragged.origin === 'backpack') {
    game.returnBackpackItemToLoot(dragged.id);
  } else if (dropZone.id === 'inventory-grid' && dragged.origin === 'backpack') {
    game.moveBackpackItem(dragged.id, targetId);
  }
}

gameShell.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const element = (event.target as HTMLElement).closest<HTMLElement>('[data-loot-item-id][draggable="true"], [data-backpack-item][draggable="true"]');
  if (!element) return;
  const id = element.dataset.lootItemId ?? element.dataset.backpackItem;
  if (!id) return;
  pointerLootDrag = {
    id,
    origin: element.dataset.lootOrigin === 'loot' ? 'loot' : 'backpack',
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    element,
  };
});

gameShell.addEventListener('pointermove', (event) => {
  if (!pointerLootDrag) return;
  if (!pointerLootDrag.active && Math.hypot(event.clientX - pointerLootDrag.startX, event.clientY - pointerLootDrag.startY) < 7) return;
  pointerLootDrag.active = true;
  pointerLootDrag.element.classList.add('is-dragging');
  for (const target of gameShell.querySelectorAll('.is-drop-target')) target.classList.remove('is-drop-target');
  const dropZone = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('#corpse-player-grid, #corpse-loot-grid, #inventory-grid');
  dropZone?.classList.add('is-drop-target');
});

gameShell.addEventListener('pointerup', (event) => {
  const dragged = pointerLootDrag;
  pointerLootDrag = null;
  if (!dragged) return;
  dragged.element.classList.remove('is-dragging');
  for (const target of gameShell.querySelectorAll('.is-drop-target')) target.classList.remove('is-drop-target');
  if (!dragged.active) return;
  event.preventDefault();
  const targetElement = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
  const dropZone = targetElement?.closest<HTMLElement>('#corpse-player-grid, #corpse-loot-grid, #inventory-grid');
  if (dropZone) {
    const targetItem = targetElement?.closest<HTMLElement>('[data-loot-origin="backpack"], [data-backpack-item]');
    const targetId = targetItem?.dataset.lootItemId ?? targetItem?.dataset.backpackItem ?? null;
    completeLootDrop(dropZone, targetId, dragged);
  }
  suppressLootClick = true;
  window.setTimeout(() => { suppressLootClick = false; }, 0);
});

gameShell.addEventListener('pointercancel', () => {
  pointerLootDrag?.element.classList.remove('is-dragging');
  pointerLootDrag = null;
  for (const target of gameShell.querySelectorAll('.is-drop-target')) target.classList.remove('is-drop-target');
});
for (const filterButton of gameShell.querySelectorAll<HTMLButtonElement>('[data-stash-filter]')) {
  filterButton.addEventListener('click', () => {
    stashFilter = (filterButton.dataset.stashFilter ?? 'all') as InventoryItem['kind'] | 'all';
    for (const button of gameShell.querySelectorAll('[data-stash-filter]')) {
      button.classList.toggle('is-active', button === filterButton);
    }
    renderProfile();
  });
}

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
  showMenu();
  stashScreen.hidden = false;
  renderProfile();
});

function setInventoryOpen(open: boolean): void {
  if (hud.hidden) return;
  inventoryPanel.hidden = !open;
  gameShell.classList.toggle('is-inventory-open', open);
  if (open) {
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    game.captureControls();
  }
}

function onGlobalKeyDown(event: KeyboardEvent): void {
  if (!settingsScreen.hidden) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (pendingKeyAction) {
      if (event.code === 'Escape') {
        pendingKeyAction = null;
        byId('key-binding-feedback').textContent = '已取消改键';
        renderSettings();
        return;
      }
      const duplicate = (Object.keys(gameSettings.keyBindings) as GameAction[])
        .find((action) => action !== pendingKeyAction && gameSettings.keyBindings[action] === event.code);
      if (duplicate) {
        byId('key-binding-feedback').textContent = `这个按键已用于“${SETTINGS_ACTION_LABELS[duplicate]}”，请换一个按键`;
        return;
      }
      const changedAction = pendingKeyAction;
      gameSettings = {
        ...gameSettings,
        keyBindings: { ...gameSettings.keyBindings, [changedAction]: event.code },
      };
      pendingKeyAction = null;
      commitSettings();
      byId('key-binding-feedback').textContent = `“${SETTINGS_ACTION_LABELS[changedAction]}”已改为 ${keyLabel(event.code)}`;
      return;
    }
    if (event.code === 'Escape') closeSettings();
    return;
  }
  if (event.code === gameSettings.keyBindings.inventory && !hud.hidden) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    setInventoryOpen(inventoryPanel.hidden);
    return;
  }
  if (event.code === 'Escape' && !inventoryPanel.hidden) {
    event.preventDefault();
    event.stopImmediatePropagation();
    setInventoryOpen(false);
  }
}

window.addEventListener('keydown', onGlobalKeyDown, { capture: true });

byId('inventory-close').addEventListener('click', () => setInventoryOpen(false));
byId('inventory-sort').addEventListener('click', () => game.sortBackpack());
byId('inventory-discard').addEventListener('click', () => {
  if (game.discardBackpackItems([...selectedInventoryItemIds], 'discard')) selectedInventoryItemIds.clear();
});
byId('inventory-destroy').addEventListener('click', () => {
  if (game.discardBackpackItems([...selectedInventoryItemIds], 'destroy')) selectedInventoryItemIds.clear();
});
byId('field-market-close').addEventListener('click', () => game.closeFieldMarket());
fieldMarket.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-field-trade]');
  const kind = button?.dataset.fieldTrade;
  if (kind === 'ammo' || kind === 'medical' || kind === 'intel') game.tradeFieldMarket(kind);
});

byId('inventory-grid').addEventListener('click', (event) => {
  const secureButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-secure-item]');
  if (secureButton?.dataset.secureItem) {
    game.secureBackpackItem(secureButton.dataset.secureItem);
    return;
  }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-discard-item]');
  if (button?.dataset.discardItem) {
    game.discardBackpackItem(button.dataset.discardItem);
    selectedInventoryItemIds.delete(button.dataset.discardItem);
    return;
  }
  const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-select-item]');
  const itemId = slot?.dataset.selectItem;
  if (!itemId) return;
  if (selectedInventoryItemIds.has(itemId)) selectedInventoryItemIds.delete(itemId);
  else selectedInventoryItemIds.add(itemId);
  renderInventory(latestRun.backpack, latestRun.player.secureContainer, latestRun.player.secureContainerCapacity);
});

byId('secure-container-grid').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-unsecure-item]');
  if (button?.dataset.unsecureItem) game.unsecureItem(button.dataset.unsecureItem);
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
