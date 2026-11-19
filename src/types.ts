export type OrderStatus =
  | 'confirmed'
  | 'packed'
  | 'dispatched'
  | 'out_for_delivery'
  | 'delivered';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'buyer' | 'seller' | 'both';
  createdAt: string;
  sellerProfile?: SellerSummary | null;
}

export interface SellerSummary {
  id: string;
  userId: string;
  storeName: string;
  bio: string;
  location: string;
  verified: boolean;
  joinedAt: string;
  avgRating: number;
  reviewCount: number;
  positivePercent: number;
  productCount: number;
  ordersFulfilled: number;
}

export interface ProductSpec {
  label: string;
  value: string;
}

export interface ExternalOffer {
  id: string;
  productId: string;
  siteName: string;
  siteDomain: string;
  offerUrl: string;
  priceCents: number;
  shippingCents: number;
  conditionLabel: string;
  deliveryWindow: string;
  sellerRating: number;
  inStock: boolean;
  updatedAt: string;
}

export interface ExternalReview {
  id: string;
  productId: string;
  sourceSite: string;
  sourceDomain: string;
  authorName: string;
  rating: number;
  title: string;
  excerpt: string;
  publishedAt: string;
}

export interface Product {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerLocation: string;
  sellerVerified: boolean;
  sellerRating: number;
  sellerReviewCount: number;
  title: string;
  slug: string;
  description: string;
  category: string;
  priceCents: number;
  stock: number;
  imageUrl: string;
  sku: string;
  specs: ProductSpec[];
  status: 'active' | 'draft' | 'archived';
  avgRating: number;
  reviewCount: number;
  offerCount: number;
  lowestExternalCents: number | null;
  combinedRating: number;
  combinedReviewCount: number;
  createdAt: string;
}

export interface Review {
  id: string;
  productId: string;
  productTitle?: string;
  sellerId: string;
  userId: string;
  reviewerName: string;
  orderId: string | null;
  rating: number;
  sellerRating: number;
  title: string;
  comment: string;
  verifiedPurchase: boolean;
  createdAt: string;
}

export interface SavedPaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
  token: string;
  isDefault: boolean;
}

export interface OrderTrackingEvent {
  id: string;
  orderId: string;
  status: OrderStatus;
  location: string;
  note: string;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  sellerId: string;
  sellerName: string;
  titleSnapshot: string;
  imageSnapshot: string;
  unitPriceCents: number;
  quantity: number;
  itemStatus: OrderStatus;
}

export interface Order {
  id: string;
  trackingCode: string;
  buyerId: string;
  buyerName: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shippingName: string;
  shippingAddress: string;
  shippingCity: string;
  shippingPostal: string;
  shippingPhone: string;
  status: OrderStatus;
  estimatedDelivery: string;
  paymentBrand: string;
  paymentLast4: string;
  gatewayReference: string;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  events: OrderTrackingEvent[];
}

export interface CartItem {
  product: Product;
  quantity: number;
}
