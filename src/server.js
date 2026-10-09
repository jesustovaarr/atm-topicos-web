const app = require('./app');
const config = require('./config/env');

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  Cajero Automático (ATM) Iniciado`);
  console.log(`  Nodo: ${config.nodeName}`);
  console.log(`  Servidor local: http://localhost:${PORT}`);
  console.log(`  Health Check:   http://localhost:${PORT}/api/health`);
  console.log(`  Banco Central:  ${config.centralBankUrl}`);
  console.log(`===============================================`);
});
