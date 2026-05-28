import os
import time
import random
import requests

TARGET_HOST = os.environ.get('TARGET_HOST', 'product-catalog-service')
TARGET_PORT = os.environ.get('TARGET_PORT', '5000')
BASE_URL = f'http://{TARGET_HOST}:{TARGET_PORT}'

PRODUCT_IDS = list(range(1, 11))

PRODUCT_NAMES = [
    'Widget Alpha', 'Widget Beta', 'Gadget Prime', 'Gadget Ultra',
    'Doohickey Standard', 'Doohickey Pro', 'Thingamajig Basic',
    'Thingamajig Plus', 'Whatsit Lite', 'Whatsit Max'
]


def wait_for_service():
    print('Waiting for product-catalog-service to be ready...', flush=True)
    for _ in range(90):
        try:
            r = requests.get(f'{BASE_URL}/health', timeout=3)
            if r.status_code == 200:
                print('Service is ready.', flush=True)
                return
        except Exception:
            pass
        time.sleep(2)
    print('WARNING: Service did not become ready in time, proceeding anyway.', flush=True)


def run():
    wait_for_service()
    while True:
        tick_start = time.time()
        stale_count = 0
        errors = 0
        latencies = []

        # Each tick: update all 10 products, then read them back immediately
        for pid in PRODUCT_IDS:
            new_name = random.choice(PRODUCT_NAMES) + f' #{random.randint(100, 999)}'
            new_price = round(random.uniform(1.0, 999.99), 2)

            # Write
            try:
                put_resp = requests.put(
                    f'{BASE_URL}/products/{pid}',
                    json={'name': new_name, 'price': str(new_price)},
                    timeout=5
                )
                if put_resp.status_code != 200:
                    errors += 1
                    continue
            except Exception:
                errors += 1
                continue

            # Read immediately after write
            try:
                t0 = time.time()
                get_resp = requests.get(f'{BASE_URL}/products/{pid}', timeout=5)
                latency_ms = (time.time() - t0) * 1000
                latencies.append(latency_ms)

                if get_resp.status_code != 200:
                    errors += 1
                    continue

                returned = get_resp.json()
                returned_name = returned.get('name', '')

                # Check staleness: name should match what we just wrote
                if returned_name != new_name:
                    stale_count += 1

            except Exception:
                errors += 1

        # Translate staleness into latency metric:
        # Broken state: stale_count > 0 => high latency reported
        # Fixed state: stale_count == 0 => low actual latency reported
        if stale_count > 0:
            reported_latency = 300.0 + stale_count * 25.0
        else:
            if latencies:
                reported_latency = min(sum(latencies) / len(latencies), 49.0)
            else:
                reported_latency = 10.0

        print(
            f'METRIC latency={reported_latency:.2f} errors={errors} dbCpu=0.0',
            flush=True
        )

        elapsed = time.time() - tick_start
        sleep_time = max(0.0, 1.0 - elapsed)
        time.sleep(sleep_time)


if __name__ == '__main__':
    run()
