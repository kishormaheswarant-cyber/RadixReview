import { useEffect, useState, type FormEvent } from 'react';
import { Check, MapPin, Radio, Search, ShieldCheck, Truck } from 'lucide-react';
import {
  apiFetch,
  formatDateTime,
  getOrderStageLabel,
  ORDER_STAGES,
} from '../lib/api.ts';
import { useCurrency } from '../lib/currency.tsx';
import type { Order } from '../types.ts';
import { ProductImage } from './ProductImage.tsx';

interface OrderTrackerViewProps {
  initialCode?: string | null;
  userOrders: Order[];
  onSelectProduct: (productId: string) => void;
}

export function OrderTrackerView({
  initialCode,
  userOrders,
  onSelectProduct,
}: OrderTrackerViewProps) {
  const { formatPrice } = useCurrency();
  const [searchCode, setSearchCode] = useState(initialCode || 'RDX-849201');
  const [trackedOrder, setTrackedOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const fetchOrder = async (code: string) => {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    const localMatch = userOrders.find((o) => o.trackingCode.toUpperCase() === clean);
    if (localMatch) {
      setError(null);
      setTrackedOrder(localMatch);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ order: Order }>(`/api/orders/track/${encodeURIComponent(clean)}`);
      setTrackedOrder(res.order);
    } catch (err) {
      setTrackedOrder(null);
      setError(err instanceof Error ? err.message : 'Order not found.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const target = initialCode || userOrders[0]?.trackingCode || 'RDX-849201';
    setSearchCode(target);
    void fetchOrder(target);
  }, [initialCode]);

  useEffect(() => {
    if (!trackedOrder) return;
    const liveMatch = userOrders.find((o) => o.id === trackedOrder.id);
    if (liveMatch) {
      setTrackedOrder(liveMatch);
    }
  }, [userOrders]);

  // Real WebSocket subscription to live order updates
  useEffect(() => {
    if (!trackedOrder) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(
        JSON.stringify({
          type: 'subscribe:order',
          orderId: trackedOrder.id,
          trackingCode: trackedOrder.trackingCode,
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type?: string; order?: Order };
        if (
          (msg.type === 'order:updated' || msg.type === 'order:created') &&
          msg.order &&
          msg.order.id === trackedOrder.id
        ) {
          setTrackedOrder(msg.order);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    ws.onerror = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [trackedOrder?.id]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void fetchOrder(searchCode);
  };

  const activeStageIdx = trackedOrder
    ? ORDER_STAGES.findIndex((s) => s.key === trackedOrder.status)
    : -1;

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-[#E6E4DF]">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[#C2410C]">
            Real-Time Order Tracking
          </p>
          <h1 className="font-display text-3xl font-bold text-[#111315] mt-1">
            Track Shipment Status
          </h1>
          <p className="text-sm text-[#5C626B] mt-1">
            Enter a tracking reference or pick an active order to stream live seller &amp; carrier updates.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="w-4 h-4 text-[#5C626B] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              placeholder="RDX-849201"
              className="w-full pl-10 pr-3.5 py-2.5 text-sm font-mono uppercase bg-white border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2.5 text-sm font-semibold text-white bg-[#111315] hover:bg-[#272A2E] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {loading ? 'Looking up...' : 'Track'}
          </button>
        </form>
      </div>

      {/* Quick Order Shortcuts */}
      <div className="flex flex-wrap items-center gap-2 mt-5 text-xs">
        <span className="text-[#5C626B] font-medium">Sample / Recent Orders:</span>
        {['RDX-849201', 'RDX-409182', ...userOrders.map((o) => o.trackingCode)]
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .slice(0, 5)
          .map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                setSearchCode(code);
                void fetchOrder(code);
              }}
              className={`px-3 py-1.5 font-mono rounded-md border transition-colors ${
                trackedOrder?.trackingCode === code
                  ? 'bg-[#111315] text-white border-[#111315]'
                  : 'bg-white text-[#111315] border-[#D4D0C8] hover:border-[#111315]'
              }`}
            >
              {code}
            </button>
          ))}
      </div>

      {error && (
        <div className="mt-8 p-5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
          {error}
        </div>
      )}

      {trackedOrder && (
        <div className="mt-8 space-y-8">
          {/* Live Status Card */}
          <div className="bg-white border border-[#E6E4DF] rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#EFECE6]">
              <div>
                <div className="flex items-center gap-2.5 text-xs text-[#5C626B]">
                  <span className="font-mono font-semibold text-[#111315] tabular-nums">
                    {trackedOrder.trackingCode}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Est. Delivery: {trackedOrder.estimatedDelivery}</span>
                </div>
                <h2 className="font-display text-2xl font-bold text-[#111315] mt-1">
                  {getOrderStageLabel(trackedOrder.status)}
                </h2>
              </div>

              <div className="inline-flex items-center gap-2 text-xs font-medium text-[#5C626B]">
                <Radio className={`w-4 h-4 ${wsConnected ? 'text-[#15803D]' : 'text-[#8C8880]'}`} />
                <span>
                  {wsConnected ? 'Live WebSocket Connected' : 'WebSocket Reconnecting'}
                </span>
              </div>
            </div>

            {/* 5-Stage Progress Stepper */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mt-8">
              {ORDER_STAGES.map((stage, idx) => {
                const isCompleted = idx <= activeStageIdx;
                const isCurrent = idx === activeStageIdx;
                return (
                  <div key={stage.key} className="relative">
                    <div className="flex items-center gap-2.5 sm:block">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold tabular-nums transition-colors ${
                          isCurrent
                            ? 'bg-[#C2410C] text-white'
                            : isCompleted
                              ? 'bg-[#111315] text-white'
                              : 'bg-[#EFECE6] text-[#5C626B]'
                        }`}
                      >
                        {isCompleted ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                      </div>
                      <div className="sm:mt-3">
                        <p
                          className={`text-sm font-semibold ${
                            isCompleted ? 'text-[#111315]' : 'text-[#8C8880]'
                          }`}
                        >
                          {stage.label}
                        </p>
                        <p className="text-xs text-[#5C626B] mt-0.5">{stage.description}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Chronological Carrier & Warehouse Timeline */}
            <div className="lg:col-span-7 bg-white border border-[#E6E4DF] rounded-2xl p-6">
              <h3 className="font-display text-lg font-bold text-[#111315] mb-5">
                Transit Event Log
              </h3>
              <div className="space-y-5">
                {[...trackedOrder.events].reverse().map((evt, index) => (
                  <div
                    key={evt.id}
                    className="flex items-start gap-4 pb-5 last:pb-0 border-b last:border-b-0 border-[#EFECE6]"
                  >
                    <div className="mt-0.5">
                      <Truck
                        className={`w-4 h-4 ${
                          index === 0 ? 'text-[#C2410C]' : 'text-[#8C8880]'
                        }`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#111315]">
                          {getOrderStageLabel(evt.status)}
                        </span>
                        <span className="text-xs font-mono text-[#5C626B] tabular-nums">
                          {formatDateTime(evt.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm text-[#3F444B] mt-1">{evt.note}</p>
                      <p className="text-xs text-[#5C626B] mt-1 inline-flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {evt.location}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Order Receipt & Payment Verification */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white border border-[#E6E4DF] rounded-2xl p-6 space-y-4">
                <h3 className="font-display text-lg font-bold text-[#111315]">
                  Items in Shipment
                </h3>
                <div className="space-y-4">
                  {trackedOrder.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3.5">
                      <div className="w-16 h-12 rounded-lg overflow-hidden bg-[#F3F1EC] shrink-0">
                        <ProductImage
                          src={item.imageSnapshot}
                          alt={item.titleSnapshot}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => onSelectProduct(item.productId)}
                          className="text-sm font-semibold text-[#111315] hover:text-[#C2410C] text-left truncate block w-full"
                        >
                          {item.titleSnapshot}
                        </button>
                        <p className="text-xs text-[#5C626B] tabular-nums">
                          Qty {item.quantity} · {item.sellerName}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-[#111315] tabular-nums">
                        {formatPrice(item.unitPriceCents * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-[#EFECE6] space-y-1.5 text-xs text-[#5C626B]">
                  <div className="flex justify-between tabular-nums">
                    <span>Subtotal</span>
                    <span>{formatPrice(trackedOrder.subtotalCents)}</span>
                  </div>
                  <div className="flex justify-between tabular-nums">
                    <span>Shipping</span>
                    <span>
                      {trackedOrder.shippingCents === 0
                        ? 'Free'
                        : formatPrice(trackedOrder.shippingCents)}
                    </span>
                  </div>
                  <div className="flex justify-between tabular-nums">
                    <span>Tax</span>
                    <span>{formatPrice(trackedOrder.taxCents)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-[#111315] pt-2 border-t border-[#EFECE6] tabular-nums">
                    <span>Total Paid</span>
                    <span>{formatPrice(trackedOrder.totalCents)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-[#E6E4DF] rounded-2xl p-6 space-y-3 text-xs text-[#5C626B]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#111315]">
                  <ShieldCheck className="w-4 h-4 text-[#15803D]" />
                  <span>Destination &amp; Payment Receipt</span>
                </div>
                <p className="text-[#111315] font-medium">{trackedOrder.shippingName}</p>
                <p>
                  {trackedOrder.shippingAddress}, {trackedOrder.shippingCity}{' '}
                  {trackedOrder.shippingPostal}
                </p>
                <p className="pt-2 border-t border-[#EFECE6] font-mono tabular-nums">
                  Authorized via {trackedOrder.paymentBrand} •••• {trackedOrder.paymentLast4} ·{' '}
                  {trackedOrder.gatewayReference}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
