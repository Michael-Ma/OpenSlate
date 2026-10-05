import { TabNav } from "@radix-ui/themes";
import { Icon, IconButton } from "./components";
import { UiButton } from "./ui";

export type WorkspaceView = "storyboard" | "assets" | "preview";
const views = [
  { value: "storyboard", label: "Storyboard", icon: "slate" },
  { value: "assets", label: "Assets", icon: "folder" },
  { value: "preview", label: "Timeline", icon: "play" },
] as const;
interface Props {
  value: WorkspaceView;
  onChange(view: WorkspaceView): void;
}

export function WorkspaceRail({
  value,
  onChange,
  onSettings,
}: Props & { onSettings(): void }) {
  return (
    <nav className="workspace-navigation" aria-label="Studio views">
      {views.map((view) => (
        <UiButton
          key={view.value}
          className={`rail-action ${value === view.value ? "active" : ""}`}
          aria-label={view.label}
          title={view.label}
          aria-current={value === view.value ? "page" : undefined}
          onClick={() => onChange(view.value)}
        >
          <Icon name={view.icon} size={19} />
          <span>{view.label}</span>
        </UiButton>
      ))}
      <div className="rail-bottom">
        <IconButton
          icon="settings"
          label="Project settings"
          onClick={onSettings}
        />
      </div>
    </nav>
  );
}
export function WorkspaceViewTabs({ value, onChange }: Props) {
  return (
    <TabNav.Root className="workspace-views" aria-label="Workspace views">
      {views.map((view) => (
        <TabNav.Link key={view.value} active={value === view.value} asChild>
          <button type="button" onClick={() => onChange(view.value)}>
            {view.label}
          </button>
        </TabNav.Link>
      ))}
    </TabNav.Root>
  );
}
