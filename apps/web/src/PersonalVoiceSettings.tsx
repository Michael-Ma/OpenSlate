import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { ApiError } from './api';
import type { StudioApi } from './api';
import type { PendingCommand } from './pending-command';
import { pendingCommandsFor } from './pending-command';
import { PersonalVoicePanel } from './PersonalVoicePanel';
import { useRecoveryReadOnly } from './RecoveryPanel';
import { errorText } from './components';

export function PersonalVoiceSettings({ api, projectId, busyChanged }:
  { api: StudioApi; projectId: string; busyChanged?(busy: boolean): void }) {
  const registry = pendingCommandsFor(api, 'personal-voices'), recovery = useRecoveryReadOnly();
  const slot = useSyncExternalStore(useCallback(listener => registry.subscribe(projectId,listener),[registry,projectId]),
    useCallback(() => registry.snapshot(projectId),[registry,projectId]));
  useEffect(() => { busyChanged?.(slot.running || !!slot.command); return () => busyChanged?.(false); },[slot.running,slot.command,busyChanged]);
  const execute = (command: PendingCommand) => {
    if (recovery) return;
    void registry.run(projectId,command,saved=>api.request(saved.path,{method:'POST',body:saved.body,key:saved.key}),
      error=>!(error instanceof ApiError)||['NETWORK_ERROR','INTERNAL_ERROR','REQUEST_FAILED'].includes(error.code));
  };
  return <section className="personal-voice-settings">
    <PersonalVoicePanel api={api} projectId={projectId} disabled={recovery || slot.running || !!slot.command} completion={slot} execute={execute} />
    {slot.command && <p role="status">{slot.running ? 'Saving voice setup…' : 'This outcome is unconfirmed. Check the same saved request.'}</p>}
    {slot.command && !slot.running && <button className="button" disabled={recovery} onClick={()=>execute(slot.command!)}>Check the same voice request</button>}
    {!!slot.error && <p role="alert">{errorText(slot.error)}</p>}
  </section>;
}
