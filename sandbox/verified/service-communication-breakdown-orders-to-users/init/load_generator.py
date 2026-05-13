import time
import random

while True:
    latency = random.uniform(0.1, 0.3)
    errors = random.choice([0, 1])
    dbCpu = random.uniform(0.0, 0.5)
    print(f'METRIC latency={latency} errors={errors} dbCpu={dbCpu}')
    time.sleep(1)