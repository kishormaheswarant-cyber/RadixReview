import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CreditCard, Lock, ShieldCheck, ShoppingBag, Trash2, X } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import { createCloudOrder, saveCloudPaymentMethod } from '../lib/cloudDb.ts';
import { useCurrency } from '../lib/currency.tsx';
import { useFirebase } from '../lib/firebaseContext.tsx';
import type { CartItem, Order, SavedPaymentMethod, User } from '../types.ts';
import { CurrencySelect } from './CurrencySelect.tsx';
import { ProductImage } from './ProductImage.tsx';

interface CartCheckoutDrawerProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  user: User | null;
  savedMethods: SavedPaymentMethod[];
  onUpdateQty: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onRequireAuth: () => void;
  onOrderCompleted: (order: Order, updatedMethods?: SavedPaymentMethod[]) => void;
}

export function CartCheckoutDrawer({
  open,
  onClose,
  cart,
  user,
  savedMethods,
  onUpdateQty,
  onRemoveItem,
  onRequireAuth,
  onOrderCompleted,
}: CartCheckoutDrawerProps) {
  const { formatPrice } = useCurrency();
  const { firebaseUser } = useFirebase();
  const [step, setStep] = useState<'bag' | 'shipping' | 'payment'>('bag');
  const [shippingName, setShippingName] = useState('');
  const [shippingAddress, setShippingAddress] = useState('742 Evergreen Terrace, Apt 4B');
  const [shippingCity, setShippingCity] = useState('San Francisco, CA');
  const [shippingPostal, setShippingPostal] = useState('94107');
  const [shippingPhone, setShippingPhone] = useState('+1 (415) 555-0148');

  // Payment Gateway state
  const [selectedSavedToken, setSelectedSavedToken] = useState<string>('');
  const [useNewCard, setUseNewCard] = useState(true);
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expMonth, setExpMonth] = useState('12');
  const [expYear, setExpYear] = useState('2028');
  const [cvc, setCvc] = useState('');
  const [saveMethod, setSaveMethod] = useState(true);
  const [idempotencyKey, setIdempotencyKey] = useState(() => `idem_${Date.now()}`);

  const [paymentIntent, setPaymentIntent] = useState<{
    id: string;
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    amountCents: number;
  } | null>(null);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !shippingName) {
      setShippingName(user.name);
      setCardholderName(user.name);
    }
  }, [user]);

  useEffect(() => {
    if (savedMethods.length > 0) {
      setSelectedSavedToken(savedMethods[0].token);
      setUseNewCard(false);
    } else {
      setUseNewCard(true);
    }
  }, [savedMethods]);

  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const subtotalCents = cart.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);
  const shippingCents = subtotalCents >= 15000 || subtotalCents === 0 ? 0 : 1200;
  const taxCents = Math.round(subtotalCents * 0.0825);
  const totalCents = subtotalCents + shippingCents + taxCents;
  const freeShippingRemaining = Math.max(0, 15000 - subtotalCents);

  const formatCardNumberInput = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  };

  const fillValidTestCard = () => {
    setUseNewCard(true);
    setCardholderName(user?.name || 'Maya Lin');
    setCardNumber('4532 0151 1283 0366'); // Luhn-valid test number
    setExpMonth('10');
    setExpYear('2029');
    setCvc('842');
  };

  const handleProceedToShipping = () => {
    setError(null);
    if (!user) {
      onClose();
      onRequireAuth();
      return;
    }
    setStep('shipping');
  };

  const handleShippingContinue = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (firebaseUser) {
      setPaymentIntent({
        id: `pi_cloud_${Date.now().toString(36)}`,
        subtotalCents,
        shippingCents,
        taxCents,
        amountCents: totalCents,
      });
      setStep('payment');
      return;
    }
    setProcessing(true);
    try {
      const res = await apiFetch<{
        paymentIntent: {
          id: string;
          subtotalCents: number;
          shippingCents: number;
          taxCents: number;
          amountCents: number;
        };
      }>('/api/payments/create-intent', {
        method: 'POST',
        body: JSON.stringify({
          items: cart.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
          idempotencyKey,
        }),
      });
      setPaymentIntent(res.paymentIntent);
      setStep('payment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initialize checkout.');
    } finally {
      setProcessing(false);
    }
  };

  const handleConfirmPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!paymentIntent) return;
    setError(null);
    setProcessing(true);

    try {
      let tokenToUse = selectedSavedToken;
      let brandToUse = '';
      let last4ToUse = '';
      let updatedMethods: SavedPaymentMethod[] | undefined;

      if (firebaseUser && user) {
        if (useNewCard || !tokenToUse) {
          const { method } = await saveCloudPaymentMethod(firebaseUser, {
            cardNumber,
            expMonth: Number(expMonth),
            expYear: Number(expYear),
            cvc,
            cardholderName,
            saveMethod,
          });
          tokenToUse = method.token;
          brandToUse = method.brand;
          last4ToUse = method.last4;
          if (saveMethod) {
            updatedMethods = [method, ...savedMethods];
          }
        } else {
          const chosen = savedMethods.find((m) => m.token === tokenToUse);
          brandToUse = chosen?.brand || 'Visa';
          last4ToUse = chosen?.last4 || '4242';
        }

        const cloudOrder = await createCloudOrder(firebaseUser, user, {
          cart,
          paymentBrand: brandToUse,
          paymentLast4: last4ToUse,
          shippingName,
          shippingAddress,
          shippingCity,
          shippingPostal,
          shippingPhone,
        });

        setStep('bag');
        setPaymentIntent(null);
        setIdempotencyKey(`idem_${Date.now()}`);
        setCardNumber('');
        setCvc('');
        onOrderCompleted(cloudOrder, updatedMethods);
        return;
      }

      if (useNewCard || !tokenToUse) {
        const tokenRes = await apiFetch<{
          tokenizedMethod: { token: string; brand: string; last4: string };
          methods: SavedPaymentMethod[];
        }>('/api/payments/tokenize', {
          method: 'POST',
          body: JSON.stringify({
            cardNumber,
            expMonth: Number(expMonth),
            expYear: Number(expYear),
            cvc,
            cardholderName,
            saveMethod,
          }),
        });
        tokenToUse = tokenRes.tokenizedMethod.token;
        brandToUse = tokenRes.tokenizedMethod.brand;
        last4ToUse = tokenRes.tokenizedMethod.last4;
        updatedMethods = tokenRes.methods;
      }

      const confirmRes = await apiFetch<{ order: Order }>('/api/payments/confirm-intent', {
        method: 'POST',
        body: JSON.stringify({
          paymentIntentId: paymentIntent.id,
          paymentMethodToken: tokenToUse,
          cardBrand: brandToUse,
          cardLast4: last4ToUse,
          shippingName,
          shippingAddress,
          shippingCity,
          shippingPostal,
          shippingPhone,
        }),
      });

      // Reset checkout state for next order
      setStep('bag');
      setPaymentIntent(null);
      setIdempotencyKey(`idem_${Date.now()}`);
      setCardNumber('');
      setCvc('');
      onOrderCompleted(confirmRes.order, updatedMethods);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment authorization failed.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]">
      <div
        className="w-full max-w-lg bg-[#FAF9F6] h-full flex flex-col border-l border-[#E6E4DF] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping Bag and Secure Checkout"
      >
        {/* Drawer Header */}
        <div className="px-6 py-4 bg-white border-b border-[#E6E4DF] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {step !== 'bag' && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep(step === 'payment' ? 'shipping' : 'bag');
                }}
                className="p-1.5 -ml-1.5 text-[#5C626B] hover:text-[#111315] rounded-md"
                aria-label="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="font-display text-lg font-bold text-[#111315]">
              {step === 'bag' && `Your Bag (${cart.reduce((s, c) => s + c.quantity, 0)})`}
              {step === 'shipping' && 'Shipping Details'}
              {step === 'payment' && 'Radix Pay Secure Checkout'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <CurrencySelect compact className="py-1.5 text-xs" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close bag"
              className="p-2 text-[#5C626B] hover:text-[#111315] rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <ShoppingBag className="w-10 h-10 text-[#8C8880] mb-3" />
              <p className="font-display text-base font-semibold text-[#111315]">Your bag is empty</p>
              <p className="text-sm text-[#5C626B] mt-1 max-w-xs">
                Browse curated audio, keyboards, optics, and travel goods from verified Radix sellers.
              </p>
            </div>
          ) : step === 'bag' ? (
            <div className="space-y-5">
              <div className="bg-white border border-[#E6E4DF] rounded-xl p-4 text-xs text-[#5C626B]">
                {freeShippingRemaining === 0 ? (
                  <span className="font-semibold text-[#15803D]">
                    Qualifies for complimentary insured shipping
                  </span>
                ) : (
                  <span className="tabular-nums">
                    Add {formatPrice(freeShippingRemaining)} more for complimentary insured shipping
                  </span>
                )}
              </div>

              {cart.map(({ product, quantity }) => (
                <div
                  key={product.id}
                  className="bg-white border border-[#E6E4DF] rounded-xl p-4 flex gap-4"
                >
                  <div className="w-20 h-16 rounded-lg overflow-hidden bg-[#F3F1EC] shrink-0">
                    <ProductImage
                      src={product.imageUrl}
                      alt={product.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[#111315] line-clamp-1">
                        {product.title}
                      </h3>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(product.id)}
                        aria-label={`Remove ${product.title}`}
                        className="text-[#8C8880] hover:text-red-700 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xs text-[#5C626B] mt-0.5">{product.sellerName}</p>
                    <div className="flex items-center justify-between mt-3">
                      <div className="inline-flex items-center border border-[#D4D0C8] rounded-md bg-[#FAF9F6]">
                        <button
                          type="button"
                          onClick={() => onUpdateQty(product.id, Math.max(1, quantity - 1))}
                          className="px-2.5 py-1 text-xs font-semibold"
                        >
                          −
                        </button>
                        <span className="px-2.5 py-1 text-xs font-mono tabular-nums">{quantity}</span>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateQty(product.id, Math.min(product.stock, quantity + 1))
                          }
                          className="px-2.5 py-1 text-xs font-semibold"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-sm font-semibold text-[#111315] tabular-nums">
                        {formatPrice(product.priceCents * quantity)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : step === 'shipping' ? (
            <form id="shipping-form" onSubmit={handleShippingContinue} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#5C626B] mb-1">
                  Recipient Full Name
                </label>
                <input
                  type="text"
                  required
                  value={shippingName}
                  onChange={(e) => setShippingName(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#5C626B] mb-1">
                  Street Address
                </label>
                <input
                  type="text"
                  required
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#5C626B] mb-1">
                    City &amp; State
                  </label>
                  <input
                    type="text"
                    required
                    value={shippingCity}
                    onChange={(e) => setShippingCity(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5C626B] mb-1">
                    Postal Code
                  </label>
                  <input
                    type="text"
                    required
                    value={shippingPostal}
                    onChange={(e) => setShippingPostal(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#5C626B] mb-1">
                  Contact Phone (Carrier Updates)
                </label>
                <input
                  type="tel"
                  required
                  value={shippingPhone}
                  onChange={(e) => setShippingPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                />
              </div>
            </form>
          ) : (
            <form id="payment-form" onSubmit={handleConfirmPayment} className="space-y-5">
              <div className="bg-white border border-[#E6E4DF] rounded-xl p-4 flex items-start gap-3 text-xs text-[#5C626B]">
                <ShieldCheck className="w-4 h-4 text-[#15803D] shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[#111315]">
                    Server-Verified Totals &amp; Idempotent Gateway
                  </p>
                  <p className="mt-0.5 font-mono">
                    Intent {paymentIntent?.id} · Key {idempotencyKey.slice(0, 14)}
                  </p>
                </div>
              </div>

              {savedMethods.length > 0 && (
                <div className="space-y-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#5C626B]">
                    Vaulted Payment Methods
                  </p>
                  {savedMethods.map((pm) => (
                    <label
                      key={pm.id}
                      className={`flex items-center justify-between p-3.5 bg-white border rounded-xl cursor-pointer transition-colors ${
                        !useNewCard && selectedSavedToken === pm.token
                          ? 'border-[#C2410C]'
                          : 'border-[#E6E4DF]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="paymentMethodChoice"
                          checked={!useNewCard && selectedSavedToken === pm.token}
                          onChange={() => {
                            setUseNewCard(false);
                            setSelectedSavedToken(pm.token);
                          }}
                          className="accent-[#C2410C]"
                        />
                        <CreditCard className="w-4 h-4 text-[#5C626B]" />
                        <div>
                          <p className="text-sm font-semibold text-[#111315] tabular-nums">
                            {pm.brand} •••• {pm.last4}
                          </p>
                          <p className="text-xs text-[#5C626B] tabular-nums">
                            Exp {String(pm.expMonth).padStart(2, '0')}/{pm.expYear}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-mono text-[#5C626B]">Tokenized</span>
                    </label>
                  ))}

                  <label
                    className={`flex items-center gap-3 p-3.5 bg-white border rounded-xl cursor-pointer ${
                      useNewCard ? 'border-[#C2410C]' : 'border-[#E6E4DF]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethodChoice"
                      checked={useNewCard}
                      onChange={() => setUseNewCard(true)}
                      className="accent-[#C2410C]"
                    />
                    <span className="text-sm font-semibold text-[#111315]">
                      Pay with a new card
                    </span>
                  </label>
                </div>
              )}

              {useNewCard && (
                <div className="bg-white border border-[#E6E4DF] rounded-xl p-4 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#5C626B]">
                      Card Details (Luhn Validated)
                    </span>
                    <button
                      type="button"
                      onClick={fillValidTestCard}
                      className="text-xs font-semibold text-[#C2410C] hover:underline"
                    >
                      Fill Test Card
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#5C626B] mb-1">
                      Cardholder Name
                    </label>
                    <input
                      type="text"
                      required
                      value={cardholderName}
                      onChange={(e) => setCardholderName(e.target.value)}
                      placeholder="Maya Lin"
                      className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#5C626B] mb-1">
                      Card Number
                    </label>
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(formatCardNumberInput(e.target.value))}
                      placeholder="4532 0151 1283 0366"
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    <div>
                      <label className="block text-xs font-medium text-[#5C626B] mb-1">
                        Month
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="12"
                        required
                        value={expMonth}
                        onChange={(e) => setExpMonth(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#5C626B] mb-1">
                        Year
                      </label>
                      <input
                        type="number"
                        min="2026"
                        max="2040"
                        required
                        value={expYear}
                        onChange={(e) => setExpYear(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#5C626B] mb-1">
                        CVC
                      </label>
                      <input
                        type="password"
                        required
                        maxLength={4}
                        value={cvc}
                        onChange={(e) => setCvc(e.target.value.replace(/\D/g, ''))}
                        placeholder="842"
                        className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-[#5C626B] pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveMethod}
                      onChange={(e) => setSaveMethod(e.target.checked)}
                      className="accent-[#C2410C]"
                    />
                    <span>Vault tokenized card for faster future checkouts</span>
                  </label>
                </div>
              )}
            </form>
          )}

          {error && (
            <div className="mt-4 p-3 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Drawer Footer Totals + Primary Action */}
        {cart.length > 0 && (
          <div className="px-6 py-5 bg-white border-t border-[#E6E4DF] space-y-4">
            <div className="space-y-1.5 text-xs text-[#5C626B]">
              <div className="flex justify-between tabular-nums">
                <span>Subtotal</span>
                <span>{formatPrice(paymentIntent?.subtotalCents ?? subtotalCents)}</span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span>Insured Shipping</span>
                <span>
                  {(paymentIntent?.shippingCents ?? shippingCents) === 0
                    ? 'Free'
                    : formatPrice(paymentIntent?.shippingCents ?? shippingCents)}
                </span>
              </div>
              <div className="flex justify-between tabular-nums">
                <span>Estimated Tax (8.25%)</span>
                <span>{formatPrice(paymentIntent?.taxCents ?? taxCents)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-[#111315] pt-2 border-t border-[#EFECE6] tabular-nums">
                <span>Total</span>
                <span>{formatPrice(paymentIntent?.amountCents ?? totalCents)}</span>
              </div>
            </div>

            {step === 'bag' && (
              <button
                type="button"
                onClick={handleProceedToShipping}
                className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] rounded-lg transition-colors"
              >
                {user ? 'Continue to Checkout' : 'Sign In to Checkout'}
              </button>
            )}

            {step === 'shipping' && (
              <button
                type="submit"
                form="shipping-form"
                disabled={processing}
                className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#111315] hover:bg-[#272A2E] disabled:opacity-50 rounded-lg transition-colors"
              >
                {processing ? 'Preparing Payment Intent...' : 'Continue to Radix Pay'}
              </button>
            )}

            {step === 'payment' && (
              <button
                type="submit"
                form="payment-form"
                disabled={processing}
                className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                {processing
                  ? 'Authorizing Payment...'
                  : `Authorize & Pay ${formatPrice(paymentIntent?.amountCents ?? totalCents)}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
