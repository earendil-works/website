const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

function load() {
  function element() {
    return {
      children: [], attributes: {}, events: {}, value: '',
      style: { setProperty(key, value) { this[key] = value; } },
      appendChild(child) { this.children.push(child); },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, listener) { this.events[key] = listener; }
    };
  }
  const context = vm.createContext({
    window: {},
    document: { createElement: element, querySelectorAll: () => [], body: element() }
  });
  const source = readFileSync(new URL('../_static/color-spaces.js', `file://${__filename}`), 'utf8');
  vm.runInContext(source.replace('  initColorSpaces();', `
    window.test = { GAMUTS, Picker, ColorReadout, selectHex, previewOffset, rgbToOklch, oklchToLinear, encodeUnclipped, inGamut, select,
      selection: function() { return selection; } };
    initColorSpaces();`), context);
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
  assert.equal(readout.el.hidden, true);
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
