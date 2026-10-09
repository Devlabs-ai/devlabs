/**
 * Download landmark paper PDFs (if needed) and upload to MinIO:
 *   papers/<section>/<id>.pdf
 *
 * Usage (from backend/):
 *   npx tsx scripts/uploadWhitePapers.ts            # every section
 *   npx tsx scripts/uploadWhitePapers.ts monthly    # one section
 */

import fs from 'fs';
import path from 'path';
function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnv(path.join(__dirname, '..', '.env'));

const { getObjectStore, normalizeKey } = require('../workspace/objectStore');

const PAPERS: Array<{ id: string; section: string; urls: string[] }> = [
  {
    id: 'rdd',
    section: 'spark',
    urls: ['https://www.usenix.org/system/files/conference/nsdi12/nsdi12-final138.pdf'],
  },
  {
    id: 'spark-sql',
    section: 'spark',
    urls: ['https://people.csail.mit.edu/matei/papers/2015/sigmod_spark_sql.pdf'],
  },
  {
    id: 'dstreams',
    section: 'spark',
    urls: ['https://people.csail.mit.edu/matei/papers/2013/sosp_spark_streaming.pdf'],
  },
  {
    id: 'structured-streaming',
    section: 'spark',
    urls: [
      'https://people.eecs.berkeley.edu/~matei/papers/2018/sigmod_structured_streaming.pdf',
    ],
  },
  {
    id: 'mapreduce',
    section: 'spark',
    urls: [
      'https://static.googleusercontent.com/media/research.google.com/en//archive/mapreduce-osdi04.pdf',
    ],
  },
  // Paper of the Month pool (backend/papers/monthlyPapers.ts).
  {
    id: 'gfs',
    section: 'monthly',
    urls: ['https://static.googleusercontent.com/media/research.google.com/en//archive/gfs-sosp2003.pdf'],
  },
  {
    id: 'mapreduce',
    section: 'monthly',
    urls: ['https://static.googleusercontent.com/media/research.google.com/en//archive/mapreduce-osdi04.pdf'],
  },
  {
    id: 'dynamo',
    section: 'monthly',
    urls: ['https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf'],
  },
  {
    id: 'raft',
    section: 'monthly',
    urls: ['https://raft.github.io/raft.pdf'],
  },
  {
    id: 'bigtable',
    section: 'monthly',
    urls: ['https://static.googleusercontent.com/media/research.google.com/en//archive/bigtable-osdi06.pdf'],
  },
];

async function fetchPdf(urls: string[]): Promise<Buffer> {
  for (const url of urls) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 DevlabsPaperMirror/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) {
      console.warn(`  skip ${url} status=${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.slice(0, 4).toString('utf8') !== '%PDF') {
      console.warn(`  skip ${url} (not a PDF)`);
      continue;
    }
    return buf;
  }
  throw new Error(`failed to download PDF from: ${urls.join(' | ')}`);
}

async function main() {
  // Same client and bucket the API reads from in routes/papers.ts.
  const store = getObjectStore();
  const onlySection = process.argv[2];
  for (const paper of PAPERS.filter((p) => !onlySection || p.section === onlySection)) {
    console.log(`fetch ${paper.section}/${paper.id}`);
    const body = await fetchPdf(paper.urls);
    const key = normalizeKey(`papers/${paper.section}/${paper.id}.pdf`);
    await store.putObject(key, body, 'application/pdf');
    console.log(`  uploaded ${key} (${body.length} bytes)`);
  }
  console.log('DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
