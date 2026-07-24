'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer', 'pet.js'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'tools', 'build_frame_preserving_identity_actions.py'), 'utf8');
const identities = ['programmer', 'writer', 'chubby'];
const actions = ['research', 'analysis', 'needs-input', 'failure', 'celebration', 'celebration-alt', 'work-overload', 'rest-roam', 'rest-roll', 'rest-phone', 'rest-special'];

for (const identity of identities) {
  for (const action of actions) {
    const file = path.join(root, 'assets', 'cat', 'office-scene', 'actions', identity, `${action}.webp`);
    assert(fs.existsSync(file), `missing high-frame action: ${identity}/${action}`);
    const header = fs.readFileSync(file).subarray(0, 12).toString('ascii');
    assert(header.startsWith('RIFF') && header.endsWith('WEBP'), `invalid WebP action: ${identity}/${action}`);
  }
}

assert(renderer.includes('OFFICE_HIGH_FRAME_POOLS'), 'state routing must use the high-frame action pools');
assert(renderer.includes('OFFICE_ORIGINAL_PLAIN_GIF_POOLS'), 'the plain cat must use the approved original root GIF pool directly');
assert(renderer.includes("if (identity === 'plain') return officeOriginalPlainAsset(state, session);"), 'plain identity must route to original root GIFs before derived actions');
assert(renderer.includes("if (state === 'celebration') return '../assets/cat/cat-happy.gif';"), 'plain completion must begin with the original ball kick');
assert(renderer.includes('office-scene/actions/${identity}/${action}.webp'), 'state routing must point at the new identity actions');
assert(renderer.includes("research: ['research']"), 'research needs its dedicated high-frame action');
assert(renderer.includes("analysis: ['analysis']"), 'analysis needs its dedicated high-frame action');
assert(renderer.includes("'needs-input': ['needs-input']"), 'need-input needs its dedicated high-frame action');
assert(renderer.includes("'gentle-failure': ['failure']"), 'failure needs its dedicated high-frame action');
assert(renderer.includes("celebration: ['celebration']"), 'completion must retain the ball-kick opening');
assert(renderer.includes("'rest-special'"), 'each identity needs its own relaxed personality rest performance');
assert(!renderer.includes('office-scene/animations/${identity}/rest-phone.gif'), 'resting must use the frame-preserving identity action, not an old generic GIF');
assert(builder.includes('def pose_for_frame'), 'identity parts must follow each source frame head-to-torso pose');
assert(builder.includes('def draw_beret_layers'), 'writer beret needs separate rear-crown and front-brim passes');
assert(builder.includes('Image.alpha_composite(Image.alpha_composite(behind, original), front)'), 'identity layers must flatten around untouched original-cat pixels');
assert(builder.includes('Eyes are the stable character landmark'), 'props must not inflate the perceived cat size');
assert(builder.includes('BORDER = (99, 55, 43, 255)'), 'every added outline must use the original cat brown #63372B');
assert(builder.includes('NAVY = (50, 84, 159, 255)'), 'every added blue identity part must use the original eye blue #32549F');
assert(builder.includes('BODY_FUR = (224, 186, 167, 255)'), 'all source fur must use the phone-rest cat main fur #E0BAA7');
assert(builder.includes('BODY_FUR_SHADE = (221, 183, 165, 255)'), 'all source fur shadows must use the phone-rest cat shade #DDB7A5');
assert(builder.includes('BODY_WHITE = (252, 251, 251, 255)'), 'all source faces and bellies must use the phone-rest cat white #FCFBFB');
assert(builder.includes('frame = canonicalize_body_palette(frame)'), 'every identity and action must receive body palette normalisation');
assert(!renderer.includes('return `../assets/cat/office-scene/cats/${identity}.png`'), 'runtime must not fall back to separately redrawn identity cats');

console.log('high-frame identity actions: ok');
