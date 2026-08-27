(() => {
  const install = () => {
    const api = window.__criticalExtraction;
    const game = api?.game;
    const bossOptions = document.querySelector('#boss-mode-options');
    if (!game || !bossOptions || game.__noBossModeInstalled) {
      if (!game || !bossOptions) window.setTimeout(install, 120);
      return;
    }

    const administrationRouteCuts = [
      { x: 189, y: 6, z: 4, width: 0.6, height: 12, depth: 24 },
      { x: 188, y: 1.1, z: 0.2, width: 14, height: 2.2, depth: 0.18 },
      { x: 198, y: 6, z: 36, width: 18, height: 12, depth: 0.6 },
    ];
    const near = (left, right, tolerance = 0.06) => Math.abs(left - right) <= tolerance;
    const matchesRouteCut = (position, scale) => administrationRouteCuts.some((cut) => (
      near(position.x, cut.x)
      && near(position.y, cut.y)
      && near(position.z, cut.z)
      && (!scale || (
        near(scale.x, cut.width)
        && near(scale.y, cut.height)
        && near(scale.z, cut.depth)
      ))
    ));
    let removedRouteWalls = 0;
    for (let index = game.blockers.length - 1; index >= 0; index -= 1) {
      const blocker = game.blockers[index];
      if (!matchesRouteCut(blocker.position, blocker.scale)) continue;
      blocker.parent?.remove(blocker);
      game.blockers.splice(index, 1);
      removedRouteWalls += 1;
    }
    let disabledRouteColliders = 0;
    game.physicsWorld?.forEachCollider?.((collider) => {
      const position = collider.parent()?.translation();
      if (!position || !matchesRouteCut(position)) return;
      collider.setEnabled(false);
      disabledRouteColliders += 1;
    });
    game.__administrationRouteOpened = {
      walls: removedRouteWalls,
      colliders: disabledRouteColliders,
    };

    if (!bossOptions.querySelector('[data-boss-mode="none"]')) {
      const option = document.createElement('button');
      option.className = 'option-chip';
      option.type = 'button';
      option.dataset.bossMode = 'none';
      option.textContent = '无首领';
      bossOptions.append(option);
    }

    game.__noBossModeInstalled = true;
    game.__noBossRequested = false;

    const originalMiniMapUpdate = game.callbacks?.onMiniMap;
    if (originalMiniMapUpdate) {
      game.callbacks.onMiniMap = function (view) {
        if (!game.__noBossRequested || !Array.isArray(view?.tasks)) {
          return originalMiniMapUpdate.call(this, view);
        }
        return originalMiniMapUpdate.call(this, {
          ...view,
          tasks: view.tasks.filter((task) => !String(task.label).includes('首领')),
        });
      };
    }

    const originalCreateEnemies = game.createEnemies;
    game.createEnemies = function (...args) {
      if (!this.__noBossRequested || !this.activeOperation?.enemies) {
        return originalCreateEnemies.apply(this, args);
      }
      const operation = this.activeOperation;
      this.activeOperation = {
        ...operation,
        enemies: operation.enemies.filter((enemy) => !enemy[2]),
      };
      try {
        return originalCreateEnemies.apply(this, args);
      } finally {
        this.activeOperation = operation;
      }
    };

    const originalStartRun = game.startRun;
    game.startRun = function (map, difficulty, loadout, bossMode, gameMode) {
      const availableMap = map;
      const noBoss = bossMode === 'none' || this.__noBossRequested;
      const args = [availableMap, difficulty, loadout, noBoss ? 'single' : bossMode, gameMode];
      const result = originalStartRun.apply(this, args);
      if (noBoss) {
        this.activeBossMode = 'none';
        this.syncMissionObjectiveText?.();
        this.callbacks?.onMiniMap?.(this.createMiniMapView());
      }
      return result;
    };

    const originalAdvanceContinuousOperation = game.advanceContinuousOperation;
    if (originalAdvanceContinuousOperation) {
      game.advanceContinuousOperation = function (...args) {
        if (this.activeOperation?.id !== 'administration') {
          return originalAdvanceContinuousOperation.apply(this, args);
        }
        const operation = this.activeOperation;
        this.activeOperation = { ...operation, id: 'reservoir' };
        try {
          return originalAdvanceContinuousOperation.apply(this, args);
        } finally {
          if (this.activeOperation?.id === 'reservoir') this.activeOperation = operation;
        }
      };
    }

    const refreshMenu = () => {
      const noBoss = bossOptions.querySelector('[data-boss-mode="none"]')?.classList.contains('is-selected');
      game.__noBossRequested = noBoss;
      const bossHunt = document.querySelector('[data-game-mode="boss-hunt"]');
      if (bossHunt) {
        bossHunt.disabled = noBoss;
        bossHunt.title = noBoss ? '无首领模式不能进行首领追猎' : '';
        if (noBoss && bossHunt.classList.contains('is-selected')) {
          document.querySelector('[data-game-mode="extraction"]')?.click();
        }
      }
      if (!noBoss) return;

      const difficulty = document.querySelector('[data-difficulty].is-selected')?.dataset.difficulty;
      const level = { recruit: '较低', standard: '标准', veteran: '较高' }[difficulty] ?? '标准';
      const threat = document.querySelector('#mission-threat');
      if (threat) threat.textContent = `无首领 · ${level}`;
      const mode = document.querySelector('[data-game-mode].is-selected')?.dataset.gameMode;
      if (mode === 'extraction') {
        const copy = document.querySelector('#mission-copy');
        if (copy) copy.textContent = '回收任务物品，并前往标记区域撤离。';
      }
    };

    for (const id of ['boss-mode-options', 'difficulty-options', 'map-options', 'game-mode-options']) {
      document.querySelector(`#${id}`)?.addEventListener('click', refreshMenu);
    }
    refreshMenu();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
