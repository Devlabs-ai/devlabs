import os
import time
import psycopg2
import psycopg2.extras
from flask import Flask, jsonify

app = Flask(__name__)


def get_db_connection():
    return psycopg2.connect(
        host=os.environ.get('DB_HOST', 'postgres'),
        port=int(os.environ.get('DB_PORT', 5432)),
        dbname=os.environ.get('DB_NAME', 'shop'),
        user=os.environ.get('DB_USER', 'postgres'),
        password=os.environ.get('DB_PASSWORD', 'postgres'),
    )


def wait_for_db():
    for _ in range(30):
        try:
            conn = get_db_connection()
            conn.close()
            return
        except Exception:
            time.sleep(2)


@app.route('/api/orders', methods=['GET'])
def get_orders():
    conn = get_db_connection()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute('SELECT id, customer_name, product_id, quantity, status, created_at FROM orders ORDER BY created_at DESC;')
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get('created_at'):
                d['created_at'] = d['created_at'].isoformat()
            result.append(d)
        return jsonify(result)
    finally:
        conn.close()


@app.route('/api/products', methods=['GET'])
def get_products_passthrough():
    conn = get_db_connection()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute('SELECT id, customer_name, product_id, quantity, status, created_at FROM orders ORDER BY created_at DESC;')
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get('created_at'):
                d['created_at'] = d['created_at'].isoformat()
            result.append(d)
        return jsonify(result)
    finally:
        conn.close()


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    wait_for_db()
    app.run(host='0.0.0.0', port=3001, debug=False)
