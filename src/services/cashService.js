const fs = require('fs');
const path = require('path');
const config = require('../config/env');

/**
 * Servicio de Control de Efectivo Físico Local del ATM
 * 
 * "Manejar de forma independiente la lógica local del cajero
 * (ejemplo: verificar disponibilidad de efectivo local del nodo cajero
 * antes de autorizar la transacción central)."
 */
class CashService {
  constructor() {
    this.storagePath = this._resolveStoragePath();
    this.cashAvailable = config.initialCash;
    this.nodeName = config.nodeName;
    this.location = config.location;
    this.nodeId = config.nodeId;
    this.nodeStatus = 'active';
    this.history = [];
    this._loadState();
  }

  /**
   * Resuelve la ruta de persistencia 
   */
  _resolveStoragePath() {
    // Si corre en Vercel, solo /tmp es escribible
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      return path.join('/tmp', 'atm_state.json');
    }
    return path.join(__dirname, '../../data', 'atm_state.json');
  }

  /**
   * Carga el estado guardado del cajero desde disco si existe
   */
  _loadState() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data.cashAvailable === 'number') {
          this.cashAvailable = data.cashAvailable;
          this.history = Array.isArray(data.history) ? data.history : [];
          if (data.nodeName) this.nodeName = data.nodeName;
          if (data.location) this.location = data.location;
          if (data.nodeId) this.nodeId = data.nodeId;
          if (data.nodeStatus) this.nodeStatus = data.nodeStatus;
          return;
        }
      }
    } catch (err) {
      console.warn(`[CashService] No se pudo leer estado previo (${err.message}). Usando valor inicial.`);
    }

    // Si no existía archivo, inicializar con el monto por defecto
    this.cashAvailable = config.initialCash;
    this._saveState();
  }

  /**
   * Guarda el estado actual en disco para persistencia entre reinicios
   */
  _saveState() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.storagePath,
        JSON.stringify(
          {
            nodeName: this.nodeName || config.nodeName,
            location: this.location || config.location,
            nodeId: this.nodeId || config.nodeId,
            nodeStatus: this.nodeStatus || 'active',
            cashAvailable: this.cashAvailable,
            lastUpdated: new Date().toISOString(),
            history: this.history.slice(-50) // Guardar últimos 50 movimientos
          },
          null,
          2
        ),
        'utf8'
      );
    } catch (err) {
      console.warn(`[CashService] No se pudo persistir el estado local: ${err.message}`);
    }
  }

  /**
   * Obtiene el efectivo físico disponible en la bóveda del cajero
   * @returns {number}
   */
  getCashAvailable() {
    return Number(this.cashAvailable.toFixed(2));
  }

  /**
   * Verifica si el cajero tiene billetes físicos suficientes antes de pedir autorización central
   * @param {number} amount 
   * @returns {boolean}
   */
  hasEnoughCash(amount) {
    const parsed = Number(amount);
    if (isNaN(parsed) || parsed <= 0) return false;
    return this.cashAvailable >= parsed;
  }

  /**
   * Descuenta billetes físicos tras un retiro exitoso autorizado por el Banco Central
   * @param {number} amount
   * @param {string} transactionId
   */
  dispenseCash(amount, transactionId = null) {
    const parsed = Number(amount);
    if (!this.hasEnoughCash(parsed)) {
      throw new Error(`Efectivo físico insuficiente en el cajero. Solicitado: $${parsed}, Disponible: $${this.cashAvailable}`);
    }

    const previous = this.cashAvailable;
    this.cashAvailable = Number((this.cashAvailable - parsed).toFixed(2));

    this.history.push({
      type: 'dispense',
      amount: parsed,
      previousCash: previous,
      newCash: this.cashAvailable,
      transactionId,
      timestamp: new Date().toISOString()
    });

    this._saveState();
    return this.cashAvailable;
  }

  /**
   * Incrementa el efectivo físico cuando un cliente realiza un depósito de billetes en el cajero
   * @param {number} amount
   * @param {string} transactionId
   */
  acceptDeposit(amount, transactionId = null) {
    const parsed = Number(amount);
    if (isNaN(parsed) || parsed <= 0) {
      throw new Error('El monto a depositar debe ser un número positivo');
    }

    const previous = this.cashAvailable;
    this.cashAvailable = Number((this.cashAvailable + parsed).toFixed(2));

    this.history.push({
      type: 'deposit_received',
      amount: parsed,
      previousCash: previous,
      newCash: this.cashAvailable,
      transactionId,
      timestamp: new Date().toISOString()
    });

    this._saveState();
    return this.cashAvailable;
  }

  /**
   * Recarga administrativa del efectivo del cajero 
   * @param {number} newAmount
   * @param {string} reason
   */
  setCashAvailable(newAmount, reason = 'Recarga administrativa') {
    const parsed = Number(newAmount);
    if (isNaN(parsed) || parsed < 0) {
      throw new Error('El monto debe ser un valor positivo o cero');
    }

    const previous = this.cashAvailable;
    this.cashAvailable = Number(parsed.toFixed(2));

    this.history.push({
      type: 'admin_adjustment',
      amount: Math.abs(this.cashAvailable - previous),
      previousCash: previous,
      newCash: this.cashAvailable,
      reason,
      timestamp: new Date().toISOString()
    });

    this._saveState();
    return this.cashAvailable;
  }

  /**
   * Sincroniza el efectivo físico con el reporte oficial del Banco Central (cash_after)
   * @param {number} centralCashAmount
   * @param {string} transactionId
   */
  syncWithCentralCash(centralCashAmount, transactionId = null) {
    const parsed = Number(centralCashAmount);
    if (isNaN(parsed) || parsed < 0) return this.cashAvailable;

    const previous = this.cashAvailable;
    this.cashAvailable = Number(parsed.toFixed(2));

    this.history.push({
      type: 'central_sync',
      amount: Math.abs(this.cashAvailable - previous),
      previousCash: previous,
      newCash: this.cashAvailable,
      transactionId,
      timestamp: new Date().toISOString()
    });

    this._saveState();
    return this.cashAvailable;
  }

  /**
   * Actualiza los datos del nodo y su efectivo desde la respuesta dinámica del Banco Central
   * @param {Object} nodeInfo
   */
  updateFromNodeInfo(nodeInfo) {
    if (!nodeInfo) return;

    let hasChanges = false;
    if (nodeInfo.name && nodeInfo.name !== this.nodeName) {
      this.nodeName = nodeInfo.name;
      hasChanges = true;
    }
    if (nodeInfo.location && nodeInfo.location !== this.location) {
      this.location = nodeInfo.location;
      hasChanges = true;
    }
    if (nodeInfo.id && nodeInfo.id !== this.nodeId) {
      this.nodeId = nodeInfo.id;
      hasChanges = true;
    }
    if (nodeInfo.status && nodeInfo.status !== this.nodeStatus) {
      this.nodeStatus = nodeInfo.status;
      hasChanges = true;
    }

    if (typeof nodeInfo.cash === 'number' && !isNaN(nodeInfo.cash)) {
      this.syncWithCentralCash(nodeInfo.cash, 'central_boot_sync');
    } else if (hasChanges) {
      this._saveState();
    }
  }

  /**
   * Obtiene el estado completo para el panel de administración
   */
  getState() {
    return {
      nodeName: this.nodeName || config.nodeName,
      location: this.location || config.location,
      nodeId: this.nodeId || config.nodeId,
      nodeStatus: this.nodeStatus || 'active',
      cashAvailable: this.getCashAvailable(),
      storagePath: this.storagePath,
      totalMovements: this.history.length,
      history: this.history.slice(-10).reverse()
    };
  }
}

module.exports = new CashService();