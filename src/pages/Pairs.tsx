import { useState, useEffect, useRef, useCallback } from 'react';
import { TradingPair } from '../types';
import { fetchAllUsdtPairs } from '../api/binance';
import CandlestickChart from '../components/CandlestickChart';
import {
  Coins,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  ChevronDown,
  X,
  Loader2,
  BarChart3,
} from 'lucide-react';

interface PairsProps {
  pairs: TradingPair[];
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onToggle: (symbol: string) => void;
}

interface BinancePair {
  symbol: string;
  baseAsset: string;
}

// Popular coins to show at the top
const POPULAR_COINS = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX',
  'DOT', 'MATIC', 'LINK', 'UNI', 'ATOM', 'LTC', 'FIL',
  'NEAR', 'APT', 'ARB', 'OP', 'SUI', 'SEI', 'INJ', 'TIA',
  'PEPE', 'SHIB', 'WIF', 'BONK', 'FLOKI', 'RENDER', 'FET',
];

export default function Pairs({ pairs, onAdd, onRemove, onToggle }: PairsProps) {
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [workerStatus, setWorkerStatus] = useState<{ lastPriceCheckAt: number; lastICTScanAt: number } | null>(null);

  // Dropdown state
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allPairs, setAllPairs] = useState<BinancePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Already added symbols
  const addedSymbols = new Set(pairs.map(p => p.symbol));

  // Load all pairs from Binance
  const loadPairs = useCallback(async () => {
    if (loaded && allPairs.length > 0) return;
    setLoading(true);
    try {
      const result = await fetchAllUsdtPairs();
      setAllPairs(result);
      setLoaded(true);
    } catch {
      console.error('Failed to load pairs');
    }
    setLoading(false);
  }, [loaded, allPairs.length]);

  // Open dropdown
  const handleOpen = () => {
    setIsOpen(true);
    setSearchQuery('');
    loadPairs();
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  // Worker status polling
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/worker-status');
        if (res.ok) setWorkerStatus(await res.json());
      } catch { /* ignore */ }
    };
    fetchStatus();
    const t = setInterval(fetchStatus, 10_000);
    return () => clearInterval(t);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClick);
    }
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Filter pairs
  const filteredPairs = (() => {
    const q = searchQuery.toUpperCase().trim();

    if (!q) {
      // Show popular coins first, then the rest
      const popular: BinancePair[] = [];
      const rest: BinancePair[] = [];

      for (const p of allPairs) {
        if (POPULAR_COINS.includes(p.baseAsset)) {
          popular.push(p);
        } else {
          rest.push(p);
        }
      }

      // Sort popular by the order in POPULAR_COINS
      popular.sort((a, b) =>
        POPULAR_COINS.indexOf(a.baseAsset) - POPULAR_COINS.indexOf(b.baseAsset)
      );

      return [...popular, ...rest];
    }

    return allPairs.filter(
      p => p.baseAsset.includes(q) || p.symbol.includes(q)
    );
  })();

  const handleSelect = (symbol: string) => {
    onAdd(symbol);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Coins className="w-6 h-6 text-amber-400" />
        <h2 className="text-xl font-bold">Trading Pairs</h2>
        <span className="text-sm text-gray-500">({pairs.length} pairs)</span>
      </div>

      {/* Worker Status Bar */}
      {workerStatus && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-400">
          <span>
            <span className="text-gray-600">Τελευταία τιμές:</span>{' '}
            {workerStatus.lastPriceCheckAt > 0
              ? <span className={Date.now() - workerStatus.lastPriceCheckAt < 15_000 ? 'text-emerald-400' : 'text-red-400'}>
                  {Math.round((Date.now() - workerStatus.lastPriceCheckAt) / 1000)}s πριν
                </span>
              : <span className="text-red-400">Ποτέ — worker δεν τρέχει!</span>}
          </span>
          <span>
            <span className="text-gray-600">Τελευταίο scan:</span>{' '}
            {workerStatus.lastICTScanAt > 0
              ? <span className="text-gray-300">
                  {Math.round((Date.now() - workerStatus.lastICTScanAt) / 1000)}s πριν
                </span>
              : <span className="text-amber-400">Εκκρεμεί…</span>}
          </span>
        </div>
      )}

      {/* Add New Pair — Dropdown */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Add New Pair
        </h3>

        <div className="relative" ref={dropdownRef}>
          {/* Dropdown Trigger */}
          <button
            onClick={handleOpen}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-sm hover:border-amber-500/50 focus:border-amber-500 transition-colors"
          >
            <span className="text-gray-400 flex items-center gap-2">
              <Search className="w-4 h-4" />
              Search and select a trading pair...
            </span>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Panel */}
          {isOpen && (
            <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
              {/* Search Input */}
              <div className="p-3 border-b border-gray-700">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search coin... (BTC, SOL, DOGE...)"
                    className="w-full pl-10 pr-10 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-sm focus:outline-none focus:border-amber-500 transition-colors"
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Results Count */}
              <div className="px-3 py-2 border-b border-gray-700/50 bg-gray-800/50">
                <span className="text-xs text-gray-500">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading pairs from Binance...
                    </span>
                  ) : (
                    <>
                      {filteredPairs.length} pairs available
                      {!searchQuery && ' • Popular coins shown first'}
                    </>
                  )}
                </span>
              </div>

              {/* Pairs List */}
              <div className="max-h-72 overflow-y-auto overscroll-contain">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                  </div>
                ) : filteredPairs.length === 0 ? (
                  <div className="py-8 text-center text-gray-500 text-sm">
                    No pairs found for "{searchQuery}"
                  </div>
                ) : (
                  <>
                    {/* Popular section label */}
                    {!searchQuery && (
                      <div className="px-3 pt-2 pb-1">
                        <span className="text-[10px] font-semibold text-amber-400/70 uppercase tracking-widest">
                          ⭐ Popular
                        </span>
                      </div>
                    )}

                    {filteredPairs.map((pair, index) => {
                      const isAdded = addedSymbols.has(pair.symbol);
                      const isPopularBoundary =
                        !searchQuery &&
                        index > 0 &&
                        POPULAR_COINS.includes(filteredPairs[index - 1].baseAsset) &&
                        !POPULAR_COINS.includes(pair.baseAsset);

                      return (
                        <div key={pair.symbol}>
                          {/* Divider between popular and rest */}
                          {isPopularBoundary && (
                            <div className="px-3 pt-3 pb-1 border-t border-gray-700/50">
                              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                                All Pairs (A-Z)
                              </span>
                            </div>
                          )}

                          <button
                            onClick={() => !isAdded && handleSelect(pair.symbol)}
                            disabled={isAdded}
                            className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors ${
                              isAdded
                                ? 'opacity-40 cursor-not-allowed bg-gray-800/30'
                                : 'hover:bg-amber-500/10 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-[10px] font-bold text-amber-400 border border-gray-600">
                                {pair.baseAsset.slice(0, 4)}
                              </div>
                              <div className="text-left">
                                <p className="font-medium text-white">
                                  {pair.baseAsset}
                                  <span className="text-gray-500 font-normal">/USDT</span>
                                </p>
                                <p className="text-[11px] text-gray-500">{pair.symbol}</p>
                              </div>
                            </div>

                            {isAdded ? (
                              <span className="text-[11px] text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">
                                ✓ Added
                              </span>
                            ) : (
                              <span className="text-[11px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100">
                                <Plus className="w-3 h-3 inline" /> Add
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="px-3 py-2 border-t border-gray-700 bg-gray-800/80">
                <p className="text-[11px] text-gray-500 text-center">
                  Data from Binance • Click a pair to add it
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500 mt-2">
          Click to browse {loaded ? `${allPairs.length}` : 'all'} available USDT pairs from Binance.
        </p>
      </div>

      {/* Pairs List */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Your Pairs <span className="text-gray-600 text-xs font-normal ml-2">📊 Click a pair to view chart</span>
        </h3>
        {pairs.length === 0 ? (
          <div className="text-center py-8">
            <Coins className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No pairs added yet.</p>
            <p className="text-gray-600 text-xs mt-1">Click "Search and select" above to add pairs.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pairs.map((pair) => (
              <div
                key={pair.symbol}
                className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                  pair.enabled
                    ? 'border-gray-700 bg-gray-800/30 hover:border-amber-500/30'
                    : 'border-gray-800 bg-gray-900/50 opacity-60'
                }`}
              >
                {/* Clickable area — opens chart */}
                <button
                  onClick={() => setChartSymbol(pair.symbol)}
                  className="flex items-center gap-3 text-left flex-1 min-w-0 group"
                >
                  <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold text-amber-400 border border-gray-700 group-hover:border-amber-500/50 transition-colors">
                    {pair.symbol.replace('USDT', '').slice(0, 4)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{pair.symbol}</p>
                      <BarChart3 className="w-3.5 h-3.5 text-gray-600 group-hover:text-amber-400 transition-colors" />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      {pair.currentPrice > 0 ? (
                        <>
                          <span className="font-mono text-white">
                            ${pair.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                          </span>
                          <span className={`flex items-center gap-0.5 ${pair.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pair.change24h >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {Math.abs(pair.change24h).toFixed(2)}%
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-600 animate-pulse">Loading…</span>
                      )}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  {/* Toggle */}
                  <button
                    onClick={() => onToggle(pair.symbol)}
                    className="p-2 rounded-lg hover:bg-gray-700 transition-colors"
                    title={pair.enabled ? 'Disable' : 'Enable'}
                  >
                    {pair.enabled ? (
                      <ToggleRight className="w-6 h-6 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-gray-500" />
                    )}
                  </button>

                  {/* Delete */}
                  {showConfirm === pair.symbol ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          onRemove(pair.symbol);
                          setShowConfirm(null);
                        }}
                        className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setShowConfirm(null)}
                        className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowConfirm(pair.symbol)}
                      className="p-2 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                      title="Remove pair"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chart Modal */}
      {chartSymbol && (
        <CandlestickChart
          symbol={chartSymbol}
          onClose={() => setChartSymbol(null)}
        />
      )}
    </div>
  );
}
