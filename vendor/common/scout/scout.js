/*!
 * Scout: the suite's assistant, a beagle on his mat. No image files: the character is an SVG rig posed
 * procedurally every frame. assistant.js puts him in the apps; this file is only the character.
 *
 * Coverage
 *   - All 43 actions in the Office "Clippit" agent data, under the same names
 *     (Congratulate, IdleRopePile, GetWizardy, Hearing_1, ...), and 24 extras of his own (9 of them small idles).
 *   - All 35 Office 2003 MsoAnimationType constants, accepted as aliases
 *     (play('msoAnimationPrinting') plays Print).
 *
 *   const scout = new L.Scout({ onclick, onmenu });   // floating, bottom-right; styles in scout.css
 *   scout.show();                                     // unroll the mat and pop in
 *   scout.speak('Need a hand? I can sniff that out.');
 *   scout.ask('What would you like to do?', ['Print it', 'Save it']).then(choice => …);
 *   scout.play('Searching');                          // any action name or Office constant
 *
 * The frame loop runs only while something moves, as Microsoft Agent's sprite held its frame between animations:
 * at rest he sits still and nothing is drawn but a blink now and then (every frame) and now and then a slow sway of
 * the tail (about 10 frames a second, as a nap); it stops once he is hidden and starts again with the next action;
 * freeze(true) stops it while he is shown (the window in the background).
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ math */
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    lin: x => x,
    io: x => (x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
    out: x => 1 - Math.pow(1 - x, 3),
    in: x => x * x * x,
    back: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  };
  /** Rises over [a,b], holds, falls over [c,d]. */
  const win = (t, a, b, c, d, e = E.io) => e(seg(t, a, b)) * (1 - e(seg(t, c, d)));
  /** 0 → 1 → 0 over [a,b]. */
  const bump = (t, a, b) => { const x = seg(t, a, b); return x <= 0 || x >= 1 ? 0 : Math.sin(x * Math.PI); };
  const osc = (t, hz, ph = 0) => Math.sin((t * hz + ph) * Math.PI * 2);
  const rnd = (i, s = 1) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  const mix2 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  const rot = (deg, x, y) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };
  const f = v => Math.round(v * 100) / 100;
  const range = n => Array.from({ length: n }, (_, i) => i);
  const D2R = Math.PI / 180;

  /* --------------------------------------------------------------- palette */
  const C = {
    line: '#4a3426',
    tan: '#c97a3c', tanD: '#a35a24', tanL: '#e2a464', pip: '#efc187',
    black: '#3a302a',
    white: '#fbf8f2', whiteD: '#e6dccd',
    ear: '#8c4c22', earD: '#6a3615', earL: '#ad6830',
    nose: '#231d1a', iris: '#5a3218', pupil: '#140c08',
    mouth: '#6d2a2c', tongue: '#e8727c', tongueD: '#c4505b',
    collar: '#2f6fb3', collarL: '#7fb0e6', tag: '#f0bf45', tagD: '#c9952a',
    pad: '#cf8b86'
  };
  const LINE = C.line;
  const OL = `stroke="${LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;
  const MIR = 'matrix(-1 0 0 1 200 0)';
  const PARTY = ['#e5483d', '#f0bf45', '#2f6fb3', '#3fa66b', '#e77fb0', '#8c5bd0'];

  /* ------------------------------------------------------- rig constants */
  const UPPER = 24, FORE = 27;                 // front leg segment lengths
  const RWL = [87, 173], RWR = [113, 173];     // resting paw positions
  /* The camera: three-quarter, body angled toward screen-left, head turned to the viewer. Actions are authored in
   * front-facing rig coordinates (forward toward the viewer); the camera maps them. */
  const VIEW = {
    head: -16, scene: -16, turn: -.3, hr: 3, tail: [150, 150], tailAdd: 6, shadow: [108, 54],
    sh: { L: [69, 121], R: [87, 124] }, d: { L: [-18, -1.5], R: [-26, 2.5] },
    /* forward points to screen-left and toward the viewer; the near side (+lateral) is screen-right */
    cam: { O: [134, 173.5], F: [-.8, .16], U: [0, -1], L: [.6, .22], floor: 176.5, D: [.58, .27, .77] },
    hind3: { L: { lz: -15, side: -1, splay: 12, slot: 'back', far: 1 }, R: { lz: 15, side: 1, splay: 12, slot: 'front', ear: [133, 84], roll: 4 } }
  };
  /* One canine hind leg, in rig units. Bones: femur, tibia, metatarsus (dogs stand on their toes,
   * so the hock is a lifted heel). Angles are the direction from the ball of the foot to the hock:
   * sitting it lies flat behind the paw, standing it rises steeply, hanging it points almost straight up. */
  const HIND3 = { hipY: 27, femur: 25, tibia: 27, meta: 13.5, ball: 12.5, metR: 3.4, reach: 22,
    sitHock: 174, standHock: 108, hangHock: 96, thA: 13.5, thW: 16, thS: 19, gas: 7.5, wK: 12, wH: 10, wM: 9 };

  /* Where scene objects stand, in scene coordinates (the scene layer is shifted by the camera's scene). */
  const STAGE = { printer: [42, 176], easel: [46, 176], trash: [44, 176] };

  /** The head's outline, its chin moved by (dx, down) and its crown by up (<= 0), from 'M100 37C123 37 135 52 134 70C133 88 121 104
   *  100 104C79 104 67 88 66 70C65 52 77 37 100 37Z' at rest; map (x, y) => [x, y] puts it in another space. */
  function skullPath(dx, down, up, map) {
    const P = (x, y) => { const q = map ? map(x, y) : [x, y]; return f(q[0]) + ' ' + f(q[1]); }, tx = dx * .5;
    return `M${P(100 + tx, 37 + up)}C${P(123 + tx, 37 + up)} ${P(135, 52 + up * .5)} ${P(134, 70)}` +
      `C${P(133 + dx * .5, 88 + down * .5)} ${P(121 + dx, 104 + down)} ${P(100 + dx, 104 + down)}` +
      `C${P(79 + dx, 104 + down)} ${P(67 + dx * .5, 88 + down * .5)} ${P(66, 70)}C${P(65, 52 + up * .5)} ${P(77 + tx, 37 + up)} ${P(100 + tx, 37 + up)}Z`;
  }

  /* ------------------------------------------------------------ the pose */
  function rest() {
    return {
      x: 0, y: 0, rot: 0, sx: 1, sy: 1, scale: 1, opacity: 1, lean: 0,
      mat: 1, matO: 1, shadow: 1, breath: 0,
      hx: 0, hy: 0, hr: 0, turn: 0, faceY: 0,
      lookX: 0, lookY: 0, lidL: 0, lidR: 0, lowL: 0, lowR: 0, happy: 0, eyeS: 1,
      browL: 0, browR: 0, browTL: .18, browTR: .18,
      mouth: 0, smile: 0, tongue: 0, tongueX: 0, sniff: 0,
      earL: 5, earR: 5,
      wL: RWL.slice(), wR: RWR.slice(), pawSL: 1, pawSR: 1, padsL: 0, padsR: 0, elbL: 0, elbR: 0,
      absL: 0, absR: 0, wRL: 0, held: null, write: null,
      kL: 0, kR: 0, scrR: 0,
      tail: 35, wag: 0, wagHz: 3, autoBlink: 1,
      props: {}
    };
  }
  const NUM_KEYS = (() => { const r = rest(); return Object.keys(r).filter(k => typeof r[k] === 'number'); })();

  /* ---------------------------------------------------- authoring helpers */
  function blink(p, t, at, d = .18) { const b = bump(t, at, at + d); if (b > p.lidL) p.lidL = b; if (b > p.lidR) p.lidR = b; }
  function talk(p, t, a, b, amt = .55) {
    const k = win(t, a, a + .12, b - .12, b);
    if (k > 0) p.mouth = Math.max(p.mouth, k * amt * (.3 + .7 * Math.abs(Math.sin(t * 13))));
  }
  function squash(p, t, at, d = .2, amt = .1) { const b = bump(t, at, at + d); p.sy *= 1 - amt * b; p.sx *= 1 + amt * .7 * b; }
  function jump(p, t, a, b, h) {
    const x = seg(t, a, b);
    if (x > 0 && x < 1) { const s = Math.sin(x * Math.PI); p.y -= 4 * h * x * (1 - x); p.sy *= 1 + .07 * s; p.sx *= 1 - .04 * s; }
  }
  function waveR(p, t, k) {
    if (k <= 0) return;
    p.wR = mix2(p.wR, [139 + 7 * osc(t, 2.4), 82 + 2 * osc(t, 4.8)], k);
    p.padsR = Math.max(p.padsR, k);
  }
  function both(p, key, v) { p[key + 'L'] += v; p[key + 'R'] += v; }
  /** Wrist position that puts a held prop's tip (at local (0,-len) when r = 0) on `tip`. */
  function wristFor(tip, r, len) { const o = rot(r, 0, -len); return [tip[0] - o[0], tip[1] - o[1]]; }

  /* ================================================================ ACTIONS
   * Every action is a pure function of time: pose(t, p) adjusts the resting
   * pose for time t (seconds). That makes each one seekable for the viewer.
   * cat: viewer group; key: thumbnail frame; office: MsoAnimationType aliases.
   */
  const A = {};

  A.RestPose = {
    cat: 'idle', dur: .6, key: .3, office: ['msoAnimationRestPose'],
    desc: 'The neutral sitting pose that every other action starts from and returns to.',
    pose() {}
  };

  A.Idle1_1 = {
    cat: 'idle', dur: 3.4, key: 1.5, loop: true, office: ['msoAnimationIdle'],
    desc: 'Breathes, blinks, tilts his head a little and flicks one ear.',
    pose(t, p) {
      blink(p, t, .35); blink(p, t, 2.55);
      const k = win(t, .8, 1.15, 2.0, 2.45);
      p.hr += 6 * k; p.lookX += .35 * k; p.lookY -= .15 * k; p.browR += .35 * k;
      p.earR += 16 * bump(t, 1.25, 1.42) + 8 * bump(t, 1.42, 1.58);
      p.wag = 6; p.wagHz = 1.6;
    }
  };

  A.Show = {
    cat: 'entrance', dur: 1.15, key: 1.0, office: ['msoAnimationAppear'],
    desc: 'Unrolls his mat and pops up onto it with a springy landing.',
    pose(t, p) {
      p.mat = E.back(seg(t, 0, .34)); p.matO = seg(t, 0, .12);
      const k = seg(t, .22, .72);
      p.scale = E.back(k); p.opacity = seg(t, .22, .3); p.y += 24 * (1 - E.out(k));
      squash(p, t, .7, .24, .12);
      both(p, 'ear', 32 * bump(t, .5, .98));
      blink(p, t, .9);
      p.smile += .5 * win(t, .72, .86, .98, 1.15);
      p.wag = 18 * seg(t, .62, .8); p.wagHz = 4;
      if (t < .7) p.props.poof = { k: seg(t, .16, .7), x: 100, y: 158 };
    }
  };

  A.Hide = {
    cat: 'entrance', dur: 1.0, key: .38, hides: true, office: ['msoAnimationDisappear'],
    desc: 'Squeezes his eyes shut, ducks down into the mat, and the mat rolls itself away.',
    pose(t, p) {
      squash(p, t, 0, .22, .12);
      const k = seg(t, .18, .6);
      p.scale = 1 - E.in(k); p.y += 20 * E.in(k); p.opacity = 1 - seg(t, .5, .6);
      both(p, 'ear', 36 * seg(t, .14, .4));
      const sq = seg(t, .06, .22); p.lidL = p.lidR = .85 * sq; p.lowL = p.lowR = .4 * sq;
      p.mat = 1 - E.in(seg(t, .58, .95)); p.matO = 1 - seg(t, .86, 1);
      if (t > .42 && t < .95) p.props.poof = { k: seg(t, .42, .95), x: 100, y: 164 };
    }
  };

  A.Greeting = {
    cat: 'entrance', dur: 3.0, key: 1.75, office: ['msoAnimationGreeting'],
    desc: 'Pops onto the mat, then waves hello with his eyes crinkled and tail going.',
    pose(t, p) {
      A.Show.pose(Math.min(t, 1.15), p);
      const k = win(t, 1.05, 1.35, 2.5, 2.85);
      waveR(p, t, k);
      p.happy = .95 * win(t, 1.3, 1.45, 2.3, 2.5);
      p.smile = Math.max(p.smile, .7 * k); p.mouth = Math.max(p.mouth, .35 * k);
      p.hr -= 7 * k; p.wag = Math.max(p.wag, 22 * k); p.wagHz = 5;
    }
  };

  A.GoodBye = {
    cat: 'entrance', dur: 3.2, key: .85, hides: true, office: ['msoAnimationGoodbye'],
    desc: 'Waves a slightly wistful goodbye, hops up and drops through the mat, which rolls up after him.',
    pose(t, p) {
      const k = win(t, .05, .35, 1.35, 1.6);
      waveR(p, t, k);
      both(p, 'brow', .35 * k); both(p, 'browT', .7 * k);
      p.smile += .3 * k; p.hr -= 6 * k; p.wag = 10 * k;
      squash(p, t, 1.65, .3, .14);
      const up = seg(t, 1.95, 2.25), down = seg(t, 2.25, 2.7);
      p.y -= 20 * E.out(up) * (1 - down); p.y += 34 * E.in(down);
      p.scale *= 1 - .9 * E.in(down);
      p.sy *= 1 + .1 * bump(t, 1.95, 2.4);
      p.opacity *= 1 - seg(t, 2.55, 2.7);
      both(p, 'ear', 40 * bump(t, 1.95, 2.6));
      p.happy = .9 * win(t, 1.85, 1.95, 2.6, 2.7);
      p.mat = 1 - E.in(seg(t, 2.65, 3.1)); p.matO = 1 - seg(t, 2.95, 3.15);
      if (t > 2.45 && t < 3.0) p.props.poof = { k: seg(t, 2.45, 3.0), x: 100, y: 166 };
    }
  };

  A.Wave = {
    cat: 'gesture', dur: 2.1, key: .8, office: [],
    desc: 'Raises a front paw, pads showing, and waves.',
    pose(t, p) {
      const k = win(t, .05, .35, 1.7, 2.05);
      waveR(p, t, k);
      p.hr -= 7 * k; p.smile += .6 * k; p.mouth = .25 * k; p.lookX += .1 * k;
      p.earL += 6 * k; p.wag = 16 * k; p.wagHz = 4;
      blink(p, t, 1.2);
    }
  };

  A.Congratulate = {
    cat: 'reaction', dur: 2.8, key: .62, office: ['msoAnimationCharacterSuccessMajor'],
    desc: 'Jumps up with both paws in the air while confetti flies.',
    pose(t, p) {
      squash(p, t, 0, .28, .12);
      jump(p, t, .25, .8, 34);
      squash(p, t, .78, .2, .12);
      jump(p, t, 1.05, 1.4, 10);
      squash(p, t, 1.38, .16, .08);
      const k = win(t, .15, .4, 2.2, 2.6), w = osc(t, 3.5);
      p.wL = mix2(p.wL, [62 + 3 * w, 64 - 2 * w], k); p.wR = mix2(p.wR, [138 - 3 * w, 64 + 2 * w], k);
      p.padsL = p.padsR = k;
      p.happy = .95 * win(t, .25, .4, 2.1, 2.4); p.mouth = .75 * k; p.smile += .75 * k;
      both(p, 'ear', 45 * bump(t, .25, .85) + 25 * bump(t, 1.05, 1.45));
      p.wag = 30 * k; p.wagHz = 6;
      p.props.confetti = { o: 1 - seg(t, 2.45, 2.8), k: seg(t, .42, 2.8) };
    }
  };

  A.Alert = {
    cat: 'reaction', dur: 1.6, key: .45, office: ['msoAnimationGetAttentionMinor'],
    desc: 'Ears shoot up, eyes go wide and an exclamation mark pops overhead.',
    pose(t, p) {
      const k = win(t, 0, .12, 1.15, 1.55, E.out);
      p.y -= 7 * bump(t, .02, .3); p.sy *= 1 + .07 * bump(t, .02, .3);
      p.eyeS = 1 + .22 * k; both(p, 'brow', k);
      both(p, 'ear', 55 * k);
      p.mouth = .45 * k; p.smile -= .45 * k;
      p.tail = 35 - 25 * k; p.hy -= 2 * k;
      p.props.exclaim = { o: win(t, .05, .12, 1.1, 1.35), s: E.back(seg(t, .05, .3)) };
    }
  };

  A.GetAttention = {
    cat: 'reaction', dur: 2.6, key: 1.0, office: ['msoAnimationGetAttentionMajor'],
    desc: 'Leans in and taps on the glass three times, then gives one short bark.',
    pose(t, p) {
      const k = win(t, 0, .35, 2.1, 2.55);
      p.scale *= 1 + .07 * k; p.y += 3 * k;
      const knocks = [.75, 1.05, 1.35];
      const hit = knocks.reduce((m, a) => Math.max(m, bump(t, a - .12, a + .1)), 0);
      p.wR = mix2(p.wR, [136, 100 + 4 * hit], k);
      p.pawSR = 1 + .7 * k + .25 * hit; p.padsR = k;
      p.hr += 6 * k; both(p, 'brow', .6 * k); both(p, 'browT', .4 * k);
      both(p, 'ear', 10 * hit);
      const bark = bump(t, 1.6, 1.95);
      p.mouth = Math.max(p.mouth, .9 * bark); both(p, 'ear', 25 * bark); p.y -= 3 * bark;
      if (t > .6 && t < 1.7) p.props.ripple = { t, hits: knocks };
      p.props.woof = { o: win(t, 1.6, 1.68, 2.0, 2.2), s: E.back(seg(t, 1.6, 1.8)) };
      p.wag = 12 * k;
    }
  };

  A.Explain = {
    cat: 'gesture', dur: 1.8, key: .8, office: ['msoAnimationBeginSpeaking'],
    desc: 'Opens one paw to the side and talks you through something.',
    pose(t, p) {
      const k = win(t, 0, .3, 1.4, 1.75), bob = osc(t, 1.8);
      p.wR = mix2(p.wR, [146 + 3 * bob, 130 - 4 * bob], k); p.padsR = .9 * k;
      p.wL = mix2(p.wL, [80, 160], .6 * k);
      p.hr -= 5 * k; p.lean += 2 * k; p.browL += .5 * k; p.browR += .7 * k; p.lookX += .15 * k;
      talk(p, t, .25, 1.45, .6); p.smile += .3 * k;
      p.wag = 8 * k;
    }
  };

  function gesture(side, tgt, dir, look) {
    return function (t, p) {
      const k = win(t, 0, .3, 1.25, 1.6);
      const w = 'w' + side;
      p[w] = mix2(p[w], tgt, k); p['pads' + side] = .8 * k;
      p.lookX += look[0] * k; p.lookY += look[1] * k; p.turn += look[2] * k; p.hr += look[3] * k; p.faceY += look[4] * k;
      both(p, 'brow', .3 * k);
      p.props['pointer' + side] = { o: win(t, .28, .38, 1.15, 1.3), d: dir, t };
    };
  }
  A.GestureUp = {
    cat: 'gesture', dur: 1.6, key: .75, office: ['msoAnimationGestureUp'],
    desc: 'Points a paw straight up and looks where it points.',
    pose(t, p) { gesture('R', [140, 54], -90, [.35, -1, .2, -3, -2])(t, p); p.elbR = win(t, 0, .3, 1.25, 1.6); }
  };
  A.GestureDown = {
    cat: 'gesture', dur: 1.6, key: .75, office: ['msoAnimationGestureDown'],
    desc: 'Lifts a paw and points it down at the floor in front of him, looking where it points.',
    pose(t, p) {
      gesture('R', [136, 150 + 3 * Math.max(0, osc(t, 2.5))], 90, [.45, 1, .25, -5, 3])(t, p);
      const k = win(t, 0, .3, 1.25, 1.6);
      p.scale *= 1 + .03 * k; p.y += 2 * k; p.hy += 3 * k; p.padsR = 0;
    }
  };
  A.GestureLeft = {
    cat: 'gesture', dur: 1.6, key: .75, office: ['msoAnimationGestureLeft'],
    desc: 'Stretches a paw out to the left of the screen and looks along it.',
    pose: gesture('L', [36, 128], 180, [-1, .1, -.6, -4, 0])
  };
  A.GestureRight = {
    cat: 'gesture', dur: 1.6, key: .75, office: ['msoAnimationGestureRight'],
    desc: 'Stretches a paw out to the right of the screen and looks along it.',
    pose: gesture('R', [164, 128], 0, [1, .1, .6, 4, 0])
  };

  function look(lx, ly, turn, hr, fy, extra) {
    return function (t, p) {
      const k = win(t, 0, .28, 1.2, 1.55);
      p.lookX += lx * k; p.lookY += ly * k; p.turn += turn * k; p.hr += hr * k;
      p.faceY += fy * k; p.hy += fy * .35 * k;
      if (extra) extra(p, k);
      blink(p, t, .95);
    };
  }
  const lookUp = (p, k) => { both(p, 'brow', .45 * k); both(p, 'ear', -5 * k); };
  const lookDown = (p, k) => { p.lidL = Math.max(p.lidL, .3 * k); p.lidR = Math.max(p.lidR, .3 * k); };
  A.LookUp = { cat: 'look', dur: 1.6, key: .7, office: ['msoAnimationLookUp'], desc: 'Tips his head back and looks straight up.', pose: look(0, -1, 0, 0, -4, lookUp) };
  A.LookDown = { cat: 'look', dur: 1.6, key: .7, office: ['msoAnimationLookDown'], desc: 'Drops his gaze to the floor just in front of the mat.', pose: look(0, 1, 0, 0, 4.5, lookDown) };
  A.LookLeft = { cat: 'look', dur: 1.6, key: .7, office: ['msoAnimationLookLeft'], desc: 'Turns his head and eyes to the left of the screen.', pose: look(-1, 0, -1, -7, 0) };
  A.LookRight = { cat: 'look', dur: 1.6, key: .7, office: ['msoAnimationLookRight'], desc: 'Turns his head and eyes to the right of the screen.', pose: look(1, 0, 1, 7, 0) };
  A.LookUpLeft = { cat: 'look', dur: 1.6, key: .7, office: ['msoAnimationLookUpLeft'], desc: 'Glances up and to the left.', pose: look(-.85, -.85, -.8, -9, -3, lookUp) };
  A.LookUpRight = { cat: 'look', dur: 1.6, key: .7, office: ['msoAnimationLookUpRight'], desc: 'Glances up and to the right.', pose: look(.85, -.85, .8, 9, -3, lookUp) };
  A.LookDownLeft = { cat: 'look', dur: 1.6, key: .7, office: ['msoAnimationLookDownLeft'], desc: 'Glances down and to the left.', pose: look(-.85, .85, -.8, 7, 3.5, lookDown) };
  A.LookDownRight = { cat: 'look', dur: 1.6, key: .7, office: ['msoAnimationLookDownRight'], desc: 'Glances down and to the right.', pose: look(.85, .85, .8, -7, 3.5, lookDown) };

  A.Thinking = {
    cat: 'task', dur: 3.8, key: 1.95, office: ['msoAnimationThinking'],
    desc: 'Tips his head and rolls his eyes up to the side, mulling it over in a thought bubble until the bulb lights up.',
    pose(t, p) {
      const k = win(t, 0, .4, 3.3, 3.75);
      const idea = win(t, 2.35, 2.5, 3.2, 3.5);
      p.hr += 7 * k; p.lookX += .7 * k; p.lookY -= .85 * k; p.turn += .25 * k;
      p.browL += .1 * k; p.browR += .75 * k; p.browTL -= .5 * k;
      p.smile -= .35 * k;
      p.eyeS += .15 * idea; p.browL += .6 * idea; p.smile += .8 * idea; both(p, 'ear', 18 * idea);
      p.lookY += .5 * idea;
      blink(p, t, 1.55);
      p.props.thought = {
        o: win(t, .45, .6, 3.2, 3.5), b1: seg(t, .45, .6), b2: seg(t, .55, .7), cl: E.back(seg(t, .65, .9)),
        d1: seg(t, 1.0, 1.1) * (1 - idea), d2: seg(t, 1.35, 1.45) * (1 - idea), d3: seg(t, 1.7, 1.8) * (1 - idea),
        bulb: E.back(seg(t, 2.35, 2.6)), glow: idea, t
      };
    }
  };

  A.Processing = {
    cat: 'task', dur: 3.0, key: 1.05, loop: true, office: ['msoAnimationWorkingAtSomething'],
    desc: 'Head down and hard at work, paws kneading while two gears turn overhead.',
    pose(t, p) {
      const k = win(t, 0, .3, 2.7, 3.0);
      const a = Math.max(0, osc(t, 4)), b = Math.max(0, osc(t, 4, .5));
      p.wL = mix2(p.wL, [86, 155 - 7 * a], k); p.wR = mix2(p.wR, [114, 155 - 7 * b], k);
      p.lookY += .7 * k; p.faceY += 1.5 * k; p.hy += 1 * k;
      both(p, 'browT', -.5 * k); both(p, 'brow', -.2 * k);
      p.tongue = .45 * k; p.tongueX = 3; p.smile -= .1;
      p.hr += 2 * osc(t, 1) * k;
      p.props.gears = { o: k, a: t * 240, s: E.back(seg(t, 0, .35)) };
    }
  };

  A.CheckingSomething = {
    cat: 'task', dur: 3.6, key: 2.05, office: ['msoAnimationCheckingSomething'],
    desc: 'A clipboard floats up turned toward him and a pencil ticks off each item while he reads down the list and nods.',
    pose(t, p) {
      const side = -1;   // toward his work, at screen-left
      const k = win(t, 0, .45, 3.15, 3.55);
      const grow = E.back(seg(t, 0, .5)) * (1 - E.in(seg(t, 3.15, 3.55)));
      const rows = [1.05, 1.65, 2.25], Y = [-8, 2, 12];
      const nod = rows.reduce((m, a) => Math.max(m, bump(t, a - .16, a + .14)), 0);
      let row = 0; rows.forEach((a, i) => { if (t > a - .3) row = i; });
      const tick = seg(t, rows[row], rows[row] + .14), y = Y[row];
      const A = [-9.8, y - 1], B = [-7.8, y + 1.4], Cc = [-4.2, y - 4.6];
      const uv = tick < .4 ? mix2(A, B, tick / .4) : mix2(B, Cc, (tick - .4) / .6);
      const onPage = win(t, rows[row] - .06, rows[row], rows[row] + .14, rows[row] + .2);
      p.lookX += .7 * side * k; p.lookY += (.1 + .2 * row) * k;
      p.turn += .35 * side * k; p.hr += 4 * side * k;
      p.faceY += 1.5 * nod; p.hy += 3 * nod; both(p, 'brow', -.2 * k);
      p.smile += .55 * seg(t, 2.35, 2.6) * k;
      both(p, 'ear', 6 * nod);
      p.held = { layer: 'F', items: { clipboard: { s: 1.12 * grow, pos: [32, 116], t, yaw: 45, tilt: 8, c: rows.map(a => seg(t, a, a + .14)), float: true } } };
      p.write = { on: 'clipboard', uv, lift: 3 * (1 - onPage) + 9 * (1 - seg(t, .55, .95)), r: 226, s: 1.15 * grow };
    }
  };

  A.Searching = {
    cat: 'task', dur: 3.8, key: 1.3, office: ['msoAnimationSearching'],
    desc: 'Nose down, with a magnifier floating along in front of him, he sniffs left and right across the mat until he catches the scent.',
    pose(t, p) {
      const k = win(t, 0, .4, 3.3, 3.75);
      const sweep = osc(t - .4, .55);
      const found = win(t, 2.7, 2.85, 3.2, 3.5);
      const s = k * (1 - found);
      p.scale *= 1 + .04 * s; p.y += 4 * s;
      p.hy += 7 * s; p.faceY += 3 * s; p.hr += 8 * sweep * s; p.turn += .55 * sweep * s;
      p.lookX += .8 * sweep * s; p.lookY += .9 * s;
      p.sniff = s * Math.abs(osc(t, 4));
      both(p, 'ear', -6 * s); both(p, 'browT', -.3 * s);
      p.eyeS += .2 * found; both(p, 'brow', .9 * found); both(p, 'ear', 40 * found);
      p.y -= 4 * bump(t, 2.7, 2.95); p.mouth += .35 * found; p.smile += .4 * found;
      p.wag = 6 + 24 * found; p.wagHz = 5;
      const mx = 86;
      p.props.floatMag = { x: mx + 26 * sweep * k, y: 164 + 2 * Math.sin(t * 2.3) - 6 * found, r: -10 * sweep * s, s: 1.1 * E.back(seg(t, 0, .45)) * (1 - E.in(seg(t, 3.3, 3.75))), t };
      p.props.sniff = { o: s, t, x: 100 + 7 * sweep * s, y: 92 + 10 * s };
      p.props.exclaim = { o: win(t, 2.72, 2.8, 3.2, 3.4), s: E.back(seg(t, 2.72, 2.95)) };
    }
  };

  A.Hearing_1 = {
    cat: 'reaction', dur: 2.6, key: 1.2, loop: true, office: ['msoAnimationListensToComputer'],
    desc: 'Lifts one ear and tilts his head to catch what you are saying.',
    pose(t, p) {
      const k = win(t, 0, .35, 2.2, 2.6);
      p.earR += (46 + 6 * osc(t, 3)) * k; p.hr += 13 * k; p.lookX += .55 * k; p.lookY -= .25 * k; p.turn += .2 * k;
      p.browR += .7 * k; p.browL += .3 * k; both(p, 'browT', .5 * k);
      p.smile -= .15 * k;
      p.props.sound = { o: k, t };
      blink(p, t, 1.6);
    }
  };

  A.Writing = {
    cat: 'task', dur: 3.8, key: 2.0, office: ['msoAnimationWritingNotingSomething'],
    desc: 'A notepad floats up beside him, turned toward him, and a pencil writes three lines of notes by itself while he concentrates.',
    pose(t, p) {
      const side = -1;   // toward his work, at screen-left
      const k = win(t, 0, .45, 3.35, 3.75);
      const grow = E.back(seg(t, 0, .5)) * (1 - E.in(seg(t, 3.35, 3.75)));
      const W = [[1.0, 1.7], [1.8, 2.5], [2.6, 3.2]];
      let line = 0; W.forEach((w, i) => { if (t >= w[0] - .12) line = i; });
      const prog = W.map(w => seg(t, w[0], w[1])), q = prog[line], wig = osc(t, 6);
      const u = -9 + 20 * q, v = scribbleY(u, NOTE_ROWS[line], line * 1.7);
      const writing = win(t, W[line][0] - .06, W[line][0] + .02, W[line][1], W[line][1] + .08);
      p.lookX += (.7 * side + .25 * (q - .5)) * k; p.lookY += (.25 + .12 * line) * k;
      p.turn += .35 * side * k; p.hr += 4 * side * k;
      p.tongue = .5 * k; p.tongueX = 3 * side; both(p, 'browT', -.35 * k); p.browR += .2 * k;
      p.held = { layer: 'F', items: { notepad: { s: 1.2 * grow, pos: [34, 118], t, yaw: 45, tilt: 8, lines: prog, float: true } } };
      p.write = { on: 'notepad', uv: [u, v], lift: 2.6 * (1 - writing) + 8 * (1 - seg(t, .55, .95)), r: 226 + 4 * wig * writing, s: 1.2 * grow };
    }
  };

  A.Print = {
    cat: 'task', dur: 3.8, key: 1.9, office: ['msoAnimationPrinting'],
    desc: 'A small printer pops up beside him and feeds out a page while he watches, then he gives it two approving nods.',
    pose(t, p) {
      const dir = -1, at = STAGE.printer;
      const k = win(t, .15, .45, 3.3, 3.7);
      p.turn += .55 * dir * k; p.lookX += .9 * dir * k; p.lookY += .45 * k; p.hr += 4 * dir * k;
      p.earL += 10 * bump(t, .6, .9);
      const done = win(t, 2.3, 2.45, 3.1, 3.4);
      p.smile += .5 * done; p.wag = 6 + 22 * done; p.wagHz = 5;
      const nod = bump(t, 2.45, 2.7) + bump(t, 2.75, 3.0);
      p.hy += 3 * nod; p.faceY += 1.5 * nod;
      p.props.printer = {
        x: at[0], y: at[1],
        s: E.back(seg(t, 0, .35)) * (1 - E.in(seg(t, 3.45, 3.75))),
        k: E.io(seg(t, .65, 2.25)), led: t > .6 && t < 2.3 ? (osc(t, 3) > 0 ? 1 : .25) : 1
      };
    }
  };

  A.Save = {
    cat: 'task', dur: 3.9, key: 1.95, office: ['msoAnimationSaving'],
    desc: 'A floppy disk floats down to him; he digs a hole in the mat and it sinks in for safekeeping, like a good bone.',
    pose(t, p) {
      const cx = 92;
      const k = win(t, 0, .3, 3.5, 3.9);
      const dig = win(t, 1.35, 1.5, 2.35, 2.5);
      const d = osc(t, 5);
      p.wL = mix2(p.wL, [91, 171 - 8 * Math.max(0, d)], dig);
      p.wR = mix2(p.wR, [109, 171 - 8 * Math.max(0, -d)], dig);
      p.scale *= 1 + .04 * dig; p.y += 3 * dig;
      const proud = win(t, 2.95, 3.1, 3.45, 3.75);
      const ly = (t < 1.1 ? lerp(-1, .6, E.io(seg(t, .2, 1.1))) : .9) * (1 - proud);
      p.lookY += ly * k; p.faceY += 2.5 * ly * k; p.hy += Math.max(0, ly) * 3 * k;
      both(p, 'ear', 14 * dig * Math.abs(d));
      both(p, 'browT', -.3 * dig); p.tongue = .45 * dig;
      p.happy = .9 * proud; p.smile += .7 * proud; p.wag = 6 + 22 * proud; p.wagHz = 5;
      let fy, fr = 0;
      if (t < 1.1) { const q = E.out(seg(t, .1, 1.1)); fy = lerp(-14, 150, q) + 2 * Math.sin(t * 5); fr = 30 * Math.sin(t * 4) * (1 - q); }
      else if (t < 1.45) fy = 150 + 2 * Math.sin(t * 5);
      else fy = lerp(150, 200, E.in(seg(t, 1.45, 2.3)));
      if (t < 2.35) p.props.floppy = { x: cx, y: fy, r: fr, s: E.back(seg(t, .1, .35)), clip: fy > 178 };
      p.props.hole = { x: cx, o: win(t, 1.3, 1.45, 2.35, 2.6), s: .4 + .6 * E.back(seg(t, 1.3, 1.5)) };
      p.props.dirt = { x: cx, o: dig, t };
      p.props.saved = { o: win(t, 2.95, 3.05, 3.5, 3.75), s: E.back(seg(t, 2.95, 3.2)) };
    }
  };

  A.SendMail = {
    cat: 'task', dur: 4.1, key: 1.6, office: ['msoAnimationSendingMail'],
    desc: 'An envelope floats up to his nose; he licks it shut, a paw-print stamp drops onto it, and it sprouts wings and flies off.',
    pose(t, p) {
      const cx = 86;
      const k = win(t, 0, .3, 3.7, 4.1);
      const hover = win(t, .1, .4, 2.15, 2.3);
      const lick = win(t, .95, 1.05, 1.28, 1.4);
      p.hy += 4 * lick; p.faceY += 2 * lick; p.tongue = Math.max(p.tongue, .9 * lick);
      p.lidL = Math.max(p.lidL, .55 * lick); p.lidR = Math.max(p.lidR, .55 * lick);
      const fly = seg(t, 2.3, 3.5), watch = win(t, 2.3, 2.5, 3.5, 3.9);
      p.lookY += .55 * hover * (1 - watch) - .9 * watch; p.lookX += .8 * watch * E.io(fly);
      p.faceY += 1.5 * hover * (1 - watch) - 2 * watch; p.turn += .4 * watch * E.io(fly); p.hr += 6 * watch;
      waveR(p, t, .9 * win(t, 2.9, 3.05, 3.5, 3.75));
      p.smile += .5 * watch; p.wag = 16 * watch; p.wagHz = 4;
      const up = win(t, .8, .98, 1.3, 1.5);
      let ex = cx, ey = 144 - 26 * up + 1.8 * Math.sin(t * 2.6), er = 0, es = 1;
      if (t >= 2.25) ey = lerp(144, 88, E.out(seg(t, 2.25, 2.5)));
      if (t >= 2.45) { const q = E.in(seg(t, 2.45, 3.4)); ex = lerp(cx, 222, q); ey = lerp(88, -36, q) - 14 * Math.sin(q * Math.PI); er = -18 * q; es = 1 - .4 * q; }
      p.props.envelope = {
        o: 1 - seg(t, 3.25, 3.4), x: ex, y: ey, r: er + 4 * Math.sin(t * 1.9) * hover, s: es * E.back(seg(t, .05, .3)),
        flap: E.io(seg(t, .55, .9)), stamp: seg(t, 1.62, 1.7), wing: seg(t, 2.4, 2.55), trail: seg(t, 2.5, 2.6), t
      };
      const drop = seg(t, 1.42, 1.66);
      if (t > 1.42 && t < 1.72) p.props.stampDrop = { x: ex + 10, y: ey - 3 - 30 * (1 - E.in(drop)), s: 1 + .5 * (1 - drop), o: 1 - seg(t, 1.66, 1.72) };
    }
  };

  A.EmptyTrash = {
    cat: 'task', dur: 3.9, key: 1.3, office: ['msoAnimationEmptyTrash'],
    desc: 'He stares at the trash can until its lid flips open by itself, crumpled pages fly out, and the empty can gives a shake.',
    pose(t, p) {
      const k = win(t, .1, .4, 3.4, 3.8);
      p.turn -= .55 * k; p.lookX -= .9 * k; p.lookY += .25 * k; p.hr -= 4 * k;
      const focus = win(t, .3, .5, .9, 1.0);
      both(p, 'browT', -.5 * focus); p.lidL = Math.max(p.lidL, .35 * focus); p.lidR = Math.max(p.lidR, .35 * focus);
      const lift = win(t, .55, .85, 2.45, 2.7);
      const at = STAGE.trash, lidA = -75 * lift;
      const whoa = win(t, .95, 1.05, 1.6, 1.9);
      p.eyeS += .18 * whoa; both(p, 'brow', .8 * whoa); p.mouth = Math.max(p.mouth, .45 * whoa); p.lean -= 3 * whoa;
      both(p, 'ear', 28 * bump(t, .95, 1.5));
      const done = win(t, 2.7, 2.85, 3.3, 3.6);
      p.smile += .5 * done; p.lowL = p.lowR = .3 * done;
      const nod = bump(t, 2.8, 3.05); p.hy += 3 * nod;
      p.props.trash = {
        x: at[0], y: at[1], s: E.back(seg(t, 0, .35)) * (1 - E.in(seg(t, 3.25, 3.6))), lid: lidA, k: seg(t, .95, 2.0),
        shake: 7 * osc(t, 7) * win(t, 1.95, 2.05, 2.35, 2.45)
      };
      p.props.trashGlow = { x: at[0], y: at[1] - 20, o: win(t, .4, .6, 2.4, 2.7), t };
      if (t > 3.2) p.props.poof = { k: seg(t, 3.2, 3.75), x: at[0], y: 158 };
    }
  };

  A.GetTechy = {
    cat: 'persona', dur: 3.9, key: 2.0, office: ['msoAnimationGetTechy'],
    desc: 'Snaps on headphones and a heads-up visor; a laptop floats up facing him and types away by itself while binary streams past.',
    pose(t, p) {
      const k = win(t, .1, .4, 3.4, 3.8);
      const on = seg(t, .15, .55), off = seg(t, 3.35, 3.7);
      const type = win(t, .75, .9, 3.1, 3.3);
      p.hy += 2.5 * Math.abs(osc(t, 1.5)) * type; p.hr += 3 * osc(t, .5) * type;
      p.lookY += .6 * k; p.faceY += 1.2 * k; p.smile += .45 * type; both(p, 'brow', .25 * type);
      p.wag = 10 * type;
      const cx = 74;
      p.props.techy = { o: 1 - off, y: -34 * (1 - E.back(on)) - 30 * E.in(off), glow: .5 + .5 * osc(t, 1), t };
      p.props.floatLaptop = { x: cx, y: 172 - 4 * E.out(seg(t, .3, .7)) + 1.6 * Math.sin(t * 2.3), s: E.back(seg(t, .3, .62)) * (1 - E.in(seg(t, 3.3, 3.65))), glow: type, t };
      p.props.binary = { o: type, t };
    }
  };

  A.GetWizardy = {
    cat: 'persona', dur: 4.0, key: 1.9, office: ['msoAnimationGetWizardy'],
    desc: 'A wizard hat appears in a puff; a wand floats up beside him, winds up and casts a burst of stars.',
    pose(t, p) {
      const side = -1;
      const k = win(t, .1, .4, 3.5, 3.95);
      const hat = E.back(seg(t, .15, .5)) * (1 - E.in(seg(t, 3.45, 3.8)));
      const raise = win(t, .7, 1.15, 1.35, 1.55);
      const swish = seg(t, 1.35, 1.6), hold = win(t, 1.35, 1.6, 2.9, 3.4);
      const wr = side * (t < 1.35 ? -20 * raise : lerp(-20, 75, E.out(swish)) * (1 - seg(t, 2.9, 3.4)));
      const wx = 40, wy = 118 - 34 * raise + 2 * Math.sin(t * 2.4);
      p.lookY -= .5 * raise; p.lookX += .8 * side * (hold + raise * .6); p.turn += .35 * side * hold;
      p.happy = .8 * win(t, 1.6, 1.7, 2.4, 2.6);
      both(p, 'brow', .8 * hold); p.smile += .6 * hold; p.mouth = .4 * win(t, 1.55, 1.65, 2.2, 2.5);
      both(p, 'ear', 20 * bump(t, 1.4, 1.9));
      p.wag = 16 * hold; p.wagHz = 4;
      p.props.wizard = { s: hat, o: hat > .01 ? 1 : 0 };
      const ws = E.back(seg(t, .55, .8)) * (1 - E.in(seg(t, 3.4, 3.75)));
      p.props.floatWand = { x: wx, y: wy, r: wr, s: ws, t };
      const tip = rot(wr, 0, -28 * ws);
      p.props.stars = { o: t > 1.5 && t < 2.8 ? 1 : 0, k: seg(t, 1.55, 2.7), x: wx + tip[0], y: wy + tip[1] };
      p.props.twinkle = { o: win(t, 1.6, 1.8, 2.8, 3.2), t };
      if (t < .55) p.props.poof = { k: seg(t, .1, .55), x: 100, y: 26 };
      else if (t > 3.4) p.props.poof = { k: seg(t, 3.4, 3.95), x: 100, y: 26 };
    }
  };

  A.GetArtsy = {
    cat: 'persona', dur: 4.3, key: 2.2, office: ['msoAnimationGetArtsy'],
    desc: 'Puts on a beret; a palette and brush float up and the brush paints a little bone on the easel while he directs, then he admires it.',
    pose(t, p) {
      const dir = -1, EZ = STAGE.easel;
      const k = win(t, .1, .4, 3.8, 4.25);
      const gear = E.back(seg(t, .15, .5)) * (1 - E.in(seg(t, 3.75, 4.1)));
      const paint = win(t, .8, 1.0, 3.0, 3.2), admire = win(t, 3.0, 3.2, 3.7, 4.0);
      const S = [[1.0, 1.65], [1.75, 2.35], [2.45, 2.95]];
      let tip = [EZ[0] - 12 * dir, EZ[1] - 34], col = '#3fa66b';
      if (t >= S[0][0] - .2 && t < S[1][0] - .05) { const q = seg(t, S[0][0], S[0][1]); tip = [EZ[0] + dir * (-13 + 26 * q), EZ[1] - 28 - 1.5 * osc(q, 2)]; col = '#3fa66b'; }
      else if (t >= S[1][0] - .05 && t < S[2][0] - .05) { const q = seg(t, S[1][0], S[1][1]); tip = [EZ[0] - 10 + 17 * q, EZ[1] - 38 + 2.4 * osc(q, 3)]; col = '#8c4c22'; }
      else if (t >= S[2][0] - .05) { const q = seg(t, S[2][0], S[2][1]); tip = [EZ[0] + 9 + 3.5 * Math.cos(q * 6.283), EZ[1] - 45 + 3.5 * Math.sin(q * 6.283)]; col = '#f0bf45'; }
      const rest = [EZ[0] - 26 * dir, EZ[1] - 52];
      tip = mix2(rest, tip, paint);
      const br = 40 * dir, o = rot(br, 0, -20 * gear);
      p.turn += .5 * dir * paint; p.lookX += .9 * dir * paint; p.lookY += .25 * paint; p.hr += 4 * dir * paint;
      p.tongue = .35 * paint; p.tongueX = 3 * dir; both(p, 'browT', -.3 * paint);
      p.happy = .85 * admire; p.smile += .6 * admire; p.wag = 22 * admire; p.wagHz = 5; p.lean -= 3 * dir * admire; p.hr -= 6 * dir * admire;
      p.props.beret = { s: gear, o: gear > .01 ? 1 : 0, r: -10 };
      p.props.easel = { x: EZ[0], y: EZ[1], s: E.back(seg(t, .3, .65)) * (1 - E.in(seg(t, 3.75, 4.1))), k1: seg(t, 1.0, 1.65), k2: seg(t, 1.75, 2.35), k3: seg(t, 2.45, 2.95) };
      p.props.floatPalette = { x: EZ[0] + 34 * dir, y: EZ[1] - 64 + 2 * Math.sin(t * 2.2), r: -8 * dir, s: .8 * gear, t };
      p.props.floatBrush = { x: tip[0] - o[0], y: tip[1] - o[1], r: br, s: gear, c: col, t };
    }
  };

  A.IdleAtom = {
    cat: 'idle', dur: 4.4, key: 1.6, loop: true, office: [],
    desc: 'Three tennis balls whirl around his head like electrons, and his eyes try to keep up.',
    pose(t, p) {
      const k = win(t, 0, .5, 3.8, 4.4), a = t * Math.PI * 2 * .75;
      const s = { k, a, o: Math.min(1, k * 3) };
      p.props.atomB = s; p.props.atomF = s;
      p.lookX += .9 * Math.cos(a) * k; p.lookY += (.35 * Math.sin(a) - .2) * k;
      p.hr += 4 * Math.cos(a) * k; p.turn += .25 * Math.cos(a) * k;
      p.smile += .3 * k; p.wag = 10 * k; both(p, 'brow', .3 * k);
    }
  };

  A.IdleRopePile = {
    cat: 'idle', dur: 4.4, key: 1.42, loop: true, office: [],
    desc: 'Grabs a rope toy, gives it a good shake, then drops it in a coiled pile and studies it.',
    pose(t, p) {
      const hold = win(t, .25, .45, 2.55, 2.65), shake = win(t, .7, .9, 2.2, 2.45), s = osc(t, 3.2);
      p.hr += 15 * s * shake; p.hx += 2 * s * shake; p.rot += 2 * s * shake;
      p.mouth = .3 * hold; both(p, 'browT', -.5 * shake); p.lidL = p.lidR = .25 * shake;
      p.earL += 20 * s * shake; p.earR -= 20 * s * shake;
      p.wag = 22 * shake; p.wagHz = 5;
      const fall = seg(t, 2.6, 2.95);
      const pile = win(t, 2.9, 3.1, 3.9, 4.3);
      p.lookY += .9 * pile; p.faceY += 2 * pile; p.hr += 10 * pile; p.browR += .6 * pile;
      if (t < 2.6) p.props.ropeMouth = { o: hold > 0 ? 1 : 0, s: E.back(seg(t, .2, .45)), r: -s * 18 * shake };
      else p.props.ropePile = { o: 1 - seg(t, 4.0, 4.4), y: 182 - 80 * (1 - E.in(fall)), coil: seg(t, 2.6, 3.05), sq: bump(t, 2.92, 3.1) };
    }
  };

  A.IdleSideToSide = {
    cat: 'idle', dur: 3.4, key: .42, loop: true, office: [],
    desc: 'Sways from side to side, humming to himself with his eyes half closed.',
    pose(t, p) {
      const k = win(t, 0, .4, 2.9, 3.4), s = Math.sin(t / 3.4 * Math.PI * 4);
      p.rot += 5 * s * k; p.hr -= 4 * s * k; p.lookX += .7 * s * k; p.turn += .3 * s * k;
      p.lidL = p.lidR = .35 * k; p.smile += .45 * k;
      p.earL += 6 * s * k; p.earR -= 6 * s * k;
      p.wag = 14 * k; p.wagHz = 1.2;
      p.props.notes = { o: k, t };
    }
  };

  A.IdleHeadScratch = {
    cat: 'idle', dur: 3.0, key: 1.3, loop: true, office: [],
    desc: 'Lifts a hind leg and scratches behind his ear, eyes half shut in bliss.',
    pose(t, p) {
      const k = win(t, 0, .35, 2.45, 2.9), up = win(t, .25, .55, 2.2, 2.6);
      const o = osc(t, 9), sc = win(t, .55, .6, 2.1, 2.2);
      p.lean -= 6 * k; p.hr += 15 * k;
      p.kR = up; p.scrR = o * sc;
      p.lidL = p.lidR = .72 * k; p.lowL = p.lowR = .2 * k;
      p.tongue = .7 * win(t, .7, .9, 2.0, 2.3); p.mouth = .2 * k;
      p.earR += (15 + 10 * o * sc) * up;
      p.props.fur = { o: win(t, .7, .8, 2.2, 2.4), t };
    }
  };

  A.IdleFingerTap = {
    cat: 'idle', dur: 3.0, key: .58, loop: true, office: [],
    desc: 'Taps one paw on the mat, giving you a flat, patient look.',
    pose(t, p) {
      const k = win(t, 0, .3, 2.7, 3.0), tp = Math.max(0, osc(t, 3));
      p.wR = mix2(p.wR, [116, 173 - 9 * tp], k);
      p.lidL = p.lidR = .38 * k; both(p, 'brow', -.3 * k); both(p, 'browT', -.2 * k);
      p.smile -= .3 * k;
      const glance = win(t, .9, 1.1, 1.8, 2.0);
      p.lookX += (.15 + .35 * glance) * k; p.lookY += .6 * glance; p.faceY += 1.5 * glance;
      p.hr -= 4 * k; p.wag = 0.01;
      const sigh = bump(t, 2.36, 2.76); p.mouth = .25 * sigh; p.sy *= 1 - .025 * sigh;
      p.props.dust = { o: k, t, x: 108, y: 178 };
    }
  };

  A.IdleSnooze = {
    cat: 'idle', dur: 5.2, key: 2.6, office: [],
    desc: 'Yawns, nods off with a bubble at his nose, then wakes with a start.',
    pose(t, p) {
      const drowsy = seg(t, 0, .8);
      const yawn = win(t, .5, .75, 1.05, 1.3);
      const sleep = win(t, 1.3, 1.6, 3.8, 3.86);
      const startle = win(t, 3.8, 3.88, 4.3, 4.8);
      const br = .5 + .5 * osc(t, .5);
      const lid = Math.max(.55 * drowsy * (1 - seg(t, 3.78, 3.82)), yawn, sleep);
      p.lidL = p.lidR = lid * (1 - startle);
      p.mouth = Math.max(p.mouth, yawn); p.tongue = .3 * yawn; p.sy *= 1 + .03 * yawn;
      p.hy += (5 + 1.5 * br) * sleep + 4 * bump(t, .9, 1.3); p.hr += 12 * sleep; p.faceY += 2.5 * sleep;
      both(p, 'ear', -10 * sleep); p.sy *= 1 - .03 * sleep * br;
      p.tail = 35 + 40 * sleep; p.autoBlink = 0;
      p.y -= 8 * bump(t, 3.8, 4.1); p.eyeS += .25 * startle; both(p, 'brow', startle);
      both(p, 'ear', 50 * bump(t, 3.8, 4.4)); p.mouth = Math.max(p.mouth, .35 * startle);
      blink(p, t, 4.65);
      p.props.zzz = { o: sleep, t };
      if (t < 3.84) p.props.bubble = { o: sleep, k: br };
      else if (t < 4.05) p.props.bubble = { o: 1, k: 1, pop: seg(t, 3.84, 4.05) };
    }
  };

  A.IdleEyeBrowRaise = {
    cat: 'idle', dur: 1.8, key: .4, office: [],
    desc: 'Raises one brow, then the other, then wiggles both at you.',
    pose(t, p) {
      p.browL += .95 * bump(t, .15, .6); p.browR += .95 * bump(t, .5, .95);
      const w = win(t, 1.0, 1.08, 1.4, 1.5) * Math.abs(osc(t, 4));
      both(p, 'brow', .9 * w);
      const k = win(t, .1, .3, 1.5, 1.75);
      p.smile += .35 * k; p.lookX += .15 * k; p.hr += 3 * k;
      p.eyeS += .06 * Math.max(bump(t, .15, .6), bump(t, .5, .95), w);
    }
  };

  /* ===================================================== SCOUT EXTRAS
   * Not part of the Clippit set: Microsoft Agent's standard moods, plus beagle behaviour.
   */
  A.Acknowledge = {
    cat: 'mood', extra: true, dur: 1.5, key: .33,
    desc: 'Gives one small, sure nod: yes, got it.',
    pose(t, p) {
      const n = bump(t, .15, .5) + .55 * bump(t, .55, .88), k = win(t, .1, .3, 1.1, 1.45);
      p.hy += 5 * n; p.faceY += 2.5 * n; p.lookY += .25 * n; p.hr += 1.5 * n;
      p.smile += .3 * k; p.lidL = Math.max(p.lidL, .3 * n); p.lidR = Math.max(p.lidR, .3 * n);
      both(p, 'ear', 8 * n); p.wag = 6 * k; p.wagHz = 2;
    }
  };
  A.Decline = {
    cat: 'mood', extra: true, dur: 1.7, key: .42,
    desc: 'Shakes his head no, ears swinging.',
    pose(t, p) {
      const k = win(t, .05, .2, 1.2, 1.55), sh = osc(t - .1, 3) * k * (1 - .35 * seg(t, .2, 1.2));
      p.turn += .55 * sh; p.hr += 5 * sh; p.lookX += .2 * sh; p.earL += 18 * sh; p.earR -= 18 * sh;
      p.smile -= .3 * k; p.lidL = Math.max(p.lidL, .35 * k); p.lidR = Math.max(p.lidR, .35 * k); both(p, 'browT', -.25 * k);
    }
  };
  A.Pleased = {
    cat: 'mood', extra: true, dur: 2.2, key: .55,
    desc: 'Beams with his eyes crinkled, bounces on his hind legs and wags hard.',
    pose(t, p) {
      const k = win(t, .05, .3, 1.8, 2.2);
      p.happy = .95 * win(t, .15, .3, 1.7, 1.95); p.smile += .85 * k; p.mouth = .25 * k;
      squash(p, t, .2, .18, .08); jump(p, t, .35, .7, 9); squash(p, t, .68, .18, .08); jump(p, t, .85, 1.12, 4);
      both(p, 'ear', 14 * bump(t, .35, .75)); p.hr -= 5 * k; p.wag = 28 * k; p.wagHz = 6;
      p.props.hearts = { o: win(t, .3, .4, 1.7, 2.0), k: seg(t, .3, 1.9) };
    }
  };
  A.Sad = {
    cat: 'mood', extra: true, dur: 2.8, key: 1.5,
    desc: 'Ears droop, brows lift in the middle, and he looks at the floor with a small sigh.',
    pose(t, p) {
      const k = win(t, 0, .5, 2.3, 2.8);
      both(p, 'browT', .85 * k); both(p, 'brow', .1 * k); p.lookY += .75 * k; p.lookX -= .2 * k; p.faceY += 2 * k; p.hy += 3 * k; p.hr -= 4 * k;
      p.lidL = Math.max(p.lidL, .42 * k); p.lidR = Math.max(p.lidR, .42 * k); p.smile -= .7 * k;
      both(p, 'ear', -12 * k); p.tail += 48 * k; p.wag = .01;
      const sigh = bump(t, 1.2, 1.9); p.sy *= 1 - .03 * sigh; p.mouth = .15 * sigh;
      blink(p, t, 1.95, .3);
    }
  };
  A.Surprised = {
    cat: 'mood', extra: true, dur: 1.7, key: .3,
    desc: 'Jolts back with wide eyes, raised brows and an open mouth.',
    pose(t, p) {
      const k = win(t, 0, .1, 1.2, 1.65, E.out);
      p.y -= 7 * bump(t, .02, .32); p.sy *= 1 + .06 * bump(t, .02, .32); p.scale *= 1 - .03 * k; p.lean += 3 * k;
      p.eyeS += .28 * k; both(p, 'brow', 1.1 * k); p.mouth = .6 * k; p.smile -= .5 * k; both(p, 'ear', 48 * k); p.hy -= 2 * k; p.hr -= 3 * k;
      p.tail -= 10 * k;
      p.props.shock = { o: win(t, .02, .08, .45, .6), k: seg(t, .02, .45) };
    }
  };
  A.Confused = {
    cat: 'mood', extra: true, dur: 2.6, key: .9,
    desc: 'Tilts his head one way, then the other, with one brow up and a question mark overhead.',
    pose(t, p) {
      const k = win(t, 0, .35, 2.2, 2.6), tilt = lerp(14, -11, E.io(seg(t, .9, 1.3))) * k;
      p.hr += tilt; p.browR += .9 * k; p.browL -= .15 * k; p.lookX -= .35 * k; p.lookY -= .4 * k;
      p.earR += (13 + .7 * tilt) * k; p.earL += (13 - .7 * tilt) * k; p.smile -= .2 * k;
      p.props.question = { o: win(t, .25, .35, 2.0, 2.3), s: E.back(seg(t, .25, .5)), r: 10 * Math.sin(t * 3) };
    }
  };
  A.Uncertain = {
    cat: 'mood', extra: true, dur: 2.2, key: .85,
    desc: 'Shrugs with both paws turned up and his head cocked: not sure.',
    pose(t, p) {
      const k = win(t, .05, .4, 1.7, 2.15);
      p.wL = mix2(p.wL, [62, 148], k); p.wR = mix2(p.wR, [138, 148], k); p.padsL = p.padsR = .9 * k;
      p.y -= 2 * k; p.hr += 7 * k; p.lookX += .4 * osc(t, .8) * k; p.lookY -= .15 * k;
      both(p, 'browT', .45 * k); p.browR += .3 * k; p.smile -= .15 * k; p.mouth = .08 * k;
      both(p, 'ear', 8 * k);
    }
  };
  A.Suggest = {
    cat: 'extra', extra: true, dur: 2.4, key: 1.0,
    desc: 'Gets an idea: a light bulb pops on overhead and he lifts a paw to share it.',
    pose(t, p) {
      const k = win(t, .15, .4, 1.9, 2.3);
      p.wR = mix2(p.wR, [140, 70], k); p.padsR = k;
      p.eyeS += .12 * k; both(p, 'brow', .7 * k); p.smile += .5 * k; p.mouth = .2 * k; both(p, 'ear', 16 * k);
      p.lookY -= .4 * k; p.lookX += .2 * k; p.hr -= 3 * k; p.wag = 12 * k; p.wagHz = 4;
      p.props.bulb = { o: win(t, .15, .22, 1.9, 2.2), s: E.back(seg(t, .15, .45)), glow: .6 + .4 * osc(t, 2.2) };
    }
  };
  A.Read = {
    cat: 'extra', extra: true, dur: 4.2, key: 1.3,
    desc: 'An open book floats up in front of him, facing him, and turns its own page while he reads along the lines.',
    pose(t, p) {
      const k = win(t, 0, .45, 3.7, 4.15), grow = E.back(seg(t, 0, .5)) * (1 - E.in(seg(t, 3.7, 4.1)));
      const turning = win(t, 2.0, 2.1, 2.55, 2.65), flip = seg(t, 2.1, 2.55), read = k * (1 - turning);
      const line = ((t + 10) % .8) / .8;
      p.lookY += .45 * k; p.lookX += (-.5 + .95 * E.io(clamp(line * 1.15))) * read * .8 + (.4 - .9 * flip) * turning;
      p.faceY += 1.2 * k; p.hy += 1 * k; both(p, 'browT', .15 * k);
      p.held = { layer: 'F', items: { book: { s: 1.12 * grow, pos: [52, 120], t, facing: 'dog', tilt: 30, flip: turning > 0 ? flip : -1, float: true } } };
      blink(p, t, 1.62); blink(p, t, 3.22);
    }
  };
  A.Announce = {
    cat: 'extra', extra: true, dur: 2.8, key: 1.3,
    desc: 'Points his nose at the ceiling and bays, the way beagles announce things.',
    pose(t, p) {
      const k = win(t, .1, .5, 2.1, 2.6), howl = win(t, .6, .8, 1.9, 2.1);
      p.faceY -= 4 * k; p.lookY -= .8 * k; p.hy -= 3 * k; p.hr -= 8 * k; p.turn -= .2 * k;
      p.sy *= 1 + .04 * k; p.y -= 2 * k;
      p.lidL = Math.max(p.lidL, .85 * howl); p.lidR = Math.max(p.lidR, .85 * howl);
      p.mouth = Math.max(p.mouth, (.65 + .15 * Math.sin(t * 9)) * howl); p.smile -= .3 * howl;
      both(p, 'ear', -8 * k + 6 * Math.sin(t * 7) * howl); both(p, 'browT', .4 * howl);
      p.wag = 6 * k;
      p.props.howl = { o: howl, k: seg(t, .7, 2.0), t };
    }
  };
  A.Fetch = {
    cat: 'extra', extra: true, dur: 3.9, key: 1.3,
    desc: 'A tennis ball bounces in; he tracks it, jumps and catches it, then drops it proudly on the mat.',
    pose(t, p) {
      const catchT = 1.25, dropT = 2.45;
      let bx = 100, by = 99, show = false, inMouth = false;
      if (t < catchT) {
        show = t > .1;
        if (t < .75) { const q = seg(t, .1, .75); bx = lerp(236, 150, q); by = 170 - 44 * Math.abs(Math.sin(q * Math.PI * 2)) * (1 - q * .45); }
        else { const q = seg(t, .75, catchT); bx = lerp(150, 100, q); by = lerp(170, 98, q) - 46 * Math.sin(q * Math.PI); }
      } else if (t < dropT) inMouth = true;
      else {
        show = true;
        const q = seg(t, dropT, 2.85); bx = lerp(100, 86, q); by = lerp(100, 174, E.in(q));
        if (t > 2.85) { const q2 = seg(t, 2.85, 3.2); by = 174 - 12 * Math.sin(q2 * Math.PI); bx = lerp(86, 78, q2); }
      }
      const track = win(t, .1, .3, 1.15, 1.3);
      p.lookX += clamp((bx - 100) / 60, -1, 1) * track; p.lookY += clamp((by - 75) / 60, -1, 1) * track;
      p.turn += clamp((bx - 100) / 120, -.6, .6) * track; p.hr += clamp((bx - 100) / 12, -6, 6) * track;
      both(p, 'ear', 18 * track);
      squash(p, t, .88, .2, .1); jump(p, t, 1.0, 1.5, 30); squash(p, t, 1.48, .18, .1);
      const hold = win(t, 1.3, 1.45, 2.3, 2.45);
      p.mouth = Math.max(p.mouth, .7 * win(t, .95, 1.1, 1.2, 1.28), .3 * (inMouth ? 1 : 0), .5 * bump(t, 2.38, 2.6));
      p.happy = .6 * win(t, 1.45, 1.6, 2.2, 2.35); p.smile += .5 * hold + .4 * win(t, 3.0, 3.2, 3.5, 3.85);
      p.wag = 28 * win(t, 1.3, 1.45, 3.4, 3.8); p.wagHz = 6;
      const watch = win(t, 2.45, 2.6, 3.1, 3.4); p.lookY += .8 * watch; p.faceY += 2 * watch; p.lookX -= .25 * watch;
      p.props.ball = { o: show ? 1 - seg(t, 3.45, 3.75) : 0, x: bx, y: by, r: t * 420 };
      p.props.mouthBall = { o: inMouth ? 1 : 0 };
    }
  };
  A.Shake = {
    cat: 'extra', extra: true, dur: 2.2, key: .85,
    desc: 'Gives a full wet-dog shake from ears to tail, droplets flying.',
    pose(t, p) {
      const k = win(t, .15, .3, 1.45, 1.7), sh = osc(t, 6) * k;
      p.rot += 6 * sh; p.hr -= 14 * sh; p.hx += 3 * sh; p.turn += .3 * sh; p.earL += 40 * sh; p.earR -= 40 * sh; p.tail += 20 * sh;
      p.lidL = Math.max(p.lidL, .85 * k); p.lidR = Math.max(p.lidR, .85 * k); p.mouth = .15 * k; p.smile -= .1 * k;
      p.sx *= 1 + .03 * Math.abs(sh);
      squash(p, t, 1.62, .2, .06); blink(p, t, 1.95);
      p.smile += .3 * win(t, 1.7, 1.85, 2.0, 2.2);
      p.props.drops = { o: win(t, .2, .3, 1.55, 1.85), t };
    }
  };
  A.Beg = {
    cat: 'extra', extra: true, dur: 2.8, key: 1.2,
    desc: 'Sits up on his hind legs with both front paws tucked under his chin and his best puppy eyes.',
    pose(t, p) {
      const k = win(t, .1, .55, 2.2, 2.7), bob = osc(t, 1.2) * k;
      p.y -= 16 * k + 1.5 * bob;
      p.wL = mix2(p.wL, [84, 136 + 2 * bob], k); p.wR = mix2(p.wR, [116, 136 - 2 * bob], k);
      p.eyeS += .12 * k; both(p, 'browT', .9 * k); both(p, 'brow', .25 * k); p.hr += 8 * k; p.lookY -= .35 * k; p.smile += .15 * k;
      both(p, 'ear', 6 * k); p.wag = 16 * k; p.wagHz = 4;
    }
  };
  A.ChaseTail = {
    cat: 'extra', extra: true, dur: 2.9, key: 1.95,
    desc: 'Spins around after his own tail, then sits down a little dizzy.',
    pose(t, p) {
      const spin = win(t, .15, .3, 1.35, 1.5), ang = E.io(seg(t, .2, 1.5)) * Math.PI * 4;
      const c = Math.cos(ang); p.sx *= Math.sign(c || 1) * Math.max(.08, Math.abs(c));
      p.y -= 4 * Math.abs(Math.sin(ang * 2)) * spin; p.tail += 25 * Math.sin(ang * 2) * spin;
      p.lookX += .8 * spin; p.turn += .4 * spin; p.mouth = .3 * spin; p.smile += .4 * spin;
      const dz = win(t, 1.5, 1.65, 2.5, 2.85);
      p.hr += 9 * osc(t, .9) * dz; p.lookX += .7 * Math.cos(t * 9) * dz; p.lookY += .5 * Math.sin(t * 9) * dz;
      p.lidL = Math.max(p.lidL, .3 * dz); p.lidR = Math.max(p.lidR, .3 * dz); p.smile += .3 * dz; p.tongue = .4 * dz; p.tongueX = 3;
      p.props.dizzy = { o: dz, t };
    }
  };
  A.SniffAir = {
    cat: 'extra', extra: true, dur: 2.6, key: 1.0,
    desc: 'Lifts his nose and sniffs the air, following a scent as it drifts past.',
    pose(t, p) {
      const k = win(t, .05, .4, 2.1, 2.55);
      p.faceY -= 3 * k; p.lookY -= .55 * k; p.hy -= 2 * k;
      p.hr += (-6 + 10 * E.io(seg(t, .6, 1.8))) * k; p.turn += (-.3 + .5 * E.io(seg(t, .6, 1.8))) * k;
      p.sniff = k * Math.abs(osc(t, 5)); p.lidL = Math.max(p.lidL, .45 * k); p.lidR = Math.max(p.lidR, .45 * k);
      both(p, 'ear', 10 * k); p.smile += .1 * k;
      p.props.scent = { o: k, t };
    }
  };
  /* Small idles for while the user works: short, quiet, no props, each back at rest by its end. */
  A.IdleEarFlick = {
    cat: 'idle', extra: true, dur: 1.1, key: .2,
    desc: 'Flicks one ear, then the other, as if a fly went past.',
    pose(t, p) {
      p.earL += 18 * bump(t, .08, .24) + 8 * bump(t, .24, .38);
      p.earR += 15 * bump(t, .5, .66) + 6 * bump(t, .66, .8);
      p.lookX -= .12 * win(t, .05, .2, .35, .5); p.lookX += .12 * win(t, .45, .6, .8, 1.0);
    }
  };
  A.IdleLickChops = {
    cat: 'idle', extra: true, dur: 1.2, key: .45,
    desc: 'Licks his chops once, side to side.',
    pose(t, p) {
      const l = win(t, .2, .32, .66, .82);
      p.mouth = Math.max(p.mouth, .22 * l); p.tongue = Math.max(p.tongue, .55 * l); p.tongueX = 3.5 * Math.sin(seg(t, .26, .76) * Math.PI * 2);
      p.hy += 1.2 * l; p.smile += .15 * l; blink(p, t, .95);
    }
  };
  A.IdleSlowBlink = {
    cat: 'idle', extra: true, dur: 1.7, key: .75,
    desc: 'Closes his eyes slowly and opens them again, content.',
    pose(t, p) {
      const k = win(t, .1, .6, .95, 1.5);
      p.lidL = Math.max(p.lidL, k); p.lidR = Math.max(p.lidR, k); p.autoBlink = 0;
      p.smile += .25 * k; p.hy += 1.5 * k; p.hr -= 2 * k;
    }
  };
  A.IdleSettle = {
    cat: 'idle', extra: true, dur: 2.0, key: .6,
    desc: 'Shifts his weight on the mat and settles again.',
    pose(t, p) {
      const a = win(t, .1, .55, .85, 1.35), b = win(t, .85, 1.2, 1.5, 1.9);
      p.lean += 3.5 * a - 1.5 * b; p.x += 1.5 * a - .7 * b; p.hr -= 2 * a - b;
      squash(p, t, 1.3, .35, .035); blink(p, t, 1.45);
    }
  };
  A.IdleTailThump = {
    cat: 'idle', extra: true, dur: 1.8, key: .8,
    desc: 'Thumps his tail a few lazy times, pleased with things.',
    pose(t, p) {
      const k = win(t, .1, .35, 1.25, 1.7);
      p.wag = 2.5 + 12 * k; p.wagHz = 2.2; p.smile += .2 * k;
      p.lidL = Math.max(p.lidL, .15 * k); p.lidR = Math.max(p.lidR, .15 * k);
    }
  };
  A.IdleCurious = {
    cat: 'idle', extra: true, dur: 2.0, key: .8,
    desc: 'Tilts his head the other way, one brow up, curious, then straightens.',
    pose(t, p) {
      const k = win(t, .12, .5, 1.3, 1.8);
      p.hr -= 9 * k; p.turn -= .1 * k; p.lookX -= .2 * k; p.lookY -= .1 * k;
      p.browL += .45 * k; p.earL += 12 * k; p.earR -= 4 * k; blink(p, t, 1.05);
    }
  };
  A.IdleLookAtYou = {
    cat: 'idle', extra: true, dur: 1.9, key: .7,
    desc: 'Turns to look at you for a moment with a small smile.',
    pose(t, p) {
      const k = win(t, .1, .45, 1.25, 1.75);
      p.turn -= VIEW.turn * .9 * k; p.hr -= VIEW.hr * .5 * k; p.lookX = lerp(p.lookX, 0, k); p.lookY -= .05 * k;
      p.smile += .35 * k; both(p, 'brow', .2 * k); both(p, 'ear', 4 * k); blink(p, t, .8);
    }
  };
  A.IdleWatchWork = {
    cat: 'idle', extra: true, dur: 2.2, key: 1.0,
    desc: 'Glances over at your work and gives a small approving nod.',
    pose(t, p) {
      const k = win(t, .1, .45, 1.6, 2.05), n = bump(t, .95, 1.25) + .5 * bump(t, 1.25, 1.5);
      p.lookX -= .65 * k; p.lookY -= .45 * k; p.turn -= .15 * k; p.hr -= 3 * k; p.faceY -= 1.5 * k;
      p.hy += 3.5 * n; p.faceY += 1.5 * n; p.smile += .2 * k; blink(p, t, 1.7);
    }
  };
  A.IdleYawn = {
    cat: 'idle', extra: true, dur: 2.2, key: 1.0,
    desc: 'Gives a small yawn, eyes squeezed shut, and settles again.',
    pose(t, p) {
      const k = win(t, .25, .75, 1.25, 1.8);
      p.mouth = Math.max(p.mouth, .85 * k); p.tongue = Math.max(p.tongue, .25 * k); p.sy *= 1 + .025 * k;
      p.lidL = Math.max(p.lidL, .9 * k); p.lidR = Math.max(p.lidR, .9 * k); p.autoBlink = 0;
      p.hy -= 2 * k; p.faceY -= 2 * k; p.hr += 4 * k; both(p, 'ear', -6 * k);
    }
  };
  const EXTRAS = ['Acknowledge', 'Decline', 'Pleased', 'Sad', 'Surprised', 'Confused', 'Uncertain',
    'Suggest', 'Read', 'Announce', 'Fetch', 'Shake', 'Beg', 'ChaseTail', 'SniffAir',
    'IdleEarFlick', 'IdleLickChops', 'IdleSlowBlink', 'IdleSettle', 'IdleTailThump', 'IdleCurious', 'IdleLookAtYou', 'IdleWatchWork', 'IdleYawn'];

  /* Canonical order of the Clippit agent's 43 actions. */
  const ORDER = ['Congratulate', 'LookRight', 'SendMail', 'Thinking', 'Explain', 'IdleRopePile', 'IdleAtom', 'Print', 'Hide',
    'GetAttention', 'Save', 'GetTechy', 'GestureUp', 'Idle1_1', 'Processing', 'Alert', 'LookUpRight', 'IdleSideToSide',
    'GoodBye', 'LookLeft', 'IdleHeadScratch', 'LookUpLeft', 'CheckingSomething', 'Hearing_1', 'GetWizardy', 'IdleFingerTap',
    'GestureLeft', 'Wave', 'GestureRight', 'Writing', 'IdleSnooze', 'LookDownRight', 'GetArtsy', 'Show', 'LookDown',
    'Searching', 'EmptyTrash', 'Greeting', 'LookUp', 'GestureDown', 'RestPose', 'IdleEyeBrowRaise', 'LookDownLeft'];

  /* Intro / loop / outro: while looping only [a, b] repeats; finishing plays out the rest. */
  const SEGMENTS = {
    IdleSnooze: [1.7, 3.7], Processing: [.5, 2.5], Searching: [.6, 2.418], Hearing_1: [.4, 2.0667],
    GetAttention: [.6, 1.5], Wave: [.35, 1.6], IdleSideToSide: [.4, 2.1], IdleAtom: [.5, 3.1667],
    IdleRopePile: [.9, 2.15], GetTechy: [.9, 2.9], IdleFingerTap: [1 / 3, 7 / 3]
  };
  Object.keys(SEGMENTS).forEach(n => { A[n].seg = SEGMENTS[n]; A[n].loop = true; });

  /* Office 2003 MsoAnimationType → action. */
  const OFFICE = {};
  ORDER.forEach(n => (A[n].office || []).forEach(c => { OFFICE[c] = n; }));
  /* Idling follows the user (userActive), so he doesn't pull focus from the page: while
     they work, a small thing now and then; once they have been quiet a while, more and bigger; after five minutes
     he naps until they are back. [quiet for (s), pause after his last act (s), what he does (weighted)] */
  const SMALL = [['Idle1_1', 1.5], ['IdleEarFlick', 1.5], ['IdleSlowBlink', 1.5], ['IdleWatchWork', 1.5], ['IdleTailThump', 1], ['IdleSettle', 1],
    ['IdleCurious', 1], ['IdleLookAtYou', 1], ['IdleLickChops', .8], ['IdleEyeBrowRaise', .5],
    ['LookLeft', .8], ['LookDownLeft', .8], ['LookRight', .6], ['LookDownRight', .6], ['LookUpLeft', .6], ['LookDown', .5], ['LookUpRight', .4], ['LookUp', .3]];
  const NAP = 'IdleSnooze';
  const IDLE_STAGES = [
    [0, [45, 90], SMALL],
    [30, [8, 16], SMALL.concat([['Hearing_1', 1], ['IdleHeadScratch', 1], ['IdleYawn', 1], ['SniffAir', 1]])],
    [120, [10, 20], [['Idle1_1', 2], ['IdleHeadScratch', 2], ['IdleFingerTap', 2], ['IdleSideToSide', 2], ['Hearing_1', 1], ['SniffAir', 1],
      ['IdleEyeBrowRaise', 1], ['IdleAtom', 1], ['IdleRopePile', 1], ['IdleYawn', 1], ['IdleSettle', 1], ['IdleTailThump', 1]]],
    [300, [2, 2], [[NAP, 1]]],
  ];
  /** a weighted pick, not one of `recent` (his last idles) while the pool has others */
  function pickIdle(pool = IDLE_STAGES[1][2], recent = []) {
    const fresh = pool.filter(it => recent.indexOf(it[0]) < 0), from = fresh.length ? fresh : pool;
    let r = Math.random() * from.reduce((a, b) => a + b[1], 0);
    for (const [n, w] of from) { if ((r -= w) <= 0) return n; }
    return from[0][0];
  }
  const NOT_RANDOM = ['Show', 'Hide', 'GoodBye', 'Greeting', 'RestPose'];

  /* =================================================================== PROPS
   * layer: back | front | fx (scene) · head (moves with head) · handL / handR (at the wrist)
   * Markup is drawn around the prop's own origin; the state object s positions it.
   */
  const star = (cx, cy, R, r, n = 5) => {
    let d = '';
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r : R;
      d += (i ? 'L' : 'M') + f(cx + Math.cos(a) * rr) + ' ' + f(cy + Math.sin(a) * rr);
    }
    return d + 'Z';
  };
  const sparkle = s => `M0 ${-s}L${s * .25} ${-s * .25}L${s} 0L${s * .25} ${s * .25}L0 ${s}L${-s * .25} ${s * .25}L${-s} 0L${-s * .25} ${-s * .25}Z`;
  function gearPath(r, n, h) {
    const step = Math.PI * 2 / n; let d = '';
    for (let j = 0; j < n; j++) {
      const a = j * step;
      [[a, r], [a + step * .16, r + h], [a + step * .44, r + h], [a + step * .6, r]].forEach((q, i) => {
        d += (j === 0 && i === 0 ? 'M' : 'L') + f(Math.cos(q[0]) * q[1]) + ' ' + f(Math.sin(q[0]) * q[1]);
      });
    }
    return d + 'Z';
  }
  const pawPrint = (x, y, s, fill) =>
    `<g fill="${fill}" transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="1.4" rx="2.4" ry="1.9"/><circle cx="-2.4" cy="-1.6" r="1"/><circle cx="-.8" cy="-2.7" r="1"/><circle cx=".8" cy="-2.7" r="1"/><circle cx="2.4" cy="-1.6" r="1"/></g>`;
  const rope = (d, extra = '') =>
    `<path d="${d}" fill="none" stroke="${LINE}" stroke-width="8.6" stroke-linecap="round" ${extra}/>` +
    `<path d="${d}" fill="none" stroke="#e5d2a6" stroke-width="5.6" stroke-linecap="round" ${extra}/>` +
    `<path d="${d}" fill="none" stroke="#c4483e" stroke-width="5.6" stroke-dasharray="2.6 4.4" ${extra}/>`;
  const knot = (x, y) =>
    `<g transform="translate(${x} ${y})"><path d="M4 -2L10 -6M5 1L11 2M4 3L9 8" stroke="#d9c49a" stroke-width="1.6" stroke-linecap="round"/><circle r="5.6" fill="#e5d2a6" stroke="${LINE}" stroke-width="1.8"/><path d="M-4 -2C-1 0 1 0 4 -2M-4 2C-1 4 1 4 4 2" fill="none" stroke="#c4483e" stroke-width="1.6"/></g>`;
  const SPIRAL = (() => {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const th = i / 64 * Math.PI * 2 * 2.6, r = 2.5 + th * 1.15;
      pts.push([Math.cos(th) * r * 1.35, Math.sin(th) * r * .45 - th * .75]);
    }
    return 'M' + pts.reverse().map(q => f(q[0]) + ' ' + f(q[1])).join('L');
  })();
  const ballSVG = i => `<g data-k="b${i}"><circle r="6.2" fill="#d4e44a" stroke="${LINE}" stroke-width="1.6"/><path d="M-4.6 -3.6C-1.6 -1.6 -1.6 1.6 -4.6 3.6M4.6 -3.6C1.6 -1.6 1.6 1.6 4.6 3.6" fill="none" stroke="#fff" stroke-width="1.3"/></g>`;
  const ORBIT_TILT = [0, 58, -58];
  function atomUpdate(front) {
    return (q, s) => {
      const sc = .3 + .7 * E.back(clamp(s.k));
      for (let i = 0; i < 3; i++) {
        const th = s.a * (1 + i * .5) + i * 2.1;
        let [x, y] = [Math.cos(th) * 58, Math.sin(th) * 16];
        [x, y] = rot(ORBIT_TILT[i], x, y);
        const depth = Math.sin(th);
        const show = front ? depth > 0 : depth <= 0;
        attr(q['b' + i], 'transform', `translate(${f(x * sc)} ${f(y * sc)}) scale(${f(.85 + .25 * depth)})`);
        attr(q['b' + i], 'opacity', show ? 1 : 0);
      }
      if (!front) attr(q.orbits, 'transform', `scale(${f(sc)})`);
    };
  }

  /* the glow around a floating object */
  const auraSVG = (rx, ry) => `<ellipse data-k="halo" rx="${rx}" ry="${ry}" fill="#a9d6ff" opacity=".4"/><ellipse rx="${f(rx * .7)}" ry="${f(ry * .7)}" fill="#e3f2ff" opacity=".55"/>` +
    range(3).map(i => `<path data-k="sp${i}" d="${sparkle(2.8)}" fill="#ffe07a" stroke="${LINE}" stroke-width=".8"/>`).join('');
  function auraUpdate(q, t, rx, ry, c = [0, 0]) {
    attr(q.halo, 'opacity', f(.34 + .12 * Math.sin(t * 3)));
    for (let i = 0; i < 3; i++) {
      const a = t * 1.4 + i * 2.094;
      attr(q['sp' + i], 'transform', `translate(${f(c[0] + Math.cos(a) * rx * 1.05)} ${f(c[1] + Math.sin(a) * ry * 1.05)}) scale(${f(.6 + .45 * Math.abs(Math.sin(t * 2.6 + i)))})`);
    }
  }

  const PROPS = {
    /* ---------- scene fx ---------- */
    poof: {
      layer: 'fx', at: [100, 160],
      svg: range(9).map(i => `<circle data-k="c${i}" r="5" fill="#f4f0ea" stroke="${LINE}" stroke-width="1.4"/>`).join(''),
      update(q, s) {
        const k = clamp(s.k);
        for (let i = 0; i < 9; i++) {
          const a = i / 9 * Math.PI * 2 + .35, d = 8 + 34 * E.out(k);
          attr(q['c' + i], 'cx', f(Math.cos(a) * d * 1.3)); attr(q['c' + i], 'cy', f(Math.sin(a) * d * .55));
          attr(q['c' + i], 'r', f(Math.max(.01, 7 * (1 - k) * (.7 + .5 * rnd(i)))));
          attr(q['c' + i], 'opacity', f(1 - E.in(k)));
        }
      }
    },
    confetti: {
      layer: 'fx', at: [100, 22],
      svg: range(34).map(i => `<rect data-k="c${i}" x="-2" y="-3.5" width="4" height="7" rx="1" fill="${PARTY[i % PARTY.length]}"/>`).join(''),
      update(q, s) {
        const T = clamp(s.k) * 2.4;
        for (let i = 0; i < 34; i++) {
          const a = -Math.PI / 2 + (rnd(i, 2) - .5) * 3.0, v = 80 + rnd(i, 3) * 80;
          const x = Math.cos(a) * (14 + v * T * .75) + 6 * Math.sin(T * 5 + i), y = Math.sin(a) * (10 + v * T * .8) + 70 * T * T;
          attr(q['c' + i], 'transform', `translate(${f(x)} ${f(y)}) rotate(${f(T * 400 * (rnd(i, 4) - .5))}) scale(1 ${f(Math.cos(T * 9 + i))})`);
        }
      }
    },
    exclaim: {
      layer: 'fx', at: [136, 16],
      svg: `<path d="M-11 -18L-15 -24M11 -18L15 -24M0 -26V-32" stroke="#e5483d" stroke-width="2.4" stroke-linecap="round"/>
        <rect x="-4.2" y="-20" width="8.4" height="17" rx="4.2" fill="#e5483d" ${OL} stroke-width="1.8"/>
        <circle cx="0" cy="4.5" r="4.3" fill="#e5483d" ${OL} stroke-width="1.8"/>`
    },
    woof: {
      layer: 'fx', at: [150, 38],
      svg: (() => {
        let d = '';
        for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2, r = i % 2 ? 1 : 1.24; d += (i ? 'L' : 'M') + f(Math.cos(a) * 25 * r) + ' ' + f(Math.sin(a) * 13 * r); }
        return `<path d="${d}Z" fill="#fff" ${OL} stroke-width="1.8"/><text x="0" y="4.4" text-anchor="middle" font-family="Trebuchet MS, Verdana, sans-serif" font-weight="800" font-size="12.5" fill="#c23a30">Woof!</text>`;
      })()
    },
    thought: {
      layer: 'fx', at: [0, 0],
      svg: (() => {
        const cl = [[-15, 2, 9], [-5, -6, 11], [9, -6, 10.5], [17, 3, 8.5], [5, 7, 9.5], [-8, 8, 8.5]];
        const ring = (sw, fill, stroke) => cl.map(c => `<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}" fill="${fill}" ${stroke ? `stroke="${LINE}" stroke-width="${sw}"` : ''}/>`).join('');
        return `<circle data-k="b1" cx="127" cy="33" r="2.6" fill="#fff" ${OL} stroke-width="1.5"/>
          <circle data-k="b2" cx="137" cy="22" r="4.2" fill="#fff" ${OL} stroke-width="1.6"/>
          <g data-k="cloud" transform="translate(160 2)">${ring(4, '#fff', true)}${ring(0, '#fff', false)}
            <g data-k="dots" fill="${LINE}"><circle data-k="d1" cx="-8" cy="1" r="2.4"/><circle data-k="d2" cx="0" cy="1" r="2.4"/><circle data-k="d3" cx="8" cy="1" r="2.4"/></g>
            <g data-k="bulb"><circle data-k="glow" cx="0" cy="-2" r="13" fill="#ffe27a" opacity="0"/>
              <path d="M0 -10C5 -10 8 -6.4 8 -2.6C8 1 5.4 2.6 4.4 5H-4.4C-5.4 2.6 -8 1 -8 -2.6C-8 -6.4 -5 -10 0 -10Z" fill="#ffe27a" ${OL} stroke-width="1.6"/>
              <rect x="-4.2" y="5" width="8.4" height="5.6" rx="1.4" fill="#b9c0c9" ${OL} stroke-width="1.4"/>
              <path d="M-4 7.6H4M-2.4 -4.6C-1 -6.4 1.4 -6.4 2.4 -4.6" fill="none" stroke="${LINE}" stroke-width="1"/></g>
          </g>`;
      })(),
      update(q, s) {
        attr(q.b1, 'transform', `translate(127 33) scale(${f(s.b1)}) translate(-127 -33)`);
        attr(q.b2, 'transform', `translate(137 22) scale(${f(s.b2)}) translate(-137 -22)`);
        attr(q.cloud, 'transform', `translate(160 2) scale(${f(Math.max(.001, s.cl))})`);
        attr(q.d1, 'opacity', f(s.d1)); attr(q.d2, 'opacity', f(s.d2)); attr(q.d3, 'opacity', f(s.d3));
        attr(q.bulb, 'transform', `scale(${f(Math.max(.001, s.bulb))})`); attr(q.bulb, 'opacity', s.bulb > .01 ? 1 : 0);
        attr(q.glow, 'opacity', f(.35 * s.glow * (.75 + .25 * osc(s.t, 3))));
      }
    },
    gears: {
      layer: 'fx', at: [150, 22],
      svg: `<g data-k="g1"><path d="${gearPath(10.5, 9, 3.4)}" fill="#a7b2be" ${OL} stroke-width="1.8"/><circle r="3.6" fill="#fff" ${OL} stroke-width="1.6"/></g>
        <g data-k="g2" transform="translate(17 -11)"><path d="${gearPath(7, 7, 3)}" fill="#f0bf45" ${OL} stroke-width="1.8"/><circle r="2.4" fill="#fff" ${OL} stroke-width="1.4"/></g>`,
      update(q, s) {
        attr(q.g1, 'transform', `rotate(${f(s.a)})`);
        attr(q.g2, 'transform', `translate(17 -11) rotate(${f(-s.a * 1.5 + 12)})`);
      }
    },
    sound: {
      layer: 'fx', at: [0, 0],
      svg: range(3).map(i => `<path data-k="a${i}" d="M3 -9Q-5 0 3 9" fill="none" stroke="${C.collar}" stroke-width="2.4" stroke-linecap="round"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 3; i++) {
          const ph = (s.t * .6 + i / 3) % 1;
          attr(q['a' + i], 'transform', `translate(${f(186 - 38 * ph)} ${f(62 - 2 * ph)}) scale(${f(1.3 - .6 * ph)})`);
          attr(q['a' + i], 'opacity', f(Math.sin(ph * Math.PI)));
        }
      }
    },
    sniff: {
      layer: 'fx', at: [0, 0],
      svg: range(4).map(i => `<path data-k="p${i}" d="M0 -4Q3 0 0 4" fill="none" stroke="${C.collar}" stroke-width="1.8" stroke-linecap="round"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 4; i++) {
          const ph = (s.t * 2.4 + (i >> 1) / 2) % 1, side = i % 2 ? 1 : -1;
          attr(q['p' + i], 'transform', `translate(${f(side * (13 + 8 * ph))} ${f(-2 * ph)}) scale(${f(side * (.7 + .5 * ph))} ${f(.7 + .5 * ph)})`);
          attr(q['p' + i], 'opacity', f(Math.sin(ph * Math.PI)));
        }
      }
    },
    notes: {
      layer: 'fx', at: [0, 0],
      svg: range(3).map(i => `<g data-k="n${i}"><ellipse cx="0" cy="0" rx="3.4" ry="2.5" transform="rotate(-22)" fill="${i === 1 ? C.collar : LINE}"/><path d="M3 -1V-13C6 -11.5 8.4 -10 7.4 -6" fill="none" stroke="${i === 1 ? C.collar : LINE}" stroke-width="1.6" stroke-linecap="round"/></g>`).join(''),
      update(q, s) {
        for (let i = 0; i < 3; i++) {
          const ph = (s.t / 1.7 + i / 3) % 1;
          attr(q['n' + i], 'transform', `translate(${f(132 + 30 * ph + 5 * Math.sin(ph * 9 + i))} ${f(38 - 44 * ph)}) rotate(${f(12 * Math.sin(ph * 7))})`);
          attr(q['n' + i], 'opacity', f(Math.sin(ph * Math.PI)));
        }
      }
    },
    zzz: {
      layer: 'fx', at: [0, 0],
      svg: range(3).map(i => `<path data-k="z${i}" d="M-4 -4H4L-4 4H4" fill="none" stroke="${C.collar}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 3; i++) {
          const ph = (s.t * .5 + i / 3) % 1;
          attr(q['z' + i], 'transform', `translate(${f(126 + 34 * ph)} ${f(44 - 46 * ph)}) scale(${f(.7 + .9 * ph)}) rotate(-8)`);
          attr(q['z' + i], 'opacity', f(Math.sin(ph * Math.PI)));
        }
      }
    },
    binary: {
      layer: 'fx', at: [0, 0],
      svg: range(12).map(i => `<text data-k="t${i}" text-anchor="middle" font-family="Consolas, Menlo, monospace" font-weight="700" font-size="${8 + (i % 3) * 2}" fill="#1f9e6e">${i % 2 ? '1' : '0'}</text>`).join(''),
      update(q, s) {
        const xs = [36, 52, 148, 166, 28, 174, 44, 158, 60, 140, 20, 182];
        for (let i = 0; i < 12; i++) {
          const ph = (s.t * .5 + rnd(i, 8)) % 1;
          attr(q['t' + i], 'x', xs[i]); attr(q['t' + i], 'y', f(150 - 150 * ph));
          attr(q['t' + i], 'opacity', f(Math.sin(ph * Math.PI) * .9));
        }
      }
    },
    stars: {
      layer: 'fx', at: [0, 0],
      svg: range(10).map(i => `<path data-k="s${i}" d="${star(0, 0, 5, 2.2)}" fill="${['#ffd84a', '#ff9bd2', '#8fd6ff'][i % 3]}" stroke="${LINE}" stroke-width="1.1"/>`).join(''),
      update(q, s) {
        const k = clamp(s.k);
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * Math.PI * 2 + rnd(i, 9), d = 4 + (34 + 18 * rnd(i, 5)) * E.out(k);
          attr(q['s' + i], 'transform', `translate(${f(Math.cos(a) * d)} ${f(Math.sin(a) * d + 18 * k * k)}) rotate(${f(k * 300)}) scale(${f(.4 + .9 * (1 - k))})`);
          attr(q['s' + i], 'opacity', f(1 - seg(k, .65, 1)));
        }
      }
    },
    twinkle: {
      layer: 'fx', at: [0, 0],
      svg: [[38, 40], [168, 34], [28, 118], [178, 92], [62, 8], [182, 140], [16, 74], [140, 4]].map((p, i) =>
        `<path data-k="w${i}" transform="translate(${p[0]} ${p[1]})" d="${sparkle(5)}" fill="#ffd84a" stroke="${LINE}" stroke-width=".9"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 8; i++) attr(q['w' + i], 'opacity', f(Math.max(0, osc(s.t, 1.4 + .3 * rnd(i), rnd(i, 3)))));
      }
    },
    dirt: {
      layer: 'fx', at: [100, 181],
      svg: range(9).map(i => `<circle data-k="d${i}" r="${1.3 + rnd(i, 6) * 1.3}" fill="${i % 2 ? '#6b4a2f' : '#9a7048'}"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 9; i++) {
          const ph = (s.t * 2.3 + i / 9) % 1, side = i % 2 ? 1 : -1;
          attr(q['d' + i], 'cx', f(side * (5 + 24 * ph * (.5 + rnd(i))))); attr(q['d' + i], 'cy', f(-26 * 4 * ph * (1 - ph) * (.6 + .6 * rnd(i, 2))));
          attr(q['d' + i], 'opacity', f(1 - ph));
        }
      }
    },
    hole: {
      layer: 'front', at: [100, 182],
      svg: `<ellipse rx="16" ry="5" fill="#9a7048" ${OL} stroke-width="1.6"/><ellipse rx="12.5" ry="3.4" fill="#2b1d14"/>`
    },
    saved: {
      layer: 'fx', at: [134, 140],
      svg: `<circle r="9.5" fill="#3fa66b" ${OL} stroke-width="1.8"/><path d="M-4.4 .2L-1.2 3.6L4.8 -3.6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${sparkle(4)}" transform="translate(13 -10)" fill="#ffd84a" stroke="${LINE}" stroke-width=".9"/>`
    },
    fur: {
      layer: 'fx', at: [0, 0],
      svg: range(4).map(i => `<path data-k="f${i}" d="M-3 0C-2 -3 1 -3.6 3 -1.4M-1 2C0 0 2 -.4 3.6 1" fill="none" stroke="${C.tanD}" stroke-width="1.4" stroke-linecap="round"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 4; i++) {
          const ph = (s.t * 1.6 + i / 4) % 1;
          attr(q['f' + i], 'transform', `translate(${f(150 + 22 * ph * (.6 + rnd(i)))} ${f(72 - 18 * ph + 30 * ph * ph)}) rotate(${f(ph * 200)})`);
          attr(q['f' + i], 'opacity', f(Math.sin(ph * Math.PI)));
        }
      }
    },
    dust: {
      layer: 'fx', at: [0, 0],
      svg: range(2).map(i => `<circle data-k="d${i}" r="3" fill="#f4f0ea" stroke="${LINE}" stroke-width="1"/>`).join(''),
      update(q, s) {
        const ph = (s.t * 3 + .5) % 1, on = ph < .5 ? ph * 2 : 0;
        for (let i = 0; i < 2; i++) {
          const side = i ? 1 : -1;
          attr(q['d' + i], 'cx', f(side * (7 + 9 * on))); attr(q['d' + i], 'cy', f(-2 * on));
          attr(q['d' + i], 'r', f(1.4 + 2.4 * on)); attr(q['d' + i], 'opacity', f(on > 0 ? .9 * (1 - on) : 0));
        }
      }
    },

    /* ---------- objects on the mat ---------- */
    printer: {
      layer: 'front', at: [166, 176],
      svg: `<path d="M-14 -30L-12 -46H12L14 -30Z" fill="#fff" ${OL} stroke-width="1.5"/>
        <path d="M-8 -41H8M-8 -37H5" stroke="#c6ccd4" stroke-width="1.2"/>
        <rect x="-24" y="-31" width="48" height="26" rx="5" fill="#d7dce2" ${OL}/>
        <rect x="-24" y="-11" width="48" height="9" rx="3" fill="#b4bcc6" ${OL} stroke-width="1.6"/>
        <rect x="-16" y="-23" width="32" height="3.6" rx="1.8" fill="#39414c"/>
        <rect x="-20" y="-28" width="9" height="2.4" rx="1.2" fill="#9aa4ae"/>
        <circle data-k="led" cx="17" cy="-26.4" r="2.1" fill="#45c46b" stroke="${LINE}" stroke-width=".8"/>
        <rect data-k="sheet" x="-12" y="-21.5" width="24" height="0" fill="#fff" ${OL} stroke-width="1.4"/>
        <g stroke="#6b7380" stroke-width="1.4" stroke-linecap="round"><path data-k="l0" d="M-8 -15H6"/><path data-k="l1" d="M-8 -11H8"/><path data-k="l2" d="M-8 -7H2"/><path data-k="l3" d="M-8 -3H7"/></g>
        <g data-k="pp">${pawPrint(5.5, 0, .9, C.tanD)}</g>`,
      update(q, s) {
        const h = clamp(s.k) * 27, bottom = -21.5 + h;
        attr(q.sheet, 'height', f(h));
        [-15, -11, -7, -3].forEach((y, i) => attr(q['l' + i], 'opacity', bottom > y + 2 ? 1 : 0));
        attr(q.pp, 'opacity', bottom > 3 ? 1 : 0);
        attr(q.led, 'opacity', f(s.led == null ? 1 : s.led));
      }
    },
    floppy: {
      layer: 'front', at: [100, 140], clipToFloor: true,
      svg: `<rect x="-12" y="-12" width="24" height="24" rx="2" fill="#33405a" ${OL} stroke-width="1.8"/>
        <rect x="-6.5" y="-12" width="13" height="8.5" fill="#c9ced6" ${OL} stroke-width="1.2"/>
        <rect x="-3" y="-10.6" width="3.4" height="5.4" fill="#33405a"/>
        <rect x="-8.6" y="-.4" width="17.2" height="10.4" rx="1" fill="#f6f2e8"/>
        <path d="M-6 3H6M-6 6.4H3" stroke="#9aa3ad" stroke-width="1.1"/>
        <path d="M9 -12L12 -9" stroke="${LINE}" stroke-width="1.2"/>`
    },
    envelope: {
      layer: 'front', at: [100, 140],
      svg: `<g data-k="trail" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round" opacity="0"><path d="M-24 8H-38M-22 14H-32M-26 2H-44"/></g>
        <g data-k="wl"><path d="M-6 -9C-14 -26 -30 -28 -34 -20C-28 -18 -26 -14 -24 -10C-18 -12 -12 -11 -6 -9Z" fill="#fff" ${OL} stroke-width="1.5"/><path d="M-12 -14C-18 -17 -24 -18 -28 -17" fill="none" stroke="#cdbfae" stroke-width="1.1"/></g>
        <g data-k="wr"><path d="M6 -9C14 -26 30 -28 34 -20C28 -18 26 -14 24 -10C18 -12 12 -11 6 -9Z" fill="#fff" ${OL} stroke-width="1.5"/><path d="M12 -14C18 -17 24 -18 28 -17" fill="none" stroke="#cdbfae" stroke-width="1.1"/></g>
        <rect x="-17" y="-11" width="34" height="22" rx="2" fill="#fbf8f2" ${OL} stroke-width="1.8"/>
        <path d="M-17 11L-3 1M17 11L3 1" stroke="#cdbfae" stroke-width="1.2"/>
        <path data-k="flap" d="M-17 -11L0 -25L17 -11Z" fill="#e9dfcd" ${OL} stroke-width="1.6"/>
        <g data-k="stamp" opacity="0"><rect x="5.6" y="-8.6" width="9" height="10" rx="1" fill="#e5483d" ${OL} stroke-width="1.2"/>${pawPrint(10.1, -3.6, .62, '#fff')}</g>`,
      update(q, s) {
        const ty = lerp(-25, 3, clamp(s.flap));
        attr(q.flap, 'd', `M-17 -11L0 ${f(ty)}L17 -11Z`);
        attr(q.flap, 'fill', ty < -11 ? '#e9dfcd' : '#f3ece0');
        attr(q.stamp, 'opacity', f(s.stamp || 0));
        const w = s.wing || 0, fl = 26 * Math.sin((s.t || 0) * 28);
        attr(q.wl, 'opacity', f(w)); attr(q.wr, 'opacity', f(w));
        attr(q.wl, 'transform', `rotate(${f(-fl)} -6 -9) scale(${f(Math.max(.01, w))})`);
        attr(q.wr, 'transform', `rotate(${f(fl)} 6 -9) scale(${f(Math.max(.01, w))})`);
        attr(q.trail, 'opacity', f(s.trail || 0));
      }
    },
    trash: {
      layer: 'front', at: [36, 176],
      svg: `<g data-k="papers">${range(7).map(i => `<g data-k="p${i}"><circle r="4.4" fill="#f6f2e8" ${OL} stroke-width="1.3"/><path d="M-2.4 -1.6L-.6 -.2L1 -2M-1.6 2L.8 1.1L2.2 1.8" fill="none" stroke="#a89f90" stroke-width=".9"/></g>`).join('')}</g>
        <g data-k="can">
          <path d="M-14 -34L-12 0H12L14 -34Z" fill="#aab4be" ${OL}/>
          <path d="M-7.5 -29L-6.8 -5M0 -29V-5M7.5 -29L6.8 -5" stroke="#7f8a95" stroke-width="1.6" stroke-linecap="round"/>
          <path d="M-13 -3H13" stroke="${LINE}" stroke-width="1.4"/>
          <ellipse cx="0" cy="-34" rx="14" ry="3.2" fill="#2f3438"/>
          <g data-k="lid"><ellipse cx="0" cy="-35" rx="16" ry="4" fill="#c3ccd4" ${OL} stroke-width="1.8"/><rect x="-4.5" y="-41.5" width="9" height="4.4" rx="2" fill="#c3ccd4" ${OL} stroke-width="1.5"/></g>
        </g>`,
      update(q, s) {
        attr(q.can, 'transform', `rotate(${f(s.shake || 0)})`);
        attr(q.lid, 'transform', `rotate(${f(s.lid || 0)} -16 -35)`);
        const k = clamp(s.k), T = k * 1.15;
        for (let i = 0; i < 7; i++) {
          const a = (-90 + (rnd(i, 3) - .5) * 120) * D2R, v = 72 + rnd(i, 5) * 55;
          const x = Math.cos(a) * v * T, y = -36 + Math.sin(a) * v * T + 95 * T * T;
          attr(q['p' + i], 'transform', `translate(${f(x)} ${f(y)}) rotate(${f(T * 500 * (rnd(i, 1) - .5))})`);
          attr(q['p' + i], 'opacity', k > 0 && k < 1 ? f(1 - seg(k, .7, 1)) : 0);
        }
      }
    },
    easel: {
      layer: 'front', at: STAGE.easel,
      svg: `<path d="M-15 0L-5 -56M15 0L5 -56" stroke="${LINE}" stroke-width="4.8" stroke-linecap="round"/>
        <path d="M-15 0L-5 -56M15 0L5 -56" stroke="#b07a45" stroke-width="2.8" stroke-linecap="round"/>
        <rect x="-18" y="-54" width="36" height="31" rx="1.5" fill="#fffdf7" ${OL} stroke-width="1.8"/>
        <rect x="-20" y="-23.5" width="40" height="3.8" rx="1.4" fill="#b07a45" ${OL} stroke-width="1.3"/>
        <path data-k="a1" d="M-13 -28Q-6.5 -32 0 -28T13 -28" fill="none" stroke="#3fa66b" stroke-width="2.6" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>
        <path data-k="a2" d="M-7 -40.2C-8.6 -43.4 -12.4 -41.6 -10.6 -38.9C-12.6 -36.5 -9.6 -33.6 -7 -35.8L4 -35.8C6.6 -33.6 9.6 -36.5 7.6 -38.9C9.4 -41.6 5.6 -43.4 4 -40.2Z" fill="none" stroke="#8c4c22" stroke-width="2" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>
        <path data-k="a3" d="M12.5 -45A3.5 3.5 0 1 1 12.49 -45.3" fill="none" stroke="#f0bf45" stroke-width="2.6" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>`,
      update(q, s) {
        attr(q.a1, 'stroke-dashoffset', f(1 - clamp(s.k1)));
        attr(q.a2, 'stroke-dashoffset', f(1 - clamp(s.k2)));
        attr(q.a3, 'stroke-dashoffset', f(1 - clamp(s.k3)));
      }
    },
    laptop: {
      layer: 'front', at: [100, 179],
      svg: `<path data-k="glow" d="M-21 -33L-30 -66H30L21 -33Z" fill="#7fe3f2" opacity="0"/>
        <path d="M-29 0H29L25 -5.5H-25Z" fill="#c3cad3" ${OL} stroke-width="1.8"/>
        <rect x="-23" y="-34" width="46" height="29" rx="3" fill="#8e98a5" ${OL}/>
        <path d="M-19 -30.5H19" stroke="#a9b2bd" stroke-width="1.4" stroke-linecap="round"/>
        ${pawPrint(0, -19, 1.25, '#e9edf2')}`,
      update(q, s) { attr(q.glow, 'opacity', f(.22 * (s.glow || 0))); }
    },
    ropePile: {
      layer: 'front', at: [100, 182],
      svg: `<g data-k="coil">${rope(SPIRAL, 'pathLength="1" data-r="1"')}</g>${knot(-8, -20)}`,
      build(g) { g.querySelectorAll('[data-r]').forEach(n => { n.setAttribute('stroke-dasharray', n.getAttribute('stroke-dasharray') ? '0.02 0.033' : '1 1'); }); },
      update(q, s, ctx, g) {
        const c = clamp(s.coil);
        g.querySelectorAll('[data-r]').forEach(n => {
          if (n.getAttribute('stroke') === '#c4483e') { n.setAttribute('opacity', c > .98 ? 1 : 0); return; }
          n.setAttribute('stroke-dashoffset', f(1 - c));
        });
        attr(q.coil, 'transform', `scale(${f(1 + .12 * (s.sq || 0))} ${f(1 - .18 * (s.sq || 0))})`);
      }
    },
    atomB: {
      layer: 'back', at: [100, 62],
      svg: `<g data-k="orbits" fill="none" stroke="${C.collar}" stroke-width="1.2" stroke-dasharray="3 3" opacity=".55">${ORBIT_TILT.map(a => `<ellipse rx="58" ry="16" transform="rotate(${a})"/>`).join('')}</g>${range(3).map(ballSVG).join('')}`,
      update: atomUpdate(false)
    },
    atomF: {
      layer: 'fx', at: [100, 62],
      svg: range(3).map(ballSVG).join(''),
      update: atomUpdate(true)
    },

    /* ---------- props for the extras ---------- */
    hearts: {
      layer: 'fx', at: [0, 0],
      svg: range(3).map(i => `<path data-k="h${i}" d="M0 4C-7 -1 -6 -7 -2.4 -7C-1.1 -7 0 -6 0 -4.8C0 -6 1.1 -7 2.4 -7C6 -7 7 -1 0 4Z" fill="#e5483d" stroke="${LINE}" stroke-width="1.2"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 3; i++) {
          const ph = clamp(s.k * 1.6 - i * .25);
          attr(q['h' + i], 'transform', `translate(${f(122 + i * 13 + 4 * Math.sin(ph * 7 + i))} ${f(46 - 46 * ph)}) scale(${f(.5 + .7 * Math.sin(Math.min(1, ph * 1.4) * Math.PI / 2))})`);
          attr(q['h' + i], 'opacity', f(ph > 0 && ph < 1 ? Math.min(1, Math.sin(ph * Math.PI) * 1.4) : 0));
        }
      }
    },
    shock: {
      layer: 'fx', at: [100, 64],
      svg: range(9).map(i => `<path data-k="l${i}" stroke="${LINE}" stroke-width="2.2" stroke-linecap="round"/>`).join(''),
      update(q, s) {
        const k = clamp(s.k);
        for (let i = 0; i < 9; i++) {
          const a = (-170 + i * 20) * D2R, r0 = 46 + 10 * E.out(k), r1 = r0 + 3 + 6 * (1 - k);
          attr(q['l' + i], 'd', `M${f(Math.cos(a) * r0)} ${f(Math.sin(a) * r0)}L${f(Math.cos(a) * r1)} ${f(Math.sin(a) * r1)}`);
        }
      }
    },
    question: {
      layer: 'fx', at: [136, 12],
      svg: `<path d="M-6 -8C-6 -15 6 -15 6 -8C6 -3 0 -2 0 3" fill="none" stroke="${LINE}" stroke-width="7.6" stroke-linecap="round"/>
        <path d="M-6 -8C-6 -15 6 -15 6 -8C6 -3 0 -2 0 3" fill="none" stroke="${C.collar}" stroke-width="4.4" stroke-linecap="round"/>
        <circle cx="0" cy="10" r="3.6" fill="${C.collar}" ${OL} stroke-width="1.6"/>`
    },
    bulb: {
      layer: 'fx', at: [138, 12],
      svg: `<g data-k="rays" stroke="#f0bf45" stroke-width="2.4" stroke-linecap="round">${range(7).map(i => { const a = (-160 + i * 23.3) * D2R; return `<path d="M${f(Math.cos(a) * 14)} ${f(Math.sin(a) * 14 - 2)}L${f(Math.cos(a) * 20)} ${f(Math.sin(a) * 20 - 2)}"/>`; }).join('')}</g>
        <path d="M0 -12C6 -12 9.5 -7.6 9.5 -3C9.5 1.4 6.4 3.2 5.2 6H-5.2C-6.4 3.2 -9.5 1.4 -9.5 -3C-9.5 -7.6 -6 -12 0 -12Z" fill="#ffe27a" ${OL} stroke-width="1.8"/>
        <rect x="-5" y="6" width="10" height="6.5" rx="1.6" fill="#b9c0c9" ${OL} stroke-width="1.5"/>
        <path d="M-4.6 9.2H4.6M-2.8 -5.4C-1.2 -7.6 1.6 -7.6 2.8 -5.4" fill="none" stroke="${LINE}" stroke-width="1.1"/>`,
      update(q, s) { attr(q.rays, 'opacity', f(s.glow == null ? 1 : s.glow)); }
    },
    book: {
      layer: 'handLF', at: [2, 0],
      svg: `<path d="M-4 -1V-33Q22 -30 22 -27Q22 -30 48 -33V-1Q22 2 22 3Q22 2 -4 -1Z" fill="#b8323f" ${OL} stroke-width="1.8"/>
        <path d="M-1 -4V-30Q11 -31.5 22 -26V-.5Q11 -6 -1 -4Z" fill="#fdfbf6" ${OL} stroke-width="1.4"/>
        <path d="M45 -4V-30Q33 -31.5 22 -26V-.5Q33 -6 45 -4Z" fill="#fdfbf6" ${OL} stroke-width="1.4"/>
        <path d="M3 -24H18M3 -20H17M3 -16H18M3 -12H14M26 -24H41M26 -20H40M26 -16H41M26 -12H37" stroke="#a9b0ba" stroke-width="1.3" stroke-linecap="round"/>
        <g data-k="flip"><path d="M22 -26Q33 -31.5 45 -30V-4Q33 -6 22 -.5Z" fill="#f2ecdf" ${OL} stroke-width="1.3"/><path d="M26 -22H40M26 -18H38M26 -14H40" stroke="#c3c8cf" stroke-width="1.2" stroke-linecap="round"/></g>`,
      update(q, s) {
        const fl = clamp(s.flip || 0), sx = Math.cos(fl * Math.PI);
        attr(q.flip, 'opacity', fl > 0 && fl < 1 ? 1 : 0);
        attr(q.flip, 'transform', `translate(22 0) scale(${f(Math.abs(sx) < .03 ? .03 : sx)} 1) translate(-22 0)`);
      }
    },
    howl: {
      layer: 'fx', at: [54, 12],
      svg: `<g data-k="g"><text x="0" y="0" text-anchor="middle" font-family="Trebuchet MS, Verdana, sans-serif" font-style="italic" font-weight="800" font-size="15" fill="${C.collar}" stroke="#fff" stroke-width="3" paint-order="stroke" transform="rotate(-12)">Aroooo!</text></g>
        ${range(3).map(i => `<path data-k="w${i}" d="M-6 0q3 -4 6 0t6 0t6 0" fill="none" stroke="${C.collar}" stroke-width="2" stroke-linecap="round"/>`).join('')}`,
      update(q, s) {
        attr(q.g, 'transform', `translate(0 ${f(-8 * s.k)}) scale(${f(.6 + .4 * E.back(clamp(s.k * 3)))})`);
        for (let i = 0; i < 3; i++) {
          const ph = ((s.t || 0) * 1.5 + i / 3) % 1;
          attr(q['w' + i], 'transform', `translate(${f(38 - 32 * ph)} ${f(66 - 50 * ph)}) rotate(-35) scale(${f(.6 + .6 * ph)})`);
          attr(q['w' + i], 'opacity', f(Math.sin(ph * Math.PI)));
        }
      }
    },
    ball: { layer: 'front', at: [0, 0], svg: ballSVG(0) },
    mouthBall: { layer: 'head', at: [100, 99], svg: ballSVG(0) },
    drops: {
      layer: 'fx', at: [100, 112],
      svg: range(14).map(i => `<path data-k="d${i}" d="M0 -3.4C1.6 -1 2.4 .4 2.4 1.4C2.4 2.8 1.3 3.6 0 3.6C-1.3 3.6 -2.4 2.8 -2.4 1.4C-2.4 .4 -1.6 -1 0 -3.4Z" fill="#7cc0ef" stroke="#3f7fb0" stroke-width=".9"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 14; i++) {
          const ph = ((s.t || 0) * 1.8 + rnd(i, 4)) % 1, a = i / 14 * Math.PI * 2 + rnd(i) * .5, v = 46 + 22 * rnd(i, 2);
          const x = Math.cos(a) * v * ph * 1.3, y = Math.sin(a) * v * ph * .6 + 40 * ph * ph;
          attr(q['d' + i], 'transform', `translate(${f(x)} ${f(y)}) rotate(${f(Math.atan2(Math.sin(a) * .6 + ph, Math.cos(a) * 1.3) / D2R + 90)})`);
          attr(q['d' + i], 'opacity', f(1 - ph));
        }
      }
    },
    dizzy: {
      layer: 'fx', at: [100, 30],
      svg: range(3).map(i => `<path data-k="s${i}" d="${star(0, 0, 4.6, 2)}" fill="#ffd84a" stroke="${LINE}" stroke-width="1"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 3; i++) {
          const a = (s.t || 0) * 5 + i * 2.094;
          attr(q['s' + i], 'transform', `translate(${f(Math.cos(a) * 26)} ${f(Math.sin(a) * 7)}) scale(${f(.8 + .3 * Math.sin(a))})`);
        }
      }
    },
    scent: {
      layer: 'fx', at: [0, 0],
      svg: range(3).map(i => `<path data-k="c${i}" d="M0 0c3 -4 6 4 9 0s6 4 9 0" fill="none" stroke="#9a7bc8" stroke-width="2" stroke-linecap="round"/>`).join(''),
      update(q, s) {
        for (let i = 0; i < 3; i++) {
          const ph = ((s.t || 0) * .7 + i / 3) % 1;
          attr(q['c' + i], 'transform', `translate(${f(10 + 70 * ph)} ${f(64 + 6 * Math.sin(ph * 6 + i) - 6 * i)})`);
          attr(q['c' + i], 'opacity', f(Math.sin(ph * Math.PI) * .9));
        }
      }
    },

    /* ---------- floating objects: moved by Scout's mind, with a soft glow ---------- */
    trashGlow: {
      layer: 'back', at: [0, 0],
      svg: `${auraSVG(22, 26)}`,
      update(q, s) { auraUpdate(q, s.t || 0, 22, 26); }
    },
    stampDrop: {
      layer: 'front', at: [0, 0],
      svg: `<rect x="-4.5" y="-5" width="9" height="10" rx="1" fill="#e5483d" ${OL} stroke-width="1.2"/>${pawPrint(0, 0, .62, '#fff')}`
    },
    floatMag: {
      layer: 'front', at: [100, 166],
      svg: `${auraSVG(17, 15)}
        <path d="M7 -7L17 -18" stroke="${LINE}" stroke-width="6.6" stroke-linecap="round"/><path d="M7 -7L17 -18" stroke="#8a5530" stroke-width="4.2" stroke-linecap="round"/>
        <circle r="10" fill="#cfe6f5" fill-opacity=".45" stroke="${LINE}" stroke-width="5"/><circle r="10" fill="none" stroke="#c9a24a" stroke-width="2.6"/>
        <path d="M-6.5 -4A7 7 0 0 1 0 -7.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`,
      update(q, s) { auraUpdate(q, s.t || 0, 17, 15); }
    },
    floatWand: {
      layer: 'fx', at: [150, 118],
      svg: `<g transform="translate(0 -10)">${auraSVG(11, 22)}</g>
        <path d="M0 9V-23" stroke="${LINE}" stroke-width="5" stroke-linecap="round"/><path d="M0 9V-16" stroke="#2b2b33" stroke-width="3" stroke-linecap="round"/>
        <path d="M0 -16V-23" stroke="#f6f2ea" stroke-width="3" stroke-linecap="round"/><path d="${star(0, -28, 6, 2.6)}" fill="#ffd84a" ${OL} stroke-width="1.3"/>`,
      update(q, s) { auraUpdate(q, s.t || 0, 11, 22); }
    },
    floatBrush: {
      layer: 'front', at: [0, 0],
      svg: `<g transform="translate(0 -4)">${auraSVG(8, 16)}</g>
        <path d="M0 10V-8" stroke="${LINE}" stroke-width="5" stroke-linecap="round"/><path d="M0 10V-8" stroke="#b9773e" stroke-width="3" stroke-linecap="round"/>
        <rect x="-2.6" y="-13" width="5.2" height="5.5" fill="#c3cad3" ${OL} stroke-width="1.2"/>
        <path data-k="tip" d="M-2.6 -13C-3 -16 -1 -19 0 -20C1 -19 3 -16 2.6 -13Z" fill="#3fa66b" ${OL} stroke-width="1.2"/>`,
      update(q, s) { if (s.c) attr(q.tip, 'fill', s.c); auraUpdate(q, s.t || 0, 8, 16); }
    },
    floatPalette: {
      layer: 'front', at: [0, 0],
      svg: `${auraSVG(24, 18)}
        <path d="M13 -7C0 -18 -21 -11 -21 2C-21 14 -6 19 7 15C13 13 11 7 15 5C19 3 23 -2 13 -7Z" fill="#e2c39a" ${OL} stroke-width="1.8"/>
        <circle cx="-12" cy="-2" r="3.2" fill="#e5483d"/><circle cx="-4" cy="-9" r="3" fill="#f0bf45"/><circle cx="5" cy="-10" r="2.8" fill="#2f6fb3"/>
        <circle cx="-13" cy="8" r="3" fill="#3fa66b"/><circle cx="-3" cy="11.5" r="2.8" fill="#8c5bd0"/>
        <ellipse cx="5" cy="3" rx="3" ry="2.2" fill="#d9b88d" stroke="${LINE}" stroke-width="1.2"/>`,
      update(q, s) { auraUpdate(q, s.t || 0, 24, 18); }
    },
    floatLaptop: {
      layer: 'front', at: [100, 160],
      svg: `<g transform="translate(0 -17)">${auraSVG(34, 24)}</g>
        <path data-k="glow" d="M-21 -33L-30 -60H30L21 -33Z" fill="#7fe3f2" opacity="0"/>
        <path d="M-29 0H29L25 -5.5H-25Z" fill="#c3cad3" ${OL} stroke-width="1.8"/>
        <rect x="-23" y="-34" width="46" height="29" rx="3" fill="#8e98a5" ${OL}/>
        <path d="M-19 -30.5H19" stroke="#a9b2bd" stroke-width="1.4" stroke-linecap="round"/>${pawPrint(0, -19, 1.25, '#e9edf2')}
        ${range(4).map(i => `<rect data-k="key${i}" x="${-18 + i * 9}" y="-4.6" width="6" height="2.6" rx="1" fill="#7fe3f2" opacity="0"/>`).join('')}`,
      update(q, s) {
        attr(q.glow, 'opacity', f(.22 * (s.glow || 0)));
        const t = s.t || 0;
        for (let i = 0; i < 4; i++) attr(q['key' + i], 'opacity', f((s.glow || 0) * Math.max(0, Math.sin(t * 9 + i * 1.9))));
        auraUpdate(q, t, 34, 24, [0, -17]);
      }
    },

    /* ---------- worn on the head ---------- */
    wizard: {
      layer: 'head', at: [0, 0], pivot: [100, 46],
      svg: `<ellipse cx="100" cy="46" rx="38" ry="8" fill="#43307f" ${OL}/>
        <path d="M72 46C82 30 93 6 104 -12C108 -9 112 -8 115 -10C112 4 120 30 128 46Z" fill="#5a3ea8" ${OL}/>
        <path d="M104 -12C106 -16 111 -16 115 -10" fill="none" stroke="${LINE}" stroke-width="2"/>
        <path d="M77 37C90 33 112 33 124 37L126 43C112 39 90 39 74 43Z" fill="#f0bf45" ${OL} stroke-width="1.6"/>
        <path d="${star(95, 22, 4.4, 1.9)}" fill="#f0bf45"/><path d="${star(108, 8, 3, 1.3)}" fill="#f0bf45"/><circle cx="111" cy="26" r="1.4" fill="#f0bf45"/>
        <path d="M62 46A38 8 0 0 0 138 46" fill="#43307f" ${OL}/>`
    },
    beret: {
      layer: 'head', at: [0, 0], pivot: [100, 40],
      svg: `<path d="M66 44C60 32 80 20 104 21C128 22 142 31 136 41C130 46 118 47 100 47C84 47 72 47 66 44Z" fill="#b8323f" ${OL}/>
        <path d="M70 43C86 46 116 46 132 41" fill="none" stroke="#8e2430" stroke-width="2.6" stroke-linecap="round"/>
        <path d="M104 21L106 14.5" stroke="${LINE}" stroke-width="3" stroke-linecap="round"/>
        <path d="M84 29C90 26 98 25 104 25" fill="none" stroke="#d65a66" stroke-width="2" stroke-linecap="round"/>`
    },
    techy: {
      layer: 'head', at: [0, 0], pivot: [100, 60],
      svg: `<path d="M67 60C63 24 137 24 133 60" fill="none" stroke="${LINE}" stroke-width="8.4" stroke-linecap="round"/>
        <path d="M67 60C63 24 137 24 133 60" fill="none" stroke="#3a4250" stroke-width="5" stroke-linecap="round"/>
        <rect x="59" y="51" width="15" height="23" rx="6.5" fill="#3a4250" ${OL}/><rect x="126" y="51" width="15" height="23" rx="6.5" fill="#3a4250" ${OL}/>
        <rect x="62.5" y="56" width="3" height="13" rx="1.5" fill="#35d0e8"/><rect x="134.5" y="56" width="3" height="13" rx="1.5" fill="#35d0e8"/>
        <path d="M66 73C66 86 75 94 87 95.5" fill="none" stroke="#3a4250" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="88.5" cy="95.6" r="2.7" fill="#35d0e8" ${OL} stroke-width="1.2"/>
        <rect data-k="visor" x="77" y="57" width="46" height="18" rx="8" fill="#35d0e8" fill-opacity=".34" stroke="#1a6f86" stroke-width="2"/>
        <path d="M81 61.5H89M81 64.5H85.5M111 61.5H119M114.5 64.5H119" stroke="#d6fbff" stroke-width="1.1" stroke-linecap="round"/>
        <rect data-k="scan" x="79" y="60" width="42" height="1.3" rx=".6" fill="#ecfdff"/>`,
      update(q, s) {
        attr(q.visor, 'fill-opacity', f(.22 + .2 * (s.glow || 0)));
        attr(q.scan, 'y', f(59 + 13 * (((s.t || 0) * .5) % 1)));
      }
    },
    bubble: {
      layer: 'head', at: [108, 83],
      svg: `<g data-k="ball"><circle data-k="b" r="5" fill="#bfe0ff" fill-opacity=".6" stroke="#5f9fd3" stroke-width="1.2"/><circle data-k="hl" r="1.4" fill="#fff"/></g>
        <g data-k="pop" stroke="#5f9fd3" stroke-width="1.3" stroke-linecap="round" opacity="0">${range(6).map(i => { const a = i / 6 * Math.PI * 2; return `<path d="M${f(Math.cos(a) * 6)} ${f(Math.sin(a) * 6)}L${f(Math.cos(a) * 10)} ${f(Math.sin(a) * 10)}"/>`; }).join('')}</g>`,
      update(q, s) {
        const r = 2 + 6 * clamp(s.k), pop = s.pop || 0;
        attr(q.ball, 'opacity', pop > 0 ? 0 : 1);
        attr(q.b, 'r', f(r)); attr(q.b, 'cx', f(r * .75)); attr(q.b, 'cy', f(-r * .15));
        attr(q.hl, 'cx', f(r * .75 - r * .4)); attr(q.hl, 'cy', f(-r * .15 - r * .45));
        attr(q.pop, 'opacity', pop > 0 ? f(1 - pop) : 0);
        attr(q.pop, 'transform', `translate(6 -1) scale(${f(.6 + pop)})`);
      }
    },
    earPencil: {
      layer: 'head', at: [130, 50], pivot: [0, 0],
      svg: `<g transform="rotate(62)"><rect x="-2.6" y="-11" width="5.2" height="19" fill="#f2c230" ${OL} stroke-width="1.4"/>
        <rect x="-2.6" y="6" width="5.2" height="4" rx="1.2" fill="#e88a9a" ${OL} stroke-width="1.4"/>
        <path d="M-2.6 -11L0 -17L2.6 -11Z" fill="#f0d9b5" ${OL} stroke-width="1.4"/><path d="M-.8 -15L0 -17L.8 -15Z" fill="${LINE}"/></g>`
    },
    ropeMouth: {
      layer: 'head', at: [100, 95],
      svg: `${rope('M-29 7C-18 2 -8 1 0 2C8 3 18 3 29 8')}${knot(-31, 8)}${knot(31, 9)}`
    },

    /* ---------- held in a paw ---------- */
    pencil: {
      layer: 'handRF', at: [0, 0],
      svg: `<rect x="-2.7" y="-8" width="5.4" height="21" fill="#f2c230" ${OL} stroke-width="1.5"/>
        <rect x="-2.7" y="9" width="5.4" height="4.2" rx="1.2" fill="#e88a9a" ${OL} stroke-width="1.5"/>
        <rect x="-2.7" y="7.8" width="5.4" height="2" fill="#b9bec6"/>
        <path d="M-2.7 -8L0 -15L2.7 -8Z" fill="#f0d9b5" ${OL} stroke-width="1.5"/>
        <path d="M-.9 -12.6L0 -15L.9 -12.6Z" fill="${LINE}"/>`
    },
    magnifier: {
      layer: 'handR', at: [0, 0],
      svg: `<path d="M4 -5L-8 9" stroke="${LINE}" stroke-width="6.6" stroke-linecap="round"/>
        <path d="M4 -5L-8 9" stroke="#8a5530" stroke-width="4.2" stroke-linecap="round"/>
        <circle cx="-15" cy="17" r="10" fill="#cfe6f5" fill-opacity=".45" stroke="${LINE}" stroke-width="5"/>
        <circle cx="-15" cy="17" r="10" fill="none" stroke="#c9a24a" stroke-width="2.6"/>
        <path d="M-21.5 13A7 7 0 0 1 -15 9.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>`
    },
    wand: {
      layer: 'handR', at: [0, 0],
      svg: `<path d="M0 9V-23" stroke="${LINE}" stroke-width="5" stroke-linecap="round"/>
        <path d="M0 9V-16" stroke="#2b2b33" stroke-width="3" stroke-linecap="round"/>
        <path d="M0 -16V-23" stroke="#f6f2ea" stroke-width="3" stroke-linecap="round"/>
        <path d="${star(0, -28, 6, 2.6)}" fill="#ffd84a" ${OL} stroke-width="1.3"/>`
    },
    brush: {
      layer: 'handR', at: [0, 0],
      svg: `<path d="M0 10V-8" stroke="${LINE}" stroke-width="5" stroke-linecap="round"/>
        <path d="M0 10V-8" stroke="#b9773e" stroke-width="3" stroke-linecap="round"/>
        <rect x="-2.6" y="-13" width="5.2" height="5.5" fill="#c3cad3" ${OL} stroke-width="1.2"/>
        <path data-k="tip" d="M-2.6 -13C-3 -16 -1 -19 0 -20C1 -19 3 -16 2.6 -13Z" fill="#3fa66b" ${OL} stroke-width="1.2"/>`,
      update(q, s) { if (s.c) attr(q.tip, 'fill', s.c); }
    },
    brushL: null,
    paletteR: null,
    palette: {
      layer: 'handL', at: [0, 0],
      svg: `<path d="M-4 -7C-17 -18 -38 -11 -38 2C-38 14 -23 19 -10 15C-4 13 -6 7 -2 5C2 3 6 -2 -4 -7Z" fill="#e2c39a" ${OL} stroke-width="1.8"/>
        <circle cx="-29" cy="-2" r="3.2" fill="#e5483d"/><circle cx="-21" cy="-9" r="3" fill="#f0bf45"/><circle cx="-12" cy="-10" r="2.8" fill="#2f6fb3"/>
        <circle cx="-30" cy="8" r="3" fill="#3fa66b"/><circle cx="-20" cy="11.5" r="2.8" fill="#8c5bd0"/>
        <ellipse cx="-12" cy="3" rx="3" ry="2.2" fill="#d9b88d" stroke="${LINE}" stroke-width="1.2"/>`
    },
    clipboard: {
      layer: 'handLF', at: [7, 0],
      svg: `<rect x="-6" y="-42" width="34" height="44" rx="3" fill="#b5804a" ${OL} stroke-width="1.8"/>
        <rect x="-2" y="-37" width="26" height="35" fill="#fdfbf6"/>
        <rect x="5" y="-46" width="12" height="7" rx="2" fill="#c3cad3" ${OL} stroke-width="1.4"/>
        ${[-28, -20, -12].map((y, i) => `<rect x="0" y="${y - 3}" width="5" height="5" fill="none" stroke="${LINE}" stroke-width="1.1"/><path d="M8 ${y - .5}H${i === 1 ? 18 : 21}" stroke="#9aa3ad" stroke-width="1.6" stroke-linecap="round"/>
          <path data-k="c${i}" d="M.4 ${y - 1}L2.6 ${y + 1.6}L7 ${y - 5}" fill="none" stroke="#2c9d5b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>`).join('')}`,
      update(q, s) { for (let i = 0; i < 3; i++) attr(q['c' + i], 'stroke-dashoffset', f(1 - clamp(s['c' + i] || 0))); }
    },
    notepad: {
      layer: 'handL', at: [0, 0],
      svg: `<rect x="-4" y="-40" width="34" height="40" rx="2" fill="#fdfbf6" ${OL} stroke-width="1.8"/>
        <path d="M-1 -30H27M-1 -23H27M-1 -16H27M-1 -9H27" stroke="#a8c4e0" stroke-width="1"/>
        <path d="M3 -38V-2" stroke="#e9a0a0" stroke-width="1"/>
        ${[1, 7, 13, 19, 25].map(x => `<path d="M${x} -42.5a2 2.4 0 1 1 0 4.4" fill="none" stroke="${LINE}" stroke-width="1.4"/>`).join('')}
        ${[[-27.5, 'c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5m2 0c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5'], [-20.5, 'c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5m2 0c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5'], [-13.5, 'c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5c1.2 -3.2 2.6 -3.4 2.8 -.9c.15 1.6 -1.1 2 -.8 .4c.4 -1 .9 -.9 1.4 .5']].map(([y, d], i) => `<path data-k="l${i}" d="M5 ${y}${d}" fill="none" stroke="#2b3a67" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>`).join('')}`,
      update(q, s) { for (let i = 0; i < 3; i++) attr(q['l' + i], 'stroke-dashoffset', f(1 - clamp(s['l' + i] || 0))); }
    },
    pointerL: {
      layer: 'handLF', at: [0, 0],
      svg: range(3).map(i => `<path data-k="l${i}" stroke="${C.collar}" stroke-width="2.4" stroke-linecap="round"/>`).join(''),
      update(q, s, ctx) { pointerRays(q, s, ctx.dirL); }
    },
    pointerR: {
      layer: 'handRF', at: [0, 0],
      svg: range(3).map(i => `<path data-k="l${i}" stroke="${C.collar}" stroke-width="2.4" stroke-linecap="round"/>`).join(''),
      update(q, s, ctx) { pointerRays(q, s, ctx.dirR); }
    },
    ripple: {
      layer: 'handR', at: [0, 0],
      svg: range(3).map(i => `<circle data-k="r${i}" r="6" fill="none" stroke="${C.collar}" stroke-width="2"/>`).join(''),
      update(q, s) {
        s.hits.forEach((h, i) => {
          const u = s.t - h;
          const on = u > 0 && u < .5;
          attr(q['r' + i], 'r', f(on ? 9 + 34 * E.out(u / .5) : 1));
          attr(q['r' + i], 'opacity', on ? f(1 - u / .5) : 0);
        });
      }
    }
  };
  PROPS.brushL = Object.assign({}, PROPS.brush, { layer: 'handL' });
  PROPS.paletteR = { layer: 'handR', at: [0, 0], svg: `<g transform="scale(-1 1)">${PROPS.palette.svg}</g>` };
  /* ============================================================ CARDS
   * Flat objects that live in 3D: pages, boards, the laptop, the canvas. Each has front and back art
   * in its own local units (x right, y down, centred), placed on a plane facing the dog, the camera, or
   * halfway between, then projected with the camera (an exact affine map for a plane).
   */
  const VE = 'vector-effect="non-scaling-stroke"';
  const OLv = (w = 1.8) => `stroke="${LINE}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" ${VE}`;
  const ringsTop = (xs, y) => xs.map(x => `<path d="M${x} ${y + 2.6}a2 2.7 0 1 1 0 -4.8" fill="none" ${OLv(1.3)}/>`).join('');
  const polyline = q => q.length > 1 ? 'M' + q.map(pt).join('L') : '';
  const NOTE_ROWS = [-6.6, -.6, 5.4];
  /* the three strokes of the painting, as point functions of progress (canvas units) */
  const BONE = (() => {
    const segs = [[[-7, -1.7], [-8.6, -4.9], [-12.4, -3.1], [-10.6, -.4]], [[-10.6, -.4], [-12.6, 2], [-9.6, 4.9], [-7, 2.7]],
      [[-7, 2.7], [-1.5, 2.7], [-1.5, 2.7], [4, 2.7]], [[4, 2.7], [6.6, 4.9], [9.6, 2], [7.6, -.4]], [[7.6, -.4], [9.4, -3.1], [5.6, -4.9], [4, -1.7]],
      [[4, -1.7], [-1.5, -1.7], [-1.5, -1.7], [-7, -1.7]]];
    const out = [];
    segs.forEach(([a, b, c, d]) => { for (let i = 0; i < 10; i++) { const u = i / 10, w = 1 - u; out.push([w * w * w * a[0] + 3 * w * w * u * b[0] + 3 * w * u * u * c[0] + u * u * u * d[0], w * w * w * a[1] + 3 * w * w * u * b[1] + 3 * w * u * u * c[1] + u * u * u * d[1]]); } });
    out.push(out[0].slice());
    return out;
  })();
  const STROKES = [
    q => [-13 + 26 * q, 9.5 - 2.6 * Math.sin(q * Math.PI * 2)],
    q => { const x = clamp(q) * (BONE.length - 1), i = Math.min(BONE.length - 2, Math.floor(x)); return mix2(BONE[i], BONE[i + 1], x - i); },
    q => [9 + 3.4 * Math.cos(q * 6.283 - 1.57), -7 + 3.4 * Math.sin(q * 6.283 - 1.57)]
  ];
  const strokePath = (i, k) => { if (k <= 0) return ''; const n = Math.max(2, Math.round(42 * k)); return polyline(range(n + 1).map(j => STROKES[i](k * j / n))); };
  const pageText = (x0, x1, ys) => `<path d="${ys.map(y => `M${x0} ${y}H${x1}`).join('')}" stroke="#a9b0ba" stroke-width="1.2" stroke-linecap="round" ${VE}/>`;

  const CARDS = {
    notepad: {
      w: 30, h: 38, t: 1.6, edge: '#d8cbb2',
      front: `<rect x="-15" y="-19" width="30" height="38" rx="1.5" fill="#fdfbf6" ${OLv()}/>
        <path d="M-12.5 -11H12.5M-12.5 -5H12.5M-12.5 1H12.5M-12.5 7H12.5M-12.5 13H12.5" stroke="#a8c4e0" stroke-width="1" ${VE}/>
        <path d="M-10.5 -17V17" stroke="#e9a0a0" stroke-width="1" ${VE}/>
        ${ringsTop([-11, -5.5, 0, 5.5, 11], -19)}
        ${range(3).map(i => `<path data-k="l${i}" fill="none" stroke="#2b3a67" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${VE}/>`).join('')}`,
      back: `<rect x="-15" y="-19" width="30" height="38" rx="1.5" fill="#c9a77c" ${OLv()}/>${ringsTop([-11, -5.5, 0, 5.5, 11], -19)}`,
      update(q, st) { for (let i = 0; i < 3; i++) attr(q['l' + i], 'd', polyline(scribble(-9, 11, NOTE_ROWS[i], (st.lines || [])[i] || 0, i * 1.7))); }
    },
    clipboard: {
      w: 34, h: 44, t: 2.4, edge: '#8a5d31',
      front: `<rect x="-17" y="-22" width="34" height="44" rx="3" fill="#b5804a" ${OLv()}/>
        <rect x="-13" y="-17" width="26" height="36" fill="#fdfbf6" ${OLv(1.1)}/>
        <rect x="-6" y="-25" width="12" height="7" rx="2" fill="#c3cad3" ${OLv(1.4)}/>
        ${[-8, 2, 12].map((y, i) => `<rect x="-10.5" y="${y - 3}" width="5" height="5" fill="none" ${OLv(1.1)}/><path d="M-2 ${y - .5}H${i === 1 ? 8 : 10.5}" stroke="#9aa3ad" stroke-width="1.6" stroke-linecap="round" ${VE}/>
          <path data-k="c${i}" fill="none" stroke="#2c9d5b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${VE}/>`).join('')}`,
      back: `<rect x="-17" y="-22" width="34" height="44" rx="3" fill="#a87442" ${OLv()}/><rect x="-6" y="-25" width="12" height="7" rx="2" fill="#c3cad3" ${OLv(1.4)}/>`,
      update(q, st) {
        [-8, 2, 12].forEach((y, i) => {
          const k = clamp((st.c || [])[i] || 0), a = [-9.8, y - 1], b = [-7.8, y + 1.4], c = [-4.2, y - 4.6];
          attr(q['c' + i], 'd', k <= 0 ? '' : k < .4 ? polyline([a, mix2(a, b, k / .4)]) : polyline([a, b, mix2(b, c, (k - .4) / .6)]));
        });
      }
    },
    bookL: {
      w: 22, h: 30, t: 2.2, edge: '#efe6d2',
      front: `<rect x="-11" y="-15" width="22" height="30" fill="#fdfbf6" ${OLv(1.4)}/>${pageText(-7, 8, [-9, -5, -1, 3, 7, 11])}`,
      back: `<rect x="-11" y="-15" width="22" height="30" rx="1" fill="#b8323f" ${OLv()}/>`
    },
    bookR: {
      w: 22, h: 30, t: 2.2, edge: '#efe6d2',
      front: `<rect x="-11" y="-15" width="22" height="30" fill="#fdfbf6" ${OLv(1.4)}/>${pageText(-8, 7, [-9, -5, -1, 3, 7, 11])}`,
      back: `<rect x="-11" y="-15" width="22" height="30" rx="1" fill="#b8323f" ${OLv()}/>
        <path d="M-6 -9H6M-4 -5.5H4" stroke="#f0bf45" stroke-width="1.8" stroke-linecap="round" ${VE}/>${pawPrint(0, 4, 1.1, '#f0bf45')}`
    },
    bookP: {
      w: 22, h: 30, t: 0,
      front: `<rect x="-11" y="-15" width="22" height="30" fill="#f6f1e6" ${OLv(1.3)}/>${pageText(-8, 7, [-9, -5, -1, 3, 7])}`,
      back: `<rect x="-11" y="-15" width="22" height="30" fill="#f6f1e6" ${OLv(1.3)}/>${pageText(-7, 8, [-9, -5, -1, 3, 7])}`
    },
    laptopBase: {
      w: 46, h: 30, t: 2.6, edge: '#8e98a5',
      front: `<rect x="-23" y="-15" width="46" height="30" rx="3" fill="#c3cad3" ${OLv()}/>
        <rect x="-19" y="-12" width="38" height="14" rx="1.5" fill="#39414c" ${OLv(1)}/>
        <path d="${range(3).map(r => `M-17 ${-9.5 + r * 4.4}H17`).join('')}${range(7).map(c => `M${-12.5 + c * 4.6} -11.5V1.5`).join('')}" stroke="#5c6672" stroke-width="1" ${VE}/>
        <rect x="-7" y="5" width="14" height="8" rx="1.5" fill="#aeb6c0" ${OLv(1)}/>`,
      back: `<rect x="-23" y="-15" width="46" height="30" rx="3" fill="#9aa3ad" ${OLv()}/>`
    },
    laptopLid: {
      w: 46, h: 30, t: 1.6, edge: '#7d8794',
      front: `<rect x="-23" y="-15" width="46" height="30" rx="3" fill="#2a3340" ${OLv()}/>
        <rect data-k="scr" x="-20" y="-12" width="40" height="24" rx="1" fill="#7fe3f2"/>
        <path d="M-16 -7H2M-16 -3H8M-12 1H6M-16 5H0" stroke="#1d6f86" stroke-width="1.6" stroke-linecap="round" ${VE}/>`,
      back: `<rect x="-23" y="-15" width="46" height="30" rx="3" fill="#8e98a5" ${OLv()}/>
        <path d="M-19 -11.5H19" stroke="#a9b2bd" stroke-width="1.4" stroke-linecap="round" ${VE}/>${pawPrint(0, 1, 1.6, '#e9edf2')}`,
      update(q, st) { attr(q.scr, 'opacity', f(.35 + .65 * clamp(st.glow || 0))); }
    },
    canvas: {
      w: 34, h: 30, t: 2.2, edge: '#c9b48f',
      front: `<rect x="-17" y="-15" width="34" height="30" rx="1" fill="#fffdf7" ${OLv()}/>
        <path data-k="a0" fill="none" stroke="#3fa66b" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ${VE}/>
        <path data-k="a1" fill="none" stroke="#8c4c22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${VE}/>
        <path data-k="a2" fill="none" stroke="#f0bf45" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" ${VE}/>`,
      back: `<rect x="-17" y="-15" width="34" height="30" rx="1" fill="#e8dcc4" ${OLv()}/><path d="M-15 0H15M0 -13V13" stroke="#b07a45" stroke-width="2.4" ${VE}/>`,
      update(q, st) { for (let i = 0; i < 3; i++) attr(q['a' + i], 'd', strokePath(i, clamp((st.k || [])[i] || 0))); }
    },
    palette: {
      w: 42, h: 34, t: 1.4, edge: '#b6956c', shape: 'M13 -7C0 -18 -21 -11 -21 2C-21 14 -6 19 7 15C13 13 11 7 15 5C19 3 23 -2 13 -7Z',
      front: `<path d="M13 -7C0 -18 -21 -11 -21 2C-21 14 -6 19 7 15C13 13 11 7 15 5C19 3 23 -2 13 -7Z" fill="#e2c39a" ${OLv()}/>
        <circle cx="-12" cy="-2" r="3.2" fill="#e5483d"/><circle cx="-4" cy="-9" r="3" fill="#f0bf45"/><circle cx="5" cy="-10" r="2.8" fill="#2f6fb3"/>
        <circle cx="-13" cy="8" r="3" fill="#3fa66b"/><circle cx="-3" cy="11.5" r="2.8" fill="#8c5bd0"/>
        <ellipse cx="5" cy="3" rx="3" ry="2.2" fill="#d9b88d" ${OLv(1.2)}/>`,
      back: `<path d="M13 -7C0 -18 -21 -11 -21 2C-21 14 -6 19 7 15C13 13 11 7 15 5C19 3 23 -2 13 -7Z" fill="#c9a77c" ${OLv()}/><ellipse cx="5" cy="3" rx="3" ry="2.2" fill="#a8865c" ${OLv(1.2)}/>`
    }
  };
  /* tools held in a paw, drawn from the grip (wrist) to the tip */
  const TOOLS = {
    pencil: { len: 17, w: 4.6, cone: 4.2, body: '#f2c230', end: '#e88a9a', tipC: '#f0d9b5' },
    brush: { len: 20, w: 3.4, cone: 5.5, body: '#b9773e', end: '#c3cad3', tipC: '#3fa66b' }
  };

  /* Three short lines that fly off the end of the paw, along the forearm. */
  function pointerRays(q, s, dir) {
    const base = s.d != null ? s.d : dir, ph = ((s.t || 0) * 2.2) % 1;
    [-24, 0, 24].forEach((da, i) => {
      const a = (base + da) * D2R, r0 = 14 + 6 * ph, len = i === 1 ? 8 : 6;
      attr(q['l' + i], 'd', `M${f(Math.cos(a) * r0)} ${f(Math.sin(a) * r0)}L${f(Math.cos(a) * (r0 + len))} ${f(Math.sin(a) * (r0 + len))}`);
      attr(q['l' + i], 'opacity', f(1 - .7 * ph));
    });
  }


  /* ============================================================== DOG SVG */
  function dogMarkup(u) {
    const id = n => `scout${u}-${n}`, V = VIEW;
    const ear = `
      <path d="M76 45C63 47 55.5 62 55.5 80C55.5 97 58.5 110 65 114.5C71.5 118.5 77.5 112 78.5 104C79.5 90 79.5 68 78.5 52C78 48 77.5 46 76 45Z" fill="${C.ear}" ${OL}/>
      <path d="M70 58C64.5 70 63.5 89 66.5 106" fill="none" stroke="${C.earD}" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>
      <path d="M74 50C70 52 66 56 63.5 62" fill="none" stroke="${C.earL}" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>`;
    const eye = (S, cx) => {
      const cy = 66;
      return `<g data-p="eye${S}">
        <g data-p="open${S}">
          <g clip-path="url(#${id('clip' + S)})">
            <ellipse cx="${cx}" cy="${cy}" rx="7.4" ry="8.2" fill="#fffdf8"/>
            <g data-p="iris${S}">
              <circle cx="${cx}" cy="${cy}" r="5.9" fill="${C.iris}"/>
              <circle cx="${cx}" cy="${cy}" r="3.3" fill="${C.pupil}"/>
              <circle cx="${cx - 1.9}" cy="${cy - 2.3}" r="1.9" fill="#fff"/>
              <circle cx="${cx + 2.1}" cy="${cy + 1.9}" r=".9" fill="#fff" opacity=".75"/>
            </g>
            <rect data-p="lid${S}" x="${cx - 9}" y="${cy - 9.5}" width="18" height="0" fill="${C.tan}"/>
            <rect data-p="low${S}" x="${cx - 9}" y="${cy + 9}" width="18" height="0" fill="${C.tan}"/>
            <path data-p="lidLine${S}" fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round" opacity="0"/>
          </g>
          <ellipse data-p="rim${S}" cx="${cx}" cy="${cy}" rx="7.4" ry="8.2" fill="none" stroke="${LINE}" stroke-width="1.8"/>
        </g>
        <path data-p="shut${S}" d="M${cx - 7} ${cy + 1}Q${cx} ${cy + 5.5} ${cx + 7} ${cy + 1}" fill="none" stroke="${LINE}" stroke-width="2.2" stroke-linecap="round" opacity="0"/>
        <path data-p="joy${S}" d="M${cx - 6.5} ${cy + 3}Q${cx} ${cy - 5} ${cx + 6.5} ${cy + 3}" fill="none" stroke="${LINE}" stroke-width="2.4" stroke-linecap="round" opacity="0"/>
      </g>`;
    };
    const paw = (S, fill = C.white) => `<g data-p="paw${S}">
        <path d="M-10 1.6C-10 -3.6 -5.6 -4.6 0 -4.6C5.6 -4.6 10 -3.6 10 1.6C10 6.6 5.8 9 0 9C-5.8 9 -10 6.6 -10 1.6Z" fill="${fill}" ${OL} stroke-width="1.8"/>
        <path data-p="toes${S}" d="M-3.3 5.2V8.6M3.3 5.2V8.6" stroke="${LINE}" stroke-width="1.4" stroke-linecap="round"/>
        <g data-p="pads${S}" opacity="0" fill="${C.pad}"><ellipse cx="0" cy="0" rx="3.6" ry="2.7"/><circle cx="-4.6" cy="4" r="1.6"/><circle cx="0" cy="5.4" r="1.6"/><circle cx="4.6" cy="4" r="1.6"/></g>
      </g>`;
    const limb = (name, w, color) => `<path data-p="${name}O" fill="none" stroke="${LINE}" stroke-width="${w + 3.4}" stroke-linecap="round" stroke-linejoin="round"/><path data-p="${name}F" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const hindLeg = (S, far) => {
      const tanC = far ? '#b5672e' : C.tan, whiteC = far ? '#ebe2d4' : C.white;
      return `<g data-p="leg${S}">
            <path data-p="leg${S}Low" fill="${whiteC}" ${OL}/>
            <ellipse data-p="leg${S}Gas" fill="${tanC}" ${OL}/>
            <ellipse data-p="leg${S}Th" fill="${tanC}" ${OL}/>
            <path data-p="leg${S}Hi" fill="none" stroke="${C.tanL}" stroke-width="2.6" stroke-linecap="round" opacity="${far ? .3 : .75}"/>
            <ellipse data-p="leg${S}Paw" fill="${whiteC}" ${OL} stroke-width="1.8"/>
            <path data-p="leg${S}Toes" fill="none" stroke="${LINE}" stroke-width="1.3" stroke-linecap="round"/>
          </g>`;
    };
    const skull = 'M100 37C123 37 135 52 134 70C133 88 121 104 100 104C79 104 67 88 66 70C65 52 77 37 100 37Z';
    const tag = (x, y) => `<circle cx="${x}" cy="${y - 5.8}" r="2" fill="none" stroke="#9c874f" stroke-width="1.4"/>
          <circle cx="${x}" cy="${y}" r="5.4" fill="${C.tag}" ${OL} stroke-width="1.6"/>${pawPrint(x, y + .4, .62, C.tagD)}`;
    const FAR = '#efe7da';
    /* Three-quarter body: chest and front legs to the left, near haunch and tail to the right. */
    const torsoQ = 'M64 96C54 112 50 134 53 152C55 165 60 174 74 177L140 178C155 178 165 168 163 152C161 138 148 120 128 108C118 102 110 99 104 97Z';
    const bodyBack = `
          <g data-p="slotBack">${hindLeg('L', true)}</g>
          <path d="${torsoQ}" fill="${C.tan}"/>
          <path d="M102 97C112 99 120 103 128 108C148 120 161 138 163 152C163 156 162 160 160 163C152 152 140 142 128 136C114 129 104 120 100 108Z" fill="${C.black}"/>
          <path d="M64 96C56 110 52 130 54 150C56 163 61 172 70 176L96 176C99 158 98 136 92 120C87 108 78 100 64 96Z" fill="${C.white}"/>
          <path d="M60 148C61 160 65 168 71 173" fill="none" stroke="${C.whiteD}" stroke-width="3" stroke-linecap="round"/>
          <path d="${torsoQ}" fill="none" ${OL}/>
          <path d="M57 98Q82 114 111 95L112 101.5Q82 121 56 104.5Z" fill="${C.collar}" ${OL}/>
          <path d="M61 102.5Q82 116.5 108 99.5" fill="none" stroke="${C.collarL}" stroke-width="1.1" stroke-dasharray="2 2"/>
`;
    const legShape = (name, fill) => `<path data-p="${name}F" fill="${fill}"/><path data-p="${name}S" fill="none" stroke="${C.whiteD}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path data-p="${name}O" fill="none" ${OL}/>`;
    const armM = S => `<g data-p="arm${S}">${legShape('arm' + S, S === 'L' ? FAR : C.white)}${paw(S, S === 'L' ? FAR : C.white)}</g>`;
    const bodyFront = `<g data-p="slotFront">${hindLeg('R')}</g>
          <g data-p="handL"></g><g data-p="handR"></g><g data-p="heldB"></g>
          ${armM('L') + armM('R')}<g clip-path="url(#${id('tagC')})">${tag(80, 118.6)}</g>
          <g data-p="heldF"></g>
          <g data-p="handLF"></g><g data-p="handRF"></g>`;

    return `<defs>
        <linearGradient id="${id('crown')}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${C.tanD}"/><stop offset=".5" stop-color="${C.tan}"/><stop offset="1" stop-color="#cf8445"/>
        </linearGradient>
        <clipPath id="${id('clipL')}"><ellipse cx="88" cy="66" rx="7.4" ry="8.2"/></clipPath>
        <clipPath id="${id('clipR')}"><ellipse cx="112" cy="66" rx="7.4" ry="8.2"/></clipPath>
        <clipPath id="${id('mouth')}"><path data-p="mclip"/></clipPath>
        <!-- the tag hangs in front of the legs but behind the head (his chin, nose down): the head's shape is cut out of it -->
        <clipPath id="${id('tagC')}"><path data-p="tagClip" clip-rule="evenodd"/></clipPath>
        <clipPath id="${id('floor')}"><rect x="-100" y="-200" width="400" height="382"/></clipPath>
      </defs>
      <g data-p="mat">
        <ellipse cx="100" cy="183.6" rx="80" ry="15.5" fill="#24465b" ${OL}/>
        <ellipse cx="100" cy="181" rx="80" ry="15.5" fill="#35617d" ${OL}/>
        <ellipse cx="100" cy="181" rx="70.5" ry="12.4" fill="#ead9b4"/>
        <ellipse cx="100" cy="181" rx="61" ry="10" fill="#c5653f"/>
        <ellipse cx="100" cy="181" rx="51" ry="7.7" fill="#ead9b4"/>
        <ellipse cx="100" cy="181" rx="75.5" ry="14" fill="none" stroke="#ead9b4" stroke-width="1" stroke-dasharray="2.5 3" opacity=".75"/>
        <ellipse cx="100" cy="181" rx="56" ry="8.9" fill="none" stroke="#ead9b4" stroke-width=".9" stroke-dasharray="2 2.5" opacity=".6"/>
      </g>
      <ellipse data-p="shadow" cx="${V.shadow[0]}" cy="178.5" rx="${V.shadow[1]}" ry="6.5" fill="#2a1a0e" opacity=".25"/>
      <g data-p="back" transform="translate(${V.scene} 0)"></g>
      <g data-p="root">
        <g data-p="tail">
          <path data-p="tailO" fill="none" stroke="${LINE}" stroke-width="10.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path data-p="tailF" fill="none" stroke="${C.black}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
          <path data-p="tailT" fill="none" stroke="${C.white}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
        <g data-p="body">
          ${bodyBack}
          <g data-p="head">
            <path data-p="skull" d="${skull}" fill="url(#${id('crown')})"/>
            <g data-p="face">
              <path data-p="blaze" d="M97 40C98.2 38.6 101.8 38.6 103 40C103.6 52 104.6 62 108 75L92 75C95.4 62 96.4 52 97 40Z" fill="${C.white}"/>
              <path data-p="muzzle" d="M100 71C113 71 121 79 121.5 88C121.5 98 112 103.2 100 103.2C88 103.2 78.5 98 78.5 88C79 79 87 71 100 71Z" fill="${C.white}"/>
              <path d="M82 95C86 100 93 102.5 100 102.5C107 102.5 114 100 118 95" fill="none" stroke="${C.whiteD}" stroke-width="2.4" stroke-linecap="round"/>
              <g fill="#cdbfae"><circle cx="85.5" cy="88.5" r=".9"/><circle cx="83.5" cy="91.6" r=".9"/><circle cx="87.6" cy="92.6" r=".9"/><circle cx="114.5" cy="88.5" r=".9"/><circle cx="116.5" cy="91.6" r=".9"/><circle cx="112.4" cy="92.6" r=".9"/></g>
              <ellipse data-p="browL" cx="87" cy="55.5" rx="4.8" ry="2.7" fill="${C.pip}"/>
              <ellipse data-p="browR" cx="113" cy="55.5" rx="4.8" ry="2.7" fill="${C.pip}"/>
              ${eye('L', 88)}${eye('R', 112)}
              <path data-p="mopen" fill="${C.mouth}" ${OL} stroke-width="1.6" opacity="0"/>
              <ellipse data-p="tongueIn" cx="100" cy="98" rx="6" ry="3" fill="${C.tongue}" clip-path="url(#${id('mouth')})" opacity="0"/>
              <path data-p="mline" fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M100 87.4V93.4" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>
              <g data-p="nose">
                <path d="M91 79.5C91 75.5 109 75.5 109 79.5C109 84.5 104 87.6 100 87.6C96 87.6 91 84.5 91 79.5Z" fill="${C.nose}" ${OL} stroke-width="1.4"/>
                <ellipse cx="96.4" cy="78.6" rx="3.3" ry="1.4" fill="#fff" opacity=".5"/>
              </g>
            </g>
            <path data-p="skullO" d="${skull}" fill="none" ${OL}/>
            <g data-p="faceF"><g data-p="tongueOut" opacity="0"><path data-p="tongueP" fill="${C.tongue}" ${OL} stroke-width="1.5"/><path data-p="tongueL" fill="none" stroke="${C.tongueD}" stroke-width="1.2" stroke-linecap="round"/></g></g>
            <g data-p="earL">${ear}</g>
            <g transform="${MIR}"><g data-p="earR">${ear}</g></g>
            <g data-p="headL"></g>
          </g>
          ${bodyFront}
        </g>
      </g>
      <g data-p="front" transform="translate(${V.scene} 0)"></g>
      <g data-p="fx" transform="translate(${V.scene} 0)"></g>`;
  }

  /* --------------------------------------------------------- DOM helpers */
  function attr(el, k, v) {
    if (!el) return;
    const c = el.__sc || (el.__sc = {});
    const s = String(v);
    if (c[k] !== s) { c[k] = s; el.setAttribute(k, s); }
  }
  const pt = q => f(q[0]) + ' ' + f(q[1]);

  /** Two-bone IK. The elbow bends away from the body (side -1 = left, 1 = right), or down when down > .5. */
  function ik(S, T, side, down, L1 = UPPER, L2 = FORE) {
    let dx = T[0] - S[0], dy = T[1] - S[1], d = Math.hypot(dx, dy);
    const UPPER_ = L1, FORE_ = L2;
    const dmax = UPPER_ + FORE_ - .4, dmin = Math.abs(UPPER_ - FORE_) + .6;
    if (d > dmax) { dx *= dmax / d; dy *= dmax / d; d = dmax; }
    else if (d < dmin) { if (d < 1e-3) { dx = 0; dy = dmin; } else { dx *= dmin / d; dy *= dmin / d; } d = dmin; }
    const base = Math.atan2(dy, dx);
    const al = Math.acos(clamp((UPPER_ * UPPER_ + d * d - FORE_ * FORE_) / (2 * UPPER_ * d), -1, 1));
    const e1 = [S[0] + UPPER_ * Math.cos(base + al), S[1] + UPPER_ * Math.sin(base + al)];
    const e2 = [S[0] + UPPER_ * Math.cos(base - al), S[1] + UPPER_ * Math.sin(base - al)];
    const mx = S[0] + dx / 2, my = S[1] + dy / 2, pref = q => (q[0] - mx) * side + (q[1] - my) * .35;
    const El = pref(e1) >= pref(e2) ? e1 : e2;
    return { S, E: El, W: [S[0] + dx, S[1] + dy] };
  }

  /** A front leg as one tapered shape through shoulder S, elbow Ep and wrist W.
   *  The top blends into the chest (no outline there); the far side gets a soft shade line. */
  function legPaths(S, Ep, W, wS, wE, wW) {
    const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l, l]; };
    const [ux, uy, l1] = unit(S, Ep), [vx, vy, l2] = unit(Ep, W);
    let ex = -uy - vy, ey = ux + vx; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const side = (sg, k) => {
      const s0 = [S[0] - uy * wS / 2 * sg * k, S[1] + ux * wS / 2 * sg * k];
      const e0 = [Ep[0] + ex * wE / 2 * sg * k, Ep[1] + ey * wE / 2 * sg * k];
      const w0 = [W[0] - vy * wW / 2 * sg * k, W[1] + vx * wW / 2 * sg * k];
      const d1 = Math.hypot(e0[0] - s0[0], e0[1] - s0[1]) || 1, d2 = Math.hypot(w0[0] - e0[0], w0[1] - e0[1]) || 1;
      const r = Math.min(7, l1 * .4, l2 * .4);
      const a1 = [e0[0] + (s0[0] - e0[0]) * Math.min(.45, r / d1), e0[1] + (s0[1] - e0[1]) * Math.min(.45, r / d1)];
      const b1 = [e0[0] + (w0[0] - e0[0]) * Math.min(.45, r / d2), e0[1] + (w0[1] - e0[1]) * Math.min(.45, r / d2)];
      return { s0, a1, e0, b1, w0 };
    };
    const A = side(1, 1), B = side(-1, 1), h = wW / 2;
    const tip = [W[0] + vx * h, W[1] + vy * h];
    const cA = [A.w0[0] + vx * h, A.w0[1] + vy * h], cB = [B.w0[0] + vx * h, B.w0[1] + vy * h];
    const down = `L${pt(A.a1)}Q${pt(A.e0)} ${pt(A.b1)}L${pt(A.w0)}Q${pt(cA)} ${pt(tip)}Q${pt(cB)} ${pt(B.w0)}L${pt(B.b1)}Q${pt(B.e0)} ${pt(B.a1)}`;
    const top = .6;
    const sh = side(-1, .45);
    return {
      fill: `M${pt(A.s0)}${down}L${pt(B.s0)}Q${pt([S[0] - ux * wS * .75 + (B.s0[0] - S[0]), S[1] - uy * wS * .75 + (B.s0[1] - S[1])])} ${pt([S[0] - ux * wS * .6, S[1] - uy * wS * .6])}Q${pt([S[0] - ux * wS * .75 + (A.s0[0] - S[0]), S[1] - uy * wS * .75 + (A.s0[1] - S[1])])} ${pt(A.s0)}Z`,
      line: `M${pt(mix2(A.s0, A.a1, top))}${down}L${pt(mix2(B.s0, B.a1, top))}`,
      shade: `M${pt(mix2(sh.s0, sh.a1, .85))}L${pt(sh.a1)}Q${pt(sh.e0)} ${pt(sh.b1)}L${pt(mix2(sh.b1, sh.w0, .8))}`
    };
  }

  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: (a, fb) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-6 ? [a[0] / l, a[1] / l, a[2] / l] : (fb || [0, 1, 0]); },
    mix: (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
  };

  /** Handwriting along a line of a page: returns points from x0 to x0 + (x1 - x0) * prog. */
  function scribble(x0, x1, y, prog, seed) {
    const pts = [], n = Math.max(0, Math.round((x1 - x0) / .7 * clamp(prog)));
    for (let i = 0; i <= n; i++) { const x = x0 + i * .7; pts.push([x, scribbleY(x, y, seed)]); }
    return pts;
  }
  const scribbleY = (x, y, seed) => y + 1.3 * Math.sin(x * 2.1 + seed) * (Math.sin(x * .55 + seed * 2) > -.75 ? 1 : 0) - .5 * Math.sin(x * .8 + seed);


  /** Outline of an ellipsoid under the camera's projection: semi-axes already projected to 2D. */
  function ellipse2(c, axes) {
    let a = 0, b = 0, d = 0;
    for (const v of axes) { a += v[0] * v[0]; b += v[0] * v[1]; d += v[1] * v[1]; }
    const tr = a + d, det = a * d - b * b, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    return { cx: c[0], cy: c[1], rx: Math.sqrt(tr / 2 + disc), ry: Math.sqrt(Math.max(.25, tr / 2 - disc)), ang: .5 * Math.atan2(2 * b, a - d) / D2R };
  }
  function setEllipse(el, e) {
    attr(el, 'cx', f(e.cx)); attr(el, 'cy', f(e.cy)); attr(el, 'rx', f(e.rx)); attr(el, 'ry', f(e.ry));
    attr(el, 'transform', `rotate(${f(e.ang)} ${f(e.cx)} ${f(e.cy)})`);
  }

  /** Closed outline of a tube through pts with widths ws: rounded joints and rounded ends. */
  function tube(pts, ws) {
    const n = pts.length, dirs = [];
    for (let i = 0; i < n - 1; i++) { const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy) || 1; dirs.push([dx / l, dy / l, l]); }
    const side = sg => pts.map((q, i) => {
      const a = dirs[Math.max(0, i - 1)], b = dirs[Math.min(n - 2, i)];
      let nx = -(a[1] + b[1]), ny = a[0] + b[0]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      return [q[0] + nx * ws[i] / 2 * sg, q[1] + ny * ws[i] / 2 * sg];
    });
    const run = Sd => {
      let d = '';
      for (let i = 1; i < n - 1; i++) {
        const p0 = Sd[i - 1], p1 = Sd[i], p2 = Sd[i + 1];
        const r = Math.min(6, dirs[i - 1][2] * .4, dirs[i][2] * .4);
        const d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
        const a1 = [p1[0] + (p0[0] - p1[0]) * Math.min(.45, r / d1), p1[1] + (p0[1] - p1[1]) * Math.min(.45, r / d1)];
        const b1 = [p1[0] + (p2[0] - p1[0]) * Math.min(.45, r / d2), p1[1] + (p2[1] - p1[1]) * Math.min(.45, r / d2)];
        d += `L${pt(a1)}Q${pt(p1)} ${pt(b1)}`;
      }
      return d + `L${pt(Sd[n - 1])}`;
    };
    const cap = (from, to, c, dir, r) => `Q${pt([from[0] + dir[0] * r, from[1] + dir[1] * r])} ${pt([c[0] + dir[0] * r, c[1] + dir[1] * r])}Q${pt([to[0] + dir[0] * r, to[1] + dir[1] * r])} ${pt(to)}`;
    const A = side(1), B = side(-1).reverse(), de = dirs[n - 2], ds = dirs[0];
    return `M${pt(A[0])}${run(A)}${cap(A[n - 1], B[0], pts[n - 1], de, ws[n - 1] / 2)}${run(B)}${cap(B[n - 1], A[0], pts[0], [-ds[0], -ds[1]], ws[0] / 2)}Z`;
  }

  function tailPaths(ang, B) {
    const L = 54, a = ang * D2R;
    const T = [B[0] + Math.sin(a) * L, B[1] - Math.cos(a) * L];
    const M = [(B[0] + T[0]) / 2 + Math.cos(a) * 9, (B[1] + T[1]) / 2 + Math.sin(a) * 9];
    const pts = [];
    for (let i = 0; i <= 12; i++) { const u = i / 12, v = 1 - u; pts.push([v * v * B[0] + 2 * v * u * M[0] + u * u * T[0], v * v * B[1] + 2 * v * u * M[1] + u * u * T[1]]); }
    const d = (a0, a1) => 'M' + pts.slice(a0, a1 + 1).map(pt).join('L');
    return { all: d(0, 12), tip: d(8, 12) };
  }

  /* --------------------------------------------------------- the ticker */
  /* Each frame asks when the next is needed (_wait): now (an action, a blink, words), in SLOW_MS (the tail's sway at
     rest, a nap) or when his next blink or sway is due; meanwhile nothing runs, but a look at the time every CHECK_MS
     (idling follows the clock). Time asleep still counts on his clock (real), not in an action (dt). */
  const live = new Set(), SLOW_MS = 90, CHECK_MS = 1000;
  let raf = 0, nap = 0, last = 0, ticking = false;
  function frame(now) {
    raf = 0;
    const real = Math.max(0, (now - last) / 1000);
    last = now;
    ticking = true;
    try { live.forEach(a => a._tick(Math.min(.15, real), real)); } finally { ticking = false; }
    if (!live.size) return;
    let wait = Infinity;
    live.forEach(a => { wait = Math.min(wait, a._wait()); });
    if (wait <= 0) raf = requestAnimationFrame(frame);
    else nap = setTimeout(() => { nap = 0; raf = requestAnimationFrame(frame); }, Math.min(wait, CHECK_MS));
  }
  function wake(a) {
    if (ticking) { live.add(a); return; }   // the frame under way asks it when it needs the next
    if (nap) {   // asleep: the clocks catch up with the time slept, and the next frame comes now
      clearTimeout(nap); nap = 0;
      const now = performance.now();
      live.forEach(x => { x._clock += Math.max(0, now - last) / 1000; });
      last = now;
    } else if (!raf) last = performance.now();
    live.add(a);
    if (!raf) raf = requestAnimationFrame(frame);
  }

  const BLEND = .2;
  const EAR_IN = 2;   // the most an ear swings in over the face (degrees), however far an action turns it
  const SWAY = { dur: 3.2, deg: 7, hz: .45 };   // the tail's slow sway at rest, now and then
  let UID = 0;
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================== Scout */
  class Scout {
    /**
     * @param {object} [opts]
     * @param {'desktop'|'stage'|'still'} [opts.mode='desktop'] desktop: floating, draggable, idles on its own.
     *        stage: sits inline inside `parent`. still: inline and frozen until you play or seek.
     * @param {HTMLElement} [opts.parent=document.body]
     * @param {number} [opts.size=168] rendered width in px
     * @param {number} [opts.x] [opts.y] desktop position in px (defaults to bottom-right)
     * @param {boolean} [opts.idle=true] play idle actions when nothing else is queued, following the user (userActive) (desktop)
     * @param {string} [opts.label] what a screen reader says for him (desktop)
     * @param {function} [opts.onclick] () on a click that is not a drag, or Enter / Space (desktop)
     * @param {function} [opts.onmenu] (x, y) on a right-click, Shift+F10 or the menu key (desktop)
     * @param {function} [opts.onmoved] (x, y) when the user has dragged him somewhere (desktop)
     */
    constructor(opts = {}) {
      this.o = Object.assign({ mode: 'desktop', parent: null, size: 168, x: null, y: null, idle: true, balloon: true, label: 'Scout, the assistant' }, opts);
      const mode = this.o.mode;
      this.uid = ++UID;
      this.speed = 1;
      this.onframe = null; this.onend = null;
      this._q = []; this._running = false;
      this._cur = null; this._clock = 0; this._blend = 9; this._from = null; this._last = null;
      this._nextBlink = 1.2 + Math.random() * 2; this._blinkT0 = -9; this._nextSway = 6 + Math.random() * 10; this._swayT0 = -99; this._wagPh = 0;
      this._talking = false; this._hidden = mode === 'desktop';
      this._activeAt = 0; this._restAt = 0; this._idleR = Math.random(); this._recent = []; this._nx = null; this._props = {}; this._move = null;

      const el = this.el = document.createElement('div');
      el.className = 'scout-agent ' + (mode === 'desktop' ? 'is-desktop' : 'is-inline');
      el.style.setProperty('--scout-w', this.o.size + 'px');
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('viewBox', '-30 -30 260 235');
      this.svg.setAttribute('aria-hidden', 'true');
      this.svg.innerHTML = dogMarkup(this.uid);
      el.appendChild(this.svg);
      this.P = {};
      this.svg.querySelectorAll('[data-p]').forEach(n => { this.P[n.getAttribute('data-p')] = n; });
      if (this.o.balloon && mode !== 'still') {
        const b = this.balloon = document.createElement('div');
        b.className = 'scout-balloon';
        b.setAttribute('role', 'status');
        b.innerHTML = '<div class="scout-text"></div><div class="scout-choices" role="group" hidden></div>';
        this._bText = b.firstChild; this._bChoices = b.lastChild;
        b.addEventListener('click', e => {
          const bt = e.target.closest('.scout-choices button');
          if (bt) { if (this._bPick) this._bPick(+bt.dataset.i); return; }
          if (!this._bPick) this._closeBalloon();
        });
        b.addEventListener('keydown', e => { if (e.key === 'Escape') this._closeBalloon(); });
        el.appendChild(b);
      }
      (this.o.parent || document.body).appendChild(el);

      if (mode === 'desktop') {
        el.tabIndex = 0;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', this.o.label);
        const h = this.o.size * 235 / 260;
        this._pos = [this.o.x != null ? this.o.x : innerWidth - this.o.size - 20, this.o.y != null ? this.o.y : innerHeight - h - 16];
        this._place();
        el.classList.add('is-hidden');
        this._bindDesktop();
      }
      this._render(this._compute(0), 0);
      if (mode !== 'still') wake(this);
    }


    /* ---------- catalogue ---------- */
    static get actions() { return ORDER.slice(); }
    static get office() { return Object.assign({}, OFFICE); }
    static info(name) { const n = Scout.resolve(name); const d = A[n]; return d && { name: n, cat: d.cat, dur: d.dur, key: d.key, loop: !!d.loop, seg: d.seg ? d.seg.slice() : null, hides: !!d.hides, extra: !!d.extra, desc: d.desc, office: (d.office || []).slice() }; }
    static get extras() { return EXTRAS.slice(); }
    static get all() { return ORDER.concat(EXTRAS); }
    static resolve(name) { if (A[name]) return name; if (OFFICE[name]) return OFFICE[name]; return null; }
    animations() { return ORDER.slice(); }
    hasAnimation(name) { return !!Scout.resolve(name); }

    /* ---------- queued API (each call waits its turn) ---------- */
    /** Queue an action by Clippit name or Office constant. Resolves true when it completes.
     *  opts.interrupt: now, in place of everything. opts.next: as soon as the act under way ends, in place of any other
     *  waiting this way (a newer one takes its place, resolving it false): an idle gives way at once, a nap ends
     *  first with his waking up. */
    play(name, opts = {}) {
      if (opts.interrupt) { this.stop(); return this._playNow(name, opts); }
      if (opts.next) return this._playNext(name, opts);
      return this._enqueue(() => this._playNow(name, opts));
    }
    /** The user did something (a key, a click): idling starts over from small things, and a nap ends. */
    userActive() {
      this._activeAt = this._clock;
      const c = this._cur;
      if (c && c.idle && c.loop) this.finish();
      return this;
    }
    /** Pop in on the mat (no-op if already visible). */
    show(fast) {
      return this._enqueue(() => {
        if (!this._hidden) return Promise.resolve(true);
        if (fast) { this._unhide(); return Promise.resolve(true); }
        return this._playNow('Show');
      });
    }
    /** Duck into the mat and roll it away. */
    hide(fast) {
      return this._enqueue(() => {
        if (this._hidden) return Promise.resolve(true);
        if (fast) { this._setHidden(); return Promise.resolve(true); }
        return this._playNow('Hide');
      });
    }
    /** Show a speech balloon and move the mouth while the words type out.
     *  opts.choices: list of strings or {label, value}; the promise then resolves with the picked value (null if closed). */
    speak(text, opts = {}) { return this._enqueue(() => this._speakNow(String(text), opts)); }
    /** Speak with a list of choices under the text, the way the XP search assistant offered options. */
    ask(text, choices, opts = {}) { return this.speak(text, Object.assign({}, opts, { choices })); }
    /** Trot to a desktop position (px, top-left of the character box). */
    moveTo(x, y, ms = 900) { return this._enqueue(() => this._moveNow(x, y, ms)); }
    /** Point toward a page coordinate using the nearest Gesture action. */
    gestureAt(x, y) { return this.play(this._dirTo(x, y, 'Gesture')); }
    /** Look toward a page coordinate using the nearest Look action. */
    lookAt(x, y) { return this.play(this._dirTo(x, y, 'Look', true)); }
    /** Play a random action (excludes entrances, exits and the rest pose). */
    animate() { const pool = ORDER.concat(EXTRAS).filter(n => NOT_RANDOM.indexOf(n) < 0); return this.play(pool[Math.floor(Math.random() * pool.length)]); }
    /** Wait in the queue. */
    delay(ms) { return this._enqueue(() => new Promise(r => setTimeout(() => r(true), ms))); }
    /** Clear the queue, stop the current action and close the balloon. */
    stop() {
      this._q.length = 0;
      if (this._nx) { const nx = this._nx; this._nx = null; nx.res(false); }
      if (this._cur) this._endCurrent(false);
      this._closeBalloon();
      return this;
    }
    /** Close the speech balloon now. */
    closeBalloon() { this._closeBalloon(); return this; }
    /** Turn looping on or off for the action that is playing. */
    setLoop(on) { if (this._cur) this._cur.loop = !!on; return this; }
    /** Finish only the current action early. */
    stopCurrent() { if (this._cur) this._endCurrent(false); return this; }
    /** End a looping action gracefully: it plays its exit now (e.g. Snooze wakes up) and then resolves. */
    finish() {
      const c = this._cur; if (!c || !c.loop) return this;
      c.loop = false; c.stopAt = 0;
      const sg = c.def.seg;
      if (sg && c.t < sg[1]) { c.t = sg[1]; this._from = this._last; this._blend = 0; this._kick(); }
      return this;
    }

    /** Stop drawing and keep the frame on screen (the window is in the background), or carry on from it.
     *  Time stands still meanwhile: an action resumes where it was, queued calls wait their turn. */
    freeze(on) {
      this._frozen = !!on;
      if (this._frozen) live.delete(this); else this._kick();
      return this;
    }
    get frozen() { return !!this._frozen; }

    /* ---------- direct control (used by the viewer) ---------- */
    pause() { if (this._cur) this._cur.paused = true; return this; }
    resume() { if (this._cur) { this._cur.paused = false; this._kick(); } return this; }
    seek(t) { if (this._cur) { this._cur.t = clamp(t, 0, this._cur.def.dur); this._blend = 9; this._kick(); } return this; }
    get current() { const c = this._cur; return c ? { name: c.name, t: c.t, dur: c.def.dur, paused: !!c.paused, loop: !!c.loop, idle: !!c.idle } : null; }
    get hidden() { return this._hidden; }
    /** Render a single frame of an action (no auto-blinking), e.g. for thumbnails. */
    pose(name, t) {
      const n = Scout.resolve(name); if (!n) return this;
      if (this._cur) this._endCurrent(false);
      this._still = { name: n, t };
      this._blend = 9;
      this._render(this._compute(0), t);
      return this;
    }
    destroy() {
      this.stop(); live.delete(this);
      if (this._onResize) removeEventListener('resize', this._onResize);
      this.el.remove();
    }

    /* ---------- internals: queue ---------- */
    _enqueue(fn) {
      return new Promise(res => { this._q.push({ fn, res }); this._pump(); });
    }
    _pump() {
      if (this._running || !this._q.length) return;
      this._running = true;
      const { fn, res } = this._q.shift();
      Promise.resolve().then(fn).then(v => { res(v); }, () => res(false)).then(() => { this._running = false; this._restAt = this._clock; this._pump(); });
    }
    _playNext(name, opts) {
      if (this._nx) { const old = this._nx; this._nx = null; old.res(false); }
      const c = this._cur;
      if (!c || (c.idle && !(c.name === NAP && c.t >= c.def.seg[0]))) return this._playNow(name, opts);
      return new Promise(res => { this._nx = { name, opts, res }; if (c.idle) this.finish(); });
    }
    /* what waits for the act under way (play next), once it has ended; another started meanwhile: after that one */
    _runNext() {
      const nx = this._nx;
      if (!nx || this._cur) return;
      this._nx = null;
      this._playNow(nx.name, nx.opts).then(nx.res);
    }
    _playNow(name, opts = {}) {
      let n = Scout.resolve(name);
      if (!n) return Promise.resolve(false);
      if (name === 'msoAnimationIdle') n = pickIdle();
      const def = A[n];
      if (this._cur) this._endCurrent(false);
      if (this._hidden && n !== 'Show' && n !== 'Greeting' && this.o.mode === 'desktop') {
        return this._playNow('Show').then(() => this._playNow(n, opts));
      }
      if (n === 'Show' || n === 'Greeting' || this._hidden) this._unhide();
      this._still = null;
      this._from = this._last; this._blend = 0;
      return new Promise(res => {
        const c = this._cur = { name: n, def, t: clamp(opts.at || 0, 0, def.dur), loop: !!opts.loop, paused: !!opts.paused, idle: !!opts.idle, res };
        if (opts.duration > 0) { c.loop = true; c.stopAt = this._clock + opts.duration / 1000; }
        if (opts.until && typeof opts.until.then === 'function') { c.loop = true; opts.until.then(() => { if (this._cur === c) c.loop = false; }, () => { if (this._cur === c) c.loop = false; }); }
        this._kick();
      });
    }
    _endCurrent(done) {
      const c = this._cur; if (!c) return;
      this._cur = null; this._restAt = this._clock;
      this._from = this._last; this._blend = 0;
      if (done && c.def.hides) this._setHidden();
      if (this.onend) this.onend(c.name, done);
      c.res(done);
      this._kick();
      if (this._nx) Promise.resolve().then(() => this._runNext());
      if (this.o.mode === 'still' && !this._still) live.delete(this);
    }
    _kick() { if (!this._frozen) wake(this); }
    _unhide() { this._hidden = false; this.el.classList.remove('is-hidden'); this._drawnSteady = false; this._kick(); }
    _setHidden() { this._hidden = true; this.el.classList.add('is-hidden'); this._closeBalloon(); }

    /* ---------- internals: frame ---------- */
    _tick(dt, real = dt) {
      this._clock += real;
      this._blend += dt;
      /* the tail's wag runs on a phase of its own, so a change of pace (a blend between actions) can't make it jump */
      if (this._last) this._wagPh = (this._wagPh + Math.PI * 2 * this._last.wagHz * dt) % (Math.PI * 2);
      const c = this._cur;
      if (c && !c.paused) {
        c.t += dt * this.speed;
        if (c.stopAt && this._clock >= c.stopAt) { c.loop = false; c.stopAt = 0; }
        const sg = c.def.seg;
        if (sg && c.loop && c.t >= sg[1]) c.t = sg[0] + (c.t - sg[1]) % (sg[1] - sg[0]);
        else if (c.t >= c.def.dur) {
          if (c.loop) { c.t %= c.def.dur; }
          else { c.t = c.def.dur; const p = this._compute(c.t); this._render(p, this._clock); this._endCurrent(true); return; }
        }
      }
      if (this._move) this._stepMove();
      const clk = this._clock;
      if (clk >= this._nextBlink) { this._blinkT0 = clk; this._nextBlink = clk + (Math.random() < .1 ? .32 : 4 + Math.random() * 5); }
      if (clk >= this._nextSway) {
        if (!this._cur && !reduceMotion()) this._swayT0 = clk;
        this._nextSway = clk + SWAY.dur + 8 + Math.random() * 14;
      }
      if (this.o.mode === 'desktop' && this.o.idle && !this._cur && !this._running && !this._q.length && !this._nx && !this._hidden &&
          !this._dragging && !reduceMotion()) {
        const st = this._idleStage(), due = this._restAt + lerp(st[1][0], st[1][1], this._idleR);
        if (this._clock >= due) {
          const n = pickIdle(st[2], this._recent);
          this._recent = [n].concat(this._recent).slice(0, 2);
          this._idleR = Math.random();
          this.play(n, { idle: true, loop: n === NAP });
        }
      }
      /* nothing moves: the frame on screen stays as it is */
      const steady = this._steady();
      if (!steady || !this._drawnSteady) {
        const p = this._compute(c ? c.t : 0);
        this._render(p, this.o.mode === 'still' ? (c ? c.t : 0) : this._clock);
        this._drawnSteady = steady;
      }
      if (this.onframe && c) this.onframe(c.name, c.t, c.def.dur);
      if (this.o.mode === 'still' && !this._cur) live.delete(this);
      else if (this._hidden && !this._cur && !this._move && this._blend >= BLEND) live.delete(this);
    }
    _idleStage() {
      const quiet = this._clock - this._activeAt;
      let st = IDLE_STAGES[0];
      for (const it of IDLE_STAGES) if (quiet >= it[0]) st = it;
      return st;
    }
    /* at rest, nothing moving: no action, move, blend, words, balloon turning in, blink or sway */
    _steady() {
      const clk = this._clock;
      return !this._cur && !this._still && !this._move && !this._talking && this._blend >= BLEND && !(this._bOpen && clk - this._bT0 < .4) &&
        clk - this._blinkT0 >= .2 && clk - this._swayT0 >= SWAY.dur;
    }
    /* how soon he needs a frame (ms): 0 every frame; SLOW_MS for a nap or the tail's sway; at rest, his next blink or sway */
    _wait() {
      const c = this._cur, clk = this._clock;
      if (this._steady()) return (Math.min(this._nextBlink, this._nextSway) - clk) * 1000;
      if (this._move || this._talking || this._blend < BLEND || (this._bOpen && clk - this._bT0 < .4)) return 0;
      if (c) return c.idle && c.loop && c.name === NAP && c.t >= c.def.seg[0] ? SLOW_MS : 0;
      return clk - this._blinkT0 < .2 ? 0 : SLOW_MS;
    }
    _compute(t) {
      const p = rest();
      const c = this._cur;
      if (c) c.def.pose(c.t, p);
      else if (this._still) A[this._still.name].pose(this._still.t, p);
      else if (this._hidden) { p.opacity = 0; p.mat = 0; p.matO = 0; p.shadow = 0; }
      if (this._from && this._blend < BLEND) {
        const k = E.io(this._blend / BLEND), fr = this._from;
        for (const key of NUM_KEYS) p[key] = lerp(fr[key], p[key], k);
        p.wL = mix2(fr.wL, p.wL, k); p.wR = mix2(fr.wR, p.wR, k);
      }
      if (this.o.mode !== 'still') { this._auto(p); p.wagPh = this._wagPh; }
      this._last = p;
      return p;
    }
    _auto(p) {
      const clk = this._clock;
      const bt = clk - this._blinkT0, b = bt < .17 ? Math.sin(bt / .17 * Math.PI) * p.autoBlink : 0;
      if (b > p.lidL) p.lidL = b;
      if (b > p.lidR) p.lidR = b;
      if (this._talking) p.mouth = Math.max(p.mouth, .18 + .5 * Math.abs(Math.sin(clk * 12.5)) * (.65 + .35 * Math.sin(clk * 3.1)));
      /* in an action the tail keeps a little wag (faded in from rest); at rest it is still but for a sway now and then */
      if (this._cur) { if (!p.wag) { p.wag = 2.5 * (this._blend < BLEND ? E.io(this._blend / BLEND) : 1); p.wagHz = .35; } }
      else if (clk - this._swayT0 < SWAY.dur) { p.wag = SWAY.deg * win(clk - this._swayT0, 0, .7, SWAY.dur - .9, SWAY.dur); p.wagHz = SWAY.hz; }
      if (!this._cur) {
        if (this._bOpen) {
          const k = Math.min(1, (clk - this._bT0) / .35);
          p.lookY -= .55 * this._bUp * k; p.lookX += .45 * this._bDir * k;
          p.browL += .12 * k; p.browR += .12 * k; p.hr += 2 * this._bDir * k;
        }
      }
      if (this._move) {
        const m = this._move, hop = Math.abs(Math.sin(m.k * Math.PI * m.hops));
        p.y -= 9 * hop; p.sy *= 1 + .05 * hop; p.lean += 5 * m.dir;
        p.lookX += .9 * m.dir; p.turn += .4 * m.dir;
        p.earL += 22 * hop; p.earR += 22 * hop; p.wag = 18; p.wagHz = 5; p.smile += .5;
      }
    }

    _render(p, time) {
      const P = this.P, V = VIEW;
      attr(P.mat, 'transform', `translate(100 181) scale(${f(p.mat)} ${f(.35 + .65 * clamp(p.mat, 0, 2))}) translate(-100 -181)`);
      attr(P.mat, 'opacity', f(clamp(p.matO)));
      const ss = clamp(1 - Math.max(0, -p.y) / 80, .3, 1) * p.scale;
      attr(P.shadow, 'transform', `translate(${f(V.shadow[0] + p.x)} 178.5) scale(${f(ss * p.sx)} ${f(ss)}) translate(${-V.shadow[0]} -178.5)`);
      attr(P.shadow, 'opacity', f(.25 * clamp(p.opacity) * clamp(p.shadow) * clamp(p.matO)));
      attr(P.root, 'transform', `translate(${f(p.x)} ${f(p.y)}) translate(100 178) rotate(${f(p.rot)}) scale(${f(p.sx * p.scale)} ${f(p.sy * p.scale)}) translate(-100 -178)`);
      attr(P.root, 'opacity', f(clamp(p.opacity)));
      attr(P.body, 'transform', `rotate(${f(p.lean)} 100 176) translate(100 176) scale(1 ${f(1 + .014 * p.breath)}) translate(-100 -176)`);

      /* head */
      const hr = p.hr + V.hr, turn = clamp(p.turn + V.turn, -1.15, 1.15);
      attr(P.head, 'transform', `translate(${f(p.hx + V.head)} ${f(p.hy)}) rotate(${f(hr)} 100 104)`);
      const faceT = `translate(${f(turn * 7)} ${f(p.faceY)})`;
      attr(P.face, 'transform', faceT); attr(P.faceF, 'transform', faceT);
      /* the head's outline follows the face from rest: the chin when it looks down or turns, the crown when it looks up,
         so the face never slides under the outline */
      const rel = turn - V.turn, sk = skullPath(rel * 7, Math.max(0, p.faceY), Math.min(0, p.faceY));
      attr(P.skull, 'd', sk); attr(P.skullO, 'd', sk);
      if (P.tagClip) {
        const a = hr * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), ox = p.hx + V.head, oy = p.hy;
        const toBody = (x, y) => [100 + (x - 100) * c - (y - 104) * sn + ox, 104 + (x - 100) * sn + (y - 104) * c + oy];
        attr(P.tagClip, 'd', 'M-100 -100H300V300H-100Z' + skullPath(rel * 7, Math.max(0, p.faceY), Math.min(0, p.faceY), toBody));
      }
      const grav = -hr * .55 - p.rot * .5 - p.lean * .5;
      /* an ear keeps pace with the face turning its way, so it doesn't cover the eye */
      /* and hangs from the side of the head: it swings out freely, in hardly at all (not over the eye) */
      const earIn = (a) => (a >= 0 ? a : -EAR_IN * (1 - Math.exp(a / EAR_IN)));
      attr(P.earL, 'transform', `translate(${f(turn * 3.5 + Math.min(0, rel) * 3.5)} 0) rotate(${f(earIn(p.earL + grav))} 76 48)`);
      attr(P.earR, 'transform', `translate(${f(-turn * 3.5 - Math.max(0, rel) * 3.5)} 0) rotate(${f(earIn(p.earR - grav))} 76 48)`);
      attr(P.browL, 'transform', `translate(0 ${f(-p.browL * 5.4)}) rotate(${f(-p.browTL * 20)} 87 55.5)`);
      attr(P.browR, 'transform', `translate(0 ${f(-p.browR * 5.4)}) rotate(${f(p.browTR * 20)} 113 55.5)`);
      const lx = clamp(p.lookX, -1, 1), ly = clamp(p.lookY, -1, 1), happy = clamp(p.happy);
      const relaxed = .12 * (1 - clamp((p.eyeS - 1) * 6)) * (1 - clamp(Math.max(p.browL, p.browR))) * (1 - happy);
      ['L', 'R'].forEach(S => {
        const cx = S === 'L' ? 88 : 112, cy = 66;
        const lid = Math.max(relaxed, clamp(p['lid' + S])), low = clamp(p['low' + S]);
        attr(P['eye' + S], 'transform', `translate(${cx} ${cy}) scale(${f(p.eyeS)}) translate(${-cx} ${-cy})`);
        attr(P['iris' + S], 'transform', `translate(${f(lx * 2.6)} ${f(ly * 2.4)})`);
        attr(P['lid' + S], 'height', f(lid * 18.5));
        attr(P['low' + S], 'y', f(cy + 8.6 - low * 8)); attr(P['low' + S], 'height', f(low * 8 + .4));
        const yE = cy - 9.5 + lid * 18.5;
        attr(P['lidLine' + S], 'd', `M${cx - 9} ${f(yE)}Q${cx} ${f(yE + 2.4)} ${cx + 9} ${f(yE)}`);
        attr(P['lidLine' + S], 'opacity', lid > .06 && lid < .9 ? 1 : 0);
        const shut = E.io(seg(lid, .82, 1));
        attr(P['rim' + S], 'opacity', f(1 - shut));
        attr(P['open' + S], 'opacity', f(1 - happy));
        attr(P['shut' + S], 'opacity', f(shut * (1 - happy)));
        attr(P['joy' + S], 'opacity', f(happy));
      });
      attr(P.nose, 'transform', `translate(100 ${f(81 - .6 * p.sniff)}) scale(${f(1 + .09 * p.sniff)} ${f(1 - .06 * p.sniff)}) translate(-100 -81)`);

      /* mouth */
      const m = clamp(p.mouth), sm = p.smile, my = 93.5;
      const cY = my + .7 - sm * 3.4 + m * 1.2, dip = my + 1.7 + 2.2 * clamp(sm, 0, 1);
      attr(P.mline, 'd', `M90 ${f(cY)}Q95 ${f(dip)} 100 ${f(my)}Q105 ${f(dip)} 110 ${f(cY)}`);
      if (m > .02) {
        const b = my + 4 + m * 14;
        const d = `M91 ${f(my + .6)}C92 ${f(my + 2.4)} 108 ${f(my + 2.4)} 109 ${f(my + .6)}C108 ${f(b)} 92 ${f(b)} 91 ${f(my + .6)}Z`;
        attr(P.mopen, 'd', d); attr(P.mclip, 'd', d); attr(P.mopen, 'opacity', 1);
        attr(P.tongueIn, 'cy', f(my + 4 + m * 10)); attr(P.tongueIn, 'ry', f(2 + m * 3)); attr(P.tongueIn, 'opacity', 1);
      } else { attr(P.mopen, 'opacity', 0); attr(P.tongueIn, 'opacity', 0); }
      const T = clamp(p.tongue);
      if (T > .02) {
        const tx = p.tongueX, y1 = my + 1, y2 = my + 3 + T * 10;
        attr(P.tongueP, 'd', `M${f(95 + tx)} ${f(y1)}L${f(95 + tx)} ${f(y2)}Q${f(100 + tx)} ${f(y2 + T * 6)} ${f(105 + tx)} ${f(y2)}L${f(105 + tx)} ${f(y1)}Z`);
        attr(P.tongueL, 'd', `M${f(100 + tx)} ${f(y1 + 1.5)}L${f(100 + tx)} ${f(y2 - 1)}`);
        attr(P.tongueOut, 'opacity', 1);
      } else attr(P.tongueOut, 'opacity', 0);

      /* front legs, and whatever they hold */
      const map = (w, S) => {
        const base = S === 'R' ? mix2(V.d.R, V.d.L, clamp(p.wRL)) : V.d.L;
        const off = mix2(base, [V.scene, 0], clamp(p['abs' + S]));
        return [w[0] + off[0], w[1] + off[1]];
      };
      const arms = { L: ik(V.sh.L, map(p.wL, 'L'), -1) };
      let tR = map(p.wR, 'R');
      arms.R = ik(V.sh.R, tR, 1);
      const held = this._heldFrames(p, V, arms);
      ['L', 'R'].forEach(S => {
        const a = arms[S];
        const lp = legPaths(a.S, a.E, a.W, 17, 13, 10.5);
        attr(P['arm' + S + 'F'], 'd', lp.fill); attr(P['arm' + S + 'O'], 'd', lp.line); attr(P['arm' + S + 'S'], 'd', lp.shade);
        const dx = a.W[0] - a.E[0], dy = a.W[1] - a.E[1], len = Math.hypot(dx, dy) || 1;
        /* the carpus only folds one way: a lifted paw droops instead of bending back, unless the action opens it */
        const pads = clamp(p['pads' + S]);
        let ang = Math.atan2(dy, dx) / D2R - 90;
        const droop = clamp((-dy / len - .05) / .6) * (1 - pads);
        let diff = ((0 - ang) % 360 + 540) % 360 - 180;
        if (Math.abs(diff) > 170) diff = 180 * (S === 'L' ? -1 : 1);
        ang += diff * droop * .85;
        attr(P['paw' + S], 'transform', `translate(${pt(a.W)}) rotate(${f(ang)}) scale(${f(p['pawS' + S])})`);
        attr(P['pads' + S], 'opacity', f(pads)); attr(P['toes' + S], 'opacity', f(1 - pads));
        attr(P['hand' + S], 'transform', `translate(${pt(a.W)})`);
        if (P['hand' + S + 'F']) attr(P['hand' + S + 'F'], 'transform', `translate(${pt(a.W)})`);
      });
      this._drawHeld(held, V, p);

      /* hind legs: a 3D leg posed in its own plane, then projected with the camera.
         hip -> femur (down and forward) -> stifle -> tibia (down and back) -> hock -> metatarsus -> paw.
         Sitting folds every joint: hock on the floor behind, metatarsus flat, paw under the knee.
         When the body rises the paws stay planted and the heels lift; past full reach the legs hang. */
      const CAM = V.cam, HL = HIND3;
      const pv3 = v => [CAM.F[0] * v[0] + CAM.U[0] * v[1] + CAM.L[0] * v[2], CAM.F[1] * v[0] + CAM.U[1] * v[1] + CAM.L[1] * v[2]];
      const pr3 = v => { const q = pv3(v); return [CAM.O[0] + q[0], CAM.O[1] + q[1]]; };
      const bodyS = p.sy * p.scale;
      const floorDy = p.scale > .6 ? clamp((CAM.floor - p.y - 178) / (bodyS || 1) + 178 - CAM.floor, 0, 60) : 0;
      const earPt = loc => {
        const a = hr * D2R, x0 = loc[0] - 100, y0 = loc[1] - 104;
        return [100 + x0 * Math.cos(a) - y0 * Math.sin(a) + p.hx + V.head, 104 + x0 * Math.sin(a) + y0 * Math.cos(a) + p.hy];
      };
      for (const S of ['L', 'R']) {
        const G = V.hind3[S], el = P['leg' + S];
        if (!G || !el) continue;
        const side = G.side, hip = [0, HL.hipY];
        const free = G.ear && p.kR > 0 ? E.io(clamp(p.kR)) : 0;
        const lift = clamp(floorDy / HL.reach), air = clamp((floorDy - HL.reach) / 8) * (1 - free);
        let splay = lerp(lerp(G.splay, 5, E.out(lift)), 8, free), roll = (G.roll || 0) * free, stretch = 1 + .22 * free;
        /* ball of the foot (metatarsus meets paw), angle from it to the hock, and the paw's forward axis */
        let Q = [HL.ball, HL.metR - Math.min(floorDy, HL.reach)];
        let mA = lerp(HL.sitHock, HL.standHock, E.out(lift));
        let pawDir = [1, 0];
        const W3 = (fx, y, ca, sa, cb, sb) => {
          const dy = y - HL.hipY, z1 = side * fx * sa;
          return [fx * ca, HL.hipY + dy * cb - side * z1 * sb, G.lz + z1 * cb + side * dy * sb];
        };
        if (free > 0) {
          /* scratching: the paw goes to the ear; find that point in the leg's plane */
          const e = earPt(G.ear), Sx = e[0] + p.scrR * 1.4, Sy = e[1] + p.scrR * 4.5;
          let tx, ty;
          if (Math.abs(CAM.F[0]) > .2) {
            const ca = Math.cos(splay * D2R), sa = Math.sin(splay * D2R), cb = Math.cos(roll * D2R), sb = Math.sin(roll * D2R);
            const A = pv3([ca, -sa * sb, side * sa * cb]), B = pv3([0, cb, side * sb]), base = pr3(W3(0, 0, ca, sa, cb, sb));
            const det = A[0] * B[1] - A[1] * B[0], rx = Sx - base[0], ry = Sy - base[1];
            tx = (rx * B[1] - ry * B[0]) / det; ty = (A[0] * ry - A[1] * rx) / det;
          } else {
            tx = 16; ty = CAM.O[1] + CAM.F[1] * tx - Sy;
            roll = Math.asin(clamp(side * (Sx - CAM.O[0] - G.lz) / Math.max(20, ty - HL.hipY), 0, .55)) / D2R * free;
          }
          const up = [Math.cos(58 * D2R), Math.sin(58 * D2R)];
          pawDir = [lerp(1, up[0], free), lerp(0, up[1], free)];
          Q = mix2(Q, [tx - up[0] * 7, ty - up[1] * 7], free);
          mA = lerp(mA, 250, free);
        }
        const ca = Math.cos(splay * D2R), sa = Math.sin(splay * D2R), cb = Math.cos(roll * D2R), sb = Math.sin(roll * D2R);
        const P3 = (q) => pr3(W3(q[0], q[1], ca, sa, cb, sb));
        const D3 = (d) => { const z1 = side * d[0] * sa; return [d[0] * ca, d[1] * cb - side * z1 * sb, z1 * cb + side * d[1] * sb]; };
        const N3 = [-side * sa, -side * ca * sb, ca * cb];
        const FEM = HL.femur * stretch, TIB = HL.tibia * stretch, MET = HL.meta * stretch;
        if (air > 0) mA = lerp(mA, HL.hangHock, air);
        let Hk = [Q[0] + Math.cos(mA * D2R) * MET, Q[1] + Math.sin(mA * D2R) * MET];
        const g = ik(hip, Hk, 1, 0, FEM, TIB);
        if (Math.hypot(g.W[0] - Hk[0], g.W[1] - Hk[1]) > .3) { Hk = g.W; Q = [Hk[0] - Math.cos(mA * D2R) * MET, Hk[1] - Math.sin(mA * D2R) * MET]; }
        if (air > 0) { const dn = [-Math.cos(mA * D2R), -Math.sin(mA * D2R)]; pawDir = mix2(pawDir, mix2([1, 0], dn, .7), air); }
        const pl = Math.hypot(pawDir[0], pawDir[1]) || 1; pawDir = [pawDir[0] / pl, pawDir[1] / pl];
        const K = g.E;
        /* lower leg: knee -> hock -> ball, white stocking */
        attr(P['leg' + S + 'Low'], 'd', tube([P3(K), P3(Hk), P3(Q)], [HL.wK, HL.wH, HL.wM]));
        /* gaskin: the muscle over the top of the tibia */
        const tb = [Hk[0] - K[0], Hk[1] - K[1]], tl = Math.hypot(tb[0], tb[1]) || 1, tu = [tb[0] / tl, tb[1] / tl];
        setEllipse(P['leg' + S + 'Gas'], ellipse2(P3([K[0] + tb[0] * .34, K[1] + tb[1] * .34]),
          [pv3(D3(tu)).map(v => v * tl * .34), pv3(N3).map(v => v * 6.5), pv3(D3([-tu[1], tu[0]])).map(v => v * HL.gas)]));
        /* thigh: the round haunch around the femur */
        const fm = [K[0] - hip[0], K[1] - hip[1]], fl = Math.hypot(fm[0], fm[1]) || 1, fu = [fm[0] / fl, fm[1] / fl], fp = [-fu[1], fu[0]];
        const tc = [hip[0] + fm[0] * .36 + fp[0] * 3, hip[1] + fm[1] * .36 + fp[1] * 3];
        const th = ellipse2(P3(tc), [pv3(D3(fu)).map(v => v * (fl * .5 + HL.thA)), pv3(N3).map(v => v * HL.thW), pv3(D3(fp)).map(v => v * HL.thS)]);
        setEllipse(P['leg' + S + 'Th'], th);
        {
          const ar = th.ang * D2R, pt2 = t => [th.cx + Math.cos(ar) * th.rx * .74 * Math.cos(t) - Math.sin(ar) * th.ry * .74 * Math.sin(t),
            th.cy + Math.sin(ar) * th.rx * .74 * Math.cos(t) + Math.cos(ar) * th.ry * .74 * Math.sin(t)];
          let best = 0, bv = 1e9;
          for (let i = 0; i < 24; i++) { const t = i / 24 * Math.PI * 2, q = pt2(t), v = q[1] + .45 * q[0] * -side; if (v < bv) { bv = v; best = t; } }
          attr(P['leg' + S + 'Hi'], 'd', 'M' + [-.42, -.21, 0, .21, .42].map(o => pt(pt2(best + o))).join('L'));
        }
        /* paw: a flattened ellipsoid, toes forward */
        const pc = [Q[0] + pawDir[0] * 7.5, Q[1] + pawDir[1] * 7.5], pw = [-pawDir[1], pawDir[0]];
        const pu = D3(pawDir), pn = N3, pwv = D3(pw), c3 = W3(pc[0], pc[1], ca, sa, cb, sb);
        setEllipse(P['leg' + S + 'Paw'], ellipse2(pr3(c3), [pv3(pu).map(v => v * 10.6), pv3(pn).map(v => v * 8.4), pv3(pwv).map(v => v * 4.8)]));
        attr(P['leg' + S + 'Toes'], 'd', [-1, 1].map(k => {
          const a3 = [0, 1, 2].map(i => c3[i] + pu[i] * 8 + pn[i] * k * 2.7 + pwv[i] * 2.2), b3 = [0, 1, 2].map(i => c3[i] + pu[i] * 8.9 + pn[i] * k * 2.7 - pwv[i] * .8);
          return `M${pt(pr3(a3))}L${pt(pr3(b3))}`;
        }).join(''));
        const want = G.slot === 'front' || (G.ear && p.kR > .2) ? P.slotFront : P.slotBack;
        if (el.parentNode !== want) want.appendChild(el);
      }

      /* tail */
      const tp = tailPaths(p.tail + V.tailAdd + p.wag * Math.sin(p.wagPh != null ? p.wagPh : Math.PI * 2 * p.wagHz * time), V.tail);
      attr(P.tailO, 'd', tp.all); attr(P.tailF, 'd', tp.all); attr(P.tailT, 'd', tp.tip);

      /* props */
      const fa = a => Math.atan2(a.W[1] - a.E[1], a.W[0] - a.E[0]) / D2R;
      const ctx = { time, wL: arms.L.W, wR: arms.R.W, dirL: fa(arms.L), dirR: fa(arms.R) };
      const used = p.props;
      for (const name in this._props) if (!used[name]) this._props[name].wrap.style.display = 'none';
      for (const name in used) {
        const def = PROPS[name]; if (!def) continue;
        const s = used[name];
        const o = s.o == null ? 1 : clamp(s.o);
        let inst = this._props[name];
        if (o <= .001) { if (inst) inst.wrap.style.display = 'none'; continue; }
        if (!inst) inst = this._buildProp(name, def);
        inst.wrap.style.display = '';
        attr(inst.wrap, 'opacity', f(o));
        if (def.clipToFloor) attr(inst.wrap, 'clip-path', s.clip ? `url(#scout${this.uid}-floor)` : 'none');
        const x = s.x != null ? s.x : def.at[0], y = s.y != null ? s.y : def.at[1], pv = def.pivot || [0, 0];
        attr(inst.g, 'transform', `translate(${f(x)} ${f(y)}) translate(${pv[0]} ${pv[1]}) rotate(${f(s.r || 0)}) scale(${f(s.s == null ? 1 : Math.max(.001, s.s))}) translate(${-pv[0]} ${-pv[1]})`);
        if (def.update) def.update(inst.q, s, ctx, inst.g);
      }
    }
    /* ---------- items held in the paws ----------
       Each is a flat plane with an orientation in the scene (turned toward the dog, or facing him),
       projected with the camera, so it reads as turned. Its position comes from
       the paws on screen. */
    _heldFrames(p, V, arms) {
      const out = {}, h = p.held;
      if (!h) return out;
      const CAM = V.cam, D = CAM.D;
      const P2 = v => [CAM.F[0] * v[0] + CAM.U[0] * v[1] + CAM.L[0] * v[2], CAM.F[1] * v[0] + CAM.U[1] * v[1] + CAM.L[1] * v[2]];
      const frame = n => {
        let up = v3.sub([0, 1, 0], v3.mul(n, n[1]));
        up = v3.len(up) < .2 ? [1, 0, 0] : v3.norm(up);
        return { n, up, wd: v3.norm(v3.cross(n, up)) };
      };
      const make = (name, C2, fr, s, st) => {
        const pw = P2(fr.wd), pu = P2(fr.up), pn = P2(fr.n);
        out[name] = Object.assign({ C2, s, st, pw, pu, pn, layer: h.layer || 'F' }, fr, {
          pt: (u, v, lift = 0) => [C2[0] + (pw[0] * u - pu[0] * v + pn[0] * lift) * s, C2[1] + (pw[1] * u - pu[1] * v + pn[1] * lift) * s]
        });
      };
      for (const name in h.items) {
        const st = h.items[name], s = st.s == null ? 1 : st.s;
        if (s < .02) continue;
        /* orientation: turned `yaw` degrees from facing the viewer toward the dog, top tipped back `tilt` */
        let n;
        if (st.facing === 'dog') { const a = (st.tilt || 35) * D2R; n = [-Math.cos(a), Math.sin(a), 0]; }
        else {
          const yaw = st.yaw, base = Math.atan2(D[2], D[0]) + (yaw == null ? 45 : yaw) * D2R, a = (st.tilt || 0) * D2R;
          n = v3.norm([Math.cos(base) * Math.cos(a), Math.sin(a), Math.sin(base) * Math.cos(a)]);
        }
        const fr = frame(n), pw = P2(fr.wd), pu = P2(fr.up);
        let C2;
        if (st.pos) {
          const ps = st.pos, tt = st.t || 0;
          C2 = [ps[0] + .8 * Math.sin(tt * 1.7), ps[1] + 1.8 * Math.sin(tt * 2.3)];
        } else if (st.anchor === 'L' || st.anchor === 'R') {
          const w = arms[st.anchor].W, at = st.at || [0, 0];
          C2 = [w[0] - (pw[0] * at[0] - pu[0] * at[1]) * s, w[1] - (pw[1] * at[0] - pu[1] * at[1]) * s];
        } else {
          const m = mix2(arms.L.W, arms.R.W, .5), lift = st.lift || 0;
          C2 = [m[0] + pu[0] * lift * s, m[1] + pu[1] * lift * s];
        }
        if (name === 'book') {
          /* an open book facing the dog: two covers in a shallow V around the spine */
          const o = 17 * D2R, cs = Math.cos(o), sn = Math.sin(o);
          const dL = v3.norm(v3.add(v3.mul(fr.wd, -cs), v3.mul(fr.n, sn))), dR = v3.norm(v3.add(v3.mul(fr.wd, cs), v3.mul(fr.n, sn)));
          const at = d => { const q = P2(d); return [C2[0] + q[0] * 11 * s, C2[1] + q[1] * 11 * s]; };
          make('bookL', at(dL), { n: v3.cross(dL, fr.up), up: fr.up, wd: v3.mul(dL, -1) }, s, st);
          make('bookR', at(dR), { n: v3.cross(fr.up, dR), up: fr.up, wd: dR }, s, st);
          if (st.flip >= 0) {
            const th = lerp(17, 163, E.io(clamp(st.flip))) * D2R, dP = v3.norm(v3.add(v3.mul(fr.wd, Math.cos(th)), v3.mul(fr.n, Math.sin(th))));
            make('bookP', at(dP), { n: v3.cross(fr.up, dP), up: fr.up, wd: dP }, s, st);
          }
          out.bookSpine = { C2, s, pu, pn: P2(fr.n), spine: true };
        } else make(name, C2, fr, s, st);
      }
      return out;
    }

    _drawHeld(held, V, p) {
      const D = V.cam.D, used = { F: [], B: [] };
      this._held = this._held || {};
      const NS = 'http://www.w3.org/2000/svg';
      for (const name in held) {
        const H = held[name], layer = H.layer === 'B' ? 'B' : 'F';
        if (H.spine) {
          let e = this._held.bookSpine;
          if (!e) {
            const g = document.createElementNS(NS, 'g');
            g.innerHTML = `<path data-k="a" fill="none" stroke="${LINE}" stroke-width="4.6" stroke-linecap="round"/><path data-k="b" fill="none" stroke="#8e2430" stroke-width="2.6" stroke-linecap="round"/>`;
            e = this._held.bookSpine = { g, a: g.firstChild, b: g.lastChild };
          }
          const h = 15 * H.s, c = [H.C2[0] - H.pn[0] * 1.2 * H.s, H.C2[1] - H.pn[1] * 1.2 * H.s];
          const d = `M${pt([c[0] - H.pu[0] * h, c[1] - H.pu[1] * h])}L${pt([c[0] + H.pu[0] * h, c[1] + H.pu[1] * h])}`;
          attr(e.a, 'd', d); attr(e.b, 'd', d); e.g.style.display = '';
          used[layer].push([1e3, e.g, 'bookSpine']);
          continue;
        }
        const def = CARDS[name]; if (!def) continue;
        let c = this._held[name];
        if (!c) {
          const g = document.createElementNS(NS, 'g'), slab = document.createElementNS(NS, 'path'), fr = document.createElementNS(NS, 'g'), bk = document.createElementNS(NS, 'g');
          slab.setAttribute('fill', def.edge || '#ccc'); slab.setAttribute('stroke', LINE); slab.setAttribute('stroke-width', '1.4'); slab.setAttribute('stroke-linejoin', 'round');
          fr.innerHTML = def.front; bk.innerHTML = def.back;
          g.appendChild(slab); g.appendChild(bk); g.appendChild(fr);
          const q = {}; g.querySelectorAll('[data-k]').forEach(n => { q[n.getAttribute('data-k')] = n; });
          c = this._held[name] = { g, slab, fr, bk, q, def };
        }
        const s = H.s, vis = v3.dot(H.n, D) >= 0;
        const m = sx => `matrix(${f(H.pw[0] * s * sx)} ${f(H.pw[1] * s * sx)} ${f(-H.pu[0] * s)} ${f(-H.pu[1] * s)} ${f(H.C2[0])} ${f(H.C2[1])})`;
        attr(c.fr, 'transform', m(1)); attr(c.bk, 'transform', m(-1));
        c.fr.style.display = vis ? '' : 'none'; c.bk.style.display = vis ? 'none' : '';
        if (def.t) {
          const t = (vis ? -1 : 1) * def.t, hw = def.w / 2, hh = def.h / 2;
          attr(c.slab, 'd', 'M' + [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => pt(H.pt(x, y, t))).join('L') + 'Z');
        } else attr(c.slab, 'd', '');
        if (def.update) def.update(c.q, H.st || {}, vis);
        c.g.style.display = '';
        used[layer].push([(H.C2[0] * D[2] - H.C2[1] * .01), c.g, name]);
        if (H.st && H.st.float && name !== 'bookL' && name !== 'bookP') {
          /* a soft glow behind anything Scout is holding up with his mind */
          let a = this._held['aura_' + name];
          if (!a) {
            const g = document.createElementNS(NS, 'g'); g.innerHTML = auraSVG(1, 1);
            const q = {}; g.querySelectorAll('[data-k]').forEach(n => { q[n.getAttribute('data-k')] = n; });
            a = this._held['aura_' + name] = { g, q };
          }
          const big = name === 'bookR' ? 2.1 : 1, rx = Math.hypot(H.pw[0], H.pw[1]) * def.w * H.s * .66 * big, ry = Math.hypot(H.pu[0], H.pu[1]) * def.h * H.s * .62;
          const cx = name === 'bookR' ? (held.bookSpine ? held.bookSpine.C2 : H.C2) : H.C2;
          attr(a.g, 'transform', `translate(${pt(cx)})`);
          a.g.firstChild.setAttribute('rx', f(rx)); a.g.firstChild.setAttribute('ry', f(ry));
          a.g.children[1].setAttribute('rx', f(rx * .68)); a.g.children[1].setAttribute('ry', f(ry * .68));
          auraUpdate(a.q, H.st.t || 0, rx, ry);
          a.g.style.display = '';
          used[layer].push([-1e4, a.g, 'aura_' + name]);
        }
      }
      /* a pencil that writes by itself */
      if (p && p.write && held[p.write.on]) {
        const H = held[p.write.on], w = p.write, tip = H.pt(w.uv[0], w.uv[1], w.lift || 0), ps = w.s == null ? 1 : w.s;
        let e = this._held.floatPencil;
        if (!e) {
          const g = document.createElementNS(NS, 'g');
          g.innerHTML = PROPS.pencil.svg;
          e = this._held.floatPencil = { g };
        }
        attr(e.g, 'transform', `translate(${pt(tip)}) rotate(${f(w.r)}) scale(${f(Math.max(.001, ps))}) translate(0 15)`);
        e.g.style.display = ps > .02 ? '' : 'none';
        used.F.push([1e4, e.g, 'floatPencil']);
      }
      for (const L of ['F', 'B']) {
        const box = this.P['held' + L], list = used[L];
        list.sort((a, b) => a[0] - b[0]);
        list.forEach(([, g], i) => { if (box.children[i] !== g) box.insertBefore(g, box.children[i] || null); });
      }
      const live = new Set(used.F.concat(used.B).map(u => u[2]));
      for (const k in this._held) if (!live.has(k)) this._held[k].g.style.display = 'none';
    }

    _buildProp(name, def) {
      const NSs = 'http://www.w3.org/2000/svg';
      const wrap = document.createElementNS(NSs, 'g'), g = document.createElementNS(NSs, 'g');
      wrap.setAttribute('data-prop', name);
      g.innerHTML = def.svg;
      wrap.appendChild(g);
      const layer = def.layer === 'head' ? this.P.headL : this.P[def.layer];
      layer.appendChild(wrap);
      const q = {};
      g.querySelectorAll('[data-k]').forEach(n => { q[n.getAttribute('data-k')] = n; });
      if (def.build) def.build(g);
      return (this._props[name] = { wrap, g, q });
    }

    /* ---------- internals: speech ---------- */
    _speakNow(text, opts) {
      if (!this.balloon) return Promise.resolve(false);
      if (this._hidden && this.o.mode === 'desktop') return this._playNow('Show').then(() => this._speakNow(text, opts));
      const b = this.balloon, tx = this._bText, ch = this._bChoices;
      clearTimeout(this._bTimer); clearInterval(this._bType);
      const choices = (opts.choices || []).map(c => typeof c === 'string' ? { label: c, value: c } : { label: String(c.label), value: c.value !== undefined ? c.value : c.label });
      ch.innerHTML = '';
      choices.forEach((c, i) => { const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = c.label; bt.dataset.i = i; ch.appendChild(bt); });
      b.classList.toggle('has-choices', choices.length > 0);
      this._placeBalloon(text, choices.length > 0);
      tx.textContent = ''; ch.hidden = true;
      this._kick();
      b.classList.add('is-on'); this._bOpen = true; this._bT0 = this._clock;
      const words = text.split(/(\s+)/);
      let i = 0;
      this._talking = true;
      return new Promise(res => {
        this._bDone = val => {
          clearTimeout(this._bTimer); clearInterval(this._bType);
          this._talking = false; this._bOpen = false; this._bDone = null; this._bPick = null; this._drawnSteady = false; this._kick();
          b.classList.remove('is-on'); res(val);
        };
        this._bPick = choices.length ? (n => { if (this._bDone) this._bDone(choices[n].value); }) : null;
        const finish = () => {
          clearInterval(this._bType); this._talking = false; tx.textContent = text;
          if (choices.length) { ch.hidden = false; return; }
          if (opts.hold) return;
          this._bTimer = setTimeout(() => this._bDone && this._bDone(true), opts.timeout || 1800 + text.length * 38);
        };
        if (reduceMotion()) { finish(); return; }
        this._bType = setInterval(() => {
          tx.textContent += words[i++] || '';
          if (i >= words.length) finish();
        }, 70);
      });
    }
    _closeBalloon() { if (this._bDone) this._bDone(this._bPick ? null : false); }
    _placeBalloon(text, withChoices) {
      const b = this.balloon, W = this.el.offsetWidth || this.o.size, H = this.el.offsetHeight || W * 235 / 260, sc = W / 260;
      const V = VIEW;
      const headX = (130 + V.head) * sc, headTop = 64 * sc;
      this._bText.textContent = text; this._bChoices.hidden = !withChoices;
      b.style.width = ''; b.style.left = '0px'; b.style.top = '0px'; b.style.bottom = 'auto'; b.classList.remove('is-below');
      const bw = Math.ceil(b.getBoundingClientRect().width), bh = b.offsetHeight;
      b.style.width = bw + 'px';
      let left = headX - bw * .62;
      if (this.o.mode === 'desktop') {
        const absL = this._pos[0] + left;
        if (absL < 10) left += 10 - absL;
        if (this._pos[0] + left + bw > innerWidth - 10) left -= this._pos[0] + left + bw - (innerWidth - 10);
      } else {
        const host = this.el.getBoundingClientRect(), vw = document.documentElement.clientWidth;
        if (host.left + left < 8) left = 8 - host.left;
        if (host.left + left + bw > vw - 8) left = vw - 8 - host.left - bw;
      }
      const top = headTop - bh - 12;
      const absTop = this.o.mode === 'desktop' ? this._pos[1] + top : this.el.getBoundingClientRect().top + top;
      const above = absTop >= 8;
      b.style.left = f(left) + 'px';
      if (above) { b.style.top = 'auto'; b.style.bottom = f(H - headTop + 12) + 'px'; }
      else { b.style.top = f(H - 6) + 'px'; b.style.bottom = 'auto'; b.classList.add('is-below'); }
      b.style.setProperty('--scout-tip', f(clamp(headX - left, 16, bw - 16)) + 'px');
      this._bDir = clamp((left + bw / 2 - headX) / 90, -1, 1);
      this._bUp = above ? 1 : -1;
    }

    /* ---------- internals: desktop ---------- */
    _place() { this.el.style.transform = `translate(${Math.round(this._pos[0])}px, ${Math.round(this._pos[1])}px)`; }
    _moveNow(x, y, ms) {
      if (this.o.mode !== 'desktop') return Promise.resolve(false);
      return new Promise(res => {
        const from = this._pos.slice(), dist = Math.hypot(x - from[0], y - from[1]);
        this._kick();
        this._move = { from, to: [x, y], t0: this._clock, dur: Math.max(.3, ms / 1000), k: 0, hops: Math.max(1, Math.round(dist / 70)), dir: Math.sign(x - from[0]) || 0, res };
        this._kick();
      });
    }
    _stepMove() {
      const m = this._move;
      m.k = clamp((this._clock - m.t0) / m.dur);
      const e = E.io(m.k);
      this._pos = [lerp(m.from[0], m.to[0], e), lerp(m.from[1], m.to[1], e)];
      this._place();
      if (m.k >= 1) { this._move = null; m.res(true); }
    }
    _dirTo(x, y, kind, diag) {
      const r = this.el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * .4;
      const a = Math.atan2(y - cy, x - cx) / D2R;
      if (diag) {
        const dirs = ['Right', 'DownRight', 'Down', 'DownLeft', 'Left', 'UpLeft', 'Up', 'UpRight'];
        return kind + dirs[(Math.round(((a + 360) % 360) / 45)) % 8];
      }
      if (a >= -45 && a < 45) return kind + 'Right';
      if (a >= 45 && a < 135) return kind + 'Down';
      if (a >= -135 && a < -45) return kind + 'Up';
      return kind + 'Left';
    }
    _bindDesktop() {
      const el = this.el, o = this.o;
      let start = null;
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0 || this._hidden || e.target.closest('.scout-balloon')) return;
        start = { x: e.clientX, y: e.clientY, pos: this._pos.slice(), moved: false };
        el.setPointerCapture(e.pointerId);
      });
      /* a click leaves the keyboard focus where it was (the document) */
      el.addEventListener('mousedown', e => { e.preventDefault(); });
      el.addEventListener('pointermove', e => {
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 4) return;
        start.moved = true; this._dragging = true; el.classList.add('is-dragging');
        this.placeAt(start.pos[0] + dx, start.pos[1] + dy);
      });
      const end = e => {
        if (!start) return;
        const s = start; start = null;
        this._dragging = false; el.classList.remove('is-dragging'); this._restAt = this._clock;
        if (e.type !== 'pointerup') return;
        if (s.moved) { if (o.onmoved) o.onmoved(this._pos[0], this._pos[1]); }
        else if (o.onclick) o.onclick();
      };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
      el.addEventListener('keydown', e => {
        if (e.target.closest('.scout-balloon')) return;
        if ((e.key === 'Enter' || e.key === ' ') && o.onclick) { e.preventDefault(); o.onclick(); }
        else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && o.onmenu) {
          e.preventDefault();
          const r = this.svg.getBoundingClientRect();
          o.onmenu(r.left + r.width / 2, r.top + r.height / 2);
        }
        else if (e.key === 'Escape') this.stop();
      });
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (o.onmenu && !e.target.closest('.scout-balloon')) o.onmenu(e.clientX, e.clientY);
      });
      this._onResize = () => this.placeAt(this._pos[0], this._pos[1]);
      addEventListener('resize', this._onResize);
    }
    /** Put him at a desktop position now (px, top-left of the character box), kept inside the window. */
    placeAt(x, y) {
      if (this.o.mode !== 'desktop') return this;
      const W = this.o.size, H = W * 235 / 260;
      this._pos = [clamp(x, -W * .2, innerWidth - W * .8), clamp(y, -H * .2, innerHeight - H * .7)];
      this._place();
      return this;
    }
    get position() { return this._pos ? this._pos.slice() : null; }
  }

  Scout.version = '1.0.0';
  (root.L || (root.L = {})).Scout = Scout;
})(typeof window !== 'undefined' ? window : globalThis);
