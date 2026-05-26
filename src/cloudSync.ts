// Server Sync — persists all data in Railway PostgreSQL via the Express backend

interface CloudData {
  signals:       unknown[];
  trades:        unknown[];
  pairs:         unknown[];
  settings:      unknown;
  equityHistory: unknown[];
  updatedAt?:    string;
}

const API_KEY = import.meta.env?.VITE_API_KEY ?? '';

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['x-api-key'] = API_KEY;
  return h;
}

let _lastSyncAt: number | null = null;
let _syncStatus: 'idle' | 'syncing' | 'ok' | 'error' = 'idle';

export function getSyncInfo() {
  return { status: _syncStatus, lastSyncAt: _lastSyncAt };
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

// ============ SERVER-SIDE MUTATIONS ============
export async function closeTrade(id: string, closePrice: number): Promise<boolean> {
  try {
    const res = await fetch(`/api/trades/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ status: 'manual_close', closeTime: Date.now(), closePrice }),
    });
    return res.ok;
  } catch { return false; }
}

export async function deleteTrade(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/trades/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: apiHeaders(),
    });
    return res.ok;
  } catch { return false; }
}

export async function deleteSignal(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/signals/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: apiHeaders(),
    });
    return res.ok;
  } catch { return false; }
}

export async function updateSettings(settings: unknown): Promise<boolean> {
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: apiHeaders(),
      body: JSON.stringify(settings),
    });
    return res.ok;
  } catch { return false; }
}

export async function updatePairs(pairs: unknown[]): Promise<boolean> {
  try {
    const res = await fetch('/api/pairs', {
      method: 'PUT',
      headers: apiHeaders(),
      body: JSON.stringify(pairs),
    });
    return res.ok;
  } catch { return false; }
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
