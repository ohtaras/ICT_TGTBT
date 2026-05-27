import { Candle, TradingPair } from '../types';

// Binance Futures Public API (fapi) — perpetual USDT contracts
const BASE_URL = 'https://fapi.binance.com';

export async function fetchPrice(symbol: string): Promise<{ price: number; change24h: number }> {
  try {
    const res = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr?symbol=${symbol}`);
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

export async function fetchAllPrices(pairs: TradingPair[]): Promise<Map<string, { price: number; change24h: number }>> {
  const results = new Map<string, { price: number; change24h: number }>();
  try {
    let data: { symbol: string; lastPrice: string; priceChangePercent: string }[];
    try {
      const symbols = encodeURIComponent('[' + pairs.map(p => `"${p.symbol}"`).join(',') + ']');
      const res = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr?symbols=${symbols}`);
      if (!res.ok) throw new Error('batch failed');
      data = await res.json();
    } catch {
      const res = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr`);
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
    for (const pair of pairs) {
      try {
        const res = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr?symbol=${pair.symbol}`);
        if (res.ok) {
          const item = await res.json();
          results.set(pair.symbol, {
            price: parseFloat(item.lastPrice),
            change24h: parseFloat(item.priceChangePercent),
          });
        }
      } catch { /* skip */ }
    }
  }
  return results;
}

export async function fetchCandles(
  symbol: string,
  interval: string = '1h',
  limit: number = 200
): Promise<Candle[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: number[][] = await res.json();
    return data.map((k) => ({
      time: k[0],
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
    }));
  } catch (err) {
    console.error(`Error fetching candles for ${symbol}:`, err);
    return [];
  }
}

export async function testBinanceConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/fapi/v1/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getServerTime(): Promise<number> {
  try {
    const res = await fetch(`${BASE_URL}/fapi/v1/time`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.serverTime;
  } catch {
    return 0;
  }
}

let cachedUsdtPairs: { symbol: string; baseAsset: string }[] = [];
let cacheTimestamp = 0;
const CACHE_DURATION = 10 * 60 * 1000;

export async function fetchAllUsdtPairs(): Promise<{ symbol: string; baseAsset: string }[]> {
  const now = Date.now();
  if (cachedUsdtPairs.length > 0 && now - cacheTimestamp < CACHE_DURATION) {
    return cachedUsdtPairs;
  }
  try {
    const res = await fetch(`${BASE_URL}/fapi/v1/exchangeInfo`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedUsdtPairs = (data.symbols as { symbol: string; baseAsset: string; quoteAsset: string; contractType: string; status: string }[])
      .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL')
      .map(s => ({ symbol: s.symbol, baseAsset: s.baseAsset }))
      .sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));
    cacheTimestamp = now;
    return cachedUsdtPairs;
  } catch (err) {
    console.error('Error fetching futures exchange info:', err);
    return cachedUsdtPairs;
  }
}

export async function searchSymbols(query: string): Promise<{ symbol: string; baseAsset: string }[]> {
  const allPairs = await fetchAllUsdtPairs();
  if (!query.trim()) return allPairs.slice(0, 50);
  const q = query.toUpperCase();
  return allPairs
    .filter(p => p.baseAsset.includes(q) || p.symbol.includes(q))
    .slice(0, 50);
}
