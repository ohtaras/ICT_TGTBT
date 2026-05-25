import { Candle, TradingPair } from '../types';

// Binance Public API — ΔΩΡΕΑΝ, χωρίς API key
// Rate limit: 1200 requests/minute (πολύ γενναιόδωρο)
const BASE_URL = 'https://api.binance.com';

/**
 * Fetch current price + 24h change for a symbol
 */
export async function fetchPrice(symbol: string): Promise<{ price: number; change24h: number }> {
  try {
    const res = await fetch(`${BASE_URL}/api/v3/ticker/24hr?symbol=${symbol}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      price: parseFloat(data.lastPrice),
      change24h: parseFloat(data.priceChangePercent),
    };
  } catch (err) {
    console.error(`Error fetching price for ${symbol}:`, err);
    return { price: 0, change24h: 0 };
  }
}

/**
 * Fetch prices for multiple symbols at once (single API call)
 */
export async function fetchAllPrices(pairs: TradingPair[]): Promise<Map<string, { price: number; change24h: number }>> {
  const results = new Map<string, { price: number; change24h: number }>();

  try {
    // Build query for specific symbols to reduce data
    let data: any[];

    try {
      // Try batch endpoint first
      const res = await fetch(`${BASE_URL}/api/v3/ticker/24hr?symbols=${encodeURIComponent('[' + pairs.map(p => `"${p.symbol}"`).join(',') + ']')}`);
      if (!res.ok) throw new Error('batch failed');
      data = await res.json();
    } catch {
      // Fallback: fetch all tickers
      const res = await fetch(`${BASE_URL}/api/v3/ticker/24hr`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    }

    const symbolSet = new Set(pairs.map(p => p.symbol));
    for (const item of data) {
      if (symbolSet.has(item.symbol)) {
        results.set(item.symbol, {
          price: parseFloat(item.lastPrice),
          change24h: parseFloat(item.priceChangePercent),
        });
      }
    }
  } catch (err) {
    console.error('Error fetching all prices:', err);

    // Ultimate fallback: fetch one by one
    for (const pair of pairs) {
      try {
        const res = await fetch(`${BASE_URL}/api/v3/ticker/24hr?symbol=${pair.symbol}`);
        if (res.ok) {
          const item = await res.json();
          results.set(pair.symbol, {
            price: parseFloat(item.lastPrice),
            change24h: parseFloat(item.priceChangePercent),
          });
        }
      } catch {
        // skip this pair
      }
    }
  }

  return results;
}

/**
 * Fetch kline (candlestick) data from Binance
 * Binance intervals: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
 */
export async function fetchCandles(
  symbol: string,
  interval: string = '1h',
  limit: number = 200
): Promise<Candle[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any[][] = await res.json();

    // Binance kline format:
    // [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, ...]
    return data.map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch (err) {
    console.error(`Error fetching candles for ${symbol}:`, err);
    return [];
  }
}

/**
 * Test connectivity to Binance API (no key needed)
 */
export async function testBinanceConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/v3/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get Binance server time (useful for verifying connection)
 */
export async function getServerTime(): Promise<number> {
  try {
    const res = await fetch(`${BASE_URL}/api/v3/time`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.serverTime;
  } catch {
    return 0;
  }
}

/**
 * Cached list of all available USDT trading pairs
 */
let cachedUsdtPairs: { symbol: string; baseAsset: string }[] = [];
let cacheTimestamp = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch ALL available USDT trading pairs from Binance (cached)
 */
export async function fetchAllUsdtPairs(): Promise<{ symbol: string; baseAsset: string }[]> {
  const now = Date.now();
  if (cachedUsdtPairs.length > 0 && now - cacheTimestamp < CACHE_DURATION) {
    return cachedUsdtPairs;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/v3/exchangeInfo`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    cachedUsdtPairs = data.symbols
      .filter((s: any) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s: any) => ({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
      }))
      .sort((a: any, b: any) => a.baseAsset.localeCompare(b.baseAsset));

    cacheTimestamp = now;
    return cachedUsdtPairs;
  } catch (err) {
    console.error('Error fetching exchange info:', err);
    return cachedUsdtPairs; // return stale cache if available
  }
}

/**
 * Search for available trading pairs on Binance (uses cache)
 */
export async function searchSymbols(query: string): Promise<{ symbol: string; baseAsset: string }[]> {
  const allPairs = await fetchAllUsdtPairs();
  if (!query.trim()) return allPairs.slice(0, 50);

  const q = query.toUpperCase();
  return allPairs
    .filter(p => p.baseAsset.includes(q) || p.symbol.includes(q))
    .slice(0, 50);
}
