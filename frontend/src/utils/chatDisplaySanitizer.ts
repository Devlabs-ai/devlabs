/** XML blocks emitted by design / schema agents — shown in Preview, not chat. */
const STRUCTURED_CHAT_TAGS = [
  'shape_contract',
  'challenge_draft',
  'problem_statement',
  'shape_meta',
  'catalogue_categories',
  'root_cause',
  'arch_intent',
  'services',
  'validation_intent',
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTrailingPartialTag(text: string): string {
  let out = text;
  const lt = out.lastIndexOf('<');
  if (lt === -1) return out;
  const tail = out.slice(lt);
  if (tail.includes('>')) return out;
  if (/^<[a-zA-Z0-9_-]*$/.test(tail)) return out.slice(0, lt);
  return out;
}

export function stripStructuredChatTags(text: string, { streaming = false }: { streaming?: boolean } = {}): string {
  let out = text || '';
  for (const tag of STRUCTURED_CHAT_TAGS) {
    const closed = new RegExp(`<${escapeRegex(tag)}>[\\s\\S]*?<\\/${escapeRegex(tag)}>`, 'gi');
    out = out.replace(closed, '\n');
    if (streaming) {
      const open = new RegExp(`<${escapeRegex(tag)}>[\\s\\S]*$`, 'i');
      out = out.replace(open, '');
    }
  }
  if (streaming) out = stripTrailingPartialTag(out);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function footnoteForTags(raw: string): string | null {
  if (/<challenge_draft>/i.test(raw)) return 'Schema materialized — see Preview panel.';
  if (/<shape_contract>/i.test(raw)) return 'Design contract updated — see Preview panel.';
  if (STRUCTURED_CHAT_TAGS.some((tag) => new RegExp(`<${escapeRegex(tag)}>`, 'i').test(raw || ''))) {
    return 'Structured output updated — see Preview panel.';
  }
  return null;
}

export function formatChatForDisplay(raw: string): string {
  const footnote = footnoteForTags(raw);
  let clean = stripStructuredChatTags(raw, { streaming: false });
  if (!clean && footnote) return footnote;
  if (footnote && !clean.includes(footnote)) {
    clean = clean ? `${clean}\n\n${footnote}` : footnote;
  }
  return clean.trim();
}

export class ChatDisplayStreamFilter {
  private raw = '';
  private emittedLen = 0;

  pushDelta(delta: string): string | null {
    this.raw += delta;
    const visible = stripStructuredChatTags(this.raw, { streaming: true });
    if (visible.length <= this.emittedLen) return null;
    const slice = visible.slice(this.emittedLen);
    this.emittedLen = visible.length;
    return slice || null;
  }

  isInsideStructuredBlock(): boolean {
    if (!this.raw) return false;
    const visible = stripStructuredChatTags(this.raw, { streaming: true });
    return this.raw.length > visible.length + 20;
  }
}
