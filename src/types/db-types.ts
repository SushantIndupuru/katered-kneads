export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  // Optional sale price. When set and lower than price, checkout charges this.
  // Null = no sale.
  salePrice: number | null;
}

export interface Drop {
  id: string;
  name: string;
  openTime: string;
  closeTime: string;
  // LEGACY single-spot fields, superseded by PickupSpot (see pickup_spots).
  // Kept as a fallback for drops created before multiple pickup spots existed.
  // When the actual pickup/drop happens, independent of closeTime. Null = unset.
  pickupTime: string | null;
  // Public, general pickup area shown before payment (e.g. "Downtown Davis").
  locationName: string;
  // Exact pickup address — sensitive, only revealed to a customer after payment.
  locationAddress: string;
  // NULL = private draft; set = announced (public countdown + previews show).
  announcedAt: string | null;
  // NULL = the single active/focused drop; set = moved to the "older drops" list.
  archivedAt: string | null;
  // When an item's remaining online stock is at or below this number, the
  // storefront shows a "Low stock, N left" badge. 0 = never show counts.
  lowStockThreshold: number;
}

// One of a drop's pickup spots. A drop can have several; the customer picks
// exactly one at checkout, and its details are snapshotted onto the order.
export interface PickupSpot {
  id: string;
  dropId: string;
  // Public, general pickup area shown before payment (e.g. "Downtown Davis").
  locationName: string;
  // Exact pickup address — sensitive, only revealed to a customer after payment.
  locationAddress: string;
  // The spot's pickup window. pickupEnd is at or after pickupStart.
  pickupStart: string;
  pickupEnd: string;
  // Display order within the drop (lowest first).
  sortOrder: number;
}

export interface DropItem {
  dropId: string;
  menuItemId: string;
  initialStock: number;
  consumedStock: number;
  // Separate in-person sales pool, tracked independently of the online pool.
  inPersonStock: number;
  inPersonConsumed: number;
  preview: boolean;
  tag: string;
}

// A drop item joined with its menu item, ready for display.
export interface DropItemWithMenu {
  menuItem: MenuItem;
  initialStock: number;
  consumedStock: number;
  inPersonStock: number;
  inPersonConsumed: number;
  // How many have physically been baked/made so far (production progress).
  madeStock: number;
  preview: boolean;
  tag: string;
}

// Orders are only persisted once Stripe confirms payment, so there is no
// pending/canceled state — a row exists only for a real purchase.
export type OrderStatus = 'paid' | 'fulfilled';

export interface OrderItem {
  menuItemId: string | null;
  nameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
}

export interface Order {
  id: string;
  dropId: string | null;
  status: OrderStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  // Snapshot of the chosen pickup spot's window at purchase time. pickupTime is
  // the start; pickupTimeEnd is the end (null for legacy orders without a window).
  pickupTime: string | null;
  pickupTimeEnd: string | null;
  // Snapshot of the chosen pickup spot's general area at purchase time.
  pickupLocation: string;
  // Snapshot of the exact pickup address — safe to show since the order is paid.
  pickupAddress: string;
  // Sum of line totals at the charged unit price (sale price if active).
  subtotalCents: number;
  // Coupon discount applied at checkout (0 if none). Charged amount is
  // subtotalCents - discountCents + tipCents.
  discountCents: number;
  // Snapshot of the promo code used (uppercase), if any.
  couponCode: string | null;
  // Optional gratuity added at checkout.
  tipCents: number;
  pickupCode: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  createdAt: string;
  items: OrderItem[];
}

export type CouponType = 'percent' | 'fixed';

export interface Coupon {
  id: string;
  // Stored uppercase.
  code: string;
  type: CouponType;
  // percent: 1–100; fixed: cents off.
  value: number;
  active: boolean;
  expiresAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  minSubtotalCents: number | null;
  createdAt: string;
}

// A customer who opted in to SMS drop updates. The sending side is added
// later; for now this is just a consented, deduplicated list of numbers.
export interface SmsSubscriber {
  id: string;
  // Stored in E.164, e.g. +15305551234.
  phone: string;
  consent: boolean;
  // Where the signup happened (e.g. "footer", "order").
  source: string;
  // NULL = actively subscribed; set = opted out.
  unsubscribedAt: string | null;
  createdAt: string;
}

// A walk-up sale taken through the in-person POS. Unlike online orders there is
// no customer/pickup code — payment is captured on the spot via a QR code.
export interface InPersonSale {
  id: string;
  dropId: string | null;
  subtotalCents: number;
  discountCents: number;
  couponCode: string | null;
  // Optional gratuity added by the customer on the pay page. The amount charged
  // is subtotalCents - discountCents + tipCents.
  tipCents: number;
  stripePaymentIntentId: string;
  createdAt: string;
  items: OrderItem[];
}
