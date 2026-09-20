import * as THREE from "https://esm.sh/three@0.160.0";

const MOVE_SPEED = 4.2;
const ROT_SPEED = 2.6;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// 線分(from→to)が軸並行の直方体(box)を貫通する場合、貫通し始める距離(0..segLen)を返す。
// 貫通しなければnull。カメラが本棚などの障害物の裏側に回り込むのを防ぐために使う。
function segmentBoxEntry(from, to, box) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (segLen < 1e-6) return null;
  const dir = [dx / segLen, dy / segLen, dz / segLen];
  const origin = [from.x, from.y, from.z];
  const bmin = [box.minX, box.minY, box.minZ];
  const bmax = [box.maxX, box.maxY, box.maxZ];
  let tmin = 0;
  let tmax = segLen;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-8) {
      if (origin[i] < bmin[i] || origin[i] > bmax[i]) return null;
      continue;
    }
    let t1 = (bmin[i] - origin[i]) / dir[i];
    let t2 = (bmax[i] - origin[i]) / dir[i];
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin >= 0 && tmin <= segLen ? tmin : null;
}

export class LocalPlayerController {
  constructor(camera, playerGroup, layout) {
    this.camera = camera;
    this.group = playerGroup;
    this.bounds = layout.BOUNDS;
    this.keys = new Set();
    this.enabled = true;

    // 本棚の裏側にプレイヤーが回り込んだとき、カメラが本棚を挟んで
    // 反対側に取り残されて視界が塞がれる(=自キャラが見えなくなる)のを防ぐための
    // 簡易的な衝突ボックス。
    const hw = layout.CASE_WIDTH / 2;
    const hd = layout.CASE_DEPTH / 2;
    this._obstacles = (layout.BOOKCASES || []).map((bc) => ({
      minX: bc.x - hw, maxX: bc.x + hw,
      minY: 0, maxY: layout.CASE_HEIGHT,
      minZ: bc.z - hd, maxZ: bc.z + hd,
    }));

    this.cameraOffset = new THREE.Vector3(0, 3.4, -5.6);
    this.cameraLookOffset = new THREE.Vector3(0, 1.2, 0);
    this._camPos = camera.position.clone();

    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => this.keys.clear());
  }

  update(dt) {
    let rotDelta = 0;
    if (this.enabled) {
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) rotDelta += ROT_SPEED * dt;
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) rotDelta -= ROT_SPEED * dt;
    }
    if (rotDelta !== 0) this.group.rotation.y += rotDelta;

    let moveDir = 0;
    if (this.enabled) {
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) moveDir += 1;
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) moveDir -= 1;
    }

    let moved = false;
    if (moveDir !== 0) {
      const forward = new THREE.Vector3(0, 0, 1).applyEuler(this.group.rotation);
      const nextX = this.group.position.x + forward.x * moveDir * MOVE_SPEED * dt;
      const nextZ = this.group.position.z + forward.z * moveDir * MOVE_SPEED * dt;
      this.group.position.x = clamp(nextX, this.bounds.xMin, this.bounds.xMax);
      this.group.position.z = clamp(nextZ, this.bounds.zMin, this.bounds.zMax);
      moved = true;
    }

    const rotatedOffset = this.cameraOffset.clone().applyEuler(new THREE.Euler(0, this.group.rotation.y, 0));
    const desiredCamPos = this.group.position.clone().add(rotatedOffset);
    // カメラが部屋の外側に出て自キャラが壁の裏に隠れてしまわないよう、
    // プレイヤーの可動域と同じ範囲にカメラ位置もクランプする。
    desiredCamPos.x = clamp(desiredCamPos.x, this.bounds.xMin, this.bounds.xMax);
    desiredCamPos.z = clamp(desiredCamPos.z, this.bounds.zMin, this.bounds.zMax);

    const lookTarget = this.group.position.clone().add(this.cameraLookOffset);

    // 本棚がプレイヤーとカメラの間に割り込んで視界を塞ぐ場合は、
    // 本棚の手前までカメラを引き寄せる(自キャラが見えなくなるのを防ぐ)。
    let nearestHit = null;
    for (const box of this._obstacles) {
      const t = segmentBoxEntry(lookTarget, desiredCamPos, box);
      if (t != null && (nearestHit == null || t < nearestHit)) nearestHit = t;
    }
    if (nearestHit != null) {
      const margin = 0.3;
      const fullDist = lookTarget.distanceTo(desiredCamPos);
      const safeDist = Math.max(0.6, Math.min(fullDist, nearestHit - margin));
      const dir = desiredCamPos.clone().sub(lookTarget).normalize();
      desiredCamPos.copy(lookTarget).addScaledVector(dir, safeDist);
    }

    const followT = 1 - Math.pow(0.0001, dt);
    this._camPos.lerp(desiredCamPos, followT);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(lookTarget);

    return moved || rotDelta !== 0;
  }
}
