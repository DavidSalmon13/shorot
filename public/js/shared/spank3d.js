/**
 * The 🍑 Spanking gag with realistic 3D people (storeFx.js picks this when it's ready, and
 * falls back to the drawn figures otherwise). Two copies of a rigged 3D man
 * (public/models/soldier.glb - a free three.js sample model made with Adobe Mixamo, which
 * comes with Idle / Walk / Run clips) are rendered live with three.js on a see-through
 * full-screen canvas over the game. The sender walks over using the model's real walk cycle;
 * the bend-over, the three smacks, the hop and the cheer are posed on the skeleton in code.
 * Each figure's head is replaced by the player's own face (sticker or emoji), as an HTML
 * element that follows the head bone.
 *
 * three.js and the model (~3 MB together) are only fetched the first time a Spanking is
 * about to play (or when the player owns one - storeActions.js), never on app start.
 * Screen coordinates map 1:1 to world units (orthographic camera, y flipped), so figures
 * stand on CSS-pixel positions.
 */

const MODEL_URL = '/models/soldier.glb';
const FIG_PX = 132; // figure height on screen, in CSS px

let loading = null; // Promise of { THREE, SkeletonUtils, gltf, height }
let assets = null; // the resolved value, once loaded

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

/** Starts loading three.js + the model (once). Resolves when ready; rejects on failure. */
export function preloadSpank3d() {
  if (assets) return Promise.resolve(assets);
  if (!loading) {
    if (!webglAvailable()) return Promise.reject(new Error('no WebGL'));
    loading = (async () => {
      const [THREE, { GLTFLoader }, SkeletonUtils] = await Promise.all([
        import('three'),
        import('/vendor/three/jsm/loaders/GLTFLoader.js'),
        import('/vendor/three/jsm/utils/SkeletonUtils.js'),
      ]);
      const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      assets = { THREE, SkeletonUtils, gltf, height: box.max.y - box.min.y };
      return assets;
    })();
    loading.catch(() => {
      loading = null; // let a later gag retry
    });
  }
  return loading;
}

export function spank3dReady() {
  return !!assets;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => x * x * (3 - 2 * x);
/** 0 before `a`, 1 after `b`, smooth in between. */
const ramp = (t, a, b) => ease(clamp01((t - a) / (b - a)));

/**
 * Plays the 3D show into `layer`. `geo` (screen px): target {x,y}, start {x,y} (walker's
 * feet), end {x,y} (walker's feet at the target), victim {x,y} (victim's feet), face (1 =
 * both face right, -1 = left). `faces`: { walker, victim } as { src } or { emoji }.
 * `timeline` ms marks shared with the 2D version. Returns a cleanup function.
 */
export function playSpank3d(layer, geo, faces, totalMs) {
  const { THREE, SkeletonUtils, gltf, height } = assets;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const root = document.createElement('div');
  root.className = 'sfx-3d';
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  layer.appendChild(root);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(vw, vh, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, vw, 0, -vh, -3000, 3000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3550, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(0.6, 1, 1.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 1.4);
  rim.position.set(-1, 0.6, -0.8);
  scene.add(rim);

  const scale = FIG_PX / height;
  // 3/4 view: turned mostly sideways (toward `face`), a little toward the viewer.
  const yaw = geo.face * (Math.PI / 2 - 0.5);

  function makeFigure(face) {
    const obj = SkeletonUtils.clone(gltf.scene);
    obj.scale.setScalar(scale);
    obj.rotation.y = yaw;
    obj.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        if (/visor/i.test(o.name)) o.visible = false; // the face replaces the helmet visor
      }
    });
    scene.add(obj);
    const mixer = new THREE.AnimationMixer(obj);
    const clip = (name) => mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, name));
    const bone = (name) => obj.getObjectByName(`mixamorig${name}`);
    const faceEl = document.createElement('span');
    faceEl.className = 'sfx-3d-face';
    if (face.src) {
      const img = document.createElement('img');
      img.src = face.src;
      img.alt = '';
      faceEl.appendChild(img);
    } else {
      faceEl.textContent = face.emoji;
    }
    root.appendChild(faceEl);
    return {
      obj,
      mixer,
      idle: clip('Idle'),
      walk: clip('Walk'),
      faceEl,
      b: {
        hips: bone('Hips'),
        spine: bone('Spine'),
        spine1: bone('Spine1'),
        spine2: bone('Spine2'),
        head: bone('Head'),
        rArm: bone('RightArm'),
        rFore: bone('RightForeArm'),
        lArm: bone('LeftArm'),
        lFore: bone('LeftForeArm'),
      },
    };
  }

  const walker = makeFigure(faces.walker);
  const victim = makeFigure(faces.victim);
  walker.idle.play();
  victim.idle.play();
  victim.idle.time = 0.7; // out of step with the walker

  const place = (fig, p, lift = 0) => fig.obj.position.set(p.x, -(p.y - lift), 0);
  place(victim, geo.victim);
  place(walker, geo.start);

  // --- skeleton posing helpers (world space, so they work whatever the bone axes are) ---
  const tmpQ = new THREE.Quaternion();
  const tmpQ2 = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** Model-space direction (x = figure's left/right, y up, z forward) -> world direction. */
  function worldDir(fig, x, y, z) {
    return tmpV2.set(x, y, z).normalize().applyQuaternion(fig.obj.quaternion);
  }

  /** Rotates `bone` (blend `w`) so it points along world direction `dir` (bones point along +Y). */
  function aimBone(bone, dir, w) {
    if (!bone || w <= 0) return;
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(tmpQ);
    const now = tmpV.copy(UP).applyQuaternion(tmpQ).normalize();
    const delta = tmpQ2.setFromUnitVectors(now, dir);
    const targetWorld = delta.multiply(tmpQ); // delta * current
    const parentQ = new THREE.Quaternion();
    bone.parent.getWorldQuaternion(parentQ);
    const local = parentQ.invert().multiply(targetWorld);
    bone.quaternion.slerp(local, w);
  }

  /** Bends `bone` forward by `angle` radians about the figure's side-to-side axis. */
  function bendBone(fig, bone, angle) {
    if (!bone || !angle) return;
    bone.updateWorldMatrix(true, false);
    const axis = tmpV.set(1, 0, 0).applyQuaternion(fig.obj.quaternion).normalize();
    bone.getWorldQuaternion(tmpQ);
    const targetWorld = tmpQ2.setFromAxisAngle(axis, angle).multiply(tmpQ);
    const parentQ = new THREE.Quaternion();
    bone.parent.getWorldQuaternion(parentQ);
    bone.quaternion.copy(parentQ.invert().multiply(targetWorld));
  }

  // The arm nearer the viewer does the spanking, so it's clearly seen.
  const near = geo.face === 1 ? { arm: 'rArm', fore: 'rFore' } : { arm: 'lArm', fore: 'lFore' };
  const far = geo.face === 1 ? { arm: 'lArm', fore: 'lFore' } : { arm: 'rArm', fore: 'rFore' };
  const sideSign = geo.face === 1 ? -1 : 1; // model x of the near arm's side

  const hits = [2925, 3425, 3925];
  let walking = false;
  const startAt = performance.now();
  let last = startAt;
  let raf = 0;
  const marks = new Set(); // hit times already shown

  function projectFace(fig) {
    const head = fig.b.head;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(tmpV);
    const size = FIG_PX * 0.3;
    fig.faceEl.style.width = `${size}px`;
    fig.faceEl.style.height = `${size}px`;
    fig.faceEl.style.fontSize = `${size * 0.82}px`;
    fig.faceEl.style.transform = `translate(${tmpV.x - size / 2}px, ${-tmpV.y - size * 0.62}px)`;
  }

  function showHit(t) {
    // The victim's backside: hips, nudged toward the walker (behind the victim).
    victim.b.hips.getWorldPosition(tmpV);
    const x = tmpV.x - geo.face * FIG_PX * 0.09;
    const y = -tmpV.y + FIG_PX * 0.02;
    const hand = document.createElement('span');
    hand.className = 'sfx-part sfx-handprint';
    hand.textContent = '🖐️';
    hand.style.left = `${x + (marks.size - 1) * 5 * geo.face}px`;
    hand.style.top = `${y + (marks.size - 1) * 4}px`;
    hand.style.animationDelay = '0ms';
    root.appendChild(hand);
    const smack = document.createElement('span');
    smack.className = 'sfx-part sfx-smack';
    smack.textContent = 'SMACK!';
    smack.style.left = `${Math.max(50, Math.min(vw - 50, x - geo.face * 30))}px`;
    smack.style.top = `${y - FIG_PX * 0.55 - marks.size * 6}px`;
    smack.style.animationDelay = '0ms';
    root.appendChild(smack);
    marks.add(t);
  }

  function frame() {
    const now = performance.now();
    const t = now - startAt;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // Walker: walk 300-2500ms from start to end, then stand.
    const wk = clamp01((t - 300) / 2200);
    if (t >= 300 && t < 2500 && !walking) {
      walking = true;
      walker.walk.reset().play();
      walker.walk.crossFadeFrom(walker.idle, 0.2, false);
      const dist = Math.hypot(geo.end.x - geo.start.x, geo.end.y - geo.start.y);
      walker.walk.timeScale = Math.max(0.7, Math.min(1.8, dist / 2.2 / (FIG_PX * 0.75)));
    }
    if (t >= 2500 && walking) {
      walking = false;
      walker.idle.reset().play();
      walker.idle.crossFadeFrom(walker.walk, 0.2, false);
    }
    const e = ease(wk);
    place(walker, { x: geo.start.x + (geo.end.x - geo.start.x) * e, y: geo.start.y + (geo.end.y - geo.start.y) * e });

    // Victim: hops after the smacks.
    const hop = t > 4050 && t < 5300 ? Math.abs(Math.sin((t - 4050) / 110)) * FIG_PX * 0.09 : 0;
    // Jolt on each smack: a quick lift forward.
    let jolt = 0;
    for (const h of hits) if (t >= h && t < h + 220) jolt = Math.max(jolt, 1 - (t - h) / 220);
    place(victim, { x: geo.victim.x + geo.face * jolt * 6, y: geo.victim.y }, hop + jolt * 5);

    walker.mixer.update(dt);
    victim.mixer.update(dt);
    walker.obj.updateMatrixWorld(true);
    victim.obj.updateMatrixWorld(true);

    // Victim bends forward 2100-2450, stays bent through the smacks, straightens at 4050.
    const bent = ramp(t, 2100, 2450) * (1 - ramp(t, 4000, 4250));
    const extra = jolt * 0.18;
    bendBone(victim, victim.b.spine, bent * 0.55 - extra);
    bendBone(victim, victim.b.spine1, bent * 0.45);
    bendBone(victim, victim.b.spine2, bent * 0.3);
    if (bent > 0.01) {
      // Hands on knees while bent over.
      aimBone(victim.b.rArm, worldDir(victim, 0, -1, 0.35), bent * 0.8);
      aimBone(victim.b.lArm, worldDir(victim, 0, -1, 0.35), bent * 0.8);
    }
    if (t > 4050) {
      // Both hands clutching the backside while hopping.
      const w = ramp(t, 4050, 4250);
      aimBone(victim.b.rArm, worldDir(victim, 0.1, -0.7, -0.7), w);
      aimBone(victim.b.rFore, worldDir(victim, -0.3, -0.2, -0.9), w);
      aimBone(victim.b.lArm, worldDir(victim, -0.1, -0.7, -0.7), w);
      aimBone(victim.b.lFore, worldDir(victim, 0.3, -0.2, -0.9), w);
    }

    // Walker spanks 2500-4050: the near arm winds up over the shoulder and swings down.
    if (t >= 2500 && t < 4050) {
      const phase = ((t - 2500) % 500) / 500; // hit lands at 0.85
      let a; // 0 = raised up and back, 1 = swung through, forward and down
      if (phase < 0.55) a = 0;
      else if (phase < 0.85) a = ease((phase - 0.55) / 0.3);
      else a = 1 - ease((phase - 0.85) / 0.15);
      const w = ramp(t, 2500, 2650);
      const up = { x: sideSign * 0.25, y: 1, z: -0.45 };
      const down = { x: sideSign * 0.15, y: -0.6, z: 0.85 };
      const d = { x: up.x + (down.x - up.x) * a, y: up.y + (down.y - up.y) * a, z: up.z + (down.z - up.z) * a };
      aimBone(walker.b[near.arm], worldDir(walker, d.x, d.y, d.z), w);
      aimBone(walker.b[near.fore], worldDir(walker, d.x, d.y, d.z + 0.15), w);
      bendBone(walker, walker.b.spine1, 0.15 * w);
    }
    // Then cheers with both fists up.
    if (t >= 4050) {
      const w = ramp(t, 4050, 4250);
      const wiggle = Math.sin((t - 4050) / 90) * 0.2;
      aimBone(walker.b[near.arm], worldDir(walker, sideSign * 0.35, 1, wiggle), w);
      aimBone(walker.b[near.fore], worldDir(walker, sideSign * 0.2, 1, 0), w);
      aimBone(walker.b[far.arm], worldDir(walker, -sideSign * 0.35, 1, -wiggle), w);
      aimBone(walker.b[far.fore], worldDir(walker, -sideSign * 0.2, 1, 0), w);
    }

    // The real head is replaced by the player's face.
    walker.b.head.scale.setScalar(0.001);
    victim.b.head.scale.setScalar(0.001);
    walker.obj.updateMatrixWorld(true);
    victim.obj.updateMatrixWorld(true);
    projectFace(walker);
    projectFace(victim);

    for (const h of hits) if (t >= h && !marks.has(h)) showHit(h);

    renderer.render(scene, camera);
    if (t < totalMs) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // "OW!" over the victim once the smacks are done.
  setTimeout(() => {
    if (!root.isConnected) return;
    const ow = document.createElement('span');
    ow.className = 'sfx-part sfx-ow';
    ow.textContent = 'OW!';
    ow.style.left = `${Math.max(40, Math.min(vw - 40, geo.victim.x + geo.face * 8))}px`;
    ow.style.top = `${geo.victim.y - FIG_PX - 18}px`;
    ow.style.animationDelay = '0ms';
    root.appendChild(ow);
  }, 4050);
  setTimeout(() => root.classList.add('sfx-3d-out'), totalMs - 600);

  return function cleanup() {
    cancelAnimationFrame(raf);
    walker.mixer.stopAllAction();
    victim.mixer.stopAllAction();
    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch {
      /* ignore */
    }
    root.remove();
  };
}
