import { TabNav } from "@radix-ui/themes";
import { Icon } from "./components";
export type WorkspaceView = "plan" | "frames" | "assets" | "cut";
const views = [
  { value: "plan", label: "计划", icon: "list" },
  { value: "frames", label: "关键帧", icon: "frames" },
  { value: "assets", label: "素材", icon: "folder" },
  { value: "cut", label: "成片", icon: "timeline" },
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
  return (
    <TabNav.Root className="workspace-views" aria-label="工作区视图">
      {views.map((view) => (
        <TabNav.Link key={view.value} active={value === view.value} asChild>
          <button type="button" onClick={() => onChange(view.value)}>
            <Icon name={view.icon} size={16} />
            {view.label}
            {view.value === "assets" && assetCount !== undefined && (
              <small>{assetCount}</small>
            )}
          </button>
        </TabNav.Link>
      ))}
    </TabNav.Root>
  );
}
