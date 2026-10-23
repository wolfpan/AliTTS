// WAV 解析 / 重建 / 多段合并（多段合成的正确拼接：剥离各段文件头，统一 PCM 后重建单一文件头）

function parseWav(buf) {
  if (buf.length < 44) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let fmt = null;
  let dataStart = -1;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      dataStart = off + 8;
      dataLen = Math.min(size, buf.length - dataStart);
      break;
    }
    off += 8 + size + (size % 2);
    if (size === 0 && id !== 'fmt ' && !fmt) break; // 防御：异常 chunk
  }
  if (!fmt || dataStart < 0 || fmt.audioFormat !== 1) return null;
  return { ...fmt, dataStart, dataLen };
}

function buildWav(pcm, { sampleRate, channels, bitsPerSample }) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * 合并多段合成产物。
 * - wav：解析各段头，参数一致则剥头拼 PCM + 段间静音 + 重建单一文件头；不一致或解析失败降级为直接拼接。
 * - pcm：按单声道 16bit 直接拼接（DashScope pcm 输出口径），可插静音。
 * - 其他格式（mp3 帧流可容忍拼接 / opus 降级）：直接拼接。
 */
function mergeSegments(buffers, format, silenceMs, pcmSampleRate = 24000) {
  if (format === 'wav') {
    const parsed = buffers.map(parseWav);
    if (parsed.every(Boolean)) {
      const ref = parsed[0];
      const sameFmt = parsed.every((p) =>
        p.sampleRate === ref.sampleRate && p.channels === ref.channels && p.bitsPerSample === ref.bitsPerSample);
      if (sameFmt) {
        const bytesPerFrame = (ref.bitsPerSample / 8) * ref.channels;
        const silenceBytes = Math.round((silenceMs / 1000) * ref.sampleRate) * bytesPerFrame;
        const parts = [];
        buffers.forEach((buf, i) => {
          if (i > 0 && silenceBytes > 0) parts.push(Buffer.alloc(silenceBytes));
          const p = parsed[i];
          parts.push(buf.subarray(p.dataStart, p.dataStart + p.dataLen));
        });
        return buildWav(Buffer.concat(parts), ref);
      }
    }
    return Buffer.concat(buffers);
  }
  if (format === 'pcm' && silenceMs > 0) {
    const silenceBytes = Math.round((silenceMs / 1000) * pcmSampleRate) * 2; // 16bit 单声道
    const parts = [];
    buffers.forEach((buf, i) => {
      if (i > 0) parts.push(Buffer.alloc(silenceBytes));
      parts.push(buf);
    });
    return Buffer.concat(parts);
  }
  return Buffer.concat(buffers);
}

module.exports = { parseWav, buildWav, mergeSegments };
