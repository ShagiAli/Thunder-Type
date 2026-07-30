// Wires DOM events to GameState + the backend API. No game math lives here —
// see static/js/stats.js and static/js/gameState.js for that.

import { GameState } from "./gameState.js";
import { accuracyColorBucket } from "./stats.js";
import { authenticate, loadTexts, saveStats } from "./api.js";
import { createSigninBackground } from "./signinBackground.js";
import { createAmbientBackground } from "./ambientBackground.js";

const MAX_LEVEL = 10;

// Used only if the backend can't be reached (see init()'s catch branch).
const FALLBACK_LEVELS = [
  { level: 1, texts: ["Cats sleep a lot.", "The sun is hot."] },
  { level: 2, texts: ["The dog ran fast down the street."] },
  { level: 3, texts: ["Clean code is simple, clear, and easy to maintain."] },
  { level: 4, texts: ["Practice every day and your typing speed will improve."] },
  { level: 5, texts: ["Programming means telling a computer exactly what to do."] },
];

const els = {
  appRoot: document.getElementById("appRoot"),
  mainCanvas: document.getElementById("mainCanvas"),
  signinOverlay: document.getElementById("signinOverlay"),
  signinCanvas: document.getElementById("signinCanvas"),
  signinForm: document.getElementById("signinForm"),
  signinName: document.getElementById("signinName"),
  signinPassword: document.getElementById("signinPassword"),
  signinError: document.getElementById("signinError"),
  playerGreeting: document.getElementById("playerGreeting"),
  levelTrack: document.getElementById("levelTrack"),
  levelPill: document.getElementById("levelPill"),
  promptCard: document.getElementById("promptCard"),
  promptText: document.getElementById("promptText"),
  typeInput: document.getElementById("typeInput"),
  voltageFill: document.getElementById("voltageFill"),
  statWpm: document.getElementById("statWpm"),
  statAccuracy: document.getElementById("statAccuracy"),
  statTime: document.getElementById("statTime"),
  comboLine: document.getElementById("comboLine"),
  statusLine: document.getElementById("statusLine"),
  btnNextLevel: document.getElementById("btnNextLevel"),
  btnReset: document.getElementById("btnReset"),
  btnProfile: document.getElementById("btnProfile"),
  btnTheme: document.getElementById("btnTheme"),
  profileOverlay: document.getElementById("profileOverlay"),
  btnCloseProfile: document.getElementById("btnCloseProfile"),
  btnSwitchUser: document.getElementById("btnSwitchUser"),
  profileName: document.getElementById("profileName"),
  levelCompleteOverlay: document.getElementById("levelCompleteOverlay"),
  completeTitle: document.getElementById("completeTitle"),
  completeSubtitle: document.getElementById("completeSubtitle"),
  completeWpm: document.getElementById("completeWpm"),
  completeAccuracy: document.getElementById("completeAccuracy"),
  completeTime: document.getElementById("completeTime"),
  completeCombo: document.getElementById("completeCombo"),
  completeNote: document.getElementById("completeNote"),
  btnCompleteReset: document.getElementById("btnCompleteReset"),
  btnCompleteNext: document.getElementById("btnCompleteNext"),
  profileBestWpm: document.getElementById("profileBestWpm"),
  profileBestAccuracy: document.getElementById("profileBestAccuracy"),
  profileMaxCombo: document.getElementById("profileMaxCombo"),
  profileRounds: document.getElementById("profileRounds"),
};

const state = new GameState();
const signinBg = createSigninBackground(els.signinCanvas, els.signinName);
const ambientBg = createAmbientBackground(els.mainCanvas);
let levels = [];
let playerName = "";
let currentPassword = ""; // kept in memory only for the duration of the session, used to authorize saves
let currentLevel = 1;
let comboBeforeLevel = 0;
let pendingGreeting = null;
let tickHandle = null;
let backendAvailable = true;

const SESSION_KEY = "thunderType.session";

// NOTE ON TRADEOFF: storing the password here (not just the name) is what
// lets a page refresh keep you signed in without re-typing it, matching
// the existing refresh behavior. It sits in sessionStorage — tied to this
// browser tab, cleared when the tab closes, never sent anywhere except
// back to this same origin's API. For a casual project this is a
// reasonable tradeoff; if you want stricter behavior (re-enter password
// on every refresh), stop storing `password` here and prompt for it again
// in enterGameAs() instead.

function saveSession(name, password) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name, password }));
  } catch (err) {
    console.warn("Thunder Type: couldn't save session (storage may be blocked by browser privacy settings):", err);
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (err) {
    console.warn("Thunder Type: couldn't clear session:", err);
  }
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    console.log("Thunder Type: session check on load ->", raw ? "found saved session" : "none found");
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn("Thunder Type: couldn't read session (storage may be blocked by browser privacy settings):", err);
    return null;
  }
}

async function init() {
  try {
    levels = await loadTexts();
  } catch (err) {
    // Backend not reachable (e.g. opened as a raw file instead of via
    // `python server.py`) — fall back to built-in defaults so the game
    // still works, just without persistence.
    console.warn("Could not reach backend, running without persistence:", err);
    backendAvailable = false;
    levels = FALLBACK_LEVELS;
    els.statusLine.textContent = "Running without a backend — scores won't be saved this session.";
  }

  bindEvents();

  const saved = readSession();
  if (saved && saved.name && saved.password) {
    await enterGameAs(saved.name, saved.password, { silent: true });
  } else {
    showSignIn();
  }
}

function bindEvents() {
  els.signinForm.addEventListener("submit", onSignIn);
  els.signinName.addEventListener("input", () => {
    if (els.signinName.value.trim()) {
      els.signinName.parentElement.classList.remove("has-error");
    }
    if (els.signinName.value.trim() && els.signinPassword.value) {
      els.signinError.hidden = true;
    }
  });
  els.signinPassword.addEventListener("input", () => {
    if (els.signinPassword.value) {
      els.signinPassword.parentElement.classList.remove("has-error");
    }
    if (els.signinName.value.trim() && els.signinPassword.value) {
      els.signinError.hidden = true;
    }
  });
  els.btnNextLevel.addEventListener("click", nextLevel);
  els.btnReset.addEventListener("click", resetInput);
  els.btnProfile.addEventListener("click", openProfile);
  els.btnCloseProfile.addEventListener("click", closeProfile);
  els.btnSwitchUser.addEventListener("click", switchUser);
  els.btnCompleteReset.addEventListener("click", () => {
    closeLevelComplete();
    resetInput();
  });
  els.btnCompleteNext.addEventListener("click", () => {
    closeLevelComplete();
    nextLevel();
  });
  els.levelCompleteOverlay.addEventListener("click", (e) => {
    if (e.target === els.levelCompleteOverlay) closeLevelComplete();
  });
  els.profileOverlay.addEventListener("click", (e) => {
    if (e.target === els.profileOverlay) closeProfile();
  });
  els.btnTheme.addEventListener("click", toggleTheme);
  els.typeInput.addEventListener("keyup", onKey);
  els.typeInput.addEventListener("input", onKey);
  els.typeInput.addEventListener("paste", onBlockedPaste);
  els.typeInput.addEventListener("drop", onBlockedPaste);
}

// ---- sign-in ----

function showSignIn() {
  els.signinOverlay.classList.add("open");
  signinBg.start();
  requestAnimationFrame(() => els.signinName.focus());
}

async function onSignIn(event) {
  event.preventDefault();
  const name = els.signinName.value.trim();
  const password = els.signinPassword.value;

  if (!name || !password) {
    els.signinError.textContent = "Please enter both a name and a password to continue.";
    els.signinError.hidden = false;
    els.signinName.parentElement.classList.toggle("has-error", !name);
    els.signinPassword.parentElement.classList.toggle("has-error", !password);
    (name ? els.signinPassword : els.signinName).focus();
    return;
  }
  els.signinError.hidden = true;
  els.signinName.parentElement.classList.remove("has-error");
  els.signinPassword.parentElement.classList.remove("has-error");

  const submitBtn = els.signinForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in...";

  const ok = await enterGameAs(name, password);

  submitBtn.disabled = false;
  submitBtn.textContent = "Start Playing";

  if (ok) {
    els.signinPassword.value = "";
  }
}

/** Returns true on success, false if sign-in failed and the user needs to try again. */
async function enterGameAs(name, password, { silent = false } = {}) {
  try {
    if (backendAvailable) {
      const profile = await authenticate(name, password);
      state.bestWpm = profile.best_wpm;
      state.bestAccuracy = profile.best_accuracy;
      state.maxCombo = profile.max_combo;
      state.roundsFinished = profile.rounds_finished;
      currentLevel = clampLevel(profile.current_level || 1);
      playerName = profile.player_name; // preserves this user's original casing
      currentPassword = password;
      pendingGreeting = silent
        ? `${playerName} \u2014 welcome back. Resuming Level ${currentLevel}.`
        : profile.exists
          ? `Welcome back, ${playerName}! Resuming at Level ${currentLevel}.`
          : `Welcome, ${playerName}! Your account is set up \u2014 let's get started at Level 1.`;
    } else {
      // No backend reachable — every "user" just gets a fresh, unsaved session.
      playerName = name;
      currentPassword = password;
      state.bestWpm = 0;
      state.bestAccuracy = 0;
      state.maxCombo = 0;
      state.roundsFinished = 0;
      currentLevel = 1;
      pendingGreeting = `Hi ${playerName}! Playing without persistence this session.`;
    }
  } catch (err) {
    if (err.status === 401) {
      // Wrong password for an existing name — do NOT enter the game or
      // leak any stats. Stay on the sign-in screen with a clear error.
      if (silent) {
        // A saved session became invalid (e.g. password was reset another
        // way) — clear it quietly and just show the normal sign-in form.
        clearSession();
        showSignIn();
        return false;
      }
      els.signinError.textContent = "Incorrect password for that name. Try again, or use a different name to create a new account.";
      els.signinError.hidden = false;
      els.signinPassword.parentElement.classList.add("has-error");
      els.signinPassword.value = "";
      els.signinPassword.focus();
      return false;
    }
    console.warn("Could not sign in, starting an unsaved session:", err);
    playerName = name;
    currentPassword = password;
    currentLevel = 1;
    pendingGreeting = `Hi ${playerName}! Let's get you started at Level 1.`;
  }

  saveSession(playerName, currentPassword);
  els.profileName.textContent = playerName;
  els.signinOverlay.classList.remove("open");
  signinBg.stop();
  els.appRoot.hidden = false;
  ambientBg.start();

  persist();
  startLevel(currentLevel);
  startTicker();
  return true;
}

// ---- level flow ----

function clampLevel(n) {
  return Math.min(Math.max(1, Math.round(n)), MAX_LEVEL);
}

function textsForLevel(levelNumber) {
  const entry = levels.find((l) => l.level === levelNumber) || levels[0];
  return entry.texts;
}

function startLevel(levelNumber) {
  currentLevel = clampLevel(levelNumber);
  const pool = textsForLevel(currentLevel);
  const text = pool[Math.floor(Math.random() * pool.length)];

  state.startRound(text);
  comboBeforeLevel = state.maxCombo;
  els.typeInput.value = "";
  els.typeInput.disabled = false;
  renderTarget("");
  resetStatLabels();
  renderLevelIndicator();

  els.playerGreeting.textContent = pendingGreeting || `${playerName} \u2014 Level ${currentLevel} of ${MAX_LEVEL}. Best combo so far: ${state.maxCombo}.`;
  pendingGreeting = null;

  els.statusLine.textContent = `Level ${currentLevel} of ${MAX_LEVEL}. Start typing when you're ready.`;
  els.btnNextLevel.disabled = true;
  els.promptCard.classList.remove("round-enter");
  void els.promptCard.offsetWidth; // restart the fade-in animation
  els.promptCard.classList.add("round-enter");
  els.typeInput.focus();
}

function nextLevel() {
  if (!state.finished) return; // extra guard, matches the disabled button state
  if (currentLevel >= MAX_LEVEL) {
    els.statusLine.textContent = `You're already at the top — replaying Level ${MAX_LEVEL}.`;
    startLevel(MAX_LEVEL);
  } else {
    startLevel(currentLevel + 1);
  }
  persist();
}

function resetInput() {
  state.resetInput();
  els.typeInput.value = "";
  els.typeInput.disabled = false;
  els.btnNextLevel.disabled = true;
  renderTarget("");
  resetStatLabels();
  els.statusLine.textContent = "Input cleared. Start typing again.";
  els.typeInput.focus();
}

function onBlockedPaste(event) {
  event.preventDefault();
  els.statusLine.textContent = "Pasting isn't allowed — type it out to get real practice!";
}

function onKey(event) {
  if (state.finished) return;

  const typed = els.typeInput.value;
  const isBackspace = event.inputType === "deleteContentBackward" || event.key === "Backspace";
  const prevCombo = state.combo;
  const snap = state.typeChar(typed, isBackspace);

  els.statWpm.textContent = snap.wpm.toFixed(1);
  els.statAccuracy.textContent = `${snap.accuracy.toFixed(1)}%`;
  els.statTime.textContent = snap.elapsed.toFixed(1);
  updateCombo(snap.combo, snap.maxCombo, snap.combo > prevCombo);
  updateVoltage(snap.progress, accuracyColorBucket(snap.accuracy));
  renderTarget(typed);

  if (typed && snap.elapsed <= 0.3) {
    els.statusLine.textContent = "Typing... keep the combo alive!";
  }
  if (snap.justFinished) {
    const isMax = currentLevel >= MAX_LEVEL;
    const beatBestCombo = snap.maxCombo > comboBeforeLevel;
    els.statusLine.textContent = isMax
      ? `Level ${currentLevel} complete! You've reached the top level.`
      : `Level ${currentLevel} complete!`;
    els.playerGreeting.textContent = beatBestCombo
      ? `\u26a1 ${playerName} just set a new best combo: ${snap.maxCombo}! (Level ${currentLevel})`
      : `${playerName} \u2014 Level ${currentLevel} of ${MAX_LEVEL} complete. Best combo: ${snap.maxCombo}.`;
    els.typeInput.disabled = true;
    els.btnNextLevel.disabled = false;
    persist();
    openLevelComplete(snap);
  }
}

// ---- profile ----

function openProfile() {
  els.profileName.textContent = playerName;
  els.profileBestWpm.textContent = `Best speed: ${state.bestWpm.toFixed(1)} WPM`;
  els.profileBestAccuracy.textContent = `Best accuracy: ${state.bestAccuracy.toFixed(1)}%`;
  els.profileMaxCombo.textContent = `Best combo: ${state.maxCombo}`;
  els.profileRounds.textContent = `Rounds finished: ${state.roundsFinished}`;
  els.profileOverlay.classList.add("open");
}

function closeProfile() {
  els.profileOverlay.classList.remove("open");
  persist();
}

function openLevelComplete(snap) {
  const isMax = currentLevel >= MAX_LEVEL;
  const beatBestCombo = snap.maxCombo > comboBeforeLevel;
  els.completeTitle.textContent = `Level ${currentLevel} complete!`;
  els.completeSubtitle.textContent = "Here's how that run went.";
  els.completeWpm.textContent = `${snap.wpm.toFixed(1)} WPM`;
  els.completeAccuracy.textContent = `${snap.accuracy.toFixed(1)}%`;
  els.completeTime.textContent = `${snap.elapsed.toFixed(1)}s`;
  els.completeCombo.textContent = `${snap.maxCombo}`;
  els.completeNote.textContent = beatBestCombo
    ? `\u26a1 New personal best combo! (previous best: ${comboBeforeLevel})`
    : isMax
      ? "You've reached the top level. Replay it any time to push your best score higher."
      : "Ready for a tougher prompt?";
  els.btnCompleteNext.textContent = isMax ? "Replay Level 10" : "Next Level";
  els.levelCompleteOverlay.classList.add("open");
}

function closeLevelComplete() {
  els.levelCompleteOverlay.classList.remove("open");
}

function switchUser() {
  persist(); // make sure the outgoing user's progress is saved first
  clearSession();

  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }

  els.profileOverlay.classList.remove("open");
  els.appRoot.hidden = true;
  ambientBg.stop();
  els.typeInput.value = "";
  els.signinName.value = "";
  els.signinPassword.value = "";

  playerName = "";
  currentPassword = "";
  currentLevel = 1;
  state.bestWpm = 0;
  state.bestAccuracy = 0;
  state.maxCombo = 0;
  state.roundsFinished = 0;
  state.startRound("");

  showSignIn();
}

function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
  html.setAttribute("data-theme", next);
  els.btnTheme.textContent = next === "dark" ? "◐" : "◑";
}

// ---- rendering helpers ----

function renderTarget(typed) {
  const target = state.targetText;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < target.length; i++) {
    const span = document.createElement("span");
    span.className = "char";
    span.textContent = target[i];
    if (i < typed.length) {
      span.classList.add(typed[i] === target[i] ? "correct" : "incorrect");
    } else {
      span.classList.add("pending");
    }
    frag.appendChild(span);
  }
  els.promptText.replaceChildren(frag);
}

function renderLevelIndicator() {
  els.levelPill.textContent = `Level ${currentLevel} of ${MAX_LEVEL}`;
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= MAX_LEVEL; i++) {
    const dot = document.createElement("span");
    dot.className = "level-dot";
    if (i < currentLevel) dot.classList.add("filled");
    if (i === currentLevel) dot.classList.add("filled", "current");
    dot.title = `Level ${i}`;
    frag.appendChild(dot);
  }
  els.levelTrack.replaceChildren(frag);
  els.btnNextLevel.textContent = currentLevel >= MAX_LEVEL ? "Replay Level 10" : "Next Level";
}

function updateVoltage(fraction, bucket) {
  els.voltageFill.style.width = `${Math.round(fraction * 100)}%`;
  const colorVar = { danger: "var(--danger)", warning: "var(--warning)", success: "var(--storm)" }[bucket];
  els.voltageFill.style.background = `linear-gradient(90deg, var(--volt), ${colorVar})`;
}

function updateCombo(combo, maxCombo, grew) {
  els.comboLine.textContent = `Combo: ${combo} | Best: ${maxCombo}`;
  if (grew) {
    els.comboLine.classList.remove("flicker");
    void els.comboLine.offsetWidth;
    els.comboLine.classList.add("flicker");
  }
}

function resetStatLabels() {
  els.statWpm.textContent = "0.0";
  els.statAccuracy.textContent = "0.0%";
  els.statTime.textContent = "0.0";
  updateCombo(0, state.maxCombo, false);
  updateVoltage(0, "success");
}

function startTicker() {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    const elapsed = state.currentElapsed();
    if (elapsed > 0) {
      els.statTime.textContent = elapsed.toFixed(1);
    }
  }, 100);
}

function persist() {
  if (!backendAvailable || !currentPassword) return;
  saveStats(playerName, currentPassword, {
    best_wpm: state.bestWpm,
    best_accuracy: state.bestAccuracy,
    max_combo: state.maxCombo,
    rounds_finished: state.roundsFinished,
    current_level: currentLevel,
  }).catch((err) => {
    if (err.status === 401) {
      // Password no longer valid for this account — don't keep silently
      // failing every save. Sign the session out so they can re-auth.
      console.warn("Session is no longer valid, signing out:", err);
      clearSession();
    } else {
      console.warn("Could not save profile:", err);
    }
  });
}

window.addEventListener("beforeunload", persist);

window.addEventListener("error", (e) => {
  console.error("Thunder Type error:", e.error || e.message);
  if (els.statusLine) {
    els.statusLine.textContent = `Something went wrong: ${e.message}. Check the browser console (F12) for details.`;
  }
});

init();
