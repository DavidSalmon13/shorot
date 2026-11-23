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
const HIDE = '#reaction-row, #store-action-row, #sticker-dropdown, #install-app-btn, #lobby-install-btn { display: none !important; }';
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
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
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
  async tenseconds(pages) {
    await pages[0].click('#choose-tenseconds-btn');
    await sleep(800);
    await pages[0].click('#ts-start-btn');
    await sleep(4000);
    await shot(pages[1], 'tenseconds');
  },
  async menifot(pages) {
    await pages[0].click('#choose-menifot-btn');
    await sleep(800);
    await pages[0].click('#mf-start-btn');
    await sleep(2000);
    await shot(pages[0], 'menifot');
  },
  async warfront(pages) {
    await pages[0].click('#choose-warfront-btn');
    await sleep(1000);
    for (const [i, p] of pages.entries()) await clickIfVisible(p, i % 2 ? '#wf-join-blue' : '#wf-join-red');
    for (const p of pages.slice(0, 2)) await clickIfVisible(p, '#wf-captain-btn');
    for (const [i, p] of pages.entries()) await p.locator('.race').nth(i % 3).click();
    await sleep(800);
    await shot(pages[0], 'warfront-lobby');
    await pages[0].click('#wf-start-btn');
    await sleep(12000);
    await shot(pages[0], 'warfront-battle');
  },
  async bluff(pages) {
    await pages[0].click('#choose-bluff-btn');
    await sleep(800);
    await pages[0].click('#bf-start-btn');
    await sleep(2500);
    await shot(pages[0], 'bluff');
  },
  async allinorfold(pages) {
    await pages[0].click('#choose-allinorfold-btn');
    await sleep(800);
    for (const p of pages.slice(1)) await clickIfVisible(p, '#choose-allinorfold-btn');
    await sleep(400);
    for (const [i, p] of pages.entries()) {
      await clickIfVisible(p, `.aiof-seat-slot-${i}`);
      await sleep(400);
      await clickIfVisible(p, '#aiof-buyin-confirm-btn');
      await sleep(400);
    }
    await pages[0].click('#aiof-start-btn');
    await sleep(3000);
    await shot(pages[1], 'allinorfold');
  },
};
const PLAYERS = { menifot: 3 };

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
    const server = await startServer();
    try {
      const pages = await joinPlayers(browser, PLAYERS[name] || 4);
      await take(pages);
      await Promise.all(pages.map((p) => p.context().close()));
    } catch (err) {
      failed++;
      console.error(`  FAILED: ${err.message.split('\n')[0]}`);
    } finally {
      server.kill();
      await sleep(300);
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
