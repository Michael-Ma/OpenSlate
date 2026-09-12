/** Supervisor/native reasoning adapter remains pending; skills and MCP transport are implemented below. */
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

export * from "./skills/index.js";
export * from "./tools/index.js";
