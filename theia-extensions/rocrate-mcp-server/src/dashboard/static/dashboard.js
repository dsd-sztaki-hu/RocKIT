/**
 * RO-Crate MCP Dashboard Client
 * Handles API communication and UI updates
 */

// API base URL (same host)
const API_BASE = window.location.origin;

// State
let currentMinutes = 15;
let autoRefreshInterval = null;

// DOM Elements
const elements = {
  totalCalls: document.getElementById('totalCalls'),
  errorRate: document.getElementById('errorRate'),
  activeSessions: document.getElementById('activeSessions'),
  p95Latency: document.getElementById('p95Latency'),
  avgLatency: document.getElementById('avgLatency'),
  uptime: document.getElementById('uptime'),
  toolsTableBody: document.querySelector('#toolsTable tbody'),
  errorsList: document.getElementById('errorsList'),
  sessionsTableBody: document.querySelector('#sessionsTable tbody'),
  dependenciesTableBody: document.querySelector('#dependenciesTable tbody'),
  timeRange: document.getElementById('timeRange'),
  refreshBtn: document.getElementById('refreshBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  errorBanner: document.getElementById('errorBanner'),
  sessionModal: document.getElementById('sessionModal'),
  sessionModalTitle: document.getElementById('sessionModalTitle'),
  sessionModalBody: document.getElementById('sessionModalBody'),
  closeSessionModal: document.getElementById('closeSessionModal'),
  toolCallModal: document.getElementById('toolCallModal'),
  toolCallModalTitle: document.getElementById('toolCallModalTitle'),
  toolCallModalBody: document.getElementById('toolCallModalBody'),
  closeToolCallModal: document.getElementById('closeToolCallModal'),
  settingsModal: document.getElementById('settingsModal'),
  settingsForm: document.getElementById('settingsForm'),
  detailedLoggingToggle: document.getElementById('detailedLoggingToggle'),
  retentionHoursInput: document.getElementById('retentionHoursInput'),
  cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
  closeSettingsModal: document.getElementById('closeSettingsModal'),
  settingsMessage: document.getElementById('settingsMessage'),
  schemaRegistryTableBody: document.querySelector('#schemaRegistryTable tbody'),
  schemaIdInput: document.getElementById('schemaIdInput'),
  schemaDisplayNameInput: document.getElementById('schemaDisplayNameInput'),
  schemaUrlInput: document.getElementById('schemaUrlInput'),
  schemaMatchesInput: document.getElementById('schemaMatchesInput'),
  schemaSpecsInput: document.getElementById('schemaSpecsInput'),
  addSchemaBtn: document.getElementById('addSchemaBtn'),
  reloadSchemaBtn: document.getElementById('reloadSchemaBtn'),
  schemaRegistryMessage: document.getElementById('schemaRegistryMessage'),
};

// API Helpers
async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function postAPI(endpoint, data) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function putAPI(endpoint, data) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function deleteAPI(endpoint) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// Show error banner
function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove('hidden');
  setTimeout(() => {
    elements.errorBanner.classList.add('hidden');
  }, 5000);
}

// Format session ID (show first 8 chars)
function formatSessionId(id) {
  if (!id) return '-';
  const short = id.slice(0, 8);
  return `<code class="session-id"><span class="truncated">${short}</span></code>`;
}

// Get color class for error rate
function getErrorRateColor(rate) {
  if (rate === 0) return 'success';
  if (rate < 1) return 'success';
  if (rate < 5) return 'warning';
  return 'danger';
}

// Get badge class for status
function getStatusBadge(status) {
  const classes = {
    active: 'badge-success',
    inactive: 'badge-neutral',
    success: 'badge-success',
    error: 'badge-danger',
    started: 'badge-info',
    timeout: 'badge-warning',
  };
  return classes[status] || 'badge-neutral';
}

// Update overview cards
async function updateOverview() {
  try {
    const params = currentMinutes === 'all' ? '' : `?minutes=${currentMinutes}`;
    const data = await fetchAPI(`/metrics/summary${params}`);

    elements.totalCalls.textContent = data.totalCalls.toLocaleString();
    elements.totalCalls.className = 'card-value';

    const errorRate = data.errorRate || 0;
    elements.errorRate.textContent = errorRate.toFixed(2) + '%';
    elements.errorRate.className = `card-value ${getErrorRateColor(errorRate)}`;

    elements.activeSessions.textContent = data.activeSessions;
    elements.activeSessions.className = 'card-value';

    const p95 = data.p95LatencyMs;
    elements.p95Latency.textContent = p95 !== null ? formatLatency(p95) : 'N/A';
    elements.p95Latency.className = 'card-value';

    const avg = data.avgLatencyMs;
    elements.avgLatency.textContent = formatLatency(avg);
    elements.avgLatency.className = 'card-value';

    elements.uptime.textContent = data.uptimeFormatted || formatDuration(data.uptimeSeconds);
    elements.uptime.className = 'card-value neutral';
  } catch (err) {
    console.error('Failed to update overview:', err);
    // Silently fail - individual errors are shown elsewhere
  }
}

// Format latency
function formatLatency(ms) {
  if (ms === null || ms === undefined) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Format duration
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

// Update tools table
async function updateTools() {
  try {
    const params = currentMinutes === 'all' ? '' : `?minutes=${currentMinutes}`;
    const data = await fetchAPI(`/metrics/tools${params}`);

    if (data.tools.length === 0) {
      elements.toolsTableBody.innerHTML = '<tr><td colspan="6" class="empty">No tool calls in this time range</td></tr>';
      return;
    }

    elements.toolsTableBody.innerHTML = data.tools.map(tool => `
      <tr>
        <td><code>${escapeHtml(tool.toolName)}</code></td>
        <td>${tool.callCount.toLocaleString()}</td>
        <td>
          <span class="badge ${getErrorRateColor(tool.failureRate)}">
            ${tool.failureRate.toFixed(2)}%
          </span>
          ${tool.failedCalls > 0 ? ` (${tool.failedCalls})` : ''}
        </td>
        <td>${tool.avgLatencyFormatted}</td>
        <td>${tool.p95LatencyFormatted}</td>
        <td>${tool.lastCallFormatted || 'Never'}</td>
      </tr>
    `).join('');
  } catch (err) {
    elements.toolsTableBody.innerHTML = `<tr><td colspan="6" class="text-danger">Failed to load: ${err.message}</td></tr>`;
  }
}

// Update errors list
async function updateErrors() {
  try {
    const data = await fetchAPI('/errors/recent?limit=20');

    if (data.errors.length === 0) {
      elements.errorsList.innerHTML = '<div class="text-muted" style="padding: 1rem; text-align: center;">No errors recorded</div>';
      return;
    }

    elements.errorsList.innerHTML = data.errors.map(error => `
      <div class="error-item">
        <div class="error-header">
          <span class="error-code">${escapeHtml(error.errorCode)}</span>
          <span class="error-time">${error.timestampFormatted || error.timestamp}</span>
        </div>
        ${error.toolName ? `<div class="error-tool">Tool: <code>${escapeHtml(error.toolName)}</code></div>` : ''}
        <div class="error-message">${escapeHtml(error.message)}</div>
      </div>
    `).join('');
  } catch (err) {
    elements.errorsList.innerHTML = `<div class="text-danger">Failed to load errors: ${err.message}</div>`;
  }
}

// Update sessions table
async function updateSessions() {
  try {
    const data = await fetchAPI('/sessions');

    if (data.sessions.length === 0) {
      elements.sessionsTableBody.innerHTML = '<tr><td colspan="8" class="empty">No sessions recorded</td></tr>';
      return;
    }

    elements.sessionsTableBody.innerHTML = data.sessions.map(session => `
      <tr>
        <td>${formatSessionId(session.id)}</td>
        <td>${session.startedAtFormatted || session.startedAt}</td>
        <td>${session.lastActivityFormatted || session.lastActivityAt}</td>
        <td><span class="badge badge-neutral">${escapeHtml(session.transportMode)}</span></td>
        <td>${session.requestCount}</td>
        <td>${session.errorCount > 0 ? `<span class="text-danger">${session.errorCount}</span>` : '0'}</td>
        <td><span class="badge ${session.active ? 'badge-success' : 'badge-neutral'}">${session.active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <button class="btn btn-sm" onclick="viewSession('${session.id}')">View</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    elements.sessionsTableBody.innerHTML = `<tr><td colspan="8" class="text-danger">Failed to load sessions: ${err.message}</td></tr>`;
  }
}

// View session details
async function viewSession(sessionId) {
  try {
    const data = await fetchAPI(`/sessions/${sessionId}`);
    const session = data.session;
    const stats = data.stats;

    elements.sessionModalTitle.textContent = `Session: ${sessionId.slice(0, 8)}...`;

    elements.sessionModalBody.innerHTML = `
      <div class="session-detail-section">
        <h3>Session Info</h3>
        <div class="session-stats">
          <div class="session-stat">
            <div class="session-stat-label">Status</div>
            <div class="session-stat-value">
              <span class="badge ${session.active ? 'badge-success' : 'badge-neutral'}">
                ${session.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <div class="session-stat">
            <div class="session-stat-label">Transport</div>
            <div class="session-stat-value">${escapeHtml(session.transportMode)}</div>
          </div>
          <div class="session-stat">
            <div class="session-stat-label">Requests</div>
            <div class="session-stat-value">${session.requestCount}</div>
          </div>
          <div class="session-stat">
            <div class="session-stat-label">Errors</div>
            <div class="session-stat-value ${session.errorCount > 0 ? 'text-danger' : ''}">${session.errorCount}</div>
          </div>
        </div>
      </div>

      <div class="session-detail-section">
        <h3>Call Statistics</h3>
        <div class="session-stats">
          <div class="session-stat">
            <div class="session-stat-label">Total Calls</div>
            <div class="session-stat-value">${stats.toolCallCount}</div>
          </div>
          <div class="session-stat">
            <div class="session-stat-label">Successful</div>
            <div class="session-stat-value text-success">${stats.successfulCalls}</div>
          </div>
          <div class="session-stat">
            <div class="session-stat-label">Failed</div>
            <div class="session-stat-value ${stats.failedCalls > 0 ? 'text-danger' : ''}">${stats.failedCalls}</div>
          </div>
        </div>
      </div>

      <div class="session-detail-section">
        <h3>Tool Calls (${data.toolCalls.length})</h3>
        ${data.toolCalls.length > 0 ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${data.toolCalls.map(call => `
                <tr>
                  <td><code>${escapeHtml(call.toolName)}</code></td>
                  <td><span class="badge ${getStatusBadge(call.status)}">${call.status}</span></td>
                  <td>${call.durationMs !== null ? formatLatency(call.durationMs) : '-'}</td>
                  <td style="font-size: 0.75rem; color: var(--color-text-muted);">${new Date(call.startedAt).toLocaleTimeString()}</td>
                  <td><button class="btn btn-sm" onclick="viewToolCall('${call.id}')">View Details</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p class="text-muted">No tool calls in this session</p>'}
      </div>

      ${data.errors.length > 0 ? `
        <div class="session-detail-section">
          <h3>Errors (${data.errors.length})</h3>
          <div class="errors-list">
            ${data.errors.map(error => `
              <div class="error-item">
                <div class="error-header">
                  <span class="error-code">${escapeHtml(error.errorCode)}</span>
                  <span class="error-time">${error.timestampFormatted || error.timestamp}</span>
                </div>
                ${error.toolName ? `<div class="error-tool">Tool: <code>${escapeHtml(error.toolName)}</code></div>` : ''}
                <div class="error-message">${escapeHtml(error.message)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;

    elements.sessionModal.classList.remove('hidden');
  } catch (err) {
    showError(`Failed to load session details: ${err.message}`);
  }
}

// View tool call details
async function viewToolCall(toolCallId) {
  try {
    const data = await fetchAPI(`/tool-calls/${toolCallId}`);
    const toolCall = data.toolCall;

    elements.toolCallModalTitle.textContent = `${toolCall.toolName} - ${toolCall.id.slice(0, 8)}...`;

    let detailsHtml = '';

    // Basic info
    detailsHtml += `
      <div class="session-detail-section">
        <h3>Call Info</h3>
        <div class="session-stats">
          <div class="session-stat">
            <div class="session-stat-label">Status</div>
            <div class="session-stat-value">
              <span class="badge ${getStatusBadge(toolCall.status)}">${toolCall.status}</span>
            </div>
          </div>
          <div class="session-stat">
            <div class="session-stat-label">Duration</div>
            <div class="session-stat-value">${toolCall.durationFormatted || 'In progress'}</div>
          </div>
          <div class="session-stat">
            <div class="session-stat-label">Started</div>
            <div class="session-stat-value">${toolCall.startedAtFormatted}</div>
          </div>
          ${toolCall.finishedAtFormatted ? `
            <div class="session-stat">
              <div class="session-stat-label">Finished</div>
              <div class="session-stat-value">${toolCall.finishedAtFormatted}</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Parameters
    if (toolCall.params !== undefined && toolCall.params !== null) {
      detailsHtml += `
        <div class="session-detail-section">
          <h3>Parameters</h3>
          <pre class="code-block">${escapeHtml(typeof toolCall.params === 'string' ? toolCall.params : JSON.stringify(toolCall.params, null, 2))}</pre>
        </div>
      `;
    } else {
      detailsHtml += `
        <div class="session-detail-section">
          <h3>Parameters</h3>
          <p class="text-muted">Parameters not available (enable ROCRATE_DASHBOARD_DETAILED_LOGGING=true to capture parameters)</p>
        </div>
      `;
    }

    // Result
    if (toolCall.status === 'success' && toolCall.result !== undefined && toolCall.result !== null) {
      detailsHtml += `
        <div class="session-detail-section">
          <h3>Result</h3>
          <pre class="code-block">${escapeHtml(typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2))}</pre>
        </div>
      `;
    }

    // Error
    if (toolCall.status === 'error') {
      detailsHtml += `
        <div class="session-detail-section">
          <h3>Error</h3>
          <div class="error-item">
            <div class="error-header">
              <span class="error-code">${escapeHtml(toolCall.errorCode || 'Unknown')}</span>
            </div>
            <div class="error-message">${escapeHtml(toolCall.errorMessage || toolCall.errorMessageFull || 'No message')}</div>
          </div>
        </div>
      `;
    }

    // Sizes
    detailsHtml += `
      <div class="session-detail-section">
        <h3>Metadata</h3>
        <div class="session-stats">
          <div class="session-stat">
            <div class="session-stat-label">Args Size</div>
            <div class="session-stat-value">${formatBytes(toolCall.argsSizeBytes)}</div>
          </div>
          ${toolCall.resultSizeBytes !== undefined ? `
            <div class="session-stat">
              <div class="session-stat-label">Result Size</div>
              <div class="session-stat-value">${formatBytes(toolCall.resultSizeBytes)}</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    elements.toolCallModalBody.innerHTML = detailsHtml;
    elements.toolCallModal.classList.remove('hidden');
  } catch (err) {
    showError(`Failed to load tool call details: ${err.message}`);
  }
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Settings functions
async function loadSettings() {
  try {
    const config = await fetchAPI('/config');
    elements.detailedLoggingToggle.checked = config.detailedToolCallLogging;
    elements.retentionHoursInput.value = config.retentionHours;
  } catch (err) {
    showError(`Failed to load settings: ${err.message}`);
  }
}

async function saveSettings(e) {
  e.preventDefault();

  const detailedLogging = elements.detailedLoggingToggle.checked;
  const retentionHours = parseInt(elements.retentionHoursInput.value, 10);

  if (isNaN(retentionHours) || retentionHours < 1 || retentionHours > 168) {
    showSettingsMessage('Retention hours must be between 1 and 168', 'error');
    return;
  }

  try {
    const result = await postAPI('/config', {
      detailedToolCallLogging: detailedLogging,
      retentionHours: retentionHours,
    });

    showSettingsMessage('Settings saved successfully!', 'success');

    // Refresh the data to reflect any changes
    setTimeout(() => refreshAll(), 500);
  } catch (err) {
    showSettingsMessage(`Failed to save settings: ${err.message}`, 'error');
  }
}

function showSettingsMessage(message, type) {
  elements.settingsMessage.textContent = message;
  elements.settingsMessage.className = `settings-message ${type}`;
  elements.settingsMessage.classList.remove('hidden');

  setTimeout(() => {
    elements.settingsMessage.classList.add('hidden');
  }, 3000);
}

function showSchemaRegistryMessage(message, type) {
  elements.schemaRegistryMessage.textContent = message;
  elements.schemaRegistryMessage.className = `settings-message ${type}`;
  elements.schemaRegistryMessage.classList.remove('hidden');

  setTimeout(() => {
    elements.schemaRegistryMessage.classList.add('hidden');
  }, 3000);
}

function splitCsv(input) {
  return (input || '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

async function loadSchemaRegistry() {
  try {
    const data = await fetchAPI('/schema-registry?mode=local');
    const schemas = data.schemas || [];
    if (schemas.length === 0) {
      elements.schemaRegistryTableBody.innerHTML = '<tr><td colspan="6" class="empty">No schemas registered</td></tr>';
      return;
    }

    elements.schemaRegistryTableBody.innerHTML = schemas.map((entry) => `
      <tr>
        <td><code>${escapeHtml(entry.id)}</code></td>
        <td>${escapeHtml(entry.displayName)}</td>
        <td><code>${escapeHtml(entry.schemaUrl)}</code></td>
        <td>${escapeHtml((entry.matchesUrls || []).join(', '))}</td>
        <td>${escapeHtml((entry.activeOnSpec || []).join(', '))}</td>
        <td>
          <button class="btn btn-sm" onclick='editSchema(${JSON.stringify(entry.id)})'>Edit</button>
          <button class="btn btn-sm" onclick='deleteSchema(${JSON.stringify(entry.id)})'>Delete</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    elements.schemaRegistryTableBody.innerHTML = `<tr><td colspan="6" class="text-danger">Failed to load schema registry: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function addOrReplaceSchema() {
  const id = (elements.schemaIdInput.value || '').trim();
  const displayName = (elements.schemaDisplayNameInput.value || '').trim();
  const schemaUrl = (elements.schemaUrlInput.value || '').trim();
  const matchesUrls = splitCsv(elements.schemaMatchesInput.value);
  const activeOnSpec = splitCsv(elements.schemaSpecsInput.value);

  if (!id || !displayName || !schemaUrl || matchesUrls.length === 0) {
    showSchemaRegistryMessage('id, displayName, schemaUrl and matchesUrls are required.', 'error');
    return;
  }

  const payload = {
    mode: 'local',
    id,
    displayName,
    schemaUrl,
    matchesUrls,
  };
  if (activeOnSpec.length > 0) {
    payload.activeOnSpec = activeOnSpec;
  }

  try {
    const existing = await fetchAPI('/schema-registry?mode=local');
    const exists = (existing.schemas || []).some((entry) => entry.id === id);
    if (exists) {
      await putAPI(`/schema-registry/${encodeURIComponent(id)}`, payload);
      showSchemaRegistryMessage('Schema updated.', 'success');
    } else {
      await postAPI('/schema-registry', payload);
      showSchemaRegistryMessage('Schema added.', 'success');
    }
    await loadSchemaRegistry();
  } catch (err) {
    showSchemaRegistryMessage(`Failed to save schema: ${err.message}`, 'error');
  }
}

async function editSchema(id) {
  try {
    const data = await fetchAPI('/schema-registry?mode=local');
    const entry = (data.schemas || []).find((item) => item.id === id);
    if (!entry) {
      showSchemaRegistryMessage(`Schema not found: ${id}`, 'error');
      return;
    }
    elements.schemaIdInput.value = entry.id || '';
    elements.schemaDisplayNameInput.value = entry.displayName || '';
    elements.schemaUrlInput.value = entry.schemaUrl || '';
    elements.schemaMatchesInput.value = (entry.matchesUrls || []).join(', ');
    elements.schemaSpecsInput.value = (entry.activeOnSpec || []).join(', ');
  } catch (err) {
    showSchemaRegistryMessage(`Failed to load schema for edit: ${err.message}`, 'error');
  }
}

async function deleteSchema(id) {
  if (!window.confirm(`Delete schema '${id}'?`)) {
    return;
  }
  try {
    await deleteAPI(`/schema-registry/${encodeURIComponent(id)}?mode=local`);
    showSchemaRegistryMessage('Schema deleted.', 'success');
    await loadSchemaRegistry();
  } catch (err) {
    showSchemaRegistryMessage(`Failed to delete schema: ${err.message}`, 'error');
  }
}

function openSettings() {
  loadSettings();
  loadSchemaRegistry();
  elements.settingsModal.classList.remove('hidden');
  elements.settingsMessage.classList.add('hidden');
}

function closeSettings() {
  elements.settingsModal.classList.add('hidden');
}

function closeOpenModals() {
  if (elements.sessionModal && !elements.sessionModal.classList.contains('hidden')) {
    elements.sessionModal.classList.add('hidden');
  }
  if (elements.toolCallModal && !elements.toolCallModal.classList.contains('hidden')) {
    elements.toolCallModal.classList.add('hidden');
  }
  if (elements.settingsModal && !elements.settingsModal.classList.contains('hidden')) {
    elements.settingsModal.classList.add('hidden');
  }
}

// Update dependencies table
async function updateDependencies() {
  try {
    const data = await fetchAPI('/dependencies');

    if (data.dependencies.length === 0) {
      elements.dependenciesTableBody.innerHTML = '<tr><td colspan="5" class="empty">No dependency usage recorded</td></tr>';
      return;
    }

    elements.dependenciesTableBody.innerHTML = data.dependencies.map(dep => `
      <tr>
        <td><code>${escapeHtml(dep.dependency)}</code></td>
        <td>${dep.callCount.toLocaleString()}</td>
        <td>${dep.successRate}</td>
        <td>${dep.avgLatency}</td>
        <td>${dep.lastCall}</td>
      </tr>
    `).join('');
  } catch (err) {
    elements.dependenciesTableBody.innerHTML = `<tr><td colspan="5" class="text-danger">Failed to load: ${err.message}</td></tr>`;
  }
}

// Escape HTML to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Refresh all data
async function refreshAll() {
  const icon = elements.refreshBtn.querySelector('.icon');
  icon.classList.add('spinning');

  try {
    await Promise.all([
      updateOverview(),
      updateTools(),
      updateErrors(),
      updateSessions(),
      updateDependencies(),
    ]);
  } finally {
    icon.classList.remove('spinning');
  }
}

// Event Listeners
elements.timeRange.addEventListener('change', (e) => {
  currentMinutes = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
  refreshAll();
});

elements.refreshBtn.addEventListener('click', refreshAll);

elements.closeSessionModal.addEventListener('click', () => {
  elements.sessionModal.classList.add('hidden');
});

elements.sessionModal.addEventListener('click', (e) => {
  if (e.target === elements.sessionModal) {
    elements.sessionModal.classList.add('hidden');
  }
});

// Tool call modal event listeners
if (elements.closeToolCallModal) {
  elements.closeToolCallModal.addEventListener('click', () => {
    elements.toolCallModal.classList.add('hidden');
  });

  elements.toolCallModal.addEventListener('click', (e) => {
    if (e.target === elements.toolCallModal) {
      elements.toolCallModal.classList.add('hidden');
    }
  });
}

// Settings modal event listeners
if (elements.settingsBtn) {
  elements.settingsBtn.addEventListener('click', openSettings);
}

if (elements.closeSettingsModal) {
  elements.closeSettingsModal.addEventListener('click', closeSettings);
}

if (elements.cancelSettingsBtn) {
  elements.cancelSettingsBtn.addEventListener('click', closeSettings);
}

if (elements.settingsForm) {
  elements.settingsForm.addEventListener('submit', saveSettings);
}

if (elements.settingsModal) {
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      closeSettings();
    }
  });
}

if (elements.addSchemaBtn) {
  elements.addSchemaBtn.addEventListener('click', addOrReplaceSchema);
}

if (elements.reloadSchemaBtn) {
  elements.reloadSchemaBtn.addEventListener('click', loadSchemaRegistry);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeOpenModals();
  }
});

// Make viewSession and viewToolCall available globally
window.viewSession = viewSession;
window.viewToolCall = viewToolCall;
window.editSchema = editSchema;
window.deleteSchema = deleteSchema;

// Initial load
refreshAll();

// Auto-refresh every 30 seconds
setInterval(refreshAll, 30000);
