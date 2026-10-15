/** The dev server's API target. Port 3001 is a live studio with real projects; reaching it must be an explicit opt-in. */
export const DEFAULT_API_ORIGIN = "http://127.0.0.1:3101";

export function apiProxyTarget(env: Record<string, string | undefined>): string {
  return env.OPENSLATE_API_ORIGIN ?? DEFAULT_API_ORIGIN;
}
