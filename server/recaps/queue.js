/**
 * Recap render queue: one job at a time, FIFO, capped. Each job belongs to a room; if a room
 * queues a new job while an older one of its own is still waiting, the newer one replaces it
 * (rapid-fire games collapse to the latest). A job that is already rendering is never replaced.
 *
 * createQueue({ run, maxQueue, onDrop }) -> { push(job), size(), busy() }
 *   run(job): async, does the work (errors are caught and passed to job.onError)
 *   job: { roomKey, onStart?, onDone?(result), onError?(err) }
 */
function createQueue({ run, maxQueue = 5, onDrop = () => {} }) {
  const waiting = [];
  let running = null;

  function push(job) {
    const same = waiting.findIndex((j) => j.roomKey === job.roomKey);
    if (same !== -1) {
      const [old] = waiting.splice(same, 1);
      onDrop(old, 'replaced');
    }
    if (waiting.length >= maxQueue) {
      onDrop(job, 'full');
      return false;
    }
    waiting.push(job);
    pump();
    return true;
  }

  async function pump() {
    if (running) return;
    while (waiting.length) {
      running = waiting.shift();
      const job = running;
      try {
        if (job.onStart) job.onStart();
        const result = await run(job);
        if (job.onDone) job.onDone(result);
      } catch (err) {
        if (job.onError) job.onError(err);
      }
    }
    running = null;
  }

  return {
    push,
    size: () => waiting.length,
    busy: () => !!running,
  };
}

module.exports = { createQueue };
