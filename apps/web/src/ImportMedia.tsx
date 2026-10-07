import { useTranslation } from "./Locale";
import { settingsUiTranslations } from "./settings-ui-translations";
import { useState } from "react";
import { Tabs } from "@radix-ui/themes";
import { AppDialog } from "./ui";
import type { ReactNode } from "react";
export function ImportMedia({
  children,
  close,
  title = "Import media",
}: {
  children: ReactNode;
  title?: string;
  close(): void;
}) {
  const { t, ui } = useTranslation();

  return (
    <AppDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={ui(title, settingsUiTranslations)}
      className="studio-media-dialog"
      closeLabel={t("Close media import", "关闭媒体导入")}
    >
      {children}
    </AppDialog>
  );
}
export function ImportTabs({
  image,
  video,
  audio,
  initialTab = "image",
  onTabChange,
}: {
  onTabChange?(tab: "image" | "video" | "audio"): void;
  initialTab?: "image" | "video" | "audio";
  image: ReactNode;
  video: ReactNode;
  audio: ReactNode;
}) {
  const { t } = useTranslation();

  const [tab, setTab] = useState(initialTab);
  return (
    <Tabs.Root
      value={tab}
      onValueChange={(value) => {
        const next = value as "image" | "video" | "audio";
        setTab(next);
        onTabChange?.(next);
      }}
    >
      <Tabs.List aria-label={t("Media type", "媒体类型")}>
        {(["image", "video", "audio"] as const).map((kind) => (
          <Tabs.Trigger key={kind} value={kind}>
            {kind === "image"
              ? t("Image", "图片")
              : kind === "video"
                ? t("Video", "视频")
                : t("Audio", "音频")}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <Tabs.Content value="image" forceMount hidden={tab !== "image"}>
        {image}
      </Tabs.Content>
      <Tabs.Content value="video" forceMount hidden={tab !== "video"}>
        {video}
      </Tabs.Content>
      <Tabs.Content value="audio" forceMount hidden={tab !== "audio"}>
        {audio}
      </Tabs.Content>
    </Tabs.Root>
  );
}
