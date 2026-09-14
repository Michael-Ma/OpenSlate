import { createHash } from "node:crypto";
import { canonical, digest, invariant } from "@openslate/core";

export const CODEX_IMAGE_LIMITS = Object.freeze({ promptBytes: 32768, references: 8, referenceBytes: 4 * 1024 ** 2,
  totalReferenceBytes: 24 * 1024 ** 2, outputBytes: 32 * 1024 ** 2, dimension: 4096, revisedPromptBytes: 32768 });
export interface CodexImageReference { artifactId: string; sha256: string; byteLength: number; bytes: Uint8Array }
export interface CodexImageInput { attemptId: string; requestDigest: string; prompt: string; width: number; height: number;
  runtimeVersion: '0.153.4'; model: 'gpt-6-astra'; images: CodexImageReference[] }
export interface CodexImageDescription { version: 1; policy: 'codex-image-turn-v1'; attemptId: string; requestDigest: string;
  prompt: string; width: number; height: number; runtimeVersion: '0.153.4'; model: 'gpt-6-astra';
  images: Array<Omit<CodexImageReference, 'bytes'>>; turnInputDigest: string }
export interface CodexImagePrepared { runtime: { version: 1; runtimeVersion: '0.153.4'; runtimeDigest: string; configurationDigest: string; model: 'gpt-6-astra'; authMode: 'chatgpt' };
  session: { threadId: string; turnInputDigest: string } }
export type CodexImageOutcome = { kind: 'unknown'; code: string } | { kind: 'pending'; threadId: string; turnId: string }
  | { kind: 'failed'; threadId: string; turnId: string; code: 'USAGE_LIMIT' | 'TURN_FAILED' | 'IMAGE_FAILED' }
  | { kind: 'completed'; threadId: string; turnId: string; itemId: string; bytes: Uint8Array; revisedPrompt: string | null };
/** prepare performs no model turn. start performs at most one turn/start. lookup only reads saved history/files. */
export interface CodexImageTransport {
  release?(prepared: CodexImagePrepared): Promise<void>;
  prepare(input: CodexImageInput, options?: { signal?: AbortSignal }): Promise<CodexImagePrepared>;
  start(prepared: CodexImagePrepared, input: CodexImageInput, options: { signal?: AbortSignal; observeTurn: (turnId: string) => Promise<void> }): Promise<CodexImageOutcome>;
  lookup(prepared: CodexImagePrepared, options?: { turnId?: string; signal?: AbortSignal }): Promise<CodexImageOutcome>;
}
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function describeCodexImageInput(input: Omit<CodexImageInput, 'images'> & { images: Array<Omit<CodexImageReference, 'bytes'>> }): CodexImageDescription {
  invariant(typeof input.prompt === 'string' && input.prompt.trim().length > 0 && Buffer.byteLength(input.prompt) <= CODEX_IMAGE_LIMITS.promptBytes
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(input.attemptId) && sha(input.requestDigest)
    && input.runtimeVersion === '0.153.4' && input.model === 'gpt-6-astra' && input.width === 1024 && input.height === 1024
    && Array.isArray(input.images) && input.images.length <= CODEX_IMAGE_LIMITS.references,
  'CODEX_IMAGE_INPUT_INVALID', 'Invalid bounded Codex image turn requirements');
  let total = 0;
  const images = input.images.map(image => {
    invariant(typeof image.artifactId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(image.artifactId) && sha(image.sha256)
      && Number.isSafeInteger(image.byteLength) && image.byteLength >= 33 && image.byteLength <= CODEX_IMAGE_LIMITS.referenceBytes,
    'CODEX_IMAGE_INPUT_INVALID', 'Invalid exact Codex image reference');
    total += image.byteLength; return { artifactId: image.artifactId, sha256: image.sha256, byteLength: image.byteLength };
  });
  invariant(total <= CODEX_IMAGE_LIMITS.totalReferenceBytes, 'CODEX_IMAGE_INPUT_INVALID', 'Image references exceed the input limit');
  const body = { version: 1 as const, policy: 'codex-image-turn-v1' as const, attemptId: input.attemptId, requestDigest: input.requestDigest,
    prompt: input.prompt, width: input.width, height: input.height, runtimeVersion: input.runtimeVersion, model: input.model, images };
  return { ...body, turnInputDigest: digest(body) };
}
/** Versioned turn text; requirements are preferences, not native tool parameters or an internal-call limit. */
export function codexImageTurnText(input: CodexImageInput): string {
  const description = describeCodexImageInput(input);
  return 'Generate one image for this exact application request. Use the attached references in their supplied order. Do not run shell commands or other tools. Return the generated image. Requested dimensions are preferences.\n' + canonical(description);
}
export function inspectCodexImagePng(bytes: Uint8Array): { sha256: string; byteLength: number; width: number; height: number } {
  invariant(bytes instanceof Uint8Array && bytes.byteLength >= 33 && bytes.byteLength <= CODEX_IMAGE_LIMITS.outputBytes,
    'CODEX_IMAGE_OUTPUT_INVALID', 'Codex image output exceeds its PNG limit');
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  invariant(data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && data.readUInt32BE(8) === 13 && data.toString('latin1',12,16) === 'IHDR',
    'CODEX_IMAGE_OUTPUT_INVALID', 'Codex returned no bounded PNG');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  invariant(width > 0 && width <= CODEX_IMAGE_LIMITS.dimension && height > 0 && height <= CODEX_IMAGE_LIMITS.dimension,
    'CODEX_IMAGE_OUTPUT_INVALID', 'Codex image dimensions exceed the output limit');
  return { sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength, width, height };
}
