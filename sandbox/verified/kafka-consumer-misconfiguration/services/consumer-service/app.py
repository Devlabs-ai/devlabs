from kafka import KafkaConsumer
import logging
import time

logging.basicConfig(level=logging.INFO)

consumer = None
attempts = 0
while not consumer and attempts < 5:
    try:
        consumer = KafkaConsumer(
            'test-topic',
            bootstrap_servers='kafka:9092',
            group_id='my-group'
        )
    except Exception as e:
        logging.error(f"Error connecting to Kafka: {e}")
        time.sleep(5)
        attempts += 1

if not consumer:
    logging.error("Failed to connect to Kafka after retries.")
else:
    for message in consumer:
        logging.info(f"Received message: {message.value}")
