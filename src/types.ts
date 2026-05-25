export interface Signal {
  id: string;
  pair: string;
  type: 'BULLISH' | 'BEARISH';
  entry: number;
  sl: number;
  tp: number;
  timestamp: number;
  status: 'pending' | 'triggered' | 'expired' | 'rejected';
  triggeredAt?: number;
  expiredAt?: number;
  rejectedAt?: number;
  rejectionReason?: string;
  currentPrice?: number;
}

export interface Trade {
  id: string;
  signalId: string;
  pair: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  status: 'open' | 'won' | 'lost' | 'manual_close';
  openTime: number;
  closeTime?: number;
  closePrice?: number;
}

export interface TradingPair {
  symbol: string;
  enabled: boolean;
  currentPrice: number;
  change24h: number;
  lastUpdate: number;
}

export interface Settings {
  autoTrading: boolean;
  riskPerTrade: number;
  initialBalance: number;
  dataSource: 'binance';
  cloudSyncEnabled?: boolean;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PortfolioStats {
  balance: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalPnl: number;
  openTrades: number;
}
