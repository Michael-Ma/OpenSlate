import { StrictMode, useCallback, useEffect, useState } from "react";
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

interface Session { store: StudioStore; media: MediaSource; mode: "live" | "fixture" }

async function liveSession(): Promise<Session> {
  const client = await StudioClient.connect(takeStudioLaunchCode(window.location, window.history));
  const store = new StudioStore({ client, storage, newKey });
  client.onSessionExpired = () => store.dispatch({ type: "connection", connection: "expired" });
  const media: MediaSource = {
    url: (artifact, signal) => client.artifactUrl(store.getState().projectId ?? "", artifact, signal),
    revoke: (url) => URL.revokeObjectURL(url),
  };
  void store.start(new URLSearchParams(window.location.search).get("project"));
  return { store, media, mode: "live" };
}

async function fixtureSession(): Promise<Session> {
  const { FixturePort, fixtureMedia } = await import("./fixtures/fixture-port.ts");
  const store = new StudioStore({ client: new FixturePort(), storage: null, newKey });
  void store.start();
  return { store, media: await fixtureMedia(), mode: "fixture" };
}

function Root() {
  const [session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState(false);
  const fixture = new URLSearchParams(window.location.search).get("fixture") === "last-ferry";
  const connect = useCallback(() => {
    setFailed(false);
    (fixture ? fixtureSession() : liveSession()).then(setSession, () => setFailed(true));
  }, [fixture]);
  useEffect(() => {
    connect();
    // A launcher can reuse this window with a fresh #connect= link.
    const onHash = () => { if (window.location.hash.startsWith("#connect=")) connect(); };
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

function ConnectGate({ failed, onRetry }: { failed: boolean; onRetry(): void }) {
  return <Connect state={failed ? "failed" : "connecting"} onRetry={onRetry} />;
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
