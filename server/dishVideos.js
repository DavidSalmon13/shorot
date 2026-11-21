/** The 🧽 Go Do the Dishes gag's AI video of the target at a kitchen sink (see server/gagVideos.js). */
const { createGagVideos } = require('./gagVideos');

module.exports = createGagVideos({
  kind: 'dishes',
  dir: 'dishvideos',
  version: 1,
  prompt:
    'Photorealistic phone video. The person from the photo is standing at a kitchen sink ' +
    'in a real home kitchen, grumpily scrubbing a dirty plate with a yellow sponge, soap suds, ' +
    'running tap. They sigh, roll their eyes and keep scrubbing. Keep their face exactly the same. ' +
    'Natural light, slight handheld camera, filmed from across the counter.',
});
