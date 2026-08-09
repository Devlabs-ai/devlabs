/** Landmark data-systems papers, grouped for the Play Explore shelf.
 * PDFs live in MinIO (`papers/<section>/<id>.pdf`) and are served via `/api/papers/...`.
 */

export interface WhitePaper {
  id: string;
  title: string;
  shortTitle: string;
  year: number;
  venue: string;
  authors: string;
  blurb: string;
  /** App API path that streams the MinIO-backed PDF. */
  href?: string;
  status: 'available' | 'coming-soon';
}

export interface WhitePaperSection {
  id: string;
  label: string;
  blurb: string;
  papers: WhitePaper[];
}

function paperHref(sectionId: string, paperId: string): string {
  return `/api/papers/${sectionId}/${paperId}`;
}

export const WHITE_PAPER_SECTIONS: WhitePaperSection[] = [
  {
    id: 'spark',
    label: 'Spark',
    blurb: 'RDDs, SQL, streaming, and the lineage that made cluster compute feel interactive.',
    papers: [
      {
        id: 'rdd',
        shortTitle: 'RDDs',
        title: 'Resilient Distributed Datasets',
        year: 2012,
        venue: 'NSDI',
        authors: 'Zaharia et al.',
        blurb:
          'The Spark abstraction: immutable partitioned collections with lineage for fault tolerance — and why lazy transforms matter.',
        href: paperHref('spark', 'rdd'),
        status: 'available',
      },
      {
        id: 'spark-sql',
        shortTitle: 'Spark SQL',
        title: 'Spark SQL: Relational Data Processing in Spark',
        year: 2015,
        venue: 'SIGMOD',
        authors: 'Armbrust et al.',
        blurb:
          'DataFrames, Catalyst optimizer, and how declarative queries become physical plans on the same engine.',
        href: paperHref('spark', 'spark-sql'),
        status: 'available',
      },
      {
        id: 'dstreams',
        shortTitle: 'DStreams',
        title: 'Discretized Streams',
        year: 2013,
        venue: 'SOSP',
        authors: 'Zaharia et al.',
        blurb:
          'Streaming as a series of small batch RDDs — trade-offs that led toward Structured Streaming.',
        href: paperHref('spark', 'dstreams'),
        status: 'available',
      },
      {
        id: 'structured-streaming',
        shortTitle: 'Structured Streaming',
        title: 'Structured Streaming: A Declarative API for Real-Time Applications in Apache Spark',
        year: 2018,
        venue: 'SIGMOD',
        authors: 'Armbrust et al.',
        blurb:
          'A declarative stream processing API on Spark SQL — continuous applications with the same DataFrame model.',
        href: paperHref('spark', 'structured-streaming'),
        status: 'available',
      },
      {
        id: 'mapreduce',
        shortTitle: 'MapReduce',
        title: 'MapReduce: Simplified Data Processing on Large Clusters',
        year: 2004,
        venue: 'OSDI',
        authors: 'Dean & Ghemawat',
        blurb:
          'The ancestor of Spark’s programming model — useful contrast for shuffles, faults, and why RDDs improved on MR.',
        href: paperHref('spark', 'mapreduce'),
        status: 'available',
      },
    ],
  },
];

export function getWhitePaperSection(id: string | null | undefined): WhitePaperSection | null {
  if (!id) return null;
  return WHITE_PAPER_SECTIONS.find((s) => s.id === id) || null;
}
