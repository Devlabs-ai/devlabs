/** Strip common markdown markers for card excerpts and search snippets. */
export function markdownToPlainText(text: string | null | undefined): string {
  if (!text?.trim()) return '';
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Plain-text preview for list cards. Drops a leading heading when it repeats `title`.
 */
export function markdownExcerpt(
  text: string | null | undefined,
  { maxLen = 120, title = '' }: { maxLen?: number; title?: string } = {},
): string {
  if (!text?.trim()) return 'No description yet';
  let body = text.trim();
  const firstLine = body.split('\n')[0]?.trim() || '';
  if (/^#{1,6}\s/.test(firstLine)) {
    const heading = firstLine.replace(/^#+\s*/, '').trim();
    const t = (title || '').trim();
    if (t && heading.toLowerCase() === t.toLowerCase()) {
      body = body.slice(firstLine.length).trim();
    }
  }
  const plain = markdownToPlainText(body);
  if (!plain) return 'No description yet';
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen).trimEnd()}…`;
}
