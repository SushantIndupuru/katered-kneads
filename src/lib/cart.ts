// Client-side shopping cart, persisted to localStorage so it survives page
// navigation and reloads. All amounts are in integer cents. The server always
// re-validates prices and stock at checkout — this is purely for UX.

export interface CartItem {
    id: string;
    name: string;
    priceCents: number;
    qty: number;
}

export const CART_STORAGE_KEY = 'kk_cart_v1';
const CART_EVENT = 'kk-cart-change';

function isCartItem(value: unknown): value is CartItem {
    const v = value as Partial<CartItem> | null;
    return !!v
        && typeof v.id === 'string'
        && typeof v.name === 'string'
        && typeof v.priceCents === 'number'
        && typeof v.qty === 'number'
        && v.qty > 0;
}

export function getCart(): CartItem[] {
    try {
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isCartItem) : [];
    } catch {
        return [];
    }
}

function save(items: CartItem[]): void {
    try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    } catch {
        // Storage might be unavailable (private mode); fail silently.
    }
    // Notify listeners on this page (the native `storage` event only fires in
    // other tabs, so we dispatch our own for same-tab reactivity).
    window.dispatchEvent(new CustomEvent(CART_EVENT));
}

export function getQty(id: string): number {
    return getCart().find(i => i.id === id)?.qty ?? 0;
}

// Upserts an item to an exact quantity. qty <= 0 removes it.
export function setQty(item: { id: string; name: string; priceCents: number }, qty: number): void {
    const items = getCart();
    const idx = items.findIndex(i => i.id === item.id);
    if (qty <= 0) {
        if (idx >= 0) items.splice(idx, 1);
    } else if (idx >= 0) {
        items[idx] = { ...items[idx], name: item.name, priceCents: item.priceCents, qty };
    } else {
        items.push({ id: item.id, name: item.name, priceCents: item.priceCents, qty });
    }
    save(items);
}

export function removeItem(id: string): void {
    save(getCart().filter(i => i.id !== id));
}

export function clearCart(): void {
    try {
        localStorage.removeItem(CART_STORAGE_KEY);
    } catch {
        // ignore
    }
    window.dispatchEvent(new CustomEvent(CART_EVENT));
}

export function cartCount(): number {
    return getCart().reduce((n, i) => n + i.qty, 0);
}

export function cartSubtotalCents(): number {
    return getCart().reduce((sum, i) => sum + i.priceCents * i.qty, 0);
}

// Subscribe to cart changes (same tab via custom event, other tabs via storage).
// Returns an unsubscribe function.
export function onCartChange(cb: () => void): () => void {
    const handler = () => cb();
    const storageHandler = (e: StorageEvent) => {
        if (e.key === CART_STORAGE_KEY) cb();
    };
    window.addEventListener(CART_EVENT, handler);
    window.addEventListener('storage', storageHandler);
    return () => {
        window.removeEventListener(CART_EVENT, handler);
        window.removeEventListener('storage', storageHandler);
    };
}
