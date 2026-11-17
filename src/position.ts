/**
 * Checklist order. Positions are strings compared lexicographically, so moving one item
 * writes one event instead of renumbering the whole list. Generated keys never end in "0",
 * which is what keeps a gap available between any two of them.
 */
const D = "0123456789abcdefghijklmnopqrstuvwxyz";
const B = D.length;
const val = (c: string) => D.indexOf(c);

/** A key strictly between a and b. Either side may be null, meaning no bound. */
export function between(a: string | null, b: string | null): string {
  let out = "";
  let i = 0;
  for (;;) {
    const lo = a && i < a.length ? val(a[i]) : 0;
    const hi = b ? (i < b.length ? val(b[i]) : 0) : B;
    if (hi - lo > 1) return out + D[lo + Math.floor((hi - lo) / 2)];
    if (hi === lo) {
      out += D[lo];
      i++;
      continue;
    }
    // The two differ by one digit, so b stops constraining us: stay below it and
    // then find any key above what is left of a.
    out += D[lo];
    i++;
    for (;;) {
      const tail = a && i < a.length ? val(a[i]) : -1;
      if (tail === -1) return out + D[Math.floor(B / 2)];
      if (tail < B - 1) return out + D[tail + Math.floor((B - tail) / 2)];
      out += D[tail];
      i++;
    }
  }
}
