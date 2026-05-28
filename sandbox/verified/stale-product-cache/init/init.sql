CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO products (name, price) VALUES
    ('Widget Alpha', 9.99),
    ('Widget Beta', 19.99),
    ('Gadget Prime', 49.99),
    ('Gadget Ultra', 99.99),
    ('Doohickey Standard', 14.99),
    ('Doohickey Pro', 29.99),
    ('Thingamajig Basic', 7.99),
    ('Thingamajig Plus', 24.99),
    ('Whatsit Lite', 4.99),
    ('Whatsit Max', 39.99);
