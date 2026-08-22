/**
 * Return zero-based lines in `after` that differ from `before`.
 * A deletion marks the nearest surviving line so the change remains visible.
 */
export function changedLineNumbers(before, after) {
  if (before === after) return new Set();
  const left = before.split('\n');
  const right = after.split('\n');
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix++;

  const a = left.slice(prefix, left.length - suffix);
  const b = right.slice(prefix, right.length - suffix);
  const changed = new Set();

  // Large rewrites do not need a quadratic line diff: the whole changed region is
  // already the honest and useful highlight.
  if (a.length * b.length > 300_000) {
    for (let index = prefix; index < right.length - suffix; index++) changed.add(index);
  } else {
    const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        table[i][j] = a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
      } else if (table[i + 1][j] > table[i][j + 1]) {
        i++;
      } else {
        changed.add(prefix + j);
        j++;
      }
    }
    while (j < b.length) changed.add(prefix + j++);
  }

  if (changed.size === 0) changed.add(Math.min(prefix, Math.max(0, right.length - 1)));
  return changed;
}
