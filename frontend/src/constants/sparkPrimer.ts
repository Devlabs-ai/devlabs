/** Spark "Start here" primer — plain notes before labs. */

import whatImg from '../assets/spark-primer/spark-primer-what.png';
import whyImg from '../assets/spark-primer/spark-primer-why.png';
import howEngineImg from '../assets/spark-primer/spark-primer-how-engine.png';
import howLabImg from '../assets/spark-primer/spark-primer-how-lab.png';

export const SPARK_PRIMER_PATH = '/play/data-engineer/spark/intro';
export const SPARK_LABS_PATH = '/play/data-engineer/spark';

export interface SparkPrimerExample {
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface SparkPrimerSection {
  id: string;
  eyebrow: string;
  title: string;
  body: string[];
  example?: SparkPrimerExample;
  image: string;
  imageAlt: string;
  caption: string;
}

export const SPARK_PRIMER_SECTIONS: SparkPrimerSection[] = [
  {
    id: 'what',
    eyebrow: 'The engine',
    title: 'Spark is the compute layer',
    body: [
      'Apache Spark is a distributed data-processing engine. You write transforms on a table (or files); Spark splits the work across machines and stitches the result back together.',
      'It is not a database. It does not permanently store your warehouse. Think of it as a fast kitchen crew that cooks a large meal using many counters — then hands you the plate.',
    ],
    image: whatImg,
    imageAlt: 'Hand-drawn sketch: sales data split into chunks across Spark worker machines',
    caption: 'Same job idea — data split across machines.',
  },
  {
    id: 'why',
    eyebrow: 'The wall',
    title: 'When one server crawls — or dies',
    body: [
      'A single laptop or one beefy app server is a great place to learn pandas or SQL. It stops being enough when the data (or the join) no longer fits comfortably in memory, or when the job no longer finishes in a useful amount of time.',
      'That failure is usually not dramatic at first — it just gets slower. Then one day it OOMs, thrashing to disk, or the “nightly” job is still running at noon.',
    ],
    example: {
      title: 'Example: one server vs many workers',
      paragraphs: [
        'Same task: build yesterday’s store revenue summary from sales files.',
        'On one server you might load files into memory (or stream them in one process), filter invalid rows, join a small product dimension, then group by store. With 2 GB of clean data and 16 GB RAM, that often works. With 80 GB of raw dumps, a wide join, and a busy machine, the same script starts to hurt.',
      ],
      bullets: [
        'Single server — small day (≈2 GB): finishes in minutes; laptop stays calm',
        'Single server — big day (≈80 GB + join): RAM fills → swap → disk thrash → hours or crash (OOM / killed)',
        'Single server — “just increase memory”: works until the next spike; you are still one machine with one bottleneck',
        'Distributed Spark — same logic: files are read in partitions; each executor filters/joins its slice; partial aggregates merge; summary writes out',
        'What changes: wall-clock time drops because many CPUs work at once; one worker’s memory only needs to hold a slice, not the whole day',
      ],
    },
    image: whyImg,
    imageAlt: 'Hand-drawn sketch: one overloaded laptop versus many workers sharing data pieces',
    caption: 'When one machine is not enough.',
  },
  {
    id: 'how-engine',
    eyebrow: 'Sharing the work',
    title: 'Driver, workers, and file storage',
    body: [
      'Your program runs on a Driver — the “brain” that builds a plan. Executors are the workers that run tasks. File storage is where datasets live between jobs — inputs you read and outputs you write.',
      'Transforms are lazy: Spark records what you asked for (filter, groupBy, …). An action (write, count, collect) kicks the real work. That one idea explains half of “why is nothing happening yet?”',
      'Going back to the store-summary example: the Driver plans stages (read → filter/join → aggregate → write). Executors pull partition files from file storage, run tasks, shuffle only what the plan needs, and write the summary. You inspect stages in History UI — not by SSH-ing into every box.',
    ],
    example: {
      title: 'How distributed compute eases the same job',
      paragraphs: [
        'Instead of one process holding 80 GB, Spark asks each executor to handle, say, a few hundred MB–GB partitions. Failures and retries are per task. Scaling out (more executors) usually helps more than hoping one server’s RAM grows forever.',
      ],
      bullets: [
        'Driver: owns your code + the plan (not the heavy data)',
        'Executors: run tasks on partitions in parallel',
        'File storage: source of truth for inputs and outputs',
        'Shuffle: the expensive “re-group by key” step — later labs will make this visible',
      ],
    },
    image: howEngineImg,
    imageAlt: 'Hand-drawn sketch: Driver sends tasks to executors that read and write file storage',
    caption: 'Plan → tasks → file storage → results.',
  },
  {
    id: 'how-lab',
    eyebrow: 'Inside a lab',
    title: 'What you will do in DevLabs',
    body: [
      'You write a transform, submit the job to the shared Spark platform, watch it run on the cluster, then open History UI to see stages and tasks.',
      'Labs grade the output of that path — not memorized trivia. When something fails or crawls, History UI is your first mirror: which stage, how many tasks, where time went.',
      'Start with small L1 transforms (filter, derive, rollup). The “one server vs cluster” intuition above is why those labs matter before you chase every Spark API.',
    ],
    image: howLabImg,
    imageAlt: 'Hand-drawn comic: write code, submit, job runs on cluster, inspect History UI',
    caption: 'Code → submit → run → inspect.',
  },
];

export const SPARK_PRIMER_NEXT_LINKS: Array<{ label: string; href: string; external?: boolean }> = [
  {
    label: 'Official Spark overview',
    href: 'https://spark.apache.org/docs/latest/',
    external: true,
  },
  {
    label: 'RDD white paper (optional depth)',
    href: '/play/papers/spark',
  },
  {
    label: 'Open Spark labs',
    href: SPARK_LABS_PATH,
  },
];
