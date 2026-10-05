import { useState } from 'react';
import { Tabs } from '@radix-ui/themes';
import { AppDialog } from './ui';
import type { ReactNode } from 'react';
export function ImportMedia({ children, close, title = 'Import media' }: { children: ReactNode; title?: string; close(): void }) {
  return <AppDialog open onOpenChange={open => { if (!open) close(); }} title={title} className="studio-media-dialog" closeLabel="Close media import">{children}</AppDialog>;
}
export function ImportTabs({ image, video, audio, initialTab = 'image', onTabChange }: { onTabChange?(tab: 'image' | 'video' | 'audio'): void; initialTab?: 'image' | 'video' | 'audio'; image: ReactNode; video: ReactNode; audio: ReactNode }) {
  const [tab, setTab] = useState(initialTab);
  return <Tabs.Root value={tab} onValueChange={value => { const next = value as 'image' | 'video' | 'audio'; setTab(next); onTabChange?.(next); }}><Tabs.List aria-label="Media type">{(['image','video','audio'] as const).map(kind => <Tabs.Trigger key={kind} value={kind}>{kind[0]!.toUpperCase()+kind.slice(1)}</Tabs.Trigger>)}</Tabs.List><Tabs.Content value="image" forceMount hidden={tab !== 'image'}>{image}</Tabs.Content><Tabs.Content value="video" forceMount hidden={tab !== 'video'}>{video}</Tabs.Content><Tabs.Content value="audio" forceMount hidden={tab !== 'audio'}>{audio}</Tabs.Content></Tabs.Root>;
}
