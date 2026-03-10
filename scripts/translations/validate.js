#!/usr/bin/env node
/**
 * Validates translation files for consistency and completeness.
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '../../locales');
const NAMESPACES = ['common', 'posts', 'subscribe', 'errors', 'content'];

const LANGUAGE_CODES = [
  'en', 'ar', 'bn', 'de', 'es', 'fa', 'fr', 'he', 'hi', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pt', 'ru', 'sv', 'sw',
  'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh'
];

function extractMessage(entry) {
  if (typeof entry === 'object' && entry !== null && 'message' in entry) {
    return entry.message;
  }
  return typeof entry === 'string' ? entry : null;
}

function validatePlaceholders(englishMsg, translatedMsg, key, lang) {
  const placeholderRegex = /\{(\w+)\}/g;
  const englishPlaceholders = [...englishMsg.matchAll(placeholderRegex)].map(m => m[1]).sort();
  const translatedPlaceholders = [...translatedMsg.matchAll(placeholderRegex)].map(m => m[1]).sort();

  if (JSON.stringify(englishPlaceholders) !== JSON.stringify(translatedPlaceholders)) {
    return `Placeholder mismatch in ${lang}/${key}: expected {${englishPlaceholders.join(', ')}}, got {${translatedPlaceholders.join(', ')}}`;
  }
  return null;
}

function validateHtmlTags(englishMsg, translatedMsg, key, lang) {
  const tagRegex = /<\/?[a-z][^>]*>/gi;
  const englishTags = (englishMsg.match(tagRegex) || []).sort();
  const translatedTags = (translatedMsg.match(tagRegex) || []).sort();

  if (JSON.stringify(englishTags) !== JSON.stringify(translatedTags)) {
    return `HTML tag mismatch in ${lang}/${key}`;
  }
  return null;
}

function main() {
  console.log('Validating translations...\n');

  const errors = [];
  const warnings = [];

  for (const namespace of NAMESPACES) {
    const englishFile = path.join(LOCALES_DIR, 'en', `${namespace}.json`);

    if (!fs.existsSync(englishFile)) {
      warnings.push(`Missing English file: en/${namespace}.json`);
      continue;
    }

    const englishData = JSON.parse(fs.readFileSync(englishFile, 'utf-8'));
    const englishKeys = Object.keys(englishData).filter(k => extractMessage(englishData[k]));

    for (const lang of LANGUAGE_CODES) {
      if (lang === 'en') continue;

      const langFile = path.join(LOCALES_DIR, lang, `${namespace}.json`);

      if (!fs.existsSync(langFile)) {
        errors.push(`Missing file: ${lang}/${namespace}.json`);
        continue;
      }

      let langData;
      try {
        langData = JSON.parse(fs.readFileSync(langFile, 'utf-8'));
      } catch (e) {
        errors.push(`Invalid JSON in ${lang}/${namespace}.json: ${e.message}`);
        continue;
      }

      const langKeys = Object.keys(langData);

      // Check for missing keys
      for (const key of englishKeys) {
        if (!langKeys.includes(key)) {
          warnings.push(`Missing key: ${lang}/${namespace}.json/${key}`);
        } else {
          const englishMsg = extractMessage(englishData[key]);
          const translatedMsg = langData[key];

          if (typeof translatedMsg !== 'string') {
            errors.push(`Invalid value type in ${lang}/${namespace}.json/${key}`);
            continue;
          }

          // Validate placeholders
          const placeholderError = validatePlaceholders(englishMsg, translatedMsg, key, lang);
          if (placeholderError) errors.push(placeholderError);

          // Validate HTML tags
          const htmlError = validateHtmlTags(englishMsg, translatedMsg, key, lang);
          if (htmlError) warnings.push(htmlError);
        }
      }

      // Check for extra keys
      for (const key of langKeys) {
        if (!englishKeys.includes(key)) {
          warnings.push(`Extra key: ${lang}/${namespace}.json/${key}`);
        }
      }
    }
  }

  // Report results
  if (errors.length > 0) {
    console.log('ERRORS:');
    errors.forEach(e => console.log(`  ❌ ${e}`));
    console.log();
  }

  if (warnings.length > 0) {
    console.log('WARNINGS:');
    warnings.slice(0, 20).forEach(w => console.log(`  ⚠️  ${w}`));
    if (warnings.length > 20) {
      console.log(`  ... and ${warnings.length - 20} more`);
    }
    console.log();
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ All translations valid!');
  } else {
    console.log(`Summary: ${errors.length} errors, ${warnings.length} warnings`);
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

main();
