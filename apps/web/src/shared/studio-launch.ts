/** Remove launch secrets before any network request; never store them or accept a redirect target. */
export function takeStudioLaunchCode(location: Pick<Location, "hash" | "pathname" | "search">, history: Pick<History, "replaceState">): string | undefined {
  if (!location.hash.startsWith("#connect=")) return;
  const code = location.hash.slice("#connect=".length);
  history.replaceState(null, "", location.pathname + location.search);
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error("This studio link is invalid. Run pnpm studio to open a fresh window.");
  return code;
}
