/* One run per key at a time, inside this process. A call that arrives while a run for the same key is still going gets
   the busy result back at once instead of starting overlapping Render writes. The lock is released whether the run
   succeeds or throws. It is not a lock across several API instances; see mainServer.js for that. */
const running = new Map();

async function withRunLock(key, run, busyResult) {
  if (running.has(key)) return busyResult;
  const promise = Promise.resolve().then(run);
  running.set(key, promise);
  try {
    return await promise;
  } finally {
    if (running.get(key) === promise) running.delete(key);
  }
}

module.exports = { withRunLock };
