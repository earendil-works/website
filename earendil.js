(function () {
  // Global configuration defaults
  if (typeof window.EARENDIL_DISABLE_RIPPLE === 'undefined') {
    window.EARENDIL_DISABLE_RIPPLE = false;
  }

  if (typeof window.EARENDIL_MAX_RIPPLES === 'undefined') {
    window.EARENDIL_MAX_RIPPLES = 9;
  }

  if (typeof window.EARENDIL_RIPPLE_INTERVAL === 'undefined') {
    window.EARENDIL_RIPPLE_INTERVAL = 90; // ms between ripples
  }

  if (typeof window.EARENDIL_MORPH_DURATION === 'undefined') {
    window.EARENDIL_MORPH_DURATION = 0.85;
  }

  if (typeof window.EARENDIL_INITIAL_ELVEN_REVEAL_DURATION === 'undefined') {
    window.EARENDIL_INITIAL_ELVEN_REVEAL_DURATION = 1.0; // seconds
  }

  const HOME_ROUTE = 'home';

  const bg = document.querySelector('.fullscreen-bg');
  const img = document.querySelector('.main-image');
  const cornerLinks = document.querySelectorAll('.corner-link');

  // Debug observer removed after investigation

  const rippleContainer = document.querySelector('.ripple-container');
  const pageLayer = document.querySelector('[data-page-layer]');
  const pageContent = pageLayer ? pageLayer.querySelector('[data-page-content]') : null;
  const homeElements = Array.from(document.querySelectorAll('[data-home-el]'));
  const homeElementMeta = new Map();
  homeElements.forEach((el) => {
    const parsed = Number.parseFloat(el.dataset.homeVisibleOpacity || '1');
    const clamped = Number.isNaN(parsed) ? 1 : Math.max(0, Math.min(1, parsed));
    const manualShow = el.hasAttribute('data-home-manual-show');
    homeElementMeta.set(el, {
      visibleOpacity: clamped,
      manualShow,
      storedTransition: null,
    });
  });
  const routeTemplates = document.querySelectorAll('#page-templates template');

  const routes = new Map();
  const pathToRoute = new Map();

  function setHomeElementsVisible(visible, options = {}) {
    const { immediate = false, includeManual = true } = options;
    homeElements.forEach((el) => {
      const meta = homeElementMeta.get(el);
      if (!meta) {
        return;
      }
      if (visible && meta.manualShow && !includeManual) {
        return;
      }

      let transitionOverride = null;
      if (!visible && meta.manualShow) {
        if (meta.storedTransition === null) {
          meta.storedTransition = el.style.transition || '';
        }
        transitionOverride = 'opacity 0.2s ease-out';
      } else if (visible && meta.manualShow && meta.storedTransition !== null) {
        transitionOverride = meta.storedTransition;
        meta.storedTransition = null;
      }

      const target = visible ? meta.visibleOpacity : 0;
      if (immediate) {
        const previousTransition = el.style.transition;
        el.style.transition = 'none';
        el.style.opacity = `${target}`;
        el.getBoundingClientRect();
        el.style.transition = previousTransition;
      } else {
        if (transitionOverride !== null) {
          el.style.transition = transitionOverride;
        } else if (!el.style.transition) {
          el.style.transition = 'opacity 0.6s ease';
        }
        el.style.opacity = `${target}`;
      }
    });
  }

  setHomeElementsVisible(false, { immediate: true });

  // Updates page form initialization
  function initUpdatesForm() {
    var input = document.getElementById('updates-email');
    var display = document.getElementById('updates-display');
    var cursor = document.getElementById('updates-cursor');
    var enterBtn = document.getElementById('updates-enter');
    var messageEl = document.getElementById('updates-message');
    var container = document.querySelector('.updates-input-container');
    var wrapper = document.querySelector('.updates-input-wrapper');
    var PLACEHOLDER = 'your@email.here';
    var isPlaceholder = true;
    var lastValidValue = '';

    if (!input) return;

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

    function showAnimatedDisplay(val) {
      if (!display) return;
      // Build character spans with staggered animation
      var chars = val.split('').map(function(c, i) {
        return '<span class="updates-char" style="animation-delay:' + (i * 30) + 'ms">' + c + '</span>';
      }).join('');
      display.innerHTML = chars;
      display.hidden = false;
      display.classList.add('valid');
      input.classList.add('has-display');
      lastValidValue = val;
    }

    function hideAnimatedDisplay() {
      if (!display) return;
      display.hidden = true;
      display.classList.remove('valid');
      input.classList.remove('has-display');
    }

    function updateState() {
      var val = input.value;

      if (val === PLACEHOLDER && isPlaceholder) {
        input.classList.add('placeholder-text');
        hideAnimatedDisplay();
        if (enterBtn) enterBtn.hidden = true;
      } else if (isValidEmail(val)) {
        input.classList.remove('placeholder-text');
        if (val !== lastValidValue) {
          showAnimatedDisplay(val);
        }
        if (enterBtn) enterBtn.hidden = false;
      } else {
        input.classList.remove('placeholder-text');
        hideAnimatedDisplay();
        if (enterBtn) enterBtn.hidden = true;
      }
    }

    function showCursor() {
      if (cursor) cursor.classList.add('visible');
    }

    function hideCursor() {
      if (cursor) cursor.classList.remove('visible');
    }

    input.addEventListener('focus', function() {
      hideCursor();
      if (isPlaceholder) {
        // Use timeout to ensure select happens after click event
        setTimeout(function() { input.select(); }, 0);
      } else if (isValidEmail(input.value)) {
        // Re-apply display state immediately to prevent spacing flicker
        input.classList.add('has-display');
      }
    });

    input.addEventListener('input', function() {
      isPlaceholder = false;
      updateState();
    });

    input.addEventListener('blur', function() {
      if (input.value === '' || input.value === PLACEHOLDER) {
        input.value = PLACEHOLDER;
        isPlaceholder = true;
        hideAnimatedDisplay();
        input.classList.add('placeholder-text');
        showCursor();
        if (enterBtn) enterBtn.hidden = true;
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

      fetch('https://script.google.com/macros/s/AKfycbxtaYo7U3mpdwBnfl3O735PTKySaypH3JbYczz4tLJ7je-qBRgjQrZS0ZyB6bMRwt-4cQ/exec', {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ email: email })
      })
      .then(function() {
        // With no-cors, we can't read response but request was sent
        if (wrapper) {
          wrapper.style.transition = 'opacity 0.4s ease';
          wrapper.style.opacity = '0';
        }
        setTimeout(function() {
          if (container) container.style.display = 'none';
          if (messageEl) messageEl.hidden = false;
        }, 400);
      })
      .catch(function(err) {
        var originalValue = input.value;
        input.value = 'Something went wrong';
        input.classList.add('updates-error');
        hideAnimatedDisplay();
        if (enterBtn) enterBtn.hidden = true;
        setTimeout(function() {
          input.value = originalValue;
          input.classList.remove('updates-error');
          updateState();
        }, 2000);
      });
    }

    // Auto-focus on any keypress so typing immediately works
    function handleGlobalKeydown(e) {
      // Ignore if already focused or if it's a modifier key
      if (document.activeElement === input) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1) {
        // It's a printable character
        input.focus();
      }
    }
    document.addEventListener('keydown', handleGlobalKeydown);

    // Initialize: cursor visible, placeholder shown
    showCursor();
  }

  routeTemplates.forEach((template) => {
    const slug = template.dataset.page;
    if (!slug) {
      return;
    }
    const rawPath = template.dataset.path || `/${slug}/`;
    const path = ensureTrailingSlash(rawPath);
    const title = template.dataset.title || slug;
    const html = template.innerHTML.trim();

    routes.set(slug, { slug, path, title, html });
    pathToRoute.set(path, slug);
  });

  let currentRoute = null;
  let homeIntroDone = false;

  function ensureTrailingSlash(pathname) {
    if (!pathname) {
      return '/';
    }
    let normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
    if (normalized.length > 1 && normalized.endsWith('/')) {
      return normalized;
    }
    if (normalized === '/') {
      return normalized;
    }
    return `${normalized}/`;
  }

  function resolveRouteFromPath(pathname) {
    const normalized = ensureTrailingSlash(pathname || '/');
    if (pathToRoute.has(normalized)) {
      return pathToRoute.get(normalized);
    }
    return HOME_ROUTE;
  }

  function routeToPath(route) {
    if (route === HOME_ROUTE) {
      return '/';
    }
    const page = routes.get(route);
    return page ? ensureTrailingSlash(page.path) : '/';
  }

  function showPageLayer(immediate) {
    if (!pageLayer) {
      return;
    }
    pageLayer.removeAttribute('hidden');
    if (immediate) {
      const previous = pageLayer.style.transition;
      pageLayer.style.transition = 'none';
      pageLayer.classList.add('visible');
      pageLayer.getBoundingClientRect();
      pageLayer.style.transition = previous;
    } else {
      requestAnimationFrame(() => {
        pageLayer.classList.add('visible');
      });
    }
  }

  function hidePageLayer(immediate) {
    if (!pageLayer) {
      return;
    }
    if (immediate) {
      const previous = pageLayer.style.transition;
      pageLayer.style.transition = 'none';
      pageLayer.classList.remove('visible');
      pageLayer.setAttribute('hidden', '');
      pageLayer.getBoundingClientRect();
      pageLayer.style.transition = previous;
    } else {
      pageLayer.classList.remove('visible');
      const handle = (event) => {
        if (event.target === pageLayer) {
          pageLayer.setAttribute('hidden', '');
          pageLayer.removeEventListener('transitionend', handle);
        }
      };
      pageLayer.addEventListener('transitionend', handle);
    }
  }

  function fadeInHomeElement(el, targetOpacity, durationSec, delayMs) {
    if (!el) {
      return;
    }

    const meta = homeElementMeta.get(el);
    if (meta) {
      meta.storedTransition = `opacity ${durationSec}s ease`;
    }

    el.style.transition = 'none';
    el.style.opacity = '0';
    el.getBoundingClientRect();

    setTimeout(() => {
      el.style.transition = `opacity ${durationSec}s ease`;
      el.style.opacity = `${targetOpacity}`;
    }, delayMs);
  }

  function runInitialHomeIntro() {
    if (homeIntroDone) {
      return;
    }
    homeIntroDone = true;

    if (bg) {
      bg.style.opacity = '0';
      setTimeout(() => {
        bg.style.transition = 'opacity 2s';
        bg.style.opacity = '1.0';
      }, 250);
    }

    fadeInHomeElement(img, 0.9, 5, 600);
    cornerLinks.forEach(function(link) {
      fadeInHomeElement(link, 1, 3, 600);
    });
  }

  function applyRoute(route, options = {}) {
    const { immediate = false, initial = false } = options;
    const isHome = route === HOME_ROUTE;
    const previousRoute = currentRoute;
    currentRoute = route;

    document.body.classList.toggle('view-home', isHome);
    document.body.classList.toggle('view-page', !isHome);

    if (bg) {
      bg.classList.toggle('page-bg', !isHome);
      if (isHome && immediate) {
        bg.style.opacity = '1.0';
      } else if (!isHome && immediate) {
        bg.style.opacity = '0.4';
      }
    }

    window.EARENDIL_DISABLE_RIPPLE = !isHome;

    const includeManual = !(initial && isHome);
    setHomeElementsVisible(isHome, { immediate: immediate || initial, includeManual });

    if (isHome) {
      document.title = 'EARENDIL';
      hidePageLayer(immediate || initial);
      if (initial || (!previousRoute && !initial) || !homeIntroDone) {
        runInitialHomeIntro();
      } else if (!immediate && previousRoute && previousRoute !== HOME_ROUTE) {
        if (bg) {
          bg.style.transition = 'opacity 1.2s ease';
          bg.style.opacity = '1.0';
        }
        if (img) {
          img.style.transition = img.style.transition || 'opacity 5s ease';
          img.style.opacity = '0.9';
        }
        cornerLinks.forEach(function(link) {
          link.style.transition = link.style.transition || 'opacity 3s ease';
          link.style.opacity = '1';
        });
      }
    } else {
      const page = routes.get(route);
      if (!page) {
        applyRoute(HOME_ROUTE, { immediate: true });
        return;
      }

      document.title = `${page.title} - EARENDIL`;

      if (pageContent) {
        pageContent.innerHTML = page.html;
        // Initialize updates form if on updates page
        if (route === 'updates') {
          initUpdatesForm();
        }
      }

      showPageLayer(immediate || initial);

      if (bg) {
        if (initial || immediate) {
          bg.style.opacity = '0.4';
        } else {
          bg.style.transition = 'opacity 0.6s ease';
          bg.style.opacity = '0.4';
        }
      }
    }
  }

  function updateHistory(route, mode) {
    const path = routeToPath(route);
    const state = { route };
    const normalizedTarget = ensureTrailingSlash(path);
    const normalizedCurrent = ensureTrailingSlash(window.location.pathname || '/');

    if (mode === 'replace') {
      history.replaceState(state, '', path);
    } else if (mode === 'push') {
      if (normalizedTarget === normalizedCurrent) {
        history.replaceState(state, '', path);
      } else {
        history.pushState(state, '', path);
      }
    }
  }

  const initialRoute = resolveRouteFromPath(window.location.pathname);
  if (initialRoute !== HOME_ROUTE) {
    homeIntroDone = true;
  }
  applyRoute(initialRoute, { immediate: true, initial: true });
  updateHistory(initialRoute, 'replace');

  const routeLinks = document.querySelectorAll('[data-route-link]');
  routeLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetRoute = link.dataset.routeLink === 'home'
        ? HOME_ROUTE
        : link.dataset.routeLink;

      if (targetRoute !== HOME_ROUTE && !routes.has(targetRoute)) {
        return;
      }

      event.preventDefault();

      if (targetRoute === currentRoute) {
        return;
      }

      updateHistory(targetRoute, 'push');
      applyRoute(targetRoute);
    });
  });

  window.addEventListener('popstate', (event) => {
    const stateRoute = event.state && event.state.route;
    let route = stateRoute;
    if (!route || (route !== HOME_ROUTE && !routes.has(route))) {
      route = resolveRouteFromPath(window.location.pathname);
    }
    applyRoute(route, { immediate: false });
  });

  // Ripple effect configuration and helpers
  const MAX_RIPPLES = window.EARENDIL_MAX_RIPPLES;
  let lastRippleTime = 0;
  const RIPPLE_INTERVAL = window.EARENDIL_RIPPLE_INTERVAL;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CURSOR_GLOW_INACTIVITY_MS = 3000;

  let cursorGlow = null;
  let cursorGlowFadeHandle = null;
  let cursorGlowAnimationHandle = null;
  let cursorGlowPosition = null;
  let cursorGlowTarget = null;

  function createRipple(x, y) {
    if (prefersReducedMotion || window.EARENDIL_DISABLE_RIPPLE || !rippleContainer) {
      return;
    }

    const now = Date.now();
    if (now - lastRippleTime < RIPPLE_INTERVAL) {
      return;
    }
    lastRippleTime = now;

    const ripples = rippleContainer.querySelectorAll('.ripple');
    if (ripples.length >= MAX_RIPPLES) {
      ripples[0].remove();
    }

    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.width = '100px';
    ripple.style.height = '100px';
    ripple.style.pointerEvents = 'none';

    rippleContainer.appendChild(ripple);

    setTimeout(() => {
      if (ripple.parentNode) {
        ripple.remove();
      }
    }, 3600);
  }

  function ensureCursorGlow() {
    if (cursorGlow || !rippleContainer) {
      return;
    }
    cursorGlow = document.createElement('div');
    cursorGlow.className = 'cursor-glow';
    rippleContainer.appendChild(cursorGlow);
  }

  function clearCursorGlowFade() {
    if (cursorGlowFadeHandle !== null) {
      clearTimeout(cursorGlowFadeHandle);
      cursorGlowFadeHandle = null;
    }
  }

  function hideCursorGlow() {
    if (!cursorGlow) {
      return;
    }
    cursorGlow.style.opacity = '0';
  }

  function scheduleCursorGlowFade() {
    if (!cursorGlow) {
      return;
    }
    clearCursorGlowFade();
    cursorGlowFadeHandle = window.setTimeout(() => {
      cursorGlowFadeHandle = null;
      hideCursorGlow();
    }, CURSOR_GLOW_INACTIVITY_MS);
  }

  function showCursorGlow() {
    if (!cursorGlow) {
      return;
    }
    cursorGlow.style.opacity = '1';
    scheduleCursorGlowFade();
  }

  function applyCursorGlowPosition(x, y) {
    if (!cursorGlow) {
      return;
    }
    cursorGlow.style.left = `${x}px`;
    cursorGlow.style.top = `${y}px`;
  }

  function stepCursorGlowAnimation() {
    if (!cursorGlow || !cursorGlowTarget || !cursorGlowPosition) {
      cursorGlowAnimationHandle = null;
      return;
    }

    const lerp = 0.2;
    const dx = cursorGlowTarget.x - cursorGlowPosition.x;
    const dy = cursorGlowTarget.y - cursorGlowPosition.y;

    cursorGlowPosition.x += dx * lerp;
    cursorGlowPosition.y += dy * lerp;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      cursorGlowPosition.x = cursorGlowTarget.x;
      cursorGlowPosition.y = cursorGlowTarget.y;
    }

    applyCursorGlowPosition(cursorGlowPosition.x, cursorGlowPosition.y);

    if (cursorGlowPosition.x !== cursorGlowTarget.x || cursorGlowPosition.y !== cursorGlowTarget.y) {
      cursorGlowAnimationHandle = requestAnimationFrame(stepCursorGlowAnimation);
    } else {
      cursorGlowAnimationHandle = null;
    }
  }

  function updateCursorGlowPosition(x, y) {
    if (!cursorGlow) {
      return;
    }

    cursorGlowTarget = { x, y };

    if (!cursorGlowPosition) {
      cursorGlowPosition = { x, y };
      applyCursorGlowPosition(x, y);
      return;
    }

    if (cursorGlowAnimationHandle === null) {
      cursorGlowAnimationHandle = requestAnimationFrame(stepCursorGlowAnimation);
    }
  }

  if (!prefersReducedMotion && rippleContainer) {
    ensureCursorGlow();

    document.addEventListener('mousemove', (event) => {
      createRipple(event.pageX, event.pageY);
      ensureCursorGlow();
      updateCursorGlowPosition(event.clientX, event.clientY);
      showCursorGlow();
    });

    document.addEventListener('mouseleave', () => {
      clearCursorGlowFade();
      hideCursorGlow();
      cursorGlowTarget = null;
      cursorGlowPosition = null;
      if (cursorGlowAnimationHandle !== null) {
        cancelAnimationFrame(cursorGlowAnimationHandle);
        cursorGlowAnimationHandle = null;
      }
    });
  }
})();
