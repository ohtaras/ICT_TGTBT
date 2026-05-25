import { useState } from 'react';
import {
  LayoutDashboard,
  Radio,
  ArrowLeftRight,
  Coins,
  BarChart3,
  Settings,
  Menu,
  X,
  Zap,
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: string;
  onNavigate: (page: string) => void;
  botActive: boolean;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'signals', label: 'Signals', icon: Radio },
  { id: 'trades', label: 'Trades', icon: ArrowLeftRight },
  { id: 'pairs', label: 'Pairs', icon: Coins },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Layout({ children, currentPage, onNavigate, botActive }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-gray-900 border-r border-gray-800 transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } flex flex-col`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-5 border-b border-gray-800">
          <Zap className="w-7 h-7 text-amber-400 mr-2" />
          <span className="text-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            ICT Terminal
          </span>
          <button
            className="ml-auto lg:hidden text-gray-400 hover:text-white"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bot Status */}
        <div className="px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${botActive ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-400">
              Bot {botActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-800">
          <p className="text-xs text-gray-600">ICT Trading Engine v1.0</p>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 bg-gray-900/80 backdrop-blur border-b border-gray-800 flex items-center px-4 lg:px-6 sticky top-0 z-30">
          <button
            className="lg:hidden text-gray-400 hover:text-white mr-3"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-semibold capitalize">{currentPage}</h1>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
