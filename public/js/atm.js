/**
 * Controlador de Pantalla Táctil - Terminal ATM
 * Consume la API REST del cajero
 */
document.addEventListener('DOMContentLoaded', () => {
  // Estado local de la sesión en el navegador
  let session = {
    accountNumber: '',
    holderName: '',
    balance: 0
  };

  // Vistas de la terminal
  const screens = {
    welcome: document.getElementById('screenWelcome'),
    menu: document.getElementById('screenMenu'),
    balance: document.getElementById('screenBalance'),
    withdraw: document.getElementById('screenWithdraw'),
    deposit: document.getElementById('screenDeposit'),
    processing: document.getElementById('screenProcessing'),
    receipt: document.getElementById('screenReceipt')
  };

  // Inputs y alertas
  const inputAccount = document.getElementById('inputAccount');
  const inputPin = document.getElementById('inputPin');
  const loginAlert = document.getElementById('loginAlert');
  const withdrawAlert = document.getElementById('withdrawAlert');
  const depositAlert = document.getElementById('depositAlert');

  // Metadatos de la terminal
  const atmNodeName = document.getElementById('atmNodeName');
  const footerLocalCash = document.getElementById('footerLocalCash');
  const footerApiKeyStatus = document.getElementById('footerApiKeyStatus');
  const networkBadge = document.getElementById('networkBadge');
  const networkText = document.getElementById('networkText');
  const liveClock = document.getElementById('liveClock');

  // Elementos de sesión
  const menuHolderName = document.getElementById('menuHolderName');
  const menuAccountNumber = document.getElementById('menuAccountNumber');
  const menuQuickBalance = document.getElementById('menuQuickBalance');

  // Reloj digital
  function updateClock() {
    if (liveClock) {
      const now = new Date();
      liveClock.textContent = now.toLocaleTimeString('es-MX', { hour12: false });
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // Transición entre pantallas
  function showScreen(screenKey) {
    Object.values(screens).forEach(screen => {
      if (screen) screen.classList.remove('active');
    });
    if (screens[screenKey]) {
      screens[screenKey].classList.add('active');
    }
  }

  // Permite navegar entre pantallas para pruebas visuales en consola
  window.goToScreen = showScreen;

  // Carga inicial del estado del nodo cajero
  async function loadAtmStatus() {
    try {
      const res = await fetch('/api/atm/status');
      if (!res.ok) throw new Error('Terminal fuera de servicio');
      const data = await res.json();

      const formattedCash = `$${Number(data.cashAvailableLocal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      if (atmNodeName) {
        const locationText = data.location ? ` &bull; <strong>${data.location}</strong>` : '';
        atmNodeName.innerHTML = `Terminal <strong>${data.nodeName || 'ATM-01'}</strong>${locationText}`;
      }
      if (footerLocalCash) footerLocalCash.textContent = formattedCash;
      if (footerApiKeyStatus) {
        footerApiKeyStatus.textContent = data.bankConfigured ? 'Conectado' : 'Pendiente';
        footerApiKeyStatus.style.color = data.bankConfigured ? '#047857' : '#b45309';
      }

      if (data.status && data.status !== 'active') {
        setNetworkStatus(false, 'NODO SUSPENDIDO');
      } else {
        setNetworkStatus(true);
      }
    } catch (err) {
      setNetworkStatus(false);
    }
  }

  function setNetworkStatus(online, customText = null) {
    if (!networkBadge) return;
    const dot = networkBadge.querySelector('.kiosk-dot');
    if (online) {
      if (dot) dot.className = 'kiosk-dot online';
      if (networkText) networkText.textContent = customText || 'OPERATIVO';
    } else {
      if (dot) dot.className = 'kiosk-dot offline';
      if (networkText) networkText.textContent = customText || 'FUERA DE SERVICIO';
    }
  }

  // TECLADO TÁCTIL 
  const keypad = document.querySelector('.touch-pad');
  if (keypad) {
    keypad.addEventListener('click', (e) => {
      const target = e.target.closest('button');
      if (!target) return;

      const num = target.getAttribute('data-num');
      if (num !== null) {
        if (inputPin.value.length < 4) {
          inputPin.value += num;
        }
      }
    });

    const btnClear = document.getElementById('btnKeyClear');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        inputPin.value = '';
        hideAlert(loginAlert);
      });
    }

    const btnEnter = document.getElementById('btnKeyEnter');
    if (btnEnter) {
      btnEnter.addEventListener('click', handleLogin);
    }
  }

  inputAccount.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      inputPin.focus();
    }
  });

  // AUTENTICACIÓN / INICIO DE SESIÓN
  async function handleLogin() {
    const account = inputAccount.value.trim();
    const pin = inputPin.value.trim();

    hideAlert(loginAlert);

    if (!account) {
      showAlert(loginAlert, 'Ingrese el número de cuenta');
      inputAccount.focus();
      return;
    }

    if (pin.length !== 4) {
      showAlert(loginAlert, 'El PIN debe ser de 4 dígitos');
      return;
    }

    showScreen('processing');
    document.getElementById('processingTitle').textContent = 'Validando Credenciales';
    document.getElementById('processingSubtitle').textContent = 'Consultando autenticidad en el Banco Central...';

    try {
      const res = await fetch('/api/atm/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_number: account, pin: pin })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        showScreen('welcome');
        showAlert(loginAlert, data.error || 'Número de cuenta o PIN incorrecto');
        inputPin.value = '';
        return;
      }

      // Guardar datos de sesión devueltos por el backend
      session.accountNumber = data.account_number;
      session.holderName = data.holder_name;
      session.balance = data.balance !== null ? data.balance : 0;
      session.pin = pin;

      menuHolderName.textContent = session.holderName;
      menuAccountNumber.textContent = `Cuenta: ${session.accountNumber}`;
      if (menuQuickBalance) {
        menuQuickBalance.textContent = `$${Number(session.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      }

      showScreen('menu');
    } catch (err) {
      showScreen('welcome');
      showAlert(loginAlert, 'Error de conexión con el cajero');
    }
  }

  // MENÚ TÁCTIL PRINCIPAL
  document.getElementById('btnMenuBalance').addEventListener('click', async () => {
    showScreen('processing');
    document.getElementById('processingTitle').textContent = 'Consultando Saldo';
    document.getElementById('processingSubtitle').textContent = 'Consultando datos contables en Banco Central...';

    try {
      const res = await fetch(`/api/atm/balance/${encodeURIComponent(session.accountNumber)}`);
      const data = await res.json();

      if (res.ok && data.success) {
        session.balance = data.balance;
        document.getElementById('balanceAccNumber').textContent = `Cuenta No. ${session.accountNumber}`;
        document.getElementById('balanceAmountText').textContent = `$${Number(data.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        document.getElementById('balanceAccountStatus').textContent = data.status === 'active' ? 'Cuenta Activa' : 'Cuenta Bloqueada';
        
        if (menuQuickBalance) {
          menuQuickBalance.textContent = `$${Number(session.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        }
        showScreen('balance');
      } else {
        alert(data.error || 'No fue posible consultar el saldo');
        showScreen('menu');
      }
    } catch (err) {
      alert('Error de conexión al consultar saldo');
      showScreen('menu');
    }
  });

  document.getElementById('btnBalanceBack').addEventListener('click', () => showScreen('menu'));
  document.getElementById('btnBalanceGoWithdraw').addEventListener('click', () => showScreen('withdraw'));

  document.getElementById('btnMenuWithdraw').addEventListener('click', () => {
    hideAlert(withdrawAlert);
    document.getElementById('inputCustomWithdraw').value = '';
    showScreen('withdraw');
  });

  document.getElementById('btnWithdrawBack').addEventListener('click', () => showScreen('menu'));

  document.getElementById('btnMenuDeposit').addEventListener('click', () => {
    hideAlert(depositAlert);
    document.getElementById('inputDepositAmount').value = '';
    showScreen('deposit');
  });

  document.getElementById('btnDepositBack').addEventListener('click', () => showScreen('menu'));

  // Cerrar Sesión
  document.getElementById('btnMenuExit').addEventListener('click', closeSession);
  document.getElementById('btnReceiptFinish').addEventListener('click', closeSession);
  document.getElementById('btnReceiptMenu').addEventListener('click', () => {
    if (menuQuickBalance) {
      menuQuickBalance.textContent = `$${Number(session.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }
    showScreen('menu');
  });

  function closeSession() {
    session = { accountNumber: '', holderName: '', balance: 0, pin: '' };
    inputAccount.value = '';
    inputPin.value = '';
    hideAlert(loginAlert);
    showScreen('welcome');
    loadAtmStatus();
  }

  // RETIRO DE EFECTIVO
  document.querySelectorAll('.btn-touch-amount').forEach(btn => {
    btn.addEventListener('click', () => {
      const amount = btn.getAttribute('data-amount');
      processWithdrawal(amount);
    });
  });

  document.getElementById('btnConfirmCustomWithdraw').addEventListener('click', () => {
    const val = document.getElementById('inputCustomWithdraw').value;
    processWithdrawal(val);
  });

  async function processWithdrawal(amount) {
    const withdrawAmount = Number(amount);
    hideAlert(withdrawAlert);

    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      showAlert(withdrawAlert, 'Ingrese un monto válido');
      return;
    }

    showScreen('processing');
    document.getElementById('processingTitle').textContent = 'Dispensando Billetes';
    document.getElementById('processingSubtitle').textContent = 'Validando efectivo local y realizando débito central inmutable...';

    try {
      const res = await fetch('/api/atm/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_number: session.accountNumber,
          pin: session.pin,
          amount: withdrawAmount
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        showScreen('withdraw');
        showAlert(withdrawAlert, data.error || 'Operación rechazada');
        return;
      }

      // Desplegar Recibo Oficial con datos devueltos por el backend
      document.getElementById('receiptOpType').textContent = 'Retiro en Efectivo';
      document.getElementById('receiptAccount').textContent = `•••• ${session.accountNumber.slice(-4)}`;
      document.getElementById('receiptHolder').textContent = session.holderName;
      document.getElementById('receiptAmount').textContent = `$${withdrawAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      
      const newBal = data.balance_after !== null ? data.balance_after : (session.balance - withdrawAmount);
      document.getElementById('receiptNewBalance').textContent = `$${Number(newBal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      session.balance = newBal;

      document.getElementById('receiptTxId').textContent = data.transaction_id || data.idempotency_key;
      document.getElementById('receiptTimestamp').textContent = new Date().toLocaleString('es-MX');

      // Actualizar efectivo físico restante en la barra inferior
      if (data.cash_available_local !== undefined && footerLocalCash) {
        footerLocalCash.textContent = `$${Number(data.cash_available_local).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      }

      showScreen('receipt');
    } catch (err) {
      showScreen('withdraw');
      showAlert(withdrawAlert, 'Error de comunicación durante el retiro');
    }
  }

  // DEPÓSITO DE EFECTIVO
  document.getElementById('btnConfirmDeposit').addEventListener('click', async () => {
    const val = Number(document.getElementById('inputDepositAmount').value);
    hideAlert(depositAlert);

    if (isNaN(val) || val <= 0) {
      showAlert(depositAlert, 'Ingrese un monto válido');
      return;
    }

    showScreen('processing');
    document.getElementById('processingTitle').textContent = 'Aceptando Billetes';
    document.getElementById('processingSubtitle').textContent = 'Abonando fondos en la cuenta central...';

    try {
      const res = await fetch('/api/atm/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_number: session.accountNumber,
          amount: val
        })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        showScreen('deposit');
        showAlert(depositAlert, data.error || 'Error al procesar el depósito');
        return;
      }

      document.getElementById('receiptOpType').textContent = 'Depósito en Efectivo';
      document.getElementById('receiptAccount').textContent = `•••• ${session.accountNumber.slice(-4)}`;
      document.getElementById('receiptHolder').textContent = session.holderName;
      document.getElementById('receiptAmount').textContent = `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      
      const newBal = data.balance_after !== null ? data.balance_after : (session.balance + val);
      document.getElementById('receiptNewBalance').textContent = `$${Number(newBal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      session.balance = newBal;

      document.getElementById('receiptTxId').textContent = data.transaction_id || 'OK';
      document.getElementById('receiptTimestamp').textContent = new Date().toLocaleString('es-MX');

      if (data.cash_available_local !== undefined && footerLocalCash) {
        footerLocalCash.textContent = `$${Number(data.cash_available_local).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      }

      showScreen('receipt');
    } catch (err) {
      showScreen('deposit');
      showAlert(depositAlert, 'Error de conexión');
    }
  });

  // Alertas
  function showAlert(elem, msg) {
    if (!elem) return;
    elem.textContent = msg;
    elem.style.display = 'block';
  }

  function hideAlert(elem) {
    if (!elem) return;
    elem.textContent = '';
    elem.style.display = 'none';
  }

  // Inicializar
  loadAtmStatus();

  // Refrescar estado y telemetría cada 5 segundos cuando el cajero está en espera (pantalla de bienvenida)
  setInterval(() => {
    if (screens.welcome && screens.welcome.classList.contains('active') && !document.hidden) {
      loadAtmStatus();
    }
  }, 5000);
});
