// Captures the phone screenshots the promo trailer is built from.
//
//   cd video/promo && npm run capture
//
// For each shot it boots a fresh Shorot server (its own temp DATA_DIR, so no room state leaks
// between takes) with capture/openai-stub.cjs preloaded, so Imposter and Codenames get fixed
// words without an OpenAI key. It then joins 3-4 fake players from iPhone-sized browser
// contexts, plays into the game and saves PNGs to assets/shots/.
//
// Players get no photo sticker (the emoji fallback), and the reactions row is hidden: the
// built-in stickers are photos of real people, which don't belong in a public trailer.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.resolve(__dirname, '../assets/shots');
const PORT = 3517;
const URL = `http://localhost:${PORT}/`;
// Hide the reactions row (real-people sticker photos) and the install prompts. The sticker
// picker and the in-game shop tray are left alone so the sign-up takes below can open them.
const HIDE = '#reaction-row, #install-app-btn, #lobby-install-btn { display: none !important; }';
const NAMES = ['Dana', 'Avi', 'Noa', 'Ron'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shorot-promo-'));
  const server = spawn(process.execPath, ['-r', path.join(__dirname, 'openai-stub.cjs'), 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), OPENAI_API_KEY: 'sk-stub', DATABASE_URL: '', GOOGLE_CLIENT_ID: '', FAL_KEY: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(URL); return server; } catch { await sleep(200); }
  }
  server.kill();
  throw new Error('Shorot server did not start');
}

async function joinPlayers(browser, count) {
  const pages = [];
  for (const name of NAMES.slice(0, count)) {
    // Full 390x844 screen (as the installed app shows it): the device profile alone leaves room for
    // Safari's toolbars (390x664), which wouldn't match the trailer's phone frames.
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((css) => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = css;
        document.head.append(s);
      });
    }, HIDE);
    const p = await ctx.newPage();
    await p.goto(URL);
    await p.fill('#name-input', name);
    await p.click('#join-btn');
    await p.waitForSelector('#lobby-screen', { state: 'visible' });
    pages.push(p);
  }
  await sleep(600);
  return pages;
}

async function shot(page, name) {
  await sleep(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function clickIfVisible(page, selector) {
  const el = page.locator(selector).first();
  if (await el.isVisible().catch(() => false)) await el.click();
}

// One entry per take: how many players, and how to play from the lobby to the shot.
// The trailer shows only the three headline games, then three "sign up to unlock" perks.
const TAKES = {
  async lobby([host]) {
    await shot(host, 'lobby');
  },
  async imposter(pages) {
    await pages[0].click('#choose-imposter-btn');
    await sleep(800);
    for (const p of pages) await clickIfVisible(p, '#voting-screen .level-btn');
    await sleep(2000);
    // Non-host phones first (no host-only buttons); the host's only if it drew the imposter.
    for (const p of [...pages.slice(1), pages[0]]) {
      const isImposter = await p.getByText('YOU ARE THE IMPOSTER').isVisible().catch(() => false);
      await shot(p, isImposter ? 'imposter-imposter' : 'imposter-word');
    }
  },
  async codenames(pages) {
    await pages[0].click('#choose-codenames-btn');
    await sleep(1000);
    for (const [i, p] of pages.entries()) await clickIfVisible(p, i < 2 ? '#join-red-btn' : '#join-blue-btn');
    await sleep(300);
    await clickIfVisible(pages[0], '#leader-red-btn');
    await sleep(300);
    await clickIfVisible(pages[2], '#leader-blue-btn');
    await sleep(500);
    await pages[0].click('#cn-start-btn');
    await sleep(2500);
    await shot(pages[0], 'codenames');
  },
  async bluff(pages) {
    await pages[0].click('#choose-bluff-btn');
    await sleep(800);
    await pages[0].click('#bf-start-btn');
    await sleep(2500);
    await shot(pages[0], 'bluff');
  },

  // --- "Sign up to unlock" perks. These are account features (Player Card, Store, custom
  // stickers) that real Google sign-in gates, which the capture can't automate. But each is a
  // client-side builder, so we drive it directly over the lobby with representative demo data
  // (and no real faces): exactly what a signed-in player would see.
  async stickers([host]) {
    // The real picker is an inline dropdown low in the lobby, and its tiles are photos of real
    // people - neither frames well nor belongs in a public trailer. So we show an on-brand,
    // centred version of the same choice: a prominent "upload your photo" tile plus emoji
    // options, which is exactly what the feature offers (minus the real faces).
    await host.evaluate(() => {
      const emojis = ['😎', '🥳', '🤠', '🦊', '🐼', '🐸', '🦄', '🐯'];
      const panel = document.createElement('div');
      panel.style.cssText =
        'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px;padding:48px;font-family:Sora,sans-serif;background:radial-gradient(circle at 50% 36%, #241f3a, #0a0a12 72%)';
      const title = document.createElement('div');
      title.textContent = 'Pick your sticker';
      title.style.cssText = 'font-weight:800;font-size:44px;color:#f4f2ff;letter-spacing:-0.02em';
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:22px;width:100%;max-width:380px';
      const tileStyle =
        'aspect-ratio:1;border-radius:24px;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 28px rgba(0,0,0,.45)';
      const add = document.createElement('div');
      add.textContent = '＋';
      add.style.cssText = `${tileStyle};background:rgba(198,255,74,0.16);border:3px dashed #c6ff4a;color:#c6ff4a;font-size:88px;font-weight:700`;
      grid.appendChild(add);
      emojis.forEach((e) => {
        const d = document.createElement('div');
        d.textContent = e;
        d.style.cssText = `${tileStyle};background:#2a2440;font-size:72px`;
        grid.appendChild(d);
      });
      panel.append(title, grid);
      document.body.appendChild(panel);
    });
    await sleep(300);
    await shot(host, 'stickers');
  },
  async card([host]) {
    // Render a real FIFA-style rating card (public/js/shared/cardRender.js) centred over a
    // dark glow, with demo stats - the same element the lobby's click-to-view popup shows.
    await host.evaluate(async () => {
      const mod = await import('/js/shared/cardRender.js');
      const user = { name: 'Dana', sticker: null };
      const card = { ratings: { ovr: 92, tier: 'gold', stats: { SPD: 95, COM: 88, STR: 81, TAC: 93, NRV: 86, DEC: 90 } } };
      const el = mod.buildRatingCard(user, card);
      el.style.transform = 'scale(1.4)';
      const wrap = document.createElement('div');
      wrap.id = 'promo-card-wrap';
      wrap.style.cssText =
        'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 38%, #2c2550, #0a0a12 70%)';
      wrap.appendChild(el);
      document.body.appendChild(wrap);
    });
    await sleep(500);
    await shot(host, 'card');
  },
  async gag([host]) {
    // Fire a real buyable gag (public/js/shared/storeFx.js) over the lobby and catch it
    // mid-splat - the same animation a signed-in player sets off from the shop.
    await host.evaluate(async () => {
      const mod = await import('/js/shared/storeFx.js');
      const layer = document.getElementById('store-fx-layer');
      mod.playStoreFx(layer, { itemId: 'pie', fromName: 'Avi', targetName: 'Dana' });
    });
    await sleep(900);
    await shot(host, 'gag');
  },
};
const PLAYERS = {};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const browser = await chromium.launch({
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  });
  let failed = 0;
  for (const [name, take] of Object.entries(TAKES)) {
    if (only.length && !only.includes(name)) continue;
    console.log(name);
    // Each take boots its own fresh server; booting 7 in a row under browser load is
    // occasionally flaky on the join handshake, so give each take a second attempt.
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      const server = await startServer();
      try {
        const pages = await joinPlayers(browser, PLAYERS[name] || 4);
        await take(pages);
        await Promise.all(pages.map((p) => p.context().close()));
        ok = true;
      } catch (err) {
        console.error(`  ${attempt < 2 ? 'retrying' : 'FAILED'}: ${err.message.split('\n')[0]}`);
      } finally {
        server.kill();
        await sleep(400);
      }
    }
    if (!ok) failed++;
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
