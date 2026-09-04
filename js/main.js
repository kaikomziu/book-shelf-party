function __diag(msg) {
  try {
    if (window.__diagPush) window.__diagPush("[main.js] " + msg + " " + performance.now().toFixed(1));
  } catch (_) {}
}
__diag("top of module, before imports");

import * as THREE from "https://esm.sh/three@0.160.0";
__diag("imported three");
import { buildEnvironment, BooksRenderer, createHomeGlow, createPlayerMesh, handWorldPosition } from "./scene.js";
__diag("imported scene.js");
import { LocalPlayerController } from "./player.js";
__diag("imported player.js");
import * as net from "./net.js";
__diag("imported net.js");
import { createDefaultBooksForRoom, normalizeRoomCode, sanitizeTotalBooks } from "./bookLayout.js";
__diag("imported bookLayout.js");

const PICKUP_RADIUS = 2.4;
const PLACE_RADIUS = 1.6;
const MOVE_SEND_INTERVAL = 0.09;
const PUBLIC_ROOM_CODE = "PUBLIC";

const PLAYER_COLORS = [
  0xef5350, 0x42a5f5, 0x66bb6a, 0xffca28, 0xab47bc,
  0x26c6da, 0xff7043, 0x8d6e63, 0xd4e157, 0x5c6bc0,
];

const el = {
  lobby: document.getElementById("lobby"),
  gameUi: document.getElementById("gameUi"),
  winOverlay: document.getElementById("winOverlay"),
  winText: document.getElementById("winText"),
  nameInput: document.getElementById("nameInput"),
  codeInput: document.getElementById("codeInput"),
  joinBtn: document.getElementById("joinBtn"),
  publicBtn: document.getElementById("publicBtn"),
  lobbyError: document.getElementById("lobbyError"),
  canvas: document.getElementById("gameCanvas"),
  roomBadge: document.getElementById("roomBadge"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  playerList: document.getElementById("playerList"),
  prompt: document.getElementById("prompt"),
  interactBtn: document.getElementById("interactBtn"),
  closeWinBtn: document.getElementById("closeWinBtn"),
};

__diag("el object built, publicBtn=" + (el.publicBtn ? "found" : "NULL") + " joinBtn=" + (el.joinBtn ? "found" : "NULL"));

restoreLastInputs();
__diag("restoreLastInputs done");
el.joinBtn.addEventListener("click", () => { __diag("joinBtn click handler fired"); handleJoin(el.codeInput.value); });
el.publicBtn.addEventListener("click", () => { __diag("publicBtn click handler fired"); handleJoin(PUBLIC_ROOM_CODE); });
el.codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleJoin(el.codeInput.value); });
el.nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleJoin(el.codeInput.value); });
el.closeWinBtn.addEventListener("click", () => el.winOverlay.classList.add("hidden"));
__diag("all listeners attached, module top-level complete");

function restoreLastInputs() {
  try {
    el.nameInput.value = localStorage.getItem("bsp_name") || "";
    el.codeInput.value = localStorage.getItem("bsp_code") || "";
  } catch (_) {}
}

function getSelectedBookCount() {
  const checked = document.querySelector('input[name="bookCount"]:checked');
  return sanitizeTotalBooks(checked ? checked.value : 500);
}

function getMyId() {
  try {
    let id = sessionStorage.getItem("bsp_myid");
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      sessionStorage.setItem("bsp_myid", id);
    }
    return id;
  } catch (_) {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function pickColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}

let joining = false;

async function handleJoin(rawCode) {
  if (joining) return;
  const name = el.nameInput.value.trim() || "名無し";
  const code = normalizeRoomCode(rawCode);
  if (!code) {
    el.lobbyError.textContent = "部屋番号を入力してください";
    return;
  }
  joining = true;
  el.joinBtn.disabled = true;
  el.publicBtn.disabled = true;
  el.lobbyError.textContent = "";

  try {
    localStorage.setItem("bsp_name", name);
    localStorage.setItem("bsp_code", code);
  } catch (_) {}

  const requestedTotal = getSelectedBookCount();
  const res = await net.getOrCreateRoom(code, requestedTotal);
  if (res.error || !res.totalBooks) {
    el.lobbyError.textContent = "入室に失敗しました。通信環境を確認してもう一度試してください。";
    joining = false;
    el.joinBtn.disabled = false;
    el.publicBtn.disabled = false;
    return;
  }

  el.lobby.classList.add("hidden");
  el.gameUi.classList.remove("hidden");
  el.roomBadge.textContent = code === PUBLIC_ROOM_CODE
    ? `🌍 公開部屋（${res.totalBooks}冊）`
    : `部屋番号: ${code}（${res.totalBooks}冊）`;

  startGame({ myId: getMyId(), roomCode: code, name, totalBooks: res.totalBooks });
}

async function startGame({ myId, roomCode, name, totalBooks }) {
  const { layout, books } = createDefaultBooksForRoom(roomCode, totalBooks);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x11141a);
  scene.fog = new THREE.Fog(0x11141a, 24, 60);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 300);
  const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  buildEnvironment(scene, layout);

  const booksById = new Map();
  books.forEach((b) => booksById.set(b.id, b));

  // 触られたことのある本(held/placed)の差分を適用する
  const touched = await net.fetchRoomBookStates(roomCode);
  let placedCount = 0;
  const heldByPlayer = new Map(); // holderId -> bookId
  touched.forEach((row) => {
    const book = booksById.get(row.book_id);
    if (!book) return;
    if (row.state === "placed") {
      book.state = "placed";
      book.position = { ...book.home };
      placedCount++;
    } else if (row.state === "held") {
      book.state = "held";
      book.heldBy = row.holder_id;
      heldByPlayer.set(row.holder_id, row.book_id);
    }
  });

  const booksRenderer = new BooksRenderer(scene, books);
  const homeGlow = createHomeGlow(scene);

  const players = new Map(); // id -> { group, target, isLocal, color, name }

  function spawnPlayer(id, meta, isLocal) {
    if (players.has(id)) return players.get(id);
    const color = meta.color || pickColor(id);
    const group = createPlayerMesh(color, meta.name || "");
    const startX = meta.x != null ? meta.x : (Math.random() - 0.5) * 3;
    const startZ = meta.z != null ? meta.z : layout.BOUNDS.zMax - 1.5;
    group.position.set(startX, 0, startZ);
    group.rotation.y = meta.rotationY || Math.PI;
    scene.add(group);
    const entry = {
      group,
      target: { x: startX, z: startZ, rotationY: meta.rotationY || Math.PI },
      isLocal,
      color,
      name: meta.name || "名無し",
    };
    players.set(id, entry);
    updatePlayerList();
    return entry;
  }

  const localMeta = { name, color: pickColor(myId), x: (Math.random() - 0.5) * 3, z: layout.BOUNDS.zMax - 1.5, rotationY: Math.PI };
  const me = spawnPlayer(myId, localMeta, true);
  const localController = new LocalPlayerController(camera, me.group, layout.BOUNDS);

  let localHeldBookId = heldByPlayer.get(myId) ?? null;

  updateProgress();

  // ---- 本の状態変化(Supabase Realtime) ----
  net.subscribeBookChanges(roomCode, (payload) => {
    const bookId = payload.new && payload.new.book_id != null ? payload.new.book_id : (payload.old ? payload.old.book_id : null);
    if (bookId == null) return;
    const book = booksById.get(bookId);
    if (!book) return;

    if (payload.eventType === "DELETE") {
      const prevHolder = payload.old ? payload.old.holder_id : book.heldBy;
      if (prevHolder != null) heldByPlayer.delete(prevHolder);
      if (prevHolder === myId) localHeldBookId = null;
      book.state = "floor";
      book.heldBy = null;
      booksRenderer.syncBook(book);
      return;
    }

    const row = payload.new;
    if (row.state === "held") {
      book.state = "held";
      book.heldBy = row.holder_id;
      heldByPlayer.set(row.holder_id, bookId);
      if (row.holder_id === myId) localHeldBookId = bookId;
      booksRenderer.syncBook(book);
    } else if (row.state === "placed") {
      const prevHolder = book.heldBy;
      if (prevHolder != null) heldByPlayer.delete(prevHolder);
      if (prevHolder === myId || localHeldBookId === bookId) localHeldBookId = null;
      book.state = "placed";
      book.heldBy = null;
      book.position = { ...book.home };
      booksRenderer.syncBook(book);
      placedCount++;
      updateProgress();
      if (placedCount >= totalBooks) {
        el.winText.textContent = `みんなで${totalBooks}冊すべて本棚に戻しました！`;
        el.winOverlay.classList.remove("hidden");
      }
    }
  });

  // ---- プレイヤーの入退室・移動(broadcast/presence) ----
  let sawFirstSync = false;
  const live = net.joinRoomLive(roomCode, myId, localMeta, {
    onMove(payload) {
      const p = players.get(payload.id);
      if (!p || p.isLocal) return;
      p.target.x = payload.x;
      p.target.z = payload.z;
      p.target.rotationY = payload.rotationY;
    },
    onPresenceSync(state) {
      const onlineIds = new Set(Object.keys(state));
      for (const id of onlineIds) {
        if (id === myId) continue;
        const metas = state[id];
        const m = metas && metas[0] ? metas[0] : {};
        spawnPlayer(id, m, false);
      }
      // 誰も見ていない間に切断されたまま残っている「持ちっぱなし」を掃除する
      if (!sawFirstSync) {
        sawFirstSync = true;
        for (const [holderId] of heldByPlayer) {
          if (holderId !== myId && !onlineIds.has(holderId)) {
            net.releaseAllHeldBy(roomCode, holderId);
          }
        }
      }
      // いなくなったプレイヤーの描画を消す
      for (const [id, p] of players) {
        if (id !== myId && !onlineIds.has(id)) {
          scene.remove(p.group);
          players.delete(id);
        }
      }
      updatePlayerList();
    },
    onPresenceLeave(id) {
      const p = players.get(id);
      if (p) {
        scene.remove(p.group);
        players.delete(id);
        updatePlayerList();
      }
      net.releaseAllHeldBy(roomCode, id);
    },
  });

  window.addEventListener("pagehide", () => {
    if (localHeldBookId != null) net.releaseAllHeldBy(roomCode, myId);
  });

  // ---- インタラクト ----
  function nearestFloorBookId() {
    const px = me.group.position.x;
    const pz = me.group.position.z;
    let bestId = null;
    let bestDist = PICKUP_RADIUS;
    for (const book of booksById.values()) {
      if (book.state !== "floor") continue;
      const dx = book.position.x - px;
      const dz = book.position.z - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist) {
        bestDist = d;
        bestId = book.id;
      }
    }
    return bestId;
  }

  async function tryInteract() {
    if (localHeldBookId == null) {
      const bookId = nearestFloorBookId();
      if (bookId == null) return;
      await net.pickupBook(roomCode, bookId, myId);
    } else {
      await net.placeBook(roomCode, localHeldBookId, myId);
    }
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyE" && !e.repeat) tryInteract();
  });
  el.interactBtn.addEventListener("click", () => tryInteract());

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  function updatePrompt() {
    if (localHeldBookId != null) {
      const book = booksById.get(localHeldBookId);
      if (!book) return;
      const dx = book.home.x - me.group.position.x;
      const dz = book.home.z - me.group.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      homeGlow.show(book.home, book.width);
      el.prompt.textContent = d < PLACE_RADIUS ? "E : 本を棚に戻す" : "光っている場所まで本を運ぼう";
      el.prompt.classList.remove("hidden");
    } else {
      homeGlow.hide();
      const bookId = nearestFloorBookId();
      if (bookId != null) {
        el.prompt.textContent = "E : 本を拾う";
        el.prompt.classList.remove("hidden");
      } else {
        el.prompt.classList.add("hidden");
      }
    }
  }

  function updateProgress() {
    const pct = Math.min(100, Math.round((placedCount / totalBooks) * 100));
    el.progressFill.style.width = pct + "%";
    el.progressText.textContent = `${placedCount} / ${totalBooks} 冊`;
  }

  function updatePlayerList() {
    el.playerList.innerHTML = "";
    for (const [id, p] of players) {
      const row = document.createElement("div");
      row.className = "p";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = "#" + p.color.toString(16).padStart(6, "0");
      row.appendChild(dot);
      const label = document.createElement("span");
      label.textContent = p.name + (id === myId ? "（自分）" : "");
      row.appendChild(label);
      el.playerList.appendChild(row);
    }
  }

  const clock = new THREE.Clock();
  let moveSendTimer = 0;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;

    const moved = localController.update(dt);

    moveSendTimer += dt;
    if (moved && moveSendTimer >= MOVE_SEND_INTERVAL) {
      moveSendTimer = 0;
      live.sendMove({ x: me.group.position.x, z: me.group.position.z }, me.group.rotation.y);
    }

    for (const [id, p] of players) {
      if (p.isLocal) continue;
      p.group.position.x += (p.target.x - p.group.position.x) * Math.min(1, dt * 10);
      p.group.position.z += (p.target.z - p.group.position.z) * Math.min(1, dt * 10);
      let dRot = p.target.rotationY - p.group.rotation.y;
      dRot = Math.atan2(Math.sin(dRot), Math.cos(dRot));
      p.group.rotation.y += dRot * Math.min(1, dt * 10);
    }

    for (const [playerId, bookId] of heldByPlayer) {
      const p = players.get(playerId);
      if (!p) continue;
      const handPos = handWorldPosition(p.group);
      booksRenderer.updateHeldPosition(bookId, handPos, p.group.rotation.y);
    }

    homeGlow.pulse(t);
    updatePrompt();

    renderer.render(scene, camera);
  }
  animate();
}
