// Color spaces as rotatable 3D shapes, for <figure data-color-space>. Loaded
// by script.js on pages that have one.
//
// data-color-space="rgb" draws the RGB cube, one axis per channel.
// data-color-space="oklch" draws the RGB gamut in OKLCH as a landscape:
// lightness runs from black to white, hue runs along the other side, and the
// height is the most chroma a color of that lightness and hue can have.
// data-color-space="okhsl" draws the full sRGB OKHSL cylinder.
// data-color-space="pi-range" draws what Pi makes from one terminal color
// for a role, as a hue slice inside that cylinder's outline.
// data-pi-themes on it names the terminal themes (themes.json) to take
// that color from.
// Every point is drawn in its own color. Drag (or arrow keys) to rotate.
//
// OKLCH and RGB sliders select one color for all figures; paired views
// share one picker. The color spaces are cut open at that color: the cube
// loses the box between the color and white, and the landscape the block of
// higher lightness, hue and chroma, so the color sits in the cut's inner
// corner. The cylinder loses a full-height wedge from the color's hue, so
// the color is on a side showing its whole hue; beside Pi's range, from the
// source's hue, with Pi's outputs on that side. The shapes' surfaces stay put and the GPU
// discards them inside the cut; only the cut's faces are rebuilt. What the
// cut removed stays as a ghost, a dotted pattern in its colors. A round
// lens in the color marks it, faded while the shape hides it. For a color
// a shape cannot show, the cut starts at the color outside the shape and
// extends into it, with lines leading out to it, and a crossed-out red dot
// marks the color, with the reason.
//
// Pi's range has no cut and does not take its source from the selection:
// the source is the ANSI color a role uses in a terminal theme, as in Pi.
// The selected color is a candidate, checked against the range: it is
// marked where it is, and the figure says whether Pi can make it from the
// source and if not, why. Squares mark the colors Pi makes from the source
// in that theme. Article colors (data-select-color) can pick the theme and
// role (data-pi-theme, data-pi-role) along with the candidate.
//
// On wide-gamut displays, with browsers that can draw WebGL in Display P3,
// the cube and the landscape use Display P3 instead of sRGB: the cube's
// corners are P3's primaries, and the landscape is P3's larger gamut.
// Elsewhere they use sRGB. OKHSL is defined on sRGB, so its cylinder always
// shows sRGB colors, converted for a P3 canvas.
//
// Memory: a figure's WebGL context holds its buffers only while the figure
// is near the viewport; further away it is released and restored on the
// way back (the same path as a context the browser loses). Canvases render
// at the full device pixel ratio, without multisampling from 2x on, and
// drop resolution if frames come in too slowly. Devices likely short on
// memory get coarser grids.
(function() {
  if (window.__colorSpaces) return;
  window.__colorSpaces = true;

  // Devices likely short on memory get half as fine grids, a quarter of the
  // vertices: touch-only devices, which report no memory (iOS) or little,
  // and any reporting at most 2 GB. Chrome reports deviceMemory, capped at 8.
  var LOW_MEMORY = (function() {
    var touchOnly = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    var memory = navigator.deviceMemory;
    return memory ? memory <= 2 || (touchOnly && memory <= 4) : touchOnly;
  })();
  var DETAIL = LOW_MEMORY ? 0.5 : 1;
  // Halved, these keep their halves whole: cuts step at half the grid.
  var HUE_STEPS = 288 * DETAIL; // landscape grid; stays below 65536 vertices
  var LIGHTNESS_STEPS = 160 * DETAIL;
  var WALL_STEPS = 12; // grid rows on vertical walls
  var HUE_DEPTH = 1; // length of the hue axis, lightness spans 1 as well
  var CHROMA_HEIGHT = 3; // height per unit of chroma
  var SIDE_STEPS = 216 * DETAIL; // OKHSL cylinder grid around its side
  var SATURATION_STEPS = 24; // and out from its axis on the cut's faces
  var CYLINDER_RADIUS = 0.55; // its height is 1
  var WEDGE = Math.PI / 2; // the cylinder's cut, from the selected hue on
  var WEDGE_STEPS = 72;
  var OUTLINE_ALPHA = 0.35; // OKHSL's full cylinder
  var CUT_LINE_ALPHA = 0.7; // the cut's edges
  // What the cut removed is drawn as a ghost: dots in its colors, on a grid
  // fixed to the screen (CSS pixels).
  var GHOST_SPACING = 4;
  var GHOST_RADIUS = 0.9;
  var GHOST_ALPHA = 0.7;
  var GAMUT_TOLERANCE = 1e-4; // chroma; slider steps land on the boundary
  var NOT_CUT = [-10, -10, -10]; // coordinates outside every cut
  var OPEN = 10; // cut size reaching past the end of an axis
  var SLIVER = 0.02; // thinnest wall a cut leaves of the cube for a color outside it
  // system-theme.ts's complete FAMILIES recipe. Hue is only used when no
  // terminal palette is available; palette colors keep their own hue.
  var PI_FAMILIES = {
    neutral: { hue: 231.49, min: 0.02, max: 0.08, label: 'neutral' },
    blue: { hue: 231.49, min: 0.1, max: 0.68, label: 'blue' },
    green: { hue: 158.68, min: 0.1, max: 0.76, label: 'green' },
    red: { hue: 20, min: 0.1, max: 0.92, label: 'red' },
    yellow: { hue: 82.36, min: 0.5, max: 1, label: 'yellow' },
    orange: { hue: 52, min: 0.12, max: 0.85, label: 'orange' },
    violet: { hue: 295, min: 0.2, max: 0.6, label: 'violet' },
    calamine: { hue: 202.43, min: 0.1, max: 0.74, label: 'calamine' },
    thinkingSlate: { hue: 231.49, min: 0.08, max: 0.2, label: 'thinking slate' },
    thinkingBlue: { hue: 231.49, min: 0.2, max: 0.45, label: 'thinking blue' },
    thinkingPeriwinkle: { hue: 263.25, min: 0.3, max: 0.6, label: 'thinking periwinkle' },
    thinkingViolet: { hue: 295, min: 0.4, max: 0.75, label: 'thinking violet' },
    thinkingMagenta: { hue: 337.5, min: 0.5, max: 0.85, label: 'thinking magenta' },
    thinkingRed: { hue: 20, min: 0.95, max: 1, label: 'thinking red' }
  };

  // Every distinct (family, ANSI slot) pair Pi uses (system-theme.ts,
  // TOKEN_FAMILIES, TOKEN_SLOTS), named by its main role, with the tokens
  // that use it, main token first. They differ only in lightness. Body text
  // (text, userMessageText, toolTitle) starts from the terminal's
  // foreground instead, so it is not here.
  var PI_ROLES = [
    { id: 'accent', label: 'Accent', group: 'Interface', family: 'violet', slot: 5,
      tokens: ['accent', 'borderAccent', 'customMessageLabel', 'mdCode', 'mdListBullet', 'syntaxType',
        'customMessageBg'] },
    { id: 'link', label: 'Links and borders', group: 'Interface', family: 'blue', slot: 4,
      tokens: ['mdLink', 'border', 'syntaxKeyword', 'selectedBg', 'userMessageBg'] },
    { id: 'success', label: 'Success', group: 'Interface', family: 'green', slot: 2,
      tokens: ['success', 'mdCodeBlock', 'toolDiffAdded', 'bashMode', 'toolSuccessBg'] },
    { id: 'error', label: 'Error', group: 'Interface', family: 'red', slot: 1,
      tokens: ['error', 'toolDiffRemoved', 'toolErrorBg'] },
    { id: 'warning', label: 'Warning', group: 'Interface', family: 'yellow', slot: 3,
      tokens: ['warning', 'mdHeading', 'syntaxFunction'] },
    { id: 'search', label: 'Search match', group: 'Interface', family: 'orange', slot: 3,
      tokens: ['searchMatchBg'] },
    { id: 'muted', label: 'Muted text', group: 'Interface', family: 'neutral', slot: 8,
      tokens: ['muted', 'dim', 'borderMuted', 'thinkingText', 'scrollbarThumb', 'scrollbarTrack', 'thinkingOff',
        'toolPendingBg', 'customMessageText', 'syntaxOperator', 'syntaxPunctuation', 'toolOutput', 'mdLinkUrl',
        'mdQuote', 'mdQuoteBorder', 'mdHr', 'mdCodeBlockBorder', 'toolDiffContext', 'syntaxComment',
        'searchMatchText'] },
    { id: 'strings', label: 'Strings', group: 'Syntax', family: 'orange', slot: 2, tokens: ['syntaxString'] },
    { id: 'numbers', label: 'Numbers', group: 'Syntax', family: 'green', slot: 5, tokens: ['syntaxNumber'] },
    { id: 'variables', label: 'Variables', group: 'Syntax', family: 'calamine', slot: 6, tokens: ['syntaxVariable'] },
    { id: 'thinkingMinimal', label: 'Minimal', group: 'Thinking level', family: 'thinkingSlate', slot: 4,
      tokens: ['thinkingMinimal'] },
    { id: 'thinkingLow', label: 'Low', group: 'Thinking level', family: 'thinkingBlue', slot: 4,
      tokens: ['thinkingLow'] },
    { id: 'thinkingMedium', label: 'Medium', group: 'Thinking level', family: 'thinkingPeriwinkle', slot: 6,
      tokens: ['thinkingMedium'] },
    { id: 'thinkingHigh', label: 'High', group: 'Thinking level', family: 'thinkingViolet', slot: 5,
      tokens: ['thinkingHigh'] },
    { id: 'thinkingXhigh', label: 'Extra high', group: 'Thinking level', family: 'thinkingMagenta', slot: 13,
      tokens: ['thinkingXhigh'] },
    { id: 'thinkingMax', label: 'Max', group: 'Thinking level', family: 'thinkingRed', slot: 1,
      tokens: ['thinkingMax'] }
  ];
  // How close, in OKLab, a candidate must be to count as one of Pi's colors:
  // a little more than 8-bit rounding moves a color.
  var MATCH_DISTANCE = 0.004;
  var ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'bright black', 'bright red', 'bright green', 'bright yellow', 'bright blue', 'bright magenta',
    'bright cyan', 'bright white'];
  var FOV = 30 * Math.PI / 180;
  var IDLE_SPEED = 2 * Math.PI / 40000; // radians per ms, a turn in 40s
  var MIN_PITCH = -1.2;
  var MAX_PITCH = 1.3;
  var DRAG_SPEED = 0.01; // radians per CSS pixel
  var KEY_STEP = 0.15;
  var RESUME_IDLE_MS = 2500; // auto-rotation resumes this long after a drag
  var TURN_MS = 450; // how long a shape takes to turn to a new cut
  var PROBE_MS = 100; // how often the lens checks whether it is hidden
  var MAX_CHROMA = 0.37; // the picker's range, about Display P3's most
  var THUMB_WIDTH = 8; // the sliders' thumbs, in CSS pixels (prose.css)
  var SNAP_PX = 5; // how far past an edge a slider leaving a stretch holds on
  // Canvases hold their drawing buffers only near the viewport: further than
  // this away, their WebGL contexts are released, and restored on the way back.
  var KEEP_MARGIN = '100% 0px';
  // Frame rate watch: frames come in this slowly on average over a window
  // of continuous animation, and the canvases drop to the next resolution.
  var SLOW_FRAME_MS = 40; // under 25 fps; a 30 fps cap (low power) passes
  var FRAME_WINDOW_MS = 2000;
  var RESOLUTIONS = [1, 0.75, 0.5]; // of the device pixel ratio
  var COLOR_TRANSITION_MAX_MS = 3000; // in case a transition never ends
  var instances = [];

  // The selected color, shared by all figures. Hue in degrees.
  var selection = { l: 0.65, c: 0.1, h: 250 };
  var listeners = [];
  var hasSelection = false;
  var eyedroppers = [];
  // Pi's range figures, to switch their theme and role for an article color.
  var sourceListeners = [];

  // Every terminal theme picker on the page shows the same theme. A pick in
  // a figure is announced on <body> as pi:theme, which the demo's picker
  // (script.js) follows; the demo announces its own as asciicast:theme.
  // Pickers follow both, except their own, and only announce what a reader
  // picked, so following never echoes.
  var sharedTheme = null;
  function announceTheme(name, source) {
    if (!name) return;
    sharedTheme = name;
    document.body.dispatchEvent(new CustomEvent('pi:theme', { detail: { name: name, source: source } }));
  }
  // The theme an event names, or null for one's own.
  function themeOf(event, source) {
    if (event.type === 'pi:theme') return event.detail && event.detail.source !== source ? event.detail.name : null;
    return event.target.dataset.colorTheme || null;
  }
  function followThemes(handler) {
    document.body.addEventListener('pi:theme', handler);
    document.body.addEventListener('asciicast:theme', handler);
  }
  function unfollowThemes(handler) {
    document.body.removeEventListener('pi:theme', handler);
    document.body.removeEventListener('asciicast:theme', handler);
  }
  // The theme a figure starts with: the last one picked anywhere.
  function currentTheme(data) {
    var player = document.querySelector('[data-color-theme]');
    var appearance = document.body.classList.contains('theme-night') ? 'dark' : 'light';
    return sharedTheme || (player && player.dataset.colorTheme) || (data.initial || {})[appearance];
  }
  document.body.addEventListener('asciicast:theme', function(event) {
    if (event.target.dataset.colorTheme) sharedTheme = event.target.dataset.colorTheme;
  });

  function select(next, isDefault) {
    selection = next;
    if (!isDefault) hasSelection = true;
    listeners.forEach(function(listener) { listener(selection, isDefault); });
    // Hold still while a color is picked, so the cut does not turn away.
    instances.forEach(function(instance) { instance.interact(); });
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Rendering resolution, shared by all canvases since they share the GPU.
  // Full device pixels unless frames come in too slowly, then lower steps,
  // but not below one pixel per CSS pixel. Never back up: that would only
  // oscillate.
  var resolution = { level: 0, frames: 0, time: 0, last: null };

  function pixelRatio() {
    var device = window.devicePixelRatio || 1;
    return Math.max(Math.min(device, 1), device * RESOLUTIONS[resolution.level]);
  }

  // A frame of continuous animation, dt after the previous one. Figures
  // animating together report the same frame once.
  function watchFrame(now, dt) {
    if (resolution.last === now) return;
    resolution.last = now;
    resolution.frames++;
    resolution.time += dt;
    if (resolution.time < FRAME_WINDOW_MS) return;
    var slow = resolution.time / resolution.frames > SLOW_FRAME_MS;
    resolution.frames = 0;
    resolution.time = 0;
    if (!slow || resolution.level >= RESOLUTIONS.length - 1 || pixelRatio() <= 1) return;
    resolution.level++;
    instances.forEach(function(instance) { instance.draw(); });
  }

  // A pause in animation: the next window starts over.
  function resetFrameWatch() {
    resolution.frames = 0;
    resolution.time = 0;
  }

  // Lines are drawn in the figure's text color. Reading it is a style
  // lookup, so it is cached until the theme changes. The theme fades the
  // text color (a CSS transition): while it does, figures read it every
  // frame and keep drawing.
  var textColor = { epoch: 0, fading: [], until: 0 };

  function fadingColor() {
    if (textColor.fading.length && performance.now() > textColor.until) textColor.fading = [];
    return textColor.fading.length > 0;
  }

  function themeChanged() {
    textColor.epoch++;
    instances.forEach(function(instance) { instance.schedule(); });
  }

  function aboveFigure(element) {
    return instances.some(function(instance) { return element.contains(instance.figure); });
  }

  new MutationObserver(themeChanged).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('transitionrun', function(event) {
    if (event.propertyName !== 'color' || !aboveFigure(event.target)) return;
    if (textColor.fading.indexOf(event.target) === -1) textColor.fading.push(event.target);
    textColor.until = performance.now() + COLOR_TRANSITION_MAX_MS;
    themeChanged();
  });
  ['transitionend', 'transitioncancel'].forEach(function(type) {
    document.addEventListener(type, function(event) {
      var index = textColor.fading.indexOf(event.target);
      if (event.propertyName !== 'color' || index === -1) return;
      textColor.fading.splice(index, 1);
      themeChanged();
    });
  });

  // The sRGB transfer curve without clipping, mirrored below 0, for where a
  // color outside the gamut would be in the cube.
  function encodeUnclipped(value) {
    var magnitude = Math.abs(value);
    var encoded = magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * Math.pow(magnitude, 1 / 2.4) - 0.055;
    return value < 0 ? -encoded : encoded;
  }

  function linearToSrgb(value) {
    value = Math.min(1, Math.max(0, value));
    return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  }

  // OKLab's LMS to linear sRGB.
  var LMS_TO_SRGB = [
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.7076147010]
  ];

  // Linear sRGB to linear Display P3 (both D65).
  var SRGB_TO_P3 = [
    [0.8224621209, 0.1775378791, 0],
    [0.0331941989, 0.9668058011, 0],
    [0.0170826307, 0.0723974407, 0.9105199286]
  ];

  function multiply3(a, b) {
    return a.map(function(row) {
      return [0, 1, 2].map(function(col) {
        return row[0] * b[0][col] + row[1] * b[1][col] + row[2] * b[2][col];
      });
    });
  }

  function inverse3(m) {
    var a = m[0], b = m[1], c = m[2];
    var cross = function(u, v) {
      return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    };
    var x = cross(b, c), y = cross(c, a), z = cross(a, b);
    var det = a[0] * x[0] + a[1] * x[1] + a[2] * x[2];
    return [0, 1, 2].map(function(i) { return [x[i] / det, y[i] / det, z[i] / det]; });
  }

  // The RGB spaces to draw in, by the canvas color space each needs. Both
  // encode with the sRGB transfer curve, so they differ only by their
  // primaries: the matrix from OKLab's LMS to linear RGB.
  var GAMUTS = {
    srgb: { canvas: 'srgb', name: 'sRGB', fromLms: LMS_TO_SRGB },
    p3: { canvas: 'display-p3', name: 'Display P3', fromLms: multiply3(SRGB_TO_P3, LMS_TO_SRGB) }
  };

  Object.keys(GAMUTS).forEach(function(key) {
    GAMUTS[key].toLms = inverse3(GAMUTS[key].fromLms);
  });

  // Display P3 where both the display and the browser's WebGL support it.
  function pickGamut(gl) {
    if (!('drawingBufferColorSpace' in gl)) return GAMUTS.srgb;
    if (!window.matchMedia('(color-gamut: p3)').matches) return GAMUTS.srgb;
    try {
      gl.drawingBufferColorSpace = GAMUTS.p3.canvas;
    } catch (error) {
      return GAMUTS.srgb;
    }
    return gl.drawingBufferColorSpace === GAMUTS.p3.canvas ? GAMUTS.p3 : GAMUTS.srgb;
  }

  // OKLCH (hue in radians) to the gamut's linear RGB, which is outside
  // [0, 1] for colors the gamut cannot show.
  function oklchToLinear(lightness, chroma, hue, gamut) {
    var a = chroma * Math.cos(hue);
    var b = chroma * Math.sin(hue);
    var lms = [
      Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3),
      Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3),
      Math.pow(lightness - 0.0894841775 * a - 1.2914855480 * b, 3)
    ];
    return gamut.fromLms.map(function(row) {
      return row[0] * lms[0] + row[1] * lms[1] + row[2] * lms[2];
    });
  }

  // Encoded RGB, as the canvas expects it.
  function oklchToRgb(lightness, chroma, hue, gamut) {
    return oklchToLinear(lightness, chroma, hue, gamut).map(linearToSrgb);
  }

  // Encoded RGB in the picker's gamut to OKLCH (hue in degrees).
  function rgbToOklch(rgb, gamut, fallbackHue) {
    var linear = rgb.map(function(v) {
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var lms = gamut.toLms.map(function(row) { return Math.cbrt(dot3(row, linear)); });
    var L = dot3([0.2104542553, 0.7936177850, -0.0040720468], lms);
    var a = dot3([1.9779984951, -2.4285922050, 0.4505937099], lms);
    var b = dot3([0.0259040371, 0.7827717662, -0.8086757660], lms);
    var chroma = Math.hypot(a, b);
    // Gray has no hue: retain the selection's rather than amplifying noise.
    return { l: Math.min(1, Math.max(0, L)), c: chroma < 1e-7 ? 0 : chroma,
      h: chroma < 1e-7 ? fallbackHue : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
  }

  function inGamut(rgb) {
    return rgb[0] >= -1e-6 && rgb[0] <= 1 + 1e-6 &&
      rgb[1] >= -1e-6 && rgb[1] <= 1 + 1e-6 &&
      rgb[2] >= -1e-6 && rgb[2] <= 1 + 1e-6;
  }

  // The most chroma the gamut has at this lightness and hue, by bisection.
  // sRGB peaks at a chroma of 0.32, Display P3 at 0.37. Bisection misses
  // a corner that is cut off along its own hue: sRGB's blue is in sRGB, but
  // before it, red goes slightly negative. Corners are checked directly.
  function maxChroma(lightness, hue, gamut) {
    if (lightness <= 0 || lightness >= 1) return 0;
    var low = 0, high = 0.5;
    for (var i = 0; i < 18; i++) {
      var mid = (low + high) / 2;
      if (inGamut(oklchToLinear(lightness, mid, hue, gamut))) low = mid;
      else high = mid;
    }
    corners(gamut).forEach(function(corner) {
      var turn = (hue - corner[2]) / (2 * Math.PI);
      if (Math.abs(lightness - corner[0]) < 1e-9 && Math.abs(turn - Math.round(turn)) < 1e-9) {
        low = Math.max(low, corner[1]);
      }
    });
    return low;
  }

  // The gamut's primaries and secondaries as [lightness, chroma, hue in
  // radians]: the corners of its cube, where its ridges meet.
  function corners(gamut) {
    if (!gamut.corners) {
      gamut.corners = [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1]].map(function(rgb) {
        var lch = rgbToOklch(rgb, gamut, 0);
        return [lch.l, lch.c, lch.h * Math.PI / 180];
      });
    }
    return gamut.corners;
  }

  // OKHSL, Björn Ottosson's HSL built on OKLab, as Pi implements it (pi-tui's
  // oklab.ts). A port of his reference implementation
  // (https://bottosson.github.io/posts/colorpicker/), Copyright (c) 2021
  // Björn Ottosson, MIT licensed. Its saturation is relative to the sRGB
  // gamut, so it is sRGB's cylinder even in a Display P3 canvas.
  var OKHSL_K1 = 0.206;
  var OKHSL_K2 = 0.03;
  var OKHSL_K3 = (1 + OKHSL_K1) / (1 + OKHSL_K2);

  // Per sRGB channel: the (a, b) half-plane where that channel clips first,
  // and the polynomial approximating the most saturation (C / L) there.
  var SATURATION_FIT = [
    [[-1.8817031, -0.80936501], [1.19086277, 1.76576728, 0.59662641, 0.75515197, 0.56771245]],
    [[1.8144408, -1.19445267], [0.73956515, -0.45954404, 0.08285427, 0.12541073, -0.14503204]],
    [[0.13110758, 1.81333971], [1.35733652, -0.00915799, -1.1513021, -0.50559606, 0.00692167]]
  ];

  // How fast each cube-root LMS component changes along chroma direction (a, b).
  function lmsSlopes(a, b) {
    return [
      0.3963377774 * a + 0.2158037573 * b,
      -0.1055613458 * a - 0.0638541728 * b,
      -0.0894841775 * a - 1.2914855480 * b
    ];
  }

  function dot3(row, values) {
    return row[0] * values[0] + row[1] * values[1] + row[2] * values[2];
  }

  // Most saturation inside sRGB for hue (a, b): the fit plus one Halley step.
  function okhslMaxSaturation(a, b) {
    var channel = 2;
    for (var i = 0; i < 2; i++) {
      var plane = SATURATION_FIT[i][0];
      if (plane[0] * a + plane[1] * b > 1) {
        channel = i;
        break;
      }
    }
    var k = SATURATION_FIT[channel][1];
    var weights = LMS_TO_SRGB[channel];
    var saturation = k[0] + k[1] * a + k[2] * b + k[3] * a * a + k[4] * a * b;
    var slopes = lmsSlopes(a, b);
    var base = slopes.map(function(slope) { return 1 + saturation * slope; });
    var f = dot3(weights, base.map(function(v) { return v * v * v; }));
    var f1 = dot3(weights, base.map(function(v, j) { return 3 * slopes[j] * v * v; }));
    var f2 = dot3(weights, base.map(function(v, j) { return 6 * slopes[j] * slopes[j] * v; }));
    return saturation - f * f1 / (f1 * f1 - 0.5 * f * f2);
  }

  // OKLab lightness and chroma of the most colorful sRGB color of hue (a, b).
  function okhslCusp(a, b) {
    var saturation = okhslMaxSaturation(a, b);
    var lms = [1, 1, 1].map(function(one, j) {
      var v = one + saturation * lmsSlopes(a, b)[j];
      return v * v * v;
    });
    var rgb = LMS_TO_SRGB.map(function(row) { return dot3(row, lms); });
    var lightness = Math.cbrt(1 / Math.max(rgb[0], rgb[1], rgb[2]));
    return [lightness, lightness * saturation];
  }

  // Chroma where the line of constant lightness leaves sRGB.
  function okhslMaxChroma(a, b, lightness, cusp) {
    if (lightness <= cusp[0]) return cusp[1] * lightness / cusp[0];
    // Upper half: the triangle's edge, then one Halley step per channel.
    var t = cusp[1] * (lightness - 1) / (cusp[0] - 1);
    var slopes = lmsSlopes(a, b);
    var lms = slopes.map(function(slope) { return lightness + t * slope; });
    var cubes = lms.map(function(v) { return v * v * v; });
    var first = lms.map(function(v, j) { return 3 * slopes[j] * v * v; });
    var second = lms.map(function(v, j) { return 6 * slopes[j] * slopes[j] * v; });
    var step = Infinity;
    LMS_TO_SRGB.forEach(function(row) {
      var f = dot3(row, cubes) - 1;
      var f1 = dot3(row, first);
      var f2 = dot3(row, second);
      var u = f1 / (f1 * f1 - 0.5 * f * f2);
      if (u >= 0) step = Math.min(step, -f * u);
    });
    return t + step;
  }

  // OKHSL's chroma at saturation 0, 0.8 and 1, for OKLab lightness L.
  var lastStops = { L: NaN, a: NaN, b: NaN, stops: null }; // grids often repeat one

  function okhslChromaStops(L, a, b) {
    if (lastStops.L === L && lastStops.a === a && lastStops.b === b) return lastStops.stops;
    var stops = computeChromaStops(L, a, b);
    lastStops = { L: L, a: a, b: b, stops: stops };
    return stops;
  }

  function computeChromaStops(L, a, b) {
    var cusp = okhslCusp(a, b);
    var cMax = okhslMaxChroma(a, b, L, cusp);
    var k = cMax / Math.min(L * (cusp[1] / cusp[0]), (1 - L) * (cusp[1] / (1 - cusp[0])));
    var midS = 0.11516993 + 1 / (7.4477897 + 4.1590124 * b + a * (-2.19557347 + 1.75198401 * b +
      a * (-2.13704948 - 10.02301043 * b + a * (-4.24894561 + 5.38770819 * b + 4.69891013 * a))));
    var midT = 0.11239642 + 1 / (1.6132032 - 0.68124379 * b + a * (0.40370612 + 0.90148123 * b +
      a * (-0.27087943 + 0.6122399 * b + a * (0.00299215 - 0.45399568 * b - 0.14661872 * a))));
    var cMid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / Math.pow(L * midS, 4) + 1 / Math.pow((1 - L) * midT, 4))));
    var c0 = Math.sqrt(1 / (1 / Math.pow(L * 0.4, 2) + 1 / Math.pow((1 - L) * 0.8, 2)));
    return [c0, cMid, cMax];
  }

  // A family's normalized curve (system-theme.ts, saturationCurve): 1 at
  // mid OKHSL lightness, min / max at black and white. Palette colors use
  // the target/source ratio; fallback colors multiply it by family.max.
  function piSaturation(family, lightness) {
    var gaussian = function(x) { return Math.exp(-(x - 0.5) * (x - 0.5) / (2 * 0.25 * 0.25)); };
    var bell = (gaussian(lightness) - gaussian(0)) / (1 - gaussian(0));
    var floor = family.max > 0 ? family.min / family.max : 1;
    return floor + (1 - floor) * bell;
  }

  // OKHSL (hue in radians, saturation and lightness 0-1) to OKLCH.
  function okhslToOklch(hue, saturation, lightness) {
    var L = (lightness * lightness + OKHSL_K1 * lightness) / (OKHSL_K3 * (lightness + OKHSL_K2));
    if (L <= 0 || L >= 1 || saturation <= 0) return [L, 0, hue];
    var stops = okhslChromaStops(L, Math.cos(hue), Math.sin(hue));
    var c0 = stops[0], cMid = stops[1], cMax = stops[2];
    var chroma, t, k1;
    // Chroma rises from 0 through cMid at saturation 0.8 to cMax at 1.
    if (saturation < 0.8) {
      t = 1.25 * saturation;
      k1 = 0.8 * c0;
      chroma = t * k1 / (1 - (1 - k1 / cMid) * t);
    } else {
      t = 5 * (saturation - 0.8);
      k1 = 0.2 * cMid * cMid * 1.25 * 1.25 / c0;
      chroma = cMid + t * k1 / (1 - (1 - k1 / (cMax - cMid)) * t);
    }
    return [L, chroma, hue];
  }

  function okhslToRgb(hue, saturation, lightness, gamut) {
    var lch = okhslToOklch(hue, saturation, lightness);
    return oklchToRgb(lch[0], lch[1], lch[2], gamut);
  }

  // OKLCH (hue in radians) to OKHSL [hue, saturation, lightness], the
  // inverse of okhslToOklch, for colors inside sRGB.
  function oklchToOkhsl(L, chroma, hue) {
    var x = OKHSL_K3 * L - OKHSL_K1;
    var lightness = 0.5 * (x + Math.sqrt(x * x + 4 * OKHSL_K2 * OKHSL_K3 * L));
    if (chroma < 1e-9 || L <= 0 || L >= 1) return [hue, 0, lightness];
    var stops = okhslChromaStops(L, Math.cos(hue), Math.sin(hue));
    var c0 = stops[0], cMid = stops[1], cMax = stops[2];
    var saturation, k1;
    if (chroma < cMid) {
      k1 = 0.8 * c0;
      saturation = 0.8 * (chroma / (k1 + (1 - k1 / cMid) * chroma));
    } else {
      k1 = 0.2 * cMid * cMid * 1.25 * 1.25 / c0;
      var offset = chroma - cMid;
      saturation = 0.8 + 0.2 * (offset / (k1 + (1 - k1 / (cMax - cMid)) * offset));
    }
    return [hue, Math.min(1, Math.max(0, saturation)), lightness];
  }

  // system-theme.ts's anchored(): keep the source saturation at its own
  // OKHSL lightness, attenuate it relative to that anchor, and cap chroma
  // by the source's chroma with the same attenuation. The geometry uses
  // continuous channels rather than Pi's intermediate 8-bit rounding.
  function piRangeSaturation(source, family, lightness, multiplier) {
    var anchor = piSaturation(family, source[2]);
    var falloff = anchor > 0 ? Math.min(1, piSaturation(family, lightness) / anchor) : 1;
    var saturation = source[1] * falloff * multiplier;
    var lch = okhslToOklch(source[0], saturation, lightness);
    var cap = source[3] * falloff * multiplier;
    return lch[1] <= cap ? saturation : oklchToOkhsl(lch[0], cap, source[0])[1];
  }

  function piFallbackSaturation(family, lightness, multiplier) {
    return family.max * piSaturation(family, lightness) * multiplier;
  }

  function selectedOkhsl() {
    var lch = selected();
    var chroma = inside(lch, GAMUTS.srgb) ? lch[1] : Math.min(lch[1], maxChroma(lch[0], lch[2], GAMUTS.srgb));
    var hsl = oklchToOkhsl(lch[0], chroma, lch[2]);
    return [hsl[0], hsl[1], hsl[2], lch[1]];
  }

  function cylinderPosition(hue, saturation, lightness) {
    return [saturation * CYLINDER_RADIUS * Math.cos(hue), lightness,
      -saturation * CYLINDER_RADIUS * Math.sin(hue)];
  }

  // Facing a radial slice at this hue, with a little depth still visible.
  function facingHue(hue) {
    return Math.PI - hue + 0.15;
  }

  // From angle a to angle b the short way round, in radians.
  function angleTo(a, b) {
    var delta = (b - a) % (2 * Math.PI);
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    return delta;
  }

  function easeOut(e) {
    return 1 - Math.pow(1 - e, 3);
  }

  function cylinderFacing() {
    return facingHue(selectedOkhsl()[0]);
  }

  // A hex sRGB color as OKHSL [hue in radians, saturation, lightness] and
  // its OKLCH chroma.
  function okhslOfHex(hex) {
    var lch = rgbToOklch(hexToRgb(hex), GAMUTS.srgb, 0);
    var hsl = oklchToOkhsl(lch.l, lch.c, lch.h * Math.PI / 180);
    return [hsl[0], hsl[1], hsl[2], lch.c];
  }

  // A hex sRGB color as OKLCH [lightness, chroma, hue in radians].
  function lchOfHex(hex) {
    var lch = rgbToOklch(hexToRgb(hex), GAMUTS.srgb, 0);
    return [lch.l, lch.c, lch.h * Math.PI / 180];
  }

  // An OKHSL color (hue in radians) as CSS.
  function okhslCss(hue, saturation, lightness) {
    var lch = okhslToOklch(hue, saturation, lightness);
    return css(lch[0], lch[1], hue * 180 / Math.PI);
  }

  function hexOf(rgb) {
    return '#' + rgb.map(function(value) {
      return ('0' + Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16)).slice(-2);
    }).join('');
  }

  // Between two OKLCH colors (hue in radians), in OKLab.
  function oklabDistance(first, second) {
    return Math.hypot(first[0] - second[0],
      first[1] * Math.cos(first[2]) - second[1] * Math.cos(second[2]),
      first[1] * Math.sin(first[2]) - second[1] * Math.sin(second[2]));
  }

  // The selected color as [lightness, chroma, hue in radians], and whether
  // a gamut has it.
  function selected() {
    return [Math.min(1, Math.max(0, selection.l)), selection.c, selection.h * Math.PI / 180];
  }

  // Tested directly first: sRGB's blue primary is in sRGB, but the gamut is
  // only that one point along its hue, past a notch where red goes slightly
  // negative, so maxChroma's bisection stops short of it. The chroma test
  // keeps slider steps that land just past the boundary inside.
  function inside(lch, gamut) {
    return inGamut(oklchToLinear(lch[0], lch[1], lch[2], gamut)) ||
      lch[1] <= maxChroma(lch[0], lch[2], gamut) + GAMUT_TOLERANCE;
  }

  // Collects vertices and triangles from grids, and lines. Every vertex has
  // a position, a color, its coordinates in the shape's color space, which
  // the cut is tested against, and "keep": cut faces span more than the
  // shape, and their parts outside it have a negative keep and are discarded.
  var STRIDE = 10;

  function MeshBuilder() {
    this.vertices = [];
    this.indices = [];
    this.lines = []; // drawn in the text color
  }

  MeshBuilder.prototype.vertex = function(position, color, coords, keep) {
    this.vertices.push(position[0], position[1], position[2], color[0], color[1], color[2],
      coords[0], coords[1], coords[2], keep === undefined ? 1 : keep);
  };

  // vertex(i, j) adds the vertex for 0 <= i <= rows, 0 <= j <= cols.
  MeshBuilder.prototype.grid = function(rows, cols, vertex) {
    var base = this.vertices.length / STRIDE;
    for (var i = 0; i <= rows; i++) {
      for (var j = 0; j <= cols; j++) vertex(i, j);
    }
    for (i = 0; i < rows; i++) {
      for (j = 0; j < cols; j++) {
        var a = base + i * (cols + 1) + j;
        var b = a + cols + 1;
        this.indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  };

  // A polyline through positions [x, y, z], optionally with a keep for each.
  MeshBuilder.prototype.line = function(points, keeps) {
    var base = this.vertices.length / STRIDE;
    for (var i = 0; i < points.length; i++) {
      this.vertex(points[i], [0, 0, 0], NOT_CUT, keeps ? keeps[i] : 1);
      if (i > 0) this.lines.push(base + i - 1, base + i);
    }
  };

  // Moves the vertices by offset, or, without one, centers them on their
  // bounding box (only vertically for shapes that turn around their own
  // axis). Returns the arrays and the bounds the camera needs.
  MeshBuilder.prototype.build = function(offset, verticalOnly) {
    var v = this.vertices;
    var i, k;
    if (!offset) {
      var min = [Infinity, Infinity, Infinity];
      var max = [-Infinity, -Infinity, -Infinity];
      for (i = 0; i < v.length; i += STRIDE) {
        for (k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], v[i + k]);
          max[k] = Math.max(max[k], v[i + k]);
        }
      }
      offset = [0, 1, 2].map(function(axis) {
        return verticalOnly && axis !== 1 ? 0 : (min[axis] + max[axis]) / 2;
      });
    }
    var radius = 0, spread = 0, halfHeight = 0;
    for (i = 0; i < v.length; i += STRIDE) {
      for (k = 0; k < 3; k++) v[i + k] -= offset[k];
      radius = Math.max(radius, Math.hypot(v[i], v[i + 1], v[i + 2]));
      spread = Math.max(spread, Math.hypot(v[i], v[i + 2]));
      halfHeight = Math.max(halfHeight, Math.abs(v[i + 1]));
    }
    return {
      vertices: new Float32Array(v),
      indices: new Uint16Array(this.indices.concat(this.lines)),
      triangles: this.indices.length,
      lines: this.lines.length,
      offset: offset,
      radius: radius, // bounding sphere
      spread: spread, // and cylinder around the vertical axis
      halfHeight: halfHeight
    };
  };

  // Values from `from` to 1: from itself, then the multiples of 1 / steps
  // above it, so grids line up with the shape's own grid.
  function stepsFrom(from, steps) {
    var values = [from];
    for (var i = Math.floor(from * steps + 1e-9) + 1; i <= steps; i++) values.push(i / steps);
    if (values.length === 1) values.push(from);
    return values;
  }

  // Values from `from` to `to` in `count` equal steps.
  function steps(from, to, count) {
    var values = [];
    for (var i = 0; i <= count; i++) values.push(from + (to - from) * i / count);
    return values;
  }

  // Each shape, for a gamut: the gamut it can show, its surfaces (built
  // once), the starting view, optionally facing() to turn it toward its cut
  // when the color changes, and cut(), which returns the cut at the selected color: the box in the
  // shape's coordinates to discard (from + size, the first coordinate
  // repeating every `wrap` if set), the faces that close it, and the color's
  // position. For a color the shape cannot show, the cut still starts at
  // the color, outside the shape, and reaches into it; `missing` says why
  // the color is not in the shape. A color at the far end of an axis leaves
  // nothing to cut (NO_CUT).
  var NO_CUT = { from: [0, 0, 0], size: [0, 0, 0], wrap: 0 };

  var SHAPES = {
    // Red to the right, green up, blue toward the front. Colors change
    // linearly across each face, so two triangles per face are exact. The
    // same values mean P3's primaries in a P3 canvas. The cut is the box
    // between the selected color and white. For a color outside the gamut,
    // the box reaches out of the cube to it: below 0, a channel's side of
    // the box starts outside the cube, so the cut goes all the way through
    // along it, as it does for a channel so close to 0 that only a sliver of
    // the cube's side would stand. Above 1, the box is past the cube along
    // that channel and cuts nothing. The box's edges outside the cube lead
    // out to the color.
    rgb: function(gamut) {
      var mesh = new MeshBuilder();
      // The cut's faces at the corner, skipping planes outside the cube.
      var squares = function(target, corner, skip) {
        for (var axis = 0; axis < 3; axis++) {
          if (skip && skip[axis]) continue;
          (corner ? [corner[axis]] : [0, 1]).forEach(function(value) {
            target.grid(1, 1, function(i, j) {
              var rgb = [0, 0, 0];
              rgb[axis] = value;
              rgb[(axis + 1) % 3] = corner ? (i ? 1 : corner[(axis + 1) % 3]) : i;
              rgb[(axis + 2) % 3] = corner ? (j ? 1 : corner[(axis + 2) % 3]) : j;
              target.vertex(rgb, rgb, corner ? NOT_CUT : rgb);
            });
            if (!corner) return;
            // The cut face's edges.
            target.line([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map(function(ij) {
              var rgb = [0, 0, 0];
              rgb[axis] = value;
              rgb[(axis + 1) % 3] = ij[0] ? 1 : corner[(axis + 1) % 3];
              rgb[(axis + 2) % 3] = ij[1] ? 1 : corner[(axis + 2) % 3];
              return rgb;
            }));
          });
        }
      };
      // The edges of the box between a color outside the cube and white,
      // where they are outside the cube; inside, the faces' edges show them.
      var outsideEdges = function(target, corner) {
        var lo = corner.map(function(value) { return Math.min(value, 1); });
        var hi = corner.map(function(value) { return Math.max(value, 1); });
        var within = function(value) { return value >= -1e-6 && value <= 1 + 1e-6; };
        var ends = function(k) { return hi[k] - lo[k] < 1e-6 ? [lo[k]] : [lo[k], hi[k]]; };
        for (var axis = 0; axis < 3; axis++) {
          var u = (axis + 1) % 3, v = (axis + 2) % 3;
          ends(u).forEach(function(a) {
            ends(v).forEach(function(b) {
              var spans = within(a) && within(b) ?
                [[lo[axis], Math.min(hi[axis], 0)], [Math.max(lo[axis], 1), hi[axis]]] :
                [[lo[axis], hi[axis]]];
              spans.forEach(function(span) {
                if (span[1] - span[0] < 1e-6) return;
                target.line(span.map(function(value) {
                  var point = [0, 0, 0];
                  point[axis] = value;
                  point[u] = a;
                  point[v] = b;
                  return point;
                }));
              });
            });
          });
        }
      };
      squares(mesh);
      return {
        gamut: gamut,
        mesh: mesh.build(),
        yaw: -Math.PI / 4, // white corner to the front
        pitch: 0.5,
        cut: function() {
          var lch = selected();
          var rgb = oklchToLinear(lch[0], lch[1], lch[2], gamut).map(encodeUnclipped);
          var clamp = function(value) { return Math.min(1, Math.max(0, value)); };
          var reason = inside(lch, gamut) ? undefined : 'Outside ' + gamut.name;
          // Slider steps just past the boundary count as on it.
          if (!reason) rgb = rgb.map(clamp);
          var faces = new MeshBuilder();
          if (reason) outsideEdges(faces, rgb);
          // Channels below 0 do not limit the cut, nor do channels so close
          // to 0 that they would only leave a sliver of the cube's side
          // standing: the color is not on it. Above 1, nothing is cut.
          var through = rgb.map(function(value) { return !!reason && value < SLIVER; });
          var from = rgb.map(function(value, axis) { return through[axis] ? -1 : value; });
          if (from.some(function(value) { return value >= 1 - 1e-6; })) {
            return { from: NO_CUT.from, size: NO_CUT.size, wrap: 0, faces: faces, point: rgb, missing: reason };
          }
          squares(faces, from.map(clamp), through);
          return { from: from, size: [OPEN, OPEN, OPEN], wrap: 0, faces: faces, point: rgb, missing: reason };
        }
      };
    },

    // The top is the gamut boundary, each point in its most colorful color.
    // Walls at both ends of the hue axis and a floor of grays close it. The
    // cut is the block of higher lightness, hue and chroma than the selected
    // color, which faces the camera at the start.
    oklch: function(gamut) {
      // The grid's hues (t, the position along the hue axis, 0-1) and
      // lightnesses, with the gamut's corners added: the peaks are sharp
      // there, and in between, the grid would cut them off.
      var merge = function(values, extra) {
        return values.concat(extra).sort(function(a, b) { return a - b; });
      };
      var ts = merge(steps(0, 1, HUE_STEPS), corners(gamut).map(function(corner) {
        var t = corner[2] / (2 * Math.PI);
        return t - Math.floor(t);
      }));
      var ls = merge(steps(0, 1, LIGHTNESS_STEPS), corners(gamut).map(function(corner) { return corner[0]; }));
      // Where the regular grid's points are in them.
      var regular = function(values, count) {
        var indices = [];
        values.forEach(function(value, index) {
          var step = value * count;
          if (Math.abs(step - Math.round(step)) < 1e-9) indices[Math.round(step)] = index;
        });
        return indices;
      };
      var hueIndex = regular(ts, HUE_STEPS), lightnessIndex = regular(ls, LIGHTNESS_STEPS);
      var chromas = ts.map(function(t) { // the most chroma at every grid point, [hue][lightness]
        return ls.map(function(lightness) { return maxChroma(lightness, t * 2 * Math.PI, gamut); });
      });
      var chromaAt = function(t, lightness) {
        var i = t * HUE_STEPS, j = lightness * LIGHTNESS_STEPS;
        if (Math.abs(i - Math.round(i)) < 1e-6 && Math.abs(j - Math.round(j)) < 1e-6) {
          return chromas[hueIndex[Math.round(i)]][lightnessIndex[Math.round(j)]];
        }
        return maxChroma(lightness, t * 2 * Math.PI, gamut);
      };
      var add = function(target, lightness, chroma, t, coords, keep) {
        target.vertex([lightness, chroma * CHROMA_HEIGHT, t * HUE_DEPTH],
          oklchToRgb(lightness, chroma, t * 2 * Math.PI, gamut), coords, keep);
      };

      var mesh = new MeshBuilder();
      mesh.grid(ts.length - 1, ls.length - 1, function(i, j) {
        var t = ts[i], lightness = ls[j];
        var chroma = chromas[i][j];
        add(mesh, lightness, chroma, t, [lightness, t, chroma]);
      });
      [0, 1].forEach(function(t) {
        mesh.grid(WALL_STEPS, ls.length - 1, function(k, j) {
          var lightness = ls[j];
          var chroma = chromas[t * (ts.length - 1)][j] * k / WALL_STEPS;
          add(mesh, lightness, chroma, t, [lightness, t, chroma]);
        });
      });
      mesh.grid(1, LIGHTNESS_STEPS, function(i, j) {
        var lightness = j / LIGHTNESS_STEPS;
        var gray = linearToSrgb(Math.pow(lightness, 3));
        mesh.vertex([lightness, 0, i * HUE_DEPTH], [gray, gray, gray], [lightness, i, 0]);
      });

      return {
        gamut: gamut,
        mesh: mesh.build(),
        yaw: -1,
        pitch: 0.4,
        cut: function() {
          var lch = selected();
          var l0 = lch[0], c0 = lch[1];
          // Hue 360 is the far end of the axis, not 0.
          var t0 = Math.min(1, Math.max(0, selection.h / 360));
          var point = [l0, c0 * CHROMA_HEIGHT, t0 * HUE_DEPTH];
          var reason = inside(lch, gamut) ? undefined : 'Outside ' + gamut.name;
          var faces = new MeshBuilder();
          // A color outside the gamut is above the top: the corner of the cut
          // reaches up to it.
          if (reason) {
            var below = chromaAt(t0, l0);
            faces.line([[l0, below * CHROMA_HEIGHT, t0 * HUE_DEPTH], point]);
          }
          if (t0 >= 1 - 1e-6 || l0 >= 1 - 1e-6) {
            return { from: NO_CUT.from, size: NO_CUT.size, wrap: 0, faces: faces, point: point, missing: reason };
          }
          // The cut's floor, at the selected chroma, where the shape is higher.
          var ts = stepsFrom(t0, HUE_STEPS / 2);
          var ls = stepsFrom(l0, LIGHTNESS_STEPS / 2);
          faces.grid(ts.length - 1, ls.length - 1, function(i, j) {
            add(faces, ls[j], c0, ts[i], NOT_CUT, chromaAt(ts[i], ls[j]) - c0);
          });
          // Its walls, at the selected lightness and hue, up to the top.
          var wall = function(count, at) {
            faces.grid(count, WALL_STEPS, function(i, k) {
              var point = at(i);
              var top = chromaAt(point[1], point[0]);
              var chroma = c0 + Math.max(0, top - c0) * k / WALL_STEPS;
              add(faces, point[0], chroma, point[1], NOT_CUT, top - c0);
            });
          };
          ts = stepsFrom(t0, HUE_STEPS);
          wall(ts.length - 1, function(i) { return [l0, ts[i]]; });
          ls = stepsFrom(l0, LIGHTNESS_STEPS);
          wall(ls.length - 1, function(j) { return [ls[j], t0]; });
          // The cut's edges: along the floor and the top of both walls, and
          // up the corner, wherever they are inside the shape.
          var edges = function(points) {
            var tops = points.map(function(point) { return chromaAt(point[1], point[0]); });
            var place = function(point, chroma) {
              return [point[0], chroma * CHROMA_HEIGHT, point[1] * HUE_DEPTH];
            };
            var keeps = tops.map(function(top) { return top - c0; });
            faces.line(points.map(function(point) { return place(point, c0); }), keeps);
            // Above the top, the floor's edge leads from the color to where
            // the cut enters the shape.
            var enters = keeps.findIndex(function(keep) { return keep >= 0; });
            if (reason && enters > 0) {
              faces.line(points.slice(0, enters + 1).map(function(point) { return place(point, c0); }));
            }
            faces.line(points.map(function(point, i) { return place(point, Math.max(c0, tops[i])); }), keeps);
          };
          edges(ts.map(function(t) { return [l0, t]; }));
          edges(ls.map(function(lightness) { return [lightness, t0]; }));
          // Where the cut leaves through the wall at the end of the hue axis.
          var end = ls.map(function(lightness) { return [lightness, 1]; });
          var endKeeps = end.map(function(point) { return chromaAt(1, point[0]) - c0; });
          faces.line(end.map(function(point) { return [point[0], c0 * CHROMA_HEIGHT, HUE_DEPTH]; }), endKeeps);
          [t0, 1].forEach(function(t) {
            var top = chromaAt(t, l0);
            faces.line([[l0, c0 * CHROMA_HEIGHT, t * HUE_DEPTH], [l0, Math.max(c0, top) * CHROMA_HEIGHT, t * HUE_DEPTH]],
              [top - c0, top - c0]);
          });
          return { from: [l0, t0, c0], size: [OPEN, OPEN, OPEN], wrap: 0, faces: faces, point: point, missing: reason };
        }
      };
    },

    // The full OKHSL cylinder, cut open at the selected color.
    // Beside Pi's range, it is cut open at the source's hue instead, with
    // the colors Pi makes from the source marked on the cut's side.
    okhsl: function(gamut, figure) {
      var pair = figure && figure.closest('[data-color-space-pair]');
      var position = cylinderPosition;
      var add = function(target, hue, saturation, lightness, coords, keep) {
        target.vertex(position(hue, saturation, lightness),
          okhslToRgb(hue, saturation, lightness, gamut), coords, keep);
      };
      // The selected color in OKHSL, with its chroma limited to sRGB's.
      var selectedHsl = selectedOkhsl;

      var mesh = new MeshBuilder();
      mesh.grid(SIDE_STEPS, LIGHTNESS_STEPS, function(i, j) {
        var hue = i / SIDE_STEPS * 2 * Math.PI, lightness = j / LIGHTNESS_STEPS;
        var saturation = 1;
        add(mesh, hue, saturation, lightness, [hue, saturation, lightness]);
      });
      // White on top, black at the bottom.
      [0, 1].forEach(function(lightness) {
        mesh.grid(SIDE_STEPS, 1, function(i, j) {
          var hue = i / SIDE_STEPS * 2 * Math.PI, saturation = j;
          mesh.vertex(position(hue, saturation, lightness), [lightness, lightness, lightness],
            [hue, saturation, lightness]);
        });
      });
      // OKHSL's full cylinder: its top and bottom rims.
      [0, 1].forEach(function(lightness) {
        var ring = [];
        for (var i = 0; i <= SIDE_STEPS; i++) ring.push(position(i / SIDE_STEPS * 2 * Math.PI, 1, lightness));
        mesh.line(ring);
      });

      // Looking into the cut, a little from the side.
      var facing = cylinderFacing;
      return {
        gamut: GAMUTS.srgb,
        mesh: mesh.build(null, true),
        yaw: facing(),
        pitch: 0.45,
        // The cut goes around with the hue, so the shape turns to follow it,
        // except beside Pi's range, which faces its source's slice.
        facing: facing,
        followsPair: true,
        cut: function() {
          var lch = selected();
          var hsl = selectedHsl();
          var s0 = hsl[1], l0 = hsl[2];
          var point = position(hsl[0], s0, l0);
          var reason;
          if (!inside(lch, GAMUTS.srgb)) {
            // Past the cylinder, further out the more chroma it lacks.
            var most = maxChroma(lch[0], lch[2], GAMUTS.srgb);
            var beyond = Math.min(1.3, 1 + (lch[1] - most) / Math.max(most, 0.05));
            point = position(hsl[0], beyond, l0);
            reason = 'Outside sRGB';
          }
          var range = pair && pair.__piRange;
          var h0 = ((range ? range.hue() : hsl[0]) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
          // Pi's outputs share the source's hue up to rounding: on the side.
          var markers = range ? range.outputs().map(function(output) {
            var out = okhslOfHex(output.hex);
            return { point: position(h0, out[1], out[2]), color: output.hex, label: output.token, kind: 'output' };
          }) : [];
          // A full-height wedge from the hue on: the side at the hue shows it
          // at every lightness and saturation, the colors Pi's range takes
          // from it.
          var faces = new MeshBuilder();
          var ls = steps(0, 1, LIGHTNESS_STEPS / 2);
          [h0, h0 + WEDGE].forEach(function(hue) {
            faces.grid(ls.length - 1, SATURATION_STEPS, function(j, k) {
              add(faces, hue, k / SATURATION_STEPS, ls[j], NOT_CUT);
            });
            faces.line([position(hue, 0, 0), position(hue, 1, 0), position(hue, 1, 1), position(hue, 0, 1)]);
          });
          faces.line([position(h0, 0, 0), position(h0, 0, 1)]);
          // The cut goes on past the side, out to a color outside sRGB.
          if (reason) faces.line([position(hsl[0], 1, l0), point]);
          // No ghost: the dots would cover the side.
          return {
            from: [h0, -1, -1], size: [WEDGE, OPEN, OPEN], wrap: 2 * Math.PI, faces: faces,
            point: point, ghost: false, markers: markers, missing: reason
          };
        }
      };
    },

    // A radial slice at the source's hue. Its edge is everything Pi makes
    // from the source at full saturation, one color per lightness: which
    // lightness Pi needs depends on the background and the role's contrast
    // rules. The interior sweeps Pi's saturation setting from 0 to 1. Only
    // the slice is rebuilt.
    //
    // The source is the ANSI color the role uses in the chosen terminal
    // theme; themes.json also has the colors Pi made from it there. Without
    // a palette, Pi uses the family's own color instead, which follows the
    // family's absolute curve without a chroma cap. The selection is only a
    // candidate, checked against the slice.
    'pi-range': function() {
      var role = PI_ROLES[0];
      var data = null; // themes.json, once loaded
      var theme = null; // one of data.themes
      var wanted = null; // a theme asked for before they loaded
      var noPalette = false;
      var ui = null; // the controls' elements
      var pair = null; // the pair it is in, if any
      // Redraws itself and the views beside it, which follow its source.
      var onChange = function() {};
      var changed = function() {
        onChange();
        instances.forEach(function(instance) {
          if (pair && instance.pair === pair && instance.shape.followsPair) instance.onSelect();
        });
        if (pair && pair.__colorPicker) pair.__colorPicker.setRange(pickerRange);
      };
      // For the pair's picker: colors Pi can make from the source.
      var pickerRange = {
        allows: function(lch) {
          if (!inside(lch, GAMUTS.srgb)) return false;
          var kind = check(lch, sliceHue(), currentRange().at);
          return kind === 'edge' || kind === 'inside';
        },
        hue: function() { return sliceHue() * 180 / Math.PI; }
      };
      var findTheme = function(name) {
        return (data && data.themes.filter(function(item) { return item.name === name; })[0]) || null;
      };
      var findRole = function(id) {
        return PI_ROLES.filter(function(item) { return item.id === id; })[0] || null;
      };
      var usesPalette = function() {
        return !noPalette && !!theme;
      };
      // OKHSL [hue, saturation, lightness] and OKLCH chroma, without a palette null.
      var source = function() {
        return usesPalette() ? okhslOfHex(theme.palette[role.slot]) : null;
      };
      var sliceHue = function() {
        var from = source();
        return from ? from[0] : PI_FAMILIES[role.family].hue * Math.PI / 180;
      };
      // The colors Pi made from the source in this theme. Tokens whose colors
      // differ only by rounding count as one, under the first token's name.
      var outputs = function() {
        if (!usesPalette()) return [];
        var kept = [];
        role.tokens.forEach(function(token) {
          var index = data.tokens.indexOf(token);
          if (index === -1) return;
          var hex = theme.palette[data.firstTokenIndex + index];
          var lch = lchOfHex(hex);
          if (kept.some(function(output) { return oklabDistance(lch, output.lch) <= MATCH_DISTANCE; })) return;
          kept.push({ hex: hex, token: token, lch: lch });
        });
        return kept;
      };

      // The theme's Pi colors, for a theme button's tiny terminal.
      var tokenColor = function(item, token) {
        return item.palette[data.firstTokenIndex + data.tokens.indexOf(token)];
      };
      var showName = function(item) {
        if (ui) ui.name.textContent = item ? item.name : '';
      };
      var update = function() {
        if (!ui) return;
        if (data && !ui.themeButtons.length) buildThemes();
        ui.themeButtons.forEach(function(button) {
          var checked = !!theme && button.dataset.name === theme.name;
          button.setAttribute('aria-checked', checked ? 'true' : 'false');
          button.tabIndex = checked ? 0 : -1;
        });
        showName(theme);
        ui.roles.value = role.id;
        ui.noPalette.setAttribute('aria-pressed', noPalette ? 'true' : 'false');
        ui.slots.classList.toggle('is-off', !usesPalette());
        ui.slots.hidden = !theme;
        ui.slotButtons.forEach(function(button) {
          var slot = Number(button.dataset.slot);
          var hex = theme ? theme.palette[slot] : '';
          button.style.background = hex;
          button.setAttribute('aria-pressed', usesPalette() && slot === role.slot ? 'true' : 'false');
          button.title = 'ANSI ' + ANSI_NAMES[slot] + (hex ? ' ' + hex : '');
        });
      };
      // Theme buttons as in the demo's picker: a row of dark themes and a
      // row of light ones, each a tiny terminal in Pi's colors.
      var buildThemes = function() {
        ['dark', 'light'].forEach(function(appearance) {
          var group = document.createElement('div');
          group.className = 'asciicast__theme-group';
          data.themes.forEach(function(item) {
            if (item.appearance !== appearance) return;
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'asciicast__theme';
            button.dataset.name = item.name;
            button.setAttribute('role', 'radio');
            button.setAttribute('aria-label', item.name);
            button.title = item.name;
            button.style.setProperty('--swatch-bg', item.background);
            var swatch = document.createElement('span');
            swatch.className = 'asciicast__swatch';
            ['accent', 'text', 'success'].forEach(function(token) {
              var line = document.createElement('span');
              line.className = 'asciicast__swatch-line';
              line.style.background = tokenColor(item, token);
              swatch.appendChild(line);
            });
            button.appendChild(swatch);
            button.addEventListener('click', function() { pickTheme(item.name); });
            button.addEventListener('mouseenter', function() { showName(item); });
            button.addEventListener('focus', function() { showName(item); });
            ui.themeButtons.push(button);
            group.appendChild(button);
          });
          ui.themes.appendChild(group);
        });
      };
      // The candidate: the last color picked since the source changed.
      var candidate = false;
      var resetting = false;
      var onSelect = function(color, isDefault) {
        if (resetting) return;
        if (!isDefault) {
          candidate = true;
        } else if (!candidate && data) {
          // Another default, such as the terminal's background: the source
          // takes precedence while no color is picked.
          Promise.resolve().then(function() { if (!candidate) showSource(); });
        }
        showTexts();
      };
      var sourceKey = function() {
        return [theme && theme.name, role.id, noPalette].join('\n');
      };
      // Without a candidate, the selection is the source (Pi's own color
      // without a palette), so the OKHSL cylinder and the sliders show it.
      var showSource = function() {
        var family = PI_FAMILIES[role.family];
        var lch = usesPalette() ? lchOfHex(theme.palette[role.slot]) :
          okhslToOklch(family.hue * Math.PI / 180, family.max, 0.5);
        resetting = true;
        try {
          select({ l: lch[0], c: lch[1], h: lch[2] * 180 / Math.PI }, true);
        } finally {
          resetting = false;
        }
      };
      // A new source makes the candidate meaningless: drop it. An article
      // color keeps its own candidate, which it selects right after.
      var setSource = function(spec, keep) {
        var before = sourceKey();
        if (spec.role) role = findRole(spec.role) || role;
        if (spec.theme) {
          if (data) theme = findTheme(spec.theme) || theme;
          else wanted = spec.theme;
        }
        if (spec.palette !== undefined) noPalette = !spec.palette;
        update();
        if (!keep) {
          if (sourceKey() !== before) candidate = false;
          if (!candidate) showSource();
        }
        showTexts();
        changed();
      };
      // The demo's theme picker: follow it into the new palette.
      // Follow the other pickers into the new palette.
      var onTheme = function(event) {
        var name = themeOf(event, onTheme);
        if (name && !(theme && theme.name === name)) setSource({ theme: name });
      };
      var pickTheme = function(name) {
        setSource({ theme: name, palette: true });
        announceTheme(name, onTheme);
      };
      var onArticle = function(spec) {
        setSource({ theme: spec.theme, role: spec.role, palette: true }, true);
        if (spec.theme) announceTheme(spec.theme, onTheme);
      };
      var load = function(url) {
        if (!url || typeof fetch !== 'function') return;
        fetch(url).then(function(response) { return response.json(); }).then(function(json) {
          if (!json || !json.themes) return;
          data = json;
          theme = findTheme(wanted) || findTheme(currentTheme(data)) || data.themes[0];
          update();
          if (!candidate) showSource();
          showTexts();
          changed();
        }).catch(function() {});
      };

      // Where the candidate is relative to the slice: on its edge, inside it,
      // or outside, by distance in OKLab.
      var check = function(lch, hue, at) {
        var hsl = oklchToOkhsl(lch[0], lch[1], lch[2]);
        var edge = okhslToOklch(hue, at(hsl[2], 1), hsl[2])[1];
        var along = lch[1] * Math.cos(lch[2] - hue);
        var across = Math.abs(lch[1] * Math.sin(lch[2] - hue));
        if (across > MATCH_DISTANCE || along < -MATCH_DISTANCE) return 'hue';
        if (along > edge + MATCH_DISTANCE) {
          var from = source();
          if (!from) return 'saturation';
          // The chroma cap or the saturation falloff, whichever stops it.
          var family = PI_FAMILIES[role.family];
          var falloff = Math.min(1, piSaturation(family, hsl[2]) / piSaturation(family, from[2]));
          var uncapped = okhslToOklch(hue, from[1] * falloff, hsl[2])[1];
          return uncapped > from[3] * falloff + 1e-6 ? 'chroma' : 'saturation';
        }
        return along < edge - MATCH_DISTANCE ? 'inside' : 'edge';
      };
      var near = function(lch, hex) {
        return oklabDistance(lch, lchOfHex(hex)) <= MATCH_DISTANCE;
      };
      // What the status line says, by kind; p has the details. Shared with
      // the reserve, which keeps the line as tall as its longest text.
      // The status line, by kind, always naming the source it compares with:
      // the theme's ANSI color, or without a palette Pi's own color for the
      // role. p has the details.
      var verdictText = function(kind, p) {
        var source = p.palette ? p.theme + '\u2019s ' + p.slot : 'Pi\u2019s own ' + p.role + ' color';
        switch (kind) {
          case 'none':
            return 'Pick a color to compare with ' + source + (p.palette ? ' (' + p.source + ').' : '.');
          case 'gamut': return 'The selected color is outside sRGB, so it can\u2019t come from ' + source + '.';
          case 'source': return p.hex + ' is ' + source + ' itself.';
          case 'output': return p.hex + ' is Pi\u2019s ' + p.token + ' on ' + p.theme + '.';
          case 'edge': return p.hex + ' can come from ' + source + ', on a background that needs this lightness.';
          case 'inside': return p.hex + ' can come from ' + source + ' at a lower saturation setting.';
          case 'hue': return p.hex + ' can\u2019t come from ' + source + ': its hue is ' + p.degrees + '\u00b0 off.';
          case 'chroma': return p.hex + ' can\u2019t come from ' + source + ': it is more colorful.';
          default: return p.hex + ' can\u2019t come from ' + source + ': it is too saturated at this lightness.';
        }
      };
      // What the status line says about the candidate, and how to mark it.
      var verdict = function(at, made) {
        var p = { palette: usesPalette(), role: role.label.toLowerCase(), theme: theme && theme.name,
          slot: ANSI_NAMES[role.slot], source: theme && theme.palette[role.slot] };
        if (!candidate) return { text: verdictText('none', p) };
        var lch = selected();
        if (!inside(lch, GAMUTS.srgb)) return { text: verdictText('gamut', p), outside: true };
        p.hex = hexOf(oklchToRgb(lch[0], lch[1], lch[2], GAMUTS.srgb));
        if (p.palette && near(lch, theme.palette[role.slot])) return { text: verdictText('source', p) };
        var match = made.filter(function(output) { return near(lch, output.hex); })[0];
        if (match) {
          p.token = match.token;
          return { text: verdictText('output', p), match: match };
        }
        var hue = sliceHue();
        var kind = check(lch, hue, at);
        p.degrees = Math.abs(Math.round(((lch[2] - hue) * 180 / Math.PI % 360 + 540) % 360 - 180));
        var outside = kind !== 'edge' && kind !== 'inside';
        var hsl = oklchToOkhsl(lch[0], lch[1], lch[2]);
        return { text: verdictText(kind, p), outside: outside, marker: {
          point: cylinderPosition(hsl[0], hsl[1], hsl[2]), color: p.hex, label: p.hex,
          kind: 'candidate', outside: outside
        } };
      };
      var longest = function(values) {
        return values.reduce(function(best, value) { return value.length > best.length ? value : best; }, '');
      };
      // Every text the status line can show, with the longest names, so that
      // it keeps one height whatever is picked.
      var verdictReserve = function() {
        var tokens = [];
        PI_ROLES.forEach(function(item) { tokens = tokens.concat(item.tokens); });
        var p = { hex: '#000000', source: '#000000', degrees: 180, token: longest(tokens), slot: longest(ANSI_NAMES),
          theme: longest(data ? data.themes.map(function(item) { return item.name; }) : ['']),
          role: longest(PI_ROLES.map(function(item) { return item.label.toLowerCase(); })) };
        var texts = [];
        ['none', 'gamut', 'source', 'output', 'edge', 'inside', 'hue', 'chroma', 'saturation'].forEach(function(kind) {
          [true, false].forEach(function(palette) {
            p.palette = palette;
            texts.push(verdictText(kind, p));
          });
        });
        return texts;
      };

      // The slice for the current source: its family, source (null without
      // a palette), hue, and saturation at a lightness for a setting.
      var currentRange = function() {
        var family = PI_FAMILIES[role.family];
        var from = source();
        return { family: family, from: from, palette: !!from, hue: sliceHue(), at: function(lightness, multiplier) {
          return from ? piRangeSaturation(from, family, lightness, multiplier) :
            piFallbackSaturation(family, lightness, multiplier);
        } };
      };
      // The result for the picked color. Not only when drawing: it stays
      // current while the views are scrolled away.
      var showTexts = function() {
        var range = currentRange();
        var made = outputs();
        var result = verdict(range.at, made);
        if (ui) {
          var texts = { current: result.text };
          verdictReserve().forEach(function(text, index) { texts['reserve' + index] = text; });
          stackTexts(ui.status, ui.statusTexts, texts, 'current');
          ui.status.classList.toggle('is-outside', !!result.outside);
        }
        return { made: made, result: result };
      };

      // The slice: its hue, its saturation at each row (lightness) for each
      // setting (column), and the dot, for the current source.
      var sampled = null;
      var sliceState = function() {
        var key = sourceKey();
        if (sampled && sampled.key === key) return sampled;
        var range = currentRange();
        // The source's own lightness as a row, so the edge passes through it.
        var rows = steps(0, 1, LIGHTNESS_STEPS);
        if (range.palette && range.from[2] > 0 && range.from[2] < 1) rows.push(range.from[2]);
        rows.sort(function(a, b) { return a - b; });
        var lightness = range.palette ? range.from[2] : 0.5;
        sampled = { key: key, hue: range.hue, rows: rows,
          sats: rows.map(function(row) {
            return steps(0, 1, SATURATION_STEPS).map(function(multiplier) { return range.at(row, multiplier); });
          }),
          point: [range.hue, range.at(lightness, 1), lightness] };
        return sampled;
      };

      var reference = new MeshBuilder();
      [0, 1].forEach(function(lightness) {
        reference.line(steps(0, 2 * Math.PI, SIDE_STEPS).map(function(hue) {
          return cylinderPosition(hue, 1, lightness);
        }));
      });
      for (var i = 0; i < 8; i++) {
        var hue = i / 8 * 2 * Math.PI;
        reference.line([cylinderPosition(hue, 1, 0), cylinderPosition(hue, 1, 1)]);
      }
      reference.line([[0, 0, 0], [0, 1, 0]]);
      var facing = function() { return facingHue(sliceHue()); };
      return {
        gamut: GAMUTS.srgb,
        mesh: reference.build(null, true),
        yaw: facing(),
        pitch: 0.45,
        facing: facing,
        // Below both views in a pair: the theme, and the source's ANSI
        // color with the role.
        panel: true,
        controls: function(redraw, figure) {
          onChange = redraw;
          var box = document.createElement('div');
          box.className = 'color-space__source';
          var status = document.createElement('p');
          status.className = 'color-space__verdict';
          status.setAttribute('aria-live', 'polite');

          var themes = document.createElement('div');
          themes.className = 'asciicast__themes';
          themes.setAttribute('role', 'radiogroup');
          themes.setAttribute('aria-label', 'Terminal theme');
          // Arrow keys move through all themes, as in a radio group.
          themes.addEventListener('keydown', function(event) {
            var buttons = ui.themeButtons;
            var position = buttons.map(function(button) { return button.dataset.name; }).indexOf(theme && theme.name);
            var next = null;
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (position + 1) % buttons.length;
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (position - 1 + buttons.length) % buttons.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = buttons.length - 1;
            if (next === null || !buttons.length) return;
            event.preventDefault();
            pickTheme(buttons[next].dataset.name);
            buttons[next].focus();
          });
          themes.addEventListener('mouseleave', function() { showName(theme); });
          themes.addEventListener('focusout', function() { showName(theme); });
          box.appendChild(themes);

          // The theme's name and the ANSI colors Pi uses, one of which is the
          // source: picking one picks a role that uses it. Then the role and
          // the palette switch.
          var row = document.createElement('div');
          row.className = 'color-space__recipe';
          var slots = document.createElement('div');
          slots.className = 'color-space__ansi';
          slots.setAttribute('role', 'group');
          slots.setAttribute('aria-label', 'Source: the ANSI colors Pi uses');
          var used = [];
          PI_ROLES.forEach(function(item) {
            if (used.indexOf(item.slot) === -1) used.push(item.slot);
          });
          var slotButtons = used.sort(function(a, b) { return a - b; }).map(function(slot) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'color-space__ansi-color';
            button.dataset.slot = String(slot);
            button.setAttribute('aria-label', 'ANSI ' + ANSI_NAMES[slot]);
            button.addEventListener('click', function() {
              var next = role.slot === slot ? role : PI_ROLES.filter(function(item) { return item.slot === slot; })[0];
              setSource({ role: next.id, palette: true });
            });
            slots.appendChild(button);
            return button;
          });
          // The theme's name, left of its colors.
          var name = document.createElement('span');
          name.className = 'color-space__theme-name';
          name.setAttribute('aria-hidden', 'true');
          row.appendChild(name);
          row.appendChild(slots);
          var label = document.createElement('label');
          var title = document.createElement('span');
          title.textContent = 'Role';
          var roles = document.createElement('select');
          var groups = {};
          PI_ROLES.forEach(function(item) {
            if (!groups[item.group]) {
              groups[item.group] = document.createElement('optgroup');
              groups[item.group].label = item.group;
              roles.appendChild(groups[item.group]);
            }
            var option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.label;
            groups[item.group].appendChild(option);
          });
          roles.addEventListener('change', function() { setSource({ role: roles.value }); });
          label.appendChild(title);
          label.appendChild(roles);
          row.appendChild(label);
          var noPaletteButton = document.createElement('button');
          noPaletteButton.type = 'button';
          noPaletteButton.textContent = 'No palette';
          noPaletteButton.addEventListener('click', function() { setSource({ palette: noPalette }); });
          row.appendChild(noPaletteButton);
          box.appendChild(row);

          ui = { status: status, statusTexts: {}, themes: themes, themeButtons: [], name: name, roles: roles, slots: slots,
            slotButtons: slotButtons, noPalette: noPaletteButton };
          update();
          showTexts();
          sourceListeners.push(onArticle);
          listeners.push(onSelect);
          followThemes(onTheme);
          // The OKHSL cylinder beside it cuts at the source's hue and marks
          // Pi's outputs.
          pair = figure.closest('[data-color-space-pair]');
          if (pair) pair.__piRange = { hue: sliceHue, outputs: outputs };
          if (pair && pair.__colorPicker) pair.__colorPicker.setRange(pickerRange);
          load(figure.getAttribute('data-pi-themes'));
          // The result for the picked color goes below the color sliders.
          return { el: box, below: status };
        },
        destroy: function() {
          if (pair && pair.__piRange && pair.__piRange.outputs === outputs) delete pair.__piRange;
          if (pair && pair.__colorPicker && pair.__colorPicker.range === pickerRange) pair.__colorPicker.setRange(null);
          var index = listeners.indexOf(onSelect);
          if (index !== -1) listeners.splice(index, 1);
          index = sourceListeners.indexOf(onArticle);
          if (index !== -1) sourceListeners.splice(index, 1);
          unfollowThemes(onTheme);
        },
        cut: function() {
          var state = sliceState();
          var faces = new MeshBuilder();
          faces.grid(state.rows.length - 1, SATURATION_STEPS, function(i, j) {
            var saturation = state.sats[i][j];
            faces.vertex(cylinderPosition(state.hue, saturation, state.rows[i]),
              okhslToRgb(state.hue, saturation, state.rows[i], GAMUTS.srgb), NOT_CUT);
          });
          faces.line(state.rows.map(function(lightness, i) {
            return cylinderPosition(state.hue, state.sats[i][SATURATION_STEPS], lightness);
          }));
          faces.line([[0, 0, 0], [0, 1, 0]]);

          var shown = showTexts();
          var markers = shown.made.map(function(output) {
            var hsl = okhslOfHex(output.hex);
            return { point: cylinderPosition(hsl[0], hsl[1], hsl[2]), color: output.hex, label: output.token,
              kind: 'output', match: output === shown.result.match };
          });
          if (shown.result.marker) markers.push(shown.result.marker);
          // The dot in the color where it is, also while it moves.
          var dot = state.point;
          return { from: NO_CUT.from, size: NO_CUT.size, wrap: 0, faces: faces,
            point: cylinderPosition(dot[0], dot[1], dot[2]),
            color: okhslCss(dot[0], dot[1], dot[2]), markers: markers };
        }
      };
    }
  };

  var VERTEX_SHADER = [
    'attribute vec3 position;',
    'attribute vec3 color;',
    'attribute vec3 coords;',
    'attribute float keep;',
    'uniform mat4 matrix;',
    'uniform float depthBias;', // toward the camera, for the lens's probe
    'varying vec3 vColor;',
    'varying vec3 vCoords;',
    'varying float vKeep;',
    'void main() {',
    '  vColor = color;',
    '  vCoords = coords;',
    '  vKeep = keep;',
    '  gl_Position = matrix * vec4(position, 1.0);',
    '  gl_Position.z -= depthBias * gl_Position.w;',
    '  gl_PointSize = 3.0;', // the lens's visibility probe
    '}'
  ].join('\n');

  // Unlit: every point shows exactly its own color. Lines are drawn in a
  // single, premultiplied color instead. Fragments inside the cut, and the
  // parts of the cut's faces outside the shape, are discarded. In the ghost
  // pass it is the other way round: only the surfaces inside the cut are
  // drawn, as soft round dots on a grid of `ghost.x` device pixels with a
  // radius of `ghost.y`, at `ghost.z` opacity.
  var FRAGMENT_SHADER = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform vec4 outline;',
    'uniform vec3 cutFrom;',
    'uniform vec3 cutSize;',
    'uniform float cutWrap;',
    'uniform vec3 ghost;',
    'varying vec3 vColor;',
    'varying vec3 vCoords;',
    'varying float vKeep;',
    'void main() {',
    '  if (vKeep < 0.0) discard;',
    '  vec3 d = vCoords - cutFrom;',
    '  if (cutWrap > 0.0) d.x = mod(d.x, cutWrap);',
    '  bool cut = all(greaterThan(d, vec3(0.0))) && all(lessThan(d, cutSize));',
    '  if (ghost.z > 0.0) {',
    '    if (!cut) discard;',
    '    vec2 cell = mod(gl_FragCoord.xy, ghost.x) - 0.5 * ghost.x;',
    '    float alpha = ghost.z * (1.0 - smoothstep(ghost.y - 0.6, ghost.y + 0.6, length(cell)));',
    '    if (alpha <= 0.0) discard;',
    '    gl_FragColor = vec4(vColor * alpha, alpha);',
    '    return;',
    '  }',
    '  if (cut) discard;',
    '  gl_FragColor = outline.a > 0.0 ? outline : vec4(vColor, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  // Column-major 4x4 matrices.
  function multiply(a, b) {
    var out = new Float32Array(16);
    for (var col = 0; col < 4; col++) {
      for (var row = 0; row < 4; row++) {
        var sum = 0;
        for (var k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
        out[col * 4 + row] = sum;
      }
    }
    return out;
  }

  function perspective(fov, aspect, near, far) {
    var f = 1 / Math.tan(fov / 2);
    var out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) / (near - far);
    out[11] = -1;
    out[14] = 2 * far * near / (near - far);
    return out;
  }

  // Camera at distance on +z, looking at the origin, with the shape turned
  // by yaw (around the vertical) and tipped toward the camera by pitch.
  function view(yaw, pitch, distance) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    return new Float32Array([
      cy, sp * sy, -cp * sy, 0,
      0, cp, sp, 0,
      sy, -sp * cy, cp * cy, 0,
      0, 0, -distance, 1
    ]);
  }

  function ColorSpace(figure, kind) {
    var self = this;
    this.figure = figure;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'color-space__canvas';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'img');
    var fallback = figure.querySelector('.color-space__fallback');
    if (fallback) this.canvas.setAttribute('aria-label', fallback.textContent.trim());
    // Multisampling quadruples the color and depth buffers. At two device
    // pixels per CSS pixel and more, edges are fine enough without it.
    var gl = this.canvas.getContext('webgl', {
      antialias: (window.devicePixelRatio || 1) < 2, premultipliedAlpha: true
    });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.loseContext = gl.getExtension('WEBGL_lose_context');

    var gamut = pickGamut(gl);
    figure.setAttribute('data-gamut', gamut.canvas);
    this.canvasSpace = gamut.canvas; // set again on restore
    this.shape = SHAPES[kind](gamut, figure);
    this.cut = null; // set on the first draw
    this.cutChanged = true;
    this.lineColor = null; // [r, g, b, a], cached per textColor.epoch
    this.lineEpoch = -1;
    // The context: ready to draw (set up), wanted (near the viewport; null
    // until known), released by us to free its buffers, or between losing
    // and restoring.
    this.ready = false;
    this.wanted = typeof IntersectionObserver === 'function' ? null : true;
    this.released = false;
    this.pending = false;

    this.yaw = this.shape.yaw;
    this.pitch = this.shape.pitch;
    this.velocity = 0; // yaw per ms, after letting go of a drag
    this.target = null; // a turn toward the cut: { from, to, start }
    this.drag = null;
    this.lastInteraction = -Infinity;
    this.visible = false;
    this.frame = null;
    this.last = null;
    this.width = 0;
    this.height = 0;

    // The canvas, with the lens on top of it.
    this.stage = document.createElement('div');
    this.stage.className = 'color-space__stage';
    this.stage.appendChild(this.canvas);
    this.lens = document.createElement('div');
    this.lens.className = 'color-space__lens';
    this.lens.setAttribute('aria-hidden', 'true');
    this.lensLabel = document.createElement('span');
    this.lensLabel.className = 'color-space__lens-label';
    this.lens.appendChild(this.lensLabel);
    this.stage.appendChild(this.lens);
    this.markerLenses = []; // for the cut's markers, which Pi's range has
    figure.insertBefore(this.stage, figure.querySelector('.color-space__fallback'));
    this.pair = figure.closest('[data-color-space-pair]');
    this.picker = null;
    // A paired figure owns one shared source picker below both canvases.
    if (!this.pair || !this.pair.__colorPicker) {
      // The RGB cube is about RGB, so its RGB sliders come first.
      this.picker = new Picker(this.shape.gamut, kind === 'rgb');
      // The instructions, behind a "?" in the top right corner: one for a
      // figure, or for a pair.
      var host = this.pair || figure;
      var help = host.querySelector('.color-space__help');
      if (help && !host.querySelector('.color-space__help-tip')) {
        this.helpTip = helpTip(help.textContent.trim());
        host.appendChild(this.helpTip);
      }
      if (this.pair) {
        this.pair.__colorPicker = this.picker;
        this.pair.appendChild(this.picker.el);
        this.pair.classList.add('is-enhanced');
      } else {
        figure.insertBefore(this.picker.el, figure.querySelector('figcaption'));
      }
    }
    figure.classList.add('is-enhanced');

    this.onSelect = function() {
      self.cutChanged = true;
      // In a pair, a shape that follows its partner leaves the facing to it.
      if (self.shape.facing && !self.drag && !(self.pair && self.shape.followsPair)) {
        self.turnTo(self.shape.facing());
      }
      self.schedule();
    };
    listeners.push(this.onSelect);
    if (this.shape.controls) {
      // Controls are an element, or one with an element for below the
      // pair's picker.
      var controls = this.shape.controls(this.onSelect, figure);
      var below = controls.below || null;
      controls = controls.el || controls;
      if (this.pair && this.shape.panel) {
        // Full width below both views, above the pair's picker.
        this.panel = controls;
        var picker = this.pair.__colorPicker && this.pair.__colorPicker.el;
        this.pair.insertBefore(controls, picker || null);
        if (below) {
          this.below = below;
          this.pair.insertBefore(below, picker ? picker.nextSibling : null);
        }
      } else {
        figure.insertBefore(controls, figure.querySelector('figcaption'));
        if (below) figure.insertBefore(below, figure.querySelector('figcaption'));
      }
    }

    this.canvas.addEventListener('pointerdown', function(event) { self.pointerDown(event); });
    this.canvas.addEventListener('pointermove', function(event) { self.pointerMove(event); });
    this.canvas.addEventListener('pointerup', function(event) { self.pointerUp(event); });
    this.canvas.addEventListener('pointercancel', function(event) { self.pointerUp(event); });
    this.canvas.addEventListener('keydown', function(event) { self.keyDown(event); });
    // Lost by us, far from the viewport, or by the browser, which restores
    // it on its own once allowed to (preventDefault). Either way, every
    // resource is created again on restore.
    this.canvas.addEventListener('webglcontextlost', function(event) {
      event.preventDefault();
      self.ready = false;
      self.pending = false;
      // The buffers went with the context; restoring makes new ones.
      self.surfaces = self.probe = null;
      if (self.cut) self.cut.buffers = null;
      self.sync();
    });
    this.canvas.addEventListener('webglcontextrestored', function() {
      self.released = false;
      self.pending = false;
      self.sync();
    });

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(function() { self.draw(); });
      this.resizeObserver.observe(this.canvas);
    }
    if (typeof IntersectionObserver === 'function') {
      this.visibilityObserver = new IntersectionObserver(function(entries) {
        self.visible = entries[entries.length - 1].isIntersecting;
        self.schedule();
      });
      this.visibilityObserver.observe(this.canvas);
      this.nearObserver = new IntersectionObserver(function(entries) {
        self.wanted = entries[entries.length - 1].isIntersecting;
        self.sync();
      }, { rootMargin: KEEP_MARGIN });
      this.nearObserver.observe(this.canvas);
    } else {
      this.visible = true;
    }
    this.sync();
  }

  // Creates everything the context holds: the program and its state, the
  // surfaces' buffers, and the lens's probe. The cut's buffers follow on
  // the next draw. Runs once the figure comes near the viewport, and again
  // whenever the context is restored.
  ColorSpace.prototype.setup = function() {
    var self = this;
    var gl = this.gl;
    var program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    this.uniforms = {};
    ['matrix', 'depthBias', 'outline', 'cutFrom', 'cutSize', 'cutWrap', 'ghost'].forEach(function(name) {
      self.uniforms[name] = gl.getUniformLocation(program, name);
    });
    this.attributes = ['position', 'color', 'coords', 'keep'].map(function(name) {
      var location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      return location;
    });
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    // Lines run along surfaces, so push the surfaces back a little.
    gl.polygonOffset(1, 1);
    gl.clearColor(0, 0, 0, 0);
    if (this.canvasSpace !== 'srgb') gl.drawingBufferColorSpace = this.canvasSpace;
    // The surfaces never change. Their vertices stay in memory, compact,
    // for restoring; building them again would be slower.
    this.surfaces = this.upload(this.shape.mesh, null, gl.STATIC_DRAW);
    this.probe = { vertices: gl.createBuffer(), data: new Float32Array(STRIDE) };
    this.probe.data.set([0, 0, 0, 0, 0, 0].concat(NOT_CUT, [1]));
    this.cutChanged = true;
    this.width = this.height = 0; // the drawing buffer is new
    this.ready = true;
  };

  // Moves the context toward what is wanted: set up near the viewport,
  // released far from it, and restored on the way back. One change at a
  // time; the context events call back when one is done. A context the
  // browser lost comes back on its own.
  ColorSpace.prototype.sync = function() {
    var lose = this.loseContext;
    if (this.pending || !this.figure.isConnected) return;
    var lost = this.gl.isContextLost();
    if (this.wanted && !this.ready) {
      if (!lost) {
        try {
          this.setup();
        } catch (error) {
          if (window.console) console.warn('Color space figure unavailable:', error);
          return;
        }
        this.draw();
        this.schedule();
      } else if (this.released && lose) {
        this.pending = true;
        lose.restoreContext();
      }
    } else if (this.wanted === false && !lost && lose) {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      if (this.probeTimer) clearTimeout(this.probeTimer);
      this.frame = this.probeTimer = null;
      this.last = null;
      this.ready = false;
      this.released = true;
      this.pending = true;
      lose.loseContext();
    }
  };

  // Uploads a built mesh into buffers, or into existing ones.
  ColorSpace.prototype.upload = function(mesh, buffers, usage) {
    var gl = this.gl;
    usage = usage || gl.DYNAMIC_DRAW;
    buffers = buffers || { vertices: gl.createBuffer(), indices: gl.createBuffer() };
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertices);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, usage);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, usage);
    buffers.triangles = mesh.triangles;
    buffers.lines = mesh.lines;
    return buffers;
  };

  ColorSpace.prototype.bind = function(buffers) {
    var gl = this.gl;
    var sizes = [3, 3, 3, 1];
    var offset = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertices);
    if (buffers.indices) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
    this.attributes.forEach(function(location, index) {
      gl.vertexAttribPointer(location, sizes[index], gl.FLOAT, false, STRIDE * 4, offset * 4);
      offset += sizes[index];
    });
  };

  // Rebuilds the cut at the selected color.
  ColorSpace.prototype.updateCut = function() {
    var cut = this.shape.cut();
    var offset = this.shape.mesh.offset;
    var faces = cut.faces.build(offset);
    this.cut = {
      from: cut.from,
      size: cut.size,
      wrap: cut.wrap,
      ghost: cut.ghost !== false,
      point: cut.point.map(function(value, axis) { return value - offset[axis]; }),
      markers: this.updateMarkers(cut.markers || [], offset),
      buffers: this.upload(faces, this.cut && this.cut.buffers)
    };
    this.cutChanged = false;
    this.cutProbed = false; // probe right away
    this.lens.classList.toggle('is-missing', !!cut.missing);
    this.lensLabel.textContent = cut.missing || '';
    this.lens.style.setProperty('--lens-color', cut.color || css(selection.l, selection.c, selection.h));
  };

  // A lens for each marker, labeled, with the marker's position relative to
  // the mesh. Pi's range has two kinds: squares for the colors Pi made
  // (output) and a ring for the candidate, red when Pi cannot make it.
  ColorSpace.prototype.updateMarkers = function(markers, offset) {
    var lenses = this.markerLenses;
    while (lenses.length < markers.length) {
      var lens = document.createElement('div');
      lens.className = 'color-space__lens is-marker';
      lens.setAttribute('aria-hidden', 'true');
      lens.appendChild(document.createElement('span')).className = 'color-space__lens-label';
      this.stage.appendChild(lens);
      lenses.push(lens);
    }
    while (lenses.length > markers.length) lenses.pop().remove();
    return markers.map(function(marker, index) {
      var lens = lenses[index];
      lens.style.setProperty('--lens-color', marker.color);
      lens.classList.toggle('is-output', marker.kind === 'output');
      lens.classList.toggle('is-candidate', marker.kind === 'candidate');
      lens.classList.toggle('is-outside', !!marker.outside);
      lens.classList.toggle('is-match', !!marker.match);
      lens.firstChild.textContent = marker.label;
      return {
        lens: lens,
        point: marker.point.map(function(value, axis) { return value - offset[axis]; })
      };
    });
  };

  // Stacks texts in one grid cell (prose.css) and shows the active one:
  // the cell is as tall as the longest. spans caches a span per key.
  function stackTexts(container, spans, texts, active) {
    container.classList.add('color-space__captions');
    Object.keys(texts).forEach(function(key) {
      var span = spans[key];
      if (!span) {
        span = spans[key] = document.createElement('span');
        container.appendChild(span);
      }
      if (span.textContent !== texts[key]) span.textContent = texts[key];
      span.classList.toggle('is-active', key === active);
    });
  }

  // How far the camera is: far enough that the shape's bounding cylinder
  // fits at every pitch, so turning the shape never changes its size.
  ColorSpace.prototype.distance = function(aspect) {
    if (this.fit && this.fit.aspect === aspect) return this.fit.distance;
    var bounds = this.shape.mesh;
    var tan = Math.tan(FOV / 2);
    var distance = 0;
    for (var i = 0; i <= 32; i++) {
      var pitch = MIN_PITCH + (MAX_PITCH - MIN_PITCH) * i / 32;
      var cos = Math.cos(pitch), sin = Math.abs(Math.sin(pitch));
      var tall = bounds.spread * sin + bounds.halfHeight * cos;
      var near = bounds.spread * cos + bounds.halfHeight * sin;
      // The nearest point is rarely at the silhouette's edge, so part of
      // its distance is enough.
      distance = Math.max(distance, near * 0.75 + Math.max(bounds.spread / (tan * aspect), tall / tan));
    }
    this.fit = { aspect: aspect, distance: distance };
    return distance;
  };

  // Moves the lens over the selected color, faded where the shape hides it.
  // Whether it does is probed after drawing: a dot in a color unlike the
  // pixel there, drawn at the color's depth, shows up only if nothing is in
  // front of it. The lens covers the dot. Reading pixels back waits for the
  // GPU, so the probe runs a few times a second, not every frame; the
  // lens's fade covers the delay. Markers have lenses of their own, placed
  // and probed the same way.
  ColorSpace.prototype.placeLens = function(matrix, ratio) {
    var self = this;
    var lenses = [{ lens: this.lens, point: this.cut.point }].concat(this.cut.markers);
    var spots = lenses.map(function(item) {
      var p = item.point;
      var m = matrix;
      var x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      var y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      var w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      var left = (x / w * 0.5 + 0.5) * self.canvas.clientWidth;
      var top = (0.5 - y / w * 0.5) * self.canvas.clientHeight;
      item.lens.style.transform = 'translate(' + left.toFixed(1) + 'px, ' + top.toFixed(1) + 'px)';
      return { left: left, top: top, w: w };
    });
    this.placeLabels(lenses, spots);
    var now = performance.now();
    var wait = PROBE_MS - (now - (this.probedAt || 0));
    if (this.cutProbed && wait > 0) {
      // Probe once more when it is time, in case nothing draws by then.
      if (!this.probeTimer) {
        this.probeTimer = setTimeout(function() {
          self.probeTimer = null;
          if (self.figure.isConnected) self.draw();
        }, wait);
      }
      return;
    }
    this.probedAt = now;
    this.cutProbed = true;
    lenses.forEach(function(item, index) {
      var visible = self.probeLens(item.point, spots[index], ratio);
      item.lens.classList.toggle('is-behind', !visible);
      item.lens.classList.add('is-placed');
    });
  };

  // Markers' labels go right of them, or left where that would cover a
  // marker or an earlier label, or nowhere where both would. The candidate,
  // last, goes first, then the markers in order.
  ColorSpace.prototype.placeLabels = function(lenses, spots) {
    var taken = lenses.map(function(item, index) {
      var half = item.lens.offsetWidth / 2;
      return [spots[index].left - half, spots[index].top - half, spots[index].left + half, spots[index].top + half];
    });
    var overlaps = function(box) {
      return taken.some(function(other) {
        return box[0] < other[2] && other[0] < box[2] && box[1] < other[3] && other[1] < box[3];
      });
    };
    var order = lenses.slice(1).map(function(item, index) { return index + 1; });
    var first = function(index) { return lenses[index].lens.classList.contains('is-candidate') ? 0 : 1; };
    order.sort(function(a, b) { return first(a) - first(b) || a - b; });
    order.forEach(function(index) {
      var lens = lenses[index].lens, spot = spots[index];
      var label = lens.firstChild;
      var width = label.offsetWidth || label.textContent.length * 8;
      var half = lens.offsetWidth / 2 + 8;
      var right = [spot.left + half, spot.top - 10, spot.left + half + width, spot.top + 10];
      var left = [spot.left - half - width, spot.top - 10, spot.left - half, spot.top + 10];
      var box = !overlaps(right) ? right : !overlaps(left) ? left : null;
      lens.classList.toggle('is-label-left', box === left);
      lens.classList.toggle('is-label-hidden', !box);
      if (box) taken.push(box);
    });
  };

  // Whether the point at the spot, in CSS pixels, is in front of the shape.
  ColorSpace.prototype.probeLens = function(p, spot, ratio) {
    var gl = this.gl;
    var px = Math.floor(spot.left * ratio), py = Math.floor(this.height - spot.top * ratio);
    var visible = false;
    if (spot.w > 0 && px >= 0 && py >= 0 && px < this.width && py < this.height) {
      var pixel = new Uint8Array(4);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      var probe = [0, 1, 2].map(function(channel) { return pixel[channel] < 128 ? 1 : 0; });
      this.probe.data.set(p, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.probe.vertices);
      gl.bufferData(gl.ARRAY_BUFFER, this.probe.data, gl.DYNAMIC_DRAW);
      this.bind(this.probe);
      gl.uniform4f(this.uniforms.outline, probe[0], probe[1], probe[2], 1);
      // The color sits where the cut's faces meet, and they come toward the
      // camera from there: without a nudge, they would cover the dot's edges.
      gl.uniform1f(this.uniforms.depthBias, 0.01);
      gl.drawArrays(gl.POINTS, 0, 1);
      gl.uniform1f(this.uniforms.depthBias, 0);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      visible = probe.every(function(value, channel) { return Math.abs(pixel[channel] - value * 255) < 64; });
    }
    return visible;
  };

  ColorSpace.prototype.idle = function(now) {
    return !this.pair && !this.drag && !prefersReducedMotion() &&
      now - this.lastInteraction > RESUME_IDLE_MS;
  };

  ColorSpace.prototype.animating = function() {
    return this.drag || this.target !== null || Math.abs(this.velocity) > 1e-5 ||
      this.idle(performance.now()) || fadingColor();
  };

  // Turns to a yaw the short way round, as one solid object: the cut has
  // already changed, and turns into view over TURN_MS, easing out.
  ColorSpace.prototype.turnTo = function(yaw) {
    var delta = angleTo(this.yaw, yaw);
    if (this.target && Math.abs(angleTo(this.target.to, yaw)) < 1e-6) return;
    if (Math.abs(delta) < 1e-4) {
      this.target = null;
      return;
    }
    if (prefersReducedMotion()) {
      this.yaw += delta;
      this.target = null;
      return;
    }
    this.target = { from: this.yaw, to: this.yaw + delta, start: performance.now() };
  };

  ColorSpace.prototype.schedule = function() {
    var self = this;
    if (this.frame !== null || !this.visible || !this.ready) return;
    this.frame = requestAnimationFrame(function(now) { self.tick(now); });
  };

  ColorSpace.prototype.tick = function(now) {
    this.frame = null;
    // A passive peer may already have a queued frame. It must not cancel
    // the active view's target animation when it redraws the shared camera.
    var moving = this.animating();
    if (!this.figure.isConnected) {
      this.destroy();
      return;
    }
    if (this.last !== null && moving) watchFrame(now, now - this.last);
    var dt = this.last === null ? 0 : Math.min(now - this.last, 100);
    this.last = now;
    if (!this.drag) {
      if (this.target !== null) {
        var turn = this.target;
        var e = Math.min(1, (now - turn.start) / TURN_MS);
        this.yaw = turn.from + (turn.to - turn.from) * easeOut(e);
        if (e >= 1) this.target = null;
        this.velocity = 0;
      } else if (Math.abs(this.velocity) > 1e-5) {
        this.yaw += this.velocity * dt;
        this.velocity *= Math.pow(0.995, dt);
      } else {
        this.velocity = 0;
        // Ease back into the idle rotation instead of starting abruptly.
        var since = now - this.lastInteraction - RESUME_IDLE_MS;
        if (this.idle(now)) this.yaw += IDLE_SPEED * dt * Math.min(1, since / 1000);
      }
    }
    this.draw();
    if (moving) this.syncView();
    if (this.animating()) {
      this.schedule();
    } else {
      this.last = null;
      resetFrameWatch();
    }
  };

  // The figure's text color for lines, as [r, g, b, a] in 0-255 and 0-1.
  ColorSpace.prototype.textColor = function() {
    if (this.lineEpoch !== textColor.epoch || fadingColor()) {
      var rgba = (getComputedStyle(this.figure).color.match(/[\d.]+/g) || [128, 128, 128]).map(Number);
      if (rgba.length < 4) rgba[3] = 1;
      this.lineColor = rgba;
      this.lineEpoch = textColor.epoch;
    }
    return this.lineColor;
  };

  ColorSpace.prototype.draw = function() {
    if (!this.ready) return;
    var gl = this.gl;
    var ratio = pixelRatio();
    var width = Math.round(this.canvas.clientWidth * ratio);
    var height = Math.round(this.canvas.clientHeight * ratio);
    if (!width || !height) return;
    if (width !== this.width || height !== this.height) {
      this.canvas.width = this.width = width;
      this.canvas.height = this.height = height;
    }
    if (this.cutChanged) this.updateCut();
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    var aspect = width / height;
    var bounds = this.shape.mesh;
    var distance = this.distance(aspect);
    var matrix = multiply(
      perspective(FOV, aspect, Math.max(0.01, distance - bounds.radius * 1.1), distance + bounds.radius * 1.1),
      view(this.yaw, this.pitch, distance)
    );
    var u = this.uniforms;
    var cut = this.cut;
    gl.uniformMatrix4fv(u.matrix, false, matrix);
    gl.uniform3fv(u.cutFrom, cut.from);
    gl.uniform3fv(u.cutSize, cut.size);
    gl.uniform1f(u.cutWrap, cut.wrap);
    gl.uniform4f(u.outline, 0, 0, 0, 0);
    gl.uniform3f(u.ghost, 0, 0, 0);
    var parts = [this.surfaces, cut.buffers];
    var self = this;
    gl.enable(gl.POLYGON_OFFSET_FILL);
    parts.forEach(function(buffers) {
      self.bind(buffers);
      gl.drawElements(gl.TRIANGLES, buffers.triangles, gl.UNSIGNED_SHORT, 0);
    });
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // The ghost of what the cut removed: hidden by the shape in front of it,
    // but not hiding the cut behind it.
    if (cut.size[0] > 0 && cut.ghost) {
      gl.depthMask(false);
      gl.uniform3f(u.ghost, GHOST_SPACING * ratio, GHOST_RADIUS * ratio, GHOST_ALPHA);
      this.bind(this.surfaces);
      gl.drawElements(gl.TRIANGLES, this.surfaces.triangles, gl.UNSIGNED_SHORT, 0);
      gl.uniform3f(u.ghost, 0, 0, 0);
      gl.depthMask(true);
    }
    // Lines in the figure's text color, so they follow day and night.
    var rgba = this.textColor();
    parts.forEach(function(buffers, index) {
      if (!buffers.lines) return;
      var alpha = (index ? CUT_LINE_ALPHA : OUTLINE_ALPHA) * rgba[3];
      gl.uniform4f(u.outline, rgba[0] / 255 * alpha, rgba[1] / 255 * alpha, rgba[2] / 255 * alpha, alpha);
      self.bind(buffers);
      gl.drawElements(gl.LINES, buffers.lines, gl.UNSIGNED_SHORT, buffers.triangles * 2);
    });
    gl.disable(gl.BLEND);
    this.placeLens(matrix, ratio);
  };

  // Paired canvases share a camera, including drag inertia and keyboard
  // rotation. Only the active view drives the animation.
  ColorSpace.prototype.syncView = function() {
    if (!this.pair) return;
    var self = this;
    instances.forEach(function(other) {
      if (other === self || other.pair !== self.pair) return;
      other.yaw = self.yaw;
      other.pitch = self.pitch;
      other.target = null;
      other.velocity = 0;
      if (other.visible) other.draw();
    });
  };

  ColorSpace.prototype.interact = function() {
    this.lastInteraction = performance.now();
  };

  ColorSpace.prototype.pointerDown = function(event) {
    if (event.button !== 0) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
    this.velocity = 0;
    this.target = null;
    this.interact();
    this.figure.classList.add('is-dragging');
    this.syncView();
    this.schedule();
  };

  ColorSpace.prototype.pointerMove = function(event) {
    var drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    var dt = Math.max(1, event.timeStamp - drag.time);
    this.yaw += dx * DRAG_SPEED;
    this.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, this.pitch + dy * DRAG_SPEED));
    // Smoothed, so letting go keeps the shape spinning at the drag's speed.
    this.velocity = this.velocity * 0.5 + (dx * DRAG_SPEED / dt) * 0.5;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.time = event.timeStamp;
    this.interact();
  };

  ColorSpace.prototype.pointerUp = function(event) {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    // A pause before letting go means no spin.
    if (event.timeStamp - this.drag.time > 80) this.velocity = 0;
    this.drag = null;
    this.interact();
    this.figure.classList.remove('is-dragging');
    this.schedule();
  };

  ColorSpace.prototype.keyDown = function(event) {
    var key = event.key;
    if (key === 'ArrowLeft') this.yaw -= KEY_STEP;
    else if (key === 'ArrowRight') this.yaw += KEY_STEP;
    else if (key === 'ArrowUp') this.pitch = Math.max(MIN_PITCH, this.pitch - KEY_STEP);
    else if (key === 'ArrowDown') this.pitch = Math.min(MAX_PITCH, this.pitch + KEY_STEP);
    else return;
    event.preventDefault();
    this.velocity = 0;
    this.target = null;
    this.interact();
    this.draw();
    this.syncView();
    this.schedule();
  };

  ColorSpace.prototype.destroy = function() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.frame = null;
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.visibilityObserver) this.visibilityObserver.disconnect();
    if (this.nearObserver) this.nearObserver.disconnect();
    // Browsers cap live WebGL contexts, so free ours right away.
    this.ready = false;
    if (this.loseContext && !this.gl.isContextLost()) this.loseContext.loseContext();
    if (this.shape.destroy) this.shape.destroy();
    if (this.panel) this.panel.remove();
    if (this.below) this.below.remove();
    if (this.helpTip) this.helpTip.remove();
    if (this.picker) {
      this.picker.destroy();
      if (this.pair) delete this.pair.__colorPicker;
    }
    var index = listeners.indexOf(this.onSelect);
    if (index !== -1) listeners.splice(index, 1);
    index = instances.indexOf(this);
    if (index !== -1) instances.splice(index, 1);
  };

  // A "?" button with a tooltip: shown on hover and keyboard focus, and
  // toggled by clicking, for touch screens.
  var helpTips = 0;
  function helpTip(text) {
    var wrap = document.createElement('span');
    wrap.className = 'color-space__help-tip';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-space__help-button';
    button.textContent = '?';
    button.setAttribute('aria-label', 'Help');
    var tip = document.createElement('span');
    tip.className = 'color-space__tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.id = 'color-space-help-' + (++helpTips);
    tip.textContent = text;
    button.setAttribute('aria-describedby', tip.id);
    var close = function(event) {
      if (event.type === 'keydown' ? event.key !== 'Escape' : wrap.contains(event.target)) return;
      wrap.classList.remove('is-open');
      document.removeEventListener('click', close, true);
      document.removeEventListener('keydown', close, true);
    };
    button.addEventListener('click', function() {
      if (wrap.classList.toggle('is-open')) {
        document.addEventListener('click', close, true);
        document.addEventListener('keydown', close, true);
      }
    });
    wrap.appendChild(button);
    wrap.appendChild(tip);
    return wrap;
  }

  // An OKLCH and RGB color picker, each track
  // showing the colors it would select, and leaving out (transparent) those
  // its figure's gamut cannot show. Paired figures share a picker; every
  // picker selects the same source color.
  var SLIDERS = [
    { key: 'l', label: 'L', name: 'Lightness', max: 1, step: 0.005 },
    { key: 'c', label: 'C', name: 'Chroma', max: MAX_CHROMA, step: 0.001 },
    { key: 'h', label: 'H', name: 'Hue', max: 360, step: 1 }
  ];

  var RGB_SLIDERS = [
    { key: 'r', label: 'R', name: 'Red', max: 255, step: 1 },
    { key: 'g', label: 'G', name: 'Green', max: 255, step: 1 },
    { key: 'b', label: 'B', name: 'Blue', max: 255, step: 1 }
  ];

  function css(l, c, h) {
    return 'oklch(' + l.toFixed(3) + ' ' + c.toFixed(3) + ' ' + h.toFixed(1) + ')';
  }

  // Leaving a stretch of a track toward a less visible one (dimmed, or
  // outside the gamut), a slider holds on at the edge for SNAP_PX: it helps
  // to stay in the stretch it is in. A track with dimmed colors has two
  // kinds of edges, one without only one. Inside a stretch, and entering
  // one, every value stays reachable. The value goes on the slider's steps,
  // rounded inward.
  function snap(input, slider) {
    var edges = input.__edges || [];
    var width = input.clientWidth - THUMB_WIDTH;
    var value = parseFloat(input.value);
    var last = input.__last;
    var t = value / slider.max;
    var best = null;
    if (last !== undefined && last !== value) {
      var from = last / slider.max;
      edges.forEach(function(edge) {
        // The edge's visible side is above it for dir > 0, below otherwise.
        var leaving = edge.dir > 0 ? from >= edge.t - 1e-6 && t < edge.t : from <= edge.t + 1e-6 && t > edge.t;
        var distance = Math.abs(t - edge.t) * width;
        if (leaving && distance <= SNAP_PX && (!best || distance < best.distance)) {
          best = { edge: edge, distance: distance };
        }
      });
    }
    if (best) {
      var steps = best.edge.t * slider.max / slider.step;
      var snapped = (best.edge.dir > 0 ? Math.ceil(steps - 1e-9) : Math.floor(steps + 1e-9)) * slider.step;
      input.value = String(Math.min(slider.max, Math.max(0, snapped)));
    }
    input.__last = parseFloat(input.value);
  }

  function Picker(gamut, rgbFirst) {
    var self = this;
    this.gamut = gamut;
    this.el = document.createElement('div');
    this.el.className = 'color-space__picker';
    var lchRow = document.createElement('div');
    lchRow.className = 'color-space__controls';
    var rgbRow = document.createElement('div');
    rgbRow.className = 'color-space__controls';
    // The swatch goes at the start of the first row.
    var firstRow = rgbFirst ? rgbRow : lchRow;
    this.el.appendChild(firstRow);
    this.el.appendChild(rgbFirst ? lchRow : rgbRow);
    this.swatch = document.createElement('span');
    this.swatch.className = 'color-space__swatch';
    this.swatch.setAttribute('aria-hidden', 'true');
    firstRow.appendChild(this.swatch);
    this.inputs = {};
    SLIDERS.concat(RGB_SLIDERS).forEach(function(slider, index) {
      var isRgb = index >= SLIDERS.length;
      var label = document.createElement('label');
      label.className = 'color-space__slider';
      var text = document.createElement('span');
      text.textContent = slider.label;
      text.title = slider.name;
      var input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = String(slider.max);
      input.step = String(slider.step);
      input.setAttribute('aria-label', slider.name + (isRgb ? ' (' + gamut.name + ')' : ''));
      input.addEventListener('input', function() {
        snap(input, slider);
        if (isRgb) {
          // A shared OKLCH selection may be outside this figure's gamut.
          // Editing RGB explicitly brings it back: cap all channels, not
          // just the one being dragged, before converting to OKLCH.
          var rgb = oklchToRgb(selection.l, selection.c, selection.h * Math.PI / 180, gamut);
          rgb[index - SLIDERS.length] = Math.min(255, Math.max(0, parseFloat(input.value))) / 255;
          select(rgbToOklch(rgb, gamut, selection.h));
        } else {
          var next = { l: selection.l, c: selection.c, h: selection.h };
          next[slider.key] = parseFloat(input.value);
          select(next);
        }
      });
      label.appendChild(text);
      label.appendChild(input);
      (isRgb ? rgbRow : lchRow).appendChild(label);
      self.inputs[slider.key] = input;
    });
    this.value = document.createElement('output');
    this.value.className = 'color-space__value';
    lchRow.appendChild(this.value);
    this.rgbValue = document.createElement('output');
    this.rgbValue.className = 'color-space__value';
    this.rgbValue.setAttribute('aria-label', gamut.name + ' color');
    rgbRow.appendChild(this.rgbValue);
    this.update = function(color) { self.show(color); };
    listeners.push(this.update);
    this.show(selection);
  }

  Picker.prototype.show = function(color) {
    var inputs = this.inputs;
    SLIDERS.forEach(function(slider) {
      if (parseFloat(inputs[slider.key].value) !== color[slider.key]) {
        inputs[slider.key].value = String(color[slider.key]);
      }
      inputs[slider.key].__last = parseFloat(inputs[slider.key].value); // for snap
    });
    var gamut = this.gamut;
    // Colors along a track, at(t) returning [l, c, h in degrees] for t 0-1.
    var shows = function(lch) {
      return inGamut(oklchToLinear(lch[0], lch[1], lch[2] * Math.PI / 180, gamut));
    };
    // An alpha of 0.2 dims the colors the picker's range rules out.
    var paintRgb = function(rgb, alpha) {
      var suffix = alpha < 1 ? ' / ' + alpha + ')' : ')';
      if (gamut === GAMUTS.p3) return 'color(display-p3 ' + rgb.map(function(v) { return v.toFixed(4); }).join(' ') + suffix;
      return 'rgb(' + rgb.map(function(v) { return (v * 255).toFixed(1); }).join(' ') + suffix;
    };
    var paint = function(lch, alpha) {
      return paintRgb(oklchToRgb(lch[0], lch[1], lch[2] * Math.PI / 180, gamut), alpha);
    };
    // A range (Pi's, beside it) may rule colors out: they stay visible, but
    // dimmed, so the useful part of each track stands out.
    var range = this.range;
    var fromLch = function(lch) { return [lch[0], lch[1], lch[2] * Math.PI / 180]; };
    var fromRgb = function(rgb) {
      var lch = rgbToOklch(rgb, gamut, color.h);
      return [lch.l, lch.c, lch.h * Math.PI / 180];
    };
    // Where the thumb's center is at t: it stops half its width from the ends.
    var at = function(t) {
      return 'calc(' + THUMB_WIDTH / 2 + 'px + (100% - ' + THUMB_WIDTH + 'px) * ' + t.toFixed(4) + ')';
    };
    // Each t is outside the gamut (0, transparent), ruled out (1, dimmed)
    // or neither (2). Extra ts catch narrow allowed stretches, such as the
    // current value and the range's hue.
    var track = function(along, count, contains, draw, toLch, extra) {
      contains = contains || shows;
      draw = draw || paint;
      toLch = toLch || fromLch;
      var state = function(value) {
        if (!contains(value)) return 0;
        return range && !range.allows(toLch(value)) ? 1 : 2;
      };
      var colorAt = function(value, which) {
        return which === 0 ? 'transparent' : draw(value, which === 1 ? 0.2 : 1);
      };
      var edges = [];
      var ts = steps(0, 1, count).concat((extra || []).filter(function(t) { return t > 0 && t < 1; }));
      ts.sort(function(a, b) { return a - b; });
      var stops = [];
      var before = null;
      ts.forEach(function(t) {
        var value = along(t);
        var which = state(value);
        if (before !== null && which !== before.state) {
          // A hard edge where the state changes, found by bisection.
          var low = before.t, high = t;
          for (var k = 0; k < 14; k++) {
            var mid = (low + high) / 2;
            if (state(along(mid)) === before.state) low = mid;
            else high = mid;
          }
          stops.push(colorAt(along(low), before.state) + ' ' + at(low));
          stops.push(colorAt(along(high), state(along(high))) + ' ' + at(low));
          // Where it snaps to: just on the more visible side.
          var up = state(along(high)) > before.state;
          edges.push({ t: up ? high : low, dir: up ? 1 : -1 });
        }
        stops.push(colorAt(value, which) + ' ' + at(t));
        before = { t: t, state: which };
      });
      return { gradient: 'linear-gradient(to right, ' + stops.join(', ') + ')', edges: edges };
    };
    // A track's colors, and its edges for snapping (see snap).
    var paintTrack = function(input, result) {
      input.style.setProperty('--track', result.gradient);
      input.__edges = result.edges;
    };
    var hue = range ? [range.hue() / 360] : [];
    paintTrack(inputs.l, track(function(t) { return [t, color.c, color.h]; }, 60,
      null, null, null, [color.l]));
    paintTrack(inputs.c, track(function(t) { return [color.l, t * MAX_CHROMA, color.h]; }, 60,
      null, null, null, [color.c / MAX_CHROMA]));
    paintTrack(inputs.h, track(function(t) { return [color.l, color.c, t * 360]; }, 90,
      null, null, null, [color.h / 360].concat(hue)));
    // Use unclipped channels for the tracks: an out-of-gamut OKLCH color
    // must not silently become a different, clipped color just by showing
    // it in an RGB picker. Range thumbs stop at 0 and 255; tracks remain
    // transparent wherever the other channels are outside the gamut.
    var rgb = oklchToLinear(color.l, color.c, color.h * Math.PI / 180, gamut).map(encodeUnclipped);
    var rgbInside = shows([color.l, color.c, color.h]);
    RGB_SLIDERS.forEach(function(slider, index) {
      var input = inputs[slider.key];
      var channel = Math.round(Math.min(1, Math.max(0, rgb[index])) * 255);
      if (parseFloat(input.value) !== channel) input.value = String(channel);
      input.__last = channel;
      input.setAttribute('aria-valuetext', rgbInside ? String(channel) : 'Outside ' + gamut.name);
      paintTrack(input, track(function(t) {
        var next = rgb.slice();
        next[index] = t;
        return next;
      }, 60, inGamut, paintRgb, fromRgb, [rgb[index]]));
    });
    this.rgbValue.textContent = rgbInside ? (gamut === GAMUTS.p3 ? 'P3 ' : '') +
      'rgb(' + rgb.map(function(v) { return Math.round(Math.min(1, Math.max(0, v)) * 255); }).join(' ') + ')' :
      'Outside ' + gamut.name;
    this.swatch.style.background = css(color.l, color.c, color.h);
    // Fixed digits, in a box of fixed width (prose.css): if its width
    // changed, the centered sliders would move under the pointer.
    this.value.textContent = 'oklch(' + (color.l * 100).toFixed(1) + '% ' +
      color.c.toFixed(3) + ' ' + color.h.toFixed(0) + ')';
  };

  // A range that rules colors out, { allows(lch), hue() in degrees }, or
  // null: its tracks dim what it rules out.
  Picker.prototype.setRange = function(range) {
    this.range = range;
    this.show(selection);
  };

  Picker.prototype.destroy = function() {
    var index = listeners.indexOf(this.update);
    if (index !== -1) listeners.splice(index, 1);
  };

  // Article colors and the terminal eyedropper use sRGB, independently of
  // the gamut used to draw a figure. They feed the same OKLCH selection.
  function selectRgb(rgb, isDefault) {
    select(rgbToOklch(rgb, GAMUTS.srgb, selection.h), isDefault);
  }

  function isHex(hex) {
    return /^#[\da-f]{6}$/i.test(hex);
  }

  function hexToRgb(hex) {
    return [1, 3, 5].map(function(offset) {
      return parseInt(hex.slice(offset, offset + 2), 16) / 255;
    });
  }

  function selectHex(hex, isDefault) {
    if (isHex(hex)) selectRgb(hexToRgb(hex), isDefault);
  }

  // Follow the active theme's background until a color is explicitly picked.
  function selectDefaultHex(hex) {
    if (!hasSelection) selectHex(hex, true);
  }

  function ColorReadout() {
    var self = this;
    this.el = document.createElement('div');
    this.el.className = 'asciicast__color-readout';
    this.el.setAttribute('role', 'status');
    this.swatch = document.createElement('span');
    this.swatch.className = 'color-space__swatch';
    this.swatch.setAttribute('aria-hidden', 'true');
    this.value = document.createElement('output');
    this.rgbValue = document.createElement('output');
    this.el.appendChild(this.swatch);
    this.el.appendChild(this.value);
    this.el.appendChild(this.rgbValue);
    this.update = function(color) { self.show(color); };
    listeners.push(this.update);
    this.show(selection);
  }

  ColorReadout.prototype.show = function(color) {
    this.swatch.style.background = css(color.l, color.c, color.h);
    this.value.textContent = 'oklch(' + (color.l * 100).toFixed(1) + '% ' +
      color.c.toFixed(3) + ' ' + color.h.toFixed(0) + ')';
    var rgb = oklchToLinear(color.l, color.c, color.h * Math.PI / 180, GAMUTS.srgb);
    this.rgbValue.textContent = inGamut(rgb) ? 'rgb(' + rgb.map(function(v) {
      return Math.round(linearToSrgb(v) * 255);
    }).join(' ') + ')' : 'Outside sRGB';
  };

  ColorReadout.prototype.destroy = Picker.prototype.destroy;

  // Sample the player's background canvas, or the foreground of a text
  // glyph. Picking the actual text color avoids antialiased edge shades.
  // Whitespace selects the panel behind it, not the span's text color.
  function terminalColorAt(terminal, x, y) {
    var canvas = terminal.querySelector('canvas');
    var rect = canvas.getBoundingClientRect();
    var background = getComputedStyle(terminal).borderTopColor;
    var pixel;
    if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
      pixel = canvas.getContext('2d').getImageData(
        Math.floor((x - rect.left) / rect.width * canvas.width),
        Math.floor((y - rect.top) / rect.height * canvas.height), 1, 1).data;
      if (pixel[3]) background = 'rgb(' + Array.from(pixel).slice(0, 3).join(' ') + ')';
    }
    var node, offset;
    if (document.caretPositionFromPoint) {
      var caret = document.caretPositionFromPoint(x, y);
      if (caret) { node = caret.offsetNode; offset = caret.offset; }
    } else if (document.caretRangeFromPoint) {
      var caretRange = document.caretRangeFromPoint(x, y);
      if (caretRange) { node = caretRange.startContainer; offset = caretRange.startOffset; }
    }
    if (node && node.nodeType === 3 && terminal.contains(node) &&
        node.parentElement.closest('.ap-term-text')) {
      var range = document.createRange();
      for (var i = Math.max(0, offset - 1); i <= offset && i < node.length; i++) {
        if (/\s/.test(node.textContent[i])) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        var glyph = range.getBoundingClientRect();
        if (x < glyph.left || x >= glyph.right || y < glyph.top || y >= glyph.bottom) continue;
        var style = getComputedStyle(node.parentElement);
        // Resolve CSS colors and blend faint text on the panel behind it.
        var sample = document.createElement('canvas');
        sample.width = sample.height = 1;
        var ctx = sample.getContext('2d');
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, 1, 1);
        ctx.globalAlpha = parseFloat(style.opacity);
        ctx.fillStyle = style.color;
        ctx.fillRect(0, 0, 1, 1);
        var rgb = ctx.getImageData(0, 0, 1, 1).data;
        return 'rgb(' + Array.from(rgb).slice(0, 3).join(' ') + ')';
      }
    }
    return background;
  }

  // Flip near an edge and reserve space for the lens's outer ring, since
  // the player clips its contents to rounded corners.
  function previewOffset(pointer, extent, size) {
    var inset = 4;
    var offset = pointer + 16;
    if (offset + size + inset > extent) offset = pointer - 16 - size;
    return Math.max(inset, Math.min(extent - size - inset, offset));
  }

  function TerminalEyedropper(figure) {
    var self = this;
    this.figure = figure;
    this.mount = figure.__asciicast.mount;
    this.active = false;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'asciicast__eyedropper';
    this.button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m14 5 5 5M16 3a2 2 0 0 1 3 3l-3 3-2-2-7 7-2 5-2 2-1-1 2-2 1-5 7-7-2-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    this.button.setAttribute('aria-label', 'Pick a terminal color for the visualizations');
    this.button.title = 'Pick a terminal color (Escape to cancel)';
    this.button.setAttribute('aria-pressed', 'false');
    this.mount.appendChild(this.button);
    selectDefaultHex(figure.dataset.colorBackground);
    this.readout = new ColorReadout();
    figure.appendChild(this.readout.el);
    this.preview = document.createElement('span');
    this.preview.className = 'asciicast__color-preview';
    this.preview.setAttribute('aria-hidden', 'true');
    this.preview.hidden = true;
    this.mount.appendChild(this.preview);
    this.button.addEventListener('click', function() { self.toggle(!self.active); });
    this.onClick = function(event) {
      if (!self.active || !event.target.closest('.ap-term')) return;
      event.preventDefault();
      event.stopPropagation();
      var color = terminalColorAt(event.target.closest('.ap-term'), event.clientX, event.clientY);
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      selectRgb(Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(function(v) { return v / 255; }));
      self.toggle(false);
    };
    this.mount.addEventListener('click', this.onClick, true);
    this.mount.addEventListener('pointermove', function(event) {
      var terminal = event.target.closest('.ap-term');
      self.preview.hidden = !self.active || !terminal;
      if (self.preview.hidden) return;
      var rect = self.mount.getBoundingClientRect();
      self.preview.style.left = previewOffset(event.clientX - rect.left,
        rect.width, self.preview.offsetWidth) + 'px';
      self.preview.style.top = previewOffset(event.clientY - rect.top,
        rect.height, self.preview.offsetHeight) + 'px';
      self.preview.style.background = terminalColorAt(terminal, event.clientX, event.clientY);
    });
    this.mount.addEventListener('pointerleave', function() { self.preview.hidden = true; });
    this.onKey = function(event) {
      if (!self.active || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      self.toggle(false);
    };
    document.addEventListener('keydown', this.onKey, true);
  }

  TerminalEyedropper.prototype.toggle = function(active) {
    this.active = active;
    this.button.setAttribute('aria-pressed', String(active));
    this.mount.classList.toggle('is-picking-color', active);
    this.preview.hidden = true;
  };

  TerminalEyedropper.prototype.destroy = function() {
    this.readout.destroy();
    document.removeEventListener('keydown', this.onKey, true);
  };

  // Pi's system theme generator (system-theme.ts), for the lightness curves
  // figure: the same families, contrast rules, target-lightness curves,
  // relaxation and 8-bit rounding as Pi, so it makes Pi's colors for any
  // background, not only for the themes in themes.json. Colors are
  // { r, g, b } with 0-255 channels, as in Pi. Only terminals that report
  // their background are covered; without one, Pi uses ANSI indices.
  var PI_THEME = (function() {
    var FAMILY_SLOTS = { neutral: 8, blue: 4, green: 2, red: 1, yellow: 3, orange: 3, violet: 5, calamine: 6,
      thinkingSlate: 4, thinkingBlue: 4, thinkingPeriwinkle: 6, thinkingViolet: 5, thinkingMagenta: 13,
      thinkingRed: 1 };
    var FAMILY_TOKENS = {
      blue: ['selectedBg', 'userMessageBg', 'border', 'mdLink', 'syntaxKeyword'],
      orange: ['searchMatchBg', 'syntaxString'],
      violet: ['customMessageBg', 'accent', 'borderAccent', 'customMessageLabel', 'mdCode', 'mdListBullet',
        'syntaxType'],
      neutral: ['toolPendingBg', 'text', 'userMessageText', 'customMessageText', 'toolTitle', 'syntaxOperator',
        'syntaxPunctuation', 'muted', 'dim', 'thinkingText', 'toolOutput', 'mdLinkUrl', 'mdQuote', 'mdQuoteBorder',
        'mdHr', 'mdCodeBlockBorder', 'toolDiffContext', 'syntaxComment', 'scrollbarTrack', 'scrollbarThumb',
        'searchMatchText', 'borderMuted', 'thinkingOff'],
      green: ['toolSuccessBg', 'success', 'mdCodeBlock', 'toolDiffAdded', 'bashMode', 'syntaxNumber'],
      red: ['toolErrorBg', 'error', 'toolDiffRemoved'],
      calamine: ['syntaxVariable'],
      yellow: ['warning', 'mdHeading', 'syntaxFunction'],
      thinkingSlate: ['thinkingMinimal'],
      thinkingBlue: ['thinkingLow'],
      thinkingPeriwinkle: ['thinkingMedium'],
      thinkingViolet: ['thinkingHigh'],
      thinkingMagenta: ['thinkingXhigh'],
      thinkingRed: ['thinkingMax']
    };
    var TOKEN_FAMILIES = {};
    Object.keys(FAMILY_TOKENS).forEach(function(family) {
      FAMILY_TOKENS[family].forEach(function(token) { TOKEN_FAMILIES[token] = family; });
    });
    // Palette slots for tokens that would otherwise share a hue with a similar token.
    var TOKEN_SLOTS = { syntaxString: 2, syntaxNumber: 5, searchMatchBg: 3 };

    // Target-lightness curves: a polynomial in the surface's OKLab lightness
    // giving the OKLab lightness a token needs on it, fitted to a reference
    // contrast algorithm. Beyond reachable, the level cannot be reached.
    var LEVELS = {
      panel: {
        dark: { coefficients: [0.29131, -0.39746, 2.33185, -0.85524, -1.2076, 0.86276],
          reachable: [0, 0.979] },
        light: { coefficients: [-3.74073, 27.94549, -78.44258, 112.6798, -79.60015, 22.11277],
          reachable: [0.348, 1] }
      },
      track: {
        dark: { coefficients: [0.39028, -0.23015, 0.83573, 2.43829, -4.38292, 2.01582],
          reachable: [0, 0.946] },
        light: { coefficients: [-5.24921, 38.37322, -107.28833, 152.10005, -106.17127, 29.18061],
          reachable: [0.368, 1] }
      },
      thinking0: {
        dark: { coefficients: [0.52988, -0.05809, -0.30924, 4.63567, -6.52933, 2.89108],
          reachable: [0, 0.873] },
        light: { coefficients: [-28.27749, 182.85284, -469.62416, 603.15916, -384.59976, 97.35147],
          reachable: [0.51, 1] }
      },
      thinking1: {
        dark: { coefficients: [0.55278, -0.03667, -0.45659, 4.95347, -6.90265, 3.0706],
          reachable: [0, 0.858] },
        light: { coefficients: [-37.10484, 235.86282, -596.62344, 754.3633, -474.00763, 118.3551],
          reachable: [0.535, 1] }
      },
      thinking2: {
        dark: { coefficients: [0.57486, -0.01765, -0.58987, 5.25227, -7.27175, 3.25532],
          reachable: [0, 0.842] },
        light: { coefficients: [-59.89653, 377.05024, -945.07843, 1182.03145, -734.96375, 181.68658],
          reachable: [0.556, 1] }
      },
      thinking3: {
        dark: { coefficients: [0.59621, -0.00062, -0.71148, 5.53588, -7.6392, 3.44606],
          reachable: [0, 0.827] },
        light: { coefficients: [-72.07122, 445.84082, -1099.57352, 1353.88793, -829.53392, 202.26164],
          reachable: [0.58, 1] }
      },
      thinking4: {
        dark: { coefficients: [0.61691, 0.01462, -0.82288, 5.80651, -8.00641, 3.64333],
          reachable: [0, 0.811] },
        light: { coefficients: [-110.14338, 674.21488, -1645.75941, 2004.32367, -1215.15899, 293.3183],
          reachable: [0.6, 1] }
      },
      thinking5: {
        dark: { coefficients: [0.63702, 0.02826, -0.92498, 6.06465, -8.37246, 3.84651],
          reachable: [0, 0.795] },
        light: { coefficients: [-175.47701, 1063.54495, -2570.70594, 3098.80776, -1860.15527, 444.76392],
          reachable: [0.62, 1] }
      },
      thinking6: {
        dark: { coefficients: [0.65658, 0.04044, -1.01835, 6.30989, -8.73529, 4.05439],
          reachable: [0, 0.779] },
        light: { coefficients: [-183.81712, 1094.70055, -2602.68539, 3088.71276, -1826.91131, 430.75931],
          reachable: [0.643, 1] }
      },
      subtle: {
        dark: { coefficients: [0.56762, -0.02475, -0.5383, 5.12628, -7.10931, 3.17324],
          reachable: [0, 0.848] },
        light: { coefficients: [-232.85459, 1376.54473, -3249.11801, 3827.91186, -2248.29472, 526.55751],
          reachable: [0.657, 1] }
      },
      thumb: {
        dark: { coefficients: [0.60323, 0.00278, -0.73328, 5.57157, -7.68067, 3.46933],
          reachable: [0, 0.823] },
        light: { coefficients: [-82.89897, 511.01355, -1255.98095, 1540.76821, -940.68087, 228.58523],
          reachable: [0.586, 1] }
      },
      readable: {
        dark: { coefficients: [0.66937, 0.04704, -1.06871, 6.43941, -8.9332, 4.17229],
          reachable: [0, 0.77] },
        light: { coefficients: [-1554.52576, 8733.56817, -19604.93507, 21977.72696, -12300.99599, 2749.81288],
          reachable: [0.751, 1] }
      },
      emphasis: {
        dark: { coefficients: [0.7303, 0.07695, -1.31626, 7.1681, -10.14436, 4.92846],
          reachable: [0, 0.712] },
        light: { coefficients: [-4948.31942, 26870.91986, -58334.48399, 63280.17197, -34298.01053, 7430.30146],
          reachable: [0.811, 1] }
      },
      textOnPanel: {
        dark: { coefficients: [0.86713, 0.05232, -0.89428, 4.79014, -5.5432, 1.75023],
          reachable: [0, 0.542] },
        light: { coefficients: [-8570.89457, 43954.60805, -90084.00702, 92220.6791, -47152.15802, 9632.27113],
          reachable: [0.867, 1] }
      },
      text: {
        dark: { coefficients: [0.89242, 0.02311, -0.44862, 2.34417, -0.06084, -2.63844],
          reachable: [0, 0.5] },
        light: { coefficients: [-2004.67048, 6664.47299, -6060.70202, -1792.61209, 5133.82359, -1939.85583],
          reachable: [0.894, 1] }
      }
    };

    var TOOL_PANELS = ['toolPendingBg', 'toolSuccessBg', 'toolErrorBg'];
    var MESSAGE_PANELS = ['userMessageBg', 'customMessageBg'];
    var PANELS = ['userMessageBg', 'toolPendingBg', 'toolSuccessBg', 'toolErrorBg', 'selectedBg', 'searchMatchBg',
      'customMessageBg'];
    var THINKING = ['thinkingOff', 'thinkingMinimal', 'thinkingLow', 'thinkingMedium', 'thinkingHigh',
      'thinkingXhigh', 'thinkingMax'];
    var each = function(tokens, on, level) {
      return tokens.map(function(token) { return { token: token, on: on, level: level }; });
    };
    var SYNTAX = ['syntaxComment', 'syntaxKeyword', 'syntaxFunction', 'syntaxVariable', 'syntaxString',
      'syntaxNumber', 'syntaxType', 'syntaxOperator', 'syntaxPunctuation'];
    var RULES = [].concat(
      each(PANELS, ['background'], 'panel'),
      [{ token: 'text', on: ['background'], level: 'text' },
        { token: 'text', on: ['selectedBg'], level: 'textOnPanel' },
        { token: 'userMessageText', on: ['userMessageBg'], level: 'textOnPanel' },
        { token: 'toolTitle', on: TOOL_PANELS, level: 'textOnPanel' }],
      each(['accent', 'success', 'error', 'warning'], ['background', 'selectedBg'].concat(TOOL_PANELS), 'readable'),
      [{ token: 'muted', on: ['background', 'selectedBg', 'customMessageBg'].concat(TOOL_PANELS), level: 'readable' },
        { token: 'dim', on: ['background', 'selectedBg', 'customMessageBg'].concat(TOOL_PANELS), level: 'subtle' },
        { token: 'thinkingText', on: ['background'], level: 'readable' },
        { token: 'customMessageText', on: ['customMessageBg'].concat(TOOL_PANELS), level: 'readable' },
        { token: 'customMessageLabel', on: ['background', 'customMessageBg', 'selectedBg'].concat(TOOL_PANELS),
          level: 'readable' },
        { token: 'toolOutput', on: ['background'].concat(TOOL_PANELS), level: 'readable' }],
      each(['mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode', 'mdQuote', 'mdCodeBlockBorder', 'mdListBullet'],
        ['background'].concat(MESSAGE_PANELS), 'readable'),
      [{ token: 'mdCodeBlock', on: ['background'].concat(MESSAGE_PANELS, TOOL_PANELS), level: 'readable' }],
      each(['toolDiffAdded', 'toolDiffRemoved', 'toolDiffContext'], ['background'].concat(TOOL_PANELS), 'readable'),
      each(SYNTAX, ['background'].concat(MESSAGE_PANELS, TOOL_PANELS), 'readable'),
      [{ token: 'searchMatchText', on: ['searchMatchBg'], level: 'readable' }],
      each(['bashMode', 'border', 'borderAccent'], ['background'], 'readable'),
      [{ token: 'borderMuted', on: ['background'], level: 'subtle' }],
      each(['mdQuoteBorder', 'mdHr'], ['background'].concat(MESSAGE_PANELS, TOOL_PANELS), 'readable'),
      [{ token: 'scrollbarTrack', on: ['background'], level: 'track' },
        { token: 'scrollbarThumb', on: ['scrollbarTrack'], level: 'thumb' }],
      THINKING.map(function(token, index) { return { token: token, on: ['background'], level: 'thinking' + index }; })
    );
    // Relaxation compresses levels stronger than this one toward it before weakening all levels.
    var READABLE_FLOOR = { dark: 'readable', light: 'subtle' };
    // Body text keeps the terminal's foreground where it reaches this level.
    var FOREGROUND_LEVEL = 'emphasis';
    var FOREGROUND_TOKENS = ['text', 'userMessageText', 'toolTitle'];
    var TEXT_MINIMUM_WCAG_CONTRAST = 4.5;
    // Every surface before the tokens drawn on it.
    var SOLVE_ORDER = (function() {
      var order = [];
      var visit = function(token) {
        if (order.indexOf(token) !== -1) return;
        RULES.forEach(function(rule) {
          if (rule.token !== token) return;
          rule.on.forEach(function(surface) { if (surface !== 'background') visit(surface); });
        });
        order.push(token);
      };
      RULES.forEach(function(rule) { visit(rule.token); });
      return order;
    })();

    // pi-tui's oklab.ts and colors.ts, with their constants: the figures'
    // own conversions differ in the last digits, which is enough to round a
    // channel the other way.
    var LINEAR_SRGB_TO_LMS = [
      [0.4122214694707629, 0.5363325372617349, 0.0514459932675022],
      [0.2119034958178251, 0.6806995506452344, 0.1073969535369405],
      [0.0883024591900564, 0.2817188391361215, 0.6299787016738222]
    ];
    var LMS_TO_LAB = [
      [0.210454268309314, 0.793617774702305, -0.0040720430116193],
      [1.9779985324311684, -2.42859224204858, 0.450593709617411],
      [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]
    ];
    var LAB_TO_LMS = [
      [1, 0.3963377773761749, 0.2158037573099136],
      [1, -0.1055613458156586, -0.0638541728258133],
      [1, -0.0894841775298119, -1.2914855480194092]
    ];
    var LMS_TO_LINEAR_SRGB = [
      [4.0767416360759583, -3.3077115392580629, 0.2309699031821043],
      [-1.2684379732850315, 2.6097573492876882, -0.341319376002657],
      [-0.0041960761386756, -0.7034186179359362, 1.7076146940746117]
    ];
    var times = function(m, v) {
      return m.map(function(row) { return row[0] * v[0] + row[1] * v[1] + row[2] * v[2]; });
    };
    var toOkhslLightness = function(x) {
      var y = OKHSL_K3 * x - OKHSL_K1;
      return 0.5 * (y + Math.sqrt(y * y + 4 * OKHSL_K2 * OKHSL_K3 * x));
    };
    var toOklabLightness = function(x) { return (x * x + OKHSL_K1 * x) / (OKHSL_K3 * (x + OKHSL_K2)); };
    var labToLinear = function(lab) {
      return times(LMS_TO_LINEAR_SRGB, times(LAB_TO_LMS, lab).map(function(v) { return v * v * v; }));
    };
    var labOf = function(rgb) {
      var linear = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map(function(v) {
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return times(LMS_TO_LAB, times(LINEAR_SRGB_TO_LMS, linear).map(Math.cbrt));
    };
    // Without exact, channels are rounded to 8 bits, as in Pi.
    var toRgb = function(linear, exact) {
      var channel = function(value) {
        var v = value > 0.0031308 ? 1.055 * Math.pow(value, 1 / 2.4) - 0.055 : 12.92 * value;
        v = Math.min(1, Math.max(0, v)) * 255;
        return exact ? v : Math.round(v);
      };
      return { r: channel(linear[0]), g: channel(linear[1]), b: channel(linear[2]) };
    };
    var slopes = function(a, b) {
      return LAB_TO_LMS.map(function(row) { return row[1] * a + row[2] * b; });
    };
    var dot = function(row, values) { return row[0] * values[0] + row[1] * values[1] + row[2] * values[2]; };
    var maxSaturation = function(a, b) {
      var channel = 2;
      for (var i = 0; i < 2; i++) {
        var plane = SATURATION_FIT[i][0];
        if (plane[0] * a + plane[1] * b > 1) {
          channel = i;
          break;
        }
      }
      var k = SATURATION_FIT[channel][1];
      var weights = LMS_TO_LINEAR_SRGB[channel];
      var saturation = k[0] + k[1] * a + k[2] * b + k[3] * a * a + k[4] * a * b;
      var s = slopes(a, b);
      var base = s.map(function(slope) { return 1 + saturation * slope; });
      var f = dot(weights, base.map(function(v) { return v * v * v; }));
      var f1 = dot(weights, base.map(function(v, j) { return 3 * s[j] * v * v; }));
      var f2 = dot(weights, base.map(function(v, j) { return 6 * s[j] * s[j] * v; }));
      return saturation - f * f1 / (f1 * f1 - 0.5 * f * f2);
    };
    var cusp = function(a, b) {
      var saturation = maxSaturation(a, b);
      var lightness = Math.cbrt(1 / Math.max.apply(null, labToLinear([1, saturation * a, saturation * b])));
      return [lightness, lightness * saturation];
    };
    var maxChromaAt = function(a, b, lightness, peak) {
      if (lightness <= peak[0]) return peak[1] * lightness / peak[0];
      var t = peak[1] * (lightness - 1) / (peak[0] - 1);
      var s = slopes(a, b);
      var lms = s.map(function(k) { return lightness + t * k; });
      var cubes = lms.map(function(v) { return v * v * v; });
      var first = lms.map(function(v, j) { return 3 * s[j] * v * v; });
      var second = lms.map(function(v, j) { return 6 * s[j] * s[j] * v; });
      var steps = LMS_TO_LINEAR_SRGB.map(function(row) {
        var f = dot(row, cubes) - 1;
        var f1 = dot(row, first);
        var f2 = dot(row, second);
        var u = f1 / (f1 * f1 - 0.5 * f * f2);
        return u >= 0 ? -f * u : Number.MAX_VALUE;
      });
      return t + Math.min.apply(null, steps);
    };
    var chromaStops = function(L, a, b) {
      var peak = cusp(a, b);
      var cMax = maxChromaAt(a, b, L, peak);
      var k = cMax / Math.min(L * (peak[1] / peak[0]), (1 - L) * (peak[1] / (1 - peak[0])));
      var midS = 0.11516993 + 1 / (7.4477897 + 4.1590124 * b + a * (-2.19557347 + 1.75198401 * b +
        a * (-2.13704948 - 10.02301043 * b + a * (-4.24894561 + 5.38770819 * b + 4.69891013 * a))));
      var midT = 0.11239642 + 1 / (1.6132032 - 0.68124379 * b + a * (0.40370612 + 0.90148123 * b +
        a * (-0.27087943 + 0.6122399 * b + a * (0.00299215 - 0.45399568 * b - 0.14661872 * a))));
      var cMid = 0.9 * k * Math.sqrt(Math.sqrt(1 / (1 / Math.pow(L * midS, 4) + 1 / Math.pow((1 - L) * midT, 4))));
      var c0 = Math.sqrt(1 / (1 / Math.pow(L * 0.4, 2) + 1 / Math.pow((1 - L) * 0.8, 2)));
      return [c0, cMid, cMax];
    };
    // OKHSL (hue in degrees) to rounded sRGB.
    var okhslColor = function(hue, saturation, lightness) {
      var L = toOklabLightness(lightness);
      var lab = [L, 0, 0];
      if (L > 0 && L < 1 && saturation > 0) {
        var angle = 2 * Math.PI * (((hue % 360) + 360) % 360) / 360;
        var a = Math.cos(angle), b = Math.sin(angle);
        var stops = chromaStops(L, a, b);
        var c0 = stops[0], cMid = stops[1], cMax = stops[2];
        var chroma, t, k1;
        if (saturation < 0.8) {
          t = 1.25 * saturation;
          k1 = 0.8 * c0;
          chroma = t * k1 / (1 - (1 - k1 / cMid) * t);
        } else {
          t = 5 * (saturation - 0.8);
          k1 = 0.2 * cMid * cMid * 1.25 * 1.25 / c0;
          chroma = cMid + t * k1 / (1 - (1 - k1 / (cMax - cMid)) * t);
        }
        lab = [L, chroma * a, chroma * b];
      }
      return toRgb(labToLinear(lab));
    };
    // sRGB to OKHSL (hue in degrees, 0 for grays).
    var okhslOf = function(rgb) {
      var lab = labOf(rgb);
      var chroma = Math.hypot(lab[1], lab[2]);
      var lightness = toOkhslLightness(lab[0]);
      if (chroma < 1e-9 || lightness <= 0 || lightness >= 1) return { h: 0, s: 0, l: lightness };
      var hue = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
      var stops = chromaStops(lab[0], lab[1] / chroma, lab[2] / chroma);
      var c0 = stops[0], cMid = stops[1], cMax = stops[2];
      var saturation, k1;
      if (chroma < cMid) {
        k1 = 0.8 * c0;
        saturation = 0.8 * (chroma / (k1 + (1 - k1 / cMid) * chroma));
      } else {
        k1 = 0.2 * cMid * cMid * 1.25 * 1.25 / c0;
        var offset = chroma - cMid;
        saturation = 0.8 + 0.2 * (offset / (k1 + (1 - k1 / (cMax - cMid)) * offset));
      }
      return { h: hue, s: Math.min(1, Math.max(0, saturation)), l: lightness };
    };
    // OKLCH, hue in degrees.
    var lchOf = function(rgb) {
      var lab = labOf(rgb);
      return { l: lab[0], c: Math.hypot(lab[1], lab[2]), h: (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360 };
    };
    var lightnessOf = function(rgb) { return labOf(rgb)[0]; };
    // colors.ts's oklchColor: reduce chroma until the color fits sRGB.
    // exact keeps fractional channels, for colors no terminal reports.
    var oklchColor = function(l, c, hue, exact) {
      var radians = hue * Math.PI / 180;
      var cos = Math.cos(radians), sin = Math.sin(radians);
      var at = function(chroma) { return labToLinear([l, chroma * cos, chroma * sin]); };
      var fits = function(linear) {
        // Exact colors must not clip: near black, a clipped -1e-7 moves L by 0.005.
        var epsilon = exact ? 0 : 1e-7;
        return linear.every(function(channel) { return channel >= -epsilon && channel <= 1 + epsilon; });
      };
      var direct = at(c);
      if (fits(direct)) return toRgb(direct, exact);
      var linear = at(0), low = 0, high = c;
      for (var i = 0; i < 20; i++) {
        var chroma = (low + high) / 2;
        var candidate = at(chroma);
        if (fits(candidate)) {
          low = chroma;
          linear = candidate;
        } else {
          high = chroma;
        }
      }
      return toRgb(linear, exact);
    };
    // A terminal color's OKHSL channels and its OKLCH chroma.
    var sourceOf = function(rgb) {
      var hsl = okhslOf(rgb);
      return { h: hsl.h, s: hsl.s, l: hsl.l, chroma: lchOf(rgb).c };
    };
    var luminance = function(rgb) {
      var linear = function(channel) {
        var value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
    };
    var wcagContrast = function(first, second) {
      var a = luminance(first), b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    var WHITE = { r: 255, g: 255, b: 255 };
    var BLACK = { r: 0, g: 0, b: 0 };
    // Dark or light: the direction of the terminal's own foreground where
    // text can be readable that way, otherwise whichever of white and black
    // text has more contrast.
    var appearanceOf = function(background, foreground) {
      var whiteContrast = wcagContrast(WHITE, background);
      var blackContrast = wcagContrast(BLACK, background);
      if (foreground) {
        var foregroundL = lightnessOf(foreground);
        var backgroundL = lightnessOf(background);
        if (Math.abs(foregroundL - backgroundL) > 0.05) {
          var appearance = foregroundL > backgroundL ? 'dark' : 'light';
          var best = appearance === 'dark' ? whiteContrast : blackContrast;
          if (best >= TEXT_MINIMUM_WCAG_CONTRAST) return appearance;
        }
      }
      return whiteContrast >= blackContrast ? 'dark' : 'light';
    };
    var bellWeight = function(lightness) {
      var gaussian = function(x) { return Math.exp(-(x - 0.5) * (x - 0.5) / (2 * 0.25 * 0.25)); };
      return (gaussian(lightness) - gaussian(0)) / (1 - gaussian(0));
    };
    // The target lightness for a level on a surface, or undefined where the level cannot be reached.
    var levelTarget = function(level, appearance, surfaceL) {
      var curve = LEVELS[level][appearance];
      if (surfaceL < curve.reachable[0] || surfaceL > curve.reachable[1]) return undefined;
      return curve.coefficients.reduce(function(sum, coefficient, power) {
        return sum + coefficient * Math.pow(surfaceL, power);
      }, 0);
    };
    // The source's saturation applies at its own lightness and falls off
    // toward black and white along the family's curve, never rising above
    // it; chroma is capped at the source's, with the same falloff.
    var anchored = function(source, family, lightness) {
      var anchor = piSaturation(family, source.l);
      var falloff = anchor > 0 ? Math.min(1, piSaturation(family, lightness) / anchor) : 1;
      var color = okhslColor(source.h, source.s * falloff, lightness);
      var cap = source.chroma * falloff;
      var lch = lchOf(color);
      return lch.c <= cap ? color : oklchColor(lch.l, cap, source.h);
    };
    // Move a text color toward white or black until it reaches the WCAG minimum on every surface.
    var withTextContrast = function(color, surfaces, lighter) {
      var meets = function(candidate) {
        return surfaces.every(function(surface) {
          return wcagContrast(candidate, surface) >= TEXT_MINIMUM_WCAG_CONTRAST;
        });
      };
      if (meets(color)) return color;
      var hsl = sourceOf(color);
      var at = function(lightness) { return okhslColor(hsl.h, hsl.s, lightness); };
      var extreme = lighter ? 1 : 0;
      if (!meets(at(extreme))) return at(extreme);
      var low = hsl.l, high = extreme;
      for (var i = 0; i < 20; i++) {
        var middle = (low + high) / 2;
        if (meets(at(middle))) high = middle;
        else low = middle;
      }
      return at(high);
    };

    // input: { background, foreground, palette (16 colors) }. Returns the
    // tokens' colors (the foreground where Pi keeps it), the appearance, how
    // much the levels were relaxed (0 when not), and the generator's target
    // and paint functions at that relaxation.
    var generate = function(input) {
      var background = input.background, foreground = input.foreground;
      var palette = input.palette && input.palette.length === 16 ? input.palette.map(sourceOf) : null;
      var appearance = appearanceOf(background, foreground);
      var lighter = appearance === 'dark';
      var extreme = lighter ? 1 : 0;
      var backgroundL = lightnessOf(background);
      var pick = function(values) { return lighter ? Math.max.apply(null, values) : Math.min.apply(null, values); };

      var paint = function(token, oklabL) {
        var lightness = toOkhslLightness(oklabL);
        var familyName = TOKEN_FAMILIES[token];
        var family = PI_FAMILIES[familyName];
        if (!palette) {
          return okhslColor(family.hue, family.min + (family.max - family.min) * bellWeight(lightness), lightness);
        }
        var slot = TOKEN_SLOTS[token] !== undefined ? TOKEN_SLOTS[token] : FAMILY_SLOTS[familyName];
        return anchored(palette[slot], family, lightness);
      };
      // The lightness a rule needs on a surface, relaxed by t: from 0 to 1,
      // levels stronger than the readable floor move toward it; from 1 to 2,
      // all levels move toward the surface itself.
      var target = function(level, surfaceL, t) {
        var reached = levelTarget(level, appearance, surfaceL);
        if (reached === undefined && t === 0) return undefined;
        var distance = (reached === undefined ? extreme : reached) - surfaceL;
        var floorL = levelTarget(READABLE_FLOOR[appearance], appearance, surfaceL);
        var floor = (floorL === undefined ? extreme : floorL) - surfaceL;
        var compressed = Math.abs(distance) > Math.abs(floor) ?
          distance - (distance - floor) * Math.min(t, 1) : distance;
        return surfaceL + compressed * (1 - Math.max(0, t - 1));
      };
      // Panels stay light (or dark) enough for white (or black) text.
      var extremeText = lighter ? WHITE : BLACK;
      var readable = function(color) { return wcagContrast(extremeText, color) >= TEXT_MINIMUM_WCAG_CONTRAST; };
      var limitPanel = function(token, l) {
        var color = paint(token, l);
        if (readable(color)) return color;
        var low = backgroundL, high = l;
        for (var i = 0; i < 20; i++) {
          var middle = (low + high) / 2;
          if (readable(paint(token, middle))) low = middle;
          else high = middle;
        }
        return paint(token, low);
      };
      var solve = function(t) {
        var colors = { background: background };
        for (var i = 0; i < SOLVE_ORDER.length; i++) {
          var token = SOLVE_ORDER[i];
          var targets = [];
          for (var j = 0; j < RULES.length; j++) {
            var rule = RULES[j];
            if (rule.token !== token) continue;
            for (var k = 0; k < rule.on.length; k++) {
              var value = target(rule.level, lightnessOf(colors[rule.on[k]] || background), t);
              if (value === undefined || value < 0 || value > 1) return null;
              targets.push(value);
            }
          }
          var l = pick(targets);
          colors[token] = PANELS.indexOf(token) !== -1 ? limitPanel(token, l) : paint(token, l);
        }
        return colors;
      };

      var relaxation = 0;
      var solved = solve(0);
      if (!solved) {
        // Mid-gray backgrounds cannot fit every level: relax as little as possible.
        var low = 0, high = 2;
        solved = solve(high);
        for (var i = 0; i < 20; i++) {
          var middle = (low + high) / 2;
          var attempt = solve(middle);
          if (attempt) {
            high = middle;
            solved = attempt;
          } else {
            low = middle;
          }
        }
        relaxation = high;
      }
      var surfacesOf = function(token) {
        var surfaces = [];
        RULES.forEach(function(rule) {
          if (rule.token !== token) return;
          rule.on.forEach(function(surface) { surfaces.push(solved[surface] || background); });
        });
        return surfaces;
      };
      var colors = {};
      Object.keys(TOKEN_FAMILIES).forEach(function(token) { colors[token] = solved[token]; });
      var keepsForeground = {};
      FOREGROUND_TOKENS.forEach(function(token) {
        var surfaces = surfacesOf(token);
        var text = solved[token];
        if (foreground) {
          var targets = surfaces.map(function(surface) {
            return target(FOREGROUND_LEVEL, lightnessOf(surface), relaxation);
          });
          if (targets.every(function(value) { return value !== undefined && value >= 0 && value <= 1; })) {
            var needed = pick(targets);
            var foregroundL = lightnessOf(foreground);
            if (lighter ? foregroundL >= needed : foregroundL <= needed) {
              colors[token] = foreground;
              keepsForeground[token] = true;
              return;
            }
            text = anchored(sourceOf(foreground), PI_FAMILIES.neutral, toOkhslLightness(needed));
          }
        }
        colors[token] = withTextContrast(text, surfaces, lighter);
      });
      return {
        colors: colors, keepsForeground: keepsForeground, appearance: appearance, relaxation: relaxation,
        target: function(level, surfaceL) { return target(level, surfaceL, relaxation); },
        paint: paint
      };
    };

    return {
      LEVELS: LEVELS, RULES: RULES, TOKEN_FAMILIES: TOKEN_FAMILIES, generate: generate, levelTarget: levelTarget,
      lightnessOf: lightnessOf, lchOf: lchOf, wcagContrast: wcagContrast, oklchColor: oklchColor,
      appearanceOf: appearanceOf,
      slotOf: function(token) {
        return TOKEN_SLOTS[token] !== undefined ? TOKEN_SLOTS[token] : FAMILY_SLOTS[TOKEN_FAMILIES[token]];
      }
    };
  })();

  // The lightness Pi needs, as a chart for <figure data-lightness-curves>:
  // the target-lightness curves of the contrast levels in the post's rules,
  // over the lightness of the surface below. A vertical line is a surface,
  // first the background, which can be dragged, then the panels, which Pi
  // solves on it first: a panel's target, reflected by the diagonal, is
  // where its line is. A rule's targets are dots where its level's curve
  // crosses its surfaces' lines; the strictest is Pi's lightness for the
  // color. On the right, the color Pi made (square) and the ANSI color it
  // came from (circle). Below, a terminal shows the colors on every surface.
  // data-pi-themes names the terminal themes (themes.json); the chart follows
  // the demo's theme picker.
  var CURVE_LEVELS = ['panel', 'subtle', 'readable', 'text'];
  // The post's rules: panels first, then the colors on them.
  var CURVE_RULES = [
    { id: 'panels', label: 'panels', tokens: ['selectedBg', 'toolPendingBg', 'toolSuccessBg', 'toolErrorBg'] },
    { id: 'accent', label: 'accent', tokens: ['accent'] },
    { id: 'success', label: 'success', tokens: ['success'] },
    { id: 'error', label: 'error', tokens: ['error'] },
    { id: 'warning', label: 'warning', tokens: ['warning'] },
    { id: 'dim', label: 'dim', tokens: ['dim'] }
  ];
  var CURVE_SURFACES = {
    background: { name: 'the background', row: 'background' },
    selectedBg: { name: 'the selected row', row: 'selected row' },
    toolPendingBg: { name: 'the pending tool panel', row: 'tool, pending' },
    toolSuccessBg: { name: 'the successful tool panel', row: 'tool, success' },
    toolErrorBg: { name: 'the failed tool panel', row: 'tool, failed' },
    customMessageBg: { name: 'custom messages', row: 'custom message' }
  };
  var PREVIEW_ROWS = ['background', 'selectedBg', 'toolPendingBg', 'toolSuccessBg', 'toolErrorBg'];
  var PREVIEW_WORDS = ['accent', 'success', 'error', 'warning', 'dim'];
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var charts = [];

  function rgbHex(rgb) {
    return '#' + [rgb.r, rgb.g, rgb.b].map(function(value) {
      return ('0' + Math.round(value).toString(16)).slice(-2);
    }).join('');
  }

  function hexRgb(hex) {
    var rgb = hexToRgb(hex);
    return { r: Math.round(rgb[0] * 255), g: Math.round(rgb[1] * 255), b: Math.round(rgb[2] * 255) };
  }

  function escapeText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fixed(value) {
    return value.toFixed(2);
  }

  // What the chart shows, in words; p has the details.
  function curvesText(p) {
    var text;
    if (p.panels) {
      text = 'Panels come first: the panel level on the background (L ' + p.surfaceL + ') makes them L ' +
        p.target + ', a little ' + (p.lighter ? 'lighter' : 'darker') + '. Colors drawn on them start from that.';
    } else {
      text = p.token.charAt(0).toUpperCase() + p.token.slice(1) + ' needs the ' + p.level + ' level on the ' +
        'background and ' + p.count + ' panels: L ' + p.onBackground + ' and L ' + p.range + '. The strictest, ' +
        'on ' + p.surface + ', wins: L ' + p.target + ', ' + p.hex + '.';
    }
    if (p.unreached) text += ' The level is out of reach here, so Pi goes toward ' + (p.lighter ? 'white' : 'black') + '.';
    return text;
  }

  // Every text the status can show, with the longest values.
  var curvesReserved = null;
  function curvesReserve() {
    if (curvesReserved) return curvesReserved;
    var longestSurface = Object.keys(CURVE_SURFACES).map(function(key) { return CURVE_SURFACES[key].name; })
      .reduce(function(a, b) { return a.length >= b.length ? a : b; });
    curvesReserved = [];
    CURVE_RULES.forEach(function(rule) {
      var panels = rule.id === 'panels';
      var level = panels ? 'panel' : PI_THEME.RULES.filter(function(item) { return item.token === rule.id; })[0].level;
      [true, false].forEach(function(lighter) {
        [true, false].forEach(function(unreached) {
          curvesReserved.push(curvesText({ panels: panels, lighter: lighter, level: level, unreached: unreached,
            surfaceL: '0.00', target: '0.00', token: rule.label, count: 5, onBackground: '0.00',
            range: '0.00 to 0.00', surface: longestSurface, hex: '#000000' }));
        });
      });
    });
    return curvesReserved;
  }

  function LightnessCurves(figure) {
    var self = this;
    this.figure = figure;
    this.data = null;
    this.theme = null;
    this.rule = CURVE_RULES[3]; // error, as in the post
    this.moved = null; // the background's lightness, once dragged
    this.drag = null;

    var fallback = figure.querySelector('.lightness-curves__fallback');
    this.chart = document.createElement('div');
    this.chart.className = 'lightness-curves__chart';
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('role', 'img');
    this.chart.appendChild(this.svg);
    this.status = document.createElement('p');
    this.status.className = 'lightness-curves__status';
    this.status.setAttribute('aria-live', 'polite');
    this.statusTexts = {};

    // The rules, as in the post's code.
    this.rules = document.createElement('div');
    this.rules.className = 'color-space__recipe lightness-curves__rules';
    this.rules.setAttribute('role', 'group');
    this.rules.setAttribute('aria-label', 'Rule');
    var rulesTitle = document.createElement('span');
    rulesTitle.textContent = 'Rule';
    this.rules.appendChild(rulesTitle);
    this.ruleButtons = CURVE_RULES.map(function(rule) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = rule.label;
      button.addEventListener('click', function() { self.setRule(rule.id); });
      self.rules.appendChild(button);
      return button;
    });

    // A terminal with Pi's colors on every surface the post names.
    this.preview = document.createElement('div');
    this.preview.className = 'lightness-curves__preview';
    this.previewRows = PREVIEW_ROWS.map(function(surface) {
      var label = document.createElement('span');
      label.className = 'lightness-curves__row-label';
      label.textContent = CURVE_SURFACES[surface].row;
      var row = document.createElement('div');
      row.className = 'lightness-curves__row';
      var words = PREVIEW_WORDS.map(function(token) {
        var word = document.createElement('button');
        word.type = 'button';
        word.className = 'lightness-curves__word';
        word.textContent = token;
        word.dataset.token = token;
        word.addEventListener('click', function() { self.setRule(token); });
        row.appendChild(word);
        return word;
      });
      self.preview.appendChild(label);
      self.preview.appendChild(row);
      return { surface: surface, label: label, row: row, words: words };
    });

    // The background's lightness, keeping its hue and chroma where sRGB can.
    this.slider = document.createElement('div');
    this.slider.className = 'color-space__recipe lightness-curves__background';
    var sliderLabel = document.createElement('label');
    sliderLabel.className = 'color-space__slider';
    var sliderTitle = document.createElement('span');
    sliderTitle.textContent = 'Background L';
    this.input = document.createElement('input');
    this.input.type = 'range';
    this.input.min = '0';
    this.input.max = '1';
    this.input.step = '0.005';
    this.input.addEventListener('input', function() { self.moveBackground(Number(self.input.value)); });
    this.value = document.createElement('output');
    this.value.className = 'lightness-curves__value';
    sliderLabel.appendChild(sliderTitle);
    sliderLabel.appendChild(this.input);
    sliderLabel.appendChild(this.value);
    this.slider.appendChild(sliderLabel);
    this.reset = document.createElement('button');
    this.reset.type = 'button';
    this.reset.textContent = 'Theme background';
    this.reset.addEventListener('click', function() { self.moveBackground(null); });
    this.slider.appendChild(this.reset);

    this.themes = document.createElement('div');
    this.themes.className = 'asciicast__themes';
    this.themes.setAttribute('role', 'radiogroup');
    this.themes.setAttribute('aria-label', 'Terminal theme');
    this.themeButtons = [];
    this.themes.addEventListener('keydown', function(event) { self.themeKey(event); });
    this.themes.addEventListener('mouseleave', function() { self.showName(self.theme); });
    this.themes.addEventListener('focusout', function() { self.showName(self.theme); });
    this.name = document.createElement('p');
    this.name.className = 'lightness-curves__theme-name';
    this.name.setAttribute('aria-hidden', 'true');

    var caption = figure.querySelector('figcaption');
    [this.chart, this.status, this.rules, this.preview, this.slider, this.themes, this.name].forEach(function(node) {
      figure.insertBefore(node, caption || null);
    });
    if (fallback) fallback.hidden = true;
    var help = figure.querySelector('.color-space__help');
    if (help) {
      this.helpTip = helpTip(help.textContent.trim());
      figure.appendChild(this.helpTip);
    }
    figure.classList.add('is-enhanced');

    this.svg.addEventListener('pointerdown', function(event) { self.pointerDown(event); });
    this.svg.addEventListener('pointermove', function(event) { self.pointerMove(event); });
    this.svg.addEventListener('pointerup', function(event) { self.pointerUp(event); });
    this.svg.addEventListener('pointercancel', function(event) { self.pointerUp(event); });
    this.svg.addEventListener('click', function(event) {
      var target = event.target.closest && event.target.closest('[data-hex]');
      if (target) selectHex(target.getAttribute('data-hex'));
    });
    this.onTheme = function(event) {
      var name = themeOf(event, self.onTheme);
      if (name && !(self.theme && self.theme.name === name)) self.setTheme(name);
    };
    followThemes(this.onTheme);
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(function() { self.render(); });
      this.resizeObserver.observe(this.chart);
    }
    this.load(figure.getAttribute('data-pi-themes'));
  }

  LightnessCurves.prototype.load = function(url) {
    var self = this;
    if (!url || typeof fetch !== 'function') return;
    fetch(url).then(function(response) { return response.json(); }).then(function(json) {
      if (!json || !json.themes) return;
      self.data = json;
      self.buildThemes();
      self.setTheme(currentTheme(json));
    }).catch(function(error) {
      if (window.console) console.warn('Lightness curves unavailable:', error);
    });
  };

  LightnessCurves.prototype.findTheme = function(name) {
    var themes = this.data ? this.data.themes : [];
    return themes.filter(function(item) { return item.name === name; })[0] || themes[0] || null;
  };

  LightnessCurves.prototype.tokenColor = function(theme, token) {
    return theme.palette[this.data.firstTokenIndex + this.data.tokens.indexOf(token)];
  };

  // As in the demo's picker: a row of dark themes and a row of light ones,
  // each a tiny terminal in Pi's colors.
  LightnessCurves.prototype.buildThemes = function() {
    var self = this;
    ['dark', 'light'].forEach(function(appearance) {
      var group = document.createElement('div');
      group.className = 'asciicast__theme-group';
      self.data.themes.forEach(function(item) {
        if (item.appearance !== appearance) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'asciicast__theme';
        button.dataset.name = item.name;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-label', item.name);
        button.title = item.name;
        button.style.setProperty('--swatch-bg', item.background);
        var swatch = document.createElement('span');
        swatch.className = 'asciicast__swatch';
        ['accent', 'text', 'success'].forEach(function(token) {
          var line = document.createElement('span');
          line.className = 'asciicast__swatch-line';
          line.style.background = self.tokenColor(item, token);
          swatch.appendChild(line);
        });
        button.appendChild(swatch);
        button.addEventListener('click', function() { self.pickTheme(item.name); });
        button.addEventListener('mouseenter', function() { self.showName(item); });
        button.addEventListener('focus', function() { self.showName(item); });
        self.themeButtons.push(button);
        group.appendChild(button);
      });
      self.themes.appendChild(group);
    });
  };

  LightnessCurves.prototype.showName = function(theme) {
    this.name.textContent = theme ? theme.name : '';
  };

  LightnessCurves.prototype.themeKey = function(event) {
    var buttons = this.themeButtons;
    var names = buttons.map(function(button) { return button.dataset.name; });
    var position = names.indexOf(this.theme && this.theme.name);
    var next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (position + 1) % buttons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (position - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    if (next === null || !buttons.length) return;
    event.preventDefault();
    this.pickTheme(names[next]);
    buttons[next].focus();
  };

  // A theme the reader picked here, for every picker on the page.
  LightnessCurves.prototype.pickTheme = function(name) {
    this.setTheme(name);
    announceTheme(name, this.onTheme);
  };

  LightnessCurves.prototype.setTheme = function(name) {
    if (!this.data) return;
    this.theme = this.findTheme(name);
    this.moved = null;
    this.update();
  };

  LightnessCurves.prototype.setRule = function(id) {
    this.rule = CURVE_RULES.filter(function(rule) { return rule.id === id; })[0] || this.rule;
    this.update();
  };

  LightnessCurves.prototype.moveBackground = function(lightness) {
    if (!this.theme) return;
    this.moved = lightness === null ? null : Math.min(1, Math.max(0, lightness));
    this.update();
  };

  // Pi's colors for the theme with the background as it is now.
  LightnessCurves.prototype.solve = function() {
    var theme = this.theme;
    var background = hexRgb(theme.background);
    if (this.moved !== null) {
      var lch = PI_THEME.lchOf(background);
      // Unrounded: near black, 8-bit colors are far apart in lightness
      // (#010101 is L 0.067), and the background would jump between them.
      background = PI_THEME.oklchColor(this.moved, lch.c, lch.h, true);
    }
    var result = PI_THEME.generate({ foreground: hexRgb(theme.foreground), background: background,
      palette: theme.palette.slice(0, 16).map(hexRgb) });
    result.background = background;
    result.lighter = result.appearance === 'dark';
    return result;
  };

  // The selected rule's targets, one per surface, and the strictest.
  LightnessCurves.prototype.targets = function(result) {
    var L = PI_THEME.lightnessOf;
    var entries = [];
    this.rule.tokens.forEach(function(token) {
      PI_THEME.RULES.forEach(function(rule) {
        if (rule.token !== token) return;
        rule.on.forEach(function(surface) {
          var surfaceL = L(surface === 'background' ? result.background : result.colors[surface]);
          var reached = PI_THEME.levelTarget(rule.level, result.appearance, surfaceL);
          var target = result.target(rule.level, surfaceL);
          entries.push({ token: token, surface: surface, level: rule.level, surfaceL: surfaceL,
            target: target, reached: reached !== undefined });
        });
      });
    });
    var winner = entries.reduce(function(best, entry) {
      if (!best) return entry;
      return (result.lighter ? entry.target > best.target : entry.target < best.target) ? entry : best;
    }, null);
    return { entries: entries, winner: winner, level: entries.length ? entries[0].level : 'panel' };
  };

  LightnessCurves.prototype.update = function() {
    if (!this.theme) return;
    var self = this;
    var result = this.result = this.solve();
    var targets = this.picked = this.targets(result);
    var background = rgbHex(result.background);
    var backgroundL = PI_THEME.lightnessOf(result.background);
    this.themeButtons.forEach(function(button) {
      var checked = button.dataset.name === self.theme.name;
      button.setAttribute('aria-checked', checked ? 'true' : 'false');
      button.tabIndex = checked ? 0 : -1;
    });
    this.showName(this.theme);
    this.ruleButtons.forEach(function(button, index) {
      button.setAttribute('aria-pressed', CURVE_RULES[index] === self.rule ? 'true' : 'false');
    });
    this.input.value = String(backgroundL);
    this.value.textContent = fixed(backgroundL);
    this.reset.disabled = this.moved === null;
    // The track: the background's hue at every lightness.
    var lch = PI_THEME.lchOf(hexRgb(this.theme.background));
    var stops = [];
    for (var i = 0; i <= 16; i++) stops.push(rgbHex(PI_THEME.oklchColor(i / 16, lch.c, lch.h)));
    this.input.style.setProperty('--track', 'linear-gradient(to right, ' + stops.join(', ') + ')');

    var surfaces = {};
    targets.entries.forEach(function(entry) { surfaces[entry.surface] = true; });
    this.previewRows.forEach(function(row) {
      var color = row.surface === 'background' ? result.background : result.colors[row.surface];
      row.row.style.background = rgbHex(color);
      var used = self.rule.id === 'panels' ? row.surface !== 'background' : !!surfaces[row.surface];
      row.label.classList.toggle('is-active', used);
      row.row.classList.toggle('is-active', used);
      row.words.forEach(function(word) {
        var token = word.dataset.token;
        word.style.color = rgbHex(result.colors[token]);
        word.setAttribute('aria-pressed', token === self.rule.id ? 'true' : 'false');
        word.title = token + ' ' + rgbHex(result.colors[token]) + ' on ' + CURVE_SURFACES[row.surface].row;
      });
    });
    this.preview.style.setProperty('--preview-bg', background);
    // Stacked with every text it can show, so that it keeps one height.
    var texts = { current: this.describe(result, targets) };
    curvesReserve().forEach(function(reserve, index) { texts['reserve' + index] = reserve; });
    stackTexts(this.status, this.statusTexts, texts, 'current');
    this.svg.setAttribute('aria-label', texts.current);
    this.render();
  };

  // What the chart shows, in words.
  LightnessCurves.prototype.describe = function(result, targets) {
    var winner = targets.winner;
    if (!winner) return '';
    var p = { panels: this.rule.id === 'panels', lighter: result.lighter, level: winner.level,
      surfaceL: fixed(winner.surfaceL), target: fixed(winner.target),
      unreached: targets.entries.some(function(entry) { return !entry.reached; }) };
    if (!p.panels) {
      var onBackground = targets.entries.filter(function(entry) { return entry.surface === 'background'; })[0];
      var panels = targets.entries.filter(function(entry) { return entry.surface !== 'background'; });
      var values = panels.map(function(entry) { return fixed(entry.target); });
      var low = values.reduce(function(a, b) { return a < b ? a : b; });
      var high = values.reduce(function(a, b) { return a > b ? a : b; });
      p.token = this.rule.label;
      p.count = panels.length;
      p.onBackground = fixed(onBackground.target);
      p.range = low === high ? low : result.lighter ? low + ' to ' + high : high + ' to ' + low;
      p.surface = CURVE_SURFACES[winner.surface].name;
      p.hex = rgbHex(result.colors[winner.token]);
    }
    return curvesText(p);
  };

  // The plot's geometry in CSS pixels, for the chart's width.
  LightnessCurves.prototype.layout = function() {
    var width = Math.max(260, this.chart.clientWidth || 560);
    var narrow = width < 480;
    var left = 54, right = narrow ? 104 : 136, top = 26, bottom = 46;
    var plot = Math.min(width - left - right, 420);
    var offset = Math.max(0, (width - left - right - plot) / 2);
    var x0 = left + offset, x1 = x0 + plot;
    return { width: width, height: top + plot + bottom, x0: x0, x1: x1, y0: top, y1: top + plot, narrow: narrow,
      x: function(l) { return x0 + l * plot; },
      y: function(l) { return top + (1 - l) * plot; },
      lightness: function(px) { return (px - x0) / plot; } };
  };

  LightnessCurves.prototype.render = function() {
    if (!this.result) return;
    var g = this.geometry = this.layout();
    var result = this.result, targets = this.picked, rule = this.rule;
    var L = PI_THEME.lightnessOf;
    var lighter = result.lighter;
    var parts = [];
    var title = function(value) { return '<title>' + escapeText(value) + '</title>'; };
    var line = function(points, className, extra, tip) {
      var path = '<path class="' + className + '" d="M' + points.map(function(p) {
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join('L') + '"' + (extra || '');
      return tip ? path + '>' + title(tip) + '</path>' : path + '/>';
    };
    var text = function(x, y, value, className, anchor) {
      return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" class="' + (className || '') + '"' +
        (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + escapeText(value) + '</text>';
    };

    // Axes: gray ramps of OKLab lightness, ticks and titles.
    var grays = [];
    for (var i = 0; i <= 16; i++) {
      grays.push('<stop offset="' + (i / 16) + '" stop-color="' + rgbHex(PI_THEME.oklchColor(i / 16, 0, 0)) + '"/>');
    }
    parts.push('<defs><linearGradient id="lc-x" x1="0" x2="1" y1="0" y2="0">' + grays.join('') +
      '</linearGradient><linearGradient id="lc-y" x1="0" x2="0" y1="1" y2="0">' + grays.join('') +
      '</linearGradient><marker id="lc-head" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" ' +
      'markerHeight="6" orient="auto-start-reverse"><path d="M0,0L8,4L0,8z" class="lc-head"/></marker>' +
      '<pattern id="lc-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<path d="M0,0V6" class="lc-hatch-line"/></pattern></defs>');
    parts.push('<rect class="lc-ramp" x="' + g.x0 + '" y="' + (g.y1 + 4) + '" width="' + (g.x1 - g.x0) +
      '" height="6" rx="2" fill="url(#lc-x)"/>');
    parts.push('<rect class="lc-ramp" x="' + (g.x0 - 10) + '" y="' + g.y0 + '" width="6" height="' + (g.y1 - g.y0) +
      '" rx="2" fill="url(#lc-y)"/>');
    [0.25, 0.5, 0.75].forEach(function(l) {
      parts.push(line([[g.x(l), g.y0], [g.x(l), g.y1]], 'lc-grid'));
      parts.push(line([[g.x0, g.y(l)], [g.x1, g.y(l)]], 'lc-grid'));
    });
    parts.push('<rect class="lc-frame" x="' + g.x0 + '" y="' + g.y0 + '" width="' + (g.x1 - g.x0) + '" height="' +
      (g.y1 - g.y0) + '"/>');
    [0, 0.5, 1].forEach(function(l) {
      parts.push(text(g.x(l), g.y1 + 25, l === 0.5 ? '0.5' : String(l), 'lc-tick', 'middle'));
      parts.push(text(g.x0 - 14, g.y(l) + 4, l === 0.5 ? '0.5' : String(l), 'lc-tick', 'end'));
    });
    parts.push(text((g.x0 + g.x1) / 2, g.y1 + 42, 'lightness of the surface', 'lc-axis', 'middle'));
    parts.push('<text class="lc-axis" text-anchor="middle" transform="translate(' + (g.x0 - 40) +
      ',' + ((g.y0 + g.y1) / 2) + ') rotate(-90)">lightness Pi needs</text>');

    // Where the selected rule's level is out of reach with the curves as
    // drawn, so Pi goes toward white (dark) or black (light): surfaces past
    // where its dark curve ends, or before its light curve starts.
    var active = rule.id === 'panels' ? 'panel' : targets.level;
    var reach = PI_THEME.LEVELS[active][result.appearance].reachable;
    [[0, reach[0]], [reach[1], 1]].forEach(function(band) {
      if (band[1] - band[0] < 0.002) return;
      var x = g.x(band[0]), width = g.x(band[1]) - x;
      parts.push('<rect class="lc-unreachable" x="' + x.toFixed(1) + '" y="' + g.y0 + '" width="' +
        width.toFixed(1) + '" height="' + (g.y1 - g.y0) + '" fill="url(#lc-hatch)">' +
        title('The ' + active + ' level is out of reach on these surfaces, so Pi goes toward ' +
          (lighter ? 'white' : 'black')) + '</rect>');
      if (width >= 16) {
        parts.push('<text class="lc-unreachable-label" text-anchor="end" transform="translate(' +
          (x + width / 2 + 4.5).toFixed(1) + ',' + (g.y0 + 8) + ') rotate(-90)">out of reach</text>');
      }
    });

    // Where the terminal turns from dark to light (or back) as the
    // background moves, and the curves flip with it.
    var segments = this.appearances();
    segments.slice(1).forEach(function(segment, index) {
      var x = g.x(segment.from);
      parts.push(line([[x, g.y0], [x, g.y1]], 'lc-flip', '', 'Here the terminal turns ' + segment.appearance +
        ', and the curves flip'));
      // Above where dots at black sit.
      parts.push(text(x - 4, g.y1 - 16, segments[index].appearance, 'lc-flip-label', 'end'));
      parts.push(text(x + 4, g.y1 - 16, segment.appearance, 'lc-flip-label', 'start'));
    });

    // No contrast: a color as light as the surface.
    parts.push(line([[g.x(0), g.y(0)], [g.x(1), g.y(1)]], 'lc-diagonal'));
    // Along it, on the side without curves, away from the usual backgrounds.
    var noteL = lighter ? 0.62 : 0.4;
    // Text sits above its baseline, so below the diagonal it needs more room.
    var noteX = g.x(noteL) + (lighter ? 12 : -4), noteY = g.y(noteL) + (lighter ? 12 : -4);
    parts.push('<text class="lc-note" transform="translate(' + noteX.toFixed(1) + ',' + noteY.toFixed(1) +
      ') rotate(-45)">no contrast</text>');

    // The levels' curves for this appearance, where they can be reached.
    var labels = [];
    CURVE_LEVELS.forEach(function(level) {
      var curve = PI_THEME.LEVELS[level][result.appearance];
      var from = curve.reachable[0], to = curve.reachable[1];
      var points = [];
      for (var i = 0; i <= 96; i++) {
        var x = from + (to - from) * i / 96;
        var y = PI_THEME.levelTarget(level, result.appearance, x);
        points.push([g.x(x), g.y(Math.min(1, Math.max(0, y)))]);
      }
      var className = 'lc-curve' + (level === active ? ' is-active' : level === 'panel' ? ' is-panel' : '');
      parts.push(line(points, className, '', 'The ' + level + ' level'));
      // Labeled away from the backgrounds: on dark, above where the curve
      // starts at black; on light, left of where it starts, toward black.
      var startY = PI_THEME.levelTarget(level, result.appearance, from);
      labels.push({ level: level, x: g.x(from), y: g.y(startY), className: level === active ? ' is-active' : '' });
    });
    if (lighter) {
      labels.sort(function(a, b) { return a.y - b.y; });
      labels.forEach(function(label, index) {
        if (index && label.y - labels[index - 1].y < 15) label.y = labels[index - 1].y + 15;
        parts.push(text(g.x0 + 5, label.y - 5, label.level, 'lc-label' + label.className, 'start'));
      });
    } else {
      // Left to right, each a row lower where it would run into the last.
      labels.sort(function(a, b) { return a.x - b.x; });
      var lastEnd = -Infinity, row = 0;
      labels.forEach(function(label) {
        var end = label.x - 5;
        row = end - label.level.length * 7.5 < lastEnd + 4 ? row + 1 : 0;
        lastEnd = end;
        parts.push(text(end, label.y + 4 + row * 15, label.level, 'lc-label' + label.className, 'end'));
      });
    }

    // The background and the panels Pi solves on it first: the panel level
    // on the background, reflected by the diagonal, places their lines.
    var backgroundL = L(result.background);
    var panelL = result.target('panel', backgroundL);
    var panels = rule.id === 'dim' ? ['selectedBg', 'customMessageBg'].concat(CURVE_RULES[0].tokens.slice(1)) :
      CURVE_RULES[0].tokens;
    panels.forEach(function(panel) {
      var x = g.x(L(result.colors[panel]));
      parts.push(line([[x, g.y0], [x, g.y1]], 'lc-surface is-panel', '',
        CURVE_SURFACES[panel].row + ', L ' + fixed(L(result.colors[panel]))));
    });
    parts.push(line([[g.x(backgroundL), g.y(panelL)], [g.x(panelL), g.y(panelL)]], 'lc-reflect'));
    var bx = g.x(backgroundL);
    parts.push(line([[bx, g.y0], [bx, g.y1]], 'lc-surface'));
    // Above the plot, each on the far side of its line from the other.
    var panelX = g.x(L(result.colors.selectedBg));
    var panelsRight = panelX >= bx;
    parts.push(text(bx + (panelsRight ? -3 : 3), g.y0 - 8, 'background', 'lc-surface-label',
      panelsRight ? 'end' : 'start'));
    parts.push(text(panelX + (panelsRight ? 3 : -3), g.y0 - 8, 'panels', 'lc-surface-label',
      panelsRight ? 'start' : 'end'));
    parts.push('<circle class="lc-dot" cx="' + bx.toFixed(1) + '" cy="' + g.y(panelL).toFixed(1) + '" r="3.5" fill="' +
      rgbHex(result.colors.selectedBg) + '">' + title('Panels: L ' + fixed(panelL)) + '</circle>');

    // The rule's targets, one per surface, in the colors they would make.
    var winner = targets.winner;
    if (rule.id !== 'panels') {
      targets.entries.forEach(function(entry) {
        if (entry === winner) return;
        var color = rgbHex(result.paint(entry.token, entry.target));
        parts.push('<circle class="lc-dot" data-hex="' + color + '" cx="' + g.x(entry.surfaceL).toFixed(1) +
          '" cy="' + g.y(entry.target).toFixed(1) + '" r="4" fill="' + color + '">' +
          title(CURVE_SURFACES[entry.surface].row + ': L ' + fixed(entry.target)) + '</circle>');
      });
    }
    var resultX = g.x1 + 18;
    if (winner) {
      parts.push(line([[g.x(winner.surfaceL), g.y(winner.target)], [resultX, g.y(winner.target)]], 'lc-winner-line'));
      var winnerColor = rgbHex(result.paint(winner.token, winner.target));
      parts.push('<circle class="lc-dot is-winner" data-hex="' + winnerColor + '" cx="' +
        g.x(winner.surfaceL).toFixed(1) + '" cy="' + g.y(winner.target).toFixed(1) + '" r="5.5" fill="' +
        winnerColor + '">' + title('Strictest, ' + CURVE_SURFACES[winner.surface].row + ': L ' +
        fixed(winner.target)) + '</circle>');
    }

    // On the right: Pi's color and the terminal color it came from.
    parts.push(line([[resultX, g.y0], [resultX, g.y1]], 'lc-result-axis'));
    var marks = [];
    if (rule.id === 'panels') {
      var color = rgbHex(result.colors.selectedBg);
      marks.push({ y: g.y(L(result.colors.selectedBg)), label: 'panels', hex: color, kind: 'output' });
    } else {
      var token = rule.tokens[0];
      var made = result.colors[token];
      var slot = PI_THEME.slotOf(token);
      var source = this.theme.palette[slot];
      var sourceY = g.y(L(hexRgb(source))), madeY = g.y(L(made));
      if (Math.abs(sourceY - madeY) > 9) {
        parts.push(line([[resultX, sourceY + (madeY > sourceY ? 6 : -6)], [resultX, madeY + (madeY > sourceY ? -8 : 8)]],
          'lc-arrow', ' marker-end="url(#lc-head)"'));
      }
      marks.push({ y: sourceY, label: ANSI_NAMES[slot], hex: source, kind: 'source' });
      marks.push({ y: madeY, label: token, hex: rgbHex(made), kind: 'output' });
    }
    var labelYs = marks.map(function(mark) { return mark.y; });
    if (marks.length === 2 && Math.abs(labelYs[0] - labelYs[1]) < 16) {
      var middle = (labelYs[0] + labelYs[1]) / 2, up = labelYs[0] <= labelYs[1] ? 0 : 1;
      labelYs[up] = middle - 8;
      labelYs[1 - up] = middle + 8;
    }
    marks.forEach(function(mark, index) {
      var shape = mark.kind === 'source' ?
        '<circle class="lc-mark" data-hex="' + mark.hex + '" cx="' + resultX + '" cy="' + mark.y.toFixed(1) +
          '" r="5" fill="' + mark.hex + '">' :
        '<rect class="lc-mark" data-hex="' + mark.hex + '" x="' + (resultX - 5.5) + '" y="' + (mark.y - 5.5).toFixed(1) +
          '" width="11" height="11" rx="2" fill="' + mark.hex + '">';
      parts.push(shape + title((mark.kind === 'source' ? 'Terminal\u2019s ' : 'Pi\u2019s ') + mark.label + ' ' +
        mark.hex + ', L ' + fixed(L(hexRgb(mark.hex)))) + (mark.kind === 'source' ? '</circle>' : '</rect>'));
      parts.push(text(resultX + 11, labelYs[index] + 4, mark.label, 'lc-mark-label' +
        (mark.kind === 'source' ? ' is-source' : ''), 'start'));
    });

    this.svg.setAttribute('viewBox', '0 0 ' + g.width + ' ' + g.height);
    this.svg.setAttribute('width', String(g.width));
    this.svg.setAttribute('height', String(g.height));
    this.svg.innerHTML = parts.join('');
  };

  // Where along the x axis the theme is dark and where light: the
  // background keeps its hue and chroma, and the terminal's foreground
  // decides, as in Pi, by bisection between samples.
  LightnessCurves.prototype.appearances = function() {
    var theme = this.theme;
    if (this.segments && this.segments.theme === theme) return this.segments.list;
    var lch = PI_THEME.lchOf(hexRgb(theme.background)), foreground = hexRgb(theme.foreground);
    var at = function(l) { return PI_THEME.appearanceOf(PI_THEME.oklchColor(l, lch.c, lch.h), foreground); };
    var list = [], start = 0, current = at(0), steps = 200;
    for (var i = 1; i <= steps; i++) {
      var next = at(i / steps);
      if (next === current) continue;
      var low = (i - 1) / steps, high = i / steps;
      for (var k = 0; k < 12; k++) {
        var middle = (low + high) / 2;
        if (at(middle) === current) low = middle;
        else high = middle;
      }
      list.push({ from: start, to: high, appearance: current });
      start = high;
      current = next;
    }
    list.push({ from: start, to: 1, appearance: current });
    this.segments = { theme: theme, list: list };
    return list;
  };

  // Dragging anywhere over the plot moves the background there.
  LightnessCurves.prototype.pointerDown = function(event) {
    if (event.button !== 0 || !this.geometry || !this.theme) return;
    if (event.target.closest && event.target.closest('[data-hex]')) return;
    var rect = this.svg.getBoundingClientRect();
    var x = event.clientX - rect.left;
    if (x < this.geometry.x0 - 12 || x > this.geometry.x1 + 6) return;
    this.svg.setPointerCapture(event.pointerId);
    this.drag = event.pointerId;
    this.figure.classList.add('is-dragging');
    this.pointerMove(event);
  };

  LightnessCurves.prototype.pointerMove = function(event) {
    if (this.drag !== event.pointerId) return;
    var rect = this.svg.getBoundingClientRect();
    this.moveBackground(this.geometry.lightness(event.clientX - rect.left));
  };

  LightnessCurves.prototype.pointerUp = function(event) {
    if (this.drag !== event.pointerId) return;
    this.drag = null;
    this.figure.classList.remove('is-dragging');
  };

  LightnessCurves.prototype.destroy = function() {
    unfollowThemes(this.onTheme);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.helpTip) this.helpTip.remove();
  };

  function initLightnessCurves() {
    charts = charts.filter(function(chart) {
      if (chart.figure.isConnected) return true;
      chart.destroy();
      return false;
    });
    document.querySelectorAll('[data-lightness-curves]').forEach(function(figure) {
      if (figure.dataset.lightnessCurvesInitialized) return;
      figure.dataset.lightnessCurvesInitialized = 'true';
      charts.push(new LightnessCurves(figure));
    });
  }

  function initColorTools() {
    eyedroppers = eyedroppers.filter(function(picker) {
      if (picker.figure.isConnected) return true;
      picker.destroy();
      return false;
    });
    document.querySelectorAll('[data-select-color]').forEach(function(span) {
      if (span.dataset.colorInitialized) return;
      span.dataset.colorInitialized = 'true';
      var hex = span.getAttribute('data-select-color');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'inline-color';
      button.innerHTML = span.innerHTML;
      button.style.setProperty('--inline-color', hex);
      // Pi's range checks the color against a theme's source for a role.
      var source = { theme: span.getAttribute('data-pi-theme'), role: span.getAttribute('data-pi-role') };
      button.setAttribute('aria-label', 'Show ' + hex + ' in the color visualizations');
      button.title = 'Show this color in the visualizations';
      button.addEventListener('click', function() {
        if (source.theme || source.role) {
          sourceListeners.forEach(function(listener) { listener(source); });
        }
        selectHex(hex);
      });
      span.replaceChildren(button);
    });
    document.querySelectorAll('[data-color-eyedropper]').forEach(function(figure) {
      if (!figure.__asciicast || figure.dataset.colorEyedropperInitialized) return;
      figure.dataset.colorEyedropperInitialized = 'true';
      eyedroppers.push(new TerminalEyedropper(figure));
    });
  }

  function initColorSpaces() {
    initColorTools();
    initLightnessCurves();
    instances.slice().forEach(function(instance) {
      if (!instance.figure.isConnected) instance.destroy();
    });
    document.querySelectorAll('[data-color-space]').forEach(function(figure) {
      if (figure.dataset.colorSpaceInitialized) return;
      var kind = figure.getAttribute('data-color-space');
      if (!SHAPES[kind]) return;
      figure.dataset.colorSpaceInitialized = 'true';
      try {
        figure.__colorSpace = new ColorSpace(figure, kind);
        instances.push(figure.__colorSpace);
      } catch (error) {
        // Keep the fallback text, and say why.
        if (window.console) console.warn('Color space figure unavailable:', error);
      }
    });
  }

  initColorSpaces();
  document.body.addEventListener('htmx:afterSettle', initColorSpaces);
  document.body.addEventListener('asciicast:ready', initColorTools);
  document.body.addEventListener('asciicast:theme', function(event) {
    if (event.target.hasAttribute('data-color-eyedropper')) {
      selectDefaultHex(event.target.dataset.colorBackground);
    }
  });
})();
