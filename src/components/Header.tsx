import type { User } from '../types.ts';

export type AppView = 'shop' | 'sell' | 'track' | 'account' | 'product' | 'seller';

interface HeaderProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  user: User | null;
  cartCount: number;
  onOpenCart: () => void;
}

export function Header({
  activeView,
  onNavigate,
  user,
  cartCount,
  onOpenCart,
}: HeaderProps) {
  const accountLabel = user ? user.name.split(' ')[0] : 'Sign In';

  const navItems: Array<{ view: AppView; label: string; isActive: boolean }> = [
    { view: 'shop', label: 'Shop', isActive: activeView === 'shop' || activeView === 'product' || activeView === 'seller' },
    { view: 'sell', label: 'Sell', isActive: activeView === 'sell' },
    { view: 'track', label: 'Track Order', isActive: activeView === 'track' },
    { view: 'account', label: accountLabel, isActive: activeView === 'account' },
  ];

  return (
    <header className="sticky top-0 z-30 bg-[#FAF9F6]/95 backdrop-blur-sm border-b border-[#E6E4DF]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onNavigate('shop')}
          className="font-display text-xl font-bold tracking-tight text-[#111315] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C2410C]"
        >
          Radix
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav className="flex items-center gap-5 sm:gap-7 text-sm font-medium">
          {navItems.map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C2410C] ${
                item.isActive
                  ? 'border-[#C2410C] text-[#111315] font-semibold'
                  : 'border-transparent text-[#5C626B] hover:text-[#111315] hover:border-[#D4D0C8]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={onOpenCart}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#111315] hover:bg-[#272A2E] rounded-lg transition-colors duration-150 whitespace-nowrap shrink-0 tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2410C]"
          >
            Bag ({cartCount})
          </button>
        </div>
      </div>
    </header>
  );
}
