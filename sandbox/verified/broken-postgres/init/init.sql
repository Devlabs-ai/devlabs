-- Initial seed for the broken-postgres challenge.
-- Intentionally creates a large unindexed orders table so that
-- SELECT ... WHERE user_id = $1 performs a sequential scan.

CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY,
    username  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    product_sku TEXT    NOT NULL,
    amount_cents INTEGER NOT NULL,
    status      TEXT    NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 200 users
INSERT INTO users (id, username)
SELECT g, 'user_' || g FROM generate_series(1, 200) AS g
ON CONFLICT (id) DO NOTHING;

-- 500,000 orders, evenly distributed across users.
-- No index on user_id => sequential scans on WHERE user_id = $1.
-- Each user has ~2,500 orders so aggregations must scan many rows.
INSERT INTO orders (user_id, product_sku, amount_cents, status, created_at)
SELECT
    1 + (random() * 199)::INT,
    'SKU-' || (1 + (random() * 999)::INT),
    100 + (random() * 9000)::INT,
    (ARRAY['pending', 'paid', 'shipped', 'delivered', 'cancelled'])[1 + (random() * 4)::INT],
    now() - (random() * INTERVAL '90 days')
FROM generate_series(1, 500000);

ANALYZE orders;
