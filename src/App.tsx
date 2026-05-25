import { useState, useEffect, useCallback, useRef } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import TradesPage from './pages/Trades';
import Pairs from './pages/Pairs';
import Analytics from './pages/Analytics';
import SettingsPage from './pages/Settings';
import {
  getSignals,
  saveSignals,
  addSignal,
  getTrades,
  saveTrades,
  addTrade,
  updateTrade,
  getPairs,
  savePairs,
  addPair as storeAddPair,
  removePair as storeRemovePair,
  togglePair as storeTogglePair,
  getSettings,
  saveSettings,
  getEquityHistory,
  addEquityPoint,
  getPortfolioStats,
  generateId,
} from './store';
import { fetchAllPrices, fetchCandles } from './api/binance';
import { ictCoreEngine, checkSignalTrigger, checkTradeExit } from './ictEngine';
import { downloadFromCloud, applyCloudData } from './cloudSync';
import type { Signal, Trade, TradingPair, Settings, PortfolioStats } from './types';

const PRICE_INTERVAL = 15000; // 15 seconds
const SCAN_INTERVAL = 60000; // 1 minute

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [signals, setSignals] = useState<Signal[]>(getSignals);
  const [trades, setTrades] = useState<Trade[]>(getTrades);
  const [pairs, setPairs] = useState<TradingPair[]>(getPairs);
  const [settings, setSettings] = useState<Settings>(getSettings);
  const [stats, setStats] = useState<PortfolioStats>(getPortfolioStats);
  const [equityHistory, setEquityHistory] = useState(getEquityHistory);

  // ============ SERVER SYNC ON STARTUP ============
  useEffect(() => {
    downloadFromCloud().then((data) => {
      if (data && (Array.isArray(data.signals) || Array.isArray(data.trades))) {
        applyCloudData(data);
        setSignals(getSignals());
        setTrades(getTrades());
        setPairs(getPairs());
        setSettings(getSettings());
        setEquityHistory(getEquityHistory());
        setStats(getPortfolioStats());
      }
    });
  }, []);

  const pairsRef = useRef(pairs);
  const settingsRef = useRef(settings);
  const signalsRef = useRef(signals);
  const tradesRef = useRef(trades);

  useEffect(() => { pairsRef.current = pairs; }, [pairs]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { signalsRef.current = signals; }, [signals]);
  useEffect(() => { tradesRef.current = trades; }, [trades]);

  // Recalculate stats whenever trades change
  useEffect(() => {
    setStats(getPortfolioStats());
  }, [trades]);

  // ============ PRICE FETCHING LOOP ============
  const fetchPrices = useCallback(async () => {
    const currentPairs = pairsRef.current;
    const enabledPairs = currentPairs.filter((p) => p.enabled);
    if (enabledPairs.length === 0) return;

    try {
      const priceMap = await fetchAllPrices(enabledPairs);

      const updated = currentPairs.map((p) => {
        const data = priceMap.get(p.symbol);
        if (data && data.price > 0) {
          return {
            ...p,
            currentPrice: data.price,
            change24h: data.change24h,
            lastUpdate: Date.now(),
          };
        }
        return p;
      });

      setPairs(updated);
      savePairs(updated);

      // Update open trade prices and check SL/TP
      const currentTrades = tradesRef.current;
      let tradesChanged = false;
      const updatedTrades = currentTrades.map((trade) => {
        if (trade.status !== 'open') return trade;

        const pairData = priceMap.get(trade.pair);
        if (!pairData || pairData.price <= 0) return trade;

        const currentPrice = pairData.price;
        const pnl =
          trade.type === 'LONG'
            ? (currentPrice - trade.entryPrice) * trade.size
            : (trade.entryPrice - currentPrice) * trade.size;
        const pnlPercent =
          trade.type === 'LONG'
            ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
            : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

        const exitResult = checkTradeExit(trade.type, currentPrice, trade.sl, trade.tp);

        if (exitResult) {
          tradesChanged = true;
          const closePnl =
            trade.type === 'LONG'
              ? ((exitResult === 'won' ? trade.tp : trade.sl) - trade.entryPrice) * trade.size
              : (trade.entryPrice - (exitResult === 'won' ? trade.tp : trade.sl)) * trade.size;

          // Add equity point
          const currentStats = getPortfolioStats();
          addEquityPoint(currentStats.balance + closePnl);

          return {
            ...trade,
            currentPrice,
            pnl: parseFloat(closePnl.toFixed(4)),
            pnlPercent: parseFloat(
              (
                (closePnl / (trade.entryPrice * trade.size)) *
                100
              ).toFixed(2)
            ),
            status: exitResult as Trade['status'],
            closeTime: Date.now(),
            closePrice: exitResult === 'won' ? trade.tp : trade.sl,
          };
        }

        return {
          ...trade,
          currentPrice,
          pnl: parseFloat(pnl.toFixed(4)),
          pnlPercent: parseFloat(pnlPercent.toFixed(2)),
        };
      });

      if (tradesChanged || updatedTrades.some((t, i) => t.currentPrice !== currentTrades[i]?.currentPrice)) {
        setTrades(updatedTrades);
        saveTrades(updatedTrades);
        if (tradesChanged) {
          setEquityHistory(getEquityHistory());
        }
      }

      // Check if pending signals should be triggered (Auto Trading)
      if (settingsRef.current.autoTrading) {
        const currentSignals = signalsRef.current;
        const currentTrades = tradesRef.current;
        let signalsChanged = false;

        const updatedSignals = currentSignals.map((sig) => {
          if (sig.status !== 'pending') return sig;

          const pairData = priceMap.get(sig.pair);
          if (!pairData || pairData.price <= 0) return sig;

          const triggered = checkSignalTrigger(sig, pairData.price);
          if (triggered) {
            signalsChanged = true;

            // ✅ CHECK: Υπάρχει ήδη ανοιχτό trade για αυτό το ζευγάρι;
            const existingOpenTrade = currentTrades.find(
              (t) => t.pair === sig.pair && t.status === 'open'
            );

            if (existingOpenTrade) {
              // ❌ REJECT: Υπάρχει ήδη ανοιχτή θέση
              console.log(`🚫 Signal REJECTED for ${sig.pair}: Already has open trade (ID: ${existingOpenTrade.id})`);
              return {
                ...sig,
                status: 'rejected' as const,
                rejectedAt: Date.now(),
                rejectionReason: `Υπάρχει ήδη ανοιχτή θέση (${existingOpenTrade.type} @ ${existingOpenTrade.entryPrice.toFixed(4)})`,
              };
            }

            // Create trade entry in database
            const balance = getPortfolioStats().balance;
            const riskAmount = balance * (settingsRef.current.riskPerTrade / 100);
            const riskPerUnit = Math.abs(sig.entry - sig.sl);
            const size = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;

            if (size > 0) {
              const newTrade: Trade = {
                id: generateId(),
                signalId: sig.id,
                pair: sig.pair,
                type: sig.type === 'BULLISH' ? 'LONG' : 'SHORT',
                entryPrice: sig.entry,
                currentPrice: pairData.price,
                sl: sig.sl,
                tp: sig.tp,
                size: parseFloat(size.toFixed(6)),
                pnl: 0,
                pnlPercent: 0,
                status: 'open',
                openTime: Date.now(),
              };

              addTrade(newTrade);
              setTrades(getTrades());
              console.log(`✅ Trade OPENED for ${sig.pair}: ${newTrade.type} @ ${newTrade.entryPrice}`);
            }

            return { ...sig, status: 'triggered' as const, triggeredAt: Date.now() };
          }

          // Expire signals older than 24 hours
          if (Date.now() - sig.timestamp > 24 * 60 * 60 * 1000) {
            signalsChanged = true;
            return { ...sig, status: 'expired' as const, expiredAt: Date.now() };
          }

          return sig;
        });

        if (signalsChanged) {
          setSignals(updatedSignals);
          saveSignals(updatedSignals);
        }
      }
    } catch (err) {
      console.error('Price fetch error:', err);
    }
  }, []);

  // ============ ICT SCAN LOOP ============
  const runICTScan = useCallback(async () => {
    const currentPairs = pairsRef.current.filter((p) => p.enabled);
    if (currentPairs.length === 0) return;

    for (const pair of currentPairs) {
      try {
        const candles = await fetchCandles(pair.symbol, '1h', 200);
        if (candles.length < 30) continue;

        const newSignals = ictCoreEngine(candles, pair.symbol);

        // Only add signals from the last 2 candles (recent)
        const recentTime = candles.length > 2 ? candles[candles.length - 3].time : 0;
        const recentSignals = newSignals.filter((s) => s.timestamp >= recentTime);

        for (const sig of recentSignals) {
          // Check for duplicates
          const existing = signalsRef.current.find(
            (s) =>
              s.pair === sig.pair &&
              s.type === sig.type &&
              Math.abs(s.entry - sig.entry) < sig.entry * 0.001 &&
              Math.abs(s.timestamp - sig.timestamp) < 3600000
          );

          if (!existing) {
            // ✅ CHECK: Υπάρχει ήδη ανοιχτό trade για αυτό το ζευγάρι;
            const existingOpenTrade = tradesRef.current.find(
              (t) => t.pair === sig.pair && t.status === 'open'
            );

            if (existingOpenTrade) {
              // ❌ Αν ναι, αποθήκευσε το signal ως rejected με αιτιολόγηση
              const rejectedSignal: Signal = {
                ...sig,
                status: 'rejected',
                rejectedAt: Date.now(),
                rejectionReason: `Υπάρχει ήδη ανοιχτή θέση (${existingOpenTrade.type} @ ${existingOpenTrade.entryPrice.toFixed(4)})`,
              };
              addSignal(rejectedSignal);
              console.log(`🚫 New signal REJECTED for ${sig.pair}: Already has open trade`);
            } else {
              // ✅ Δεν υπάρχει ανοιχτό trade, προσθέτουμε κανονικά
              addSignal(sig);
              console.log(`📊 New signal added for ${sig.pair}: ${sig.type}`);
            }
          }
        }

        setSignals(getSignals());
      } catch (err) {
        console.error(`ICT scan error for ${pair.symbol}:`, err);
      }
    }
  }, []);

  // ============ START LOOPS ============
  useEffect(() => {
    // Initial fetch
    fetchPrices();
    runICTScan();

    // Set up intervals
    const priceTimer = setInterval(fetchPrices, PRICE_INTERVAL);
    const scanTimer = setInterval(runICTScan, SCAN_INTERVAL);

    return () => {
      clearInterval(priceTimer);
      clearInterval(scanTimer);
    };
  }, [fetchPrices, runICTScan]);

  // ============ HANDLERS ============
  const handleToggleAutoTrading = () => {
    const updated = { ...settings, autoTrading: !settings.autoTrading };
    setSettings(updated);
    saveSettings(updated);
  };

  const handleAddPair = (symbol: string) => {
    storeAddPair(symbol);
    setPairs(getPairs());
  };

  const handleRemovePair = (symbol: string) => {
    storeRemovePair(symbol);
    setPairs(getPairs());
  };

  const handleTogglePair = (symbol: string) => {
    storeTogglePair(symbol);
    setPairs(getPairs());
  };

  const handleSaveSettings = (newSettings: Settings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleCloseTrade = (id: string) => {
    const trade = trades.find((t) => t.id === id);
    if (!trade) return;

    updateTrade(id, {
      status: 'manual_close',
      closeTime: Date.now(),
      closePrice: trade.currentPrice,
    });

    const updatedTrades = getTrades();
    setTrades(updatedTrades);

    // Add equity point
    const currentStats = getPortfolioStats();
    addEquityPoint(currentStats.balance);
    setEquityHistory(getEquityHistory());
  };

  const handleDeleteSignal = (id: string) => {
    const updatedSignals = signals.filter((s) => s.id !== id);
    setSignals(updatedSignals);
    saveSignals(updatedSignals);
  };

  const handleDeleteTrade = (id: string) => {
    const updatedTrades = trades.filter((t) => t.id !== id);
    setTrades(updatedTrades);
    saveTrades(updatedTrades);
    // Recalculate stats
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
            cloudEnabled={settings.cloudSyncEnabled}
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
            onCloudRestore={() => {
              // Reload all state from localStorage (after cloud download or reset)
              setSignals(getSignals());
              setTrades(getTrades());
              setPairs(getPairs());
              setSettings(getSettings());
              setEquityHistory(getEquityHistory());
              setStats(getPortfolioStats());
            }}
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
