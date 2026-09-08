/** Initial boundary only. The Codex adapter and event/tool protocols are planned. */
export interface DirectorSession {
  id: string;
  projectId: string;
}

export interface DirectorRuntime {
  readonly id: string;
  createSession(projectId: string): Promise<DirectorSession>;
  resumeSession(sessionId: string): Promise<DirectorSession>;
  interrupt(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}
