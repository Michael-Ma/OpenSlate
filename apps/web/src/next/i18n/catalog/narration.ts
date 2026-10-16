import type { Entry } from "./entry.ts";

/**
 * Narration per shot (card B13 parity): the inspector's narration panel (no narration, a line the studio voices,
 * or the person's own recording), stock voices, the current take, the voice line's state, recording uploads and
 * their refusals, and the Plan editor's "My recording" choice. Voice names (Cedar, Ash…) are names, not words.
 */
export const narrationMessages = {
  // ---- choices
  "narr.choice.none": { en: "None", zh: "无" },
  "narr.choice.line": { en: "A line", zh: "一句旁白" },
  "narr.choice.recording": { en: "My recording", zh: "我的录音" },

  // ---- the inspector's narration row
  "narr.row.undecided": { en: "Not decided", zh: "未决定" },
  "narr.row.recording": { en: "Your recording", zh: "你的录音" },
  "narr.row.recording_measured": { en: "{seconds} s", zh: "{seconds} 秒" },
  "narr.row.recording_missing": { en: "not added yet", zh: "还没有添加" },
  "narr.row.no_answer": { en: "no answer from the voice service", zh: "配音服务没有回应" },
  "narr.row.edit": { en: "Edit", zh: "编辑" },
  "narr.row.edit_label": { en: "Edit narration for {shot}", zh: "编辑 {shot} 的旁白" },
  "narr.row.listen": { en: "Listen", zh: "试听" },
  "narr.row.listen_label": { en: "Listen to the narration of {shot}", zh: "试听 {shot} 的旁白" },

  // ---- the panel
  "narr.panel.label": { en: "Narration for {shot}", zh: "{shot} 的旁白" },
  "narr.line_label": { en: "Line", zh: "台词" },
  "narr.line.empty": { en: "Write the line, or choose None.", zh: "请写好台词，或选择“无”。" },
  "narr.voice_label": { en: "Voice", zh: "声音" },
  "narr.voices_loading": { en: "Reading the voices…", zh: "正在读取声音…" },
  "narr.voices_failed": { en: "The voices could not be read ({code}). The shot keeps its voice.", zh: "无法读取声音列表（{code}），镜头保留原来的声音。" },
  "narr.voice.follow": { en: "Same as the film ({voice})", zh: "与影片相同（{voice}）" },
  "narr.voice.follow_personal": { en: "Same as the film (your personal voice)", zh: "与影片相同（你的个人声音）" },
  "narr.voice.follow_plain": { en: "Same as the film", zh: "与影片相同" },
  "narr.voice.name": { en: "{voice}", zh: "{voice}" },
  "narr.voice.name_default": { en: "{voice} · film default", zh: "{voice} · 影片默认" },
  "narr.voice.personal": { en: "Your personal voice", zh: "你的个人声音" },
  "narr.voice.impact.remake": { en: "The voice line will be made again in this voice, about {price}, with the scene's next keyframes or video.", zh: "配音会用这个声音重新生成，约 {price}，随这一场下次的关键帧或视频一起生成。" },
  "narr.voice.impact.remake_unpriced": { en: "The voice line will be made again in this voice, with the scene's next keyframes or video.", zh: "配音会用这个声音重新生成，随这一场下次的关键帧或视频一起生成。" },
  "narr.voice.impact.new": { en: "The voice line of {shot} will be made in this voice.", zh: "{shot} 的配音会用这个声音生成。" },
  "narr.none.impact": { en: "{shot} will have no narration.", zh: "{shot} 将没有旁白。" },
  "narr.none.impact.voiced": { en: "{shot} will have no narration. Its voice line stays in Assets.", zh: "{shot} 将没有旁白，配音会保留在素材里。" },

  // ---- the current take
  "narr.take.voice": { en: "Voice line · {seconds} s · {voice}", zh: "配音 · {seconds} 秒 · {voice}" },
  "narr.take.voice_personal": { en: "Voice line · {seconds} s · your personal voice", zh: "配音 · {seconds} 秒 · 你的个人声音" },
  "narr.take.voice_plain": { en: "Voice line · {seconds} s", zh: "配音 · {seconds} 秒" },
  "narr.take.recording": { en: "Your recording · {seconds} s", zh: "你的录音 · {seconds} 秒" },
  "narr.take.voice_name": { en: "Voice line of {shot}, {seconds} s", zh: "{shot} 的配音，{seconds} 秒" },
  "narr.take.recording_name": { en: "Your recording for {shot}, {seconds} s", zh: "你为 {shot} 添加的录音，{seconds} 秒" },
  "narr.take.loading": { en: "Loading the recording…", zh: "正在加载录音…" },
  "narr.take.failed": { en: "The recording could not be played ({code}).", zh: "无法播放这段录音（{code}）。" },
  "narr.take.retry": { en: "Try again", zh: "重试" },

  // ---- the voice line's state (the overview's narration slot)
  "narr.state.making": { en: "The voice line is being made…", zh: "正在生成配音…" },
  "narr.state.failed": { en: "The voice line failed. It is made again with the scene's next keyframes or video.", zh: "配音生成失败，会随这一场下次的关键帧或视频重新生成。" },
  "narr.state.no_answer": { en: "The voice service has not answered. The line may still arrive.", zh: "配音服务还没有回应，这句配音之后仍可能返回。" },
  "narr.state.not_voiced": { en: "Not voiced yet. It is made with the scene's next keyframes or video.", zh: "还没有配音，会随这一场下次的关键帧或视频一起生成。" },
  "narr.state.no_recording": { en: "No recording yet. Choose one below.", zh: "还没有录音，请在下面选择。" },

  // ---- recordings
  "narr.recording_label": { en: "Recording", zh: "录音" },
  "narr.choose": { en: "Choose a recording…", zh: "选择录音…" },
  "narr.choose_new": { en: "Choose a new recording…", zh: "选择新的录音…" },
  "narr.choose_other": { en: "Choose another…", zh: "换一个…" },
  "narr.reading": { en: "Reading the file…", zh: "正在读取文件…" },
  "narr.file": { en: "{name} · {size}", zh: "{name} · {size}" },
  "narr.file_length": { en: "{name} · {size} · {seconds} s", zh: "{name} · {size} · {seconds} 秒" },
  "narr.file_long": { en: "{seconds} s is longer than the {shot} s shot. Once added, choose how to fit it.", zh: "{seconds} 秒比 {shot} 秒的镜头长。添加后再选择处理方式。" },
  "narr.words_label": { en: "Words in the recording (optional)", zh: "录音里的话（可不填）" },
  "narr.words_hint": { en: "Used as the subtitle. The recording is not transcribed.", zh: "用作字幕，录音不会被转写。" },
  "narr.add": { en: "Add recording", zh: "添加录音" },
  "narr.adding": { en: "Adding…", zh: "正在添加…" },
  "narr.free": { en: "Free: the recording stays on this computer and replaces any voice line, which stays in Assets.", zh: "免费：录音只保存在本机，会替换配音，配音仍保留在素材里。" },
  "narr.sending": { en: "Sending {sent} of {total}", zh: "已发送 {sent}，共 {total}" },
  "narr.checking": { en: "Sent. The studio is checking the recording…", zh: "已发送，工作室正在检查录音…" },
  "narr.stop": { en: "Stop sending", zh: "停止发送" },
  "narr.stopped": { en: "Sending stopped. Nothing was added.", zh: "已停止发送，没有添加任何内容。" },
  "narr.try_again": { en: "Try again", zh: "重试" },
  "narr.done": { en: "Done", zh: "完成" },
  "narr.toast.recording": { en: "{shot} now uses your recording ({seconds} s).", zh: "{shot} 现在使用你的录音（{seconds} 秒）。" },
  "narr.toast.recording_long": { en: "{shot} now uses your recording ({seconds} s), longer than the {length} s shot. Choose how to fit it.", zh: "{shot} 现在使用你的录音（{seconds} 秒），比 {length} 秒的镜头长，请选择处理方式。" },
  "narr.toast.voice": { en: "{shot} has a new voice for its line.", zh: "{shot} 的旁白换了声音。" },
  "narr.toast.none": { en: "{shot} has no narration now.", zh: "{shot} 现在没有旁白。" },
  "narr.toast.line": { en: "{shot} has a line to voice now.", zh: "{shot} 现在有一句要配音的旁白。" },
  "narr.toast.recording_mode": { en: "{shot} will use your recording.", zh: "{shot} 将使用你的录音。" },

  // ---- recording refusals: neutral, an icon and words
  "narr.refusal.type": { en: "Choose an audio file (WAV, MP3, M4A, FLAC…).", zh: "请选择音频文件（WAV、MP3、M4A、FLAC 等）。" },
  "narr.refusal.empty": { en: "This file is empty.", zh: "这个文件是空的。" },
  "narr.refusal.too_large": { en: "{size} is over the {limit} limit for a recording.", zh: "{size} 超过了录音 {limit} 的上限。" },
  "narr.refusal.too_large_server": { en: "The studio refused this recording as too large.", zh: "录音太大，工作室拒绝了。" },
  "narr.refusal.too_long": { en: "{length} is longer than the 6-minute limit.", zh: "{length} 超过了 6 分钟的上限。" },
  "narr.refusal.too_long_server": { en: "The studio refused this recording as longer than 6 minutes.", zh: "录音超过 6 分钟，工作室拒绝了。" },
  "narr.refusal.unreadable": { en: "The studio could not read this recording. Try another file.", zh: "工作室无法读取这段录音，请换一个文件。" },
  "narr.refusal.unavailable": { en: "Recordings need FFmpeg on this computer. See Settings › This computer.", zh: "添加录音需要本机安装 FFmpeg，请查看“设置 › 本机”。" },
  "narr.refusal.slow": { en: "The studio took too long to check the recording. Try again.", zh: "工作室检查录音太久了，请重试。" },
  "narr.refusal.changed": { en: "The film changed while the recording was sent. Try again.", zh: "发送录音时影片有变化，请重试。" },
  "narr.refusal.corrupt": { en: "The recording changed on the way. Try again.", zh: "录音在传输中出错，请重试。" },
  "narr.refusal.confirming": { en: "This scene's video is being made. Add the recording once it finishes.", zh: "这一场的视频正在生成，完成后再添加录音。" },
  "narr.refusal.key": { en: "This request was already used for another version of the film. Choose the file again.", zh: "这个请求已用于影片的另一个版本，请重新选择文件。" },
  "narr.refusal.gone": { en: "This shot is no longer in the film.", zh: "这个镜头已经不在影片里了。" },
  "narr.refusal.network": { en: "The studio did not answer. Try again: the same recording is never added twice.", zh: "工作室没有响应。请重试：同一段录音不会被添加两次。" },
  "narr.refusal.session": { en: "This window is no longer connected. Open a fresh studio link, then try again.", zh: "这个窗口已断开连接，请打开新的工作室链接后重试。" },
  "narr.refusal.recovery": { en: "The studio is in recovery review. Nothing can be added until it is finished.", zh: "工作室正在恢复检查，完成前无法添加。" },

  // ---- the Plan shot editor
  "narr.plan.recording_add": { en: "Add the recording on {shot} in Keyframes.", zh: "请在关键帧里为 {shot} 添加录音。" },
  "narr.plan.recording_has": { en: "Your recording, {seconds} s. Replace it in Keyframes.", zh: "你的录音，{seconds} 秒。可在关键帧里替换。" },
  "narr.plan.impact.add": { en: "{shot} will use your recording; add it in Keyframes.", zh: "{shot} 将使用你的录音，请在关键帧里添加。" },
  "narr.plan.impact.replaces": { en: "{shot} will use your recording instead of its voice line, which stays in Assets; add it in Keyframes.", zh: "{shot} 将用你的录音代替配音，配音保留在素材里；请在关键帧里添加录音。" },
} satisfies Record<string, Entry>;
