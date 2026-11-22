/**
 * The 🍅 Tomato Throw gag's AI video of the target getting splatted by a tomato (see
 * server/gagVideos.js). Same flow as the Dishes clip: made once per photo sticker, in the
 * background, the first time that player is splatted; until then the drawn splat plays alone.
 */
const { createGagVideos } = require('./gagVideos');

module.exports = createGagVideos({
  kind: 'tomato',
  dir: 'tomatovideos',
  // v2: fal's content check refused v1 (a tomato hitting their face). Now it's a friendly
  // tomato-festival food fight they're enjoying: a soft splash on the shirt, and they laugh it off.
  version: 2,
  prompt:
    'Photorealistic, wholesome, funny phone video. The person from the photo is happily joining a ' +
    'colorful tomato festival food fight with friends on a sunny street, everyone laughing and having ' +
    'fun. A soft, overripe tomato lands with a big juicy splash on their shirt, spraying harmless red ' +
    'juice. They gasp in mock surprise, look down at their shirt, then burst out laughing, wipe a ' +
    'little juice off their cheek and give the camera a cheerful thumbs up. Keep their face exactly ' +
    'the same. Natural light, slight handheld camera, natural sound.',
});
