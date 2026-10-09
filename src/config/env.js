const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const config = {
  port: process.env.PORT || 3000,
  centralBankUrl: process.env.CENTRAL_BANK_URL || 'http://localhost:8000',
  apiKey: process.env.ATM_API_KEY || '',
  initialCash: parseFloat(process.env.INITIAL_LOCAL_CASH || '5000.00'),
  nodeName: process.env.ATM_NODE_NAME || 'ATM-CENTRO',
  location: process.env.ATM_LOCATION || 'Sucursal Centro',
  mockBank: process.env.MOCK_BANK === 'true',
  adminPassword: process.env.ATM_ADMIN_PASSWORD || 'admin1234',
  env: process.env.NODE_ENV || 'development'
};

module.exports = config;
