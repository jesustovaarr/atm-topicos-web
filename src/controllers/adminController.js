const bankService = require('../services/bankService');
const cashService = require('../services/cashService');
const config = require('../config/env');

/**
 * Controlador del Panel Administrativo del Cajero Automático
 * 
 * Panel administrativo para realizar la configuración del cajero automático
 * en función del API Key generado por el banco central.
 */
class AdminController {
  /**
   * Autenticación de Modo Supervisor
   * POST /api/admin/login
   */
  login(req, res) {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: 'Ingrese la contraseña de operador' });
    }
    if (password !== config.adminPassword) {
      return res.status(401).json({ success: false, error: 'Contraseña de operador incorrecta' });
    }
    return res.status(200).json({ success: true, message: 'Acceso autorizado al modo de configuración' });
  }

  /**
   * Obtiene la configuración actual del cajero y el estado de la bóveda
   * GET /api/admin/config
   */
  getConfig(req, res) {
    const bankConf = bankService.getConfig();
    const cashState = cashService.getState();

    res.status(200).json({
      success: true,
      nodeName: cashState.nodeName,
      location: cashState.location,
      nodeId: cashState.nodeId,
      nodeStatus: cashState.nodeStatus,
      centralBankUrl: bankConf.centralBankUrl,
      hasApiKey: bankConf.hasApiKey,
      maskedApiKey: bankConf.maskedApiKey,
      cashAvailable: cashState.cashAvailable,
      totalMovements: cashState.totalMovements,
      history: cashState.history
    });
  }

  /**
   * Actualiza el API Key y la URL del Banco Central
   * POST /api/admin/config
   */
  updateConfig(req, res) {
    try {
      const { central_bank_url, api_key } = req.body;

      if (!central_bank_url && !api_key) {
        return res.status(400).json({
          success: false,
          error: 'Debe proporcionar al menos la URL del banco central o el API Key'
        });
      }

      bankService.updateConfig(central_bank_url, api_key);

      return res.status(200).json({
        success: true,
        message: 'Configuración de conectividad actualizada exitosamente',
        config: bankService.getConfig()
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * Ajusta o recarga el efectivo físico local del cajero
   * POST /api/admin/cash
   */
  adjustCash(req, res) {
    try {
      const { amount, reason } = req.body;
      const parsedAmount = Number(amount);

      if (isNaN(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({
          success: false,
          error: 'El monto de efectivo debe ser un número mayor o igual a 0'
        });
      }

      const newCash = cashService.setCashAvailable(
        parsedAmount,
        reason || 'Recarga desde panel administrativo'
      );

      return res.status(200).json({
        success: true,
        message: `Efectivo local actualizado exitosamente a $${newCash.toFixed(2)}`,
        cashAvailable: newCash
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * Prueba de conectividad en tiempo real con el Banco Central
   * GET /api/admin/test-connection
   */
  async testConnection(req, res) {
    const result = await bankService.checkConnection();
    let nodeInfo = null;
    try {
      if (bankService.apiKey && !config.mockBank) {
        nodeInfo = await bankService.getNodeInfo();
        if (nodeInfo) {
          cashService.updateFromNodeInfo(nodeInfo);
        }
      }
    } catch (e) {
      // Ignorar si aún no existe /api/nodes/me
    }

    if (result.ok) {
      return res.status(200).json({
        success: true,
        message: 'Conexión exitosa con el Banco Central',
        bankData: result.data,
        nodeData: nodeInfo
      });
    } else {
      return res.status(502).json({
        success: false,
        message: 'No se pudo conectar con el Banco Central',
        error: result.error
      });
    }
  }
}

module.exports = new AdminController();
