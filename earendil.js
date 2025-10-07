(function () {
  // Ripple effect configuration
  if (typeof window.EARENDIL_DISABLE_RIPPLE === 'undefined') {
    window.EARENDIL_DISABLE_RIPPLE = false;
  }

  // Parallax effect configuration
  if (typeof window.EARENDIL_DISABLE_PARALLAX === 'undefined') {
    window.EARENDIL_DISABLE_PARALLAX = true;
  }

  // Ripple management constants
  if (typeof window.EARENDIL_MAX_RIPPLES === 'undefined') {
    window.EARENDIL_MAX_RIPPLES = 6;
  }

  if (typeof window.EARENDIL_RIPPLE_INTERVAL === 'undefined') {
    window.EARENDIL_RIPPLE_INTERVAL = 100; // ms between ripples
  }

  if (typeof window.EARENDIL_MORPH_DURATION === 'undefined') {
    window.EARENDIL_MORPH_DURATION = 0.85;
  }

  if (typeof window.EARENDIL_INITIAL_ELVEN_REVEAL_DURATION === 'undefined') {
    window.EARENDIL_INITIAL_ELVEN_REVEAL_DURATION = 1.0; // seconds
  }

  const bg = document.querySelector('.fullscreen-bg');
  const img = document.querySelector('.main-image');
  const navLinks = document.querySelector('.nav-links');
  const rippleContainer = document.querySelector('.ripple-container');

  // Ripple management
  const MAX_RIPPLES = window.EARENDIL_MAX_RIPPLES;
  let lastRippleTime = 0;
  const RIPPLE_INTERVAL = window.EARENDIL_RIPPLE_INTERVAL;
  let restingTimeout = null;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function createRipple(x, y) {
    if (prefersReducedMotion || window.EARENDIL_DISABLE_RIPPLE) return; // Respect reduced motion preference and config

    const now = Date.now();
    if (now - lastRippleTime < RIPPLE_INTERVAL) return;
    lastRippleTime = now;

    // Remove old ripples if at max
    const ripples = rippleContainer.querySelectorAll('.ripple');
    if (ripples.length >= MAX_RIPPLES) {
      ripples[0].remove();
    }

    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.style.width = '100px';
    ripple.style.height = '100px';
    ripple.style.pointerEvents = 'none';

    rippleContainer.appendChild(ripple);

    // Remove after animation completes
    setTimeout(() => {
      if (ripple.parentNode) {
        ripple.remove();
      }
    }, 3600);
  }

  bg.style.opacity = '0';
  setTimeout(() => {
    bg.style.transition = 'opacity 2s';
    bg.style.opacity = '1.0';
  }, 250);

  img.style.opacity = '0';
  setTimeout(() => {
    img.style.transition = 'opacity 3s';
    img.style.opacity = '0.9';
  }, 600);

  if (!window.EARENDIL_DISABLE_RIPPLE && rippleContainer) {
    document.addEventListener('mousemove', (e) => {
      createRipple(e.pageX, e.pageY);
    });
  }

  // Animate logo transform
  img.style.opacity = '0';
  setTimeout(() => {
    img.style.transition = 'opacity 5s ease';
    img.style.opacity = '0.9';
  }, 600);

  // Animate nav links transform
  navLinks.style.opacity = '0';
  setTimeout(() => {
    navLinks.style.transition = 'opacity 3s ease';
    navLinks.style.opacity = '1';
  }, 600);

  // Corner text language switching - only run if corner texts exist
  const cornerTexts = document.querySelectorAll('.corner-text');

  if (cornerTexts.length > 0) {
    // Detect if device is mobile/touch-enabled
    const isMobile = window.matchMedia('(max-width: 768px)').matches ||
                     'ontouchstart' in window ||
                     navigator.maxTouchPoints > 0;

    // Track default language for each corner text (starts as elven)
    const defaultLanguages = new Map();
    const morphStates = new Map();
    const MORPH_DURATION = window.EARENDIL_MORPH_DURATION;
    const INITIAL_ELVEN_REVEAL_DURATION = window.EARENDIL_INITIAL_ELVEN_REVEAL_DURATION;

    // Utility: apply blur+opacity for a given fraction (0..1)
    function setMorph(cornerElement, fraction) {
      const elvenSpan = cornerElement.querySelector('.text-version.elven');
      const englishSpan = cornerElement.querySelector('.text-version.english');

      // Clamp to avoid division by zero in blur formula
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      let f = clamp(fraction, 0.0001, 0.9999);

      // English visibility follows f; Elven follows (1-f)
      const englishBlur = Math.min(8 / f - 8, 100);
      const elvenBlur = Math.min(8 / (1 - f) - 8, 100);

      const englishOpacity = Math.pow(f, 0.4);
      const elvenOpacity = Math.pow(1 - f, 0.4);

      englishSpan.style.filter = `blur(${englishBlur}px)`;
      englishSpan.style.opacity = `${englishOpacity}`;

      elvenSpan.style.filter = `blur(${elvenBlur}px)`;
      elvenSpan.style.opacity = `${elvenOpacity}`;
    }

    // Start a morph animation towards target language for a specific element
    function startMorph(cornerElement, targetLanguage) {
      let state = morphStates.get(cornerElement);
      if (!state) {
        state = { f: 0, raf: null };
        morphStates.set(cornerElement, state);
      }

      const targetF = targetLanguage === 'english' ? 1 : 0;
      const startF = state.f;
      const startTime = performance.now();

      if (state.raf) cancelAnimationFrame(state.raf);

      const step = (now) => {
        const t = (now - startTime) / (MORPH_DURATION * 1000);
        // Ease in/out for smoother motion
        const ease = t <= 0 ? 0 : t >= 1 ? 1 : (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const f = startF + (targetF - startF) * ease;
        state.f = f;
        setMorph(cornerElement, f);
        if (t < 1) {
          state.raf = requestAnimationFrame(step);
        } else {
          state.raf = null;
          // Snap to exact target at end
          state.f = targetF;
          setMorph(cornerElement, targetF);
        }
      };

      state.raf = requestAnimationFrame(step);
    }

    // Ensure CSS transitions don't interfere with JS morphing

    cornerTexts.forEach(cornerText => {
      defaultLanguages.set(cornerText, 'elven');
      const elvenSpan = cornerText.querySelector('.text-version.elven');
      const englishSpan = cornerText.querySelector('.text-version.english');
      // Remove CSS transitions so JS-driven morphing takes precedence
      elvenSpan.style.transition = 'none';
      englishSpan.style.transition = 'none';
      // Initialize morph state, but start with both hidden for reveal
      morphStates.set(cornerText, { f: 0, raf: null });
      elvenSpan.style.opacity = '0';
      elvenSpan.style.filter = 'blur(100px)';
      englishSpan.style.opacity = '0';
      englishSpan.style.filter = 'blur(100px)';
    });

    // Stacked layout spacing handled via CSS media queries

    // Initial reveal animation for Elvish text only (from full transparency)
    function startInitialReveal(cornerElement, durationSec) {
      const elvenSpan = cornerElement.querySelector('.text-version.elven');
      const start = performance.now();
      const step = (now) => {
        const t = (now - start) / (durationSec * 1000);
        const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
        // Ease in-out cubic
        const ease = clamped < 0.5
          ? 4 * clamped * clamped * clamped
          : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
        // Use similar blur falloff as morph for visual consistency
        const f = Math.max(ease, 0.0001);
        const blur = Math.min(8 / f - 8, 100);
        const opacity = Math.pow(ease, 0.4);
        elvenSpan.style.filter = `blur(${blur}px)`;
        elvenSpan.style.opacity = `${opacity}`;
        if (clamped < 1) {
          requestAnimationFrame(step);
        } else {
          // Snap to stable morph baseline (Elvish fully visible)
          setMorph(cornerElement, 0);
        }
      };
      requestAnimationFrame(step);
    }

    // Kick off initial reveal for all corners
    cornerTexts.forEach(cornerText => startInitialReveal(cornerText, INITIAL_ELVEN_REVEAL_DURATION));

    cornerTexts.forEach(cornerText => {
      let isHovering = false;

      if (!isMobile) {
        // Desktop: hover to temporarily show English, return to default on mouse leave
        cornerText.addEventListener('mouseenter', () => {
          isHovering = true;
          startMorph(cornerText, 'english');
        });

        cornerText.addEventListener('mouseleave', () => {
          isHovering = false;
          const defaultLang = defaultLanguages.get(cornerText);
          startMorph(cornerText, defaultLang);
        });
      }

      // Click/tap: toggle default language
      cornerText.addEventListener('click', (e) => {
        const currentDefault = defaultLanguages.get(cornerText);
        const newDefault = currentDefault === 'elven' ? 'english' : 'elven';
        defaultLanguages.set(cornerText, newDefault);

        // Morph to new default
        if (isMobile || !isHovering) {
          startMorph(cornerText, newDefault);
        }
      });
    });
  }

  // Background parallax motion: follows mouse cursor with smooth decay
  (function setupBackgroundParallax() {
    if (window.EARENDIL_DISABLE_PARALLAX) return;

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!bg || reduceMotion) return;

    const MAX_OFFSET = 40; // max px offset in any direction
    const SMOOTHING = 0.01; // how quickly we ease toward target per frame
    const DECAY_DURATION_MS = 2000; // time to scale down to rest after mouse stops

    let currentX = 0, currentY = 0;
    let targetX = 0, targetY = 0;
    let lastMouseMove = performance.now();
    let isMouseMoving = false;

    // Track mouse position and calculate parallax offset
    document.addEventListener('mousemove', (e) => {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      // Calculate normalized position (-1 to 1) from center
      const normalizedX = (e.clientX - centerX) / centerX;
      const normalizedY = (e.clientY - centerY) / centerY;

      // Invert for parallax effect (mouse right = background left)
      targetX = -normalizedX * MAX_OFFSET;
      targetY = -normalizedY * MAX_OFFSET;

      lastMouseMove = performance.now();
      isMouseMoving = true;
    });

    function animate(now) {
      // Calculate decay factor if mouse stopped moving
      const timeSinceMove = now - lastMouseMove;
      let decayFactor = 1;

      if (timeSinceMove > 100) { // Small delay before decay starts
        isMouseMoving = false;
        const decayProgress = Math.min((timeSinceMove - 100) / DECAY_DURATION_MS, 1);
        // Ease out cubic for smooth deceleration
        decayFactor = 1 - (decayProgress < 1 ? 1 - Math.pow(1 - decayProgress, 3) : 1);
      }

      // Apply decay to target when not moving
      const effectiveTargetX = isMouseMoving ? targetX : targetX * decayFactor;
      const effectiveTargetY = isMouseMoving ? targetY : targetY * decayFactor;

      // Smoothly interpolate current position toward target
      currentX += (effectiveTargetX - currentX) * SMOOTHING;
      currentY += (effectiveTargetY - currentY) * SMOOTHING;

      if (Math.abs(currentX) < 0.2) {
        currentX = 0;
      }
      if (Math.abs(currentY) < 0.2) {
        currentY = 0;
      }

      bg.style.setProperty('--bg-offset-x', currentX + 'px');
      bg.style.setProperty('--bg-offset-y', currentY + 'px');

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  })();
})();
