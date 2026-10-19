'use strict';
 
const http = require('http');
const { Pool } = require('pg');
 
// 1. Validate Environment Variable Injection (Zero-Trust Check)
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = parseInt(process.env.PORT || '3000', 10);
 
if (!DATABASE_URL || !DATABASE_URL.includes('sslmode=require')) {
  console.error('[FATAL] DATABASE_URL is missing or lacks mandatory ?sslmode=require parameter.');
  process.exit(1);
}
 
// 2. Initialize Singleton Connection Pool with explicit resource bounds
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Enforces TLS encryption over PaaS-to-DBaaS link
  // For lab only; production should use verify-full with CA cert
  max: 10,                          // Neon 0.25 CU = 104 max_connections; 10 per container allows ~10 containers
  idleTimeoutMillis: 30000,         // Release idle sockets after 30s to allow Neon Scale-to-Zero
  connectionTimeoutMillis: 15000    // Allow up to 5s for Serverless Cold Start wake-up
});
 
pool.on('error', (err) => {
  console.error('[POOL_ERROR] Unexpected error on idle PostgreSQL client:', err.message);
});
 
// 3. HTTP Server with Health & Database Audit Endpoints
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
 
  if (req.method === 'GET' && req.url === '/healthz') {
    let client;
    try {
      const startTime = process.hrtime.bigint();
      client = await pool.connect();
      const dbRes = await client.query(
        `SELECT current_database() AS db_name,
               inet_server_addr()::text AS db_ip,
               pg_backend_pid() AS backend_pid,
               NOW() AS server_time;`
      );
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
 
      res.writeHead(200);
      return res.end(JSON.stringify({
        status: 'HEALTHY',
        latency_ms: Number(durationMs.toFixed(2)),
        pool_metrics: {
          total_count: pool.totalCount,
          idle_count: pool.idleCount,
          waiting_count: pool.waitingCount
        },
        telemetry: dbRes.rows[0]
      }, null, 2));
    } catch (err) {
      console.error('[DB_HEALTH_FAILURE]', err.code, err.message);
      res.writeHead(503);
      return res.end(JSON.stringify({
        status: 'UNHEALTHY',
        error_code: err.code || 'UNKNOWN',
        message: err.message
      }));
    } finally {
      if (client) client.release(); // Always return socket to pool (Prevents Connection Leak)
    }
  }
 
  if (req.method === 'GET' && req.url.startsWith('/deployments')) {
    let client;
    try {
      client = await pool.connect();
      const result = await client.query(
        'SELECT id, student_id, service_node, tls_cipher, created_at FROM cloud_deployments ORDER BY id DESC LIMIT 20;'
      );
      res.writeHead(200);
      return res.end(JSON.stringify({ count: result.rowCount, data: result.rows }, null, 2));
    } catch (err) {
      console.error('[QUERY_FAILURE]', err.code, err.message);
      res.writeHead(500);
      return res.end(JSON.stringify({ error: 'Database query failed', code: err.code }));
    } finally {
      if (client) client.release();
    }
  }
 
  res.writeHead(404);
  return res.end(JSON.stringify({ error: 'Route Not Found' }));
});
 
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[STARTUP] Server bound to 0.0.0.0:${PORT} | PID: ${process.pid}`);
});
 
// 4. Kernel Signal Trapping (SIGTERM / SIGINT) for Graceful Pool Teardown
const gracefulShutdown = async (signal) => {
  console.log(`[SIGNAL] Intercepted ${signal}. Draining HTTP server and PostgreSQL pool...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log('[SHUTDOWN] PostgreSQL Connection Pool closed cleanly. Exiting 0.');
      process.exit(0);
    } catch (err) {
      console.error('[SHUTDOWN_ERROR]', err.message);
      process.exit(1);
    }
  });
};
 
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));