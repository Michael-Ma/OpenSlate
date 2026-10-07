import type { UiTranslations } from "./locale-model";
export const errorUiTranslations: UiTranslations = {
  "Register your existing recorded voice in Project settings before generating speech.":
    "生成语音前，请在项目设置中登记已有的个人声音。",
  "This recorded voice was revoked. Choose another registered voice and prepare a new speech review.":
    "此声音已撤销，请选择其他已登记声音，并准备新的语音方案。",
  "This voice provider is not connected to the selected speech model.":
    "此声音服务商未连接所选语音模型。",
  "The recorded voice identity could not be verified. Review its setup.":
    "无法验证声音身份，请检查配置。",
  "This project reached its registered-voice limit.":
    "项目已达到登记声音数量上限。",
  "This historical request cannot start work after recovery. Continue the project and use its scene controls for new media.":
    "恢复后，历史请求无法启动任务。请继续项目并使用场景操作创建新媒体。",
  "The saved recovery record could not be verified. Keep this installation paused.":
    "无法验证保存的恢复记录，请保持当前安装暂停。",
  "Recovery was already released by another decision. Refresh to see its current status.":
    "恢复已通过其他操作解除，请刷新以查看当前状态。",
  "This shot has multiple active alternatives. Choose its current take before generating the scene.":
    "此镜头存在多个有效版本，请先选择当前版本再生成场景。",
  "The installed models changed. Reset and refresh the model choices before creating this project.":
    "已安装的模型发生变化，请重置并刷新模型选择后再创建项目。",
  "Refresh the model choices and choose one model for each operation.":
    "请刷新模型选项，并为每种任务选择一个模型。",
  "That question is no longer waiting for an answer. Refresh to see the current conversation.":
    "此问题已不再等待回答，请刷新查看当前对话。",
  "This project's director is already fixed. Create a new project to choose a different director.":
    "此项目的导演已确定，请新建项目以选择其他导演。",
  "Wait for the current conversation or setup check to finish, then refresh settings.":
    "请等待当前对话或配置检查完成，再刷新设置。",
  "The director choice or project guidance changed. Refresh settings before choosing again.":
    "导演选择或项目指导已变化，请刷新设置后重新选择。",
  "The project, model choices or unfinished work changed. Refresh choices and preview the impact again.":
    "项目、模型选择或未完成任务已变化，请刷新选项并重新预览影响。",
  "This project's saved work or model history is too large for a safe settings change.":
    "项目的保存内容或模型历史过多，无法进行可靠的设置更新。",
  "The settings request was cancelled. Check the current choices before trying again.":
    "设置请求已取消，请检查当前选择后重试。",
  "Keep the current video choice and ask the director to prepare a compatible plan before selecting H3 for unfinished videos. Image and audio defaults can still be changed.":
    "请保留当前视频模型，并让导演准备兼容计划后再为未完成视频选择 H3。图像与音频默认模型仍可修改。",
  "Wait for the current conversation and setup to finish before updating project guidance.":
    "请等待当前对话和配置检查完成，再更新项目指导。",
  "This project's guidance changed. Reload its settings before updating.":
    "项目指导已变化，请重新加载设置后再更新。",
  "Recording import needs FFmpeg and ffprobe installed on this computer. Narration writing is still available.":
    "导入录音需要这台电脑安装 FFmpeg 和 ffprobe。仍可编辑旁白文本。",
  "Local Codex checks did not pass. Check the executable and model, and sign in to Codex if needed.":
    "本地 Codex 检查未通过，请检查可执行程序和模型，并在需要时登录 Codex。",
  "The preview bytes changed. Refresh before reviewing this frame.":
    "预览文件已变化，请刷新后再检查画面。",
  "This preview is too large to load here.": "预览过大，无法在此加载。",
  "Choose a nonempty file up to 128 MiB.":
    "请选择非空且不超过 128 MiB 的文件。",
  "A pending edit holds this render. Continue that edit and apply a matching plan first.":
    "未完成的编辑暂停了此渲染，请先继续编辑并应用匹配的计划。",
  "Generation is stopped. Send a new direction in the conversation before rendering.":
    "生成已停止，请先在对话中发送新的方向再渲染。",
  "The stop state changed. Your draft is kept; refresh and send it again.":
    "停止状态已变化。草稿已保留，请刷新后重新发送。",
  "Review and apply narration that matches the current plan before rendering.":
    "渲染前，请检查并应用与当前计划匹配的旁白。",
  "The plan needs a real, owned clip. Demo fixture media cannot be used for this render.":
    "计划需要实际拥有的视频片段，演示素材无法用于此渲染。",
  "The plan changed. Prepare a render from the current version.":
    "计划已变化，请基于当前版本准备渲染。",
  "This render already started. Check its saved completion instead of starting it again.":
    "渲染已开始，请检查已保存的完成结果。",
  "The local server is unreachable. Your draft and last view are still here.":
    "无法连接本地服务，草稿和上次视图已保留。",
};
