import { useState, useMemo } from 'react';
import { Signal, Settings, TradingPair } from '../types';
import CandlestickChart, { PriceLine } from '../components/CandlestickChart';
import { Radio, Clock, ArrowUpRight, ArrowDownRight, BarChart3, XCircle, ChevronDown, ChevronRight, Eye, EyeOff, Trash2, DollarSign, TrendingUp } from 'lucide-react';

interface SignalsProps {
  signals: Signal[];
  settings: Settings;
  pairs: TradingPair[];
  onDeleteSignal: (id: string) => void;
}

// Calculate risk-based position sizing
function calculateRiskMetrics(signal: Signal, settings: Settings) {
  const balance = settings.initialBalance || 10000;
  const riskPercent = settings.riskPerTrade || 1.5;
  
  // Risk amount in dollars
  const riskAmount = balance * (riskPercent / 100);
  
  // Distance from entry to SL (as percentage)
  const slDistance = Math.abs(signal.entry - signal.sl);
  const slDistancePercent = (slDistance / signal.entry) * 100;
  
  // Position size = Risk Amount / SL Distance %
  const positionSize = slDistancePercent > 0 ? riskAmount / (slDistancePercent / 100) : 0;
  
  // Potential profit (if TP hit)
  const tpDistance = Math.abs(signal.tp - signal.entry);
  const potentialProfit = (tpDistance / signal.entry) * positionSize;
  
  // Potential loss (if SL hit) = Risk Amount (by definition)
  const potentialLoss = riskAmount;
  
  return {
    positionSize,
    potentialProfit,
    potentialLoss,
    riskAmount,
  };
}

// Group signals by date
function groupByDate<T extends { timestamp: number }>(items: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  items.forEach((item) => {
    const dateKey = new Date(item.timestamp).toLocaleDateString('el-GR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(item);
  });
  return groups;
}

export default function Signals({ signals, settings, pairs, onDeleteSignal }: SignalsProps) {
  const priceMap = useMemo(
    () => new Map(pairs.map(p => [p.symbol, p.currentPrice])),
    [pairs]
  );
  const pendingSignals = signals.filter((s) => s.status === 'pending');
  const triggeredSignals = signals.filter((s) => s.status === 'triggered');
  const expiredSignals = signals.filter((s) => s.status === 'expired');
  const rejectedSignals = signals.filter((s) => s.status === 'rejected');

  // Visibility toggles
  const [showPending, setShowPending] = useState(true);
  const [showTriggered, setShowTriggered] = useState(true);
  const [showExpired, setShowExpired] = useState(true);
  const [showRejected, setShowRejected] = useState(true);

  // Chart state
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [chartLines, setChartLines] = useState<PriceLine[]>([]);

  const openSignalChart = (sig: Signal) => {
    const lines: PriceLine[] = [
      { price: sig.entry, color: '#f59e0b', title: '📍 Entry' },
      { price: sig.sl, color: '#ef4444', title: '🛑 Stop Loss' },
      { price: sig.tp, color: '#10b981', title: '🎯 Take Profit' },
    ];
    setChartLines(lines);
    setChartSymbol(sig.pair);
  };

  return (
    <div className="space-y-4">
      {/* Chart Modal */}
      {chartSymbol && (
        <CandlestickChart
          symbol={chartSymbol}
          onClose={() => { setChartSymbol(null); setChartLines([]); }}
          priceLines={chartLines}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Radio className="w-6 h-6 text-amber-400" />
        <h2 className="text-xl font-bold">ICT Signals</h2>
        <span className="text-sm text-gray-500">({signals.length} total)</span>
      </div>

      {/* Category Toggles */}
      <div className="flex flex-wrap gap-2 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
        <span className="text-xs text-gray-400 mr-2">Εμφάνιση:</span>
        <ToggleButton label="⏳ Pending" count={pendingSignals.length} active={showPending} onClick={() => setShowPending(!showPending)} color="yellow" />
        <ToggleButton label="✅ Triggered" count={triggeredSignals.length} active={showTriggered} onClick={() => setShowTriggered(!showTriggered)} color="blue" />
        <ToggleButton label="⌛ Expired" count={expiredSignals.length} active={showExpired} onClick={() => setShowExpired(!showExpired)} color="gray" />
        <ToggleButton label="🚫 Rejected" count={rejectedSignals.length} active={showRejected} onClick={() => setShowRejected(!showRejected)} color="red" />
      </div>

      {/* Pending Signals */}
      {showPending && (
        <CollapsibleSection
          title="⏳ Pending"
          count={pendingSignals.length}
          color="yellow"
          defaultOpen={true}
        >
          {pendingSignals.length === 0 ? (
            <EmptyState text="No pending signals. Engine is scanning..." />
          ) : (
            <SignalsByDate
              signals={pendingSignals}
              settings={settings}
              priceMap={priceMap}
              onOpenChart={openSignalChart}
              onDelete={onDeleteSignal}
            />
          )}
        </CollapsibleSection>
      )}

      {/* Triggered Signals */}
      {showTriggered && (
        <CollapsibleSection
          title="✅ Triggered (Became Trades)"
          count={triggeredSignals.length}
          color="blue"
          defaultOpen={true}
        >
          {triggeredSignals.length === 0 ? (
            <EmptyState text="No triggered signals yet." />
          ) : (
            <SignalsByDate
              signals={triggeredSignals}
              settings={settings}
              priceMap={priceMap}
              onOpenChart={openSignalChart}
              onDelete={onDeleteSignal}
            />
          )}
        </CollapsibleSection>
      )}

      {/* Expired */}
      {showExpired && (
        <CollapsibleSection
          title="⌛ Expired"
          count={expiredSignals.length}
          color="gray"
          defaultOpen={false}
        >
          {expiredSignals.length === 0 ? (
            <EmptyState text="No expired signals." />
          ) : (
            <SignalsByDate
              signals={expiredSignals}
              settings={settings}
              priceMap={priceMap}
              onOpenChart={openSignalChart}
              onDelete={onDeleteSignal}
            />
          )}
        </CollapsibleSection>
      )}

      {/* Rejected */}
      {showRejected && (
        <CollapsibleSection
          title="🚫 Rejected (Υπήρχε Ανοιχτή Θέση)"
          count={rejectedSignals.length}
          color="red"
          defaultOpen={false}
        >
          {rejectedSignals.length === 0 ? (
            <EmptyState text="No rejected signals." />
          ) : (
            <SignalsByDate
              signals={rejectedSignals}
              settings={settings}
              priceMap={priceMap}
              onOpenChart={openSignalChart}
              onDelete={onDeleteSignal}
            />
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}

// Toggle button for category visibility
function ToggleButton({ label, count, active, onClick, color }: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    yellow: active ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' : 'bg-gray-800 border-gray-700 text-gray-500',
    blue: active ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-500',
    gray: active ? 'bg-gray-600/20 border-gray-500/50 text-gray-300' : 'bg-gray-800 border-gray-700 text-gray-500',
    red: active ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-gray-800 border-gray-700 text-gray-500',
  };

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${colorClasses[color]}`}
    >
      {active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
      {label} ({count})
    </button>
  );
}

// Collapsible section with date grouping
function CollapsibleSection({
  title,
  count,
  color,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  color: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const colorMap: Record<string, string> = {
    yellow: 'border-yellow-500/20 bg-yellow-500/5',
    blue: 'border-blue-500/20 bg-blue-500/5',
    gray: 'border-gray-700 bg-gray-800/30',
    red: 'border-red-500/20 bg-red-500/5',
  };

  return (
    <div className={`rounded-xl border ${colorMap[color] || colorMap.gray}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors rounded-xl"
      >
        <h3 className="text-sm font-semibold text-gray-300">
          {title} ({count})
        </h3>
        {isOpen ? (
          <ChevronDown className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-500" />
        )}
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// Signals grouped by date with collapsible days
function SignalsByDate({
  signals,
  settings,
  priceMap,
  onOpenChart,
  onDelete,
}: {
  signals: Signal[];
  settings: Settings;
  priceMap: Map<string, number>;
  onOpenChart: (sig: Signal) => void;
  onDelete: (id: string) => void;
}) {
  const grouped = useMemo(() => groupByDate(signals), [signals]);
  const sortedDates = Object.keys(grouped).sort((a, b) => {
    // Sort by most recent first
    const dateA = grouped[a][0]?.timestamp || 0;
    const dateB = grouped[b][0]?.timestamp || 0;
    return dateB - dateA;
  });

  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  const toggleDay = (date: string) => {
    const newSet = new Set(collapsedDays);
    if (newSet.has(date)) {
      newSet.delete(date);
    } else {
      newSet.add(date);
    }
    setCollapsedDays(newSet);
  };

  return (
    <div className="space-y-3">
      {sortedDates.map((date) => (
        <div key={date} className="border border-gray-700/50 rounded-lg overflow-hidden">
          <button
            onClick={() => toggleDay(date)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
          >
            <span className="text-xs font-medium text-gray-400">
              📅 {date} ({grouped[date].length} signals)
            </span>
            {collapsedDays.has(date) ? (
              <ChevronRight className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-gray-500" />
            )}
          </button>
          {!collapsedDays.has(date) && (
            <div className="p-3 grid gap-3 sm:grid-cols-2">
              {grouped[date].map((sig) => (
                <SignalCard
                  key={sig.id}
                  signal={sig}
                  settings={settings}
                  currentPrice={priceMap.get(sig.pair) ?? 0}
                  onClick={() => onOpenChart(sig)}
                  onDelete={() => onDelete(sig.id)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SignalCard({
  signal,
  settings,
  currentPrice,
  onClick,
  onDelete,
}: {
  signal: Signal;
  settings: Settings;
  currentPrice: number;
  onClick: () => void;
  onDelete: () => void;
}) {
  const isBull = signal.type === 'BULLISH';
  const riskReward = Math.abs((signal.tp - signal.entry) / (signal.entry - signal.sl)).toFixed(1);
  const metrics = calculateRiskMetrics(signal, settings);

  const distToEntry = currentPrice > 0
    ? ((currentPrice - signal.entry) / signal.entry) * 100
    : null;

  return (
    <div
      className={`rounded-lg border p-4 transition-all hover:scale-[1.01] relative group ${
        isBull
          ? 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40'
          : 'border-red-500/20 bg-red-500/5 hover:border-red-500/40'
      }`}
    >
      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/30 text-red-400 opacity-0 group-hover:opacity-100 transition-all"
        title="Διαγραφή"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      {/* Clickable area for chart */}
      <div onClick={onClick} className="cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isBull ? (
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
            ) : (
              <ArrowDownRight className="w-4 h-4 text-red-400" />
            )}
            <span className="font-bold text-sm">{signal.pair}</span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded ${
                isBull ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {signal.type}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
              R:R {riskReward}
            </span>
          </div>
        </div>

        {/* Current price */}
        {currentPrice > 0 && (
          <div className="flex items-center gap-2 mb-2 text-xs">
            <TrendingUp className="w-3 h-3 text-gray-400" />
            <span className="text-gray-500">Τρέχουσα:</span>
            <span className="font-mono font-semibold text-white">
              ${currentPrice.toFixed(currentPrice < 1 ? 6 : 2)}
            </span>
            {distToEntry !== null && (
              <span className={`font-mono ${Math.abs(distToEntry) < 1 ? 'text-amber-400 font-bold' : distToEntry > 0 === isBull ? 'text-gray-400' : 'text-gray-500'}`}>
                ({distToEntry > 0 ? '+' : ''}{distToEntry.toFixed(2)}% vs entry)
              </span>
            )}
          </div>
        )}

        {/* Entry / SL / TP */}
        <div className="grid grid-cols-3 gap-2 text-xs mb-3">
          <div>
            <p className="text-gray-500">Entry</p>
            <p className="font-mono font-medium text-amber-400">${signal.entry.toFixed(signal.entry < 1 ? 6 : 2)}</p>
          </div>
          <div>
            <p className="text-gray-500">Stop Loss</p>
            <p className="font-mono font-medium text-red-400">${signal.sl.toFixed(signal.sl < 1 ? 6 : 2)}</p>
          </div>
          <div>
            <p className="text-gray-500">Take Profit</p>
            <p className="font-mono font-medium text-emerald-400">${signal.tp.toFixed(signal.tp < 1 ? 6 : 2)}</p>
          </div>
        </div>

        {/* Risk Metrics */}
        <div className="bg-gray-800/50 rounded-lg p-2 mb-3 border border-gray-700/50">
          <div className="flex items-center gap-1 text-xs text-gray-400 mb-2">
            <DollarSign className="w-3 h-3" />
            <span className="font-medium">Risk Analysis ({settings.riskPerTrade}% risk)</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-gray-500">Position Size</p>
              <p className="font-mono font-bold text-white">${metrics.positionSize.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500">Potential Profit</p>
              <p className="font-mono font-bold text-emerald-400">+${metrics.potentialProfit.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500">Potential Loss</p>
              <p className="font-mono font-bold text-red-400">-${metrics.potentialLoss.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Timestamps */}
        <div className="space-y-1 border-t border-gray-700/30 pt-2">
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="w-3 h-3" />
            🔍 Detected: <span className="text-gray-300">{new Date(signal.timestamp).toLocaleString('el-GR')}</span>
          </div>
          {signal.status === 'triggered' && signal.triggeredAt && (
            <div className="flex items-center gap-1 text-xs text-blue-400">
              ✅ Triggered: <span>{new Date(signal.triggeredAt).toLocaleString('el-GR')}</span>
            </div>
          )}
          {signal.status === 'expired' && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              ⌛ Expired {signal.expiredAt ? new Date(signal.expiredAt).toLocaleString('el-GR') : '(24h timeout)'}
            </div>
          )}
          {signal.status === 'rejected' && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-xs text-red-400">
                <XCircle className="w-3 h-3" />
                🚫 Rejected: <span>{signal.rejectedAt ? new Date(signal.rejectedAt).toLocaleString('el-GR') : 'N/A'}</span>
              </div>
              {signal.rejectionReason && (
                <div className="text-xs text-red-300 bg-red-500/10 px-2 py-1 rounded">
                  📋 Αιτία: {signal.rejectionReason}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-gray-500 italic">{text}</p>;
}
