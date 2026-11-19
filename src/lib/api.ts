import type { OrderStatus } from '../types.ts';

const TOKEN_STORAGE_KEY = 'radix_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export const ORDER_STAGES: Array<{
  key: OrderStatus;
  label: string;
  description: string;
}> = [
  { key: 'confirmed', label: 'Confirmed', description: 'Payment authorized' },
  { key: 'packed', label: 'Packed', description: 'Prepared by seller' },
  { key: 'dispatched', label: 'Dispatched', description: 'In carrier transit' },
  { key: 'out_for_delivery', label: 'Out for Delivery', description: 'Local courier' },
  { key: 'delivered', label: 'Delivered', description: 'Completed' },
];

export function getOrderStageLabel(status: OrderStatus): string {
  return ORDER_STAGES.find((s) => s.key === status)?.label || status;
}

export const STUDIO_IMAGE_PRESETS: Array<{ label: string; url: string }> = [
  { label: 'Studio Headphones', url: '/src/assets/images/product_headphones_studio_1795062896138.jpg' },
  { label: 'Mechanical Keyboard', url: '/src/assets/images/product_mechanical_keyboard_1795062896159.jpg' },
  { label: 'Manual Espresso Press', url: '/src/assets/images/product_espresso_machine_1795062896301.jpg' },
  { label: 'Field Chronograph', url: '/src/assets/images/product_chronograph_watch_1795062896534.jpg' },
  { label: 'Gooseneck Kettle', url: '/src/assets/images/product_ceramic_kettle_1795062896430.jpg' },
  { label: '35mm Prime Lens', url: '/src/assets/images/product_camera_lens_1795062896016.jpg' },
  { label: 'Leather Weekender', url: '/src/assets/images/product_leather_weekender_1795062896362.jpg' },
  { label: 'Cantilever Desk Lamp', url: '/src/assets/images/product_desk_lamp_1795063730189.jpg' },
  { label: 'Walnut Vinyl Turntable', url: '/src/assets/images/product_turntable_1795063730152.jpg' },
  { label: 'Bookshelf Wireless Speaker', url: '/src/assets/images/product_bluetooth_speaker_1795063729796.jpg' },
  { label: 'Machined Titanium Pen Duo', url: '/src/assets/images/product_titanium_pen_1795063730115.jpg' },
];
