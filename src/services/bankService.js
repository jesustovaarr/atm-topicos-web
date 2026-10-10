const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');

/**
 * Servicio Cliente HTTP para Conexión con el Banco Central
 * 
 * Producción:
 *    - Realiza llamadas HTTP autenticadas con X-API-KEY e idempotencia UUID.
 * 
 * Simulación Local:
 *    - Utiliza data/test_accounts.json para permitir desarrollo y pruebas
 *      locales independientes sin depender de que el Banco Central esté encendido.
 */
class BankService {
  constructor() {
    this.centralBankUrl = config.centralBankUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.timeoutMs = 8000;
    this.mockFilePath = path.join(__dirname, '../../data/test_accounts.json');
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
      maskedApiKey: this.apiKey ? `${this.apiKey.substring(0, 6)}...${this.apiKey.slice(-4)}` : 'No configurada',
      isMockMode: config.mockBank
    };
  }

  /**
   * Genera un UUID seguro para idempotencia contable
   */
  generateIdempotencyKey() {
    return crypto.randomUUID();
  }

  // Helpers para simulacion local
  _readMockAccounts() {
    try {
      if (fs.existsSync(this.mockFilePath)) {
        const raw = fs.readFileSync(this.mockFilePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[BankService] Error leyendo test_accounts.json:', e.message);
    }
    return [];
  }

  _writeMockAccounts(accounts) {
    try {
      fs.writeFileSync(this.mockFilePath, JSON.stringify(accounts, null, 2), 'utf8');
    } catch (e) {
      console.warn('[BankService] Error guardando test_accounts.json:', e.message);
    }
  }

  // Comunicacion HTTP
  _getHeaders(customHeaders = {}) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-API-Key': this.apiKey,
      'User-Agent': `ATM-Node/${config.nodeName}`,
      ...customHeaders
    };
  }

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
   * Health Check de Conectividad con el Banco Central
   */
  async checkConnection() {
    if (config.mockBank) {
      return {
        ok: true,
        data: {
          status: 'simulacion_local_activa',
          message: 'Modo simulación con data/test_accounts.json',
          nodeName: config.nodeName
        }
      };
    }

    try {
      const result = await this._request('/api/health', { method: 'GET' });
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: err.message, status: err.status || 500 };
    }
  }

  /**
   * Consulta los datos dinámicos del nodo registrados en el Banco Central
   * (Nombre, ubicación, efectivo asignado en Supabase, UUID, estado)
   * GET /api/nodes/me
   */
  async getNodeInfo() {
    if (config.mockBank) {
      return {
        id: config.nodeId,
        name: config.nodeName,
        location: config.location,
        type: 'atm',
        cash: config.initialCash,
        status: 'active'
      };
    }

    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada.');
    }

    const data = await this._request('/api/nodes/me', { method: 'GET' });

    return {
      id: data.id || data.uuid || config.nodeId,
      name: data.name || data.nombre || config.nodeName,
      location: data.location || data.ubicacion || config.location,
      type: data.type || 'atm',
      cash: data.cash !== undefined ? Number(data.cash) : config.initialCash,
      status: data.status || 'active'
    };
  }

  /**
   * Actualiza el efectivo del nodo en el Banco Central (Supabase)
   * PATCH /api/nodes/me
   */
  async updateNodeCash(newCash) {
    if (config.mockBank) {
      return { success: true, cash: Number(newCash) };
    }

    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada.');
    }

    return this._request('/api/nodes/me', {
      method: 'PATCH',
      body: JSON.stringify({ cash: Number(newCash) })
    });
  }

  /**
   * Valida el número de cuenta y el PIN del cliente
   */
  async verifyPin(accountNumber, pin) {
    if (config.mockBank) {
      const accounts = this._readMockAccounts();
      const account = accounts.find(a => a.account_number === accountNumber);
      if (!account) {
        const err = new Error('Cuenta bancaria no encontrada');
        err.status = 404;
        throw err;
      }
      if (account.pin !== pin) {
        const err = new Error('PIN de seguridad incorrecto');
        err.status = 401;
        throw err;
      }
      if (account.status !== 'active') {
        const err = new Error('La cuenta se encuentra bloqueada');
        err.status = 403;
        throw err;
      }
      return {
        success: true,
        account_number: account.account_number,
        holder_name: account.holder_name,
        balance: account.balance
      };
    }

    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada.');
    }

    const account = await this.getBalance(accountNumber);
    if (account.status && account.status !== 'active') {
      const err = new Error('La cuenta bancaria se encuentra inactiva o bloqueada');
      err.status = 403;
      throw err;
    }

    return {
      success: true,
      account_number: account.account_number,
      holder_name: account.holder_name,
      balance: account.balance
    };
  }

  /**
   * Consulta el saldo central de una cuenta
   */
  async getBalance(accountNumber) {
    if (config.mockBank) {
      const accounts = this._readMockAccounts();
      const account = accounts.find(a => a.account_number === accountNumber);
      if (!account) {
        const err = new Error('Cuenta no encontrada');
        err.status = 404;
        throw err;
      }
      return {
        success: true,
        account_number: account.account_number,
        holder_name: account.holder_name,
        balance: account.balance,
        status: account.status
      };
    }

    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada.');
    }

    const data = await this._request(`/api/balance/${encodeURIComponent(accountNumber)}`, {
      method: 'GET'
    });

    return {
      success: true,
      account_number: data.account_number,
      holder_name: data.holder_name,
      balance: Number(data.balance),
      status: data.status
    };
  }

  /**
   * Ejecuta un retiro contra el Banco Central
   */
  async withdraw(accountNumber, amount, idempotencyKey = null, pin = null) {
    const key = idempotencyKey || this.generateIdempotencyKey();

    if (config.mockBank) {
      const accounts = this._readMockAccounts();
      const account = accounts.find(a => a.account_number === accountNumber);
      if (!account) {
        const err = new Error('Cuenta no encontrada');
        err.status = 404;
        throw err;
      }
      const withdrawAmount = Number(amount);
      if (account.balance < withdrawAmount) {
        const err = new Error('Saldo insuficiente en la cuenta bancaria');
        err.status = 400;
        throw err;
      }

      account.balance = Number((account.balance - withdrawAmount).toFixed(2));
      this._writeMockAccounts(accounts);

      return {
        success: true,
        transaction_id: key,
        balance_after: account.balance,
        idempotency_key: key
      };
    }

    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada.');
    }

    const data = await this._request('/api/withdraw', {
      method: 'POST',
      headers: {
        'Idempotency-Key': key
      },
      body: JSON.stringify({
        account_number: accountNumber,
        pin: pin,
        amount: Number(amount)
      })
    });

    return {
      success: true,
      message: data.message || 'Retiro exitoso',
      transaction_id: data.transaction_id || key,
      balance_after: data.balance_after !== undefined ? Number(data.balance_after) : null,
      cash_after: data.cash_after !== undefined ? Number(data.cash_after) : null,
      idempotency_key: key,
      replayed: data.replayed || false
    };
  }

  /**
   * Realiza un depósito / abono de efectivo a la cuenta central
   */
  async deposit(accountNumber, amount, idempotencyKey = null) {
    const key = idempotencyKey || this.generateIdempotencyKey();

    if (config.mockBank) {
      const accounts = this._readMockAccounts();
      const account = accounts.find(a => a.account_number === accountNumber);
      if (!account) {
        const err = new Error('Cuenta no encontrada');
        err.status = 404;
        throw err;
      }
      const depositAmount = Number(amount);
      account.balance = Number((account.balance + depositAmount).toFixed(2));
      this._writeMockAccounts(accounts);

      return {
        success: true,
        transaction_id: key,
        balance_after: account.balance,
        idempotency_key: key
      };
    }

    if (!this.apiKey) {
      throw new Error('El cajero no tiene un API Key configurada.');
    }

    const headers = {};
    if (key) headers['Idempotency-Key'] = key;

    const data = await this._request('/api/deposit', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        account_number: accountNumber,
        amount: Number(amount)
      })
    });

    return {
      success: true,
      message: data.message || 'Depósito exitoso',
      transaction_id: data.transaction_id || key,
      balance_after: data.balance_after !== undefined ? Number(data.balance_after) : null,
      idempotency_key: key
    };
  }
}

module.exports = new BankService();
