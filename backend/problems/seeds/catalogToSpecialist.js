'use strict';

// Convert legacy imageCatalog entries into specialist rows (dos / donts / conf).

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

function catalogEntryToSpecialist(entry) {
  const category = entry.category === 'docker-images' ? 'global' : entry.category;
  const stack = entry.category === 'docker-images' ? 'docker-policy' : entry.category;
  const title = entry.details?.image
    || entry.details?.policy
    || entry.category;
  const donts = extractDonts(entry.text);
  const dos = [entry.text];
  const conf = buildConf(entry.details, stack);
  const priority = entry.category === 'docker-images' ? 100 : 0;

  return {
    category,
    stack,
    serviceRole: null,
    title: String(title),
    dos,
    donts,
    conf,
    priority,
  };
}

module.exports = { catalogEntryToSpecialist };
