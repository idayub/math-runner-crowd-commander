/**
 * level.ts — procedural level generation for Math Runner: Crowd Commander.
 * Deterministic per level (seeded RNG) so retries of the same level feel identical.
 *
 * Track runs toward -Z: the crowd starts at z = 0 and the finish line sits at z = -length.
 */

export type OpKind = "add" | "sub" | "mul" | "div";

export interface GateDef {
  z: number;
  left: { op: OpKind; val: number };
  right: { op: OpKind; val: number };
}

export type ObstacleKind = "squad" | "tower" | "barrel" | "boss";

export interface ObstacleDef {
  kind: ObstacleKind;
  x: number;
  z: number;
  hp: number;
  width: number;
}

export interface CoinDef {
  x: number;
  z: number;
}

export interface LevelDef {
  level: number;
  length: number;
  speed: number;
  gates: GateDef[];
  obstacles: ObstacleDef[];
  coins: CoinDef[];
}

export function applyOp(count: number, op: OpKind, val: number): number {
  switch (op) {
    case "add": return Math.min(9999, count + val);
    case "sub": return count - val;
    case "mul": return Math.min(9999, count * val);
    case "div": return Math.floor(count / val);
  }
}

export function opLabel(op: OpKind, val: number): string {
  switch (op) {
    case "add": return `+${val}`;
    case "sub": return `-${val}`;
    case "mul": return `×${val}`;
    case "div": return `÷${val}`;
  }
}

/** mulberry32 seeded PRNG (bare Math.random is banned for level content). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ri = (rnd: () => number, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

export function genLevel(level: number): LevelDef {
  const rnd = mulberry32(level * 7919 + 13);
  const length = 240 + Math.min(level - 1, 15) * 12;
  const speed = Math.min(16, 8.5 + (level - 1) * 0.55);

  // ---- gates ----
  const gates: GateDef[] = [];
  const gateCount = 4 + Math.min(level, 4);
  for (let i = 0; i < gateCount; i++) {
    const z = -46 - i * (34 + rnd() * 6);
    const mk = (): { op: OpKind; val: number } => {
      const r = rnd();
      if (r < 0.34) return { op: "add", val: ri(rnd, 5, 9) + level * 2 };
      if (r < 0.52) return { op: "mul", val: level >= 4 && rnd() < 0.4 ? 3 : 2 };
      if (r < 0.78) return { op: "sub", val: ri(rnd, 4, 8) + Math.floor(level * 1.2) };
      return { op: "div", val: 2 };
    };
    let left = mk();
    let right = mk();
    // the two options must differ, and at least one side must not shrink the crowd
    let guard = 0;
    while (left.op === right.op && left.val === right.val && guard++ < 8) right = mk();
    if ((left.op === "sub" || left.op === "div") && (right.op === "sub" || right.op === "div")) {
      right = { op: "add", val: ri(rnd, 5, 9) + level * 2 };
    }
    gates.push({ z, left, right });
  }

  // ---- obstacles (a math check after each gate) ----
  const obstacles: ObstacleDef[] = [];
  const lanes = [-2.7, 0, 2.7];
  for (let i = 0; i < gateCount; i++) {
    const z = gates[i].z - 17 - rnd() * 6;
    const x = lanes[ri(rnd, 0, 2)];
    const hp = Math.round((9 + level * 3.2) * (0.75 + rnd() * 0.6));
    const kr = rnd();
    const kind: ObstacleKind = kr < 0.5 ? "squad" : kr < 0.8 ? "tower" : "barrel";
    obstacles.push({ kind, x, z, hp, width: kind === "tower" ? 2.4 : 2.2 });
  }
  // boss guarding the finish line
  const bossHp = Math.round(42 + level * 15);
  obstacles.push({ kind: "boss", x: 0, z: -(length - 18), hp: bossHp, width: 3.6 });

  // ---- coins (trails between gates, often on the riskier lane) ----
  const coins: CoinDef[] = [];
  for (let i = 0; i < gateCount + 1; i++) {
    const zBase = -28 - i * 36 - rnd() * 8;
    const cx = lanes[ri(rnd, 0, 2)] * (rnd() < 0.5 ? 1 : 0.6);
    const n = ri(rnd, 3, 5);
    for (let c = 0; c < n; c++) {
      coins.push({ x: cx + Math.sin(c * 1.2) * 0.5, z: zBase - c * 2.2 });
    }
  }

  return { level, length, speed, gates, obstacles, coins };
}
