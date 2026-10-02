// Fuzzy matching between trainer names and invoice file names.

const GENERIC = new Set(['invoice', 'invoices', 'inv', 'bill', 'pdf', 'copy', 'final']);

export const MATCH_THRESHOLD = 0.6;   // at or above this, a file is auto-matched
export const HIGH_CONFIDENCE = 0.85;  // at or above this, the match is shown as "Matched" (else "Check")

// what the user sees / what we score against (includes the sub-folder if the folder has them)
export const fileLabel = (f) => f.webkitRelativePath || f.name;

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const words = (s) => norm(s).split(' ').filter(Boolean);
const fileWords = (s) => words(s).filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w));

const editDistance = (a, b) => {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
};

const similarity = (a, b) => 1 - editDistance(a, b) / Math.max(a.length, b.length);

// how well one word of the trainer's name is found among the file's words (0..1)
const wordScore = (w, fileTokens) => {
  let best = 0;
  for (const f of fileTokens) {
    let s = 0;
    if (w === f) s = 1;
    else if (w.length === 1 || f.length === 1) s = w[0] === f[0] ? 0.4 : 0; // initial, e.g. "P" vs "Prachika"
    else if (w.length >= 3 && f.length >= 3 && (f.startsWith(w) || w.startsWith(f))) s = 0.85;
    else {
      const sim = similarity(w, f);
      s = sim >= 0.75 ? sim * 0.9 : 0; // small spelling differences
    }
    if (s > best) best = s;
  }
  return best;
};

// 0 = nothing in common, 1 = every word of the name is in the file name
export const scoreMatch = (name, fileName) => {
  const nameWords = words(name);
  const fileTokens = fileWords(fileName);
  if (nameWords.length === 0 || fileTokens.length === 0) return 0;

  // "JohnDoe_invoice.pdf"
  const joinedName = nameWords.join('');
  if (joinedName.length >= 4 && fileTokens.join('').includes(joinedName)) return 1;

  const total = nameWords.reduce((sum, w) => sum + wordScore(w, fileTokens), 0);
  return total / nameWords.length;
};

// people = [{ key, name }], files = File[]
// Returns { [key]: { idx, score } }, idx = -1 when nothing matched well enough.
// One file is given to at most one person; the best scores claim their files first.
export const autoMatchAll = (people, files) => {
  const pairs = [];
  people.forEach((p) => {
    files.forEach((f, idx) => {
      const score = scoreMatch(p.name, fileLabel(f));
      if (score >= MATCH_THRESHOLD) pairs.push({ key: p.key, idx, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const out = {};
  people.forEach((p) => {
    out[p.key] = { idx: -1, score: 0 };
  });
  const usedFiles = new Set();
  pairs.forEach((pr) => {
    if (out[pr.key].idx !== -1 || usedFiles.has(pr.idx)) return;
    out[pr.key] = { idx: pr.idx, score: pr.score };
    usedFiles.add(pr.idx);
  });
  return out;
};

// every file, best match for this name first: [{ i, s }]
export const rankFiles = (name, files) =>
  files
    .map((f, i) => ({ i, s: scoreMatch(name, fileLabel(f)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);