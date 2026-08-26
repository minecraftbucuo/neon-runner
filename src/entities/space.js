// ---------- 程序化宇宙天空穹 ----------
// 一整块大球以 shader 实时生成：深空渐变 + 银河带 + 噪声星云 + 两层程序化星星。
// 天空球跟随相机、雾外渲染、最先绘制，赛道/护栏自然遮住它 → 真实深度感。
import * as THREE from 'three';

const VERT = `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

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
  float n1 = fbm(dir * 2.7 + vec3(0.0, uTime * 0.006, 0.0));
  float neb = smoothstep(0.50, 0.92, n1);
  neb = neb * (0.35 + 0.65 * band);
  vec3 nebCol = mix(vec3(0.16, 0.07, 0.30), vec3(0.04, 0.18, 0.30), vnoise(dir * 1.7 + 5.0));
  nebCol = mix(nebCol, vec3(0.30, 0.09, 0.20), vnoise(dir * 1.3 - 3.0));
  col += nebCol * neb * 0.9;

  // 星星：稀疏亮星 + 密集暗星（银河带内加密）
  col += starLayer(dir, 24.0, 0.055, 1.35);
  col += starLayer(dir, 70.0, 0.28, 0.5) * (0.7 + 0.6 * band);

  // 银河带整体微光
  col += vec3(0.05, 0.06, 0.11) * band * (0.4 + 0.3 * n1);

  gl_FragColor = vec4(col, 1.0);
}`;

export function createSpace(scene, camera) {
  const geo = new THREE.SphereGeometry(70, 40, 24);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  // 不透明队列 + 最先绘制：轨道等后续物体会自然盖住天空
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  function update(dt, t) {
    mat.uniforms.uTime.value = t;
    dome.position.copy(camera.position); // 天空穹始终包裹相机
  }

  return { update };
}
