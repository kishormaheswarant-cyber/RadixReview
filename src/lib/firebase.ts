import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

// Synchronized validation constants derived verbatim from firebase-blueprint.json
export const BLUEPRINT_CONSTRAINTS = {
  idPattern: /^[a-zA-Z0-9_\-]+$/,
  slugPattern: /^[a-z0-9\-]+$/,
  offerUrlPattern: /^https?:\/\/.+/,
  last4Pattern: /^[0-9]{4}$/,
  trackingCodePattern: /^RDX-[A-Z0-9]+$/,
  maxIdLength: 128,
  maxNameLength: 100,
  maxEmailLength: 200,
  maxStoreNameLength: 100,
  maxBioLength: 800,
  maxLocationLength: 120,
  maxProductTitleLength: 160,
  maxProductDescriptionLength: 2000,
  maxImageUrlLength: 500,
  maxSkuLength: 48,
  maxSpecsCount: 12,
  maxReviewTitleLength: 140,
  maxReviewCommentLength: 2000,
  maxSiteNameLength: 80,
  maxSiteDomainLength: 120,
  maxOfferUrlLength: 500,
  maxShippingNameLength: 120,
  maxShippingAddressLength: 240,
  maxShippingCityLength: 120,
  maxShippingPostalLength: 24,
  maxShippingPhoneLength: 40,
  maxTrackingNoteLength: 300,
  maxSellerIdsPerOrder: 10,
} as const;

export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, BLUEPRINT_CONSTRAINTS.maxIdLength);
}

export function buildValidSlug(value: string, fallbackId: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
  const suffix = fallbackId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-8) || 'item';
  const candidate = base.length >= 3 ? `${base}-${suffix}` : `item-${suffix}`;
  return candidate.slice(0, 180);
}
