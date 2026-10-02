import { useState } from 'react';
import type { StudioApi } from './api';
import type { DirectorStatus, ProjectSnapshot, ReviewSnapshot } from './model';
import type { SpendingState } from './spending-model';
import { generationStep } from './generation-guide-model';
import { GenerationPermission } from './GenerationPermission';
import { SpendingPanel } from './SpendingPanel';
import { IconButton } from './components';
import './generation-guide.css';

type PermissionBody = Parameters<typeof GenerationPermission>[0]['authorize'] extends (body: infer B) => void ? B : never;
export function GenerationGuide({ api, snapshot, review, director, disabled, authorize, onChanged, onChat, onFrames, onTimeline, onAudio, focus, active = true }:
  { api: StudioApi; snapshot: ProjectSnapshot; review: ReviewSnapshot | null; director: DirectorStatus; disabled: boolean;
    authorize(body: PermissionBody): void; onChanged(): void; onChat(): void; onFrames(): void; onTimeline(): void; onAudio(shotId: string): void;
    focus?: { candidateId: string; requestId: string }; active?: boolean }) {
  const [costs, setCosts] = useState<SpendingState | null>(null), [choose, setChoose] = useState(false);
  const baseStep = generationStep(snapshot, review, director, costs);
  const focused = focus && costs?.candidates.find(candidate => candidate.candidateId === focus.candidateId);
  const step = focused && (focused.operation === 'speech' || focused.operation === 'transcription')
    ? { ...baseStep, label: focused.operation === 'speech' ? 'Narration generation' : 'Recording transcription', detail: 'Review the exact recording work and its usage below.', action: 'costs' as const } : baseStep;
  const action = step.action === 'audio' && step.shotId ? () => onAudio(step.shotId!) : step.action === 'chat' ? onChat : step.action === 'frames' ? onFrames : step.action === 'timeline' ? onTimeline : null;
  return <section className="generation-guide" aria-label="Generation review">
    <ol className="generation-stages" aria-label="Production stages">{(['plan','frames','clips','export'] as const).map((stage,i) => <li key={stage} aria-current={step.stage === stage ? 'step' : undefined}><span>{i+1}</span>{['Plan','Keyframes','Clips','Export'][i]}</li>)}</ol>
    <div className="generation-next"><div><h4>{step.label}</h4><p>{step.detail}</p></div>{action && <IconButton icon={step.action === 'audio' ? 'settings' : step.action === 'chat' ? 'chat' : step.action === 'timeline' ? 'play' : 'image'} label={step.label} disabled={disabled} onClick={action} />}</div>
    <div hidden={!choose && step.action !== 'permission'}><GenerationPermission key={step.stage} {...(step.stage === "clips" ? { initialKinds: ["video"] } : {})} snapshot={snapshot} disabled={disabled} authorize={body => { setChoose(false); authorize(body); }} /></div>
    <div hidden={step.action !== 'costs' && !focus}><SpendingPanel active={active && (step.action === "costs" || !!focus)} api={api} snapshot={snapshot} onChanged={onChanged} onState={setCosts} guided {...(!focus && (step.stage === "frames" || step.stage === "clips") ? { operations: [step.stage === "frames" ? "image" : "video"] } : {})} {...(focus ? { focus } : {})} /></div>
    <details className="generation-options"><summary>Other generation options</summary><button className="text-button" disabled={disabled} onClick={() => setChoose(v => !v)}>{choose ? 'Hide shot selection' : 'Choose new shots or takes'}</button></details>
  </section>;
}
