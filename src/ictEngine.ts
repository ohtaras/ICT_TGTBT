import { Candle, Signal } from './types';
import { generateId } from './store';

/**
 * ICT Core Engine - Inner Circle Trader Strategy
 * Detects: Liquidity Sweep → Market Structure Shift (MSS) → Fair Value Gap (FVG)
 * 
 * Translated from the Python algorithm to TypeScript.
 */
export function ictCoreEngine(candles: Candle[], pair: string): Signal[] {
  if (candles.length < 30) return [];

  const signals: Signal[] = [];
  const usedIndices = new Set<number>();

  // Calculate rolling 24-period high and low
  const prevHigh: (number | null)[] = [];
  const prevLow: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < 24) {
      prevHigh.push(null);
      prevLow.push(null);
      continue;
    }
    let maxH = -Infinity;
    let minL = Infinity;
    for (let k = i - 24; k < i; k++) {
      if (candles[k].high > maxH) maxH = candles[k].high;
      if (candles[k].low < minL) minL = candles[k].low;
    }
    prevHigh.push(maxH);
    prevLow.push(minL);
  }

  for (let i = 25; i < candles.length; i++) {
    if (prevHigh[i] === null || prevLow[i] === null) continue;

    const currentClose = candles[i].close;
    const currentLow = candles[i].low;
    const currentHigh = candles[i].high;
    const pHigh = prevHigh[i]!;
    const pLow = prevLow[i]!;

    // --- BULLISH SETUP (BUY) ---
    // A. LIQUIDITY SWEEP: Price drops below previous low (trap) then closes above it
    if (currentLow < pLow && currentClose > pLow) {
      // B. MARKET STRUCTURE SHIFT (MSS): Wait for next high to break
      for (let j = i + 1; j < Math.min(i + 10, candles.length); j++) {
        if (usedIndices.has(j)) continue;

        if (candles[j].close > candles[i].high) {
          // MSS Confirmation
          // C. FAIR VALUE GAP (FVG): Look for gap in the MSS move
          if (j >= 2 && candles[j].low > candles[j - 2].high) {
            const entryPrice = candles[j].low; // Entry at bottom of FVG
            const sl = currentLow - (currentLow * 0.001); // SL just below sweep
            const tp = entryPrice + (entryPrice - sl) * 2.5; // R:R 1:2.5

            signals.push({
              id: generateId(),
              pair,
              type: 'BULLISH',
              entry: parseFloat(entryPrice.toPrecision(8)),
              sl: parseFloat(sl.toPrecision(8)),
              tp: parseFloat(tp.toPrecision(8)),
              timestamp: candles[j].time,
              status: 'pending',
            });
            usedIndices.add(j);
            break;
          }
        }
      }
    }
    // --- BEARISH SETUP (SELL) ---
    // A. LIQUIDITY SWEEP: Price rises above previous high then closes below it
    else if (currentHigh > pHigh && currentClose < pHigh) {
      // B. MARKET STRUCTURE SHIFT (MSS)
      for (let j = i + 1; j < Math.min(i + 10, candles.length); j++) {
        if (usedIndices.has(j)) continue;

        if (candles[j].close < candles[i].low) {
          // MSS Confirmation
          // C. FAIR VALUE GAP (FVG)
          if (j >= 2 && candles[j].high < candles[j - 2].low) {
            const entryPrice = candles[j].high;
            const sl = currentHigh + (currentHigh * 0.001);
            const tp = entryPrice - (sl - entryPrice) * 2.5;

            signals.push({
              id: generateId(),
              pair,
              type: 'BEARISH',
              entry: parseFloat(entryPrice.toPrecision(8)),
              sl: parseFloat(sl.toPrecision(8)),
              tp: parseFloat(Math.max(0, tp).toPrecision(8)),
              timestamp: candles[j].time,
              status: 'pending',
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

/**
 * Check if current price triggers any pending signals.
 * If price enters FVG zone, the signal becomes a trade.
 */
export function checkSignalTrigger(signal: Signal, currentPrice: number): boolean {
  if (signal.status !== 'pending') return false;

  if (signal.type === 'BULLISH') {
    // Price drops into FVG zone (entry area)
    return currentPrice <= signal.entry * 1.002 && currentPrice >= signal.sl;
  } else {
    // Price rises into FVG zone (entry area)
    return currentPrice >= signal.entry * 0.998 && currentPrice <= signal.sl;
  }
}

/**
 * Check if an open trade hits SL or TP
 */
export function checkTradeExit(
  type: 'LONG' | 'SHORT',
  currentPrice: number,
  sl: number,
  tp: number
): 'won' | 'lost' | null {
  if (type === 'LONG') {
    if (currentPrice >= tp) return 'won';
    if (currentPrice <= sl) return 'lost';
  } else {
    if (currentPrice <= tp) return 'won';
    if (currentPrice >= sl) return 'lost';
  }
  return null;
}
