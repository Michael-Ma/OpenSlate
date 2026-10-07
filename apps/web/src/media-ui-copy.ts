import type { Recording } from "./narration-model";
type MediaTranslation = (
  english: string,
  chinese: string,
  values?: Readonly<Record<string, string | number>>,
) => string;
/** Controlled media UI only. Never translate owned names, scripts, transcripts or prompts. */
export const mediaUiCopy: Readonly<Record<string, string>> = {
  "Scene decisions": "场景生成",
  "Earlier scene decision": "之前的场景决定",
  "An earlier scene decision was not confirmed. Its exact saved request is kept.":
    "之前的场景请求尚未确认，原请求已保留。",
  "Checking saved decision…": "正在检查已保存的决定…",
  "Check saved scene decision": "检查已保存的场景决定",
  "· media saved": "· 媒体已保存",
  "{v0} generation": "{v0}生成",
  "See scene": "查看场景",
  "Refresh scene": "刷新场景",
  Shot: "镜头",
  "Video motion": "视频运动",
  "Planned motion": "计划运动",
  "Motion is not saved yet.": "尚未保存运动描述。",
  " generated · {v0} in the film": "生成时长 · 成片中使用 {v0}",
  " · Demo frame": " · 演示画面",
  "Keyframe prompt": "关键帧提示词",
  "Video settings": "视频设置",
  "completed shot": "个已完成镜头",
  "kept.": "已保留。",
  "Open narration ·": "编辑旁白 ·",
  "Saving scene decision…": "正在保存场景决定…",
  "Generate keyframes · {v0}": "生成关键帧 · {v0}",
  "Generate video · {v0}": "生成视频 · {v0}",
  "The response was not confirmed. Check the saved decision with the same request.":
    "响应尚未确认，请用原请求检查已保存的决定。",
  Keyframes: "关键帧",
  Video: "视频",
  "requested for": "已请求生成，场景：",
  "Shot narration": "镜头旁白",
  Narration: "旁白",
  "Refresh shot audio": "刷新镜头音频",
  "The shot’s audio direction changed. Save these current words or revise them before preparing new speech.":
    "镜头的音频要求已更改。请先保存或修改当前文稿，再生成语音。",
  "Retry saved request": "重试已保存的请求",
  "Loading…": "正在加载…",
  Source: "来源",
  "Generate speech": "生成语音",
  "Upload recording": "上传录音",
  "Choose narration model in Project settings": "在项目设置中选择旁白模型",
  Voice: "音色",
  "Choose your registered voice": "选择已登记的音色",
  "Words or description": "文稿或描述",
  Script: "文稿",
  "Optional description of this recording": "录音描述（选填）",
  "Words for this shot": "这个镜头的旁白文稿",
  "A newer script was saved. Your draft is kept.":
    "已有更新的文稿，您的草稿仍已保留。",
  "Keep my draft": "保留我的草稿",
  "Use saved script": "使用已保存文稿",
  "Save shot script": "保存镜头文稿",
  "Generate narration": "生成旁白",
  "Select and configure a speech model in Settings to generate narration.":
    "请在设置中选择并配置语音模型，再生成旁白。",
  "Enroll your recorded voice in Settings before generating speech.":
    "请先在设置中登记您的音色，再生成语音。",
  "Earlier preparation saved. Use Generate narration to request the current script.":
    "之前的准备已保存。点击「生成旁白」请求生成当前文稿。",
  "View job status": "查看任务状态",
  Recording: "录音",
  "Choose a take": "选择录音版本",
  "Use this recording for the shot": "为此镜头使用这份录音",
  "Checking recording…": "正在检查录音…",
  "Listen to shot narration": "试听镜头旁白",
  From: "开始",
  To: "结束",
  "s voice ·": "秒旁白 ·",
  "s shot": "秒镜头",
  "Match the shot to the recording (3–15s)": "让镜头时长匹配录音（3–15 秒）",
  "Save the words or describe this recording before accepting it.":
    "请先保存文稿或录音描述，再确认使用。",
  "Choose a 3–15 second range within this recording.":
    "请在录音中选择 3–15 秒的片段。",
  "Choose a nonempty range within this shot’s planned duration, or explicitly match a longer recording.":
    "请选择不超过镜头计划时长的片段，或明确让镜头匹配更长的录音。",
  "Accepted narration": "旁白已确认",
  "Listen, then accept the script, recording and range.":
    "请先试听，再确认文稿、录音和使用范围。",
  "Accept narration and timing for this shot": "确认此镜头的旁白和时间范围",
  "Continue with director": "继续与导演讨论",
  "Listen to {v0}": "试听 {v0}",
  "Loading verified audio…": "正在加载已核验音频…",
  Recordings: "录音库",
  "Audio library": "音频库",
  "Upload music or a recording, then listen. Importing adds an owned asset only. Choose background music in Timeline, or attach narration from a shot. Audio is normalized locally; no provider request or voice enrollment occurs.":
    "上传音乐或录音后即可试听。在时间线选择背景音乐，或为镜头添加旁白。导入只保存素材并在本地处理音频，不会调用生成服务或登记音色。",
  "Refresh recordings": "刷新录音库",
  "Import a recording or music": "导入录音或音乐",
  "Import selected audio": "导入所选音频",
  "Local FFmpeg and ffprobe are needed. Run":
    "需要本地 FFmpeg 和 ffprobe。运行",
  "for setup instructions.": "查看配置说明。",
  "Choose nonempty audio up to": "请选择非空音频文件，大小上限为",
  "MiB.": "MiB。",
  "Importing and verifying audio…": "正在导入并核验音频…",
  "The import was not confirmed.": "导入结果尚未确认。",
  "Retry the same audio import": "用原请求重试音频导入",
  "Loading recordings…": "正在加载录音库…",
  Generated: "生成的录音",
  Uploaded: "上传的录音",
  "No recordings yet.": "暂无录音。",
  "Close audio preview": "关闭音频预览",
  "Recording pages": "录音分页",
  Previous: "上一页",
  recordings: "份录音",
  Next: "下一页",
  "VOICE & STORY": "声音与故事",
  "Shape the narration": "创作旁白",
  "Start with notes or a finished script. Choose an existing generated take or bring a recording, then review what is said and where it belongs.":
    "从想法或完整文稿开始，选择已有录音或上传新录音，再确认内容和它在影片中的位置。",
  "Refresh saved work": "刷新已保存内容",
  "Narration session open · your edits stay together":
    "旁白编辑已开启 · 修改将一并保存",
  "This session needs an explicit continuation": "需要明确继续这次编辑",
  "Start a narration session to make changes": "开始旁白编辑后即可修改",
  "Continue this edit in narration": "在旁白中继续这次编辑",
  "Continue narration": "继续编辑旁白",
  "Start narration": "开始编辑旁白",
  "Continue your current edit: “": "继续当前编辑：“",
  "Your saved narration request is still running. Switching projects will not start it again.":
    "已保存的旁白请求仍在运行，切换项目不会重复启动。",
  "The response was uncertain. Retry the same saved request to check its result.":
    "响应尚未确认，请用原请求检查结果。",
  "Retry exact request": "重试原请求",
  "Loading your saved narration…": "正在加载已保存的旁白…",
  "Audio for": "音频对应：",
  ". Other shot links are preserved.": "。其他镜头关联仍已保留。",
  "Personal voice enrollment is not connected. Do not generate a stock voice as a substitute.":
    "个人音色登记尚未连接，请勿用默认音色代替。",
  "01 · Write": "01 · 写作",
  "02 · Listen & time": "02 · 试听与时间范围",
  "03 · Review changes": "03 · 检查修改",
  "Your sections": "旁白段落",
  "Close new section": "关闭新段落",
  "Add a section": "添加段落",
  "Start with words or a recording.": "从文稿或录音开始。",
  "Add a section for notes or a script, or upload a recording below and review its transcript first. Nothing is filled in or accepted for you.":
    "添加段落记录想法或文稿，或先上传录音并检查转写内容。内容不会自动填写或确认。",
  "New narration section": "新旁白段落",
  "Save section": "保存段落",
  "Notes and outlines can be refined before approval.":
    "可以在确认前继续完善想法和提纲。",
  "Your unsaved writing is still here": "未保存的文稿仍在这里",
  "This section was removed from the saved narration while you were editing.":
    "编辑期间，这个段落已从保存的旁白中移除。",
  "Restore as a new section": "恢复为新段落",
  "Discard this unsaved writing": "丢弃未保存文稿",
  "YOUR RECORDINGS": "您的录音",
  "Choose and listen": "选择并试听",
  "Choose an existing take or upload a recording. Listen before attaching it.":
    "选择已有版本或上传录音，试听后再关联。",
  "New speech generation starts when you request it. Attaching a saved take does not generate or accept anything.":
    "生成语音使用保存的语音方案。关联已有录音不会生成或确认新内容。",
  "Writing and script review are available. Recording import needs configured local media tools. Existing generated takes can be previewed through their saved artifacts.":
    "可以写作和检查文稿。导入录音需要本地媒体工具，已有生成录音可以直接试听。",
  "Recording source": "录音来源",
  "My recording": "我的录音",
  "Generated elsewhere": "其他工具生成",
  "Choose a narration recording": "选择旁白录音",
  "Saved recordings": "已保存录音",
  "Choose a recording to listen": "选择录音进行试听",
  "Showing the": "显示",
  "newest saved recordings out of": "份最新保存录音，总计",
  ". Older attached recordings remain available in their sections.":
    "。已关联的旧录音仍可在对应段落中使用。",
  "completed OpenSlate recording": "份 OpenSlate 已完成录音",
  "listed. Preview a take, attach it to a section, then review its audio and timing.":
    "。先试听并关联到段落，再检查音频和时间范围。",
  "Load older generated recordings": "加载更早的生成录音",
  "REVIEW CHANGES": "检查修改",
  "Connect narration to your shots": "为镜头关联旁白",
  "A section sets its shot's narration and duration. Choose links deliberately; one changed section does not rewrite your other shots.":
    "段落决定对应镜头的旁白和时长。请明确选择关联，修改一个段落不会改写其他镜头。",
  "Untitled shot": "未命名镜头",
  "Keep existing link": "保留现有关联",
  "No narration · detach explicitly": "无旁白 · 明确取消关联",
  Section: "段落",
  Untitled: "未命名",
  "Save or revert your unsaved writing, new section or timing before reviewing or applying narration. Review uses the saved, accepted version.":
    "检查或应用旁白前，请先保存或撤销文稿、新段落和时间范围。检查使用已保存并确认的版本。",
  "Reopen new section": "重新打开新段落",
  "Discard new section draft": "丢弃新段落草稿",
  "Each section needs an accepted saved script, attached recording and saved timing before you can review the complete narration.":
    "每个段落都需要已确认文稿、已关联录音和已保存时间范围，才能检查完整旁白。",
  "Review narration changes": "检查旁白修改",
  "Review before applying": "应用前检查",
  "Save or revert your changes first": "请先保存或撤销修改",
  "Ready for your decision": "等待您的确认",
  "This preview is out of date": "此预览已过期",
  "accepted section": "个已确认段落",
  ". No video will be generated by applying these changes.":
    "。应用修改不会生成视频。",
  "No shot links will change. Choose links above if this narration should set shot timing.":
    "镜头关联不会更改。若需要旁白决定镜头时间，请在上方选择关联。",
  "video prompt needs review because narration meaning or duration changed":
    "旁白内容或时长已变，需要检查视频提示词",
  "video intent can stay as it is": "视频意图可以保留",
  "Apply this narration": "应用旁白",
  "Your saved work changed. Review a fresh preview before applying.":
    "保存的内容已变，请检查最新预览后再应用。",
  "Narration is saved in the project.": "旁白已保存到项目。",
  "Editing holds stay in place until a matching plan is applied. Ask the director to update the affected plan using the accepted narration.":
    "应用匹配的计划前，相关编辑仍暂停生成。请让导演依据已确认旁白更新相关计划。",
  "Continue with the director": "继续与导演讨论",
  "The demo director cannot plan narration changes. A connected director is needed for that next step.":
    "演示导演无法规划旁白修改，需要连接导演后继续。",
  "Words or notes": "文稿或想法",
  "What should the audience hear?": "希望观众听到什么？",
  "How finished is it?": "文稿完成到哪一步？",
  Notes: "想法",
  Outline: "提纲",
  "Finished draft": "完整草稿",
  "Choose later": "稍后选择",
  "Generated audio": "生成的音频",
  Language: "语言",
  "What should this section communicate?": "这个段落要传达什么？",
  "The main idea the visuals should support": "画面需要支持的核心想法",
  "Listen to the saved narration recording": "试听已保存旁白录音",
  "Listen to recording": "试听录音",
  "Untitled narration section": "未命名旁白段落",
  "Script accepted": "文稿已确认",
  "Draft to review": "草稿待检查",
  "Writing in progress": "正在写作",
  "Recording accepted": "录音已确认",
  "Recording attached": "录音已关联",
  "No recording": "无录音",
  "Timing accepted": "时间范围已确认",
  "Timing to review": "时间范围待检查",
  "Revert unsaved writing": "撤销未保存文稿",
  "Revert unsaved timing": "撤销未保存时间范围",
  "A newer script was saved. Your typed text has been kept.":
    "已有更新的文稿，您的输入仍已保留。",
  "Use saved version": "使用已保存版本",
  "Keep my edits over this version": "将我的修改用于此版本",
  "Save writing": "保存文稿",
  "✓ Script accepted": "✓ 文稿已确认",
  "Accept saved script": "确认已保存文稿",
  "Attach a saved recording": "关联已保存录音",
  "Choose a recording": "选择录音",
  "Attach recording": "关联录音",
  "Preview the selected recording before attaching. It may differ from the saved script; acceptance stays separate.":
    "关联前请试听所选录音。它可能与保存的文稿不同，需要单独确认。",
  "✓ Recording accepted": "✓ 录音已确认",
  "Accept attached recording": "确认已关联录音",
  "The saved recording or range changed. Your typed values are still here.":
    "保存的录音或范围已变，您的输入仍已保留。",
  "Reload saved range": "重新加载已保存范围",
  "Keep my typed range": "保留我输入的范围",
  "The saved position changed to": "保存的位置已改为",
  "s.": "秒。",
  "Use saved position": "使用已保存位置",
  "Keep my typed position": "保留我输入的位置",
  "Choose the range in the recording, then where this section begins in the video. All values are seconds.":
    "选择录音片段，再设置它在视频中的开始位置。单位均为秒。",
  "Save recording range": "保存录音范围",
  "Save video position": "保存视频位置",
  "✓ Timing accepted": "✓ 时间范围已确认",
  "Accept saved timing": "确认已保存时间范围",
  "Remove this section": "移除此段落",
  "Accepted history remains saved. Any linked shot will need a new narration choice.":
    "已确认的历史仍会保留。关联镜头需要重新选择旁白。",
  "Remove section": "移除段落",
  "Refresh speech plans": "刷新语音方案",
  "Generate speech from saved writing. Listen to the returned recording before accepting it for the film.":
    "根据已保存文稿生成语音，试听结果后再确认用于影片。",
  "Choose a narration model in Project settings.":
    "请在项目设置中选择旁白模型。",
  "Add narration on a storyboard shot, or save writing here to generate a recording.":
    "为分镜中的镜头添加旁白，或在这里保存文稿后生成录音。",
  "Saved section": "已保存段落",
  "Choose a section": "选择段落",
  "Project narration model:": "项目旁白模型：",
  "Choose in Project settings": "在项目设置中选择",
  "Delivery instructions": "朗读要求",
  "Warm, calm delivery with natural pauses": "温暖、平静地朗读，自然停顿",
  "Saved speech plans": "已保存语音方案",
  "Choose a plan to review": "选择方案进行检查",
  "Selected saved plan": "当前已保存方案",
  "Unavailable saved plan": "已保存方案不可用",
  "Load older speech plans": "加载更早的语音方案",
  "Checking this exact plan…": "正在检查此方案…",
  "Narration request": "旁白请求",
  "· Voice:": "· 音色：",
  "Delivery:": "朗读方式：",
  "Default delivery": "默认朗读方式",
  "This earlier preparation did not start speech. Use Generate narration with the current saved writing to request it.":
    "之前的准备没有启动语音生成。请点击「生成旁白」请求生成当前文稿。",
  "Transcribe a recording": "转写录音",
  "Refresh transcription plans": "刷新转写方案",
  "Transcribe an owned recording, then choose which returned words or timing to use.":
    "转写已有录音，再选择采用哪些文字或时间建议。",
  "Loading transcription choices…": "正在加载转写选项…",
  "Transcription planning needs configured local audio tools.":
    "转写需要已配置的本地音频工具。",
  "Choose a transcription model in Project settings.":
    "请在项目设置中选择转写模型。",
  "Choose a saved recording above to listen and prepare its transcript.":
    "先在上方选择已保存录音进行试听和转写。",
  "Attach this OpenSlate take to a section first so it is saved in your narration recordings.":
    "请先把这份 OpenSlate 录音关联到段落，将它保存到旁白录音库。",
  "Project transcription model:": "项目转写模型：",
  "Recording language": "录音语言",
  "Detect automatically": "自动识别",
  "Use this recording for": "录音用途",
  "Independent transcript · choose a section later": "独立转写 · 稍后选择段落",
  "Transcribe recording": "转写录音",
  "Saved transcription plans": "已保存转写方案",
  "Recently prepared plan": "最近准备的方案",
  Plan: "方案",
  " · unavailable": " · 不可用",
  "Loading plans…": "正在加载方案…",
  "Load older transcription plans": "加载更早的转写方案",
  "Checking the selected plan…": "正在检查所选方案…",
  "Transcription request": "转写请求",
  "s ·": "秒 ·",
  "Generated by OpenSlate": "由 OpenSlate 生成",
  Model: "模型",
  "· word timing": "· 逐词时间",
  Destination: "目标段落",
  "Independent transcript; no section is changed": "独立转写；不修改任何段落",
  "{v0} · no words or timing are adopted": "{v0} · 尚未采用文字或时间建议",
  "This earlier preparation did not start transcription. Request the current recording with Transcribe recording.":
    "之前的准备没有启动转写。请点击「转写录音」请求处理当前录音。",
  "Review an existing transcript": "检查已有转写",
  "Recognized words and timing are suggestions for this recording. Using them does not accept your script, recording or timing.":
    "识别的文字和时间是录音建议。采用建议不等于确认文稿、录音或时间范围。",
  "Refresh transcripts": "刷新转写内容",
  "Load more transcripts": "加载更多转写",
  "Loading transcripts…": "正在加载转写…",
  "No completed transcript is listed for this recording":
    "此录音暂无已完成转写",
  " on this page. Load more to continue.": "在本页。加载更多即可继续查看。",
  " yet.": "。",
  Transcript: "转写",
  "Choose a transcript": "选择转写",
  "words ·": "个词 ·",
  "First word": "开始词",
  "First transcript word": "转写开始词",
  "Last word": "结束词",
  "Last transcript word": "转写结束词",
  "Choose one continuous range, from 1 to": "请选择连续范围，词序号为 1 至",
  "Loading recognized words…": "正在加载识别文字…",
  "This transcript contains no recognized words.": "此转写不含识别文字。",
  Word: "词序",
  "Recognized text": "识别文字",
  "Recording time": "录音时间",
  "Choose range": "选择范围",
  "Start at word {v0}": "从第 {v0} 个词开始",
  "Start here": "从这里开始",
  "End at word {v0}": "在第 {v0} 个词结束",
  "End here": "到这里结束",
  "Previous words": "上一页文字",
  of: "共",
  "Next words": "下一页文字",
  "Choose a first and last word within this transcript, in that order.":
    "请按顺序选择此转写中的开始词和结束词。",
  "Checking this selection…": "正在检查所选范围…",
  "Saved script": "已保存文稿",
  "This section has no words yet.": "此段落暂无文稿。",
  "Recognized words": "识别文字",
  " to use": "待采用",
  "Too many words for one section. Choose fewer words to use them as your script.":
    "文字超过单个段落上限，请缩小范围后用作文稿。",
  "Suggested recording range: {v0}–{v1}s.": "建议录音范围：{v0}–{v1} 秒。",
  "No usable recording range is available for this selection.":
    "此选择没有可用录音范围。",
  " The section's video position stays the same.":
    "该段落在视频中的位置保持不变。",
  "Choose a smaller valid range, or enter recording timing manually.":
    "请选择更小的有效范围，或手动输入录音时间。",
  "More selected words have timing issues. Review their word pages for details.":
    "更多所选文字存在时间问题，请查看对应文字页。",
  "Open a current narration session and save or revert edits before using this selection.":
    "请先打开当前旁白编辑，并保存或撤销修改，再使用此选择。",
  "Use recognized words": "使用识别文字",
  "Use suggested timing": "使用建议时间",
  "To use these suggestions, add or choose a section above, choose its recording source and attach this recording. Review words and timing separately in that section.":
    "先在上方添加或选择段落，选择来源并关联此录音，再分别检查该段落的文字和时间建议。",
  "Your voice": "您的音色",
  "Personal voice setup": "个人音色设置",
  "Use an existing consented OpenAI custom voice from an eligible account. Registration saves its identity locally. Provider access is checked when you request speech. Creating a voice from a recording is not available yet.":
    "使用符合条件的 OpenAI 账户中已有且获得授权的自定义音色。登记只在本地保存标识，生成时才检查服务访问。尚不支持通过录音创建新音色。",
  Revoked: "已撤销",
  Registered: "已登记",
  "Provider not connected": "服务未连接",
  "Revoke {v0}": "撤销 {v0}",
  "Register an existing voice": "登记已有音色",
  "Requires an eligible OpenAI account and a voice already created with your consent.":
    "需要符合条件的 OpenAI 账户，以及已获得您同意创建的音色。",
  "Provider requirements": "服务要求",
  "Voice name": "音色名称",
  "My narration voice": "我的旁白音色",
  "Provider voice ID": "服务音色 ID",
  "This is my own recorded voice.": "这是我本人的录音音色。",
  "I permit OpenSlate to synthesize speech with this voice.":
    "我允许 OpenSlate 使用此音色合成语音。",
  "Save voice": "保存音色",
  "Loading verified reference…": "正在加载已核验参考图…",
  "Selected supplied reference": "所选参考图",
  "Upload an image": "上传图片",
  "Your images": "您的图片",
  "Your saved import is running. Switching projects will not start it again.":
    "已保存的导入仍在运行，切换项目不会重复启动。",
  "The import result was not confirmed. Check the same saved request.":
    "导入结果尚未确认，请用原请求检查。",
  "Retry same import": "用原请求重试导入",
  "PNG image · up to 32 MiB": "PNG 图片 · 最大 32 MiB",
  "Add this reference to the current edit": "将参考图添加到当前编辑",
  "Importing…": "正在导入…",
  "Import reference": "导入参考图",
  "Loading reference library…": "正在加载参考图库…",
  "No reference images yet.": "暂无参考图。",
  Reference: "参考图",
  Preview: "预览",
  "Previous references": "上一页参考图",
  "More references": "更多参考图",
  "Attach and discuss": "附加并讨论",
  "Local FFmpeg is needed to prepare an image for Codex.":
    "需要本地 FFmpeg 为 Codex 准备讨论用图片。",
  "Send a reduced image to Codex for this discussion. Your project stays unchanged; request edits in the conversation. Later messages do not automatically include the image.":
    "向 Codex 发送缩小后的图片进行讨论。项目不会自动修改，可在对话中提出编辑要求。后续消息不会自动附加图片。",
  "Upload a video": "上传视频",
  Export: "导出",
  "Local rendering": "本地渲染",
  "Uploaded video audio is removed. Add narration from a shot in the storyboard.":
    "上传视频的音轨会被移除，请为分镜中的镜头添加旁白。",
  "Your saved request is still running. Switching projects will not start it again.":
    "已保存请求仍在运行，切换项目不会重复启动。",
  "The result was not confirmed. Retry the saved request to check its outcome.":
    "结果尚未确认，请用原请求检查。",
  "Retry same action": "重试原操作",
  "Video file · up to 128 MiB": "视频文件 · 最大 128 MiB",
  "Add this clip to the current edit": "将片段添加到当前编辑",
  "Working…": "正在处理…",
  "Import clip": "导入片段",
  "Discuss these clips with OpenSlate": "与 OpenSlate 讨论这些片段",
  "Render current plan": "渲染当前计划",
  "Uses the current clips and accepted narration. Pending edits and pause still apply.":
    "使用当前片段和已确认旁白。待处理编辑与暂停仍会生效。",
  "A timeline plan is needed before rendering.": "渲染前需要时间线计划。",
  "Render history ·": "渲染历史 ·",
  "Run prepared render": "开始已准备的渲染",
  "Check saved completion": "检查已保存的完成结果",
  Cancel: "取消",
  "Saved.": "已保存。",
  "Narration accepted for this shot.": "此镜头的旁白已确认。",
  "Narration accepted. Update the visual plan: {v0}":
    "旁白已确认，请更新画面计划：{v0}",
  "The audio request could not complete.": "音频请求未能完成。",
  "The shot audio session could not be opened.": "未能打开镜头音频编辑。",
  "The request could not be completed.": "请求未能完成。",
  "The speech plan could not be loaded.": "无法加载语音方案。",
  "The transcription plan could not be loaded.": "无法加载转写方案。",
  "The transcript could not be loaded.": "无法加载转写内容。",
  "Speech history changed. Refresh before loading more.":
    "语音历史已变，请刷新后再加载更多。",
  "This section changed. Choose it again.": "段落已变，请重新选择。",
  "Refresh the project before registering a voice.":
    "请先刷新项目，再登记音色。",
  "Enter a voice name and existing OpenAI voice ID, then confirm both consent choices.":
    "请填写音色名称和已有 OpenAI 音色 ID，并确认两项同意声明。",
  "Personal voice registered. No audio generated.":
    "个人音色已登记，未生成音频。",
  "Voice revoked for new speech requests. Existing recordings retained.":
    "已禁止此音色用于新语音请求，已有录音仍保留。",
  "Choose a nonempty PNG image up to 32 MiB.":
    "请选择非空 PNG 图片，最大 32 MiB。",
  "Choose a PNG no larger than 4096 pixels on either side and 8.29 megapixels overall.":
    "请选择边长不超过 4096 像素、总像素不超过 829 万的 PNG 图片。",
  "This file could not be decoded as a complete PNG. Choose another image.":
    "无法将文件解码为完整 PNG，请选择其他图片。",
  "The image changed during verification. Select the original file and try again.":
    "核验期间图片已变，请重新选择原文件。",
  "This reference could not be displayed.": "无法显示此参考图。",
  "Saved speech has not been requested": "保存的语音尚未请求生成",
  "Narration requested · waiting for the configured provider":
    "已请求旁白 · 等待配置的服务",
  "Requesting narration": "正在请求旁白",
  "Response uncertain · the request will not be repeated automatically":
    "响应尚未确认 · 不会自动重复请求",
  "Narration in progress": "正在生成旁白",
  "Saving the recording": "正在保存录音",
  "Recording ready · listen and attach it to a section":
    "录音已就绪 · 试听后关联到段落",
  "Narration did not complete": "旁白未能完成",
  "Saved execution details are unavailable": "已保存的执行信息不可用",
  "Checking progress": "正在检查进度",
  "This plan has already been approved.": "此方案已确认。",
  "The project changed. Prepare a fresh speech plan.":
    "项目已变，请准备新的语音方案。",
  "This section or its speech choices changed. Prepare a fresh plan.":
    "段落或语音选项已变，请准备新方案。",
  "This is restored history. Prepare a new plan for new generation.":
    "这是恢复的历史记录，新生成需要准备新方案。",
  "Finish the installation recovery review first.": "请先完成安装恢复检查。",
  "Project execution is paused.": "项目执行已暂停。",
  "An editing request is holding this work. Finish or explicitly continue that edit.":
    "此任务因编辑请求暂停，请完成或明确继续该编辑。",
  "The saved model setup changed.": "保存的模型设置已变。",
  "This saved plan is unavailable for review.": "此已保存方案无法检查。",
  "This plan needs a fresh check before it can run.":
    "运行前需要重新检查此方案。",
  "Saved transcription has not been requested": "保存的转写尚未请求",
  "Transcription requested · waiting for the configured provider":
    "已请求转写 · 等待配置的服务",
  "Waiting for local audio preparation": "等待本地音频准备",
  "Requesting transcription": "正在请求转写",
  "The response is uncertain · checking the existing request":
    "响应尚未确认 · 正在检查原请求",
  "Transcription in progress": "正在转写",
  "Saving the transcript": "正在保存转写",
  "Transcript ready to review": "转写已就绪，等待检查",
  "Transcription did not complete": "转写未能完成",
  "Checking transcription progress": "正在检查转写进度",
  "This is restored history. Prepare a new transcription plan to start new work.":
    "这是恢复的历史记录，请准备新转写方案后开始新任务。",
  "Restored work is paused until recovery is reviewed.":
    "恢复的任务已暂停，请先完成恢复检查。",
  "The project changed. Prepare a new transcription plan.":
    "项目已变，请准备新转写方案。",
  "Project execution is paused. Resume it before this transcription can start.":
    "项目执行已暂停，恢复后才能启动转写。",
  "An editing request is keeping this work on hold. Finish reviewing and applying that edit before transcription can start.":
    "此任务因编辑请求暂停，请先检查并应用编辑，再启动转写。",
  "This transcription no longer matches the selected recording or current plan. Prepare a new transcription plan.":
    "此转写已不匹配所选录音或当前计划，请准备新方案。",
  "The recording or selected section changed. Prepare a new transcription plan.":
    "录音或所选段落已变，请准备新转写方案。",
  "The saved model setup changed. Prepare a new transcription plan.":
    "保存的模型设置已变，请准备新转写方案。",
  "The project review changed. Prepare a new transcription plan.":
    "项目检查状态已变，请准备新转写方案。",
  "This saved plan is too large to show here.":
    "此已保存方案过大，无法在这里显示。",
  "Refresh this plan to check whether it can be approved.":
    "请刷新方案，检查是否可以确认。",
  "A word extends beyond the recording.": "有词超出了录音范围。",
  "Word timings overlap.": "词的时间范围重叠。",
  "Word timings are out of order.": "词的时间顺序有误。",
  "A word has unusable timing.": "有词的时间信息不可用。",
  "A word has no usable duration.": "有词没有有效时长。",
  "The transcript reports a duration beyond this recording.":
    "转写报告的时长超出了录音。",
  "The transcript's full text differs from its word list. Review the words shown here.":
    "转写全文与逐词列表不同，请检查这里显示的词。",
  "Choose fewer words to fit this section.":
    "请减少选择的词，使其符合段落上限。",
  "Choose a positive range inside the recording.":
    "请选择录音内有效的非空范围。",
  "This selection has a timing issue. Choose another range or enter timing manually.":
    "所选范围存在时间问题，请另选范围或手动输入时间。",
  "The saved section already matches. Its review decisions were kept.":
    "已保存段落已匹配，检查决定仍已保留。",
  "Recognized words saved as a draft. Review the script, recording and timing separately.":
    "识别文字已保存为草稿，请分别检查文稿、录音和时间范围。",
  "Suggested recording range saved. Review and accept its timing separately.":
    "建议录音范围已保存，请单独检查并确认时间范围。",
  "Narration session opened.": "旁白编辑已开启。",
  "Section saved.": "段落已保存。",
  "Writing restored as a new section.": "文稿已恢复为新段落。",
  "Recording uploaded. Listen, transcribe it, or attach it to a section.":
    "录音已上传，可以试听、转写或关联到段落。",
  "Narration changes are ready for your review.": "旁白修改已就绪，等待检查。",
  "Narration applied. A matching plan is still needed before production resumes.":
    "旁白已应用，恢复制作前仍需要匹配的计划。",
  "Job outcome unconfirmed": "任务结果尚未确认",
  "Video saved": "视频已保存",
  "Video in progress": "正在生成视频",
  "Keyframe in progress": "正在生成关键帧",
  "Keyframe saved": "关键帧已保存",
  "Keyframe to create": "待生成关键帧",
  "Generation in progress": "正在生成",
  "Narration to review": "旁白待检查",
  "Media saved": "媒体已保存",
  "No shots yet": "暂无镜头",
  "Loading scene…": "正在加载场景…",
  "Scene results changed. Refresh this scene.": "场景结果已变，请刷新场景。",
  "The scene changed. Refresh its current frames and recipe.":
    "场景已变，请刷新当前画面和方案。",
  "Finish the current conversation before starting generation.":
    "请先完成当前对话，再开始生成。",
  "Project is stopped. Send a new direction to continue.":
    "项目已停止，请发送新要求继续。",
  "Follow the existing job before requesting more work.":
    "请先查看已有任务，再请求新任务。",
  "Finish narration timing before generating this scene’s video.":
    "生成此场景视频前，请先完成旁白时间范围。",
  "Inspect every current keyframe and its actual video recipe before generating video.":
    "生成视频前，请查看每个当前关键帧和实际视频方案。",
  prepared: "已准备",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  "completion unknown": "完成结果未确认",
  "Needs attention": "需要处理",
  "Checking saved work…": "正在检查已保存内容…",
  "The scene changed. Waiting for its current direction and results.":
    "场景已变，等待最新要求和结果。",
  "Stopped. Send a new direction in the conversation to continue.":
    "已停止，请在对话中发送新要求继续。",
  "Waiting for the current conversation or saved action to finish.":
    "等待当前对话或已保存操作完成。",
  "Answer the Director’s current question before generating this scene.":
    "请先回答导演的当前问题，再生成此场景。",
  "A saved job’s outcome is unconfirmed. Follow its existing status before starting more work.":
    "已保存任务的结果尚未确认，请先检查已有状态，再开始新任务。",
  "Following this scene’s existing jobs.": "正在查看此场景已有任务。",
  "Add shots in the conversation before generating this scene.":
    "生成此场景前，请在对话中添加镜头。",
  "Keyframes and video are saved for this scene.":
    "此场景的关键帧和视频已保存。",
  "Update the motion or choose a model that supports these shot durations.":
    "请更新运动描述，或选择支持这些镜头时长的模型。",
  "Finish the requested narration timing before video.":
    "生成视频前，请先完成旁白时间范围。",
  "Display every current keyframe on the right before generating video.":
    "生成视频前，请先查看右侧所有当前关键帧。",
  "Refresh this scene before generating.": "生成前请先刷新此场景。",
  "The scene action needs a retry identity.": "场景操作需要稳定的重试标识。",
  "Another edit superseded this narration session. Refresh, then explicitly continue it.":
    "其他编辑已替代此旁白编辑，请刷新后明确继续。",
  "A narration session is already saved. Use Continue narration to resume it.":
    "旁白编辑已保存，请点击「继续编辑旁白」。",
  "Finish the draft, attach a recording, and accept its saved script, audio and timing before continuing.":
    "请先完善草稿、关联录音，并确认已保存文稿、音频和时间范围。",
  "Choose the matching recording source before attaching it.":
    "关联前请先选择匹配的录音来源。",
  "That saved version changed. Refresh and review the current version before accepting it.":
    "已保存版本发生变化，请刷新并检查当前版本后再确认。",
  "A removed narration section is still linked to a shot. Choose a replacement or No narration for that shot.":
    "移除的旁白段落仍关联镜头，请选择替代段落或「无旁白」。",
  "A saved version changed. Your typed text is still here; refresh and compare it before saving again.":
    "已保存版本发生变化，您的输入仍在。请刷新比较后再保存。",
  "The selected range goes beyond the recording. Check its start and end times.":
    "所选范围超过录音，请检查开始和结束时间。",
  "Choose a recording smaller than 128 MiB.": "请选择小于 128 MiB 的录音。",
  "Another local media operation is running. Try again shortly.":
    "其他本地媒体操作正在运行，请稍后重试。",
  "This recording could not be read. Try a supported audio file.":
    "无法读取此录音，请尝试支持的音频文件。",
  "The recording or transcript list changed. Refresh transcripts and choose the range again.":
    "录音或转写列表已变，请刷新后重新选择范围。",
  "This transcript page is too large to show. Choose a smaller range.":
    "此转写页过大，请选择更小范围。",
  "This transcript selection no longer matches the saved section. Refresh and review it again.":
    "所选转写已不匹配保存的段落，请刷新后重新检查。",
  "Check the selected words and recording before using this suggestion.":
    "采用建议前，请检查所选文字和录音。",
  "Check the section, timing and recording choices before saving.":
    "保存前，请检查段落、时间范围和录音选择。",
  "The saved narration no longer matches its inputs. Refresh before continuing.":
    "已保存旁白不再匹配其输入，请刷新后继续。",
  "Save Generated audio as this section's recording source before attaching this recording.":
    "关联录音前，请先将此段落的录音来源保存为「生成的音频」。",
  "The generated recording library changed. Refresh it before loading more.":
    "生成录音库已变，请刷新后再加载更多。",
};

/** These labels are application-generated; recording contents and provider voice names stay intact. */
export function mediaRecordingLabel(
  audio: Recording,
  index: number,
  t: MediaTranslation,
): string {
  const origin =
    audio.originEvidence === "verified_generated_audio"
      ? `${t("Generated by OpenSlate", "由 OpenSlate 生成")}${audio.generation ? ` · ${audio.generation.voice}` : ""}`
      : audio.declaredOrigin === "generated"
        ? t("made elsewhere", "其他工具生成")
        : t("uploaded", "上传的录音");
  return t(
    "Recording {number} · {seconds}s · {origin} · {hash}",
    "录音 {number} · {seconds} 秒 · {origin} · {hash}",
    {
      number: index + 1,
      seconds: (audio.media.probe.audio?.durationSeconds ?? 0).toFixed(1),
      origin,
      hash: audio.media.sha256.slice(0, 8),
    },
  );
}
export function mediaHierarchyLabel(
  label: string,
  locale: "en" | "zh-CN",
): string {
  if (locale !== "zh-CN") return label;
  return label.replace(/^(Scene|Shot)(?= (?:\d+(?:\.\d+)*$)|$)/, (prefix) =>
    prefix === "Scene" ? "场景" : "镜头",
  );
}

/** Match only sentences produced by our timing/acceptance helpers; capture values are never translated. */
export function mediaControlledMessage(
  text: string,
  t: MediaTranslation,
  ui: (text: string, extra?: Readonly<Record<string, string>>) => string,
): string {
  let match =
    /^Section (\d+) begins before the previous section ends at ([\d.]+)s\. Move its video position later or shorten the previous range\.$/.exec(
      text,
    );
  if (match)
    return t(
      "Section {section} begins before the previous section ends at {seconds}s. Move its video position later or shorten the previous range.",
      "段落 {section} 的开始位置早于上一段落的结束时间（{seconds} 秒）。请延后视频位置或缩短上一段的范围。",
      { section: match[1]!, seconds: match[2]! },
    );
  match =
    /^Section (\d+) needs a recording range long enough to cover a video frame\.$/.exec(
      text,
    );
  if (match)
    return t(
      "Section {section} needs a recording range long enough to cover a video frame.",
      "段落 {section} 的录音范围至少需要覆盖一帧视频。",
      { section: match[1]! },
    );
  match = /^Section (\d+) extends beyond the six-minute limit\.$/.exec(text);
  if (match)
    return t(
      "Section {section} extends beyond the six-minute limit.",
      "段落 {section} 超过六分钟时长上限。",
      { section: match[1]! },
    );
  const prefix = "Narration accepted. Update the visual plan: ";
  if (text.startsWith(prefix))
    return t(
      "Narration accepted. Update the visual plan: {message}",
      "旁白已确认，请更新画面计划：{message}",
      { message: ui(text.slice(prefix.length), mediaUiCopy) },
    );
  return ui(text, mediaUiCopy);
}
