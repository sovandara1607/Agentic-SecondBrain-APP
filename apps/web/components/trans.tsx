"use client";

import { useLocale } from "@/lib/i18n/locale-provider";
import type { DictionaryKey } from "@/lib/i18n/dictionary";

/**
 * Drop-in translated text for use inside a Server Component (most
 * page.tsx headers are async Server Components, which can't call
 * useLocale() directly - locale only lives in localStorage, not
 * anything the server can read at render time). Renders the English
 * string on first paint (matches the server-rendered HTML, avoiding a
 * hydration mismatch) and swaps to the translated one on mount, same
 * "client catches up a beat after first paint" pattern as ThemeToggle/
 * LanguageSwitcher's own state.
 */
export function Trans({ id }: { id: DictionaryKey }) {
  const { t } = useLocale();
  return <>{t(id)}</>;
}
