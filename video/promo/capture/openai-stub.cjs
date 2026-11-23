// Preloaded into the Shorot server (node -r) while capturing promo screenshots: answers
// OpenAI chat calls with fixed words, so Imposter/Codenames run offline and look the same every take.
const realFetch = global.fetch;
const GRID = ['Pizza', 'Rocket', 'Beach', 'Ghost', 'Piano', 'Castle', 'Tiger', 'Laser', 'Honey', 'Ninja',
  'Diamond', 'Volcano', 'Pirate', 'Cactus', 'Robot', 'Jungle', 'Mirror', 'Dragon', 'Bridge', 'Comet',
  'Coffee', 'Wizard', 'Guitar', 'Island', 'Shadow', 'Falafel', 'Galaxy', 'Lemon', 'Anchor', 'Banana'];
global.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.openai.com/')) return realFetch(url, opts);
  const prompt = JSON.parse(opts.body).messages.map((m) => m.content).join("\n");
  const count = Number((prompt.match(/exactly (\d+) items/) || [])[1]) || 25;
  const content = prompt.includes('{"words"') ? { words: GRID.slice(0, count) } : { word: 'Pizza', hint: 'Italian' };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
