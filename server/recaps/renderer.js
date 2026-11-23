/**
 * The only file that knows how recap videos are rendered: it runs the HyperFrames CLI
 * (https://github.com/heygen-com/hyperframes, Apache-2.0) as a child process, so Chrome and
 * FFmpeg never run inside the app's own Node process. See docs/specs/recap-videos-specs.md.
 *
 * A job dir is assembled per render: the template's index.html, the shared assets (GSAP, font,
 * base script and styles), copies of the players' photo stickers and vars.json. The CLI renders it
 * to an MP4. Values reach the composition only through vars.json (never a command line or shell).
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { stickerPath } = require('../stickers');

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'recaps', 'templates');
const SHARED_DIR = path.join(TEMPLATES_DIR, '_shared');

let cliPath;
function hyperframesCli() {
  if (cliPath !== undefined) return cliPath;
  try {
    const pkgFile = require.resolve('hyperframes/package.json');
    const bin = require(pkgFile).bin.hyperframes;
    cliPath = path.join(path.dirname(pkgFile), bin);
  } catch {
    cliPath = null;
  }
  return cliPath;
}

let availability;
/** Can recaps render here? Needs the hyperframes package, Node >= 22 and FFmpeg. Probed once. */
function available() {
  if (availability !== undefined) return availability;
  const major = Number(process.versions.node.split('.')[0]);
  let reason = null;
  if (major < 22) reason = `Node ${process.versions.node} (HyperFrames needs >= 22)`;
  else if (!hyperframesCli()) reason = 'the hyperframes package is not installed';
  else if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) reason = 'ffmpeg is not installed';
  availability = reason ? { ok: false, reason } : { ok: true };
  return availability;
}

function templateExists(template) {
  return /^[a-z0-9-]+$/.test(template) && fs.existsSync(path.join(TEMPLATES_DIR, template, 'index.html'));
}

/**
 * Copies photo stickers into the job dir and swaps each sticker avatar for its relative path.
 * A missing file falls back to the player's emoji. Returns new data (input is not mutated).
 */
function withLocalStickers(data, jobDir) {
  fs.mkdirSync(path.join(jobDir, 'stickers'), { recursive: true });
  const players = data.players.map((p, i) => {
    if (p.avatar.kind !== 'sticker') return p;
    const source = stickerPath(p.avatar.sticker);
    if (!source || !fs.existsSync(source)) return { ...p, avatar: { kind: 'emoji', emoji: p.avatar.fallback || '🙂' } };
    const file = `stickers/${i}${path.extname(source).toLowerCase()}`;
    fs.copyFileSync(source, path.join(jobDir, file));
    return { ...p, avatar: { kind: 'image', src: file } };
  });
  return { ...data, players };
}

/** Assembles the job dir for `data` (from data.js). Returns the template actually used. */
function prepareJob(data, jobDir) {
  const template = templateExists(data.template) ? data.template : 'generic';
  fs.mkdirSync(jobDir, { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES_DIR, template, 'index.html'), path.join(jobDir, 'index.html'));
  fs.cpSync(SHARED_DIR, path.join(jobDir, 'shared'), { recursive: true });
  const local = withLocalStickers({ ...data, template }, jobDir);
  fs.writeFileSync(path.join(jobDir, 'vars.json'), JSON.stringify({ recap: JSON.stringify(local) }));
  return template;
}

/**
 * Renders `data` to `outFile`. Resolves { ms, template } or rejects with an Error whose message
 * ends with the tail of the CLI's output. The whole process group is killed on timeout.
 */
function render({ data, jobDir, outFile, quality = 'draft', workers = 1, timeoutMs = 180000 }) {
  const started = Date.now();
  const template = prepareJob(data, jobDir);
  const args = [
    hyperframesCli(), 'render', jobDir,
    '--variables-file', path.join(jobDir, 'vars.json'),
    '--strict-variables',
    '--refuse-outside-files',
    '-o', outFile,
    '-q', quality,
    '--workers', String(workers),
    '--no-wait',
    '--quiet',
  ];
  const useNice = process.platform !== 'win32' && spawnSync('nice', ['true'], { stdio: 'ignore' }).status === 0;
  const [cmd, cmdArgs] = useNice ? ['nice', ['-n', '19', process.execPath, ...args]] : [process.execPath, args];

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: jobDir,
      detached: process.platform !== 'win32', // own process group, so a timeout also kills Chrome
      env: {
        ...process.env,
        HYPERFRAMES_NO_TELEMETRY: '1',
        DO_NOT_TRACK: '1',
        HYPERFRAMES_SKIP_SKILLS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const keep = (chunk) => {
      output = (output + chunk).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => {
      try {
        process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL');
      } catch {}
      reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outFile)) return resolve({ ms: Date.now() - started, template });
      const tail = output.trim().split('\n').slice(-3).join(' | ').slice(-300);
      reject(new Error(`hyperframes exited with ${code}${tail ? `: ${tail}` : ''}`));
    });
  });
}

module.exports = { available, render, prepareJob, templateExists, TEMPLATES_DIR };
