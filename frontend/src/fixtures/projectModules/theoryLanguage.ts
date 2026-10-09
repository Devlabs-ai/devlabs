import type { LanguageId } from '../../constants/languages';

const LANG_BLOCK = /<!--\s*lang:\s*([\w,\s]+?)\s*-->\n?([\s\S]*?)<!--\s*\/lang\s*-->\n?/g;

/**
 * Keeps the `<!-- lang: go -->…<!-- /lang -->` blocks of a shared theory file
 * that match `lang` and drops the rest. A block may list several languages:
 * `<!-- lang: go, cpp -->`. Text outside blocks is shared by every language.
 */
export function theoryForLanguage(theory: string, lang: LanguageId): string {
  return theory.replace(LANG_BLOCK, (_match, langs: string, body: string) =>
    langs
      .split(',')
      .map((l) => l.trim())
      .includes(lang)
      ? body
      : '',
  );
}
