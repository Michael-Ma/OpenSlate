import { translate, translateUiText } from "./locale-model.ts";
import type { Locale } from "./locale-model.ts";
import { settingsUiTranslations } from "./settings-ui-translations.ts";
import {
  settingsBillingRoute,
  settingsSetupIssue,
} from "./settings-presentation-model.ts";
import { providerEstimate } from "./provider-model.ts";
import type { ProviderView } from "./provider-model.ts";
import type { ProjectSnapshot } from "./model.ts";
import type { DirectorPlanView } from "./director-plan-model.ts";
import { planScopeLabel } from "./director-plan-model.ts";
import { currentProjectAttempts } from "./production-evidence-model.ts";
const ui = (text: string, locale: Locale) =>
  translateUiText(text, locale, settingsUiTranslations);
/** Account routes/setup copy are controlled labels. Provider/model names are never passed here. */
export function settingsAccountLine(
  provider: ProviderView,
  locale: Locale,
): string {
  const route = ui(settingsBillingRoute(provider), locale),
    issue = settingsSetupIssue(provider);
  if (issue) return `${route} · ${ui(issue, locale)}`;
  if (provider.profile?.adapter === "fake")
    return ui("Demo · no model calls", locale);
  return `${route} · ${ui(provider.readiness.credential.required ? "key saved" : "configured", locale)}`;
}
export function settingsEstimate(
  provider: ProviderView,
  locale: Locale,
): string {
  const source = providerEstimate(provider),
    prefix = "Configured estimate: $",
    suffix = " USD / attempt";
  if (source.startsWith(prefix) && source.endsWith(suffix))
    return translate(
      locale,
      "Configured estimate: ${amount} USD / attempt",
      "配置的预估：每次 ${amount} 美元",
      { amount: source.slice(prefix.length, -suffix.length) },
    );
  return ui(source, locale);
}
export function settingsScopeLabel(
  snapshot: ProjectSnapshot,
  scopeIds: readonly string[],
  locale: Locale,
): string {
  if (locale === "en") return planScopeLabel(snapshot, scopeIds);
  if (scopeIds.includes(snapshot.project.id)) return ui("Whole film", locale);
  return [...new Set(scopeIds)]
    .map((id) => {
      const sceneIndex = snapshot.project.scenes.findIndex(
        (scene) => scene.id === id,
      );
      if (sceneIndex >= 0)
        return translate(locale, "Scene {number}", "场景 {number}", {
          number: sceneIndex + 1,
        });
      const shot = snapshot.project.shots.find((shot) => shot.id === id);
      if (!shot) return ui("Saved scope", locale);
      const scene = snapshot.project.scenes.findIndex(
          (scene) => scene.id === shot.sceneId,
        ),
        index = snapshot.project.shots
          .filter((peer) => peer.sceneId === shot.sceneId)
          .findIndex((peer) => peer.id === id);
      return translate(locale, "Shot {number}", "镜头 {number}", {
        number:
          scene >= 0
            ? `${scene + 1}.${index + 1}`
            : snapshot.project.shots.indexOf(shot) + 1,
      });
    })
    .join("，");
}
/** Translate model-owned copy only. Human question headers and saved directions remain untouched. */
export function settingsPlanCopy(
  snapshot: ProjectSnapshot,
  plan: DirectorPlanView,
  locale: Locale,
) {
  const labels: Record<string, string> = { ...settingsUiTranslations };
  const active = currentProjectAttempts(snapshot).filter((attempt) =>
    ["preparing", "submitting", "remote_pending", "ingesting"].includes(
      attempt.phase,
    ),
  ).length;
  if (active)
    labels[
      `${active} ${active === 1 ? "job is" : "jobs are"} being prepared, generated or saved.`
    ] = `${active} 个任务正在准备、生成或保存。`;
  if (plan.edits.length > 1)
    labels[`${plan.edits.length} saved edits need a next step`] =
      `${plan.edits.length} 个已保存编辑需要继续处理`;
  const plural = (n: number, name: string) =>
    `${n} ${name}${n === 1 ? "" : "s"}`;
  const en: string[] = [],
    zh: string[] = [];
  if (snapshot.project.scenes.length || snapshot.project.shots.length) {
    en.push(
      plural(snapshot.project.scenes.length, "scene"),
      plural(snapshot.project.shots.length, "shot"),
    );
    zh.push(
      `${snapshot.project.scenes.length} 个场景`,
      `${snapshot.project.shots.length} 个镜头`,
    );
  } else if (snapshot.project.brief.trim()) {
    en.push("Your brief");
    zh.push("创作简报");
  } else if (snapshot.messages.length || snapshot.conversation?.length) {
    en.push("This conversation");
    zh.push("本次对话");
  } else {
    en.push("Project");
    zh.push("项目");
  }
  const currentPlan =
    snapshot.plan?.id === snapshot.project.activePlanId ? snapshot.plan : null;
  const artifacts = new Map(
    snapshot.outputs
      .filter((output) =>
        currentPlan?.nodes?.some((node) => node.id === output.nodeId),
      )
      .map((output) => [output.artifact.artifactId, output.artifact]),
  );
  const images = [...artifacts.values()].filter(
      (artifact) => artifact.kind === "image",
    ).length,
    videos = [...artifacts.values()].filter(
      (artifact) => artifact.kind === "video",
    ).length;
  if (images) {
    en.push(plural(images, "image"));
    zh.push(`${images} 张图片`);
  }
  if (videos) {
    en.push(plural(videos, "video"));
    zh.push(`${videos} 个视频`);
  }
  labels[`${en.join(" · ")} saved.`] = `${zh.join(" · ")}已保存。`;
  const question = snapshot.questions?.find(
    (row) => row.state === "pending" && row.canAnswer !== false,
  );
  const humanHeader =
    plan.state === "question" &&
    question?.questions.map((row) => row.header).join(" · ");
  return {
    title: translateUiText(plan.title, locale, labels),
    detail: humanHeader
      ? plan.detail
      : translateUiText(plan.detail, locale, labels),
    saved: translateUiText(plan.saved, locale, labels),
    next: translateUiText(plan.next, locale, labels),
    actionLabel: plan.actionLabel
      ? translateUiText(plan.actionLabel, locale, labels)
      : undefined,
  };
}

/** A contextual count avoids ambiguous reverse labels or unfilled plural placeholders. */
export function settingsMediaAccountCount(
  count: number,
  locale: Locale,
): string {
  return translate(
    locale,
    count === 1 ? "{count} media account" : "{count} media accounts",
    "{count} 个媒体账号",
    { count },
  );
}
