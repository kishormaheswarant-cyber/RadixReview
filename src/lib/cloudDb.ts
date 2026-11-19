import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  BLUEPRINT_CONSTRAINTS,
  buildValidSlug,
  db,
  handleFirestoreError,
  OperationType,
  sanitizeId,
  sanitizeText,
} from './firebase.ts';
import type {
  CartItem,
  ExternalOffer,
  Order,
  OrderItem,
  OrderStatus,
  OrderTrackingEvent,
  Product,
  ProductSpec,
  Review,
  SavedPaymentMethod,
  SellerSummary,
  User,
} from '../types.ts';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return new Date().toISOString();
}

function generateId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return sanitizeId(`${prefix}_${rand}`);
}

function luhnCheck(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function detectCardBrand(digits: string): 'Visa' | 'Mastercard' | 'American Express' | 'Discover' | 'Card' {
  if (digits.startsWith('4')) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (/^6(?:011|5)/.test(digits)) return 'Discover';
  return 'Card';
}

export async function ensureCloudUser(fbUser: FirebaseUser): Promise<User> {
  const uid = sanitizeId(fbUser.uid);
  const userPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/info`;
  const sellerPath = `sellers/${uid}`;

  const displayName = sanitizeText(
    fbUser.displayName || fbUser.email?.split('@')[0] || 'Radix Member',
    BLUEPRINT_CONSTRAINTS.maxNameLength,
  );
  const email = sanitizeText(fbUser.email || `${uid}@radix.market`, BLUEPRINT_CONSTRAINTS.maxEmailLength);

  let userData: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      userData = snap.data() as Record<string, unknown>;
    } else {
      const payload = {
        id: uid,
        name: displayName,
        role: 'buyer',
        sellerId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, 'users', uid), payload);
      const freshSnap = await getDoc(doc(db, 'users', uid));
      userData = (freshSnap.data() as Record<string, unknown>) || payload;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  try {
    const privSnap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    if (!privSnap.exists()) {
      await setDoc(doc(db, 'users', uid, 'private', 'info'), {
        userId: uid,
        email,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }

  let sellerProfile: SellerSummary | null = null;
  try {
    const sellerSnap = await getDoc(doc(db, 'sellers', uid));
    if (sellerSnap.exists()) {
      const s = sellerSnap.data() as Record<string, unknown>;
      sellerProfile = {
        id: String(s.id || uid),
        userId: String(s.userId || uid),
        storeName: String(s.storeName || ''),
        bio: String(s.bio || ''),
        location: String(s.location || ''),
        verified: Boolean(s.verified),
        joinedAt: toIsoString(s.joinedAt),
        avgRating: Number(s.avgRating || 0),
        reviewCount: Number(s.reviewCount || 0),
        positivePercent: Number(s.positivePercent || 100),
        productCount: Number(s.productCount || 0),
        ordersFulfilled: Number(s.ordersFulfilled || 0),
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, sellerPath);
  }

  return {
    id: uid,
    email,
    name: String(userData?.name || displayName),
    role: (userData?.role as User['role']) || (sellerProfile ? 'both' : 'buyer'),
    createdAt: toIsoString(userData?.createdAt),
    sellerProfile,
  };
}

export async function activateCloudSellerStorefront(
  fbUser: FirebaseUser,
  input: { storeName: string; location: string; bio: string },
): Promise<User> {
  const uid = sanitizeId(fbUser.uid);
  const storeName = sanitizeText(input.storeName, BLUEPRINT_CONSTRAINTS.maxStoreNameLength);
  const location = sanitizeText(input.location, BLUEPRINT_CONSTRAINTS.maxLocationLength);
  const bio = sanitizeText(input.bio, BLUEPRINT_CONSTRAINTS.maxBioLength);

  if (storeName.length < 2 || location.length < 2 || bio.length < 1) {
    throw new Error('Storefront name, location, and bio are required.');
  }

  const batch = writeBatch(db);
  batch.set(doc(db, 'sellers', uid), {
    id: uid,
    userId: uid,
    storeName,
    bio,
    location,
    isPublic: true,
    verified: false,
    avgRating: 0,
    reviewCount: 0,
    positivePercent: 100,
    productCount: 0,
    ordersFulfilled: 0,
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', uid), {
    role: 'both',
    sellerId: uid,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `sellers/${uid}`);
  }

  return ensureCloudUser(fbUser);
}

export async function createCloudProduct(
  fbUser: FirebaseUser,
  seller: SellerSummary,
  input: {
    title: string;
    category: string;
    priceDollars: number;
    stock: number;
    sku?: string;
    imageUrl: string;
    description: string;
    specs: ProductSpec[];
  },
): Promise<Product> {
  const uid = sanitizeId(fbUser.uid);
  const productId = generateId('prd');
  const title = sanitizeText(input.title, BLUEPRINT_CONSTRAINTS.maxProductTitleLength);
  const description = sanitizeText(input.description, BLUEPRINT_CONSTRAINTS.maxProductDescriptionLength);
  const imageUrl = sanitizeText(input.imageUrl, BLUEPRINT_CONSTRAINTS.maxImageUrlLength);
  const priceCents = Math.round(Number(input.priceDollars) * 100);
  const stock = Math.max(0, Math.min(100000, Math.round(Number(input.stock))));
  const skuRaw = input.sku?.trim() || `RDX-${productId.slice(-6).toUpperCase()}`;
  const sku = sanitizeId(skuRaw).slice(0, BLUEPRINT_CONSTRAINTS.maxSkuLength) || 'RDX-ITEM';
  const slug = buildValidSlug(title, productId);
  const boundedSpecs = (input.specs || [])
    .filter((s) => s.label.trim() && s.value.trim())
    .slice(0, BLUEPRINT_CONSTRAINTS.maxSpecsCount)
    .map((s) => ({
      label: sanitizeText(s.label, 60),
      value: sanitizeText(s.value, 120),
    }));

  if (title.length < 3) throw new Error('Product title must be at least 3 characters.');
  if (description.length < 10) throw new Error('Description must be at least 10 characters.');
  if (!Number.isInteger(priceCents) || priceCents <= 0) throw new Error('Price must be greater than zero.');

  const payload = {
    id: productId,
    sellerId: uid,
    ownerId: uid,
    sellerName: sanitizeText(seller.storeName, BLUEPRINT_CONSTRAINTS.maxStoreNameLength),
    sellerLocation: sanitizeText(seller.location, BLUEPRINT_CONSTRAINTS.maxLocationLength),
    sellerVerified: false,
    sellerRating: Number(seller.avgRating || 0),
    sellerReviewCount: Math.max(0, Math.round(seller.reviewCount || 0)),
    title,
    slug,
    description,
    category: input.category,
    priceCents,
    stock,
    imageUrl,
    sku,
    specs: boundedSpecs,
    status: 'active' as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'products', productId), payload);
    await updateDoc(doc(db, 'sellers', uid), {
      productCount: (seller.productCount || 0) + 1,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `products/${productId}`);
  }

  return {
    id: productId,
    sellerId: uid,
    sellerName: payload.sellerName,
    sellerLocation: payload.sellerLocation,
    sellerVerified: false,
    sellerRating: payload.sellerRating,
    sellerReviewCount: payload.sellerReviewCount,
    title,
    slug,
    description,
    category: input.category,
    priceCents,
    stock,
    imageUrl,
    sku,
    specs: boundedSpecs,
    status: 'active',
    avgRating: 0,
    reviewCount: 0,
    offerCount: 0,
    lowestExternalCents: null,
    combinedRating: 0,
    combinedReviewCount: 0,
    createdAt: new Date().toISOString(),
  };
}

export async function updateCloudProductStock(
  productId: string,
  nextStock: number,
): Promise<void> {
  const safeStock = Math.max(0, Math.min(100000, Math.round(nextStock)));
  try {
    await updateDoc(doc(db, 'products', productId), {
      stock: safeStock,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `products/${productId}`);
  }
}

export async function createCloudReview(
  fbUser: FirebaseUser,
  user: User,
  product: Product,
  input: {
    rating: number;
    sellerRating: number;
    title: string;
    comment: string;
    hasPurchased?: boolean;
    orderId?: string | null;
  },
): Promise<Review> {
  const uid = sanitizeId(fbUser.uid);
  const reviewId = generateId('rev');
  const title = sanitizeText(input.title, BLUEPRINT_CONSTRAINTS.maxReviewTitleLength);
  const comment = sanitizeText(input.comment, BLUEPRINT_CONSTRAINTS.maxReviewCommentLength);
  const rating = Math.max(1, Math.min(5, Math.round(input.rating)));
  const sellerRating = Math.max(1, Math.min(5, Math.round(input.sellerRating)));

  if (title.length < 2) throw new Error('Review headline must be at least 2 characters.');
  if (comment.length < 5) throw new Error('Detailed review must be at least 5 characters.');

  const payload = {
    id: reviewId,
    productId: sanitizeId(product.id),
    productTitle: sanitizeText(product.title, BLUEPRINT_CONSTRAINTS.maxProductTitleLength),
    sellerId: sanitizeId(product.sellerId),
    userId: uid,
    reviewerName: sanitizeText(user.name, BLUEPRINT_CONSTRAINTS.maxNameLength),
    orderId: input.orderId ? sanitizeId(input.orderId) : '',
    rating,
    sellerRating,
    title,
    comment,
    verifiedPurchase: Boolean(input.hasPurchased),
    status: 'published',
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'reviews', reviewId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `reviews/${reviewId}`);
  }

  return {
    id: reviewId,
    productId: payload.productId,
    productTitle: payload.productTitle,
    sellerId: payload.sellerId,
    userId: uid,
    reviewerName: payload.reviewerName,
    orderId: payload.orderId || null,
    rating,
    sellerRating,
    title,
    comment,
    verifiedPurchase: payload.verifiedPurchase,
    createdAt: new Date().toISOString(),
  };
}

export async function createCloudExternalOffer(
  fbUser: FirebaseUser,
  productId: string,
  input: {
    siteName: string;
    offerUrl: string;
    priceDollars: number;
    shippingDollars: number;
    deliveryWindow: string;
  },
): Promise<ExternalOffer> {
  const uid = sanitizeId(fbUser.uid);
  const offerId = generateId('off');
  const siteName = sanitizeText(input.siteName, BLUEPRINT_CONSTRAINTS.maxSiteNameLength);
  const offerUrl = sanitizeText(input.offerUrl, BLUEPRINT_CONSTRAINTS.maxOfferUrlLength);

  if (!BLUEPRINT_CONSTRAINTS.offerUrlPattern.test(offerUrl)) {
    throw new Error('Offer URL must begin with http:// or https://');
  }
  let siteDomain = 'external.market';
  try {
    siteDomain = new URL(offerUrl).hostname.replace(/^www\./, '').slice(0, BLUEPRINT_CONSTRAINTS.maxSiteDomainLength);
  } catch {
    throw new Error('Please enter a valid external website URL.');
  }

  const priceCents = Math.round(Number(input.priceDollars) * 100);
  const shippingCents = Math.max(0, Math.round(Number(input.shippingDollars || 0) * 100));
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    throw new Error('Offer price must be greater than zero.');
  }

  const deliveryWindow = sanitizeText(input.deliveryWindow || '3–5 business days', 80);

  const payload = {
    id: offerId,
    productId: sanitizeId(productId),
    userId: uid,
    siteName,
    siteDomain,
    offerUrl,
    priceCents,
    shippingCents,
    conditionLabel: 'New · Community Submitted',
    deliveryWindow,
    sellerRating: 4.7,
    inStock: true,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'externalOffers', offerId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `externalOffers/${offerId}`);
  }

  return {
    id: offerId,
    productId: payload.productId,
    siteName,
    siteDomain,
    offerUrl,
    priceCents,
    shippingCents,
    conditionLabel: payload.conditionLabel,
    deliveryWindow,
    sellerRating: payload.sellerRating,
    inStock: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function saveCloudPaymentMethod(
  fbUser: FirebaseUser,
  input: {
    cardNumber: string;
    expMonth: number;
    expYear: number;
    cvc: string;
    cardholderName: string;
    saveMethod: boolean;
  },
): Promise<{ method: SavedPaymentMethod }> {
  const uid = sanitizeId(fbUser.uid);
  const digits = input.cardNumber.replace(/\D/g, '');
  if (!luhnCheck(digits)) {
    throw new Error('Card number failed Luhn checksum validation.');
  }
  if (!/^\d{3,4}$/.test(input.cvc.trim())) {
    throw new Error('Security code (CVC) must be 3 or 4 digits.');
  }
  const expMonth = Math.round(input.expMonth);
  const expYear = Math.round(input.expYear);
  if (expMonth < 1 || expMonth > 12 || expYear < 2026 || expYear > 2050) {
    throw new Error('Card expiration date is invalid or expired.');
  }

  const brand = detectCardBrand(digits);
  const last4 = digits.slice(-4);
  const methodId = generateId('pm');
  const token = generateId('tok_rdx');
  const cardholderName = sanitizeText(input.cardholderName, 120) || 'Radix Member';

  const method: SavedPaymentMethod = {
    id: methodId,
    brand,
    last4,
    expMonth,
    expYear,
    cardholderName,
    token,
    isDefault: false,
  };

  if (input.saveMethod) {
    try {
      await setDoc(doc(db, 'users', uid, 'paymentMethods', methodId), {
        id: methodId,
        userId: uid,
        brand,
        last4,
        expMonth,
        expYear,
        cardholderName,
        token,
        isDefault: false,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${uid}/paymentMethods/${methodId}`);
    }
  }

  return { method };
}

export async function createCloudOrder(
  fbUser: FirebaseUser,
  user: User,
  input: {
    cart: CartItem[];
    paymentBrand: string;
    paymentLast4: string;
    shippingName: string;
    shippingAddress: string;
    shippingCity: string;
    shippingPostal: string;
    shippingPhone: string;
  },
): Promise<Order> {
  const uid = sanitizeId(fbUser.uid);
  const orderId = generateId('ord');
  const trackingSuffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const trackingCode = `RDX-${trackingSuffix}`;
  const gatewayReference = generateId('gw_rdx');

  const subtotalCents = input.cart.reduce(
    (sum, item) => sum + item.product.priceCents * item.quantity,
    0,
  );
  const shippingCents = subtotalCents >= 15000 ? 0 : 1200;
  const taxCents = Math.round(subtotalCents * 0.0825);
  const totalCents = subtotalCents + shippingCents + taxCents;

  const uniqueSellerIds = Array.from(
    new Set(input.cart.map((c) => sanitizeId(c.product.sellerId)).filter(Boolean)),
  ).slice(0, BLUEPRINT_CONSTRAINTS.maxSellerIdsPerOrder);

  if (uniqueSellerIds.length === 0) {
    uniqueSellerIds.push(uid);
  }

  const shippingName = sanitizeText(input.shippingName, BLUEPRINT_CONSTRAINTS.maxShippingNameLength);
  const shippingAddress = sanitizeText(input.shippingAddress, BLUEPRINT_CONSTRAINTS.maxShippingAddressLength);
  const shippingCity = sanitizeText(input.shippingCity, BLUEPRINT_CONSTRAINTS.maxShippingCityLength);
  const shippingPostal = sanitizeText(input.shippingPostal, BLUEPRINT_CONSTRAINTS.maxShippingPostalLength);
  const shippingPhone = sanitizeText(input.shippingPhone, BLUEPRINT_CONSTRAINTS.maxShippingPhoneLength);

  const eta = new Date(Date.now() + 4 * 86400000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const batch = writeBatch(db);
  batch.set(doc(db, 'orders', orderId), {
    id: orderId,
    trackingCode,
    buyerId: uid,
    buyerName: sanitizeText(user.name, BLUEPRINT_CONSTRAINTS.maxNameLength),
    sellerIds: uniqueSellerIds,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents,
    shippingName,
    shippingAddress,
    shippingCity,
    shippingPostal,
    shippingPhone,
    status: 'confirmed',
    estimatedDelivery: eta,
    paymentBrand: sanitizeText(input.paymentBrand || 'Visa', 32),
    paymentLast4: (input.paymentLast4 || '4242').slice(-4),
    gatewayReference,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const orderItems: OrderItem[] = input.cart.map((c) => {
    const itemId = generateId('oi');
    const itemDoc = {
      id: itemId,
      orderId,
      buyerId: uid,
      sellerIds: uniqueSellerIds,
      productId: sanitizeId(c.product.id),
      sellerId: sanitizeId(c.product.sellerId),
      sellerName: sanitizeText(c.product.sellerName, BLUEPRINT_CONSTRAINTS.maxStoreNameLength),
      titleSnapshot: sanitizeText(c.product.title, BLUEPRINT_CONSTRAINTS.maxProductTitleLength),
      imageSnapshot: sanitizeText(c.product.imageUrl, BLUEPRINT_CONSTRAINTS.maxImageUrlLength),
      unitPriceCents: c.product.priceCents,
      quantity: c.quantity,
      itemStatus: 'confirmed' as const,
    };
    batch.set(doc(db, 'orders', orderId, 'items', itemId), itemDoc);
    return {
      id: itemDoc.id,
      orderId: itemDoc.orderId,
      productId: itemDoc.productId,
      sellerId: itemDoc.sellerId,
      sellerName: itemDoc.sellerName,
      titleSnapshot: itemDoc.titleSnapshot,
      imageSnapshot: itemDoc.imageSnapshot,
      unitPriceCents: itemDoc.unitPriceCents,
      quantity: itemDoc.quantity,
      itemStatus: itemDoc.itemStatus,
    };
  });

  const evtId = generateId('evt');
  const eventNote = `Radix Pay authorized ${input.paymentBrand} ending in ${input.paymentLast4} (${gatewayReference}).`;
  batch.set(doc(db, 'orders', orderId, 'trackingEvents', evtId), {
    id: evtId,
    orderId,
    buyerId: uid,
    sellerIds: uniqueSellerIds,
    actorId: uid,
    status: 'confirmed',
    location: 'Radix Cloud Gateway',
    note: sanitizeText(eventNote, BLUEPRINT_CONSTRAINTS.maxTrackingNoteLength),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
  }

  const nowIso = new Date().toISOString();
  return {
    id: orderId,
    trackingCode,
    buyerId: uid,
    buyerName: user.name,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents,
    shippingName,
    shippingAddress,
    shippingCity,
    shippingPostal,
    shippingPhone,
    status: 'confirmed',
    estimatedDelivery: eta,
    paymentBrand: input.paymentBrand,
    paymentLast4: input.paymentLast4,
    gatewayReference,
    createdAt: nowIso,
    updatedAt: nowIso,
    items: orderItems,
    events: [
      {
        id: evtId,
        orderId,
        status: 'confirmed',
        location: 'Radix Cloud Gateway',
        note: eventNote,
        createdAt: nowIso,
      },
    ],
  };
}

const NEXT_STAGE: Record<OrderStatus, OrderStatus | null> = {
  confirmed: 'packed',
  packed: 'dispatched',
  dispatched: 'out_for_delivery',
  out_for_delivery: 'delivered',
  delivered: null,
};

export async function advanceCloudOrderStage(
  fbUser: FirebaseUser,
  order: Order,
  sellerLocation: string,
  note?: string,
): Promise<void> {
  const uid = sanitizeId(fbUser.uid);
  const nextStatus = NEXT_STAGE[order.status];
  if (!nextStatus) {
    throw new Error('Order has already reached final delivery.');
  }

  const evtId = generateId('evt');
  const defaultNotes: Record<OrderStatus, string> = {
    confirmed: 'Order confirmed.',
    packed: 'Quality inspection completed and parcel sealed at studio warehouse.',
    dispatched: 'Handed off to insured regional carrier hub.',
    out_for_delivery: 'Loaded onto local courier route for delivery today.',
    delivered: 'Signed and delivered to recipient.',
  };

  const orderSnap = await getDoc(doc(db, 'orders', order.id)).catch((err) =>
    handleFirestoreError(err, OperationType.GET, `orders/${order.id}`),
  );
  if (!orderSnap.exists()) {
    throw new Error('Order not found in cloud database.');
  }
  const orderData = orderSnap.data() as Record<string, unknown>;
  const sellerIds = Array.isArray(orderData.sellerIds) ? (orderData.sellerIds as string[]) : [uid];

  const batch = writeBatch(db);
  batch.update(doc(db, 'orders', order.id), {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'orders', order.id, 'trackingEvents', evtId), {
    id: evtId,
    orderId: order.id,
    buyerId: String(orderData.buyerId || order.buyerId),
    sellerIds,
    actorId: uid,
    status: nextStatus,
    location: sanitizeText(sellerLocation || 'Radix Fulfillment Hub', 120),
    note: sanitizeText(note?.trim() || defaultNotes[nextStatus], BLUEPRINT_CONSTRAINTS.maxTrackingNoteLength),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

async function hydrateOrderSubcollections(rawOrder: Record<string, unknown>): Promise<Order> {
  const orderId = String(rawOrder.id);

  let items: OrderItem[] = [];
  try {
    const itemsSnap = await getDocs(collection(db, 'orders', orderId, 'items'));
    items = itemsSnap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: String(data.id),
        orderId: String(data.orderId),
        productId: String(data.productId),
        sellerId: String(data.sellerId),
        sellerName: String(data.sellerName),
        titleSnapshot: String(data.titleSnapshot),
        imageSnapshot: String(data.imageSnapshot),
        unitPriceCents: Number(data.unitPriceCents),
        quantity: Number(data.quantity),
        itemStatus: data.itemStatus as OrderStatus,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `orders/${orderId}/items`);
  }

  let events: OrderTrackingEvent[] = [];
  try {
    const eventsSnap = await getDocs(collection(db, 'orders', orderId, 'trackingEvents'));
    events = eventsSnap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: String(data.id),
          orderId: String(data.orderId),
          status: data.status as OrderStatus,
          location: String(data.location),
          note: String(data.note),
          createdAt: toIsoString(data.createdAt),
        };
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `orders/${orderId}/trackingEvents`);
  }

  return {
    id: orderId,
    trackingCode: String(rawOrder.trackingCode),
    buyerId: String(rawOrder.buyerId),
    buyerName: String(rawOrder.buyerName),
    subtotalCents: Number(rawOrder.subtotalCents),
    shippingCents: Number(rawOrder.shippingCents),
    taxCents: Number(rawOrder.taxCents),
    totalCents: Number(rawOrder.totalCents),
    shippingName: String(rawOrder.shippingName),
    shippingAddress: String(rawOrder.shippingAddress),
    shippingCity: String(rawOrder.shippingCity),
    shippingPostal: String(rawOrder.shippingPostal),
    shippingPhone: String(rawOrder.shippingPhone),
    status: rawOrder.status as OrderStatus,
    estimatedDelivery: String(rawOrder.estimatedDelivery),
    paymentBrand: String(rawOrder.paymentBrand),
    paymentLast4: String(rawOrder.paymentLast4),
    gatewayReference: String(rawOrder.gatewayReference),
    createdAt: toIsoString(rawOrder.createdAt),
    updatedAt: toIsoString(rawOrder.updatedAt),
    items,
    events,
  };
}

export function subscribeCloudCatalog(handlers: {
  onProducts: (products: Product[]) => void;
  onSellers: (sellers: SellerSummary[]) => void;
  onReviews: (reviews: Review[]) => void;
  onOffers: (offers: ExternalOffer[]) => void;
}): Unsubscribe {
  const unsubProducts = onSnapshot(
    query(collection(db, 'products'), where('status', '==', 'active')),
    (snap) => {
      const list: Product[] = snap.docs.map((d) => {
        const p = d.data() as Record<string, unknown>;
        return {
          id: String(p.id),
          sellerId: String(p.sellerId),
          sellerName: String(p.sellerName),
          sellerLocation: String(p.sellerLocation),
          sellerVerified: Boolean(p.sellerVerified),
          sellerRating: Number(p.sellerRating || 0),
          sellerReviewCount: Number(p.sellerReviewCount || 0),
          title: String(p.title),
          slug: String(p.slug),
          description: String(p.description),
          category: String(p.category),
          priceCents: Number(p.priceCents),
          stock: Number(p.stock),
          imageUrl: String(p.imageUrl),
          sku: String(p.sku),
          specs: Array.isArray(p.specs) ? (p.specs as ProductSpec[]) : [],
          status: (p.status as Product['status']) || 'active',
          avgRating: 0,
          reviewCount: 0,
          offerCount: 0,
          lowestExternalCents: null,
          combinedRating: 0,
          combinedReviewCount: 0,
          createdAt: toIsoString(p.createdAt),
        };
      });
      handlers.onProducts(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'products');
    },
  );

  const unsubSellers = onSnapshot(
    query(collection(db, 'sellers'), where('isPublic', '==', true)),
    (snap) => {
      const list: SellerSummary[] = snap.docs.map((d) => {
        const s = d.data() as Record<string, unknown>;
        return {
          id: String(s.id),
          userId: String(s.userId),
          storeName: String(s.storeName),
          bio: String(s.bio),
          location: String(s.location),
          verified: Boolean(s.verified),
          joinedAt: toIsoString(s.joinedAt),
          avgRating: Number(s.avgRating || 0),
          reviewCount: Number(s.reviewCount || 0),
          positivePercent: Number(s.positivePercent || 100),
          productCount: Number(s.productCount || 0),
          ordersFulfilled: Number(s.ordersFulfilled || 0),
        };
      });
      handlers.onSellers(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sellers');
    },
  );

  const unsubReviews = onSnapshot(
    query(collection(db, 'reviews'), where('status', '==', 'published')),
    (snap) => {
      const list: Review[] = snap.docs.map((d) => {
        const r = d.data() as Record<string, unknown>;
        return {
          id: String(r.id),
          productId: String(r.productId),
          productTitle: r.productTitle ? String(r.productTitle) : undefined,
          sellerId: String(r.sellerId),
          userId: String(r.userId),
          reviewerName: String(r.reviewerName),
          orderId: r.orderId ? String(r.orderId) : null,
          rating: Number(r.rating),
          sellerRating: Number(r.sellerRating),
          title: String(r.title),
          comment: String(r.comment),
          verifiedPurchase: Boolean(r.verifiedPurchase),
          createdAt: toIsoString(r.createdAt),
        };
      });
      handlers.onReviews(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'reviews');
    },
  );

  const unsubOffers = onSnapshot(
    query(collection(db, 'externalOffers'), where('status', '==', 'active')),
    (snap) => {
      const list: ExternalOffer[] = snap.docs.map((d) => {
        const o = d.data() as Record<string, unknown>;
        return {
          id: String(o.id),
          productId: String(o.productId),
          siteName: String(o.siteName),
          siteDomain: String(o.siteDomain),
          offerUrl: String(o.offerUrl),
          priceCents: Number(o.priceCents),
          shippingCents: Number(o.shippingCents),
          conditionLabel: String(o.conditionLabel),
          deliveryWindow: String(o.deliveryWindow),
          sellerRating: Number(o.sellerRating),
          inStock: Boolean(o.inStock),
          updatedAt: toIsoString(o.updatedAt),
        };
      });
      handlers.onOffers(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'externalOffers');
    },
  );

  return () => {
    unsubProducts();
    unsubSellers();
    unsubReviews();
    unsubOffers();
  };
}

export function subscribeCloudUserAccount(
  uid: string,
  handlers: {
    onBuyerOrders: (orders: Order[]) => void;
    onSellerOrders: (orders: Order[]) => void;
    onPaymentMethods: (methods: SavedPaymentMethod[]) => void;
  },
): Unsubscribe {
  const safeUid = sanitizeId(uid);

  const unsubBuyerOrders = onSnapshot(
    query(collection(db, 'orders'), where('buyerId', '==', safeUid)),
    (snap) => {
      void Promise.all(
        snap.docs.map((d) => hydrateOrderSubcollections(d.data() as Record<string, unknown>)),
      )
        .then((orders) => {
          handlers.onBuyerOrders(
            orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
          );
        })
        .catch(() => {
          // handled inside hydrateOrderSubcollections
        });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    },
  );

  const unsubSellerOrders = onSnapshot(
    query(collection(db, 'orders'), where('sellerIds', 'array-contains', safeUid)),
    (snap) => {
      void Promise.all(
        snap.docs.map((d) => hydrateOrderSubcollections(d.data() as Record<string, unknown>)),
      )
        .then((orders) => {
          handlers.onSellerOrders(
            orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
          );
        })
        .catch(() => {
          // handled inside hydrateOrderSubcollections
        });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    },
  );

  const unsubPaymentMethods = onSnapshot(
    query(collection(db, 'users', safeUid, 'paymentMethods'), where('userId', '==', safeUid)),
    (snap) => {
      const methods: SavedPaymentMethod[] = snap.docs.map((d) => {
        const pm = d.data() as Record<string, unknown>;
        return {
          id: String(pm.id),
          brand: String(pm.brand),
          last4: String(pm.last4),
          expMonth: Number(pm.expMonth),
          expYear: Number(pm.expYear),
          cardholderName: String(pm.cardholderName),
          token: String(pm.token),
          isDefault: Boolean(pm.isDefault),
        };
      });
      handlers.onPaymentMethods(methods);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${safeUid}/paymentMethods`);
    },
  );

  return () => {
    unsubBuyerOrders();
    unsubSellerOrders();
    unsubPaymentMethods();
  };
}
