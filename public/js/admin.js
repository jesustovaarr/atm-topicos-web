/**
 * Controlador del Panel de Administración del Cajero Automático
 * Modo Supervisor con Autenticación
 */
document.addEventListener('DOMContentLoaded', () => {
  // Vistas
  const adminLoginSection = document.getElementById('adminLoginSection');
  const adminDashboardSection = document.getElementById('adminDashboardSection');
  const btnAdminLogout = document.getElementById('btnAdminLogout');

  // Login de Supervisor
  const formAdminLogin = document.getElementById('formAdminLogin');
  const inputAdminPassword = document.getElementById('inputAdminPassword');
  const adminLoginAlert = document.getElementById('adminLoginAlert');

  // Elementos de Configuración y Control
  const formBankConfig = document.getElementById('formBankConfig');
  const inputCentralBankUrl = document.getElementById('inputCentralBankUrl');
  const inputApiKey = document.getElementById('inputApiKey');
  const btnTestConnection = document.getElementById('btnTestConnection');
  const connectionStatusBox = document.getElementById('connectionStatusBox');

  const formAdjustCash = document.getElementById('formAdjustCash');
  const inputNewCash = document.getElementById('inputNewCash');
  const inputCashReason = document.getElementById('inputCashReason');
  const adminCashDisplay = document.getElementById('adminCashDisplay');
  const auditTableBody = document.getElementById('auditTableBody');

  const adminNodeHeader = document.getElementById('adminNodeHeader');
  const footerAdminNodeName = document.getElementById('footerAdminNodeName');
  const footerAdminLocation = document.getElementById('footerAdminLocation');
  const footerAdminCash = document.getElementById('footerAdminCash');
  const adminNetworkBadge = document.getElementById('adminNetworkBadge');
  const adminNetworkText = document.getElementById('adminNetworkText');
  const liveClock = document.getElementById('liveClock');
  const adminNodeIdDisplay = document.getElementById('adminNodeIdDisplay');

  // Reloj digital en vivo
  function updateClock() {
    if (liveClock) {
      const now = new Date();
      liveClock.textContent = now.toLocaleTimeString('es-MX', { hour12: false });
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  function setNetworkStatus(online) {
    if (!adminNetworkBadge || !adminNetworkText) return;
    const dot = adminNetworkBadge.querySelector('.kiosk-dot');
    if (online) {
      if (dot) dot.className = 'kiosk-dot online';
      adminNetworkText.textContent = 'OPERATIVO';
    } else {
      if (dot) dot.className = 'kiosk-dot offline';
      adminNetworkText.textContent = 'SIN CONEXIÓN';
    }
  }

  // CONTROL DE SESIÓN DE SUPERVISOR

  let autoRefreshTimer = null;

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      const isAuth = sessionStorage.getItem('atm_supervisor_auth') === 'true';
      if (isAuth && !document.hidden) {
        loadConfig(true);
      }
    }, 3000);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function checkSupervisorAuth() {
    const isAuth = sessionStorage.getItem('atm_supervisor_auth') === 'true';

    if (isAuth) {
      if (adminLoginSection) adminLoginSection.style.display = 'none';
      if (adminDashboardSection) adminDashboardSection.style.display = 'grid';
      if (btnAdminLogout) btnAdminLogout.style.display = 'inline-flex';
      loadNodeInfo();
      loadConfig();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
      if (adminLoginSection) adminLoginSection.style.display = 'block';
      if (adminDashboardSection) adminDashboardSection.style.display = 'none';
      if (btnAdminLogout) btnAdminLogout.style.display = 'none';
    }
  }

  // Login de Supervisor
  if (formAdminLogin) {
    formAdminLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwd = inputAdminPassword.value.trim();
      hideLoginAlert();

      if (!pwd) {
        showLoginAlert('Ingrese la contraseña de operador');
        return;
      }

      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          sessionStorage.setItem('atm_supervisor_auth', 'true');
          inputAdminPassword.value = '';
          checkSupervisorAuth();
        } else {
          showLoginAlert(data.error || 'Contraseña incorrecta');
          inputAdminPassword.value = '';
          inputAdminPassword.focus();
        }
      } catch (err) {
        showLoginAlert('Error de red al validar credenciales');
      }
    });
  }

  // Logout de Supervisor
  if (btnAdminLogout) {
    btnAdminLogout.addEventListener('click', () => {
      stopAutoRefresh();
      sessionStorage.removeItem('atm_supervisor_auth');
      checkSupervisorAuth();
    });
  }

  function showLoginAlert(msg) {
    if (!adminLoginAlert) return;
    adminLoginAlert.textContent = msg;
    adminLoginAlert.style.display = 'block';
  }

  function hideLoginAlert() {
    if (!adminLoginAlert) return;
    adminLoginAlert.textContent = '';
    adminLoginAlert.style.display = 'none';
  }

  // CARGA DE CONFIGURACIÓN Y TELEMETRÍA

  // Metadatos globales del nodo
  async function loadNodeInfo() {
    try {
      const res = await fetch('/api/atm/status');
      if (!res.ok) throw new Error('Terminal fuera de servicio');
      const data = await res.json();

      const locationText = data.location ? ` &bull; <strong>${data.location}</strong>` : '';
      if (adminNodeHeader) {
        adminNodeHeader.innerHTML = `Terminal <strong>${data.nodeName || 'ATM-01'}</strong>${locationText}`;
      }
      if (footerAdminNodeName) {
        footerAdminNodeName.textContent = data.nodeName || 'ATM-01';
      }
      if (footerAdminLocation) {
        footerAdminLocation.textContent = data.location || 'Sucursal Centro';
      }
      if (footerAdminCash && data.cashAvailableLocal !== undefined) {
        footerAdminCash.textContent = `$${Number(data.cashAvailableLocal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      }
      setNetworkStatus(true);
    } catch (err) {
      setNetworkStatus(false);
    }
  }

  async function loadConfig(isSilent = false) {
    try {
      const res = await fetch('/api/admin/config');
      if (!res.ok) throw new Error('Error al consultar configuración del nodo');
      const data = await res.json();

      // Conectividad (solo actualizar si el usuario no está escribiendo en el campo)
      if (inputCentralBankUrl && (!isSilent || document.activeElement !== inputCentralBankUrl)) {
        inputCentralBankUrl.value = data.centralBankUrl || '';
      }

      // Bóveda
      const formattedCash = `$${Number(data.cashAvailable).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      if (adminCashDisplay) {
        adminCashDisplay.textContent = formattedCash;
      }
      if (footerAdminCash) {
        footerAdminCash.textContent = formattedCash;
      }

      // Metadatos del nodo
      const locationText = data.location ? ` &bull; <strong>${data.location}</strong>` : '';
      if (adminNodeHeader) {
        adminNodeHeader.innerHTML = `Terminal <strong>${data.nodeName || 'ATM-01'}</strong>${locationText}`;
      }
      if (footerAdminNodeName) footerAdminNodeName.textContent = data.nodeName || 'ATM-01';
      if (footerAdminLocation) footerAdminLocation.textContent = data.location || 'Sucursal Centro';
      if (adminNodeIdDisplay && data.nodeId) adminNodeIdDisplay.textContent = data.nodeId;

      // Historial
      renderHistory(data.history || []);
    } catch (err) {
      if (!isSilent) console.error('Error al cargar configuración:', err);
    }
  }

  // Renderizar tabla de movimientos locales
  function renderHistory(history) {
    if (!auditTableBody) return;

    if (!history || history.length === 0) {
      auditTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center" style="padding: 24px; color: #64748b;">
            No hay movimientos registrados en la bóveda local todavía.
          </td>
        </tr>
      `;
      return;
    }

    const typeLabels = {
      dispense: { label: 'Retiro Dispensado', class: 'dispense' },
      deposit_received: { label: 'Depósito Recibido', class: 'deposit_received' },
      admin_adjustment: { label: 'Ajuste Manual', class: 'admin_adjustment' },
      boot_sync: { label: 'Sincronización Banco', class: 'sync' },
      central_sync: { label: 'Sincronización Banco', class: 'sync' },
      node_switch_sync: { label: 'Cambio de Nodo', class: 'sync' }
    };

    auditTableBody.innerHTML = history.map(item => {
      const typeInfo = typeLabels[item.type] || { label: item.type, class: 'admin_adjustment' };
      const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleString('es-MX') : '--';
      const amountStr = `$${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const prevStr = `$${Number(item.previousCash).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      const newStr = `$${Number(item.newCash).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      
      let detail = item.reason || 'Operación local';
      if (item.transactionId === 'central_boot_sync') {
        detail = 'Sincronización con Supabase';
      } else if (item.transactionId) {
        detail = `Folio: ${item.transactionId.substring(0, 13)}...`;
      }

      return `
        <tr>
          <td>${dateStr}</td>
          <td><span class="badge-audit ${typeInfo.class}">${typeInfo.label}</span></td>
          <td class="font-mono font-bold">${amountStr}</td>
          <td class="font-mono">${prevStr}</td>
          <td class="font-mono">${newStr}</td>
          <td class="font-mono font-subtle">${detail}</td>
        </tr>
      `;
    }).join('');
  }

  // OPERACIONES ADMINISTRATIVAS

  // Guardar configuración de conectividad
  if (formBankConfig) {
    formBankConfig.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = inputCentralBankUrl.value.trim();
      const apiKey = inputApiKey.value.trim();

      try {
        const res = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ central_bank_url: url, api_key: apiKey })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          showStatus(connectionStatusBox, 'Configuración de conectividad guardada correctamente', true);
          inputApiKey.value = '';
          loadConfig();
        } else {
          showStatus(connectionStatusBox, data.error || 'No fue posible guardar la configuración', false);
        }
      } catch (err) {
        showStatus(connectionStatusBox, 'Error de conexión con el servidor del cajero', false);
      }
    });
  }

  // Probar conectividad con el Banco Central
  if (btnTestConnection) {
    btnTestConnection.addEventListener('click', async () => {
      showStatus(connectionStatusBox, 'Verificando comunicación con Banco Central...', true);
      btnTestConnection.disabled = true;

      try {
        const res = await fetch('/api/admin/test-connection');
        const data = await res.json();

        if (res.ok && data.success) {
          let nodeDetail = '';
          if (data.nodeData) {
            nodeDetail = ` | Nodo Supabase: ${data.nodeData.name || 'ATM'} ($${Number(data.nodeData.cash).toLocaleString('en-US', { minimumFractionDigits: 2 })})`;
            loadConfig();
          }
          const modeInfo = data.bankData?.status === 'simulacion_local_activa'
            ? ' (Modo simulación local activo)'
            : ' (Conexión exitosa a API Core)';
          showStatus(connectionStatusBox, `${data.message}${modeInfo}${nodeDetail}`, true);
        } else {
          showStatus(connectionStatusBox, `Fallo de conexión: ${data.error || data.message}`, false);
        }
      } catch (err) {
        showStatus(connectionStatusBox, 'No se pudo contactar con el Banco Central', false);
      } finally {
        btnTestConnection.disabled = false;
      }
    });
  }

  // Ajustar o recargar efectivo de la bóveda
  if (formAdjustCash) {
    formAdjustCash.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number(inputNewCash.value);
      const reason = inputCashReason.value.trim();

      if (isNaN(amount) || amount < 0) {
        alert('Ingrese un monto de efectivo válido');
        return;
      }

      try {
        const res = await fetch('/api/admin/cash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amount,
            reason: reason || 'Ajuste'
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          inputNewCash.value = '';
          inputCashReason.value = '';
          loadConfig();
          alert(`Bóveda actualizada exitosamente a $${Number(data.cashAvailable).toFixed(2)}`);
        } else {
          alert(data.error || 'No fue posible actualizar el efectivo');
        }
      } catch (err) {
        alert('Error al actualizar el efectivo');
      }
    });
  }

  // Sincronizar bóveda con Banco Central
  const btnSyncWithBank = document.getElementById('btnSyncWithBank');
  if (btnSyncWithBank) {
    btnSyncWithBank.addEventListener('click', async () => {
      btnSyncWithBank.disabled = true;
      btnSyncWithBank.textContent = 'Sincronizando...';
      try {
        const res = await fetch('/api/admin/sync', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.success) {
          loadConfig();
          alert(data.message || 'Bóveda sincronizada exitosamente con el Banco Central');
        } else {
          alert(data.error || 'No se pudo sincronizar con el Banco Central');
        }
      } catch (err) {
        alert('Error de conexión con el cajero');
      } finally {
        btnSyncWithBank.disabled = false;
        btnSyncWithBank.textContent = 'Sincronizar con Banco';
      }
    });
  }

  function showStatus(elem, msg, isSuccess) {
    if (!elem) return;
    elem.textContent = msg;
    elem.className = `connection-status-box ${isSuccess ? 'success' : 'error'}`;
    elem.style.display = 'block';
  }

  // Inicialización
  loadNodeInfo();
  checkSupervisorAuth();
});
