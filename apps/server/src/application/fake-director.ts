import { applyCreativePatch, invariant, shotIntentDigest } from "@openslate/core";
import type { ChangeProposal, ProjectRecord } from "@openslate/core";
import type { DirectorRunInput, DirectorRunResult, DirectorRuntime, DirectorStartOptions } from "@openslate/director";
import { DirectorStartRefusal } from "@openslate/director";
import type { ProductionService, RequestRecord } from "./service.js";
import { ToolInvocationService } from "./tool-invocations.js";
import { derivedShotPrompts } from "./shot-prompts.js";
import { GenerationOverviewReader } from "../generation-overview.js";
import { isKeyframeReview } from "./keyframe-review.js";

export interface DemoCommand { action: "create" | "close_up" | "wide" | "review"; shotId?: string; sceneId?: string }

function source(project: ProjectRecord) {
  const q = JSON.stringify;
  return `definePlan({baseRevision:${q(project.revisionId)}},p=>{${project.artifacts.map((artifact, index) => `const a${index}=p.asset(${q(artifact.artifactId)});`).join("\n")}
    ${project.shots.map((shot, index) => `
    const s${index}=p.shot(${q(shot.id)});
    const i${index}=p.image("shot-${index}/frame",{intent:s${index},profile:"fake-image-v1",references:[${shot.referenceArtifactIds.map(id => `a${project.artifacts.findIndex(artifact => artifact.artifactId === id)}`).join(",")}],prompt:${q(shot.imagePrompt)}});
    const r${index}=p.humanReview("shot-${index}/review",{shots:[{intent:s${index},keyframe:i${index},videoProfile:"fake-video-v1",motionPrompt:${q(shot.videoPrompt)},seconds:${shot.desiredFrames / 30}}]});
    const v${index}=p.video("shot-${index}/take",{intent:s${index},profile:"fake-video-v1",firstFrame:p.approvedImage(i${index},r${index}),prompt:${q(shot.videoPrompt)},seconds:${shot.desiredFrames / 30}});`).join("\n")}
    const timeline=p.timeline("film/timeline",{takes:[${project.shots.map((_, index) => `v${index}`).join(",")}],narration:a${project.artifacts.findIndex(artifact => artifact.artifactId === project.cues[0]?.audio.artifactId)},transition:"cut"});
    return p.render("film/preview",{timeline});
  });`;
}

/** Explicitly scripted demonstration. This class never pretends to understand arbitrary creative intent. */
export class FakeWorkflowDirector implements DirectorRuntime {
  readonly id = "fake-workflow-v1";
  constructor(readonly service: ProductionService) {}
  async start(input: DirectorRunInput, options: DirectorStartOptions = {}): Promise<DirectorRunResult> {
    const identity = { projectId: input.projectId, requestId: input.requestId, epochId: input.epochId, turnId: input.turnId };
    if (options.signal?.aborted) return { ...identity, status: "interrupted", text: "", dispatched: false };
    const actor = (() => {
      try {
        const actor = this.service.actorForBridge(input.projectId, input.bridge.credential);
        invariant(actor.kind === "director" && actor.epochId === input.epochId, "EPOCH_REVOKED", "Fake runtime must retain the active epoch");
        return actor;
      } catch (error) { throw new DirectorStartRefusal(error); }
    })();
    const calls = new ToolInvocationService(this.service);
    let ordinal = 0;
    const invoke = async (tool: string, args: unknown) => {
      options.signal?.throwIfAborted();
      return calls.invoke(input.projectId, actor, `demo-${++ordinal}`, tool, args);
    };
    await invoke("read_context", {});
    const command = this.service.store.get<DemoCommand>("demo_command", input.requestId);
    let text = "Your message is saved. This offline director is a scripted demonstration, so it cannot interpret arbitrary creative requests yet. Use Create a 2-shot demo, then review its frames or try a scoped close-up/wide edit. Real conversation requires the Codex runtime connection.";
    const projectForNotes = this.service.store.getProject(input.projectId);
    const request = this.service.store.get<RequestRecord>("message", input.requestId)!;
    const scene = projectForNotes.scenes.find(scene => request.scopeIds.includes(scene.id) || projectForNotes.shots.some(s => s.sceneId === scene.id && request.scopeIds.includes(s.id)));
    const shots = projectForNotes.shots.filter(shot => shot.sceneId === scene?.id && (request.scopeIds.includes(scene!.id) || request.scopeIds.includes(shot.id)));
    // This bounded script only recognizes an explicit request to make video. The
    // application still owns readiness and the later human confirmation press.
    const wantsVideo = /\b(?:make|generate|create|start)\s+(?:(?:a|the|scene)\s+)*(?:videos?|clips?)\b/i.test(request.text);
    const readyScenes = (!command || command.action === "review") && input.bridge.toolContractVersion === "6.0.0" && wantsVideo
      && (request.editing || isKeyframeReview(this.service, input.requestId))
      ? new GenerationOverviewReader(this.service).read(input.projectId).scenes.filter(scene =>
        (request.scopeIds.includes(input.projectId) || request.scopeIds.includes(scene.sceneId) || scene.shotIds.some(id => request.scopeIds.includes(id)))
        && scene.state === "keyframes_back" && scene.confirmationDigest !== null && scene.videoTargets.length > 0
        && scene.blockers.every(blocker => blocker.code === "director_working"))
      : [];
    if (readyScenes.length) {
      for (let offset = 0; offset < readyScenes.length; offset += 6) await invoke("record_notes", { notes: readyScenes.slice(offset, offset + 6).map(scene => ({
        anchor: request.scopeIds.includes(input.projectId) || request.scopeIds.includes(scene.sceneId)
          ? { sceneId: scene.sceneId } : { shotIds: scene.shotIds.filter(id => request.scopeIds.includes(id)) },
        kind: "recommendation", blocking: false,
        text: "Scripted demo: this scene is ready for your video confirmation. No video has started.",
        choices: [{ kind: "confirm_video", sceneId: scene.sceneId }, { kind: "reply" }],
      })) });
      text = "Scripted demo: confirm video in the chat or in Keyframes. No video has started.";
    } else if ((!command || command.action === "review") && scene && shots.length && ["5.0.0", "6.0.0"].includes(input.bridge.toolContractVersion ?? "1.0.0")) {
      const first = shots[0]!, last = shots.at(-1)!;
      const review = this.service.store.get("keyframe_review_request", input.requestId) || command?.action === "review";
      const proposal = review && last.desiredFrames < 240 ? await invoke("propose_change", { patch: { updateShots: [{ id: last.id, desiredFrames: 240 }] } }) as { proposalId: string } : null;
      await invoke("record_notes", { notes: [
        { anchor: { shotIds: [first.id] }, kind: "observation", blocking: false,
          text: "Scripted demo note: a live Director would compare this frame with the brief. This offline Director has not seen the picture.",
          choices: [{ kind: "accept", label: "Keep this frame" }, { kind: "regenerate_keyframe", shotIds: [first.id] }] },
        { anchor: { shotIds: [last.id] }, kind: "recommendation", blocking: true,
          text: review ? "Scripted demo recommendation: the closing line needs timing review; consider an eight-second shot." : "Scripted demo recommendation: check whether the closing narration expresses the scene's intent.",
          choices: [...(proposal ? [{ kind: "proposal", proposalId: proposal.proposalId }] : []), { kind: "accept", label: review ? `Keep ${last.desiredFrames / 30} s` : "Keep narration" }, { kind: "edit_field", shotId: last.id, field: "narration" }] },
      ] });
      text = "Scripted demo review: two notes are saved for this scene. Keep the current choices, edit the narration, or use the human keyframe generation action. No picture was visually inspected.";
    }
    if (command && command.action !== "review") {
      const project = this.service.store.getProject(input.projectId);
      if (command.action !== "create" && ["5.0.0", "6.0.0"].includes(input.bridge.toolContractVersion ?? "1.0.0")) {
        const shot = project.shots.find(shot => shot.id === command.shotId);
        invariant(shot, "SCOPE_DENIED", "Choose a shot in this project");
        const framing = command.action === "close_up" ? "Extreme close-up" : "Wide";
        // V5 cannot propose a framing field. Keep its catalog immutable and offer
        // the corresponding prompt direction using the same derivation as V6.
        const update = input.bridge.toolContractVersion === "6.0.0"
          ? { id: shot.id, framing }
          : { id: shot.id, ...derivedShotPrompts(shot, { framing }) };
        const changed = Object.entries(update).some(([field, value]) => field !== "id" && shot[field as keyof typeof shot] !== value);
        const held = changed ? await invoke("propose_change", { patch: { updateShots: [update] } }) as { proposalId: string } : null;
        await invoke("record_notes", { notes: [{
          anchor: { shotIds: [shot.id] }, kind: held ? "recommendation" : "observation", blocking: !!held,
          text: held
            ? `Scripted demo recommendation: try ${command.action === "close_up" ? "an extreme close-up" : "a wide view"} for this shot. Review the Now/After preview before accepting; no replacement media has been made.`
            : "Scripted demo note: this shot already has the requested direction. No change or replacement media is needed.",
          choices: [...(held ? [{ kind: "proposal", proposalId: held.proposalId }] : []), { kind: "accept", label: "Keep current direction" }],
        }] });
        text = held
          ? "A scripted demo proposal is ready for the selected shot. Review its Now/After preview, then accept it or keep the current direction. Accepting changes the saved direction; replacement frames and clips still need your generation decision."
          : "The selected shot already has this scripted demo direction. No change was made.";
      } else {
        let proposed = project;
        const proposal: ChangeProposal = { variant: "workflow", expectedHeadVersion: project.headVersion };
        if (command.action !== "create") {
          invariant(command.shotId && project.shots.some(shot => shot.id === command.shotId), "SCOPE_DENIED", "Choose a shot in this project");
          const framing = input.bridge.toolContractVersion === "6.0.0"
            ? command.action === "close_up" ? "Extreme close-up" : "Wide"
            : command.action === "close_up" ? "Extreme close-up of stitching" : "Wide product view";
          const creative = { updateShots: [{ id: command.shotId, framing,
            imagePrompt: `Brown leather boot, ${framing.toLowerCase()}`, videoPrompt: `Slow push toward a brown leather boot, ${framing.toLowerCase()}`, reauthorPrompts: true }] };
          proposed = applyCreativePatch(project, creative, (shot, cue) => ({ ...shot, promptIntent: { image: shotIntentDigest(shot, "image", cue), video: shotIntentDigest(shot, "video", cue) } }));
          proposal.creative = creative;
        }
        proposal.source = source(proposed);
        const prepared = await invoke("prepare_change", proposal) as { preparedId: string };
        await invoke("apply_change", { preparedId: prepared.preparedId });
        text = command.action === "create"
          ? "The two-shot fixture plan is ready. OpenSlate will prepare the sample frames and wait for your review before making sample videos. The pictures and one-second clips demonstrate the pipeline; they are not AI-generated creative results."
          : "The selected shot's framing and prompts were updated. Unchanged shots keep their saved work. Review the replacement sample frame before its video can run.";
      }
    }
    const attached = JSON.parse(input.context).attachedMaterial?.attachments as Array<{ name: string; readable: boolean }> | undefined;
    if (attached?.length) text += ` Attached files received: ${attached.map(item => `${item.name}${item.readable ? "" : " (content unreadable)"}`).join(", ")}. This scripted Director acknowledges the files without interpreting their contents.`;
    await options.onEvent?.({ ...identity, kind: "assistant_message", text, phase: "final" });
    return { ...identity, status: "completed", text, dispatched: true };
  }
}
