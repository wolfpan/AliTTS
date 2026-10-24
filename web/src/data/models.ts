// 模型能力矩阵（驱动高级模式控件启停）
export type InstructionMode = 'free' | 'fixed' | 'none';

export interface ModelMeta {
  id: string;
  label: string;
  vendor: 'dashscope';
  endpoint: 'speech' | 'multimodal';
  supportsProsody: boolean; // rate / pitch / volume
  instructionMode: InstructionMode;
  supportsSsml: boolean;
  supportsSeed: boolean;
  supportsHotfix: boolean;
  supportsTimestamps: boolean;
  supportsLanguageHints: boolean; // language_hints 参数
  supportsLanguageType: boolean; // qwen3-tts 的 language_type
  systemVoices: boolean;
  maxChars: number; // 单次请求上限，0 = 无硬限
  outputFixed?: { format: 'wav'; sampleRate: number };
  note?: string;
}

const qwenAudio = (id: string, label: string): ModelMeta => ({
  id, label, vendor: 'dashscope', endpoint: 'speech',
  supportsProsody: true, instructionMode: 'free', supportsSsml: true,
  supportsSeed: true, supportsHotfix: true, supportsTimestamps: true,
  supportsLanguageHints: true, supportsLanguageType: false, systemVoices: true, maxChars: 0,
});

const cosyvoice = (id: string, label: string, instructionMode: InstructionMode, hotfix: boolean, note?: string): ModelMeta => ({
  id, label, vendor: 'dashscope', endpoint: 'speech',
  supportsProsody: true, instructionMode, supportsSsml: true,
  supportsSeed: true, supportsHotfix: hotfix, supportsTimestamps: true,
  supportsLanguageHints: true, supportsLanguageType: false, systemVoices: true, maxChars: 0,
  ...(note ? { note } : {}),
});

export const MODELS: ModelMeta[] = [
  qwenAudio('qwen-audio-3.1-tts-plus', 'Qwen-Audio 3.1 TTS Plus（旗舰）'),
  qwenAudio('qwen-audio-3.1-tts-flash', 'Qwen-Audio 3.1 TTS Flash（性价比）'),
  qwenAudio('qwen-audio-3.0-tts-plus', 'Qwen-Audio 3.0 TTS Plus'),
  qwenAudio('qwen-audio-3.0-tts-flash', 'Qwen-Audio 3.0 TTS Flash'),
  {
    ...cosyvoice('cosyvoice-v3.5-plus', 'CosyVoice 3.5 Plus', 'free', true),
    systemVoices: false,
    note: '无系统音色，仅支持复刻/设计音色（M3 交付声音复刻后可用）',
  },
  {
    ...cosyvoice('cosyvoice-v3.5-flash', 'CosyVoice 3.5 Flash', 'free', true),
    systemVoices: false,
    note: '无系统音色，仅支持复刻/设计音色（M3 交付声音复刻后可用）',
  },
  cosyvoice('cosyvoice-v3-plus', 'CosyVoice 3 Plus', 'fixed', true, '系统音色仅 2 个；指令需按音色列表固定格式'),
  cosyvoice('cosyvoice-v3-flash', 'CosyVoice 3 Flash（音色最全）', 'fixed', true, '系统音色指令需按音色列表固定格式；复刻/设计音色支持自然语言'),
  cosyvoice('cosyvoice-v2', 'CosyVoice 2（经典）', 'none', false, '不支持指令与纠音'),
  {
    id: 'qwen3-tts-flash', label: 'Qwen3-TTS Flash（方言）', vendor: 'dashscope', endpoint: 'multimodal',
    supportsProsody: false, instructionMode: 'none', supportsSsml: false,
    supportsSeed: false, supportsHotfix: false, supportsTimestamps: false,
    supportsLanguageHints: false, supportsLanguageType: true, systemVoices: true,
    maxChars: 600, outputFixed: { format: 'wav', sampleRate: 24000 },
  },
];

export const LANGUAGE_HINTS = [
  'zh', 'en', 'fr', 'de', 'ja', 'ko', 'ru', 'pt', 'th', 'id', 'vi', 'es', 'it', 'ms', 'fil', 'ar',
];

export const LANGUAGE_TYPE_OPTIONS = [
  { label: '自动识别', value: 'Auto' },
  { label: '中文', value: 'Chinese' },
  { label: '英语', value: 'English' },
  { label: '德语', value: 'German' },
  { label: '意大利语', value: 'Italian' },
  { label: '葡萄牙语', value: 'Portuguese' },
  { label: '西班牙语', value: 'Spanish' },
  { label: '日语', value: 'Japanese' },
  { label: '韩语', value: 'Korean' },
  { label: '法语', value: 'French' },
  { label: '俄语', value: 'Russian' },
];

export const SAMPLE_RATES = [8000, 12000, 16000, 22050, 24000, 44100, 48000];
export const OPUS_SAMPLE_RATES = [8000, 12000, 16000, 24000, 48000];

export function getModel(id: string): ModelMeta | undefined {
  return MODELS.find((m) => m.id === id);
}
