// ---------- 拾取特效：金色扩散光环（环形对象池） ----------
import * as THREE from 'three';

const RING_TTL = 0.35;

export function createEffects(scene) {
  const N = 8;
  const geo = new THREE.TorusGeometry(0.55, 0.055, 10, 30);
  const rings = [];
  let idx = 0;

  for (let i = 0; i < N; i++) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xffd54a, transparent: true, opacity: 0,
    }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, life: -1 });
  }

  function popRing(x, y, z) {
    const r = rings[idx++ % N];
    r.life = 0;
    r.mesh.visible = true;
    r.mesh.position.set(x, y, z);
    r.mesh.scale.set(1, 1, 1);
    r.mesh.material.opacity = 1;
  }

  function update(dt) {
    for (const r of rings) {
      if (r.life < 0) continue;
      r.life += dt;
      const k = r.life / RING_TTL;
      if (k >= 1) { r.life = -1; r.mesh.visible = false; continue; }
      const s = 1 + k * 2.6;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = 1 - k;
    }
  }

  function clear() {
    for (const r of rings) { r.life = -1; r.mesh.visible = false; }
  }

  return { popRing, update, clear };
}
