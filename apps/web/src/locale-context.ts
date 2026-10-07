import { createContext, useCallback, useContext } from "react";
import { translate, translateUiText } from "./locale-model.ts";
import type {
  Locale,
  TranslationValues,
  UiTranslations,
} from "./locale-model.ts";
import { commonUiTranslations } from "./locale-ui-messages.ts";
type LocaleValue = { locale: Locale; setLocale(locale: Locale): void };
export const LocaleContext = createContext<LocaleValue>({
  locale: "en",
  setLocale: () => {},
});
export function useTranslation() {
  const { locale, setLocale } = useContext(LocaleContext);
  const t = useCallback(
    (english: string, chinese: string, values?: TranslationValues) =>
      translate(locale, english, chinese, values),
    [locale],
  );
  const ui = useCallback(
    (text: string, extra?: UiTranslations) =>
      translateUiText(
        text,
        locale,
        extra ? { ...commonUiTranslations, ...extra } : commonUiTranslations,
      ),
    [locale],
  );
  return { locale, setLocale, t, ui };
}
