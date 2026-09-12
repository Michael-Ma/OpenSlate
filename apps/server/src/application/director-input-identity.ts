import { digest, toolCatalog } from "@openslate/core";
import type { DirectorRunInput } from "@openslate/director";

/** Bind authored input and exact image identities, excluding credentials and host paths. */
export function directorInputDigest(input: DirectorRunInput): string {
  const catalog = toolCatalog(input.bridge?.toolContractVersion);
  return digest({ text: input.text, context: input.context,
    images: (input.images ?? []).map(image => ({ sha256: image.sha256, mediaType: image.mediaType })),
    ...(catalog.version === "1.0.0" ? {} : { toolContract: { version: catalog.version, digest: catalog.digest } }) });
}
