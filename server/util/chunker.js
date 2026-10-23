// 按句子边界贪心切分长文本；单句超限时再按逗号/空格硬切
const SENTENCE_BREAK = /([。！？；!?;\n])/;

function splitText(text, limit = 600) {
  if (!text) return [];
  const normalized = String(text).replace(/\r\n/g, '\n');
  if (normalized.length <= limit) return [normalized];

  // 先按句子边界切成句子
  const parts = normalized.split(SENTENCE_BREAK);
  const sentences = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = (parts[i] || '') + (parts[i + 1] || '');
    if (s) sentences.push(s);
  }

  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > limit) {
      if (cur) { chunks.push(cur); cur = ''; }
      for (const piece of hardSplit(s, limit)) chunks.push(piece);
      continue;
    }
    if ((cur + s).length > limit) { chunks.push(cur); cur = s; }
    else cur += s;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function hardSplit(s, limit) {
  const out = [];
  let cur = '';
  for (const seg of s.split(/([，、, ])/)) {
    if ((cur + seg).length > limit && cur) { out.push(cur); cur = seg; }
    else cur += seg;
  }
  if (cur) out.push(cur);
  return out;
}

module.exports = { splitText };
