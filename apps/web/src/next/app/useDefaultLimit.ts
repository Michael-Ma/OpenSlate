import { browserPreference } from "./browserPreference.ts";

/** The spend limit a new code-plan film starts with (Settings › This computer), in micro-dollars. A browser preference. */
export const DEFAULT_LIMIT_STORAGE_KEY = "openslate.defaultSpendLimit";
export const STANDARD_LIMIT_MICROS = "4000000";

const preference = browserPreference(DEFAULT_LIMIT_STORAGE_KEY);
const valid = (value: string | null): string | null => (value && /^[1-9]\d{0,14}$/.test(value) ? value : null);

export const readDefaultLimit = (store?: Pick<Storage, "getItem"> | null): string | null => valid(preference.read(store));
export const setDefaultLimit = (micros: string | null, store?: Pick<Storage, "setItem" | "removeItem"> | null): boolean => preference.write(micros, store);
export const useDefaultLimit = (): string => valid(preference.use()) ?? STANDARD_LIMIT_MICROS;
