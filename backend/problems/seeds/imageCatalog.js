'use strict';

// Curated catalog of known-good Docker image recipes that pre-seed the
// specialists table. Each entry is a self-contained paragraph:
//   - which image tag to use and when
//   - the minimum env / command block to run it
//   - common pitfalls and "do not use" warnings
//
// The text is what gets embedded; details is structured metadata that
// survives alongside in JSONB. Authoring guidance:
//   * keep each `text` ~600-1200 chars — the embedding model handles
//     long passages well, but anything more wastes tokens at retrieval
//     time and bloats the context the LLM sees
//   * include the in-network hostname (`kafka:9092`, `postgres:5432`)
//     because that's what the LLM emits in service code
//   * call out specific pitfalls so retrieval surfaces the seed when a
//     similar failure has already happened in real builds

const CATALOG = [
  // ------------------------ Global image policy ---------------------------
  {
    category: 'docker-images',
    details: { source: 'seed', policy: 'bitnami-ban' },
    text: 'NEVER use Bitnami Docker images (`bitnami/kafka`, `bitnami/zookeeper`, `bitnami/postgresql`, etc.) in compose files. Bitnami removed or restricted many public Docker Hub tags; pulls fail with "failed to resolve reference" or "manifest not found". For Kafka use `confluentinc/cp-kafka:7.6.1` in KRaft mode; for Zookeeper use `confluentinc/cp-zookeeper:7.6.1` if needed; for Postgres use `postgres:15-alpine` or `postgres:16-alpine`.',
  },
  {
    category: 'docker-images',
    details: { source: 'seed', policy: 'no-invented-tags' },
    text: 'Do NOT invent Docker image tags or version numbers. Only use image refs from memory.relatedLessons (seed catalog or past successful builds) or tags you are certain exist on Docker Hub. Hallucinated tags like `bitnami/zookeeper:3.7` or `kafka:3.0.0-custom` cause START failures that waste build iterations. When unsure, pick a seeded known-good tag for that software category.',
  },

  // -------------------------- Databases & caches --------------------------
  {
    category: 'postgres',
    details: {
      image: 'postgres:15-alpine',
      port: 5432,
      defaultUser: 'postgres',
      defaultDb: 'postgres',
    },
    text: 'Docker image `postgres:15-alpine` is a known-good tag for running PostgreSQL 15 in a compose sandbox. Set `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` env vars; the entrypoint auto-creates the DB on first boot. Init SQL placed in `/docker-entrypoint-initdb.d/` runs on the FIRST boot only (mount a host directory like `./init:/docker-entrypoint-initdb.d`). Default in-network address is `postgres:5432`. Add a healthcheck `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB` with 5s interval / 10 retries so dependent services can use `depends_on: { postgres: { condition: service_healthy } }`. Python clients install `psycopg2-binary` (avoids the libpq build); on alpine bases that need `psycopg2` from source, install `apk add --no-cache postgresql-dev gcc musl-dev` first. Common pitfalls: changing `POSTGRES_PASSWORD` after first boot has NO effect (the volume already holds the data dir); not waiting for `pg_isready` causes `psycopg2.OperationalError: connection refused` at startup. Avoid `latest` and `alpine` (no version pin) — pin to a major.',
  },
  {
    category: 'postgres',
    details: { image: 'postgres:16-alpine', port: 5432 },
    text: 'Docker image `postgres:16-alpine` is a known-good tag for running PostgreSQL 16. Same operational shape as `postgres:15-alpine` — set `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`, mount init SQL into `/docker-entrypoint-initdb.d/`, healthcheck with `pg_isready`. PG16 changes worth knowing: `pg_stats_ext_exprs` view exists, logical replication apply latency views are added, and `wal_compression` defaults to `pglz`. For development you almost never need to choose between 15 and 16 — pick 16 unless a specific extension only ships for 15. In-network address `postgres:5432`. The pgvector extension is NOT preinstalled here; for that use `pgvector/pgvector:pg16` instead (same image base + extension).',
  },
  {
    category: 'mysql',
    details: { image: 'mysql:8.0', port: 3306 },
    text: 'Docker image `mysql:8.0` is a known-good tag for running MySQL 8.0 in compose. Required env: `MYSQL_ROOT_PASSWORD` (mandatory unless `MYSQL_ALLOW_EMPTY_PASSWORD=yes`), `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`. Init SQL goes in `/docker-entrypoint-initdb.d/`. In-network address `mysql:3306`. Healthcheck: `mysqladmin ping -h localhost -uroot -p$MYSQL_ROOT_PASSWORD`. Python clients use `PyMySQL` or `mysqlclient`; the latter needs `apk add --no-cache mariadb-connector-c-dev gcc musl-dev` on alpine. Common pitfalls: MySQL 8 defaults to `caching_sha2_password` which some older drivers can\'t speak — either upgrade the driver or set `default-authentication-plugin=mysql_native_password` in a custom `my.cnf`. Initial boot takes 10-30s; gate dependents on the healthcheck.',
  },
  {
    category: 'mariadb',
    details: { image: 'mariadb:11', port: 3306 },
    text: 'Docker image `mariadb:11` is a known-good tag for running MariaDB 11 — a drop-in MySQL replacement that uses the same compose env shape (`MARIADB_ROOT_PASSWORD`, `MARIADB_DATABASE`, `MARIADB_USER`, `MARIADB_PASSWORD`; the `MYSQL_*` variants also still work). In-network address `mariadb:3306`. Healthcheck: `healthcheck.sh --connect --innodb_initialized` (the image ships this script). Python clients use `PyMySQL` or `mysqlclient`. Prefer MariaDB over MySQL when you want defaults that "just work" with older drivers (it uses `mysql_native_password` auth by default).',
  },
  {
    category: 'redis',
    details: { image: 'redis:7-alpine', port: 6379 },
    text: 'Docker image `redis:7-alpine` is a known-good tag for running Redis 7 as a cache, queue, or session store. No required env vars; the server starts immediately on port 6379. For persistence add `command: redis-server --save 60 1 --appendonly yes`. To require a password: `command: redis-server --requirepass mysecret` and set `REDIS_PASSWORD` on clients. In-network address `redis:6379`. Healthcheck: `redis-cli ping` returning PONG. Memory limit / eviction: `--maxmemory 256mb --maxmemory-policy allkeys-lru`. Python clients use the `redis` package (`pip install redis`); the synchronous client is `redis.Redis(host="redis", port=6379)`. Common pitfalls: forgetting to set `--appendonly yes` and losing data on container restart; binding to `127.0.0.1` inside the container (default binds to all interfaces — leave it alone in compose).',
  },
  {
    category: 'mongodb',
    details: { image: 'mongo:7', port: 27017 },
    text: 'Docker image `mongo:7` is a known-good tag for running MongoDB 7 in compose. Optional env: `MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`, `MONGO_INITDB_DATABASE`. Init scripts in `/docker-entrypoint-initdb.d/` (both `.js` and `.sh` are supported) run on the FIRST boot. In-network address `mongo:27017`. Healthcheck: `mongosh --quiet --eval "db.adminCommand(\'ping\').ok" | grep -q 1`. Python clients use `pymongo`; the URI shape is `mongodb://user:pass@mongo:27017/dbname?authSource=admin`. Common pitfalls: setting only the root user without `?authSource=admin` on the URI (auth fails silently); putting init JS in the wrong place — only `/docker-entrypoint-initdb.d/` is auto-run; expecting a replica set by default (this image starts in standalone mode — transactions and change streams require replica-set init).',
  },
  {
    category: 'mongodb',
    details: { image: 'mongo:6', port: 27017 },
    text: 'Docker image `mongo:6` is a known-good tag for running MongoDB 6 when a project hasn\'t yet migrated to v7 (some ORMs lag the server release). Same compose shape as `mongo:7` — `MONGO_INITDB_ROOT_USERNAME` / `_PASSWORD` env vars, init scripts in `/docker-entrypoint-initdb.d/`, in-network address `mongo:27017`. Prefer `mongo:7` for new sandboxes; pick `mongo:6` only when an older driver matters.',
  },

  // ------------------------------- Messaging ------------------------------
  {
    category: 'apache-kafka',
    details: {
      image: 'confluentinc/cp-kafka:7.6.1',
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
    text: 'Docker image `confluentinc/cp-kafka:7.6.1` is a known-good tag for running Apache Kafka 3.6 in single-node KRaft mode (NO Zookeeper needed). Required environment block on the kafka service: KAFKA_NODE_ID=1, KAFKA_PROCESS_ROLES=broker,controller, KAFKA_CONTROLLER_QUORUM_VOTERS=1@kafka:9093, KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093, KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092, KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT, KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER, KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT, KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1, KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1, KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1, CLUSTER_ID=MkU3OEVBNTcwNTJENDM2Qk. In-network bootstrap server: `kafka:9092`. Common pitfalls: forgetting CLUSTER_ID (container exits immediately with "cluster_id missing"); advertising the wrong hostname so clients hit `localhost:9092` instead of `kafka:9092`; not wrapping producer/consumer bootstrap in a retry-with-backoff loop (Kafka takes 20-40s to be ready even after compose says the container is running). AVOID `bitnami/kafka:*` — many tags have been removed from Docker Hub and pulls now fail with "manifest not found". For HTTP services that connect to Kafka, gate with `depends_on: { kafka: { condition: service_started } }` (not `service_healthy` — KRaft mode has no healthcheck by default).',
  },
  {
    category: 'apache-kafka',
    details: {
      image: 'confluentinc/cp-zookeeper:7.6.1',
      port: 2181,
      pairedWith: 'confluentinc/cp-kafka:7.6.1 (Zookeeper mode)',
    },
    text: 'Docker image `confluentinc/cp-zookeeper:7.6.1` is a known-good tag for Zookeeper, used as a coordination service alongside `confluentinc/cp-kafka:7.6.1` when running Kafka in the legacy Zookeeper mode (instead of KRaft). Required env: ZOOKEEPER_CLIENT_PORT=2181, ZOOKEEPER_TICK_TIME=2000. The paired kafka service then needs: KAFKA_BROKER_ID=1, KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181, KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092, KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092, KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1, KAFKA_AUTO_CREATE_TOPICS_ENABLE=true. Kafka depends_on zookeeper with `condition: service_started`. PREFER KRaft mode (single Kafka container, no Zookeeper) unless the challenge explicitly tests Zookeeper coordination behaviour. AVOID `bitnami/zookeeper:*` — those tags are not available on Docker Hub.',
  },
  {
    category: 'rabbitmq',
    details: { image: 'rabbitmq:3-management', port: 5672, managementPort: 15672 },
    text: 'Docker image `rabbitmq:3-management` is a known-good tag for running RabbitMQ with the web management UI on port 15672 and AMQP on 5672. Default credentials are `guest`/`guest` (only usable from localhost inside the container, but loopback within the container counts so it works fine for in-network access). Set RABBITMQ_DEFAULT_USER and RABBITMQ_DEFAULT_PASS to override. In-network address `rabbitmq:5672` for AMQP, `rabbitmq:15672` for the UI. Healthcheck: `rabbitmq-diagnostics -q ping`. Python clients use `pika`; the connection string is `amqp://user:pass@rabbitmq:5672/`. Common pitfalls: using `guest`/`guest` from outside the container (auth rejected); not wrapping `pika.BlockingConnection` in a retry loop (RabbitMQ takes 5-15s to start accepting). For high-availability tests prefer the `:management-alpine` variants — smaller image.',
  },
  {
    category: 'nats',
    details: { image: 'nats:2-alpine', port: 4222, monitoringPort: 8222 },
    text: 'Docker image `nats:2-alpine` is a known-good tag for running a NATS messaging server. No env vars required; the broker starts on port 4222 (client) and 8222 (monitoring HTTP). To enable JetStream (persistent streams): `command: ["-js", "-sd", "/data"]` and mount a volume at `/data`. In-network address `nats:4222`. Healthcheck: `wget -qO- http://localhost:8222/healthz`. Python clients use `nats-py` (`pip install nats-py`); the connect string is `nats://nats:4222`. Common pitfalls: forgetting `-js` flag when the challenge needs durable streams; assuming clustering — this is a single-node broker.',
  },

  // --------------------------- Web servers & proxies ----------------------
  {
    category: 'nginx',
    details: { image: 'nginx:1.27-alpine', port: 80 },
    text: 'Docker image `nginx:1.27-alpine` is a known-good tag for running nginx as a static file server or reverse proxy. Mount a custom config at `/etc/nginx/conf.d/default.conf` (or replace `/etc/nginx/nginx.conf`); mount static content at `/usr/share/nginx/html/`. In-network address `nginx:80`. Healthcheck: `wget --spider http://localhost/health` (after defining a `/health` location). To act as a reverse proxy in front of an upstream `app` service: `proxy_pass http://app:8080/;`. Common pitfalls: forgetting `proxy_set_header Host $host;` (upstream sees the wrong hostname); using the docker DNS name `app` but the upstream service hasn\'t finished booting (add `resolver 127.0.0.11 valid=10s;` so nginx re-resolves). Alpine variant lacks debug symbols — for tcpdump/strace debugging swap to `nginx:1.27` (debian).',
  },
  {
    category: 'traefik',
    details: { image: 'traefik:v3.1', port: 80, dashboardPort: 8080 },
    text: 'Docker image `traefik:v3.1` is a known-good tag for running Traefik as a reverse proxy with Docker provider auto-discovery. Minimum command: `command: ["--api.insecure=true", "--providers.docker=true", "--providers.docker.exposedbydefault=false", "--entrypoints.web.address=:80"]`. Mount the Docker socket: `volumes: [/var/run/docker.sock:/var/run/docker.sock:ro]`. Then on each upstream service add labels: `traefik.enable=true`, `traefik.http.routers.app.rule=Host(\`app.localhost\`)`, `traefik.http.services.app.loadbalancer.server.port=8080`. Dashboard on port 8080. In-network address `traefik:80`. Common pitfalls: forgetting to mount the docker socket (no auto-discovery); leaving `exposedbydefault=true` (every service gets a route, security issue); using `:latest` (Traefik major versions have breaking config changes — pin to `v3.1`).',
  },
  {
    category: 'haproxy',
    details: { image: 'haproxy:lts-alpine', port: 80 },
    text: 'Docker image `haproxy:lts-alpine` is a known-good tag for running HAProxy as a TCP/HTTP load balancer in front of multiple backend services. Mount the config at `/usr/local/etc/haproxy/haproxy.cfg`. A minimum config has a `frontend` block listening on `*:80` and a `backend` block with `server app1 app1:8080 check` lines. Reload requires SIGUSR2 (haproxy reloads gracefully). In-network address `haproxy:80`. Common pitfalls: forgetting `check` on backend servers (HAProxy doesn\'t health-check them, dead servers get traffic); using `mode http` when backends speak TCP (truncates payload); not exposing the stats socket — add `stats socket /tmp/haproxy.sock mode 660 level admin` in the global block to enable runtime API.',
  },
  {
    category: 'caddy',
    details: { image: 'caddy:2-alpine', port: 80, httpsPort: 443 },
    text: 'Docker image `caddy:2-alpine` is a known-good tag for running Caddy as an auto-HTTPS reverse proxy. Mount a Caddyfile at `/etc/caddy/Caddyfile`. A minimum Caddyfile to proxy to an upstream `app` service:\n  :80 {\n    reverse_proxy app:8080\n  }\nIn-network address `caddy:80`. Auto-HTTPS is disabled when using `:80` explicitly or `http://` prefix; for a real cert, use a public hostname and Caddy will obtain Let\'s Encrypt certs automatically. Common pitfalls: serving on `:443` without a public hostname (Caddy retries cert issuance every few seconds and floods logs); not mounting the data dir at `/data` (each restart re-obtains certs). For sandbox/dev use, prefer `:80` to skip TLS entirely.',
  },

  // ---------------------------- Search & analytics ------------------------
  {
    category: 'elasticsearch',
    details: {
      image: 'docker.elastic.co/elasticsearch/elasticsearch:8.15.0',
      port: 9200,
      note: 'Elastic publishes on docker.elastic.co, not docker.io. Tag must include the full registry path.',
    },
    text: 'Docker image `docker.elastic.co/elasticsearch/elasticsearch:8.15.0` is a known-good tag for running Elasticsearch 8 in compose. Required env: `discovery.type=single-node`, `xpack.security.enabled=false` (for local sandbox use — enables HTTP without auth on port 9200). Memory cap: `ES_JAVA_OPTS=-Xms512m -Xmx512m` (default heap is 50% of host RAM, way too much for a dev container). Mount a volume at `/usr/share/elasticsearch/data`. In-network address `elasticsearch:9200`. Healthcheck: `curl -fsSL http://localhost:9200/_cluster/health`. Python clients use `elasticsearch` (`pip install elasticsearch==8.15`). IMPORTANT: Elastic publishes on `docker.elastic.co`, NOT Docker Hub — use the full registry path or the pull fails with "manifest not found". Common pitfalls: forgetting `discovery.type=single-node` (boot waits forever for cluster peers); not capping `ES_JAVA_OPTS` (OOM kills on a dev machine).',
  },
  {
    category: 'opensearch',
    details: { image: 'opensearchproject/opensearch:2', port: 9200 },
    text: 'Docker image `opensearchproject/opensearch:2` is a known-good tag for running OpenSearch 2 (Elasticsearch fork from AWS, fully on Docker Hub — no registry prefix needed). Required env: `discovery.type=single-node`, `DISABLE_SECURITY_PLUGIN=true` (skip TLS + auth for local dev), `OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m`. In-network address `opensearch:9200`. Healthcheck: `curl -fsSL http://localhost:9200`. Python clients use `opensearch-py`; the API is 95% compatible with the Elasticsearch Python client (queries, mappings, bulk API all the same). Common pitfalls: leaving security enabled (requires HTTPS + the demo admin password `admin/admin`, then `admin/<changed>` since 2.12+); forgetting `vm.max_map_count=262144` on the host (Linux only — set with `sysctl -w` or via `ulimits` in compose).',
  },
  {
    category: 'clickhouse',
    details: { image: 'clickhouse/clickhouse-server:24.8-alpine', port: 8123, nativePort: 9000 },
    text: 'Docker image `clickhouse/clickhouse-server:24.8-alpine` is a known-good tag for running ClickHouse 24.8 as an OLAP/analytics warehouse. HTTP API on 8123, native (TCP) protocol on 9000. Env: `CLICKHOUSE_DB`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`. Init SQL in `/docker-entrypoint-initdb.d/`. In-network HTTP address `clickhouse:8123`. Healthcheck: `wget --spider http://localhost:8123/ping`. Python clients use `clickhouse-connect` (HTTP) or `clickhouse-driver` (native TCP). Common pitfalls: setting `ulimits: nofile: { soft: 262144, hard: 262144 }` is required on Linux hosts under heavy load (default 1024 causes "too many open files"); using INSERT one row at a time over HTTP (ClickHouse is column-store — batch in 1000-100000 rows per insert).',
  },

  // ------------------------------- Big data -------------------------------
  {
    category: 'apache-spark',
    details: { image: 'apache/spark:3.5.3', port: 7077, uiPort: 8080 },
    text: 'Docker image `apache/spark:3.5.3` is a known-good tag for running Apache Spark 3.5. For a standalone cluster in compose: run `spark-master` with `command: /opt/spark/sbin/start-master.sh` (or `command: bash -c "/opt/spark/sbin/start-master.sh && tail -f /opt/spark/logs/*.out"` so the container stays alive), and one or more `spark-worker` services with `command: /opt/spark/sbin/start-worker.sh spark://spark-master:7077`. Master UI on port 8080, worker bind on 8081. In-network master URL `spark://spark-master:7077`. For a single-process "local mode" job, the simplest form is to `docker run --rm apache/spark:3.5.3 /opt/spark/bin/spark-submit --master local[*] /opt/app/job.py`. PySpark scripts need Python 3.9-3.11 inside the container (image ships Python 3.11). Common pitfalls: workers can\'t reach the master because compose service names need DNS — use `spark-master`, not `localhost`; running spark-submit in `client` mode from outside the cluster requires the driver port to be reachable, easier to use `cluster` mode for in-compose jobs.',
  },
  {
    category: 'trino',
    details: { image: 'trinodb/trino:451', port: 8080 },
    text: 'Docker image `trinodb/trino:451` is a known-good tag for running Trino (formerly Presto SQL), a distributed SQL query engine across heterogeneous sources. Default port 8080 (HTTP). Catalog configs go in `/etc/trino/catalog/*.properties`, one file per data source (e.g. `postgres.properties`, `mysql.properties`, `iceberg.properties`). In-network address `trino:8080`. Connect with `trino --server trino:8080 --catalog postgres --schema public`. JDBC URL: `jdbc:trino://trino:8080`. Common pitfalls: the catalog files MUST be mounted before the container starts (Trino reads them once at boot — not hot-reloaded); using `:latest` (versions move quickly, breaking SQL features); single-node deployments are query-coordinator + worker in the same JVM — fine for dev, not prod.',
  },
  {
    category: 'apache-airflow',
    details: { image: 'apache/airflow:2.9.3', port: 8080, requiresPostgres: true },
    text: 'Docker image `apache/airflow:2.9.3` is a known-good tag for running Apache Airflow 2.9 in compose. AIRFLOW REQUIRES A METADATA DB — point it at a postgres service via `AIRFLOW__DATABASE__SQL_ALCHEMY_CONN=postgresql+psycopg2://airflow:airflow@postgres/airflow`. Set `AIRFLOW__CORE__EXECUTOR=LocalExecutor` for a single-node setup. The official quickstart compose has 4+ services (webserver, scheduler, triggerer, postgres, redis); for a tiny sandbox you can collapse webserver+scheduler into one container with `command: bash -c "airflow db migrate && airflow users create --username admin --password admin --firstname A --lastname B --role Admin --email a@b.com && airflow standalone"`. UI on 8080, default creds `admin`/`admin`. Mount DAGs at `/opt/airflow/dags/`. Common pitfalls: forgetting `AIRFLOW__CORE__LOAD_EXAMPLES=false` (example DAGs clutter the UI); running with `SQLiteExecutor` and expecting parallelism (won\'t work); not initializing the DB before starting webserver (run `airflow db migrate` first).',
  },

  // ------------------------------ Observability ---------------------------
  {
    category: 'prometheus',
    details: { image: 'prom/prometheus:v2.55.1', port: 9090 },
    text: 'Docker image `prom/prometheus:v2.55.1` is a known-good tag for running Prometheus as a metrics scraper. Mount `prometheus.yml` at `/etc/prometheus/prometheus.yml`. A minimum config:\n  global:\n    scrape_interval: 15s\n  scrape_configs:\n    - job_name: \'app\'\n      static_configs:\n        - targets: [\'app:8080\']\nIn-network address `prometheus:9090`. Mount a volume at `/prometheus` for TSDB data. UI/query browser at `:9090/graph`. Common pitfalls: scrape targets MUST resolve via compose DNS (use service names, not `localhost`); using `latest` (v2.x → v3.x has breaking changes — pin); 15s scrape interval is fine for dev but adds up — set higher (60s) if you have many targets.',
  },
  {
    category: 'grafana',
    details: { image: 'grafana/grafana:10.4.10', port: 3000 },
    text: 'Docker image `grafana/grafana:10.4.10` is a known-good tag for running Grafana with default username/password `admin`/`admin` (forced password change on first login — set `GF_SECURITY_ADMIN_PASSWORD` to skip that). Mount datasource provisioning at `/etc/grafana/provisioning/datasources/`, dashboards at `/etc/grafana/provisioning/dashboards/`. Provision a Prometheus datasource by dropping a YAML file:\n  apiVersion: 1\n  datasources:\n    - name: Prometheus\n      type: prometheus\n      url: http://prometheus:9090\n      access: proxy\n      isDefault: true\nIn-network address `grafana:3000`. Common pitfalls: forgetting `access: proxy` (browser tries to hit `localhost:9090`); dropping a dashboard JSON without the YAML provider config (Grafana doesn\'t pick it up); setting a custom admin password in env after first boot (no effect — the password is hashed in the SQLite metadata DB after first boot).',
  },
  {
    category: 'jaeger',
    details: {
      image: 'jaegertracing/all-in-one:1.60',
      uiPort: 16686,
      otlpGrpcPort: 4317,
      otlpHttpPort: 4318,
    },
    text: 'Docker image `jaegertracing/all-in-one:1.60` is a known-good tag for running the Jaeger distributed tracing UI + collector + agent in a single container (development only). UI on port 16686; OTLP gRPC ingest on 4317; OTLP HTTP on 4318; Zipkin compatibility on 9411. Set `COLLECTOR_OTLP_ENABLED=true` to enable OTLP (default in 1.35+). In-network address `jaeger:16686` for UI, `jaeger:4317` for trace ingest. Python applications use `opentelemetry-exporter-otlp` and configure the OTLP exporter endpoint to `http://jaeger:4318/v1/traces` (HTTP) or `jaeger:4317` (gRPC). Common pitfalls: trying to send via the legacy Jaeger agent UDP protocol on port 6831 (deprecated — use OTLP); expecting persistence (all-in-one uses in-memory storage that resets every restart — for persistence run separate collector + storage + query services).',
  },
  {
    category: 'opentelemetry',
    details: { image: 'otel/opentelemetry-collector-contrib:0.108.0', otlpGrpcPort: 4317, otlpHttpPort: 4318 },
    text: 'Docker image `otel/opentelemetry-collector-contrib:0.108.0` is a known-good tag for running the OpenTelemetry Collector with all contrib receivers/exporters (Kafka, Postgres, Jaeger, etc.). Mount a config at `/etc/otelcol-contrib/config.yaml`. A minimum config:\n  receivers:\n    otlp:\n      protocols:\n        grpc:\n          endpoint: 0.0.0.0:4317\n        http:\n          endpoint: 0.0.0.0:4318\n  exporters:\n    debug: {}\n  service:\n    pipelines:\n      traces:\n        receivers: [otlp]\n        exporters: [debug]\nIn-network address `otelcol:4317` (gRPC), `otelcol:4318` (HTTP). Use the `-contrib` image (not the slim `otel/opentelemetry-collector`) whenever you need processors like `tail_sampling` or exporters like `kafka`/`elasticsearch`. Common pitfalls: pinning the wrong sub-image (`-contrib` vs minimal); config schema changes between collector versions — pin to a specific patch.',
  },

  // -------------------- Object storage & cloud emulation ------------------
  {
    category: 'minio',
    details: {
      image: 'minio/minio:RELEASE.2024-09-13T20-26-02Z',
      port: 9000,
      consolePort: 9001,
    },
    text: 'Docker image `minio/minio:RELEASE.2024-09-13T20-26-02Z` is a known-good tag for running MinIO as an S3-compatible object store. Required env: `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` (both at least 8 chars or MinIO refuses to start). Required command: `server /data --console-address :9001` — without the `server` argument and a data path, the container exits immediately. S3 API on 9000, browser console on 9001. In-network S3 endpoint `http://minio:9000`. Python clients use `boto3` with `endpoint_url=http://minio:9000`, `aws_access_key_id=$MINIO_ROOT_USER`, `aws_secret_access_key=$MINIO_ROOT_PASSWORD`, `region_name=us-east-1`, `config=Config(signature_version=\'s3v4\')`. Common pitfalls: passing only `MINIO_ACCESS_KEY` (legacy env var, ignored in current versions — use `MINIO_ROOT_USER`); forgetting `--console-address` (browser UI bound to a random high port that compose doesn\'t expose); buckets not auto-created — either run `mc mb` from a sidecar or have the app create them on startup.',
  },
  {
    category: 'localstack',
    details: { image: 'localstack/localstack:3', port: 4566 },
    text: 'Docker image `localstack/localstack:3` is a known-good tag for emulating AWS services locally (S3, SQS, SNS, DynamoDB, Lambda, etc.) in a single container. All services exposed on port 4566 (the "edge port"). Env: `SERVICES=s3,sqs,dynamodb` (comma-separated list — leave unset for all). In-network endpoint `http://localstack:4566`. Python clients use `boto3` with `endpoint_url=http://localstack:4566`, dummy credentials `test`/`test`, and `region_name=us-east-1`. The community edition (this image) covers most service core features; Pro edition (`localstack/localstack-pro`) adds Lambda runtime variants, RDS, etc. Common pitfalls: forgetting to set `endpoint_url` on every boto3 client (default goes to real AWS); expecting state to persist across restarts (community edition is ephemeral — set `PERSISTENCE=1` to enable; Pro edition is needed for some service persistence).',
  },

  // ---------------------------- Language runtimes -------------------------
  {
    category: 'python',
    details: { image: 'python:3.11-alpine' },
    text: 'Docker image `python:3.11-alpine` is a known-good base for small Python services (~50MB compressed vs 950MB for `python:3.11`). USE WHEN: the service has minimal C-extension dependencies. AVOID WHEN: you need `psycopg2` from source (compile fails without `apk add postgresql-dev gcc musl-dev` first) or `pyarrow`/`grpcio` (wheels typically don\'t ship for musl). Default Dockerfile template:\n  FROM python:3.11-alpine\n  WORKDIR /app\n  COPY requirements.txt .\n  RUN pip install --no-cache-dir -r requirements.txt\n  COPY . .\n  CMD ["python", "app.py"]\nFor `psycopg2`, prefer `psycopg2-binary` in requirements.txt over `psycopg2` — avoids the apk build dance. For `cryptography` add `apk add --no-cache gcc musl-dev libffi-dev openssl-dev`.',
  },
  {
    category: 'python',
    details: { image: 'python:3.12-slim' },
    text: 'Docker image `python:3.12-slim` is a known-good base for Python services that need more compatibility than alpine offers (~120MB compressed, debian-bookworm-based, glibc-compatible). USE WHEN: you depend on `psycopg2`, `pyarrow`, `grpcio`, `tensorflow`, or any package whose musl wheels are missing. C-extension compile deps: `apt-get install -y --no-install-recommends build-essential libpq-dev` (then `apt-get clean && rm -rf /var/lib/apt/lists/*` to keep the image small). Dockerfile template same as alpine. PREFER `python:3.12-slim` over `python:3.12` (full): same compatibility, ~10x smaller. AVOID `python:slim` without a version tag — `latest` moves silently and breaks reproducibility.',
  },
  {
    category: 'node',
    details: { image: 'node:20-alpine' },
    text: 'Docker image `node:20-alpine` is a known-good base for Node.js 20 services (~120MB compressed). Default user `node` (UID 1000) is unprivileged — RUN as that user. Dockerfile template:\n  FROM node:20-alpine\n  WORKDIR /app\n  COPY package*.json ./\n  RUN npm ci --only=production\n  COPY . .\n  USER node\n  CMD ["node", "server.js"]\nFor packages with native bindings (`bcrypt`, `sharp`, `node-gyp`): add `apk add --no-cache python3 make g++` then `npm rebuild`. AVOID using `npm install` in containers (non-deterministic — use `npm ci` against a committed `package-lock.json`). Same caveats around musl as Python: some packages don\'t ship Alpine wheels — switch to `node:20-bookworm-slim` if you hit them.',
  },
  {
    category: 'java',
    details: { image: 'eclipse-temurin:21-jre' },
    text: 'Docker image `eclipse-temurin:21-jre` is a known-good base for running prebuilt Java 21 JARs (~250MB; the `-jre` variant has no JDK, smaller than `-jdk`). Eclipse Temurin is the current preferred OpenJDK distribution — `openjdk:*` Docker Hub images are deprecated (no new tags since 2022). Dockerfile template for a Spring Boot app:\n  FROM eclipse-temurin:21-jre\n  WORKDIR /app\n  COPY target/app.jar app.jar\n  EXPOSE 8080\n  ENTRYPOINT ["java", "-jar", "app.jar"]\nFor multi-stage builds with Maven, use `maven:3.9-eclipse-temurin-21` as the builder stage. JVM tuning for containers: `JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75 -Xss256k"`.',
  },
  {
    category: 'golang',
    details: { image: 'golang:1.23-alpine' },
    text: 'Docker image `golang:1.23-alpine` is a known-good base for Go 1.23 build stages (~250MB with toolchain). PREFER multi-stage Dockerfiles to ship only the binary:\n  FROM golang:1.23-alpine AS builder\n  WORKDIR /src\n  COPY go.mod go.sum ./\n  RUN go mod download\n  COPY . .\n  RUN CGO_ENABLED=0 GOOS=linux go build -o /app ./cmd/server\n\n  FROM alpine:3.20\n  RUN apk add --no-cache ca-certificates\n  COPY --from=builder /app /app\n  ENTRYPOINT ["/app"]\nFinal runtime image is ~10MB. Set `CGO_ENABLED=0` for a fully-static binary; if you need cgo (e.g. `mattn/go-sqlite3`), keep CGO on but stay on alpine and add `apk add --no-cache gcc musl-dev`. AVOID `go run` in containers (re-compiles every restart, slow); always `go build` into a binary.',
  },
];

module.exports = { CATALOG };
