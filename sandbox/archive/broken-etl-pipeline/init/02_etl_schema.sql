\connect etl_db

CREATE TABLE IF NOT EXISTS raw_orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    order_date TIMESTAMP NOT NULL,
    item_count INTEGER NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    status VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_orders (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    order_date TIMESTAMP NOT NULL,
    total_amount NUMERIC(10,2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    processed_at TIMESTAMP NOT NULL
);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO etl_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO etl_user;

INSERT INTO raw_orders (customer_id, order_date, item_count, unit_price, status) VALUES
(1,  NOW() - INTERVAL '1 day',  3,  25.00, 'delivered'),
(2,  NOW() - INTERVAL '2 days', 1,  99.99, 'shipped'),
(3,  NOW() - INTERVAL '3 days', 5,  12.50, 'confirmed'),
(4,  NOW() - INTERVAL '4 days', 2,  45.00, 'pending'),
(5,  NOW() - INTERVAL '5 days', 7,  8.75,  'delivered'),
(6,  NOW() - INTERVAL '6 days', 1,  150.00,'shipped'),
(7,  NOW() - INTERVAL '7 days', 4,  33.00, 'confirmed'),
(8,  NOW() - INTERVAL '8 days', 2,  60.00, 'delivered'),
(9,  NOW() - INTERVAL '9 days', 6,  22.00, 'pending'),
(10, NOW() - INTERVAL '10 days',3,  75.00, 'shipped'),
(11, NOW() - INTERVAL '11 days',1,  5.00,  'delivered'),
(12, NOW() - INTERVAL '12 days',8,  18.50, 'confirmed'),
(13, NOW() - INTERVAL '13 days',2,  90.00, 'shipped'),
(14, NOW() - INTERVAL '14 days',4,  40.00, 'delivered'),
(15, NOW() - INTERVAL '15 days',5,  55.00, 'pending'),
(1,  NOW() - INTERVAL '16 days',3,  30.00, 'confirmed'),
(2,  NOW() - INTERVAL '17 days',1,  110.00,'delivered'),
(3,  NOW() - INTERVAL '18 days',9,  15.00, 'shipped'),
(4,  NOW() - INTERVAL '19 days',2,  85.00, 'confirmed'),
(5,  NOW() - INTERVAL '20 days',6,  10.00, 'pending'),
(6,  NOW() - INTERVAL '21 days',1,  125.00,'delivered'),
(7,  NOW() - INTERVAL '22 days',3,  48.00, 'shipped'),
(8,  NOW() - INTERVAL '23 days',4,  20.00, 'confirmed'),
(9,  NOW() - INTERVAL '24 days',2,  95.00, 'pending'),
(10, NOW() - INTERVAL '25 days',7,  35.00, 'delivered'),
(11, NOW() - INTERVAL '26 days',1,  70.00, 'shipped'),
(12, NOW() - INTERVAL '27 days',5,  28.00, 'confirmed'),
(13, NOW() - INTERVAL '28 days',3,  140.00,'delivered'),
(14, NOW() - INTERVAL '29 days',2,  50.00, 'pending'),
(15, NOW() - INTERVAL '30 days',4,  65.00, 'shipped'),
(1,  NOW() - INTERVAL '1 day',  2,  42.00, 'confirmed'),
(2,  NOW() - INTERVAL '2 days', 3,  17.50, 'delivered'),
(3,  NOW() - INTERVAL '3 days', 1,  105.00,'shipped'),
(4,  NOW() - INTERVAL '4 days', 6,  9.00,  'pending'),
(5,  NOW() - INTERVAL '5 days', 2,  80.00, 'confirmed'),
(6,  NOW() - INTERVAL '6 days', 4,  55.00, 'delivered'),
(7,  NOW() - INTERVAL '7 days', 1,  130.00,'shipped'),
(8,  NOW() - INTERVAL '8 days', 3,  25.00, 'pending'),
(9,  NOW() - INTERVAL '9 days', 5,  38.00, 'confirmed'),
(10, NOW() - INTERVAL '10 days',2,  92.00, 'delivered'),
(11, NOW() - INTERVAL '11 days',7,  14.00, 'shipped'),
(12, NOW() - INTERVAL '12 days',1,  120.00,'confirmed'),
(13, NOW() - INTERVAL '13 days',4,  45.00, 'pending'),
(14, NOW() - INTERVAL '14 days',3,  60.00, 'delivered'),
(15, NOW() - INTERVAL '15 days',2,  75.00, 'shipped'),
(1,  NOW() - INTERVAL '16 days',5,  22.00, 'confirmed'),
(2,  NOW() - INTERVAL '17 days',2,  88.00, 'delivered'),
(3,  NOW() - INTERVAL '18 days',3,  33.00, 'shipped'),
(4,  NOW() - INTERVAL '19 days',1,  145.00,'pending'),
(5,  NOW() - INTERVAL '20 days',4,  19.50, 'confirmed');
