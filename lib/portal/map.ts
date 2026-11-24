// Salão do Grimório: static room layout (since 2026-11-17 only Palco/Plateia, Mesa do Oráculo and Coworking) shared by every client (pathfinding must be deterministic).
// Also imported by the realtime worker (realtime/src/index.ts) for bounds, spawn and seats: keep it DOM-free.

export const MAP_W = 58; // 36 + the Sala de TV wing (x 36..43) + the Coworking wing (x 44..57)
export const MAP_H = 38;
export const SPAWN = { x: 17, y: 35 };
export const VOICE_RADIUS = 4.5; // tiles
export const MAX_PEERS = 6;

export type Zone = { id: string; name: string; x0: number; y0: number; x1: number; y1: number; color: string };

export const ZONES: Zone[] = [
  { id: "palco", name: "Palco das Lives", x0: 11, y0: 1, x1: 22, y1: 5, color: "gold" },
  { id: "plateia", name: "Plateia", x0: 10, y0: 7, x1: 23, y1: 17, color: "red" },
  { id: "oraculo", name: "Mesa do Oráculo", x0: 1, y0: 20, x1: 7, y1: 26, color: "blue" },
  { id: "cowork", name: "Coworking", x0: 44, y0: 0, x1: 57, y1: 19, color: "teal" },
];

/** Inside this rectangle (stage + audience + its edges) the live plays on the stage screen automatically. */
export const LIVE_ZONE = { x0: 9, y0: 0, x1: 24, y1: 18 };
export const inLiveZone = (x: number, y: number) =>
  x >= LIVE_ZONE.x0 - 0.5 && x <= LIVE_ZONE.x1 + 0.5 && y >= LIVE_ZONE.y0 - 0.5 && y <= LIVE_ZONE.y1 + 0.5;

/** Sala de TV (past lives on the wall TV): inside it the TV plays at full volume and the camera frames the screen.
 *  The room was removed on 2026-11-17 (simplified map): the zone sits off the map so nothing triggers it. */
export const TV_ZONE = { x0: -100, y0: -100, x1: -99, y1: -99 };
export const inTvZone = (x: number, y: number) =>
  x >= TV_ZONE.x0 - 0.5 && x <= TV_ZONE.x1 + 0.5 && y >= TV_ZONE.y0 - 0.5 && y <= TV_ZONE.y1 + 0.5;

/** Where clicks on room features walk you to. */
export const SPOTS = { palco: { x: 16, y: 6 }, nichos: { x: 30, y: 6 }, tv: { x: 39, y: 4 } };
export const NPC_POS = { oraculo: { x: 2, y: 22 }, mago: { x: 20, y: 34 } };
export const ZONE_TAGS = [
  { x: 16.5, y: 6.6, text: "Palco das Lives", col: "#ffd700" },
  { x: 16.5, y: 17.7, text: "Plateia", col: "#ff8aa0" },
  { x: 4, y: 26.8, text: "Mesa do Oráculo", col: "#7cc8ff" },
  { x: 50.5, y: 19.8, text: "Coworking", col: "#7df0c8" },
];

export type Interact = "oraculo" | "mago" | "nichos" | "palco" | "grimorio" | "gato" | "links" | "tv";

/** Screen facing (0=E 1=SE 2=S 3=SW 4=W 5=NW 6=N 7=NE) for a tile-axis direction. */
const FACE = { "-y": 7, "+y": 3, "-x": 5, "+x": 1 } as const;
type Face = keyof typeof FACE;

/** A 1x1 block. Multi-tile furniture is built from several blocks so depth sorting stays correct. */
export type Block = {
  x: number;
  y: number;
  kind: string;
  h?: number; // height in base px
  interact?: Interact;
  solid?: boolean; // default true (seats are walkable: you walk onto them and sit, Habbo-style)
  /** index into SEATS when you can sit here */
  seat?: number;
  /** has a "<kind>@f" sprite (backrest) drawn in front of a seated avatar */
  front?: boolean;
};

export type Seat = { i: number; x: number; y: number; dir: number; kind: string; lift: number };

const blocks: Block[] = [];
export const SEATS: Seat[] = [];
const add = (x: number, y: number, kind: string, extra: Partial<Block> = {}) => blocks.push({ x, y, kind, ...extra });
/** lift: how many px the seated sprite is raised (seat height) */
const LIFT: Record<string, number> = { aud: 3, bench: 0, chair: 6, stool: 17, sofa: 0 };
const seat = (x: number, y: number, kind: string, face: Face, extra: Partial<Block> = {}) => {
  const i = SEATS.length;
  const fam = kind.startsWith("sofa") ? "sofa" : kind;
  SEATS.push({ i, x, y, dir: FACE[face], kind, lift: LIFT[fam] ?? 0 });
  add(x, y, kind, { solid: false, seat: i, ...extra });
};

// ---------------------------------------------------------------- Palco das Lives (stage floor walkable)
add(11, 1, "speaker", { interact: "palco" });
add(22, 1, "speaker", { interact: "palco" });
add(16, 2, "dj_l", { interact: "palco" });
add(17, 2, "dj_r", { interact: "palco" });

// ---------------------------------------------------------------- Plateia: 50 seats facing the stage
// 4 rows of red theatre chairs + a back row of benches, 5+5 per row, centre aisle x=16..17, side aisles x=10 / x=23
for (const y of [8, 10, 12, 14, 16])
  for (const x of [11, 12, 13, 14, 15, 18, 19, 20, 21, 22])
    if (y === 16) seat(x, y, "bench", "-y");
    else seat(x, y, "aud", "-y", { front: true });

// ---------------------------------------------------------------- Mesa do Oráculo
add(3, 22, "otable");
add(4, 22, "otable");
add(3, 23, "otable");
add(4, 23, "otable_crystal");
add(NPC_POS.oraculo.x, NPC_POS.oraculo.y, "npc_oraculo", { interact: "oraculo" });
for (const y of [20, 21, 25, 26]) add(0, y, "bookshelf");
seat(6, 24, "stool", "-x");
seat(5, 25, "stool", "-y");

// ---------------------------------------------------------------- Coworking (wing x 44..57, y 0..19): 4 rows of 5 desks with a PC,
// chairs facing the back wall (-y), + a coffee corner.
for (const y of [3, 7, 11, 15])
  for (let x = 48; x <= 52; x++) {
    add(x, y, "desk_pc");
    seat(x, y + 1, "chair", "-y", { front: true });
  }
add(55, 17, "rtable");
seat(54, 17, "stool", "+x");
seat(56, 17, "stool", "-x");
add(57, 15, "cauldron"); // the wing's coffee pot

// Host NPC near the entrance
add(NPC_POS.mago.x, NPC_POS.mago.y, "npc_mago", { interact: "mago" });

// Plants and lamps
for (const [x, y] of [[0, 0], [10, 1], [24, 1], [35, 0], [0, 18], [35, 24], [12, 21], [22, 29], [9, 19], [24, 19], [26, 12]]) add(x, y, "palm");
for (const [x, y] of [[35, 11], [14, 37], [20, 37], [35, 37], [0, 7], [9, 7], [24, 7], [30, 33], [26, 33], [8, 28], [43, 11], [36, 0], [43, 24], [43, 37], [39, 30]]) add(x, y, "plant");
for (const [x, y] of [[0, 5], [34, 9], [23, 33], [9, 26], [0, 13], [35, 30], [43, 7], [36, 10], [43, 18], [40, 37]]) add(x, y, "lamp");
for (const [x, y] of [[43, 14], [43, 30]]) add(x, y, "palm");
// coworking wing + the open floor below it
for (const [x, y] of [[44, 0], [57, 0], [57, 9], [44, 19], [57, 19], [57, 37], [50, 30]]) add(x, y, "plant");
for (const [x, y] of [[57, 4], [44, 9], [57, 12], [47, 26], [54, 26], [57, 33]]) add(x, y, "lamp");
for (const [x, y] of [[45, 37], [52, 37]]) add(x, y, "palm");

export const BLOCKS = blocks;

export const solid: boolean[] = new Array(MAP_W * MAP_H).fill(false);
for (const b of blocks) if (b.solid !== false) solid[b.y * MAP_W + b.x] = true;
/** seat index per tile (-1 = none) */
export const seatGrid: Int16Array = new Int16Array(MAP_W * MAP_H).fill(-1);
for (const s of SEATS) seatGrid[s.y * MAP_W + s.x] = s.i;

export const isWalkable = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && !solid[y * MAP_W + x];

export const seatAt = (x: number, y: number): Seat | null => {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return null;
  const i = seatGrid[y * MAP_W + x];
  return i >= 0 ? SEATS[i] : null;
};

export const blockAt = (x: number, y: number) => blocks.find((b) => b.x === x && b.y === y);

export function zoneAt(x: number, y: number) {
  return ZONES.find((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1);
}

/** Stage tiles are raised visually. */
export const isStage = (x: number, y: number) => x >= 11 && x <= 22 && y >= 1 && y <= 5;
