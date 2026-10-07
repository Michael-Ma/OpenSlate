import { useTranslation } from "./Locale";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Theme } from "@radix-ui/themes";
import { Icon } from "./components";
import {
  appearanceHref,
  appearanceMode,
  persistAppearancePreference,
  readAppearancePreference,
  resolveAppearance,
} from "./appearance-model";
import type { AppearanceMode } from "./appearance-model";

type AppearanceContextValue = {
  appearance: AppearanceMode;
  setAppearance: (mode: AppearanceMode) => void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);
function preferenceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
/** Set before React's first paint so a saved Night preference does not flash Day. */
export function initializeAppearance(): AppearanceMode {
  const mode =
    typeof window === "undefined"
      ? "day"
      : resolveAppearance(
          window.location.search,
          readAppearancePreference(preferenceStorage()),
        );
  if (typeof document !== "undefined")
    document.documentElement.dataset.theme = mode;
  return mode;
}
export function StudioTheme({
  children,
  initialAppearance,
}: {
  children: ReactNode;
  initialAppearance?: AppearanceMode;
}) {
  const [appearance, changeAppearance] = useState<AppearanceMode>(
    () => initialAppearance ?? initializeAppearance(),
  );
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = appearance;
  }, [appearance]);
  const setAppearance = useCallback((mode: AppearanceMode) => {
    if (!appearanceMode(mode)) return;
    changeAppearance(mode);
    persistAppearancePreference(preferenceStorage(), mode);
    // Some embedded/private browsers prohibit history writes. Appearance still works.
    try {
      window.history.replaceState(
        window.history.state,
        "",
        appearanceHref(window.location.href, mode),
      );
    } catch {
      /* Keep the in-memory choice. */
    }
  }, []);
  useEffect(() => {
    const onPopState = () =>
      changeAppearance(
        resolveAppearance(
          window.location.search,
          readAppearancePreference(preferenceStorage()),
        ),
      );
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
  const value = useMemo(
    () => ({ appearance, setAppearance }),
    [appearance, setAppearance],
  );
  return (
    <AppearanceContext.Provider value={value}>
      <Theme
        appearance={appearance === "night" ? "dark" : "light"}
        accentColor="violet"
        grayColor="gray"
        radius="medium"
        scaling="100%"
        className="openslate-theme"
      >
        {children}
      </Theme>
    </AppearanceContext.Provider>
  );
}
export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context)
    throw new Error("Appearance controls must be inside StudioTheme");
  return context;
}
export function AppearanceSwitch() {
  const { t, ui } = useTranslation();
  const { appearance, setAppearance } = useAppearance();
  return (
    <div
      className="appearance-switch"
      role="group"
      aria-label={t("Workspace appearance", "工作区外观")}
    >
      <button
        type="button"
        aria-pressed={appearance === "day"}
        onClick={() => setAppearance("day")}
      >
        <Icon name="sun" size={14} />
        <span>{t("Day", "日间")}</span>
      </button>
      <button
        type="button"
        aria-pressed={appearance === "night"}
        onClick={() => setAppearance("night")}
      >
        <Icon name="moon" size={14} />
        <span>{t("Night", "夜间")}</span>
      </button>
    </div>
  );
}
