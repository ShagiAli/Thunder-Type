// Interactive background for the sign-in screen. Streaks of monospace
// characters flow left-to-right like fast-moving keystrokes. Moving the
// mouse spawns streaks at the pointer; typing in the name field spawns a
// burst and temporarily speeds everything up, faster typing = faster burst,
// so the background literally demonstrates what it's advertising.

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const VOLT = "#f5d90a";
const STORM = "#5eead4";

export function createSigninBackground(canvas, nameInput) {
  const ctx = canvas.getContext("2d");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Phones have far less screen area, so the same per-frame spawn rate as
  // desktop reads as visual clutter there. Scale it down — desktop behavior
  // (mobile === false) is untouched.
  const isNarrowScreen = () => window.matchMedia("(max-width: 640px)").matches;

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let streaks = [];
  let running = false;
  let frameId = null;
  let speedBoost = 0; // rises on keystrokes/mouse activity, decays each frame
  let lastKeyTime = 0;
  let mobile = false;

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function randomChar() {
    return CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }

  function spawnStreak(originX, originY, fast = false) {
    const hasOrigin = originX !== undefined;
    streaks.push({
      x: hasOrigin ? originX : -20,
      y: hasOrigin ? originY : Math.random() * height,
      speed: (fast ? 9 : hasOrigin ? 6 : 2.2) + Math.random() * 4,
      char: randomChar(),
      life: 1,
      size: (mobile ? 10 : 13) + Math.random() * (mobile ? 7 : 11),
      color: Math.random() > 0.5 ? VOLT : STORM,
    });
  }

  function spawnBurst(x, y, count) {
    const actual = mobile ? Math.min(count, 3) : count;
    for (let i = 0; i < actual; i++) {
      spawnStreak(x, y + (Math.random() - 0.5) * 40, true);
    }
  }

  function step() {
    if (!running) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(11, 10, 31, 0.22)";
    ctx.fillRect(0, 0, width, height);

    const spawnChance = (mobile ? 0.18 : 0.5) + speedBoost * (mobile ? 0.8 : 2);
    if (Math.random() < spawnChance) spawnStreak();
    speedBoost *= 0.93;

    streaks.forEach((s) => {
      s.x += s.speed * (1 + speedBoost * 3);
      s.life -= 0.006;
    });
    streaks = streaks.filter((s) => s.life > 0 && s.x < width + 40);

    for (const s of streaks) {
      ctx.globalAlpha = Math.max(s.life, 0) * (mobile ? 0.65 : 1);
      ctx.fillStyle = s.color;
      ctx.font = `600 ${s.size}px "JetBrains Mono", monospace`;
      ctx.fillText(s.char, s.x, s.y);
    }
    ctx.globalAlpha = 1;

    frameId = requestAnimationFrame(step);
  }

  function drawStaticFrame() {
    // Reduced-motion fallback: one calm, non-animated frame instead of a loop.
    ctx.fillStyle = "#0b0a1f";
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = mobile ? 0.3 : 0.5;
    const count = mobile ? 14 : 30;
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? VOLT : STORM;
      ctx.font = `600 ${(mobile ? 10 : 12) + Math.random() * (mobile ? 7 : 10)}px "JetBrains Mono", monospace`;
      ctx.fillText(randomChar(), Math.random() * width, Math.random() * height);
    }
    ctx.globalAlpha = 1;
  }

  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    if (Math.random() < 0.35) {
      spawnStreak(e.clientX - rect.left, e.clientY - rect.top);
    }
  }

  function onKeystroke() {
    const now = performance.now();
    const gap = now - lastKeyTime;
    lastKeyTime = now;
    // Shorter gap between keystrokes = bigger burst = visibly "faster writing".
    const intensity = gap > 0 && gap < 600 ? Math.min(6, Math.round(600 / gap)) : 2;
    speedBoost = Math.min(1, speedBoost + 0.25);

    const rect = nameInput.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    spawnBurst(rect.left - canvasRect.left + rect.width / 2, rect.top - canvasRect.top, intensity);
  }

  function onResize() {
    resize();
  }

  function start() {
    if (running) return;
    running = true;
    mobile = isNarrowScreen();
    resize();
    streaks = [];
    window.addEventListener("resize", onResize);
    canvas.addEventListener("pointermove", onPointerMove);
    nameInput.addEventListener("input", onKeystroke);

    if (prefersReducedMotion) {
      drawStaticFrame();
    } else {
      frameId = requestAnimationFrame(step);
    }
  }

  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = null;
    window.removeEventListener("resize", onResize);
    canvas.removeEventListener("pointermove", onPointerMove);
    nameInput.removeEventListener("input", onKeystroke);
  }

  return { start, stop };
}
