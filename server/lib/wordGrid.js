'use strict';

const { chatCompletionJson } = require('./openai');

/**
 * Asks ChatGPT for `count` distinct single-word nouns for a word board (Codenames' 5x5 grid,
 * Imposter's Board mode). `language` is the room's wordLanguage, `theme` its optional free-text
 * wordTheme, `avoid` recently used words. Throws if the reply has fewer than `count` unique words.
 */
async function generateWordGrid({ count, avoid = [], language = 'english', theme = '' }) {
  const languageInstruction = language === 'hebrew' ? ' Write every word in Hebrew.' : '';
  const cleanTheme = (theme || '').trim();
  const themeInstruction = cleanTheme
    ? ` All words must be related or loosely related to this theme: "${cleanTheme}". Mix directly obvious words ` +
      `with more loosely-associated ones - not every word should be the single most obvious item for the theme.`
    : ` Covering a broad mix of categories (objects, animals, food, places, jobs, nature, sports, tools, ` +
      `clothing, etc).`;
  const prompt =
    `Generate exactly ${count} common, family-friendly, single-word nouns suitable for a word-guessing ` +
    `party game grid. Each must be ONE word (no phrases, no proper nouns), instantly recognizable to most ` +
    `adults.${themeInstruction} All ${count} words must be different from each other.${languageInstruction}` +
    (avoid.length
      ? ` These words were used recently - avoid all of them: ${avoid.join(', ')}.`
      : '') +
    ` Respond with ONLY compact JSON in the form {"words": ["...", ...]} with exactly ${count} items.`;

  const parsed = await chatCompletionJson(prompt, { temperature: 1.1 });
  const rawWords = Array.isArray(parsed.words) ? parsed.words : [];
  const words = rawWords.map((w) => String(w || '').trim()).filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(w);
  }

  if (unique.length < count) {
    throw new Error('Incomplete word grid from OpenAI');
  }

  return unique.slice(0, count);
}

module.exports = { generateWordGrid };
