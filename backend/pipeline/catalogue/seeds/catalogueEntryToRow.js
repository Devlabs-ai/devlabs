'use strict';

function extractDonts(text) {
  const donts = [];
  const never = text.match(/NEVER[^.!?]*[.!?]/gi) || [];
  const avoid = text.match(/AVOID[^.!?]*[.!?]/gi) || [];
  const doNot = text.match(/Do NOT[^.!?]*[.!?]/gi) || [];
  [...never, ...avoid, ...doNot].forEach((s) => donts.push(s.trim()));
  return donts.slice(0, 6);
}

function buildConf(details, stack) {
  const conf = {};
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

/** Map seed file category to DB `catalogue.category`. */
function dbCategory(entry) {
  if (entry.category === 'docker-images') return 'global';
  return entry.category;
}

function seedEntryToRow(entry) {
  const category = dbCategory(entry);
  const details = entry.details || {};
  const donts = extractDonts(entry.text || '');
  const conf = buildConf(details, category);
  if (entry.draftDefaults && typeof entry.draftDefaults === 'object') {
    conf.draftDefaults = entry.draftDefaults;
  }

  return {
    category,
    image: details.image || null,
    image_hints: details.imageHints || [],
    port: details.port || null,
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
