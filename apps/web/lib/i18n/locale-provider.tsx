"use client";

import { createContext, use, useCallback, useEffect, useState } from "react";
import { DICTIONARY, type DictionaryKey, type Locale } from "./dictionary";

export const LOCALE_KEY = "second-brain:locale";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: DictionaryKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Mirrors components/theme-toggle.tsx's pattern exactly: a
 * beforeInteractive script (app/layout.tsx's LOCALE_INIT_SCRIPT) stamps
 * data-locale/lang onto <html> from localStorage before hydration, this
 * just reads that back once on mount rather than owning the source of
 * truth - same reasoning as ThemeToggle's isDark state.
 */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-locale");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(current === "km" ? "km" : "en");
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.setAttribute("data-locale", next);
    document.documentElement.lang = next;
    window.localStorage.setItem(LOCALE_KEY, next);
  }, []);

  const t = useCallback((key: DictionaryKey) => DICTIONARY[key][locale], [locale]);

  return <LocaleContext value={{ locale, setLocale, t }}>{children}</LocaleContext>;
}

export function useLocale() {
  const ctx = use(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
