// Overlay animation handling
(function() {
  function openOverlays() {
    var hasOverlay = document.querySelectorAll('.updates-overlay').length > 0;
    document.body.classList.toggle('has-overlay', hasOverlay);
    document.querySelectorAll('.updates-overlay').forEach(function(overlay) {
      void overlay.offsetWidth;
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
    });
    if (hasOverlay) {
      window.scrollTo(0, 0);
    }
  }
  openOverlays();

  // Only add listeners once
  if (window.__overlayListenersAdded) return;
  window.__overlayListenersAdded = true;

  document.body.addEventListener('htmx:afterSettle', openOverlays);

  function closeOverlayWithAnimation(overlay, callback) {
    overlay.classList.add('is-closing');
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('has-overlay');
    setTimeout(callback, 350); // Match CSS transition duration
  }

  function navigateTo(url) {
    htmx.ajax('GET', url, {target: 'div.page', swap: 'outerHTML'}).then(function() {
      history.pushState({}, '', url);
    });
  }

  // Handle dismiss link clicks - animate then navigate
  document.body.addEventListener('click', function(event) {
    var dismissLink = event.target.closest('.updates-dismiss');
    if (dismissLink) {
      event.preventDefault();
      event.stopPropagation();
      var overlay = dismissLink.closest('.updates-overlay');
      if (overlay) {
        var dismissUrl = dismissLink.getAttribute('data-dismiss-url') || '/';
        closeOverlayWithAnimation(overlay, function() {
          navigateTo(dismissUrl);
        });
      }
    }
  }, true);

  // Handle background clicks while allowing underlying links
  document.body.addEventListener('click', function(event) {
    var overlay = document.querySelector('.updates-overlay.is-open');
    if (!overlay) return;
    if (event.target.closest('.updates-letter')) return;
    if (event.target.closest('.updates-dismiss')) return;
    if (event.target.closest('a')) return;
    var dismissLink = overlay.querySelector('.updates-dismiss');
    var dismissUrl = (dismissLink && dismissLink.getAttribute('data-dismiss-url')) || '/';
    closeOverlayWithAnimation(overlay, function() {
      navigateTo(dismissUrl);
    });
  });

  // Handle Escape key to close overlay
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      var overlay = document.querySelector('.updates-overlay.is-open');
      if (!overlay) return;
      event.preventDefault();
      var dismissLink = overlay.querySelector('.updates-dismiss');
      var dismissUrl = (dismissLink && dismissLink.getAttribute('data-dismiss-url')) || '/';
      closeOverlayWithAnimation(overlay, function() {
        navigateTo(dismissUrl);
      });
    }
  });
})();

// Subscribe form handling (updates page email flow)
(function() {
  function initUpdatesForm() {
    var form = document.querySelector('[data-subscribe-form]');
    if (!form || form.dataset.initialized) return;
    form.dataset.initialized = 'true';

    var input = document.getElementById('updates-email');
    if (!input) return;

    var enterBtn = document.getElementById('updates-enter');
    var messageEl = document.getElementById('updates-message');
    var wrapper = form.querySelector('.updates-input-wrapper');
    var isPlaceholder = input.value === '';
    var wasValid = false;

    // Create hidden measuring element for auto-sizing
    var measure = document.createElement('span');
    measure.className = 'updates-measure';
    measure.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(measure);

    function updateInputWidth() {
      var text = input.value || input.placeholder || '';
      measure.textContent = text;
      // Add a small buffer for the caret
      var width = measure.offsetWidth + 2;
      input.style.width = width + 'px';
    }

    // Valid email: user@domain.tld where tld has 2+ chars after final dot
    function isValidEmail(email) {
      var atIndex = email.indexOf('@');
      if (atIndex < 1) return false;
      var domain = email.slice(atIndex + 1);
      var lastDot = domain.lastIndexOf('.');
      if (lastDot < 1) return false;
      var tld = domain.slice(lastDot + 1);
      return tld.length >= 2;
    }

    function showValidGlow() {
      // Remove and re-add to restart animation
      input.classList.remove('valid-glow');
      void input.offsetWidth; // Force reflow
      input.classList.add('valid-glow');
    }

    function hideValidGlow() {
      input.classList.remove('valid-glow');
    }

    function updateState() {
      var val = input.value;
      var isEmpty = val === '';
      var isValid = isValidEmail(val);

      updateInputWidth();

      if (isEmpty) {
        isPlaceholder = true;
        input.classList.add('placeholder-text');
        hideValidGlow();
        if (enterBtn) enterBtn.hidden = true;
        wasValid = false;
      } else if (isValid) {
        isPlaceholder = false;
        input.classList.remove('placeholder-text');
        // Trigger glow animation when becoming valid
        if (!wasValid) {
          showValidGlow();
        }
        if (enterBtn) enterBtn.hidden = false;
        wasValid = true;
      } else {
        isPlaceholder = false;
        input.classList.remove('placeholder-text');
        hideValidGlow();
        if (enterBtn) enterBtn.hidden = true;
        wasValid = false;
      }
    }

    input.addEventListener('focus', function() {
      hideValidGlow();
      // Keep wasValid in sync so we don't replay animation
      wasValid = isValidEmail(input.value);
      updateState();
    });

    input.addEventListener('input', function() {
      updateState();
    });

    input.addEventListener('blur', function() {
      if (input.value === '') {
        isPlaceholder = true;
        hideValidGlow();
        input.classList.add('placeholder-text');
        if (enterBtn) enterBtn.hidden = true;
        wasValid = false;
      } else if (isValidEmail(input.value)) {
        showValidGlow();
        if (enterBtn) enterBtn.hidden = false;
        wasValid = true;
      }
    });

    if (wrapper) {
      wrapper.addEventListener('click', function(e) {
        if (e.target !== input) input.focus();
      });
    }

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && isValidEmail(input.value)) {
        e.preventDefault();
        submit();
      }
    });

    if (enterBtn) {
      enterBtn.addEventListener('click', function() {
        if (isValidEmail(input.value)) submit();
      });
    }

    function submit() {
      var email = input.value;
      if (isPlaceholder || !isValidEmail(email)) {
        updateState();
        return;
      }

      if (wrapper) {
        wrapper.style.transition = 'opacity 0.25s ease';
        wrapper.style.opacity = '0';
      }
      setTimeout(function() {
        if (wrapper) wrapper.style.display = 'none';
        if (messageEl) {
          showAnimatedMessage('Storing at the speed of light');
        }
      }, 250);

      fetch('https://script.google.com/macros/s/AKfycbxtaYo7U3mpdwBnfl3O735PTKySaypH3JbYczz4tLJ7je-qBRgjQrZS0ZyB6bMRwt-4cQ/exec', {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ email: email })
      })
      .then(function() {
        showAnimatedMessage('Welcome aboard');
      })
      .catch(function() {
        showAnimatedMessage('Something went wrong');
        setTimeout(function() {
          if (wrapper) {
            wrapper.style.display = '';
            wrapper.style.opacity = '1';
          }
          if (messageEl) {
            messageEl.hidden = true;
            messageEl.classList.remove('valid');
          }
          updateState();
        }, 2000);
      });
    }

    function showAnimatedMessage(text) {
      if (!messageEl) return;
      messageEl.textContent = text;
      messageEl.classList.remove('valid');
      void messageEl.offsetWidth; // Force reflow to restart animation
      messageEl.classList.add('valid');
      messageEl.hidden = false;
    }

    // Initialize
    updateState();

    // Auto-focus the email input
    input.focus();
  }

  initUpdatesForm();
  document.body.addEventListener('htmx:afterSettle', initUpdatesForm);
})();

// WebGL ocean rendering (runs once)
(function() {
if (window.__earendilInitialized) return;
window.__earendilInitialized = true;

// Show FPS counter only if ?fps is in URL
var fpsDisplay = document.getElementById('fps');
if (new URLSearchParams(window.location.search).has('fps')) {
  fpsDisplay.classList.add('visible');
}

const canvas = document.getElementById('canvas');
const logo = document.getElementById('logo');
const themeToggle = document.getElementById('theme-toggle');
const gl = canvas.getContext('webgl');

const LOGO_SVG_URL = '/static/earendil-logo.svg';

const THEME_STORAGE_KEY = 'earendil-theme-mode';
const THEME_MODES = ['auto', 'night', 'day'];
const THEME_LABELS = {
  auto: 'AUTO',
  night: 'DARK',
  day: 'LIGHT'
};

// Quality settings for slower computers
const QUALITY_LEVELS = ['low', 'medium', 'high'];
const QUALITY_SETTINGS = {
  low: {
    scale: 0.25,
    lowDpiScale: 0.425,  // 1.7x for low DPI screens
    raymarchSteps: 20,
    waveIterRaymarch: 4,
    waveIterNormal: 16,
    fbmOctaves: 2
  },
  medium: {
    scale: 0.35,
    lowDpiScale: 0.595,  // 1.7x for low DPI screens
    raymarchSteps: 24,
    waveIterRaymarch: 6,
    waveIterNormal: 16,
    fbmOctaves: 3
  },
  high: {
    scale: 0.4,
    lowDpiScale: 0.68,   // 1.7x for low DPI screens
    raymarchSteps: 32,
    waveIterRaymarch: 8,
    waveIterNormal: 16,
    fbmOctaves: 4
  }
};

// Low DPI threshold and noise scale multiplier
const LOW_DPI_THRESHOLD = 1.5;
const LOW_DPI_NOISE_SCALE = 1.7;

let currentQuality = 'high';

// Adaptive quality settings
const AUTO_QUALITY_FPS_LOW = 28;      // Drop quality if FPS below this
const AUTO_QUALITY_FPS_HIGH = 55;     // Increase quality if FPS above this
const AUTO_QUALITY_SAMPLE_TIME = 2000; // Time window to average FPS (ms)
const AUTO_QUALITY_COOLDOWN = 4000;   // Minimum time between quality changes (ms)
let autoQualityFpsHistory = [];
let lastQualityChangeTime = 0;

function loadThemeMode() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (THEME_MODES.includes(stored)) {
      return stored;
    }
  } catch (error) {
    console.warn('Unable to access localStorage for theme mode.', error);
  }
  return 'auto';
}

let themeMode = loadThemeMode();

const colorSchemeQuery = window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;
let prefersNight = colorSchemeQuery ? colorSchemeQuery.matches : false;

if (colorSchemeQuery) {
  const onSchemeChange = (event) => {
    prefersNight = event.matches;
    applyThemePreference();
  };
  if (colorSchemeQuery.addEventListener) {
    colorSchemeQuery.addEventListener('change', onSchemeChange);
  } else if (colorSchemeQuery.addListener) {
    colorSchemeQuery.addListener(onSchemeChange);
  }
}

function getNightPreference() {
  if (themeMode === 'auto') {
    return prefersNight;
  }
  return themeMode === 'night';
}

function applyThemePreference() {
  const isNight = getNightPreference();
  document.body.classList.toggle('theme-night', isNight);
}

function updateThemeToggle() {
  const valueSpan = themeToggle.querySelector('.value');
  valueSpan.textContent = THEME_LABELS[themeMode] || THEME_LABELS.auto;
  themeToggle.setAttribute('aria-label', `Appearance: ${THEME_LABELS[themeMode]}`);
  applyThemePreference();
}

function persistThemeMode() {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  } catch (error) {
    console.warn('Unable to persist theme mode.', error);
  }
}

themeToggle.addEventListener('click', () => {
  const currentIndex = THEME_MODES.indexOf(themeMode);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % THEME_MODES.length;
  themeMode = THEME_MODES[nextIndex];
  persistThemeMode();
  updateThemeToggle();
});

updateThemeToggle();



const THEME_FADE_DURATION = 900;
let nightBlend = getNightPreference() ? 1.0 : 0.0;
let nightFadeStart = null;
let nightFadeFrom = nightBlend;
let nightFadeTo = nightBlend;

// 404 page camera animation
const CAMERA_404_DURATION = 3000; // 3 seconds
const CAMERA_404_Y_OFFSET = 1.0;  // Move camera up
const CAMERA_404_Z_OFFSET = -8.0; // Move camera back (towards viewer)
const CAMERA_404_TILT_OFFSET = -0.7; // Tilt camera down (radians)
let camera404AnimStart = null;
let camera404AnimFrom = { y: 0, z: 0, tilt: 0 };
let camera404AnimTo = { y: 0, z: 0, tilt: 0 };
let cameraYOffset = 0;
let cameraZOffset = 0;
let cameraTiltOffset = 0;

function is404Page() {
  const page = document.querySelector('.page');
  return page && page.dataset.pageType === '404';
}

// Initialize target based on initial page state
if (is404Page()) {
  camera404AnimTo = { y: CAMERA_404_Y_OFFSET, z: CAMERA_404_Z_OFFSET, tilt: CAMERA_404_TILT_OFFSET };
}

function easeInOut(t) {
  return t * t * (3.0 - 2.0 * t);
}

function check404PageState() {
  const is404Now = is404Page();
  const targetY = is404Now ? CAMERA_404_Y_OFFSET : 0;
  const targetZ = is404Now ? CAMERA_404_Z_OFFSET : 0;
  const targetTilt = is404Now ? CAMERA_404_TILT_OFFSET : 0;
  
  // If target changed, start new animation from current position
  if (camera404AnimTo.y !== targetY || camera404AnimTo.z !== targetZ || camera404AnimTo.tilt !== targetTilt) {
    camera404AnimFrom = { y: cameraYOffset, z: cameraZOffset, tilt: cameraTiltOffset };
    camera404AnimTo = { y: targetY, z: targetZ, tilt: targetTilt };
    camera404AnimStart = null; // Will be set on next render frame
  }
}

function updateCamera404(time) {
  // Already at target
  if (cameraYOffset === camera404AnimTo.y && cameraZOffset === camera404AnimTo.z && cameraTiltOffset === camera404AnimTo.tilt) {
    return;
  }

  if (camera404AnimStart === null) {
    camera404AnimStart = time;
  }

  const elapsed = time - camera404AnimStart;
  const progress = Math.min(elapsed / CAMERA_404_DURATION, 1);
  const eased = easeInOut(progress);

  cameraYOffset = camera404AnimFrom.y + (camera404AnimTo.y - camera404AnimFrom.y) * eased;
  cameraZOffset = camera404AnimFrom.z + (camera404AnimTo.z - camera404AnimFrom.z) * eased;
  cameraTiltOffset = camera404AnimFrom.tilt + (camera404AnimTo.tilt - camera404AnimFrom.tilt) * eased;
  
  // Snap to final values when done
  if (progress >= 1) {
    cameraYOffset = camera404AnimTo.y;
    cameraZOffset = camera404AnimTo.z;
    cameraTiltOffset = camera404AnimTo.tilt;
  }
}

// Listen for HTMX navigation to update 404 state
document.body.addEventListener('htmx:afterSettle', check404PageState);

function updateNightBlend(time) {
  const desired = getNightPreference() ? 1.0 : 0.0;
  if (desired !== nightFadeTo) {
    nightFadeFrom = nightBlend;
    nightFadeTo = desired;
    nightFadeStart = time;
  }

  if (nightFadeStart !== null) {
    const progress = Math.min((time - nightFadeStart) / THEME_FADE_DURATION, 1);
    const eased = easeInOut(progress);
    nightBlend = nightFadeFrom + (nightFadeTo - nightFadeFrom) * eased;
    if (progress >= 1) {
      nightFadeStart = null;
      nightBlend = nightFadeTo;
    }
  } else {
    nightBlend = nightFadeTo;
  }

  return nightBlend;
}

const vertexShaderSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

// Dither post-process shaders
const ditherVertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

// Film grain post-process shader based on martins upitis's film grain
const ditherFragmentShaderSource = `
  precision highp float;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_night;
  uniform float u_noiseScale;
  varying vec2 v_texCoord;

  #define INTENSITY_DAY 0.4
  #define INTENSITY_NIGHT 0.065
  #define SPEED 1.5
  #define MEAN 0.0
  #define VARIANCE_DAY 0.75
  #define VARIANCE_NIGHT 0.6

  float gaussian(float z, float u, float o) {
    return (1.0 / (o * sqrt(2.0 * 3.1415))) * exp(-(((z - u) * (z - u)) / (2.0 * (o * o))));
  }

  void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    
    // Convert to grayscale
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    
    // Film grain noise (scaled for finer grain on low DPI)
    float t = u_time * SPEED;
    vec2 uv = gl_FragCoord.xy * u_noiseScale / u_resolution;
    float seed = dot(uv, vec2(12.9898, 78.233));
    float noise = fract(sin(seed) * 43758.5453 + t);
    float variance = mix(VARIANCE_DAY, VARIANCE_NIGHT, u_night);
    noise = gaussian(noise, MEAN, variance * variance);
    
    // Apply grain (addition blend mode)
    vec3 grain = vec3(noise) * (1.0 - vec3(gray));
    float grainIntensity = mix(INTENSITY_DAY, INTENSITY_NIGHT, u_night);
    gray = gray + grain.r * grainIntensity;
    gray = clamp(gray, 0.0, 1.0);
    
    // Map to color palette
    vec3 dark = mix(vec3(0.235), vec3(0.02), u_night);   // #3c3c3c -> #050505
    vec3 light = mix(vec3(0.836), vec3(1.0), u_night);   // #d5d5d5 -> #ffffff
    gl_FragColor = vec4(mix(dark, light, gray), 1.0);
  }
`;

const lightDecayFragmentShaderSource = `
  precision highp float;
  uniform sampler2D u_light;
  uniform float u_decay;
  uniform float u_cutoff;
  varying vec2 v_texCoord;

  void main() {
    vec4 color = texture2D(u_light, v_texCoord);
    float intensity = color.r * u_decay - 0.004; // linear term breaks 8-bit quantization
    intensity = max(0.0, intensity);
    intensity *= step(u_cutoff, intensity);
    gl_FragColor = vec4(vec3(intensity), intensity);
  }
`;

const lightPointVertexShaderSource = `
  attribute vec2 a_position;
  attribute vec4 a_uvDeriv;  // (du/dx, dv/dx, du/dy, dv/dy)
  attribute float a_screenRadius;  // desired radius in screen units
  uniform vec2 u_texSize;
  varying vec4 v_uvDeriv;
  varying float v_screenRadius;
  varying float v_pointSize;

  void main() {
    gl_Position = vec4(a_position * 2.0 - 1.0, 0.0, 1.0);
    // Compute pixel radius needed to cover screen radius in UV space
    vec2 uvDerivX = a_uvDeriv.xy;
    vec2 uvDerivY = a_uvDeriv.zw;
    vec2 pixelDerivX = uvDerivX * u_texSize;
    vec2 pixelDerivY = uvDerivY * u_texSize;
    float pixelRadiusX = length(pixelDerivX) * a_screenRadius;
    float pixelRadiusY = length(pixelDerivY) * a_screenRadius;
    float pixelRadius = max(pixelRadiusX, pixelRadiusY);
    gl_PointSize = pixelRadius * 2.0 + 2.0;
    v_pointSize = gl_PointSize;
    v_uvDeriv = a_uvDeriv;
    v_screenRadius = a_screenRadius;
  }
`;

const LIGHT_INTENSITY = 1.0;
const PAINT_INTENSITY = LIGHT_INTENSITY / 3;
const LOGO_FADE_DELAY = 150;
const LOGO_FADE_DURATION = 900;
const LOGO_FADE_TARGET = 0.85;

const lightPointFragmentShaderSource = `
  precision highp float;
  uniform vec2 u_texSize;
  varying vec4 v_uvDeriv;
  varying float v_screenRadius;
  varying float v_pointSize;

  void main() {
    // Convert gl_PointCoord to UV offset
    vec2 pixelOffset = (gl_PointCoord - 0.5) * v_pointSize;
    vec2 uvOffset = pixelOffset / u_texSize;

    // Invert Jacobian to map UV offset back to screen offset
    float du_dx = v_uvDeriv.x;
    float dv_dx = v_uvDeriv.y;
    float du_dy = v_uvDeriv.z;
    float dv_dy = v_uvDeriv.w;
    float det = du_dx * dv_dy - du_dy * dv_dx;
    vec2 screenOffset = uvOffset;
    if (abs(det) > 1e-12) {
      mat2 invJ = mat2(dv_dy, -dv_dx, -du_dy, du_dx) / det;
      screenOffset = invJ * uvOffset;
    }

    float dist = length(screenOffset) / v_screenRadius;
    float falloff = smoothstep(1.0, 0.0, dist);
    float intensity = falloff * ${PAINT_INTENSITY};
    gl_FragColor = vec4(vec3(intensity), intensity);
  }
`;

// based on afl_ext's ocean weaves shader (MIT licensed)
function buildFragmentShader(quality) {
  const settings = QUALITY_SETTINGS[quality];
  return `
  precision highp float;
  uniform vec2 iResolution;
  uniform float iTime;
  uniform sampler2D u_light;
  uniform sampler2D u_logo;
  uniform vec2 u_logoCenter;
  uniform vec2 u_logoSize;
  uniform float u_logoFade;
  uniform vec4 u_ripples[10]; // (worldX, worldZ, birthTime, amplitude)
  uniform int u_rippleCount;
  uniform float u_night;
  uniform float u_ambientIntensity;
  uniform float u_cameraYOffset;
  uniform float u_cameraZOffset;
  uniform float u_cameraTiltOffset;

  // afl_ext 2017-2024
  // MIT License
  #define PI 3.14159265359

  #define DRAG_MULT 0.38
  #define WATER_DEPTH 1.0
  #define CAMERA_HEIGHT 1.5
  #define ITERATIONS_RAYMARCH ${settings.waveIterRaymarch}
  #define ITERATIONS_NORMAL ${settings.waveIterNormal}
  #define RAYMARCH_STEPS ${settings.raymarchSteps}
  #define FBM_OCTAVES ${settings.fbmOctaves}
  #define LOGO_INTENSITY 3.5
  #define NIGHT_EPS 0.001

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise21(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < FBM_OCTAVES; i++) {
      value += amplitude * noise21(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  mat3 createRotationMatrixAxisAngle(vec3 axis, float angle);

  vec2 dirToScreenUV(vec3 dir) {
    vec3 unrotated = createRotationMatrixAxisAngle(vec3(1.0, 0.0, 0.0), -(0.14 + u_cameraTiltOffset)) * dir;
    if (unrotated.z <= 0.0) return vec2(-1.0);
    vec2 uv = (unrotated.xy / unrotated.z) * 1.5;
    vec2 ndc = uv / vec2(iResolution.x / iResolution.y, 1.0);
    return ndc * 0.5 + 0.5;
  }

  float star(vec2 screenUv, vec2 cellId, vec2 grid) {
    float rnd = hash21(cellId);
    if (rnd > 0.8) return 0.0;
    vec2 starPos = vec2(hash21(cellId + 0.1), hash21(cellId + 0.2));
    vec2 starUv = (cellId + starPos) / grid;
    vec2 deltaPx = (screenUv - starUv) * iResolution.xy;
    float sizePx = 0.25 + hash21(cellId + 0.3) * 0.45;
    float d = length(deltaPx);
    float core = smoothstep(sizePx, sizePx * 0.2, d);
    float flickerPhase = hash21(cellId + 0.4) * 6.28318;
    float flickerSpeed = 0.2 + hash21(cellId + 0.5) * 0.3;
    float flickerAmount = mix(0.1, 0.35, hash21(cellId + 0.7));
    float flicker = mix(1.0 - flickerAmount, 1.0 + flickerAmount, 0.5 + 0.5 * sin(iTime * flickerSpeed + flickerPhase));
    float lumens = mix(1.0, 12.0, hash21(cellId + 0.6));
    float brightness = mix(0.6, 1.4, lumens / 12.0);
    return core * flicker * brightness;
  }

  vec2 wavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
    float x = dot(direction, position) * frequency + timeshift;
    float wave = exp(sin(x) - 1.0);
    float dx = wave * cos(x);
    return vec2(wave, -dx);
  }

  float getripples(vec2 position) {
    float rippleSum = 0.0;
    for (int i = 0; i < 10; i++) {
      if (i >= u_rippleCount) break;
      vec4 ripple = u_ripples[i];
      vec2 ripplePos = ripple.xy;
      float birthTime = ripple.z;
      float amplitude = ripple.w;
      
      float age = iTime - birthTime;
      if (age < 0.0 || age > 12.0) continue;
      
      float dist = length(position - ripplePos);
      float frequency = 4.0;
      float speed = 3.2;
      float decay = 0.45;
      float spatialDecay = 0.16;
      
      // Circular wave propagating outward with decay
      float phase = dist * frequency - age * speed;
      float envelope = exp(-decay * age) * exp(-dist * spatialDecay);
      // Smooth start to avoid pop-in
      float fadeIn = smoothstep(0.0, 0.3, age);
      rippleSum += amplitude * envelope * fadeIn * sin(phase);
    }
    return rippleSum;
  }

  // Base wave calculation without ripples (used for raymarching)
  float getwaves_base(vec2 position, int iterations) {
    float wavePhaseShift = length(position) * 0.1;
    vec2 swellDir = normalize(vec2(-0.25, 1.0));
    float swellBias = 0.35;
    float iter = 0.0;
    float frequency = 1.0;
    float timeMultiplier = 2.0;
    float weight = 1.0;
    float sumOfValues = 0.0;
    float sumOfWeights = 0.0;
    for(int i=0; i < 16; i++) {
      if(i >= iterations) break;
      vec2 p = normalize(mix(vec2(sin(iter), cos(iter)), swellDir, swellBias));
      vec2 res = wavedx(position, p, frequency, iTime * timeMultiplier + wavePhaseShift);
      position += p * res.y * weight * DRAG_MULT;
      sumOfValues += res.x * weight;
      sumOfWeights += weight;
      weight = mix(weight, 0.0, 0.2);
      frequency *= 1.18;
      timeMultiplier *= 1.07;
      iter += 1232.399963;
    }
    float baseWaves = sumOfValues / sumOfWeights;

    float swellPhase = dot(position, swellDir) * 0.18 - iTime * 0.08;
    // Center swell around 0 so it adds and subtracts from the surface.
    float swell = sin(swellPhase);
    vec2 cameraPos = vec2(iTime * 0.2, 1.0);
    float swellFade = smoothstep(28.0, 4.0, length(position - cameraPos));

    return baseWaves + swell * swellFade * 0.35;
  }

  // Full wave calculation with ripples (used for normal calculation)
  float getwaves(vec2 position, int iterations) {
    return getwaves_base(position, iterations) + getripples(position);
  }

  float raymarchwater(vec3 camera, vec3 start, vec3 end, float depth) {
    vec3 pos = start;
    vec3 dir = normalize(end - start);
    for(int i=0; i < RAYMARCH_STEPS; i++) {
      float height = getwaves(pos.xz, ITERATIONS_RAYMARCH) * depth - depth;
      if(height + 0.01 > pos.y) {
        return distance(pos, camera);
      }
      pos += dir * (pos.y - height);
    }
    return distance(start, camera);
  }

  vec3 normal(vec2 pos, float e, float depth) {
    vec2 ex = vec2(e, 0);
    float H = getwaves(pos.xy, ITERATIONS_NORMAL) * depth;
    vec3 a = vec3(pos.x, H, pos.y);
    return normalize(
      cross(
        a - vec3(pos.x - e, getwaves(pos.xy - ex.xy, ITERATIONS_NORMAL) * depth, pos.y), 
        a - vec3(pos.x, getwaves(pos.xy + ex.yx, ITERATIONS_NORMAL) * depth, pos.y + e)
      )
    );
  }

  mat3 createRotationMatrixAxisAngle(vec3 axis, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    float oc = 1.0 - c;
    return mat3(
      oc * axis.x * axis.x + c, oc * axis.x * axis.y - axis.z * s, oc * axis.z * axis.x + axis.y * s, 
      oc * axis.x * axis.y + axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z - axis.x * s, 
      oc * axis.z * axis.x - axis.y * s, oc * axis.y * axis.z + axis.x * s, oc * axis.z * axis.z + c
    );
  }

  vec3 getRay(vec2 fragCoord) {
    vec2 uv = ((fragCoord.xy / iResolution.xy) * 2.0 - 1.0) * vec2(iResolution.x / iResolution.y, 1.0);
    vec3 proj = normalize(vec3(uv.x, uv.y, 1.5));
    // Fixed camera angle (no mouse movement) - tilted up to show more sky
    // u_cameraTiltOffset adds additional tilt (negative = look down more)
    return createRotationMatrixAxisAngle(vec3(0.0, -1.0, 0.0), 0.0)
      * createRotationMatrixAxisAngle(vec3(1.0, 0.0, 0.0), 0.14 + u_cameraTiltOffset)
      * proj;
  }

  float intersectPlane(vec3 origin, vec3 direction, vec3 point, vec3 normal) { 
    return clamp(dot(point - origin, normal) / dot(direction, normal), -1.0, 9991999.0); 
  }

  vec3 extra_cheap_atmosphere(vec3 raydir, vec3 sundir) {
    float special_trick = 1.0 / (raydir.y * 1.0 + 0.1);
    float special_trick2 = 1.0 / (sundir.y * 11.0 + 1.0);
    float raysundt = pow(abs(dot(sundir, raydir)), 2.0);
    float sundt = pow(max(0.0, dot(sundir, raydir)), 8.0);
    float mymie = sundt * special_trick * 0.2;
    vec3 suncolor = mix(vec3(1.0), max(vec3(0.0), vec3(1.0) - vec3(5.5, 13.0, 22.4) / 22.4), special_trick2);
    vec3 bluesky= vec3(12.0, 12.0, 13.0) / 22.4 * suncolor;
    vec3 bluesky2 = max(vec3(0.0), bluesky - vec3(12.0, 12.0, 13.0) * 0.002 * (special_trick + -6.0 * sundir.y * sundir.y));
    bluesky2 *= special_trick * (0.24 + raysundt * 0.24);
    return bluesky2 * (1.0 + 1.0 * pow(1.0 - raydir.y, 3.0));
  } 

  vec3 getSunDirection() {
    // Static sun position (no movement)
    return normalize(vec3(-0.0773502691896258, 0.6, 0.5773502691896258));
  }

  vec3 getAtmosphere(vec3 dir) {
     return extra_cheap_atmosphere(dir, getSunDirection()) * 0.5;
  }

  float getSun(vec3 dir) { 
    // No visible sun disc
    return 0.0;
  }

  vec2 skyUV(vec3 dir) {
    float u = atan(dir.z, dir.x) / (2.0 * PI) + 0.5;
    float v = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    return vec2(u, v);
  }

  vec3 getDaySky(vec3 dir, float skyLight) {
    return getAtmosphere(dir) + vec3(1.0) * skyLight * 4.0 * u_ambientIntensity;
  }

  vec3 getNightSky(vec3 dir, float skyLight) {
    vec2 uv = skyUV(dir);
    vec3 topColor = vec3(0.015, 0.02, 0.04);
    vec3 bottomColor = vec3(0.03, 0.035, 0.05);
    vec3 color = mix(bottomColor, topColor, uv.y);

    vec2 screenUv = dirToScreenUV(dir);
    if (screenUv.x >= 0.0 && screenUv.x <= 1.0 && screenUv.y >= 0.0 && screenUv.y <= 1.0) {
      if (screenUv.y > 0.35) {
        float gridX = 40.0;
        float gridY = 30.0;
        vec2 grid = vec2(gridX, gridY);
        vec2 baseCell = floor(vec2(screenUv.x * gridX, screenUv.y * gridY));
        float s = 0.0;
        for (int yi = -1; yi <= 1; yi++) {
          for (int xi = -1; xi <= 1; xi++) {
            vec2 cell = baseCell + vec2(float(xi), float(yi));
            if (cell.y < 0.0 || cell.y >= gridY) continue;
            cell.x = mod(cell.x + gridX, gridX);
            s += star(screenUv, cell, grid);
          }
        }
        float horizonFade = smoothstep(0.35, 0.55, screenUv.y);
        vec3 starColor = vec3(1.0, 0.97, 0.9);
        color += starColor * s * horizonFade;
      }

    }

    color += vec3(1.0) * skyLight * 1.4 * u_ambientIntensity;
    return color;
  }

  float sampleLogo(vec2 uv) {
    vec2 local = (uv - u_logoCenter) / u_logoSize + 0.5;
    float inside = step(0.0, local.x) * step(local.x, 1.0) * step(0.0, local.y) * step(local.y, 1.0);
    float alpha = texture2D(u_logo, local).a * inside;
    return alpha * u_logoFade;
  }

  vec3 aces_tonemap(vec3 color) {  
    mat3 m1 = mat3(
      0.59719, 0.07600, 0.02840,
      0.35458, 0.90834, 0.13383,
      0.04823, 0.01566, 0.83777
    );
    mat3 m2 = mat3(
      1.60475, -0.10208, -0.00327,
      -0.53108,  1.10813, -0.07276,
      -0.07367, -0.00605,  1.07602
    );
    vec3 v = m1 * color;  
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return pow(clamp(m2 * (a / b), 0.0, 1.0), vec3(1.0 / 2.2));  
  }

  void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 ray = getRay(fragCoord);
    if(ray.y >= 0.0) {
      float skyLight = texture2D(u_light, skyUV(ray)).r;
      vec3 C;
      float horizonFactor = smoothstep(0.02, 0.25, ray.y);
      float nightBlend = pow(u_night, mix(0.35, 1.0, horizonFactor));
      if (u_night <= NIGHT_EPS) {
        C = getDaySky(ray, skyLight);
      } else if (u_night >= 1.0 - NIGHT_EPS) {
        C = getNightSky(ray, skyLight);
      } else {
        vec3 daySky = getDaySky(ray, skyLight);
        vec3 nightSky = getNightSky(ray, skyLight);
        C = mix(daySky, nightSky, nightBlend);
      }
      fragColor = vec4(aces_tonemap(C * 2.0), 1.0);   
      return;
    }

    vec3 waterPlaneHigh = vec3(0.0, 0.0, 0.0);
    vec3 waterPlaneLow = vec3(0.0, -WATER_DEPTH, 0.0);
    vec3 origin = vec3(iTime * 0.2, CAMERA_HEIGHT + u_cameraYOffset, 1.0 + u_cameraZOffset);

    float highPlaneHit = intersectPlane(origin, ray, waterPlaneHigh, vec3(0.0, 1.0, 0.0));
    float lowPlaneHit = intersectPlane(origin, ray, waterPlaneLow, vec3(0.0, 1.0, 0.0));
    vec3 highHitPos = origin + ray * highPlaneHit;
    vec3 lowHitPos = origin + ray * lowPlaneHit;

    float dist = raymarchwater(origin, highHitPos, lowHitPos, WATER_DEPTH);
    vec3 waterHitPos = origin + ray * dist;

    vec3 N = normal(waterHitPos.xz, 0.01, WATER_DEPTH);
    N = mix(N, vec3(0.0, 1.0, 0.0), 0.8 * min(1.0, sqrt(dist*0.01) * 1.1));

    float fresnel = (0.04 + (1.0-0.04)*(pow(1.0 - max(0.0, dot(-N, ray)), 5.0)));

    vec3 R = normalize(reflect(ray, N));
    R.y = abs(R.y);
    
    float reflectedLight = texture2D(u_light, skyUV(R)).r;
    float reflectedLogo = sampleLogo(skyUV(R));
    vec3 reflection;
    float reflectionHorizon = smoothstep(0.02, 0.25, R.y);
    float nightReflectionBlend = pow(u_night, mix(0.35, 1.0, reflectionHorizon));
    if (u_night <= NIGHT_EPS) {
      reflection = getDaySky(R, reflectedLight);
    } else if (u_night >= 1.0 - NIGHT_EPS) {
      reflection = getNightSky(R, reflectedLight);
    } else {
      vec3 dayReflection = getDaySky(R, reflectedLight);
      vec3 nightReflection = getNightSky(R, reflectedLight);
      reflection = mix(dayReflection, nightReflection, nightReflectionBlend);
    }
    reflection += vec3(1.0) * (reflectedLogo * LOGO_INTENSITY);
    vec3 scatteringBase = mix(vec3(0.08, 0.08, 0.09), vec3(0.02, 0.02, 0.03), u_night);
    vec3 scattering = scatteringBase * (0.2 + (waterHitPos.y + WATER_DEPTH) / WATER_DEPTH);

    vec3 C = fresnel * reflection + scattering;
    
    // Add distance fog
    vec3 fogColor = mix(vec3(0.55, 0.55, 0.58), vec3(0.03, 0.035, 0.05), u_night);
    float fogAmount = 1.0 - exp(-dist * 0.02);
    C = mix(C, fogColor, fogAmount);
    
    // Darken waves in light mode
    float waveBrightness = mix(1.4, 1.9, u_night);
    fragColor = vec4(aces_tonemap(C * waveBrightness), 1.0);
  }

  void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
  }
`;
}

let fragmentShaderSource = buildFragmentShader(currentQuality);

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

// Ocean wave program
const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
let oceanFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
let program = createProgram(gl, vertexShader, oceanFragmentShader);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1, 1, -1, -1, 1,
  -1, 1, 1, -1, 1, 1
]), gl.STATIC_DRAW);

let positionLocation = gl.getAttribLocation(program, 'position');
let resolutionLocation = gl.getUniformLocation(program, 'iResolution');
let timeLocation = gl.getUniformLocation(program, 'iTime');
let lightTextureLocation = gl.getUniformLocation(program, 'u_light');
let logoTextureLocation = gl.getUniformLocation(program, 'u_logo');
let logoCenterLocation = gl.getUniformLocation(program, 'u_logoCenter');
let logoSizeLocation = gl.getUniformLocation(program, 'u_logoSize');
let logoFadeLocation = gl.getUniformLocation(program, 'u_logoFade');
let ripplesLocation = gl.getUniformLocation(program, 'u_ripples');
let rippleCountLocation = gl.getUniformLocation(program, 'u_rippleCount');
let nightLocation = gl.getUniformLocation(program, 'u_night');
let ambientLocation = gl.getUniformLocation(program, 'u_ambientIntensity');
let cameraYOffsetLocation = gl.getUniformLocation(program, 'u_cameraYOffset');
let cameraZOffsetLocation = gl.getUniformLocation(program, 'u_cameraZOffset');
let cameraTiltOffsetLocation = gl.getUniformLocation(program, 'u_cameraTiltOffset');

function rebuildOceanProgram() {
  fragmentShaderSource = buildFragmentShader(currentQuality);
  if (oceanFragmentShader) gl.deleteShader(oceanFragmentShader);
  if (program) gl.deleteProgram(program);
  
  oceanFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  program = createProgram(gl, vertexShader, oceanFragmentShader);
  
  positionLocation = gl.getAttribLocation(program, 'position');
  resolutionLocation = gl.getUniformLocation(program, 'iResolution');
  timeLocation = gl.getUniformLocation(program, 'iTime');
  lightTextureLocation = gl.getUniformLocation(program, 'u_light');
  logoTextureLocation = gl.getUniformLocation(program, 'u_logo');
  logoCenterLocation = gl.getUniformLocation(program, 'u_logoCenter');
  logoSizeLocation = gl.getUniformLocation(program, 'u_logoSize');
  logoFadeLocation = gl.getUniformLocation(program, 'u_logoFade');
  ripplesLocation = gl.getUniformLocation(program, 'u_ripples');
  rippleCountLocation = gl.getUniformLocation(program, 'u_rippleCount');
  nightLocation = gl.getUniformLocation(program, 'u_night');
  ambientLocation = gl.getUniformLocation(program, 'u_ambientIntensity');
  cameraYOffsetLocation = gl.getUniformLocation(program, 'u_cameraYOffset');
  cameraZOffsetLocation = gl.getUniformLocation(program, 'u_cameraZOffset');
  cameraTiltOffsetLocation = gl.getUniformLocation(program, 'u_cameraTiltOffset');
}

function setQuality(quality) {
  if (!QUALITY_LEVELS.includes(quality) || quality === currentQuality) return;
  currentQuality = quality;
  rebuildOceanProgram();
  resize();
  lastQualityChangeTime = performance.now();
}

function updateAutoQuality(time, fps) {
  // Add FPS sample with timestamp
  autoQualityFpsHistory.push({ time, fps });

  // Remove old samples outside the window
  const cutoff = time - AUTO_QUALITY_SAMPLE_TIME;
  while (autoQualityFpsHistory.length > 0 && autoQualityFpsHistory[0].time < cutoff) {
    autoQualityFpsHistory.shift();
  }

  // Need enough samples before making decisions
  if (autoQualityFpsHistory.length < 3) return;

  // Check cooldown
  if (time - lastQualityChangeTime < AUTO_QUALITY_COOLDOWN) return;

  // Calculate average FPS
  const avgFps = autoQualityFpsHistory.reduce((sum, s) => sum + s.fps, 0) / autoQualityFpsHistory.length;
  const currentIndex = QUALITY_LEVELS.indexOf(currentQuality);

  if (avgFps < AUTO_QUALITY_FPS_LOW && currentIndex > 0) {
    // FPS too low, reduce quality
    setQuality(QUALITY_LEVELS[currentIndex - 1]);
    autoQualityFpsHistory = []; // Reset history after change
  } else if (avgFps > AUTO_QUALITY_FPS_HIGH && currentIndex < QUALITY_LEVELS.length - 1) {
    // FPS high enough, try increasing quality
    setQuality(QUALITY_LEVELS[currentIndex + 1]);
    autoQualityFpsHistory = []; // Reset history after change
  }
}

// Dither post-process program
const ditherVertexShader = createShader(gl, gl.VERTEX_SHADER, ditherVertexShaderSource);
const ditherFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, ditherFragmentShaderSource);
const ditherProgram = createProgram(gl, ditherVertexShader, ditherFragmentShader);

const lightDecayFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, lightDecayFragmentShaderSource);
const lightDecayProgram = createProgram(gl, ditherVertexShader, lightDecayFragmentShader);

const lightPointVertexShader = createShader(gl, gl.VERTEX_SHADER, lightPointVertexShaderSource);
const lightPointFragmentShader = createShader(gl, gl.FRAGMENT_SHADER, lightPointFragmentShaderSource);
const lightPointProgram = createProgram(gl, lightPointVertexShader, lightPointFragmentShader);

const ditherPositionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, ditherPositionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const ditherPositionLocation = gl.getAttribLocation(ditherProgram, 'a_position');
const lightDecayPositionLocation = gl.getAttribLocation(lightDecayProgram, 'a_position');

const ditherTexCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, ditherTexCoordBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
const ditherTexCoordLocation = gl.getAttribLocation(ditherProgram, 'a_texCoord');
const lightDecayTexCoordLocation = gl.getAttribLocation(lightDecayProgram, 'a_texCoord');

const ditherResolutionLocation = gl.getUniformLocation(ditherProgram, 'u_resolution');
const ditherImageLocation = gl.getUniformLocation(ditherProgram, 'u_image');
const ditherTimeLocation = gl.getUniformLocation(ditherProgram, 'u_time');
const ditherNightLocation = gl.getUniformLocation(ditherProgram, 'u_night');
const ditherNoiseScaleLocation = gl.getUniformLocation(ditherProgram, 'u_noiseScale');

const lightDecayImageLocation = gl.getUniformLocation(lightDecayProgram, 'u_light');
const lightDecayFactorLocation = gl.getUniformLocation(lightDecayProgram, 'u_decay');
const lightDecayCutoffLocation = gl.getUniformLocation(lightDecayProgram, 'u_cutoff');

const lightPointPositionLocation = gl.getAttribLocation(lightPointProgram, 'a_position');
const lightPointUvDerivLocation = gl.getAttribLocation(lightPointProgram, 'a_uvDeriv');
const lightPointScreenRadiusLocation = gl.getAttribLocation(lightPointProgram, 'a_screenRadius');
const lightPointTexSizeLocation = gl.getUniformLocation(lightPointProgram, 'u_texSize');
const lightPointBuffer = gl.createBuffer();

// Framebuffer for render-to-texture
let framebuffer = null;
let renderTexture = null;
let fbWidth = 0;
let fbHeight = 0;

let lightFramebuffers = [null, null];
let lightTextures = [null, null];
let lightWriteIndex = 0;
let lastLightTime = 0;

const logoCenter = [0.53, 0.72];
let logoSize = [0.18, 0.18 / 1.32];
let logoFadeStart = null;
const logoTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, logoTexture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

function setupFramebuffer(width, height) {
  if (framebuffer && fbWidth === width && fbHeight === height) return;
  
  if (framebuffer) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(renderTexture);
  }

  fbWidth = width;
  fbHeight = height;

  renderTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, renderTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTexture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function createLightTexture(width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function setupLightFramebuffers(width, height) {
  for (let i = 0; i < 2; i++) {
    if (lightFramebuffers[i]) {
      gl.deleteFramebuffer(lightFramebuffers[i]);
      gl.deleteTexture(lightTextures[i]);
    }
    lightTextures[i] = createLightTexture(width, height);
    lightFramebuffers[i] = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, lightFramebuffers[i]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTextures[i], 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  lightWriteIndex = 0;
}

function setupLogoTexture() {
  const img = new Image();
  img.onload = () => {
    const logoAspect = img.naturalWidth && img.naturalHeight
      ? img.naturalWidth / img.naturalHeight
      : 1.32;
    const baseSize = 0.18;
    logoSize = [baseSize, baseSize / logoAspect];

    const width = 512;
    const height = Math.max(1, Math.round(width / logoAspect));
    const logoCanvas = document.createElement('canvas');
    logoCanvas.width = width;
    logoCanvas.height = height;
    const ctx = logoCanvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, logoTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, logoCanvas);
  };

  img.onerror = () => {
    console.warn('Unable to load logo SVG for texture.');
  };

  img.src = LOGO_SVG_URL;
}

function getViewportSize() {
  if (window.visualViewport) {
    return {
      width: window.visualViewport.width,
      height: window.visualViewport.height
    };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function resize() {
  const { width, height } = getViewportSize();
  // Render at reduced resolution based on quality setting
  // Use higher scale on low DPI screens for sharper rendering
  const isLowDpi = window.devicePixelRatio < LOW_DPI_THRESHOLD;
  const settings = QUALITY_SETTINGS[currentQuality];
  const scale = isLowDpi ? settings.lowDpiScale : settings.scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = width * window.devicePixelRatio * scale;
  canvas.height = height * window.devicePixelRatio * scale;
  setupFramebuffer(canvas.width, canvas.height);
  setupLightFramebuffers(canvas.width, canvas.height);
  updateLogoPlacement();
}

window.addEventListener('resize', resize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
}
resize();
setupLogoTexture();
updateLogoPlacement();

// FPS tracking
let frameCount = 0;
let lastFpsUpdate = 0;

const pendingLightPoints = [];
let isDrawing = false;

// Ripple system
const MAX_RIPPLES = 10;
const ripples = []; // Array of {x, z, time, amplitude}

function screenToWaterHit(clientX, clientY, time) {
  const rect = canvas.getBoundingClientRect();
  const ndcX = (clientX - rect.left) / rect.width * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height * 2 - 1);
  
  const aspect = canvas.width / canvas.height;
  let rayX = ndcX * aspect;
  let rayY = ndcY;
  let rayZ = 1.5;
  const len = Math.hypot(rayX, rayY, rayZ);
  rayX /= len; rayY /= len; rayZ /= len;
  
  // Apply camera tilt (0.08 + cameraTiltOffset radians around X axis)
  // Rotation matrix formula (matches GLSL shader):
  // newY = cos(a)*y + sin(a)*z
  // newZ = -sin(a)*y + cos(a)*z
  const tiltAngle = 0.14 + cameraTiltOffset;
  const cosTilt = Math.cos(tiltAngle);
  const sinTilt = Math.sin(tiltAngle);
  const newY = rayY * cosTilt + rayZ * sinTilt;
  const newZ = -rayY * sinTilt + rayZ * cosTilt;
  rayY = newY;
  rayZ = newZ;
  
  // Camera position (matches shader, including offsets)
  const camX = time * 0.2;
  const camY = 1.5 + cameraYOffset; // CAMERA_HEIGHT + offset
  const camZ = 1.0 + cameraZOffset;
  
  // Intersect with y=0 plane
  if (rayY >= 0) return null; // Looking up, no water hit
  
  const t = -camY / rayY;
  return { x: camX + rayX * t, z: camZ + rayZ * t };
}

function addRipple(worldX, worldZ, time, amplitude = 0.22) {
  ripples.push({ x: worldX, z: worldZ, time: time, amplitude: amplitude });
  if (ripples.length > MAX_RIPPLES) {
    ripples.shift();
  }
}

function getRippleUniforms() {
  const data = new Float32Array(MAX_RIPPLES * 4);
  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i];
    data[i * 4 + 0] = r.x;
    data[i * 4 + 1] = r.z;
    data[i * 4 + 2] = r.time;
    data[i * 4 + 3] = r.amplitude;
  }
  return data;
}

function wrapUVDelta(a, b) {
  let d = a - b;
  if (d > 0.5) d -= 1.0;
  if (d < -0.5) d += 1.0;
  return d;
}

function screenPosToSkyUV(screenX, screenY, aspect) {
  const uvX = screenX * 2 - 1;
  const uvY = screenY * 2 - 1;
  const projX = uvX * aspect;
  const projY = uvY;
  const projZ = 1.5;

  const projLen = Math.hypot(projX, projY, projZ);
  let rayX = projX / projLen;
  let rayY = projY / projLen;
  let rayZ = projZ / projLen;

  // Apply camera tilt (0.08 + cameraTiltOffset radians around X axis)
  const tiltAngle = 0.14 + cameraTiltOffset;
  const cosTilt = Math.cos(tiltAngle);
  const sinTilt = Math.sin(tiltAngle);
  const rotatedY = rayY * cosTilt + rayZ * sinTilt;
  const rotatedZ = -rayY * sinTilt + rayZ * cosTilt;
  rayY = rotatedY;
  rayZ = rotatedZ;

  if (rayY < 0) return null;

  const u = ((Math.atan2(rayZ, rayX) / (2 * Math.PI)) + 0.5) % 1;
  const v = Math.min(1, Math.max(0, rayY * 0.5 + 0.5));
  return { u, v };
}

function screenToSkyUV(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const xPx = (event.clientX - rect.left) * scaleX;
  const yPx = (rect.height - (event.clientY - rect.top)) * scaleY;
  const x = xPx / canvas.width;
  const y = yPx / canvas.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;

  const aspect = canvas.width / canvas.height;
  const result = screenPosToSkyUV(x, y, aspect);
  if (!result) return null;

  // Compute Jacobian: how much u and v change per device pixel
  const epsPx = 1;
  const rightX = (xPx + epsPx) / canvas.width;
  const leftX = (xPx - epsPx) / canvas.width;
  const upY = (yPx + epsPx) / canvas.height;
  const downY = (yPx - epsPx) / canvas.height;
  const uvRight = screenPosToSkyUV(rightX, y, aspect);
  const uvLeft = screenPosToSkyUV(leftX, y, aspect);
  const uvUp = screenPosToSkyUV(x, upY, aspect);
  const uvDown = screenPosToSkyUV(x, downY, aspect);

  let du_dx = 0.001;
  let dv_dx = 0.0;
  let du_dy = 0.0;
  let dv_dy = 0.001;

  if (uvRight && uvLeft) {
    du_dx = wrapUVDelta(uvRight.u, uvLeft.u) / (2 * epsPx);
    dv_dx = (uvRight.v - uvLeft.v) / (2 * epsPx);
  } else if (uvRight) {
    du_dx = wrapUVDelta(uvRight.u, result.u) / epsPx;
    dv_dx = (uvRight.v - result.v) / epsPx;
  } else if (uvLeft) {
    du_dx = wrapUVDelta(result.u, uvLeft.u) / epsPx;
    dv_dx = (result.v - uvLeft.v) / epsPx;
  }

  if (uvUp && uvDown) {
    du_dy = wrapUVDelta(uvUp.u, uvDown.u) / (2 * epsPx);
    dv_dy = (uvUp.v - uvDown.v) / (2 * epsPx);
  } else if (uvUp) {
    du_dy = wrapUVDelta(uvUp.u, result.u) / epsPx;
    dv_dy = (uvUp.v - result.v) / epsPx;
  } else if (uvDown) {
    du_dy = wrapUVDelta(result.u, uvDown.u) / epsPx;
    dv_dy = (result.v - uvDown.v) / epsPx;
  }

  return { u: result.u, v: result.v, du_dx, dv_dx, du_dy, dv_dy };
}

function updateLogoPlacement() {
  if (!logo) return;
  const canvasRect = canvas.getBoundingClientRect();
  const logoRect = logo.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) return;

  const centerX = (logoRect.left + logoRect.width / 2 - canvasRect.left) / canvasRect.width;
  const centerY = 1 - (logoRect.top + logoRect.height / 2 - canvasRect.top) / canvasRect.height;
  const aspect = canvas.width / canvas.height;
  const centerUV = screenPosToSkyUV(centerX, centerY, aspect);
  if (!centerUV) return;

  const halfWidth = (logoRect.width / 2) / canvasRect.width;
  const halfHeight = (logoRect.height / 2) / canvasRect.height;
  const leftUV = screenPosToSkyUV(centerX - halfWidth, centerY, aspect);
  const rightUV = screenPosToSkyUV(centerX + halfWidth, centerY, aspect);
  const upUV = screenPosToSkyUV(centerX, centerY + halfHeight, aspect);
  const downUV = screenPosToSkyUV(centerX, centerY - halfHeight, aspect);

  let sizeU = logoSize[0];
  let sizeV = logoSize[1];

  if (leftUV && rightUV) {
    sizeU = Math.abs(wrapUVDelta(rightUV.u, leftUV.u));
  }
  if (upUV && downUV) {
    sizeV = Math.abs(upUV.v - downUV.v);
  }

  logoCenter[0] = centerUV.u;
  logoCenter[1] = centerUV.v;
  logoSize[0] = sizeU;
  logoSize[1] = sizeV;
}

function queueLightPoints(event) {
  const skyUV = screenToSkyUV(event);
  if (!skyUV) return;

  // Use actual canvas scale (devicePixelRatio * quality scale) for proper sizing
  const rect = canvas.getBoundingClientRect();
  const canvasScale = canvas.width / rect.width * 2;

  const sprinkleCount = 10;
  for (let i = 0; i < sprinkleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = (Math.random() * 10 + 6) * canvasScale;
    const offsetX = Math.cos(angle) * radius;
    const offsetY = Math.sin(angle) * radius;

    const jitterU = skyUV.du_dx * offsetX + skyUV.du_dy * offsetY;
    const jitterV = skyUV.dv_dx * offsetX + skyUV.dv_dy * offsetY;

    // Radius in canvas pixels (matches Jacobian units)
    const screenRadius = (Math.random() * 6 + 4) * canvasScale;
    const px = (skyUV.u + jitterU + 1) % 1;
    const py = Math.min(1, Math.max(0, skyUV.v + jitterV));
    // 7 floats per point: x, y, du_dx, dv_dx, du_dy, dv_dy, screenRadius
    pendingLightPoints.push(px, py, skyUV.du_dx, skyUV.dv_dx, skyUV.du_dy, skyUV.dv_dy, screenRadius);
  }

  if (pendingLightPoints.length > 4200) {
    pendingLightPoints.splice(0, pendingLightPoints.length - 4200);
  }
}

function isUpdateOverlayOpen() {
  return !!document.querySelector('.updates-overlay.is-open');
}

function isInteractiveUiTarget(event) {
  return !!event.target.closest('.logo-links a, #theme-toggle, .updates-overlay, .updates-dismiss');
}

window.addEventListener('pointerdown', (event) => {
  if (isUpdateOverlayOpen() || isInteractiveUiTarget(event)) {
    return;
  }
  isDrawing = true;
  queueLightPoints(event);
});

window.addEventListener('pointermove', (event) => {
  if (isDrawing) {
    queueLightPoints(event);
  }
});

window.addEventListener('pointerup', () => {
  isDrawing = false;
});

// Ripple on click
canvas.addEventListener('click', (e) => {
  if (isUpdateOverlayOpen()) {
    return;
  }
  const time = performance.now() * 0.001;
  const hit = screenToWaterHit(e.clientX, e.clientY, time);
  if (hit) {
    addRipple(hit.x, hit.z, time, 0.18);
  }
});

function updateLightTexture(time) {
  if (!lastLightTime) {
    lastLightTime = time;
  }
  const delta = Math.max(0, (time - lastLightTime) * 0.001);
  lastLightTime = time;
  const fadeDuration = 240;
  const targetIntensity = LIGHT_INTENSITY;
  const decayCutoff = 1 / 255;
  const decayFloor = (1 / 255) / targetIntensity;
  const decay = Math.pow(decayFloor, delta / fadeDuration);
  const readIndex = lightWriteIndex;
  const writeIndex = 1 - lightWriteIndex;

  gl.bindFramebuffer(gl.FRAMEBUFFER, lightFramebuffers[writeIndex]);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(lightDecayProgram);

  gl.enableVertexAttribArray(lightDecayPositionLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, ditherPositionBuffer);
  gl.vertexAttribPointer(lightDecayPositionLocation, 2, gl.FLOAT, false, 0, 0);

  gl.enableVertexAttribArray(lightDecayTexCoordLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, ditherTexCoordBuffer);
  gl.vertexAttribPointer(lightDecayTexCoordLocation, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, lightTextures[readIndex]);
  gl.uniform1i(lightDecayImageLocation, 0);
  gl.uniform1f(lightDecayFactorLocation, decay);
  gl.uniform1f(lightDecayCutoffLocation, decayCutoff);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  if (pendingLightPoints.length > 0) {
    gl.useProgram(lightPointProgram);
    gl.uniform2f(lightPointTexSizeLocation, canvas.width, canvas.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, lightPointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pendingLightPoints), gl.DYNAMIC_DRAW);

    // 7 floats per vertex: x, y, du_dx, dv_dx, du_dy, dv_dy, screenRadius (28 bytes)
    gl.enableVertexAttribArray(lightPointPositionLocation);
    gl.vertexAttribPointer(lightPointPositionLocation, 2, gl.FLOAT, false, 28, 0);

    gl.enableVertexAttribArray(lightPointUvDerivLocation);
    gl.vertexAttribPointer(lightPointUvDerivLocation, 4, gl.FLOAT, false, 28, 8);

    gl.enableVertexAttribArray(lightPointScreenRadiusLocation);
    gl.vertexAttribPointer(lightPointScreenRadiusLocation, 1, gl.FLOAT, false, 28, 24);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, pendingLightPoints.length / 7);
    gl.disable(gl.BLEND);

    pendingLightPoints.length = 0;
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  lightWriteIndex = writeIndex;
}

// Mark shader as ready after first successful frame
let shaderReady = false;
function markShaderReady() {
  if (!shaderReady && program) {
    shaderReady = true;
    canvas.classList.add('shader-ready');
  }
}

function render(time) {
  // Update FPS counter
  frameCount++;
  if (time - lastFpsUpdate >= 1000) {
    const fps = frameCount;
    fpsDisplay.textContent = `FPS: ${fps} | ${canvas.width}x${canvas.height} | Quality: ${currentQuality}`;
    
    // Update auto quality based on measured FPS
    updateAutoQuality(time, fps);
    
    frameCount = 0;
    lastFpsUpdate = time;
  }

  updateLightTexture(time);

  if (logoFadeStart === null) {
    logoFadeStart = time + LOGO_FADE_DELAY;
  }
  const logoProgress = Math.min(Math.max((time - logoFadeStart) / LOGO_FADE_DURATION, 0), 1);
  const logoFade = logoProgress * LOGO_FADE_TARGET;
  const nightValue = updateNightBlend(time);
  const ambientIntensity = 1.0 + (0.28 - 1.0) * nightValue;
  updateCamera404(time);

  // Pass 1: Render ocean waves to framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(program);
  gl.enableVertexAttribArray(positionLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.uniform1f(timeLocation, time * 0.001);
  gl.uniform2f(logoCenterLocation, logoCenter[0], logoCenter[1]);
  gl.uniform2f(logoSizeLocation, logoSize[0], logoSize[1]);
  gl.uniform1f(logoFadeLocation, logoFade);
  gl.uniform1f(nightLocation, nightValue);
  gl.uniform1f(ambientLocation, ambientIntensity);
  gl.uniform1f(cameraYOffsetLocation, cameraYOffset);
  gl.uniform1f(cameraZOffsetLocation, cameraZOffset);
  gl.uniform1f(cameraTiltOffsetLocation, cameraTiltOffset);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, lightTextures[lightWriteIndex]);
  gl.uniform1i(lightTextureLocation, 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, logoTexture);
  gl.uniform1i(logoTextureLocation, 2);
  
  // Pass ripple uniforms
  gl.uniform4fv(ripplesLocation, getRippleUniforms());
  gl.uniform1i(rippleCountLocation, ripples.length);
  
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Pass 2: Apply dither post-processing to screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(ditherProgram);

  gl.enableVertexAttribArray(ditherPositionLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, ditherPositionBuffer);
  gl.vertexAttribPointer(ditherPositionLocation, 2, gl.FLOAT, false, 0, 0);

  gl.enableVertexAttribArray(ditherTexCoordLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, ditherTexCoordBuffer);
  gl.vertexAttribPointer(ditherTexCoordLocation, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, renderTexture);
  gl.uniform1i(ditherImageLocation, 0);
  gl.uniform2f(ditherResolutionLocation, canvas.width, canvas.height);
  gl.uniform1f(ditherTimeLocation, time * 0.001);
  gl.uniform1f(ditherNightLocation, nightValue);
  // Finer noise on low DPI screens
  const noiseScale = window.devicePixelRatio < LOW_DPI_THRESHOLD ? LOW_DPI_NOISE_SCALE : 1.0;
  gl.uniform1f(ditherNoiseScaleLocation, noiseScale);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  markShaderReady();
  requestAnimationFrame(render);
}

requestAnimationFrame(render);

// Logo fade-in animation (skip if not on home page)
if (document.body.classList.contains('skip-intro')) {
  // Non-home page: show immediately
  document.body.classList.add('loaded');
} else {
  // Home page: fade in
  setTimeout(() => {
    const fadeDuration = LOGO_FADE_DURATION / 1000;
    logo.style.transition = `opacity ${fadeDuration}s ease`;
    logo.style.opacity = `${LOGO_FADE_TARGET}`;
    const logoLinks = document.querySelector('.logo-links');
    if (logoLinks) {
      logoLinks.style.transition = `opacity ${fadeDuration}s ease`;
      logoLinks.style.opacity = `${LOGO_FADE_TARGET}`;
    }
    // Mark body as loaded so HTMX swaps don't restart animation
    setTimeout(() => {
      document.body.classList.add('loaded');
    }, fadeDuration * 1000);
  }, LOGO_FADE_DELAY);
}

})();
