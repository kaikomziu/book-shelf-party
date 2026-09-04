// 本棚レイアウトと初期の床散らばり座標を、部屋番号+総冊数から決定論的に生成する。
// 全クライアントが同じ入力(roomCode, totalBooks)から同じ配置を再現できるので、
// サーバーに座標そのものを持たせる必要がない(状態の差分だけをSupabaseに置く)。

export const TOTAL_BOOKS_OPTIONS = [500, 1000, 2000];
export const DEFAULT_TOTAL_BOOKS = 500;

const SHELVES_PER_CASE = 5;
const SLOTS_PER_SHELF = 20; // 1本棚あたり 5*20 = 100冊
const CASE_WIDTH = 3.2;
const CASE_DEPTH = 0.6;
const SHELF_Y_START = 0.35;
const SHELF_Y_STEP = 0.42;
const COLS = 5; // 1列に並べる本棚の数
const COL_SPACING = 6;
const ROW_SPACING = 6.5; // 通路の奥行き

const BOOK_COLORS = [
  0xd94f4f, 0xd97a4f, 0xd9b64f, 0xa8d94f, 0x4fd97a,
  0x4fd9c8, 0x4f9dd9, 0x4f5fd9, 0x8a4fd9, 0xc84fd9,
  0xd94f9d, 0x6b4423, 0x2f6b3f, 0x3f5c6b, 0xb08d57, 0x555555,
];

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

export function normalizeRoomCode(code) {
  // Supabase Realtimeのfilter文字列やチャンネル名に安全な文字だけを残す
  // (英数字のみ。日本語や記号は入れても伝わらないので弾く)
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

export function sanitizeTotalBooks(n) {
  const v = Number(n);
  return TOTAL_BOOKS_OPTIONS.includes(v) ? v : DEFAULT_TOTAL_BOOKS;
}

// 冊数から本棚の並び(何列×何行)・部屋のサイズ・移動可能範囲を計算する。
export function getLayoutConfig(totalBooks) {
  const bookcaseCount = Math.max(1, Math.round(totalBooks / (SHELVES_PER_CASE * SLOTS_PER_SHELF)));
  const rows = Math.ceil(bookcaseCount / COLS);

  const BOOKCASES = [];
  for (let r = 0; r < rows; r++) {
    const countInRow = Math.min(COLS, bookcaseCount - r * COLS);
    const rowZ = -12 - r * ROW_SPACING;
    for (let c = 0; c < countInRow; c++) {
      const x = (c - (countInRow - 1) / 2) * COL_SPACING;
      BOOKCASES.push({ x, z: rowZ });
    }
  }

  const lastRowZ = -12 - (rows - 1) * ROW_SPACING;
  const zMin = lastRowZ - CASE_DEPTH / 2 - 3.5;
  const zMax = 13;
  const halfWidth = (COLS * COL_SPACING) / 2 + 4;

  const ROOM = { width: halfWidth * 2, zMin, zMax };
  const BOUNDS = {
    xMin: -halfWidth + 0.6,
    xMax: halfWidth - 0.6,
    zMin: zMin + 1.0,
    zMax: zMax - 0.7,
  };

  return {
    ROOM,
    BOOKCASES,
    BOUNDS,
    CASE_WIDTH,
    CASE_DEPTH,
    SHELVES_PER_CASE,
    SLOTS_PER_SHELF,
    SHELF_Y_START,
    SHELF_Y_STEP,
  };
}

function generateHomeSlots(layout) {
  const { BOOKCASES, CASE_WIDTH: cw, CASE_DEPTH: cd, SHELVES_PER_CASE: shelves, SLOTS_PER_SHELF: slots } = layout;
  const out = [];
  let id = 0;
  for (const bc of BOOKCASES) {
    const frontZ = bc.z + cd / 2 + 0.05;
    for (let s = 0; s < shelves; s++) {
      const y = SHELF_Y_START + s * SHELF_Y_STEP;
      for (let i = 0; i < slots; i++) {
        const localX = -cw / 2 + (i + 0.5) * (cw / slots);
        out.push({
          id,
          x: bc.x + localX,
          y,
          z: frontZ,
          rotationY: 0,
          color: BOOK_COLORS[id % BOOK_COLORS.length],
          width: 0.09 + ((id * 37) % 5) * 0.008,
        });
        id++;
      }
    }
  }
  return out;
}

function generateFloorPositions(count, seed, layout) {
  const rand = mulberry32(seed);
  const { BOUNDS } = layout;
  const area = {
    xMin: BOUNDS.xMin + 0.5,
    xMax: BOUNDS.xMax - 0.5,
    zMin: BOUNDS.zMin + 0.5,
    zMax: BOUNDS.zMax - 0.5,
  };
  const areaW = area.xMax - area.xMin;
  const areaD = area.zMax - area.zMin;

  // 冊数に対して十分なマス目ができるようセルサイズを調整する(冊数が多いほど細かく)
  let cellSize = Math.sqrt((areaW * areaD) / (count * 1.35));
  cellSize = Math.max(0.4, Math.min(1.0, cellSize));

  const cols = Math.max(1, Math.floor(areaW / cellSize));
  const rows = Math.max(1, Math.floor(areaD / cellSize));

  const cells = [];
  for (let cx = 0; cx < cols; cx++) {
    for (let cz = 0; cz < rows; cz++) cells.push({ cx, cz });
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const positions = [];
  for (let i = 0; i < count; i++) {
    const c = cells[i % cells.length];
    const jitterX = (rand() - 0.5) * cellSize * 0.75;
    const jitterZ = (rand() - 0.5) * cellSize * 0.75;
    positions.push({
      x: area.xMin + (c.cx + 0.5) * cellSize + jitterX,
      z: area.zMin + (c.cz + 0.5) * cellSize + jitterZ,
      rotationY: rand() * Math.PI * 2,
    });
  }
  return positions;
}

// 部屋番号+総冊数ごとに再現性のある初期レイアウトを返す。
// 実際のstate('floor'/'held'/'placed')はSupabase側の差分だけを重ねて上書きする。
export function createDefaultBooksForRoom(roomCode, totalBooks) {
  const layout = getLayoutConfig(totalBooks);
  const seed = hashSeed(normalizeRoomCode(roomCode) + ":" + totalBooks);
  const homeSlots = generateHomeSlots(layout);
  const floorPositions = generateFloorPositions(homeSlots.length, seed, layout);

  const books = homeSlots.map((slot, i) => ({
    id: slot.id,
    color: slot.color,
    width: slot.width,
    home: { x: slot.x, y: slot.y, z: slot.z, rotationY: slot.rotationY },
    state: "floor", // 'floor' | 'held' | 'placed'
    position: { x: floorPositions[i].x, y: 0.05, z: floorPositions[i].z, rotationY: floorPositions[i].rotationY },
    heldBy: null,
  }));

  return { layout, books };
}
