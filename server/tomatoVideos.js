/**
 * The 🍅 Tomato Throw gag's AI video of the target getting splatted by a tomato (see
 * server/gagVideos.js). Same flow as the Dishes clip: made once per photo sticker, in the
 * background, the first time that player is hit; until then the drawn splat plays alone.
 */
const { createGagVideos } = require('./gagVideos');

module.exports = createGagVideos({
  kind: 'tomato',
  dir: 'tomatovideos',
  version: 1,
  prompt:
    'Photorealistic slapstick comedy phone video. The person from the photo is at a sunny backyard ' +
    'party. A big ripe tomato flies in from off-screen and splats on their forehead, bursting into ' +
    'juicy red pulp and seeds that drip down their face. They flinch, freeze in shock, wipe the pulp ' +
    'from their eyes, then glare at the camera in comic outrage. Keep their face exactly the same. ' +
    'Natural light, slight handheld camera, natural sound.',
});
