import * as THREE from "https://esm.sh/three@0.160.0";

export function buildEnvironment(scene, layout) {
  const { ROOM, BOOKCASES, CASE_WIDTH, CASE_DEPTH, SHELVES_PER_CASE, SHELF_Y_START, SHELF_Y_STEP } = layout;
  const depth = ROOM.zMax - ROOM.zMin;
  const centerZ = (ROOM.zMax + ROOM.zMin) / 2;

  const floorGeo = new THREE.PlaneGeometry(ROOM.width, depth);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.95 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, centerZ);
  scene.add(floor);

  const rugGeo = new THREE.PlaneGeometry(ROOM.width * 0.5, Math.min(14, depth * 0.4));
  const rugMat = new THREE.MeshStandardMaterial({ color: 0x7a2e2e, roughness: 1 });
  const rug = new THREE.Mesh(rugGeo, rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, ROOM.zMax - 8);
  scene.add(rug);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2f333d });
  const wallHeight = 4.5;
  const wallThickness = 0.4;
  function addWall(x, z, w, d) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallHeight, d), wallMat);
    wall.position.set(x, wallHeight / 2, z);
    scene.add(wall);
  }
  addWall(0, ROOM.zMin - wallThickness / 2, ROOM.width + wallThickness * 2, wallThickness);
  addWall(0, ROOM.zMax + wallThickness / 2, ROOM.width + wallThickness * 2, wallThickness);
  addWall(-ROOM.width / 2 - wallThickness / 2, centerZ, wallThickness, depth);
  addWall(ROOM.width / 2 + wallThickness / 2, centerZ, wallThickness, depth);

  const caseMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.85 });
  const caseHeight = SHELF_Y_START + (SHELVES_PER_CASE - 1) * SHELF_Y_STEP + 0.65;
  for (const bc of BOOKCASES) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(CASE_WIDTH, caseHeight, CASE_DEPTH), caseMat);
    back.position.set(bc.x, caseHeight / 2, bc.z);
    scene.add(back);

    const sideGeo = new THREE.BoxGeometry(0.08, caseHeight, CASE_DEPTH);
    const left = new THREE.Mesh(sideGeo, caseMat);
    left.position.set(bc.x - CASE_WIDTH / 2, caseHeight / 2, bc.z);
    scene.add(left);
    const right = new THREE.Mesh(sideGeo, caseMat);
    right.position.set(bc.x + CASE_WIDTH / 2, caseHeight / 2, bc.z);
    scene.add(right);

    for (let s = 0; s < SHELVES_PER_CASE; s++) {
      const y = SHELF_Y_START + s * SHELF_Y_STEP - 0.06;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(CASE_WIDTH, 0.05, CASE_DEPTH + 0.08), caseMat);
      plank.position.set(bc.x, y, bc.z);
      scene.add(plank);
    }
  }

  scene.add(new THREE.AmbientLight(0xfff2e0, 0.6));
  const dir = new THREE.DirectionalLight(0xfff2d9, 0.85);
  dir.position.set(10, 18, centerZ + 10);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x8ea9ff, 0.25);
  fill.position.set(-8, 10, centerZ - 6);
  scene.add(fill);
}

const BOOK_BASE_SIZE = { w: 0.1, h: 0.26, d: 0.17 };

export class BooksRenderer {
  constructor(scene, books) {
    this.count = books.length;
    this.geometry = new THREE.BoxGeometry(BOOK_BASE_SIZE.w, BOOK_BASE_SIZE.h, BOOK_BASE_SIZE.d);
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this._dummy = new THREE.Object3D();
    this._byId = new Map();
    books.forEach((b) => {
      this._byId.set(b.id, b);
      this._applyTransform(b.id, b.position, b.width);
      this._applyColor(b.id, b.color);
    });
  }

  _applyTransform(id, pos, width) {
    this._dummy.position.set(pos.x, pos.y != null ? pos.y : 0.15, pos.z);
    this._dummy.rotation.set(0, pos.rotationY || 0, 0);
    const wScale = (width || BOOK_BASE_SIZE.w) / BOOK_BASE_SIZE.w;
    this._dummy.scale.set(wScale, 1, 1);
    this._dummy.updateMatrix();
    this.mesh.setMatrixAt(id, this._dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _applyColor(id, color) {
    this.mesh.setColorAt(id, new THREE.Color(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  getBook(id) {
    return this._byId.get(id);
  }

  allBooks() {
    return this._byId.values();
  }

  // 床/設置状態の本を、最新データで再配置する
  syncBook(book) {
    this._byId.set(book.id, book);
    if (book.state === "held") return; // 追従はupdateHeldPositionが毎フレーム担当
    this._applyTransform(book.id, book.position, book.width);
  }

  // 誰かに持たれている本を、その手の位置に毎フレーム追従させる
  updateHeldPosition(bookId, worldPos, rotationY) {
    const book = this._byId.get(bookId);
    this._applyTransform(bookId, { x: worldPos.x, y: worldPos.y, z: worldPos.z, rotationY }, book ? book.width : null);
  }
}

export function createHomeGlow(scene) {
  const geo = new THREE.BoxGeometry(0.16, 0.34, 0.24);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  scene.add(mesh);

  const light = new THREE.PointLight(0xffe066, 0, 3.2, 2);
  scene.add(light);

  let baseScale = [1, 1, 1];

  return {
    show(home, width) {
      mesh.position.set(home.x, home.y, home.z);
      mesh.rotation.y = home.rotationY || 0;
      const wScale = ((width || BOOK_BASE_SIZE.w) / BOOK_BASE_SIZE.w) * 1.7;
      baseScale = [wScale, 1.2, 1.35];
      mesh.scale.set(...baseScale);
      mesh.visible = true;
      light.position.set(home.x, home.y + 0.15, home.z + 0.35);
      light.intensity = 1.6;
    },
    hide() {
      mesh.visible = false;
      light.intensity = 0;
    },
    pulse(t) {
      if (!mesh.visible) return;
      const s = 1 + Math.sin(t * 6) * 0.08;
      mesh.scale.set(baseScale[0] * s, baseScale[1] * s, baseScale[2] * s);
    },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function createNameSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.5, 0.38, 1);

  sprite.userData.setText = (t) => {
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = "rgba(20,22,27,0.78)";
    roundRect(ctx, 4, 12, 248, 40, 10);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t, 128, 32);
    texture.needsUpdate = true;
  };
  sprite.userData.setText(text);
  return sprite;
}

export function createPlayerMesh(color, name) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.75, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
  );
  body.position.y = 0.75;
  group.add(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.28, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.85, 0.32);
  group.add(nose);

  const sprite = createNameSprite(name || "");
  sprite.position.y = 1.75;
  group.add(sprite);
  group.userData.nameSprite = sprite;

  return group;
}

export function handWorldPosition(playerGroup) {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(playerGroup.quaternion);
  const pos = playerGroup.position.clone();
  pos.addScaledVector(forward, 0.5);
  pos.y = 1.05;
  return pos;
}
