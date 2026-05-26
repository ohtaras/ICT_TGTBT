import { useState, useEffect, useCallback, useRef } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import TradesPage from './pages/Trades';
import Pairs from './pages/Pairs';
import Analytics from './pages/Analytics';
import SettingsPage from './pages/Settings';
import {
  getSignals, saveSignals,
  getTrades, saveTrades,
  getPairs, savePairs,
  addPair as storeAddPair,
  removePair as storeRemovePair,
  togglePair as storeTogglePair,
  getSettings, saveSettings,
  getEquityHistory,
  getPortfolioStats,
} from './store';
import {
  downloadFromCloud,
  applyCloudData,
  closeTrade,
  deleteTrade,
  deleteSignal as deleteSignalFromServer,
  updateSettings as updateServerSettings,
  updatePairs as updateServerPairs,
} from './cloudSync';
import { fetchAllPrices } from './api/binance';
import type { Signal, Trade, TradingPair, Settings, PortfolioStats } from './types';

const SERVER_POLL_INTERVAL = 5_000; // 5 seconds

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [signals, setSignals]           = useState<Signal[]>(getSignals);
  const [trades, setTrades]             = useState<Trade[]>(getTrades);
  const [pairs, setPairs]               = useState<TradingPair[]>(getPairs);
  const [settings, setSettings]         = useState<Settings>(getSettings);
  const [stats, setStats]               = useState<PortfolioStats>(getPortfolioStats);
  const [equityHistory, setEquityHistory] = useState(getEquityHistory);

  // Ref so the price-fetch interval always sees the latest pairs without re-creating
  const pairsRef = useRef<TradingPair[]>([]);
  useEffect(() => { pairsRef.current = pairs; }, [pairs]);

  const refreshState = useCallback(() => {
    setSignals(getSignals());
    setTrades(getTrades());
    setPairs(getPairs());
    setSettings(getSettings());
    setEquityHistory(getEquityHistory());
    setStats(getPortfolioStats());
  }, []);

  // ============ SERVER SYNC ============
  // Single source of truth: server. Browser only reads + displays.
  const syncFromServer = useCallback(async () => {
    const data = await downloadFromCloud();
    if (data) {
      applyCloudData(data);
      refreshState();
    }
  }, [refreshState]);

  useEffect(() => {
    syncFromServer();
    const timer = setInterval(syncFromServer, SERVER_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [syncFromServer]);

  // Live price fetching directly from Binance (browser → Binance, bypasses server)
  // Updates global pairs state so Dashboard + Pairs page both show live prices
  useEffect(() => {
    const fetchLive = async () => {
      const current = pairsRef.current.filter(p => p.enabled);
      if (current.length === 0) return;
      const map = await fetchAllPrices(current);
      if (map.size === 0) return;
      setPairs(prev => {
        const updated = prev.map(p => {
          const live = map.get(p.symbol);
          return live && live.price > 0
            ? { ...p, currentPrice: live.price, change24h: live.change24h, lastUpdate: Date.now() }
            : p;
        });
        savePairs(updated); // persist so refreshState doesn't reset prices to 0
        return updated;
      });
    };
    fetchLive();
    const t = setInterval(fetchLive, 5_000);
    return () => clearInterval(t);
  }, []); // runs once; uses pairsRef for latest pairs

  useEffect(() => {
    setStats(getPortfolioStats());
  }, [trades]);

  // ============ HANDLERS ============
  const handleToggleAutoTrading = async () => {
    const updated = { ...settings, autoTrading: !settings.autoTrading };
    setSettings(updated);
    saveSettings(updated);
    await updateServerSettings(updated);
  };

  const handleAddPair = async (symbol: string) => {
    storeAddPair(symbol);
    const updated = getPairs();
    setPairs(updated);
    await updateServerPairs(updated);
  };

  const handleRemovePair = async (symbol: string) => {
    storeRemovePair(symbol);
    const updated = getPairs();
    setPairs(updated);
    await updateServerPairs(updated);
  };

  const handleTogglePair = async (symbol: string) => {
    storeTogglePair(symbol);
    const updated = getPairs();
    setPairs(updated);
    await updateServerPairs(updated);
  };

  const handleSaveSettings = async (newSettings: Settings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    await updateServerSettings(newSettings);
  };

  const handleCloseTrade = async (id: string) => {
    const trade = trades.find(t => t.id === id);
    if (!trade) return;
    await closeTrade(id, trade.currentPrice);
    await syncFromServer();
  };

  const handleDeleteSignal = async (id: string) => {
    await deleteSignalFromServer(id);
    // Optimistic local update for immediate feedback
    const updated = signals.filter(s => s.id !== id);
    setSignals(updated);
    saveSignals(updated);
  };

  const handleDeleteTrade = async (id: string) => {
    await deleteTrade(id);
    // Optimistic local update for immediate feedback
    const updated = trades.filter(t => t.id !== id);
    setTrades(updated);
    saveTrades(updated);
    setStats(getPortfolioStats());
  };

  // ============ RENDER ============
  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return (
          <Dashboard
            stats={stats}
            signals={signals}
            trades={trades}
            pairs={pairs}
            autoTrading={settings.autoTrading}
            onToggleAutoTrading={handleToggleAutoTrading}
          />
        );
      case 'signals':
        return <Signals signals={signals} settings={settings} onDeleteSignal={handleDeleteSignal} />;
      case 'trades':
        return <TradesPage trades={trades} settings={settings} onCloseTrade={handleCloseTrade} onDeleteTrade={handleDeleteTrade} />;
      case 'pairs':
        return (
          <Pairs
            pairs={pairs}
            onAdd={handleAddPair}
            onRemove={handleRemovePair}
            onToggle={handleTogglePair}
          />
        );
      case 'analytics':
        return (
          <Analytics
            stats={stats}
            trades={trades}
            equityHistory={equityHistory}
            initialBalance={settings.initialBalance}
          />
        );
      case 'settings':
        return (
          <SettingsPage
            settings={settings}
            onSave={handleSaveSettings}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Layout
      currentPage={page}
      onNavigate={setPage}
      botActive={settings.autoTrading}
    >
      {renderPage()}
    </Layout>
  );
}
