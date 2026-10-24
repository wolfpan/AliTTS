// 指令（instruction）与内联标签预置
export interface ChipGroup {
  title: string;
  chips: string[];
}

// 自然语言指令拼装（qwen-audio 全音色 / cosyvoice 复刻设计音色）
export const INSTRUCTION_CHIPS: ChipGroup[] = [
  {
    title: '情绪',
    chips: ['用温柔的语气', '用激动的语气', '用严肃的语气', '用欢快的语气', '用悲伤的语气', '用平静的播报腔'],
  },
  {
    title: '方言',
    chips: ['用广东话说', '用四川话说', '用上海话说', '用东北话说', '用陕西方言说'],
  },
  {
    title: '角色',
    chips: ['像游戏 NPC 一样', '像电台主持人', '像在哄小朋友睡觉', '像纪录片旁白'],
  },
  {
    title: '语速/停顿',
    chips: ['语速稍慢一点', '语速快一点', '在每个逗号处停顿'],
  },
];

// Qwen-Audio 系列支持的内联情感/语气标签（直接写入文本）
export const INLINE_TAGS: Array<{ tag: string; label: string }> = [
  { tag: '[excited]', label: '兴奋' },
  { tag: '[sad]', label: '悲伤' },
  { tag: '[laughing]', label: '笑' },
  { tag: '[sighing]', label: '叹气' },
];

// SSML 快捷片段（仅 qwen-audio / cosyvoice 支持；标签集以官方 SSML 指南为准）
export const SSML_SNIPPETS: Array<{ label: string; snippet: string; hint: string }> = [
  { label: '停顿 500ms', snippet: '<break time="500ms"/>', hint: 'break 总停顿上限 10 秒' },
  { label: '停顿 1s', snippet: '<break time="1s"/>', hint: 'time 支持 1-10 秒或 50-10000 毫秒' },
  { label: '替换读法', snippet: '<sub alias="网络协议标准">W3C</sub>', hint: 'alias 为实际朗读内容' },
  { label: '拼音标注', snippet: '<phoneme alphabet="py" ph="dian3 dang4 hang2">典当行</phoneme>', hint: '拼音个数须与汉字数一致，声调 1-5' },
  { label: '数字读法', snippet: '<say-as interpret-as="telephone">12345</say-as>', hint: 'interpret-as: cardinal/digits/telephone/date 等' },
  { label: 'LaTeX 公式', snippet: '$\\frac{1}{2}$', hint: '仅 CosyVoice 支持中文公式朗读' },
];
