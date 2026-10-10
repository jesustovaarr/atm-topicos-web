const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config/env');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend del cajero
app.use(express.static(path.join(__dirname, '../public')));

// Ruta para servir especificación OpenAPI
app.get('/openapi.yaml', (req, res) => {
  res.sendFile(path.join(__dirname, '../openapi.yaml'));
});

// Ruta de comprobación de estado
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    nodeName: config.nodeName,
    type: 'atm',
    timestamp: new Date().toISOString(),
    centralBankConfigured: Boolean(config.centralBankUrl && config.apiKey)
  });
});

// Rutas de la API interna del cajero
app.use('/api', require('./routes/api'));

module.exports = app;
