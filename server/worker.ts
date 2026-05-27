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
  feePaid: number; fundingPaid: number; lastFundingTime: number;
  status: 'open' | 'won' | 'lost' | 'liquidated' | 'manual_close';
  openTime: number; closeTime?: number; closePrice?: number;
}
interface TradingPair {
  symbol: string; enabled: boolean; currentPrice: number; change24h: number; lastUpdate: number;
}
interface Settings {
  autoTrading: boolean; riskPerTrade: number; initialBalance: number;
  leverage: number; feeRate: number; fundingRate: number;
}
interface DBState {
  signals: Signal[]; trades: Trade[]; pairs: TradingPair[];
  settings: Settings; equityHistory: { time: number; equity: number }[];
}

// ============ DEFAULTS ============
const DEFAULT_PAIRS: TradingPair[] = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
  'POLUSDT','UNIUSDT','ATOMUSDT','LTCUSDT','NEARUSDT',
  'APTUSDT','ARBUSDT','OPUSDT','SUIUSDT','INJUSDT',
  'PEPEUSDT','SHIBUSDT','RENDERUSDT','FETUSDT','FILUSDT',
].map(symbol => ({ symbol, enabled: true, currentPrice: 0, change24h: 0, lastUpdate: 0 }));

const DEFAULT_SETTINGS: Settings = { autoTrading: false, riskPerTrade: 2, initialBalance: 10000, leverage: 10, feeRate: 0.04, fundingRate: 0.01 };

// ============ UTILS ============
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getBalance(trades: Trade[], initialBalance: number): number {
  const closed = trades.filter(t => t.status !== 'open');
  return initialBalance + closed.reduce((sum, t) => sum + t.pnl, 0);
}

// ============ OKX API (Binance=HTTP 451, Bybit=HTTP 403 from Railway cloud IPs) ============
const OKX_BASE = 'https://www.okx.com';

// Symbols confirmed missing on OKX — skip after first 51001 to avoid log spam
const invalidOKXSymbols = new Set<string>();

function toOKXId(symbol: string): string {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) + '-USDT' : symbol;
}

async function fetchCandles(symbol: string, interval = '1H', limit = 200): Promise<Candle[]> {
  if (invalidOKXSymbols.has(symbol)) return [];
  try {
    const res = await fetch(`${OKX_BASE}/api/v5/market/candles?instId=${toOKXId(symbol)}&bar=${interval}&limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { code: string; data: string[][] };
    if (data.code === '51001') {
      invalidOKXSymbols.add(symbol);
      console.warn(`[worker] ${symbol} not found on OKX — skipping permanently`);
      return [];
    }
    if (data.code !== '0') throw new Error(`OKX error ${data.code}`);
    // OKX returns newest-first — reverse to oldest-first
    return data.data.reverse().map(k => ({
      time:   parseInt(k[0]),
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch (err) {
    console.error(`[worker] candles error ${symbol}:`, err);
    return [];
  }
}

async function fetchPrices(pairs: TradingPair[]): Promise<Map<string, { price: number; change24h: number }>> {
  const results = new Map<string, { price: number; change24h: number }>();
  try {
    const res = await fetch(`${OKX_BASE}/api/v5/market/tickers?instType=SPOT`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as {
      code: string;
      data: { instId: string; last: string; open24h: string }[];
    };
    if (data.code !== '0') throw new Error(`OKX error ${data.code}`);
    const symbolSet = new Set(pairs.map(p => p.symbol));
    for (const item of data.data) {
      const symbol = item.instId.replace('-USDT', 'USDT');
      if (symbolSet.has(symbol)) {
        const price = parseFloat(item.last);
        const open24h = parseFloat(item.open24h);
        results.set(symbol, {
          price,
          change24h: open24h > 0 ? ((price - open24h) / open24h) * 100 : 0,
        });
      }
    }
  } catch (err) {
    console.error('[worker] fetchPrices error:', err);
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
async function readDB(pool: Pool): Promise<(DBState & { updatedAt: Date }) | null> {
  try {
    const result = await pool.query('SELECT * FROM trading_data WHERE id = 1');
    const row = result.rows[0];
    if (!row) return null;

    const rawPairs: TradingPair[] = Array.isArray(row.pairs) && row.pairs.length > 0
      ? row.pairs
      : DEFAULT_PAIRS;
    // Auto-migrate renamed Binance symbols so stale DB entries don't break price fetches
    const SYMBOL_RENAMES: Record<string, string> = { MATICUSDT: 'POLUSDT' };
    const pairs: TradingPair[] = rawPairs.map(p =>
      SYMBOL_RENAMES[p.symbol] ? { ...p, symbol: SYMBOL_RENAMES[p.symbol], currentPrice: 0 } : p
    );
    const settings: Settings = row.settings?.initialBalance
      ? { ...DEFAULT_SETTINGS, ...row.settings }
      : DEFAULT_SETTINGS;

    return {
      signals:       row.signals       ?? [],
      trades:        row.trades        ?? [],
      pairs,
      settings,
      equityHistory: row.equity_history ?? [],
      updatedAt:     row.updated_at as Date,
    };
  } catch (err) {
    console.error('[worker] readDB error:', err);
    return null;
  }
}

async function writeDB(pool: Pool, data: DBState, expectedUpdatedAt: Date): Promise<void> {
  const result = await pool.query(
    `UPDATE trading_data
     SET signals=$1, trades=$2, pairs=$3, settings=$4, equity_history=$5, updated_at=NOW()
     WHERE id=1 AND updated_at=$6`,
    [
      JSON.stringify(data.signals),
      JSON.stringify(data.trades),
      JSON.stringify(data.pairs),
      JSON.stringify(data.settings),
      JSON.stringify(data.equityHistory),
      expectedUpdatedAt,
    ],
  );
  if ((result.rowCount ?? 0) === 0) {
    console.log('[worker] writeDB skipped — DB was modified externally (reset?)');
  }
}

// ============ ATOMIC TRADE OPS (no optimistic lock — safe even when ICT scan fires) ============

// Patch a single trade by id
async function patchTrade(pool: Pool, id: string, patch: Partial<Trade>): Promise<void> {
  await pool.query(`
    UPDATE trading_data
    SET trades = (
      SELECT COALESCE(jsonb_agg(
        CASE WHEN t->>'id' = $1 THEN t || $2::jsonb ELSE t END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(trades) t
    ), updated_at = NOW()
    WHERE id = 1
  `, [id, JSON.stringify(patch)]);
}

// Patch multiple trades in ONE SQL call: patchMap = { tradeId: partialTrade, ... }
async function patchTradesBatch(pool: Pool, patchMap: Record<string, Partial<Trade>>): Promise<void> {
  if (Object.keys(patchMap).length === 0) return;
  await pool.query(`
    UPDATE trading_data
    SET trades = (
      SELECT COALESCE(jsonb_agg(
        CASE WHEN $1::jsonb ? (t->>'id')
          THEN t || ($1::jsonb->(t->>'id'))
          ELSE t END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(trades) t
    ), updated_at = NOW()
    WHERE id = 1
  `, [JSON.stringify(patchMap)]);
}

// Patch multiple signals in ONE SQL call (safe — CASE leaves ICT scan's new signals untouched)
async function patchSignalsBatch(pool: Pool, patchMap: Record<string, Partial<Signal>>): Promise<void> {
  if (Object.keys(patchMap).length === 0) return;
  await pool.query(`
    UPDATE trading_data
    SET signals = (
      SELECT COALESCE(jsonb_agg(
        CASE WHEN $1::jsonb ? (s->>'id')
          THEN s || ($1::jsonb->(s->>'id'))
          ELSE s END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(signals) s
    ), updated_at = NOW()
    WHERE id = 1
  `, [JSON.stringify(patchMap)]);
}

async function prependTrades(pool: Pool, newTrades: Trade[]): Promise<void> {
  if (newTrades.length === 0) return;
  await pool.query(`
    UPDATE trading_data
    SET trades = ($1::jsonb || trades),
        updated_at = NOW()
    WHERE id = 1
  `, [JSON.stringify(newTrades)]);
}

// ============ WORKER STATUS (exported for /api/worker-status) ============
let lastPriceCheckAt = 0;
let lastICTScanAt = 0;
export function getWorkerStatus() {
  return { lastPriceCheckAt, lastICTScanAt };
}

// ============ PRICE CHECK (every 5s) ============
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
    if (priceMap.size > 0) lastPriceCheckAt = Date.now();
    if (priceMap.size === 0) return;

    const feeRate     = (db.settings.feeRate     ?? 0.04) / 100;
    const fundingRate = (db.settings.fundingRate ?? 0.01) / 100;
    const FUNDING_INTERVAL = 8 * 60 * 60 * 1000;

    // Build patch map for ALL open trades (closures + running P&L updates)
    const tradePatchMap: Record<string, Partial<Trade>> = {};
    let anyTradeClosed = false;

    for (const trade of db.trades) {
      if (trade.status !== 'open') continue;
      const d = priceMap.get(trade.pair);
      if (!d || d.price <= 0) continue;

      const price = d.price;
      let { feePaid, fundingPaid, lastFundingTime } = trade;

      // Apply funding rate every 8 hours
      const fundingPeriodsElapsed = Math.floor((Date.now() - lastFundingTime) / FUNDING_INTERVAL);
      if (fundingRate > 0 && fundingPeriodsElapsed > 0) {
        const periodFunding = trade.type === 'LONG'
          ? price * trade.size * fundingRate * fundingPeriodsElapsed
          : -(price * trade.size * fundingRate * fundingPeriodsElapsed);
        fundingPaid = parseFloat((fundingPaid + periodFunding).toFixed(4));
        lastFundingTime = lastFundingTime + fundingPeriodsElapsed * FUNDING_INTERVAL;
      }

      const exitResult = checkTradeExit(trade.type, price, trade.sl, trade.tp, trade.liquidationPrice);

      if (exitResult) {
        anyTradeClosed = true;
        const closePrice = exitResult === 'won'
          ? trade.tp
          : exitResult === 'liquidated'
          ? trade.liquidationPrice
          : trade.sl;

        const closingFee = parseFloat((closePrice * trade.size * feeRate).toFixed(4));
        const totalFeePaid = parseFloat((feePaid + closingFee).toFixed(4));
        const pricePnl = exitResult === 'liquidated'
          ? -(trade.entryPrice * trade.size) / trade.leverage
          : trade.type === 'LONG'
          ? (closePrice - trade.entryPrice) * trade.size
          : (trade.entryPrice - closePrice) * trade.size;
        const closePnl = parseFloat((pricePnl - totalFeePaid - fundingPaid).toFixed(4));
        const notional  = trade.entryPrice * trade.size;

        tradePatchMap[trade.id] = {
          currentPrice: price,
          status: exitResult as Trade['status'],
          closeTime: Date.now(), closePrice,
          feePaid: totalFeePaid, fundingPaid, lastFundingTime,
          pnl: closePnl,
          pnlPercent: parseFloat(((closePnl / notional) * 100).toFixed(2)),
        };
        console.log(`[worker] ${exitResult.toUpperCase()}: ${trade.pair} ${trade.type} PnL $${closePnl.toFixed(2)} (fees $${totalFeePaid.toFixed(2)} funding $${fundingPaid.toFixed(2)})`);
      } else {
        // Running P&L update
        const pricePnl = trade.type === 'LONG'
          ? (price - trade.entryPrice) * trade.size
          : (trade.entryPrice - price) * trade.size;
        const netPnl = parseFloat((pricePnl - feePaid - fundingPaid).toFixed(4));
        const notional = trade.entryPrice * trade.size;
        tradePatchMap[trade.id] = {
          currentPrice: price, feePaid, fundingPaid, lastFundingTime,
          pnl: netPnl,
          pnlPercent: parseFloat(((netPnl / notional) * 100).toFixed(2)),
        };
      }
    }

    // ATOMIC: update ALL trades (closures + running P&L) in one SQL call
    await patchTradesBatch(pool, tradePatchMap);

    // ATOMIC: update pair prices
    const updatedPairs = db.pairs.map(p => {
      const d = priceMap.get(p.symbol);
      return d && d.price > 0
        ? { ...p, currentPrice: d.price, change24h: d.change24h, lastUpdate: Date.now() }
        : p;
    });
    await pool.query(
      `UPDATE trading_data SET pairs = $1::jsonb, updated_at = NOW() WHERE id = 1`,
      [JSON.stringify(updatedPairs)]
    );

    // ATOMIC: append equity point when a trade closes
    if (anyTradeClosed) {
      const updatedTradesForBalance = db.trades.map(t =>
        tradePatchMap[t.id] ? { ...t, ...tradePatchMap[t.id] } : t
      );
      const balance = getBalance(updatedTradesForBalance, db.settings.initialBalance);
      const updatedEquity = [...db.equityHistory, { time: Date.now(), equity: balance }].slice(-500);
      await pool.query(
        `UPDATE trading_data SET equity_history = $1::jsonb, updated_at = NOW() WHERE id = 1`,
        [JSON.stringify(updatedEquity)]
      );
    }

    // Check pending signals for triggers / expiry
    const closedPairs = new Set(
      Object.keys(tradePatchMap).filter(id => {
        const patch = tradePatchMap[id];
        return patch.status && patch.status !== 'open';
      }).map(id => db.trades.find(t => t.id === id)?.pair).filter(Boolean) as string[]
    );
    const newlyOpenedPairs = new Set(
      db.trades
        .filter(t => t.status === 'open' && !closedPairs.has(t.pair))
        .map(t => t.pair)
    );
    const tradesToOpen: Trade[] = [];
    const signalPatchMap: Record<string, Partial<Signal>> = {};

    for (const sig of db.signals) {
      if (sig.status !== 'pending') continue;

      if (Date.now() - sig.timestamp > 24 * 60 * 60 * 1000) {
        signalPatchMap[sig.id] = { status: 'expired' as const, expiredAt: Date.now() };
        continue;
      }

      const d = priceMap.get(sig.pair);
      if (!d || d.price <= 0) continue;

      // Invalidate signal if price has already breached the SL — setup is broken
      // (runs regardless of autoTrading so the user can see why no trade was placed)
      if (sig.type === 'BULLISH' && d.price < sig.sl) {
        signalPatchMap[sig.id] = {
          status: 'rejected' as const, rejectedAt: Date.now(),
          rejectionReason: `SL violated @ $${d.price.toFixed(4)} — ICT setup invalidated`,
        };
        continue;
      }
      if (sig.type === 'BEARISH' && d.price > sig.sl) {
        signalPatchMap[sig.id] = {
          status: 'rejected' as const, rejectedAt: Date.now(),
          rejectionReason: `SL violated @ $${d.price.toFixed(4)} — ICT setup invalidated`,
        };
        continue;
      }

      if (!db.settings.autoTrading) continue;

      if (!checkSignalTrigger(sig, d.price)) continue;

      if (newlyOpenedPairs.has(sig.pair)) {
        signalPatchMap[sig.id] = {
          status: 'rejected' as const, rejectedAt: Date.now(),
          rejectionReason: 'Υπάρχει ήδη ανοιχτή θέση',
        };
        continue;
      }

      const leverage        = db.settings.leverage ?? 10;
      const currentTrades   = db.trades.map(t => tradePatchMap[t.id] ? { ...t, ...tradePatchMap[t.id] } : t);
      const balance         = getBalance([...currentTrades, ...tradesToOpen], db.settings.initialBalance);
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

      if (size <= 0) continue;

      const openingFee = parseFloat((sig.entry * size * feeRate).toFixed(4));
      const newTrade: Trade = {
        id: generateId(), signalId: sig.id, pair: sig.pair,
        type: sig.type === 'BULLISH' ? 'LONG' : 'SHORT',
        entryPrice: sig.entry, currentPrice: d.price,
        sl: sig.sl, tp: sig.tp, liquidationPrice, leverage, size,
        feePaid: openingFee, fundingPaid: 0, lastFundingTime: Date.now(),
        pnl: -openingFee, pnlPercent: parseFloat(((-openingFee / (sig.entry * size)) * 100).toFixed(2)),
        status: 'open', openTime: Date.now(),
      };

      tradesToOpen.push(newTrade);
      newlyOpenedPairs.add(sig.pair);
      signalPatchMap[sig.id] = { status: 'triggered' as const, triggeredAt: Date.now() };
      console.log(`[worker] TRADE OPENED: ${sig.pair} ${newTrade.type} @ ${newTrade.entryPrice} size=${size}`);
    }

    // ATOMIC: open new trades
    if (tradesToOpen.length > 0) {
      await prependTrades(pool, tradesToOpen);
    }

    // ATOMIC: update signal statuses (CASE-based — never overwrites ICT scan's new signals)
    await patchSignalsBatch(pool, signalPatchMap);

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
    const newSignals: Signal[] = []; // only genuinely new ones to prepend

    for (const pair of enabledPairs) {
      try {
        const candles = await fetchCandles(pair.symbol, '1H', 200);
        if (candles.length < 30) continue;

        const pairSignals = ictCoreEngine(candles, pair.symbol);
        const recentTime = candles.length > 2 ? candles[candles.length - 3].time : 0;
        const recentSignals = pairSignals.filter(s => s.timestamp >= recentTime);

        const openTrade = db.trades.find(t => t.pair === pair.symbol && t.status === 'open');

        for (const sig of recentSignals) {
          const isDuplicate = signals.some(s =>
            s.pair === sig.pair && s.type === sig.type &&
            Math.abs(s.entry - sig.entry) < sig.entry * 0.001 &&
            Math.abs(s.timestamp - sig.timestamp) < 3_600_000
          );
          if (isDuplicate) continue;

          const entry = openTrade
            ? { ...sig, status: 'rejected' as const, rejectedAt: Date.now(),
                rejectionReason: `Ανοιχτή θέση (${openTrade.type} @ ${openTrade.entryPrice.toFixed(4)})` }
            : sig;

          newSignals.unshift(entry);
          signals.unshift(entry); // keep local list updated for duplicate check
          if (!openTrade) console.log(`[worker] NEW SIGNAL: ${sig.pair} ${sig.type} entry=${sig.entry}`);
        }
      } catch (err) {
        console.error(`[worker] scan error ${pair.symbol}:`, err);
      }
    }

    if (newSignals.length > 0) {
      // Atomic JSONB prepend — no optimistic lock needed, no race with price check
      await pool.query(`
        UPDATE trading_data
        SET signals = ($1::jsonb || signals),
            updated_at = NOW()
        WHERE id = 1
      `, [JSON.stringify(newSignals)]);
      console.log(`[worker] ICT scan wrote ${newSignals.length} new signal(s)`);
    }
    lastICTScanAt = Date.now();
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

  setInterval(() => runPriceCheck(pool),  5_000);
  setInterval(() => runICTScan(pool),    30_000);

  console.log('[worker] Price check every 5s | ICT scan every 30s');
}
