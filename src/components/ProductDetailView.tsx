import { useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Globe,
  Plus,
  ShieldCheck,
  Star,
  Truck,
} from 'lucide-react';
import { apiFetch, formatDate } from '../lib/api.ts';
import { createCloudExternalOffer, createCloudReview } from '../lib/cloudDb.ts';
import { useCurrency } from '../lib/currency.tsx';
import { useFirebase } from '../lib/firebaseContext.tsx';
import type {
  ExternalOffer,
  ExternalReview,
  Product,
  Review,
  SellerSummary,
  User,
} from '../types.ts';
import { CurrencySelect } from './CurrencySelect.tsx';
import { ProductImage } from './ProductImage.tsx';

interface ProductDetailViewProps {
  product: Product;
  reviews: Review[];
  externalOffers: ExternalOffer[];
  externalReviews: ExternalReview[];
  seller: SellerSummary | null;
  user: User | null;
  onBack: () => void;
  onAddToCart: (product: Product, quantity: number) => void;
  onBuyNow: (product: Product, quantity: number) => void;
  onViewSeller: (sellerId: string) => void;
  onReviewCreated: (updated: {
    product: Product;
    reviews: Review[];
    seller: SellerSummary | null;
    externalOffers: ExternalOffer[];
    externalReviews: ExternalReview[];
  }) => void;
  onOffersUpdated: (updated: { product: Product; externalOffers: ExternalOffer[] }) => void;
  onRequireAuth: () => void;
}

export function ProductDetailView({
  product,
  reviews,
  externalOffers,
  externalReviews,
  seller,
  user,
  onBack,
  onAddToCart,
  onBuyNow,
  onViewSeller,
  onReviewCreated,
  onOffersUpdated,
  onRequireAuth,
}: ProductDetailViewProps) {
  const { formatPrice } = useCurrency();
  const { firebaseUser } = useFirebase();
  const [quantity, setQuantity] = useState(1);
  const [rating, setRating] = useState(5);
  const [sellerRating, setSellerRating] = useState(5);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [addedFeedback, setAddedFeedback] = useState(false);

  // Combined review source filter
  const [reviewFilter, setReviewFilter] = useState<'all' | 'radix' | 'external'>('all');

  // Add external website offer form
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerSiteName, setOfferSiteName] = useState('');
  const [offerUrl, setOfferUrl] = useState('');
  const [offerPrice, setOfferPrice] = useState('');
  const [offerShipping, setOfferShipping] = useState('0');
  const [offerDelivery, setOfferDelivery] = useState('3–5 business days');
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);

  // Combined rating math across Radix verified + External website reviews
  const allRatings = [
    ...reviews.map((r) => r.rating),
    ...externalReviews.map((r) => r.rating),
  ];
  const combinedTotal = allRatings.length;
  const combinedAvg =
    combinedTotal > 0
      ? allRatings.reduce((sum, val) => sum + val, 0) / combinedTotal
      : 0;

  const ratingBreakdown = [5, 4, 3, 2, 1].map((stars) => {
    const count = allRatings.filter((r) => r === stars).length;
    const pct = combinedTotal ? Math.round((count / combinedTotal) * 100) : 0;
    return { stars, count, pct };
  });

  // Combined unified review stream sorted by date descending
  type CombinedReviewItem =
    | { kind: 'radix'; date: string; data: Review }
    | { kind: 'external'; date: string; data: ExternalReview };

  const unifiedReviews: CombinedReviewItem[] = [
    ...reviews.map((r) => ({ kind: 'radix' as const, date: r.createdAt, data: r })),
    ...externalReviews.map((r) => ({ kind: 'external' as const, date: r.publishedAt, data: r })),
  ]
    .filter((item) => {
      if (reviewFilter === 'radix') return item.kind === 'radix';
      if (reviewFilter === 'external') return item.kind === 'external';
      return true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const radixShippingCents = product.priceCents >= 15000 ? 0 : 1200;
  const radixLandedCents = product.priceCents + radixShippingCents;

  const handleAdd = () => {
    onAddToCart(product, quantity);
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 1800);
  };

  const handleReviewSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }
    setReviewError(null);
    setSubmitting(true);
    try {
      if (firebaseUser) {
        const created = await createCloudReview(firebaseUser, user, product, {
          rating,
          sellerRating,
          title,
          comment,
        });
        setTitle('');
        setComment('');
        onReviewCreated({
          product,
          reviews: [created, ...reviews],
          seller,
          externalOffers,
          externalReviews,
        });
      } else {
        const res = await apiFetch<{
          product: Product;
          reviews: Review[];
          seller: SellerSummary | null;
        }>(`/api/products/${product.id}/reviews`, {
          method: 'POST',
          body: JSON.stringify({ rating, sellerRating, title, comment }),
        });
        setTitle('');
        setComment('');
        onReviewCreated({
          ...res,
          externalOffers,
          externalReviews,
        });
      }
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Failed to submit review.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOfferSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      onRequireAuth();
      return;
    }
    setOfferError(null);
    setOfferSubmitting(true);
    try {
      if (firebaseUser) {
        const created = await createCloudExternalOffer(firebaseUser, product.id, {
          siteName: offerSiteName,
          offerUrl,
          priceDollars: Number(offerPrice),
          shippingDollars: Number(offerShipping),
          deliveryWindow: offerDelivery,
        });
        setOfferSiteName('');
        setOfferUrl('');
        setOfferPrice('');
        setShowOfferForm(false);
        onOffersUpdated({
          product,
          externalOffers: [created, ...externalOffers],
        });
      } else {
        const res = await apiFetch<{ product: Product; externalOffers: ExternalOffer[] }>(
          `/api/products/${product.id}/offers`,
          {
            method: 'POST',
            body: JSON.stringify({
              siteName: offerSiteName,
              offerUrl,
              priceDollars: Number(offerPrice),
              shippingDollars: Number(offerShipping),
              deliveryWindow: offerDelivery,
            }),
          },
        );
        setOfferSiteName('');
        setOfferUrl('');
        setOfferPrice('');
        setShowOfferForm(false);
        onOffersUpdated(res);
      }
    } catch (err) {
      setOfferError(err instanceof Error ? err.message : 'Could not add website offer.');
    } finally {
      setOfferSubmitting(false);
    }
  };

  const uniqueSourceCount =
    (reviews.length > 0 ? 1 : 0) +
    new Set(externalReviews.map((r) => r.sourceSite)).size;

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#5C626B] hover:text-[#111315] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Marketplace
        </button>
        <CurrencySelect compact />
      </div>

      {/* Contiguous Purchase Module */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
        {/* Left: Studio Image + Technical Specifications */}
        <div className="lg:col-span-7 space-y-8">
          <div className="bg-white border border-[#E6E4DF] rounded-2xl overflow-hidden aspect-[4/3]">
            <ProductImage
              src={product.imageUrl}
              alt={product.title}
              className="w-full h-full object-cover"
            />
          </div>

          {product.specs.length > 0 && (
            <div className="bg-white border border-[#E6E4DF] rounded-2xl p-6">
              <h2 className="font-display text-lg font-bold text-[#111315] mb-4">
                Technical Specifications
              </h2>
              <dl className="divide-y divide-[#EFECE6]">
                {product.specs.map((spec) => (
                  <div
                    key={spec.label}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-sm"
                  >
                    <dt className="text-[#5C626B] font-medium">{spec.label}</dt>
                    <dd className="text-[#111315] font-medium tabular-nums">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* Right: Sticky Purchase Module */}
        <div className="lg:col-span-5 lg:sticky lg:top-24 bg-white border border-[#E6E4DF] rounded-2xl p-6 sm:p-8 space-y-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#5C626B] uppercase tracking-wider font-medium">
              <span>{product.category}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{product.sku}</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#111315] mt-2 [text-wrap:balance]">
              {product.title}
            </h1>

            <div className="flex flex-wrap items-center gap-2.5 mt-3 text-sm">
              <div className="flex items-center gap-1 text-[#C2410C] font-semibold tabular-nums">
                <Star className="w-4 h-4 fill-[#C2410C]" />
                <span>{combinedTotal > 0 ? combinedAvg.toFixed(1) : 'New'}</span>
              </div>
              <span className="text-[#D4D0C8]">·</span>
              <a
                href="#reviews"
                className="text-[#5C626B] hover:text-[#111315] underline-offset-4 hover:underline tabular-nums"
              >
                {combinedTotal} combined review{combinedTotal === 1 ? '' : 's'}
              </a>
              <span className="text-[#D4D0C8]">·</span>
              <a
                href="#offers"
                className="text-[#5C626B] hover:text-[#111315] underline-offset-4 hover:underline tabular-nums"
              >
                {externalOffers.length + 1} website offer{externalOffers.length === 0 ? '' : 's'}
              </a>
            </div>
          </div>

          <div className="pt-4 border-t border-[#EFECE6]">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-3xl font-bold text-[#111315] tabular-nums">
                {formatPrice(product.priceCents)}
              </span>
              <span className="text-xs font-medium text-[#15803D] tabular-nums">
                {product.stock > 0 ? `${product.stock} in stock · Ready to ship` : 'Out of stock'}
              </span>
            </div>
            <p className="text-sm text-[#5C626B] leading-relaxed mt-4">
              {product.description}
            </p>
          </div>

          {/* Quantity & Actions */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#111315]">Quantity</span>
              <div className="flex items-center border border-[#D4D0C8] rounded-lg bg-[#FAF9F6]">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="px-3.5 py-2 text-sm font-semibold text-[#111315] hover:bg-[#EFECE6] rounded-l-lg"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="px-4 py-2 text-sm font-mono font-semibold tabular-nums">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(Math.max(1, product.stock), q + 1))}
                  className="px-3.5 py-2 text-sm font-semibold text-[#111315] hover:bg-[#EFECE6] rounded-r-lg"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                disabled={product.stock === 0}
                onClick={handleAdd}
                className="py-3 px-4 text-sm font-semibold text-[#111315] bg-[#FAF9F6] border border-[#111315] hover:bg-[#EFECE6] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
              >
                {addedFeedback ? 'Added to Bag' : 'Add to Bag'}
              </button>
              <button
                type="button"
                disabled={product.stock === 0}
                onClick={() => onBuyNow(product, quantity)}
                className="py-3 px-4 text-sm font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
              >
                Buy Now
              </button>
            </div>
          </div>

          {/* Seller Attribution & Guarantees */}
          <div className="pt-5 border-t border-[#EFECE6] space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-[#5C626B]">Sold &amp; fulfilled by</p>
                <button
                  type="button"
                  onClick={() => onViewSeller(product.sellerId)}
                  className="text-sm font-semibold text-[#111315] hover:text-[#C2410C] underline-offset-4 hover:underline text-left mt-0.5"
                >
                  {product.sellerName}
                </button>
                <p className="text-xs text-[#5C626B] mt-0.5 tabular-nums">
                  {product.sellerRating.toFixed(1)} ★ Seller Rating ({product.sellerReviewCount}) · {product.sellerLocation}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onViewSeller(product.sellerId)}
                className="px-3 py-1.5 text-xs font-semibold text-[#111315] border border-[#D4D0C8] hover:border-[#111315] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Seller Store
              </button>
            </div>

            <div className="space-y-2 text-xs text-[#5C626B]">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#111315] shrink-0" />
                <span>Free insured shipping on orders over {formatPrice(15000)} · Real-time tracking included</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#15803D] shrink-0" />
                <span>Protected by Radix Pay tokenized escrow &amp; 30-day verified buyer guarantee</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Combined Offers Across Websites Under the Product */}
      <div id="offers" className="mt-16 pt-12 border-t border-[#E6E4DF]">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#C2410C]">
              Cross-Site Price &amp; Offer Comparison
            </p>
            <h2 className="font-display text-2xl font-bold text-[#111315] mt-1">
              Offers Across Websites ({externalOffers.length + 1})
            </h2>
            <p className="text-sm text-[#5C626B] mt-1">
              Compare direct Radix fulfillment alongside authorized retailers and external marketplaces.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!user) {
                onRequireAuth();
                return;
              }
              setShowOfferForm((prev) => !prev);
            }}
            className="px-4 py-2 text-xs font-semibold text-[#111315] bg-white border border-[#D4D0C8] hover:border-[#111315] rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            {showOfferForm ? 'Close Form' : 'Add Website Offer'}
          </button>
        </div>

        {showOfferForm && (
          <form
            onSubmit={handleOfferSubmit}
            className="bg-white border border-[#E6E4DF] rounded-2xl p-6 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-[#5C626B] mb-1">
                Website Name
              </label>
              <input
                type="text"
                required
                value={offerSiteName}
                onChange={(e) => setOfferSiteName(e.target.value)}
                placeholder="B&H Photo"
                className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C626B] mb-1">
                Offer URL
              </label>
              <input
                type="url"
                required
                value={offerUrl}
                onChange={(e) => setOfferUrl(e.target.value)}
                placeholder="https://example.com/item"
                className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C626B] mb-1">
                Price (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={offerPrice}
                onChange={(e) => setOfferPrice(e.target.value)}
                placeholder="349.00"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#5C626B] mb-1">
                Shipping (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={offerShipping}
                onChange={(e) => setOfferShipping(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={offerSubmitting}
              className="py-2.5 px-4 text-sm font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] rounded-lg transition-colors whitespace-nowrap"
            >
              {offerSubmitting ? 'Saving...' : 'Save Offer'}
            </button>
            {offerError && (
              <p className="sm:col-span-2 lg:col-span-5 text-xs text-red-700">{offerError}</p>
            )}
          </form>
        )}

        <div className="bg-white border border-[#E6E4DF] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E6E4DF] text-xs font-semibold uppercase tracking-wider text-[#5C626B]">
                  <th className="py-3.5 px-5">Storefront &amp; Website</th>
                  <th className="py-3.5 px-4">Condition &amp; Delivery</th>
                  <th className="py-3.5 px-4">Item Price</th>
                  <th className="py-3.5 px-4">Shipping</th>
                  <th className="py-3.5 px-4">Landed Total</th>
                  <th className="py-3.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFECE6] text-sm">
                {/* Radix Direct Highlighted Row */}
                <tr className="bg-[#FAF9F6]">
                  <td className="py-4 px-5">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-[#15803D] shrink-0" />
                      <div>
                        <p className="font-semibold text-[#111315]">
                          Radix Direct · {product.sellerName}
                        </p>
                        <p className="text-xs text-[#5C626B] tabular-nums">
                          radix.market · {product.sellerRating.toFixed(1)} ★ seller rating
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-xs text-[#5C626B]">
                    <p className="font-medium text-[#111315]">New · Verified Escrow &amp; Live Tracking</p>
                    <p className="mt-0.5">2–4 business days</p>
                  </td>
                  <td className="py-4 px-4 font-semibold text-[#111315] tabular-nums">
                    {formatPrice(product.priceCents)}
                  </td>
                  <td className="py-4 px-4 text-xs font-medium text-[#15803D] tabular-nums">
                    {radixShippingCents === 0 ? 'Free' : formatPrice(radixShippingCents)}
                  </td>
                  <td className="py-4 px-4 font-display font-bold text-[#111315] tabular-nums">
                    {formatPrice(radixLandedCents)}
                  </td>
                  <td className="py-4 px-5 text-right">
                    <button
                      type="button"
                      disabled={product.stock === 0}
                      onClick={() => onBuyNow(product, 1)}
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Buy on Radix
                    </button>
                  </td>
                </tr>

                {/* External Website Offers */}
                {externalOffers.map((offer) => {
                  const landedCents = offer.priceCents + offer.shippingCents;
                  const diffCents = landedCents - radixLandedCents;
                  return (
                    <tr key={offer.id} className="hover:bg-[#FAF9F6]/60">
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-2.5">
                          <Globe className="w-4 h-4 text-[#5C626B] shrink-0" />
                          <div>
                            <p className="font-semibold text-[#111315]">{offer.siteName}</p>
                            <p className="text-xs text-[#5C626B] tabular-nums">
                              {offer.siteDomain} · {offer.sellerRating.toFixed(1)} ★ store score
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-xs text-[#5C626B]">
                        <p className="font-medium text-[#111315]">{offer.conditionLabel}</p>
                        <p className="mt-0.5">{offer.deliveryWindow}</p>
                      </td>
                      <td className="py-4 px-4 font-medium text-[#111315] tabular-nums">
                        {formatPrice(offer.priceCents)}
                      </td>
                      <td className="py-4 px-4 text-xs text-[#5C626B] tabular-nums">
                        {offer.shippingCents === 0 ? 'Free' : formatPrice(offer.shippingCents)}
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-semibold text-[#111315] tabular-nums">
                          {formatPrice(landedCents)}
                        </span>
                        {diffCents !== 0 && (
                          <span
                            className={`block text-xs tabular-nums ${
                              diffCents > 0 ? 'text-[#5C626B]' : 'text-[#15803D]'
                            }`}
                          >
                            {diffCents > 0
                              ? `+${formatPrice(diffCents)} vs Radix`
                              : `${formatPrice(Math.abs(diffCents))} lower`}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-5 text-right">
                        <a
                          href={offer.offerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#111315] border border-[#D4D0C8] hover:border-[#111315] rounded-lg transition-colors whitespace-nowrap"
                        >
                          Visit Site
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Combined Reviews Across Radix & External Websites */}
      <div id="reviews" className="mt-16 pt-12 border-t border-[#E6E4DF]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Summary + Write Review */}
          <div className="lg:col-span-5 space-y-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#C2410C]">
                Combined Website Reviews
              </p>
              <h2 className="font-display text-2xl font-bold text-[#111315] mt-1">
                Radix &amp; Web Consensus
              </h2>
              <div className="flex items-baseline gap-3 mt-3">
                <span className="font-display text-4xl font-bold text-[#111315] tabular-nums">
                  {combinedTotal > 0 ? combinedAvg.toFixed(1) : '—'}
                </span>
                <span className="text-sm text-[#5C626B] tabular-nums">
                  out of 5 · {combinedTotal} review{combinedTotal === 1 ? '' : 's'} across{' '}
                  {uniqueSourceCount} site{uniqueSourceCount === 1 ? '' : 's'}
                </span>
              </div>
              {seller && (
                <p className="text-xs text-[#5C626B] mt-1.5 tabular-nums">
                  Radix verified buyers: {reviews.length} · Independent web publications:{' '}
                  {externalReviews.length} · Seller score: {seller.avgRating.toFixed(1)} / 5.0
                </p>
              )}

              <div className="mt-5 space-y-2">
                {ratingBreakdown.map((row) => (
                  <div key={row.stars} className="flex items-center gap-3 text-xs">
                    <span className="w-10 font-mono text-[#5C626B] tabular-nums">{row.stars} ★</span>
                    <div className="flex-1 h-2 bg-[#ECEAE4] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#C2410C] rounded-full"
                        style={{ width: `${row.pct}%` }}
                      />
                    </div>
                    <span className="w-9 text-right font-mono text-[#5C626B] tabular-nums">
                      {row.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleReviewSubmit}
              className="bg-white border border-[#E6E4DF] rounded-2xl p-6 space-y-4"
            >
              <h3 className="font-display text-lg font-bold text-[#111315]">
                Write a Product &amp; Seller Review
              </h3>
              {!user && (
                <p className="text-xs text-[#5C626B]">
                  Sign in with your Radix account to publish a review. Orders you purchased receive Verified Purchase attribution.
                </p>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#5C626B] mb-1.5">
                    Product Rating
                  </label>
                  <select
                    value={rating}
                    onChange={(e) => setRating(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
                  >
                    <option value={5}>5 Stars — Exceptional</option>
                    <option value={4}>4 Stars — Very Good</option>
                    <option value={3}>3 Stars — Solid</option>
                    <option value={2}>2 Stars — Fair</option>
                    <option value={1}>1 Star — Poor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#5C626B] mb-1.5">
                    Seller Rating
                  </label>
                  <select
                    value={sellerRating}
                    onChange={(e) => setSellerRating(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg"
                  >
                    <option value={5}>5 Stars — Fast &amp; Accurate</option>
                    <option value={4}>4 Stars — Reliable</option>
                    <option value={3}>3 Stars — Acceptable</option>
                    <option value={2}>2 Stars — Delayed</option>
                    <option value={1}>1 Star — Unsatisfactory</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5C626B] mb-1.5">
                  Review Headline
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Summarize your experience"
                  className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#5C626B] mb-1.5">
                  Detailed Review
                </label>
                <textarea
                  required
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Share build quality, delivery speed, and packaging feedback..."
                  className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                />
              </div>

              {reviewError && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  {reviewError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#111315] hover:bg-[#272A2E] disabled:opacity-50 rounded-lg transition-colors"
              >
                {user ? (submitting ? 'Publishing...' : 'Submit Review') : 'Sign In to Review'}
              </button>
            </form>
          </div>

          {/* Combined Unified Review Feed */}
          <div className="lg:col-span-7 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-[#EFECE6] rounded-lg w-fit">
                <button
                  type="button"
                  onClick={() => setReviewFilter('all')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    reviewFilter === 'all'
                      ? 'bg-white text-[#111315] shadow-xs'
                      : 'text-[#5C626B] hover:text-[#111315]'
                  }`}
                >
                  All Sources ({combinedTotal})
                </button>
                <button
                  type="button"
                  onClick={() => setReviewFilter('radix')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    reviewFilter === 'radix'
                      ? 'bg-white text-[#111315] shadow-xs'
                      : 'text-[#5C626B] hover:text-[#111315]'
                  }`}
                >
                  Radix Buyers ({reviews.length})
                </button>
                <button
                  type="button"
                  onClick={() => setReviewFilter('external')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    reviewFilter === 'external'
                      ? 'bg-white text-[#111315] shadow-xs'
                      : 'text-[#5C626B] hover:text-[#111315]'
                  }`}
                >
                  Other Websites ({externalReviews.length})
                </button>
              </div>
            </div>

            {unifiedReviews.length === 0 ? (
              <div className="bg-white border border-[#E6E4DF] rounded-2xl p-8 text-center">
                <p className="text-sm font-medium text-[#111315]">No reviews in this filter</p>
                <p className="text-sm text-[#5C626B] mt-1">
                  Switch source tabs or publish the first buyer review.
                </p>
              </div>
            ) : (
              unifiedReviews.map((item) =>
                item.kind === 'radix' ? (
                  <article
                    key={item.data.id}
                    className="bg-white border border-[#E6E4DF] rounded-2xl p-6"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C626B]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#111315]">
                          {item.data.reviewerName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Radix Marketplace</span>
                        {item.data.verifiedPurchase && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-[#15803D] font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Verified Purchase
                            </span>
                          </>
                        )}
                      </div>
                      <span className="tabular-nums">{formatDate(item.data.createdAt)}</span>
                    </div>

                    <div className="flex items-center gap-3 mt-2.5">
                      <div className="flex items-center gap-0.5 text-[#C2410C]">
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <Star
                            key={idx}
                            className={`w-3.5 h-3.5 ${
                              idx < item.data.rating ? 'fill-[#C2410C]' : 'text-[#D4D0C8]'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-[#5C626B] tabular-nums">
                        Product {item.data.rating}/5 · Seller {item.data.sellerRating}/5
                      </span>
                    </div>

                    <h3 className="font-display text-base font-bold text-[#111315] mt-3">
                      {item.data.title}
                    </h3>
                    <p className="text-sm text-[#3F444B] leading-relaxed mt-1.5">
                      {item.data.comment}
                    </p>
                  </article>
                ) : (
                  <article
                    key={item.data.id}
                    className="bg-white border border-[#E6E4DF] rounded-2xl p-6"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C626B]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#111315]">
                          {item.data.sourceSite}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{item.data.sourceDomain}</span>
                        <span aria-hidden="true">·</span>
                        <span>By {item.data.authorName}</span>
                      </div>
                      <span className="tabular-nums">{formatDate(item.data.publishedAt)}</span>
                    </div>

                    <div className="flex items-center gap-3 mt-2.5">
                      <div className="flex items-center gap-0.5 text-[#C2410C]">
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <Star
                            key={idx}
                            className={`w-3.5 h-3.5 ${
                              idx < item.data.rating ? 'fill-[#C2410C]' : 'text-[#D4D0C8]'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-[#5C626B] tabular-nums">
                        External Publication Rating {item.data.rating}/5
                      </span>
                    </div>

                    <h3 className="font-display text-base font-bold text-[#111315] mt-3">
                      {item.data.title}
                    </h3>
                    <p className="text-sm text-[#3F444B] leading-relaxed mt-1.5">
                      {item.data.excerpt}
                    </p>
                  </article>
                ),
              )
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
