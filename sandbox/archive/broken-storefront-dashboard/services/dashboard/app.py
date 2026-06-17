import os
import requests
from flask import Flask, render_template_string

app = Flask(__name__)

API_BASE_URL = os.environ.get('API_BASE_URL', 'http://wrong-host:9999')

HOME_TEMPLATE = '''
<!DOCTYPE html>
<html>
<head><title>Storefront Admin Dashboard</title>
<style>
body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
h1 { color: #333; }
h2 { color: #555; border-bottom: 2px solid #ddd; padding-bottom: 8px; }
.section { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
table { width: 100%; border-collapse: collapse; }
th { background: #4a90d9; color: white; padding: 10px; text-align: left; }
td { padding: 8px 10px; border-bottom: 1px solid #eee; }
tr:hover td { background: #f9f9f9; }
.empty { color: #999; font-style: italic; padding: 20px 0; }
.error { color: #c0392b; }
</style>
</head>
<body>
<h1>Storefront Admin Dashboard</h1>

<div class="section">
  <h2>Products</h2>
  {% if products_error %}
    <p class="error">{{ products_error }}</p>
  {% elif products %}
    <table>
      <tr><th>ID</th><th>Name</th><th>Description</th><th>Price</th><th>Stock</th></tr>
      {% for p in products %}
      <tr><td>{{ p.id }}</td><td>{{ p.name }}</td><td>{{ p.description }}</td><td>${{ p.price }}</td><td>{{ p.stock_quantity }}</td></tr>
      {% endfor %}
    </table>
  {% else %}
    <p class="empty">No products found.</p>
  {% endif %}
</div>

<div class="section">
  <h2>Recent Orders</h2>
  {% if orders_error %}
    <p class="error">{{ orders_error }}</p>
  {% elif orders %}
    <table>
      <tr><th>ID</th><th>Customer</th><th>Product ID</th><th>Qty</th><th>Status</th><th>Date</th></tr>
      {% for o in orders %}
      <tr><td>{{ o.id }}</td><td>{{ o.customer_name }}</td><td>{{ o.product_id }}</td><td>{{ o.quantity }}</td><td>{{ o.status }}</td><td>{{ o.created_at }}</td></tr>
      {% endfor %}
    </table>
  {% else %}
    <p class="empty">No orders found.</p>
  {% endif %}
</div>

</body>
</html>
'''


@app.route('/', methods=['GET'])
def index():
    products = []
    orders = []
    products_error = None
    orders_error = None

    try:
        resp = requests.get(f'{API_BASE_URL}/api/products', timeout=3)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list) and all('stock_quantity' in item for item in data):
            products = data
        else:
            products_error = 'Received unexpected data format from products endpoint.'
    except Exception as e:
        products_error = f'Could not load products: {str(e)}'

    try:
        resp = requests.get(f'{API_BASE_URL}/api/orders', timeout=3)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list) and all('customer_name' in item for item in data):
            orders = data
        else:
            orders_error = 'Received unexpected data format from orders endpoint.'
    except Exception as e:
        orders_error = f'Could not load orders: {str(e)}'

    return render_template_string(
        HOME_TEMPLATE,
        products=products,
        orders=orders,
        products_error=products_error,
        orders_error=orders_error
    )


@app.route('/health', methods=['GET'])
def health():
    return {'status': 'ok'}


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080, debug=False)
