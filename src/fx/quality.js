// ---------- 自适应分辨率：弱 GPU 自动降采样，算力富余再升回 ----------
// 集显扛不住「设备像素比 × MSAA」的填充率：起步封顶 1.5（检测到 Intel
// 核显则更保守），之后每秒统计一次——均值帧率低、或短时尖峰多，都算
// 压力信号按步长降 pixelRatio（最低 0.7）；持续流畅则缓慢回升
// （上限 min(设备DPR, 2)，独显/强集显最终回到原生清晰度）。
// 带冷却期，避免在阈值附近来回抖动。
export function createAdaptiveResolution(renderer) {
  const cap = Math.min(window.devicePixelRatio || 1, 2);
  let ratio = Math.min(cap, 1.5);
  try {
    // WebGL 调试信息里能拿到 GPU 型号：Intel 核显起步就压低一档，
    // 省掉开局几分钟的摸索期（之后自适应照常上调）
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/intel|uhd|iris/i.test(gpu)) ratio = Math.min(cap, 1.25);
  } catch { /* 拿不到 GPU 信息就走默认档 */ }

  let acc = 0, frames = 0, spikes = 0, cooldown = 4;  // 开局 4 秒宽限：躲开着色器编译卡顿

  renderer.setPixelRatio(ratio);

  return {
    /** 当前渲染比例（调试仪表用） */
    get ratio() { return ratio; },

    /** 每帧喂未钳制的原始帧长（tick 里的 dt 是钳制过的，不能用） */
    frame(rawDt) {
      if (document.hidden || rawDt <= 0 || rawDt > 0.25) return;  // 切后台回来的大帧不计
      acc += rawDt;
      frames++;
      if (rawDt > 0.025) spikes++;   // 单帧超 25ms（<40fps）记一次尖峰
      cooldown -= rawDt;
      if (acc < 1) return;
      const fps = frames / acc;
      // 均值还行但尖峰频繁（太阳掠过、冲刺视效等突发负载）同样要降档
      const underPressure = fps < 47 || spikes > 12;
      acc = 0; frames = 0; spikes = 0;
      if (cooldown > 0) return;
      if (underPressure && ratio > 0.7) {
        ratio = Math.max(0.7, ratio - 0.15);
        renderer.setPixelRatio(ratio);
        cooldown = 1.5;
      } else if (!underPressure && fps > 57 && ratio < cap) {
        ratio = Math.min(cap, ratio + 0.1);
        renderer.setPixelRatio(ratio);
        cooldown = 2.5;
      }
    },
  };
}

// ---------- 帧率小仪表（F 键开关）----------
// 左下角显示即时帧率与当前渲染比例：掉帧时能对上"是太阳掠过还是冲刺视效"，
// 也方便向别人描述问题时给出具体数字。
export function createFpsMeter(getRatio) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'left:10px', 'bottom:10px', 'z-index:99',
    'display:none', 'padding:4px 8px', 'border-radius:6px',
    'background:rgba(4,8,20,.72)', 'border:1px solid rgba(41,255,227,.35)',
    'color:#8ffef0', 'font:600 12px/1.5 Orbitron,monospace',
    'pointer-events:none', 'white-space:pre',
  ].join(';');
  document.body.appendChild(el);

  let on = false, acc = 0, frames = 0, worst = 0;

  return {
    toggle() {
      on = !on;
      el.style.display = on ? 'block' : 'none';
      if (!on) return;
      acc = 0; frames = 0; worst = 0;
    },
    /** 每帧喂未钳制的原始帧长 */
    frame(rawDt) {
      if (!on || document.hidden || rawDt <= 0 || rawDt > 0.25) return;
      acc += rawDt;
      frames++;
      if (rawDt > worst) worst = rawDt;
      if (acc < 0.5) return;
      const fps = Math.round(frames / acc);
      el.textContent = `${fps} fps · 渲染比例 ${getRatio().toFixed(2)} · 最差帧 ${(worst * 1000) | 0}ms`;
      acc = 0; frames = 0; worst = 0;
    },
  };
}
