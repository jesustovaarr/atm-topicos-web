const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const config = {
  port: process.env.PORT || 3000,
  centralBankUrl: process.env.CENTRAL_BANK_URL || 'http://localhost:8000',
  apiKey: process.env.ATM_API_KEY || '',
  initialCash: parseFloat(process.env.INITIAL_LOCAL_CASH || '5000.00'),
  nodeName: process.env.ATM_NODE_NAME || 'ATM-01-CENTRO',
  env: process.env.NODE_ENV || 'development'
};

module.exports = config;
