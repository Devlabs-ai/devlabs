from datetime import datetime
import psycopg2
from airflow import DAG
from airflow.operators.python import PythonOperator

ETL_DB_CONN = {
    "host": "postgres",
    "port": 5432,
    "dbname": "etl_db",
    "user": "etl_user",
    "password": "etl_pass",
}

default_args = {
    "owner": "data-engineering",
    "retries": 0,
}

dag = DAG(
    dag_id="etl_orders_pipeline",
    default_args=default_args,
    description="Extract, transform, and load orders from raw_orders to processed_orders",
    schedule_interval="@daily",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    tags=["etl", "orders"],
)


def extract(**context):
    conn = psycopg2.connect(**ETL_DB_CONN)
    cur = conn.cursor()
    cur.execute(
        "SELECT id, customer_id, order_date, item_count, unit_price, status FROM raw_orders;"
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    records = [
        {
            "id": r[0],
            "customer_id": r[1],
            "order_date": r[2].isoformat(),
            "item_count": r[3],
            "unit_price": float(r[4]),
            "status": r[5],
        }
        for r in rows
    ]
    context["ti"].xcom_push(key="raw_records", value=records)
    print(f"Extracted {len(records)} records from raw_orders")


def transform(**context):
    records = context["ti"].xcom_pull(key="raw_records", task_ids="extract")
    transformed = []
    for r in records:
        total_amount = round(r["item_count"] * r["unit_price"], 2)
        transformed.append(
            {
                "id": r["id"],
                "customer_id": r["customer_id"],
                "order_date": r["order_date"],
                "total_amount": total_amount,
                "status": r["status"],
            }
        )
    context["ti"].xcom_push(key="transformed_records", value=transformed)
    print(f"Transformed {len(transformed)} records")


def load(**context):
    records = context["ti"].xcom_pull(key="transformed_records", task_ids="transform")
    conn = psycopg2.connect(**ETL_DB_CONN)
    cur = conn.cursor()
    for r in records:
        cur.execute(
            """
            INSERT INTO processed_orders (customer_id, order_date, total_amount, status)
            VALUES (%s, %s, %s, %s)
            """,
            (
                r["customer_id"],
                r["order_date"],
                r["total_amount"],
                r["status"],
            ),
        )
    conn.commit()
    cur.close()
    conn.close()
    print(f"Loaded {len(records)} records into processed_orders")


extract_task = PythonOperator(
    task_id="extract",
    python_callable=extract,
    dag=dag,
)

transform_task = PythonOperator(
    task_id="transform",
    python_callable=transform,
    dag=dag,
)

load_task = PythonOperator(
    task_id="load",
    python_callable=load,
    dag=dag,
)

extract_task >> transform_task >> load_task
