import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { readLocalePreference, resolveLocale } from "../shared/locale-preference.ts";
import { takeStudioLaunchCode } from "../shared/studio-launch.ts";
import { StudioClient } from "./api/client.ts";
import { Connect } from "./app/Connect.tsx";
import { NextApp } from "./app/NextApp.tsx";
import { I18nProvider } from "./i18n/I18n.tsx";
import type { MediaSource } from "./media/media-source.ts";
import { StudioProvider } from "./store/react.tsx";
import { StudioStore } from "./store/store.ts";
import "./ui/studio.css";

const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const newKey = () => crypto.randomUUID();

interface Session { store: StudioStore; media: MediaSource; mode: "live" | "fixture"; close(): void }

/**
 * A new session's store has read the film list (and opened a film) before it replaces the page, so a reconnect
 * from the session-expired dialog goes straight back to the studio instead of through the Connect screen.
 */
async function liveSession(): Promise<Session> {
  const client = await StudioClient.connect(takeStudioLaunchCode(window.location, window.history));
  const store = new StudioStore({ client, storage, newKey });
  client.onSessionExpired = () => store.dispatch({ type: "connection", connection: "expired" });
  const media: MediaSource = {
    url: (artifact, signal) => client.artifactUrl(store.getState().projectId ?? "", artifact, signal),
    revoke: (url) => URL.revokeObjectURL(url),
  };
  await store.start(new URLSearchParams(window.location.search).get("project"));
  return { store, media, mode: "live", close: () => { store.stop(); client.close(); } };
}

async function fixtureSession(): Promise<Session> {
  const { FixturePort, fixtureMedia } = await import("./fixtures/fixture-port.ts");
  const store = new StudioStore({ client: new FixturePort(), storage: null, newKey });
  void store.start();
  return { store, media: await fixtureMedia(), mode: "fixture", close: () => store.stop() };
}

function Root() {
  const [session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState(false);
  const fixture = new URLSearchParams(window.location.search).get("fixture") === "last-ferry";
  const latest = useRef(0);
  const shown = useRef(0);
  /**
   * Resolves true once this attempt's session replaced the page, false when it failed or a newer session is
   * already shown. Attempts can overlap (Try again, a new #connect= link, React's development double effect);
   * the newest one that connects wins, and an older one that connects later is closed.
   */
  const connect = useCallback(async (): Promise<boolean> => {
    const attempt = ++latest.current;
    setFailed(false);
    try {
      const next = await (fixture ? fixtureSession() : liveSession());
      if (attempt < shown.current) { next.close(); return false; }
      shown.current = attempt;
      setSession(next);
      return true;
    } catch {
      if (attempt === latest.current) setFailed(true);
      return false;
    }
  }, [fixture]);
  useEffect(() => {
    void connect();
    // A launcher can reuse this window with a fresh #connect= link.
    const onHash = () => { if (window.location.hash.startsWith("#connect=")) void connect(); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [connect]);
  if (!session) return <ConnectGate failed={failed} onRetry={connect} />;
  return (
    <StudioProvider value={session}>
      <NextApp onReconnect={connect} />
    </StudioProvider>
  );
}

function ConnectGate({ failed, onRetry }: { failed: boolean; onRetry(): unknown }) {
  return <Connect state={failed ? "failed" : "connecting"} onRetry={() => void onRetry()} />;
}

export function bootNext(root: HTMLElement) {
  const initialLocale = resolveLocale(window.location.search, readLocalePreference(storage), navigator.languages);
  document.documentElement.lang = initialLocale;
  createRoot(root).render(
    <StrictMode>
      <I18nProvider initialLocale={initialLocale}>
        <Root />
      </I18nProvider>
    </StrictMode>,
  );
}
