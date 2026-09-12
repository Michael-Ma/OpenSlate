import type { ActorContext, ArtifactRef } from "@openslate/core";
import type { FrozenRenderManifest, RenderedMedia, SuppliedMedia } from "./types.js";

/** Internal records. Host paths never enter a model tool or browser request. */
export interface GeneratedMediaSource {
  id: string; projectId: string; source: SuppliedMedia; origin: "generated_video";
  attemptId: string; derivationId: string;
}
export type OwnedMediaSource = { id: string; projectId: string; source: SuppliedMedia; requestId: string } | GeneratedMediaSource;
export interface RealVideoArtifact {
  id: string; projectId: string; artifact: ArtifactRef; path: string; mimeType: "video/mp4";
  fixture: false; attemptId: null; origin: "supplied_video" | "local_render";
  byteLength: number; physicalDurationSeconds: number;
  sourceDescriptorId?: string; manifestDigest?: string; renderJobId?: string;
}
export interface RenderTarget {
  revisionId: string; headVersion: number; planId: string; graphDigest: string;
  renderNodeId: string; timelineNodeId: string; canonicalNarrationId: string | null;
  inputs: Array<{ nodeId: string | null; port: string; artifact: ArtifactRef }>;
  dependencyNodeIds: string[]; scopeIds: string[];
}
export interface MediaRenderJob {
  id: string; projectId: string; actor: ActorContext; target: RenderTarget;
  manifest: FrozenRenderManifest; outputArtifactId: string;
  state: "prepared" | "running" | "published" | "historical" | "cancelled" | "interrupted" | "failed";
  ownerToken: string | null; leaseUntil: number | null;
  cancelRequested: boolean; artifact: ArtifactRef | null;
  createdAt: string; finishedAt: string | null; errorCode: string | null;
}
export interface MediaPreview {
  id: string; projectId: string; renderJobId: string; artifact: ArtifactRef;
  revisionId: string; headVersion: number; planId: string; manifestDigest: string;
  fixture: false;
}
export interface PrepareMediaRender { expectedHeadVersion: number; renderNodeId: string; key: string }
export interface ImportVideoInput { expectedHeadVersion: number; path: string; key: string }
export interface ImportedVideo { artifact: ArtifactRef; sourceId: string; revisionId: string; headVersion: number }
export type RenderedVideoInput = Pick<RenderedMedia, "path" | "sha256" | "byteLength" | "probe">;
