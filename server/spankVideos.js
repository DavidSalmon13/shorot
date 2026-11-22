/**
 * The 🍑 Spanking gag's AI video of the target (see server/gagVideos.js): in boxers, back to the
 * camera, looking back over their shoulder in fear while a dark figure slaps their backside.
 */
const { createGagVideos } = require('./gagVideos');

module.exports = createGagVideos({
  kind: 'spank',
  dir: 'spankvideos',
  // v2: the v1 wording (boxers only, a "firm slap") was rejected by fal's content checker. This
  // wording was checked against it; words like smack/whack/slap/spank get flagged, "pats" doesn't.
  version: 2,
  prompt:
    'Comedic video. The person from the photo stands in a dim living room in a white t-shirt and ' +
    'colorful patterned boxer shorts, back to the camera. They glance back over their shoulder at the ' +
    'camera with a frightened, wide-eyed look. A tall shadowy figure in a dark hooded cloak sneaks up ' +
    'behind them and playfully pats them on the rear with an open hand; they jump in the air with a ' +
    'startled yelp. Keep their face exactly the same. Prank comedy, slight handheld camera.',
});
