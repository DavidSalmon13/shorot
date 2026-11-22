/**
 * Consent for the 🍑 Spanking gag's realistic AI video (server/spankVideos.js). It's opt-in,
 * and only the person in the photo can opt in:
 *   - stickers uploaded while signed in remember their uploader (sticker_uploads);
 *   - a signed-in player can turn the video on for themselves (users.spank_video_opt_in_at),
 *     from their account page, and it only ever applies to a sticker THEY uploaded;
 *   - turning it off (themselves, or an admin from /admin) deletes their cached clips.
 * Admins can switch it off but never on - consent can't be given on someone else's behalf.
 * Built-in stickers, guests and stickers someone else uploaded never get a video.
 * No database = never allowed.
 */
const db = require('./db');
const spankVideos = require('./spankVideos');

/** Records who uploaded a sticker. Never throws (an upload must not fail over this). */
async function recordUpload(sticker, userId) {
  if (!db.isEnabled() || !userId || !sticker) return;
  try {
    await db.query(
      'INSERT INTO sticker_uploads (sticker, user_id) VALUES ($1, $2) ON CONFLICT (sticker) DO NOTHING',
      [sticker, userId]
    );
  } catch (err) {
    console.error('Recording sticker uploader failed:', err.message);
  }
}

/** May this account's player get an AI spank video made from this sticker? */
async function isAllowed(userId, sticker) {
  if (!db.isEnabled() || !userId || !sticker) return false;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM users u JOIN sticker_uploads s ON s.user_id = u.id
        WHERE u.id = $1 AND s.sticker = $2 AND u.spank_video_opt_in_at IS NOT NULL AND u.banned_at IS NULL`,
      [userId, sticker]
    );
    return rows.length > 0;
  } catch (err) {
    console.error('Spank video consent check failed:', err.message);
    return false;
  }
}

/**
 * { optedIn, ownSticker } for the account page: whether it's on, and whether their current
 * sticker is one they uploaded (else turning it on won't do anything yet).
 */
async function status(userId) {
  const { rows } = await db.query(
    `SELECT u.spank_video_opt_in_at,
            EXISTS (SELECT 1 FROM sticker_uploads s WHERE s.user_id = u.id AND s.sticker = u.sticker) AS own
       FROM users u WHERE u.id = $1`,
    [userId]
  );
  if (!rows.length) return { optedIn: false, ownSticker: false };
  return { optedIn: !!rows[0].spank_video_opt_in_at, ownSticker: !!rows[0].own };
}

/** Turns it on (only ever from the account itself) or off; off deletes their cached clips. */
async function setOptIn(userId, on) {
  await db.query(
    `UPDATE users SET spank_video_opt_in_at = CASE WHEN $2 THEN COALESCE(spank_video_opt_in_at, now()) END WHERE id = $1`,
    [userId, !!on]
  );
  if (!on) await removeVideosOf(userId);
}

async function removeVideosOf(userId) {
  const { rows } = await db.query('SELECT sticker FROM sticker_uploads WHERE user_id = $1', [userId]);
  for (const r of rows) spankVideos.removeVideo(r.sticker);
}

/**
 * GET/POST /api/account/spank-video: the signed-in player's own switch ({ on: true|false }).
 * The admin's switch-off is in server/admin.js.
 */
function registerRoutes(app, express) {
  const { userFromRequest } = require('./accounts');
  const handle = (fn) => async (req, res) => {
    if (!db.isEnabled()) return res.status(503).json({ ok: false, error: 'Accounts are not available' });
    try {
      const user = await userFromRequest(req);
      if (!user) return res.status(401).json({ ok: false, error: 'Not signed in' });
      await fn(user, req);
      res.json({ ok: true, ...(await status(user.id)) });
    } catch (err) {
      console.error('Spank video setting failed:', err.message);
      res.status(500).json({ ok: false, error: 'Could not update the setting' });
    }
  };
  app.get('/api/account/spank-video', handle(async () => {}));
  app.post('/api/account/spank-video', express.json({ limit: '1kb' }), handle(async (user, req) => {
    await setOptIn(user.id, !!(req.body && req.body.on === true));
  }));
}

module.exports = { recordUpload, isAllowed, status, setOptIn, removeVideosOf, registerRoutes };
