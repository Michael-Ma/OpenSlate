import { TabNav } from "@radix-ui/themes";

export type WorkspaceView = "storyboard" | "assets" | "preview";
const views = [
  { value: "storyboard", label: "Project", icon: "slate" },
  { value: "assets", label: "Assets", icon: "folder" },
  { value: "preview", label: "Timeline", icon: "play" },
] as const;
interface Props {
  value: WorkspaceView;
  onChange(view: WorkspaceView): void;
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
