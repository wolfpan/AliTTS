// 快捷模式场景模板（音色 ID 均来自百炼官方音色列表文档，注意音色不能跨模型混用）
export interface QuickVoice {
  id: string;
  name: string;
  gender: '女' | '男';
  style: string;
}

export interface QuickTemplate {
  id: string;
  icon: string;
  name: string;
  desc: string;
  model: string;
  params: {
    format: 'mp3' | 'wav';
    sample_rate: number;
    rate: number;
    pitch: number;
    volume: number;
  };
  instruction?: string;
  languageHints?: string[];
  languageType?: string; // 仅 qwen3-tts 使用
  voices: QuickVoice[];
  sampleText: string;
}

export const TEMPLATES: QuickTemplate[] = [
  {
    id: 'audiobook',
    icon: '📖',
    name: '有声书旁白',
    desc: '沉稳叙事、娓娓道来的读书感',
    model: 'qwen-audio-3.1-tts-flash',
    params: { format: 'mp3', sample_rate: 24000, rate: 0.95, pitch: 1.0, volume: 50 },
    voices: [
      { id: 'longyuan_v3.1', name: '龙媛', gender: '女', style: '温暖治愈，适合言情/散文' },
      { id: 'longsanshu_v3.1', name: '龙三叔', gender: '男', style: '沉稳质感，适合历史/悬疑' },
      { id: 'xunanchuan_v3.1', name: '许南川', gender: '男', style: '磁性讲故事，节奏感强' },
      { id: 'longmiao_v3.1', name: '龙妙', gender: '女', style: '抑扬顿挫，叙事灵动' },
    ],
    sampleText: '夜色像一块缓缓落下的绒布，盖住了整座小城。巷口的灯还亮着，仿佛在等一个晚归的人。',
  },
  {
    id: 'news',
    icon: '📰',
    name: '新闻播报',
    desc: '字正腔圆、干净利落的播报腔',
    model: 'qwen-audio-3.1-tts-flash',
    params: { format: 'mp3', sample_rate: 24000, rate: 1.05, pitch: 1.0, volume: 55 },
    voices: [
      { id: 'loongstella_v3.1', name: 'loongstella', gender: '女', style: '飒爽利落，时政新闻' },
      { id: 'longxiaoxia_v3.1', name: '龙小夏', gender: '女', style: '沉稳权威，深度报道' },
      { id: 'longanfengyue_v3.1', name: '龙安风悦', gender: '女', style: '自然亲切，民生资讯' },
      { id: 'longanli_v3.1', name: '龙安莉', gender: '女', style: '利落从容，简讯快报' },
    ],
    sampleText: '各位听众早上好，今天是十月二十三日，星期五。一起来关注今天的头条要闻。',
  },
  {
    id: 'shortvideo',
    icon: '🎬',
    name: '短视频口播',
    desc: '节奏快、有网感的带货与口播风',
    model: 'qwen-audio-3.1-tts-flash',
    params: { format: 'mp3', sample_rate: 24000, rate: 1.1, pitch: 1.0, volume: 60 },
    voices: [
      { id: 'longanchong_v3.1', name: '龙安冲', gender: '男', style: '激情推销，直播带货' },
      { id: 'yunhuanhuan_v3.1', name: '云欢欢', gender: '女', style: '高亢热情，活动造势' },
      { id: 'xuxiaoqiao_v3.1', name: '徐小俏', gender: '女', style: '自然俏皮，种草分享' },
      { id: 'anmingyuan_v3.1', name: '安明远', gender: '男', style: '清亮自然，口播讲解' },
    ],
    sampleText: '家人们，三秒钟听我说完！这款遮瑕盘今天直播间直接打五折，拍一发二，库存不多了，赶紧上车！',
  },
  {
    id: 'kids',
    icon: '🧒',
    name: '儿童故事',
    desc: '童声童趣、适合讲故事的声线',
    model: 'qwen-audio-3.1-tts-flash',
    params: { format: 'mp3', sample_rate: 24000, rate: 0.95, pitch: 1.0, volume: 50 },
    instruction: '用讲睡前故事的语气，温柔亲切一些',
    voices: [
      { id: 'longniuniu_v3.1', name: '龙牛牛', gender: '男', style: '阳光男童，冒险故事' },
      { id: 'longpaopao_v3.1', name: '龙泡泡', gender: '女', style: '软糯泡泡音，低幼绘本' },
      { id: 'longling_v3.1', name: '龙铃', gender: '女', style: '稚气童声，童话感强' },
      { id: 'longshanshan_v3.1', name: '龙闪闪', gender: '男', style: '戏剧化童声，角色扮演' },
    ],
    sampleText: '小兔子第一次自己过马路，它记得妈妈说的：红灯停，绿灯行，左看看，右看看，再前行。',
  },
  {
    id: 'service',
    icon: '🎧',
    name: '客服话术',
    desc: '温和专业、清晰耐心的服务腔',
    model: 'qwen-audio-3.1-tts-flash',
    params: { format: 'mp3', sample_rate: 24000, rate: 1.0, pitch: 1.0, volume: 50 },
    voices: [
      { id: 'longyingtao_v3.1', name: '龙应桃', gender: '女', style: '温柔淡定，售后安抚' },
      { id: 'xieshurou_v3.1', name: '谢舒柔', gender: '女', style: '柔和知性，业务咨询' },
      { id: 'anxiaolan_v3.1', name: '安小岚', gender: '女', style: '清甜纯净，语音助手' },
      { id: 'longanwen_v3.1', name: '龙安温', gender: '女', style: '优雅知性，通知播报' },
    ],
    sampleText: '您好，欢迎联系客服中心。您反馈的问题我们已收到，会在二十四小时内给您答复，感谢您的耐心等待。',
  },
  {
    id: 'poem',
    icon: '🏮',
    name: '诗词朗诵',
    desc: '深情典雅、抑扬顿挫的朗诵风',
    model: 'qwen-audio-3.1-tts-flash',
    params: { format: 'mp3', sample_rate: 24000, rate: 0.85, pitch: 1.0, volume: 50 },
    instruction: '用深情朗诵的语气，注意抑扬顿挫和停顿',
    voices: [
      { id: 'libai_v3.1', name: '李白', gender: '男', style: '古代诗仙，古风浓郁' },
      { id: 'xuyanchu_v3.1', name: '许言初', gender: '女', style: '沉稳磁性，现代诗' },
      { id: 'wenhuaizhi_v3.1', name: '闻怀之', gender: '女', style: '稳重成熟，经典散文' },
      { id: 'xiaoxingzhi_v3.1', name: '萧行之', gender: '女', style: '端庄贵气，辞赋' },
    ],
    sampleText: '君不见黄河之水天上来，奔流到海不复回。君不见高堂明镜悲白发，朝如青丝暮成雪。',
  },
  {
    id: 'ad',
    icon: '📣',
    name: '广告配音',
    desc: '有说服力的品牌广告腔（CosyVoice）',
    model: 'cosyvoice-v3-flash',
    params: { format: 'mp3', sample_rate: 24000, rate: 1.05, pitch: 1.0, volume: 55 },
    voices: [
      { id: 'longyingxiao_v3', name: '龙映晓', gender: '女', style: '清甜电销，转化感强' },
      { id: 'longxiaochun_v3', name: '龙晓春', gender: '女', style: '知性积极，品牌调性' },
      { id: 'longtian_v3', name: '龙天', gender: '男', style: '磁性理智，高端大气' },
      { id: 'longanran_v3', name: '龙安然', gender: '女', style: '活泼质感，直播广告' },
    ],
    sampleText: '品质，源自二十六道工序的坚持。全新一代，为懂生活的你而来。',
  },
  {
    id: 'english',
    icon: '🌏',
    name: '出海多语种',
    desc: '英式/美式英文配音（qwen-audio）',
    model: 'qwen-audio-3.1-tts-flash',
    params: { format: 'mp3', sample_rate: 24000, rate: 1.0, pitch: 1.0, volume: 50 },
    languageHints: ['en'],
    voices: [
      { id: 'Emily_v3.1', name: 'Emily', gender: '女', style: '英式优雅，纪录片解说' },
      { id: 'David_v3.1', name: 'David', gender: '男', style: '美式沉稳，企业宣传' },
      { id: 'Luna_v3.1', name: 'Luna', gender: '女', style: '英式清新，产品介绍' },
      { id: 'Brian_v3.1', name: 'Brian', gender: '男', style: '美式亲和，课程旁白' },
    ],
    sampleText: 'Welcome to the next chapter of innovation, where technology meets humanity, and ideas become reality.',
  },
  {
    id: 'dialect',
    icon: '🌶️',
    name: '方言整活',
    desc: '北京话/上海话/四川话（qwen3-tts，600 字内）',
    model: 'qwen3-tts-flash',
    params: { format: 'mp3', sample_rate: 24000, rate: 1.0, pitch: 1.0, volume: 50 },
    languageType: 'Chinese',
    voices: [
      { id: 'Dylan', name: 'Dylan', gender: '男', style: '北京话，儿化味儿' },
      { id: 'Jada', name: 'Jada', gender: '女', style: '上海话，软糯' },
      { id: 'Sunny', name: 'Sunny', gender: '男', style: '四川话，安逸' },
      { id: 'Cherry', name: 'Cherry', gender: '女', style: '通用女声，中英双语' },
    ],
    sampleText: '今儿个天儿不错，咱们出去遛个弯儿，顺便买俩冰棍儿，您说好不好？',
  },
];
