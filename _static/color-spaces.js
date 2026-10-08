// Color spaces as rotatable 3D shapes, for <figure data-color-space>. Loaded
// by script.js on pages that have one.
//
// data-color-space="rgb" draws the RGB cube, one axis per channel.
// data-color-space="oklch" draws the RGB gamut in OKLCH as a landscape:
// lightness runs from black to white, hue runs along the other side, and the
// height is the most chroma a color of that lightness and hue can have.
// data-color-space="okhsl" draws the OKHSL colors Pi makes from the most
// colorful color of each hue at mid lightness, inside OKHSL's cylinder.
// Every point is drawn in its own color. Drag (or arrow keys) to rotate.
//
// Below each figure, an OKLCH color picker selects one color for all of
// them. Every shape is cut open at that color, in its own coordinates, so the
// color sits in the inner corner of the cut: the cube loses the box between
// the color and white, the landscape the block of higher lightness, hue and
// chroma, and the cylinder a wedge from the color's hue, above its lightness
// and outside its saturation. The shapes' surfaces stay put and the GPU
// discards them inside the cut; only the cut's faces are rebuilt. A round
// lens in the color marks it, faded while the shape hides it. A shape that
// cannot show the color is not cut, and a crossed-out red dot marks where
// the color would be, with the reason.
//
// On wide-gamut displays, with browsers that can draw WebGL in Display P3,
// the cube and the landscape use Display P3 instead of sRGB: the cube's
// corners are P3's primaries, and the landscape is P3's larger gamut.
// Elsewhere they use sRGB. OKHSL is defined on sRGB, so its cylinder always
// shows sRGB colors, converted for a P3 canvas.
(function() {
  if (window.__colorSpaces) return;
  window.__colorSpaces = true;

  var HUE_STEPS = 288; // landscape grid; stays below 65536 vertices
  var LIGHTNESS_STEPS = 160;
  var WALL_STEPS = 12; // grid rows on vertical walls
  var HUE_DEPTH = 1; // length of the hue axis, lightness spans 1 as well
  var CHROMA_HEIGHT = 3; // height per unit of chroma
  var SIDE_STEPS = 216; // OKHSL cylinder grid around its side
  var SATURATION_STEPS = 24; // and out from its axis on the cut's faces
  var CYLINDER_RADIUS = 0.55; // its height is 1
  var WEDGE = Math.PI / 2; // the cylinder's cut, from the selected hue on
  var WEDGE_STEPS = 72;
  var OUTLINE_ALPHA = 0.35; // OKHSL's full cylinder
  var CUT_LINE_ALPHA = 0.7; // the cut's edges
  var GAMUT_TOLERANCE = 1e-4; // chroma; slider steps land on the boundary
  var NOT_CUT = [-10, -10, -10]; // coordinates outside every cut
  var OPEN = 10; // cut size reaching past the end of an axis
  // Pi's saturation curve for its blue family: most of its color families
  // fall off about the same (system-theme.ts, FAMILIES).
  var PI_SATURATION = { min: 0.1, max: 0.68 };
  // The palette color the OKHSL figure follows: the most colorful one of each
  // hue (saturation 1) at mid lightness, where the curve peaks.
  var PI_SOURCE_LIGHTNESS = 0.5;
  var FOV = 30 * Math.PI / 180;
  var IDLE_SPEED = 2 * Math.PI / 40000; // radians per ms, a turn in 40s
  var MIN_PITCH = -1.2;
  var MAX_PITCH = 1.3;
  var DRAG_SPEED = 0.01; // radians per CSS pixel
  var KEY_STEP = 0.15;
  var RESUME_IDLE_MS = 2500; // auto-rotation resumes this long after a drag
  var FOLLOW_MS = 180; // how quickly a shape turns to follow its cut
  var PROBE_MS = 100; // how often the lens checks whether it is hidden
  var MAX_CHROMA = 0.37; // the picker's range, about Display P3's most
  var instances = [];

  // The selected color, shared by all figures. Hue in degrees.
  var selection = { l: 0.65, c: 0.1, h: 250 };
  var listeners = [];

  function select(next) {
    selection = next;
    listeners.forEach(function(listener) { listener(selection); });
    // Hold still while a color is picked, so the cut does not turn away.
    instances.forEach(function(instance) { instance.interact(); });
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

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

  // The RGB spaces to draw in, by the canvas color space each needs. Both
  // encode with the sRGB transfer curve, so they differ only by their
  // primaries: the matrix from OKLab's LMS to linear RGB.
  var GAMUTS = {
    srgb: { canvas: 'srgb', name: 'sRGB', fromLms: LMS_TO_SRGB },
    p3: { canvas: 'display-p3', name: 'Display P3', fromLms: multiply3(SRGB_TO_P3, LMS_TO_SRGB) }
  };

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

  function inGamut(rgb) {
    return rgb[0] >= -1e-6 && rgb[0] <= 1 + 1e-6 &&
      rgb[1] >= -1e-6 && rgb[1] <= 1 + 1e-6 &&
      rgb[2] >= -1e-6 && rgb[2] <= 1 + 1e-6;
  }

  // The most chroma the gamut has at this lightness and hue, by bisection.
  // sRGB peaks at a chroma of 0.32, Display P3 at 0.37.
  function maxChroma(lightness, hue, gamut) {
    if (lightness <= 0 || lightness >= 1) return 0;
    var low = 0, high = 0.5;
    for (var i = 0; i < 18; i++) {
      var mid = (low + high) / 2;
      if (inGamut(oklchToLinear(lightness, mid, hue, gamut))) low = mid;
      else high = mid;
    }
    return low;
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

  // The share of a color's saturation Pi keeps at an OKHSL lightness
  // (system-theme.ts, saturationCurve): all of it at mid lightness, falling
  // off along a bell curve to min / max at black and white, so very dark and
  // very light colors keep a hint of color.
  function piSaturation(lightness) {
    var gaussian = function(x) { return Math.exp(-(x - 0.5) * (x - 0.5) / (2 * 0.25 * 0.25)); };
    var bell = (gaussian(lightness) - gaussian(0)) / (1 - gaussian(0));
    var floor = PI_SATURATION.min / PI_SATURATION.max;
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

  // How saturated Pi makes the source color (saturation 1 at
  // PI_SOURCE_LIGHTNESS) of a hue at another OKHSL lightness, with the
  // saturation setting at 1: system-theme.ts's anchored(), step by step. Its
  // saturation falls off along the curve, relative to where the source sits
  // on it, and its chroma is capped at the source's with the same falloff,
  // so it never gets more colorful than the source. Pi works in 8-bit sRGB
  // between the steps; this does not round.
  var sourceChromas = {};

  function piEdge(hue, lightness) {
    var anchor = piSaturation(PI_SOURCE_LIGHTNESS);
    var falloff = anchor > 0 ? Math.min(1, piSaturation(lightness) / anchor) : 1;
    var lch = okhslToOklch(hue, falloff, lightness);
    if (!(hue in sourceChromas)) sourceChromas[hue] = okhslToOklch(hue, 1, PI_SOURCE_LIGHTNESS)[1];
    var cap = sourceChromas[hue] * falloff;
    if (lch[1] <= cap) return falloff;
    // Capped: the same OKLab lightness and hue, at the source's chroma.
    return oklchToOkhsl(lch[0], cap, hue)[1];
  }

  // The selected color as [lightness, chroma, hue in radians], and whether
  // a gamut has it.
  function selected() {
    return [Math.min(1, Math.max(0, selection.l)), selection.c, selection.h * Math.PI / 180];
  }

  function inside(lch, gamut) {
    return lch[1] <= maxChroma(lch[0], lch[2], gamut) + GAMUT_TOLERANCE;
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
  // position. For a color the shape cannot show, it returns no cut, where
  // the color would be, and why it is missing.
  var NO_CUT = { from: [0, 0, 0], size: [0, 0, 0], wrap: 0 };

  function missing(point, reason) {
    return { from: NO_CUT.from, size: NO_CUT.size, wrap: 0, faces: new MeshBuilder(), point: point, missing: reason };
  }

  // A color at the far end of an axis leaves nothing to cut.
  function uncut(point) {
    return { from: NO_CUT.from, size: NO_CUT.size, wrap: 0, faces: new MeshBuilder(), point: point };
  }
  var SHAPES = {
    // Red to the right, green up, blue toward the front. Colors change
    // linearly across each face, so two triangles per face are exact. The
    // same values mean P3's primaries in a P3 canvas. The cut is the box
    // between the selected color and white.
    rgb: function(gamut) {
      var mesh = new MeshBuilder();
      var squares = function(target, corner) {
        for (var axis = 0; axis < 3; axis++) {
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
      squares(mesh);
      return {
        gamut: gamut,
        mesh: mesh.build(),
        yaw: -Math.PI / 4, // white corner to the front
        pitch: 0.5,
        cut: function() {
          var lch = selected();
          var rgb = oklchToLinear(lch[0], lch[1], lch[2], gamut).map(encodeUnclipped);
          if (!inside(lch, gamut)) return missing(rgb, 'Outside ' + gamut.name);
          rgb = rgb.map(function(value) { return Math.min(1, Math.max(0, value)); });
          if (rgb.some(function(value) { return value >= 1 - 1e-6; })) return uncut(rgb);
          var faces = new MeshBuilder();
          squares(faces, rgb);
          return { from: rgb, size: [OPEN, OPEN, OPEN], wrap: 0, faces: faces, point: rgb };
        }
      };
    },

    // The top is the gamut boundary, each point in its most colorful color.
    // Walls at both ends of the hue axis and a floor of grays close it. The
    // cut is the block of higher lightness, hue and chroma than the selected
    // color, which faces the camera at the start.
    oklch: function(gamut) {
      var chromas = []; // the most chroma at every grid point, [hue][lightness]
      for (var i = 0; i <= HUE_STEPS; i++) {
        chromas.push([]);
        for (var j = 0; j <= LIGHTNESS_STEPS; j++) {
          chromas[i].push(maxChroma(j / LIGHTNESS_STEPS, i / HUE_STEPS * 2 * Math.PI, gamut));
        }
      }
      // t: the position along the hue axis, 0-1.
      var chromaAt = function(t, lightness) {
        var i = t * HUE_STEPS, j = lightness * LIGHTNESS_STEPS;
        if (Math.abs(i - Math.round(i)) < 1e-6 && Math.abs(j - Math.round(j)) < 1e-6) {
          return chromas[Math.round(i)][Math.round(j)];
        }
        return maxChroma(lightness, t * 2 * Math.PI, gamut);
      };
      var add = function(target, lightness, chroma, t, coords, keep) {
        target.vertex([lightness, chroma * CHROMA_HEIGHT, t * HUE_DEPTH],
          oklchToRgb(lightness, chroma, t * 2 * Math.PI, gamut), coords, keep);
      };

      var mesh = new MeshBuilder();
      mesh.grid(HUE_STEPS, LIGHTNESS_STEPS, function(i, j) {
        var t = i / HUE_STEPS, lightness = j / LIGHTNESS_STEPS;
        var chroma = chromas[i][j];
        add(mesh, lightness, chroma, t, [lightness, t, chroma]);
      });
      [0, 1].forEach(function(t) {
        mesh.grid(WALL_STEPS, LIGHTNESS_STEPS, function(k, j) {
          var lightness = j / LIGHTNESS_STEPS;
          var chroma = chromas[t * HUE_STEPS][j] * k / WALL_STEPS;
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
          if (!inside(lch, gamut)) return missing(point, 'Outside ' + gamut.name);
          if (t0 >= 1 - 1e-6 || l0 >= 1 - 1e-6) return uncut(point);
          var faces = new MeshBuilder();
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
          return { from: [l0, t0, c0], size: [OPEN, OPEN, OPEN], wrap: 0, faces: faces, point: point };
        }
      };
    },

    // The OKHSL colors Pi makes from the most colorful color of each hue at
    // mid lightness (see piEdge), as a solid: lightness up, saturation out,
    // hue around. Its side is how saturated Pi makes that color at each
    // lightness: it reaches OKHSL's full cylinder at mid lightness and
    // narrows toward black and white, and wherever a hue could be more
    // colorful than at mid lightness, the chroma cap pulls it in further.
    // The full cylinder is outlined around it. The cut is a wedge from the
    // selected color's hue, above its lightness and outside its saturation.
    okhsl: function(gamut) {
      var position = function(hue, saturation, lightness) {
        return [
          saturation * CYLINDER_RADIUS * Math.cos(hue),
          lightness,
          -saturation * CYLINDER_RADIUS * Math.sin(hue)
        ];
      };
      var add = function(target, hue, saturation, lightness, coords, keep) {
        target.vertex(position(hue, saturation, lightness),
          okhslToRgb(hue, saturation, lightness, gamut), coords, keep);
      };
      // The selected color in OKHSL, with its chroma limited to sRGB's.
      var selectedHsl = function() {
        var lch = selected();
        return oklchToOkhsl(lch[0], Math.min(lch[1], maxChroma(lch[0], lch[2], GAMUTS.srgb)), lch[2]);
      };

      var mesh = new MeshBuilder();
      mesh.grid(SIDE_STEPS, LIGHTNESS_STEPS, function(i, j) {
        var hue = i / SIDE_STEPS * 2 * Math.PI, lightness = j / LIGHTNESS_STEPS;
        var saturation = piEdge(hue, lightness);
        add(mesh, hue, saturation, lightness, [hue, saturation, lightness]);
      });
      // White on top, black at the bottom.
      [0, 1].forEach(function(lightness) {
        mesh.grid(SIDE_STEPS, 1, function(i, j) {
          var hue = i / SIDE_STEPS * 2 * Math.PI, saturation = piEdge(hue, lightness) * j;
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
      var facing = function() {
        return -Math.PI / 2 - (selectedHsl()[0] + WEDGE / 2) + 0.4;
      };
      return {
        gamut: GAMUTS.srgb,
        mesh: mesh.build(null, true),
        yaw: facing(),
        pitch: 0.45,
        // The cut goes around with the hue, so the shape turns to follow it.
        facing: facing,
        cut: function() {
          var lch = selected();
          var hsl = selectedHsl();
          var h0 = hsl[0] % (2 * Math.PI), s0 = hsl[1], l0 = hsl[2];
          if (!inside(lch, GAMUTS.srgb)) {
            // Past the cylinder, further out the more chroma it lacks.
            var most = maxChroma(lch[0], lch[2], GAMUTS.srgb);
            var beyond = Math.min(1.3, 1 + (lch[1] - most) / Math.max(most, 0.05));
            return missing(position(h0, beyond, l0), 'Outside sRGB');
          }
          if (s0 > piEdge(h0, l0) + GAMUT_TOLERANCE) {
            return missing(position(h0, s0, l0), 'Beyond Pi\'s falloff');
          }
          var faces = new MeshBuilder();
          var ls = steps(l0, 1, Math.max(2, Math.round(LIGHTNESS_STEPS / 2 * (1 - l0))));
          var hues = steps(h0, h0 + WEDGE, WEDGE_STEPS);
          var edgeAt = function(hue) {
            return ls.map(function(lightness) { return piEdge(hue, lightness); });
          };
          // Its sides, at the selected hue and a quarter turn on, out to the edge.
          [h0, h0 + WEDGE].forEach(function(hue) {
            var edges = edgeAt(hue);
            faces.grid(ls.length - 1, SATURATION_STEPS, function(j, k) {
              add(faces, hue, s0 + Math.max(0, edges[j] - s0) * k / SATURATION_STEPS, ls[j], NOT_CUT, edges[j] - s0);
            });
          });
          // Its inner wall, at the selected saturation.
          var walls = hues.map(edgeAt);
          faces.grid(hues.length - 1, ls.length - 1, function(i, j) {
            add(faces, hues[i], s0, ls[j], NOT_CUT, walls[i][j] - s0);
          });
          // Its floor, at the selected lightness.
          var floors = hues.map(function(hue) { return piEdge(hue, l0); });
          faces.grid(hues.length - 1, SATURATION_STEPS, function(i, k) {
            add(faces, hues[i], s0 + Math.max(0, floors[i] - s0) * k / SATURATION_STEPS, l0, NOT_CUT, floors[i] - s0);
          });
          // The cut's edges: up its inner corners and outer rims, around its
          // floor, wherever they are inside the shape.
          [h0, h0 + WEDGE].forEach(function(hue) {
            var edges = edgeAt(hue);
            var keeps = edges.map(function(edge) { return edge - s0; });
            faces.line(ls.map(function(lightness) { return position(hue, s0, lightness); }), keeps);
            faces.line(ls.map(function(lightness, j) {
              return position(hue, Math.max(s0, edges[j]), lightness);
            }), keeps);
          });
          var last = floors.length - 1;
          var floor = [position(h0, Math.max(s0, floors[0]), l0)]
            .concat(hues.map(function(hue) { return position(hue, s0, l0); }))
            .concat([position(h0 + WEDGE, Math.max(s0, floors[last]), l0)]);
          faces.line(floor, [floors[0] - s0].concat(floors.map(function(edge) { return edge - s0; }), [floors[last] - s0]));
          return {
            from: [h0, s0, l0], size: [WEDGE, OPEN, OPEN], wrap: 2 * Math.PI, faces: faces,
            point: position(h0, s0, l0)
          };
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
  // parts of the cut's faces outside the shape, are discarded.
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
    'varying vec3 vColor;',
    'varying vec3 vCoords;',
    'varying float vKeep;',
    'void main() {',
    '  if (vKeep < 0.0) discard;',
    '  vec3 d = vCoords - cutFrom;',
    '  if (cutWrap > 0.0) d.x = mod(d.x, cutWrap);',
    '  if (all(greaterThan(d, vec3(0.0))) && all(lessThan(d, cutSize))) discard;',
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
    var gl = this.canvas.getContext('webgl', { antialias: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;

    var program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    this.uniforms = {};
    ['matrix', 'depthBias', 'outline', 'cutFrom', 'cutSize', 'cutWrap'].forEach(function(name) {
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

    var gamut = pickGamut(gl);
    figure.setAttribute('data-gamut', gamut.canvas);
    this.shape = SHAPES[kind](gamut);
    this.surfaces = this.upload(this.shape.mesh);
    this.cut = null; // set on the first draw
    this.cutChanged = true;

    this.yaw = this.shape.yaw;
    this.pitch = this.shape.pitch;
    this.velocity = 0; // yaw per ms, after letting go of a drag
    this.target = null; // yaw to turn to, following the cut
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
    this.probe = { vertices: gl.createBuffer(), data: new Float32Array(STRIDE) };
    this.probe.data.set([0, 0, 0, 0, 0, 0].concat(NOT_CUT, [1]));
    figure.insertBefore(this.stage, figure.firstChild);
    this.picker = new Picker(this.shape.gamut);
    figure.insertBefore(this.picker.el, figure.querySelector('figcaption'));
    figure.classList.add('is-enhanced');

    this.onSelect = function() {
      self.cutChanged = true;
      if (self.shape.facing && !self.drag) self.target = self.shape.facing();
      self.schedule();
    };
    listeners.push(this.onSelect);

    this.canvas.addEventListener('pointerdown', function(event) { self.pointerDown(event); });
    this.canvas.addEventListener('pointermove', function(event) { self.pointerMove(event); });
    this.canvas.addEventListener('pointerup', function(event) { self.pointerUp(event); });
    this.canvas.addEventListener('pointercancel', function(event) { self.pointerUp(event); });
    this.canvas.addEventListener('keydown', function(event) { self.keyDown(event); });

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
    } else {
      this.visible = true;
    }
    this.draw();
    this.schedule();
  }

  // Uploads a built mesh into buffers, or into existing ones.
  ColorSpace.prototype.upload = function(mesh, buffers) {
    var gl = this.gl;
    buffers = buffers || { vertices: gl.createBuffer(), indices: gl.createBuffer() };
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertices);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
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
      point: cut.point.map(function(value, axis) { return value - offset[axis]; }),
      buffers: this.upload(faces, this.cut && this.cut.buffers)
    };
    this.cutChanged = false;
    this.cutProbed = false; // probe right away
    this.lens.classList.toggle('is-missing', !!cut.missing);
    this.lensLabel.textContent = cut.missing || '';
    this.lens.style.setProperty('--lens-color', css(selection.l, selection.c, selection.h));
  };

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
  // lens's fade covers the delay.
  ColorSpace.prototype.placeLens = function(matrix, ratio) {
    var gl = this.gl;
    var p = this.cut.point;
    var m = matrix;
    var x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    var y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    var w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    var width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    var left = (x / w * 0.5 + 0.5) * width;
    var top = (0.5 - y / w * 0.5) * height;
    this.lens.style.transform = 'translate(' + left.toFixed(1) + 'px, ' + top.toFixed(1) + 'px)';
    var now = performance.now();
    var wait = PROBE_MS - (now - (this.probedAt || 0));
    if (this.cutProbed && wait > 0) {
      // Probe once more when it is time, in case nothing draws by then.
      var self = this;
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
    var px = Math.floor(left * ratio), py = Math.floor(this.height - top * ratio);
    var visible = false;
    if (w > 0 && px >= 0 && py >= 0 && px < this.width && py < this.height) {
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
    this.lens.classList.toggle('is-behind', !visible);
    this.lens.classList.add('is-placed');
  };

  ColorSpace.prototype.idle = function(now) {
    return !this.drag && !prefersReducedMotion() &&
      now - this.lastInteraction > RESUME_IDLE_MS;
  };

  ColorSpace.prototype.animating = function() {
    return this.drag || this.target !== null || Math.abs(this.velocity) > 1e-5 ||
      this.idle(performance.now());
  };

  ColorSpace.prototype.schedule = function() {
    var self = this;
    if (this.frame !== null || !this.visible) return;
    this.frame = requestAnimationFrame(function(now) { self.tick(now); });
  };

  ColorSpace.prototype.tick = function(now) {
    this.frame = null;
    if (!this.figure.isConnected) {
      this.destroy();
      return;
    }
    var dt = this.last === null ? 0 : Math.min(now - this.last, 100);
    this.last = now;
    if (!this.drag) {
      if (this.target !== null) {
        // Turn the short way round, easing in on the cut.
        var delta = this.target - this.yaw;
        delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI));
        if (Math.abs(delta) < 0.002 || prefersReducedMotion()) {
          this.yaw += delta;
          this.target = null;
        } else {
          this.yaw += delta * (1 - Math.exp(-dt / FOLLOW_MS));
        }
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
    if (this.animating()) this.schedule();
    else this.last = null;
  };

  ColorSpace.prototype.draw = function() {
    var gl = this.gl;
    var ratio = window.devicePixelRatio || 1;
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
    var parts = [this.surfaces, cut.buffers];
    var self = this;
    gl.enable(gl.POLYGON_OFFSET_FILL);
    parts.forEach(function(buffers) {
      self.bind(buffers);
      gl.drawElements(gl.TRIANGLES, buffers.triangles, gl.UNSIGNED_SHORT, 0);
    });
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // Lines in the figure's text color, so they follow day and night.
    var rgba = (getComputedStyle(this.figure).color.match(/[\d.]+/g) || [128, 128, 128]).map(Number);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    parts.forEach(function(buffers, index) {
      if (!buffers.lines) return;
      var alpha = (index ? CUT_LINE_ALPHA : OUTLINE_ALPHA) * (rgba.length > 3 ? rgba[3] : 1);
      gl.uniform4f(u.outline, rgba[0] / 255 * alpha, rgba[1] / 255 * alpha, rgba[2] / 255 * alpha, alpha);
      self.bind(buffers);
      gl.drawElements(gl.LINES, buffers.lines, gl.UNSIGNED_SHORT, buffers.triangles * 2);
    });
    gl.disable(gl.BLEND);
    this.placeLens(matrix, ratio);
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
    this.schedule();
  };

  ColorSpace.prototype.destroy = function() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.frame = null;
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.visibilityObserver) this.visibilityObserver.disconnect();
    // Browsers cap live WebGL contexts, so free ours right away.
    var lose = this.gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    this.picker.destroy();
    var index = listeners.indexOf(this.onSelect);
    if (index !== -1) listeners.splice(index, 1);
    index = instances.indexOf(this);
    if (index !== -1) instances.splice(index, 1);
  };

  // An OKLCH color picker: lightness, chroma and hue sliders, each track
  // showing the colors it would select, and leaving out (transparent) those
  // its figure's gamut cannot show. Every figure has one, and they all
  // select the same color.
  var SLIDERS = [
    { key: 'l', label: 'L', name: 'Lightness', max: 1, step: 0.005 },
    { key: 'c', label: 'C', name: 'Chroma', max: MAX_CHROMA, step: 0.001 },
    { key: 'h', label: 'H', name: 'Hue', max: 360, step: 1 }
  ];

  function css(l, c, h) {
    return 'oklch(' + l.toFixed(3) + ' ' + c.toFixed(3) + ' ' + h.toFixed(1) + ')';
  }

  function Picker(gamut) {
    var self = this;
    this.gamut = gamut;
    this.el = document.createElement('div');
    this.el.className = 'color-space__picker';
    this.swatch = document.createElement('span');
    this.swatch.className = 'color-space__swatch';
    this.swatch.setAttribute('aria-hidden', 'true');
    this.el.appendChild(this.swatch);
    this.inputs = {};
    SLIDERS.forEach(function(slider) {
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
      input.setAttribute('aria-label', slider.name);
      input.addEventListener('input', function() {
        var next = { l: selection.l, c: selection.c, h: selection.h };
        next[slider.key] = parseFloat(input.value);
        select(next);
      });
      label.appendChild(text);
      label.appendChild(input);
      self.el.appendChild(label);
      self.inputs[slider.key] = input;
    });
    this.value = document.createElement('output');
    this.value.className = 'color-space__value';
    this.el.appendChild(this.value);
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
    });
    var gamut = this.gamut;
    // Colors along a track, at(t) returning [l, c, h in degrees] for t 0-1.
    var shows = function(lch) {
      return inGamut(oklchToLinear(lch[0], lch[1], lch[2] * Math.PI / 180, gamut));
    };
    var paint = function(lch) {
      var rgb = oklchToRgb(lch[0], lch[1], lch[2] * Math.PI / 180, gamut);
      if (gamut === GAMUTS.p3) return 'color(display-p3 ' + rgb.map(function(v) { return v.toFixed(4); }).join(' ') + ')';
      return 'rgb(' + rgb.map(function(v) { return (v * 255).toFixed(1); }).join(' ') + ')';
    };
    // Where the thumb's center is at t: it stops half its width from the ends.
    var at = function(t) { return 'calc(7px + (100% - 14px) * ' + t.toFixed(4) + ')'; };
    var track = function(along, count) {
      var stops = [];
      var before = null;
      for (var i = 0; i <= count; i++) {
        var t = i / count;
        var lch = along(t);
        var inside = shows(lch);
        if (before !== null && inside !== before.inside) {
          // A hard edge where the gamut ends, found by bisection.
          var low = before.t, high = t;
          for (var k = 0; k < 12; k++) {
            var mid = (low + high) / 2;
            if (shows(along(mid)) === before.inside) low = mid;
            else high = mid;
          }
          var edge = before.inside ? paint(along(low)) : paint(along(high));
          stops.push((before.inside ? edge : 'transparent') + ' ' + at(low));
          stops.push((before.inside ? 'transparent' : edge) + ' ' + at(low));
        }
        stops.push((inside ? paint(lch) : 'transparent') + ' ' + at(t));
        before = { t: t, inside: inside };
      }
      return 'linear-gradient(to right, ' + stops.join(', ') + ')';
    };
    inputs.l.style.setProperty('--track', track(function(t) { return [t, color.c, color.h]; }, 60));
    inputs.c.style.setProperty('--track', track(function(t) { return [color.l, t * MAX_CHROMA, color.h]; }, 60));
    inputs.h.style.setProperty('--track', track(function(t) { return [color.l, color.c, t * 360]; }, 90));
    this.swatch.style.background = css(color.l, color.c, color.h);
    // Fixed digits, in a box of fixed width (prose.css): if its width
    // changed, the centered sliders would move under the pointer.
    this.value.textContent = 'oklch(' + (color.l * 100).toFixed(1) + '% ' +
      color.c.toFixed(3) + ' ' + color.h.toFixed(0) + ')';
  };

  Picker.prototype.destroy = function() {
    var index = listeners.indexOf(this.update);
    if (index !== -1) listeners.splice(index, 1);
  };

  function initColorSpaces() {
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
})();
