CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price NUMERIC(10,2) NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_name VARCHAR(200) NOT NULL,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO products (name, description, price, stock_quantity) VALUES
    ('Wireless Noise-Cancelling Headphones', 'Premium over-ear headphones with 30-hour battery life and active noise cancellation.', 149.99, 85),
    ('Ergonomic Office Chair', 'Adjustable lumbar support, breathable mesh back, and 5-year warranty.', 329.00, 40),
    ('Mechanical Keyboard', 'Compact TKL layout with Cherry MX Red switches and RGB backlighting.', 89.95, 120),
    ('4K USB-C Monitor 27"', 'IPS panel with 99% sRGB coverage, 60Hz refresh rate, and USB-C power delivery.', 499.00, 25),
    ('Portable Bluetooth Speaker', 'IPX7 waterproof, 360-degree sound, 12-hour playtime.', 59.99, 200),
    ('Smart LED Desk Lamp', 'Touch-sensitive dimming, color temperature control, and USB charging port.', 34.99, 175),
    ('Standing Desk Converter', 'Sit-stand converter with gas spring lift, holds up to 33 lbs.', 219.00, 30),
    ('Webcam 1080p HD', 'Built-in privacy shutter, stereo microphone, and plug-and-play USB.', 69.99, 95),
    ('Laptop Cooling Pad', 'Dual fans, adjustable height, compatible with laptops up to 17 inches.', 24.99, 300),
    ('Wireless Charging Pad', 'Qi-certified 15W fast wireless charger compatible with all Qi devices.', 19.99, 400);

INSERT INTO orders (customer_name, product_id, quantity, status, created_at) VALUES
    ('Alice Johnson', 1, 1, 'delivered', NOW() - INTERVAL '29 days'),
    ('Bob Smith', 3, 2, 'delivered', NOW() - INTERVAL '27 days'),
    ('Carol White', 5, 1, 'delivered', NOW() - INTERVAL '25 days'),
    ('David Brown', 2, 1, 'shipped', NOW() - INTERVAL '22 days'),
    ('Eva Martinez', 4, 1, 'delivered', NOW() - INTERVAL '20 days'),
    ('Frank Lee', 6, 3, 'delivered', NOW() - INTERVAL '18 days'),
    ('Grace Kim', 7, 1, 'shipped', NOW() - INTERVAL '15 days'),
    ('Henry Davis', 1, 2, 'processing', NOW() - INTERVAL '12 days'),
    ('Isla Thompson', 9, 1, 'delivered', NOW() - INTERVAL '10 days'),
    ('Jack Wilson', 10, 4, 'shipped', NOW() - INTERVAL '8 days'),
    ('Karen Moore', 3, 1, 'processing', NOW() - INTERVAL '6 days'),
    ('Liam Taylor', 5, 2, 'pending', NOW() - INTERVAL '4 days'),
    ('Mia Anderson', 8, 1, 'pending', NOW() - INTERVAL '3 days'),
    ('Noah Jackson', 2, 1, 'processing', NOW() - INTERVAL '2 days'),
    ('Olivia Harris', 6, 2, 'pending', NOW() - INTERVAL '1 day');
