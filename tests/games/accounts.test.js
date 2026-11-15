'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../server/db');
const accounts = require('../../server/accounts');

/** Fake pg pool: records every query call and returns canned results in order. */
function fakeQueryable(results = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return results[i++] || { rows: [], rowCount: 0 };
    },
  };
}

test('linkDeviceToUser: claims an unlinked device for the signed-in user', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = fakeQueryable();
  t.mock.method(db, 'query', fake.query);

  await accounts.linkDeviceToUser('42', 'device-abc');

  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].text, /INSERT INTO players/);
  // Only links a device that isn't already attached to an account.
  assert.match(fake.calls[0].text, /ON CONFLICT \(client_id\) DO UPDATE SET user_id/);
  assert.match(fake.calls[0].text, /WHERE players\.user_id IS NULL/);
  assert.deepEqual(fake.calls[0].params, ['device-abc', '42']);
});

test('linkDeviceToUser: no-op when the database is disabled', async (t) => {
  t.mock.method(db, 'isEnabled', () => false);
  const fake = fakeQueryable();
  t.mock.method(db, 'query', fake.query);

  await accounts.linkDeviceToUser('42', 'device-abc');

  assert.equal(fake.calls.length, 0);
});

test('linkDeviceToUser: no-op without a userId or clientId', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = fakeQueryable();
  t.mock.method(db, 'query', fake.query);

  await accounts.linkDeviceToUser(null, 'device-abc');
  await accounts.linkDeviceToUser('42', '');
  await accounts.linkDeviceToUser('42', '   ');

  assert.equal(fake.calls.length, 0);
});

test('linkDeviceToUser: never throws when the query fails', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  t.mock.method(db, 'query', async () => {
    throw new Error('db down');
  });
  // Swallow the console.error the catch emits so the test output stays clean.
  t.mock.method(console, 'error', () => {});

  await assert.doesNotReject(() => accounts.linkDeviceToUser('42', 'device-abc'));
});
