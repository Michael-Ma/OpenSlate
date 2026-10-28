import type { StudioArtifactRef } from "@openslate/core/public";
import { useI18n } from "../i18n/I18n.tsx";
import type { CastChip } from "../model/cast.ts";
import { Picture } from "./parts.tsx";
import "./cast-avatar.css";

/**
 * A character's small round face: the face panel of their approved sheet (the fourth of its four views), or their
 * initial on a dashed ring when no sheet is approved yet. Shared by Plan › Cast, the shot rows and the Keyframes cards.
 */
export function CastAvatar({ name, picture, approved, size = "sm", crop = true }: { name: string; picture: StudioArtifactRef | null; approved: boolean; size?: "xs" | "sm" | "md"; crop?: boolean }) {
  const { t } = useI18n();
  const label = t(approved ? "cast.avatar.approved" : "cast.avatar.missing", { name });
  return (
    <span className={`cast-av ${size}${picture ? "" : " empty"}${approved ? "" : " unapproved"}${crop ? " crop" : ""}`} role="img" aria-label={label} title={label}>
      {picture ? <Picture artifact={picture} alt="" /> : <span aria-hidden="true">{[...name.trim()][0]?.toLocaleUpperCase() ?? "?"}</span>}
    </span>
  );
}

/** The cast of one shot as overlapping faces (Keyframes cards), at most three, then "+N". */
export function CastStack({ chips, max = 3 }: { chips: CastChip[]; max?: number }) {
  if (!chips.length) return null;
  const shown = chips.slice(0, max);
  return (
    <span className="cast-stack" data-cast={chips.map((chip) => chip.characterId).join(" ")}>
      {shown.map((chip) => <CastAvatar key={chip.characterId} name={chip.name} picture={chip.picture} approved={chip.approved} size="xs" />)}
      {chips.length > max ? <span className="cast-more">+{chips.length - max}</span> : null}
    </span>
  );
}
