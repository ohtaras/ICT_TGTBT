import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart, IChartApi, ISeriesApi,
  CandlestickSeries, HistogramSeries, LineSeries,
  CandlestickData, Time, ColorType, LineStyle,
  createSeriesMarkers,
} from 'lightweight-charts';
import { fetchCandles } from '../api/binance';
import { Loader2, X } from 'lucide-react';

export interface PriceLine {
  price: number;
  color: string;
  title: string;
  lineStyle?: number;
}

export interface TradeMarker {
  entryTime?: number;
  entryPrice: number;
  exitTime?: number;
  exitPrice?: number;
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
  { label: '1m', value: '1m', ms: 60_000 },
  { label: '5m', value: '5m', ms: 300_000 },
  { label: '15m', value: '15m', ms: 900_000 },
  { label: '1H', value: '1h', ms: 3_600_000 },
  { label: '4H', value: '4h', ms: 14_400_000 },
  { label: '1D', value: '1d', ms: 86_400_000 },
  { label: '1W', value: '1w', ms: 604_800_000 },
];

function getOptimalInterval(entryTime?: number, exitTime?: number): string {
  if (!entryTime) return '1h';
  const dur = (exitTime || Date.now()) - entryTime;
  if (dur < 3_600_000)    return '1m';
  if (dur < 18_000_000)   return '5m';
  if (dur < 43_200_000)   return '15m';
  if (dur < 172_800_000)  return '1h';
  if (dur < 604_800_000)  return '4h';
  if (dur < 2_592_000_000) return '1d';
  return '1w';
}

export default function CandlestickChart({ symbol, onClose, priceLines, tradeMarker }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef          = useRef<IChartApi | null>(null);
  const candleRef         = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef         = useRef<ISeriesApi<'Histogram'> | null>(null);
  const tradeLineRef      = useRef<ISeriesApi<'Line'> | null>(null);
  const firstLoadRef      = useRef(true);

  const initialInterval = tradeMarker?.entryTime
    ? getOptimalInterval(tradeMarker.entryTime, tradeMarker.exitTime)
    : '1h';

  const [activeInterval, setActiveInterval] = useState(initialInterval);
  const [loading, setLoading]               = useState(true);
  const [lastPrice, setLastPrice]           = useState<{ open: number; high: number; low: number; close: number } | null>(null);
  const [priceChange, setPriceChange]       = useState(0);
  const [tradeOutOfRange, setTradeOutOfRange] = useState(false);
  const [liveExitPrice, setLiveExitPrice]   = useState<number | null>(null);
  const [refreshKey, setRefreshKey]         = useState(0);

  // Auto-refresh timer
  useEffect(() => {
    const ms = INTERVALS.find(i => i.value === activeInterval)?.ms ?? 3_600_000;
    const every = ms <= 900_000 ? 30_000 : 60_000;
    const t = setInterval(() => setRefreshKey(k => k + 1), every);
    return () => clearInterval(t);
  }, [activeInterval]);

  // ── Chart creation — only when symbol / interval / decorations change ──
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }
    firstLoadRef.current = true;

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0f' },
        textColor: '#9ca3af',
        fontSize: 12,
      },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair: {
        vertLine: { color: '#f59e0b', width: 1, style: 2, labelBackgroundColor: '#f59e0b' },
        horzLine: { color: '#f59e0b', width: 1, style: 2, labelBackgroundColor: '#f59e0b' },
      },
      rightPriceScale: { borderColor: '#374151', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false },
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chartRef.current = chart;

    const cs = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });
    candleRef.current = cs;

    const vs = chart.addSeries(HistogramSeries, {
      color: '#374151', priceFormat: { type: 'volume' }, priceScaleId: 'volume',
    });
    vs.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeRef.current = vs;

    if (priceLines?.length) {
      for (const pl of priceLines) {
        cs.createPriceLine({
          price: pl.price, color: pl.color, lineWidth: 2,
          lineStyle: pl.lineStyle ?? 2, axisLabelVisible: true, title: pl.title,
        });
      }
    }

    if (tradeMarker) {
      tradeLineRef.current = chart.addSeries(LineSeries, {
        color: '#6b7280', lineWidth: 2, lineStyle: LineStyle.Dashed,
        crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false,
      });
    } else {
      tradeLineRef.current = null;
    }

    const ro = new ResizeObserver(entries => {
      for (const e of entries) chart.applyOptions({ width: e.contentRect.width, height: e.contentRect.height });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      tradeLineRef.current = null;
    };
  }, [symbol, activeInterval, priceLines, tradeMarker]);

  // ── Data loading — updates series in-place (no chart recreate = no flicker) ──
  const loadCandles = useCallback(async () => {
    const cs = candleRef.current;
    const vs = volumeRef.current;
    if (!cs || !vs) return;

    if (firstLoadRef.current) setLoading(true);

    const candles = await fetchCandles(symbol, activeInterval, 500);
    if (!candles.length) { setLoading(false); return; }

    // Capture current view before setData() — lightweight-charts auto-scrolls on data update
    const savedRange = firstLoadRef.current
      ? null
      : chartRef.current?.timeScale().getVisibleRange() ?? null;

    cs.setData(candles.map(c => ({
      time: (c.time / 1000) as Time,
      open: c.open, high: c.high, low: c.low, close: c.close,
    })) as CandlestickData<Time>[]);

    vs.setData(candles.map(c => ({
      time: (c.time / 1000) as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
    })));

    // Update trade line + markers in-place
    const tls = tradeLineRef.current;
    if (tradeMarker && tls) {
      const { entryTime, entryPrice, exitTime, exitPrice, type, isOpen } = tradeMarker;
      const first = candles[0].time, last = candles[candles.length - 1].time;
      setTradeOutOfRange(!!(
        (entryTime && (entryTime < first || entryTime > last)) ||
        (exitTime  && (exitTime  < first || exitTime  > last))
      ));

      const ivMs = INTERVALS.find(iv => iv.value === activeInterval)?.ms ?? 3_600_000;
      const closest = (ts: number) => {
        let idx = 0, min = Math.abs(candles[0].time - ts);
        for (let i = 1; i < candles.length; i++) {
          const d = Math.abs(candles[i].time - ts);
          if (d < min) { min = d; idx = i; }
        }
        if (min > ivMs * 2) console.warn(`Marker ~${Math.round(min / 60000)}min off`);
        return candles[idx];
      };

      const entryCandle = entryTime ? closest(entryTime) : (candles[candles.length - 20] || candles[0]);
      const exitCandle  = exitTime  ? closest(exitTime)  : candles[candles.length - 1];
      const actualExit  = isOpen ? exitCandle.close : (exitPrice ?? exitCandle.close);
      setLiveExitPrice(actualExit);

      const profit = type === 'long' ? actualExit > entryPrice : actualExit < entryPrice;
      tls.applyOptions({ color: profit ? '#10b981' : '#ef4444' });
      tls.setData([
        { time: (entryCandle.time / 1000) as Time, value: entryPrice },
        { time: (exitCandle.time  / 1000) as Time, value: actualExit },
      ]);

      const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
      createSeriesMarkers(cs, [
        {
          time: (entryCandle.time / 1000) as Time,
          position: type === 'long' ? 'belowBar' : 'aboveBar',
          color: '#f59e0b', shape: type === 'long' ? 'arrowUp' : 'arrowDown',
          text: `Entry: $${fmt(entryPrice)}`, size: 2,
        },
        {
          time: (exitCandle.time / 1000) as Time,
          position: type === 'long' ? 'aboveBar' : 'belowBar',
          color: isOpen ? '#3b82f6' : (profit ? '#10b981' : '#ef4444'),
          shape: 'circle',
          text: isOpen ? `Now: $${fmt(actualExit)}` : `Exit: $${fmt(actualExit)}`, size: 2,
        },
      ]);
    }

    const last = candles[candles.length - 1];
    setLastPrice({ open: last.open, high: last.high, low: last.low, close: last.close });
    setPriceChange(((last.close - candles[0].close) / candles[0].close) * 100);

    if (firstLoadRef.current) {
      chartRef.current?.timeScale().fitContent();
      firstLoadRef.current = false;
    } else if (savedRange) {
      // Restore exactly where the user was before the data refresh
      chartRef.current?.timeScale().setVisibleRange(savedRange);
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, activeInterval, tradeMarker, refreshKey]);

  useEffect(() => { loadCandles(); }, [loadCandles]);

  const baseCoin  = symbol.replace('USDT', '');
  const hasLines  = !!priceLines?.length;
  const hasTrade  = !!tradeMarker;
  const ivMs      = INTERVALS.find(i => i.value === activeInterval)?.ms ?? 3_600_000;
  const ivLabel   = INTERVALS.find(i => i.value === activeInterval)?.label ?? activeInterval;

  return (
    // Bottom-sheet on mobile, centered dialog on sm+
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border-t sm:border border-gray-700 rounded-t-2xl sm:rounded-2xl w-full max-w-6xl h-[95svh] sm:h-[90vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-gray-800 shrink-0">
          {/* Drag handle (mobile) */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-gray-700 rounded-full sm:hidden" />

          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gray-800 flex items-center justify-center text-[9px] sm:text-xs font-bold text-amber-400 border border-gray-700 shrink-0">
              {baseCoin.slice(0, 4)}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-lg font-bold text-white truncate">
                {baseCoin}<span className="text-gray-500">/USDT</span>
              </h3>
              {lastPrice && (
                <div className="flex items-center gap-2 text-xs sm:text-sm">
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

          {/* OHLC (hidden on smallest screens) */}
          {lastPrice && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-gray-400">
              <span>O: <span className="text-white font-mono">{lastPrice.open}</span></span>
              <span>H: <span className="text-emerald-400 font-mono">{lastPrice.high}</span></span>
              <span>L: <span className="text-red-400 font-mono">{lastPrice.low}</span></span>
              <span>C: <span className="text-white font-mono">{lastPrice.close}</span></span>
            </div>
          )}

          <button
            onClick={onClose}
            className="p-2.5 rounded-xl hover:bg-gray-800 text-gray-400 hover:text-white transition-colors shrink-0 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warnings */}
        {tradeOutOfRange && (
          <div className="px-3 sm:px-4 py-2 border-b bg-amber-500/10 border-amber-500/30 flex items-center gap-2 text-xs text-amber-400 shrink-0">
            ⚠️ Η είσοδος/έξοδος είναι εκτός εμβέλειας. Δοκίμασε μεγαλύτερο timeframe.
          </div>
        )}

        {/* Trade info banner */}
        {hasTrade && tradeMarker && (() => {
          const displayPrice = tradeMarker.isOpen ? (liveExitPrice ?? tradeMarker.exitPrice) : tradeMarker.exitPrice;
          const profit = displayPrice != null && (
            tradeMarker.type === 'long' ? displayPrice > tradeMarker.entryPrice : displayPrice < tradeMarker.entryPrice
          );
          return (
            <div className={`px-3 sm:px-4 py-2 border-b flex items-center justify-between text-xs shrink-0 ${
              tradeMarker.isOpen ? 'bg-blue-500/10 border-blue-500/30'
              : profit ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`font-semibold ${tradeMarker.type === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {tradeMarker.type === 'long' ? '📈 LONG' : '📉 SHORT'}
                </span>
                <span className="text-gray-300">
                  Entry: <span className="text-amber-400 font-mono">${tradeMarker.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
                </span>
                {displayPrice != null && (
                  <span className="text-gray-300">
                    {tradeMarker.isOpen ? 'Now' : 'Exit'}: <span className={`font-mono ${profit ? 'text-emerald-400' : 'text-red-400'}`}>
                      ${displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    </span>
                  </span>
                )}
              </div>
              <div>
                {tradeMarker.isOpen ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />LIVE
                  </span>
                ) : displayPrice != null && (
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${profit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                    {(() => {
                      const pct = tradeMarker.type === 'long'
                        ? ((displayPrice - tradeMarker.entryPrice) / tradeMarker.entryPrice) * 100
                        : ((tradeMarker.entryPrice - displayPrice) / tradeMarker.entryPrice) * 100;
                      return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                    })()}
                  </span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Interval selector + legend */}
        <div className="flex items-center gap-1 px-3 sm:px-4 py-2 border-b border-gray-800 bg-gray-900/50 overflow-x-auto shrink-0">
          {INTERVALS.map((int) => (
            <button
              key={int.value}
              onClick={() => setActiveInterval(int.value)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap min-w-[36px] ${
                activeInterval === int.value
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {int.label}
            </button>
          ))}

          {hasLines && (
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              {priceLines!.map((pl, i) => (
                <span key={i} className="flex items-center gap-1.5 text-[10px] sm:text-xs whitespace-nowrap">
                  <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: pl.color }} />
                  <span style={{ color: pl.color }}>{pl.title}: ${pl.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}</span>
                </span>
              ))}
            </div>
          )}
          {!hasLines && !hasTrade && (
            <span className="ml-auto text-[10px] sm:text-xs text-gray-600 whitespace-nowrap flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              Live · Binance
            </span>
          )}
          {hasTrade && (
            <span className="ml-auto text-[10px] sm:text-xs text-gray-500 whitespace-nowrap">
              ↗️ Entry → {tradeMarker?.isOpen ? 'Now' : 'Exit'}
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
        <div className="px-3 sm:px-4 py-2 border-t border-gray-800 text-center shrink-0">
          <p className="text-[10px] sm:text-[11px] text-gray-600">
            {symbol} · {ivLabel} · Live Binance · auto-refresh {ivMs <= 900_000 ? '30s' : '60s'} · Tap outside or ✕ to close
          </p>
        </div>
      </div>
    </div>
  );
}
