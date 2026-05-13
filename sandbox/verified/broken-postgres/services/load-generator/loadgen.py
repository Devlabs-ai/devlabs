import os
import random
import time
import requests
from concurrent.futures import ThreadPoolExecutor

TARGET_URL = os.environ.get("TARGET_URL", "http://orders-service:8080").rstrip("/")
USERS = int(os.environ.get("USERS", "200"))
SLEEP_SECONDS = float(os.environ.get("SLEEP_SECONDS", "1.0"))
REQUESTS_PER_TICK = int(os.environ.get("REQUESTS_PER_TICK", "12"))
CONCURRENCY = int(os.environ.get("CONCURRENCY", "6"))


def wait_for_target():
    sess = requests.Session()
    for _ in range(60):
        try:
            r = sess.get(f"{TARGET_URL}/health", timeout=2)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(1)


def emit_metric(latency_ms, errors):
    # Format consumed by backend/observability/metricsService.js:
    #   METRIC latency=<f> errors=<f> dbCpu=<f>
    # dbCpu is not measured here; we report 0.
    print(f"METRIC latency={latency_ms:.2f} errors={errors:.0f} dbCpu=0", flush=True)


def one_request():
    uid = 1 + random.randint(0, USERS - 1)
    t0 = time.perf_counter()
    try:
        r = requests.get(f"{TARGET_URL}/orders/{uid}", timeout=15)
        ok = r.status_code == 200
    except Exception:
        ok = False
    elapsed = (time.perf_counter() - t0) * 1000
    return elapsed, ok


def main():
    print(
        f"[load-gen] target={TARGET_URL} users={USERS} sleep={SLEEP_SECONDS}"
        f" rpt={REQUESTS_PER_TICK} concurrency={CONCURRENCY}",
        flush=True,
    )
    wait_for_target()

    executor = ThreadPoolExecutor(max_workers=CONCURRENCY)

    while True:
        futures = [executor.submit(one_request) for _ in range(REQUESTS_PER_TICK)]
        durations = []
        errors = 0
        for f in futures:
            elapsed, ok = f.result()
            durations.append(elapsed)
            if not ok:
                errors += 1
        avg_latency = sum(durations) / max(1, len(durations))
        emit_metric(avg_latency, errors)
        time.sleep(SLEEP_SECONDS)


if __name__ == "__main__":
    main()
