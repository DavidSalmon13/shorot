'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue } = require('../../server/recaps/queue');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('runs one job at a time, in order', async () => {
  const order = [];
  const gates = {};
  const q = createQueue({
    run: (job) => {
      order.push(`start ${job.roomKey}`);
      gates[job.roomKey] = deferred();
      return gates[job.roomKey].promise;
    },
  });
  const done = [];
  q.push({ roomKey: 'A', onDone: () => done.push('A') });
  q.push({ roomKey: 'B', onDone: () => done.push('B') });
  assert.deepEqual(order, ['start A']);
  assert.equal(q.busy(), true);
  assert.equal(q.size(), 1);
  gates.A.resolve();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['start A', 'start B']);
  gates.B.resolve();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(done, ['A', 'B']);
  assert.equal(q.busy(), false);
});

test('a newer waiting job for the same room replaces the older one; a running job is kept', async () => {
  const gate = deferred();
  const ran = [];
  const dropped = [];
  const q = createQueue({
    run: (job) => {
      ran.push(job.id);
      return job.id === 1 ? gate.promise : Promise.resolve();
    },
    onDrop: (job, why) => dropped.push([job.id, why]),
  });
  q.push({ id: 1, roomKey: 'A' }); // starts running
  q.push({ id: 2, roomKey: 'A' }); // waits
  q.push({ id: 3, roomKey: 'A' }); // replaces 2
  assert.deepEqual(dropped, [[2, 'replaced']]);
  gate.resolve();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ran, [1, 3]);
});

test('the queue is capped; errors go to onError and the queue keeps going', async () => {
  const gate = deferred();
  const dropped = [];
  const errors = [];
  const done = [];
  const q = createQueue({
    maxQueue: 2,
    run: (job) => (job.roomKey === 'A' ? gate.promise : job.roomKey === 'B' ? Promise.reject(new Error('bad')) : Promise.resolve()),
    onDrop: (job, why) => dropped.push([job.roomKey, why]),
  });
  q.push({ roomKey: 'A' });
  q.push({ roomKey: 'B', onError: (e) => errors.push(e.message) });
  q.push({ roomKey: 'C', onDone: () => done.push('C') });
  assert.equal(q.push({ roomKey: 'D' }), false);
  assert.deepEqual(dropped, [['D', 'full']]);
  gate.resolve();
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, ['bad']);
  assert.deepEqual(done, ['C']);
});
