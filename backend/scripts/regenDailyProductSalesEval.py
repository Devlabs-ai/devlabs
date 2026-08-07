#!/usr/bin/env python3
"""
Regenerate challenges/daily-product-sales-pipeline-l1/eval/solution.json.

Spark hive-style reads fill null store_id from the store_id=<n> partition.
The golden must use the same semantics as spark.read.parquet(INPUT_PATH).

Usage (from repo, with MinIO env / defaults):
  python scripts/regenDailyProductSalesEval.py
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path

import boto3
import pandas as pd
import pyarrow.parquet as pq
from botocore.client import Config

ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://192.168.1.9:30900")
ACCESS = os.environ.get("MINIO_ACCESS_KEY", "devlabs")
SECRET = os.environ.get("MINIO_SECRET_KEY", "devlabs-minio-change-me")
BUCKET = os.environ.get("MINIO_BUCKET", "devlabs-data")
INPUT_PREFIX = "challenges/daily-product-sales-pipeline-l1/input/"
EVAL_KEY = "challenges/daily-product-sales-pipeline-l1/eval/solution.json"
BUSINESS_DATE = "2026-01-15"
STORE_RE = re.compile(r"store_id=(\d+)")


def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS,
        aws_secret_access_key=SECRET,
        config=Config(signature_version="s3v4"),
        region_name=os.environ.get("MINIO_REGION", "us-east-1"),
    )


def list_parquet(client) -> list[str]:
    keys: list[str] = []
    token = None
    while True:
        kw = {"Bucket": BUCKET, "Prefix": INPUT_PREFIX}
        if token:
            kw["ContinuationToken"] = token
        resp = client.list_objects_v2(**kw)
        for item in resp.get("Contents", []):
            if item["Key"].endswith(".parquet"):
                keys.append(item["Key"])
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")
    return keys


def load_frames(client, keys: list[str]) -> pd.DataFrame:
    frames = []
    with tempfile.TemporaryDirectory() as td:
        for i, key in enumerate(keys):
            m = STORE_RE.search(key)
            if not m:
                raise RuntimeError(f"missing store_id partition in {key}")
            part_store = int(m.group(1))
            path = Path(td) / f"p{i}.parquet"
            path.write_bytes(client.get_object(Bucket=BUCKET, Key=key)["Body"].read())
            df = pq.read_table(path).to_pandas()
            if "store_id" in df.columns:
                df["store_id"] = df["store_id"].fillna(part_store)
            else:
                df["store_id"] = part_store
            frames.append(df)
    return pd.concat(frames, ignore_index=True)


def to_float(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def build_solution(df: pd.DataFrame) -> dict:
    qty = to_float(df["quantity"])
    price = to_float(df["unit_price"])
    pid = to_float(df["product_id"])
    sid = to_float(df["store_id"])
    valid = (
        pid.notna()
        & sid.notna()
        & qty.notna()
        & (qty > 0)
        & price.notna()
        & (price > 0)
    )
    sub = df.loc[valid].copy()
    sub["_qty"] = to_float(sub["quantity"])
    sub["_price"] = to_float(sub["unit_price"])
    sub["_pid"] = to_float(sub["product_id"]).astype(int)
    sub["_sid"] = to_float(sub["store_id"]).astype(int)
    sub["line_revenue"] = sub["_qty"] * sub["_price"]
    g = (
        sub.groupby("_pid", sort=True)
        .agg(
            total_units_sold=("_qty", "sum"),
            total_revenue=("line_revenue", "sum"),
            transaction_count=("_pid", "size"),
            stores_sold_in=("_sid", "nunique"),
        )
        .reset_index()
        .rename(columns={"_pid": "product_id"})
    )
    rows = []
    for _, r in g.iterrows():
        rev = float(r.total_revenue)
        rev_out = (
            round(rev + 1e-10, 2)
            if abs(rev * 100 - round(rev * 100)) < 1e-6
            else round(rev, 6)
        )
        rows.append(
            {
                "business_date": BUSINESS_DATE,
                "product_id": int(r.product_id),
                "total_units_sold": int(r.total_units_sold),
                "total_revenue": rev_out,
                "transaction_count": int(r.transaction_count),
                "stores_sold_in": int(r.stores_sold_in),
            }
        )
    return {
        "challenge": "daily-product-sales",
        "business_date": BUSINESS_DATE,
        "keys": ["business_date", "product_id"],
        "columns": [
            {"name": "business_date", "type": "string", "role": "key"},
            {"name": "product_id", "type": "int", "role": "key"},
            {"name": "total_units_sold", "type": "int", "role": "value"},
            {"name": "total_revenue", "type": "float", "atol": 0.0001, "role": "value"},
            {"name": "transaction_count", "type": "int", "role": "value"},
            {"name": "stores_sold_in", "type": "int", "role": "value"},
        ],
        "row_count": len(rows),
        "rows": rows,
    }


def main() -> None:
    client = s3_client()
    keys = list_parquet(client)
    print(f"input parquet files: {len(keys)}")
    df = load_frames(client, keys)
    sol = build_solution(df)
    body = (json.dumps(sol, indent=2) + "\n").encode("utf-8")
    client.put_object(Bucket=BUCKET, Key=EVAL_KEY, Body=body, ContentType="application/json")
    print(f"uploaded s3://{BUCKET}/{EVAL_KEY} ({len(body)} bytes, {sol['row_count']} rows)")
    print("p1", sol["rows"][0])


if __name__ == "__main__":
    main()
