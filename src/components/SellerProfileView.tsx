import { ArrowLeft, CheckCircle2, MapPin, Star } from 'lucide-react';
import { formatDate } from '../lib/api.ts';
import { useCurrency } from '../lib/currency.tsx';
import type { Product, Review, SellerSummary } from '../types.ts';
import { ProductImage } from './ProductImage.tsx';

interface SellerProfileViewProps {
  seller: SellerSummary;
  products: Product[];
  reviews: Review[];
  onBack: () => void;
  onSelectProduct: (productId: string) => void;
}

export function SellerProfileView({
  seller,
  products,
  reviews,
  onBack,
  onSelectProduct,
}: SellerProfileViewProps) {
  const { formatPrice } = useCurrency();
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-medium text-[#5C626B] hover:text-[#111315] mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Marketplace
      </button>

      {/* Seller Header */}
      <div className="bg-white border border-[#E6E4DF] rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-xs text-[#5C626B] font-medium">
              {seller.verified && (
                <span className="inline-flex items-center gap-1 text-[#15803D] font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Verified Radix Seller
                </span>
              )}
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {seller.location}
              </span>
              <span aria-hidden="true">·</span>
              <span>Joined {formatDate(seller.joinedAt)}</span>
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#111315] mt-2">
              {seller.storeName}
            </h1>
            <p className="text-sm sm:text-base text-[#5C626B] mt-2 leading-relaxed">
              {seller.bio}
            </p>
          </div>
        </div>

        {/* 4-column Seller Rating Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-8 pt-6 border-t border-[#EFECE6]">
          <div>
            <p className="text-xs text-[#5C626B]">Seller Rating</p>
            <p className="font-display text-2xl font-bold text-[#111315] mt-1 flex items-center gap-1.5 tabular-nums">
              <span>{seller.avgRating.toFixed(1)}</span>
              <Star className="w-4 h-4 text-[#C2410C] fill-[#C2410C]" />
            </p>
          </div>
          <div>
            <p className="text-xs text-[#5C626B]">Positive Feedback</p>
            <p className="font-display text-2xl font-bold text-[#111315] mt-1 tabular-nums">
              {seller.positivePercent}%
            </p>
          </div>
          <div>
            <p className="text-xs text-[#5C626B]">Verified Ratings</p>
            <p className="font-display text-2xl font-bold text-[#111315] mt-1 tabular-nums">
              {seller.reviewCount}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#5C626B]">Orders Fulfilled</p>
            <p className="font-display text-2xl font-bold text-[#111315] mt-1 tabular-nums">
              {seller.ordersFulfilled}
            </p>
          </div>
        </div>
      </div>

      {/* Storefront Catalog */}
      <div className="mt-12">
        <h2 className="font-display text-2xl font-bold text-[#111315] mb-6">
          Catalog by {seller.storeName}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => onSelectProduct(product.id)}
              className="group text-left bg-white border border-[#E6E4DF] rounded-2xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="aspect-[4/3] bg-[#F3F1EC] overflow-hidden">
                <ProductImage
                  src={product.imageUrl}
                  alt={product.title}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                />
              </div>
              <div className="p-5">
                <p className="text-xs uppercase tracking-wider text-[#5C626B]">
                  {product.category} · {product.stock > 0 ? 'In Stock' : 'Sold Out'}
                </p>
                <h3 className="font-display text-base font-semibold text-[#111315] mt-1 line-clamp-1">
                  {product.title}
                </h3>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-sm font-semibold text-[#111315] tabular-nums">
                    {formatPrice(product.priceCents)}
                  </span>
                  <span className="text-xs text-[#5C626B] tabular-nums">
                    {product.reviewCount > 0 ? `${product.avgRating.toFixed(1)} ★ (${product.reviewCount})` : 'New Listing'}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Verified Seller Ratings Feed */}
      <div className="mt-14">
        <h2 className="font-display text-2xl font-bold text-[#111315] mb-6">
          Verified Seller Feedback
        </h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-[#5C626B]">No seller feedback submitted yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {reviews.map((rev) => (
              <article
                key={rev.id}
                className="bg-white border border-[#E6E4DF] rounded-2xl p-6"
              >
                <div className="flex items-center justify-between text-xs text-[#5C626B]">
                  <span className="font-semibold text-[#111315]">
                    {rev.reviewerName} {rev.verifiedPurchase ? '· Verified Buyer' : ''}
                  </span>
                  <span className="tabular-nums">{formatDate(rev.createdAt)}</span>
                </div>
                <p className="text-xs text-[#C2410C] font-semibold mt-2 tabular-nums">
                  Seller Rating: {rev.sellerRating} / 5 ★ · {rev.productTitle}
                </p>
                <h3 className="font-display text-base font-bold text-[#111315] mt-2">
                  {rev.title}
                </h3>
                <p className="text-sm text-[#3F444B] mt-1.5 leading-relaxed">{rev.comment}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
