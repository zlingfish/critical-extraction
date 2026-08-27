/* Distinct first-person silhouettes for each weapon family. */
(function () {
  const boot = () => {
    const game = window.__criticalExtraction?.game;
    if (!game?.weapon || typeof game.applyWeaponVisual !== 'function') {
      window.setTimeout(boot, 120);
      return;
    }
    if (game.__weaponVariantsInstalled) return;
    game.__weaponVariantsInstalled = true;

    const weapon = game.weapon;
    const base = {
      receiver: game.weaponReceiver,
      barrel: game.weaponBarrel,
      magazine: game.weaponMagazine,
      suppressor: game.weaponSuppressor,
    };
    const extras = new Map();
    const clonePart = (source, name) => {
      const mesh = source?.clone?.();
      if (!mesh) return null;
      mesh.name = `weapon-variant-${name}`;
      if (mesh.material?.clone) mesh.material = mesh.material.clone();
      mesh.visible = false;
      weapon.add(mesh);
      extras.set(name, mesh);
      return mesh;
    };
    const parts = {
      smgTop: clonePart(base.receiver, 'smg-top'),
      smgStock: clonePart(base.receiver, 'smg-stock'),
      shotgunBarrel: clonePart(base.barrel, 'shotgun-barrel'),
      shotgunTube: clonePart(base.barrel, 'shotgun-tube'),
      asvalSuppressor: clonePart(base.suppressor, 'asval-suppressor'),
      awmBarrel: clonePart(base.barrel, 'awm-barrel'),
      awmScope: clonePart(base.receiver, 'awm-scope'),
      m7Rail: clonePart(base.receiver, 'm7-rail'),
    };

    const hideExtras = () => extras.forEach((part) => { part.visible = false; });
    const tint = (part, color) => {
      if (part?.material?.color) part.material.color.set(color);
    };
    const original = game.applyWeaponVisual.bind(game);
    game.applyWeaponVisual = function () {
      original();
      hideExtras();
      const id = this.activeWeaponId;
      const receiver = this.weaponReceiver;
      const barrel = this.weaponBarrel;
      const magazine = this.weaponMagazine;
      if (!receiver || !barrel) return;

      if (id === 'smg') {
        receiver.scale.set(0.78, 0.78, 0.62);
        receiver.position.set(0, -0.02, -0.2);
        magazine.scale.set(0.76, 1.05, 0.78);
        magazine.position.set(0, -0.19, -0.2);
        if (parts.smgTop) {
          parts.smgTop.visible = true;
          parts.smgTop.scale.set(0.62, 0.42, 0.38);
          parts.smgTop.position.set(0, 0.08, -0.33);
          tint(parts.smgTop, '#52645a');
        }
        if (parts.smgStock) {
          parts.smgStock.visible = true;
          parts.smgStock.scale.set(0.5, 0.7, 0.72);
          parts.smgStock.position.set(0, 0.01, 0.34);
          parts.smgStock.rotation.x = 0.1;
          tint(parts.smgStock, '#202721');
        }
      } else if (id === 'shotgun') {
        receiver.scale.set(1.18, 1.18, 1.25);
        magazine.scale.set(0.7, 0.72, 0.74);
        magazine.position.set(0, -0.18, -0.14);
        for (const [part, x, y, z, scale] of [[parts.shotgunBarrel, -0.045, 0.01, -1.11, 0.94], [parts.shotgunTube, 0.045, -0.005, -1.08, 0.82]]) {
          if (!part) continue;
          part.visible = true;
          part.position.set(x, y, z);
          part.scale.set(scale, 1, scale);
          tint(part, '#51483a');
        }
      } else if (id === 'asval') {
        receiver.scale.set(0.92, 0.92, 0.92);
        magazine.scale.set(0.84, 1.2, 0.84);
        magazine.position.set(0, -0.2, -0.2);
        if (parts.asvalSuppressor) {
          parts.asvalSuppressor.visible = true;
          parts.asvalSuppressor.scale.set(1.12, 1.35, 1.12);
          parts.asvalSuppressor.position.set(0, 0.01, -1.12);
          tint(parts.asvalSuppressor, '#161f1b');
        }
      } else if (id === 'awm') {
        receiver.scale.set(1.3, 1.15, 1.36);
        magazine.scale.set(0.68, 0.72, 0.68);
        magazine.position.set(0, -0.17, -0.06);
        if (parts.awmBarrel) {
          parts.awmBarrel.visible = true;
          parts.awmBarrel.scale.set(1.55, 1.8, 1.55);
          parts.awmBarrel.position.set(0, 0.01, -1.45);
          tint(parts.awmBarrel, '#66745e');
        }
        if (parts.awmScope) {
          parts.awmScope.visible = true;
          parts.awmScope.scale.set(0.52, 0.3, 1.18);
          parts.awmScope.position.set(0, 0.15, -0.54);
          tint(parts.awmScope, '#232b25');
        }
      } else if (id === 'm7') {
        receiver.scale.set(1.08, 1.08, 1.08);
        magazine.scale.set(1.08, 1.2, 1.08);
        if (parts.m7Rail) {
          parts.m7Rail.visible = true;
          parts.m7Rail.scale.set(0.72, 0.22, 1.65);
          parts.m7Rail.position.set(0, 0.095, -0.5);
          tint(parts.m7Rail, '#8b8067');
        }
      } else {
        receiver.scale.set(1, 1, 1);
        magazine.scale.set(1, 1, 1);
      }
    };
    game.applyWeaponVisual();
  };
  boot();
})();
