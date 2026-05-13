import os
import time
import psycopg2
from psycopg2.pool import SimpleConnectionPool
from flask import Flask, jsonify, abort

PGHOST = os.environ.get("PGHOST", "postgres")
PGPORT = int(os.environ.get("PGPORT", "5432"))
PGUSER = os.environ.get("PGUSER", "appuser")
PGPASSWORD = os.environ.get("PGPASSWORD", "apppass")
PGDATABASE = os.environ.get("PGDATABASE", "shop")

app = Flask(__name__)

pool = None


def get_pool():
    global pool
    if pool is None:
        last_err = None
        for _ in range(30):
            try:
                pool = SimpleConnectionPool(
                    1,
                    8,
                    host=PGHOST,
                    port=PGPORT,
                    user=PGUSER,
                    password=PGPASSWORD,
                    dbname=PGDATABASE,
                )
                break
            except Exception as e:
                last_err = e
                time.sleep(1)
        if pool is None:
            raise RuntimeError(f"could not connect to postgres: {last_err}")
    return pool


@app.route("/health")
def health():
    try:
        p = get_pool()
        conn = p.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
        finally:
            p.putconn(conn)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/orders/<int:user_id>")
def orders_for_user(user_id):
    """
    Returns a per-user summary plus the 20 most recent orders.

    The aggregation forces Postgres to touch every order belonging to the user.
    Without an index on orders(user_id) this devolves into a sequential scan of
    the entire `orders` table on every request.
    """
    p = get_pool()
    conn = p.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*), COALESCE(SUM(amount_cents), 0), "
                "       COALESCE(AVG(amount_cents), 0) "
                "FROM orders WHERE user_id = %s",
                (user_id,),
            )
            count, total, avg = cur.fetchone()

            cur.execute(
                "SELECT id, product_sku, amount_cents, status, created_at "
                "FROM orders WHERE user_id = %s "
                "ORDER BY created_at DESC LIMIT 20",
                (user_id,),
            )
            rows = cur.fetchall()
        result = [
            {
                "id": r[0],
                "product_sku": r[1],
                "amount_cents": r[2],
                "status": r[3],
                "created_at": r[4].isoformat() if r[4] else None,
            }
            for r in rows
        ]
        return jsonify(
            {
                "user_id": user_id,
                "total_orders": int(count),
                "total_amount_cents": int(total),
                "avg_amount_cents": float(avg),
                "recent_orders": result,
            }
        )
    finally:
        p.putconn(conn)


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, threaded=True)
