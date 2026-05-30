import json
import os
import time
import psycopg2
from kafka import KafkaConsumer

BOOTSTRAP_SERVERS = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092').split(',')
TOPIC = os.environ.get('KAFKA_TOPIC', 'orders')
GROUP_ID = os.environ.get('KAFKA_GROUP_ID', 'order-worker-group')
POSTGRES_DSN = os.environ.get('POSTGRES_DSN', 'postgresql://orders:orders@postgres:5432/orders')

def get_db_connection():
    return psycopg2.connect(POSTGRES_DSN)

def process_order(conn, order):
    order_id = order['order_id']
    customer_id = order['customer_id']
    amount = float(order['amount'])
    status = order.get('status', 'processed')
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO orders (order_id, customer_id, amount, status)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (order_id) DO NOTHING
            """,
            (order_id, customer_id, amount, status)
        )
    conn.commit()

def main():
    time.sleep(5)
    conn = get_db_connection()
    consumer = KafkaConsumer(
        TOPIC,
        bootstrap_servers=BOOTSTRAP_SERVERS,
        group_id=GROUP_ID,
        auto_offset_reset='earliest',
        enable_auto_commit=False,
        value_deserializer=lambda m: json.loads(m.decode('utf-8'))
    )
    print(f'Worker started. Consuming from topic: {TOPIC}', flush=True)
    for message in consumer:
        order = message.value
        order_id = order['order_id']
        customer_id = order['customer_id']
        amount = float(order['amount'])
        status = order.get('status', 'processed')
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO orders (order_id, customer_id, amount, status)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (order_id) DO NOTHING
                """,
                (order_id, customer_id, amount, status)
            )
        conn.commit()
        print(f'Processed order: {order_id}', flush=True)

if __name__ == '__main__':
    main()
