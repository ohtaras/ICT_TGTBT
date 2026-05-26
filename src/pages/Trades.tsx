import { useState, useMemo } from 'react';
import { Trade, Settings } from '../types';
import CandlestickChart, { PriceLine, TradeMarker } from '../components/CandlestickChart';
import { ArrowLeftRight, TrendingUp, TrendingDown, Clock, Calendar, BarChart3, ChevronDown, ChevronRight, Trash2, DollarSign, Eye, EyeOff } from 'lucide-react';

function formatDateTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(openTime: number, closeTime?: number): string {
  const end = closeTime || Date.now();
  const diff = end - openTime;
  if (diff < 0) return '—';
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

// Calculate risk-based metrics for a trade
function calculateTradeRiskMetrics(trade: Trade, settings: Settings) {
  const balance = settings.initialBalance || 10000;
  const riskPercent = settings.riskPerTrade || 1.5;
  
  // Risk amount in dollars
  const riskAmount = balance * (riskPercent / 100);
  
  // Distance from entry to SL (as percentage)
  const slDistance = Math.abs(trade.entryPrice - trade.sl);
  const slDistancePercent = (slDistance / trade.entryPrice) * 100;
  
  // Position size = Risk Amount / SL Distance %
  const positionSize = slDistancePercent > 0 ? riskAmount / (slDistancePercent / 100) : 0;
  
  // Potential profit (if TP hit)
  const tpDistance = Math.abs(trade.tp - trade.entryPrice);
  const potentialProfit = (tpDistance / trade.entryPrice) * positionSize;
  
  // Potential loss (if SL hit) = Risk Amount (by definition)
  const potentialLoss = riskAmount;
  
  return {
    positionSize,
    potentialProfit,
    potentialLoss,
    riskAmount,
  };
}

// Group trades by date (using openTime for open trades, closeTime for closed)
function groupTradesByDate(trades: Trade[], useCloseTime: boolean = false): Record<string, Trade[]> {
  const groups: Record<string, Trade[]> = {};
  trades.forEach((trade) => {
    const timestamp = useCloseTime && trade.closeTime ? trade.closeTime : trade.openTime;
    const dateKey = new Date(timestamp).toLocaleDateString('el-GR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(trade);
  });
  return groups;
}

interface TradesProps {
  trades: Trade[];
  settings: Settings;
  onCloseTrade: (id: string) => void;
  onDeleteTrade: (id: string) => void;
}

export default function Trades({ trades, settings, onCloseTrade, onDeleteTrade }: TradesProps) {
  const openTrades = trades.filter((t) => t.status === 'open');
  const closedTrades = trades.filter((t) => t.status !== 'open');

  // Visibility toggles
  const [showOpen, setShowOpen] = useState(true);
  const [showWon, setShowWon] = useState(true);
  const [showLost, setShowLost] = useState(true);
  const [showManual, setShowManual] = useState(true);

  // Chart state
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [chartLines, setChartLines] = useState<PriceLine[]>([]);
  const [chartTradeMarker, setChartTradeMarker] = useState<TradeMarker | undefined>(undefined);

  const openTradeChart = (trade: Trade) => {
    const lines: PriceLine[] = [
      { price: trade.entryPrice, color: '#f59e0b', title: '📍 Entry' },
      { price: trade.sl, color: '#ef4444', title: '🛑 Stop Loss' },
      { price: trade.tp, color: '#10b981', title: '🎯 Take Profit' },
    ];
    if (trade.closePrice) {
      lines.push({ price: trade.closePrice, color: '#8b5cf6', title: '📤 Close Price', lineStyle: 1 });
    }
    
    // Build trade marker for entry→exit line
    // For open trades don't pass exitTime — chart uses last candle automatically.
    // Passing Date.now() causes a false "out of range" warning because it's
    // ahead of the last completed candle's timestamp.
    const marker: TradeMarker = {
      entryTime: trade.openTime,
      entryPrice: trade.entryPrice,
      exitTime: trade.status === 'open' ? undefined : trade.closeTime,
      exitPrice: trade.closePrice || trade.currentPrice,
      type: trade.type === 'LONG' ? 'long' : 'short',
      isOpen: trade.status === 'open',
    };
    
    setChartLines(lines);
    setChartTradeMarker(marker);
    setChartSymbol(trade.pair);
  };

  // Filter closed trades by status
  const wonTrades = closedTrades.filter((t) => t.status === 'won');
  const lostTrades = closedTrades.filter((t) => t.status === 'lost');
  const manualTrades = closedTrades.filter((t) => t.status === 'manual_close');

  // Combine visible closed trades
  const visibleClosedTrades = useMemo(() => {
    const result: Trade[] = [];
    if (showWon) result.push(...wonTrades);
    if (showLost) result.push(...lostTrades);
    if (showManual) result.push(...manualTrades);
    return result.sort((a, b) => (b.closeTime || 0) - (a.closeTime || 0));
  }, [wonTrades, lostTrades, manualTrades, showWon, showLost, showManual]);

  return (
    <div className="space-y-4">
      {/* Chart Modal */}
      {chartSymbol && (
        <CandlestickChart
          symbol={chartSymbol}
          onClose={() => { setChartSymbol(null); setChartLines([]); setChartTradeMarker(undefined); }}
          priceLines={chartLines}
          tradeMarker={chartTradeMarker}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <ArrowLeftRight className="w-6 h-6 text-amber-400" />
        <h2 className="text-xl font-bold">Trades</h2>
        <span className="text-sm text-gray-500">({trades.length} total)</span>
      </div>

      {/* Category Toggles */}
      <div className="flex flex-wrap gap-2 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
        <span className="text-xs text-gray-400 mr-2">Εμφάνιση:</span>
        <ToggleButton label="🟢 Open" count={openTrades.length} active={showOpen} onClick={() => setShowOpen(!showOpen)} color="green" />
        <ToggleButton label="✅ Won" count={wonTrades.length} active={showWon} onClick={() => setShowWon(!showWon)} color="emerald" />
        <ToggleButton label="❌ Lost" count={lostTrades.length} active={showLost} onClick={() => setShowLost(!showLost)} color="red" />
        <ToggleButton label="⚙️ Manual" count={manualTrades.length} active={showManual} onClick={() => setShowManual(!showManual)} color="gray" />
      </div>

      {/* Open Trades */}
      {showOpen && (
        <CollapsibleSection
          title="🟢 Open Trades"
          count={openTrades.length}
          color="green"
          defaultOpen={true}
        >
          {openTrades.length === 0 ? (
            <p className="text-gray-500 text-sm">No open trades.</p>
          ) : (
            <div className="space-y-3">
              {openTrades.map((trade) => (
                <TradeCard
                  key={trade.id}
                  trade={trade}
                  settings={settings}
                  onClose={onCloseTrade}
                  onDelete={onDeleteTrade}
                  onOpenChart={() => openTradeChart(trade)}
                  showClose
                />
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Closed Trades (grouped by date) */}
      <CollapsibleSection
        title="📊 Trade History"
        count={visibleClosedTrades.length}
        color="gray"
        defaultOpen={true}
      >
        {visibleClosedTrades.length === 0 ? (
          <p className="text-gray-500 text-sm">No closed trades yet.</p>
        ) : (
          <TradesByDate
            trades={visibleClosedTrades}
            settings={settings}
            onOpenChart={openTradeChart}
            onDelete={onDeleteTrade}
          />
        )}
      </CollapsibleSection>
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
    green: active ? 'bg-green-500/20 border-green-500/50 text-green-400' : 'bg-gray-800 border-gray-700 text-gray-500',
    emerald: active ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-gray-800 border-gray-700 text-gray-500',
    red: active ? 'bg-red-500/20 border-red-500/50 text-red-400' : 'bg-gray-800 border-gray-700 text-gray-500',
    gray: active ? 'bg-gray-600/20 border-gray-500/50 text-gray-300' : 'bg-gray-800 border-gray-700 text-gray-500',
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

// Collapsible section
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
    green: 'border-green-500/20 bg-green-500/5',
    emerald: 'border-emerald-500/20 bg-emerald-500/5',
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

// Trades grouped by date with collapsible days
function TradesByDate({
  trades,
  settings,
  onOpenChart,
  onDelete,
}: {
  trades: Trade[];
  settings: Settings;
  onOpenChart: (trade: Trade) => void;
  onDelete: (id: string) => void;
}) {
  const grouped = useMemo(() => groupTradesByDate(trades, true), [trades]);
  const sortedDates = Object.keys(grouped).sort((a, b) => {
    // Sort by most recent first
    const dateA = grouped[a][0]?.closeTime || grouped[a][0]?.openTime || 0;
    const dateB = grouped[b][0]?.closeTime || grouped[b][0]?.openTime || 0;
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

  // Calculate day summary
  const getDaySummary = (dayTrades: Trade[]) => {
    const totalPnl = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
    const wins = dayTrades.filter((t) => t.status === 'won').length;
    const losses = dayTrades.filter((t) => t.status === 'lost').length;
    return { totalPnl, wins, losses };
  };

  return (
    <div className="space-y-3">
      {sortedDates.map((date) => {
        const dayTrades = grouped[date];
        const summary = getDaySummary(dayTrades);
        
        return (
          <div key={date} className="border border-gray-700/50 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleDay(date)}
              className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/50 hover:bg-gray-700/50 transition-colors"
            >
              <span className="text-xs font-medium text-gray-400">
                📅 {date} ({dayTrades.length} trades)
              </span>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold font-mono ${summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toFixed(2)}
                </span>
                <span className="text-xs text-gray-500">
                  ✅{summary.wins} ❌{summary.losses}
                </span>
                {collapsedDays.has(date) ? (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
              </div>
            </button>
            {!collapsedDays.has(date) && (
              <div className="p-3 space-y-3">
                {dayTrades.map((trade) => (
                  <ClosedTradeCard
                    key={trade.id}
                    trade={trade}
                    settings={settings}
                    onOpenChart={() => onOpenChart(trade)}
                    onDelete={() => onDelete(trade.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TradeCard({
  trade,
  settings,
  onClose,
  onDelete,
  onOpenChart,
  showClose,
}: {
  trade: Trade;
  settings: Settings;
  onClose: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenChart: () => void;
  showClose?: boolean;
}) {
  const isProfit = trade.pnl >= 0;
  const metrics = calculateTradeRiskMetrics(trade, settings);

  return (
    <div className={`p-4 rounded-lg border relative group ${
      isProfit ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'
    }`}>
      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(trade.id); }}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/30 text-red-400 opacity-0 group-hover:opacity-100 transition-all"
        title="Διαγραφή"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      <div className="flex flex-col gap-3">
        {/* Top row: Pair + P&L */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isProfit ? (
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-5 h-5 text-red-400" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold">{trade.pair}</span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded ${
                    trade.type === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {trade.type}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Chart button */}
            <button
              onClick={(e) => { e.stopPropagation(); onOpenChart(); }}
              className="p-2 rounded-lg bg-gray-700/50 hover:bg-gray-600 text-gray-400 hover:text-amber-400 transition-colors"
              title="View Chart"
            >
              <BarChart3 className="w-4 h-4" />
            </button>
            <div className="text-right">
              <p className={`text-lg font-bold font-mono ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                {isProfit ? '+' : ''}${trade.pnl.toFixed(2)}
              </p>
              <p className={`text-xs ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                {isProfit ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
              </p>
            </div>
            {showClose && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(trade.id); }}
                className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm font-medium transition-colors"
              >
                Close
              </button>
            )}
          </div>
        </div>

        {/* Price row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 pl-8">
          <span>Entry: <span className="text-amber-400 font-mono">${trade.entryPrice.toFixed(trade.entryPrice < 1 ? 6 : 2)}</span></span>
          <span>Current: <span className="text-white font-mono">${trade.currentPrice.toFixed(trade.currentPrice < 1 ? 6 : 2)}</span></span>
          <span>SL: <span className="text-red-400 font-mono">${trade.sl.toFixed(trade.sl < 1 ? 6 : 2)}</span></span>
          <span>TP: <span className="text-emerald-400 font-mono">${trade.tp.toFixed(trade.tp < 1 ? 6 : 2)}</span></span>
          {trade.liquidationPrice > 0 && (
            <span>LIQ: <span className="text-orange-400 font-mono font-bold">${trade.liquidationPrice.toFixed(trade.liquidationPrice < 1 ? 6 : 2)}</span></span>
          )}
          {trade.leverage && <span className="text-purple-400 font-bold">{trade.leverage}x</span>}
        </div>

        {/* Risk Metrics */}
        <div className="bg-gray-800/50 rounded-lg p-2 ml-8 border border-gray-700/50">
          <div className="flex items-center gap-1 text-xs text-gray-400 mb-2">
            <DollarSign className="w-3 h-3" />
            <span className="font-medium">Position ({settings.riskPerTrade}% risk · {settings.leverage ?? 10}x)</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-gray-500">Size</p>
              <p className="font-mono font-bold text-white">${metrics.positionSize.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500">Target Profit</p>
              <p className="font-mono font-bold text-emerald-400">+${metrics.potentialProfit.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500">Max Loss</p>
              <p className="font-mono font-bold text-red-400">-${metrics.potentialLoss.toFixed(2)}</p>
            </div>
          </div>
          {((trade.feePaid ?? 0) > 0 || (trade.fundingPaid ?? 0) !== 0) && (
            <div className="grid grid-cols-2 gap-2 text-xs mt-2 pt-2 border-t border-gray-700/50">
              <div>
                <p className="text-gray-500">Fees paid</p>
                <p className="font-mono text-orange-400">-${(trade.feePaid ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-gray-500">Funding</p>
                <p className={`font-mono ${(trade.fundingPaid ?? 0) >= 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                  {(trade.fundingPaid ?? 0) >= 0 ? '-' : '+'}${Math.abs(trade.fundingPaid ?? 0).toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Timestamp row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pl-8 border-t border-gray-700/50 pt-2">
          <span className="flex items-center gap-1 text-gray-500">
            <Calendar className="w-3 h-3" />
            📥 Opened: <span className="text-gray-300">{formatDateTime(trade.openTime)}</span>
          </span>
          <span className="flex items-center gap-1 text-gray-500">
            <Clock className="w-3 h-3" />
            ⏱️ Duration: <span className="text-amber-400">{formatDuration(trade.openTime)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function ClosedTradeCard({
  trade,
  settings,
  onOpenChart,
  onDelete,
}: {
  trade: Trade;
  settings: Settings;
  onOpenChart: () => void;
  onDelete: () => void;
}) {
  const isProfit = trade.pnl >= 0;
  const metrics = calculateTradeRiskMetrics(trade, settings);

  return (
    <div
      className={`p-4 rounded-lg border cursor-pointer transition-all hover:scale-[1.002] relative group ${
        isProfit
          ? 'border-emerald-500/10 bg-emerald-500/5 hover:border-emerald-500/30'
          : 'border-red-500/10 bg-red-500/5 hover:border-red-500/30'
      }`}
      onClick={onOpenChart}
    >
      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/30 text-red-400 opacity-0 group-hover:opacity-100 transition-all z-10"
        title="Διαγραφή"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      <div className="flex flex-col gap-2">
        {/* Top row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isProfit ? (
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-400" />
            )}
            <span className="font-bold text-sm">{trade.pair}</span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded ${
                trade.type === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}
            >
              {trade.type}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded font-medium ${
                trade.status === 'won'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : trade.status === 'lost'
                  ? 'bg-red-500/20 text-red-400'
                  : trade.status === 'liquidated'
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {trade.status === 'won' ? '✅ WON' : trade.status === 'lost' ? '❌ LOST' : trade.status === 'liquidated' ? '💥 LIQUIDATED' : '⚙️ MANUAL'}
            </span>
            <BarChart3 className="w-3.5 h-3.5 text-gray-600" />
          </div>
          <div className="text-right">
            <p className={`font-bold font-mono text-sm ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
              {isProfit ? '+' : ''}${trade.pnl.toFixed(2)}
            </p>
            <p className={`text-xs ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
              {isProfit ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Prices */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 pl-6">
          <span>Entry: <span className="text-amber-400 font-mono">${trade.entryPrice.toFixed(trade.entryPrice < 1 ? 6 : 2)}</span></span>
          <span>Close: <span className="text-purple-400 font-mono">${trade.closePrice?.toFixed(trade.closePrice < 1 ? 6 : 2) || '—'}</span></span>
          <span>SL: <span className="text-red-400 font-mono">${trade.sl.toFixed(trade.sl < 1 ? 6 : 2)}</span></span>
          <span>TP: <span className="text-emerald-400 font-mono">${trade.tp.toFixed(trade.tp < 1 ? 6 : 2)}</span></span>
        </div>

        {/* Risk Metrics */}
        <div className="bg-gray-800/50 rounded-lg p-2 ml-6 border border-gray-700/50">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-gray-500">Position Size</p>
              <p className="font-mono font-bold text-white">${metrics.positionSize.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500">Target Profit</p>
              <p className="font-mono font-bold text-emerald-400">+${metrics.potentialProfit.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500">Max Loss</p>
              <p className="font-mono font-bold text-red-400">-${metrics.potentialLoss.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Timestamps */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pl-6 border-t border-gray-700/30 pt-2">
          <span className="flex items-center gap-1 text-gray-500">
            <Calendar className="w-3 h-3" />
            📥 Opened: <span className="text-gray-300">{formatDateTime(trade.openTime)}</span>
          </span>
          <span className="flex items-center gap-1 text-gray-500">
            📤 Closed: <span className="text-gray-300">{trade.closeTime ? formatDateTime(trade.closeTime) : '—'}</span>
          </span>
          <span className="flex items-center gap-1 text-gray-500">
            <Clock className="w-3 h-3" />
            ⏱️ <span className="text-amber-400/70">{trade.openTime ? formatDuration(trade.openTime, trade.closeTime) : '—'}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
