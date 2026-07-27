// Game state and rules. No DOM here — this is what tests/test_stats.mjs exercises directly.

import { calcAccuracy, calcProgress, calcWpm } from "./stats.js";

/** Injectable clock so tests don't depend on real wall-clock timing. */
const defaultClock = () => performance.now();

export class GameState {
  constructor(clock = defaultClock) {
    this._clock = clock;
    this.targetText = "";
    this.startTime = null;
    this.finished = false;
    this.combo = 0;
    this.maxCombo = 0;
    this.bestWpm = 0;
    this.bestAccuracy = 0;
    this.roundsFinished = 0;
  }

  startRound(text) {
    this.targetText = text;
    this.startTime = null;
    this.finished = false;
    this.combo = 0;
  }

  /** Keep the same target text, clear what's been typed and the timer. */
  resetInput() {
    this.startTime = null;
    this.finished = false;
    this.combo = 0;
  }

  /**
   * Apply one keystroke's worth of typed text and return the new snapshot.
   * `typedSoFar` is the full current contents of the input box.
   */
  typeChar(typedSoFar, isBackspace) {
    const wasFinished = this.finished;

    if (isBackspace || typedSoFar.length === 0) {
      this.combo = 0;
    } else {
      const idx = typedSoFar.length - 1;
      const matches = idx < this.targetText.length && typedSoFar[idx] === this.targetText[idx];
      this.combo = matches ? this.combo + 1 : 0;
    }
    this.maxCombo = Math.max(this.maxCombo, this.combo);

    if (typedSoFar.length > 0 && this.startTime === null) {
      this.startTime = this._clock();
    }

    const elapsed = this.startTime !== null ? (this._clock() - this.startTime) / 1000 : 0;
    const wpm = calcWpm(typedSoFar.length, elapsed);
    const accuracy = calcAccuracy(typedSoFar, this.targetText);
    const progress = calcProgress(typedSoFar.length, this.targetText.length);

    this.bestWpm = Math.max(this.bestWpm, wpm);
    this.bestAccuracy = Math.max(this.bestAccuracy, accuracy);

    let justFinished = false;
    if (typedSoFar === this.targetText && !wasFinished) {
      this.finished = true;
      this.roundsFinished += 1;
      justFinished = true;
    }

    return {
      typed: typedSoFar,
      wpm,
      accuracy,
      elapsed,
      progress,
      combo: this.combo,
      maxCombo: this.maxCombo,
      finished: this.finished,
      justFinished,
    };
  }

  currentElapsed() {
    if (this.startTime === null || this.finished) return 0;
    return (this._clock() - this.startTime) / 1000;
  }
}
