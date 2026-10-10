const bankService = require('../services/bankService');
const cashService = require('../services/cashService');
const config = require('../config/env');

/**
 * Controlador de Operaciones del Cajero Automático (ATM)
 */
class AtmController {
  /**
   * Valida credenciales del cliente en el cajero (Cuenta + PIN)
   * POST /api/atm/login
   */
  async login(req, res) {
    try {
      const { account_number, pin } = req.body;

      if (!account_number || !pin) {
        return res.status(400).json({
          success: false,
          error: 'Número de cuenta y PIN son requeridos'
        });
      }

      // Validar contra el Banco Central
      const bankResult = await bankService.verifyPin(account_number, pin);

      return res.status(200).json({
        success: true,
        message: 'Autenticación exitosa',
        account_number,
        holder_name: bankResult.holder_name || bankResult.titular || 'Cliente Bancario',
        balance: bankResult.balance !== undefined ? Number(bankResult.balance) : null,
        nodeName: cashService.nodeName || config.nodeName
      });
    } catch (err) {
      console.error('[AtmController.login] Error:', err.message);
      return res.status(err.status || 401).json({
        success: false,
        error: err.message || 'Error de autenticación en el cajero'
      });
    }
  }

  /**
   * Consulta el saldo actual de la cuenta
   * GET /api/atm/balance/:accountNumber
   */
  async getBalance(req, res) {
    try {
      const { accountNumber } = req.params;

      if (!accountNumber) {
        return res.status(400).json({ success: false, error: 'Número de cuenta requerido' });
      }

      const result = await bankService.getBalance(accountNumber);

      return res.status(200).json({
        success: true,
        account_number: accountNumber,
        holder_name: result.holder_name || result.titular,
        balance: Number(result.balance),
        status: result.status
      });
    } catch (err) {
      console.error('[AtmController.getBalance] Error:', err.message);
      return res.status(err.status || 500).json({
        success: false,
        error: err.message || 'No se pudo consultar el saldo'
      });
    }
  }

  /**
   * Ejecuta un retiro en efectivo
   * Valida PRIMERO el stock de efectivo físico local antes de llamar al Banco Central.
   * POST /api/atm/withdraw
   */
  async withdraw(req, res) {
    try {
      const { account_number, amount, pin } = req.body;
      const withdrawAmount = Number(amount);

      if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'El monto a retirar debe ser un número positivo'
        });
      }

      // verificar disponibilidad de efectivo local del nodo cajero antes de autorizar la transacción central
      if (!cashService.hasEnoughCash(withdrawAmount)) {
        return res.status(400).json({
          success: false,
          error: `El cajero no dispone de suficiente efectivo físico en este momento. Efectivo disponible en dispensador: $${cashService.getCashAvailable()}`,
          cashAvailableLocal: cashService.getCashAvailable()
        });
      }

      // Generar clave de idempotencia única para este retiro
      const idempotencyKey = bankService.generateIdempotencyKey();

      // Solicitar autorización y deducción contable al Banco Central (incluyendo PIN)
      const centralResult = await bankService.withdraw(account_number, withdrawAmount, idempotencyKey, pin);

      // Si el Banco Central devolvió cash_after, sincronizamos directamente con el saldo real del nodo
      let remainingCash;
      if (centralResult.cash_after !== undefined && centralResult.cash_after !== null) {
        remainingCash = cashService.syncWithCentralCash(
          Number(centralResult.cash_after),
          centralResult.transaction_id || idempotencyKey
        );
      } else {
        remainingCash = cashService.dispenseCash(
          withdrawAmount,
          centralResult.transaction_id || idempotencyKey
        );
      }

      return res.status(200).json({
        success: true,
        message: `Retiro de $${withdrawAmount.toFixed(2)} procesado exitosamente. Por favor tome su dinero.`,
        amount: withdrawAmount,
        balance_after: centralResult.balance_after !== undefined ? Number(centralResult.balance_after) : null,
        cash_available_local: remainingCash,
        transaction_id: centralResult.transaction_id,
        idempotency_key: idempotencyKey,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[AtmController.withdraw] Error:', err.message);
      return res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Error al procesar el retiro',
        cashAvailableLocal: cashService.getCashAvailable()
      });
    }
  }

  /**
   * Realiza un depósito de efectivo a la cuenta central
   * POST /api/atm/deposit
   */
  async deposit(req, res) {
    try {
      const { account_number, amount } = req.body;
      const depositAmount = Number(amount);

      if (isNaN(depositAmount) || depositAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'El monto a depositar debe ser un número positivo'
        });
      }

      const idempotencyKey = bankService.generateIdempotencyKey();

      // Enviar abono al Banco Central
      const centralResult = await bankService.deposit(account_number, depositAmount, idempotencyKey);

      // Sincronizar o ingresar los billetes recibidos a la bóveda física del cajero
      let newCash;
      if (centralResult.cash_after !== undefined && centralResult.cash_after !== null) {
        newCash = cashService.syncWithCentralCash(
          Number(centralResult.cash_after),
          centralResult.transaction_id || idempotencyKey
        );
      } else {
        newCash = cashService.acceptDeposit(
          depositAmount,
          centralResult.transaction_id || idempotencyKey
        );
      }

      return res.status(200).json({
        success: true,
        message: `Depósito de $${depositAmount.toFixed(2)} recibido exitosamente.`,
        amount: depositAmount,
        balance_after: centralResult.balance_after !== undefined ? Number(centralResult.balance_after) : null,
        cash_available_local: newCash,
        transaction_id: centralResult.transaction_id,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('[AtmController.deposit] Error:', err.message);
      return res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Error al procesar el depósito'
      });
    }
  }

  /**
   * Consulta el estado operativo del cajero
   * GET /api/atm/status
   */
  async getStatus(req, res) {
    let dynamicNode = null;
    try {
      if (bankService.apiKey && bankService.centralBankUrl && !config.mockBank) {
        dynamicNode = await bankService.getNodeInfo();
        if (dynamicNode) {
          cashService.updateFromNodeInfo(dynamicNode);
        }
      }
    } catch (err) {
      // Si el Banco Central aún no tiene listo /api/nodes/me o da timeout,
      // se utiliza suavemente la información local sin romper la terminal
      console.warn('[AtmController.getStatus] Nodo dinámico pendiente en Banco Central:', err.message);
    }

    res.status(200).json({
      nodeName: dynamicNode?.name || cashService.nodeName || config.nodeName,
      location: dynamicNode?.location || cashService.location || config.location,
      nodeId: dynamicNode?.id || cashService.nodeId || config.nodeId,
      status: dynamicNode?.status || cashService.nodeStatus || 'active',
      type: 'atm',
      cashAvailableLocal: cashService.getCashAvailable(),
      bankConfigured: Boolean(bankService.apiKey && bankService.centralBankUrl),
      dynamicSync: Boolean(dynamicNode)
    });
  }
}

module.exports = new AtmController();
