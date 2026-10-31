/**
 * boot.ts — Math Runner: Crowd Commander
 *
 * Hyper-casual math runner: the crowd auto-runs down a suspended track (forward = -Z),
 * the player only steers left/right (A/D, arrows, or drag). Math gates (+, −, ×, ÷)
 * resize the crowd; numbered obstacles are shot down automatically (each hit = damage);
 * coins fund upgrades between levels (starting army / fire rate / damage).
 *
 * Contract with the React shell (src/pages/Home.tsx):
 *   const api = startGame(canvas, onUi)  — mounts renderer + loop, pushes UiState
 *   stopGame()                           — tears everything down
 * The returned GameApi is what the HUD buttons call.
 */

import * as THREE from "three";
import { GameLoop } from "./engine";
import { Input } from "./input";
import { AudioSystem } from "./audio";
import { storage } from "./storage";
import { GameStateMachine, type GameState } from "./state";
import { genLevel, applyOp, opLabel, mulberry32, type LevelDef, type ObstacleDef, type ObstacleKind } from "./level";

declare global {
  interface Window {
    __gameProbe?: () => { x: number; y: number; z: number };
    __GAME_READY__?: boolean;
    __gameDebug?: () => unknown;
  }
}

// ---------- UI bridge ----------

export type UpgradeKey = "army" | "rate" | "dmg";
export type Phase = GameState;

export interface UiState {
  phase: Phase;
  count: number;
  coins: number;
  level: number;
  best: number;
  progress: number; // 0..1 through the level
  muted: boolean;
  upgrades: Record<UpgradeKey, number>;
  costs: Record<UpgradeKey, number>;
  gain: number; // coins earned on the last completed run
}

export interface GameApi {
  start: () => void;
  togglePause: () => void;
  restart: () => void;
  quitToTitle: () => void;
  nextLevel: () => void;
  buyUpgrade: (k: UpgradeKey) => void;
  toggleMute: () => void;
}

// ---------- tuning ----------

const TRACK_HALF = 4.2; // crowd center clamp
const MAX_UNITS = 120; // visual cap for the crowd (the count itself is unbounded)
const SHOOT_RANGE = 14;
const BULLET_POOL = 180;
const PARTICLE_POOL = 320;

const COLORS = {
  sky: 0x6ec6ff,
  track: 0xf5f7fa,
  trackEdge: 0x2d9cdb,
  crowd: 0x2d9cdb,
  crowdDark: 0x1b6fa8,
  enemy: 0xeb5757,
  enemyDark: 0xa83232,
  coin: 0xf2c94c,
  gateGood: "#22c55e",
  gateBad: "#ef4444",
};

// ---------- save data ----------

interface SaveData {
  coins: number;
  level: number;
  best: number;
  upgrades: Record<UpgradeKey, number>;
}

const SAVE_KEY = "mrcc.save.v1";

function loadSave(): SaveData {
  const raw = storage.get<SaveData | null>(SAVE_KEY, null);
  if (raw && typeof raw.coins === "number" && typeof raw.level === "number" && raw.upgrades) {
    return {
      coins: Math.max(0, Math.floor(raw.coins)),
      level: Math.max(1, Math.floor(raw.level)),
      best: Math.max(1, Math.floor(raw.best || 1)),
      upgrades: {
        army: clampInt(raw.upgrades.army, 0, 10),
        rate: clampInt(raw.upgrades.rate, 0, 10),
        dmg: clampInt(raw.upgrades.dmg, 0, 10),
      },
    };
  }
  return { coins: 0, level: 1, best: 1, upgrades: { army: 0, rate: 0, dmg: 0 } };
}

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : lo;
  return Math.min(hi, Math.max(lo, n));
}

const startCount = (u: Record<UpgradeKey, number>) => 6 + 4 * u.army;
const fireRate = (u: Record<UpgradeKey, number>) => 1.5 + 0.5 * u.rate; // shots/s per shooter
const shotDamage = (u: Record<UpgradeKey, number>) => 1 + u.dmg;
const upgradeCost = (k: UpgradeKey, lv: number) =>
  Math.round((k === "army" ? 40 : k === "rate" ? 55 : 70) * Math.pow(1.8, lv));

// ---------- label sprites ----------

interface Label {
  sprite: THREE.Sprite;
  set: (text: string) => void;
  dispose: () => void;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeLabel(
  initial: string,
  opts: { font?: number; bg?: string; fg?: string; scaleX?: number; scaleY?: number } = {},
): Label {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(opts.scaleX ?? 2.2, opts.scaleY ?? 1.1, 1);

  const draw = (text: string) => {
    ctx.clearRect(0, 0, 256, 128);
    if (opts.bg) {
      ctx.fillStyle = opts.bg;
      roundRect(ctx, 8, 20, 240, 88, 26);
      ctx.fill();
    }
    ctx.fillStyle = opts.fg ?? "#ffffff";
    ctx.font = `800 ${opts.font ?? 64}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 66);
    tex.needsUpdate = true;
  };
  draw(initial);

  return {
    sprite,
    set: draw,
    dispose: () => {
      tex.dispose();
      mat.dispose();
    },
  };
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
    else if (m) m.dispose();
  });
}

// ---------- session ----------

let session: { dispose: () => void } | null = null;

export function startGame(canvas: HTMLCanvasElement, onUi: (s: UiState) => void): GameApi {
  stopGame();

  const vrnd = mulberry32(987654321); // visual-only randomness

  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.sky, 34, 95);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x51749a, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 14, 6);
  scene.add(sun);

  const audio = new AudioSystem();
  const input = new Input(canvas);
  const sm = new GameStateMachine();

  // ---------- persistent save ----------
  let save = loadSave();

  // ---------- crowd ----------
  // golden-angle spiral formation offsets (precomputed once — no per-frame allocation)
  const offsets: { x: number; z: number }[] = [];
  for (let i = 0; i < MAX_UNITS; i++) {
    const r = 0.27 * Math.sqrt(i);
    const a = i * 2.39996;
    offsets.push({ x: r * Math.cos(a) * 0.95, z: r * Math.sin(a) * 0.8 });
  }

  const bodyGeo = new THREE.CapsuleGeometry(0.16, 0.34, 3, 8);
  const headGeo = new THREE.SphereGeometry(0.13, 10, 8);
  const crowdBodyMat = new THREE.MeshStandardMaterial({ color: COLORS.crowd, roughness: 0.55 });
  const crowdHeadMat = new THREE.MeshStandardMaterial({ color: 0xffe0bd, roughness: 0.6 });
  const bodies = new THREE.InstancedMesh(bodyGeo, crowdBodyMat, MAX_UNITS);
  const heads = new THREE.InstancedMesh(headGeo, crowdHeadMat, MAX_UNITS);
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bodies.frustumCulled = false;
  heads.frustumCulled = false;
  scene.add(bodies, heads);

  const unitX = new Float32Array(MAX_UNITS);
  const unitZ = new Float32Array(MAX_UNITS);
  const unitPop = new Float32Array(MAX_UNITS); // spawn scale-in animation timer

  const countLabel = makeLabel("6", { bg: "rgba(13,38,64,0.85)", font: 66, scaleX: 2.0, scaleY: 1.0 });
  countLabel.sprite.position.y = 2.6;
  scene.add(countLabel.sprite);

  // ---------- run state ----------
  let def: LevelDef = genLevel(save.level);
  let count = startCount(save.upgrades);
  let centerX = 0;
  let centerZ = 0;
  let runCoins = 0;
  let lastGain = 0;
  let shake = 0;
  let elapsed = 0;
  let titleSpin = 0;
  let visible = Math.min(count, MAX_UNITS);

  // ---------- level content (rebuilt per level) ----------
  let levelGroup: THREE.Group | null = null;
  const gateState: { z: number; applied: boolean; flash: number; left: { op: "add" | "sub" | "mul" | "div"; val: number }; right: { op: "add" | "sub" | "mul" | "div"; val: number }; panels: THREE.Mesh[] }[] = [];
  interface Obstacle {
    def: ObstacleDef;
    hp: number;
    dead: boolean;
    group: THREE.Group;
    label: Label;
    hitFlash: number;
  }
  const obstacles: Obstacle[] = [];
  const coinState: { x: number; z: number; taken: boolean }[] = [];
  let coinMesh: THREE.InstancedMesh | null = null;
  let finishZ = -def.length;

  // ---------- shared materials/geometries for obstacles ----------
  const enemyMat = new THREE.MeshStandardMaterial({ color: COLORS.enemy, roughness: 0.55 });
  const enemyDarkMat = new THREE.MeshStandardMaterial({ color: COLORS.enemyDark, roughness: 0.7 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0xf2994a, roughness: 0.6 });
  const bossMat = new THREE.MeshStandardMaterial({ color: 0x9b51e0, roughness: 0.5 });

  const unitBodyGeo = new THREE.CapsuleGeometry(0.17, 0.36, 3, 8);
  const unitHeadGeo = new THREE.SphereGeometry(0.14, 10, 8);

  // ---------- environment (clouds + floating rocks — level independent) ----------
  const envGroup = new THREE.Group();
  scene.add(envGroup);
  {
    const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 });
    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, 36);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 36; i++) {
      // keep clouds out of the camera corridor (|x| < 10 is the play view)
      const side = i % 2 === 0 ? -1 : 1;
      const cx = side * (11 + vrnd() * 26);
      const cy = 9 + vrnd() * 11;
      const cz = 20 - vrnd() * 420;
      const s = 1.2 + vrnd() * 2.2;
      m.compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(s * 1.8, s * 0.55, s));
      clouds.setMatrixAt(i, m);
    }
    clouds.instanceMatrix.needsUpdate = true;
    envGroup.add(clouds);

    const rockGeo = new THREE.ConeGeometry(1, 2.4, 5);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x56ab6f, roughness: 0.9, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 18);
    for (let i = 0; i < 18; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const rx = side * (9 + vrnd() * 16);
      const ry = -3 - vrnd() * 5;
      const rz = 10 - vrnd() * 420;
      const s = 1 + vrnd() * 2.4;
      m.compose(new THREE.Vector3(rx, ry, rz), q, new THREE.Vector3(s, s, s));
      rocks.setMatrixAt(i, m);
    }
    rocks.instanceMatrix.needsUpdate = true;
    envGroup.add(rocks);
  }

  // ---------- bullets (pooled instanced) ----------
  const bulletGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
  const bulletMesh = new THREE.InstancedMesh(bulletGeo, bulletMat, BULLET_POOL);
  bulletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bulletMesh.frustumCulled = false;
  scene.add(bulletMesh);
  const bullets: { alive: boolean; x: number; y: number; z: number; target: Obstacle | null; tx: number; ty: number; tz: number }[] = [];
  for (let i = 0; i < BULLET_POOL; i++) bullets.push({ alive: false, x: 0, y: 0, z: 0, target: null, tx: 0, ty: 0, tz: 0 });

  // ---------- particles (pooled instanced, colored) ----------
  const partGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const partMesh = new THREE.InstancedMesh(partGeo, partMat, PARTICLE_POOL);
  partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  partMesh.frustumCulled = false;
  scene.add(partMesh);
  const parts: { alive: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number }[] = [];
  for (let i = 0; i < PARTICLE_POOL; i++) parts.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
  const partColor = new THREE.Color();

  function burst(x: number, y: number, z: number, n: number, color: number, spread = 3.2, up = 4): void {
    partColor.setHex(color);
    let spawned = 0;
    for (let i = 0; i < parts.length && spawned < n; i++) {
      const p = parts[i];
      if (p.alive) continue;
      p.alive = true;
      p.x = x; p.y = y; p.z = z;
      p.vx = (vrnd() - 0.5) * spread * 2;
      p.vy = vrnd() * up + 1;
      p.vz = (vrnd() - 0.5) * spread * 2;
      p.max = 0.5 + vrnd() * 0.45;
      p.life = p.max;
      partMesh.setColorAt(i, partColor);
      spawned++;
    }
    if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true;
  }

  // ---------- gate / obstacle / coin builders ----------
  function makeGatePanel(text: string, good: boolean): { group: THREE.Group; panel: THREE.Mesh } {
    const group = new THREE.Group();
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 288;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = good ? COLORS.gateGood : COLORS.gateBad;
    ctx.globalAlpha = 0.82;
    roundRect(ctx, 6, 6, 500, 276, 34);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 10;
    roundRect(ctx, 6, 6, 500, 276, 34);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 130px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 150);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.5), mat);
    panel.position.y = 1.55;
    group.add(panel);
    const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.9, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    for (const px of [-2.3, 2.3]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(px, 1.45, 0);
      group.add(post);
    }
    return { group, panel };
  }

  function buildObstacle(d: ObstacleDef): Obstacle {
    const group = new THREE.Group();
    group.position.set(d.x, 0, d.z);
    const kind: ObstacleKind = d.kind;

    if (kind === "squad") {
      // a small red stickman squad
      const spots = [[-0.55, 0.35], [0.55, 0.35], [0, -0.45]];
      for (const [sx, sz] of spots) {
        const b = new THREE.Mesh(unitBodyGeo, enemyMat);
        b.position.set(sx, 0.44, sz);
        const h = new THREE.Mesh(unitHeadGeo, enemyDarkMat);
        h.position.set(sx, 0.94, sz);
        group.add(b, h);
      }
    } else if (kind === "tower") {
      for (let i = 0; i < 3; i++) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(1.7 - i * 0.3, 0.62, 1.7 - i * 0.3), i % 2 ? enemyDarkMat : enemyMat);
        seg.position.y = 0.31 + i * 0.62;
        group.add(seg);
      }
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8), enemyDarkMat);
      gun.rotation.x = Math.PI / 2.4;
      gun.position.set(0, 1.9, 0.3);
      group.add(gun);
    } else if (kind === "barrel") {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.15, 14), barrelMat);
      b.position.y = 0.58;
      const band1 = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.14, 14), enemyDarkMat);
      band1.position.y = 0.3;
      const band2 = band1.clone();
      band2.position.y = 0.86;
      group.add(b, band1, band2);
    } else {
      // boss: big purple fortress with a crown
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 2.6), bossMat);
      base.position.y = 0.75;
      const mid = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 1.9), enemyMat);
      mid.position.y = 2.0;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.9, 6), new THREE.MeshStandardMaterial({ color: COLORS.coin, roughness: 0.35 }));
      crown.position.y = 3.0;
      group.add(base, mid, crown);
    }

    const label = makeLabel(String(d.hp), { bg: "rgba(64,13,13,0.9)", font: 68, scaleX: 1.9, scaleY: 0.95 });
    label.sprite.position.y = kind === "boss" ? 4.0 : kind === "tower" ? 2.9 : 1.9;
    group.add(label.sprite);
    return { def: d, hp: d.hp, dead: false, group, label, hitFlash: 0 };
  }
