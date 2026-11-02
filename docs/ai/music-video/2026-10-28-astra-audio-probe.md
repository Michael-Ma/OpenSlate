# GPT-6 Astra 音频理解探测（2026-10-28）

目的：确认 Director 已在用的 `gpt-6-astra`（通过 Codex 0.153.4 app-server）能否直接分析歌曲，供 `analyze_music` 使用。

方法：临时私有 Codex home（只链接 sign-in，不读取），`thread/start` read-only、`approvalPolicy: never`、ephemeral，无工具；附件文件名中性（`clip.mp3`）；提示语要求"听不到就只回 `{"canHear": false}`，不要按文件名猜"。素材是项目音乐库里那段 60 秒歌曲（约 138 BPM）。脚本在会话 scratchpad，未入库。花费：Codex 计划内 $0；歌曲片段发送给了 OpenAI（用户已同意）。

| 输入 | 结果 |
|---|---|
| `localAudio`，mp3 96 kbps 单声道 | `{"canHear": false}` |
| `audio`（base64 data URL），同一 mp3 | `{"canHear": false}` |
| `localAudio`，wav 16 kHz 30 秒 | `{"canHear": false}` |
| `localImage`，对数频谱图 1600×400 | 只给出一个 0–60 秒的 "other" 段，`confidence: low`，无法辨认人声和重拍 |

结论：协议里有音频输入类型，但这个模型在 Codex 里收不到可用的音频内容；频谱图也不足以做段落分析。**Astra 不能作为音乐分析器。**

建议（`MusicAnalyzer` 接口不变）：
1. 节拍、tempo、时长：始终用现有本地分析（准确、免费）。
2. 段落标签、人声区间、歌词时间轴、情绪：接 Gemini 的音频理解（需要用户的 Gemini key，按 token 计费，很便宜）作为第二个 analyzer；或者本地开源方案（All-In-One / STRATA 做段落，Whisper 类模型做歌词时间轴），不上传音频但依赖较重。
3. Astra 仍负责读分析结果做创作规划（它擅长音乐理论推理），只是不直接"听"。
