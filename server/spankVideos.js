/**
 * The 🍑 Spanking gag's AI video of the target (see server/gagVideos.js): in boxers, back to the
 * camera, looking back over their shoulder in fear while a dark figure slaps their backside.
 */
const { createGagVideos } = require('./gagVideos');

module.exports = createGagVideos({
  kind: 'spank',
  dir: 'spankvideos',
  version: 1,
  prompt:
    'Photorealistic comedic phone video. The person from the photo is standing in a dim living room ' +
    'wearing only plain loose boxer shorts, with their back to the camera. They turn their head and ' +
    'look back over their shoulder straight at the camera, wide-eyed and terrified. A dark shadowy ' +
    'hooded figure steps in from the side and gives them one firm open-hand slap on the seat of ' +
    'their boxers; they jolt forward and yelp. Keep their face exactly the same. Slapstick comedy, ' +
    'non-sexual. Moody light, slight handheld camera.',
});
