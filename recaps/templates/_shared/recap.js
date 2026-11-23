/*
 * Shared builder for recap videos (docs/specs/recap-videos-specs.md). Each template's index.html
 * has empty scene containers with HyperFrames timing attributes. This script fills the shared
 * scenes (title, results) and adds their motion to one paused GSAP timeline.
 *
 * SECURITY: player names, words and answers are user/LLM text. Insert them with textContent only
 * (the el() helper below), never as HTML markup. tests/recaps/templates.test.js checks for that.
 */
(function () {
  // Preview-only sample, used when no --variables are given (e.g. `npx hyperframes preview`).
  var SAMPLE = {
    template: 'generic',
    game: 'imposter',
    title: 'Imposter',
    date: '2026-11-23',
    players: [
      { name: 'Dana', points: 3, won: true, place: 1, avatar: { kind: 'emoji', emoji: '🦊' } },
      { name: 'Avi', points: 1, won: true, place: 2, avatar: { kind: 'emoji', emoji: '🐼' } },
      { name: 'Noa', points: 0, won: false, place: 3, avatar: { kind: 'emoji', emoji: '🐝' } },
      { name: 'Ron', points: -1, won: false, place: 4, avatar: { kind: 'emoji', emoji: '🦄' } },
    ],
    highlight: {
      mode: 'word', imposters: ['Noa'], caught: true, word: 'Pizza', hint: 'Italian',
      champion: 'Dana', finalRound: [{ name: 'Dana', time: '9.982' }, { name: 'Avi', time: '10.214' }],
      out: ['Ron', 'Noa', 'Avi'],
    },
  };

  var vars = (window.__hyperframes && window.__hyperframes.getVariables()) || {};
  var data;
  try {
    data = vars.recap ? JSON.parse(vars.recap) : SAMPLE;
  } catch (e) {
    data = SAMPLE;
  }
  var players = Array.isArray(data.players) ? data.players : [];
  var MAX_ROWS = 8;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }

  function avatar(p, size) {
    var a = el('div', 'avatar');
    a.style.width = size + 'px';
    a.style.height = size + 'px';
    var av = (p && p.avatar) || {};
    if (av.kind === 'image' && typeof av.src === 'string' && /^stickers\/\d+\.(webp|png|jpe?g)$/.test(av.src)) {
      var img = el('img');
      img.src = av.src;
      img.alt = '';
      a.appendChild(img);
    } else {
      a.appendChild(el('span', null, av.emoji || av.fallback || String((p && p.name) || '?').slice(0, 1)));
      a.style.fontSize = Math.round(size * 0.55) + 'px';
    }
    return a;
  }

  function byName(name) {
    for (var i = 0; i < players.length; i++) if (players[i].name === name) return players[i];
    return { name: name, avatar: {} };
  }

  function buildTitle(scene) {
    var s = el('div', 'stack');
    var logo = el('img', 'logo');
    logo.src = 'shared/logo.png';
    logo.alt = '';
    s.appendChild(logo);
    s.appendChild(el('div', 'kicker', 'Game recap'));
    s.appendChild(el('div', 'game-title', data.title || 'Shorot'));
    s.appendChild(el('div', 'date', data.date || ''));
    scene.appendChild(s);
  }

  function buildResults(scene) {
    var s = el('div', 'stack');
    var winners = players.filter(function (p) { return p.won; }).slice(0, 3);
    if (!winners.length && players.length) winners = [players[0]];
    var size = winners.length > 2 ? 170 : 220;
    s.appendChild(el('div', 'winner-label', winners.length > 1 ? 'WINNERS' : 'WINNER'));
    var w = el('div', 'winners');
    winners.forEach(function (p) {
      var box = el('div', 'winner');
      box.appendChild(el('div', 'crown', '👑'));
      box.appendChild(avatar(p, size));
      box.appendChild(el('div', 'winner-name', p.name));
      w.appendChild(box);
    });
    s.appendChild(w);
    var rows = el('div', 'rows' + (players.length > 6 ? ' compact' : ''));
    players.slice(0, MAX_ROWS).forEach(function (p) {
      var r = el('div', 'row' + (p.won ? ' won' : ''));
      r.appendChild(el('div', 'place', p.place));
      r.appendChild(avatar(p, players.length > 6 ? 56 : 72));
      r.appendChild(el('div', 'name', p.name));
      var pts = Number(p.points) || 0;
      r.appendChild(el('div', 'pts ' + (pts > 0 ? 'plus' : pts < 0 ? 'minus' : ''), (pts > 0 ? '+' : '') + pts));
      rows.appendChild(r);
    });
    s.appendChild(rows);
    scene.appendChild(s);
    var f = el('div', 'footer');
    var logo = el('img');
    logo.src = 'shared/logo.png';
    logo.alt = '';
    f.appendChild(logo);
    scene.appendChild(f);
  }

  var tl = gsap.timeline({ paused: true });

  function glows(total) {
    tl.to('#glow-a', { x: 220, y: 460, duration: total, ease: 'sine.inOut' }, 0);
    tl.to('#glow-b', { x: -200, y: -520, duration: total, ease: 'sine.inOut' }, 0);
  }

  // The title is already on screen at 0 s (the first frame is the thumbnail on social players).
  function animateTitle(end) {
    tl.fromTo('#title .logo', { scale: 0.9 }, { scale: 1, duration: 0.7, ease: 'back.out(1.8)' }, 0);
    tl.from('#title .game-title', { y: 40, duration: 0.6, ease: 'power3.out' }, 0.1);
    tl.from('#title .date', { opacity: 0, duration: 0.5 }, 0.5);
    tl.to('#title', { opacity: 0, y: -60, duration: 0.3, ease: 'power2.in' }, end - 0.3);
  }

  function animateResults(start) {
    tl.from('#results .winner-label', { opacity: 0, y: -30, duration: 0.4, ease: 'power3.out' }, start + 0.1);
    tl.from('#results .winner', { scale: 0.2, opacity: 0, duration: 0.7, stagger: 0.15, ease: 'back.out(1.8)' }, start + 0.25);
    tl.from('#results .crown', { y: -80, opacity: 0, duration: 0.5, stagger: 0.15, ease: 'bounce.out' }, start + 0.8);
    tl.from('#results .row', { x: -900, opacity: 0, duration: 0.5, stagger: 0.12, ease: 'power3.out' }, start + 1.0);
    tl.from('#results .footer', { opacity: 0, duration: 0.6 }, start + 1.6);
  }

  /** Called last by each template, after its own highlight motion. */
  function finish() {
    window.__timelines['main'] = tl;
    tl.seek(0);
  }

  window.Recap = {
    data: data,
    players: players,
    highlight: data.highlight || {},
    tl: tl,
    el: el,
    avatar: avatar,
    byName: byName,
    buildTitle: buildTitle,
    buildResults: buildResults,
    glows: glows,
    animateTitle: animateTitle,
    animateResults: animateResults,
    finish: finish,
  };
})();
