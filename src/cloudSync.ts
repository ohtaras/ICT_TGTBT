// Server Sync — persists all data in Railway PostgreSQL via the Express backend

interface CloudData {
  signals:       unknown[];
  trades:        unknown[];
  pairs:         unknown[];
  settings:      unknown;
  equityHistory: unknown[];
  updatedAt?:    string;
}

const API_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_KEY) || '';

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['x-api-key'] = API_KEY;
  return h;
}

let _lastSyncAt: number | null = null;
let _syncStatus: 'idle' | 'syncing' | 'ok' | 'error' = 'idle';
let _syncTimeout: ReturnType<typeof setTimeout> | null = null;
let _isSyncing = false;

export function getSyncInfo() {
  return { status: _syncStatus, lastSyncAt: _lastSyncAt };
}

// ============ UPLOAD ============
export async function uploadToCloud(): Promise<boolean> {
  try {
    _syncStatus = 'syncing';
    const payload = {
      signals:       JSON.parse(localStorage.getItem('ict_signals')       || '[]'),
      trades:        JSON.parse(localStorage.getItem('ict_trades')        || '[]'),
      pairs:         JSON.parse(localStorage.getItem('ict_pairs')         || '[]'),
      settings:      JSON.parse(localStorage.getItem('ict_settings')      || '{}'),
      equityHistory: JSON.parse(localStorage.getItem('ict_equity_history')|| '[]'),
    };
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _lastSyncAt = Date.now();
    _syncStatus = 'ok';
    return true;
  } catch (err) {
    console.error('[sync] upload error:', err);
    _syncStatus = 'error';
    return false;
  }
}

// ============ DOWNLOAD ============
export async function downloadFromCloud(): Promise<CloudData | null> {
  try {
    _syncStatus = 'syncing';
    const res = await fetch('/api/data', { headers: apiHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: CloudData = await res.json();
    _syncStatus = 'ok';
    return data;
  } catch (err) {
    console.error('[sync] download error:', err);
    _syncStatus = 'error';
    return null;
  }
}

// ============ APPLY TO LOCALSTORAGE ============
export function applyCloudData(data: CloudData) {
  if (Array.isArray(data.signals))
    localStorage.setItem('ict_signals', JSON.stringify(data.signals));
  if (Array.isArray(data.trades))
    localStorage.setItem('ict_trades', JSON.stringify(data.trades));
  if (Array.isArray(data.pairs))
    localStorage.setItem('ict_pairs', JSON.stringify(data.pairs));
  if (data.settings)
    localStorage.setItem('ict_settings', JSON.stringify(data.settings));
  if (Array.isArray(data.equityHistory))
    localStorage.setItem('ict_equity_history', JSON.stringify(data.equityHistory));
  _lastSyncAt = Date.now();
  _syncStatus = 'ok';
}

// ============ TEST CONNECTION ============
export async function testServerConnection(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { headers: apiHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}

// ============ DELETE SERVER DATA ============
export async function deleteServerData(): Promise<boolean> {
  try {
    const res = await fetch('/api/data', { method: 'DELETE', headers: apiHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}

// ============ DEBOUNCED SYNC ============
// Signature kept compatible with store.ts call sites
export function schedulCloudSync(_apiKey?: string, _binId?: string) {
  if (_isSyncing) return;
  if (_syncTimeout) clearTimeout(_syncTimeout);

  _syncTimeout = setTimeout(async () => {
    _isSyncing = true;
    try {
      await uploadToCloud();
    } catch (err) {
      console.error('[sync] scheduled sync error:', err);
    }
    _isSyncing = false;
    _syncTimeout = null;
  }, 5000);
}

// Kept for store.ts compatibility
export function getCloudConfig(): { apiKey: string; binId: string } | null {
  const settings = JSON.parse(localStorage.getItem('ict_settings') || '{}');
  return settings.cloudSyncEnabled ? { apiKey: '', binId: '' } : null;
}
