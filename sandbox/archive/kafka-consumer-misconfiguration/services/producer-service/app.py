from kafka import KafkaProducer
import time
import logging

logging.basicConfig(level=logging.INFO)

producer = None
attempts = 0
while not producer and attempts < 5:
    try:
        producer = KafkaProducer(bootstrap_servers='kafka:9092')
    except Exception as e:
        logging.error(f"Error connecting to Kafka: {e}")
        time.sleep(5)
        attempts += 1

if not producer:
    logging.error("Failed to connect to Kafka after retries.")
else:
    while True:
        producer.send('test-topic', b'Test Message')
        producer.flush()
        time.sleep(1)
