import { useTranslation } from "./Locale";
import { TabNav } from "@radix-ui/themes";
import { Icon } from "./components";
export type WorkspaceView = "plan" | "frames" | "assets" | "cut";
const views = [
  { value: "plan", label: "Plan", chinese: "计划", icon: "list" },
  { value: "frames", label: "Keyframes", chinese: "关键帧", icon: "frames" },
  { value: "assets", label: "Assets", chinese: "素材", icon: "folder" },
  { value: "cut", label: "Film", chinese: "成片", icon: "timeline" },
] as const;
export function initialWorkspaceView(search: string): WorkspaceView {
  const value = new URLSearchParams(search).get("view");
  return views.some((v) => v.value === value)
    ? (value as WorkspaceView)
    : "frames";
}
export function WorkspaceViewTabs({
  value,
  onChange,
  assetCount,
}: {
  value: WorkspaceView;
  onChange(view: WorkspaceView): void;
  assetCount?: number;
}) {
  const { t } = useTranslation();

  return (
    <TabNav.Root
      className="workspace-views"
      aria-label={t("Workspace views", "工作区视图")}
    >
      {views.map((view) => (
        <TabNav.Link key={view.value} active={value === view.value} asChild>
          <button type="button" onClick={() => onChange(view.value)}>
            <Icon name={view.icon} size={16} />
            {t(view.label, view.chinese)}
            {view.value === "assets" && assetCount !== undefined && (
              <small>{assetCount}</small>
            )}
          </button>
        </TabNav.Link>
      ))}
    </TabNav.Root>
  );
}
