// ---------- 巨型太阳掠过系统（初始版本） ----------
// 按行驶距离周期性让太阳从赛道远方上空掠过：
//   · 表面 = GPU 火焰噪声着色器（3D 球面噪声，无接缝）
//   · 日冕 = 两层圆形辉光
//   · 运动 = 与赛道平行的固定直线（x/y 锁死），z 随车速视差后掠 ——
//     出生在深空远处的小亮点，因为玩家在跑才慢慢变大，靠近后加速膨大
//   · 氛围 = 近距离时屏幕边缘涌入红光 + 镜头微震
import * as THREE from 'three';

const SUN_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SUN_FRAG = `
precision highp float;
uniform float uTime;
uniform float uFade;
varying vec3 vDir;

float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  return mix(
    mix(mix(hash13(i), hash13(i+vec3(1,0,0)), u.x),
        mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,0,0)), u.x), u.y),
    mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), u.x),
        mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), u.x), u.y),
    u.z);
}
float fbm(vec3 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<4;i++){ v += a*vnoise(p); p = p*2.05 + vec3(11.3,7.9,3.1); a *= 0.55; }
  return v;
}

void main(){
  vec3 d = normalize(vDir);
  // 两层不同尺度、缓慢相向流动的湍流（物体空间 → 自转时表面跟着转）
  float n1 = fbm(d*4.5 + vec3(uTime*0.06, uTime*0.04, -uTime*0.03));
  float n2 = fbm(d*12.0 - vec3(uTime*0.09, 0.0, uTime*0.05));
  float heat = n1*0.58 + n2*0.42;

  vec3 col = mix(vec3(0.95,0.26,0.01), vec3(1.0,0.82,0.28), smoothstep(0.24,0.86,heat));
  col += vec3(1.0,0.97,0.80) * pow(max(heat-0.76,0.0)*4.6, 1.4);   // 白炽耀斑
  col *= 0.90 + 0.22*n2;                                            // 明暗起伏
  gl_FragColor = vec4(col, uFade);
}`;

export function createSun(scene) {
  const RADIUS = 26;
  // 轨道：与赛道平行的固定直线（x/y 锁死），出生在 z=-560 的深空
  const ORBIT = { x: 80, y: 64, z: -560, vzMul: 0.38 };
  const DESPAWN_Z = 34;

  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // 太阳本体：火焰着色器球
  const sunMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
    vertexShader: SUN_VERT,
    fragmentShader: SUN_FRAG,
    fog: false, transparent: true,
  });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 64, 40), sunMat);
  group.add(sun);

  const glowMats = [sunMat];

  // 全屏红光氛围层
  const $fx = document.getElementById('celestialFx');

  let active = false;
  let side = 1;
  let countdown = 200;      // 距下次太阳出现的行驶距离（首颗尽快登场）

  function spawn() {
    side *= -1;             // 左右交替出现
    group.position.set(side * ORBIT.x, ORBIT.y, ORBIT.z);
    group.visible = true;
    active = true;
    setFade(0);
  }

  function setFade(k) {
    for (const m of glowMats) {
      if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity ?? 1;
      if (m.uniforms && m.uniforms.uFade) m.uniforms.uFade.value = m.userData.baseOpacity * k;
      else m.opacity = m.userData.baseOpacity * k;
    }
  }

  function update(dt, t, speed, inRun) {
    if (!active) {
      if (inRun) {
        countdown -= speed * dt;
        if (countdown <= 0) spawn();
      }
      return;
    }

    // 纯视差推进：只动 z，速率与玩家车速同源；x/y 全程锁死
    group.position.z += speed * ORBIT.vzMul * dt;
    const z0 = group.position.z;

    sunMat.uniforms.uTime.value = t;      // 表面火焰流动
    sun.rotation.y += dt * 0.05;          // 缓慢自转

    // 深空小亮点起步，前 62% 行程缓慢显形，掠过身后隐去
    const span = (DESPAWN_Z - ORBIT.z) * 0.62;
    const fadeIn = Math.pow(Math.min(1, (z0 - ORBIT.z) / span), 2.0);
    const fadeOut = Math.min(1, (DESPAWN_Z - z0) / 18);
    setFade(Math.max(0, Math.min(fadeIn, fadeOut)));

    // 近距离威慑：红光涌屏 + 镜头微震
    const closeK = Math.max(0, 1 - Math.abs(z0 + 34) / 100);
    if (closeK > 0) {
      G_shakePulse(closeK * 0.34);
      $fx.classList.add('on');
    } else {
      $fx.classList.remove('on');
    }

    if (z0 > DESPAWN_Z) {
      group.visible = false;
      active = false;
      $fx.classList.remove('on');
      countdown = 300 + Math.random() * 200;
    }
  }

  // 供外部注入的震动回调（controller 设置，避免循环依赖）
  let G_shakePulse = () => {};
  function onShake(fn) { G_shakePulse = fn; }

  return { update, onShake };
}
