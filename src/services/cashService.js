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
            nodeName: config.nodeName,
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
   * Obtiene el estado completo para el panel de administración
   */
  getState() {
    return {
      nodeName: config.nodeName,
      cashAvailable: this.getCashAvailable(),
      storagePath: this.storagePath,
      totalMovements: this.history.length,
      history: this.history.slice(-10).reverse()
    };
  }
}

module.exports = new CashService();