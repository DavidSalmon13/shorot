/**
 * The 🍑 Spanking gag's AI video of the target (see server/gagVideos.js), made in two steps so
 * it looks like them: an image-edit model first puts their face into the opening frame (at a
 * pool in a speedo, back to the camera, looking back over their shoulder in fear, a dark hooded
 * figure behind them with a hand raised), then the video model animates the jump-scare.
 *
 * Opt-in only: lobby.js asks server/spankConsent.js before using or making one. If fal's
 * content check refuses a step, that player simply gets the cartoon Spanking (the reason is in
 * the server log) - the prompts are not to be reworded just to get past it.
 */
const { createGagVideos } = require('./gagVideos');

module.exports = createGagVideos({
  kind: 'spank',
  dir: 'spankvideos',
  // v3: opt-in, two-step (frame, then video), speedo at a pool. v4: playful reaction (the game
  // draws the hit over the clip: storeFx.js buildSpank).
  version: 4,
  frame: {
    prompt:
      'Photorealistic photo of the same person as in the input image, keeping their face exactly the ' +
      'same and clearly recognizable. They stand at the edge of an outdoor swimming pool wearing a ' +
      'swimming speedo, back to the camera, full body visible from head to knees. They look back over ' +
      'their shoulder straight at the camera, wide-eyed and scared, so their face is clearly visible. ' +
      'Right behind them stands a tall figure in a dark hooded cloak, face hidden in shadow, one open ' +
      'hand raised high. Bright daylight, phone photo, comedy.',
  },
  // fal's check refuses any wording where the figure hits (or even lunges at) a real person's
  // photo, so the clip is the scare, the jump and a laugh; the game draws a cartoon smack over it.
  prompt:
    'Playful comedy video. The hooded figure behind them leans in close. The person jumps in the air ' +
    'with a startled yelp, gasps in mock outrage with a hand on their chest, then bursts out laughing ' +
    'and shakes their head at the camera. Keep their face exactly the same. Slight handheld camera, ' +
    'natural sound.',
});
