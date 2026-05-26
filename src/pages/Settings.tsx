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
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Settings as SettingsType } from '../types';
import { testBinanceConnection } from '../api/binance';
import {
  testServerConnection,
  deleteServerData,
  getSyncInfo,
} from '../cloudSync';

interface SettingsProps {
  settings: SettingsType;
  onSave: (settings: SettingsType) => void;
}

export default function SettingsPage({ settings, onSave }: SettingsProps) {
  const [riskPerTrade, setRiskPerTrade]     = useState(settings.riskPerTrade);
  const [initialBalance, setInitialBalance] = useState(settings.initialBalance);
  const [leverage, setLeverage]             = useState(settings.leverage ?? 10);
  const [feeRate, setFeeRate]               = useState(settings.feeRate ?? 0.04);
  const [fundingRate, setFundingRate]       = useState(settings.fundingRate ?? 0.01);
  const [testing, setTesting]               = useState(false);
  const [testResult, setTestResult]         = useState<boolean | null>(null);
  const [saved, setSaved]                   = useState(false);
  const [serverTesting, setServerTesting]   = useState(false);
  const [serverTestResult, setServerTestResult] = useState<boolean | null>(null);
  const [resetMessage, setResetMessage]     = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [syncInfo, setSyncInfo]             = useState(getSyncInfo());

  useEffect(() => {
    const t = setInterval(() => setSyncInfo(getSyncInfo()), 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setRiskPerTrade(settings.riskPerTrade);
    setInitialBalance(settings.initialBalance);
    setLeverage(settings.leverage ?? 10);
    setFeeRate(settings.feeRate ?? 0.04);
    setFundingRate(settings.fundingRate ?? 0.01);
  }, [settings]);

  const handleSave = () => {
    onSave({ ...settings, riskPerTrade, initialBalance, leverage, feeRate, fundingRate });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handleTestBinance = async () => {
    setTesting(true);
    setTestResult(null);
    try { setTestResult(await testBinanceConnection()); }
    catch { setTestResult(false); }
    setTesting(false);
  };

  const handleTestServer = async () => {
    setServerTesting(true);
    setServerTestResult(null);
    try { setServerTestResult(await testServerConnection()); }
    catch { setServerTestResult(false); }
    setServerTesting(false);
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

      {/* ============ SERVER STATUS ============ */}
      <div className="bg-gray-900 border border-cyan-500/30 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Server className="w-4 h-4" />
          Server — Railway PostgreSQL
        </h3>

        <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${syncDot()}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium">
              {syncInfo.status === 'syncing' ? 'Syncing…' :
               syncInfo.status === 'ok'      ? 'Connected' :
               syncInfo.status === 'error'   ? 'Sync error' : 'Idle'}
            </p>
            <p className="text-xs text-gray-400">
              Last sync: {formatSyncTime(syncInfo.lastSyncAt)} · auto-refresh every 15s
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
            serverTestResult
              ? <CheckCircle className="w-4 h-4 text-emerald-400" />
              : <XCircle className="w-4 h-4 text-red-400" />
          )}
        </div>

        <div className="mt-3 p-3 bg-cyan-500/10 border border-cyan-500/20 rounded-lg">
          <p className="text-xs text-cyan-200">
            <RefreshCw className="w-3 h-3 inline mr-1" />
            Ο server τρέχει <strong>24/7</strong> — σαρώνει signals και διαχειρίζεται trades ακόμα και όταν ο browser είναι κλειστός.
            Οποιοσδήποτε browser βλέπει τα ίδια data.
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
            <p className="text-xs text-gray-400 mt-0.5">Δωρεάν market data — δεν χρειάζεται API key!</p>
            <p className="text-xs text-gray-500 mt-1">Live τιμές + candlestick data (1H) · Rate limit: 1200 req/min</p>
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
              min={0.1} max={10} step={0.1}
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
              min={0} step={100}
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
              min={1} max={125} step={1}
              className="w-full accent-amber-400"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1x</span><span>10x</span><span>50x</span><span>125x</span>
            </div>
            <div className="mt-2 p-3 rounded-lg border text-xs space-y-1 bg-amber-500/5 border-amber-500/20 text-amber-200">
              <p>Με {leverage}x leverage:</p>
              <p>• Max notional: <span className="font-bold">${(initialBalance * leverage).toLocaleString()}</span></p>
              <p>• Liquidation αν η τιμή κινηθεί <span className="font-bold text-red-400">{(100 / leverage).toFixed(1)}%</span> εναντίον σου</p>
            </div>
          </div>
        </div>
      </div>

      {/* ============ TRADING COSTS ============ */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          💸 Trading Costs (Futures Simulation)
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Taker Fee Rate: <span className="text-amber-400 font-bold">{feeRate}%</span>
              <span className="text-gray-500 ml-2 text-xs">(Binance default: 0.04%)</span>
            </label>
            <input
              type="number"
              value={feeRate}
              onChange={(e) => setFeeRate(parseFloat(e.target.value) || 0)}
              min={0} max={1} step={0.01}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-amber-500 transition-colors"
            />
            <p className="text-xs text-gray-500 mt-1">
              Χρεώνεται στο άνοιγμα ΚΑΙ κλείσιμο κάθε trade.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Funding Rate (ανά 8ώρο): <span className="text-amber-400 font-bold">{fundingRate}%</span>
              <span className="text-gray-500 ml-2 text-xs">(Binance default: ~0.01%)</span>
            </label>
            <input
              type="number"
              value={fundingRate}
              onChange={(e) => setFundingRate(parseFloat(e.target.value) || 0)}
              min={0} max={1} step={0.001}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-amber-500 transition-colors"
            />
            <p className="text-xs text-gray-500 mt-1">
              LONG πληρώνει κάθε 8 ώρες · SHORT λαμβάνει · 0 = απενεργοποιημένο
            </p>
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
            <CheckCircle className="w-4 h-4" /> Saved!
          </span>
        )}
      </div>

      {/* ============ DANGER ZONE ============ */}
      <div className="bg-gray-900 border border-red-500/20 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Danger Zone
        </h3>
        <button
          onClick={async () => {
            if (confirm('Σίγουρα θέλεις ΠΛΗΡΗ RESET; Θα σβηστούν ΟΛΑ τα data (signals, trades, ιστορικό) και η σελίδα θα ξαναφορτωθεί.')) {
              const ok = await deleteServerData();
              if (ok) {
                localStorage.clear();
                window.location.reload();
              } else {
                setResetMessage({ text: 'Failed to clear server data', type: 'error' });
              }
            }
          }}
          className="px-4 py-2 rounded-lg bg-red-900/30 border border-red-700/30 hover:bg-red-900/50 text-red-400 text-sm font-medium transition-colors"
        >
          Reset All Data
        </button>
        {resetMessage && (
          <p className={`text-xs mt-2 ${resetMessage.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
            {resetMessage.text}
          </p>
        )}
        <p className="text-xs text-gray-500 mt-2">
          Σβήνει ΟΛΑ τα signals, trades και ιστορικό από τον server. Οι ρυθμίσεις διατηρούνται.
        </p>
      </div>
    </div>
  );
}
