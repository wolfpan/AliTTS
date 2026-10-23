// 合成结果封装：SSE 事件累积 -> 完整音频 Blob（pcm 自动封 WAV 头）
import { runTts, type TtsEvent, type TtsRequestBody } from '../api/client';
import { base64ToBytes, concatBytes, pcmToWav, MIME_BY_FORMAT } from './assemble';

export interface WordItem { text: string; begin_time?: number; end_time?: number }

export interface SynthResult {
  blob: Blob;
  format: string;
  bytes: number;
  elapsedMs: number;
  requestId: string;
  historyId: string;
  mime: string;
  words: WordItem[];
}

export async function synthesizeToBlob(
  req: TtsRequestBody,
  opts?: { signal?: AbortSignal; onEvent?: (e: TtsEvent) => void },
): Promise<SynthResult> {
  const parts: Uint8Array[] = [];
  const st: {
    meta: { format: string; sampleRate: number | null; chunks: number } | null;
    done: { bytes: number; elapsedMs: number; requestId: string; historyId: string; mime: string } | null;
    words: WordItem[];
  } = { meta: null, done: null, words: [] };

  await runTts(req, {
    signal: opts?.signal,
    onEvent: (e: TtsEvent) => {
      opts?.onEvent?.(e);
      if (e.type === 'meta') st.meta = { format: e.format, sampleRate: e.sampleRate, chunks: e.chunks };
      else if (e.type === 'audio') parts.push(base64ToBytes(e.data));
      else if (e.type === 'words') st.words = st.words.concat(e.words);
      else if (e.type === 'done') {
        st.done = { bytes: e.bytes, elapsedMs: e.elapsedMs, requestId: e.requestId, historyId: e.historyId, mime: e.mime };
      }
    },
  });

  if (!parts.length) throw new Error('未收到音频数据');

  let bytes = concatBytes(parts);
  let format = st.meta?.format || 'mp3';
  if (format === 'pcm') {
    bytes = pcmToWav(bytes, st.meta?.sampleRate || 24000);
    format = 'wav';
  }
  const mime = st.done?.mime || MIME_BY_FORMAT[format] || 'audio/mpeg';
  return {
    blob: new Blob([bytes], { type: mime }),
    format,
    bytes: st.done?.bytes ?? bytes.length,
    elapsedMs: st.done?.elapsedMs ?? 0,
    requestId: st.done?.requestId ?? '',
    historyId: st.done?.historyId ?? '',
    mime,
    words: st.words,
  };
}
