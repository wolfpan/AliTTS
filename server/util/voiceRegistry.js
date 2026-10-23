const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');

const FILE = path.join(DATA_DIR, 'voices.json');
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (typeof cache !== 'object' || Array.isArray(cache)) cache = {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

function upsert(voiceId, meta) {
  const all = load();
  all[voiceId] = { ...(all[voiceId] || {}), ...meta, updatedTs: Date.now() };
  persist();
  return all[voiceId];
}

function get(voiceId) {
  return load()[voiceId] || null;
}

function remove(voiceId) {
  const all = load();
  delete all[voiceId];
  persist();
}

function setAlias(voiceId, alias) {
  const all = load();
  all[voiceId] = { ...(all[voiceId] || {}), alias: String(alias || '').slice(0, 30), updatedTs: Date.now() };
  persist();
  return all[voiceId];
}

module.exports = { load, upsert, get, remove, setAlias };
