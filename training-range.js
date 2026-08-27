(() => {
  const setup = () => {
    const menu = document.querySelector('#menu-screen');
    if (!menu || document.querySelector('#training-button')) return;
    const host = menu.querySelector('.actions') || menu;
    const button = document.createElement('button');
    button.id = 'training-button';
    button.className = 'button';
    button.type = 'button';
    button.textContent = '进入靶场';
    host.append(button);

    const style = document.createElement('style');
    style.textContent = `
      #training-range { position: fixed; inset: 0; z-index: 120; display: none; background: #151b18; color: #edf5ec; font-family: system-ui, sans-serif; }
      #training-range.open { display: block; }
      #training-range canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: none; }
      .training-hud { position: absolute; inset: 0; pointer-events: none; text-shadow: 0 1px 3px #000; }
      .training-title { position: absolute; top: 22px; left: 28px; border-left: 3px solid #d3e468; padding-left: 12px; }
      .training-title b { display: block; font-size: 18px; letter-spacing: .08em; }
      .training-title span { display: block; margin-top: 5px; color: #b8c7ba; font-size: 12px; }
      .training-score { position: absolute; top: 22px; right: 28px; text-align: right; line-height: 1.8; font-size: 13px; }
      .training-score b { color: #f2dc82; font-size: 20px; }
      .training-help { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); width: min(640px, calc(100% - 36px)); padding: 10px 14px; border: 1px solid #dcefd044; background: #08100abd; text-align: center; color: #c8d3c7; font-size: 12px; }
      .training-crosshair { position: absolute; top: 50%; left: 50%; width: 34px; height: 34px; transform: translate(-50%, -50%); }
      .training-crosshair::before, .training-crosshair::after { content: ''; position: absolute; background: #f2f7ed; box-shadow: 0 0 3px #000; }
      .training-crosshair::before { left: 16px; top: 0; width: 2px; height: 34px; }
      .training-crosshair::after { left: 0; top: 16px; width: 34px; height: 2px; }
      .training-msg { position: absolute; top: 20%; left: 50%; transform: translateX(-50%); padding: 9px 14px; border-left: 3px solid #d3e468; background: #08100acf; opacity: 0; transition: opacity .12s; }
      .training-msg.show { opacity: 1; }
      .training-exit { position: absolute; right: 26px; bottom: 68px; pointer-events: auto; min-height: 36px; padding: 0 14px; border: 1px solid #dcefd04d; border-radius: 3px; color: #e9f1e7; background: #0c120ecc; cursor: pointer; }
    `;
    document.head.append(style);
    const range = document.createElement('section');
    range.id = 'training-range';
    range.innerHTML = '<canvas id="training-canvas" tabindex="0"></canvas><div class="training-hud"><div class="training-title"><b>战备靶场</b><span>武器校准 / 实弹训练</span></div><div class="training-score">命中 <b id="tr-hits">0</b>　射击 <b id="tr-shots">0</b><br>命中率 <b id="tr-acc">0%</b>　弹药 ∞</div><div class="training-crosshair"></div><div id="tr-msg" class="training-msg">点击画布锁定视角</div><div class="training-help">WASD 移动　·　鼠标瞄准　·　左键射击　·　固定靶与移动靶命中后自动复位　·　Esc 返回行动菜单</div><button id="tr-exit" class="training-exit" type="button">退出靶场</button></div>';
    document.body.append(range);
    const canvas = range.querySelector('#training-canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const get = (id) => range.querySelector(id);
    const targets = [
      { x: -4, z: 18, y: 1.3, label: '固定靶' },
      { x: 4, z: 22, y: 1.3, label: '移动靶', move: true, phase: .5 },
      { x: -7, z: 35, y: 1.6, label: '固定靶' },
      { x: 7, z: 43, y: 1.6, label: '移动靶', move: true, phase: 2.3 },
      { x: 0, z: 60, y: 2, label: '远距靶' },
    ];
    const keys = new Set();
    const state = { open: false, yaw: 0, pitch: 0, x: 0, z: 0, shots: 0, hits: 0, last: 0, timer: 0 };
    const updateStats = () => {
      get('#tr-hits').textContent = String(state.hits);
      get('#tr-shots').textContent = String(state.shots);
      get('#tr-acc').textContent = `${state.shots ? Math.round(state.hits / state.shots * 100) : 0}%`;
    };
    const message = (text) => {
      const node = get('#tr-msg');
      node.textContent = text;
      node.classList.add('show');
      clearTimeout(state.timer);
      state.timer = window.setTimeout(() => node.classList.remove('show'), 1200);
    };
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const project = (target, now) => {
      const dx = target.x + (target.move ? Math.sin(now * 1.2 + target.phase) * 4.6 : 0) - state.x;
      const dz = target.z - state.z;
      const cosine = Math.cos(state.yaw);
      const sine = Math.sin(state.yaw);
      const side = dx * cosine - dz * sine;
      const depth = dx * sine + dz * cosine;
      if (depth < 2) return null;
      const focal = Math.min(window.innerWidth, window.innerHeight) * .92;
      const scale = focal / depth;
      return { x: window.innerWidth / 2 + side * scale, y: window.innerHeight * .52 - (target.y - state.pitch * 2.2) * scale, radius: Math.max(8, .72 * scale), depth };
    };
    const shoot = () => {
      if (!state.open) return;
      state.shots += 1;
      const now = performance.now() / 1000;
      let chosen = null;
      for (const target of targets) {
        if (target.reset > now) continue;
        const point = project(target, now);
        if (!point) continue;
        const distance = Math.hypot(point.x - window.innerWidth / 2, point.y - window.innerHeight / 2);
        if (distance < Math.max(24, point.radius * .76) && (!chosen || point.depth < chosen.point.depth)) chosen = { target, point };
      }
      if (!chosen) message('未命中 · 调整准星');
      else { state.hits += 1; chosen.target.reset = now + .8; message(`${chosen.target.label}命中 · ${Math.round(chosen.point.depth)} 米`); }
      updateStats();
    };
    const drawTarget = (target, point, now) => {
      const { x, y, radius } = point;
      ctx.save();
      ctx.globalAlpha = target.reset > now ? .18 : 1;
      ctx.strokeStyle = '#536258'; ctx.lineWidth = Math.max(2, radius * .08);
      ctx.beginPath(); ctx.moveTo(x, y + radius * .65); ctx.lineTo(x, y + radius * 2.3); ctx.moveTo(x - radius * .75, y + radius * 2.3); ctx.lineTo(x + radius * .75, y + radius * 2.3); ctx.stroke();
      ctx.fillStyle = '#e4e4d6'; ctx.fillRect(x - radius * .6, y + radius * .65, radius * 1.2, radius * 1.25);
      ctx.fillStyle = '#283229'; ctx.beginPath(); ctx.arc(x, y, radius * .92, 0, Math.PI * 2); ctx.fill();
      for (const [ring, color] of [[.72, '#d2d9c4'], [.48, '#b24c40'], [.24, '#d8d9bf']]) { ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(x, y, radius * ring, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = '#d7e1d2'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${target.label} ${Math.round(point.depth)}m`, x, y + radius * 2.75);
      ctx.restore();
    };
    const draw = (now) => {
      const width = window.innerWidth; const height = window.innerHeight; const horizon = height * (.44 + state.pitch * .06);
      const sky = ctx.createLinearGradient(0, 0, 0, horizon); sky.addColorStop(0, '#172329'); sky.addColorStop(1, '#73817d'); ctx.fillStyle = sky; ctx.fillRect(0, 0, width, horizon); ctx.fillStyle = '#373f3a'; ctx.fillRect(0, horizon, width, height - horizon);
      ctx.strokeStyle = '#b5beab2b'; for (let i = 1; i < 13; i += 1) { const y = horizon + Math.min(height - horizon, 3000 / (i * i * 7)); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      for (const target of targets.slice().sort((a, b) => b.z - a.z)) { const point = project(target, now); if (point && point.x > -180 && point.x < width + 180) drawTarget(target, point, now); }
      ctx.fillStyle = '#0f1410b8'; ctx.fillRect(width / 2 - 76, height - 108, 152, 30); ctx.fillStyle = '#cbd6c4'; ctx.textAlign = 'center'; ctx.font = '12px system-ui'; ctx.fillText('无限弹药 · 自动复位', width / 2, height - 88);
    };
    const loop = (time) => {
      if (!state.open) return;
      const now = time / 1000; const delta = Math.min(.05, state.last ? now - state.last : 0); state.last = now;
      const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0); const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0); const speed = keys.has('ShiftLeft') ? 12 : 7;
      state.x += (Math.cos(state.yaw) * strafe + Math.sin(state.yaw) * forward) * speed * delta; state.z += (-Math.sin(state.yaw) * strafe + Math.cos(state.yaw) * forward) * speed * delta; state.x = Math.max(-15, Math.min(15, state.x)); state.z = Math.max(-4, Math.min(8, state.z)); draw(now); requestAnimationFrame(loop);
    };
    const open = () => { state.open = true; state.yaw = 0; state.pitch = 0; state.x = 0; state.z = 0; state.shots = 0; state.hits = 0; state.last = 0; targets.forEach((target) => { target.reset = 0; }); updateStats(); menu.hidden = true; document.querySelector('#topbar')?.setAttribute('hidden', ''); document.querySelector('#hud')?.setAttribute('hidden', ''); range.classList.add('open'); resize(); canvas.focus(); message('点击画布锁定视角'); requestAnimationFrame(loop); };
    const close = () => { state.open = false; keys.clear(); range.classList.remove('open'); if (document.pointerLockElement === canvas) document.exitPointerLock(); menu.hidden = false; document.querySelector('#topbar')?.removeAttribute('hidden'); };
    button.addEventListener('click', open); get('#tr-exit').addEventListener('click', close); canvas.addEventListener('click', () => { if (document.pointerLockElement !== canvas) void canvas.requestPointerLock(); }); canvas.addEventListener('mousedown', (event) => { if (event.button === 0) shoot(); }); canvas.addEventListener('contextmenu', (event) => event.preventDefault()); window.addEventListener('resize', resize); window.addEventListener('keydown', (event) => { if (!state.open) return; if (event.code === 'Escape') { event.preventDefault(); close(); return; } keys.add(event.code); }); window.addEventListener('keyup', (event) => keys.delete(event.code)); window.addEventListener('mousemove', (event) => { if (!state.open || document.pointerLockElement !== canvas) return; state.yaw -= event.movementX * .0024; state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch - event.movementY * .0016)); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true }); else setup();
})();
