const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSuggestion, allowSend, MAX_MESSAGE } = require('../server/suggestions');

test('cleanSuggestion trims, requires a message and caps its length', () => {
  assert.equal(cleanSuggestion({ message: '   ' }).ok, false);
  assert.equal(cleanSuggestion({}).ok, false);
  assert.equal(cleanSuggestion({ message: 'x'.repeat(MAX_MESSAGE + 1) }).ok, false);
  const ok = cleanSuggestion({ message: '  more games  ', name: ' Ann ', room: 'ABCD', clientId: 'c1' });
  assert.deepEqual(ok, { ok: true, value: { message: 'more games', name: 'Ann', clientId: 'c1', room: 'ABCD' } });
  assert.equal(cleanSuggestion({ message: 'hi' }).value.name, null);
});

test('allowSend rate-limits per key over a 10 minute window', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(allowSend('k', t0 + i), true);
  assert.equal(allowSend('k', t0 + 10), false);
  assert.equal(allowSend('other', t0 + 10), true);
  assert.equal(allowSend('k', t0 + 10 * 60 * 1000 + 5), true);
});
