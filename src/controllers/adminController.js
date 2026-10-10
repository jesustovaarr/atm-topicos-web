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
  async getConfig(req, res) {
    try {
      if (bankService.apiKey && bankService.centralBankUrl && !config.mockBank) {
        try {
          const dynamicNode = await bankService.getNodeInfo();
          if (dynamicNode) {
            cashService.updateFromNodeInfo(dynamicNode);
          }
        } catch (e) {
          // Continuar con el estado local si la llamada falla
        }
      }

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
        isLocallyOverridden: cashState.isLocallyOverridden,
        totalMovements: cashState.totalMovements,
        history: cashState.history
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Actualiza el API Key y la URL del Banco Central
   * POST /api/admin/config
   */
  async updateConfig(req, res) {
    try {
      const { central_bank_url, api_key } = req.body;

      if (!central_bank_url && !api_key) {
        return res.status(400).json({
          success: false,
          error: 'Debe proporcionar al menos la URL del banco central o el API Key'
        });
      }

      bankService.updateConfig(central_bank_url, api_key);

      // Al cambiar credenciales o nodo, consultar de inmediato al Banco Central y sincronizar el efectivo
      let nodeInfo = null;
      try {
        if (bankService.apiKey && !config.mockBank) {
          nodeInfo = await bankService.getNodeInfo();
          if (nodeInfo) {
            cashService.updateFromNodeInfo(nodeInfo, true);
          }
        }
      } catch (err) {
        console.warn('[AdminController.updateConfig] Error consultando nuevo nodo:', err.message);
      }

      const cashState = cashService.getState();

      return res.status(200).json({
        success: true,
        message: nodeInfo
          ? `Conectado exitosamente al nodo ${nodeInfo.name} ($${Number(cashState.cashAvailable).toFixed(2)})`
          : 'Configuración de conectividad actualizada exitosamente',
        config: bankService.getConfig(),
        nodeInfo,
        cashAvailable: cashState.cashAvailable
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }

  /**
   * Fuerza la sincronización del efectivo y metadatos con el Banco Central
   * POST /api/admin/sync
   */
  async syncNode(req, res) {
    try {
      if (!bankService.apiKey) {
        return res.status(400).json({
          success: false,
          error: 'No hay un API Key configurado para sincronizar con el Banco Central'
        });
      }

      const nodeInfo = await bankService.getNodeInfo();
      if (!nodeInfo) {
        return res.status(502).json({
          success: false,
          error: 'El Banco Central no devolvió información del nodo'
        });
      }

      cashService.updateFromNodeInfo(nodeInfo, true);
      const cashState = cashService.getState();

      return res.status(200).json({
        success: true,
        message: `Bóveda sincronizada exitosamente con ${nodeInfo.name} ($${Number(cashState.cashAvailable).toFixed(2)})`,
        nodeInfo,
        cashAvailable: cashState.cashAvailable
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message || 'Error al sincronizar con el Banco Central'
      });
    }
  }

  /**
   * Ajusta o recarga el efectivo físico local del cajero
   * POST /api/admin/cash
   */
  async adjustCash(req, res) {
    try {
      const { amount, reason } = req.body;
      const parsedAmount = Number(amount);

      if (isNaN(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({
          success: false,
          error: 'El monto de efectivo debe ser un número mayor o igual a 0'
        });
      }

      // Intentar actualizar en el Banco Central 
      let centralUpdated = false;
      try {
        if (bankService.apiKey && !config.mockBank) {
          await bankService.updateNodeCash(parsedAmount);
          centralUpdated = true;
        }
      } catch (err) {
        console.warn('[AdminController.adjustCash] Banco Central aún no soporta PATCH /api/nodes/me:', err.message);
      }

      // Actualizar stock local del cajero
      const newCash = cashService.setCashAvailable(
        parsedAmount,
        reason || 'Recarga desde panel administrativo'
      );

      return res.status(200).json({
        success: true,
        message: centralUpdated
          ? `Bóveda actualizada exitosamente a $${newCash.toFixed(2)} en el cajero y en el Banco Central`
          : `Efectivo local actualizado a $${newCash.toFixed(2)} (Aviso: El Banco Central no tiene habilitado endpoint de escritura para bóveda)`,
        cashAvailable: newCash,
        centralUpdated
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
          cashService.updateFromNodeInfo(nodeInfo, true);
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
        nodeData: nodeInfo,
        cashAvailable: cashService.getCashAvailable()
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
