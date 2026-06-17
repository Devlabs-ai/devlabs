import json
import os
import uuid
from flask import Flask, request, jsonify
from kafka import KafkaProducer

app = Flask(__name__)

BOOTSTRAP_SERVERS = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
TOPIC = os.environ.get('KAFKA_TOPIC', 'orders')

producer = None

def get_producer():
    global producer
    if producer is None:
        producer = KafkaProducer(
            bootstrap_servers=BOOTSTRAP_SERVERS,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            acks='all',
            retries=3
        )
    return producer

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'}), 200

@app.route('/orders', methods=['POST'])
def create_order():
    data = request.get_json(force=True)
    if not data:
        return jsonify({'error': 'Invalid JSON'}), 400
    required = ['customer_id', 'amount']
    for field in required:
        if field not in data:
            return jsonify({'error': f'Missing field: {field}'}), 400
    order = {
        'order_id': str(uuid.uuid4()),
        'customer_id': data['customer_id'],
        'amount': float(data['amount']),
        'status': 'pending'
    }
    get_producer().send(TOPIC, order)
    get_producer().flush()
    return jsonify({'order_id': order['order_id'], 'status': 'queued'}), 202

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
