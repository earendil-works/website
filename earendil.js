(function () {
  // Global configuration defaults
  if (typeof window.EARENDIL_DISABLE_RIPPLE === 'undefined') {
    window.EARENDIL_DISABLE_RIPPLE = false;
  }

  if (typeof window.EARENDIL_MAX_RIPPLES === 'undefined') {
    window.EARENDIL_MAX_RIPPLES = 9;
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

  const HOME_ROUTE = 'home';

  const bg = document.querySelector('.fullscreen-bg');
  const img = document.querySelector('.main-image');
  const navLinks = document.querySelector('.nav-links');
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

    if (img) {
      img.style.opacity = '0';
      setTimeout(() => {
        img.style.transition = 'opacity 5s ease';
        img.style.opacity = '0.9';
      }, 600);
    }

    if (navLinks) {
      navLinks.style.opacity = '0';
      setTimeout(() => {
        navLinks.style.transition = 'opacity 3s ease';
        navLinks.style.opacity = '1';
      }, 600);
    }
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
        if (navLinks) {
          navLinks.style.transition = navLinks.style.transition || 'opacity 3s ease';
          navLinks.style.opacity = '1';
        }
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
      }

      showPageLayer(immediate || initial);

      if (bg && (initial || immediate)) {
        bg.style.opacity = '1.0';
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

  if (!prefersReducedMotion && rippleContainer) {
    document.addEventListener('mousemove', (event) => {
      createRipple(event.pageX, event.pageY);
    });
  }

  // Corner text language morphing
  const cornerTexts = document.querySelectorAll('.corner-text');

  if (cornerTexts.length > 0) {
    const isMobile = window.matchMedia('(max-width: 768px)').matches ||
                     'ontouchstart' in window ||
                     navigator.maxTouchPoints > 0;

    const defaultLanguages = new Map();
    const morphStates = new Map();
    const MORPH_DURATION = window.EARENDIL_MORPH_DURATION;
    const INITIAL_ELVEN_REVEAL_DURATION = window.EARENDIL_INITIAL_ELVEN_REVEAL_DURATION;

    function setMorph(cornerElement, fraction) {
      const elvenSpan = cornerElement.querySelector('.text-version.elven');
      const englishSpan = cornerElement.querySelector('.text-version.english');

      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      const f = clamp(fraction, 0.0001, 0.9999);

      const englishBlur = Math.min(8 / f - 8, 100);
      const elvenBlur = Math.min(8 / (1 - f) - 8, 100);

      const englishOpacity = Math.pow(f, 0.4);
      const elvenOpacity = Math.pow(1 - f, 0.4);

      englishSpan.style.filter = `blur(${englishBlur}px)`;
      englishSpan.style.opacity = `${englishOpacity}`;

      elvenSpan.style.filter = `blur(${elvenBlur}px)`;
      elvenSpan.style.opacity = `${elvenOpacity}`;
    }

    function startMorph(cornerElement, targetLanguage) {
      let state = morphStates.get(cornerElement);
      if (!state) {
        state = { f: 0, raf: null };
        morphStates.set(cornerElement, state);
      }

      const targetF = targetLanguage === 'english' ? 1 : 0;
      const startF = state.f;
      const startTime = performance.now();

      if (state.raf) {
        cancelAnimationFrame(state.raf);
      }

      const step = (now) => {
        const t = (now - startTime) / (MORPH_DURATION * 1000);
        const ease = t <= 0 ? 0 : t >= 1 ? 1 : (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const f = startF + (targetF - startF) * ease;
        state.f = f;
        setMorph(cornerElement, f);
        if (t < 1) {
          state.raf = requestAnimationFrame(step);
        } else {
          state.raf = null;
          state.f = targetF;
          setMorph(cornerElement, targetF);
        }
      };

      state.raf = requestAnimationFrame(step);
    }

    cornerTexts.forEach((cornerText) => {
      defaultLanguages.set(cornerText, 'elven');
      const elvenSpan = cornerText.querySelector('.text-version.elven');
      const englishSpan = cornerText.querySelector('.text-version.english');
      elvenSpan.style.transition = 'none';
      englishSpan.style.transition = 'none';
      morphStates.set(cornerText, { f: 0, raf: null });
      elvenSpan.style.opacity = '0';
      elvenSpan.style.filter = 'blur(100px)';
      englishSpan.style.opacity = '0';
      englishSpan.style.filter = 'blur(100px)';
    });

    function startInitialReveal(cornerElement, durationSec) {
      const elvenSpan = cornerElement.querySelector('.text-version.elven');
      const start = performance.now();
      const step = (now) => {
        const t = (now - start) / (durationSec * 1000);
        const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
        const ease = clamped < 0.5
          ? 4 * clamped * clamped * clamped
          : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
        const f = Math.max(ease, 0.0001);
        const blur = Math.min(8 / f - 8, 100);
        const opacity = Math.pow(ease, 0.4);
        elvenSpan.style.filter = `blur(${blur}px)`;
        elvenSpan.style.opacity = `${opacity}`;
        if (clamped < 1) {
          requestAnimationFrame(step);
        } else {
          setMorph(cornerElement, 0);
        }
      };
      requestAnimationFrame(step);
    }

    cornerTexts.forEach((cornerText) => startInitialReveal(cornerText, INITIAL_ELVEN_REVEAL_DURATION));

    cornerTexts.forEach((cornerText) => {
      let isHovering = false;

      if (!isMobile) {
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

      cornerText.addEventListener('click', () => {
        const currentDefault = defaultLanguages.get(cornerText);
        const newDefault = currentDefault === 'elven' ? 'english' : 'elven';
        defaultLanguages.set(cornerText, newDefault);

        if (isMobile || !isHovering) {
          startMorph(cornerText, newDefault);
        }
      });
    });
  }
})();
