import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Search, Star } from 'lucide-react';
import { AuthPanel } from './components/AuthPanel.tsx';
import { CartCheckoutDrawer } from './components/CartCheckoutDrawer.tsx';
import { CurrencySelect } from './components/CurrencySelect.tsx';
import { Header, type AppView } from './components/Header.tsx';
import { OrderTrackerView } from './components/OrderTrackerView.tsx';
import { ProductDetailView } from './components/ProductDetailView.tsx';
import { ProductImage } from './components/ProductImage.tsx';
import { SellConsoleView } from './components/SellConsoleView.tsx';
import { SellerProfileView } from './components/SellerProfileView.tsx';
import { apiFetch, setStoredToken } from './lib/api.ts';
import {
  ensureCloudUser,
  subscribeCloudCatalog,
  subscribeCloudUserAccount,
} from './lib/cloudDb.ts';
import { useCurrency } from './lib/currency.tsx';
import { useFirebase } from './lib/firebaseContext.tsx';
import type {
  CartItem,
  ExternalOffer,
  ExternalReview,
  Order,
  Product,
  Review,
  SavedPaymentMethod,
  SellerSummary,
  User,
} from './types.ts';

const CATEGORIES = ['All', 'Audio', 'Coffee & Kitchen', 'Computing', 'Lighting', 'Timepieces', 'Optics', 'Carry'];

export default function App() {
  const { formatPrice } = useCurrency();
  const { firebaseUser, authReady, signOutFirebase } = useFirebase();
  const [view, setView] = useState<AppView>('shop');
  const [user, setUser] = useState<User | null>(null);
  const [baseProducts, setBaseProducts] = useState<Product[]>([]);
  const [baseSellers, setBaseSellers] = useState<SellerSummary[]>([]);
  const [cloudProducts, setCloudProducts] = useState<Product[]>([]);
  const [cloudSellers, setCloudSellers] = useState<SellerSummary[]>([]);
  const [cloudReviews, setCloudReviews] = useState<Review[]>([]);
  const [cloudOffers, setCloudOffers] = useState<ExternalOffer[]>([]);
  const [cloudSellerOrders, setCloudSellerOrders] = useState<Order[]>([]);
  const [userOrders, setUserOrders] = useState<Order[]>([]);
  const [savedMethods, setSavedMethods] = useState<SavedPaymentMethod[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  // Storefront search / filter / sort
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState<'featured' | 'rating' | 'price_asc' | 'price_desc'>('featured');

  // Active Product Detail or Seller Storefront
  const [activeProductData, setActiveProductData] = useState<{
    product: Product;
    reviews: Review[];
    seller: SellerSummary | null;
    externalOffers: ExternalOffer[];
    externalReviews: ExternalReview[];
  } | null>(null);
  const [activeSellerData, setActiveSellerData] = useState<{
    seller: SellerSummary;
    products: Product[];
    reviews: Review[];
  } | null>(null);

  // Order Tracker target
  const [trackingTargetCode, setTrackingTargetCode] = useState<string | null>(null);

  // Persistent Shopping Bag
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem('radix_cart_v1');
      return raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('radix_cart_v1', JSON.stringify(cart));
    } catch {
      // ignore
    }
  }, [cart]);

  const loadCatalog = async () => {
    try {
      const [prodRes, sellerRes] = await Promise.all([
        apiFetch<{ products: Product[] }>('/api/products'),
        apiFetch<{ sellers: SellerSummary[] }>('/api/sellers'),
      ]);
      setBaseProducts(prodRes.products);
      setBaseSellers(sellerRes.sellers);
    } catch {
      // ignore
    } finally {
      setLoadingCatalog(false);
    }
  };

  const loadAuthenticatedContext = async () => {
    try {
      const meRes = await apiFetch<{ user: User | null }>('/api/auth/me');
      if (meRes.user) {
        setUser(meRes.user);
        const [ordersRes, methodsRes] = await Promise.all([
          apiFetch<{ orders: Order[] }>('/api/orders'),
          apiFetch<{ methods: SavedPaymentMethod[] }>('/api/payments/methods'),
        ]);
        setUserOrders(ordersRes.orders);
        setSavedMethods(methodsRes.methods);
      } else {
        setUser((prev) => (firebaseUser ? prev : null));
        if (!firebaseUser) {
          setUserOrders([]);
          setSavedMethods([]);
        }
      }
    } catch {
      if (!firebaseUser) {
        setUser(null);
      }
    }
  };

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!firebaseUser) {
      setCloudProducts([]);
      setCloudSellers([]);
      setCloudReviews([]);
      setCloudOffers([]);
      setCloudSellerOrders([]);
      void loadAuthenticatedContext();
      return;
    }

    let active = true;
    void ensureCloudUser(firebaseUser).then((cloudUser) => {
      if (active) setUser(cloudUser);
    });

    const unsubCatalog = subscribeCloudCatalog({
      onProducts: setCloudProducts,
      onSellers: setCloudSellers,
      onReviews: setCloudReviews,
      onOffers: setCloudOffers,
    });

    const unsubAccount = subscribeCloudUserAccount(firebaseUser.uid, {
      onBuyerOrders: setUserOrders,
      onSellerOrders: setCloudSellerOrders,
      onPaymentMethods: setSavedMethods,
    });

    return () => {
      active = false;
      unsubCatalog();
      unsubAccount();
    };
  }, [authReady, firebaseUser?.uid]);

  const sellers = useMemo(() => {
    const map = new Map<string, SellerSummary>();
    for (const s of baseSellers) map.set(s.id, s);
    for (const s of cloudSellers) map.set(s.id, s);
    return Array.from(map.values());
  }, [baseSellers, cloudSellers]);

  const products = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of baseProducts) map.set(p.id, p);
    for (const p of cloudProducts) map.set(p.id, p);

    return Array.from(map.values()).map((product) => {
      const extraReviews = cloudReviews.filter((r) => r.productId === product.id);
      const extraOffers = cloudOffers.filter((o) => o.productId === product.id);
      const nextOfferCount = product.offerCount + extraOffers.length;
      const nextReviewCount = product.reviewCount + extraReviews.length;
      const totalCombinedCount = product.combinedReviewCount + extraReviews.length;
      const combinedSum =
        product.combinedRating * product.combinedReviewCount +
        extraReviews.reduce((s, r) => s + r.rating, 0);
      const lowestExternal = extraOffers.reduce<number | null>(
        (min, o) => (min === null || o.priceCents < min ? o.priceCents : min),
        product.lowestExternalCents,
      );

      return {
        ...product,
        offerCount: nextOfferCount,
        reviewCount: nextReviewCount,
        combinedReviewCount: totalCombinedCount,
        combinedRating: totalCombinedCount > 0 ? combinedSum / totalCombinedCount : product.combinedRating,
        lowestExternalCents: lowestExternal,
      };
    });
  }, [baseProducts, cloudProducts, cloudReviews, cloudOffers]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;
      if (q) {
        const hay = `${p.title} ${p.description} ${p.category} ${p.sellerName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'rating') {
      return [...filtered].sort((a, b) => b.avgRating - a.avgRating || b.reviewCount - a.reviewCount);
    }
    if (sortBy === 'price_asc') {
      return [...filtered].sort((a, b) => a.priceCents - b.priceCents);
    }
    if (sortBy === 'price_desc') {
      return [...filtered].sort((a, b) => b.priceCents - a.priceCents);
    }
    return filtered;
  }, [products, selectedCategory, searchQuery, sortBy]);

  const openProductDetail = async (productId: string) => {
    const cloudProd = cloudProducts.find((p) => p.id === productId);
    const matchingCloudReviews = cloudReviews.filter((r) => r.productId === productId);
    const matchingCloudOffers = cloudOffers.filter((o) => o.productId === productId);

    if (cloudProd) {
      const seller = sellers.find((s) => s.id === cloudProd.sellerId) || null;
      setActiveProductData({
        product: cloudProd,
        reviews: matchingCloudReviews,
        seller,
        externalOffers: matchingCloudOffers,
        externalReviews: [],
      });
      setView('product');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    try {
      const res = await apiFetch<{
        product: Product;
        reviews: Review[];
        seller: SellerSummary | null;
        externalOffers: ExternalOffer[];
        externalReviews: ExternalReview[];
      }>(`/api/products/${productId}`);
      setActiveProductData({
        ...res,
        reviews: [...matchingCloudReviews, ...res.reviews],
        externalOffers: [...matchingCloudOffers, ...res.externalOffers],
      });
      setView('product');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // ignore
    }
  };

  const openSellerProfile = async (sellerId: string) => {
    const cloudSeller = cloudSellers.find((s) => s.id === sellerId);
    if (cloudSeller) {
      setActiveSellerData({
        seller: cloudSeller,
        products: products.filter((p) => p.sellerId === sellerId),
        reviews: cloudReviews.filter((r) => r.sellerId === sellerId),
      });
      setView('seller');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    try {
      const res = await apiFetch<{
        seller: SellerSummary;
        products: Product[];
        reviews: Review[];
      }>(`/api/sellers/${sellerId}`);
      setActiveSellerData(res);
      setView('seller');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // ignore
    }
  };

  const addToCart = (product: Product, quantity = 1) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id
            ? { ...i, product, quantity: Math.min(product.stock, i.quantity + quantity) }
            : i,
        );
      }
      return [...prev, { product, quantity: Math.min(product.stock, quantity) }];
    });
  };

  const handleBuyNow = (product: Product, quantity: number) => {
    addToCart(product, quantity);
    setCartOpen(true);
  };

  const handleUpdateCartQty = (productId: string, quantity: number) => {
    setCart((prev) =>
      prev.map((item) => (item.product.id === productId ? { ...item, quantity } : item)),
    );
  };

  const handleRemoveCartItem = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const handleAuthSuccess = async (authenticatedUser: User, isCloudAuth = false) => {
    setUser(authenticatedUser);
    if (isCloudAuth) {
      return;
    }
    const [ordersRes, methodsRes] = await Promise.all([
      apiFetch<{ orders: Order[] }>('/api/orders'),
      apiFetch<{ methods: SavedPaymentMethod[] }>('/api/payments/methods'),
    ]);
    setUserOrders(ordersRes.orders);
    setSavedMethods(methodsRes.methods);
  };

  const handleLogout = async () => {
    if (firebaseUser) {
      await signOutFirebase();
    }
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setStoredToken(null);
    setUser(null);
    setUserOrders([]);
    setSavedMethods([]);
    setView('shop');
  };

  const handleOrderCompleted = (order: Order, updatedMethods?: SavedPaymentMethod[]) => {
    setCart([]);
    setCartOpen(false);
    setUserOrders((prev) => [order, ...prev]);
    if (updatedMethods) {
      setSavedMethods(updatedMethods);
    }
    setTrackingTargetCode(order.trackingCode);
    setView('track');
    void loadCatalog();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleTrackOrder = (trackingCode: string) => {
    setTrackingTargetCode(trackingCode);
    setView('track');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const totalBagCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF9F6] text-[#111315]">
      <Header
        activeView={view}
        onNavigate={(nextView) => {
          setView(nextView);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        user={user}
        cartCount={totalBagCount}
        onOpenCart={() => setCartOpen(true)}
      />

      <main className="flex-1">
        {view === 'shop' && (
          <>
            {/* Section 1: Editorial Split Hero */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch bg-white border border-[#E6E4DF] rounded-2xl overflow-hidden">
                <div className="lg:col-span-5 p-8 sm:p-12 flex flex-col justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#C2410C]">
                      Curated Buy, Sell &amp; Review Marketplace
                    </p>
                    <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight text-[#111315] leading-[1.12] mt-4 [text-wrap:balance]">
                      Precision goods, verified sellers, live tracking.
                    </h1>
                    <p className="text-base text-[#5C626B] mt-5 leading-relaxed max-w-md">
                      Discover independent hardware, audio, optics, and carry goods backed by verified buyer reviews, seller ratings, and tokenized checkout.
                    </p>
                  </div>

                  <div className="mt-8 pt-6 border-t border-[#EFECE6] flex flex-wrap items-center gap-3">
                    <a
                      href="#catalog"
                      className="px-5 py-3 text-sm font-semibold text-white bg-[#C2410C] hover:bg-[#9A3412] rounded-lg transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-2"
                    >
                      Explore Catalog
                      <ArrowRight className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => setView('sell')}
                      className="px-5 py-3 text-sm font-semibold text-[#111315] bg-[#FAF9F6] border border-[#D4D0C8] hover:border-[#111315] rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      Sell on Radix
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-7 min-h-[280px] lg:min-h-[440px] bg-[#EFECE6]">
                  <ProductImage
                    src="/src/assets/images/hero_radix_studio_1795062896352.jpg"
                    alt="Curated Radix studio workbench with aluminum desk lamp, pour-over dripper, and mechanical keyboard"
                    className="w-full h-full lg:h-full object-cover"
                  />
                </div>
              </div>
            </section>

            {/* Section 2: Storefront Search, Category Filters & Product Grid */}
            <section id="catalog" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[#E6E4DF]">
                {/* Category Segmented Controls */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setSelectedCategory(category)}
                      className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                        selectedCategory === category
                          ? 'bg-[#111315] text-white'
                          : 'bg-white text-[#5C626B] border border-[#E6E4DF] hover:text-[#111315] hover:border-[#C9C5BC]'
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>

                {/* Search + Sort */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-[#5C626B] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search products or sellers..."
                      className="w-full sm:w-64 pl-10 pr-3.5 py-2 text-sm bg-white border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                    />
                  </div>

                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    aria-label="Sort products"
                    className="px-3.5 py-2 text-sm bg-white border border-[#D4D0C8] rounded-lg focus:outline-none focus:border-[#C2410C]"
                  >
                    <option value="featured">Sort: Featured</option>
                    <option value="rating">Sort: Top Rated</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                  </select>

                  <CurrencySelect compact />
                </div>
              </div>

              {loadingCatalog ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="bg-white border border-[#E6E4DF] rounded-2xl h-96 animate-pulse"
                    />
                  ))}
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="bg-white border border-[#E6E4DF] rounded-2xl p-12 text-center mt-8">
                  <p className="font-display text-lg font-semibold text-[#111315]">
                    No matching products found
                  </p>
                  <p className="text-sm text-[#5C626B] mt-1">
                    Try clearing your search term or switching categories.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('All');
                    }}
                    className="mt-4 px-4 py-2 text-xs font-semibold text-[#111315] border border-[#D4D0C8] rounded-lg hover:border-[#111315]"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-7 mt-8">
                  {filteredProducts.map((product) => (
                    <article
                      key={product.id}
                      className="group bg-white border border-[#E6E4DF] rounded-2xl overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <button
                        type="button"
                        onClick={() => openProductDetail(product.id)}
                        className="aspect-[4/3] bg-[#F3F1EC] overflow-hidden text-left w-full"
                      >
                        <ProductImage
                          src={product.imageUrl}
                          alt={product.title}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        />
                      </button>

                      <div className="p-5 flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-2 text-xs text-[#5C626B]">
                            <span className="uppercase tracking-wider font-medium truncate">
                              {product.category}
                            </span>
                            <span className="tabular-nums shrink-0">
                              {product.stock > 0 ? 'In Stock' : 'Sold Out'}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => openProductDetail(product.id)}
                            className="text-left w-full mt-1.5"
                          >
                            <h2 className="font-display text-base font-semibold text-[#111315] group-hover:text-[#C2410C] transition-colors line-clamp-1">
                              {product.title}
                            </h2>
                          </button>

                          <div className="flex items-center gap-1.5 text-xs text-[#5C626B] mt-1.5">
                            <button
                              type="button"
                              onClick={() => openSellerProfile(product.sellerId)}
                              className="hover:text-[#111315] hover:underline truncate"
                            >
                              {product.sellerName}
                            </button>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1 text-[#111315] font-medium tabular-nums shrink-0">
                              <Star className="w-3 h-3 text-[#C2410C] fill-[#C2410C]" />
                              {product.combinedReviewCount > 0 ? product.combinedRating.toFixed(1) : 'New'}
                              {product.combinedReviewCount > 0 && (
                                <span className="text-[#5C626B] font-normal">
                                  ({product.combinedReviewCount})
                                </span>
                              )}
                            </span>
                            {product.offerCount > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums shrink-0">
                                  {product.offerCount + 1} sites
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-[#EFECE6]">
                          <span className="font-display text-base font-bold text-[#111315] tabular-nums">
                            {formatPrice(product.priceCents)}
                          </span>
                          <button
                            type="button"
                            disabled={product.stock === 0}
                            onClick={() => addToCart(product, 1)}
                            className="px-3.5 py-2 text-xs font-semibold text-[#111315] bg-[#FAF9F6] border border-[#D4D0C8] hover:border-[#111315] hover:bg-[#EFECE6] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            Add to Bag
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Section 3: Verified Sellers & Ratings Strip */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-7">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#C2410C]">
                    Verified Merchants
                  </p>
                  <h2 className="font-display text-2xl font-bold text-[#111315] mt-1">
                    Top-Rated Sellers on Radix
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setView('sell')}
                  className="text-sm font-semibold text-[#111315] hover:text-[#C2410C] inline-flex items-center gap-1.5 self-start sm:self-auto"
                >
                  Open a Storefront
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {sellers.slice(0, 3).map((seller) => (
                  <button
                    key={seller.id}
                    type="button"
                    onClick={() => openSellerProfile(seller.id)}
                    className="text-left bg-white border border-[#E6E4DF] hover:border-[#111315] rounded-2xl p-6 transition-colors flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs text-[#5C626B]">
                        <span className="inline-flex items-center gap-1 text-[#15803D] font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Verified Seller
                        </span>
                        <span>{seller.location}</span>
                      </div>
                      <h3 className="font-display text-lg font-bold text-[#111315] mt-3">
                        {seller.storeName}
                      </h3>
                      <p className="text-sm text-[#5C626B] mt-2 line-clamp-2 leading-relaxed">
                        {seller.bio}
                      </p>
                    </div>

                    <div className="mt-5 pt-4 border-t border-[#EFECE6] flex items-center justify-between text-xs tabular-nums">
                      <span className="font-semibold text-[#111315]">
                        {seller.avgRating.toFixed(1)} ★ ({seller.reviewCount} ratings)
                      </span>
                      <span className="text-[#5C626B]">
                        {seller.positivePercent}% positive · {seller.productCount} items
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {view === 'product' && activeProductData && (
          <ProductDetailView
            product={activeProductData.product}
            reviews={activeProductData.reviews}
            externalOffers={activeProductData.externalOffers}
            externalReviews={activeProductData.externalReviews}
            seller={activeProductData.seller}
            user={user}
            onBack={() => setView('shop')}
            onAddToCart={addToCart}
            onBuyNow={handleBuyNow}
            onViewSeller={openSellerProfile}
            onReviewCreated={(updated) => {
              setActiveProductData(updated);
              void loadCatalog();
            }}
            onOffersUpdated={(updated) => {
              setActiveProductData((prev) =>
                prev
                  ? { ...prev, product: updated.product, externalOffers: updated.externalOffers }
                  : null,
              );
              void loadCatalog();
            }}
            onRequireAuth={() => setView('account')}
          />
        )}

        {view === 'seller' && activeSellerData && (
          <SellerProfileView
            seller={activeSellerData.seller}
            products={activeSellerData.products}
            reviews={activeSellerData.reviews}
            onBack={() => setView('shop')}
            onSelectProduct={openProductDetail}
          />
        )}

        {view === 'sell' && (
          <SellConsoleView
            user={user}
            cloudSellerOrders={cloudSellerOrders}
            cloudProducts={cloudProducts}
            onRequireAuth={() => setView('account')}
            onUserUpdated={(updatedUser) => setUser(updatedUser)}
            onCatalogMutated={() => void loadCatalog()}
            onTrackOrder={handleTrackOrder}
          />
        )}

        {view === 'track' && (
          <OrderTrackerView
            initialCode={trackingTargetCode}
            userOrders={userOrders}
            onSelectProduct={openProductDetail}
          />
        )}

        {view === 'account' && (
          <AuthPanel
            user={user}
            orders={userOrders}
            savedMethods={savedMethods}
            onAuthSuccess={handleAuthSuccess}
            onLogout={handleLogout}
            onTrackOrder={handleTrackOrder}
            onOpenSell={() => setView('sell')}
          />
        )}
      </main>

      <footer className="border-t border-[#E6E4DF] bg-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#5C626B]">
          <div>
            <span className="font-display font-bold text-[#111315] text-sm mr-3">Radix</span>
            <span>Open-source React, Node.js, Cloud Firestore &amp; WebSocket commerce marketplace.</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <button type="button" onClick={() => setView('shop')} className="hover:text-[#111315]">
              Catalog
            </button>
            <button type="button" onClick={() => setView('sell')} className="hover:text-[#111315]">
              Sell on Radix
            </button>
            <button type="button" onClick={() => setView('track')} className="hover:text-[#111315]">
              Order Tracker
            </button>
            <button type="button" onClick={() => setView('account')} className="hover:text-[#111315]">
              Account
            </button>
            <CurrencySelect compact className="py-1.5 text-xs" />
          </div>
        </div>
      </footer>

      <CartCheckoutDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        user={user}
        savedMethods={savedMethods}
        onUpdateQty={handleUpdateCartQty}
        onRemoveItem={handleRemoveCartItem}
        onRequireAuth={() => setView('account')}
        onOrderCompleted={handleOrderCompleted}
      />
    </div>
  );
}
