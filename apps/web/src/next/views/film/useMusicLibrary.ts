import { useEffect, useMemo, useState } from "react";
import { libraryRecordings, type AudioLibraryView, type MusicRecording } from "../../model/film.ts";
import { useStore } from "../../store/react.tsx";
import { useResource } from "../../store/useResource.ts";

const PATH = "/audio-library?role=music";
/** More than enough pages for a film's music (the server pages by 40). */
const MAX_PAGES = 25;

/**
 * The film's music-role recordings, every page (SB-24): the first page is the view's own resource and is read
 * again on every event; the pages after it are read when the first one says there are more. Until they arrive
 * the earlier pages stay, so the music lane keeps its name. Null until the first page arrives.
 */
export function useMusicLibrary(): MusicRecording[] | null {
  const store = useStore();
  const first = useResource<AudioLibraryView>(PATH);
  const [rest, setRest] = useState<MusicRecording[]>([]);
  const page = first.data;
  useEffect(() => {
    const next = page?.coverage?.nextOffset;
    if (next == null) return;
    const controller = new AbortController();
    void (async () => {
      const found: MusicRecording[] = [];
      let offset: number | null = next;
      try {
        for (let n = 0; offset !== null && n < MAX_PAGES; n++) {
          const view: AudioLibraryView = await store.read<AudioLibraryView>(`${PATH}&offset=${offset}`, controller.signal);
          found.push(...view.recordings);
          offset = view.coverage?.nextOffset ?? null;
        }
        if (!controller.signal.aborted) setRest(found);
      } catch {
        // The library changed between pages, or a read failed: keep the pages read before; the next event reads again.
      }
    })();
    return () => controller.abort();
  }, [store, page]);
  return useMemo(() => (page ? libraryRecordings(page, rest) : null), [page, rest]);
}
