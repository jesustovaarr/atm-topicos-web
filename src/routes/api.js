const express = require('express');
const router = express.Router();

const atmController = require('../controllers/atmController');
const adminController = require('../controllers/adminController');

// Rutas de Operaciones del Cajero (ATM)
router.post('/atm/login', (req, res) => atmController.login(req, res));
router.get('/atm/balance/:accountNumber', (req, res) => atmController.getBalance(req, res));
router.post('/atm/withdraw', (req, res) => atmController.withdraw(req, res));
router.post('/atm/deposit', (req, res) => atmController.deposit(req, res));
router.get('/atm/status', (req, res) => atmController.getStatus(req, res));

// Rutas del Panel Administrativo del Cajero
router.post('/admin/login', (req, res) => adminController.login(req, res));
router.get('/admin/config', (req, res) => adminController.getConfig(req, res));
router.post('/admin/config', (req, res) => adminController.updateConfig(req, res));
router.post('/admin/cash', (req, res) => adminController.adjustCash(req, res));
router.get('/admin/test-connection', (req, res) => adminController.testConnection(req, res));

module.exports = router;
