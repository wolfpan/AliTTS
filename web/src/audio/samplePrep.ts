// 复刻样本预处理：任意格式音频 → 单声道 24kHz 16bit WAV（浏览器解码/重采样/裁剪）
import { pcmToWav } from './assemble';

export interface PreparedSample {
  blob: Blob;
  dataUri: string;
  originalDuration: number;
  duration: number;
  sampleRate: number;
}

function floatTo16Bit(pcm: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(pcm.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

export async function prepareSample(
  input: Blob,
  opts: { maxSeconds?: number; targetRate?: number } = {},
): Promise<PreparedSample> {
  const maxSeconds = opts.maxSeconds ?? 30;
  const targetRate = opts.targetRate ?? 24000;
  const raw = await input.arrayBuffer();

  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(raw);
  } catch {
    throw new Error('无法解码该音频，请换一个文件（支持 wav/mp3/m4a/webm 等）');
  } finally {
    void ctx.close();
  }

  const originalDuration = decoded.duration;
  if (!Number.isFinite(originalDuration) || originalDuration <= 0) throw new Error('音频时长为空');

  const useDuration = Math.min(originalDuration, maxSeconds);
  const frames = Math.max(1, Math.ceil(useDuration * targetRate));
  const offline = new OfflineAudioContext(1, frames, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0, 0, useDuration);
  const rendered = await offline.startRendering();
  const pcm = floatTo16Bit(rendered.getChannelData(0));
  const wav = pcmToWav(pcm, targetRate);
  const blob = new Blob([wav], { type: 'audio/wav' });
  return {
    blob,
    dataUri: 'data:audio/wav;base64,' + bytesToBase64(wav),
    originalDuration,
    duration: useDuration,
    sampleRate: targetRate,
  };
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, sec);
  return `${s.toFixed(1)}s`;
}
