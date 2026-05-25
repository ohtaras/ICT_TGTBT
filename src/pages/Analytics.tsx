import { PortfolioStats, Trade } from '../types';
import { BarChart3, TrendingUp, Target, AlertTriangle, Award, Percent } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

interface AnalyticsProps {
  stats: PortfolioStats;
  trades: Trade[];
  equityHistory: { time: number; equity: number }[];
  initialBalance: number;
}

export default function Analytics({ stats, trades, equityHistory, initialBalance }: AnalyticsProps) {
  const closedTrades = trades.filter((t) => t.status !== 'open');

  // Build equity curve from trades if no equity history
  const equityData = equityHistory.length > 0
    ? equityHistory.map((p) => ({
        date: new Date(p.time).toLocaleDateString(),
        equity: parseFloat(p.equity.toFixed(2)),
      }))
    : buildEquityCurve(closedTrades, initialBalance);

  // PnL distribution
  const pnlData = closedTrades.slice(-30).map((t, i) => ({
    trade: i + 1,
    pnl: parseFloat(t.pnl.toFixed(2)),
  }));

  // Monthly stats
  const monthlyStats = getMonthlyStats(closedTrades);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6 text-amber-400" />
        <h2 className="text-xl font-bold">Analytics</h2>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <AnalyticCard
          icon={<Target className="w-5 h-5" />}
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          color="emerald"
        />
        <AnalyticCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Profit Factor"
          value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
          color="blue"
        />
        <AnalyticCard
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Max Drawdown"
          value={`${stats.maxDrawdown.toFixed(1)}%`}
          color="orange"
        />
        <AnalyticCard
          icon={<Award className="w-5 h-5" />}
          label="Total Trades"
          value={stats.totalTrades.toString()}
          color="purple"
        />
        <AnalyticCard
          icon={<Percent className="w-5 h-5" />}
          label="Total P&L"
          value={`${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}`}
          color={stats.totalPnl >= 0 ? 'emerald' : 'red'}
        />
        <AnalyticCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Current Balance"
          value={`$${stats.balance.toFixed(2)}`}
          color="amber"
        />
      </div>

      {/* Equity Curve */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          📈 Equity Curve
        </h3>
        {equityData.length < 2 ? (
          <p className="text-gray-500 text-sm py-10 text-center">
            Not enough data yet. Complete at least 2 trades to see the equity curve.
          </p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111827',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="equity"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* PnL Distribution */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          📊 Trade P&L (Last 30)
        </h3>
        {pnlData.length === 0 ? (
          <p className="text-gray-500 text-sm py-10 text-center">No closed trades yet.</p>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="trade" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111827',
                    border: '1px solid #374151',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="pnl">
                  {pnlData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Monthly Performance */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          📅 Monthly Performance
        </h3>
        {monthlyStats.length === 0 ? (
          <p className="text-gray-500 text-sm">No monthly data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800 text-xs uppercase">
                  <th className="text-left py-2 font-medium">Month</th>
                  <th className="text-right py-2 font-medium">Trades</th>
                  <th className="text-right py-2 font-medium">Wins</th>
                  <th className="text-right py-2 font-medium">Win %</th>
                  <th className="text-right py-2 font-medium">P&L</th>
                </tr>
              </thead>
              <tbody>
                {monthlyStats.map((m) => (
                  <tr key={m.month} className="border-b border-gray-800/50">
                    <td className="py-2 font-medium">{m.month}</td>
                    <td className="py-2 text-right">{m.total}</td>
                    <td className="py-2 text-right text-emerald-400">{m.wins}</td>
                    <td className="py-2 text-right">{m.winRate.toFixed(0)}%</td>
                    <td
                      className={`py-2 text-right font-mono font-medium ${
                        m.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {m.pnl >= 0 ? '+' : ''}${m.pnl.toFixed(2)}
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

function AnalyticCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
    blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
    orange: { bg: 'bg-orange-500/10', text: 'text-orange-400' },
    purple: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
    red: { bg: 'bg-red-500/10', text: 'text-red-400' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  };

  const c = colorMap[color] || colorMap.amber;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center ${c.text} mb-3`}>
        {icon}
      </div>
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-1 ${c.text}`}>{value}</p>
    </div>
  );
}

function buildEquityCurve(trades: Trade[], initialBalance: number) {
  let balance = initialBalance;
  const data = [{ date: 'Start', equity: balance }];

  for (const trade of [...trades].reverse()) {
    balance += trade.pnl;
    data.push({
      date: trade.closeTime
        ? new Date(trade.closeTime).toLocaleDateString()
        : new Date(trade.openTime).toLocaleDateString(),
      equity: parseFloat(balance.toFixed(2)),
    });
  }

  return data;
}

function getMonthlyStats(trades: Trade[]) {
  const monthMap = new Map<
    string,
    { total: number; wins: number; pnl: number }
  >();

  for (const trade of trades) {
    const date = new Date(trade.closeTime || trade.openTime);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!monthMap.has(key)) {
      monthMap.set(key, { total: 0, wins: 0, pnl: 0 });
    }
    const m = monthMap.get(key)!;
    m.total++;
    if (trade.pnl > 0) m.wins++;
    m.pnl += trade.pnl;
  }

  return Array.from(monthMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, data]) => ({
      month,
      ...data,
      winRate: data.total > 0 ? (data.wins / data.total) * 100 : 0,
    }));
}
