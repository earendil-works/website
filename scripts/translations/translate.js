#!/usr/bin/env node
/**
 * Machine translation script using Claude API.
 * Reads English files with { message, context } format.
 * Outputs plain string values for other languages.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const LOCALES_DIR = path.resolve(__dirname, '../../locales');
const NAMESPACES = ['common', 'posts', 'subscribe', 'errors', 'content'];

// Language codes
const LANGUAGE_CODES = [
  'en', 'ar', 'bn', 'de', 'es', 'fa', 'fr', 'he', 'hi', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pt', 'ru', 'sv', 'sw',
  'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh'
];

const LANGUAGE_NAMES = {
  ar: 'Arabic', bn: 'Bengali', de: 'German', es: 'Spanish',
  fa: 'Persian', fr: 'French', he: 'Hebrew', hi: 'Hindi',
  id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean',
  ms: 'Malay', nl: 'Dutch', no: 'Norwegian', pt: 'Portuguese',
  ru: 'Russian', sv: 'Swedish', sw: 'Swahili', ta: 'Tamil',
  te: 'Telugu', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian',
  vi: 'Vietnamese', zh: 'Chinese'
};

const RTL_LANGUAGES = ['ar', 'he', 'fa'];

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable not set');
  process.exit(1);
}

/**
 * Make a request to Claude API
 */
function callClaude(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            const text = response.content?.[0]?.text || '';
            resolve(text);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Extract message from English entry format
 */
function extractMessage(entry) {
  if (typeof entry === 'object' && entry !== null && 'message' in entry) {
    return entry.message;
  }
  return typeof entry === 'string' ? entry : '';
}

/**
 * Get missing keys for a namespace/language
 */
function getMissingKeys(namespace, lang) {
  const englishFile = path.join(LOCALES_DIR, 'en', `${namespace}.json`);
  const langFile = path.join(LOCALES_DIR, lang, `${namespace}.json`);

  if (!fs.existsSync(englishFile)) {
    return { missing: {}, extra: [] };
  }

  const englishData = JSON.parse(fs.readFileSync(englishFile, 'utf-8'));
  let langData = {};

  if (fs.existsSync(langFile)) {
    const content = fs.readFileSync(langFile, 'utf-8').trim();
    if (content && content !== '{}') {
      langData = JSON.parse(content);
    }
  }

  const englishKeys = Object.keys(englishData).filter(k => extractMessage(englishData[k]));
  const langKeys = new Set(Object.keys(langData));

  const missing = {};
  for (const key of englishKeys) {
    if (!langKeys.has(key)) {
      const entry = englishData[key];
      missing[key] = {
        message: extractMessage(entry),
        context: typeof entry === 'object' ? entry.context || '' : ''
      };
    }
  }

  const extra = [];
  for (const key of langKeys) {
    if (!englishKeys.includes(key)) {
      extra.push(key);
    }
  }

  return { missing, extra };
}

/**
 * Build system prompt for translation
 */
function buildSystemPrompt(lang) {
  const langName = LANGUAGE_NAMES[lang] || lang;
  const isRtl = RTL_LANGUAGES.includes(lang);

  return `You are translating user interface text for Earendil, a company website.

Earendil is a public benefit corporation building software that strengthens human agency.

Translate to ${langName}${isRtl ? ' (RTL language)' : ''}.

Guidelines:
- Be friendly, professional, and concise
- Use idiomatic ${langName}, not word-for-word translations
- Keep translations similar length to English when possible
- Preserve HTML tags exactly (<a>, <em>, <strong>, <span>, <br>)
- Preserve placeholders exactly ({name}, {count}, etc.)
- For brand names like "Earendil", "Lefos", keep them as-is

Input format: JSON object with keys mapping to { "text": "...", "context": "..." }
Output format: JSON object with same keys, values are translated strings only.
Return ONLY valid JSON, no markdown or explanations.`;
}

/**
 * Translate keys using Claude
 */
async function translateKeys(lang, keysToTranslate) {
  const keys = Object.keys(keysToTranslate);
  if (keys.length === 0) return {};

  console.log(`  Translating ${keys.length} keys to ${lang}...`);

  const input = {};
  for (const [key, value] of Object.entries(keysToTranslate)) {
    input[key] = { text: value.message, context: value.context };
  }

  try {
    const systemPrompt = buildSystemPrompt(lang);
    const response = await callClaude(systemPrompt, JSON.stringify(input, null, 2));

    // Parse JSON from response
    let jsonStr = response;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr.trim());
    const translated = {};

    for (const key of keys) {
      if (typeof parsed[key] === 'string') {
        translated[key] = parsed[key];
      } else {
        console.warn(`    Warning: Missing translation for "${key}"`);
        translated[key] = keysToTranslate[key].message;
      }
    }

    return translated;
  } catch (error) {
    console.error(`    Error translating to ${lang}:`, error.message);
    // Fall back to English
    const fallback = {};
    for (const [key, value] of Object.entries(keysToTranslate)) {
      fallback[key] = value.message;
    }
    return fallback;
  }
}

/**
 * Process a namespace for a language
 */
async function processNamespaceForLanguage(namespace, lang) {
  const { missing, extra } = getMissingKeys(namespace, lang);
  const langFile = path.join(LOCALES_DIR, lang, `${namespace}.json`);

  if (Object.keys(missing).length === 0 && extra.length === 0) {
    return { translated: 0, removed: 0 };
  }

  // Load existing
  let existing = {};
  if (fs.existsSync(langFile)) {
    const content = fs.readFileSync(langFile, 'utf-8').trim();
    if (content && content !== '{}') {
      existing = JSON.parse(content);
    }
  }

  // Remove extra keys
  for (const key of extra) {
    delete existing[key];
  }

  // Translate missing
  let translatedCount = 0;
  if (Object.keys(missing).length > 0) {
    const translated = await translateKeys(lang, missing);
    existing = { ...existing, ...translated };
    translatedCount = Object.keys(missing).length;
  }

  // Sort and write
  const sorted = {};
  for (const key of Object.keys(existing).sort()) {
    sorted[key] = existing[key];
  }

  const langDir = path.dirname(langFile);
  if (!fs.existsSync(langDir)) {
    fs.mkdirSync(langDir, { recursive: true });
  }

  fs.writeFileSync(langFile, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');

  if (translatedCount > 0 || extra.length > 0) {
    console.log(`  Updated ${lang}/${namespace}.json (+${translatedCount}, -${extra.length})`);
  }

  return { translated: translatedCount, removed: extra.length };
}

/**
 * Main
 */
async function main() {
  console.log('Machine Translation Script');
  console.log(`Languages: ${LANGUAGE_CODES.filter(l => l !== 'en').join(', ')}`);
  console.log(`Namespaces: ${NAMESPACES.join(', ')}\n`);

  let totalTranslated = 0;
  let totalRemoved = 0;

  for (const namespace of NAMESPACES) {
    console.log(`Processing: ${namespace}`);

    for (const lang of LANGUAGE_CODES) {
      if (lang === 'en') continue;

      const { translated, removed } = await processNamespaceForLanguage(namespace, lang);
      totalTranslated += translated;
      totalRemoved += removed;
    }
  }

  console.log(`\n✓ Complete! Translated: ${totalTranslated}, Removed: ${totalRemoved}`);
}

main().catch(error => {
  console.error('Translation failed:', error);
  process.exit(1);
});
