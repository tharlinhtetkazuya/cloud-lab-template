const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;
const ENV = process.env.NODE_ENV || 'development';

app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'Success',
    environment: ENV,
    timestamp: new Date().toISOString()
  });
});

const server = app.listen(PORT, () => {
  console.log(`[SYSTEM] Server initializing on port ${PORT} in ${ENV} mode.`);
});

process.on('SIGTERM', () => {
  console.log('[KERNEL SIGNAL] SIGTERM received. Initiating graceful shutdown.');
  server.close(() => {
    process.exit(0);
  });
});