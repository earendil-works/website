#!/usr/bin/env node
/**
 * Detects English translation keys that were edited and need re-translation.
 * Removes those keys from non-English files so translate.js picks them up.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '../../locales');

const LANGUAGE_CODES = [
  'en', 'ar', 'bn', 'de', 'es', 'fa', 'fr', 'he', 'hi', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pt', 'ru', 'sv', 'sw',
  'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh'
];

const NON_ENGLISH = LANGUAGE_CODES.filter(l => l !== 'en');

function getBaseRef() {
  return process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
}

function getEditedEnglishKeys() {
  const baseRef = getBaseRef();
  const editedKeys = [];

  let changedFiles;
  try {
    const output = execSync(`git diff --name-only ${baseRef}...HEAD -- "locales/en/*.json"`, { encoding: 'utf-8' });
    changedFiles = output.trim().split('\n').filter(Boolean);
  } catch {
    console.log('Could not get changed files from git diff');
    return [];
  }

  for (const filePath of changedFiles) {
    const namespace = path.basename(filePath, '.json');
    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) continue;

    // Get old content
    let oldContent;
    try {
      oldContent = execSync(`git show ${baseRef}:"${filePath}"`, { encoding: 'utf-8' });
    } catch {
      continue; // New file
    }

    const newContent = fs.readFileSync(fullPath, 'utf-8');

    let oldData, newData;
    try {
      oldData = JSON.parse(oldContent);
      newData = JSON.parse(newContent);
    } catch {
      continue;
    }

    // Find keys where message changed
    for (const key of Object.keys(newData)) {
      const oldEntry = oldData[key];
      const newEntry = newData[key];

      if (!oldEntry || !newEntry) continue;

      const oldMsg = typeof oldEntry === 'object' ? oldEntry.message : oldEntry;
      const newMsg = typeof newEntry === 'object' ? newEntry.message : newEntry;

      if (oldMsg !== newMsg && newMsg) {
        editedKeys.push({ namespace, key });
      }
    }
  }

  return editedKeys;
}

function wasKeyEditedInLang(namespace, key, lang) {
  const baseRef = getBaseRef();
  const filePath = `locales/${lang}/${namespace}.json`;
  const fullPath = path.resolve(filePath);

  if (!fs.existsSync(fullPath)) return false;

  let oldContent;
  try {
    oldContent = execSync(`git show ${baseRef}:"${filePath}"`, { encoding: 'utf-8' });
  } catch {
    return false;
  }

  const newContent = fs.readFileSync(fullPath, 'utf-8');

  let oldData, newData;
  try {
    oldData = JSON.parse(oldContent);
    newData = JSON.parse(newContent);
  } catch {
    return false;
  }

  return oldData[key] !== undefined && newData[key] !== undefined && oldData[key] !== newData[key];
}

function wasKeyEditedInAllLangs(namespace, key) {
  return NON_ENGLISH.every(lang => wasKeyEditedInLang(namespace, key, lang));
}

function removeKeyFromLangFile(namespace, key, lang) {
  const filePath = path.join(LOCALES_DIR, lang, `${namespace}.json`);

  if (!fs.existsSync(filePath)) return false;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return false;
  }

  if (!(key in data)) return false;

  delete data[key];

  const sorted = {};
  for (const k of Object.keys(data).sort()) {
    sorted[k] = data[k];
  }

  fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
  return true;
}

function main() {
  console.log('Detecting edited English keys...\n');

  const editedKeys = getEditedEnglishKeys();

  if (editedKeys.length === 0) {
    console.log('No edited English keys found.');
    return;
  }

  console.log(`Found ${editedKeys.length} edited key(s):`);
  editedKeys.forEach(({ namespace, key }) => console.log(`  - ${namespace}/${key}`));
  console.log();

  let toRetranslate = 0;
  let skipped = 0;

  for (const { namespace, key } of editedKeys) {
    if (wasKeyEditedInAllLangs(namespace, key)) {
      console.log(`✓ ${namespace}/${key}: edited in all languages, skipping`);
      skipped++;
    } else {
      console.log(`→ ${namespace}/${key}: needs re-translation`);
      toRetranslate++;

      for (const lang of NON_ENGLISH) {
        if (!wasKeyEditedInLang(namespace, key, lang)) {
          removeKeyFromLangFile(namespace, key, lang);
        }
      }
    }
  }

  console.log(`\nSummary: ${toRetranslate} to re-translate, ${skipped} skipped`);
}

main();
