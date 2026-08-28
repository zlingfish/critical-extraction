(() => {
  const MAP_LAYER = 1;
  const CUSTOM_IDS = new Set(['shipyard', 'highlands']);

  const maps = {
    shipyard: {
      name: '深潮船坞',
      title: '深潮封港',
      objectiveText: '潜入船坞维修厅，取得舰船导航核心',
      objectiveCopy: '穿过集装箱堆场与干船坞，在维修厅取得导航核心后撤离。',
      bosses: ['「铆钉」', '「深潜」'],
      center: { x: -260, z: 0, range: 138 },
      spawn: { x: -330, z: 108 },
      objective: { x: -245, z: -64 },
      extraction: { x: -184, z: 106 },
      yaw: -0.6,
      enemies: [
        [-316, 76], [-292, 88], [-270, 64], [-228, 82], [-196, 70],
        [-316, 18], [-284, 30], [-236, 20], [-202, 8], [-290, -32],
        [-265, -48], [-226, -42], [-245, -58, true], [-214, -82, true],
      ],
      loot: [
        [-324, 82], [-300, 72], [-277, 92], [-250, 67], [-218, 83], [-194, 50],
        [-310, 14], [-282, 26], [-258, 8], [-226, 15], [-198, -3], [-300, -38],
        [-276, -53], [-252, -67], [-224, -48], [-195, -91],
      ],
    },
    highlands: {
      name: '霜岭前哨',
      title: '霜岭失联',
      objectiveText: '进入山体通信站，取得边境识别模块',
      objectiveCopy: '沿山路突破雷达前哨，进入山体隧道取得识别模块后撤离。',
      bosses: ['「雪线」', '「界碑」'],
      center: { x: 700, z: 0, range: 148 },
      spawn: { x: 620, z: 112 },
      objective: { x: 735, z: -72 },
      extraction: { x: 792, z: 104 },
      yaw: -0.48,
      enemies: [
        [642, 88], [675, 98], [711, 85], [752, 92], [777, 65],
        [632, 38], [668, 46], [708, 30], [760, 32], [650, -18],
        [690, -30], [724, -45], [735, -66, true], [772, -78, true],
      ],
      loot: [
        [628, 94], [650, 78], [676, 102], [704, 73], [740, 88], [775, 71],
        [635, 34], [670, 42], [704, 18], [744, 34], [783, 22], [650, -22],
        [684, -36], [716, -52], [738, -73], [778, -82],
      ],
    },
  };

  const install = () => {
    const game = window.__criticalExtraction?.game;
    const mapOptions = document.querySelector('#map-options');
    if (!game?.scene || !game?.physicsWorld || !mapOptions) {
      window.setTimeout(install, 100);
      return;
    }
    if (game.__extendedMapsInstalled) return;

    const constructors = {};
    let Mesh = null;
    let Group = null;
    let StandardMaterial = null;
    let PhysicalMaterial = null;
    game.scene.traverse((object) => {
      if (object.isGroup && !Group) Group = object.constructor;
      if (!object.isMesh) return;
      Mesh ??= object.constructor;
      if (object.geometry?.type) constructors[object.geometry.type] ??= object.geometry.constructor;
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) {
        if (material?.isMeshStandardMaterial && !material.isMeshPhysicalMaterial && !StandardMaterial) {
          StandardMaterial = material.constructor;
        }
        if (material?.isMeshPhysicalMaterial && !PhysicalMaterial) PhysicalMaterial = material.constructor;
      }
    });
    Group ??= game.scene.constructor;
    PhysicalMaterial ??= StandardMaterial;
    const BoxGeometry = constructors.BoxGeometry;
    const CylinderGeometry = constructors.CylinderGeometry;
    const DodecahedronGeometry = constructors.DodecahedronGeometry;
    const ConeGeometry = constructors.ConeGeometry ?? constructors.CylinderGeometry;
    if (!Mesh || !Group || !StandardMaterial || !BoxGeometry || !CylinderGeometry || !DodecahedronGeometry) {
      window.setTimeout(install, 100);
      return;
    }
    game.__extendedMapsInstalled = true;

    const sharedBox = new BoxGeometry(1, 1, 1);
    const materials = {
      asphalt: new StandardMaterial({ color: '#59615d', roughness: 0.9, metalness: 0.04 }),
      concrete: new StandardMaterial({ color: '#aeb4ad', roughness: 0.78, metalness: 0.04 }),
      darkConcrete: new StandardMaterial({ color: '#58615d', roughness: 0.88, metalness: 0.06 }),
      steel: new StandardMaterial({ color: '#65736e', roughness: 0.52, metalness: 0.62 }),
      darkSteel: new StandardMaterial({ color: '#26312f', roughness: 0.6, metalness: 0.56 }),
      safety: new StandardMaterial({ color: '#d2a72e', roughness: 0.6, metalness: 0.22 }),
      red: new StandardMaterial({ color: '#8e3f35', roughness: 0.68, metalness: 0.28 }),
      blue: new StandardMaterial({ color: '#315b68', roughness: 0.66, metalness: 0.32 }),
      green: new StandardMaterial({ color: '#405f50', roughness: 0.75, metalness: 0.18 }),
      snow: new StandardMaterial({ color: '#d8e0db', roughness: 0.92, metalness: 0 }),
      rock: new StandardMaterial({ color: '#4c5652', roughness: 1, flatShading: true }),
      pine: new StandardMaterial({ color: '#24463b', roughness: 0.96 }),
      trunk: new StandardMaterial({ color: '#4b3b2d', roughness: 1 }),
      glass: new StandardMaterial({
        color: '#75a9aa', emissive: '#153d3d', emissiveIntensity: 0.75,
        transparent: true, opacity: 0.72, roughness: 0.18, metalness: 0.08,
      }),
      water: new PhysicalMaterial({
        color: '#255f6d', roughness: 0.18, metalness: 0.08,
        clearcoat: 0.75, clearcoatRoughness: 0.16, transparent: true, opacity: 0.9,
      }),
    };

    const roots = {
      shipyard: new Group(),
      highlands: new Group(),
    };
    for (const [id, root] of Object.entries(roots)) {
      root.name = `extended-map-${id}`;
      root.visible = false;
      game.scene.add(root);
    }

    // 每张扩展地图独立管理碰撞体。模型隐藏时必须同时关闭碰撞，否则会出现看不见的空气墙。
    const mapColliders = new Map([
      ['shipyard', []],
      ['highlands', []],
    ]);
    let buildingMapId = null;
    const addCollider = (x, y, z, width, height, depth) => {
      if (typeof game.addStaticCollider === 'function') {
        const collider = game.addStaticCollider(x, y, z, width, height, depth);
        if (buildingMapId && collider) mapColliders.get(buildingMapId)?.push(collider);
      }
    };

    const box = (root, x, y, z, width, height, depth, material, collide = true, shadow = false) => {
      const mesh = new Mesh(sharedBox, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(width, height, depth);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.layers.set(MAP_LAYER);
      root.add(mesh);
      if (collide) {
        game.blockers?.push(mesh);
        addCollider(x, y, z, width, height, depth);
      }
      return mesh;
    };

    const cylinder = (root, x, y, z, radius, height, material, segments = 16, collide = false) => {
      const mesh = new Mesh(new CylinderGeometry(radius, radius, height, segments), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.layers.set(MAP_LAYER);
      root.add(mesh);
      if (collide) {
        game.blockers?.push(mesh);
        addCollider(x, y, z, radius * 1.7, height, radius * 1.7);
      }
      return mesh;
    };

    const sign = (root, label, x, y, z, width, accent, rotationY = 0) => {
      const mesh = game.makeWorldLabel?.(label, accent);
      if (!mesh) return;
      mesh.position.set(x, y, z);
      mesh.rotation.y = rotationY;
      mesh.scale.set(width, width / 4.8, 1);
      mesh.layers.set(MAP_LAYER);
      root.add(mesh);
    };

    const building = (root, x, z, width, depth, height, label, accent) => {
      const wall = materials.concrete;
      const halfDoor = 2.7;
      box(root, x - width / 2, height / 2, z, 0.55, height, depth, wall, true, true);
      box(root, x + width / 2, height / 2, z, 0.55, height, depth, wall, true, true);
      box(root, x, height / 2, z - depth / 2, width, height, 0.55, wall, true, true);
      box(root, x - (width / 4 + halfDoor / 2), height / 2, z + depth / 2, width / 2 - halfDoor, height, 0.55, wall, true, true);
      box(root, x + (width / 4 + halfDoor / 2), height / 2, z + depth / 2, width / 2 - halfDoor, height, 0.55, wall, true, true);
      box(root, x, height, z, width + 0.6, 0.38, depth + 0.6, materials.darkSteel, true, false);
      box(root, x, 2.5, z - depth / 2 - 0.02, width * 0.46, 1.7, 0.08, materials.glass, false, false);
      sign(root, label, x, height - 1.05, z + depth / 2 + 0.31, Math.min(12, width * 0.65), accent);
    };

    const addContainers = (root, placements) => {
      const colors = [materials.red, materials.blue, materials.green, materials.safety];
      for (const [index, placement] of placements.entries()) {
        const [x, z, rotation = 0, stacked = false] = placement;
        const container = box(root, x, 1.3, z, 6.4, 2.6, 2.5, colors[index % colors.length], true, index % 4 === 0);
        container.rotation.y = rotation;
        if (stacked) {
          const upper = box(root, x, 3.95, z, 6.4, 2.6, 2.5, colors[(index + 1) % colors.length], false, false);
          upper.rotation.y = rotation;
        }
      }
    };

    const buildShipyard = () => {
      const root = roots.shipyard;
      box(root, -260, -0.55, 0, 180, 1.1, 250, materials.asphalt, true, false);
      box(root, -260, 0.018, 79, 166, 0.035, 23, materials.darkConcrete, false, false);
      box(root, -260, 0.02, -18, 19, 0.04, 176, materials.darkConcrete, false, false);
      box(root, -260, 0.035, 23, 30, 0.07, 92, materials.water, false, false);
      box(root, -276, 0.65, 23, 1.0, 1.3, 94, materials.concrete, true, false);
      box(root, -244, 0.65, 23, 1.0, 1.3, 94, materials.concrete, true, false);
      building(root, -245, -67, 48, 34, 8.2, 'B-07 舰船维修厅', '#e1b83f');
      building(root, -311, -42, 27, 24, 6.3, '动力工段', '#80c5b0');
      building(root, -194, -34, 24, 30, 6.8, '港务控制室', '#80c5b0');
      box(root, -330, 2.3, 112, 18, 4.6, 0.6, materials.darkSteel, true, true);
      sign(root, '深潮船坞 / 04', -330, 3.2, 111.65, 13, '#dfb43a', Math.PI);
      addContainers(root, [
        [-322, 63, 0, true], [-314, 63, 0, false], [-306, 63, 0, true],
        [-207, 66, 0, true], [-199, 66, 0, false], [-191, 66, 0, true],
        [-321, 12, Math.PI / 2, false], [-321, 21, Math.PI / 2, true],
        [-199, 14, Math.PI / 2, true], [-199, 23, Math.PI / 2, false],
        [-294, -3, 0, false], [-285, -3, 0, true], [-227, -8, 0, false], [-217, -8, 0, true],
      ]);
      for (const x of [-326, -300, -220, -194]) {
        cylinder(root, x, 3.4, 42, 0.13, 6.8, materials.darkSteel, 10, false);
        box(root, x + 0.35, 6.55, 42, 0.9, 0.18, 0.36, materials.safety, false, false);
      }
      for (const x of [-296, -278, -242, -224]) {
        box(root, x, 0.18, 94, 7.5, 0.36, 0.24, materials.safety, false, false);
      }
    };

    const buildHighlands = () => {
      const root = roots.highlands;
      box(root, 705, -0.62, 0, 205, 1.24, 260, materials.rock, true, false);
      box(root, 704, 0.015, 76, 184, 0.03, 18, materials.darkConcrete, false, false);
      box(root, 704, 0.018, 15, 20, 0.036, 118, materials.darkConcrete, false, false);
      box(root, 742, 0.02, -45, 96, 0.04, 18, materials.darkConcrete, false, false);

      const mountainSpots = [
        [608, -104, 25, 20, 28], [625, -112, 20, 16, 22], [661, -118, 28, 22, 30],
        [714, -120, 27, 24, 31], [765, -116, 29, 22, 28], [803, -102, 24, 20, 26],
        [607, -22, 18, 14, 22], [803, -18, 20, 16, 24], [611, 63, 17, 13, 20], [802, 72, 18, 15, 22],
      ];
      for (const [x, z, width, height, depth] of mountainSpots) {
        const mountain = new Mesh(new DodecahedronGeometry(1, 1), materials.rock);
        mountain.position.set(x, height * 0.34 - 1, z);
        mountain.scale.set(width, height, depth);
        mountain.rotation.set(0.08, (x + z) * 0.012, -0.04);
        mountain.receiveShadow = true;
        mountain.layers.set(MAP_LAYER);
        root.add(mountain);
        game.blockers?.push(mountain);
        addCollider(x, height * 0.27, z, width * 1.35, height * 0.72, depth * 1.3);
      }

      building(root, 682, 45, 30, 25, 6.8, '霜岭通信前哨', '#9bd7cd');
      building(root, 757, 25, 24, 21, 5.8, '边境保障站', '#d9bc55');
      cylinder(root, 682, 9.2, 45, 5.2, 0.42, materials.steel, 28, false).rotation.x = Math.PI / 2;
      cylinder(root, 682, 7.1, 45, 0.18, 7.2, materials.darkSteel, 10, false);

      box(root, 735, 3.0, -82, 33, 6, 0.65, materials.concrete, true, true);
      box(root, 718.8, 3.0, -65, 0.65, 6, 34, materials.concrete, true, true);
      box(root, 751.2, 3.0, -65, 0.65, 6, 34, materials.concrete, true, true);
      box(root, 735, 6.0, -65, 33, 0.45, 34, materials.darkSteel, true, false);
      box(root, 723, 3.0, -48, 8, 6, 0.65, materials.concrete, true, true);
      box(root, 747, 3.0, -48, 8, 6, 0.65, materials.concrete, true, true);
      sign(root, '山体通信站', 735, 5.1, -47.63, 13, '#e5c454');

      const pineGeometry = ConeGeometry === CylinderGeometry
        ? new CylinderGeometry(0, 1.6, 5.4, 8)
        : new ConeGeometry(1.6, 5.4, 8);
      const pinePositions = [
        [625, 68], [642, 55], [652, 112], [674, 119], [708, 110], [736, 116], [769, 108],
        [790, 85], [619, 5], [640, -5], [780, -8], [795, 18], [661, -67], [687, -82], [786, -74],
      ];
      for (const [x, z] of pinePositions) {
        cylinder(root, x, 1.15, z, 0.18, 2.3, materials.trunk, 8, false);
        const crown = new Mesh(pineGeometry, materials.pine);
        crown.position.set(x, 4.25, z);
        crown.layers.set(MAP_LAYER);
        root.add(crown);
      }
      sign(root, '霜岭前哨 / 北境 12', 620, 3.2, 118, 14, '#9bd7cd', Math.PI);
    };

    buildingMapId = 'shipyard';
    buildShipyard();
    buildingMapId = 'highlands';
    buildHighlands();
    buildingMapId = null;

    let activeCustomMap = null;
    const harborLoot = (game.loot ?? []).filter((entry) => entry.operationId === 'harbor');
    const harborLootBackup = harborLoot.map((entry) => ({
      entry,
      x: entry.position.x,
      y: entry.position.y,
      z: entry.position.z,
      meshY: entry.mesh.position.y,
    }));

    const moveLoot = (definition) => {
      harborLoot.forEach((entry, index) => {
        const spot = definition.loot[index % definition.loot.length];
        const y = entry.position.y;
        entry.position.set(spot[0], y, spot[1]);
        entry.mesh.position.set(spot[0], entry.mesh.position.y, spot[1]);
      });
    };

    const restoreHarborLoot = () => {
      for (const backup of harborLootBackup) {
        backup.entry.position.set(backup.x, backup.y, backup.z);
        backup.entry.mesh.position.set(backup.x, backup.meshY, backup.z);
      }
    };

    const setMapVisibility = (mapId) => {
      for (const [id, root] of Object.entries(roots)) {
        const active = id === mapId;
        root.visible = active;
        for (const collider of mapColliders.get(id) ?? []) collider.setEnabled(active);
      }
    };
    // 安装脚本时默认仍在九号物流港，先关闭两张扩展地图的碰撞体。
    setMapVisibility(null);

    const updateCustomMenu = () => {
      if (!activeCustomMap) return;
      const definition = maps[activeCustomMap];
      const bossMode = document.querySelector('[data-boss-mode].is-selected')?.dataset.bossMode;
      const mode = document.querySelector('[data-game-mode].is-selected')?.dataset.gameMode;
      const noBoss = bossMode === 'none';
      const bossText = noBoss
        ? '回收任务物品'
        : bossMode === 'double'
          ? `击败${definition.bosses[0]}与${definition.bosses[1]}`
          : `击败区域首领${definition.bosses[1]}`;
      const copy = mode === 'extraction'
        ? `${bossText}，${definition.objectiveCopy}`
        : mode === 'training'
          ? '进入训练区测试武器，不消耗装备、弹药和金币。'
          : `${definition.objectiveCopy} 本局规则按当前行动模式生效。`;
      const setText = (id, value) => {
        const element = document.querySelector(`#${id}`);
        if (element) element.textContent = value;
      };
      setText('mission-title', definition.title);
      setText('mission-region', definition.name);
      setText('mission-copy', copy);
    };

    const originalFocusSun = game.focusSunOnOperation;
    if (typeof originalFocusSun === 'function') {
      game.focusSunOnOperation = function (...args) {
        const result = originalFocusSun.apply(this, args);
        if (!activeCustomMap) {
          setMapVisibility(null);
          return result;
        }
        const definition = maps[activeCustomMap];
        setMapVisibility(activeCustomMap);
        this.sun.position.set(definition.center.x - 52, 82, definition.center.z + 48);
        this.sunTarget.position.set(definition.center.x, 0, definition.center.z);
        this.sunTarget.updateMatrixWorld();
        this.sun.shadow.camera.left = -definition.center.range;
        this.sun.shadow.camera.right = definition.center.range;
        this.sun.shadow.camera.top = definition.center.range;
        this.sun.shadow.camera.bottom = -definition.center.range;
        this.sun.shadow.camera.updateProjectionMatrix();
        this.renderer.shadowMap.needsUpdate = true;
        return result;
      };
    }

    const originalStartRun = game.startRun;
    game.startRun = function (map, difficulty, loadout, bossMode, gameMode) {
      if (!activeCustomMap) {
        restoreHarborLoot();
        setMapVisibility(null);
        return originalStartRun.call(this, map, difficulty, loadout, bossMode, gameMode);
      }

      const definition = maps[activeCustomMap];
      const originalReset = this.resetDynamicWorld;
      this.resetDynamicWorld = function (...args) {
        this.activeOperation = {
          ...this.activeOperation,
          id: 'harbor',
          name: definition.name,
          objectiveText: definition.objectiveText,
          spawn: { ...definition.spawn },
          objective: { ...definition.objective },
          extraction: { ...definition.extraction },
          enemies: definition.enemies.map((entry) => [...entry]),
          loot: definition.loot.map(([x, z], index) => [x, z, index % 5 === 0 ? 'military' : index % 7 === 0 ? 'safe' : 'case']),
        };
        this.yaw = definition.yaw;
        const result = originalReset.apply(this, args);
        moveLoot(definition);
        const bossEnemies = (this.enemies ?? []).filter((enemy) => enemy.boss);
        bossEnemies.forEach((enemy, index) => {
          enemy.name = definition.bosses[Math.min(definition.bosses.length - 1, index + (bossEnemies.length === 1 ? 1 : 0))];
        });
        const focusedBoss = bossEnemies.find((enemy) => enemy.alive);
        if (focusedBoss) {
          this.callbacks?.onBossUpdate?.({
            name: focusedBoss.name,
            health: focusedBoss.health,
            maxHealth: focusedBoss.maxHealth,
            enraged: focusedBoss.enraged,
          });
        }
        return result;
      };
      try {
        const result = originalStartRun.call(this, 'harbor', difficulty, loadout, bossMode, gameMode);
        setMapVisibility(activeCustomMap);
        const deployingRegion = document.querySelector('#deploying-region');
        if (deployingRegion) deployingRegion.textContent = `K-17 / ${definition.name}`;
        this.callbacks?.onMiniMap?.(this.createMiniMapView());
        return result;
      } finally {
        this.resetDynamicWorld = originalReset;
      }
    };

    for (const [id, definition] of Object.entries(maps)) {
      if (mapOptions.querySelector(`[data-map="${id}"]`)) continue;
      const button = document.createElement('button');
      button.className = 'option-chip option-chip-large';
      button.type = 'button';
      button.dataset.map = id;
      button.textContent = definition.name;
      mapOptions.append(button);
    }

    mapOptions.addEventListener('click', (event) => {
      const target = event.target.closest?.('[data-map]');
      const mapId = target?.dataset?.map;
      if (!CUSTOM_IDS.has(mapId)) {
        activeCustomMap = null;
        setMapVisibility(null);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      activeCustomMap = mapId;
      for (const button of mapOptions.querySelectorAll('button')) {
        button.classList.toggle('is-selected', button === target);
      }
      setMapVisibility(mapId);
      updateCustomMenu();
    }, true);

    for (const selector of ['#difficulty-options', '#boss-mode-options', '#game-mode-options']) {
      document.querySelector(selector)?.addEventListener('click', () => {
        if (activeCustomMap) window.setTimeout(updateCustomMenu, 0);
      });
    }

    window.__criticalExtraction.extendedMaps = {
      maps,
      roots,
      get activeMap() { return activeCustomMap; },
      select(mapId) { mapOptions.querySelector(`[data-map="${mapId}"]`)?.click(); },
    };
  };

  // The main game module keeps the document in "loading" while its WebGL setup runs.
  // Start retrying immediately instead of waiting for DOMContentLoaded indefinitely.
  install();
})();
