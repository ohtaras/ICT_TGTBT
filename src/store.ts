import { Signal, Trade, TradingPair, Settings, PortfolioStats } from './types';
import { schedulCloudSync } from './cloudSync';

const KEYS = {
  SIGNALS: 'ict_signals',
  TRADES: 'ict_trades',
  PAIRS: 'ict_pairs',
  SETTINGS: 'ict_settings',
  EQUITY_HISTORY: 'ict_equity_history',
};

function triggerCloudSync() {
  schedulCloudSync();
}

// Signals
export function getSignals(): Signal[] {
  const data = localStorage.getItem(KEYS.SIGNALS);
  return data ? JSON.parse(data) : [];
}

export function saveSignals(signals: Signal[]) {
  localStorage.setItem(KEYS.SIGNALS, JSON.stringify(signals));
  triggerCloudSync();
}

export function addSignal(signal: Signal) {
  const signals = getSignals();
  // Avoid duplicates
  if (!signals.find(s => s.id === signal.id)) {
    signals.unshift(signal);
    // Keep last 200
    if (signals.length > 200) signals.pop();
    saveSignals(signals);
  }
}

// Trades
export function getTrades(): Trade[] {
  const data = localStorage.getItem(KEYS.TRADES);
  return data ? JSON.parse(data) : [];
}

export function saveTrades(trades: Trade[]) {
  localStorage.setItem(KEYS.TRADES, JSON.stringify(trades));
  triggerCloudSync();
}

export function addTrade(trade: Trade) {
  const trades = getTrades();
  trades.unshift(trade);
  saveTrades(trades);
}

export function updateTrade(id: string, updates: Partial<Trade>) {
  const trades = getTrades();
  const idx = trades.findIndex(t => t.id === id);
  if (idx !== -1) {
    trades[idx] = { ...trades[idx], ...updates };
    saveTrades(trades);
  }
}

// Pairs
export function getPairs(): TradingPair[] {
  const data = localStorage.getItem(KEYS.PAIRS);
  if (data) return JSON.parse(data);
  // Default pairs — τα πιο δημοφιλή ζευγάρια
  const defaults: TradingPair[] = [
    { symbol: 'BTCUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'ETHUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'BNBUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'SOLUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'XRPUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'ADAUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'DOGEUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'AVAXUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'DOTUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'LINKUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'MATICUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'UNIUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'ATOMUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'LTCUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'NEARUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'APTUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'ARBUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'OPUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'SUIUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'INJUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'PEPEUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'SHIBUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'RENDERUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'FETUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
    { symbol: 'FILUSDT', enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 },
  ];
  savePairs(defaults);
  return defaults;
}

export function savePairs(pairs: TradingPair[]) {
  localStorage.setItem(KEYS.PAIRS, JSON.stringify(pairs));
  triggerCloudSync();
}

export function addPair(symbol: string) {
  const pairs = getPairs();
  if (!pairs.find(p => p.symbol === symbol.toUpperCase())) {
    pairs.push({
      symbol: symbol.toUpperCase(),
      enabled: true,
      currentPrice: 0,
      change24h: 0,
      lastUpdate: 0,
    });
    savePairs(pairs);
  }
}

export function removePair(symbol: string) {
  const pairs = getPairs().filter(p => p.symbol !== symbol);
  savePairs(pairs);
}

export function togglePair(symbol: string) {
  const pairs = getPairs();
  const p = pairs.find(p => p.symbol === symbol);
  if (p) p.enabled = !p.enabled;
  savePairs(pairs);
}

// Settings
export function getSettings(): Settings {
  const data = localStorage.getItem(KEYS.SETTINGS);
  if (data) return JSON.parse(data);
  return {
    autoTrading: false,
    riskPerTrade: 2,
    initialBalance: 10000,
    dataSource: 'binance' as const,
  };
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  triggerCloudSync();
}

// Equity History
export function getEquityHistory(): { time: number; equity: number }[] {
  const data = localStorage.getItem(KEYS.EQUITY_HISTORY);
  return data ? JSON.parse(data) : [];
}

export function addEquityPoint(equity: number) {
  const history = getEquityHistory();
  history.push({ time: Date.now(), equity });
  if (history.length > 500) history.shift();
  localStorage.setItem(KEYS.EQUITY_HISTORY, JSON.stringify(history));
  triggerCloudSync();
}

// Portfolio Stats
export function getPortfolioStats(): PortfolioStats {
  const trades = getTrades();
  const settings = getSettings();

  const closedTrades = trades.filter(t => t.status === 'won' || t.status === 'lost' || t.status === 'manual_close');
  const openTrades = trades.filter(t => t.status === 'open');
  const wonTrades = closedTrades.filter(t => t.pnl > 0);
  const lostTrades = closedTrades.filter(t => t.pnl <= 0);

  const totalPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossProfit = wonTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(lostTrades.reduce((sum, t) => sum + t.pnl, 0));

  const winRate = closedTrades.length > 0 ? (wonTrades.length / closedTrades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Max Drawdown
  let peak = settings.initialBalance;
  let maxDD = 0;
  let runningBalance = settings.initialBalance;
  for (const trade of [...closedTrades].reverse()) {
    runningBalance += trade.pnl;
    if (runningBalance > peak) peak = runningBalance;
    const dd = ((peak - runningBalance) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    balance: settings.initialBalance + totalPnl,
    totalTrades: closedTrades.length,
    winRate,
    profitFactor,
    maxDrawdown: maxDD,
    totalPnl,
    openTrades: openTrades.length,
  };
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}
