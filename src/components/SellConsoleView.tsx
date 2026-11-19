import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, PackagePlus, Store, Truck } from 'lucide-react';
import {
  apiFetch,
  formatDateTime,
  getOrderStageLabel,
  STUDIO_IMAGE_PRESETS,
} from '../lib/api.ts';
import {
  activateCloudSellerStorefront,
  advanceCloudOrderStage,
  createCloudProduct,
  updateCloudProductStock,
} from '../lib/cloudDb.ts';
import { useCurrency } from '../lib/currency.tsx';
import { useFirebase } from '../lib/firebaseContext.tsx';
import type { Order, Product, User } from '../types.ts';
import { ProductImage } from './ProductImage.tsx';

interface SellConsoleViewProps {
  user: User | null;
  cloudSellerOrders?: Order[];
  cloudProducts?: Product[];
  onRequireAuth: () => void;
  onUserUpdated: (user: User) => void;
  onCatalogMutated: () => void;
  onTrackOrder: (trackingCode: string) => void;
}

const CATEGORIES = ['Audio', 'Coffee & Kitchen', 'Computing', 'Lighting', 'Timepieces', 'Optics', 'Carry'];

export function SellConsoleView({
  user,
  cloudSellerOrders = [],
  cloudProducts = [],
  onRequireAuth,
  onUserUpdated,
  onCatalogMutated,
  onTrackOrder,
}: SellConsoleViewProps) {
  const { formatPrice } = useCurrency();
  const { firebaseUser } = useFirebase();
  const [tab, setTab] = useState<'create' | 'inventory' | 'fulfillment'>('fulfillment');
  const [storeName, setStoreName] = useState('');
  const [location, setLocation] = useState('');
  const [bio, setBio] = useState('');
  const [onboardLoading, setOnboardLoading] = useState(false);
  const [onboardError, setOnboardError] = useState<string | null>(null);

  // Seller data
  const [sellerOrders, setSellerOrders] = useState<Order[]>([]);
  const [listings, setListings] = useState<Product[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Create Product Form
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priceDollars, setPriceDollars] = useState('195');
  const [stock, setStock] = useState('12');
  const [sku, setSku] = useState('');
  const [imageUrl, setImageUrl] = useState(STUDIO_IMAGE_PRESETS[0].url);
  const [description, setDescription] = useState('');
  const [specLabel1, setSpecLabel1] = useState('Materials');
  const [specVal1, setSpecVal1] = useState('Anodized 6061 Aluminum');
  const [createLoading, setCreateLoading] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Fulfillment note input per order
  const [fulfillNotes, setFulfillNotes] = useState<Record<string, string>>({});
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const loadSellerData = async () => {
    if (!user?.sellerProfile) return;
    if (firebaseUser) {
      setSellerOrders(cloudSellerOrders);
      setListings(cloudProducts.filter((p) => p.sellerId === user.sellerProfile?.id));
      setLoadingData(false);
      return;
    }
    setLoadingData(true);
    try {
      const res = await apiFetch<{ orders: Order[]; listings: Product[] }>('/api/seller/orders');
      setSellerOrders(res.orders);
      setListings(res.listings);
    } catch {
      // ignore
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (user?.sellerProfile) {
      void loadSellerData();
    }
  }, [user?.id, user?.sellerProfile?.id, firebaseUser?.uid, cloudSellerOrders, cloudProducts]);

  if (!user) {
    return (
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <Store className="w-10 h-10 text-[#C2410C] mx-auto mb-4" />
        <h1 className="font-display text-3xl font-bold text-[#111315]">
          Sell Directly on Radix
        </h1>
        <p className="text-base text-[#5C626B] mt-3 max-w-xl mx-auto leading-relaxed">
          Sign in or register a seller account to publish product listings, manage inventory, and dispatch live-tracked orders to verified buyers.
        </p>
        <button
          type="button"
          onClick={onRequireAuth}
          className="mt-7 px-6 py-3 text-sm font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] rounded-lg transition-colors"
        >
          Sign In or Create Seller Account
        </button>
      </section>
    );
  }

  if (!user.sellerProfile) {
    const handleOnboard = async (e: FormEvent) => {
      e.preventDefault();
      setOnboardError(null);
      setOnboardLoading(true);
      try {
        if (firebaseUser) {
          const updatedUser = await activateCloudSellerStorefront(firebaseUser, {
            storeName,
            location,
            bio,
          });
          onUserUpdated(updatedUser);
        } else {
          const res = await apiFetch<{ user: User }>('/api/sellers/onboard', {
            method: 'POST',
            body: JSON.stringify({ storeName, location, bio }),
          });
          onUserUpdated(res.user);
        }
      } catch (err) {
        setOnboardError(err instanceof Error ? err.message : 'Could not activate storefront.');
      } finally {
        setOnboardLoading(false);
      }
    };

    return (
      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-14">
        <div className="bg-white border border-[#E6E4DF] rounded-2xl p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#C2410C]">
            Seller Storefront Activation
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#111315] mt-2">
            Open your Radix merchant storefront
          </h1>
          <p className="text-sm text-[#5C626B] mt-2">
            Your buyer profile ({user.email}) will gain seller tools for listing products and fulfilling live orders.
          </p>

          <form onSubmit={handleOnboard} className="space-y-4 mt-6">
            <div>
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Storefront Name
              </label>
              <input
                type="text"
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="Northwind Hardware Lab"
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Warehouse / Dispatch City
              </label>
              <input
                type="text"
                required
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Austin, TX"
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Merchant Bio
              </label>
              <textarea
                rows={3}
                required
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Describe what you craft or curate..."
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
              />
            </div>
            {onboardError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {onboardError}
              </p>
            )}
            <button
              type="submit"
              disabled={onboardLoading}
              className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] rounded-lg transition-colors"
            >
              {onboardLoading ? 'Activating Storefront...' : 'Activate Seller Storefront'}
            </button>
          </form>
        </div>
      </section>
    );
  }

  const handleCreateProduct = async (e: FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);
    setCreateLoading(true);
    try {
      const payload = {
        title,
        category,
        priceDollars: Number(priceDollars),
        stock: Number(stock),
        sku,
        imageUrl,
        description,
        specs: specLabel1 && specVal1 ? [{ label: specLabel1, value: specVal1 }] : [],
      };
      let createdTitle = title;
      if (firebaseUser && user.sellerProfile) {
        const created = await createCloudProduct(firebaseUser, user.sellerProfile, payload);
        createdTitle = created.title;
      } else {
        const res = await apiFetch<{ product: Product }>('/api/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        createdTitle = res.product.title;
      }
      setCreateSuccess(`Published "${createdTitle}" to the live marketplace.`);
      setTitle('');
      setSku('');
      setDescription('');
      await loadSellerData();
      onCatalogMutated();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to publish listing.');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleAdvanceOrder = async (orderId: string) => {
    setAdvancingId(orderId);
    try {
      const note = fulfillNotes[orderId] || '';
      if (firebaseUser) {
        const target = sellerOrders.find((o) => o.id === orderId);
        if (target) {
          await advanceCloudOrderStage(
            firebaseUser,
            target,
            user.sellerProfile?.location || 'Radix Studio Hub',
            note,
          );
        }
      } else {
        await apiFetch<{ order: Order }>(`/api/seller/orders/${orderId}/advance`, {
          method: 'POST',
          body: JSON.stringify({ note }),
        });
      }
      setFulfillNotes((prev) => ({ ...prev, [orderId]: '' }));
      await loadSellerData();
    } catch {
      // ignore
    } finally {
      setAdvancingId(null);
    }
  };

  const handleAdjustStock = async (product: Product, delta: number) => {
    const nextStock = Math.max(0, product.stock + delta);
    if (firebaseUser) {
      await updateCloudProductStock(product.id, nextStock);
    } else {
      await apiFetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ stock: nextStock }),
      });
    }
    await loadSellerData();
    onCatalogMutated();
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-[#E6E4DF]">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-[#C2410C]">
            Seller Console · {user.sellerProfile.location}
          </p>
          <h1 className="font-display text-3xl font-bold text-[#111315] mt-1">
            {user.sellerProfile.storeName}
          </h1>
          <p className="text-sm text-[#5C626B] mt-1 tabular-nums">
            {user.sellerProfile.avgRating.toFixed(1)} ★ Seller Rating · {user.sellerProfile.reviewCount} reviews · {listings.length} listings
          </p>
        </div>

        {/* Segmented Console Tabs */}
        <div className="flex items-center gap-1 p-1 bg-[#EFECE6] rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setTab('fulfillment')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'fulfillment' ? 'bg-white text-[#111315] shadow-xs' : 'text-[#5C626B] hover:text-[#111315]'
            }`}
          >
            Order Fulfillment ({sellerOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('inventory')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'inventory' ? 'bg-white text-[#111315] shadow-xs' : 'text-[#5C626B] hover:text-[#111315]'
            }`}
          >
            Inventory ({listings.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('create')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'create' ? 'bg-white text-[#111315] shadow-xs' : 'text-[#5C626B] hover:text-[#111315]'
            }`}
          >
            List New Product
          </button>
        </div>
      </div>

      {/* Tab 1: Live Order Fulfillment */}
      {tab === 'fulfillment' && (
        <div className="mt-8 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-[#111315]">
              Incoming Buyer Orders
            </h2>
            <p className="text-xs text-[#5C626B]">
              Advancing a shipment stage broadcasts an instant WebSocket update to the buyer&apos;s tracker.
            </p>
          </div>

          {loadingData ? (
            <p className="text-sm text-[#5C626B]">Loading seller orders...</p>
          ) : sellerOrders.length === 0 ? (
            <div className="bg-white border border-[#E6E4DF] rounded-2xl p-10 text-center">
              <Truck className="w-8 h-8 text-[#8C8880] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#111315]">No incoming orders yet</p>
              <p className="text-sm text-[#5C626B] mt-1">
                When buyers purchase your products, fulfillment controls appear here.
              </p>
            </div>
          ) : (
            sellerOrders.map((order) => (
              <div
                key={order.id}
                className="bg-white border border-[#E6E4DF] rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#5C626B]">
                    <span className="font-mono font-semibold text-[#111315] tabular-nums">
                      {order.trackingCode}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-[#C2410C]">
                      {getOrderStageLabel(order.status)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatDateTime(order.updatedAt)}</span>
                  </div>
                  <p className="text-base font-semibold text-[#111315]">
                    {order.items.map((i) => `${i.titleSnapshot} (×${i.quantity})`).join(', ')}
                  </p>
                  <p className="text-xs text-[#5C626B]">
                    Ship to: {order.shippingName} · {order.shippingAddress}, {order.shippingCity} {order.shippingPostal}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                  {order.status !== 'delivered' ? (
                    <>
                      <input
                        type="text"
                        value={fulfillNotes[order.id] || ''}
                        onChange={(e) =>
                          setFulfillNotes((prev) => ({ ...prev, [order.id]: e.target.value }))
                        }
                        placeholder="Optional carrier / hub note"
                        className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg w-full sm:w-56"
                      />
                      <button
                        type="button"
                        disabled={advancingId === order.id}
                        onClick={() => handleAdvanceOrder(order.id)}
                        className="px-4 py-2 text-xs font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center justify-center gap-1.5"
                      >
                        {advancingId === order.id ? 'Broadcasting...' : 'Advance Stage'}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#15803D]">
                      <CheckCircle2 className="w-4 h-4" />
                      Delivered
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onTrackOrder(order.trackingCode)}
                    className="px-3.5 py-2 text-xs font-semibold text-[#111315] border border-[#D4D0C8] hover:border-[#111315] rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    Open Tracker
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab 2: Inventory Management */}
      {tab === 'inventory' && (
        <div className="mt-8 bg-white border border-[#E6E4DF] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E6E4DF] text-xs font-semibold uppercase tracking-wider text-[#5C626B]">
                  <th className="py-3.5 px-5">Product</th>
                  <th className="py-3.5 px-4">SKU</th>
                  <th className="py-3.5 px-4">Price</th>
                  <th className="py-3.5 px-4">Stock</th>
                  <th className="py-3.5 px-4">Rating</th>
                  <th className="py-3.5 px-5 text-right">Quick Adjust</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFECE6] text-sm">
                {listings.map((item) => (
                  <tr key={item.id} className="hover:bg-[#FAF9F6]">
                    <td className="py-4 px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-9 rounded-md overflow-hidden bg-[#F3F1EC] shrink-0">
                          <ProductImage src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <p className="font-semibold text-[#111315]">{item.title}</p>
                          <p className="text-xs text-[#5C626B]">{item.category}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 font-mono text-xs text-[#5C626B] tabular-nums">{item.sku}</td>
                    <td className="py-4 px-4 font-semibold tabular-nums">{formatPrice(item.priceCents)}</td>
                    <td className="py-4 px-4 font-mono tabular-nums">{item.stock}</td>
                    <td className="py-4 px-4 text-xs text-[#5C626B] tabular-nums">
                      {item.reviewCount > 0 ? `${item.avgRating.toFixed(1)} ★ (${item.reviewCount})` : '—'}
                    </td>
                    <td className="py-4 px-5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAdjustStock(item, -1)}
                          className="px-2.5 py-1 text-xs font-semibold border border-[#D4D0C8] rounded hover:border-[#111315]"
                        >
                          −1
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAdjustStock(item, 5)}
                          className="px-2.5 py-1 text-xs font-semibold border border-[#D4D0C8] rounded hover:border-[#111315]"
                        >
                          +5
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Create New Listing */}
      {tab === 'create' && (
        <form
          onSubmit={handleCreateProduct}
          className="mt-8 bg-white border border-[#E6E4DF] rounded-2xl p-6 sm:p-8 max-w-3xl space-y-5"
        >
          <div className="flex items-center gap-2.5">
            <PackagePlus className="w-5 h-5 text-[#C2410C]" />
            <h2 className="font-display text-xl font-bold text-[#111315]">
              Publish a Product Listing
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Product Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Monolith CNC Desktop Amplifier"
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                SKU Code (optional)
              </label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="RDX-AMP-01"
                className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Price (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={priceDollars}
                onChange={(e) => setPriceDollars(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Initial Stock Units
              </label>
              <input
                type="number"
                min="1"
                required
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Studio Image Preset
              </label>
              <select
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
              >
                {STUDIO_IMAGE_PRESETS.map((preset) => (
                  <option key={preset.url} value={preset.url}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#5C626B] mb-1">
                Primary Spec Label
              </label>
              <input
                type="text"
                value={specLabel1}
                onChange={(e) => setSpecLabel1(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C626B] mb-1">
                Primary Spec Value
              </label>
              <input
                type="text"
                value={specVal1}
                onChange={(e) => setSpecVal1(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-[#111315] mb-1.5">
                Product Description
              </label>
              <textarea
                rows={4}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe engineering details, materials, warranty, and included accessories..."
                className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
              />
            </div>
          </div>

          {createError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {createError}
            </p>
          )}
          {createSuccess && (
            <p className="text-xs text-[#15803D] bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              {createSuccess}
            </p>
          )}

          <button
            type="submit"
            disabled={createLoading}
            className="px-6 py-3 text-sm font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] rounded-lg transition-colors"
          >
            {createLoading ? 'Publishing...' : 'Publish Listing to Radix'}
          </button>
        </form>
      )}
    </section>
  );
}
