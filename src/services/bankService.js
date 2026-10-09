const crypto = require('crypto');
const config = require('../config/env');

/**
 * Servicio Cliente HTTP para Conexión con el Banco Central
 * 
 * - Enviar el API Key del cajero en cada solicitud.
 * - Generar UUIDs de idempotencia para garantizar transacciones inmutables y únicas.
 * - Consumir los endpoints de verificación de PIN, consulta de saldo, retiro y depósito.
 * - Permitir actualizar dinámicamente la URL y el API Key desde el panel de administración del ATM.
 */
class BankService {
  constructor() {
    this.centralBankUrl = config.centralBankUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = 8000;
  }

  /**
   * Actualiza la configuración en caliente desde el panel administrativo del cajero
   */
  updateConfig(newUrl, newApiKey) {
    if (newUrl) this.centralBankUrl = newUrl.replace(/\/$/, '');
    if (newApiKey) this.apiKey = newApiKey;
  }

  /**
   * Obtiene la configuración actual del cliente
   */
  getConfig() {
    return {
      centralBankUrl: this.centralBankUrl,
      hasApiKey: Boolean(this.apiKey),
      maskedApiKey: this.apiKey ? `${this.apiKey.substring(0, 6)}...${this.apiKey.slice(-4)}` : 'No configurada'
    };
  }

  /**
   * Genera un UUID seguro para idempotencia contable
   */
  generateIdempotencyKey() {
    return crypto.randomUUID();
  }

  /**
   * Headers estándar para toda llamada al Banco Central
   */
  _getHeaders(customHeaders = {}) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-API-KEY': this.apiKey,
      'User-Agent': `ATM-Node/${config.nodeName}`,
      ...customHeaders
    };
  }

  /**
   * Envoltorio genérico para peticiones HTTP con timeout y manejo de errores estructurado
   */
  async _request(endpoint, options = {}) {
    const url = `${this.centralBankUrl}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers: this._getHeaders(options.headers),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg = data?.message || data?.error || `Error del Banco Central (HTTP ${response.status})`;
        const error = new Error(errorMsg);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        const timeoutErr = new Error('Tiempo de espera agotado al conectar con el Banco Central');
        timeoutErr.status = 504;
        throw timeoutErr;
      }
      throw err;
    }
  }

  /**
   * Verifica la conectividad con el Banco Central (Health Check)
   */
  async checkConnection() {
    try {
      const result = await this._request('/api/health', { method: 'GET' });
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message, status: err.status || 500 };
    }
  }

  /**
   * Valida el número de cuenta y el PIN del cliente
   * @param {string} accountNumber
   * @param {string} pin
   */
  async verifyPin(accountNumber, pin) {
    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada. Configure el API Key en el panel administrativo.');
    }

    return await this._request('/api/v1/atm/verify-pin', {
      method: 'POST',
      body: JSON.stringify({
        account_number: accountNumber,
        pin: pin
      })
    });
  }

  /**
   * Consulta el saldo central de una cuenta en Supabase / Banco Central
   * @param {string} accountNumber
   */
  async getBalance(accountNumber) {
    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada.');
    }

    return await this._request(`/api/v1/atm/accounts/${encodeURIComponent(accountNumber)}/balance`, {
      method: 'GET'
    });
  }

  /**
   * Ejecuta un retiro contra el Banco Central
   * @param {string} accountNumber
   * @param {number} amount
   * @param {string} idempotencyKey
   */
  async withdraw(accountNumber, amount, idempotencyKey = null) {
    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada.');
    }

    const key = idempotencyKey || this.generateIdempotencyKey();

    return await this._request('/api/v1/atm/withdraw', {
      method: 'POST',
      body: JSON.stringify({
        account_number: accountNumber,
        amount: Number(amount),
        idempotency_key: key
      })
    });
  }

  /**
   * Realiza un depósito / abono de efectivo a la cuenta central
   * @param {string} accountNumber
   * @param {number} amount
   * @param {string} idempotencyKey
   */
  async deposit(accountNumber, amount, idempotencyKey = null) {
    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada.');
    }

    const key = idempotencyKey || this.generateIdempotencyKey();

    return await this._request('/api/v1/atm/deposit', {
      method: 'POST',
      body: JSON.stringify({
        account_number: accountNumber,
        amount: Number(amount),
        idempotency_key: key
      })
    });
  }
}

module.exports = new BankService();
