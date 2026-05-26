import { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  CheckCircle,
  XCircle,
  Loader2,
  Wifi,
  Database,
  Zap,
  Server,
  ServerOff,
  Download,
  Upload,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Settings as SettingsType } from '../types';
import { testBinanceConnection } from '../api/binance';
import {
  uploadToCloud,
  downloadFromCloud,
  applyCloudData,
  testServerConnection,
  deleteServerData,
  getSyncInfo,
} from '../cloudSync';

interface SettingsProps {
  settings: SettingsType;
  onSave: (settings: SettingsType) => void;
  onCloudRestore?: () => void;
}

export default function SettingsPage({ settings, onSave, onCloudRestore }: SettingsProps) {
  const [riskPerTrade, setRiskPerTrade]     = useState(settings.riskPerTrade);
  const [initialBalance, setInitialBalance] = useState(settings.initialBalance);
  const [leverage, setLeverage]             = useState(settings.leverage ?? 10);
  const [testing, setTesting]               = useState(false);
  const [testResult, setTestResult]         = useState<boolean | null>(null);
  const [saved, setSaved]                   = useState(false);

  // Server sync state
  const [cloudEnabled, setCloudEnabled]       = useState(settings.cloudSyncEnabled ?? false);
  const [serverTesting, setServerTesting]     = useState(false);
  const [serverTestResult, setServerTestResult] = useState<boolean | null>(null);
  const [uploading, setUploading]             = useState(false);
  const [downloading, setDownloading]         = useState(false);
  const [syncMessage, setSyncMessage]         = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [syncInfo, setSyncInfo]               = useState(getSyncInfo());

  // Refresh sync info every 5 seconds
  useEffect(() => {
    const t = setInterval(() => setSyncInfo(getSyncInfo()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setCloudEnabled(settings.cloudSyncEnabled ?? false);
  }, [settings]);

  const handleSave = () => {
    onSave({ ...settings, riskPerTrade, initialBalance, leverage, cloudSyncEnabled: cloudEnabled });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTestBinance = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testBinanceConnection());
    } catch {
      setTestResult(false);
    }
    setTesting(false);
  };

  const handleTestServer = async () => {
    setServerTesting(true);
    setServerTestResult(null);
    setSyncMessage(null);
    try {
      const ok = await testServerConnection();
      setServerTestResult(ok);
      setSyncMessage(ok
        ? { text: 'Server connected!', type: 'success' }
        : { text: 'Server unreachable — check Railway deployment', type: 'error' }
      );
    } catch {
      setServerTestResult(false);
      setSyncMessage({ text: 'Connection error', type: 'error' });
    }
    setServerTesting(false);
  };

  const handleUpload = async () => {
    setUploading(true);
    setSyncMessage(null);
    const ok = await uploadToCloud();
    setSyncMessage(ok
      ? { text: 'Data uploaded to server!', type: 'success' }
      : { text: 'Upload failed — check server', type: 'error' }
    );
    setSyncInfo(getSyncInfo());
    setUploading(false);
  };

  const handleDownload = async () => {
    setDownloading(true);
    setSyncMessage(null);
    const data = await downloadFromCloud();
    if (data && (Array.isArray(data.signals) || Array.isArray(data.trades))) {
      applyCloudData(data);
      setSyncMessage({
        text: `Data restored! (${data.updatedAt ? new Date(data.updatedAt).toLocaleString('el-GR') : 'unknown time'})`,
        type: 'success',
      });
      setSyncInfo(getSyncInfo());
      onCloudRestore?.();
    } else {
      setSyncMessage({ text: 'No server data found', type: 'error' });
    }
    setDownloading(false);
  };

  const handleToggleSync = () => {
    const newEnabled = !cloudEnabled;
    setCloudEnabled(newEnabled);
    onSave({ ...settings, riskPerTrade, initialBalance, cloudSyncEnabled: newEnabled });
  };

  const formatSyncTime = (ts: number | null) => {
    if (!ts) return 'Never';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return new Date(ts).toLocaleTimeString('el-GR');
  };

  const syncDot = () => {
    const { status } = syncInfo;
    if (status === 'syncing') return 'bg-amber-400 animate-pulse';
    if (status === 'ok')      return 'bg-emerald-400';
    if (status === 'error')   return 'bg-red-500';
    return 'bg-gray-600';
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <SettingsIcon className="w-6 h-6 text-amber-400" />
        <h2 className="text-xl font-bold">Settings</h2>
      </div>

      {/* ============ SERVER SYNC ============ */}
      <div className="bg-gray-900 border border-cyan-500/30 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Server className="w-4 h-4" />
          Server Sync — Railway PostgreSQL
        </h3>

        {/* Status row */}
        <div className="flex items-center gap-3 mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${syncDot()}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium capitalize">
              {syncInfo.status === 'idle' ? 'Idle' :
               syncInfo.status === 'syncing' ? 'Syncing…' :
               syncInfo.status === 'ok' ? 'Synced' : 'Sync error'}
            </p>
            <p className="text-xs text-gray-400">
              Last sync: {formatSyncTime(syncInfo.lastSyncAt)}
            </p>
          </div>
          <button
            onClick={handleTestServer}
            disabled={serverTesting}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm flex items-center gap-1.5 transition-colors disabled:opacity-40"
          >
            {serverTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
            Test
          </button>
          {serverTestResult !== null && (
            <div className={serverTestResult ? 'text-emerald-400' : 'text-red-400'}>
              {serverTestResult ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            </div>
          )}
        </div>

        {/* Auto sync toggle */}
        <div className="mb-4 flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3">
            {cloudEnabled ? (
              <Server className="w-5 h-5 text-cyan-400" />
            ) : (
              <ServerOff className="w-5 h-5 text-gray-500" />
            )}
            <div>
              <p className="text-sm font-medium text-white">Auto Server Sync</p>
              <p className="text-xs text-gray-400">
                {cloudEnabled
                  ? 'Saves to Railway database every 5s'
                  : 'Disabled — data stays local only'}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggleSync}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
              cloudEnabled ? 'bg-cyan-500' : 'bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                cloudEnabled ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Manual sync buttons */}
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="px-4 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 hover:bg-emerald-600/30 text-emerald-400 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Upload to Server
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="px-4 py-2 rounded-lg bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/30 text-blue-400 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download from Server
          </button>
        </div>

        {syncMessage && (
          <div className={`mt-2 p-3 rounded-lg text-sm flex items-center gap-2 ${
            syncMessage.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}>
            {syncMessage.type === 'success'
              ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
              : <XCircle className="w-4 h-4 flex-shrink-0" />}
            {syncMessage.text}
          </div>
        )}

        <div className="mt-4 p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
          <p className="text-xs text-cyan-200">
            <RefreshCw className="w-3 h-3 inline mr-1" />
            Τα δεδομένα αποθηκεύονται στο Railway PostgreSQL. Λειτουργεί <strong>24/7</strong> και είναι
            προσβάσιμα από οποιαδήποτε συσκευή. Δεν χρειάζεται καμία ρύθμιση — απλώς ανοίξε το URL.
          </p>
        </div>
      </div>

      {/* ============ BINANCE DATA SOURCE ============ */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Database className="w-4 h-4" />
          Data Source
        </h3>

        <div className="flex items-center gap-4 mb-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-white">Binance Public API</h4>
            <p className="text-xs text-gray-400 mt-0.5">
              Δωρεάν market data — δεν χρειάζεται API key!
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Live τιμές, 24h stats, candlestick data • Rate limit: 1200 req/min
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">Free</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTestBinance}
            disabled={testing}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            Test Connection
          </button>

          {testResult !== null && (
            <div className={`flex items-center gap-1 text-sm ${testResult ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult
                ? <><CheckCircle className="w-4 h-4" /> Binance Connected!</>
                : <><XCircle className="w-4 h-4" /> Connection failed</>}
            </div>
          )}
        </div>
      </div>

      {/* ============ TRADING SETTINGS ============ */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          ⚙️ Trading Settings
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Risk Per Trade (%)
            </label>
            <input
              type="number"
              value={riskPerTrade}
              onChange={(e) => setRiskPerTrade(parseFloat(e.target.value) || 0)}
              min={0.1}
              max={10}
              step={0.1}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-amber-500 transition-colors"
            />
            <p className="text-xs text-gray-500 mt-1">
              Ποσοστό balance που ρισκάρεται σε κάθε trade (προτεινόμενο: 1-2%)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Initial Balance ($)
            </label>
            <input
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(parseFloat(e.target.value) || 0)}
              min={0}
              step={100}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-amber-500 transition-colors"
            />
            <p className="text-xs text-gray-500 mt-1">
              Αρχικό balance για υπολογισμό P&L (virtual portfolio)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Leverage: <span className="text-amber-400 font-bold">{leverage}x</span>
            </label>
            <input
              type="range"
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              min={1}
              max={125}
              step={1}
              className="w-full accent-amber-400"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1x (spot-like)</span>
              <span>10x</span>
              <span>50x</span>
              <span>125x (max)</span>
            </div>
            <div className="mt-2 p-3 rounded-lg border text-xs space-y-1 bg-amber-500/5 border-amber-500/20 text-amber-200">
              <p>Με {leverage}x leverage:</p>
              <p>• Max notional: <span className="font-bold">${(initialBalance * leverage).toLocaleString()}</span></p>
              <p>• Liquidation αν η τιμή κινηθεί <span className="font-bold text-red-400">{(100 / leverage).toFixed(1)}%</span> εναντίον σου</p>
              <p>• Margin ανά trade ≈ <span className="font-bold">${(initialBalance * (riskPerTrade / 100) * 2.5).toFixed(0)}</span> (εκτίμηση)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-lg text-sm transition-colors"
        >
          Save Settings
        </button>
        {saved && (
          <span className="text-sm text-emerald-400 flex items-center gap-1">
            <CheckCircle className="w-4 h-4" /> Settings saved!
          </span>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-gray-900 border border-blue-500/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-3">
          ℹ️ Πώς Λειτουργεί
        </h3>
        <div className="space-y-2 text-xs text-gray-400">
          <p>
            <span className="text-white font-medium">📡 Data:</span> Η Binance
            στέλνει live τιμές κάθε 15 δευτερόλεπτα + candlestick data (1H) κάθε 1 λεπτό.
          </p>
          <p>
            <span className="text-white font-medium">🧠 ICT Algorithm:</span> Σαρώνει
            για Liquidity Sweep → MSS → FVG patterns σε κάθε ζευγάρι.
          </p>
          <p>
            <span className="text-white font-medium">📊 Trades:</span> Όταν
            ενεργοποιήσεις Auto Trading, τα σήματα γίνονται trades αυτόματα.
          </p>
          <p>
            <span className="text-white font-medium">🖥️ Server Sync:</span> Με
            Railway + PostgreSQL τα δεδομένα αποθηκεύονται στο cloud — τρέχει 24/7!
          </p>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-gray-900 border border-red-500/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Danger Zone
        </h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => {
              if (confirm('Σίγουρα θέλεις να διαγράψεις ΟΛΑ τα τοπικά δεδομένα; (Signals, Trades, Pairs, Stats)')) {
                localStorage.removeItem('ict_signals');
                localStorage.removeItem('ict_trades');
                localStorage.removeItem('ict_pairs');
                localStorage.removeItem('ict_equity_history');
                onCloudRestore?.();
              }
            }}
            className="px-4 py-2 rounded-lg bg-red-600/20 border border-red-500/30 hover:bg-red-600/30 text-red-400 text-sm font-medium transition-colors"
          >
            Reset Local Data
          </button>
          <button
            onClick={async () => {
              if (confirm('Σίγουρα θέλεις να διαγράψεις ΟΛΑ τα δεδομένα του SERVER; Αυτό δεν αναιρείται!')) {
                const ok = await deleteServerData();
                setSyncMessage(ok
                  ? { text: 'Server data cleared', type: 'success' }
                  : { text: 'Failed to clear server data', type: 'error' }
                );
              }
            }}
            className="px-4 py-2 rounded-lg bg-red-900/30 border border-red-700/30 hover:bg-red-900/50 text-red-500 text-sm font-medium transition-colors"
          >
            Reset Server Data
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          "Reset Local" σβήνει τοπικά δεδομένα — τα server data παραμένουν (μπορείς να τα κατεβάσεις).
          "Reset Server" σβήνει τη βάση δεδομένων στο Railway.
        </p>
      </div>
    </div>
  );
}
