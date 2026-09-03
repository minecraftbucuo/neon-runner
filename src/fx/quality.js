// ---------- 自适应分辨率：弱 GPU 自动降采样，算力富余再升回 ----------
// 集显扛不住「设备像素比 × MSAA」的填充率：起步封顶 1.5，之后每秒统计
// 一次帧率——低于阈值按步长降 pixelRatio（最低 0.7），高于阈值缓慢回升
// （上限 min(设备DPR, 2)，独显/强集显最终回到原生清晰度）。
// 带冷却期，避免在阈值附近来回抖动。
export function createAdaptiveResolution(renderer) {
  const cap = Math.min(window.devicePixelRatio || 1, 2);
  let ratio = Math.min(cap, 1.5);
  let acc = 0, frames = 0, cooldown = 4;  // 开局 4 秒宽限：躲开着色器编译卡顿

  renderer.setPixelRatio(ratio);

  return {
    /** 每帧喂未钳制的原始帧长（tick 里的 dt 是钳制过的，不能用） */
    frame(rawDt) {
      if (document.hidden || rawDt <= 0 || rawDt > 0.25) return;  // 切后台回来的大帧不计
      acc += rawDt;
      frames++;
      cooldown -= rawDt;
      if (acc < 1) return;
      const fps = frames / acc;
      acc = 0; frames = 0;
      if (cooldown > 0) return;
      if (fps < 47 && ratio > 0.7) {
        ratio = Math.max(0.7, ratio - 0.15);
        renderer.setPixelRatio(ratio);
        cooldown = 1.5;
      } else if (fps > 57 && ratio < cap) {
        ratio = Math.min(cap, ratio + 0.1);
        renderer.setPixelRatio(ratio);
        cooldown = 2.5;
      }
    },
  };
}
