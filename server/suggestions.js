/**
 * Suggestion box: the 💡 button in the app header (public/js/shared/suggestionBox.js) posts
 * here; messages land in Postgres (migrations/008_suggestions.sql) and the admin reads them
 * in /admin's Messages tab (server/admin.js). Open to guests too - the sender is whatever
 * in-game name they typed, plus their account when signed in. Needs DATABASE_URL.
 */
const express = require('express');
const db = require('./db');
const accounts = require('./accounts');

const MAX_MESSAGE = 1000;
const MAX_NAME = 40;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

// key (ip|clientId) -> recent send timestamps. In-memory, like everything else per-process here.
const recentSends = new Map();

/** Trims and validates a submission body. Returns { ok, error } or { ok, value }. */
function cleanSuggestion(body) {
  const message = String((body && body.message) || '').trim();
  if (!message) return { ok: false, error: 'Write something first' };
  if (message.length > MAX_MESSAGE) return { ok: false, error: `Keep it under ${MAX_MESSAGE} characters` };
  const short = (v, max) => String(v || '').trim().slice(0, max) || null;
  return {
    ok: true,
    value: {
      message,
      name: short(body.name, MAX_NAME),
      clientId: short(body.clientId, 64),
      room: short(body.room, 8),
    },
  };
}

/** True when `key` may send now (and records the send). */
function allowSend(key, now = Date.now()) {
  const list = (recentSends.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) {
    recentSends.set(key, list);
    return false;
  }
  list.push(now);
  recentSends.set(key, list);
  return true;
}

function registerSuggestionRoutes(app) {
  const json = express.json({ limit: '4kb' });

  app.post('/api/suggestions', json, async (req, res) => {
    try {
      if (!db.isEnabled()) return res.status(503).json({ ok: false, error: 'Suggestions are not available right now' });
      const cleaned = cleanSuggestion(req.body);
      if (!cleaned.ok) return res.status(400).json(cleaned);
      // Per device: a whole room on one wifi shares an IP, so the IP alone is too coarse.
      if (!allowSend(`${req.ip || 'unknown'}|${cleaned.value.clientId || ''}`)) {
        return res.status(429).json({ ok: false, error: 'Too many messages - try again in a few minutes' });
      }
      const user = await accounts.userFromRequest(req);
      const { message, name, clientId, room } = cleaned.value;
      await db.query(
        `INSERT INTO suggestions (message, name_used, user_id, client_id, room_code)
         VALUES ($1, $2, $3, $4, $5)`,
        [message, name, user ? user.id : null, clientId, room]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error('Saving a suggestion failed:', err.message);
      res.status(500).json({ ok: false, error: 'Something went wrong' });
    }
  });
}

module.exports = { registerSuggestionRoutes, cleanSuggestion, allowSend, MAX_MESSAGE };
