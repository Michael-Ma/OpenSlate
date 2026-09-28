import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { IconButton } from './components';
export function ImportMedia({ children, close, title = 'Import media' }: { children: ReactNode; title?: string; close(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="studio-media-dialog" onCancel={close}><header className="section-heading"><h2>{title}</h2><IconButton label="Close media import" onClick={close} /></header>{children}</dialog>;
}
export function ImportTabs({ image, video, audio, initialTab = 'image' }: { initialTab?: 'image' | 'video' | 'audio'; image: ReactNode; video: ReactNode; audio: ReactNode }) {
  const [tab, setTab] = useState(initialTab);
  return <><div className="tabs">{['image','video','audio'].map(kind => <button className={tab === kind ? 'active' : ''} aria-pressed={tab === kind} key={kind} onClick={() => setTab(kind as 'image' | 'video' | 'audio')}>{kind[0]!.toUpperCase()+kind.slice(1)}</button>)}</div><div hidden={tab !== 'image'}>{image}</div><div hidden={tab !== 'video'}>{video}</div><div hidden={tab !== 'audio'}>{audio}</div></>;
}
