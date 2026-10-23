const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AUDIO_DIR, HISTORY_FILE } = require('../config');

let history = null;

function loadHistory() {
  if (history) return history;
  try {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    history = [];
  }
  return history;
}

function persist() {
  const tmp = HISTORY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(loadHistory(), null, 2), 'utf8');
  fs.renameSync(tmp, HISTORY_FILE);
}

function saveAudio(buffer, format) {
  const id = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
  const ext = format === 'pcm' ? 'pcm' : format || 'mp3';
  const name = `${id}.${ext}`;
  fs.writeFileSync(path.join(AUDIO_DIR, name), buffer);
  return { fileId: name, bytes: buffer.length };
}

function addRecord(record) {
  const list = loadHistory();
  list.unshift(record);
  // 上限 500 条，超出裁剪并删除对应音频文件
  while (list.length > 500) {
    const dropped = list.pop();
    safeUnlink(dropped.file);
  }
  persist();
  return record;
}

function removeRecord(id) {
  const list = loadHistory();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  const [rec] = list.splice(idx, 1);
  safeUnlink(rec.file);
  persist();
  return true;
}

function clearHistory() {
  const list = loadHistory();
  for (const rec of list) safeUnlink(rec.file);
  history = [];
  persist();
  return true;
}

function safeUnlink(file) {
  if (!file) return;
  const full = path.join(AUDIO_DIR, path.basename(file));
  fs.unlink(full, () => {});
}

module.exports = { loadHistory, addRecord, removeRecord, clearHistory, saveAudio, AUDIO_DIR };
