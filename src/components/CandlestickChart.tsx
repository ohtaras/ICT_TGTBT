import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, CandlestickSeries, HistogramSeries, LineSeries, CandlestickData, Time, ColorType, LineStyle, createSeriesMarkers } from 'lightweight-charts';
import { fetchCandles } from '../api/binance';
import { Loader2, X } from 'lucide-react';

export interface PriceLine {
  price: number;
  color: string;
  title: string;
  lineStyle?: number; // 0=solid, 1=dotted, 2=dashed
}

export interface TradeMarker {
  entryTime?: number;   // timestamp ms
  entryPrice: number;
  exitTime?: number;    // timestamp ms (if closed)
  exitPrice?: number;   // close price or current price
  type: 'long' | 'short';
  isOpen?: boolean;
}

interface CandlestickChartProps {
  symbol: string;
  onClose: () => void;
  priceLines?: PriceLine[];
  tradeMarker?: TradeMarker;
}

const INTERVALS = [
  { label: '1m', value: '1m', ms: 60000 },
  { label: '5m', value: '5m', ms: 300000 },
  { label: '15m', value: '15m', ms: 900000 },
  { label: '1H', value: '1h', ms: 3600000 },
  { label: '4H', value: '4h', ms: 14400000 },
  { label: '1D', value: '1d', ms: 86400000 },
  { label: '1W', value: '1w', ms: 604800000 },
];

// Calculate optimal interval based on trade duration
function getOptimalInterval(entryTime?: number, exitTime?: number): string {
  if (!entryTime) return '1h';
  
  const now = exitTime || Date.now();
  const duration = now - entryTime;
  
  // We want the trade to fit nicely on screen (around 20-100 candles)
  // 500 candles available, so pick interval where trade spans ~50 candles
  if (duration < 60000 * 60) return '1m';      // < 1 hour → 1m candles
  if (duration < 60000 * 300) return '5m';     // < 5 hours → 5m candles
  if (duration < 60000 * 720) return '15m';    // < 12 hours → 15m candles
  if (duration < 60000 * 2880) return '1h';    // < 2 days → 1h candles
  if (duration < 60000 * 10080) return '4h';   // < 1 week → 4h candles
  if (duration < 60000 * 43200) return '1d';   // < 30 days → 1d candles
  return '1w';                                  // >= 30 days → 1w candles
}

export default function CandlestickChart({ symbol, onClose, priceLines, tradeMarker }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  
  // Calculate optimal initial interval based on trade time
  const initialInterval = tradeMarker?.entryTime 
    ? getOptimalInterval(tradeMarker.entryTime, tradeMarker.exitTime)
    : '1h';
  
  const [activeInterval, setActiveInterval] = useState(initialInterval);
  const [loading, setLoading] = useState(true);
  const [lastPrice, setLastPrice] = useState<{ open: number; high: number; low: number; close: number } | null>(null);
  const [priceChange, setPriceChange] = useState(0);
  const [tradeOutOfRange, setTradeOutOfRange] = useState(false);
  const [liveExitPrice, setLiveExitPrice] = useState<number | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0f' },
        textColor: '#9ca3af',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: {
        vertLine: { color: '#f59e0b', width: 1, style: 2, labelBackgroundColor: '#f59e0b' },
        horzLine: { color: '#f59e0b', width: 1, style: 2, labelBackgroundColor: '#f59e0b' },
      },
      rightPriceScale: {
        borderColor: '#374151',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
        secondsVisible: false,
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    chartRef.current = chart;

    // v5 API: chart.addSeries(SeriesType, options)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#374151',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Fetch data
    setLoading(true);
    fetchCandles(symbol, activeInterval, 500).then((candles) => {
      if (candles.length === 0) {
        setLoading(false);
        return;
      }

      const candleData: CandlestickData<Time>[] = candles.map((c) => ({
        time: (c.time / 1000) as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volumeData = candles.map((c) => ({
        time: (c.time / 1000) as Time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
      }));

      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);

      // Add price lines (Entry, SL, TP)
      if (priceLines && priceLines.length > 0) {
        for (const pl of priceLines) {
          candleSeries.createPriceLine({
            price: pl.price,
            color: pl.color,
            lineWidth: 2,
            lineStyle: pl.lineStyle ?? 2, // dashed by default
            axisLabelVisible: true,
            title: pl.title,
          });
        }
      }

      // Add trade marker line (entry -> exit)
      if (tradeMarker) {
        const { entryTime, entryPrice, exitTime, exitPrice, type, isOpen } = tradeMarker;
        
        // Get the time range of available candles
        const firstCandleTime = candles[0].time;
        const lastCandleTime = candles[candles.length - 1].time;
        
        // Check if entry time is within the visible range
        const entryOutOfRange = entryTime && (entryTime < firstCandleTime || entryTime > lastCandleTime);
        const exitOutOfRange = exitTime && (exitTime < firstCandleTime || exitTime > lastCandleTime);
        
        if (entryOutOfRange || exitOutOfRange) {
          setTradeOutOfRange(true);
          console.warn('Trade time out of chart range. Try a larger timeframe.');
        } else {
          setTradeOutOfRange(false);
        }
        
        // Helper function to find the CLOSEST candle to a timestamp
        const findClosestCandle = (timestamp: number): number => {
          let closestIdx = 0;
          let minDiff = Math.abs(candles[0].time - timestamp);
          
          for (let i = 1; i < candles.length; i++) {
            const diff = Math.abs(candles[i].time - timestamp);
            if (diff < minDiff) {
              minDiff = diff;
              closestIdx = i;
            }
          }
          
          // Get the current interval's duration to check if match is reasonable
          const intervalObj = INTERVALS.find(iv => iv.value === activeInterval);
          const intervalMs = intervalObj?.ms || 3600000;
          
          // If the closest candle is more than 2 intervals away, it's not a good match
          if (minDiff > intervalMs * 2) {
            console.warn(`Trade marker may be inaccurate. Closest candle is ${Math.round(minDiff / 60000)} minutes away.`);
          }
          
          return closestIdx;
        };
        
        // Default candles (in case timestamps are missing)
        let entryCandle = candles[candles.length - 20] || candles[0];
        let exitCandle = candles[candles.length - 1];
        
        if (entryTime) {
          // Find the candle CLOSEST to entry time
          const entryCandleIdx = findClosestCandle(entryTime);
          entryCandle = candles[entryCandleIdx];
          
          // Log for debugging
          console.log('📍 Entry placement:', {
            tradeTime: new Date(entryTime).toLocaleString(),
            candleTime: new Date(entryCandle.time).toLocaleString(),
            diffMinutes: Math.round(Math.abs(entryCandle.time - entryTime) / 60000)
          });
        }
        
        if (exitTime) {
          // Find the candle CLOSEST to exit time
          const exitCandleIdx = findClosestCandle(exitTime);
          exitCandle = candles[exitCandleIdx];
          
          console.log('📤 Exit placement:', {
            tradeTime: new Date(exitTime).toLocaleString(),
            candleTime: new Date(exitCandle.time).toLocaleString(),
            diffMinutes: Math.round(Math.abs(exitCandle.time - exitTime) / 60000)
          });
        } else {
          // If no exit time, use the last candle (current)
          exitCandle = candles[candles.length - 1];
        }

        // For open trades always use the last candle close (live Binance price),
        // not trade.currentPrice which can be stale if the server is behind.
        const actualExitPrice = isOpen ? exitCandle.close : (exitPrice ?? exitCandle.close);
        setLiveExitPrice(actualExitPrice);
        const isProfitable = type === 'long' 
          ? actualExitPrice > entryPrice 
          : actualExitPrice < entryPrice;
        
        // Create line series for the trade connection
        const tradeLineSeries = chart.addSeries(LineSeries, {
          color: isProfitable ? '#10b981' : '#ef4444',
          lineWidth: 2,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        });

        // Set line data
        tradeLineSeries.setData([
          { time: (entryCandle.time / 1000) as Time, value: entryPrice },
          { time: (exitCandle.time / 1000) as Time, value: actualExitPrice },
        ]);

        // Add markers for entry and exit points
        const markers: Array<{
          time: Time;
          position: 'aboveBar' | 'belowBar';
          color: string;
          shape: 'circle' | 'arrowUp' | 'arrowDown';
          text: string;
          size: number;
        }> = [];

        // Entry marker
        markers.push({
          time: (entryCandle.time / 1000) as Time,
          position: type === 'long' ? 'belowBar' : 'aboveBar',
          color: '#f59e0b',
          shape: type === 'long' ? 'arrowUp' : 'arrowDown',
          text: `Entry: $${entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`,
          size: 2,
        });

        // Exit marker
        markers.push({
          time: (exitCandle.time / 1000) as Time,
          position: type === 'long' ? 'aboveBar' : 'belowBar',
          color: isOpen ? '#3b82f6' : (isProfitable ? '#10b981' : '#ef4444'),
          shape: 'circle',
          text: isOpen 
            ? `Now: $${actualExitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` 
            : `Exit: $${actualExitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`,
          size: 2,
        });

        createSeriesMarkers(candleSeries, markers);

        // Calculate P&L for display
        const pnlPercent = type === 'long'
          ? ((actualExitPrice - entryPrice) / entryPrice) * 100
          : ((entryPrice - actualExitPrice) / entryPrice) * 100;
        
        // Store for legend
        (window as unknown as Record<string, unknown>).__tradeInfo = {
          entryPrice,
          exitPrice: actualExitPrice,
          pnlPercent,
          isProfitable,
          isOpen,
          type
        };
      }

      // Set last price info
      const last = candles[candles.length - 1];
      const first = candles[0];
      setLastPrice({
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
      setPriceChange(((last.close - first.close) / first.close) * 100);

      chart.timeScale().fitContent();
      setLoading(false);
    });

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol, activeInterval, priceLines, tradeMarker]);

  const baseCoin = symbol.replace('USDT', '');

  // Build legend for price lines
  const hasLines = priceLines && priceLines.length > 0;
  const hasTrade = !!tradeMarker;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-gray-800">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gray-800 flex items-center justify-center text-[10px] sm:text-xs font-bold text-amber-400 border border-gray-700">
              {baseCoin.slice(0, 4)}
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white">
                {baseCoin}<span className="text-gray-500">/USDT</span>
              </h3>
              {lastPrice && (
                <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                  <span className="font-mono text-white font-medium">
                    ${lastPrice.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
                  </span>
                  <span className={priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* OHLC Info */}
          {lastPrice && (
            <div className="hidden md:flex items-center gap-4 text-xs text-gray-400">
              <span>O: <span className="text-white font-mono">{lastPrice.open}</span></span>
              <span>H: <span className="text-emerald-400 font-mono">{lastPrice.high}</span></span>
              <span>L: <span className="text-red-400 font-mono">{lastPrice.low}</span></span>
              <span>C: <span className="text-white font-mono">{lastPrice.close}</span></span>
            </div>
          )}

          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning if trade is out of range */}
        {tradeOutOfRange && (
          <div className="px-3 sm:px-4 py-2 border-b bg-amber-500/10 border-amber-500/30 flex items-center gap-2 text-xs sm:text-sm text-amber-400">
            <span>⚠️</span>
            <span>Η είσοδος/έξοδος είναι εκτός εμβέλειας. Δοκίμασε μεγαλύτερο timeframe (1D, 1W) για να δεις σωστά τα markers.</span>
          </div>
        )}

        {/* Trade info banner (if trade marker exists) */}
        {hasTrade && tradeMarker && (() => {
          // For open trades use the live price from the chart candles; fall back to prop while loading
          const displayPrice = tradeMarker.isOpen
            ? (liveExitPrice ?? tradeMarker.exitPrice)
            : tradeMarker.exitPrice;
          const isProfitBanner = displayPrice != null && (
            tradeMarker.type === 'long'
              ? displayPrice > tradeMarker.entryPrice
              : displayPrice < tradeMarker.entryPrice
          );
          return (
            <div className={`px-3 sm:px-4 py-2 border-b flex items-center justify-between text-xs sm:text-sm ${
              tradeMarker.isOpen
                ? 'bg-blue-500/10 border-blue-500/30'
                : isProfitBanner
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="flex items-center gap-4 flex-wrap">
                <span className={`font-semibold ${tradeMarker.type === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tradeMarker.type === 'long' ? '📈 LONG' : '📉 SHORT'}
                </span>
                <span className="text-gray-300">
                  Entry: <span className="text-amber-400 font-mono">${tradeMarker.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
                </span>
                {displayPrice != null && (
                  <span className="text-gray-300">
                    {tradeMarker.isOpen ? 'Current' : 'Exit'}: <span className={`font-mono ${isProfitBanner ? 'text-emerald-400' : 'text-red-400'}`}>
                      ${displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    </span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {tradeMarker.isOpen ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    LIVE
                  </span>
                ) : displayPrice != null && (
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    isProfitBanner ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {(() => {
                      const pnl = tradeMarker.type === 'long'
                        ? ((displayPrice - tradeMarker.entryPrice) / tradeMarker.entryPrice) * 100
                        : ((tradeMarker.entryPrice - displayPrice) / tradeMarker.entryPrice) * 100;
                      return `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
                    })()}
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Price lines legend + Interval selector */}
        <div className="flex items-center gap-1 px-3 sm:px-4 py-2 border-b border-gray-800 bg-gray-900/50 overflow-x-auto">
          {INTERVALS.map((int) => (
            <button
              key={int.value}
              onClick={() => setActiveInterval(int.value)}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                activeInterval === int.value
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {int.label}
            </button>
          ))}

          {/* Price lines legend */}
          {hasLines && (
            <div className="ml-auto flex items-center gap-3">
              {priceLines!.map((pl, idx) => (
                <span key={idx} className="flex items-center gap-1.5 text-[10px] sm:text-xs whitespace-nowrap">
                  <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: pl.color }} />
                  <span style={{ color: pl.color }}>{pl.title}: ${pl.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</span>
                </span>
              ))}
            </div>
          )}

          {!hasLines && !hasTrade && (
            <span className="ml-auto text-[10px] sm:text-xs text-gray-600 whitespace-nowrap">📡 Binance Data</span>
          )}

          {hasTrade && (
            <span className="ml-auto text-[10px] sm:text-xs text-gray-500 whitespace-nowrap">
              ↗️ Entry → {tradeMarker?.isOpen ? 'Current' : 'Exit'} (dashed line)
            </span>
          )}
        </div>

        {/* Chart */}
        <div className="flex-1 relative min-h-0">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-10">
              <div className="flex items-center gap-3 text-amber-400">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-sm">Loading chart...</span>
              </div>
            </div>
          )}
          <div ref={chartContainerRef} className="w-full h-full" />
        </div>

        {/* Footer */}
        <div className="px-3 sm:px-4 py-2 border-t border-gray-800 text-center">
          <p className="text-[10px] sm:text-[11px] text-gray-600">
            📊 {symbol} • {INTERVALS.find(i => i.value === activeInterval)?.label} Chart • Data from Binance
            {hasLines && ' • Entry/SL/TP lines shown'}
            {hasTrade && ' • Trade entry→exit connected'}
            {' • Click outside or ✕ to close'}
          </p>
        </div>
      </div>
    </div>
  );
}
