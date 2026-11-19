import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  attachAuth,
  clearSessionCookie,
  hashPassword,
  requireAuth,
  setSessionCookie,
  signSessionToken,
  verifyPassword,
  type AuthenticatedRequest,
} from './src/server/auth.ts';
import {
  db,
  generateId,
  generateTrackingCode,
  getOrderByIdOrCode,
  getProductById,
  getProductExternalOffers,
  getProductExternalReviews,
  getProductReviews,
  getSellerById,
  getSellerReviews,
  getUserById,
  initDatabase,
  listBuyerOrders,
  listProducts,
  listSavedPaymentMethods,
  listSellerOrders,
  listSellers,
} from './src/server/db.ts';
import { computeOrderTotals, generateGatewayReference, tokenizeCard } from './src/server/payments.ts';
import type { Order, OrderStatus } from './src/types.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(attachAuth);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

interface WsSubscription {
  orderIds: Set<string>;
  trackingCodes: Set<string>;
}

const clientSubscriptions = new Map<WebSocket, WsSubscription>();

wss.on('connection', (ws) => {
  clientSubscriptions.set(ws, { orderIds: new Set(), trackingCodes: new Set() });

  ws.send(JSON.stringify({ type: 'connection:ready', timestamp: new Date().toISOString() }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type?: string;
        orderId?: string;
        trackingCode?: string;
      };
      const sub = clientSubscriptions.get(ws);
      if (!sub) return;
      if (msg.type === 'subscribe:order') {
        if (msg.orderId) sub.orderIds.add(msg.orderId);
        if (msg.trackingCode) sub.trackingCodes.add(msg.trackingCode.toUpperCase());
      } else if (msg.type === 'unsubscribe:order') {
        if (msg.orderId) sub.orderIds.delete(msg.orderId);
        if (msg.trackingCode) sub.trackingCodes.delete(msg.trackingCode.toUpperCase());
      }
    } catch {
      // Ignore malformed WebSocket payloads
    }
  });

  ws.on('close', () => {
    clientSubscriptions.delete(ws);
  });
});

function broadcastOrderEvent(eventType: 'order:created' | 'order:updated', order: Order): void {
  const payload = JSON.stringify({ type: eventType, order });
  for (const [ws, sub] of clientSubscriptions.entries()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (
      sub.orderIds.has(order.id) ||
      sub.trackingCodes.has(order.trackingCode.toUpperCase()) ||
      sub.orderIds.size === 0
    ) {
      ws.send(payload);
    }
  }
}

// ---------- Health ----------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ---------- Authentication Routes ----------
app.post('/api/auth/register', (req, res) => {
  try {
    const {
      name,
      email,
      password,
      openSellerStore,
      storeName,
      storeLocation,
      storeBio,
    } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      openSellerStore?: boolean;
      storeName?: string;
      storeLocation?: string;
      storeBio?: string;
    };

    const cleanName = (name || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const rawPassword = password || '';

    if (cleanName.length < 2) {
      res.status(400).json({ error: 'Full name must be at least 2 characters.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (rawPassword.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const userId = generateId('usr');
    const now = new Date().toISOString();
    const role = openSellerStore ? 'both' : 'buyer';
    const passwordHash = hashPassword(rawPassword);

    const registerTx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(userId, cleanEmail, cleanName, passwordHash, role, now);

      if (openSellerStore) {
        const sellerId = generateId('sel');
        db.prepare(
          `INSERT INTO sellers (id, user_id, store_name, bio, location, verified, joined_at) VALUES (?, ?, ?, ?, ?, 1, ?)`,
        ).run(
          sellerId,
          userId,
          (storeName || `${cleanName}'s Studio`).trim(),
          (storeBio || 'Independent verified seller on Radix Marketplace.').trim(),
          (storeLocation || 'United States').trim(),
          now,
        );
      }
    });

    registerTx();

    const token = signSessionToken(userId, cleanEmail);
    setSessionCookie(res, token);
    const user = getUserById(userId);
    res.status(201).json({ user, token });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    const cleanEmail = (email || '').trim().toLowerCase();
    const rawPassword = password || '';

    if (!cleanEmail || !rawPassword) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const userRow = db
      .prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
      .get(cleanEmail) as { id: string; email: string; password_hash: string } | undefined;

    if (!userRow || !verifyPassword(rawPassword, userRow.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = signSessionToken(userRow.id, userRow.email);
    setSessionCookie(res, token);
    const user = getUserById(userRow.id);
    res.json({ user, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Sign in failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
  if (!req.authUserId) {
    res.json({ user: null });
    return;
  }
  const user = getUserById(req.authUserId);
  res.json({ user });
});

// ---------- Seller Storefront Onboarding & Profiles ----------
app.post('/api/sellers/onboard', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUserId!;
    const existing = db.prepare('SELECT id FROM sellers WHERE user_id = ?').get(userId) as
      | { id: string }
      | undefined;
    if (existing) {
      res.json({ user: getUserById(userId) });
      return;
    }

    const { storeName, location, bio } = req.body as {
      storeName?: string;
      location?: string;
      bio?: string;
    };

    const cleanStore = (storeName || '').trim();
    if (cleanStore.length < 2) {
      res.status(400).json({ error: 'Store name must be at least 2 characters.' });
      return;
    }

    const now = new Date().toISOString();
    const sellerId = generateId('sel');

    db.transaction(() => {
      db.prepare(`UPDATE users SET role = 'both' WHERE id = ?`).run(userId);
      db.prepare(
        `INSERT INTO sellers (id, user_id, store_name, bio, location, verified, joined_at) VALUES (?, ?, ?, ?, ?, 1, ?)`,
      ).run(
        sellerId,
        userId,
        cleanStore,
        (bio || 'Verified independent merchant offering direct fulfillment on Radix.').trim(),
        (location || 'United States').trim(),
        now,
      );
    })();

    res.status(201).json({ user: getUserById(userId) });
  } catch (err) {
    console.error('Seller onboard error:', err);
    res.status(500).json({ error: 'Failed to create seller storefront.' });
  }
});

app.get('/api/sellers', (_req, res) => {
  res.json({ sellers: listSellers() });
});

app.get('/api/sellers/:id', (req, res) => {
  const seller = getSellerById(req.params.id);
  if (!seller) {
    res.status(404).json({ error: 'Seller not found.' });
    return;
  }
  const products = listProducts({ sellerId: seller.id });
  const reviews = getSellerReviews(seller.id);
  res.json({ seller, products, reviews });
});

// ---------- Product Catalog & Seller Listings ----------
app.get('/api/products', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const sellerId = typeof req.query.sellerId === 'string' ? req.query.sellerId : undefined;
  res.json({ products: listProducts({ category, search, sellerId }) });
});

app.get('/api/products/:id', (req, res) => {
  const product = getProductById(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  const reviews = getProductReviews(product.id);
  const seller = getSellerById(product.sellerId);
  const externalOffers = getProductExternalOffers(product.id);
  const externalReviews = getProductExternalReviews(product.id);
  res.json({ product, reviews, seller, externalOffers, externalReviews });
});

app.post('/api/products/:id/offers', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const product = getProductById(req.params.id);
    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const { siteName, offerUrl, priceDollars, shippingDollars, deliveryWindow, conditionLabel } =
      req.body as {
        siteName?: string;
        offerUrl?: string;
        priceDollars?: number;
        shippingDollars?: number;
        deliveryWindow?: string;
        conditionLabel?: string;
      };

    const cleanSite = (siteName || '').trim();
    const cleanUrl = (offerUrl || '').trim();
    const priceCents = Math.round(Number(priceDollars) * 100);
    const shippingCents = Math.max(0, Math.round((Number(shippingDollars) || 0) * 100));

    if (cleanSite.length < 2) {
      res.status(400).json({ error: 'Website name must be at least 2 characters.' });
      return;
    }
    if (!/^https?:\/\/.+/i.test(cleanUrl)) {
      res.status(400).json({ error: 'Offer URL must start with http:// or https://.' });
      return;
    }
    if (!Number.isFinite(priceCents) || priceCents < 100) {
      res.status(400).json({ error: 'Price must be at least $1.00.' });
      return;
    }

    let domain = cleanSite.toLowerCase().replace(/\s+/g, '') + '.com';
    try {
      domain = new URL(cleanUrl).hostname.replace(/^www\./, '');
    } catch {
      // fallback domain
    }

    const offerId = generateId('off');
    db.prepare(
      `INSERT INTO product_external_offers
       (id, product_id, site_name, site_domain, offer_url, price_cents, shipping_cents, condition_label, delivery_window, seller_rating, in_stock, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 4.7, 1, ?)`,
    ).run(
      offerId,
      product.id,
      cleanSite,
      domain,
      cleanUrl,
      priceCents,
      shippingCents,
      (conditionLabel || 'New · External Retailer').trim(),
      (deliveryWindow || '3–5 business days').trim(),
      new Date().toISOString(),
    );

    res.status(201).json({
      product: getProductById(product.id),
      externalOffers: getProductExternalOffers(product.id),
    });
  } catch (err) {
    console.error('Add external offer error:', err);
    res.status(500).json({ error: 'Failed to add external website offer.' });
  }
});

app.post('/api/products', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const user = getUserById(req.authUserId!);
    if (!user?.sellerProfile) {
      res.status(403).json({ error: 'Activate a Seller Storefront before listing products.' });
      return;
    }

    const { title, description, category, priceDollars, stock, imageUrl, sku, specs } = req.body as {
      title?: string;
      description?: string;
      category?: string;
      priceDollars?: number;
      stock?: number;
      imageUrl?: string;
      sku?: string;
      specs?: Array<{ label: string; value: string }>;
    };

    const cleanTitle = (title || '').trim();
    const cleanDesc = (description || '').trim();
    const cleanCat = (category || 'Computing').trim();
    const priceCents = Math.round(Number(priceDollars) * 100);
    const cleanStock = Math.max(0, Math.floor(Number(stock) || 0));

    if (cleanTitle.length < 3) {
      res.status(400).json({ error: 'Product title must be at least 3 characters.' });
      return;
    }
    if (cleanDesc.length < 15) {
      res.status(400).json({ error: 'Description must be at least 15 characters.' });
      return;
    }
    if (!Number.isFinite(priceCents) || priceCents < 100) {
      res.status(400).json({ error: 'Price must be at least $1.00.' });
      return;
    }

    const id = generateId('prd');
    const slugBase = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const slug = `${slugBase}-${id.slice(-4)}`;
    const cleanImage =
      (imageUrl || '').trim() || '/src/assets/images/product_mechanical_keyboard_1795062896159.jpg';
    const cleanSku = (sku || `RDX-${id.slice(-5).toUpperCase()}`).trim();
    const cleanSpecs = Array.isArray(specs)
      ? specs.filter((s) => s.label?.trim() && s.value?.trim())
      : [];

    db.prepare(
      `INSERT INTO products (id, seller_id, title, slug, description, category, price_cents, stock, image_url, sku, specs_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).run(
      id,
      user.sellerProfile.id,
      cleanTitle,
      slug,
      cleanDesc,
      cleanCat,
      priceCents,
      cleanStock,
      cleanImage,
      cleanSku,
      JSON.stringify(cleanSpecs),
      new Date().toISOString(),
    );

    const product = getProductById(id);
    res.status(201).json({ product });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product listing.' });
  }
});

app.patch('/api/products/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const user = getUserById(req.authUserId!);
    const existing = getProductById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }
    if (!user?.sellerProfile || existing.sellerId !== user.sellerProfile.id) {
      res.status(403).json({ error: 'You can only edit your own listings.' });
      return;
    }

    const { priceDollars, stock, status } = req.body as {
      priceDollars?: number;
      stock?: number;
      status?: 'active' | 'draft' | 'archived';
    };

    const nextPriceCents =
      priceDollars !== undefined ? Math.round(Number(priceDollars) * 100) : existing.priceCents;
    const nextStock = stock !== undefined ? Math.max(0, Math.floor(Number(stock))) : existing.stock;
    const nextStatus = status && ['active', 'draft', 'archived'].includes(status) ? status : existing.status;

    if (!Number.isFinite(nextPriceCents) || nextPriceCents < 100) {
      res.status(400).json({ error: 'Invalid price.' });
      return;
    }

    db.prepare('UPDATE products SET price_cents = ?, stock = ?, status = ? WHERE id = ?').run(
      nextPriceCents,
      nextStock,
      nextStatus,
      existing.id,
    );

    res.json({ product: getProductById(existing.id) });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update product.' });
  }
});

// ---------- Reviews & Verified Seller Ratings ----------
app.post('/api/products/:id/reviews', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUserId!;
    const product = getProductById(req.params.id);
    if (!product) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const { rating, sellerRating, title, comment } = req.body as {
      rating?: number;
      sellerRating?: number;
      title?: string;
      comment?: string;
    };

    const cleanRating = Math.round(Number(rating));
    const cleanSellerRating = Math.round(Number(sellerRating || rating));
    const cleanTitle = (title || '').trim();
    const cleanComment = (comment || '').trim();

    if (cleanRating < 1 || cleanRating > 5 || cleanSellerRating < 1 || cleanSellerRating > 5) {
      res.status(400).json({ error: 'Ratings must be between 1 and 5 stars.' });
      return;
    }
    if (cleanTitle.length < 3 || cleanComment.length < 10) {
      res.status(400).json({ error: 'Please include a short headline and at least 10 characters of review text.' });
      return;
    }

    // Server-verified purchase check
    const matchingOrder = db
      .prepare(
        `SELECT o.id
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE o.buyer_id = ? AND oi.product_id = ?
         ORDER BY o.created_at DESC
         LIMIT 1`,
      )
      .get(userId, product.id) as { id: string } | undefined;

    const reviewId = generateId('rev');
    db.prepare(
      `INSERT INTO reviews (id, product_id, seller_id, user_id, order_id, rating, seller_rating, title, comment, verified_purchase, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      reviewId,
      product.id,
      product.sellerId,
      userId,
      matchingOrder?.id || null,
      cleanRating,
      cleanSellerRating,
      cleanTitle,
      cleanComment,
      matchingOrder ? 1 : 0,
      new Date().toISOString(),
    );

    res.status(201).json({
      product: getProductById(product.id),
      reviews: getProductReviews(product.id),
      seller: getSellerById(product.sellerId),
    });
  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: 'Failed to submit review.' });
  }
});

// ---------- Secure Payment Gateway Routes ----------
app.get('/api/payments/methods', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ methods: listSavedPaymentMethods(req.authUserId!) });
});

app.post('/api/payments/tokenize', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const { cardNumber, expMonth, expYear, cvc, cardholderName, saveMethod } = req.body as {
      cardNumber?: string;
      expMonth?: number;
      expYear?: number;
      cvc?: string;
      cardholderName?: string;
      saveMethod?: boolean;
    };

    const tokenized = tokenizeCard({
      cardNumber: cardNumber || '',
      expMonth: Number(expMonth),
      expYear: Number(expYear),
      cvc: cvc || '',
      cardholderName: cardholderName || '',
    });

    if (saveMethod) {
      const methodId = generateId('pm');
      db.prepare(
        `INSERT INTO payment_methods (id, user_id, brand, last4, exp_month, exp_year, cardholder_name, token, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        methodId,
        req.authUserId!,
        tokenized.brand,
        tokenized.last4,
        tokenized.expMonth,
        tokenized.expYear,
        tokenized.cardholderName,
        tokenized.token,
        new Date().toISOString(),
      );
    }

    res.status(201).json({
      tokenizedMethod: tokenized,
      methods: listSavedPaymentMethods(req.authUserId!),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Card tokenization failed.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/payments/create-intent', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUserId!;
    const { items, idempotencyKey } = req.body as {
      items?: Array<{ productId: string; quantity: number }>;
      idempotencyKey?: string;
    };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Your bag is empty.' });
      return;
    }

    const cleanIdemKey = (idempotencyKey || generateId('idem')).trim();
    const existingIntent = db
      .prepare('SELECT * FROM payment_intents WHERE idempotency_key = ? AND user_id = ?')
      .get(cleanIdemKey, userId) as
      | {
          id: string;
          subtotal_cents: number;
          shipping_cents: number;
          tax_cents: number;
          amount_cents: number;
          status: string;
        }
      | undefined;

    if (existingIntent) {
      res.json({
        paymentIntent: {
          id: existingIntent.id,
          subtotalCents: existingIntent.subtotal_cents,
          shippingCents: existingIntent.shipping_cents,
          taxCents: existingIntent.tax_cents,
          amountCents: existingIntent.amount_cents,
          status: existingIntent.status,
          idempotencyKey: cleanIdemKey,
        },
      });
      return;
    }

    // Authoritative server-side price & stock validation
    let subtotalCents = 0;
    const normalizedItems: Array<{ productId: string; quantity: number }> = [];

    for (const line of items) {
      const qty = Math.floor(Number(line.quantity));
      if (!line.productId || qty <= 0) {
        res.status(400).json({ error: 'Invalid item quantity.' });
        return;
      }
      const product = getProductById(line.productId);
      if (!product || product.status !== 'active') {
        res.status(404).json({ error: 'One of the items in your bag is no longer available.' });
        return;
      }
      if (product.stock < qty) {
        res.status(409).json({
          error: `Only ${product.stock} unit(s) left in stock for "${product.title}".`,
        });
        return;
      }
      subtotalCents += product.priceCents * qty;
      normalizedItems.push({ productId: product.id, quantity: qty });
    }

    const totals = computeOrderTotals(subtotalCents);
    const intentId = generateId('pi');

    db.prepare(
      `INSERT INTO payment_intents (id, user_id, idempotency_key, items_json, subtotal_cents, shipping_cents, tax_cents, amount_cents, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'requires_confirmation', ?, ?)`,
    ).run(
      intentId,
      userId,
      cleanIdemKey,
      JSON.stringify(normalizedItems),
      totals.subtotalCents,
      totals.shippingCents,
      totals.taxCents,
      totals.totalCents,
      new Date().toISOString(),
    );

    res.status(201).json({
      paymentIntent: {
        id: intentId,
        ...totals,
        amountCents: totals.totalCents,
        status: 'requires_confirmation',
        idempotencyKey: cleanIdemKey,
      },
    });
  } catch (err) {
    console.error('Create payment intent error:', err);
    res.status(500).json({ error: 'Could not initialize payment intent.' });
  }
});

app.post('/api/payments/confirm-intent', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authUserId!;
    const {
      paymentIntentId,
      paymentMethodToken,
      cardBrand,
      cardLast4,
      shippingName,
      shippingAddress,
      shippingCity,
      shippingPostal,
      shippingPhone,
    } = req.body as {
      paymentIntentId?: string;
      paymentMethodToken?: string;
      cardBrand?: string;
      cardLast4?: string;
      shippingName?: string;
      shippingAddress?: string;
      shippingCity?: string;
      shippingPostal?: string;
      shippingPhone?: string;
    };

    if (!paymentIntentId || !paymentMethodToken) {
      res.status(400).json({ error: 'Payment intent and tokenized card are required.' });
      return;
    }

    const cleanName = (shippingName || '').trim();
    const cleanAddr = (shippingAddress || '').trim();
    const cleanCity = (shippingCity || '').trim();
    const cleanPostal = (shippingPostal || '').trim();
    const cleanPhone = (shippingPhone || '').trim();

    if (cleanName.length < 2 || cleanAddr.length < 5 || cleanCity.length < 2 || cleanPostal.length < 3) {
      res.status(400).json({ error: 'Please provide a complete shipping address.' });
      return;
    }

    // Look up saved method if token matches a vaulted card
    const savedMethod = db
      .prepare('SELECT brand, last4 FROM payment_methods WHERE token = ? AND user_id = ?')
      .get(paymentMethodToken, userId) as { brand: string; last4: string } | undefined;

    const brand = savedMethod?.brand || cardBrand || 'Card';
    const last4 = savedMethod?.last4 || cardLast4 || '4242';

    const confirmTx = db.transaction((): string => {
      const intent = db
        .prepare('SELECT * FROM payment_intents WHERE id = ? AND user_id = ?')
        .get(paymentIntentId, userId) as
        | {
            id: string;
            items_json: string;
            subtotal_cents: number;
            shipping_cents: number;
            tax_cents: number;
            amount_cents: number;
            status: string;
          }
        | undefined;

      if (!intent) {
        throw new Error('Payment intent not found.');
      }
      if (intent.status === 'succeeded') {
        const existingOrder = db
          .prepare('SELECT id FROM orders WHERE payment_intent_id = ?')
          .get(intent.id) as { id: string } | undefined;
        if (existingOrder) return existingOrder.id;
      }

      const items = JSON.parse(intent.items_json) as Array<{ productId: string; quantity: number }>;
      const now = new Date().toISOString();
      const estimatedDelivery = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
      const gatewayRef = generateGatewayReference();

      // Atomically decrement inventory
      for (const item of items) {
        const product = getProductById(item.productId);
        if (!product || product.stock < item.quantity) {
          throw new Error(`Insufficient stock for ${product?.title || 'requested item'}.`);
        }
        db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(item.quantity, item.productId);
      }

      db.prepare(
        `UPDATE payment_intents
         SET status = 'succeeded', payment_method_token = ?, brand = ?, last4 = ?, gateway_reference = ?
         WHERE id = ?`,
      ).run(paymentMethodToken, brand, last4, gatewayRef, intent.id);

      const orderId = generateId('ord');
      let trackingCode = generateTrackingCode();
      while (db.prepare('SELECT 1 FROM orders WHERE tracking_code = ?').get(trackingCode)) {
        trackingCode = generateTrackingCode();
      }

      db.prepare(
        `INSERT INTO orders (id, tracking_code, buyer_id, payment_intent_id, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_name, shipping_address, shipping_city, shipping_postal, shipping_phone, status, estimated_delivery, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      ).run(
        orderId,
        trackingCode,
        userId,
        intent.id,
        intent.subtotal_cents,
        intent.shipping_cents,
        intent.tax_cents,
        intent.amount_cents,
        cleanName,
        cleanAddr,
        cleanCity,
        cleanPostal,
        cleanPhone || '—',
        estimatedDelivery,
        now,
        now,
      );

      const insertItem = db.prepare(
        `INSERT INTO order_items (id, order_id, product_id, seller_id, title_snapshot, image_snapshot, unit_price_cents, quantity, item_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      );

      for (const item of items) {
        const product = getProductById(item.productId)!;
        insertItem.run(
          generateId('oi'),
          orderId,
          product.id,
          product.sellerId,
          product.title,
          product.imageUrl,
          product.priceCents,
          item.quantity,
        );
      }

      db.prepare(
        `INSERT INTO order_tracking_events (id, order_id, status, location, note, actor_user_id, created_at)
         VALUES (?, ?, 'confirmed', 'Radix Pay Gateway', ?, ?, ?)`,
      ).run(
        generateId('evt'),
        orderId,
        `Payment authorized (${brand} •••• ${last4} · Ref ${gatewayRef})`,
        userId,
        now,
      );

      return orderId;
    });

    const createdOrderId = confirmTx();
    const order = getOrderByIdOrCode(createdOrderId)!;
    broadcastOrderEvent('order:created', order);

    res.status(201).json({ order });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment confirmation failed.';
    res.status(400).json({ error: message });
  }
});

// ---------- Orders & Real-Time Tracking Routes ----------
app.get('/api/orders', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ orders: listBuyerOrders(req.authUserId!) });
});

app.get('/api/orders/track/:identifier', (req, res) => {
  const order = getOrderByIdOrCode(req.params.identifier);
  if (!order) {
    res.status(404).json({ error: 'No order found matching that tracking code.' });
    return;
  }
  res.json({ order });
});

app.get('/api/seller/orders', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = getUserById(req.authUserId!);
  if (!user?.sellerProfile) {
    res.json({ orders: [], listings: [] });
    return;
  }
  const orders = listSellerOrders(user.sellerProfile.id);
  const listings = listProducts({ sellerId: user.sellerProfile.id, includeInactive: true });
  res.json({ orders, listings });
});

const ORDER_STAGE_FLOW: OrderStatus[] = [
  'confirmed',
  'packed',
  'dispatched',
  'out_for_delivery',
  'delivered',
];

const DEFAULT_STAGE_NOTES: Record<OrderStatus, { location: string; note: string }> = {
  confirmed: { location: 'Radix Checkout', note: 'Order confirmed and queued for seller fulfillment' },
  packed: { location: 'Seller Studio Hub', note: 'Quality verified, packed, and shipping label printed' },
  dispatched: { location: 'Regional Transit Hub', note: 'Handed to express carrier and in transit' },
  out_for_delivery: { location: 'Local Delivery Depot', note: 'Loaded on courier vehicle for final-mile delivery' },
  delivered: { location: 'Destination Address', note: 'Package delivered to recipient' },
};

app.post('/api/seller/orders/:id/advance', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const user = getUserById(req.authUserId!);
    const order = getOrderByIdOrCode(req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const sellerOwnsItem =
      user?.sellerProfile && order.items.some((item) => item.sellerId === user.sellerProfile!.id);
    if (!sellerOwnsItem) {
      res.status(403).json({ error: 'Only the fulfilling seller can advance this order stage.' });
      return;
    }

    const currentIdx = ORDER_STAGE_FLOW.indexOf(order.status);
    if (currentIdx === -1 || currentIdx >= ORDER_STAGE_FLOW.length - 1) {
      res.status(400).json({ error: 'Order is already delivered.' });
      return;
    }

    const { nextStatus, location, note } = req.body as {
      nextStatus?: OrderStatus;
      location?: string;
      note?: string;
    };

    const targetStatus =
      nextStatus && ORDER_STAGE_FLOW.indexOf(nextStatus) > currentIdx
        ? nextStatus
        : ORDER_STAGE_FLOW[currentIdx + 1];

    const fallbackMeta = DEFAULT_STAGE_NOTES[targetStatus];
    const cleanLocation = (location || '').trim() || user.sellerProfile?.location || fallbackMeta.location;
    const cleanNote = (note || '').trim() || fallbackMeta.note;
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(
        targetStatus,
        now,
        order.id,
      );
      db.prepare('UPDATE order_items SET item_status = ? WHERE order_id = ? AND seller_id = ?').run(
        targetStatus,
        order.id,
        user.sellerProfile!.id,
      );
      db.prepare(
        `INSERT INTO order_tracking_events (id, order_id, status, location, note, actor_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(generateId('evt'), order.id, targetStatus, cleanLocation, cleanNote, user.id, now);
    })();

    const updatedOrder = getOrderByIdOrCode(order.id)!;
    broadcastOrderEvent('order:updated', updatedOrder);

    res.json({ order: updatedOrder });
  } catch (err) {
    console.error('Advance order error:', err);
    res.status(500).json({ error: 'Failed to update order status.' });
  }
});

// ---------- Vite Dev Middleware / Production Static Serving ----------
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Radix marketplace server listening on http://localhost:${PORT}`);
  });
}

startServer();
