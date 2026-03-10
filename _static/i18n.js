/**
 * Lightweight i18n for static site.
 * Loads translations from /locales/{lang}/*.json
 * Uses browser language by default, falls back to English.
 */
(function() {
  'use strict';

  var FALLBACK_LANG = 'en';
  var LANG_COOKIE = 'lang';
  var NAMESPACES = ['common', 'posts', 'subscribe', 'errors', 'content'];
  var RTL_LANGUAGES = ['ar', 'he', 'fa'];
  var SUPPORTED_LANGUAGES = [
    'en', 'ar', 'bn', 'de', 'es', 'fa', 'fr', 'he', 'hi', 'id',
    'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pt', 'ru', 'sv', 'sw',
    'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh'
  ];

  var translations = {};
  var currentLang = FALLBACK_LANG;
  var ready = false;
  var readyCallbacks = [];

  // Extract message from English format { message: "...", context: "..." } or plain string
  function extractMessage(value) {
    if (typeof value === 'object' && value !== null && 'message' in value) {
      return value.message;
    }
    return typeof value === 'string' ? value : '';
  }

  // Get translation by key (e.g., "common.site.title")
  function t(key, values) {
    var parts = key.split('.');
    var ns = parts[0];
    var id = parts.slice(1).join('.');
    
    // Try current language
    var nsData = translations[currentLang + ':' + ns];
    var message = nsData ? extractMessage(nsData[id]) : null;
    
    // Fallback to English
    if (!message && currentLang !== FALLBACK_LANG) {
      nsData = translations[FALLBACK_LANG + ':' + ns];
      message = nsData ? extractMessage(nsData[id]) : null;
    }
    
    if (!message) return key;
    
    // Simple interpolation: {name} -> values.name
    if (values) {
      message = message.replace(/\{(\w+)\}/g, function(match, name) {
        return values[name] !== undefined ? values[name] : match;
      });
    }
    
    return message;
  }

  // Load a namespace for a language
  function loadNamespace(lang, ns) {
    var key = lang + ':' + ns;
    if (translations[key]) {
      return Promise.resolve();
    }
    
    return fetch('/locales/' + lang + '/' + ns + '.json')
      .then(function(res) {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(function(data) {
        translations[key] = data;
      })
      .catch(function() {
        translations[key] = {};
      });
  }

  // Load all namespaces for a language
  function loadLanguage(lang) {
    var promises = NAMESPACES.map(function(ns) {
      return loadNamespace(lang, ns);
    });
    
    // Always load English as fallback
    if (lang !== FALLBACK_LANG) {
      NAMESPACES.forEach(function(ns) {
        promises.push(loadNamespace(FALLBACK_LANG, ns));
      });
    }
    
    return Promise.all(promises);
  }

  // Get language from cookie
  function getLangFromCookie() {
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + LANG_COOKIE + '=([^;]*)'));
    return match ? match[1] : null;
  }

  // Save language to cookie
  function saveLangCookie(lang) {
    document.cookie = LANG_COOKIE + '=' + lang + ';path=/;max-age=' + (60 * 60 * 24 * 365);
  }

  // Get browser language preference
  function getBrowserLang() {
    var langs = navigator.languages || [navigator.language];
    for (var i = 0; i < langs.length; i++) {
      var baseLang = langs[i].split('-')[0].toLowerCase();
      if (SUPPORTED_LANGUAGES.indexOf(baseLang) !== -1) {
        return baseLang;
      }
    }
    return null;
  }

  // Apply RTL direction if needed
  function applyDirection(lang) {
    var isRtl = RTL_LANGUAGES.indexOf(lang) !== -1;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }

  // Update all elements with data-i18n attribute
  function updateDOM() {
    var elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      var text = t(key);
      if (text !== key) {
        el.textContent = text;
      }
    });
    
    // Update HTML content (for rich text with links etc)
    var htmlElements = document.querySelectorAll('[data-i18n-html]');
    htmlElements.forEach(function(el) {
      var key = el.getAttribute('data-i18n-html');
      var html = t(key);
      if (html !== key) {
        // Convert newlines to <br> for proper formatting
        html = html.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
        el.innerHTML = html;
      }
    });
    
    // Update placeholders
    var placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    placeholders.forEach(function(el) {
      var key = el.getAttribute('data-i18n-placeholder');
      var text = t(key);
      if (text !== key) {
        el.placeholder = text;
      }
    });
    
    // Update aria-labels
    var ariaLabels = document.querySelectorAll('[data-i18n-aria]');
    ariaLabels.forEach(function(el) {
      var key = el.getAttribute('data-i18n-aria');
      var text = t(key);
      if (text !== key) {
        el.setAttribute('aria-label', text);
      }
    });
  }

  // Change language
  function changeLanguage(lang) {
    if (SUPPORTED_LANGUAGES.indexOf(lang) === -1) {
      console.warn('Unsupported language:', lang);
      return Promise.resolve();
    }
    
    return loadLanguage(lang).then(function() {
      currentLang = lang;
      saveLangCookie(lang);
      applyDirection(lang);
      updateDOM();
      
      // Dispatch event for other scripts to react
      window.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: lang } }));
    });
  }

  // Initialize
  function init() {
    // Priority: cookie > browser > fallback
    var lang = getLangFromCookie() || getBrowserLang() || FALLBACK_LANG;
    
    return loadLanguage(lang).then(function() {
      currentLang = lang;
      applyDirection(lang);
      ready = true;
      updateDOM();
      
      // Call ready callbacks
      readyCallbacks.forEach(function(cb) { cb(); });
      readyCallbacks = [];
    });
  }

  // Register callback for when i18n is ready
  function onReady(callback) {
    if (ready) {
      callback();
    } else {
      readyCallbacks.push(callback);
    }
  }

  // Language names for the picker
  var LANGUAGE_NAMES = {
    en: 'English',
    ar: 'العربية',
    bn: 'বাংলা',
    de: 'Deutsch',
    es: 'Español',
    fa: 'فارسی',
    fr: 'Français',
    he: 'עברית',
    hi: 'हिन्दी',
    id: 'Bahasa Indonesia',
    it: 'Italiano',
    ja: '日本語',
    ko: '한국어',
    ms: 'Bahasa Melayu',
    nl: 'Nederlands',
    no: 'Norsk',
    pt: 'Português',
    ru: 'Русский',
    sv: 'Svenska',
    sw: 'Kiswahili',
    ta: 'தமிழ்',
    te: 'తెలుగు',
    th: 'ไทย',
    tr: 'Türkçe',
    uk: 'Українська',
    vi: 'Tiếng Việt',
    zh: '中文'
  };

  // Short native labels for the picker toggle (first 2 chars of native name)
  var LANGUAGE_SHORT = {
    en: 'EN',
    ar: 'عر',
    bn: 'বা',
    de: 'DE',
    es: 'ES',
    fa: 'فا',
    fr: 'FR',
    he: 'עב',
    hi: 'हि',
    id: 'ID',
    it: 'IT',
    ja: '日本',
    ko: '한국',
    ms: 'MS',
    nl: 'NL',
    no: 'NO',
    pt: 'PT',
    ru: 'РУ',
    sv: 'SV',
    sw: 'SW',
    ta: 'தமி',
    te: 'తె',
    th: 'ไท',
    tr: 'TR',
    uk: 'УК',
    vi: 'VI',
    zh: '中文'
  };

  // Initialize language picker UI
  function initLanguagePicker() {
    var toggle = document.getElementById('lang-toggle');
    var menu = document.getElementById('lang-menu');
    var currentDisplay = toggle ? toggle.querySelector('.lang-current') : null;
    
    if (!toggle || !menu) return;
    
    // Populate menu
    menu.innerHTML = '';
    SUPPORTED_LANGUAGES.forEach(function(code) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'option');
      btn.setAttribute('data-lang', code);
      btn.innerHTML = '<span class="lang-name">' + LANGUAGE_NAMES[code] + '</span><span class="lang-code">' + LANGUAGE_SHORT[code] + '</span>';
      btn.addEventListener('click', function() {
        changeLanguage(code);
        closeMenu();
      });
      li.appendChild(btn);
      menu.appendChild(li);
    });
    
    // Update current display
    function updateCurrentDisplay() {
      if (currentDisplay) {
        currentDisplay.textContent = LANGUAGE_SHORT[currentLang] || currentLang.toUpperCase();
      }
      // Update selected state in menu
      var buttons = menu.querySelectorAll('button');
      buttons.forEach(function(btn) {
        btn.setAttribute('aria-selected', btn.getAttribute('data-lang') === currentLang ? 'true' : 'false');
      });
    }
    
    // Toggle menu
    function toggleMenu() {
      var isOpen = !menu.hidden;
      if (isOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    }
    
    function openMenu() {
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      updateCurrentDisplay();
      // Focus current language
      var currentBtn = menu.querySelector('[data-lang="' + currentLang + '"]');
      if (currentBtn) {
        setTimeout(function() { currentBtn.focus(); }, 10);
      }
    }
    
    function closeMenu() {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
    
    // Event listeners
    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleMenu();
    });
    
    // Close on outside click
    document.addEventListener('click', function(e) {
      if (!menu.hidden && !menu.contains(e.target) && e.target !== toggle) {
        closeMenu();
      }
    });
    
    // Close on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !menu.hidden) {
        closeMenu();
        toggle.focus();
      }
    });
    
    // Keyboard navigation in menu
    menu.addEventListener('keydown', function(e) {
      var buttons = Array.from(menu.querySelectorAll('button'));
      var currentIndex = buttons.indexOf(document.activeElement);
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        var nextIndex = (currentIndex + 1) % buttons.length;
        buttons[nextIndex].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        var prevIndex = (currentIndex - 1 + buttons.length) % buttons.length;
        buttons[prevIndex].focus();
      }
    });
    
    // Update display on language change
    window.addEventListener('languagechange', updateCurrentDisplay);
    
    // Initial update
    updateCurrentDisplay();
  }

  // Export
  window.i18n = {
    t: t,
    changeLanguage: changeLanguage,
    getLanguage: function() { return currentLang; },
    onReady: onReady,
    updateDOM: updateDOM,
    SUPPORTED_LANGUAGES: SUPPORTED_LANGUAGES,
    LANGUAGE_NAMES: LANGUAGE_NAMES
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      init().then(initLanguagePicker);
    });
  } else {
    init().then(initLanguagePicker);
  }
})();
