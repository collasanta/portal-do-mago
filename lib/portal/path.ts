import { MAP_W, MAP_H, isWalkable, seatGrid } from "./map";

/** Walking across chairs is allowed (Habbo-style) but aisles are preferred. */
const SEAT_COST = 2.5;

export type P = { x: number; y: number };

const DIRS = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1],
];

/** Deterministic 8-direction A* without corner cutting. Returns tiles after `from`, ending at `to`. */
export function findPath(from: P, to: P): P[] {
  if (!isWalkable(to.x, to.y)) {
    const alt = nearestWalkable(to, from);
    if (!alt) return [];
    to = alt;
  }
  if (from.x === to.x && from.y === to.y) return [];
  const N = MAP_W * MAP_H;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = from.y * MAP_W + from.x;
  const goal = to.y * MAP_W + to.x;
  g[start] = 0;
  // tiny binary heap of [f, order, idx]
  const heap: [number, number, number][] = [];
  let order = 0;
  const push = (f: number, i: number) => {
    heap.push([f, order++, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (less(heap[k], heap[p])) {
        [heap[k], heap[p]] = [heap[p], heap[k]];
        k = p;
      } else break;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === k) break;
        [heap[k], heap[m]] = [heap[m], heap[k]];
        k = m;
      }
    }
    return top;
  };
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - to.x), dy = Math.abs(y - to.y);
    return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
  };
  push(h(from.x, from.y), start);
  let iter = 0;
  while (heap.length && iter++ < 8000) {
    const [, , cur] = pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!isWalkable(nx, ny)) continue;
      if (dx && dy && (!isWalkable(cx + dx, cy) || !isWalkable(cx, cy + dy))) continue;
      const ni = ny * MAP_W + nx;
      const ng = g[cur] + (dx && dy ? 1.4142 : 1) * (seatGrid[ni] >= 0 && ni !== goal ? SEAT_COST : 1);
      if (ng < g[ni] - 1e-6) {
        g[ni] = ng;
        came[ni] = cur;
        push(ng + h(nx, ny), ni);
      }
    }
  }
  if (came[goal] === -1) return [];
  const out: P[] = [];
  for (let i = goal; i !== start; i = came[i]) out.push({ x: i % MAP_W, y: (i / MAP_W) | 0 });
  return out.reverse();
}

function less(a: [number, number, number], b: [number, number, number]) {
  return a[0] < b[0] - 1e-6 || (Math.abs(a[0] - b[0]) <= 1e-6 && a[1] < b[1]);
}

export function nearestWalkable(p: P, toward?: P, ok: (x: number, y: number) => boolean = () => true): P | null {
  let best: P | null = null;
  let bd = Infinity;
  for (let r = 1; r <= 3; r++) {
    for (let y = p.y - r; y <= p.y + r; y++)
      for (let x = p.x - r; x <= p.x + r; x++) {
        if (!isWalkable(x, y) || !ok(x, y)) continue;
        const d = Math.hypot(x - p.x, y - p.y) + (toward ? Math.hypot(x - toward.x, y - toward.y) * 0.01 : 0);
        if (d < bd) {
          bd = d;
          best = { x, y };
        }
      }
    if (best) return best;
  }
  return null;
}
