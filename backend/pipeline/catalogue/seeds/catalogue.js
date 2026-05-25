'use strict';

// Unified seed for the `catalogue` table: one row per category with canonical
// Docker image/infra handbook + observable definitions (metric_format, observables[]).
// Seeded at startup when catalogue is empty. Alternate image tags → details.imageHints.

const DEFAULT_METRIC_OBSERVABLES = [
  { id: 'latency_steady_median_ms', algorithm: 'median', field: 'latency', segment: 'steady', requires: { roles: ['load-generator'] } },
  { id: 'latency_spike_median_ms', algorithm: 'median', field: 'latency', segment: 'spike', requires: { roles: ['load-generator'] } },
  { id: 'spike_to_steady_ratio', algorithm: 'spike_ratio', field: 'latency', requires: { roles: ['load-generator'] } },
  { id: 'spike_period_seconds', algorithm: 'dominant_period', field: 'latency', requires: { roles: ['load-generator'] } },
  { id: 'errors_max_per_minute', algorithm: 'max_rate_per_minute', field: 'errors', requires: { roles: ['load-generator'] } },
];

const CATALOG = [
  {
    category: 'docker-images',
    details: { source: 'seed', policy: 'global-image-policy' },
    text: 'NEVER use Bitnami Docker images (`bitnami/kafka`, `bitnami/zookeeper`, `bitnami/postgresql`, etc.) in compose files — many tags fail with "manifest not found". Do NOT invent Docker image tags or version numbers; only use refs from the catalogue or past successful builds. For Kafka use `confluentinc/cp-kafka:7.6.1` in KRaft mode; for Postgres use `postgres:16-alpine`; for Zookeeper (legacy Kafka only) use `confluentinc/cp-zookeeper:7.6.1`. Hallucinated tags cause START failures that waste build iterations.',
  },

  {
    category: 'postgres',
    details: {
      image: 'postgres:16-alpine',
      imageHints: ['postgres:15-alpine', 'pgvector/pgvector:pg16'],
      port: 5432,
      defaultUser: 'postgres',
      defaultDb: 'postgres',
    },
    text: 'Docker image `postgres:16-alpine` is the canonical tag for PostgreSQL in compose sandboxes. Set `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`; init SQL in `/docker-entrypoint-initdb.d/` runs on FIRST boot only. In-network address `postgres:5432`. Healthcheck: `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`. Python: `psycopg2-binary` on alpine. Pitfalls: password env changes after first boot have no effect; dependents must wait for `pg_isready`. For pgvector use `pgvector/pgvector:pg16` instead.',
    defaultLimits: { cpus: '1.0', memory: '512M' },
    observables: [
      { id: 'db_cpu_spike_median', algorithm: 'median', field: 'dbCpu', segment: 'spike', requires: { roles: ['load-generator'], infra: ['postgres'] } },
    ],
    draftDefaults: {
      infra: {
        services: [
          {
            name: 'postgres',
            image_hint: 'postgres:16-alpine',
            limits: { cpus: '1.0', memory: '512M' },
            env_hints: { shared_buffers: '128MB' },
            notes: 'Primary database.',
          },
          {
            name: 'orders-service',
            image_hint: 'python:3.11-alpine',
            limits: { cpus: '0.5', memory: '256M' },
            notes: 'Flask API.',
          },
          {
            name: 'load-generator',
            image_hint: 'python:3.11-alpine',
            limits: { cpus: '0.25', memory: '128M' },
            notes: 'METRIC emitter.',
          },
        ],
      },
      metrics: {
        enabled: true,
        service: 'load-generator',
        format: 'METRIC latency=<float> errors=<int> dbCpu=<float>',
        interval_seconds: 1,
        display: {
          primary: 'latency',
          secondary: ['errors', 'dbCpu'],
          guidance: 'Latency should drop sharply after the database fix (e.g. index).',
        },
        recovery: { latency_below_ms: 50, consecutive_samples: 10 },
      },
    },
  },

  {
    category: 'mysql',
    details: { image: 'mysql:8.0', port: 3306 },
    text: 'Docker image `mysql:8.0` is a known-good tag for MySQL 8.0 in compose. Required env: `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`. Init SQL in `/docker-entrypoint-initdb.d/`. In-network `mysql:3306`. Healthcheck: `mysqladmin ping`. Pitfalls: `caching_sha2_password` vs older drivers — set `default-authentication-plugin=mysql_native_password` if needed; initial boot 10-30s.',
  },

  {
    category: 'mariadb',
    details: { image: 'mariadb:11', port: 3306 },
    text: 'Docker image `mariadb:11` is a known-good MariaDB tag — MySQL-compatible env (`MARIADB_*` or `MYSQL_*`). In-network `mariadb:3306`. Healthcheck: `healthcheck.sh --connect --innodb_initialized`. Python: `PyMySQL` or `mysqlclient`.',
  },

  {
    category: 'redis',
    details: { image: 'redis:7-alpine', port: 6379 },
    text: 'Docker image `redis:7-alpine` is the canonical Redis tag for cache/session/queue sandboxes. Starts on 6379 with no required env. Optional: `command: redis-server --requirepass mysecret`, persistence via `--appendonly yes`. In-network `redis:6379`. Healthcheck: `redis-cli ping`. Python: `redis` package. Pitfalls: data loss without AOF/RDB; eviction via `--maxmemory` + policy.',
    defaultLimits: { cpus: '0.5', memory: '256M' },
    observables: [
      { id: 'spike_to_steady_ratio', algorithm: 'spike_ratio', field: 'latency', requires: { roles: ['load-generator'], infra: ['redis'] } },
    ],
    draftDefaults: {
      infra: {
        services: [
          {
            name: 'redis',
            image_hint: 'redis:7-alpine',
            limits: { cpus: '0.5', memory: '256M' },
            notes: 'Small cache; prod-like memory cap.',
          },
          {
            name: 'postgres',
            image_hint: 'postgres:16-alpine',
            limits: { cpus: '1.0', memory: '512M' },
            env_hints: { max_connections: 30 },
            notes: 'Low connection cap makes stampede visible.',
          },
          {
            name: 'catalog-api',
            image_hint: 'python:3.11-alpine',
            limits: { cpus: '0.5', memory: '256M' },
            notes: 'Flask cache-aside API.',
          },
          {
            name: 'load-generator',
            image_hint: 'python:3.11-alpine',
            limits: { cpus: '0.25', memory: '128M' },
            notes: 'METRIC emitter.',
          },
        ],
      },
      metrics: {
        enabled: true,
        service: 'load-generator',
        format: 'METRIC latency=<float> errors=<int> dbCpu=<float>',
        interval_seconds: 1,
        display: {
          primary: 'latency',
          secondary: ['errors'],
          guidance: 'Watch for repeating spike windows vs quiet periods between TTL rollovers.',
        },
        recovery: { latency_below_ms: 120, consecutive_samples: 10 },
      },
    },
  },

  {
    category: 'mongodb',
    details: { image: 'mongo:7', port: 27017, imageHints: ['mongo:6'] },
    text: 'Docker image `mongo:7` is the canonical MongoDB tag for compose. Env: `MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`, `MONGO_INITDB_DATABASE`. Init in `/docker-entrypoint-initdb.d/`. In-network `mongo:27017`. Python: `pymongo` with `authSource=admin`. Pitfalls: standalone mode by default (no replica set); init scripts only on first boot.',
  },

  {
    category: 'apache-kafka',
    details: {
      image: 'confluentinc/cp-kafka:7.6.1',
      imageHints: ['confluentinc/cp-zookeeper:7.6.1'],
      port: 9092,
      mode: 'KRaft single-node',
      requiredEnv: {
        KAFKA_NODE_ID: '1',
        KAFKA_PROCESS_ROLES: 'broker,controller',
        KAFKA_CONTROLLER_QUORUM_VOTERS: '1@kafka:9093',
        KAFKA_LISTENERS: 'PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093',
        KAFKA_ADVERTISED_LISTENERS: 'PLAINTEXT://kafka:9092',
        KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: 'PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT',
        KAFKA_CONTROLLER_LISTENER_NAMES: 'CONTROLLER',
        KAFKA_INTER_BROKER_LISTENER_NAME: 'PLAINTEXT',
        KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: '1',
        KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: '1',
        KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: '1',
        CLUSTER_ID: 'MkU3OEVBNTcwNTJENDM2Qk',
      },
    },
    text: 'Docker image `confluentinc/cp-kafka:7.6.1` is the canonical Kafka tag — single-node KRaft (no Zookeeper). Required env block includes CLUSTER_ID, listeners, and replication factors of 1. Bootstrap `kafka:9092`. Pitfalls: missing CLUSTER_ID exits immediately; wrong advertised listener; clients need retry backoff (20-40s ready). PREFER KRaft over Zookeeper mode unless the challenge tests ZK coordination. AVOID `bitnami/kafka:*`.',
    metricFormat: 'METRIC lag=<float> rebalance=<int> errors=<int>',
    observables: [
      { id: 'consumer_lag_max', algorithm: 'max', field: 'lag', requires: { roles: ['load-generator'], infra: ['kafka'] } },
      { id: 'rebalance_events_total', algorithm: 'sum', field: 'rebalance', requires: { roles: ['load-generator'] } },
      { id: 'errors_max_per_minute', algorithm: 'max_rate_per_minute', field: 'errors', requires: { roles: ['load-generator'] } },
    ],
  },

  {
    category: 'rabbitmq',
    details: { image: 'rabbitmq:3-management', port: 5672, managementPort: 15672 },
    text: 'Docker image `rabbitmq:3-management` — AMQP 5672, management UI 15672. Override creds with `RABBITMQ_DEFAULT_USER/PASS`. In-network `rabbitmq:5672`. Healthcheck: `rabbitmq-diagnostics -q ping`. Python: `pika` with retry on boot.',
  },

  {
    category: 'nats',
    details: { image: 'nats:2-alpine', port: 4222, monitoringPort: 8222 },
    text: 'Docker image `nats:2-alpine` — client 4222, monitoring 8222. JetStream: `command: ["-js", "-sd", "/data"]` + volume. In-network `nats:4222`. Python: `nats-py`.',
  },

  {
    category: 'nginx',
    details: { image: 'nginx:1.27-alpine', port: 80 },
    text: 'Docker image `nginx:1.27-alpine` for static files or reverse proxy. Config at `/etc/nginx/conf.d/default.conf`. In-network `nginx:80`. Pitfalls: upstream DNS — use compose service names; set `proxy_set_header Host`.',
  },

  {
    category: 'traefik',
    details: { image: 'traefik:v3.1', port: 80, dashboardPort: 8080 },
    text: 'Docker image `traefik:v3.1` reverse proxy with Docker provider. Mount docker.sock read-only; pin version (not `:latest`). Dashboard :8080. In-network `traefik:80`.',
  },

  {
    category: 'haproxy',
    details: { image: 'haproxy:lts-alpine', port: 80 },
    text: 'Docker image `haproxy:lts-alpine` — mount `haproxy.cfg` at `/usr/local/etc/haproxy/haproxy.cfg`. Add `check` on backend servers. In-network `haproxy:80`.',
  },

  {
    category: 'caddy',
    details: { image: 'caddy:2-alpine', port: 80, httpsPort: 443 },
    text: 'Docker image `caddy:2-alpine` — Caddyfile at `/etc/caddy/Caddyfile`. For sandboxes use `:80` to skip auto-TLS. In-network `caddy:80`.',
  },

  {
    category: 'elasticsearch',
    details: {
      image: 'docker.elastic.co/elasticsearch/elasticsearch:8.15.0',
      port: 9200,
      note: 'Full registry path required — not docker.io.',
    },
    text: 'Docker image `docker.elastic.co/elasticsearch/elasticsearch:8.15.0`. Env: `discovery.type=single-node`, `xpack.security.enabled=false`, cap heap with `ES_JAVA_OPTS=-Xms512m -Xmx512m`. In-network `elasticsearch:9200`. Pitfalls: wrong registry; missing single-node discovery.',
  },

  {
    category: 'opensearch',
    details: { image: 'opensearchproject/opensearch:2', port: 9200 },
    text: 'Docker image `opensearchproject/opensearch:2`. Env: `discovery.type=single-node`, `DISABLE_SECURITY_PLUGIN=true`, cap JVM. In-network `opensearch:9200`. Host may need `vm.max_map_count=262144`.',
  },

  {
    category: 'clickhouse',
    details: { image: 'clickhouse/clickhouse-server:24.8-alpine', port: 8123, nativePort: 9000 },
    text: 'Docker image `clickhouse/clickhouse-server:24.8-alpine` — HTTP 8123, native 9000. Init in `/docker-entrypoint-initdb.d/`. Batch inserts for OLAP workloads.',
  },

  {
    category: 'apache-spark',
    details: { image: 'apache/spark:3.5.3', port: 7077, uiPort: 8080 },
    text: 'Docker image `apache/spark:3.5.3` for standalone cluster: `spark-master` + `spark-worker` with `spark://spark-master:7077`. Master UI :8080. Local mode: `spark-submit --master local[*]`. Use compose DNS names, not localhost.',
    metricFormat: 'METRIC stageProgress=<float> maxTaskSec=<float> shuffleSkew=<float>',
    observables: [
      { id: 'max_task_sec', algorithm: 'max', field: 'maxTaskSec', requires: { roles: ['load-generator', 'spark'] } },
      { id: 'shuffle_skew_max', algorithm: 'max', field: 'shuffleSkew', requires: { roles: ['load-generator', 'spark'] } },
      { id: 'stage_progress_min', algorithm: 'min', field: 'stageProgress', requires: { roles: ['load-generator', 'spark'] } },
    ],
  },

  {
    category: 'trino',
    details: { image: 'trinodb/trino:451', port: 8080 },
    text: 'Docker image `trinodb/trino:451` — catalog configs in `/etc/trino/catalog/*.properties` before boot. In-network `trino:8080`.',
  },

  {
    category: 'apache-airflow',
    details: { image: 'apache/airflow:2.9.3', port: 8080, requiresPostgres: true },
    text: 'Docker image `apache/airflow:2.9.3` requires Postgres metadata DB (`AIRFLOW__DATABASE__SQL_ALCHEMY_CONN`). `LocalExecutor` for single-node. Mount DAGs at `/opt/airflow/dags/`. Run `airflow db migrate` before webserver.',
  },

  {
    category: 'prometheus',
    details: { image: 'prom/prometheus:v2.55.1', port: 9090 },
    text: 'Docker image `prom/prometheus:v2.55.1` — mount `prometheus.yml` at `/etc/prometheus/prometheus.yml`. Scrape targets use compose DNS. In-network `prometheus:9090`.',
  },

  {
    category: 'grafana',
    details: { image: 'grafana/grafana:10.4.10', port: 3000 },
    text: 'Docker image `grafana/grafana:10.4.10`. Set `GF_SECURITY_ADMIN_PASSWORD` on first boot. Provision datasources under `/etc/grafana/provisioning/`. In-network `grafana:3000`.',
  },

  {
    category: 'jaeger',
    details: {
      image: 'jaegertracing/all-in-one:1.60',
      uiPort: 16686,
      otlpGrpcPort: 4317,
      otlpHttpPort: 4318,
    },
    text: 'Docker image `jaegertracing/all-in-one:1.60` — dev tracing UI :16686, OTLP :4317/:4318. Set `COLLECTOR_OTLP_ENABLED=true`. In-memory storage resets on restart.',
  },

  {
    category: 'opentelemetry',
    details: { image: 'otel/opentelemetry-collector-contrib:0.108.0', otlpGrpcPort: 4317, otlpHttpPort: 4318 },
    text: 'Docker image `otel/opentelemetry-collector-contrib:0.108.0` — mount config at `/etc/otelcol-contrib/config.yaml`. Use `-contrib` for kafka/elasticsearch exporters.',
  },

  {
    category: 'minio',
    details: {
      image: 'minio/minio:RELEASE.2024-09-13T20-26-02Z',
      port: 9000,
      consolePort: 9001,
    },
    text: 'Docker image `minio/minio:RELEASE.2024-09-13T20-26-02Z`. Env: `MINIO_ROOT_USER/PASSWORD` (8+ chars). Command: `server /data --console-address :9001`. S3 endpoint `http://minio:9000`.',
  },

  {
    category: 'localstack',
    details: { image: 'localstack/localstack:3', port: 4566 },
    text: 'Docker image `localstack/localstack:3` — AWS emulation on :4566. Set `SERVICES=s3,sqs,...`. boto3 with `endpoint_url=http://localstack:4566`, creds `test`/`test`.',
  },

  {
    category: 'python',
    details: {
      image: 'python:3.11-alpine',
      imageHints: ['python:3.12-slim'],
    },
    text: 'Docker image `python:3.11-alpine` is the canonical base for custom Flask/HTTP services in sandboxes (~50MB). Use `psycopg2-binary` to avoid alpine compile deps. Switch to `python:3.12-slim` when you need glibc wheels (pyarrow, grpcio). Template: COPY requirements.txt, pip install, CMD python app.py.',
  },

  {
    category: 'node',
    details: { image: 'node:20-alpine' },
    text: 'Docker image `node:20-alpine` for Node services. Use `npm ci`, run as `USER node`. Native modules may need `apk add python3 make g++` or use `node:20-bookworm-slim`.',
  },

  {
    category: 'java',
    details: { image: 'eclipse-temurin:21-jre' },
    text: 'Docker image `eclipse-temurin:21-jre` for prebuilt JARs. Prefer over deprecated `openjdk:*`. JVM opts: `-XX:+UseContainerSupport -XX:MaxRAMPercentage=75`.',
  },

  {
    category: 'golang',
    details: { image: 'golang:1.23-alpine' },
    text: 'Docker image `golang:1.23-alpine` for multi-stage builds — ship static binary on `alpine:3.20` runtime (~10MB). Set `CGO_ENABLED=0` unless cgo required.',
  },

  {
    category: 'load-generator',
    details: { image: 'python:3.11-alpine' },
    text: 'Load-generator service for sandboxes: emits one METRIC line per interval to stdout for OBSERVE and play recovery. Must match metricFormat exactly.',
    defaultLimits: { cpus: '0.25', memory: '128M' },
    metricFormat: 'METRIC latency=<float> errors=<int> dbCpu=<float>',
    observables: DEFAULT_METRIC_OBSERVABLES,
  },
];

module.exports = { CATALOG };
