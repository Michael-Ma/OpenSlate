import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { Locale } from "../../../shared/locale-preference.ts";
import { useRecoveryLock } from "../../app/useWriteGuard.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import { activeSection, type ModelSettingsStatus, type ProviderCatalogView } from "../../model/settings.ts";
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
  const projectId = useStudio((s) => s.projectId);
  const hasFilm = !!projectId;
  const film = useStudio((s) => s.snapshot?.project.name ?? s.projects.find((p) => p.id === s.projectId)?.name ?? "");
  const connection = useStudio((s) => s.connection);
  // A restored studio in recovery review is read-only (app/useWriteGuard.ts): its reason replaces the offline one for
  // anything that writes. Reads keep working, so a control that only reads (This computer's Check again) is off only
  // while the studio cannot be reached.
  const locked = useRecoveryLock();
  const unreachable = connection === "connected" ? null : t("set.offline");
  const offline = locked ?? unreachable;
  // What makes each section read again. A studio restart reconnects, so every follow includes the connection.
  const head = useStudio((s) => s.snapshot?.project.headVersion ?? s.overview?.headVersion ?? 0);
  const filmChanged = `${head}|${connection === "connected"}`;
  // The film's models and narrator change only with the film (both move its head version).
  const models = useRead<ModelSettingsStatus>("/settings/models", { follow: filmChanged });
  const voice = useRead<VoiceSetting>("/settings/voice", { follow: filmChanged });
  // The Director's state (busy, the setup check), the review setting and personal voices move without the head.
  const setup = useResource<DirectorSetup>("/director/setup");
  const review = useRead<DirectorReview>("/settings/director-review");
  const personal = useResource<PersonalVoices>("/narration/personal-voices");
  // The installed catalog belongs to this computer, not to a film: read on opening, Check again and a restart.
  const providers = useRead<ProviderCatalogView>("/api/providers", { film: false, follow: String(connection === "connected") });
  const [section, setSection] = useState(hasFilm ? "set-models" : "set-computer");
  /** The section last chosen in the index: it stays marked at the end of the scroll, where it cannot reach the top. */
  const chosen = useRef<string | null>(section);
  /** Until when the scroll is the index's own jump: the sections it passes on the way are not marked. */
  const jumping = useRef(0);

  // Without a film, open at This computer, as the study's gear on Start does (settings.html#computer).
  useEffect(() => {
    if (hasFilm) return;
    chosen.current = "set-computer";
    setSection("set-computer");
    document.getElementById("set-computer")?.scrollIntoView({ block: "start" });
  }, [hasFilm]);

  // The index follows the scroll: the section at the top of the page is marked, including after a form opens.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (Date.now() < jumping.current) return;
      const main = document.querySelector<HTMLElement>("main[data-view='settings']");
      if (!main) return;
      // From 900 px the workspace scrolls; below it the page does.
      const own = main.scrollHeight > main.clientHeight + 1 && getComputedStyle(main).overflowY !== "visible";
      const scroller = own ? main : document.scrollingElement ?? document.documentElement;
      const top = own ? main.getBoundingClientRect().top : 0;
      const bottom = own ? main.getBoundingClientRect().bottom : window.innerHeight;
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const panels = SECTIONS.flatMap((entry) => {
        const rect = document.getElementById(entry.id)?.getBoundingClientRect();
        return rect ? [{ id: entry.id, top: rect.top, bottom: rect.bottom }] : [];
      });
      const next = activeSection(panels, top + 24, bottom, atEnd, chosen.current);
      if (next) setSection(next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const landed = () => { jumping.current = 0; schedule(); };
    // Scroll events do not bubble, but they reach a capturing listener on the document from any scroller.
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    document.addEventListener("scrollend", landed, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      document.removeEventListener("scrollend", landed, { capture: true });
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const go = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    chosen.current = id;
    // A smooth jump passes other sections; mark the chosen one until it lands (scrollend), at most a second.
    jumping.current = Date.now() + 1000;
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
          {/* With no film open, these three are set for each film (as their panels say), not for "this film". */}
          <span className="grp">{t(hasFilm ? "set.index.film" : "set.index.each_film")}</span>
          {SECTIONS.filter((s) => s.group === "film").map(link)}
          <span className="grp">{t("set.index.everywhere")}</span>
          {SECTIONS.filter((s) => s.group === "everywhere").map(link)}
        </nav>
        <div className="set-sections">
          {hasFilm ? (
            <>
              <ModelsPanel key={`models:${projectId}`} models={models} setup={setup} film={film} offline={offline} />
              <DirectorPanel key={`director:${projectId}`} setup={setup} review={review} film={film} offline={offline} />
              <VoicePanel key={`voice:${projectId}`} voice={voice} personal={personal} film={film} offline={offline} />
            </>
          ) : (
            <>
              <NoFilmPanel id="set-models" title="set.section.models" lead="set.no_film.models" />
              <NoFilmPanel id="set-director" title="set.section.director" lead="set.no_film.director" />
              <NoFilmPanel id="set-voice" title="set.section.voice" lead="set.no_film.voice" />
            </>
          )}
          <ComputerPanel providers={providers} setup={setup} hasFilm={hasFilm} offline={unreachable} />
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
