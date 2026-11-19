import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck, LogOut, Store, CreditCard, Package } from 'lucide-react';
import { apiFetch, formatDate, getOrderStageLabel, setStoredToken } from '../lib/api.ts';
import { ensureCloudUser } from '../lib/cloudDb.ts';
import { useCurrency } from '../lib/currency.tsx';
import { useFirebase } from '../lib/firebaseContext.tsx';
import type { Order, SavedPaymentMethod, User } from '../types.ts';
import { CurrencySelect } from './CurrencySelect.tsx';

interface AuthPanelProps {
  user: User | null;
  orders: Order[];
  savedMethods: SavedPaymentMethod[];
  onAuthSuccess: (user: User, isCloudAuth?: boolean) => void;
  onLogout: () => void;
  onTrackOrder: (trackingCode: string) => void;
  onOpenSell: () => void;
}

export function AuthPanel({
  user,
  orders,
  savedMethods,
  onAuthSuccess,
  onLogout,
  onTrackOrder,
  onOpenSell,
}: AuthPanelProps) {
  const { formatPrice } = useCurrency();
  const { signInWithGoogle } = useFirebase();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [openSellerStore, setOpenSellerStore] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [storeLocation, setStoreLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : { name, email, password, openSellerStore, storeName, storeLocation };

      const res = await apiFetch<{ user: User; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setStoredToken(res.token);
      onAuthSuccess(res.user, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const fbUser = await signInWithGoogle();
      const cloudUser = await ensureCloudUser(fbUser);
      onAuthSuccess(cloudUser, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const fillDemoCredentials = (type: 'buyer' | 'seller') => {
    setMode('login');
    setError(null);
    if (type === 'buyer') {
      setEmail('buyer@radix.market');
      setPassword('RadixBuyer!2026');
    } else {
      setEmail('seller1@radix.market');
      setPassword('RadixSeller!2026');
    }
  };

  if (user) {
    return (
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-[#E6E4DF]">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[#5C626B] mb-2">
              Authenticated Account · {user.sellerProfile ? 'Buyer & Verified Seller' : 'Buyer Account'}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#111315]">
              {user.name}
            </h1>
            <p className="text-sm text-[#5C626B] mt-1">
              {user.email} · Member since {formatDate(user.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <CurrencySelect compact />
            <button
              type="button"
              onClick={onOpenSell}
              className="px-4 py-2.5 text-sm font-semibold text-[#111315] bg-white border border-[#D4D0C8] hover:border-[#111315] rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
            >
              <Store className="w-4 h-4" />
              {user.sellerProfile ? 'Seller Console' : 'Open Seller Storefront'}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="px-4 py-2.5 text-sm font-semibold text-white bg-[#111315] hover:bg-[#272A2E] rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 mt-10">
          {/* Recent Orders */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-xl font-bold text-[#111315]">
                Order History
              </h2>
              <span className="text-xs text-[#5C626B] tabular-nums">
                {orders.length} total order{orders.length === 1 ? '' : 's'}
              </span>
            </div>

            {orders.length === 0 ? (
              <div className="bg-white border border-[#E6E4DF] rounded-xl p-8 text-center">
                <Package className="w-8 h-8 text-[#8C8880] mx-auto mb-3" />
                <p className="text-sm font-medium text-[#111315]">No orders placed yet</p>
                <p className="text-sm text-[#5C626B] mt-1">
                  Explore the marketplace to purchase verified hardware and goods.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="bg-white border border-[#E6E4DF] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs text-[#5C626B]">
                        <span className="font-mono font-semibold text-[#111315] tabular-nums">
                          {order.trackingCode}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatDate(order.createdAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-[#C2410C]">
                          {getOrderStageLabel(order.status)}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-[#111315] mt-1.5">
                        {order.items.map((i) => `${i.titleSnapshot} ×${i.quantity}`).join(', ')}
                      </p>
                      <p className="text-xs text-[#5C626B] mt-1 tabular-nums">
                        Paid {formatPrice(order.totalCents)} via {order.paymentBrand} •••• {order.paymentLast4}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onTrackOrder(order.trackingCode)}
                      className="px-4 py-2 text-xs font-semibold text-[#111315] bg-[#FAF9F6] border border-[#D4D0C8] hover:border-[#111315] rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
                    >
                      Live Tracking
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Saved Tokenized Payment Methods */}
          <div>
            <h2 className="font-display text-xl font-bold text-[#111315] mb-5">
              Saved Payment Tokens
            </h2>
            <div className="bg-white border border-[#E6E4DF] rounded-xl p-5 space-y-4">
              {savedMethods.length === 0 ? (
                <p className="text-sm text-[#5C626B]">
                  No vaulted cards yet. Save a card securely during checkout.
                </p>
              ) : (
                savedMethods.map((pm) => (
                  <div
                    key={pm.id}
                    className="flex items-center justify-between pb-3 last:pb-0 border-b last:border-b-0 border-[#EFECE6]"
                  >
                    <div className="flex items-center gap-3">
                      <CreditCard className="w-5 h-5 text-[#5C626B]" />
                      <div>
                        <p className="text-sm font-semibold text-[#111315] tabular-nums">
                          {pm.brand} •••• {pm.last4}
                        </p>
                        <p className="text-xs text-[#5C626B] tabular-nums">
                          Expires {String(pm.expMonth).padStart(2, '0')}/{pm.expYear}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-[#5C626B]">
                      {pm.isDefault ? 'Default' : 'Tokenized'}
                    </span>
                  </div>
                ))
              )}
              <div className="pt-3 border-t border-[#EFECE6] flex items-start gap-2.5 text-xs text-[#5C626B]">
                <ShieldCheck className="w-4 h-4 text-[#15803D] shrink-0 mt-0.5" />
                <span>
                  Card numbers are validated and replaced with cryptographic tokens. Raw PAN and CVC values are never stored.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-5">
          <p className="text-xs font-medium uppercase tracking-wider text-[#C2410C] mb-3">
            Password Authentication
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#111315] [text-wrap:balance]">
            One account to buy, sell, and review on Radix.
          </h1>
          <p className="text-base text-[#5C626B] mt-4 leading-relaxed">
            Passwords are salted and hashed with cryptographic scrypt, and sessions are protected by signed HTTP-only tokens.
          </p>

          <div className="mt-8 pt-6 border-t border-[#E6E4DF] space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#5C626B]">
              Quick Demo Credentials
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => fillDemoCredentials('buyer')}
                className="px-3.5 py-2 text-xs font-semibold text-[#111315] bg-white border border-[#D4D0C8] hover:border-[#111315] rounded-lg transition-colors"
              >
                Fill Demo Buyer
              </button>
              <button
                type="button"
                onClick={() => fillDemoCredentials('seller')}
                className="px-3.5 py-2 text-xs font-semibold text-[#111315] bg-white border border-[#D4D0C8] hover:border-[#111315] rounded-lg transition-colors"
              >
                Fill Demo Seller
              </button>
            </div>
            <p className="text-xs text-[#5C626B] leading-relaxed">
              Buyer has live order tracking &amp; saved Visa. Seller has active studio inventory &amp; order fulfillment controls.
            </p>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-[#E6E4DF] rounded-2xl p-6 sm:p-8">
          <button
            type="button"
            disabled={googleLoading || loading}
            onClick={handleGoogleAuth}
            className="w-full py-3 px-4 text-sm font-semibold text-[#111315] bg-[#FAF9F6] border border-[#D4D0C8] hover:border-[#111315] hover:bg-[#EFECE6] disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2.5"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            {googleLoading ? 'Connecting Cloud Account...' : 'Continue with Google (Cloud Firestore)'}
          </button>

          <div className="my-6 flex items-center gap-3 text-xs text-[#8C8880]">
            <div className="flex-1 h-px bg-[#EFECE6]" />
            <span>or use Radix email &amp; password</span>
            <div className="flex-1 h-px bg-[#EFECE6]" />
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#F3F1EC] rounded-lg mb-6 w-fit">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'login'
                  ? 'bg-white text-[#111315] shadow-xs'
                  : 'text-[#5C626B] hover:text-[#111315]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'register'
                  ? 'bg-white text-[#111315] shadow-xs'
                  : 'text-[#5C626B] hover:text-[#111315]'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-[#111315] mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Minimum 8 characters' : 'Enter your password'}
                  className="w-full px-3.5 py-2.5 pr-11 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[#5C626B] hover:text-[#111315]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div className="pt-2">
                <label className="flex items-start gap-2.5 text-sm text-[#111315] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={openSellerStore}
                    onChange={(e) => setOpenSellerStore(e.target.checked)}
                    className="mt-1 accent-[#C2410C]"
                  />
                  <span>
                    <span className="font-semibold">Also open a Seller Storefront</span>
                    <span className="block text-xs text-[#5C626B]">
                      List products, manage inventory, and fulfill live orders.
                    </span>
                  </span>
                </label>

                {openSellerStore && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[#EFECE6]">
                    <div>
                      <label className="block text-xs font-medium text-[#5C626B] mb-1">
                        Storefront Name
                      </label>
                      <input
                        type="text"
                        required
                        value={storeName}
                        onChange={(e) => setStoreName(e.target.value)}
                        placeholder="Studio North"
                        className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#5C626B] mb-1">
                        Dispatch Location
                      </label>
                      <input
                        type="text"
                        required
                        value={storeLocation}
                        onChange={(e) => setStoreLocation(e.target.value)}
                        placeholder="Seattle, WA"
                        className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-5 text-sm font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              {loading
                ? 'Authenticating...'
                : mode === 'login'
                  ? 'Sign In to Radix'
                  : 'Create Radix Account'}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
