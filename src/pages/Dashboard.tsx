import { useState } from 'react';
import { PortfolioStats, Signal, Trade, TradingPair } from '../types';
import CandlestickChart, { PriceLine } from '../components/CandlestickChart';
import { getSyncInfo } from '../cloudSync';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  Target,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Server,
  BarChart3,
} from 'lucide-react';

interface DashboardProps {
  stats: PortfolioStats;
  signals: Signal[];
  trades: Trade[];
  pairs: TradingPair[];
  autoTrading: boolean;
  onToggleAutoTrading: () => void;
}

export default function Dashboard({
  stats,
  signals,
  trades,
  pairs,
  autoTrading,
  onToggleAutoTrading,
}: DashboardProps) {
  const syncInfo = getSyncInfo();
  const recentSignals = signals.slice(0, 5);
  const openTrades = trades.filter((t) => t.status === 'open');
  const activePairs = pairs.filter((p) => p.enabled);

  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [chartLines, setChartLines] = useState<PriceLine[]>([]);

  const openPairChart = (symbol: string) => {
    setChartLines([]);
    setChartSymbol(symbol);
  };

  const openSignalChart = (sig: Signal) => {
    const lines: PriceLine[] = [
      { price: sig.entry, color: '#f59e0b', title: '📍 Entry' },
      { price: sig.sl, color: '#ef4444', title: '🛑 Stop Loss' },
      { price: sig.tp, color: '#10b981', title: '🎯 Take Profit' },
    ];
    setChartLines(lines);
    setChartSymbol(sig.pair);
  };

  const openTradeChart = (trade: Trade) => {
    const lines: PriceLine[] = [
      { price: trade.entryPrice, color: '#f59e0b', title: '📍 Entry' },
      { price: trade.sl, color: '#ef4444', title: '🛑 Stop Loss' },
      { price: trade.tp, color: '#10b981', title: '🎯 Take Profit' },
    ];
    setChartLines(lines);
    setChartSymbol(trade.pair);
  };

  return (
    <div className="space-y-6">
      {/* Chart Modal */}
      {chartSymbol && (
        <CandlestickChart
          symbol={chartSymbol}
          onClose={() => { setChartSymbol(null); setChartLines([]); }}
          priceLines={chartLines}
        />
      )}

      {/* Data Source + Auto Trading Toggle */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="w-5 h-5 text-amber-400" />
            Auto Trading
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {autoTrading
              ? 'Bot is scanning pairs and creating trades automatically'
              : 'Bot is paused — signals only, no auto trades'}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <p className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
              Binance Data Feed • Τιμές κάθε 5s • ICT Scan κάθε 30s
            </p>
            <p className={`text-xs flex items-center gap-1.5 ${
              syncInfo.status === 'ok' ? 'text-cyan-400' :
              syncInfo.status === 'error' ? 'text-red-400' : 'text-gray-500'
            }`}>
              <Server className="w-3 h-3" />
              {syncInfo.status === 'ok' ? 'Server Connected' :
               syncInfo.status === 'error' ? 'Server Error' :
               syncInfo.status === 'syncing' ? 'Syncing…' : 'Connecting…'}
            </p>
          </div>
        </div>
        <button
          onClick={onToggleAutoTrading}
          className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
            autoTrading
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
          }`}
        >
          {autoTrading ? '● ACTIVE' : '○ INACTIVE'}
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign className="w-5 h-5" />}
          label="Balance"
          value={`$${stats.balance.toFixed(2)}`}
          color="text-amber-400"
          bg="bg-amber-500/10"
        />
        <StatCard
          icon={<Target className="w-5 h-5" />}
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          color="text-emerald-400"
          bg="bg-emerald-500/10"
        />
        <StatCard
          icon={stats.totalPnl >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
          label="Total P&L"
          value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`}
          color={stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
          bg={stats.totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}
        />
        <StatCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Max Drawdown"
          value={`${stats.maxDrawdown.toFixed(1)}%`}
          color="text-orange-400"
          bg="bg-orange-500/10"
        />
      </div>

      {/* Two column layout */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Active Pairs */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Active Pairs ({activePairs.length})
            <span className="ml-2 text-[10px] text-gray-600 normal-case font-normal">click for chart</span>
          </h3>
          <div className="space-y-3">
            {activePairs.length === 0 && (
              <p className="text-gray-500 text-sm">No active pairs. Go to Pairs to add some.</p>
            )}
            {activePairs.map((pair) => (
              <div
                key={pair.symbol}
                onClick={() => openPairChart(pair.symbol)}
                className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0 cursor-pointer hover:bg-gray-800/30 rounded-lg px-2 -mx-2 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold text-amber-400">
                    {pair.symbol.replace('USDT', '').slice(0, 3)}
                  </div>
                  <span className="font-medium text-sm">{pair.symbol}</span>
                  <BarChart3 className="w-3.5 h-3.5 text-gray-600 group-hover:text-amber-400 transition-colors" />
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">
                    {pair.currentPrice > 0 ? `$${pair.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : '—'}
                  </p>
                  <p
                    className={`text-xs flex items-center justify-end gap-0.5 ${
                      pair.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {pair.change24h >= 0 ? (
                      <ArrowUpRight className="w-3 h-3" />
                    ) : (
                      <ArrowDownRight className="w-3 h-3" />
                    )}
                    {Math.abs(pair.change24h).toFixed(2)}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Signals */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Recent Signals
            <span className="ml-2 text-[10px] text-gray-600 normal-case font-normal">click for chart with Entry/SL/TP</span>
          </h3>
          <div className="space-y-3">
            {recentSignals.length === 0 && (
              <p className="text-gray-500 text-sm">No signals yet. Waiting for ICT setups...</p>
            )}
            {recentSignals.map((sig) => (
              <div
                key={sig.id}
                onClick={() => openSignalChart(sig)}
                className={`p-3 rounded-lg border cursor-pointer transition-all hover:scale-[1.01] ${
                  sig.type === 'BULLISH'
                    ? 'border-emerald-500/20 bg-emerald-500/5 hover:border-emerald-500/40'
                    : 'border-red-500/20 bg-red-500/5 hover:border-red-500/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        sig.type === 'BULLISH'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {sig.type}
                    </span>
                    <span className="text-sm font-medium">{sig.pair}</span>
                    <BarChart3 className="w-3.5 h-3.5 text-gray-600" />
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    sig.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                    sig.status === 'triggered' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {sig.status}
                  </span>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-gray-400">
                  <span>Entry: <span className="text-white">${sig.entry}</span></span>
                  <span>SL: <span className="text-red-400">${sig.sl}</span></span>
                  <span>TP: <span className="text-emerald-400">${sig.tp}</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Open Trades */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Open Trades ({openTrades.length})
          <span className="ml-2 text-[10px] text-gray-600 normal-case font-normal">click for chart with Entry/SL/TP</span>
        </h3>
        {openTrades.length === 0 ? (
          <p className="text-gray-500 text-sm">No open trades.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-2 font-medium">Pair</th>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-right py-2 font-medium">Entry</th>
                  <th className="text-right py-2 font-medium">Current</th>
                  <th className="text-right py-2 font-medium">P&L</th>
                  <th className="text-right py-2 font-medium">📊</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map((trade) => (
                  <tr
                    key={trade.id}
                    onClick={() => openTradeChart(trade)}
                    className="border-b border-gray-800/50 cursor-pointer hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="py-2 font-medium">{trade.pair}</td>
                    <td className="py-2">
                      <span
                        className={`text-xs font-bold ${
                          trade.type === 'LONG' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {trade.type}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono">${trade.entryPrice}</td>
                    <td className="py-2 text-right font-mono">${trade.currentPrice}</td>
                    <td
                      className={`py-2 text-right font-mono font-medium ${
                        trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                    </td>
                    <td className="py-2 text-right">
                      <BarChart3 className="w-4 h-4 text-gray-600 hover:text-amber-400 inline-block" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  bg: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center ${color} mb-3`}>
        {icon}
      </div>
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}
