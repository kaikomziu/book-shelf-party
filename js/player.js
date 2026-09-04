import * as THREE from "https://esm.sh/three@0.160.0";

const MOVE_SPEED = 4.2;
const ROT_SPEED = 2.6;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export class LocalPlayerController {
  constructor(camera, playerGroup, bounds) {
    this.camera = camera;
    this.group = playerGroup;
    this.bounds = bounds;
    this.keys = new Set();
    this.enabled = true;

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
    // カメラが壁の外側に出て自キャラが壁の裏に隠れてしまわないよう、
    // プレイヤーの可動域と同じ範囲にカメラ位置もクランプする。
    desiredCamPos.x = clamp(desiredCamPos.x, this.bounds.xMin, this.bounds.xMax);
    desiredCamPos.z = clamp(desiredCamPos.z, this.bounds.zMin, this.bounds.zMax);
    const followT = 1 - Math.pow(0.0001, dt);
    this._camPos.lerp(desiredCamPos, followT);
    this.camera.position.copy(this._camPos);
    const lookTarget = this.group.position.clone().add(this.cameraLookOffset);
    this.camera.lookAt(lookTarget);

    return moved || rotDelta !== 0;
  }
}
