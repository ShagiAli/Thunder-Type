// Run with: node tests/test_stats.mjs
// Uses Node's built-in assert + a tiny manual runner — no test framework needed.

import assert from "node:assert/strict";
import { accuracyColorBucket, calcAccuracy, calcProgress, calcWpm } from "../static/js/stats.js";
import { GameState } from "../static/js/gameState.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---- stats.js ----
test("calcWpm returns 0 with no elapsed time", () => {
  assert.equal(calcWpm(50, 0), 0);
});

test("calcWpm basic case (25 chars in 30s -> 10 WPM)", () => {
  assert.equal(calcWpm(25, 30), 10);
});

test("calcAccuracy is 0 when nothing typed", () => {
  assert.equal(calcAccuracy("", "hello"), 0);
});

test("calcAccuracy is 100 when all typed chars match", () => {
  assert.equal(calcAccuracy("hello", "hello world"), 100);
});

test("calcAccuracy partial match (hxllo vs hello -> 80%)", () => {
  assert.equal(calcAccuracy("hxllo", "hello"), 80);
});

test("calcProgress clamps to 1 and handles zero target", () => {
  assert.equal(calcProgress(20, 10), 1);
  assert.equal(calcProgress(5, 10), 0.5);
  assert.equal(calcProgress(0, 0), 0);
});

test("accuracyColorBucket buckets correctly", () => {
  assert.equal(accuracyColorBucket(40), "danger");
  assert.equal(accuracyColorBucket(70), "warning");
  assert.equal(accuracyColorBucket(95), "success");
});

// ---- gameState.js (fake clock so timing is deterministic) ----
function fakeClock() {
  let t = 0;
  const clock = () => t;
  clock.advance = (ms) => { t += ms; };
  return clock;
}

test("combo resets on a mistake", () => {
  const clock = fakeClock();
  const gs = new GameState(clock);
  gs.startRound("cat");
  gs.typeChar("c", false);
  gs.typeChar("ca", false);
  const snap = gs.typeChar("cx", false); // mistake
  assert.equal(snap.combo, 0);
});

test("combo builds on correct chars and finishes the round", () => {
  const clock = fakeClock();
  const gs = new GameState(clock);
  gs.startRound("cat");
  gs.typeChar("c", false);
  gs.typeChar("ca", false);
  const snap = gs.typeChar("cat", false);
  assert.equal(snap.combo, 3);
  assert.equal(snap.finished, true);
  assert.equal(snap.justFinished, true);
});

test("backspace resets combo", () => {
  const clock = fakeClock();
  const gs = new GameState(clock);
  gs.startRound("cat");
  gs.typeChar("c", false);
  const snap = gs.typeChar("", true);
  assert.equal(snap.combo, 0);
});

test("justFinished only fires once", () => {
  const clock = fakeClock();
  const gs = new GameState(clock);
  gs.startRound("hi");
  gs.typeChar("h", false);
  const snap1 = gs.typeChar("hi", false);
  assert.equal(snap1.justFinished, true);
  const snap2 = gs.typeChar("hi", false);
  assert.equal(snap2.justFinished, false);
});

test("maxCombo persists across resetInput", () => {
  const clock = fakeClock();
  const gs = new GameState(clock);
  gs.startRound("cat");
  gs.typeChar("c", false);
  gs.typeChar("ca", false);
  gs.typeChar("cat", false);
  assert.equal(gs.maxCombo, 3);
  gs.resetInput();
  assert.equal(gs.maxCombo, 3); // session record, not per-round
  assert.equal(gs.combo, 0);
});

test("wpm reflects elapsed time via injected clock", () => {
  const clock = fakeClock();
  const gs = new GameState(clock);
  gs.startRound("hello world"); // 11 chars
  gs.typeChar("h", false); // starts the timer at t=0
  clock.advance(30000); // +30s
  const snap = gs.typeChar("hello world", false); // 11 chars typed
  // 11 chars / 5 = 2.2 words, in 0.5 min -> 4.4 WPM
  assert.ok(Math.abs(snap.wpm - 4.4) < 0.001, `expected ~4.4, got ${snap.wpm}`);
});

// ---- runner ----
let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL ${name} -> ${err.message}`);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
