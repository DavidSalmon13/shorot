/**
 * Keeps the recap folder bounded: deletes recap MP4s older than the TTL, then the oldest ones
 * while the folder is over its size cap, and leftover job dirs under tmp/ (all of them at boot,
 * only stale ones after that, so a render in progress keeps its dir).
 */
const fs = require('fs');
const path = require('path');

const STALE_JOB_MS = 60 * 60 * 1000;

function sweep({ dir, ttlMs, maxBytes, now = Date.now(), atBoot = false }) {
  const removed = [];
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        return { f, full, at: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => a.at - b.at);
  } catch {
    return removed;
  }
  let total = files.reduce((sum, x) => sum + x.size, 0);
  for (const x of files) {
    if (now - x.at > ttlMs || total > maxBytes) {
      try {
        fs.unlinkSync(x.full);
        total -= x.size;
        removed.push(x.f);
      } catch {}
    }
  }
  const tmp = path.join(dir, 'tmp');
  try {
    for (const job of fs.readdirSync(tmp)) {
      const full = path.join(tmp, job);
      if (atBoot || now - fs.statSync(full).mtimeMs > STALE_JOB_MS) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch {}
  return removed;
}

module.exports = { sweep };
