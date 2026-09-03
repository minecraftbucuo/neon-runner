// ---------- 程序化宇宙天空穹 ----------
// 性能策略：原实现每帧对全屏每个像素跑 4 八度 3D 噪声 + 程序化星星，
// 集显上这是最大的单帧开销（而且先画满屏、再被赛道盖掉一大半）。
// 现改为开局把穹顶一次性烘进立方体贴图充当 scene.background —— 主循环
// 每帧只采样贴图；星星整体密度由烘焙保证（与原版同款双层星场），
// 闪烁的"活感"由少量点精灵（Points）叠加补回，观感与帧成本双赢。
import * as THREE from 'three';

const VERT = `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// 烘焙用：与原版同一套 shader（uTime 固定 0，星星亮度随机相位定格）
const FRAG = `
precision highp float;
uniform float uTime;
varying vec3 vPos;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// 3D 值噪声（trilinear）
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), u.x),
        mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x),
        mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y),
    u.z);
}

// 4 个八度的分形噪声，做星云
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec3(17.1, 9.2, 4.7);
    a *= 0.55;
  }
  return v;
}

// 一层程序化星星（cell 哈希 → 稀疏亮点）
vec3 starLayer(vec3 dir, float scale, float density, float bright) {
  vec3 g = dir * scale;
  vec3 id = floor(g);
  float h = hash13(id);
  if (h > density) return vec3(0.0);
  vec3 offs = vec3(hash13(id + 19.19), hash13(id + 47.7), hash13(id + 83.13)) - 0.5;
  float d = length(fract(g) - 0.5 - offs * 0.6);
  float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 4.0) + h * 91.0);
  float core  = smoothstep(0.11, 0.0, d);
  float glow  = smoothstep(0.30, 0.0, d) * 0.30;
  vec3 tint = mix(vec3(1.0), vec3(0.62, 0.84, 1.0), step(0.72, h));
  tint = mix(tint, vec3(1.0, 0.80, 0.55), step(0.90, h));
  float variety = smoothstep(density, density * 0.30, h);
  return tint * (core * 1.25 + glow) * bright * tw * variety;
}

void main() {
  vec3 dir = normalize(vPos);

  // 深空底色：越靠近地平线越亮一点
  float horiz = exp(-abs(dir.y) * 5.5);
  vec3 col = mix(vec3(0.008, 0.010, 0.022), vec3(0.002, 0.003, 0.008), smoothstep(-0.1, 0.6, dir.y));
  col += horiz * vec3(0.016, 0.032, 0.048);

  // 银河带：一条倾斜的大圆带
  float band = pow(max(0.0, 1.0 - abs(dot(dir, normalize(vec3(0.25, 0.88, 0.38))))), 2.2);

  // 星云：多层噪声塑形，银河带内更浓
  float n1 = fbm(dir * 2.7);
  float neb = smoothstep(0.50, 0.92, n1);
  neb = neb * (0.35 + 0.65 * band);
  vec3 nebCol = mix(vec3(0.16, 0.07, 0.30), vec3(0.04, 0.18, 0.30), vnoise(dir * 1.7 + 5.0));
  nebCol = mix(nebCol, vec3(0.30, 0.09, 0.20), vnoise(dir * 1.3 - 3.0));
  col += nebCol * neb * 0.9;

  // 星星：稀疏亮星 + 密集暗星（银河带内加密）——密度与原版一致
  col += starLayer(dir, 24.0, 0.055, 1.35);
  col += starLayer(dir, 70.0, 0.28, 0.5) * (0.7 + 0.6 * band);

  // 银河带整体微光
  col += vec3(0.05, 0.06, 0.11) * band * (0.4 + 0.3 * n1);

  gl_FragColor = vec4(col, 1.0);
}`;

// 闪烁星层：只负责"眨眼"的活感，整体密度由烘焙星场保证
const STARS_BRIGHT = 320;
const STARS_FAINT = 1400;
const SKY_R = 62;

/** 微型圆形软光斑贴图：点精灵用，避免方形像素闪烁 */
let starDot = null;
function getStarDot() {
  if (starDot) return starDot;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  starDot = new THREE.CanvasTexture(c);
  return starDot;
}

function makeStarField(scene, count, sizePx, opacity, brightMin, brightMax, fadeMax) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const base = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const fade = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // 球面均匀分布
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3]     = s * Math.cos(a) * SKY_R;
    pos[i * 3 + 1] = u * SKY_R;
    pos[i * 3 + 2] = s * Math.sin(a) * SKY_R;
    const h = Math.random();
    const tint = h < 0.75 ? [1, 1, 1] : h < 0.9 ? [0.62, 0.84, 1] : [1, 0.80, 0.55];
    const b = brightMin + Math.random() * (brightMax - brightMin);
    base[i * 3] = tint[0] * b; base[i * 3 + 1] = tint[1] * b; base[i * 3 + 2] = tint[2] * b;
    phase[i] = Math.random() * Math.PI * 2;
    fade[i] = 0.5 + Math.random() * fadeMax;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: sizePx, sizeAttenuation: false, map: getStarDot(), vertexColors: true,
    transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return { geo, pos: col, base, phase, fade, points };
}

export function createSpace(scene, camera, renderer) {
  const geo = new THREE.SphereGeometry(70, 40, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  dome.layers.set(1);   // 只给烘焙立方相机（layer 1）渲染；主相机不再逐像素画它
  scene.add(dome);

  // 烘焙目标：一张立方体贴图。星星(尤其密集暗星)偏细小，取 1024 保证
  // 清晰度；代价只是开机时一次性烘焙多花几十毫秒，每帧成本不变。
  const cubeRT = new THREE.WebGLCubeRenderTarget(1024, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCam = new THREE.CubeCamera(0.5, 200, cubeRT);
  cubeCam.children.forEach((c) => c.layers.set(1));
  scene.add(cubeCam);

  const bright = makeStarField(scene, STARS_BRIGHT, 2.6, 0.95, 0.7, 1.25, 4.5);
  const faint  = makeStarField(scene, STARS_FAINT, 2.0, 0.5, 0.22, 0.55, 1.2);
  const starFields = [bright, faint];

  let baked = false;
  function bake() {
    mat.uniforms.uTime.value = 0;
    cubeCam.update(renderer, scene);   // 场景里只有穹顶在 layer 1
    scene.background = cubeRT.texture;
    scene.remove(dome, cubeCam);
    geo.dispose();
    mat.dispose();
    baked = true;
  }

  function update(dt, t) {
    if (!baked) bake();
    // 星空跟随相机（与原穹顶行为一致）；逐帧调制度走 CPU，量小可忽略
    for (const f of starFields) {
      f.points.position.copy(camera.position);
      const col = f.geo.attributes.color.array;
      for (let i = 0; i < col.length / 3; i++) {
        const tw = 0.55 + 0.45 * Math.sin(t * f.fade[i] + f.phase[i]);
        col[i * 3] = f.base[i * 3] * tw;
        col[i * 3 + 1] = f.base[i * 3 + 1] * tw;
        col[i * 3 + 2] = f.base[i * 3 + 2] * tw;
      }
      f.geo.attributes.color.needsUpdate = true;
    }
  }

  return { update };
}
