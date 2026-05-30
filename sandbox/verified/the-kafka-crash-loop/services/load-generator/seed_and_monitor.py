import json
import os
import time
import uuid
import sys
import psycopg2
from kafka import KafkaProducer, KafkaAdminClient, KafkaConsumer
from kafka.admin import NewTopic
from kafka.errors import TopicAlreadyExistsError

BOOTSTRAP_SERVERS = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092').split(',')
TOPIC = os.environ.get('KAFKA_TOPIC', 'orders')
GROUP_ID = os.environ.get('KAFKA_GROUP_ID', 'order-worker-group')
POSTGRES_DSN = os.environ.get('POSTGRES_DSN', 'postgresql://orders:orders@postgres:5432/orders')
METRIC_INTERVAL = int(os.environ.get('METRIC_INTERVAL_SECONDS', '1'))

TOTAL_MESSAGES = 20
POISON_PILL_OFFSET = 3

def wait_for_kafka():
    for attempt in range(30):
        try:
            admin = KafkaAdminClient(bootstrap_servers=BOOTSTRAP_SERVERS)
            admin.close()
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError('Kafka not available after 60s')

def ensure_topic():
    try:
        admin = KafkaAdminClient(bootstrap_servers=BOOTSTRAP_SERVERS)
        topic = NewTopic(name=TOPIC, num_partitions=1, replication_factor=1)
        admin.create_topics([topic])
        admin.close()
    except TopicAlreadyExistsError:
        pass
    except Exception as e:
        print(f'Topic creation note: {e}', flush=True)

def seed_messages():
    producer = KafkaProducer(
        bootstrap_servers=BOOTSTRAP_SERVERS,
        value_serializer=lambda v: json.dumps(v).encode('utf-8'),
        acks='all'
    )
    for i in range(TOTAL_MESSAGES):
        if i == POISON_PILL_OFFSET:
            msg = {
                'customer_id': f'customer-malformed-{i}',
                'amount': 99.99,
                'status': 'pending'
            }
        else:
            msg = {
                'order_id': str(uuid.uuid4()),
                'customer_id': f'customer-{i}',
                'amount': round(10.0 + i * 5.5, 2),
                'status': 'pending'
            }
        producer.send(TOPIC, msg)
    producer.flush()
    producer.close()
    print(f'Seeded {TOTAL_MESSAGES} messages to topic {TOPIC} (poison-pill at offset {POISON_PILL_OFFSET})', flush=True)

def get_consumer_lag():
    try:
        consumer = KafkaConsumer(
            bootstrap_servers=BOOTSTRAP_SERVERS,
            group_id='__lag_checker__',
            auto_offset_reset='earliest',
            enable_auto_commit=False,
            consumer_timeout_ms=2000
        )
        partitions = consumer.partitions_for_topic(TOPIC)
        if not partitions:
            consumer.close()
            return 0.0
        from kafka import TopicPartition
        tps = [TopicPartition(TOPIC, p) for p in partitions]
        end_offsets = consumer.end_offsets(tps)
        consumer.close()

        committed_consumer = KafkaConsumer(
            bootstrap_servers=BOOTSTRAP_SERVERS,
            group_id=GROUP_ID,
            enable_auto_commit=False,
            consumer_timeout_ms=2000
        )
        total_lag = 0.0
        for tp in tps:
            committed = committed_consumer.committed(tp)
            end = end_offsets.get(tp, 0)
            if committed is None:
                committed = 0
            lag = max(0, end - committed)
            total_lag += lag
        committed_consumer.close()
        return float(total_lag)
    except Exception:
        return 0.0

def get_db_row_count():
    try:
        conn = psycopg2.connect(POSTGRES_DSN)
        with conn.cursor() as cur:
            cur.execute('SELECT COUNT(*) FROM orders')
            count = cur.fetchone()[0]
        conn.close()
        return count
    except Exception:
        return 0

def main():
    wait_for_kafka()
    ensure_topic()
    time.sleep(2)
    seed_messages()
    time.sleep(3)

    errors_seen = 0
    while True:
        lag = get_consumer_lag()
        db_count = get_db_row_count()
        expected = TOTAL_MESSAGES - 1
        if db_count < expected:
            errors_seen = expected - db_count
        else:
            errors_seen = 0
        latency = lag * 10.0
        db_cpu = 0.1 if db_count >= expected else 0.5
        print(f'METRIC latency={latency:.1f} errors={errors_seen} dbCpu={db_cpu:.2f}', flush=True)
        time.sleep(METRIC_INTERVAL)

if __name__ == '__main__':
    main()
