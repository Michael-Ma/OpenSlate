import { useI18n } from "../i18n/I18n.tsx";
import { CHECK_MARK } from "../model/checks.ts";
import type { CastCheck, CastChip } from "../model/cast.ts";
import { listLabels } from "../model/keyframes.ts";
import { useStore } from "../store/react.tsx";
import { requestSheetReview } from "../views/plan/cast-open.ts";
import { BannerFrame } from "./BannerFrame.tsx";
import { CastAvatar } from "./CastAvatar.tsx";

/**
 * The cast check before Make keyframes (docs/ai/characters §2.8): a recurring character in this scene has no approved
 * sheet, so its keyframes would draw them without a reference. App-computed, so neutral (never the Director's amber).
 * Review sheet opens the character's sheet review in Plan › Cast; Not now leaves it for this scene until the page reloads.
 */
export function CastBanner({ check, total, chip, onLater }: { check: CastCheck; total: number; chip: CastChip | null; onLater(): void }) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  return (
    <BannerFrame
      tone="check"
      state="open"
      letter={CHECK_MARK}
      eyebrow={total > 1 ? `${t("cast.check.eyebrow")} · ${t("check.of", { index: 1, total })}` : t("cast.check.eyebrow")}
      title={tm(check.title)}
      sub={tm(check.body)}
      anchor={{ attribute: "data-check", value: `cast:${check.characterId}` }}
      extra={
        <div className="cast-check-faces">
          <CastAvatar name={check.name} picture={chip?.picture ?? null} approved={false} size="sm" />
          <span>{t("cast.check.in_scene", { shots: listLabels(check.sceneShots, locale) })}</span>
        </div>
      }
      actions={
        <>
          <button type="button" className="pill chosen" data-act="cast-review" data-character={check.characterId} onClick={() => requestSheetReview(store, check.characterId)}>{t("cast.check.review")}</button>
          <button type="button" className="pill ghost" data-act="cast-later" data-character={check.characterId} onClick={onLater}>{t("cast.check.later")}</button>
        </>
      }
    />
  );
}
