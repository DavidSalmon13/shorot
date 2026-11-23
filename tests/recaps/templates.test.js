'use strict';

// Static checks on the recap video templates (recaps/templates). No rendering here: rendering
// needs Chrome + FFmpeg and takes ~45 s, so it's a manual / optional CI step (see the spec).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareJob, templateExists, TEMPLATES_DIR } = require('../../server/recaps/renderer');

const templates = fs.readdirSync(TEMPLATES_DIR).filter((d) => !d.startsWith('_'));
const sharedFiles = fs.readdirSync(path.join(TEMPLATES_DIR, '_shared'));

function sources(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(html|js|css)$/.test(f) && f !== 'gsap.min.js')
    .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
}

test('the generic template and the per-game templates exist', () => {
  for (const t of ['generic', 'imposter', 'ten-seconds']) assert.ok(templates.includes(t), t);
});

for (const t of templates) {
  test(`${t}: declares the recap variable, loads only local files, never uses innerHTML`, () => {
    const html = fs.readFileSync(path.join(TEMPLATES_DIR, t, 'index.html'), 'utf8');
    assert.match(html, /data-composition-variables='\[\{"id":"recap","type":"string"/);
    assert.match(html, /data-composition-id="main"/);
    assert.doesNotMatch(html, /https?:\/\//, 'templates must render offline');
    assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert.ok(ref.startsWith('shared/'), `${ref} must come from shared/`);
      assert.ok(sharedFiles.includes(ref.slice('shared/'.length)), `${ref} exists in _shared`);
    }
  });
}

test('shared code: no network, no HTML injection sinks', () => {
  for (const [file, src] of sources(path.join(TEMPLATES_DIR, '_shared'))) {
    assert.doesNotMatch(src, /https?:\/\/(?!gsap\.com)/, `${file} must not reference the network`);
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, file);
  }
});

test('templateExists rejects path tricks', () => {
  assert.equal(templateExists('generic'), true);
  assert.equal(templateExists('../_shared'), false);
  assert.equal(templateExists('_shared'), false);
  assert.equal(templateExists('nope'), false);
});

test('prepareJob: copies template + shared, falls back to generic, passes data as one JSON variable', () => {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-job-'));
  const data = {
    template: 'does-not-exist',
    title: 'Bluff',
    players: [{ name: '<img src=x>', points: 1, won: true, place: 1, avatar: { kind: 'emoji', emoji: '🦊' } }],
    highlight: null,
  };
  assert.equal(prepareJob(data, jobDir), 'generic');
  assert.ok(fs.existsSync(path.join(jobDir, 'index.html')));
  assert.ok(fs.existsSync(path.join(jobDir, 'shared', 'recap.js')));
  const vars = JSON.parse(fs.readFileSync(path.join(jobDir, 'vars.json'), 'utf8'));
  assert.deepEqual(Object.keys(vars), ['recap']);
  const parsed = JSON.parse(vars.recap);
  assert.equal(parsed.template, 'generic');
  assert.equal(parsed.players[0].name, '<img src=x>', 'text is passed through as data, escaped by the template');
});

test('prepareJob: a missing photo sticker falls back to the emoji', () => {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-job-'));
  prepareJob(
    {
      template: 'generic',
      players: [{ name: 'Ann', avatar: { kind: 'sticker', sticker: 'custom-missing.webp', fallback: '🐼' } }],
    },
    jobDir
  );
  const parsed = JSON.parse(JSON.parse(fs.readFileSync(path.join(jobDir, 'vars.json'), 'utf8')).recap);
  assert.deepEqual(parsed.players[0].avatar, { kind: 'emoji', emoji: '🐼' });
});
