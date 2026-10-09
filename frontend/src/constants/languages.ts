/** Languages a build (minor chapter) can be authored in. */

export type LanguageId = 'go' | 'python' | 'cpp';

export const LANGUAGE_LABELS: Record<LanguageId, string> = {
  go: 'Go',
  python: 'Python',
  cpp: 'C++',
};

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGE_LABELS, value);
}
