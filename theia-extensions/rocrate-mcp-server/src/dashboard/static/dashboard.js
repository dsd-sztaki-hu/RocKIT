/**
 * RO-Crate MCP Dashboard Client
 * Handles API communication and UI updates
 */

// API base URL (same host)
const API_BASE = window.location.origin;

// State
let currentMinutes = 15;
let autoRefreshInterval = null;
let metadataProfileProviders = [];
let currentMetadataProfileProviderId = '';
let metadataProfilesState = {
  profiles: [],
  page: 1,
  pageSize: 10,
};
let cedarBrowserState = {
  providerId: '',
  selectedTemplateId: '',
  selectedTemplateName: '',
  nodes: [],
  expanded: new Set(),
  loading: new Set(),
  query: '',
};

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
  metadataProfilesBtn: document.getElementById('metadataProfilesBtn'),
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
  keepDataverseUploadZipsToggle: document.getElementById('keepDataverseUploadZipsToggle'),
  retentionHoursInput: document.getElementById('retentionHoursInput'),
  cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
  closeSettingsModal: document.getElementById('closeSettingsModal'),
  metadataProfilesModal: document.getElementById('metadataProfilesModal'),
  closeMetadataProfilesModal: document.getElementById('closeMetadataProfilesModal'),
  settingsMessage: document.getElementById('settingsMessage'),
  dataverseBaseUrlValue: document.getElementById('dataverseBaseUrlValue'),
  dataverseBaseUrlSource: document.getElementById('dataverseBaseUrlSource'),
  dataverseApiKeyValue: document.getElementById('dataverseApiKeyValue'),
  dataverseApiKeySource: document.getElementById('dataverseApiKeySource'),
  metadataProfileStorageValue: document.getElementById('metadataProfileStorageValue'),
  metadataProfilesTableBody: document.querySelector('#metadataProfilesTable tbody'),
  metadataProfilesPagination: document.getElementById('metadataProfilesPagination'),
  metadataProfilesPrevPageBtn: document.getElementById('metadataProfilesPrevPageBtn'),
  metadataProfilesNextPageBtn: document.getElementById('metadataProfilesNextPageBtn'),
  metadataProfilesPageValue: document.getElementById('metadataProfilesPageValue'),
  metadataProfilesPageSizeSelect: document.getElementById('metadataProfilesPageSizeSelect'),
  metadataProfileUrlInput: document.getElementById('metadataProfileUrlInput'),
  importMetadataProfileBtn: document.getElementById('importMetadataProfileBtn'),
  browseMetadataProfilesBtn: document.getElementById('browseMetadataProfilesBtn'),
  manageMetadataProvidersBtn: document.getElementById('manageMetadataProvidersBtn'),
  reloadMetadataProfilesBtn: document.getElementById('reloadMetadataProfilesBtn'),
  metadataProfilesMessage: document.getElementById('metadataProfilesMessage'),
  remoteProviderSelectModal: document.getElementById('remoteProviderSelectModal'),
  closeRemoteProviderSelectModal: document.getElementById('closeRemoteProviderSelectModal'),
  cancelRemoteProviderSelectBtn: document.getElementById('cancelRemoteProviderSelectBtn'),
  openManageProvidersFromSelectBtn: document.getElementById('openManageProvidersFromSelectBtn'),
  remoteProviderSelectList: document.getElementById('remoteProviderSelectList'),
  manageRemoteProvidersModal: document.getElementById('manageRemoteProvidersModal'),
  closeManageRemoteProvidersModal: document.getElementById('closeManageRemoteProvidersModal'),
  closeManageRemoteProvidersBtn: document.getElementById('closeManageRemoteProvidersBtn'),
  addRemoteProviderBtn: document.getElementById('addRemoteProviderBtn'),
  remoteProviderManageList: document.getElementById('remoteProviderManageList'),
  remoteProviderForm: document.getElementById('remoteProviderForm'),
  remoteProviderOriginalId: document.getElementById('remoteProviderOriginalId'),
  remoteProviderIdInput: document.getElementById('remoteProviderIdInput'),
  remoteProviderTitleInput: document.getElementById('remoteProviderTitleInput'),
  remoteProviderBaseUrlInput: document.getElementById('remoteProviderBaseUrlInput'),
  remoteProviderDomainInput: document.getElementById('remoteProviderDomainInput'),
  remoteProviderAccessModeInput: document.getElementById('remoteProviderAccessModeInput'),
  remoteProviderProxyBaseUrlInput: document.getElementById('remoteProviderProxyBaseUrlInput'),
  remoteProviderApiKeyInput: document.getElementById('remoteProviderApiKeyInput'),
  cancelRemoteProviderFormBtn: document.getElementById('cancelRemoteProviderFormBtn'),
  remoteProviderManageMessage: document.getElementById('remoteProviderManageMessage'),
  cedarBrowserModal: document.getElementById('cedarBrowserModal'),
  cedarBrowserTitle: document.getElementById('cedarBrowserTitle'),
  closeCedarBrowserModal: document.getElementById('closeCedarBrowserModal'),
  cedarSearchToggleBtn: document.getElementById('cedarSearchToggleBtn'),
  cedarSearchInput: document.getElementById('cedarSearchInput'),
  cedarExpandAllBtn: document.getElementById('cedarExpandAllBtn'),
  cedarCollapseAllBtn: document.getElementById('cedarCollapseAllBtn'),
  cedarBrowserTree: document.getElementById('cedarBrowserTree'),
  cedarLocateSelectedBtn: document.getElementById('cedarLocateSelectedBtn'),
  cedarClearSelectionBtn: document.getElementById('cedarClearSelectionBtn'),
  cedarBrowserSelectionText: document.getElementById('cedarBrowserSelectionText'),
  cancelCedarBrowserBtn: document.getElementById('cancelCedarBrowserBtn'),
  addCedarTemplateBtn: document.getElementById('addCedarTemplateBtn'),
  schemaRegistryTableBody: document.querySelector('#schemaRegistryTable tbody'),
  schemaIdInput: document.getElementById('schemaIdInput'),
  schemaDisplayNameInput: document.getElementById('schemaDisplayNameInput'),
  schemaUrlInput: document.getElementById('schemaUrlInput'),
  schemaMatchesInput: document.getElementById('schemaMatchesInput'),
  schemaSpecsInput: document.getElementById('schemaSpecsInput'),
  addSchemaBtn: document.getElementById('addSchemaBtn'),
  reloadSchemaBtn: document.getElementById('reloadSchemaBtn'),
  schemaRegistryMessage: document.getElementById('schemaRegistryMessage'),
  tavilyTestForm: document.getElementById('tavilyTestForm'),
  tavilyQueryInput: document.getElementById('tavilyQueryInput'),
  tavilyMaxResults: document.getElementById('tavilyMaxResults'),
  tavilySearchDepth: document.getElementById('tavilySearchDepth'),
  tavilyTestBtn: document.getElementById('tavilyTestBtn'),
  tavilyClearBtn: document.getElementById('tavilyClearBtn'),
  tavilyTestResult: document.getElementById('tavilyTestResult'),
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

    // Artifacts
    if (Array.isArray(toolCall.artifacts) && toolCall.artifacts.length > 0) {
      detailsHtml += `
        <div class="session-detail-section">
          <h3>Artifacts</h3>
          ${toolCall.artifacts.map(artifact => `
            <div class="artifact-row">
              <div class="artifact-label">${escapeHtml(artifact.label || 'Artifact')}</div>
              <pre class="code-block artifact-path">${escapeHtml(artifact.path || '')}</pre>
            </div>
          `).join('')}
        </div>
      `;
    }

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

    if (Array.isArray(toolCall.httpLogs) && toolCall.httpLogs.length > 0) {
      detailsHtml += `
        <div class="session-detail-section">
          <h3>HTTP Communication</h3>
          ${toolCall.httpLogs.map((log, index) => `
            <div class="session-detail-section">
              <h4>${escapeHtml(log.dependency || 'http')} #${index + 1}</h4>
              <div class="session-stats">
                <div class="session-stat">
                  <div class="session-stat-label">Timestamp</div>
                  <div class="session-stat-value">${escapeHtml(log.timestamp || '')}</div>
                </div>
                <div class="session-stat">
                  <div class="session-stat-label">Request</div>
                  <div class="session-stat-value">${escapeHtml((log.request?.method || 'GET') + ' ' + (log.request?.url || ''))}</div>
                </div>
                ${log.response ? `
                  <div class="session-stat">
                    <div class="session-stat-label">Response</div>
                    <div class="session-stat-value">${escapeHtml(String(log.response.status))}</div>
                  </div>
                ` : ''}
              </div>
              <h4>Request Headers</h4>
              ${formatHttpHeaders(log.request?.headers)}
              <h4>Request Body</h4>
              ${formatHttpBody(log.request?.body)}
              ${log.response ? `
                <h4>Response Headers</h4>
                ${formatHttpHeaders(log.response.headers)}
                <h4>Response Body</h4>
                ${formatHttpBody(log.response.body)}
              ` : ''}
              ${log.error ? `
                <h4>Error</h4>
                <pre class="code-block">${escapeHtml(log.error)}</pre>
              ` : ''}
            </div>
          `).join('')}
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

function formatHttpHeaders(headers) {
  if (!headers || Object.keys(headers).length === 0) {
    return '<p class="text-muted">No headers logged</p>';
  }
  return `<pre class="code-block">${escapeHtml(JSON.stringify(headers, null, 2))}</pre>`;
}

function formatHttpBody(body) {
  if (body === undefined || body === null || body === '') {
    return '<p class="text-muted">No body logged</p>';
  }
  return `<pre class="code-block">${escapeHtml(body)}</pre>`;
}

// Settings functions
async function loadSettings() {
  try {
    const config = await fetchAPI('/config');
    elements.detailedLoggingToggle.checked = config.detailedToolCallLogging;
    elements.keepDataverseUploadZipsToggle.checked = config.keepDataverseUploadZips === true;
    elements.retentionHoursInput.value = config.retentionHours;
    renderDataverseSettings(config.dataverse);
  } catch (err) {
    showError(`Failed to load settings: ${err.message}`);
  }
}

function renderDataverseSettings(dataverse) {
  const config = dataverse || {};
  const baseUrl = config.baseUrl || '(not set)';
  const apiKey = config.apiKey || '(not set)';
  const baseUrlSource = config.baseUrlSource === 'env'
    ? 'Set from DATAVERSE_BASE_URL'
    : 'Using upload tool default';
  const apiKeySource = config.apiKeySource === 'env'
    ? 'Set from DATAVERSE_API_KEY'
    : 'DATAVERSE_API_KEY is not set';

  elements.dataverseBaseUrlValue.textContent = baseUrl;
  elements.dataverseBaseUrlSource.textContent = baseUrlSource;
  elements.dataverseApiKeyValue.textContent = apiKey;
  elements.dataverseApiKeySource.textContent = apiKeySource;
}

async function saveSettings(e) {
  e.preventDefault();

  const detailedLogging = elements.detailedLoggingToggle.checked;
  const keepDataverseUploadZips = elements.keepDataverseUploadZipsToggle.checked;
  const retentionHours = parseInt(elements.retentionHoursInput.value, 10);

  if (isNaN(retentionHours) || retentionHours < 1 || retentionHours > 168) {
    showSettingsMessage('Retention hours must be between 1 and 168', 'error');
    return;
  }

  try {
    const result = await postAPI('/config', {
      detailedToolCallLogging: detailedLogging,
      keepDataverseUploadZips: keepDataverseUploadZips,
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

function showMetadataProfilesMessage(message, type) {
  elements.metadataProfilesMessage.textContent = message;
  elements.metadataProfilesMessage.className = `settings-message ${type}`;
  elements.metadataProfilesMessage.classList.remove('hidden');

  setTimeout(() => {
    elements.metadataProfilesMessage.classList.add('hidden');
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

async function loadMetadataProfiles() {
  if (!elements.metadataProfilesTableBody) return;
  try {
    const data = await fetchAPI('/metadata-profiles');
    const storage = data.storage || {};
    elements.metadataProfileStorageValue.textContent = `${storage.rootPath || ''} (${storage.indexPath || ''})`;
    metadataProfilesState.profiles = data.profiles || [];
    renderMetadataProfilesTable();
  } catch (err) {
    elements.metadataProfilesTableBody.innerHTML = `<tr><td colspan="7" class="text-danger">Failed to load metadata profiles: ${escapeHtml(err.message)}</td></tr>`;
    updateMetadataProfilesPagination(0);
  }
}

function renderUrlCell(value) {
  const text = value || '';
  if (!text) {
    return '<span class="text-muted">-</span>';
  }
  const escaped = escapeHtml(text);
  if (/^https?:\/\//i.test(text)) {
    return `<a class="url-cell" href="${escaped}" target="_blank" rel="noopener noreferrer" title="${escaped}">${escaped}</a>`;
  }
  return `<code class="url-cell" title="${escaped}">${escaped}</code>`;
}

function renderMetadataProfilesTable() {
  if (!elements.metadataProfilesTableBody) return;
  const profiles = metadataProfilesState.profiles || [];
  const totalPages = Math.max(1, Math.ceil(profiles.length / metadataProfilesState.pageSize));
  metadataProfilesState.page = Math.min(Math.max(1, metadataProfilesState.page), totalPages);

  if (profiles.length === 0) {
    elements.metadataProfilesTableBody.innerHTML = '<tr><td colspan="7" class="empty">No metadata profiles imported</td></tr>';
    updateMetadataProfilesPagination(0);
    return;
  }

  const start = (metadataProfilesState.page - 1) * metadataProfilesState.pageSize;
  const pageProfiles = profiles.slice(start, start + metadataProfilesState.pageSize);
  elements.metadataProfilesTableBody.innerHTML = pageProfiles.map((profile) => {
    const reference = profile.aux?.reference || profile.downloadUrl || '';
    const conformsTo = profile.conformsTo || '';
    return `
      <tr>
        <td><span class="badge badge-success">Ready</span></td>
        <td>${escapeHtml(profile.name)}</td>
        <td>${escapeHtml(profile.version || '')}</td>
        <td><span class="badge badge-neutral">${escapeHtml(profile.source || '')}</span></td>
        <td>${renderUrlCell(reference)}</td>
        <td>${renderUrlCell(conformsTo)}</td>
        <td>
          <button class="btn btn-sm" onclick='deleteMetadataProfile(${JSON.stringify(profile.id)})'>Delete</button>
        </td>
      </tr>
    `;
  }).join('');
  updateMetadataProfilesPagination(profiles.length);
}

function updateMetadataProfilesPagination(total) {
  if (!elements.metadataProfilesPagination) return;
  const totalPages = Math.max(1, Math.ceil(total / metadataProfilesState.pageSize));
  elements.metadataProfilesPageValue.textContent = String(metadataProfilesState.page);
  elements.metadataProfilesPrevPageBtn.disabled = metadataProfilesState.page <= 1;
  elements.metadataProfilesNextPageBtn.disabled = metadataProfilesState.page >= totalPages || total === 0;
  elements.metadataProfilesPageSizeSelect.value = String(metadataProfilesState.pageSize);
}

async function loadMetadataProfileProviders() {
  try {
    const data = await fetchAPI('/metadata-profiles/providers');
    metadataProfileProviders = data.providers || [];
    const providers = metadataProfileProviders;
    if (providers.length === 0) {
      if (elements.remoteProviderSelectList) {
        elements.remoteProviderSelectList.innerHTML = '<div class="empty">No CEDAR providers are configured</div>';
      }
      if (elements.remoteProviderManageList) {
        elements.remoteProviderManageList.innerHTML = '<div class="empty">No CEDAR providers are configured</div>';
      }
      showMetadataProfilesMessage('No CEDAR providers are configured.', 'error');
      return providers;
    }
    const proxyProvider = providers.find((provider) => provider.accessMode === 'dataverseProxy');
    const keyedProvider = providers.find((provider) => provider.apiKeyPresent);
    currentMetadataProfileProviderId = proxyProvider?.id || keyedProvider?.id || providers[0]?.id || '';
    renderRemoteProviderSelectList();
    renderRemoteProviderManageList();
    if (data.warnings && data.warnings.length > 0) {
      showMetadataProfilesMessage(data.warnings.join(' '), 'error');
    }
    return providers;
  } catch (err) {
    if (elements.remoteProviderSelectList) {
      elements.remoteProviderSelectList.innerHTML = '<div class="text-danger">Provider load failed</div>';
    }
    if (elements.remoteProviderManageList) {
      elements.remoteProviderManageList.innerHTML = '<div class="text-danger">Provider load failed</div>';
    }
    showMetadataProfilesMessage(`Failed to load CEDAR providers: ${err.message}`, 'error');
    return [];
  }
}

function renderRemoteProviderSelectList() {
  if (!elements.remoteProviderSelectList) return;
  if (metadataProfileProviders.length === 0) {
    elements.remoteProviderSelectList.innerHTML = '<div class="empty">No CEDAR providers are configured</div>';
    return;
  }
  elements.remoteProviderSelectList.innerHTML = metadataProfileProviders.map((provider) => `
    <div class="provider-row clickable" onclick='selectRemoteProvider(${JSON.stringify(provider.id || '')})'>
      <div class="provider-row-icon provider-server-icon"></div>
      <div>
        <div class="provider-row-title">${escapeHtml(provider.title || provider.id || 'CEDAR Provider')}${providerAccessBadge(provider)}</div>
        <div class="provider-row-url">${escapeHtml(provider.displayUrl || provider.baseUrl || provider.domainBase || '')}</div>
      </div>
      <div class="provider-arrow">›</div>
    </div>
  `).join('');
}

function renderRemoteProviderManageList() {
  if (!elements.remoteProviderManageList) return;
  if (metadataProfileProviders.length === 0) {
    elements.remoteProviderManageList.innerHTML = '<div class="empty">No CEDAR providers are configured</div>';
    return;
  }
  elements.remoteProviderManageList.innerHTML = metadataProfileProviders.map((provider) => `
    <div class="provider-row">
      <div class="provider-row-icon provider-server-icon"></div>
      <div>
        <div class="provider-row-title">${escapeHtml(provider.title || provider.id || 'CEDAR Provider')}${providerAccessBadge(provider, true)}</div>
        <div class="provider-row-url">${escapeHtml(provider.displayUrl || provider.baseUrl || provider.domainBase || '')}</div>
      </div>
      <div class="provider-row-actions">
        <button type="button" class="btn btn-sm" onclick='editRemoteProvider(${JSON.stringify(provider.id || '')})'>Edit</button>
        <button type="button" class="btn btn-sm" onclick='deleteRemoteProvider(${JSON.stringify(provider.id || '')})'>Delete</button>
      </div>
    </div>
  `).join('');
}

function showRemoteProviderManageMessage(message, type = 'success') {
  if (!elements.remoteProviderManageMessage) return;
  elements.remoteProviderManageMessage.textContent = message;
  elements.remoteProviderManageMessage.className = `settings-message ${type}`;
  elements.remoteProviderManageMessage.classList.remove('hidden');
}

function hideRemoteProviderManageMessage() {
  if (elements.remoteProviderManageMessage) {
    elements.remoteProviderManageMessage.classList.add('hidden');
  }
}

function providerAccessBadge(provider, verbose = false) {
  const mode = provider.accessMode || (provider.apiKeyPresent ? 'apiKey' : 'dataverseProxy');
  if (mode === 'dataverseProxy') {
    return ` <span class="badge badge-success">${verbose ? 'Dataverse proxy' : 'proxy'}</span>`;
  }
  if (provider.apiKeyPresent) {
    return ` <span class="badge badge-success">${verbose ? 'key configured' : 'key'}</span>`;
  }
  return ` <span class="badge">${verbose ? 'API key' : 'key'}</span>`;
}

async function openRemoteProviderSelect() {
  await loadMetadataProfileProviders();
  elements.remoteProviderSelectModal.classList.remove('hidden');
}

function closeRemoteProviderSelect() {
  elements.remoteProviderSelectModal.classList.add('hidden');
}

async function openManageRemoteProviders() {
  closeRemoteProviderSelect();
  await loadMetadataProfileProviders();
  hideRemoteProviderForm();
  hideRemoteProviderManageMessage();
  elements.manageRemoteProvidersModal.classList.remove('hidden');
}

function closeManageRemoteProviders() {
  elements.manageRemoteProvidersModal.classList.add('hidden');
}

async function selectRemoteProvider(providerId) {
  currentMetadataProfileProviderId = providerId || '';
  closeRemoteProviderSelect();
  await openCedarBrowser(providerId);
}

async function openCedarBrowser(providerId) {
  const provider = metadataProfileProviders.find((item) => item.id === providerId) || {};
  cedarBrowserState = {
    providerId: providerId || '',
    selectedTemplateId: '',
    selectedTemplateName: '',
    nodes: [],
    expanded: new Set(),
    loading: new Set(),
    query: '',
  };
  elements.cedarBrowserTitle.textContent = `Browse ${provider.title || provider.id || 'Remote'}`;
  elements.cedarSearchInput.value = '';
  elements.cedarSearchInput.classList.add('hidden');
  elements.cedarBrowserModal.classList.remove('hidden');
  updateCedarSelection();
  elements.cedarBrowserTree.innerHTML = '<div class="loading">Loading repository...</div>';
  try {
    cedarBrowserState.nodes = await fetchCedarFolder('');
    renderCedarTree();
  } catch (err) {
    elements.cedarBrowserTree.innerHTML = `<div class="text-danger">Failed to load repository: ${escapeHtml(err.message)}</div>`;
  }
}

function closeCedarBrowser() {
  elements.cedarBrowserModal.classList.add('hidden');
}

async function fetchCedarFolder(folderId) {
  const params = new URLSearchParams();
  if (cedarBrowserState.providerId) params.set('providerId', cedarBrowserState.providerId);
  if (folderId) params.set('folderId', folderId);
  const data = await fetchAPI(`/metadata-profiles/remote-folder?${params.toString()}`);
  return (data.resources || []).map((resource) => ({
    id: resource.id,
    name: resource.name,
    resourceType: resource.resourceType,
    isFolder: resource.resourceType === 'folder',
    conformsTo: resource.conformsTo || '',
    alreadyImported: Boolean(resource.alreadyImported),
    children: [],
    childrenLoaded: false,
    error: '',
  }));
}

function renderCedarTree() {
  const query = cedarBrowserState.query.trim().toLowerCase();
  const nodes = query ? filterCedarNodes(cedarBrowserState.nodes, query) : cedarBrowserState.nodes;
  if (nodes.length === 0) {
    elements.cedarBrowserTree.innerHTML = `<div class="empty">${query ? 'No results found.' : 'No templates found.'}</div>`;
    return;
  }
  elements.cedarBrowserTree.innerHTML = `<ul class="cedar-tree-list">${renderCedarNodes(nodes)}</ul>`;
}

function renderCedarNodes(nodes) {
  return nodes.map((node) => {
    const expanded = cedarBrowserState.expanded.has(node.id);
    const loading = cedarBrowserState.loading.has(node.id);
    const selected = cedarBrowserState.selectedTemplateId === node.id;
    const disabled = node.alreadyImported && !node.isFolder;
    const childrenHtml = node.isFolder && expanded
      ? `<ul class="cedar-tree-children">${loading ? '<li class="cedar-tree-loading">Loading...</li>' : node.error ? `<li class="cedar-tree-error">${escapeHtml(node.error)}</li>` : renderCedarNodes(node.children)}</ul>`
      : '';
    return `
      <li class="cedar-tree-node" id="cedar-node-${escapeAttr(node.id)}">
        <div class="cedar-tree-row ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" onclick='handleCedarNodeClick(${JSON.stringify(node.id)})'>
          <button type="button" class="cedar-tree-toggle ${node.isFolder ? '' : 'placeholder'}" onclick='handleCedarToggle(event, ${JSON.stringify(node.id)})'>${node.isFolder ? (expanded ? '⌄' : '›') : ''}</button>
          <span class="cedar-tree-icon ${node.isFolder ? 'folder' : 'template'}"></span>
          <span class="cedar-tree-name">${escapeHtml(node.name)}${node.alreadyImported ? ' <span class="badge badge-success">Imported</span>' : ''}</span>
        </div>
        ${childrenHtml}
      </li>
    `;
  }).join('');
}

function filterCedarNodes(nodes, query) {
  return nodes.map((node) => {
    const ownMatch = node.name.toLowerCase().includes(query);
    const childMatches = filterCedarNodes(node.children || [], query);
    if (ownMatch || childMatches.length > 0) {
      return { ...node, children: childMatches };
    }
    return null;
  }).filter(Boolean);
}

function findCedarNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findCedarNode(node.children || [], id);
    if (found) return found;
  }
  return null;
}

async function handleCedarToggle(event, nodeId) {
  event.stopPropagation();
  const node = findCedarNode(cedarBrowserState.nodes, nodeId);
  if (!node || !node.isFolder) return;
  if (cedarBrowserState.expanded.has(nodeId)) {
    cedarBrowserState.expanded.delete(nodeId);
    renderCedarTree();
    return;
  }
  cedarBrowserState.expanded.add(nodeId);
  if (!node.childrenLoaded) {
    cedarBrowserState.loading.add(nodeId);
    renderCedarTree();
    try {
      node.children = await fetchCedarFolder(node.id);
      node.childrenLoaded = true;
      node.error = '';
    } catch (err) {
      node.error = err.message;
    } finally {
      cedarBrowserState.loading.delete(nodeId);
    }
  }
  renderCedarTree();
}

async function handleCedarNodeClick(nodeId) {
  const node = findCedarNode(cedarBrowserState.nodes, nodeId);
  if (!node) return;
  if (node.isFolder) {
    cedarBrowserState.selectedTemplateId = '';
    cedarBrowserState.selectedTemplateName = '';
    updateCedarSelection();
    await handleCedarToggle({ stopPropagation() {} }, nodeId);
    return;
  }
  if (node.alreadyImported) return;
  cedarBrowserState.selectedTemplateId = node.id;
  cedarBrowserState.selectedTemplateName = node.name;
  updateCedarSelection();
  renderCedarTree();
}

function updateCedarSelection() {
  const hasSelection = Boolean(cedarBrowserState.selectedTemplateId);
  elements.addCedarTemplateBtn.disabled = !hasSelection;
  elements.cedarBrowserSelectionText.textContent = hasSelection
    ? cedarBrowserState.selectedTemplateName
    : 'Select a template to import...';
  elements.cedarBrowserSelectionText.classList.toggle('cedar-browser-placeholder', !hasSelection);
  elements.cedarLocateSelectedBtn.classList.toggle('hidden', !hasSelection);
  elements.cedarClearSelectionBtn.classList.toggle('hidden', !hasSelection);
}

function clearCedarSelection() {
  cedarBrowserState.selectedTemplateId = '';
  cedarBrowserState.selectedTemplateName = '';
  updateCedarSelection();
  renderCedarTree();
}

function locateCedarSelection() {
  if (!cedarBrowserState.selectedTemplateId) return;
  document.getElementById(`cedar-node-${cedarBrowserState.selectedTemplateId}`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
}

async function expandAllCedarNodes(nodes = cedarBrowserState.nodes) {
  for (const node of nodes) {
    if (!node.isFolder) continue;
    cedarBrowserState.expanded.add(node.id);
    if (!node.childrenLoaded) {
      cedarBrowserState.loading.add(node.id);
      renderCedarTree();
      try {
        node.children = await fetchCedarFolder(node.id);
        node.childrenLoaded = true;
        node.error = '';
      } catch (err) {
        node.error = err.message;
      } finally {
        cedarBrowserState.loading.delete(node.id);
      }
    }
    await expandAllCedarNodes(node.children);
  }
  renderCedarTree();
}

function collapseAllCedarNodes() {
  cedarBrowserState.expanded = new Set();
  renderCedarTree();
}

async function addSelectedCedarTemplate() {
  if (!cedarBrowserState.selectedTemplateId) return;
  try {
    elements.addCedarTemplateBtn.disabled = true;
    await postAPI('/metadata-profiles/import-known', {
      templateIdOrUrl: cedarBrowserState.selectedTemplateId,
      providerId: cedarBrowserState.providerId,
    });
    closeCedarBrowser();
    showMetadataProfilesMessage('Remote metadata profile imported.', 'success');
    await loadMetadataProfiles();
  } catch (err) {
    showMetadataProfilesMessage(`Failed to import remote profile: ${err.message}`, 'error');
    elements.addCedarTemplateBtn.disabled = false;
  }
}

function showRemoteProviderForm(provider = null) {
  elements.remoteProviderForm.classList.remove('hidden');
  elements.remoteProviderOriginalId.value = provider?.id || '';
  elements.remoteProviderIdInput.value = provider?.id || '';
  elements.remoteProviderTitleInput.value = provider?.title || '';
  elements.remoteProviderBaseUrlInput.value = provider?.displayUrl || provider?.baseUrl || '';
  elements.remoteProviderDomainInput.value = provider?.domainBase || '';
  elements.remoteProviderAccessModeInput.value = provider?.accessMode || (provider?.apiKeyPresent ? 'apiKey' : 'dataverseProxy');
  elements.remoteProviderProxyBaseUrlInput.value = provider?.dataverseProxyBaseUrl || deriveDataverseProxyBaseUrl(provider?.domainBase || provider?.displayUrl || provider?.baseUrl || '');
  elements.remoteProviderApiKeyInput.value = '';
  updateRemoteProviderAccessFields();
  hideRemoteProviderManageMessage();
}

function hideRemoteProviderForm() {
  elements.remoteProviderForm.classList.add('hidden');
}

function updateRemoteProviderAccessFields() {
  const mode = elements.remoteProviderAccessModeInput.value || 'dataverseProxy';
  elements.remoteProviderProxyBaseUrlInput.classList.toggle('hidden', mode !== 'dataverseProxy');
  elements.remoteProviderApiKeyInput.classList.toggle('hidden', mode !== 'apiKey');
  if (mode === 'dataverseProxy' && !elements.remoteProviderProxyBaseUrlInput.value) {
    elements.remoteProviderProxyBaseUrlInput.value = deriveDataverseProxyBaseUrl(
      elements.remoteProviderDomainInput.value || elements.remoteProviderBaseUrlInput.value,
    );
  }
}

function deriveDataverseProxyBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'https://repo.researchdata.hu';
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const parts = url.hostname.split('.');
    const first = (parts[0] || '').toLowerCase();
    if (first === 'schema') {
      parts[0] = 'repo';
    } else if (['cedar', 'resource', 'open', 'openview'].includes(first)) {
      parts.shift();
      if ((parts[0] || '').toLowerCase() === 'schema') {
        parts[0] = 'repo';
      } else {
        parts.unshift('repo');
      }
    } else if (first !== 'repo') {
      parts.unshift('repo');
    }
    url.hostname = parts.join('.');
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.origin;
  } catch {
    return trimmed;
  }
}

function editRemoteProvider(providerId) {
  const provider = metadataProfileProviders.find((item) => item.id === providerId);
  if (provider) {
    showRemoteProviderForm(provider);
  }
}

async function saveRemoteProvider(event) {
  event.preventDefault();
  const payload = {
    id: (elements.remoteProviderIdInput.value || '').trim(),
    title: (elements.remoteProviderTitleInput.value || '').trim(),
    baseUrl: (elements.remoteProviderBaseUrlInput.value || '').trim(),
    domainBase: (elements.remoteProviderDomainInput.value || '').trim(),
    accessMode: elements.remoteProviderAccessModeInput.value,
    dataverseProxyBaseUrl: (elements.remoteProviderProxyBaseUrlInput.value || '').trim(),
    apiKey: elements.remoteProviderAccessModeInput.value === 'apiKey'
      ? (elements.remoteProviderApiKeyInput.value || '').trim()
      : '',
  };
  if (!payload.id || !payload.title || !payload.baseUrl || !payload.domainBase) {
    showRemoteProviderManageMessage('Provider id, title, base URL and domain base are required.', 'error');
    return;
  }
  if (payload.accessMode === 'dataverseProxy' && !payload.dataverseProxyBaseUrl) {
    payload.dataverseProxyBaseUrl = deriveDataverseProxyBaseUrl(payload.domainBase || payload.baseUrl);
  }
  try {
    const originalId = elements.remoteProviderOriginalId.value;
    if (originalId && originalId !== payload.id) {
      await deleteAPI(`/metadata-profiles/providers/${encodeURIComponent(originalId)}`);
    }
    const data = await postAPI('/metadata-profiles/providers', payload);
    metadataProfileProviders = data.providers || [];
    renderRemoteProviderManageList();
    renderRemoteProviderSelectList();
    hideRemoteProviderForm();
    if (data.warnings && data.warnings.length > 0) {
      showRemoteProviderManageMessage(data.warnings.join(' '), 'error');
    } else {
      showRemoteProviderManageMessage('Provider saved.', 'success');
    }
  } catch (err) {
    showRemoteProviderManageMessage(`Failed to save provider: ${err.message}`, 'error');
  }
}

async function deleteRemoteProvider(providerId) {
  if (!window.confirm(`Delete remote provider '${providerId}'?`)) {
    return;
  }
  try {
    const data = await deleteAPI(`/metadata-profiles/providers/${encodeURIComponent(providerId)}`);
    metadataProfileProviders = data.providers || [];
    renderRemoteProviderManageList();
    renderRemoteProviderSelectList();
    showRemoteProviderManageMessage('Provider deleted.', 'success');
  } catch (err) {
    showRemoteProviderManageMessage(`Failed to delete provider: ${err.message}`, 'error');
  }
}

function selectedMetadataProfileProviderId() {
  return currentMetadataProfileProviderId || metadataProfileProviders[0]?.id || '';
}

async function importMetadataProfileUrl() {
  const url = (elements.metadataProfileUrlInput.value || '').trim();
  if (!url) {
    showMetadataProfilesMessage('Profile URL is required.', 'error');
    return;
  }
  try {
    await postAPI('/metadata-profiles/import-url', {
      url,
      providerId: selectedMetadataProfileProviderId(),
    });
    elements.metadataProfileUrlInput.value = '';
    showMetadataProfilesMessage('Metadata profile imported.', 'success');
    await loadMetadataProfiles();
  } catch (err) {
    showMetadataProfilesMessage(`Failed to import profile: ${err.message}`, 'error');
  }
}

async function importKnownMetadataProfile(templateIdOrUrl, conformsTo) {
  try {
    await postAPI('/metadata-profiles/import-known', {
      templateIdOrUrl,
      conformsTo,
      providerId: selectedMetadataProfileProviderId(),
    });
    showMetadataProfilesMessage('Remote metadata profile imported.', 'success');
    await loadMetadataProfiles();
  } catch (err) {
    showMetadataProfilesMessage(`Failed to import remote profile: ${err.message}`, 'error');
  }
}

async function deleteMetadataProfile(id) {
  if (!window.confirm(`Delete metadata profile '${id}' and its files?`)) {
    return;
  }
  try {
    await deleteAPI(`/metadata-profiles/${encodeURIComponent(id)}`);
    showMetadataProfilesMessage('Metadata profile deleted.', 'success');
    await loadMetadataProfiles();
  } catch (err) {
    showMetadataProfilesMessage(`Failed to delete metadata profile: ${err.message}`, 'error');
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

function openMetadataProfiles() {
  loadMetadataProfileProviders();
  loadMetadataProfiles();
  elements.metadataProfilesModal.classList.remove('hidden');
  elements.metadataProfilesMessage.classList.add('hidden');
}

function closeMetadataProfiles() {
  elements.metadataProfilesModal.classList.add('hidden');
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
  if (elements.metadataProfilesModal && !elements.metadataProfilesModal.classList.contains('hidden')) {
    elements.metadataProfilesModal.classList.add('hidden');
  }
  if (elements.remoteProviderSelectModal && !elements.remoteProviderSelectModal.classList.contains('hidden')) {
    elements.remoteProviderSelectModal.classList.add('hidden');
  }
  if (elements.manageRemoteProvidersModal && !elements.manageRemoteProvidersModal.classList.contains('hidden')) {
    elements.manageRemoteProvidersModal.classList.add('hidden');
  }
  if (elements.cedarBrowserModal && !elements.cedarBrowserModal.classList.contains('hidden')) {
    elements.cedarBrowserModal.classList.add('hidden');
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

function escapeAttr(str) {
  return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '_');
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

if (elements.metadataProfilesBtn) {
  elements.metadataProfilesBtn.addEventListener('click', openMetadataProfiles);
}

if (elements.closeSettingsModal) {
  elements.closeSettingsModal.addEventListener('click', closeSettings);
}

if (elements.cancelSettingsBtn) {
  elements.cancelSettingsBtn.addEventListener('click', closeSettings);
}

if (elements.closeMetadataProfilesModal) {
  elements.closeMetadataProfilesModal.addEventListener('click', closeMetadataProfiles);
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

if (elements.metadataProfilesModal) {
  elements.metadataProfilesModal.addEventListener('click', (e) => {
    if (e.target === elements.metadataProfilesModal) {
      closeMetadataProfiles();
    }
  });
}

if (elements.remoteProviderSelectModal) {
  elements.remoteProviderSelectModal.addEventListener('click', (e) => {
    if (e.target === elements.remoteProviderSelectModal) {
      closeRemoteProviderSelect();
    }
  });
}

if (elements.manageRemoteProvidersModal) {
  elements.manageRemoteProvidersModal.addEventListener('click', (e) => {
    if (e.target === elements.manageRemoteProvidersModal) {
      closeManageRemoteProviders();
    }
  });
}

if (elements.cedarBrowserModal) {
  elements.cedarBrowserModal.addEventListener('click', (e) => {
    if (e.target === elements.cedarBrowserModal) {
      closeCedarBrowser();
    }
  });
}

if (elements.addSchemaBtn) {
  elements.addSchemaBtn.addEventListener('click', addOrReplaceSchema);
}

if (elements.reloadSchemaBtn) {
  elements.reloadSchemaBtn.addEventListener('click', loadSchemaRegistry);
}

if (elements.importMetadataProfileBtn) {
  elements.importMetadataProfileBtn.addEventListener('click', importMetadataProfileUrl);
}

if (elements.browseMetadataProfilesBtn) {
  elements.browseMetadataProfilesBtn.addEventListener('click', openRemoteProviderSelect);
}

if (elements.manageMetadataProvidersBtn) {
  elements.manageMetadataProvidersBtn.addEventListener('click', openManageRemoteProviders);
}

if (elements.reloadMetadataProfilesBtn) {
  elements.reloadMetadataProfilesBtn.addEventListener('click', loadMetadataProfiles);
}

if (elements.metadataProfilesPrevPageBtn) {
  elements.metadataProfilesPrevPageBtn.addEventListener('click', () => {
    metadataProfilesState.page = Math.max(1, metadataProfilesState.page - 1);
    renderMetadataProfilesTable();
  });
}

if (elements.metadataProfilesNextPageBtn) {
  elements.metadataProfilesNextPageBtn.addEventListener('click', () => {
    metadataProfilesState.page += 1;
    renderMetadataProfilesTable();
  });
}

if (elements.metadataProfilesPageSizeSelect) {
  elements.metadataProfilesPageSizeSelect.addEventListener('change', (event) => {
    metadataProfilesState.pageSize = Number(event.target.value) || 10;
    metadataProfilesState.page = 1;
    renderMetadataProfilesTable();
  });
}

if (elements.closeRemoteProviderSelectModal) {
  elements.closeRemoteProviderSelectModal.addEventListener('click', closeRemoteProviderSelect);
}

if (elements.cancelRemoteProviderSelectBtn) {
  elements.cancelRemoteProviderSelectBtn.addEventListener('click', closeRemoteProviderSelect);
}

if (elements.openManageProvidersFromSelectBtn) {
  elements.openManageProvidersFromSelectBtn.addEventListener('click', openManageRemoteProviders);
}

if (elements.closeManageRemoteProvidersModal) {
  elements.closeManageRemoteProvidersModal.addEventListener('click', closeManageRemoteProviders);
}

if (elements.closeManageRemoteProvidersBtn) {
  elements.closeManageRemoteProvidersBtn.addEventListener('click', closeManageRemoteProviders);
}

if (elements.addRemoteProviderBtn) {
  elements.addRemoteProviderBtn.addEventListener('click', () => showRemoteProviderForm());
}

if (elements.cancelRemoteProviderFormBtn) {
  elements.cancelRemoteProviderFormBtn.addEventListener('click', hideRemoteProviderForm);
}

if (elements.remoteProviderAccessModeInput) {
  elements.remoteProviderAccessModeInput.addEventListener('change', updateRemoteProviderAccessFields);
}

if (elements.remoteProviderBaseUrlInput) {
  elements.remoteProviderBaseUrlInput.addEventListener('input', () => {
    if (elements.remoteProviderAccessModeInput.value === 'dataverseProxy') {
      elements.remoteProviderProxyBaseUrlInput.value = deriveDataverseProxyBaseUrl(
        elements.remoteProviderDomainInput.value || elements.remoteProviderBaseUrlInput.value,
      );
    }
  });
}

if (elements.remoteProviderDomainInput) {
  elements.remoteProviderDomainInput.addEventListener('input', () => {
    if (elements.remoteProviderAccessModeInput.value === 'dataverseProxy') {
      elements.remoteProviderProxyBaseUrlInput.value = deriveDataverseProxyBaseUrl(
        elements.remoteProviderDomainInput.value || elements.remoteProviderBaseUrlInput.value,
      );
    }
  });
}

if (elements.remoteProviderForm) {
  elements.remoteProviderForm.addEventListener('submit', saveRemoteProvider);
}

if (elements.closeCedarBrowserModal) {
  elements.closeCedarBrowserModal.addEventListener('click', closeCedarBrowser);
}

if (elements.cancelCedarBrowserBtn) {
  elements.cancelCedarBrowserBtn.addEventListener('click', closeCedarBrowser);
}

if (elements.cedarSearchToggleBtn) {
  elements.cedarSearchToggleBtn.addEventListener('click', () => {
    elements.cedarSearchInput.classList.toggle('hidden');
    if (!elements.cedarSearchInput.classList.contains('hidden')) {
      elements.cedarSearchInput.focus();
    } else {
      elements.cedarSearchInput.value = '';
      cedarBrowserState.query = '';
      renderCedarTree();
    }
  });
}

if (elements.cedarSearchInput) {
  elements.cedarSearchInput.addEventListener('input', () => {
    cedarBrowserState.query = elements.cedarSearchInput.value || '';
    renderCedarTree();
  });
}

if (elements.cedarExpandAllBtn) {
  elements.cedarExpandAllBtn.addEventListener('click', () => {
    expandAllCedarNodes();
  });
}

if (elements.cedarCollapseAllBtn) {
  elements.cedarCollapseAllBtn.addEventListener('click', collapseAllCedarNodes);
}

if (elements.cedarLocateSelectedBtn) {
  elements.cedarLocateSelectedBtn.addEventListener('click', locateCedarSelection);
}

if (elements.cedarClearSelectionBtn) {
  elements.cedarClearSelectionBtn.addEventListener('click', clearCedarSelection);
}

if (elements.addCedarTemplateBtn) {
  elements.addCedarTemplateBtn.addEventListener('click', addSelectedCedarTemplate);
}

// Tavily test form event listeners
if (elements.tavilyTestForm) {
  elements.tavilyTestForm.addEventListener('submit', testTavilySearch);
}

if (elements.tavilyClearBtn) {
  elements.tavilyClearBtn.addEventListener('click', clearTavilyTestResult);
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
window.deleteMetadataProfile = deleteMetadataProfile;
window.importKnownMetadataProfile = importKnownMetadataProfile;
window.selectRemoteProvider = selectRemoteProvider;
window.editRemoteProvider = editRemoteProvider;
window.deleteRemoteProvider = deleteRemoteProvider;
window.handleCedarToggle = handleCedarToggle;
window.handleCedarNodeClick = handleCedarNodeClick;

// Tavily search test functions
async function testTavilySearch(e) {
  e.preventDefault();

  const query = elements.tavilyQueryInput.value.trim();
  const maxResults = parseInt(elements.tavilyMaxResults.value, 10);
  const searchDepth = elements.tavilySearchDepth.value;

  if (!query) {
    showTavilyTestResult('Please enter a search query', 'error');
    return;
  }

  // Show loading state
  elements.tavilyTestBtn.disabled = true;
  const originalBtnContent = elements.tavilyTestBtn.innerHTML;
  elements.tavilyTestBtn.innerHTML = '<span class="icon spinning">↻</span> Testing...';

  showTavilyTestResult('Running test search...', 'info');

  try {
    const result = await postAPI('/test/tavily-search', {
      query,
      max_results: maxResults,
      search_depth: searchDepth,
    });

    if (result.success) {
      // Display successful results
      let resultHtml = `
        <div class="settings-message success" style="margin-top: 1rem;">
          <strong>✓ Search successful!</strong><br>
          Query: ${escapeHtml(result.query)}<br>
          Latency: ${result.latencyMs}ms
        </div>
      `;

      if (result.result && result.result.answer) {
        resultHtml += `
          <div style="margin-top: 1rem; padding: 1rem; background: var(--color-bg-tertiary); border-radius: var(--border-radius);">
            <h4 style="margin-bottom: 0.5rem;">Answer:</h4>
            <p style="color: var(--color-text); line-height: 1.5;">${escapeHtml(result.result.answer)}</p>
          </div>
        `;
      }

      if (result.result && result.result.results && Array.isArray(result.result.results)) {
        resultHtml += `
          <div style="margin-top: 1rem;">
            <h4 style="margin-bottom: 0.5rem;">Results (${result.result.results.length}):</h4>
            <div style="max-height: 300px; overflow-y: auto;">
        `;

        result.result.results.forEach((item, index) => {
          resultHtml += `
            <div style="padding: 0.75rem; margin-bottom: 0.5rem; background: var(--color-bg-tertiary); border-radius: var(--border-radius);">
              <div style="display: flex; justify-content: space-between; align-items: start;">
                <strong style="color: var(--color-primary);">${index + 1}. ${escapeHtml(item.title || 'Untitled')}</strong>
                ${item.score ? `<span class="badge badge-neutral">Score: ${item.score.toFixed(2)}</span>` : ''}
              </div>
              ${item.url ? `<div style="margin-top: 0.25rem;"><a href="${escapeHtml(item.url)}" target="_blank" style="color: var(--color-info); font-size: 0.875rem;">${escapeHtml(item.url)}</a></div>` : ''}
              ${item.content ? `<div style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">${escapeHtml(item.content.slice(0, 200))}${item.content.length > 200 ? '...' : ''}</div>` : ''}
            </div>
          `;
        });

        resultHtml += `
            </div>
          </div>
        `;
      }

      elements.tavilyTestResult.innerHTML = resultHtml;
    } else {
      // Display error
      let errorHtml = `
        <div class="settings-message error" style="margin-top: 1rem;">
          <strong>✗ Search failed</strong><br>
      `;

      if (!result.apiKeyPresent) {
        errorHtml += `TAVILY_API_KEY environment variable is not set on the server.<br>`;
        errorHtml += `Please set the environment variable and restart the server.`;
      } else {
        errorHtml += `${escapeHtml(result.error || 'Unknown error')}`;
      }

      errorHtml += `</div>`;
      elements.tavilyTestResult.innerHTML = errorHtml;
    }

    elements.tavilyTestResult.classList.remove('hidden');
  } catch (err) {
    showTavilyTestResult(`Request failed: ${escapeHtml(err.message)}`, 'error');
  } finally {
    elements.tavilyTestBtn.disabled = false;
    elements.tavilyTestBtn.innerHTML = originalBtnContent;
  }
}

function showTavilyTestResult(message, type) {
  const colorClass = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
  const bgColor = type === 'error' ? 'var(--color-danger-bg)' : type === 'success' ? 'var(--color-success-bg)' : 'var(--color-info-bg)';
  const textColor = type === 'error' ? '#ffa198' : type === 'success' ? '#7ee787' : '#79c0ff';

  elements.tavilyTestResult.innerHTML = `
    <div class="settings-message ${colorClass}" style="margin-top: 1rem;">
      ${escapeHtml(message)}
    </div>
  `;
  elements.tavilyTestResult.classList.remove('hidden');
}

function clearTavilyTestResult() {
  elements.tavilyQueryInput.value = '';
  elements.tavilyTestResult.classList.add('hidden');
  elements.tavilyTestResult.innerHTML = '';
}

// Initial load
refreshAll();

// Auto-refresh every 30 seconds
setInterval(refreshAll, 30000);
