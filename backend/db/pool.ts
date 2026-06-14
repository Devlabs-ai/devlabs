'use strict';

import type { Pool } from 'pg';

const { Pool: PgPool } = require('pg');

const pool: Pool = new PgPool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'devlabs',
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err: Error) => {
  console.error('[pg] idle client error', err);
});

module.exports = pool;
