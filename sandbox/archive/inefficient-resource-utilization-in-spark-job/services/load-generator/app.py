# Load generator for Spark job
import time
import random

while True:
    latency = random.uniform(0.2, 0.5)
    errors = random.randint(0, 2)
    dbCpu = random.uniform(0.1, 0.5)
    print(f"METRIC latency={latency} errors={errors} dbCpu={dbCpu}")
    time.sleep(1)
