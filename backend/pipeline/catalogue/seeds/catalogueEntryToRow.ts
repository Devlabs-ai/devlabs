'use strict';

interface CatalogueDbRow {
  category: string;
  image?: string | null;
  image_hints?: string[];
  port?: number | null;
  dos?: string[];
  donts?: string[];
  conf?: Record<string, unknown>;
  default_limits?: Record<string, string> | null;
  handbook_text?: string | null;
  metric_format?: string | null;
  observables?: unknown[];
}

function extractDonts(text: string): string[] {
  const donts: string[] = [];
  const never = text.match(/NEVER[^.!?]*[.!?]/gi) || [];
  const avoid = text.match(/AVOID[^.!?]*[.!?]/gi) || [];
  const doNot = text.match(/Do NOT[^.!?]*[.!?]/gi) || [];
  [...never, ...avoid, ...doNot].forEach((s) => donts.push(s.trim()));
  return donts.slice(0, 6);
}

function buildConf(details: Record<string, unknown>, stack: string): Record<string, unknown> {
  const conf: Record<string, unknown> = {};
  if (!details || typeof details !== 'object') return conf;
  if (details.image) conf.image = details.image;
  if (details.port) {
    conf.inNetwork = { host: stack, port: details.port };
  }
  if (details.requiredEnv) {
    conf.composeFragment = { environment: details.requiredEnv };
  }
  if (details.mode) conf.mode = details.mode;
  return conf;
}

interface SeedEntry {
  category: string;
  details?: Record<string, unknown>;
  text?: string;
  dos?: string[];
  defaultLimits?: Record<string, string>;
  metricFormat?: string;
  observables?: unknown[];
  draftDefaults?: Record<string, unknown>;
}

/** Map seed file category to DB `catalogue.category`. */
function dbCategory(entry: SeedEntry): string {
  if (entry.category === 'docker-images') return 'global';
  return entry.category;
}

function seedEntryToRow(entry: SeedEntry): CatalogueDbRow {
  const category = dbCategory(entry);
  const details: Record<string, unknown> = entry.details || {};
  const donts = extractDonts(entry.text || '');
  const conf: Record<string, unknown> = buildConf(details, category);
  if (entry.draftDefaults && typeof entry.draftDefaults === 'object') {
    conf.draftDefaults = entry.draftDefaults;
  }

  return {
    category,
    image: (details.image as string) || null,
    image_hints: (details.imageHints as string[]) || [],
    port: (details.port as number) || null,
    dos: Array.isArray(entry.dos) ? entry.dos : (entry.text ? [entry.text] : []),
    donts,
    conf,
    default_limits: entry.defaultLimits || null,
    handbook_text: entry.text || null,
    metric_format: entry.metricFormat || null,
    observables: Array.isArray(entry.observables) ? entry.observables : [],
  };
}

module.exports = { dbCategory, seedEntryToRow };
