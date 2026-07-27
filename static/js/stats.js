// Pure math for typing stats. No DOM access, no side effects, fully testable.

export const CHARS_PER_WORD = 5;

/** Words-per-minute using the standard 5-chars-per-word convention. */
export function calcWpm(typedChars, elapsedSeconds) {
  if (elapsedSeconds <= 0) return 0;
  const words = typedChars / CHARS_PER_WORD;
  const minutes = elapsedSeconds / 60;
  return words / minutes;
}

/** Percentage of typed characters that match the target at the same index. */
export function calcAccuracy(typed, target) {
  if (!typed) return 0;
  const len = Math.min(typed.length, target.length);
  let correct = 0;
  for (let i = 0; i < len; i++) {
    if (typed[i] === target[i]) correct++;
  }
  return (correct / typed.length) * 100;
}

/** Fraction (0-1) of the target text that has been typed. */
export function calcProgress(typedLen, targetLen) {
  if (targetLen <= 0) return 0;
  return Math.min(typedLen / targetLen, 1);
}

/** Which semantic color bucket an accuracy value falls into ("danger" | "warning" | "success"). */
export function accuracyColorBucket(accuracy) {
  if (accuracy < 60) return "danger";
  if (accuracy < 85) return "warning";
  return "success";
}
