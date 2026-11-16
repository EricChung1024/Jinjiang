/* 首頁 3D 街景：路人在店門前來來往往，部分客人走進「金匠鍋貼」，稍後提著外帶袋走出來。
 * 使用 Three.js（assets/three.min.js）。不支援 WebGL 時整個區塊會隱藏。 */
(() => {
  const hero = document.getElementById('hero');
  const wrap = document.getElementById('street3d');
  const toggle = document.getElementById('crowd-toggle');
  if (!hero || !wrap || !toggle) return;

  const hide = () => { wrap.style.display = 'none'; toggle.style.display = 'none'; };
  if (!window.THREE) return hide();

  const T = window.THREE;
  if (T.ColorManagement) T.ColorManagement.legacyMode = false; // 讓顏色以正確的 sRGB 呈現，不會偏白
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (e) { return hide(); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.setClearColor(0x000000, 0);
  wrap.appendChild(renderer.domElement);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 2.4, 10);
  camera.lookAt(0, 1.05, 0);

  // ---------- 色票（取自網站品牌色） ----------
  const C = {
    wood900: 0x2b1d14, wood700: 0x54392a, wood500: 0x8a634b, wood300: 0xc39976,
    ember: 0xe8772e, emberDark: 0xcf5f17, cream: 0xfdfaf3, paving: 0xefe3cc, skin: 0xd5b08b,
  };
  const mat = (color, extra = {}) => new T.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

  // ---------- 燈光 ----------
  scene.add(new T.HemisphereLight(0xfff4e0, 0x8a634b, 0.85));
  const sun = new T.DirectionalLight(0xffe2b8, 0.9);
  sun.position.set(-4, 8, 6);
  scene.add(sun);

  // ---------- 地面（石板人行道，後方漸淡融入背景） ----------
  const GROUND_W = 80, GROUND_D = 8;
  const pave = document.createElement('canvas');
  pave.width = 4096; pave.height = 512;
  const pg = pave.getContext('2d');
  const tile = 4096 / GROUND_W; // 每公尺的像素
  pg.fillStyle = '#efe3cc'; pg.fillRect(0, 0, pave.width, pave.height);
  pg.strokeStyle = 'rgba(84,57,42,.14)'; pg.lineWidth = 2;
  for (let row = 0; row * tile < pave.height; row++) {
    const y = row * tile;
    pg.beginPath(); pg.moveTo(0, y); pg.lineTo(pave.width, y); pg.stroke();
    for (let x = (row % 2) * tile / 2; x < pave.width; x += tile) { pg.beginPath(); pg.moveTo(x, y); pg.lineTo(x, y + tile); pg.stroke(); }
  }
  // 上方（遠處）漸漸透明
  pg.globalCompositeOperation = 'destination-in';
  const fade = pg.createLinearGradient(0, 0, 0, pave.height);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.42, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  pg.fillStyle = fade; pg.fillRect(0, 0, pave.width, pave.height);
  const paveTex = new T.CanvasTexture(pave);
  paveTex.encoding = T.sRGBEncoding;
  paveTex.anisotropy = 4;
  const ground = new T.Mesh(new T.PlaneGeometry(GROUND_W, GROUND_D), new T.MeshStandardMaterial({ map: paveTex, transparent: true, roughness: 1, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -0.6;
  ground.renderOrder = -1;
  scene.add(ground);
  const curb = new T.Mesh(new T.BoxGeometry(120, 0.12, 0.25), mat(0xd9c6a5));
  curb.position.set(0, 0.06, 3);
  scene.add(curb);

  // ---------- 店面 ----------
  const store = new T.Group();
  scene.add(store);
  const FACADE_Z = -1.6;

  const wall = new T.Mesh(new T.BoxGeometry(5.4, 3.6, 0.4), mat(C.wood700));
  wall.position.set(0, 1.8, FACADE_Z - 0.2);
  store.add(wall);
  const baseBoard = new T.Mesh(new T.BoxGeometry(5.5, 0.35, 0.5), mat(C.wood900));
  baseBoard.position.set(0, 0.175, FACADE_Z - 0.15);
  store.add(baseBoard);

  // 門口：溫暖的室內光
  const warm = new T.MeshBasicMaterial({ color: 0xffc67a });
  const door = new T.Mesh(new T.PlaneGeometry(1.15, 2.15), warm);
  door.position.set(0, 1.075, FACADE_Z + 0.045);
  store.add(door);
  const doorFrame = new T.Mesh(new T.BoxGeometry(1.4, 2.35, 0.1), mat(C.wood900));
  doorFrame.position.set(0, 1.175, FACADE_Z - 0.02);
  store.add(doorFrame);

  // 兩側窗戶，窗內有蒸籠與師傅剪影
  [-1.75, 1.75].forEach((x) => {
    const frame = new T.Mesh(new T.BoxGeometry(1.5, 1.25, 0.1), mat(C.wood900));
    frame.position.set(x, 1.45, FACADE_Z - 0.02);
    store.add(frame);
    const glass = new T.Mesh(new T.PlaneGeometry(1.3, 1.05), new T.MeshBasicMaterial({ color: 0xffd79a }));
    glass.position.set(x, 1.45, FACADE_Z + 0.045);
    store.add(glass);
    const sill = new T.Mesh(new T.BoxGeometry(1.6, 0.08, 0.3), mat(C.wood500));
    sill.position.set(x, 0.82, FACADE_Z + 0.08);
    store.add(sill);
  });
  const steamers = [];
  [-2.05, -1.55].forEach((x, i) => {
    for (let k = 0; k < 2 + i; k++) {
      const s = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.12, 20), mat(0xb98a5a));
      s.position.set(x, 0.98 + k * 0.13, FACADE_Z + 0.08);
      store.add(s);
    }
    steamers.push(x);
  });
  const chef = new T.Group();
  const chefBody = new T.Mesh(new T.CapsuleGeometry(0.18, 0.3, 4, 10), new T.MeshBasicMaterial({ color: 0x9a6a45 }));
  chefBody.position.y = 1.15;
  const chefHat = new T.Mesh(new T.CylinderGeometry(0.13, 0.11, 0.18, 14), new T.MeshBasicMaterial({ color: 0xfffaf0 }));
  chefHat.position.y = 1.68;
  const chefHead = new T.Mesh(new T.SphereGeometry(0.13, 14, 10), new T.MeshBasicMaterial({ color: 0xb5835a }));
  chefHead.position.y = 1.5;
  chef.add(chefBody, chefHead, chefHat);
  chef.position.set(1.75, 0, FACADE_Z + 0.06);
  chef.scale.set(1, 1, 0.2);
  store.add(chef);

  // 遮雨棚（橘白條紋）
  const awn = document.createElement('canvas');
  awn.width = 256; awn.height = 16;
  const ag = awn.getContext('2d');
  for (let i = 0; i < 16; i++) { ag.fillStyle = i % 2 ? '#fdfaf3' : '#e8772e'; ag.fillRect(i * 16, 0, 16, 16); }
  const awnTex = new T.CanvasTexture(awn);
  awnTex.encoding = T.sRGBEncoding;
  const awning = new T.Mesh(new T.BoxGeometry(5.6, 0.06, 1.1), [
    mat(C.ember), mat(C.ember), mat(0xffffff, { map: awnTex }), mat(C.emberDark), mat(C.ember), mat(C.ember),
  ]);
  awning.position.set(0, 2.62, FACADE_Z + 0.45);
  awning.rotation.x = 0.28;
  store.add(awning);
  const valance = new T.Mesh(new T.BoxGeometry(5.6, 0.18, 0.04), mat(0xffffff, { map: awnTex }));
  valance.position.set(0, 2.42, FACADE_Z + 1.0);
  store.add(valance);

  // 招牌
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 1024; signCanvas.height = 192;
  const signTex = new T.CanvasTexture(signCanvas);
  signTex.encoding = T.sRGBEncoding;
  signTex.anisotropy = 4;
  const drawSign = () => {
    const g = signCanvas.getContext('2d');
    g.fillStyle = '#2b1d14'; g.fillRect(0, 0, 1024, 192);
    g.strokeStyle = '#c39976'; g.lineWidth = 10; g.strokeRect(14, 14, 996, 164);
    g.fillStyle = '#fdfaf3';
    g.font = '900 112px "Noto Serif TC", "PMingLiU", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('金匠鍋貼', 512, 92);
    signTex.needsUpdate = true;
  };
  drawSign();
  if (document.fonts && document.fonts.load) document.fonts.load('900 112px "Noto Serif TC"', '金匠鍋貼').then(drawSign).catch(() => {});
  const sign = new T.Mesh(new T.PlaneGeometry(2.8, 0.525), new T.MeshBasicMaterial({ map: signTex }));
  sign.position.set(0, 3.1, FACADE_Z + 0.02);
  store.add(sign);

  // 紅燈籠
  const lanterns = [];
  [-2.55, 2.55].forEach((x) => {
    const g = new T.Group();
    const cord = new T.Mesh(new T.CylinderGeometry(0.01, 0.01, 0.3, 4), mat(C.wood900));
    cord.position.y = -0.15;
    const body = new T.Mesh(new T.SphereGeometry(0.22, 18, 12), new T.MeshStandardMaterial({ color: 0xd8382a, emissive: 0x7a1408, roughness: 0.6 }));
    body.scale.y = 1.15; body.position.y = -0.52;
    const tassel = new T.Mesh(new T.CylinderGeometry(0.03, 0.05, 0.18, 6), mat(0xe7b23a));
    tassel.position.y = -0.86;
    g.add(cord, body, tassel);
    g.position.set(x, 2.55, FACADE_Z + 0.9);
    store.add(g);
    lanterns.push(g);
  });

  // 蒸氣
  const steamMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  const steamPuffs = Array.from({ length: 6 }, (_, i) => {
    const m = new T.Mesh(new T.SphereGeometry(0.09, 10, 8), steamMat.clone());
    m.userData.t = i / 6;
    store.add(m);
    return m;
  });

  // ---------- 街道小物：路燈、盆栽 ----------
  const props = new T.Group();
  scene.add(props);
  const makeLamp = () => {
    const g = new T.Group();
    const pole = new T.Mesh(new T.CylinderGeometry(0.05, 0.07, 2.8, 10), mat(C.wood900));
    pole.position.y = 1.4;
    const head = new T.Mesh(new T.SphereGeometry(0.16, 14, 10), new T.MeshBasicMaterial({ color: 0xffe2a8 }));
    head.position.y = 2.85;
    g.add(pole, head);
    return g;
  };
  const makePlant = () => {
    const g = new T.Group();
    const pot = new T.Mesh(new T.CylinderGeometry(0.22, 0.17, 0.35, 14), mat(C.wood500));
    pot.position.y = 0.175;
    const bush = new T.Mesh(new T.IcosahedronGeometry(0.33, 1), mat(0x6f8a4a, { flatShading: true }));
    bush.position.y = 0.55;
    g.add(pot, bush);
    return g;
  };
  const lampA = makeLamp(), lampB = makeLamp(), plantA = makePlant(), plantB = makePlant();
  props.add(lampA, lampB, plantA, plantB);

  // ---------- 路人 ----------
  const SHIRTS = [0xe8772e, 0xcf5f17, 0x6b4a36, 0x3b2a1e, 0x8a634b, 0x5f7a8c, 0xa84a10, 0x7b8f5a, 0xc9a26b, 0x9c5b70];
  const PANTS = [0x2b1d14, 0x3b3f4a, 0x54392a, 0x4a5568, 0x1f2933];
  const HAIR = [0x2b1d14, 0x1a1210, 0x54392a, 0x8a634b, 0x777777];
  const SKIN = [0xe0bb94, 0xd5b08b, 0xc39976, 0xa9784f];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rand = (a, b) => a + Math.random() * (b - a);

  const geo = {
    torso: new T.CapsuleGeometry(0.2, 0.42, 4, 12),
    head: new T.SphereGeometry(0.17, 18, 14),
    hair: new T.SphereGeometry(0.18, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    leg: new T.CapsuleGeometry(0.08, 0.68, 3, 8),
    arm: new T.CapsuleGeometry(0.055, 0.42, 3, 8),
    bag: new T.BoxGeometry(0.2, 0.24, 0.1),
    shadow: new T.CircleGeometry(0.32, 20),
    hatBrim: new T.CylinderGeometry(0.27, 0.27, 0.025, 20),
    hatCrown: new T.CylinderGeometry(0.15, 0.17, 0.15, 18),
    hatBand: new T.CylinderGeometry(0.172, 0.172, 0.035, 18),
  };
  const shadowMat = new T.MeshBasicMaterial({ color: 0x54392a, transparent: true, opacity: 0.18, depthWrite: false });

  const makePerson = () => {
    const shirt = mat(pick(SHIRTS)), pants = mat(pick(PANTS)), skin = mat(pick(SKIN)), hair = mat(pick(HAIR));
    const bagMat = mat(C.ember);
    const hatMat = mat(0x111111), bandMat = mat(0x2a2a2a);
    const mats = [shirt, pants, skin, hair, bagMat, hatMat, bandMat];
    const root = new T.Group();
    const body = new T.Group();
    root.add(body);

    const torso = new T.Mesh(geo.torso, shirt); torso.position.y = 1.2; body.add(torso);
    const head = new T.Mesh(geo.head, skin); head.position.y = 1.67; body.add(head);
    const hairM = new T.Mesh(geo.hair, hair); hairM.position.set(0, 1.7, -0.01); hairM.rotation.x = -0.25; body.add(hairM);

    // 每個人都戴黑帽子（黑色禮帽：帽簷＋帽冠＋帽帶）
    const hat = new T.Group(); hat.position.set(0, 1.8, 0); hat.rotation.x = -0.08;
    const brim = new T.Mesh(geo.hatBrim, hatMat);
    const crown = new T.Mesh(geo.hatCrown, hatMat); crown.position.y = 0.085;
    const band = new T.Mesh(geo.hatBand, bandMat); band.position.y = 0.04;
    hat.add(brim, crown, band); body.add(hat);

    // 手腳以關節為軸心擺動；half 為肢體中心到關節的距離
    const limb = (g, m, x, y, half) => {
      const pivot = new T.Group(); pivot.position.set(x, y, 0);
      const mesh = new T.Mesh(g, m); mesh.position.y = -half;
      pivot.add(mesh); body.add(pivot);
      return pivot;
    };
    const legL = limb(geo.leg, pants, -0.1, 0.84, 0.42), legR = limb(geo.leg, pants, 0.1, 0.84, 0.42);
    const armL = limb(geo.arm, shirt, -0.27, 1.45, 0.27), armR = limb(geo.arm, shirt, 0.27, 1.45, 0.27);
    const bag = new T.Mesh(geo.bag, bagMat); bag.position.set(0, -0.6, 0.02); bag.visible = false;
    armR.add(bag);

    const shadow = new T.Mesh(geo.shadow, shadowMat.clone());
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01;
    root.add(shadow);

    const s = rand(0.88, 1.08);
    root.scale.set(s, s, s);
    scene.add(root);
    return { root, body, legL, legR, armL, armR, bag, shadow, mats, phase: rand(0, 6.28) };
  };

  // ---------- 版面配置（依畫面寬度擺放店面） ----------
  let halfW = 10, doorX = 4;
  const layout = () => {
    const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const dist = camera.position.z;
    halfW = Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * dist * camera.aspect;
    doorX = Math.min(halfW * 0.5, halfW - 3.2);
    store.position.x = doorX;
    lampA.position.set(doorX - 4.2, 0, -0.9);
    lampB.position.set(doorX + 4.2, 0, -0.9);
    plantA.position.set(doorX - 3.3, 0, -1.25);
    plantB.position.set(doorX + 3.3, 0, -1.25);
    plantB.visible = doorX + 3.3 < halfW + 1;
    lampB.visible = doorX + 4.2 < halfW + 1;
  };

  const LANES = [0.15, 0.95, 1.75];
  const people = [];

  const setOpacity = (p, o) => {
    const t = o < 1;
    p.mats.forEach((m) => { if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; } m.opacity = o; });
    p.shadow.material.opacity = 0.18 * o;
  };

  const resetWalker = (p, fromEdge) => {
    p.dir = Math.random() < 0.5 ? 1 : -1;
    p.z = pick(LANES) + rand(-0.15, 0.15);
    p.speed = rand(0.9, 1.45);
    p.state = 'walk';
    p.wantsIn = Math.random() < 0.4;
    p.bag.visible = false;
    p.x = fromEdge ? -p.dir * (halfW + rand(1, 4)) : rand(-halfW, halfW);
    // 已經走過店門的人就不再進店
    if ((p.x - doorX) * p.dir > 0) p.wantsIn = false;
    setOpacity(p, 1);
    p.root.visible = true;
  };

  const faceTo = (p, dx, dz, dt) => {
    const target = Math.atan2(dx, dz) + Math.PI; // 倒著走：面朝行進方向的反方向
    let diff = target - p.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    p.root.rotation.y += diff * Math.min(1, dt * 8);
  };

  const moveTo = (p, tx, tz, dt) => {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    const step = p.speed * dt;
    faceTo(p, dx, dz, dt);
    if (d <= step) { p.x = tx; p.z = tz; return true; }
    p.x += (dx / d) * step; p.z += (dz / d) * step;
    return false;
  };

  const DOOR_Z = FACADE_Z + 0.15;

  const stepPerson = (p, dt) => {
    let moving = true;
    switch (p.state) {
      case 'walk': {
        const nx = p.x + p.dir * p.speed * dt;
        if (p.wantsIn && (p.x - doorX) * (nx - doorX) <= 0) { p.state = 'toDoor'; break; }
        p.x = nx;
        faceTo(p, p.dir, 0, dt);
        if (p.x * p.dir > halfW + 4) resetWalker(p, true);
        break;
      }
      case 'toDoor':
        if (moveTo(p, doorX + rand(-0.05, 0.05), DOOR_Z + 0.35, dt)) { p.state = 'entering'; p.t = 0; }
        break;
      case 'entering':
        p.t += dt;
        moveTo(p, doorX, DOOR_Z - 0.4, dt * 0.6);
        setOpacity(p, Math.max(0, 1 - p.t / 0.6));
        if (p.t >= 0.6) { p.state = 'inside'; p.t = rand(3, 7); p.root.visible = false; }
        break;
      case 'inside':
        moving = false;
        p.t -= dt;
        if (p.t <= 0) {
          p.state = 'exiting'; p.t = 0; p.root.visible = true; p.bag.visible = true;
          p.x = doorX; p.z = DOOR_Z - 0.2; p.root.rotation.y = 0;
          p.dir = Math.random() < 0.5 ? 1 : -1;
          p.exitLane = pick(LANES);
        }
        break;
      case 'exiting':
        p.t += dt;
        setOpacity(p, Math.min(1, p.t / 0.5));
        if (moveTo(p, doorX + p.dir * 0.6, p.exitLane, dt)) { setOpacity(p, 1); p.state = 'walk'; p.wantsIn = false; p.z = p.exitLane; }
        break;
    }

    if (!p.root.visible) return;
    if (moving) p.phase += dt * p.speed * 6.2;
    // 倒著走：臉朝行進方向的反方向，腳步反向邁出（與正常走路的擺動相反），並保留輕微上下起伏
    const sw = -Math.sin(p.phase), a = moving ? 1 : 0;
    p.legL.rotation.x = sw * 0.5 * a;
    p.legR.rotation.x = -sw * 0.5 * a;
    p.legL.position.y = 0.84;
    p.legR.position.y = 0.84;
    p.armL.rotation.x = -sw * 0.4 * a;
    p.armR.rotation.x = p.bag.visible ? sw * 0.12 * a : sw * 0.4 * a;
    p.body.rotation.x = -0.05 * a;
    p.body.position.y = Math.abs(Math.cos(p.phase)) * 0.04 * a;
    p.root.position.set(p.x, 0, p.z);
  };

  // ---------- 動畫迴圈 ----------
  const clock = new T.Clock();
  let elapsed = 0;
  const animateScene = (dt) => {
    elapsed += dt;
    people.forEach((p) => stepPerson(p, dt));
    lanterns.forEach((l, i) => { l.rotation.z = Math.sin(elapsed * 1.3 + i * 1.7) * 0.06; });
    chef.position.x = 1.75 + Math.sin(elapsed * 0.7) * 0.25;
    steamPuffs.forEach((m, i) => {
      const t = (m.userData.t + elapsed * 0.35) % 1;
      const x = steamers[i % steamers.length];
      m.position.set(x + Math.sin(t * 6 + i) * 0.05, 1.2 + t * 0.7, FACADE_Z + 0.12);
      m.scale.setScalar(0.6 + t * 1.4);
      m.material.opacity = 0.45 * (1 - t);
    });
  };

  const populate = () => {
    const want = Math.max(5, Math.min(16, Math.round(halfW * 0.75)));
    while (people.length < want) { const p = makePerson(); resetWalker(p, false); people.push(p); }
    while (people.length > want) { const p = people.pop(); scene.remove(p.root); }
  };

  layout();
  populate();
  animateScene(0);
  renderer.render(scene, camera);

  // ---------- 播放控制（尊重「減少動態效果」設定，並在看不到時暫停） ----------
  let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = true, raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    animateScene(Math.min(clock.getDelta(), 0.05));
    renderer.render(scene, camera);
  };
  const sync = () => {
    const run = !paused && visible && !document.hidden;
    if (run && !raf) { clock.getDelta(); loop(); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  const renderToggle = () => {
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.textContent = paused ? '播放人潮動畫' : '暫停人潮動畫';
    sync();
  };
  toggle.addEventListener('click', () => { paused = !paused; renderToggle(); });
  renderToggle();

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; sync(); }).observe(wrap);
  }
  document.addEventListener('visibilitychange', sync);
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { layout(); populate(); renderer.render(scene, camera); }, 120);
  });
})();
