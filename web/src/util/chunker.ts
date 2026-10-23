// 长文本分段（与服务端 server/util/chunker.js 保持同一算法，用于 UI 分段预览）
const SENTENCE_BREAK = /([。！？；!?;\n])/;

export function splitText(text: string, limit = 600): string[] {
  if (!text) return [];
  const normalized = String(text).replace(/\r\n/g, '\n');
  if (normalized.length <= limit) return [normalized];

  const parts = normalized.split(SENTENCE_BREAK);
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const s = (parts[i] || '') + (parts[i + 1] || '');
    if (s) sentences.push(s);
  }

  const chunks: string[] = [];
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

function hardSplit(s: string, limit: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const seg of s.split(/([，、, ])/)) {
    if ((cur + seg).length > limit && cur) { out.push(cur); cur = seg; }
    else cur += seg;
  }
  if (cur) out.push(cur);
  return out;
}
