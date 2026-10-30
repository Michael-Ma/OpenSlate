import { browserPreference } from "./browserPreference.ts";

/**
 * Developer mode (Settings › This computer): shows a code-plan film's program (the Code tab and its mentions). A
 * browser preference like the language, off by default.
 */
export const DEVELOPER_STORAGE_KEY = "openslate.developerMode";

const preference = browserPreference(DEVELOPER_STORAGE_KEY);

export const readDeveloperMode = (store?: Pick<Storage, "getItem"> | null): boolean => preference.read(store) === "on";
export const setDeveloperMode = (on: boolean, store?: Pick<Storage, "setItem" | "removeItem"> | null): boolean => preference.write(on ? "on" : null, store);
export const useDeveloperMode = (): boolean => preference.use() === "on";
