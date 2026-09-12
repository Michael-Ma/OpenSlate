import { applyCreativePatch, invariant, shotIntentDigest } from "@openslate/core";
import type { ChangeProposal, ProjectRecord } from "@openslate/core";
import type { DirectorRunInput, DirectorRunResult, DirectorRuntime, DirectorStartOptions } from "@openslate/director";
import type { ProductionService } from "./service.js";
import { ToolInvocationService } from "./tool-invocations.js";

export interface DemoCommand { action: "create" | "close_up" | "wide"; shotId?: string }

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
    const actor = this.service.actorForBridge(input.projectId, input.bridge.credential);
    invariant(actor.kind === "director" && actor.epochId === input.epochId, "EPOCH_REVOKED", "Fake runtime must retain the active epoch");
    const calls = new ToolInvocationService(this.service);
    let ordinal = 0;
    const invoke = async (tool: string, args: unknown) => {
      options.signal?.throwIfAborted();
      return calls.invoke(input.projectId, actor, `demo-${++ordinal}`, tool, args);
    };
    await invoke("read_context", {});
    const command = this.service.store.get<DemoCommand>("demo_command", input.requestId);
    let text = "Your message is saved. This offline director is a scripted demonstration, so it cannot interpret arbitrary creative requests yet. Use Create a 2-shot demo, then review its frames or try a scoped close-up/wide edit. Real conversation requires the Codex runtime connection.";
    if (command) {
      const project = this.service.store.getProject(input.projectId);
      let proposed = project;
      const proposal: ChangeProposal = { variant: "workflow", expectedHeadVersion: project.headVersion };
      if (command.action !== "create") {
        invariant(command.shotId && project.shots.some(shot => shot.id === command.shotId), "SCOPE_DENIED", "Choose a shot in this project");
        const framing = command.action === "close_up" ? "Extreme close-up of stitching" : "Wide product view";
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
    await options.onEvent?.({ ...identity, kind: "assistant_message", text, phase: "final" });
    return { ...identity, status: "completed", text, dispatched: true };
  }
}
