/**
 * Spark Playground catalog — named data clusters on MinIO.
 * Clusters are logical groupings for ideation / challenge design, not hard
 * boundaries — jobs may join freely across clusters.
 */

export const SPARK_PLAYGROUND_CHALLENGE_ID = 'spark-playground';

export interface PlaygroundColumn {
  column: string;
  type: string;
}

export type PlaygroundSampleValue = string | number | boolean | null;

/** Broad category for a cluster (more clusters will share these labels). */
export type PlaygroundCategory = 'transactional' | 'clickstream' | 'analytical' | 'reference';

export interface PlaygroundTable {
  id: string;
  label: string;
  kind: 'fact' | 'dim';
  /** s3a path (directory of Parquet). */
  path: string;
  blurb: string;
  schema: PlaygroundColumn[];
  /** Optional join hint for dims. */
  joinHint?: string;
  /** Exact / approximate row count. */
  rowCount: number;
  /** On-disk Parquet size in bytes (Snappy). */
  sizeBytes: number;
  /** Number of part files under the path. */
  fileCount: number;
  format: string;
  compression: string;
  /** Generator seed (deterministic). */
  seed: number;
  /** Optional time window for fact tables. */
  timeRange?: string;
  /** First few rows (for preview). */
  sampleRows: Array<Record<string, PlaygroundSampleValue>>;
}

/**
 * A named, tagged set of related tables (one MinIO family).
 * Logical only — challenge ideas often start inside a cluster, but paths from
 * any cluster can be combined in one job.
 */
export interface PlaygroundCluster {
  id: string;
  /** Display name — e.g. "Card Rails". */
  name: string;
  /** Category tag shown in the catalog. */
  category: PlaygroundCategory;
  /** Extra labels (domain, domain nouns). */
  tags: string[];
  blurb: string;
  /** MinIO key prefix under datasets/ (no s3a://). */
  prefix: string;
  tables: PlaygroundTable[];
}

export const PLAYGROUND_CATEGORY_LABEL: Record<PlaygroundCategory, string> = {
  transactional: 'Transactional',
  clickstream: 'Clickstream',
  analytical: 'Analytical',
  reference: 'Reference',
};

const BUCKET = 's3a://devlabs-data';
const PAYMENT = `${BUCKET}/datasets/payment-network`;
const NOVAMART = `${BUCKET}/datasets/novamart`;
const VESPER = `${BUCKET}/datasets/vesper`;
const SEED = 42;

const TXN_SCHEMA: PlaygroundColumn[] = [
  { column: 'txn_id', type: 'STRING' },
  { column: 'txn_ts', type: 'TIMESTAMP' },
  { column: 'card_number', type: 'STRING' },
  { column: 'amount', type: 'DECIMAL(14,2)' },
  { column: 'currency_code', type: 'STRING' },
  { column: 'country_code', type: 'STRING' },
  { column: 'mcc', type: 'STRING' },
  { column: 'merchant_id', type: 'STRING' },
  { column: 'acquirer_bin', type: 'STRING' },
  { column: 'response_code', type: 'STRING' },
  { column: 'entry_mode', type: 'STRING' },
  { column: 'channel', type: 'STRING' },
  { column: 'merchant_country', type: 'STRING' },
  { column: 'auth_code', type: 'STRING' },
  { column: 'settled', type: 'BOOLEAN' },
];

const TXN_TIME_RANGE = '2024-01-01 → ~2024-06-29 (UTC, ~180d)';

/** Card Rails — transactional payment / acquiring cluster. */
const CARD_RAILS_TABLES: PlaygroundTable[] = [
  {
    id: 'txns-50m-skew-key75',
    label: 'txns / 50m-skew-key75',
    kind: 'fact',
    path: `${PAYMENT}/txns/50m-skew-key75/`,
    blurb:
      '~50M wide (15-col) txns with the same extreme join-key skew as 100m-skew-key75: 33.0M of 44.0M approved rows (75%) are (mcc 5411, US, chip) — 903× the next key, against a median of ~800 across the other 5,250 keys. Half the scan cost of the 100m drop — use it to shape a key75 plan before paying for the full one.',
    schema: TXN_SCHEMA,
    rowCount: 50_000_000,
    sizeBytes: 1_798_187_969,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    timeRange: TXN_TIME_RANGE,
    sampleRows: [
      {
        txn_id: 'TXN000000000001',
        txn_ts: '2024-03-09T15:13:35.275724',
        card_number: '4000000000015182',
        amount: '17.58',
        currency_code: 'USD',
        country_code: 'US',
        mcc: '4511',
        merchant_id: 'MID0024853',
        acquirer_bin: '400015',
        response_code: '14',
        entry_mode: 'contactless',
        channel: 'mobile',
        merchant_country: 'US',
        auth_code: '',
        settled: false,
      },
      {
        txn_id: 'TXN000000000002',
        txn_ts: '2024-06-03T17:13:39.625771',
        card_number: '4000000000391450',
        amount: '4.69',
        currency_code: 'USD',
        country_code: 'US',
        mcc: '5411',
        merchant_id: 'MID0028967',
        acquirer_bin: '400010',
        response_code: '00',
        entry_mode: 'chip',
        channel: 'mobile',
        merchant_country: 'US',
        auth_code: '226364',
        settled: true,
      },
    ],
  },
  {
    id: 'txns-100m-skew-key75',
    label: 'txns / 100m-skew-key75',
    kind: 'fact',
    path: `${PAYMENT}/txns/100m-skew-key75/`,
    blurb:
      '~100M wide (15-col) txns with extreme join-key skew: 66.0M of 88.0M approved rows (75%) are (mcc 5411, US, chip) — 909× the next key, against a median of ~1.6k. Expect one very hot task and heavy spill on small executors.',
    schema: TXN_SCHEMA,
    rowCount: 100_000_000,
    sizeBytes: 3_596_195_864,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    timeRange: TXN_TIME_RANGE,
    sampleRows: [
      {
        txn_id: 'TXN000000000001',
        txn_ts: '2024-04-06T11:31:30.359892',
        card_number: '4000000000088270',
        amount: '4.81',
        currency_code: 'USD',
        country_code: 'US',
        mcc: '5411',
        merchant_id: 'MID0017745',
        acquirer_bin: '400009',
        response_code: '00',
        entry_mode: 'chip',
        channel: 'pos',
        merchant_country: 'US',
        auth_code: '677117',
        settled: true,
      },
      {
        txn_id: 'TXN000000000002',
        txn_ts: '2024-01-07T08:32:57.933335',
        card_number: '4000000000730368',
        amount: '79.61',
        currency_code: 'USD',
        country_code: 'US',
        mcc: '5411',
        merchant_id: 'MID0024572',
        acquirer_bin: '400004',
        response_code: '00',
        entry_mode: 'chip',
        channel: 'pos',
        merchant_country: 'US',
        auth_code: '729046',
        settled: true,
      },
    ],
  },
  {
    id: 'dim-country',
    label: 'dims / country',
    kind: 'dim',
    path: `${PAYMENT}/dims/country/`,
    blurb: 'ISO country directory with region and risk tier.',
    schema: [
      { column: 'country_code', type: 'STRING' },
      { column: 'country_name', type: 'STRING' },
      { column: 'region', type: 'STRING' },
      { column: 'risk_tier', type: 'STRING' },
    ],
    joinHint: 'txns.country_code = country.country_code',
    rowCount: 25,
    sizeBytes: 1_698,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      { country_code: 'US', country_name: 'United States', region: 'NA', risk_tier: 'low' },
      { country_code: 'CA', country_name: 'Canada', region: 'NA', risk_tier: 'low' },
      { country_code: 'GB', country_name: 'United Kingdom', region: 'EU', risk_tier: 'low' },
    ],
  },
  {
    id: 'dim-mcc',
    label: 'dims / mcc',
    kind: 'dim',
    path: `${PAYMENT}/dims/mcc/`,
    blurb: 'Merchant Category Codes with coarse category.',
    schema: [
      { column: 'mcc', type: 'STRING' },
      { column: 'mcc_description', type: 'STRING' },
      { column: 'category', type: 'STRING' },
    ],
    joinHint: 'txns.mcc = mcc.mcc',
    rowCount: 30,
    sizeBytes: 1_801,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      { mcc: '5411', mcc_description: 'Grocery Stores', category: 'retail' },
      { mcc: '5812', mcc_description: 'Eating Places', category: 'restaurant' },
      { mcc: '5814', mcc_description: 'Fast Food', category: 'restaurant' },
    ],
  },
  {
    id: 'dim-interchange-rate',
    label: 'dims / interchange_rate',
    kind: 'dim',
    path: `${PAYMENT}/dims/interchange_rate/`,
    blurb:
      'Scheme interchange rate card — weekly effective schedules per MCC / country / entry mode. Large enough that it will not auto-broadcast.',
    schema: [
      { column: 'rate_id', type: 'STRING' },
      { column: 'mcc', type: 'STRING' },
      { column: 'country_code', type: 'STRING' },
      { column: 'entry_mode', type: 'STRING' },
      { column: 'effective_from', type: 'DATE' },
      { column: 'effective_to', type: 'DATE' },
      { column: 'rate_bps', type: 'INT' },
      { column: 'fixed_fee', type: 'DECIMAL(6,4)' },
      { column: 'program_code', type: 'STRING' },
      { column: 'program_name', type: 'STRING' },
    ],
    joinHint:
      'txns.(mcc, country_code, entry_mode) = interchange_rate.(…) AND txn_date BETWEEN effective_from AND effective_to',
    rowCount: 682_500,
    sizeBytes: 12_456_868,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    timeRange: '2024-01-01 → 2026-06-22 (weekly schedules)',
    sampleRows: [
      {
        rate_id: 'IC000000001',
        mcc: '5411',
        country_code: 'US',
        entry_mode: 'chip',
        effective_from: '2024-01-01',
        effective_to: '2024-01-07',
        rate_bps: 128,
        fixed_fee: '0.0060',
        program_code: 'RETA-CHIP-W00',
        program_name: 'United States Retail chip programme, week 00 effective schedule',
      },
      {
        rate_id: 'IC000000002',
        mcc: '5411',
        country_code: 'US',
        entry_mode: 'contactless',
        effective_from: '2024-01-01',
        effective_to: '2024-01-07',
        rate_bps: 123,
        fixed_fee: '0.0070',
        program_code: 'RETA-CONT-W00',
        program_name: 'United States Retail contactless programme, week 00 effective schedule',
      },
    ],
  },
  {
    id: 'dim-currency',
    label: 'dims / currency',
    kind: 'dim',
    path: `${PAYMENT}/dims/currency/`,
    blurb: 'ISO currencies and minor units.',
    schema: [
      { column: 'currency_code', type: 'STRING' },
      { column: 'currency_name', type: 'STRING' },
      { column: 'minor_units', type: 'INT' },
    ],
    joinHint: 'txns.currency_code = currency.currency_code',
    rowCount: 20,
    sizeBytes: 1_452,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      { currency_code: 'USD', currency_name: 'US Dollar', minor_units: 2 },
      { currency_code: 'CAD', currency_name: 'Canadian Dollar', minor_units: 2 },
      { currency_code: 'GBP', currency_name: 'Pound Sterling', minor_units: 2 },
    ],
  },
  {
    id: 'dim-response-code',
    label: 'dims / response_code',
    kind: 'dim',
    path: `${PAYMENT}/dims/response_code/`,
    blurb: 'Auth / decline opcodes (~88% approved on facts).',
    schema: [
      { column: 'response_code', type: 'STRING' },
      { column: 'meaning', type: 'STRING' },
      { column: 'is_approved', type: 'BOOLEAN' },
    ],
    joinHint: 'txns.response_code = response_code.response_code',
    rowCount: 12,
    sizeBytes: 1_236,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      { response_code: '00', meaning: 'Approved', is_approved: true },
      { response_code: '01', meaning: 'Refer to issuer', is_approved: false },
      { response_code: '05', meaning: 'Do not honor', is_approved: false },
    ],
  },
  {
    id: 'dim-entry-mode',
    label: 'dims / entry_mode',
    kind: 'dim',
    path: `${PAYMENT}/dims/entry_mode/`,
    blurb: 'POS / CNP entry modes.',
    schema: [
      { column: 'entry_mode', type: 'STRING' },
      { column: 'description', type: 'STRING' },
    ],
    joinHint: 'txns.entry_mode = entry_mode.entry_mode',
    rowCount: 7,
    sizeBytes: 972,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      { entry_mode: 'chip', description: 'EMV chip read' },
      { entry_mode: 'contactless', description: 'NFC / contactless' },
      { entry_mode: 'magstripe', description: 'Magnetic stripe' },
    ],
  },
  {
    id: 'dim-acquirer',
    label: 'dims / acquirer',
    kind: 'dim',
    path: `${PAYMENT}/dims/acquirer/`,
    blurb: 'Acquirer BIN directory.',
    schema: [
      { column: 'acquirer_bin', type: 'STRING' },
      { column: 'acquirer_name', type: 'STRING' },
      { column: 'country_code', type: 'STRING' },
    ],
    joinHint: 'txns.acquirer_bin = acquirer.acquirer_bin',
    rowCount: 15,
    sizeBytes: 1_462,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      { acquirer_bin: '400001', acquirer_name: 'Northstar Acquiring', country_code: 'US' },
      { acquirer_bin: '400002', acquirer_name: 'Maple Pay', country_code: 'CA' },
      { acquirer_bin: '400003', acquirer_name: 'Thames Merchant Services', country_code: 'GB' },
    ],
  },
];

const EVENTS_SCHEMA: PlaygroundColumn[] = [
  { column: 'event_id', type: 'BIGINT' },
  { column: 'product_id', type: 'INT' },
  { column: 'event_type', type: 'STRING' },
  { column: 'amount', type: 'DECIMAL(10,2)' },
  { column: 'quantity', type: 'INT' },
  { column: 'session_id', type: 'STRING' },
  { column: 'visitor_id', type: 'STRING' },
  { column: 'channel', type: 'STRING' },
  { column: 'country_code', type: 'STRING' },
];

const CATALOG_SCHEMA: PlaygroundColumn[] = [
  { column: 'product_id', type: 'INT' },
  { column: 'product_name', type: 'STRING' },
  { column: 'category', type: 'STRING' },
  { column: 'brand', type: 'STRING' },
  { column: 'list_price', type: 'DECIMAL(10,2)' },
  { column: 'effective_ts', type: 'DATE' },
  { column: 'payload', type: 'BINARY' },
];

/** NovaMart — retail clickstream + versioned product catalog. */
const NOVAMART_TABLES: PlaygroundTable[] = [
  {
    id: 'events-20k',
    label: 'events / 20k',
    kind: 'fact',
    path: `${NOVAMART}/events/20k/`,
    blurb:
      'Small clickstream drop for smoke / join practice. Pairs with catalog_current. ~3% of product_ids have no catalog match.',
    schema: EVENTS_SCHEMA,
    joinHint: 'events.product_id = catalog.product_id (current row)',
    rowCount: 20_000,
    sizeBytes: 520_141,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      {
        event_id: 1,
        product_id: 2167,
        event_type: 'purchase',
        amount: '70.23',
        quantity: 2,
        session_id: 'sess-000000000001',
        visitor_id: 'vis-028479',
        channel: 'ios',
        country_code: 'GB',
      },
      {
        event_id: 2,
        product_id: 2126,
        event_type: 'view',
        amount: '5.41',
        quantity: 0,
        session_id: 'sess-000000000002',
        visitor_id: 'vis-039477',
        channel: 'web',
        country_code: 'AU',
      },
      {
        event_id: 3,
        product_id: 2040,
        event_type: 'purchase',
        amount: '24.42',
        quantity: 5,
        session_id: 'sess-000000000003',
        visitor_id: 'vis-005957',
        channel: 'ios',
        country_code: 'AU',
      },
    ],
  },
  {
    id: 'events-200k',
    label: 'events / 200k',
    kind: 'fact',
    path: `${NOVAMART}/events/200k/`,
    blurb: 'Mid-size clickstream. Pairs with catalog_scd_small. ~3% unmatched product_ids.',
    schema: EVENTS_SCHEMA,
    joinHint: 'events.product_id = catalog.product_id (current row)',
    rowCount: 200_000,
    sizeBytes: 4_270_188,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      {
        event_id: 1,
        product_id: 2143,
        event_type: 'purchase',
        amount: '90.29',
        quantity: 4,
        session_id: 'sess-000000000001',
        visitor_id: 'vis-041143',
        channel: 'ios',
        country_code: 'US',
      },
      {
        event_id: 2,
        product_id: 2164,
        event_type: 'view',
        amount: '29.18',
        quantity: 0,
        session_id: 'sess-000000000002',
        visitor_id: 'vis-001865',
        channel: 'web',
        country_code: 'DE',
      },
      {
        event_id: 3,
        product_id: 2141,
        event_type: 'click',
        amount: '40.27',
        quantity: 0,
        session_id: 'sess-000000000003',
        visitor_id: 'vis-005427',
        channel: 'ios',
        country_code: 'US',
      },
    ],
  },
  {
    id: 'events-1m',
    label: 'events / 1m',
    kind: 'fact',
    path: `${NOVAMART}/events/1m/`,
    blurb:
      '~1M clickstream events (~4% unmatched product_ids). Pairs with catalog_scd. Broadcast Catalog Enrichment Submit drop.',
    schema: EVENTS_SCHEMA,
    joinHint: 'events.product_id = catalog.product_id (current row)',
    rowCount: 1_000_000,
    sizeBytes: 23_126_184,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      {
        event_id: 1,
        product_id: 40031,
        event_type: 'view',
        amount: '50.59',
        quantity: 0,
        session_id: 'sess-000000000001',
        visitor_id: 'vis-026337',
        channel: 'web',
        country_code: 'FR',
      },
      {
        event_id: 2,
        product_id: 40147,
        event_type: 'refund',
        amount: '96.40',
        quantity: 1,
        session_id: 'sess-000000000002',
        visitor_id: 'vis-003212',
        channel: 'android',
        country_code: 'US',
      },
      {
        event_id: 3,
        product_id: 40126,
        event_type: 'refund',
        amount: '34.63',
        quantity: 5,
        session_id: 'sess-000000000003',
        visitor_id: 'vis-026424',
        channel: 'ios',
        country_code: 'IN',
      },
    ],
  },
  {
    id: 'dim-catalog-current',
    label: 'dims / catalog_current',
    kind: 'dim',
    path: `${NOVAMART}/dims/catalog_current/`,
    blurb:
      'Current-only product catalog — 2,000 products, one version, tiny payload. Safe to broadcast. Pairs with events/20k.',
    schema: CATALOG_SCHEMA,
    joinHint: 'events.product_id = catalog_current.product_id',
    rowCount: 2_000,
    sizeBytes: 37_551,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    sampleRows: [
      {
        product_id: 1362,
        product_name: 'sku-00001362-v000',
        category: 'Kitchen',
        brand: 'Helix',
        list_price: '23.62',
        effective_ts: '2020-01-01',
        payload: '<8 bytes>',
      },
      {
        product_id: 497,
        product_name: 'sku-00000497-v000',
        category: 'Toys',
        brand: 'Helix',
        list_price: '14.97',
        effective_ts: '2020-01-01',
        payload: '<8 bytes>',
      },
      {
        product_id: 96,
        product_name: 'sku-00000096-v000',
        category: 'Kitchen',
        brand: 'Northstar',
        list_price: '10.96',
        effective_ts: '2020-01-01',
        payload: '<8 bytes>',
      },
    ],
  },
  {
    id: 'dim-catalog-scd-small',
    label: 'dims / catalog_scd_small',
    kind: 'dim',
    path: `${NOVAMART}/dims/catalog_scd_small/`,
    blurb:
      'Short SCD history — 2,000 products × 4 weekly versions. Practice snapshot-then-join without the whale. Pairs with events/200k.',
    schema: CATALOG_SCHEMA,
    joinHint:
      'events.product_id = catalog.product_id after keeping the latest effective_ts (tie-break smaller product_name)',
    rowCount: 8_000,
    sizeBytes: 114_469,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    timeRange: '2020-01-01 → 2020-01-22 (weekly versions)',
    sampleRows: [
      {
        product_id: 1148,
        product_name: 'sku-00001148-v003',
        category: 'Home',
        brand: 'Maple',
        list_price: '22.23',
        effective_ts: '2020-01-22',
        payload: '<16 bytes>',
      },
      {
        product_id: 595,
        product_name: 'sku-00000595-v001',
        category: 'Home',
        brand: 'Acme',
        list_price: '16.20',
        effective_ts: '2020-01-08',
        payload: '<16 bytes>',
      },
      {
        product_id: 1128,
        product_name: 'sku-00001128-v001',
        category: 'Toys',
        brand: 'Maple',
        list_price: '21.53',
        effective_ts: '2020-01-08',
        payload: '<16 bytes>',
      },
    ],
  },
  {
    id: 'dim-catalog-scd',
    label: 'dims / catalog_scd',
    kind: 'dim',
    path: `${NOVAMART}/dims/catalog_scd/`,
    blurb:
      'Versioned catalog — 40,000 products × 50 weekly versions plus ~1% name ties, brand/list_price, and a 120-byte payload (~28.1 MB on disk). Uncompressed history will not fit a 512 MB driver; a current-row snapshot will. Pairs with events/1m.',
    schema: CATALOG_SCHEMA,
    joinHint:
      'events.product_id = catalog.product_id after keeping the latest effective_ts (tie-break smaller product_name)',
    rowCount: 2_000_400,
    sizeBytes: 29_424_116,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    timeRange: '2020-01-01 → 2020-12-09 (weekly versions)',
    sampleRows: [
      {
        product_id: 6856,
        product_name: 'sku-00006856-v020',
        category: 'Sports',
        brand: 'Northstar',
        list_price: '43.56',
        effective_ts: '2020-05-20',
        payload: '<120 bytes>',
      },
      {
        product_id: 9721,
        product_name: 'sku-00009721-v039',
        category: 'Kitchen',
        brand: 'Northstar',
        list_price: '36.96',
        effective_ts: '2020-09-30',
        payload: '<120 bytes>',
      },
      {
        product_id: 34990,
        product_name: 'sku-00034990-v017',
        category: 'Toys',
        brand: 'Acme',
        list_price: '44.15',
        effective_ts: '2020-04-29',
        payload: '<120 bytes>',
      },
    ],
  },
];

const VESPER_SALES_SCHEMA: PlaygroundColumn[] = [
  { column: 'txn_id', type: 'STRING' },
  { column: 'store_id', type: 'INT' },
  { column: 'register_id', type: 'INT' },
  { column: 'product_id', type: 'INT' },
  { column: 'product_code', type: 'STRING' },
  { column: 'customer_id', type: 'INT' },
  { column: 'quantity', type: 'INT' },
  { column: 'unit_price', type: 'DECIMAL(10,2)' },
  { column: 'discount_pct', type: 'DECIMAL(5,2)' },
  { column: 'currency', type: 'STRING' },
  { column: 'status', type: 'STRING' },
  { column: 'channel', type: 'STRING' },
  { column: 'payment_method', type: 'STRING' },
  { column: 'country_code', type: 'STRING' },
  { column: 'event_ts', type: 'TIMESTAMP' },
];

const VESPER_TIME_RANGE = '2026-01-15 (UTC, store open 09:00–21:00)';

/** Vesper Markets — overnight retail sales fact. */
const VESPER_TABLES: PlaygroundTable[] = [
  {
    id: 'vesper-sales-100k',
    label: 'sales / 100k',
    kind: 'fact',
    path: `${VESPER}/sales/100k/`,
    blurb:
      'Clean overnight ticket lines (15 columns). Same grain as the L1 Vesper labs — filter, revenue, dates, and joins start here.',
    schema: VESPER_SALES_SCHEMA,
    rowCount: 100_000,
    sizeBytes: 5_313_799,
    fileCount: 1,
    format: 'Parquet',
    compression: 'Snappy',
    seed: SEED,
    timeRange: VESPER_TIME_RANGE,
    sampleRows: [
      {
        txn_id: '3eb13b90-4668-4257-bdd6-40fb06671ad1',
        store_id: 15,
        register_id: 3,
        product_id: 115,
        product_code: 'SKU-00115',
        customer_id: 48266,
        quantity: 14,
        unit_price: '67.99',
        discount_pct: '0.45',
        currency: 'USD',
        status: 'COMPLETED',
        channel: 'app',
        payment_method: 'cash',
        country_code: 'US',
        event_ts: '2026-01-15T20:38:25+00:00',
      },
      {
        txn_id: '9a1de644-815e-46d1-bb8f-aa1837f8a88b',
        store_id: 2,
        register_id: 4,
        product_id: 96,
        product_code: 'SKU-00096',
        customer_id: 46926,
        quantity: 84,
        unit_price: '70.42',
        discount_pct: '0.21',
        currency: 'EUR',
        status: 'COMPLETED',
        channel: 'app',
        payment_method: 'cash',
        country_code: 'US',
        event_ts: '2026-01-15T09:32:32+00:00',
      },
      {
        txn_id: '27cd8130-4722-4389-971a-a8766c307511',
        store_id: 14,
        register_id: 6,
        product_id: 715,
        product_code: 'SKU-00715',
        customer_id: 6699,
        quantity: 12,
        unit_price: '38.61',
        discount_pct: '0.18',
        currency: 'EUR',
        status: 'COMPLETED',
        channel: 'app',
        payment_method: 'cash',
        country_code: 'US',
        event_ts: '2026-01-15T11:54:23+00:00',
      },
    ],
  },
];

/**
 * Data clusters available in the playground.
 * Add new families here (analytical marts, clickstream, etc.) — each gets its own section.
 */
export const PLAYGROUND_CLUSTERS: PlaygroundCluster[] = [
  {
    id: 'card-rails',
    name: 'Card Rails',
    category: 'transactional',
    tags: ['payments', 'acquiring', 'settlement'],
    blurb:
      'Card-network authorization and settlement facts (15-col) at 50m/100m-skew-key75 for single-hot-key join skew, with opcode dims.',
    prefix: 'datasets/payment-network',
    tables: CARD_RAILS_TABLES,
  },
  {
    id: 'novamart',
    name: 'NovaMart',
    category: 'clickstream',
    tags: ['retail', 'events', 'scd', 'catalog'],
    blurb:
      'Retail clickstream events at 20k–1M (session, visitor, channel, country) plus a versioned product catalog with brand and list_price: a current snapshot, a short SCD, and a 2M-row whale with a fat payload.',
    prefix: 'datasets/novamart',
    tables: NOVAMART_TABLES,
  },
  {
    id: 'vesper',
    name: 'Vesper Markets',
    category: 'transactional',
    tags: ['retail', 'pos', 'sales', 'overnight'],
    blurb:
      'Overnight store ticket lines, 15 columns, 100k clean rows. Filter, revenue, calendar features, and joins use this grain; L1 labs plant dirt on copies, not on this drop.',
    prefix: 'datasets/vesper',
    tables: VESPER_TABLES,
  },
];

/** Flat table list across all clusters (lookups / path constants). */
export const PLAYGROUND_TABLES: PlaygroundTable[] = PLAYGROUND_CLUSTERS.flatMap((c) => c.tables);

export const PLAYGROUND_FACTS = PLAYGROUND_TABLES.filter((t) => t.kind === 'fact');
export const PLAYGROUND_DIMS = PLAYGROUND_TABLES.filter((t) => t.kind === 'dim');

export function getPlaygroundCluster(id: string | null | undefined): PlaygroundCluster | null {
  if (!id) return null;
  return PLAYGROUND_CLUSTERS.find((c) => c.id === id) || null;
}

export function getPlaygroundTable(id: string | null | undefined): PlaygroundTable | null {
  if (!id) return null;
  return PLAYGROUND_TABLES.find((t) => t.id === id) || null;
}

export function findPlaygroundClusterForTable(tableId: string | null | undefined): PlaygroundCluster | null {
  if (!tableId) return null;
  return PLAYGROUND_CLUSTERS.find((c) => c.tables.some((t) => t.id === tableId)) || null;
}

export function formatPlaygroundBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatPlaygroundRows(n: number): string {
  return n.toLocaleString('en-US');
}

/** Path constants embedded in the starter template. */
export const PLAYGROUND_PATH_CONSTANTS = {
  TXNS_50M_SKEW_KEY75: `${PAYMENT}/txns/50m-skew-key75/`,
  TXNS_100M_SKEW_KEY75: `${PAYMENT}/txns/100m-skew-key75/`,
  DIM_COUNTRY: `${PAYMENT}/dims/country/`,
  DIM_MCC: `${PAYMENT}/dims/mcc/`,
  DIM_INTERCHANGE_RATE: `${PAYMENT}/dims/interchange_rate/`,
  DIM_CURRENCY: `${PAYMENT}/dims/currency/`,
  DIM_RESPONSE_CODE: `${PAYMENT}/dims/response_code/`,
  DIM_ENTRY_MODE: `${PAYMENT}/dims/entry_mode/`,
  DIM_ACQUIRER: `${PAYMENT}/dims/acquirer/`,
  EVENTS_20K: `${NOVAMART}/events/20k/`,
  EVENTS_200K: `${NOVAMART}/events/200k/`,
  EVENTS_1M: `${NOVAMART}/events/1m/`,
  DIM_CATALOG_CURRENT: `${NOVAMART}/dims/catalog_current/`,
  DIM_CATALOG_SCD_SMALL: `${NOVAMART}/dims/catalog_scd_small/`,
  DIM_CATALOG_SCD: `${NOVAMART}/dims/catalog_scd/`,
  VESPER_SALES_100K: `${VESPER}/sales/100k/`,
} as const;
