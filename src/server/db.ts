import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.ts';
import type {
  ExternalOffer,
  ExternalReview,
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

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'radix.db');
export const db = new Database(DB_PATH);

// Scalable SQLite configuration: WAL mode for concurrent reads/writes + strict foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'seller', 'both')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sellers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      store_name TEXT NOT NULL,
      bio TEXT NOT NULL,
      location TEXT NOT NULL,
      verified INTEGER NOT NULL DEFAULT 1,
      joined_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      image_url TEXT NOT NULL,
      sku TEXT NOT NULL,
      specs_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brand TEXT NOT NULL,
      last4 TEXT NOT NULL,
      exp_month INTEGER NOT NULL,
      exp_year INTEGER NOT NULL,
      cardholder_name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_intents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL UNIQUE,
      items_json TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      shipping_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL CHECK (status IN ('requires_confirmation', 'succeeded', 'failed')),
      payment_method_token TEXT,
      brand TEXT,
      last4 TEXT,
      gateway_reference TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      tracking_code TEXT NOT NULL UNIQUE,
      buyer_id TEXT NOT NULL REFERENCES users(id),
      payment_intent_id TEXT NOT NULL REFERENCES payment_intents(id),
      subtotal_cents INTEGER NOT NULL,
      shipping_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      shipping_name TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      shipping_city TEXT NOT NULL,
      shipping_postal TEXT NOT NULL,
      shipping_phone TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('confirmed', 'packed', 'dispatched', 'out_for_delivery', 'delivered')),
      estimated_delivery TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      seller_id TEXT NOT NULL REFERENCES sellers(id),
      title_snapshot TEXT NOT NULL,
      image_snapshot TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      item_status TEXT NOT NULL DEFAULT 'confirmed'
    );

    CREATE TABLE IF NOT EXISTS order_tracking_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('confirmed', 'packed', 'dispatched', 'out_for_delivery', 'delivered')),
      location TEXT NOT NULL,
      note TEXT NOT NULL,
      actor_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      seller_id TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      seller_rating INTEGER NOT NULL CHECK (seller_rating BETWEEN 1 AND 5),
      title TEXT NOT NULL,
      comment TEXT NOT NULL,
      verified_purchase INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_external_offers (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      site_name TEXT NOT NULL,
      site_domain TEXT NOT NULL,
      offer_url TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      shipping_cents INTEGER NOT NULL DEFAULT 0,
      condition_label TEXT NOT NULL DEFAULT 'New · Authorized Dealer',
      delivery_window TEXT NOT NULL DEFAULT '3–5 business days',
      seller_rating REAL NOT NULL DEFAULT 4.7,
      in_stock INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS external_reviews (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      source_site TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      author_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      title TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      published_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_category_status ON products(category, status);
    CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
    CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_orders_tracking ON orders(tracking_code);
    CREATE INDEX IF NOT EXISTS idx_order_items_seller ON order_items(seller_id, order_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_order ON order_tracking_events(order_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reviews_seller ON reviews(seller_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ext_offers_product ON product_external_offers(product_id, price_cents ASC);
    CREATE INDEX IF NOT EXISTS idx_ext_reviews_product ON external_reviews(product_id, published_at DESC);
  `);

  seedInitialData();
  ensureExtendedCatalogAndOffers();
}

function ensureExtendedCatalogAndOffers(): void {
  const tx = db.transaction(() => {
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

    const insertProductIgnore = db.prepare(
      `INSERT OR IGNORE INTO products (id, seller_id, title, slug, description, category, price_cents, stock, image_url, sku, specs_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    );

    const extendedProducts: Array<{
      id: string;
      sellerId: string;
      title: string;
      slug: string;
      description: string;
      category: string;
      priceCents: number;
      stock: number;
      imageUrl: string;
      sku: string;
      specs: ProductSpec[];
      createdAt: string;
    }> = [
      {
        id: 'prd_desklamp',
        sellerId: 'sel_aria',
        title: 'Aethelgard Cantilever LED Task Lamp',
        slug: 'aethelgard-cantilever-led-task-lamp',
        description:
          'Counterbalanced brushed aluminum desk luminaire featuring high-CRI 97+ warm-to-daylight LED array, tensioned stainless steel cables, and a solid knurled brass stepless dimmer dial.',
        category: 'Lighting',
        priceCents: 29500,
        stock: 14,
        imageUrl: '/src/assets/images/product_desk_lamp_1795063730189.jpg',
        sku: 'ARI-LMP-02',
        specs: [
          { label: 'Color Accuracy', value: '97+ CRI · 2700K–4500K' },
          { label: 'Chassis', value: 'Bead-Blasted 6061 Aluminum' },
          { label: 'Dimmer', value: 'Knurled Solid Brass Rotary' },
          { label: 'Reach', value: '68 cm Cantilever Span' },
        ],
        createdAt: daysAgo(15),
      },
      {
        id: 'prd_turntable',
        sellerId: 'sel_vesper',
        title: 'Vesper Walnut Belt-Drive Vinyl Turntable',
        slug: 'vesper-walnut-belt-drive-vinyl-turntable',
        description:
          'Audiophile belt-drive turntable milled from kiln-dried American black walnut with an optical speed-regulated DC motor, damped 2.1kg aluminum platter, and pre-calibrated Ortofon elliptical cartridge.',
        category: 'Audio',
        priceCents: 79000,
        stock: 8,
        imageUrl: '/src/assets/images/product_turntable_1795063730152.jpg',
        sku: 'VSP-TT-200',
        specs: [
          { label: 'Plinth', value: 'Solid Oiled American Walnut' },
          { label: 'Speeds', value: '33.3 / 45 RPM Optical Lock' },
          { label: 'Tonearm', value: '8.6" Gimbaled Aluminum' },
          { label: 'Output', value: 'Switchable Phono / Line RCA' },
        ],
        createdAt: daysAgo(12),
      },
      {
        id: 'prd_speaker',
        sellerId: 'sel_aria',
        title: 'Audo Brushed Aluminum Wireless Speaker',
        slug: 'audo-brushed-aluminum-wireless-speaker',
        description:
          'Compact acoustic monitor wrapped in Kvadrat charcoal wool and CNC-extruded silver aluminum. Supports AirPlay 2, lossless Wi-Fi streaming, Bluetooth 5.3 aptX Adaptive, and stereo pairing.',
        category: 'Audio',
        priceCents: 42000,
        stock: 16,
        imageUrl: '/src/assets/images/product_bluetooth_speaker_1795063729796.jpg',
        sku: 'ARI-SPK-11',
        specs: [
          { label: 'Amplification', value: '90W Class-D Bi-Amped' },
          { label: 'Connectivity', value: 'Wi-Fi 6 · AirPlay 2 · USB-C' },
          { label: 'Grille', value: 'Kvadrat Acoustic Wool' },
          { label: 'Dimensions', value: '14 × 24 × 15 cm' },
        ],
        createdAt: daysAgo(10),
      },
      {
        id: 'prd_penset',
        sellerId: 'sel_kestrel',
        title: 'Kestrel Machined Titanium & Brass Pen Duo',
        slug: 'kestrel-machined-titanium-brass-pen-duo',
        description:
          'Twin-pack precision writing instruments turned on Swiss lathes from Grade 5 titanium and C360 raw brass with diamond-knurled grip sections and Schmidt P9000 pressurized ink cartridges.',
        category: 'Carry',
        priceCents: 14800,
        stock: 27,
        imageUrl: '/src/assets/images/product_titanium_pen_1795063730115.jpg',
        sku: 'KST-PEN-02',
        specs: [
          { label: 'Alloys', value: 'Grade 5 Titanium & C360 Brass' },
          { label: 'Grip', value: '0.4mm Diamond Micro-Knurl' },
          { label: 'Refill', value: 'Parker G2 / Schmidt EasyFlow' },
          { label: 'Weight', value: '32g Titanium · 44g Brass' },
        ],
        createdAt: daysAgo(8),
      },
    ];

    for (const p of extendedProducts) {
      insertProductIgnore.run(
        p.id,
        p.sellerId,
        p.title,
        p.slug,
        p.description,
        p.category,
        p.priceCents,
        p.stock,
        p.imageUrl,
        p.sku,
        JSON.stringify(p.specs),
        p.createdAt,
      );
    }

    // Seed Radix Verified Reviews for the 4 new products (if missing)
    const insertReviewIgnore = db.prepare(
      `INSERT OR IGNORE INTO reviews (id, product_id, seller_id, user_id, order_id, rating, seller_rating, title, comment, verified_purchase, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertReviewIgnore.run(
      'rev_ext_8',
      'prd_desklamp',
      'sel_aria',
      'usr_buyer_julian',
      null,
      5,
      5,
      'Zero glare on glossy studio monitors',
      'The brass rotary dimmer feels like vintage hi-fi gear. Holds its exact height without sagging.',
      1,
      daysAgo(5),
    );
    insertReviewIgnore.run(
      'rev_ext_9',
      'prd_turntable',
      'sel_vesper',
      'usr_buyer_elena',
      null,
      5,
      5,
      'Dead-silent noise floor and gorgeous walnut grain',
      'Setup took ten minutes out of the crate. Tracking force gauge was spot-on from Atelier Vesper.',
      1,
      daysAgo(4),
    );
    insertReviewIgnore.run(
      'rev_ext_10',
      'prd_speaker',
      'sel_aria',
      'usr_buyer_maya',
      null,
      5,
      5,
      'Remarkable bass extension for a bookshelf footprint',
      'Paired two over Wi-Fi in my living room—vocal clarity rivals passive monitors twice its size.',
      1,
      daysAgo(3),
    );
    insertReviewIgnore.run(
      'rev_ext_11',
      'prd_penset',
      'sel_kestrel',
      'usr_buyer_julian',
      null,
      4,
      5,
      'Balanced weight and zero tip wiggle',
      'The brass pen develops a subtle warm patina within a week. Thread tolerances are invisible to the naked eye.',
      1,
      daysAgo(2),
    );

    // Seed External Website Offers across all 11 products
    const insertOfferIgnore = db.prepare(
      `INSERT OR IGNORE INTO product_external_offers
       (id, product_id, site_name, site_domain, offer_url, price_cents, shipping_cents, condition_label, delivery_window, seller_rating, in_stock, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const offersSeed: Array<[string, string, string, string, string, number, number, string, string, number, number]> = [
      ['off_hp_1', 'prd_headphones', 'B&H Photo Video', 'bhphotovideo.com', 'https://www.bhphotovideo.com', 36900, 0, 'New · Authorized Dealer', '2–4 business days', 4.8, 1],
      ['off_hp_2', 'prd_headphones', 'AudioCraft Direct', 'audiocraft.store', 'https://www.crutchfield.com', 35900, 1400, 'New · Boxed', '4–6 business days', 4.7, 1],
      ['off_esp_1', 'prd_espresso', 'Seattle Coffee Gear', 'seattlecoffeegear.com', 'https://www.seattlecoffeegear.com', 71500, 0, 'New · 2-Yr Warranty', '3–5 business days', 4.8, 1],
      ['off_esp_2', 'prd_espresso', 'Nordic Kitchen Co.', 'nordickitchen.dk', 'https://www.wholelattelove.com', 69900, 2500, 'New · EU/US Dual Voltage', '5–7 business days', 4.6, 1],
      ['off_kb_1', 'prd_keyboard', 'Drop Studio', 'drop.com', 'https://drop.com', 27900, 1000, 'New · Barebones + Keycaps', '4–6 business days', 4.6, 1],
      ['off_kb_2', 'prd_keyboard', 'MechanicalKeyboards', 'mechanicalkeyboards.com', 'https://mechanicalkeyboards.com', 28500, 0, 'New · Factory Assembled', '3–5 business days', 4.8, 1],
      ['off_wt_1', 'prd_watch', 'HODINKEE Shop', 'shop.hodinkee.com', 'https://shop.hodinkee.com', 92500, 0, 'New · Authorized AD', '2–3 business days', 4.9, 1],
      ['off_wt_2', 'prd_watch', 'Chrono24 Boutique', 'chrono24.com', 'https://www.chrono24.com', 87500, 3500, 'Unworn · Box & Papers', '5–8 business days', 4.7, 1],
      ['off_kt_1', 'prd_kettle', 'Fellow & Co. Retail', 'fellowproducts.com', 'https://fellowproducts.com', 17500, 0, 'New · Direct Warranty', '3–5 business days', 4.8, 1],
      ['off_kt_2', 'prd_kettle', 'Crate & Barrel', 'crateandbarrel.com', 'https://www.crateandbarrel.com', 16900, 1295, 'New · Retail Box', '3–6 business days', 4.5, 1],
      ['off_ln_1', 'prd_lens', 'B&H Photo Video', 'bhphotovideo.com', 'https://www.bhphotovideo.com', 76900, 0, 'New · Munich QC Cert', '2–3 business days', 4.9, 1],
      ['off_ln_2', 'prd_lens', 'Adorama Pro', 'adorama.com', 'https://www.adorama.com', 75500, 0, 'New · US Warranty', '3–5 business days', 4.7, 1],
      ['off_wk_1', 'prd_weekender', 'Huckberry', 'huckberry.com', 'https://huckberry.com', 48500, 0, 'New · Tuscan Hide', '3–4 business days', 4.8, 1],
      ['off_wk_2', 'prd_weekender', 'MR PORTER', 'mrporter.com', 'https://www.mrporter.com', 49500, 0, 'New · Dust Bag Included', '2–4 business days', 4.9, 1],
      ['off_dl_1', 'prd_desklamp', 'Design Within Reach', 'dwr.com', 'https://www.dwr.com', 32500, 1500, 'New · Architectural Edition', '4–7 business days', 4.7, 1],
      ['off_dl_2', 'prd_desklamp', 'MoMA Design Store', 'store.moma.org', 'https://store.moma.org', 31000, 1200, 'New · Curated Selection', '3–5 business days', 4.8, 1],
      ['off_tt_1', 'prd_turntable', 'Crutchfield', 'crutchfield.com', 'https://www.crutchfield.com', 81900, 0, 'New · Pre-Mounted Cartridge', '2–4 business days', 4.9, 1],
      ['off_tt_2', 'prd_turntable', 'Turntable Lab', 'turntablelab.com', 'https://www.turntablelab.com', 79900, 1800, 'New · Walnut Plinth', '4–6 business days', 4.8, 1],
      ['off_sp_1', 'prd_speaker', 'Audo Copenhagen', 'audocph.com', 'https://audocph.com', 44900, 0, 'New · Nordic Edition', '3–5 business days', 4.8, 1],
      ['off_sp_2', 'prd_speaker', 'Nordic Nest', 'nordicnest.com', 'https://www.nordicnest.com', 43500, 1500, 'New · Kvadrat Wool', '5–7 business days', 4.6, 1],
      ['off_pn_1', 'prd_penset', 'Goulet Pens', 'gouletpens.com', 'https://www.gouletpens.com', 15800, 700, 'New · Gift Boxed', '2–4 business days', 4.9, 1],
      ['off_pn_2', 'prd_penset', 'JetPens', 'jetpens.com', 'https://www.jetpens.com', 15200, 0, 'New · Twin Pack', '3–5 business days', 4.9, 1],
    ];

    for (const o of offersSeed) {
      insertOfferIgnore.run(...o, daysAgo(1));
    }

    // Seed Combined External Website Reviews across all 11 products
    const insertExtReviewIgnore = db.prepare(
      `INSERT OR IGNORE INTO external_reviews
       (id, product_id, source_site, source_domain, author_name, rating, title, excerpt, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const extReviewsSeed: Array<[string, string, string, string, string, number, string, string, string]> = [
      ['exr_hp_1', 'prd_headphones', 'AudioScience Review', 'audiosciencereview.com', 'Amir M.', 5, 'Clean Harman-adjacent tuning with minimal distortion', 'Measured THD stays below 0.12% across the midband. Titanium yoke geometry resists creaks under studio wear.', daysAgo(21)],
      ['exr_hp_2', 'prd_headphones', 'Gear Patrol', 'gearpatrol.com', 'Tucker B.', 5, 'Built like studio equipment, comfortable like lounge wear', '48-hour real-world battery endurance and lossless USB-C audio make these our top travel reference pair.', daysAgo(12)],
      ['exr_esp_1', 'prd_espresso', 'Home-Barista', 'home-barista.com', 'Marcus V.', 5, 'Tactile lever feedback you simply cannot get from buttons', 'Thermal stability stayed within 0.6°C across four consecutive double shots.', daysAgo(19)],
      ['exr_esp_2', 'prd_espresso', 'Wirecutter Lab', 'nytimes.com/wirecutter', 'Lesley S.', 4, 'Compact footprint with commercial 58mm compatibility', 'Steep learning curve for first-time lever users, but extraction ceiling rivals machines twice its price.', daysAgo(11)],
      ['exr_kb_1', 'prd_keyboard', 'Keychatter', 'keychatter.com', 'Devon K.', 5, 'Dense 1.85kg gasket acoustics with zero hollow resonance', 'The solid brass encoder and crisp QMK/VIA support make this a standout daily driver.', daysAgo(16)],
      ['exr_kb_2', 'prd_keyboard', 'The Verge Reviews', 'theverge.com', 'Antonio G.', 5, 'Machined aluminum perfection for Mac and Linux desks', 'Warm PBT legends remain sharp and tactile even after months of heavy coding.', daysAgo(9)],
      ['exr_wt_1', 'prd_watch', 'Worn & Wound', 'wornandwound.com', 'Zach W.', 5, 'Sub-40mm field chronograph proportions done right', 'Bead-blasted 316L steel paired with an effortless 54-hour automatic movement.', daysAgo(25)],
      ['exr_wt_2', 'prd_watch', 'Hodinkee Dispatch', 'hodinkee.com', 'Cole P.', 4, 'Warm cream dial with crisp orange chrono seconds hand', 'Sapphire AR coating cuts reflections cleanly outdoors; strap softens rapidly.', daysAgo(14)],
      ['exr_kt_1', 'prd_kettle', 'Spudge Gear', 'sprudge.com', 'Noah F.', 5, 'Laminar pour spout holds a vertical stream effortlessly', 'Degree-accurate PID holds temperature through long V60 bloom cycles.', daysAgo(17)],
      ['exr_ln_1', 'prd_lens', 'DPReview Lab', 'dpreview.com', 'Chris N.', 5, 'Apochromatic correction eliminates longitudinal CA wide open', 'Focus throw is silky and damped to cinema standards.', daysAgo(18)],
      ['exr_wk_1', 'prd_weekender', 'Carryology', 'carryology.com', 'Taylor W.', 5, 'Vegetable-tanned Tuscan hide with zero plastic hardware', 'Fits neatly beneath regional jet overhead bins with room for four days of clothing.', daysAgo(13)],
      ['exr_dl_1', 'prd_desklamp', 'Core77', 'core77.com', 'Rain N.', 5, 'Architectural counterbalance with heirloom brass dimmer', '97+ CRI illumination makes color-critical print proofing noticeably more accurate at night.', daysAgo(7)],
      ['exr_tt_1', 'prd_turntable', 'What Hi-Fi?', 'whathifi.com', 'Samir P.', 5, 'Musical timing and rock-solid optical speed stability', 'Walnut plinth damps floorboard vibration far better than hollow MDF competitors.', daysAgo(6)],
      ['exr_sp_1', 'prd_speaker', 'Wallpaper* Tech', 'wallpaper.com', 'Jonathan B.', 5, 'Sculptural Scandinavian form meets room-filling dispersion', 'Kvadrat wool front conceals dual waveguides that sound remarkably open off-axis.', daysAgo(5)],
      ['exr_pn_1', 'prd_penset', 'Everyday Carry', 'everydaycarry.com', 'Bernard C.', 5, 'Zero tip play and razor-clean Swiss-lathe knurling', 'Titanium for light daily carry, C360 brass for desk permanence.', daysAgo(4)],
    ];

    for (const r of extReviewsSeed) {
      insertExtReviewIgnore.run(...r);
    }
  });

  tx();
}

function seedInitialData(): void {
  const userCount = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
  if (userCount > 0) return;

  const seedTx = db.transaction(() => {
    const now = new Date();
    const daysAgo = (d: number, hoursOffset = 0) =>
      new Date(now.getTime() - d * 86400000 - hoursOffset * 3600000).toISOString();
    const daysAhead = (d: number) =>
      new Date(now.getTime() + d * 86400000).toISOString().slice(0, 10);

    // Seed Users (Demo Buyer + 3 Verified Sellers)
    const buyerId = 'usr_buyer_maya';
    const sellerUser1 = 'usr_seller_aria';
    const sellerUser2 = 'usr_seller_vesper';
    const sellerUser3 = 'usr_seller_kestrel';
    const reviewer2 = 'usr_buyer_julian';
    const reviewer3 = 'usr_buyer_elena';

    const insertUser = db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insertUser.run(buyerId, 'buyer@radix.market', 'Maya Lin', hashPassword('RadixBuyer!2026'), 'buyer', daysAgo(60));
    insertUser.run(sellerUser1, 'seller1@radix.market', 'Kenji Takahashi', hashPassword('RadixSeller!2026'), 'both', daysAgo(120));
    insertUser.run(sellerUser2, 'seller2@radix.market', 'Soren Lindqvist', hashPassword('RadixSeller!2026'), 'both', daysAgo(110));
    insertUser.run(sellerUser3, 'seller3@radix.market', 'Lukas Weber', hashPassword('RadixSeller!2026'), 'both', daysAgo(95));
    insertUser.run(reviewer2, 'julian@radix.market', 'Julian Mercer', hashPassword('RadixBuyer!2026'), 'buyer', daysAgo(45));
    insertUser.run(reviewer3, 'elena@radix.market', 'Elena Rostova', hashPassword('RadixBuyer!2026'), 'buyer', daysAgo(35));

    // Seed Seller Storefronts
    const insertSeller = db.prepare(
      `INSERT INTO sellers (id, user_id, store_name, bio, location, verified, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertSeller.run(
      'sel_aria',
      sellerUser1,
      'Aria Acoustics & Desk',
      'Precision-machined audio hardware, custom mechanical input instruments, and tactile desk tools engineered in small batches.',
      'Portland, OR',
      1,
      daysAgo(120),
    );
    insertSeller.run(
      'sel_vesper',
      sellerUser2,
      'Atelier Vesper',
      'Architectural coffee apparatus, mechanical field chronographs, and enduring everyday kitchen hardware.',
      'Copenhagen, DK',
      1,
      daysAgo(110),
    );
    insertSeller.run(
      'sel_kestrel',
      sellerUser3,
      'Kestrel Optics & Carry',
      'Multi-coated prime optical lenses and vegetable-tanned full-grain leather travel goods built for decades of field work.',
      'Munich, DE',
      1,
      daysAgo(95),
    );

    // Seed Saved Tokenized Payment Method for Demo Buyer
    db.prepare(
      `INSERT INTO payment_methods (id, user_id, brand, last4, exp_month, exp_year, cardholder_name, token, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'pm_demo_visa',
      buyerId,
      'Visa',
      '4242',
      11,
      2029,
      'Maya Lin',
      'tok_rdx_demo_visa_4242',
      1,
      daysAgo(30),
    );

    // Seed 7 Curated Products using generated studio images
    const insertProduct = db.prepare(
      `INSERT INTO products (id, seller_id, title, slug, description, category, price_cents, stock, image_url, sku, specs_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    );

    const seededProducts: Array<{
      id: string;
      sellerId: string;
      title: string;
      slug: string;
      description: string;
      category: string;
      priceCents: number;
      stock: number;
      imageUrl: string;
      sku: string;
      specs: ProductSpec[];
      createdAt: string;
    }> = [
      {
        id: 'prd_headphones',
        sellerId: 'sel_aria',
        title: 'Aria Studio Reference Wireless Headphones',
        slug: 'aria-studio-reference-wireless-headphones',
        description:
          'Closed-back planar-inspired dynamic drivers housed in bead-blasted aluminum and breathable micro-suede ear cushions. Calibrated for neutral mastering response with 48-hour battery endurance and lossless USB-C DAC mode.',
        category: 'Audio',
        priceCents: 34900,
        stock: 18,
        imageUrl: '/src/assets/images/product_headphones_studio_1795062896138.jpg',
        sku: 'ARI-HD-400',
        specs: [
          { label: 'Driver', value: '45mm Beryllium Composite' },
          { label: 'Impedance', value: '32 Ohms (Passive)' },
          { label: 'Battery', value: '48 Hours · USB-C Fast Charge' },
          { label: 'Weight', value: '286g Titanium Hinges' },
        ],
        createdAt: daysAgo(50),
      },
      {
        id: 'prd_espresso',
        sellerId: 'sel_vesper',
        title: 'Lever & Oak Manual Espresso Press',
        slug: 'lever-and-oak-manual-espresso-press',
        description:
          'Direct-lever 9-bar extraction built from 304 brushed stainless steel and oiled European walnut. Features an integrated analog pressure gauge, PID-regulated thermal block, and 58mm commercial portafilter.',
        category: 'Coffee & Kitchen',
        priceCents: 68500,
        stock: 9,
        imageUrl: '/src/assets/images/product_espresso_machine_1795062896301.jpg',
        sku: 'VSP-ESP-09',
        specs: [
          { label: 'Pressure', value: '0–12 Bar Analog Gauge' },
          { label: 'Portafilter', value: '58mm Commercial Brass' },
          { label: 'Materials', value: '304 Steel & American Walnut' },
          { label: 'Footprint', value: '21 × 26 × 38 cm' },
        ],
        createdAt: daysAgo(45),
      },
      {
        id: 'prd_keyboard',
        sellerId: 'sel_aria',
        title: 'Radix 75 CNC Aluminum Mechanical Keyboard',
        slug: 'radix-75-cnc-aluminum-mechanical-keyboard',
        description:
          'Gasket-mounted 75% mechanical instrument milled from a solid 6063 aluminum billet. Equipped with dye-sublimated warm PBT keycaps, a solid knurled brass rotary encoder, and QMK/VIA open-source firmware.',
        category: 'Computing',
        priceCents: 26500,
        stock: 24,
        imageUrl: '/src/assets/images/product_mechanical_keyboard_1795062896159.jpg',
        sku: 'ARI-KB-75',
        specs: [
          { label: 'Chassis', value: 'CNC 6063 Anodized Aluminum' },
          { label: 'Mount', value: 'Poron Gasket · Hot-Swap PCB' },
          { label: 'Firmware', value: 'Open-Source QMK / VIA' },
          { label: 'Weight', value: '1.85 kg Assembled' },
        ],
        createdAt: daysAgo(40),
      },
      {
        id: 'prd_watch',
        sellerId: 'sel_vesper',
        title: 'Vesper Field Automatic Chronograph',
        slug: 'vesper-field-automatic-chronograph',
        description:
          '39mm bead-blasted 316L steel field chronograph powered by a regulated 28,800 vph automatic movement. Protected by domed sapphire crystal with inner anti-reflective coating and Horween vegetable-tanned strap.',
        category: 'Timepieces',
        priceCents: 89000,
        stock: 6,
        imageUrl: '/src/assets/images/product_chronograph_watch_1795062896534.jpg',
        sku: 'VSP-CHR-39',
        specs: [
          { label: 'Case Diameter', value: '39.0 mm · 100m Water Resistance' },
          { label: 'Crystal', value: 'Box-Domed Sapphire (AR)' },
          { label: 'Movement', value: 'Automatic Mechanical · 54h Reserve' },
          { label: 'Strap', value: '20mm Full-Grain Saddle Leather' },
        ],
        createdAt: daysAgo(35),
      },
      {
        id: 'prd_kettle',
        sellerId: 'sel_vesper',
        title: 'Kanto Variable-Temp Gooseneck Kettle',
        slug: 'kanto-variable-temp-gooseneck-kettle',
        description:
          'Precision-balanced 0.9L pour-over kettle with degree-accurate PID heating, matte obsidian powder coat, and solid white oak handle. Delivers laminar flow control for filter coffee and loose-leaf tea.',
        category: 'Coffee & Kitchen',
        priceCents: 16500,
        stock: 31,
        imageUrl: '/src/assets/images/product_ceramic_kettle_1795062896430.jpg',
        sku: 'VSP-KTL-09',
        specs: [
          { label: 'Capacity', value: '900 ml · 1200W Quick Heat' },
          { label: 'Control', value: '40°C – 100°C Degree PID' },
          { label: 'Handle', value: 'Kiln-Dried White Oak' },
          { label: 'Spout', value: 'Precision Laminar Gooseneck' },
        ],
        createdAt: daysAgo(30),
      },
      {
        id: 'prd_lens',
        sellerId: 'sel_kestrel',
        title: 'Kestrel 35mm f/1.4 Apochromatic Prime Lens',
        slug: 'kestrel-35mm-f14-apochromatic-prime-lens',
        description:
          'All-metal manual-focus 35mm prime engineered in Munich with low-dispersion lanthanide glass elements, de-clickable 11-blade aperture ring, and engraved depth-of-field scale.',
        category: 'Optics',
        priceCents: 74000,
        stock: 7,
        imageUrl: '/src/assets/images/product_camera_lens_1795062896016.jpg',
        sku: 'KST-OPT-35',
        specs: [
          { label: 'Focal Length', value: '35mm · f/1.4 – f/16' },
          { label: 'Optics', value: '9 Elements in 7 Groups (APO)' },
          { label: 'Filter Thread', value: '52mm Brass Ring' },
          { label: 'Minimum Focus', value: '0.32 m' },
        ],
        createdAt: daysAgo(25),
      },
      {
        id: 'prd_weekender',
        sellerId: 'sel_kestrel',
        title: 'Atelier Full-Grain Leather Weekender Duffel',
        slug: 'atelier-full-grain-leather-weekender-duffel',
        description:
          'Cabin-sized 42L travel bag cut from drum-dyed Italian Tuscan leather and stitched with waxed linen thread. Fitted with solid cast-brass buckles, YKK Excella dual zippers, and padded 16-inch laptop sleeve.',
        category: 'Carry',
        priceCents: 46000,
        stock: 11,
        imageUrl: '/src/assets/images/product_leather_weekender_1795062896362.jpg',
        sku: 'KST-BAG-42',
        specs: [
          { label: 'Volume', value: '42 Liters · Carry-On Compliant' },
          { label: 'Hide', value: '2.2mm Vegetable-Tanned Tuscan' },
          { label: 'Hardware', value: 'Solid Cast Brass & Excella Zip' },
          { label: 'Lining', value: '10oz Organic Cotton Twill' },
        ],
        createdAt: daysAgo(20),
      },
    ];

    for (const p of seededProducts) {
      insertProduct.run(
        p.id,
        p.sellerId,
        p.title,
        p.slug,
        p.description,
        p.category,
        p.priceCents,
        p.stock,
        p.imageUrl,
        p.sku,
        JSON.stringify(p.specs),
        p.createdAt,
      );
    }

    // Seed 2 existing orders for Demo Buyer (1 delivered, 1 actively dispatched for real-time tracking!)
    const insertIntent = db.prepare(
      `INSERT INTO payment_intents (id, user_id, idempotency_key, items_json, subtotal_cents, shipping_cents, tax_cents, amount_cents, currency, status, payment_method_token, brand, last4, gateway_reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'succeeded', ?, ?, ?, ?, ?)`,
    );
    const insertOrder = db.prepare(
      `INSERT INTO orders (id, tracking_code, buyer_id, payment_intent_id, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_name, shipping_address, shipping_city, shipping_postal, shipping_phone, status, estimated_delivery, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertOrderItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, seller_id, title_snapshot, image_snapshot, unit_price_cents, quantity, item_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEvent = db.prepare(
      `INSERT INTO order_tracking_events (id, order_id, status, location, note, actor_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // Order 1: Delivered 8 days ago
    insertIntent.run(
      'pi_seed_1',
      buyerId,
      'idem_seed_1',
      JSON.stringify([{ productId: 'prd_keyboard', quantity: 1 }]),
      26500,
      0,
      2186,
      28686,
      'tok_rdx_demo_visa_4242',
      'Visa',
      '4242',
      'ch_rdx_819a2f0c41',
      daysAgo(12),
    );
    insertOrder.run(
      'ord_seed_1',
      'RDX-409182',
      buyerId,
      'pi_seed_1',
      26500,
      0,
      2186,
      28686,
      'Maya Lin',
      '742 Evergreen Terrace, Apt 4B',
      'San Francisco, CA',
      '94107',
      '+1 (415) 555-0148',
      'delivered',
      daysAgo(8).slice(0, 10),
      daysAgo(12),
      daysAgo(8),
    );
    insertOrderItem.run(
      'oi_seed_1',
      'ord_seed_1',
      'prd_keyboard',
      'sel_aria',
      'Radix 75 CNC Aluminum Mechanical Keyboard',
      '/src/assets/images/product_mechanical_keyboard_1795062896159.jpg',
      26500,
      1,
      'delivered',
    );
    insertEvent.run('evt_s1_1', 'ord_seed_1', 'confirmed', 'Radix Checkout', 'Payment authorized via Visa •••• 4242', buyerId, daysAgo(12, 5));
    insertEvent.run('evt_s1_2', 'ord_seed_1', 'packed', 'Portland, OR Hub', 'Quality inspected and sealed in foam insert', sellerUser1, daysAgo(11, 4));
    insertEvent.run('evt_s1_3', 'ord_seed_1', 'dispatched', 'Portland Regional Carrier', 'Departed origin facility via Express Ground', sellerUser1, daysAgo(10, 2));
    insertEvent.run('evt_s1_4', 'ord_seed_1', 'out_for_delivery', 'San Francisco Depot', 'With local courier for afternoon drop-off', sellerUser1, daysAgo(8, 3));
    insertEvent.run('evt_s1_5', 'ord_seed_1', 'delivered', 'San Francisco, CA 94107', 'Delivered to front reception desk — signed M. Lin', sellerUser1, daysAgo(8, 0));

    // Order 2: Active Dispatched order (live trackable!)
    insertIntent.run(
      'pi_seed_2',
      buyerId,
      'idem_seed_2',
      JSON.stringify([{ productId: 'prd_kettle', quantity: 1 }]),
      16500,
      0,
      1361,
      17861,
      'tok_rdx_demo_visa_4242',
      'Visa',
      '4242',
      'ch_rdx_942b8e1d73',
      daysAgo(2),
    );
    insertOrder.run(
      'ord_seed_2',
      'RDX-849201',
      buyerId,
      'pi_seed_2',
      16500,
      0,
      1361,
      17861,
      'Maya Lin',
      '742 Evergreen Terrace, Apt 4B',
      'San Francisco, CA',
      '94107',
      '+1 (415) 555-0148',
      'dispatched',
      daysAhead(2),
      daysAgo(2),
      daysAgo(1),
    );
    insertOrderItem.run(
      'oi_seed_2',
      'ord_seed_2',
      'prd_kettle',
      'sel_vesper',
      'Kanto Variable-Temp Gooseneck Kettle',
      '/src/assets/images/product_ceramic_kettle_1795062896430.jpg',
      16500,
      1,
      'dispatched',
    );
    insertEvent.run('evt_s2_1', 'ord_seed_2', 'confirmed', 'Radix Checkout', 'Payment authorized via Visa •••• 4242', buyerId, daysAgo(2, 6));
    insertEvent.run('evt_s2_2', 'ord_seed_2', 'packed', 'Copenhagen Studio', 'Serialized unit packed with EU/US dual power base', sellerUser2, daysAgo(1, 8));
    insertEvent.run('evt_s2_3', 'ord_seed_2', 'dispatched', 'Frankfurt Air Freight Hub', 'Cleared customs and departed toward Oakland Gateway', sellerUser2, daysAgo(1, 1));

    // Seed Verified Reviews across products & sellers
    const insertReview = db.prepare(
      `INSERT INTO reviews (id, product_id, seller_id, user_id, order_id, rating, seller_rating, title, comment, verified_purchase, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insertReview.run(
      'rev_1',
      'prd_keyboard',
      'sel_aria',
      buyerId,
      'ord_seed_1',
      5,
      5,
      'Heirloom CNC finish and effortless QMK mapping',
      'Zero case ping out of the box. The anodized silver finish matches my studio display and Kenji shipped it packed in custom-cut high-density foam within 18 hours.',
      1,
      daysAgo(7),
    );
    insertReview.run(
      'rev_2',
      'prd_headphones',
      'sel_aria',
      reviewer2,
      null,
      5,
      5,
      'Neutral mids that do not fatigue after 6 hours',
      'Used these on a full album mix in Logic Pro. Clamping force is balanced and titanium hinges feel indestructible.',
      1,
      daysAgo(14),
    );
    insertReview.run(
      'rev_3',
      'prd_espresso',
      'sel_vesper',
      reviewer3,
      null,
      5,
      5,
      'Consistent 9-bar pulls once dialed in',
      'The walnut lever feels wonderfully weighted. Atelier Vesper answered my grind-size question in under an hour and included spare silicone gaskets.',
      1,
      daysAgo(10),
    );
    insertReview.run(
      'rev_4',
      'prd_watch',
      'sel_vesper',
      reviewer2,
      null,
      4,
      5,
      'Clean cream dial legibility, crisp pusher action',
      'Running +2 seconds per day over two weeks. Strap breaks in fast. Only wish it included a spring-bar tool in the box.',
      1,
      daysAgo(18),
    );
    insertReview.run(
      'rev_5',
      'prd_kettle',
      'sel_vesper',
      reviewer3,
      null,
      5,
      5,
      'Dead-accurate pour control',
      'Holds 93°C steadily without overshooting. Oak handle stays cool even after consecutive brews.',
      1,
      daysAgo(6),
    );
    insertReview.run(
      'rev_6',
      'prd_lens',
      'sel_kestrel',
      reviewer2,
      null,
      5,
      5,
      'Razor sharp wide open at f/1.4',
      'Zero purple fringing on high-contrast chrome highlights. Aperture detents are surgical and Kestrel shipped with factory optical test chart.',
      1,
      daysAgo(9),
    );
    insertReview.run(
      'rev_7',
      'prd_weekender',
      'sel_kestrel',
      reviewer3,
      null,
      5,
      5,
      'Fits overhead bins effortlessly and smells incredible',
      'Took this on three flights between Zurich and London. Brass buckles and stitching show zero wear.',
      1,
      daysAgo(4),
    );
  });

  seedTx();
}

// ---------- Query Helpers ----------

export function getUserById(userId: string): User | null {
  const row = db
    .prepare('SELECT id, email, name, role, created_at FROM users WHERE id = ?')
    .get(userId) as
    | { id: string; email: string; name: string; role: 'buyer' | 'seller' | 'both'; created_at: string }
    | undefined;
  if (!row) return null;

  const sellerRow = db.prepare('SELECT id FROM sellers WHERE user_id = ?').get(userId) as
    | { id: string }
    | undefined;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    sellerProfile: sellerRow ? getSellerById(sellerRow.id) : null,
  };
}

export function getSellerById(sellerId: string): SellerSummary | null {
  const row = db
    .prepare(
      `SELECT
        s.id,
        s.user_id,
        s.store_name,
        s.bio,
        s.location,
        s.verified,
        s.joined_at,
        COALESCE(ROUND(AVG(r.seller_rating), 2), 5.0) AS avg_rating,
        COUNT(DISTINCT r.id) AS review_count,
        COALESCE(
          ROUND(
            100.0 * SUM(CASE WHEN r.seller_rating >= 4 THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT r.id), 0),
            0
          ),
          100
        ) AS positive_percent,
        (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id AND p.status = 'active') AS product_count,
        (SELECT COUNT(DISTINCT oi.order_id) FROM order_items oi WHERE oi.seller_id = s.id) AS orders_fulfilled
      FROM sellers s
      LEFT JOIN reviews r ON r.seller_id = s.id
      WHERE s.id = ?
      GROUP BY s.id`,
    )
    .get(sellerId) as
    | {
        id: string;
        user_id: string;
        store_name: string;
        bio: string;
        location: string;
        verified: number;
        joined_at: string;
        avg_rating: number;
        review_count: number;
        positive_percent: number;
        product_count: number;
        orders_fulfilled: number;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    storeName: row.store_name,
    bio: row.bio,
    location: row.location,
    verified: Boolean(row.verified),
    joinedAt: row.joined_at,
    avgRating: Number(row.avg_rating),
    reviewCount: Number(row.review_count),
    positivePercent: Number(row.positive_percent),
    productCount: Number(row.product_count),
    ordersFulfilled: Number(row.orders_fulfilled),
  };
}

export function listSellers(): SellerSummary[] {
  const rows = db.prepare('SELECT id FROM sellers ORDER BY verified DESC, joined_at ASC').all() as Array<{
    id: string;
  }>;
  return rows.map((r) => getSellerById(r.id)).filter((s): s is SellerSummary => s !== null);
}

interface RawProductRow {
  id: string;
  seller_id: string;
  store_name: string;
  seller_location: string;
  seller_verified: number;
  seller_rating: number;
  seller_review_count: number;
  title: string;
  slug: string;
  description: string;
  category: string;
  price_cents: number;
  stock: number;
  image_url: string;
  sku: string;
  specs_json: string;
  status: 'active' | 'draft' | 'archived';
  avg_rating: number;
  review_count: number;
  offer_count: number;
  lowest_external_cents: number | null;
  ext_review_count: number;
  ext_rating_sum: number;
  radix_rating_sum: number;
  created_at: string;
}

function mapProductRow(row: RawProductRow): Product {
  let specs: ProductSpec[] = [];
  try {
    specs = JSON.parse(row.specs_json) as ProductSpec[];
  } catch {
    specs = [];
  }
  const combinedCount = Number(row.review_count) + Number(row.ext_review_count);
  const combinedSum = Number(row.radix_rating_sum) + Number(row.ext_rating_sum);
  const combinedRating =
    combinedCount > 0 ? Math.round((combinedSum / combinedCount) * 100) / 100 : 0;

  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.store_name,
    sellerLocation: row.seller_location,
    sellerVerified: Boolean(row.seller_verified),
    sellerRating: Number(row.seller_rating),
    sellerReviewCount: Number(row.seller_review_count),
    title: row.title,
    slug: row.slug,
    description: row.description,
    category: row.category,
    priceCents: row.price_cents,
    stock: row.stock,
    imageUrl: row.image_url,
    sku: row.sku,
    specs,
    status: row.status,
    avgRating: Number(row.avg_rating),
    reviewCount: Number(row.review_count),
    offerCount: Number(row.offer_count),
    lowestExternalCents:
      row.lowest_external_cents !== null ? Number(row.lowest_external_cents) : null,
    combinedRating,
    combinedReviewCount: combinedCount,
    createdAt: row.created_at,
  };
}

const PRODUCT_BASE_SELECT = `
  SELECT
    p.id,
    p.seller_id,
    s.store_name,
    s.location AS seller_location,
    s.verified AS seller_verified,
    COALESCE((SELECT ROUND(AVG(sr.seller_rating), 2) FROM reviews sr WHERE sr.seller_id = s.id), 5.0) AS seller_rating,
    (SELECT COUNT(*) FROM reviews sr WHERE sr.seller_id = s.id) AS seller_review_count,
    p.title,
    p.slug,
    p.description,
    p.category,
    p.price_cents,
    p.stock,
    p.image_url,
    p.sku,
    p.specs_json,
    p.status,
    COALESCE((SELECT ROUND(AVG(pr.rating), 2) FROM reviews pr WHERE pr.product_id = p.id), 0) AS avg_rating,
    (SELECT COUNT(*) FROM reviews pr WHERE pr.product_id = p.id) AS review_count,
    (SELECT COUNT(*) FROM product_external_offers eo WHERE eo.product_id = p.id) AS offer_count,
    (SELECT MIN(eo.price_cents + eo.shipping_cents) FROM product_external_offers eo WHERE eo.product_id = p.id AND eo.in_stock = 1) AS lowest_external_cents,
    (SELECT COUNT(*) FROM external_reviews er WHERE er.product_id = p.id) AS ext_review_count,
    COALESCE((SELECT SUM(er.rating) FROM external_reviews er WHERE er.product_id = p.id), 0) AS ext_rating_sum,
    COALESCE((SELECT SUM(pr.rating) FROM reviews pr WHERE pr.product_id = p.id), 0) AS radix_rating_sum,
    p.created_at
  FROM products p
  JOIN sellers s ON s.id = p.seller_id
`;

export function listProducts(filters?: {
  category?: string;
  search?: string;
  sellerId?: string;
  includeInactive?: boolean;
}): Product[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!filters?.includeInactive) {
    clauses.push(`p.status = 'active'`);
  }
  if (filters?.category && filters.category !== 'All') {
    clauses.push(`p.category = ?`);
    params.push(filters.category);
  }
  if (filters?.sellerId) {
    clauses.push(`p.seller_id = ?`);
    params.push(filters.sellerId);
  }
  if (filters?.search && filters.search.trim()) {
    const q = `%${filters.search.trim()}%`;
    clauses.push(`(p.title LIKE ? OR p.description LIKE ? OR p.category LIKE ? OR s.store_name LIKE ?)`);
    params.push(q, q, q, q);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${PRODUCT_BASE_SELECT} ${whereSql} ORDER BY p.created_at DESC`)
    .all(...params) as RawProductRow[];
  return rows.map(mapProductRow);
}

export function getProductById(productId: string): Product | null {
  const row = db
    .prepare(`${PRODUCT_BASE_SELECT} WHERE p.id = ?`)
    .get(productId) as RawProductRow | undefined;
  return row ? mapProductRow(row) : null;
}

export function getProductReviews(productId: string): Review[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.product_id, p.title AS product_title, r.seller_id, r.user_id, u.name AS reviewer_name,
              r.order_id, r.rating, r.seller_rating, r.title, r.comment, r.verified_purchase, r.created_at
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN products p ON p.id = r.product_id
       WHERE r.product_id = ?
       ORDER BY r.created_at DESC`,
    )
    .all(productId) as Array<{
    id: string;
    product_id: string;
    product_title: string;
    seller_id: string;
    user_id: string;
    reviewer_name: string;
    order_id: string | null;
    rating: number;
    seller_rating: number;
    title: string;
    comment: string;
    verified_purchase: number;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productTitle: r.product_title,
    sellerId: r.seller_id,
    userId: r.user_id,
    reviewerName: r.reviewer_name,
    orderId: r.order_id,
    rating: r.rating,
    sellerRating: r.seller_rating,
    title: r.title,
    comment: r.comment,
    verifiedPurchase: Boolean(r.verified_purchase),
    createdAt: r.created_at,
  }));
}

export function getProductExternalOffers(productId: string): ExternalOffer[] {
  const rows = db
    .prepare(
      `SELECT id, product_id, site_name, site_domain, offer_url, price_cents, shipping_cents,
              condition_label, delivery_window, seller_rating, in_stock, updated_at
       FROM product_external_offers
       WHERE product_id = ?
       ORDER BY (price_cents + shipping_cents) ASC`,
    )
    .all(productId) as Array<{
    id: string;
    product_id: string;
    site_name: string;
    site_domain: string;
    offer_url: string;
    price_cents: number;
    shipping_cents: number;
    condition_label: string;
    delivery_window: string;
    seller_rating: number;
    in_stock: number;
    updated_at: string;
  }>;

  return rows.map((o) => ({
    id: o.id,
    productId: o.product_id,
    siteName: o.site_name,
    siteDomain: o.site_domain,
    offerUrl: o.offer_url,
    priceCents: o.price_cents,
    shippingCents: o.shipping_cents,
    conditionLabel: o.condition_label,
    deliveryWindow: o.delivery_window,
    sellerRating: Number(o.seller_rating),
    inStock: Boolean(o.in_stock),
    updatedAt: o.updated_at,
  }));
}

export function getProductExternalReviews(productId: string): ExternalReview[] {
  const rows = db
    .prepare(
      `SELECT id, product_id, source_site, source_domain, author_name, rating, title, excerpt, published_at
       FROM external_reviews
       WHERE product_id = ?
       ORDER BY published_at DESC`,
    )
    .all(productId) as Array<{
    id: string;
    product_id: string;
    source_site: string;
    source_domain: string;
    author_name: string;
    rating: number;
    title: string;
    excerpt: string;
    published_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    sourceSite: r.source_site,
    sourceDomain: r.source_domain,
    authorName: r.author_name,
    rating: r.rating,
    title: r.title,
    excerpt: r.excerpt,
    publishedAt: r.published_at,
  }));
}

export function getSellerReviews(sellerId: string): Review[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.product_id, p.title AS product_title, r.seller_id, r.user_id, u.name AS reviewer_name,
              r.order_id, r.rating, r.seller_rating, r.title, r.comment, r.verified_purchase, r.created_at
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN products p ON p.id = r.product_id
       WHERE r.seller_id = ?
       ORDER BY r.created_at DESC`,
    )
    .all(sellerId) as Array<{
    id: string;
    product_id: string;
    product_title: string;
    seller_id: string;
    user_id: string;
    reviewer_name: string;
    order_id: string | null;
    rating: number;
    seller_rating: number;
    title: string;
    comment: string;
    verified_purchase: number;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productTitle: r.product_title,
    sellerId: r.seller_id,
    userId: r.user_id,
    reviewerName: r.reviewer_name,
    orderId: r.order_id,
    rating: r.rating,
    sellerRating: r.seller_rating,
    title: r.title,
    comment: r.comment,
    verifiedPurchase: Boolean(r.verified_purchase),
    createdAt: r.created_at,
  }));
}

export function listSavedPaymentMethods(userId: string): SavedPaymentMethod[] {
  const rows = db
    .prepare(
      `SELECT id, brand, last4, exp_month, exp_year, cardholder_name, token, is_default
       FROM payment_methods
       WHERE user_id = ?
       ORDER BY is_default DESC, created_at DESC`,
    )
    .all(userId) as Array<{
    id: string;
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
    cardholder_name: string;
    token: string;
    is_default: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    brand: r.brand,
    last4: r.last4,
    expMonth: r.exp_month,
    expYear: r.exp_year,
    cardholderName: r.cardholder_name,
    token: r.token,
    isDefault: Boolean(r.is_default),
  }));
}

export function getOrderByIdOrCode(identifier: string): Order | null {
  const row = db
    .prepare(
      `SELECT o.*, u.name AS buyer_name, pi.brand AS payment_brand, pi.last4 AS payment_last4, pi.gateway_reference
       FROM orders o
       JOIN users u ON u.id = o.buyer_id
       JOIN payment_intents pi ON pi.id = o.payment_intent_id
       WHERE o.id = ? OR UPPER(o.tracking_code) = UPPER(?)`,
    )
    .get(identifier, identifier.trim()) as
    | {
        id: string;
        tracking_code: string;
        buyer_id: string;
        buyer_name: string;
        subtotal_cents: number;
        shipping_cents: number;
        tax_cents: number;
        total_cents: number;
        shipping_name: string;
        shipping_address: string;
        shipping_city: string;
        shipping_postal: string;
        shipping_phone: string;
        status: OrderStatus;
        estimated_delivery: string;
        payment_brand: string | null;
        payment_last4: string | null;
        gateway_reference: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;

  const itemRows = db
    .prepare(
      `SELECT oi.*, s.store_name AS seller_name
       FROM order_items oi
       JOIN sellers s ON s.id = oi.seller_id
       WHERE oi.order_id = ?`,
    )
    .all(row.id) as Array<{
    id: string;
    order_id: string;
    product_id: string;
    seller_id: string;
    seller_name: string;
    title_snapshot: string;
    image_snapshot: string;
    unit_price_cents: number;
    quantity: number;
    item_status: OrderStatus;
  }>;

  const eventRows = db
    .prepare(
      `SELECT id, order_id, status, location, note, created_at
       FROM order_tracking_events
       WHERE order_id = ?
       ORDER BY created_at ASC`,
    )
    .all(row.id) as Array<{
    id: string;
    order_id: string;
    status: OrderStatus;
    location: string;
    note: string;
    created_at: string;
  }>;

  return {
    id: row.id,
    trackingCode: row.tracking_code,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    subtotalCents: row.subtotal_cents,
    shippingCents: row.shipping_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    shippingName: row.shipping_name,
    shippingAddress: row.shipping_address,
    shippingCity: row.shipping_city,
    shippingPostal: row.shipping_postal,
    shippingPhone: row.shipping_phone,
    status: row.status,
    estimatedDelivery: row.estimated_delivery,
    paymentBrand: row.payment_brand || 'Card',
    paymentLast4: row.payment_last4 || '••••',
    gatewayReference: row.gateway_reference || '—',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: itemRows.map(
      (i): OrderItem => ({
        id: i.id,
        orderId: i.order_id,
        productId: i.product_id,
        sellerId: i.seller_id,
        sellerName: i.seller_name,
        titleSnapshot: i.title_snapshot,
        imageSnapshot: i.image_snapshot,
        unitPriceCents: i.unit_price_cents,
        quantity: i.quantity,
        itemStatus: i.item_status,
      }),
    ),
    events: eventRows.map(
      (e): OrderTrackingEvent => ({
        id: e.id,
        orderId: e.order_id,
        status: e.status,
        location: e.location,
        note: e.note,
        createdAt: e.created_at,
      }),
    ),
  };
}

export function listBuyerOrders(buyerId: string): Order[] {
  const rows = db
    .prepare('SELECT id FROM orders WHERE buyer_id = ? ORDER BY created_at DESC')
    .all(buyerId) as Array<{ id: string }>;
  return rows.map((r) => getOrderByIdOrCode(r.id)).filter((o): o is Order => o !== null);
}

export function listSellerOrders(sellerId: string): Order[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT o.id
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE oi.seller_id = ?
       ORDER BY o.created_at DESC`,
    )
    .all(sellerId) as Array<{ id: string }>;
  return rows.map((r) => getOrderByIdOrCode(r.id)).filter((o): o is Order => o !== null);
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function generateTrackingCode(): string {
  const num = crypto.randomInt(100000, 999999);
  return `RDX-${num}`;
}
