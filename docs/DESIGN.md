# AliTTS 语音合成工作台 — 设计方案 v1.1

> 基于 Vue 3 + Node.js 的**本机/内网**语音合成 Web 应用。接入阿里百炼 DashScope 单通道，
> 覆盖语音合成（快捷/高级双模式）、声音复刻、声音设计、声音库与历史管理。
> 状态：**待最终确认开工**。
>
> v1.2 变更（相对 v1.1，2026-10-24）：
> 1. **彻底移除 OpenRouter 备份通道**（实测该平台无任何阿里系 TTS 模型、音频输出模型仅 OpenAI gpt-audio 与 Google Lyria 音乐模型、音色体系与复刻音色完全不互通，"自动故障转移"前提不成立，改为不做备份通道）；
> 2. M5 重新定义为**局域网选项完善**：访问令牌保护、端口设置、局域网地址展示、重启生效提示。
>
> v1.1 变更（相对 v1）：
> 1. API Key 改为**首次打开引导输入**（向导式），后续可在设置中修改；
> 2. 部署范围明确为**仅本机/内网**，不对外网提供服务；
> 3. 前端升级为 **Vue 3 + Vite + TypeScript + Naive UI**；
> 4. ~~OpenRouter 明确为冗余备份通道，支持故障转移~~（**v1.2 已废除**，见上）；
> 5. 界面支持**深色/浅色/跟随系统**三态切换。

---

## 1. 目标与范围

### 1.1 核心功能
| 模块 | 说明 |
|---|---|
| 首次运行向导 | 检测未配置 → 引导输入 DashScope Key → 连通性测试 → 偏好设置 → 进入主界面 |
| 语音合成 | 快捷模式（场景模板三步出声）+ 高级模式（全参数、全音色、指令/SSML/seed） |
| 声音复刻 | 上传或浏览器录音 10–20s 样本 → 创建复刻音色 → 状态轮询 → 试音 → 入库使用 |
| 声音设计 | 文字描述音色（组合生成器）→ 立即返回试听预览 → 满意入库 |
| 声音库 | 系统音色目录（200+，官方文档整理）+ 自定义音色，统一检索/试听/管理 |
| 历史 | 参数快照 + 音频文件，回放/下载/载入参数/A-B 对比 |
| 设置 | Key 修改、域名/模型默认值、部署范围（仅本机/内网）、故障转移、主题 |

### 1.2 非目标（v1 不做）
- 对公网提供服务（无域名/HTTPS/多用户/注册鉴权）
- 实时流式对话 / WebSocket 双工合成（接口层保留扩展位）
- 移动端深度适配（响应式到平板宽度即可）

---

## 2. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 后端 | Node.js ≥18（本机 v24.16）+ Express | API 代理 + 静态托管，依赖极简 |
| 前端 | **Vue 3 + `<script setup>` + TypeScript + Vite + Pinia** | 六个视图、高级模式大量联动表单与能力开关，响应式框架显著降低维护成本；TS 保障能力矩阵/参数类型安全 |
| UI 组件库 | **Naive UI** | 深色/浅色主题原生切换（n-config-provider），组件轻、样式易定制，适合工具型应用 |
| 音频 | 后端 SSE 转发 base64 分片；前端 Web Audio / Blob 播放 | wav/pcm 边合成边播，mp3/opus 聚合播放 |
| 存储 | JSON 文件 + 音频目录（无数据库） | `data/`：settings.json、history.json、audio/ |
| 密钥 | 只存服务端 `data/settings.json`，浏览器仅见掩码 | 安全 |

依赖：后端 `express`；前端 `vue / naive-ui / pinia`（devDeps：vite、typescript、vue-tsc、concurrently）。

**开发与运行**
- 开发：`npm run dev` = concurrently（Express :3210 + Vite :5173，Vite proxy `/api → 3210`）
- 产物：`npm run build`（vue-tsc 校验 + vite 构建到 `dist/`）→ `npm start`（Express 托管 dist，**单命令即完整应用**）
- 内网其他设备访问时使用 Express 托管的构建产物（不依赖 Vite）

---

## 3. 部署与安全（仅本机/内网）

- 默认监听 `127.0.0.1:3210`（仅本机）；设置中一键切换「允许局域网访问」→ 监听 `0.0.0.0:3210`。
- 「允许局域网访问」时可选择设置**访问口令**（简单 Bearer token）：开启后浏览器首次访问输入一次，存 localStorage，所有 `/api/*` 携带校验；静态页面不拦截（无 Key 数据）。
- 关闭跨域：仅同源提供服务；不注册、不多用户、无公网暴露。
- Key 永不出服务端；`data/` 目录整体 gitignore。

---

## 4. 上游 API 事实清单（实现依据）

### 4.1 阿里百炼 DashScope（主通道）

**鉴权**：`Authorization: Bearer <DASHSCOPE_API_KEY>`；流式加 `X-DashScope-SSE: enable`。
**域名**：默认公共 `https://dashscope.aliyuncs.com`；业务空间专属域名 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` 设置于向导/设置中可填，公共域名失败自动回退尝试。

#### 4.1.1 语音合成 — SpeechSynthesizer 端点
`POST {base}/api/v1/services/audio/tts/SpeechSynthesizer`

适用模型：`qwen-audio-3.1-tts-plus / 3.1-tts-flash / 3.0-tts-plus / 3.0-tts-flash`、
`cosyvoice-v3.5-plus / v3.5-flash / v3-plus / v3-flash / v2`。

请求参数（均在 `input` 内，除 model）：
| 参数 | 取值 | 备注 |
|---|---|---|
| model | 见上 | |
| text | 支持 SSML（enable_ssml=true）与 LaTeX | |
| voice | 系统音色 / 复刻音色ID / 设计音色ID | |
| format | mp3(默认)/pcm/wav/opus | |
| sample_rate | 8000/12000/16000/22050(默认)/24000/44100/48000 | opus 仅 8000/12000/16000/24000/48000 |
| volume | 0–100，默认 50 | |
| rate（语速） | 0.5–2.0，默认 1.0 | |
| pitch（音调） | 0.5–2.0，默认 1.0 | |
| bit_rate | 6–510 kbps，仅 opus | |
| enable_ssml | bool | |
| word_timestamp_enabled | bool，仅流式 | 句/字时间戳 |
| seed | 0–65535 | 同 seed 可复现 |
| language_hints | 数组（建议单个）：zh/en/fr/de/ja/ko/ru/pt/th/id/vi/es/it/ms/fil/ar | |
| instruction | 自然语言：方言/情感/角色/语速 | 见能力矩阵 |
| hot_fix | pronunciation（拼音纠音）/ replace（文本替换） | v2 不支持 |

响应：`output.audio.data`（流式 base64 分片，按序拼接）/ `output.audio.url`（完整音频，24h 有效）/ `usage.characters`。后端收到即落盘。

#### 4.1.2 语音合成 — Qwen3-TTS（multimodal 端点）
`POST {base}/api/v1/services/aigc/multimodal-generation/generation`

- 模型：`qwen3-tts-flash`（非实时）
- 参数：`input.text`（**≤600 字符**）、`input.voice`（Cherry/Serena/Ethan/Chelsie/Jada/Sunny/Uncle_Fu/Dylan…）、`input.language_type`（Auto + 10 语种）
- 无 rate/pitch/volume/instruction/复刻/设计；输出 24kHz 16bit WAV；URL 24h 有效。

#### 4.1.3 声音复刻 / 声音设计 — customization 端点
`POST {base}/api/v1/services/audio/tts/customization`，`model` 固定 `voice-enrollment`。

**复刻 create_voice**：
- `target_model`（必选；**合成时模型必须与之一致**）、`audio`（公网 URL 或 `data:audio/wav;base64,...`）、`prefix`（≤10 位字母数字）、`language_hints`（单元素数组，默认 ["zh"]）、`max_prompt_audio_length`（3.0–30.0s，默认 10）、`enable_preprocess`、`enable_volume_normalization`
- 样本建议 10–20s；返回 `voice_id = {target_model}-{prefix}-{uid}`
- 状态：`DEPLOYING` → `OK` / `UNDEPLOYED`；另有 list_voice（prefix/page_index/page_size）、query_voice、update_voice、delete_voice

**设计 create_voice**：
- `target_model`、`voice_prompt`（中/英 ≤500 字）、`preview_text`（15–200 字）、`prefix`、`language_hints`、`parameters.sample_rate`（16000/24000/48000）、`parameters.response_format`（pcm/wav/mp3）
- 返回 `voice_id = {target_model}-vd-{prefix}-{uid}` + `preview_audio.data`（base64 试听）

**模型能力矩阵**（UI 按此做能力开关）：
| 模型 | 系统音色 | 复刻 | 设计 | instruction | rate/pitch/volume | SSML | seed |
|---|---|---|---|---|---|---|---|
| qwen-audio-3.1/3.0-tts-plus/flash | ✓ | ✓ | ✓ | ✓ 全部音色·自然语言 | ✓ | ✓ | ✓ |
| cosyvoice-v3.5-plus/flash | ✗ | ✓ | ✓ | ✓ 仅复刻/设计音色·≤100字 | ✓ | ✓ | ✓ |
| cosyvoice-v3-plus | ✓（2 个） | ✓ | ✓ | 仅系统音色·固定格式 | ✓ | ✓ | ✓ |
| cosyvoice-v3-flash | ✓（100+，含方言） | ✓ | ✓ | 系统音色固定格式；复刻/设计自然语言 | ✓ | ✓ | ✓ |
| cosyvoice-v2 | ✓（旧目录） | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| qwen3-tts-flash | ✓（方言/9 语种） | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

#### 4.1.4 MiniMax（可选加成）
`dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`，`MiniMax/speech-2.8-hd` 等，仅复刻。v1 列为可选，不阻塞。

### 4.2 OpenRouter 备份通道（已于 v1.2 移除）
2026-10-24 实测 OpenRouter 平台（468 个模型）后确认：
- **无任何阿里系 TTS 模型**（Qwen 系全部仅文本输出，无 cosyvoice / qwen-tts 类 slug）；
- 支持音频输出的仅 4 个模型：OpenAI gpt-audio / gpt-audio-mini（固定音色体系）与 Google Lyria（音乐生成），与 DashScope 音色/参数体系完全不互通；
- 复刻与设计音色存储于百炼 voice-enrollment，无法跨供应商使用。
结论："自动故障转移"的前提（备份通道能以近似效果完成同一请求）不成立，且静默切换音色对 TTS 工具有害。**彻底移除 OpenRouter**（配置、向导、设置页、文档），不引入其他自动备份通道。

### 4.3 自定义 OpenAI 兼容通道（预留）
任意 `base_url` + 标准 `POST {base_url}/v1/audio/speech`（model/input/voice/response_format/speed），用于将来接入其他聚合商/自建网关。设置页按需添加，v1 仅做参数透传级支持。

---

## 5. 总体架构

```
┌──────────────────── 浏览器（Vue 3 SPA） ────────────────────────┐
│ 首次运行向导 │ 合成(快捷/高级) │ 复刻 │ 设计 │ 声音库 │ 历史 │ 设置 │
└──────────────▲───────────────────────────────────▲─────────────┘
               │ REST + SSE（JSON/base64）           │ 静态资源(dist)
┌──────────────┴────────── Node/Express :3210 ──────┴─────────────┐
│ 首次配置检测 · 访问口令校验(可选) · routes /api/*                  │
│ providers: dashscope(3端点)                              │
│ 故障转移编排 · 长文本分段 · 音频落盘 · 音色目录 · 设置/历史存储     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS（密钥仅在此层）
                   DashScope（单通道）
```

要点：
1. `GET /api/settings` 返回 `{configured: false}` → 前端路由强制进入 `/setup` 向导。
2. 后端将上游 SSE 归一为自有事件协议：`meta → audio(分片) → word(时间戳) → done → error`。
3. 长文本后端自动分段顺序合成、拼接；产物落盘 `data/audio/`，历史引用本地文件。
4. 开发期 Vite:5173 代理 /api；日常使用单命令 `npm start` 访问 :3210。

---

## 6. 功能详细设计

### 6.0 首次运行向导（Onboarding）
未配置时强制进入，4 步：
1. **欢迎页**：应用简介 + 部署说明（本机/内网）。
2. **Key 录入**：DashScope API Key（必填，粘贴框 + 显示/隐藏 + 掩码）；DashScope 域名模式（默认公共域名；可选填业务空间 WorkspaceId）。
3. **连通性测试**：DashScope 连通测试（list_voice 零成本调用），实时显示 ✓/✗ 与错误摘要，失败可返回修改。
4. **偏好**：默认模型、默认 format、主题（浅色/深色/跟随系统）→ 完成进入主界面。
向导内容与设置页同源，随时可改。

### 6.1 合成 — 快捷模式
三步出声：
1. **选场景模板**（内置 8+）：有声书旁白 / 新闻播报 / 广告配音 / 短视频口播 / 儿童故事 / 客服话术 / 诗词朗诵 / 出海多语种。模板 = JSON 预设：推荐模型 + 3–6 个推荐音色（标签+一句话定位）+ rate/pitch/volume + 可选 instruction + 默认 format/sample_rate。支持用户自定义模板（从高级模式“存为模板”）。
2. **选音色**：卡片单选，内置 demo 短句试听。
3. **输入文本 → 生成**：合成/播放/下载/重试；显示所用参数，可一键转高级模式微调。

### 6.2 合成 — 高级模式
**A. 模型与通道**：模型下拉（阿里百炼各系列）；按能力矩阵自动启停控件并给出提示（qwen3-tts 无语速条、v3.5 无系统音色等）。

**B. 音色中心**：三个来源 Tab（系统音色 / 我的复刻 / 我的设计）。
- 系统音色目录 `web/src/data/voices-catalog.json`（约 200+ 条）：`{id, 名称, 性别, 语言, 风格, 场景tags, 适用模型[], ssml, 时间戳}`；搜索 + 性别/语言/风格/场景筛选；按当前模型自动过滤。
- 自定义音色：后端对当前 target_model 聚合 list_voice（本地缓存 + 手动刷新）。
- 任意音色可试听 8 字短句；复刻/设计音色仅当 `当前模型 == target_model` 可选，否则置灰显示原因。

**C. 文本区**：大文本框 + 字数统计 + 分段预览（超阈值提示将自动分段 N 段）；SSML 助手（enable_ssml 后出现：停顿/多音字/强调等 snippet 插入 + 轻量标签校验）；指令区（情绪/方言/角色 chips 拼装 + 手改；固定格式模型转预置指令下拉；100 字计数）。

**D. 参数区（全量）**：rate 0.5–2.0、pitch 0.5–2.0、volume 0–100 滑条；format + sample_rate 联动（opus 出 bit_rate）；seed 0–65535 + 随机 + 锁定；language_hints 单选；hot_fix 纠音表格（词→拼音、原文→替换）；词级时间戳开关；分段策略（自动按句切分，段长上限默认 600 / 关闭）。

**E. 结果区**：波形播放器（canvas）+ 下载（pcm 由前端封 WAV 头）；wav/pcm 边收边播（AudioContext 队列），mp3/opus 聚合后播放；**A/B 对比**（近两次并排播放 + 参数 diff 高亮，“锁定参数仅改一项”）；“用备份通道重试”按钮（故障转移手动版）；一键“存为模板”。

### 6.3 声音复刻（三步向导）
1. **样本**：上传（wav/mp3/m4a）或**浏览器录音**（MediaRecorder + 15–20s 朗读文案 + 实时时长表）；前端检测 3–30s（推荐 10–20s），base64 上传；可选预处理/音量归一；`max_prompt_audio_length` 滑条 3–30s。
2. **配置**：target_model（醒目提示绑定关系）、prefix（≤10 字母数字）、language_hints。
3. **创建与管理**：提交 → 轮询 DEPLOYING→OK/UNDEPLOYED（未通过给重传引导）→ OK 自动试音 → 入库；支持换音频 / 删除 / 本地别名备注。

### 6.4 声音设计
- **voice_prompt 组合生成器**：性别 × 年龄 × 质感 × 风格 × 场景 chips 自动拼句，可手改（≤500 字计数）；8 个精选 prompt 模板。
- preview_text（15–200 字，含示例文案）；target_model、prefix、预览参数（sample_rate/format）。
- 创建即返 preview_audio 直接试听；「重新生成」（新 voice_id）与「入库使用」并存；管理与复刻一致。

### 6.5 声音库
系统（只读）+ 复刻 + 设计统一检索（来源/模型/语言/性别/状态筛选）；试听（短句/自选文本）；自定义音色管理（更新/删除/别名）；详情抽屉（voice_id、target_model、创建时间、状态、设计 prompt）。

### 6.6 历史
时间、provider/model、voice、文本、参数快照、音频文件、字符数；回放/下载/**载入参数**/删除；筛选与清理策略（天数/条数/清空）。

### 6.7 设置
- **API Key**：DashScope 修改（掩码回显 + 连通测试）；DashScope 域名模式与 WorkspaceId；地域（北京/新加坡）。
- **部署**：仅本机（默认）/ 允许局域网访问（+ 可选访问口令），切换后提示重启生效。
- **故障转移**：自动故障转移开关 + 触发条件说明。
- **默认值**：默认模型、format/sample_rate、分段长度、历史保留策略。
- **外观**：浅色/深色/跟随系统三态（Naive UI darkTheme + prefers-color-scheme 监听，持久化，跟随系统时实时响应系统切换）。

---

## 7. 后端接口设计（本机 /api）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/settings` | 返回 `{configured, maskedKeys, preferences…}`；未配置则前端进向导 |
| PUT | `/api/settings` | 保存设置（含向导提交） |
| POST | `/api/settings/test` | 连通性测试 `{provider}` → 测试结果 |
| POST | `/api/tts` | `{provider, model, text, voice, params{…}}`；SSE：meta/audio/word/done/error；done 含 `{historyId, fileId}` |
| GET | `/api/tts/history` | 历史列表（分页/筛选） |
| DELETE | `/api/tts/history/:id` | 删除单条（含音频） |
| GET | `/api/audio/:file` | 音频回放/下载（Range 支持） |
| GET | `/api/voices/system` | 系统音色目录（可带 model 过滤） |
| GET | `/api/voices/custom?target_model=` | list_voice 聚合 + 本地别名/缓存 |
| GET | `/api/voices/custom/:id` | 详情/状态 |
| POST | `/api/voices/clone` | 创建复刻音色 |
| POST | `/api/voices/design` | 创建设计音色（含 preview_audio 回传） |
| POST | `/api/voices/custom/:id/update` | 换音频（复刻） |
| DELETE | `/api/voices/custom/:id` | 删除音色 |

错误约定：`{error:{code, message, requestId?}}`，透传上游 `request_id`。开启访问口令后 `/api/*` 校验 `Authorization: Bearer <token>`（`/api/settings` GET 的 configured 字段除外，用于判断进向导）。

---

## 8. 目录结构

```
aliTTS/
├── package.json            # 根编排：scripts(dev/build/start) + express + concurrently
├── server/
│   ├── index.js            # 入口：静态托管 dist + API + 监听策略
│   ├── config.js           # settings 读写（原子写，configured 判定）
│   ├── providers/          # dashscope.js
│   ├── routes/             # tts.js voices.js settings.js history.js
│   └── util/               # chunker.js 文本分段 · sse.js · logger.js · wav.js
├── web/                    # Vue 3 + Vite + TS
│   ├── vite.config.ts      # proxy /api → :3210
│   ├── src/
│   │   ├── main.ts · App.vue · router/ · stores/(settings/theme/voices/history)
│   │   ├── views/          # Setup(向导) · Synthesis(快捷/高级) · Clone · Design · Library · History · Settings
│   │   ├── components/     # VoicePicker · ParamPanel · Player(waveform) · SsmlHelper · InstructionChips …
│   │   ├── api/            # SSE 客户端封装 · rest.ts
│   │   ├── audio/          # 流式播放器(pcm→wav封头) · 下载工具
│   │   └── data/voices-catalog.json
│   └── package.json
└── data/                   # 运行时（gitignore）：settings.json · history.json · audio/
```

---

## 9. 关键实现细节

1. **长文本分段**：按 `。！？；!?;\n` 贪心切分至 ≤ 段长上限（默认 600，qwen3-tts 强制）；顺序请求拼接；可选段间静音（0/200ms）。
2. **流式播放**：wav 首片含文件头，AudioContext decode+顺序 schedule；pcm 前端封 WAV 头同法；mp3/opus 聚合 Blob 播放（v2 再上 MSE）。
3. **双域名回退**：按设置域名请求；失败且配置 WorkspaceId 时自动切业务空间域名重试一次。
4. **访问令牌**：设置后所有 /api 请求（除 /api/health）需携带 X-AliTTS-Token 头或 ?token= 参数；浏览器端首次访问弹窗索取并记忆。
5. **能力矩阵驱动 UI**：`web/src/data/models.ts` 集中维护矩阵与参数 schema，表单控件按 schema 动态渲染/禁用，改模型零散逻辑不再散落。
6. **音色目录**：静态 JSON + 注释说明来源与更新方式；models[] 字段驱动过滤。
7. **主题三态**：theme store（light/dark/auto + matchMedia 监听）→ n-config-provider；持久化到本地并同步到 settings。

---

## 10. 里程碑

| 阶段 | 内容 | 交付物 |
|---|---|---|
| M1 | 工程骨架（Vue+Express+构建链）、**首次运行向导**、设置、DashScope 合成核心（快捷模式） | 配 Key 即能用模板出声下载 |
| M2 | 高级模式全量参数 + 音色目录 + 历史回放 | 完整合成工作台 |
| M3 | 声音复刻 + 声音设计 + 声音库 | 自定义音色闭环 |
| M4 | 长文本分段拼接、流式边收边播、A/B 对比 | 体验完善 |
| M5 | 移除 OpenRouter、局域网选项完善（访问令牌/端口/地址展示/重启提示） | 内网安全共享 |

每阶段本地真实 Key 冒烟自测后汇报。

---

## 11. 风险与备注
- SpeechSynthesizer 域名存在公共/业务空间两种口径 → 默认公共 + 可配 + 自动回退。
- 复刻审核 DEPLOYING 可能耗时 → 轮询 + 手动刷新 + 状态恢复。
- 上游音频 URL 24h 失效 → 一律落盘。
- qwen3-tts 600 字硬限 → 服务端强制分段。
- 浏览器录音保留在方案内（M3 交付），若不需要可砍。

---

## 12. 已确认决策记录（2026-10-23）
1. API Key：首次打开向导输入，设置页可改 ✅
2. 部署：仅本机/内网，不做公网服务 ✅
3. 前端：可上框架 → 采用 Vue 3 + Vite + TS + Naive UI ✅
4. ~~OpenRouter：冗余备份，支持故障转移~~ → **v1.2（2026-10-24）彻底移除**：实测平台无阿里系 TTS、音色/复刻不互通，自动故障转移前提不成立 ✅
5. 主题：浅色/深色/跟随系统三态切换 ✅
6. 浏览器录音（复刻样本采集）：保留（默认做）
