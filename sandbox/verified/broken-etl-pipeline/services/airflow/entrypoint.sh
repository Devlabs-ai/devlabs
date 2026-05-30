#!/bin/bash
set -e

echo "Waiting for Postgres to be ready..."
until python -c "import psycopg2; psycopg2.connect(host='postgres', port=5432, dbname='airflow', user='airflow', password='airflow')" 2>/dev/null; do
  echo "Postgres not ready yet, retrying in 3s..."
  sleep 3
done
echo "Postgres is ready."

export AIRFLOW__DATABASE__SQL_ALCHEMY_CONN="postgresql+psycopg2://airflow:airflow@postgres:5432/airflow"

echo "Running airflow db migrate..."
airflow db migrate

echo "Creating admin user..."
airflow users create \
  --username admin \
  --password admin \
  --firstname Admin \
  --lastname User \
  --role Admin \
  --email admin@example.com || true

echo "Starting Airflow scheduler in background..."
airflow scheduler &
SCHEDULER_PID=$!

echo "Starting Airflow webserver..."
exec airflow webserver --port 8080
