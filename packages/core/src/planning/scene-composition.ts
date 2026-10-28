import { parse } from "@babel/parser";
import { Worker } from "node:worker_threads";
import { canonical, digest, DomainError, invariant } from "../common.js";
import type {
  ArtifactRef,
  CompileContext,
  CompiledPlan,
  JsonValue,
  PlanNode,
  ProviderProfile,
  ShotRecord,
} from "../contracts.js";
import {
  assertRestrictedPlanSource,
  compilePlan,
  PLAN_LIMITS,
  printRestrictedPlan,
  shotIntentDigest,
} from "./index.js";
import {
  assertPlanCompositionContext,
  snapshotPlanCompositionData,
} from "./speech-composition.js";
import type { RestrictedPlanAst as Ast } from "./index.js";

export interface SceneOperation {
  shotId: string;
  kind: "image" | "video";
  profileId: string;
  /** Explicit bindings avoid selecting the first declaration when a shot has several alternatives. */
  nodeId?: string;
  frameNodeId?: string;
  frame?: ArtifactRef;
  /** Video only: exact reviewed settings that replace the retained ones (a lip-sync shot binds its song segment). */
  settings?: { [key: string]: JsonValue };
}
const fail = (condition: unknown, message: string): void =>
  invariant(condition, "SCENE_PLAN_INVALID", message);
const obj = (value: unknown): Ast => {
  fail(
    value &&
      typeof value === "object" &&
      typeof (value as Ast).type === "string",
    "Invalid saved plan syntax",
  );
  return value as Ast;
};
const arr = (value: unknown): Ast[] => {
  fail(Array.isArray(value), "Invalid saved plan syntax list");
  return value as Ast[];
};
const key = (value: Ast): string =>
  String(obj(value.key).name ?? obj(value.key).value);
const field = (value: Ast, name: string): Ast | undefined =>
  arr(value.properties).find((item) => key(item) === name);
const get = (value: Ast, name: string): Ast => {
  const item = field(value, name);
  fail(item, "Saved " + name + " is missing");
  return obj(item!.value);
};
const put = (value: Ast, name: string, replacement: Ast): void => {
  const item = field(value, name);
  if (item) item.value = replacement;
  else arr(value.properties).push(property(name, replacement));
};
const lit = (value: string): Ast => ({ type: "StringLiteral", value });
const id = (name: string): Ast => ({ type: "Identifier", name });
const property = (name: string, value: Ast): Ast => ({
  type: "ObjectProperty",
  key: id(name),
  value,
  computed: false,
  shorthand: false,
});
const object = (fields: Record<string, Ast>): Ast => ({
  type: "ObjectExpression",
  properties: Object.entries(fields).map(([name, value]) =>
    property(name, value),
  ),
});
const list = (elements: Ast[]): Ast => ({ type: "ArrayExpression", elements });
const number = (value: number): Ast => ({ type: "NumericLiteral", value });
const json = (value: JsonValue): Ast =>
  value === null
    ? { type: "NullLiteral" }
    : typeof value === "string"
      ? lit(value)
      : typeof value === "number"
        ? number(value)
        : typeof value === "boolean"
          ? { type: "BooleanLiteral", value }
          : Array.isArray(value)
            ? list(value.map(json))
            : {
                type: "ObjectExpression",
                properties: Object.entries(value).map(([name, value]) => ({
                  ...property(name, json(value)),
                  key: lit(name),
                })),
              };
const call = (receiver: string, name: string, args: Ast[]): Ast => ({
  type: "CallExpression",
  callee: {
    type: "MemberExpression",
    object: id(receiver),
    property: id(name),
    computed: false,
  },
  arguments: args,
});
const method = (value: Ast): string | null =>
  value.type === "CallExpression" &&
  obj(value.callee).type === "MemberExpression"
    ? String(obj(obj(value.callee).property).name)
    : null;
function walk(value: Ast, visit: (value: Ast) => void): void {
  visit(value);
  for (const child of Object.values(value))
    if (Array.isArray(child)) {
      for (const item of child)
        if (
          item &&
          typeof item === "object" &&
          typeof (item as Ast).type === "string"
        )
          walk(item as Ast, visit);
    } else if (
      child &&
      typeof child === "object" &&
      typeof (child as Ast).type === "string"
    )
      walk(child as Ast, visit);
}
function declaration(source: string): Ast {
  assertRestrictedPlanSource(source);
  const parsed = obj(
    parse(source, {
      sourceType: "module",
      strictMode: true,
      errorRecovery: false,
      plugins: ["typescript"],
    }),
  );
  const statements = arr(obj(parsed.program).body);
  fail(
    statements.length === 1 && statements[0]!.type === "ExpressionStatement",
    "Expected one complete saved plan",
  );
  const root = obj(statements[0]!.expression);
  fail(
    root.type === "CallExpression" &&
      obj(root.callee).name === "definePlan" &&
      arr(root.arguments).length === 2,
    "Expected definePlan",
  );
  return root;
}

/** Initial providers require integer seconds; preserve a still-valid existing covering recipe. */
export function sceneVideoDurationFrames(
  shot: Pick<ShotRecord, "desiredFrames">,
  profile: Pick<ProviderProfile, "minFrames" | "maxFrames">,
  existing?: Pick<PlanNode, "args">,
): number {
  invariant(
    Number.isSafeInteger(shot.desiredFrames) && shot.desiredFrames > 0,
    "PROFILE_INCOMPATIBLE",
    "The shot needs a valid planned duration",
  );
  const minimum = Math.max(shot.desiredFrames, profile.minFrames ?? 1),
    maximum = profile.maxFrames ?? 10800;
  const prior = existing?.args.durationFrames;
  const frames =
    typeof prior === "number" &&
    Number.isSafeInteger(prior) &&
    prior % 30 === 0 &&
    prior >= minimum &&
    prior <= maximum
      ? prior
      : Math.ceil(minimum / 30) * 30;
  invariant(
    frames <= maximum,
    "PROFILE_INCOMPATIBLE",
    "The selected video model cannot cover this planned shot duration",
  );
  return frames;
}
function mergeIds(
  context: CompileContext,
  original: Record<string, string>,
  initial: Record<string, string>,
  result: Record<string, string>,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(context, "logicalIds");
  invariant(
    descriptor &&
      Object.hasOwn(descriptor, "value") &&
      descriptor.value === original &&
      canonical(snapshotPlanCompositionData(original)) === canonical(initial),
    "REVISION_CONFLICT",
    "Scene identities changed during composition",
  );
  for (const [alias, value] of Object.entries(initial))
    invariant(
      result[alias] === value,
      "REVISION_CONFLICT",
      "Scene composition replaced a saved identity",
    );
  const added = Object.entries(result).filter(
    ([alias]) => !Object.hasOwn(initial, alias),
  );
  invariant(
    !added.length || Object.isExtensible(original),
    "REVISION_CONFLICT",
    "Scene identities cannot accept the composed plan",
  );
  for (const [alias, value] of added)
    Object.defineProperty(original, alias, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
}
function chooseNode(
  base: CompiledPlan | null,
  operation: SceneOperation,
  kind = operation.kind,
): PlanNode | undefined {
  const nodes =
    base?.nodes.filter(
      (node) => node.kind === kind && node.shotId === operation.shotId,
    ) ?? [];
  if (kind === operation.kind && operation.nodeId) {
    const selected = nodes.find((node) => node.id === operation.nodeId);
    fail(selected, "The exact selected operation is missing");
    return selected;
  }
  fail(
    nodes.length <= 1,
    "Choose the exact saved operation when a shot has multiple declarations",
  );
  return nodes[0];
}
function verifyBase(
  base: CompiledPlan,
  operations: SceneOperation[],
  context: CompileContext,
): void {
  // Verify the immutable source and cached operation shape while permitting the selected shot's
  // newer intent. Preserved branches keep their exact operation specifications;
  // a narration-only revision can update their shot metadata without new work.
  const source = declaration(base.source),
    revision = get(arr(source.arguments)[0]!, "baseRevision").value;
  fail(typeof revision === "string", "Saved revision is missing");
  const selected = new Set(operations.map((operation) => operation.shotId));
  const project = snapshotPlanCompositionData(context.project);
  for (const shot of project.shots.filter((shot) => selected.has(shot.id))) {
    const image = base.nodes.find(
      (node) => node.kind === "image" && node.shotId === shot.id,
    );
    const video = base.nodes.find(
      (node) => node.kind === "video" && node.shotId === shot.id,
    );
    if (image) {
      shot.imagePrompt = String(image.args.prompt);
      shot.referenceArtifactIds = image.inputs
        .filter(
          (input) =>
            input.role === "reference" && input.source.kind === "artifact",
        )
        .map((input) =>
          input.source.kind === "artifact"
            ? input.source.artifact.artifactId
            : "",
        );
    }
    if (video) {
      shot.videoPrompt = String(video.args.prompt);
      shot.desiredFrames = Math.min(
        shot.desiredFrames,
        Number(video.args.durationFrames),
      );
    }
    shot.revisionId =
      image?.shotRevisionId ?? video?.shotRevisionId ?? shot.revisionId;
    const cue = project.cues.find((cue) => cue.id === shot.cueId);
    shot.promptIntent = {
      image: shotIntentDigest(shot, "image", cue),
      video: shotIntentDigest(shot, "video", cue),
    };
  }
  project.revisionId = revision as string;
  const verified = compilePlan(base.source, { ...context, project });
  fail(
    verified.canonicalSource === base.canonicalSource &&
      verified.nodes.length === base.nodes.length &&
      verified.gates.length === base.gates.length,
    "Saved source and cached graph disagree",
  );
  const affected = new Set(
    base.nodes
      .filter((node) => selected.has(node.shotId ?? ""))
      .map((node) => node.id),
  );
  for (let pass = 0; pass < base.nodes.length; pass++)
    for (const node of base.nodes)
      if (
        node.inputs.some(
          (input) =>
            input.source.kind === "output" && affected.has(input.source.nodeId),
        )
      )
        affected.add(node.id);
  for (const old of base.nodes) {
    const next = verified.nodes.find((node) => node.id === old.id);
    const value = selected.has(old.shotId ?? "")
      ? {
          ...next,
          shotRevisionId: old.shotRevisionId,
          intentDigest: old.intentDigest,
          specDigest: old.specDigest,
        }
      : // Planned cut duration derives from the selected shot, independently of covering video duration.
        affected.has(old.id) && ["timeline", "render"].includes(old.kind)
        ? {
            ...next,
            ...(old.kind === "timeline"
              ? {
                  args: {
                    ...next!.args,
                    durationFrames: old.args.durationFrames!,
                  },
                }
              : {}),
            specDigest: old.specDigest,
          }
        : next?.specDigest === old.specDigest
        ? { ...next, shotRevisionId: old.shotRevisionId }
        : next;
    fail(
      next && canonical(value) === canonical(old),
      "Saved operation and source disagree: " + old.alias,
    );
  }
  for (const gate of base.gates) {
    const next = verified.gates.find((item) => item.id === gate.id);
    fail(
      next &&
        next.alias === gate.alias &&
        next.members.length === gate.members.length,
      "Saved gate identity changed",
    );
    gate.members.forEach((member, index) => {
      const current = next!.members[index]!;
      fail(
        canonical(
          selected.has(member.shotId)
            ? { ...current, recipeDigest: member.recipeDigest }
            : current,
        ) === canonical(member),
        "Saved review and source disagree",
      );
    });
  }
  const graph = digest({
    nodes: base.nodes
      .map((node) => ({
        id: node.id,
        kind: node.kind,
        spec: node.specDigest,
        requires: [...node.requires].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    gates: base.gates
      .map((gate) => ({
        id: gate.id,
        members: [...gate.members].sort((a, b) =>
          a.videoNodeId.localeCompare(b.videoNodeId),
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  fail(graph === base.graphDigest, "Saved graph digest changed");
}

/** Pure worker transformation. Image work can invalidate same-shot videos; the caller must defer those candidates until the video action. */
export function composeScenePlan(
  base: CompiledPlan | null,
  operations: SceneOperation[],
  context: CompileContext,
): CompiledPlan {
  assertPlanCompositionContext(context);
  const originalIds = context.logicalIds,
    initialIds = snapshotPlanCompositionData(originalIds);
  const saved = snapshotPlanCompositionData({
    base,
    operations,
    project: context.project,
    profiles: context.profiles,
    logicalIds: initialIds,
    ...(context.localExecution
      ? { localExecution: context.localExecution }
      : {}),
    ...(context.transcriptionInputs
      ? { transcriptionInputs: context.transcriptionInputs }
      : {}),
  });
  const working: CompileContext = {
    project: saved.project,
    profiles: saved.profiles,
    logicalIds: saved.logicalIds,
    allocateId: context.allocateId,
    ...(saved.localExecution ? { localExecution: saved.localExecution } : {}),
    ...(saved.transcriptionInputs
      ? { transcriptionInputs: saved.transcriptionInputs }
      : {}),
  };
  base = saved.base;
  operations = saved.operations;
  fail(
    operations.length > 0 &&
      operations.length <= 64 &&
      new Set(operations.map((operation) => operation.shotId)).size ===
        operations.length &&
      operations.every(
        (operation) =>
          ["image", "video"].includes(operation.kind) &&
          operation.kind === operations[0]!.kind &&
          Object.keys(operation).every((key) =>
            [
              "shotId",
              "kind",
              "profileId",
              "nodeId",
              "frameNodeId",
              "frame",
              "settings",
            ].includes(key),
          ) &&
          (operation.settings === undefined ||
            (operation.kind === "video" &&
              operation.settings !== null &&
              typeof operation.settings === "object" &&
              !Array.isArray(operation.settings))),
      ),
    "Choose distinct shots for one bounded picture operation",
  );
  for (const item of [...(base?.nodes ?? []), ...(base?.gates ?? [])]) {
    fail(
      !Object.hasOwn(working.logicalIds, item.alias) ||
        working.logicalIds[item.alias] === item.id,
      "Saved alias identity changed",
    );
    Object.defineProperty(working.logicalIds, item.alias, {
      value: item.id,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (base) verifyBase(base, operations, working);
  const root = declaration(
    base?.canonicalSource ??
      "definePlan({baseRevision:" +
        JSON.stringify(working.project.revisionId) +
        "},p=>{return [];});",
  );
  put(arr(root.arguments)[0]!, "baseRevision", lit(working.project.revisionId));
  const arrow = arr(root.arguments)[1]!,
    receiver = String(arr(arrow.params)[0]!.name),
    block = obj(arrow.body),
    statements = arr(block.body);
  const symbols = new Map<string, Ast>();
  walk(root, (value) => {
    if (value.type === "VariableDeclarator")
      symbols.set(String(obj(value.id).name), obj(value.init));
  });
  let serial = 0;
  const freshSymbol = (stem = "__scene_"): string => {
    let name: string;
    do name = stem + ++serial;
    while (symbols.has(name));
    return name;
  };
  const add = (value: Ast, before = statements.length - 1): Ast => {
    const name = freshSymbol();
    symbols.set(name, value);
    statements.splice(before, 0, {
      type: "VariableDeclaration",
      kind: "const",
      declarations: [{ type: "VariableDeclarator", id: id(name), init: value }],
    });
    return id(name);
  };
  const resolve = (value: Ast, depth = 0): Ast => {
    fail(depth <= 128, "Saved symbol exceeds syntax bound");
    return value.type === "Identifier"
      ? resolve(obj(symbols.get(String(value.name))), depth + 1)
      : value;
  };
  const calls = (): Ast[] => {
    const values: Ast[] = [];
    walk(root, (value) => {
      if (method(value)) values.push(value);
    });
    return values;
  };
  const operationCall = (node: { alias: string; kind: string }): Ast => {
    const matches = calls().filter(
      (value) =>
        method(value) === node.kind &&
        arr(value.arguments)[0]?.value === node.alias,
    );
    fail(
      matches.length === 1,
      "The saved operation call is missing or duplicated",
    );
    return matches[0]!;
  };
  const reference = (value: Ast): string => {
    const source = resolve(value),
      name = method(source);
    if (name === "asset")
      return "artifact:" + String(arr(source.arguments)[0]!.value);
    const alias = String(arr(source.arguments)[0]!.value),
      node = base?.nodes.find((node) => node.alias === alias);
    fail(node, "Saved media reference is missing");
    return "output:" + node!.id;
  };
  const shotId = (value: Ast): string => {
    const source = resolve(value);
    fail(method(source) === "shot", "Saved intent is missing");
    const name = String(arr(source.arguments)[0]!.value);
    const shot = working.project.shots.find(
      (shot) =>
        shot.id === name ||
        shot.revisionId === name ||
        name.startsWith(shot.id + "@"),
    );
    fail(shot, "Saved shot is missing");
    return shot!.id;
  };
  const aliases = new Set(
    [...(base?.nodes ?? []), ...(base?.gates ?? [])].map((node) => node.alias),
  );
  const newAlias = (stem: string): string => {
    let alias = stem,
      suffix = 1;
    while (aliases.has(alias)) alias = stem + "/" + ++suffix;
    aliases.add(alias);
    return alias;
  };
  const imageReference = (node: PlanNode): Ast => {
    const expression = operationCall(node);
    for (const [name, value] of symbols)
      if (value === expression) return id(name);
    // Lift an inline image once, immediately before its first consumer, retaining previous dependencies.
    const index = statements.findIndex((statement) => {
      let found = false;
      walk(statement, (value) => {
        if (value === expression) found = true;
      });
      return found;
    });
    fail(index >= 0, "Saved image declaration is missing");
    const name = freshSymbol("__scene_frame_");
    const replace = (value: Ast): Ast => {
      if (value === expression) return id(name);
      for (const [key, child] of Object.entries(value))
        if (Array.isArray(child))
          value[key] = child.map((item) =>
            item &&
            typeof item === "object" &&
            typeof (item as Ast).type === "string"
              ? replace(item as Ast)
              : item,
          );
        else if (
          child &&
          typeof child === "object" &&
          typeof (child as Ast).type === "string"
        )
          value[key] = replace(child as Ast);
      return value;
    };
    statements.forEach((statement) => replace(statement));
    symbols.set(name, expression);
    statements.splice(index, 0, {
      type: "VariableDeclaration",
      kind: "const",
      declarations: [
        { type: "VariableDeclarator", id: id(name), init: expression },
      ],
    });
    return id(name);
  };
  const changed = new Set<string>(),
    changedVideos = new Set<string>(),
    outputs: Ast[] = [];
  const updateVideo = (
    node: PlanNode,
    shot: ShotRecord,
    profile: ProviderProfile,
    intent: Ast,
    frame: Ast,
    deferredImageWork = false,
    reviewedSettings?: SceneOperation["settings"],
  ): void => {
    const expression = operationCall(node),
      options = resolve(arr(expression.arguments)[1]!),
      gate = base?.gates.find((gate) => node.requires.includes(gate.id));
    fail(gate, "Saved video review gate is missing");
    const review = operationCall({ alias: gate!.alias, kind: "humanReview" }),
      members = arr(
        resolve(get(resolve(arr(review.arguments)[1]!), "shots")).elements,
      ).map((member) => resolve(member));
    const source = node.inputs.find(
      (input) => input.role === "first_frame",
    )?.source;
    fail(source, "Saved first-frame binding is missing");
    const sourceKey =
      source!.kind === "artifact"
        ? "artifact:" + source!.artifact.artifactId
        : "output:" + source!.nodeId;
    const matches = members.filter(
      (member) =>
        shotId(get(member, "intent")) === shot.id &&
        reference(get(member, "keyframe")) === sourceKey,
    );
    fail(matches.length === 1, "Saved video review member is ambiguous");
    let duration: number;
    try {
      duration = sceneVideoDurationFrames(shot, profile, node);
    } catch (error) {
      const prior = node.args.durationFrames,
        maximum = profile.maxFrames ?? 10800;
      // Image publication gives this dependent recipe no video candidate/authority.
      // Keep its supported duration symbolic until a compatible video choice is made.
      if (
        !(
          deferredImageWork &&
          error instanceof DomainError &&
          error.code === "PROFILE_INCOMPATIBLE" &&
          shot.desiredFrames > maximum &&
          node.profileId === profile.id &&
          typeof prior === "number" &&
          Number.isSafeInteger(prior) &&
          prior > 0 &&
          prior % 30 === 0 &&
          prior >= (profile.minFrames ?? 1) &&
          prior <= maximum
        )
      )
        throw error;
      duration = prior;
    }
    const settings = json(
      reviewedSettings ??
        (node.profileId === profile.id ? (node.args.settings ?? {}) : {}),
    );
    for (const [name, value] of Object.entries({
      intent,
      profile: lit(profile.id),
      prompt: lit(shot.videoPrompt),
      seconds: number(duration / 30),
      settings,
    }))
      put(options, name, value);
    const approved = resolve(get(options, "firstFrame"));
    fail(
      method(approved) === "approvedImage",
      "Saved video approval is missing",
    );
    arr(approved.arguments)[0] = frame;
    for (const [name, value] of Object.entries({
      intent,
      keyframe: frame,
      videoProfile: lit(profile.id),
      motionPrompt: lit(shot.videoPrompt),
      seconds: number(duration / 30),
      settings,
    }))
      put(matches[0]!, name, value);
    changedVideos.add(node.id);
  };
  for (const operation of operations) {
    const shot = working.project.shots.find(
        (shot) => shot.id === operation.shotId,
      ),
      profile = working.profiles.find(
        (profile) =>
          profile.id === operation.profileId && profile.kind === operation.kind,
      );
    fail(shot && profile, "Shot or pinned model is missing");
    // Versioned shot references in the selected branch now point at the current stable ID.
    for (const value of calls().filter((value) => method(value) === "shot"))
      if (shotId(value) === shot!.id) arr(value.arguments)[0] = lit(shot!.id);
    const intent = add(call(receiver, "shot", [lit(shot!.id)]), 0),
      existing = chooseNode(base, operation);
    if (operation.kind === "image") {
      const options = {
        intent,
        profile: lit(profile!.id),
        prompt: lit(shot!.imagePrompt),
        references: list(
          shot!.referenceArtifactIds.map((ref) =>
            call(receiver, "asset", [lit(ref)]),
          ),
        ),
        width: number(
          Number(
            profile!.configuration?.settings?.width ??
              (existing?.profileId === profile!.id
                ? existing.args.width
                : undefined) ??
              1280,
          ),
        ),
        height: number(
          Number(
            profile!.configuration?.settings?.height ??
              (existing?.profileId === profile!.id
                ? existing.args.height
                : undefined) ??
              720,
          ),
        ),
      };
      const video = chooseNode(base, operation, "video");
      let generatedFrame: Ast | undefined;
      if (existing) {
        const expression = operationCall(existing),
          previous = resolve(arr(expression.arguments)[1]!);
        for (const [name, value] of Object.entries(options))
          put(previous, name, value);
        if (existing.profileId !== profile!.id)
          put(previous, "settings", object({}));
        changed.add(existing.id);
        if (video) generatedFrame = imageReference(existing);
      } else {
        // A shot may have only a video conditioned by an owned/shared image. Its
        // replacement frame must precede both its review and video. Its sole
        // declaration dependency is the current intent just inserted at index zero.
        generatedFrame = add(
          call(receiver, "image", [
            lit(newAlias("shot-" + shot!.id + "/keyframe")),
            object(options),
          ]),
          video ? 1 : statements.length - 1,
        );
        outputs.push(generatedFrame);
      }
      if (video) {
        const videoProfile = working.profiles.find(
          (profile) =>
            profile.id === video.profileId && profile.kind === "video",
        );
        fail(videoProfile, "Saved video model is missing");
        updateVideo(video, shot!, videoProfile!, intent, generatedFrame!, true);
      }
    } else {
      invariant(
        operation.frame?.kind === "image" &&
          /^[a-f0-9]{64}$/.test(operation.frame.sha256),
        "SCENE_REVIEW_STALE",
        "An exact reviewed image is required",
      );
      const previousSource = existing?.inputs.find(
        (input) => input.role === "first_frame",
      )?.source;
      let frame: Ast;
      if (previousSource?.kind === "artifact" && !operation.frameNodeId) {
        invariant(
          canonical(previousSource.artifact) === canonical(operation.frame),
          "SCENE_REVIEW_STALE",
          "The reviewed frame changed",
        );
        frame = call(receiver, "asset", [lit(operation.frame.artifactId)]);
      } else {
        const frameId =
          operation.frameNodeId ??
          (previousSource?.kind === "output"
            ? previousSource.nodeId
            : undefined);
        const image = frameId
          ? base?.nodes.find(
              (node) => node.id === frameId && node.kind === "image",
            )
          : chooseNode(base, operation, "image");
        fail(
          image && (image.shotId === shot!.id || image.shotId === null),
          "The exact conditioning-image declaration is missing",
        );
        frame = imageReference(image!);
      }
      if (existing) {
        updateVideo(existing, shot!, profile!, intent, frame, false, operation.settings);
        changed.add(existing.id);
      } else {
        const duration = sceneVideoDurationFrames(shot!, profile!);
        const review = add(
          call(receiver, "humanReview", [
            lit(newAlias("scene-" + shot!.id + "/review")),
            object({
              shots: list([
                object({
                  intent,
                  keyframe: frame,
                  videoProfile: lit(profile!.id),
                  motionPrompt: lit(shot!.videoPrompt),
                  seconds: number(duration / 30),
                  ...(operation.settings
                    ? { settings: json(operation.settings) }
                    : {}),
                }),
              ]),
            }),
          ]),
        );
        outputs.push(
          add(
            call(receiver, "video", [
              lit(newAlias("shot-" + shot!.id + "/video")),
              object({
                intent,
                profile: lit(profile!.id),
                firstFrame: call(receiver, "approvedImage", [frame, review]),
                prompt: lit(shot!.videoPrompt),
                seconds: number(duration / 30),
                ...(operation.settings
                  ? { settings: json(operation.settings) }
                  : {}),
              }),
            ]),
          ),
        );
      }
    }
  }
  if (!base) obj(statements.at(-1)).argument = list(outputs);
  const compiled = compilePlan(printRestrictedPlan(root), working);
  const affected = new Set([...changed, ...changedVideos]);
  for (let pass = 0; pass < (base?.nodes.length ?? 0); pass++)
    for (const node of base!.nodes)
      if (
        node.inputs.some(
          (input) =>
            input.source.kind === "output" && affected.has(input.source.nodeId),
        )
      )
        affected.add(node.id);
  for (const old of base?.nodes ?? []) {
    const next = compiled.nodes.find((node) => node.id === old.id);
    fail(
      next && next.alias === old.alias && next.kind === old.kind,
      "Scene generation removed a saved operation",
    );
    if (
      changed.has(old.id) ||
      changedVideos.has(old.id) ||
      (affected.has(old.id) && ["timeline", "render"].includes(old.kind))
    )
      continue;
    const unchanged =
      next!.specDigest === old.specDigest
        ? { ...next, shotRevisionId: old.shotRevisionId }
        : next;
    invariant(
      canonical(unchanged) === canonical(old),
      "SCOPE_DENIED",
      "Scene generation would alter unrelated saved media",
    );
  }
  for (const gate of base?.gates ?? []) {
    const next = compiled.gates.find((item) => item.id === gate.id);
    fail(
      next &&
        next.alias === gate.alias &&
        next.members.length === gate.members.length,
      "Scene generation removed a saved review",
    );
    gate.members.forEach((member, index) => {
      if (!changedVideos.has(member.videoNodeId))
        invariant(
          canonical(next!.members[index]) === canonical(member),
          "SCOPE_DENIED",
          "Scene generation changed unrelated review evidence",
        );
    });
  }
  mergeIds(context, originalIds, initialIds, working.logicalIds);
  return compiled;
}

export async function composeScenePlanIsolated(
  base: CompiledPlan | null,
  operations: SceneOperation[],
  context: CompileContext,
): Promise<CompiledPlan> {
  assertPlanCompositionContext(context);
  const originalIds = context.logicalIds,
    initialIds = snapshotPlanCompositionData(originalIds);
  const data = snapshotPlanCompositionData({
    base,
    operations,
    context: {
      project: context.project,
      profiles: context.profiles,
      logicalIds: initialIds,
      ...(context.localExecution
        ? { localExecution: context.localExecution }
        : {}),
      ...(context.transcriptionInputs
        ? { transcriptionInputs: context.transcriptionInputs }
        : {}),
    },
  });
  if (base) {
    assertRestrictedPlanSource(base.source);
    assertRestrictedPlanSource(base.canonicalSource);
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      workerData: { mode: "compose_scene", ...data },
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = async (
      error?: unknown,
      plan?: CompiledPlan,
      ids?: Record<string, string>,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await worker.terminate();
      try {
        if (error) throw error;
        fail(plan && ids, "Scene worker returned no validated plan");
        mergeIds(context, originalIds, initialIds, ids!);
        resolve(plan!);
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(
      () =>
        void finish(
          new DomainError(
            "PLAN_LIMIT",
            "Scene preparation exceeded its deadline",
          ),
        ),
      PLAN_LIMITS.timeoutMs,
    );
    worker.on("error", (error) => void finish(error));
    worker.on("exit", (code) => {
      if (!settled)
        void finish(
          new DomainError("COMPILER_FAILED", "Scene worker exited " + code),
        );
    });
    worker.on(
      "message",
      (message: {
        ok: boolean;
        plan?: CompiledPlan;
        logicalIds?: Record<string, string>;
        error?: { code: string; message: string };
      }) =>
        void finish(
          message.ok
            ? undefined
            : new DomainError(
                message.error?.code ?? "COMPILER_FAILED",
                message.error?.message ?? "Scene preparation failed",
              ),
          message.plan,
          message.logicalIds,
        ),
    );
  });
}
