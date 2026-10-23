// 流式边收边播：SSE 音频分片到达即解码播放（仅 wav / pcm 单段流；mp3/opus 仍聚合后播放）
import { base64ToBytes, concatBytes, pcmToWav } from './assemble';

export interface StreamPlayerInfo {
  active: boolean;
  playedSeconds: number;
  bufferedSeconds: number;
  suspended: boolean;
}

export class StreamPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private byteParts: Uint8Array[] = [];
  private processedOffset = 0;
  private header: { sampleRate: number; channels: number; bits: number; dataStart: number } | null = null;
  private format: 'wav' | 'pcm';
  private fallbackSampleRate: number;
  private _active = false;
  private _suspended = false;

  constructor(format: 'wav' | 'pcm', sampleRate = 24000) {
    this.format = format;
    this.fallbackSampleRate = sampleRate;
    try {
      this.ctx = new AudioContext();
      this.nextTime = this.ctx.currentTime + 0.08;
      this._active = true;
      this.ctx.resume().catch(() => {});
      // 用户未与页面交互过时 AudioContext 可能保持 suspended：稍后复查
      setTimeout(() => {
        if (this.ctx && this.ctx.state === 'suspended') this._suspended = true;
      }, 400);
    } catch {
      this._active = false;
    }
    this.report();
  }

  get active() { return this._active; }

  /** 喂入一个 base64 音频分片 */
  feedChunk(b64: string) {
    const bytes = base64ToBytes(b64);
    this.byteParts.push(bytes);
    if (!this._active || !this.ctx || this._suspended) { this.report(); return; }

    // 时钟冻结守卫：部分环境（如内嵌 WebView 禁音）AudioContext 状态为 running 但时钟不走，
    // 调度的音频永远不会触发；此时放弃流式，回退聚合播放，避免 UI 谎报"播放中"
    if (this.nextTime > 1 && this.ctx.currentTime < 0.05) {
      this._suspended = true;
      this.report();
      return;
    }

    const stream = concatBytes(this.byteParts);
    if (this.format === 'wav' && !this.header) {
      if (stream.length < 44) { this.report(); return; }
      this.header = parseWavHeader(stream);
      if (!this.header) { // 非 PCM 或解析失败：放弃流式，聚合播放兜底
        this._active = false;
        this.report();
        return;
      }
      this.processedOffset = this.header.dataStart;
    }

    const header = this.format === 'wav' ? this.header! : { sampleRate: this.fallbackSampleRate, channels: 1, bits: 16, dataStart: 0 };
    const bytesPerFrame = (header.bits / 8) * header.channels;
    const availFrames = Math.floor((stream.length - this.processedOffset) / bytesPerFrame);
    if (availFrames <= 0) { this.report(); return; }

    const sampleBytes = availFrames * bytesPerFrame;
    const view = new DataView(stream.buffer, stream.byteOffset + this.processedOffset, sampleBytes);
    const audio = this.ctx.createBuffer(header.channels, availFrames, header.sampleRate);
    const framesPerChannel = Math.floor(availFrames / header.channels);
    for (let ch = 0; ch < header.channels; ch++) {
      const data = audio.getChannelData(ch);
      for (let i = 0; i < framesPerChannel; i++) {
        const v = view.getInt16((i * header.channels + ch) * (header.bits / 8), true);
        data[i] = v / 32768;
      }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.ctx.destination);
    src.start(this.nextTime);
    this.nextTime += framesPerChannel / header.sampleRate;
    this.processedOffset += sampleBytes;
    this.report();
  }

  /** 取完整字节（pcm 自动封 WAV 头），供结果播放器/下载复用 */
  getBlob(mime: string): Blob {
    let bytes = concatBytes(this.byteParts);
    if (this.format === 'pcm') bytes = pcmToWav(bytes, this.header?.sampleRate || this.fallbackSampleRate);
    return new Blob([bytes], { type: mime });
  }

  /** 已调度的音频继续自然播完；仅释放调试信息与上下文由 stop 处理 */
  stop() {
    this._active = false;
    if (this.ctx) {
      try { void this.ctx.close(); } catch { /* 已关闭 */ }
      this.ctx = null;
    }
    this.report(true);
  }

  info(): StreamPlayerInfo {
    const header = this.header;
    const sr = header?.sampleRate || this.fallbackSampleRate;
    const total = this.byteParts.reduce((n, p) => n + p.length, 0);
    const played = this.ctx ? Math.max(0, this.ctx.currentTime - 0.08) : 0;
    return {
      active: this._active,
      suspended: this._suspended,
      playedSeconds: Math.round(played * 10) / 10,
      bufferedSeconds: Math.round(((total - (header?.dataStart ?? 0)) / 2 / sr) * 10) / 10,
    };
  }

  // 暴露到 window 便于调试/自测，不影响功能
  private report(clear = false) {
    (window as unknown as Record<string, unknown>).__alittsStreamInfo = clear ? null : this.info();
  }
}

function parseWavHeader(b: Uint8Array): { sampleRate: number; channels: number; bits: number; dataStart: number } | null {
  if (b.length < 44) return null;
  if (String.fromCharCode(...b.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...b.slice(8, 12)) !== 'WAVE') return null;
  const v = new DataView(b.buffer, b.byteOffset, b.length);
  let off = 12;
  let channels = 0, sampleRate = 0, bits = 0, dataStart = -1;
  while (off + 8 <= b.length) {
    const id = String.fromCharCode(...b.slice(off, off + 4));
    const size = v.getUint32(off + 4, true);
    if (id === 'fmt ') {
      const audioFormat = v.getUint16(off + 8, true);
      if (audioFormat !== 1) return null; // 仅支持 PCM
      channels = v.getUint16(off + 10, true);
      sampleRate = v.getUint32(off + 12, true);
      bits = v.getUint16(off + 22, true);
    } else if (id === 'data') {
      dataStart = off + 8;
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!sampleRate || !channels || !bits || dataStart < 0) return null;
  return { sampleRate, channels, bits, dataStart };
}
