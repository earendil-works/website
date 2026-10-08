const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

function load() {
  function element() {
    return {
      children: [], attributes: {}, events: {}, value: '', hidden: false,
      style: { setProperty(key, value) { this[key] = value; } },
      appendChild(child) { this.children.push(child); },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, listener) { this.events[key] = listener; },
      removeEventListener(key, listener) { if (this.events[key] === listener) delete this.events[key]; }
    };
  }
  const context = vm.createContext({
    window: { matchMedia: () => ({ matches: false }) },
    performance: { now: () => 1000 },
    document: { createElement: element, querySelector: () => null, querySelectorAll: () => [], body: element() }
  });
  const source = readFileSync(new URL('../_static/color-spaces.js', `file://${__filename}`), 'utf8');
  vm.runInContext(source.replace('  initColorSpaces();', `
    window.test = { GAMUTS, Picker, ColorReadout, ColorSpace, instances, SHAPES, PI_FAMILIES, PI_ROLES, piSaturation, piRangeSaturation, piFallbackSaturation,
      selectedOkhsl, okhslToOklch, okhslToRgb, selectHex, selectDefaultHex, previewOffset, rgbToOklch, oklchToLinear, encodeUnclipped, inGamut, select,
      selection: function() { return selection; } };
    initColorSpaces();`), context);
  context.window.test.document = context.document;
  return context.window.test;
}

function rgbOf(api, color, gamut) {
  return api.oklchToLinear(color.l, color.c, color.h * Math.PI / 180, gamut).map(api.encodeUnclipped);
}

function close(actual, expected, tolerance = 2e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('RGB conversions round-trip in sRGB and Display P3, including cube corners', () => {
  const api = load();
  for (const gamut of Object.values(api.GAMUTS)) {
    for (const r of [0, 0.02, 0.5, 1]) {
      for (const g of [0, 0.02, 0.5, 1]) {
        for (const b of [0, 0.02, 0.5, 1]) {
          const rgb = [r, g, b];
          const color = api.rgbToOklch(rgb, gamut, 250);
          rgbOf(api, color, gamut).forEach((v, i) => close(v, rgb[i]));
        }
      }
    }
  }
});

test('achromatic RGB colors retain the selected hue', () => {
  const api = load();
  for (const gamut of Object.values(api.GAMUTS)) {
    for (const gray of [0, 0.5, 1]) {
      const color = api.rgbToOklch([gray, gray, gray], gamut, 123);
      assert.equal(color.h, 123);
      assert.equal(color.c, 0);
    }
  }
});

test('RGB controls are capped, synchronized, and painted in their own gamut', () => {
  const api = load();
  const srgb = new api.Picker(api.GAMUTS.srgb);
  const p3 = new api.Picker(api.GAMUTS.p3);
  for (const picker of [srgb, p3]) {
    for (const key of ['r', 'g', 'b']) {
      assert.equal(picker.inputs[key].min, '0');
      assert.equal(picker.inputs[key].max, '255');
      assert.equal(picker.inputs[key].step, '1');
    }
  }
  assert.match(p3.inputs.r.style['--track'], /color\(display-p3/);
  srgb.inputs.r.value = '255';
  srgb.inputs.r.events.input();
  close(rgbOf(api, api.selection(), api.GAMUTS.srgb)[0], 1);
  assert.equal(Number(srgb.inputs.r.value), 255);
  close(Number(p3.inputs.l.value), api.selection().l);
  assert.match(srgb.rgbValue.textContent, /^rgb\(255 /);
});

test('showing an out-of-gamut color does not clip selection; RGB editing caps every channel', () => {
  const api = load();
  const picker = new api.Picker(api.GAMUTS.srgb);
  const color = { l: 0.65, c: 0.37, h: 250 };
  api.select(color);
  assert.equal(api.selection(), color);
  assert.equal(picker.rgbValue.textContent, 'Outside sRGB');
  assert.equal(picker.inputs.r.attributes['aria-valuetext'], 'Outside sRGB');
  // Other channels are out of range, so the whole red track is unavailable.
  assert.match(picker.inputs.r.style['--track'], /transparent/);
  assert.doesNotMatch(picker.inputs.r.style['--track'], /rgb\(/);
  for (const value of ['-20', '300']) {
    api.select(color);
    picker.inputs.r.value = value;
    picker.inputs.r.events.input();
    const rgb = rgbOf(api, api.selection(), api.GAMUTS.srgb);
    rgb.forEach(v => assert.ok(v >= -2e-6 && v <= 1 + 2e-6));
    close(rgb[0], value === '-20' ? 0 : 1);
    assert.match(picker.rgbValue.textContent, /^rgb\(/);
  }
  picker.destroy();
  const oldValue = picker.value.textContent;
  api.select({ l: 0.5, c: 0.1, h: 30 });
  assert.equal(picker.value.textContent, oldValue);
});

test('article hex colors select sRGB and synchronize every figure and terminal readout', () => {
  const api = load();
  const srgb = new api.Picker(api.GAMUTS.srgb);
  const p3 = new api.Picker(api.GAMUTS.p3);
  const readout = new api.ColorReadout();
  assert.equal(readout.el.hidden, false);
  assert.equal(readout.el.children.length, 3); // swatch and outputs, no controls
  for (const hex of ['#0000ff', '#00ff00', '#f4b8e4', '#eb76d1', '#cc92bd', '#FFFFFF', '#000000']) {
    api.selectHex(hex);
    const expected = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    rgbOf(api, api.selection(), api.GAMUTS.srgb).forEach((v, i) => close(v * 255, expected[i], 0.001));
    assert.equal(readout.el.hidden, false);
    assert.equal(readout.rgbValue.textContent, `rgb(${expected.join(' ')})`);
    assert.equal(readout.value.textContent, srgb.value.textContent);
    assert.equal(readout.value.textContent, p3.value.textContent);
    assert.equal(readout.swatch.style.background, srgb.swatch.style.background);
  }
  const selection = api.selection();
  for (const hex of ['not a color', '#123', '#1234567', '#gggggg']) api.selectHex(hex);
  assert.equal(api.selection(), selection);
});

test('theme backgrounds are shown by default and followed until an explicit selection', () => {
  const api = load();
  api.selectDefaultHex('#282c34');
  const readout = new api.ColorReadout();
  assert.equal(readout.el.hidden, false);
  assert.equal(readout.rgbValue.textContent, 'rgb(40 44 52)');
  api.selectDefaultHex('#eff1f5');
  assert.equal(readout.rgbValue.textContent, 'rgb(239 241 245)');
  api.selectHex('#f4b8e4');
  api.selectDefaultHex('#282c34');
  assert.equal(readout.rgbValue.textContent, 'rgb(244 184 228)');
});

test('eyedropper lens flips at player edges and keeps its outer ring inside', () => {
  const { previewOffset } = load();
  assert.equal(previewOffset(100, 400, 24), 116);
  assert.equal(previewOffset(399, 400, 24), 359);
  for (const extent of [48, 200, 400]) {
    for (let pointer = 0; pointer <= extent; pointer++) {
      const offset = previewOffset(pointer, extent, 24);
      assert.ok(offset >= 4);
      assert.ok(offset + 24 + 4 <= extent);
    }
  }
});

test('Pi falloff is anchored to the source and preserves it at its own lightness', () => {
  const api = load();
  assert.equal(Object.keys(api.PI_FAMILIES).length, 14);
  for (const hex of ['#f4b8e4', '#81a2be', '#00ff00', '#0000ff', '#888888', '#000000', '#ffffff']) {
    api.selectHex(hex);
    const source = api.selectedOkhsl();
    for (const family of Object.values(api.PI_FAMILIES)) {
      close(api.piSaturation(family, 0.5), 1);
      close(api.piSaturation(family, 0), family.min / family.max);
      close(api.piSaturation(family, 1), family.min / family.max);
      close(api.piRangeSaturation(source, family, source[2], 1), source[1], 2e-5);
      assert.ok(api.piRangeSaturation(source, family, 0.5, 1) <= source[1] + 1e-9);
    }
  }
});

test('every family caps chroma with the anchored falloff at every saturation setting', () => {
  const api = load();
  for (const hex of ['#f4b8e4', '#81a2be', '#00ff00', '#0000ff', '#888888']) {
    api.selectHex(hex);
    const source = api.selectedOkhsl();
    for (const family of Object.values(api.PI_FAMILIES)) {
      for (const lightness of [0, 0.05, 0.2, 0.4, 0.5, 0.7, 0.95, 1]) {
        const falloff = Math.min(1, api.piSaturation(family, lightness) / api.piSaturation(family, source[2]));
        let previous = 0;
        for (const multiplier of [0, 0.1, 0.4, 0.7, 1]) {
          const saturation = api.piRangeSaturation(source, family, lightness, multiplier);
          assert.ok(saturation >= previous - 1e-9);
          assert.ok(saturation <= source[1] * falloff * multiplier + 1e-9);
          const lch = api.okhslToOklch(source[0], saturation, lightness);
          assert.ok(lch[1] <= source[3] * falloff * multiplier + 1e-9);
          assert.ok(api.okhslToRgb(source[0], saturation, lightness, api.GAMUTS.srgb).every(Number.isFinite));
          previous = saturation;
        }
      }
    }
  }
});

test('continuous range colors match Pi’s anchored RGB outputs within 8-bit rounding', () => {
  const api = load();
  // Generated with system-theme.ts's anchored() and pi-tui's color conversions.
  const cases = [
    ['#f4b8e4', 'violet', 0.2, 1, [72, 25, 63]],
    ['#f4b8e4', 'violet', 0.5, 1, [152, 98, 139]],
    ['#f4b8e4', 'violet', 0.8, 1, [237, 177, 221]],
    ['#f4b8e4', 'violet', 0.5, 0.4, [133, 111, 127]],
    ['#81a2be', 'blue', 0.8, 1, [187, 201, 213]],
    ['#ffff00', 'yellow', 0.4, 1, [98, 98, 0]],
    ['#ef596f', 'thinkingRed', 0.9, 1, [252, 216, 218]]
  ];
  for (const [hex, family, lightness, multiplier, expected] of cases) {
    api.selectHex(hex);
    const source = api.selectedOkhsl();
    const saturation = api.piRangeSaturation(source, api.PI_FAMILIES[family], lightness, multiplier);
    const rgb = api.okhslToRgb(source[0], saturation, lightness, api.GAMUTS.srgb);
    rgb.forEach((channel, i) => close(channel * 255, expected[i], 1.5));
  }
});

test('fallback curves use each family’s absolute saturation, not the selected source', () => {
  const api = load();
  for (const family of Object.values(api.PI_FAMILIES)) {
    close(api.piFallbackSaturation(family, 0, 1), family.min);
    close(api.piFallbackSaturation(family, 1, 1), family.min);
    close(api.piFallbackSaturation(family, 0.5, 1), family.max);
    close(api.piFallbackSaturation(family, 0.5, 0.4), family.max * 0.4);
  }
  assert.ok(api.PI_FAMILIES.thinkingRed.min / api.PI_FAMILIES.thinkingRed.max > 0.9);
});

test('the full cylinder is fixed and accepts colors beyond the old global falloff', () => {
  const api = load();
  api.selectHex('#f4b8e4');
  const shape = api.SHAPES.okhsl(api.GAMUTS.srgb);
  assert.equal(shape.cut().missing, undefined);
  api.selectHex('#00ff00');
  assert.deepEqual(shape.mesh.vertices, api.SHAPES.okhsl(api.GAMUTS.srgb).mesh.vertices);
  assert.equal(shape.cut().missing, undefined);
});

test('roles cover every family and slot pair Pi uses', () => {
  const api = load();
  const pairs = new Set(api.PI_ROLES.map(role => role.family + ':' + role.slot));
  assert.equal(api.PI_ROLES.length, 16);
  assert.equal(pairs.size, 16);
  assert.deepEqual(new Set(api.PI_ROLES.map(role => role.family)), new Set(Object.keys(api.PI_FAMILIES)));
  const role = id => api.PI_ROLES.find(item => item.id === id);
  assert.deepEqual([role('accent').family, role('accent').slot], ['violet', 5]);
  assert.deepEqual([role('strings').family, role('strings').slot], ['orange', 2]);
  assert.deepEqual([role('numbers').family, role('numbers').slot], ['green', 5]);
  assert.deepEqual([role('thinkingXhigh').family, role('thinkingXhigh').slot], ['thinkingMagenta', 13]);
});

test('Pi’s slice follows roles, theme palettes, defaults and custom colors', () => {
  const api = load();
  // Catppuccin Frappé's ANSI palette, as the demo's theme picker publishes it.
  const frappe = '#51576d #e78284 #a6d189 #e5c890 #8caaee #f4b8e4 #81c8be #b5bfe2 ' +
    '#626880 #e78284 #a6d189 #e5c890 #8caaee #f4b8e4 #81c8be #a5adce';
  const player = { dataset: { colorPalette: frappe, colorTheme: 'Catppuccin Frappé' } };
  api.document.querySelector = () => player;
  const shape = api.SHAPES['pi-range'](api.GAMUTS.srgb);
  let changes = 0;
  const controls = shape.controls(() => changes++);
  const role = controls.children[0].children[1];
  const reset = controls.children[1];
  assert.equal(role.children.length, 3); // interface, syntax, thinking
  assert.equal(role.children.reduce((sum, group) => sum + group.children.length, 0), 16);
  const rgb = () => [...rgbOf(api, api.selection(), api.GAMUTS.srgb)].map(v => Math.round(v * 255) + 0);

  // A role selects its slot in the current theme.
  role.value = 'accent';
  role.events.change();
  assert.deepEqual(rgb(), [244, 184, 228]);
  assert.match((cut => cut.captions[cut.caption])(shape.cut()), /Accent uses Catppuccin Frappé’s ANSI magenta with Pi’s violet recipe/);
  const pink = shape.cut().faces.build(shape.mesh.offset);
  assert.ok(pink.vertices.every(Number.isFinite));
  assert.ok(Math.max(...pink.indices) < 65536);
  const hue = api.selection().h * Math.PI / 180;
  for (let i = 0; i < pink.vertices.length; i += 10) {
    close(pink.vertices[i] * Math.sin(hue) + pink.vertices[i + 2] * Math.cos(hue), 0);
  }
  role.value = 'numbers';
  role.events.change();
  assert.deepEqual(rgb(), [244, 184, 228]); // the same magenta slot ...
  assert.notDeepEqual(pink.vertices, shape.cut().faces.build(shape.mesh.offset).vertices); // ... another recipe
  role.value = 'strings';
  role.events.change();
  assert.deepEqual(rgb(), [166, 209, 137]);

  // Switching the demo's theme follows the role.
  player.dataset.colorPalette = frappe.replace('#a6d189', '#00ff00');
  api.document.body.events['asciicast:theme']();
  assert.deepEqual(rgb(), [0, 255, 0]);

  // Reset selects Pi's own color, with the family's absolute curve.
  role.value = 'warning';
  role.events.change();
  reset.events.click();
  close(api.selection().h, api.PI_FAMILIES.yellow.hue);
  close(api.selectedOkhsl()[1], api.PI_FAMILIES.yellow.max, 2e-5);
  close(api.selectedOkhsl()[2], 0.5, 2e-5);
  assert.match((cut => cut.captions[cut.caption])(shape.cut()), /default color for warning/);
  const marker = shape.cut().point;
  close(Math.hypot(marker[0], marker[2]), 0.55 * api.PI_FAMILIES.yellow.max);
  close(Math.atan2(-marker[2], marker[0]), api.PI_FAMILIES.yellow.hue * Math.PI / 180);
  // A theme change no longer moves a default or custom color.
  api.document.body.events['asciicast:theme']();
  close(api.selectedOkhsl()[1], api.PI_FAMILIES.yellow.max, 2e-5);

  // Any other selection is a custom palette color.
  api.selectHex('#f4b8e4');
  assert.match((cut => cut.captions[cut.caption])(shape.cut()), /custom color with the warning role’s recipe \(yellow\)/);
  api.document.body.events['asciicast:theme']();
  assert.deepEqual(rgb(), [244, 184, 228]);
  api.select({ l: 0.65, c: 0.37, h: 250 });
  assert.equal(shape.cut().missing, 'Outside sRGB');
  assert.equal(changes, 5);

  // Without a theme palette, a role falls back to Pi's default color.
  api.document.querySelector = () => null;
  role.value = 'error';
  role.events.change();
  close(api.selection().h, api.PI_FAMILIES.red.hue);
  shape.destroy();
  assert.equal(api.document.body.events['asciicast:theme'], undefined);
  for (const hex of ['#000000', '#ffffff', '#888888']) {
    api.selectHex(hex);
    assert.ok(shape.cut().faces.build(shape.mesh.offset).vertices.every(Number.isFinite));
  }
});

test('paired camera animation follows the source without passive frames cancelling its target', () => {
  const api = load();
  const pair = {};
  const view = () => Object.assign(Object.create(api.ColorSpace.prototype), {
    pair, figure: { isConnected: true }, frame: null, last: 0, yaw: 0, pitch: 0.45,
    target: 1, velocity: 0, drag: null, visible: true,
    draw() {}, schedule() {}
  });
  const left = view(), right = view();
  api.instances.push(left, right);
  for (let now = 16; now <= 1600; now += 16) {
    left.tick(now);
    right.tick(now);
    close(left.yaw, right.yaw);
    assert.equal(left.pitch, right.pitch);
  }
  close(left.yaw, 1);
  assert.equal(left.target, null);
  assert.equal(right.target, null);
});

test('terminal readout handles selections made before player load and outside sRGB', () => {
  const api = load();
  api.selectHex('#f4b8e4');
  const readout = new api.ColorReadout();
  assert.equal(readout.el.hidden, false);
  assert.equal(readout.rgbValue.textContent, 'rgb(244 184 228)');
  const color = { l: 0.65, c: 0.37, h: 250 };
  api.select(color);
  assert.equal(readout.rgbValue.textContent, 'Outside sRGB');
  assert.equal(api.selection(), color); // displaying does not clip
  readout.destroy();
  const oldValue = readout.value.textContent;
  api.selectHex('#cc92bd');
  assert.equal(readout.value.textContent, oldValue);
});
