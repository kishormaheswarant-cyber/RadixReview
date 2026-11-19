/**
 * Phase 0 Payload-First Security TDD specification runner for Radix Firestore Rules.
 * Verifies the "Dirty Dozen" adversarial payloads against expected PERMISSION_DENIED outcomes.
 */

export interface SecurityPayloadTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: SecurityPayloadTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Product Create',
    collectionPath: '/products/prd_spoof_1',
    operation: 'create',
    auth: { uid: 'uid_attacker', email_verified: true },
    payload: {
      id: 'prd_spoof_1',
      ownerId: 'uid_victim',
      sellerId: 'uid_victim',
      title: 'Spoofed Audio Interface',
      status: 'active',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Shadow Ghost Field / Self-Verified Seller',
    collectionPath: '/sellers/uid_attacker',
    operation: 'create',
    auth: { uid: 'uid_attacker', email_verified: true },
    payload: {
      id: 'uid_attacker',
      userId: 'uid_attacker',
      storeName: 'Fake Verified Store',
      verified: true,
      adminOverride: true,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'PII Blanket Read on Another User Private Doc',
    collectionPath: '/users/uid_victim/private/info',
    operation: 'get',
    auth: { uid: 'uid_attacker', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Path Variable ID Poisoning (Oversized ID)',
    collectionPath: `/reviews/${'a'.repeat(256)}`,
    operation: 'create',
    auth: { uid: 'uid_attacker', email_verified: true },
    payload: { id: 'a'.repeat(256), rating: 5 },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Unverified Email Write Blocked',
    collectionPath: '/reviews/rev_unverified_1',
    operation: 'create',
    auth: { uid: 'uid_unverified', email_verified: false },
    payload: {
      id: 'rev_unverified_1',
      productId: 'prd_headphones',
      userId: 'uid_unverified',
      rating: 5,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Temporal Forgery (Client Backdated Timestamp)',
    collectionPath: '/reviews/rev_backdate_1',
    operation: 'create',
    auth: { uid: 'uid_buyer', email_verified: true },
    payload: {
      id: 'rev_backdate_1',
      userId: 'uid_buyer',
      createdAt: '2020-01-01T00:00:00.000Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immortal Field Mutation on Product Update',
    collectionPath: '/products/prd_owned_1',
    operation: 'update',
    auth: { uid: 'uid_seller', email_verified: true },
    payload: {
      ownerId: 'uid_other',
      stock: 50,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Order State Shortcutting (Confirmed -> Delivered)',
    collectionPath: '/orders/ord_1',
    operation: 'update',
    auth: { uid: 'uid_seller', email_verified: true },
    payload: {
      status: 'delivered',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Terminal State Bypass After Delivery',
    collectionPath: '/orders/ord_delivered_1',
    operation: 'update',
    auth: { uid: 'uid_seller', email_verified: true },
    payload: {
      status: 'dispatched',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Unauthorized Non-Seller Tracking Event Injection',
    collectionPath: '/orders/ord_1/trackingEvents/evt_bad_1',
    operation: 'create',
    auth: { uid: 'uid_stranger', email_verified: true },
    payload: {
      id: 'evt_bad_1',
      orderId: 'ord_1',
      actorId: 'uid_stranger',
      status: 'packed',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unbounded or Type-Poisoned Array Payload',
    collectionPath: '/products/prd_array_bad',
    operation: 'create',
    auth: { uid: 'uid_seller', email_verified: true },
    payload: {
      id: 'prd_array_bad',
      ownerId: 'uid_seller',
      specs: ['not-a-spec-map'],
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Blanket Unscoped Orders List Query',
    collectionPath: '/orders',
    operation: 'list',
    auth: { uid: 'uid_attacker', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
