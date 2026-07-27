// Ambient background for the main game screen. Same visual language as the
// sign-in screen's streaks, but slower, sparser, and non-interactive —
// no pointer or keystroke listeners, it just drifts quietly behind the cards.

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const VOLT = "#f5d90a";
const STORM = "#5eead4";

export function createAmbientBackground(canvas) {
  const ctx = canvas.getContext("2d");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Phones get a much lighter version: fewer, smaller, fainter streaks.
  // This check runs once per session (re-evaluated each start()) and never
  // changes the desktop code path at all.
  const isNarrowScreen = () => window.matchMedia("(max-width: 640px)").matches;

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let streaks = [];
  let running = false;
  let frameId = null;
  let resizeObserver = null;
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

  function spawnStreak() {
    streaks.push({
      x: -20,
      y: Math.random() * height,
      speed: (mobile ? 0.35 : 0.5) + Math.random() * (mobile ? 0.7 : 1.2),
      char: randomChar(),
      life: 1,
      size: (mobile ? 9 : 12) + Math.random() * (mobile ? 5 : 8),
      color: Math.random() > 0.5 ? VOLT : STORM,
    });
  }

  function step() {
    if (!running) return;

    ctx.clearRect(0, 0, width, height);

    if (Math.random() < (mobile ? 0.045 : 0.1)) spawnStreak(); // sparser on phones

    streaks.forEach((s) => {
      s.x += s.speed;
      s.life -= 0.0035;
    });
    streaks = streaks.filter((s) => s.life > 0 && s.x < width + 40);

    for (const s of streaks) {
      ctx.globalAlpha = Math.max(s.life, 0) * (mobile ? 0.16 : 0.3); // fainter on phones
      ctx.fillStyle = s.color;
      ctx.font = `600 ${s.size}px "JetBrains Mono", monospace`;
      ctx.fillText(s.char, s.x, s.y);
    }
    ctx.globalAlpha = 1;

    frameId = requestAnimationFrame(step);
  }

  function drawStaticFrame() {
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = mobile ? 0.08 : 0.14;
    const count = mobile ? 8 : 16;
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? VOLT : STORM;
      ctx.font = `600 ${(mobile ? 9 : 12) + Math.random() * (mobile ? 5 : 8)}px "JetBrains Mono", monospace`;
      ctx.fillText(randomChar(), Math.random() * width, Math.random() * height);
    }
    ctx.globalAlpha = 1;
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

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(document.body);
    }

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
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  }

  return { start, stop };
}
