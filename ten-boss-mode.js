(() => {
  const TEN_BOSS_COUNT = 10;
  const BOSS_NAMES = ['黑潮', '断桥', '霜刃', '铁幕', '夜巡', '岩蜂', '灰烬', '冷港', '界碑', '终局'];

  const install = () => {
    const api = window.__criticalExtraction;
    const game = api?.game;
    const bossOptions = document.querySelector('#boss-mode-options');
    if (!game || !bossOptions) {
      window.setTimeout(install, 100);
      return;
    }
    if (game.__tenBossModeInstalled) return;
    game.__tenBossModeInstalled = true;
    game.__tenBossRequested = false;

    const refreshTenObjective = (target) => {
      if (!target?.__tenBossRequested || !target.run) return 0;
      const remaining = (target.enemies ?? []).filter((enemy) => enemy.boss && enemy.alive).length;
      if (remaining > 0) {
        target.run.objectiveText = `十首领突围 · 击败全部首领，解除任务物品锁定（剩余 ${remaining} / ${TEN_BOSS_COUNT}）`;
      }
      return remaining;
    };

    if (!bossOptions.querySelector('[data-boss-mode="ten"]')) {
      const option = document.createElement('button');
      option.className = 'option-chip option-chip-danger';
      option.type = 'button';
      option.dataset.bossMode = 'ten';
      option.textContent = '十首领突围';
      bossOptions.append(option);
    }

    const originalToast = game.callbacks?.onToast;
    if (originalToast) {
      game.callbacks.onToast = function (message, tone) {
        const fixedMessage = game.__tenBossRequested && message === '两名区域首领已全部击败 · 任务物品锁定解除'
          ? '十名区域首领已全部击败 · 任务物品锁定解除'
          : message;
        return originalToast.call(this, fixedMessage, tone);
      };
    }

    const originalSyncMissionObjectiveText = game.syncMissionObjectiveText;
    if (typeof originalSyncMissionObjectiveText === 'function') {
      game.syncMissionObjectiveText = function (...args) {
        const result = originalSyncMissionObjectiveText.apply(this, args);
        refreshTenObjective(this);
        return result;
      };
    }

    const originalMiniMapUpdate = game.callbacks?.onMiniMap;
    if (originalMiniMapUpdate) {
      game.callbacks.onMiniMap = function (view) {
        if (game.__tenBossRequested) {
          refreshTenObjective(game);
          game.callbacks?.onUpdate?.(game.run);
        }
        return originalMiniMapUpdate.call(this, view);
      };
    }

    const originalCreateMiniMapView = game.createMiniMapView;
    if (typeof originalCreateMiniMapView === 'function') {
      game.createMiniMapView = function (...args) {
        const view = originalCreateMiniMapView.apply(this, args);
        if (!this.__tenBossRequested) return view;
        const remaining = (this.enemies ?? []).filter((enemy) => enemy.boss && enemy.alive).length;
        return {
          ...view,
          target: view.target?.type === 'boss'
            ? { ...view.target, label: `十首领突围 · ${remaining} / ${TEN_BOSS_COUNT}` }
            : view.target,
          tasks: (view.tasks ?? []).map((task) => task.id === 'boss'
            ? { ...task, label: `击败十名区域首领（剩余 ${remaining} / ${TEN_BOSS_COUNT}）` }
            : task),
        };
      };
    }

    const originalStartRun = game.startRun;
    game.startRun = function (map, difficulty, supplies, bossMode, gameMode) {
      const tenBoss = bossMode === 'ten' || this.__tenBossRequested;
      if (!tenBoss) {
        this.__tenBossRequested = false;
        this.__tenBossTotal = 0;
        return originalStartRun.call(this, map, difficulty, supplies, bossMode, gameMode);
      }

      this.__tenBossRequested = true;
      const originalCreateEnemies = this.createEnemies;
      this.createEnemies = function (...args) {
        const operation = this.activeOperation;
        const currentRegulars = operation.enemies.filter((entry) => !entry[2]).length;
        // Even on the easy difficulty, reserve enough normal spawns for eight to be promoted.
        const requiredRegulars = 14;
        const additional = [];
        for (let index = currentRegulars; index < requiredRegulars; index += 1) {
          const angle = Math.PI * 2 * (index - currentRegulars) / Math.max(1, requiredRegulars - currentRegulars);
          const radius = 17 + (index % 3) * 8;
          additional.push([
            operation.objective.x + Math.cos(angle) * radius,
            operation.objective.z + Math.sin(angle) * radius,
          ]);
        }
        this.activeOperation = additional.length > 0
          ? { ...operation, enemies: [...operation.enemies, ...additional] }
          : operation;
        try {
          return originalCreateEnemies.apply(this, args);
        } finally {
          this.activeOperation = operation;
        }
      };

      try {
        // The base game creates two authored bosses. Eight guards are promoted immediately after creation.
        const result = originalStartRun.call(this, map, difficulty, supplies, 'double', gameMode);
        const promoted = (this.enemies ?? []).filter((enemy) => enemy.alive && !enemy.boss).slice(0, TEN_BOSS_COUNT - 2);
        for (const [index, enemy] of promoted.entries()) {
          const maxHealth = Math.max(620, Math.round(enemy.maxHealth * 10));
          const maxArmor = Math.max(320, Math.round(enemy.armorMaxDurability * 7));
          enemy.boss = true;
          enemy.elite = true;
          enemy.role = 'captain';
          enemy.maxHealth = maxHealth;
          enemy.health = maxHealth;
          enemy.armorMaxDurability = maxArmor;
          enemy.armorDurability = maxArmor;
          enemy.armorBroken = false;
          enemy.enraged = false;
          enemy.group.scale.setScalar(1.08);
        }
        const bosses = (this.enemies ?? []).filter((enemy) => enemy.boss && enemy.alive).slice(0, TEN_BOSS_COUNT);
        bosses.forEach((enemy, index) => {
          enemy.name = `首领「${BOSS_NAMES[index]}」`;
          const rarity = index >= 8 ? 'red' : index >= 5 ? 'gold' : 'purple';
          enemy.bossReward = {
            id: `ten-boss-token-${this.operationSeed}-${index}`,
            name: `${BOSS_NAMES[index]}的指挥凭证`,
            kind: 'intel',
            rarity,
            value: rarity === 'red' ? 18000 : rarity === 'gold' ? 8200 : 3800,
            quantity: 1,
            description: '十首领突围行动中的专属高价值战利品。',
          };
        });
        this.activeBossMode = 'ten';
        this.__tenBossTotal = bosses.length;
        this.designatedGuard = bosses[0] ?? null;
        this.syncMissionObjectiveText?.();
        refreshTenObjective(this);
        this.callbacks?.onUpdate?.(this.run);
        this.refreshBossHud?.(bosses[0]);
        this.callbacks?.onMiniMap?.(this.createMiniMapView());
        this.callbacks?.onToast?.(`十首领突围开始 · 已部署 ${bosses.length} 名强化首领`, 'danger');
        return result;
      } finally {
        this.createEnemies = originalCreateEnemies;
      }
    };

    const refreshMenu = () => {
      const selected = bossOptions.querySelector('[data-boss-mode="ten"]')?.classList.contains('is-selected');
      game.__tenBossRequested = Boolean(selected);
      if (!selected) return;
      const setText = (id, value) => {
        const element = document.querySelector(`#${id}`);
        if (element) element.textContent = value;
      };
      setText('mission-title', '十首领突围');
      setText('mission-copy', '十名强化首领封锁任务区域。全部击败后，任务物品与撤离信号才会解除锁定。');
      setText('mission-threat', '十首领突围 · 极高');
    };

    for (const id of ['boss-mode-options', 'difficulty-options', 'map-options', 'game-mode-options']) {
      document.querySelector(`#${id}`)?.addEventListener('click', () => window.setTimeout(refreshMenu, 0));
    }
    refreshMenu();
  };

  // The WebGL boot sequence can keep the document in loading state, so retry immediately.
  install();
})();
