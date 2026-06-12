import os
import json
import time
import redis
import psycopg2
import psycopg2.extras
from flask import Flask, request, jsonify

app = Flask(__name__)

REDIS_HOST = os.environ.get('REDIS_HOST', 'redis')
REDIS_PORT = int(os.environ.get('REDIS_PORT', 6379))
POSTGRES_HOST = os.environ.get('POSTGRES_HOST', 'postgres')
POSTGRES_PORT = int(os.environ.get('POSTGRES_PORT', 5432))
POSTGRES_DB = os.environ.get('POSTGRES_DB', 'catalog')
POSTGRES_USER = os.environ.get('POSTGRES_USER', 'catalog')
POSTGRES_PASSWORD = os.environ.get('POSTGRES_PASSWORD', 'catalog')

CACHE_TTL = 3600  # intentionally long TTL to make staleness visible


def get_redis():
    return redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


def get_db():
    return psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        dbname=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD
    )


@app.route('/products/<int:product_id>', methods=['GET'])
def get_product(product_id):
    r = get_redis()
    cache_key = f'product:{product_id}'

    # Cache-aside: check Redis first
    cached = r.get(cache_key)
    if cached:
        data = json.loads(cached)
        data['source'] = 'cache'
        return jsonify(data)

    # Cache miss: read from Postgres
    conn = get_db()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            'SELECT id, name, price::text, updated_at::text FROM products WHERE id = %s',
            (product_id,)
        )
        row = cur.fetchone()
        if row is None:
            return jsonify({'error': 'not found'}), 404
        product = dict(row)
        # Populate cache with long TTL (bug: writes never invalidate this)
        r.setex(cache_key, CACHE_TTL, json.dumps(product))
        product['source'] = 'db'
        return jsonify(product)
    finally:
        conn.close()


@app.route('/products/<int:product_id>', methods=['PUT'])
def update_product(product_id):
    data = request.get_json(force=True)
    name = data.get('name')
    price = data.get('price')

    conn = get_db()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            'UPDATE products SET name = %s, price = %s, updated_at = NOW() '
            'WHERE id = %s RETURNING id, name, price::text, updated_at::text',
            (name, price, product_id)
        )
        row = cur.fetchone()
        conn.commit()
        if row is None:
            return jsonify({'error': 'not found'}), 404

        # BUG: We do NOT invalidate the Redis cache key here.
        # The stale cache entry will continue to be served until TTL expires (3600s).
        # FIX would be: r = get_redis(); r.delete(f'product:{product_id}')

        return jsonify(dict(row))
    finally:
        conn.close()


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


@app.route('/products/<int:product_id>/cache-check', methods=['GET'])
def cache_check(product_id):
    """Returns what is currently in the Redis cache for a product (for validation)."""
    r = get_redis()
    cache_key = f'product:{product_id}'
    cached = r.get(cache_key)
    if cached:
        return jsonify({'cached': True, 'data': json.loads(cached)})
    return jsonify({'cached': False, 'data': None})


if __name__ == '__main__':
    # Wait for Postgres to be ready
    print('Waiting for Postgres...', flush=True)
    for attempt in range(30):
        try:
            conn = get_db()
            conn.close()
            print('Postgres is ready.', flush=True)
            break
        except Exception as e:
            print(f'Postgres not ready (attempt {attempt+1}/30): {e}', flush=True)
            time.sleep(2)

    # Wait for Redis to be ready
    print('Waiting for Redis...', flush=True)
    for attempt in range(30):
        try:
            r = get_redis()
            r.ping()
            print('Redis is ready.', flush=True)
            break
        except Exception as e:
            print(f'Redis not ready (attempt {attempt+1}/30): {e}', flush=True)
            time.sleep(2)

    print('Starting Flask on 0.0.0.0:5000', flush=True)
    app.run(host='0.0.0.0', port=5000, debug=False)
