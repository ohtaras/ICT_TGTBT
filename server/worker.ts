import { Pool } from 'pg';

// ============ TYPES ============
interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}
interface Signal {
  id: string; pair: string; type: 'BULLISH' | 'BEARISH';
  entry: number; sl: number; tp: number; timestamp: number;
  status: 'pending' | 'triggered' | 'expired' | 'rejected';
  triggeredAt?: number; expiredAt?: number; rejectedAt?: number; rejectionReason?: string;
}
interface Trade {
  id: string; signalId: string; pair: string; type: 'LONG' | 'SHORT';
  entryPrice: number; currentPrice: number; sl: number; tp: number;
  liquidationPrice: number; leverage: number;
  size: number; pnl: number; pnlPercent: number;
  status: 'open' | 'won' | 'lost' | 'liquidated' | 'manual_close';
  openTime: number; closeTime?: number; closePrice?: number;
}
interface TradingPair {
  symbol: string; enabled: boolean; currentPrice: number; change24h: number; lastUpdate: number;
}
interface Settings {
  autoTrading: boolean; riskPerTrade: number; initialBalance: number; leverage: number;
}
interface DBState {
  signals: Signal[]; trades: Trade[]; pairs: TradingPair[];
  settings: Settings; equityHistory: { time: number; equity: number }[];
}

// ============ DEFAULTS ============
const DEFAULT_PAIRS: TradingPair[] = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
  'MATICUSDT','UNIUSDT','ATOMUSDT','LTCUSDT','NEARUSDT',
  'APTUSDT','ARBUSDT','OPUSDT','SUIUSDT','INJUSDT',
  'PEPEUSDT','SHIBUSDT','RENDERUSDT','FETUSDT','FILUSDT',
].map(symbol => ({ symbol, enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 }));

const DEFAULT_SETTINGS: Settings = { autoTrading: false, riskPerTrade: 2, initialBalance: 10000, leverage: 10 };

// ============ UTILS ============
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getBalance(trades: Trade[], initialBalance: number): number {
  const closed = trades.filter(t => t.status !== 'open');
  return initialBalance + closed.reduce((sum, t) => sum + t.pnl, 0);
}

// ============ BINANCE API ============
const BINANCE_BASE = 'https://api.binance.com';

async function fetchCandles(symbol: string, interval = '1h', limit = 200): Promise<Candle[]> {
  try {
    const res = await fetch(`${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as unknown[][];
    return data.map(k => ({
      time:   k[0] as number,
      open:   parseFloat(k[1] as string),
      high:   parseFloat(k[2] as string),
      low:    parseFloat(k[3] as string),
      close:  parseFloat(k[4] as string),
      volume: parseFloat(k[5] as string),
    }));
  } catch (err) {
    console.error(`[worker] candles error ${symbol}:`, err);
    return [];
  }
}

async function fetchPrices(pairs: TradingPair[]): Promise<Map<string, { price: number; change24h: number }>> {
  const results = new Map<string, { price: number; change24h: number }>();
  try {
    const symbols = pairs.map(p => `"${p.symbol}"`).join(',');
    const url = `${BINANCE_BASE}/api/v3/ticker/24hr?symbols=${encodeURIComponent('[' + symbols + ']')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { symbol: string; lastPrice: string; priceChangePercent: string }[];
    for (const item of data) {
      results.set(item.symbol, {
        price: parseFloat(item.lastPrice),
        change24h: parseFloat(item.priceChangePercent),
      });
    }
  } catch (err) {
    console.error('[worker] prices error:', err);
  }
  return results;
}

// ============ ICT ENGINE ============
function ictCoreEngine(candles: Candle[], pair: string): Signal[] {
  if (candles.length < 30) return [];

  const signals: Signal[] = [];
  const usedIndices = new Set<number>();
  const prevHigh: (number | null)[] = [];
  const prevLow: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < 24) { prevHigh.push(null); prevLow.push(null); continue; }
    let maxH = -Infinity, minL = Infinity;
    for (let k = i - 24; k < i; k++) {
      if (candles[k].high > maxH) maxH = candles[k].high;
      if (candles[k].low < minL) minL = candles[k].low;
    }
    prevHigh.push(maxH);
    prevLow.push(minL);
  }

  for (let i = 25; i < candles.length; i++) {
    if (prevHigh[i] === null || prevLow[i] === null) continue;
    const pHigh = prevHigh[i]!;
    const pLow  = prevLow[i]!;
    const { close: currentClose, low: currentLow, high: currentHigh } = candles[i];

    // BULLISH: Liquidity Sweep → MSS → FVG
    if (currentLow < pLow && currentClose > pLow) {
      for (let j = i + 1; j < Math.min(i + 10, candles.length); j++) {
        if (usedIndices.has(j)) continue;
        if (candles[j].close > candles[i].high) {
          if (j >= 2 && candles[j].low > candles[j - 2].high) {
            const entryPrice = candles[j].low;
            const sl = currentLow * 0.999;
            const tp = entryPrice + (entryPrice - sl) * 2.5;
            signals.push({
              id: generateId(), pair, type: 'BULLISH',
              entry: parseFloat(entryPrice.toPrecision(8)),
              sl:    parseFloat(sl.toPrecision(8)),
              tp:    parseFloat(tp.toPrecision(8)),
              timestamp: candles[j].time, status: 'pending',
            });
            usedIndices.add(j);
            break;
          }
        }
      }
    }
    // BEARISH: Liquidity Sweep → MSS → FVG
    else if (currentHigh > pHigh && currentClose < pHigh) {
      for (let j = i + 1; j < Math.min(i + 10, candles.length); j++) {
        if (usedIndices.has(j)) continue;
        if (candles[j].close < candles[i].low) {
          if (j >= 2 && candles[j].high < candles[j - 2].low) {
            const entryPrice = candles[j].high;
            const sl = currentHigh * 1.001;
            const tp = entryPrice - (sl - entryPrice) * 2.5;
            signals.push({
              id: generateId(), pair, type: 'BEARISH',
              entry: parseFloat(entryPrice.toPrecision(8)),
              sl:    parseFloat(sl.toPrecision(8)),
              tp:    parseFloat(Math.max(0.000001, tp).toPrecision(8)),
              timestamp: candles[j].time, status: 'pending',
            });
            usedIndices.add(j);
            break;
          }
        }
      }
    }
  }

  return signals;
}

function checkSignalTrigger(signal: Signal, price: number): boolean {
  if (signal.status !== 'pending') return false;
  if (signal.type === 'BULLISH') return price <= signal.entry * 1.002 && price >= signal.sl;
  return price >= signal.entry * 0.998 && price <= signal.sl;
}

function checkTradeExit(
  type: 'LONG' | 'SHORT',
  price: number,
  sl: number,
  tp: number,
  liquidationPrice: number,
): 'won' | 'lost' | 'liquidated' | null {
  if (type === 'LONG') {
    if (price >= tp) return 'won';
    if (price <= liquidationPrice) return 'liquidated';
    if (price <= sl) return 'lost';
  } else {
    if (price <= tp) return 'won';
    if (price >= liquidationPrice) return 'liquidated';
    if (price >= sl) return 'lost';
  }
  return null;
}

// ============ DB HELPERS ============
async function readDB(pool: Pool): Promise<DBState | null> {
  try {
    const result = await pool.query('SELECT * FROM trading_data WHERE id = 1');
    const row = result.rows[0];
    if (!row) return null;

    const pairs: TradingPair[] = Array.isArray(row.pairs) && row.pairs.length > 0
      ? row.pairs
      : DEFAULT_PAIRS;
    const settings: Settings = row.settings?.initialBalance
      ? row.settings
      : DEFAULT_SETTINGS;

    return {
      signals:       row.signals       ?? [],
      trades:        row.trades        ?? [],
      pairs,
      settings,
      equityHistory: row.equity_history ?? [],
    };
  } catch (err) {
    console.error('[worker] readDB error:', err);
    return null;
  }
}

async function writeDB(pool: Pool, data: DBState): Promise<void> {
  await pool.query(
    `UPDATE trading_data
     SET signals=$1, trades=$2, pairs=$3, settings=$4, equity_history=$5, updated_at=NOW()
     WHERE id=1`,
    [
      JSON.stringify(data.signals),
      JSON.stringify(data.trades),
      JSON.stringify(data.pairs),
      JSON.stringify(data.settings),
      JSON.stringify(data.equityHistory),
    ],
  );
}

// ============ PRICE CHECK (every 15s) ============
let priceCheckRunning = false;

async function runPriceCheck(pool: Pool): Promise<void> {
  if (priceCheckRunning) return;
  priceCheckRunning = true;
  try {
    const db = await readDB(pool);
    if (!db) return;

    const enabledPairs = db.pairs.filter(p => p.enabled);
    if (enabledPairs.length === 0) return;

    const priceMap = await fetchPrices(enabledPairs);
    if (priceMap.size === 0) return;

    // Update pair prices
    const updatedPairs = db.pairs.map(p => {
      const d = priceMap.get(p.symbol);
      return d && d.price > 0
        ? { ...p, currentPrice: d.price, change24h: d.change24h, lastUpdate: Date.now() }
        : p;
    });

    // Check SL/TP on open trades
    let tradesChanged = false;
    const updatedTrades = db.trades.map(trade => {
      if (trade.status !== 'open') return trade;
      const d = priceMap.get(trade.pair);
      if (!d || d.price <= 0) return trade;

      const price = d.price;
      const exitResult = checkTradeExit(trade.type, price, trade.sl, trade.tp, trade.liquidationPrice);

      if (exitResult) {
        tradesChanged = true;
        const closePrice = exitResult === 'won'
          ? trade.tp
          : exitResult === 'liquidated'
          ? trade.liquidationPrice
          : trade.sl;
        const closePnl = exitResult === 'liquidated'
          ? -(trade.entryPrice * trade.size) / trade.leverage  // full margin loss
          : trade.type === 'LONG'
          ? (closePrice - trade.entryPrice) * trade.size
          : (trade.entryPrice - closePrice) * trade.size;
        console.log(`[worker] ${exitResult.toUpperCase()}: ${trade.pair} ${trade.type} PnL $${closePnl.toFixed(2)}`);
        return {
          ...trade, currentPrice: price,
          status: exitResult as Trade['status'],
          closeTime: Date.now(), closePrice,
          pnl: parseFloat(closePnl.toFixed(4)),
          pnlPercent: parseFloat(((closePnl / (trade.entryPrice * trade.size)) * 100).toFixed(2)),
        };
      }

      const pnl = trade.type === 'LONG'
        ? (price - trade.entryPrice) * trade.size
        : (trade.entryPrice - price) * trade.size;
      return {
        ...trade, currentPrice: price,
        pnl: parseFloat(pnl.toFixed(4)),
        pnlPercent: parseFloat(((pnl / (trade.entryPrice * trade.size)) * 100).toFixed(2)),
      };
    });

    // Update equity history on trade close
    let updatedEquity = db.equityHistory;
    if (tradesChanged) {
      const balance = getBalance(updatedTrades, db.settings.initialBalance);
      updatedEquity = [...db.equityHistory, { time: Date.now(), equity: balance }].slice(-500);
    }

    // Check pending signals for triggers
    let signalsChanged = false;
    // Track pairs that got a new trade opened THIS cycle (fixes double-trade bug)
    const newlyOpenedPairs = new Set(
      updatedTrades.filter(t => t.status === 'open').map(t => t.pair)
    );

    const updatedSignals = db.signals.map(sig => {
      if (sig.status !== 'pending') return sig;

      // Always expire stale signals regardless of autoTrading setting
      if (Date.now() - sig.timestamp > 24 * 60 * 60 * 1000) {
        signalsChanged = true;
        return { ...sig, status: 'expired' as const, expiredAt: Date.now() };
      }

      if (!db.settings.autoTrading) return sig;

      const d = priceMap.get(sig.pair);
      if (!d || d.price <= 0) return sig;

      if (!checkSignalTrigger(sig, d.price)) return sig;

      signalsChanged = true;

      // Reject if pair already has open trade (including one opened this cycle)
      if (newlyOpenedPairs.has(sig.pair)) {
        return {
          ...sig, status: 'rejected' as const, rejectedAt: Date.now(),
          rejectionReason: 'Υπάρχει ήδη ανοιχτή θέση',
        };
      }

      // Futures position sizing
      const leverage        = db.settings.leverage ?? 10;
      const balance         = getBalance(updatedTrades, db.settings.initialBalance);
      const riskAmount      = balance * (db.settings.riskPerTrade / 100);
      const riskPerUnit     = Math.abs(sig.entry - sig.sl);
      const sizeByRisk      = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;
      const maxSizeByMargin = (balance * leverage) / sig.entry;
      const size            = parseFloat(Math.min(sizeByRisk, maxSizeByMargin).toFixed(6));
      const liquidationPrice = parseFloat((
        sig.type === 'BULLISH'
          ? sig.entry * (1 - 1 / leverage)
          : sig.entry * (1 + 1 / leverage)
      ).toPrecision(8));

      if (size <= 0) return sig;

      const newTrade: Trade = {
        id: generateId(), signalId: sig.id, pair: sig.pair,
        type: sig.type === 'BULLISH' ? 'LONG' : 'SHORT',
        entryPrice: sig.entry, currentPrice: d.price,
        sl: sig.sl, tp: sig.tp, liquidationPrice, leverage, size,
        pnl: 0, pnlPercent: 0, status: 'open', openTime: Date.now(),
      };

      updatedTrades.unshift(newTrade);
      newlyOpenedPairs.add(sig.pair); // prevent a 2nd signal for same pair this cycle
      console.log(`[worker] TRADE OPENED: ${sig.pair} ${newTrade.type} @ ${newTrade.entryPrice} size=${size}`);

      return { ...sig, status: 'triggered' as const, triggeredAt: Date.now() };
    });

    await writeDB(pool, {
      signals:       signalsChanged ? updatedSignals : db.signals,
      trades:        updatedTrades,
      pairs:         updatedPairs,
      settings:      db.settings,
      equityHistory: updatedEquity,
    });

  } catch (err) {
    console.error('[worker] price check error:', err);
  } finally {
    priceCheckRunning = false;
  }
}

// ============ ICT SCAN (every 60s) ============
let ictScanRunning = false;

async function runICTScan(pool: Pool): Promise<void> {
  if (ictScanRunning) return;
  ictScanRunning = true;
  try {
    const db = await readDB(pool);
    if (!db) return;

    const enabledPairs = db.pairs.filter(p => p.enabled);
    if (enabledPairs.length === 0) return;

    let signals = [...db.signals];
    let changed = false;

    for (const pair of enabledPairs) {
      try {
        const candles = await fetchCandles(pair.symbol, '1h', 200);
        if (candles.length < 30) continue;

        const newSignals = ictCoreEngine(candles, pair.symbol);
        const recentTime = candles.length > 2 ? candles[candles.length - 3].time : 0;
        const recentSignals = newSignals.filter(s => s.timestamp >= recentTime);

        const openTrade = db.trades.find(t => t.pair === pair.symbol && t.status === 'open');

        for (const sig of recentSignals) {
          const isDuplicate = signals.some(s =>
            s.pair === sig.pair && s.type === sig.type &&
            Math.abs(s.entry - sig.entry) < sig.entry * 0.001 &&
            Math.abs(s.timestamp - sig.timestamp) < 3_600_000
          );
          if (isDuplicate) continue;

          changed = true;
          if (openTrade) {
            signals.unshift({
              ...sig, status: 'rejected', rejectedAt: Date.now(),
              rejectionReason: `Ανοιχτή θέση (${openTrade.type} @ ${openTrade.entryPrice.toFixed(4)})`,
            });
          } else {
            signals.unshift(sig);
            console.log(`[worker] NEW SIGNAL: ${sig.pair} ${sig.type} entry=${sig.entry}`);
          }
        }

        if (signals.length > 200) signals = signals.slice(0, 200);
      } catch (err) {
        console.error(`[worker] scan error ${pair.symbol}:`, err);
      }
    }

    if (changed) {
      await pool.query(
        `UPDATE trading_data SET signals=$1, updated_at=NOW() WHERE id=1`,
        [JSON.stringify(signals)],
      );
    }
  } catch (err) {
    console.error('[worker] ICT scan error:', err);
  } finally {
    ictScanRunning = false;
  }
}

// ============ START WORKER ============
export function startWorker(pool: Pool): void {
  console.log('[worker] 24/7 trading worker starting...');

  // Initial run immediately
  runICTScan(pool).then(() => runPriceCheck(pool));

  setInterval(() => runPriceCheck(pool), 15_000);
  setInterval(() => runICTScan(pool),    60_000);

  console.log('[worker] Price check every 15s | ICT scan every 60s');
}
