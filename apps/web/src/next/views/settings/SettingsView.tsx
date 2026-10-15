import { useEffect, useState, type MouseEvent } from "react";
import type { Locale } from "../../../shared/locale-preference.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import type { ModelSettingsStatus, ProviderCatalogView } from "../../model/settings.ts";
import type { DirectorReview, DirectorSetup } from "../../model/settings-director.ts";
import type { PersonalVoices, VoiceSetting } from "../../model/settings-voice.ts";
import { searchWithLocale } from "../../model/shell.ts";
import { useStudio } from "../../store/react.tsx";
import { useResource } from "../../store/useResource.ts";
import { ComputerPanel } from "./ComputerPanel.tsx";
import { DirectorPanel } from "./DirectorPanel.tsx";
import { ModelsPanel } from "./ModelsPanel.tsx";
import { NoFilmPanel, onRadioKeys, Panel, radioTab } from "./parts.tsx";
import { useRead } from "./useRead.ts";
import { VoicePanel } from "./VoicePanel.tsx";
import "./settings.css";

const SECTIONS: { id: string; label: MessageId; group: "film" | "everywhere" }[] = [
  { id: "set-models", label: "set.section.models", group: "film" },
  { id: "set-director", label: "set.section.director", group: "film" },
  { id: "set-voice", label: "set.section.voice", group: "film" },
  { id: "set-computer", label: "set.section.computer", group: "everywhere" },
  { id: "set-language", label: "set.section.language", group: "everywhere" },
];

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Settings (SB-23, SB-24, D4, D15), reached from the gear in the top bar. One page, not a chat card: the film's
 * models, Director and voice first, then this computer and the language, with a section index on the left.
 * With no film open (the gear on Start) the film sections say so, and the page opens at This computer.
 */
export function SettingsView() {
  const { t } = useI18n();
  const hasFilm = useStudio((s) => !!s.projectId);
  const film = useStudio((s) => s.snapshot?.project.name ?? s.projects.find((p) => p.id === s.projectId)?.name ?? "");
  const connection = useStudio((s) => s.connection);
  const offline = connection === "connected" ? null : t("set.offline");
  const models = useResource<ModelSettingsStatus>("/settings/models");
  const setup = useResource<DirectorSetup>("/director/setup");
  const review = useRead<DirectorReview>("/settings/director-review");
  const voice = useResource<VoiceSetting>("/settings/voice");
  const personal = useResource<PersonalVoices>("/narration/personal-voices");
  // The installed catalog belongs to this computer, not to a film.
  const providers = useRead<ProviderCatalogView>("/api/providers", { film: false });
  const [section, setSection] = useState(hasFilm ? "set-models" : "set-computer");

  // Without a film, open at This computer, as the study's gear on Start does (settings.html#computer).
  useEffect(() => {
    if (hasFilm) return;
    setSection("set-computer");
    document.getElementById("set-computer")?.scrollIntoView({ block: "start" });
  }, [hasFilm]);

  const go = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    setSection(id);
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    // Keyboard users land on the section's heading.
    target?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  };

  const link = (entry: (typeof SECTIONS)[number]) => (
    <a key={entry.id} href={`#${entry.id}`} data-act="section" data-section={entry.id} aria-current={section === entry.id ? "true" : undefined} onClick={go(entry.id)}>
      {t(entry.label)}
    </a>
  );

  return (
    <main className="work set-view" data-view="settings">
      <div className="view-head">
        <h1 tabIndex={-1}>{t("set.title")}</h1>
        <span className="line">{hasFilm ? t("set.scope_line", { film }) : t("set.scope_line_no_film")}</span>
      </div>
      <div className="set-grid">
        <nav className="set-index" aria-label={t("set.index")}>
          <span className="grp">{t("set.index.film")}</span>
          {SECTIONS.filter((s) => s.group === "film").map(link)}
          <span className="grp">{t("set.index.everywhere")}</span>
          {SECTIONS.filter((s) => s.group === "everywhere").map(link)}
        </nav>
        <div className="set-sections">
          {hasFilm ? (
            <>
              <ModelsPanel models={models} setup={setup} film={film} offline={offline} />
              <DirectorPanel setup={setup} review={review} film={film} offline={offline} />
              <VoicePanel voice={voice} personal={personal} film={film} offline={offline} />
            </>
          ) : (
            <>
              <NoFilmPanel id="set-models" title="set.section.models" lead="set.no_film.models" />
              <NoFilmPanel id="set-director" title="set.section.director" lead="set.no_film.director" />
              <NoFilmPanel id="set-voice" title="set.section.voice" lead="set.no_film.voice" />
            </>
          )}
          <ComputerPanel providers={providers} setup={setup} hasFilm={hasFilm} offline={offline} />
          <LanguagePanel />
        </div>
      </div>
    </main>
  );
}

/** English or 中文, kept in this browser. Prompts and the Director's words stay in their own language. */
function LanguagePanel() {
  const { t, locale, setLocale } = useI18n();
  const choose = (next: Locale) => {
    if (next === locale) return;
    const search = searchWithLocale(window.location.search, next);
    if (search !== null) {
      try { window.history.replaceState(window.history.state, "", window.location.pathname + search + window.location.hash); } catch { /* history unavailable */ }
    }
    setLocale(next);
  };
  return (
    <Panel id="set-language" title="set.section.language" scope={t("set.scope.browser")}>
      <div className="srow">
        <div className="txt">
          <b id="set-lang-l">{t("set.lang.label")}</b>
          <span>{t("set.lang.hint")}</span>
        </div>
        <span className="segctl" role="radiogroup" aria-labelledby="set-lang-l" onKeyDown={onRadioKeys}>
          <button type="button" role="radio" lang="en" aria-checked={locale === "en"} tabIndex={radioTab(locale === "en")} data-act="set-language" data-v="en" onClick={() => choose("en")}>{t("set.lang.en")}</button>
          <button type="button" role="radio" lang="zh-CN" aria-checked={locale === "zh-CN"} tabIndex={radioTab(locale === "zh-CN")} data-act="set-language" data-v="zh-CN" onClick={() => choose("zh-CN")}>{t("set.lang.zh")}</button>
        </span>
      </div>
    </Panel>
  );
}
