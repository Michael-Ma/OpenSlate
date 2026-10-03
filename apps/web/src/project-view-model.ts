export type ProjectConnection = 'connecting' | 'connected' | 'reconnecting';
/** A background projection refresh is not a lost network connection. */
export function visibleProjectConnection(projectId: string, loadedProjectId: string, connection: ProjectConnection): ProjectConnection {
  return projectId && loadedProjectId === projectId ? connection : 'connecting';
}
