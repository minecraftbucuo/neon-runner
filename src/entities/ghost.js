// ---------- 联机幽灵车：远端玩家的半透明替身 ----------
// 纯展示实体：位置来自 net client 的插值快照（§7.2），不参与碰撞。
// 视图映射：障碍/玩家的屏幕 z = myDistance - trackPos，故幽灵屏幕 z = G.distance - 远端 z。
import * as THREE from 'three';
import { G } from '../core/state.js';

const PALETTE = [0xff5f9e, 0x9d6bff, 0x4fc3ff, 0xffd24a, 0x7dff8a, 0xff8a4f, 0xff4f6e, 0x4fe3ff];

export function createGhosts(scene, net) {
  const geo = new THREE.BoxGeometry(1.25, 1.25, 1.25);
  const edgeGeo = new THREE.EdgesGeometry(geo);

  /** @type {Map<string, {group, mat, edgeMat, color, label}>} */
  const cache = new Map();

  function makeLabel(name) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 36px "Ma Shan Zheng", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.shadowColor = 'rgba(0,0,0,.8)';
    ctx.shadowBlur = 6;
    ctx.fillText(name, 128, 46);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
    sp.scale.set(3.6, 0.9, 1);
    sp.position.y = 2.2;
    return sp;
  }

  function obtain(id, name) {
    let g = cache.get(id);
    if (!g) {
      const color = PALETTE[cache.size % PALETTE.length];
      const mat = new THREE.MeshStandardMaterial({
        color: 0x141428, emissive: color, emissiveIntensity: 0.8,
        metalness: 0.35, roughness: 0.35, transparent: true, opacity: 0.55,
        fog: false,   // 不受雾衰减：远处也能看到对手
      });
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.45,
      });
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geo, mat));
      group.children[0].add(new THREE.LineSegments(edgeGeo, edgeMat));
      group.add(makeLabel(name));
      group.visible = false;
      scene.add(group);
      g = { group, mat, edgeMat, color };
      cache.set(id, g);
    }
    return g;
  }

  function hideAll() {
    for (const g of cache.values()) g.group.visible = false;
  }

  function update(dt) {
    const active = G.gameMode === 'versus'
      && (G.mode === 'playing' || G.net.status === 'racing');
    if (!active) { hideAll(); return; }

    const now = performance.now();
    for (const p of G.net.roster) {
      if (p.id === G.net.myId) continue;
      const g = obtain(p.id, p.name);
      if (p.status === 'out') { g.group.visible = false; continue; }
      const s = net.sampleGhost(p.id, now);
      if (!s) { g.group.visible = false; continue; }

      // 屏幕坐标：z 轴与本地障碍同一映射（ ahead = 负）
      const zv = G.distance - s.z;
      if (zv < -95 || zv > 16) { g.group.visible = false; continue; }
      g.group.visible = true;

      // 位置平滑（与本地车的手感一致）
      const k = Math.min(1, dt * 12);
      g.group.position.z += (zv - g.group.position.z) * k;
      g.group.position.x += (s.x - g.group.position.x) * k;
      g.group.position.y = 1.0;

      // 状态表现：眩晕红闪、冲线淡出、跑动常亮
      if (s.st === 'stun') {
        g.mat.emissive.setHex(0xff2244);
        g.mat.emissiveIntensity = 1.2;
        g.mat.opacity = 0.3 + 0.3 * Math.abs(Math.sin(now / 70));
      } else if (s.st === 'fin') {
        g.mat.opacity = 0.18;
        g.mat.emissive.setHex(g.color);
        g.mat.emissiveIntensity = 0.5;
      } else {
        g.mat.emissive.setHex(g.color);
        g.mat.emissiveIntensity = 0.8;
        g.mat.opacity = 0.55;
      }
    }
  }

  return { update };
}
