// Lightweight, dependency-free client-side notifications used across the admin
// pages in place of the native window.alert / window.confirm dialogs. Both the
// container DOM and the styles are injected lazily on first use so this module
// can simply be imported from any Astro client <script>.

type ToastKind = 'error' | 'info' | 'success';

let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
    .kk-toast-region {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
        max-width: min(360px, calc(100vw - 2rem));
        pointer-events: none;
    }
    .kk-toast {
        pointer-events: auto;
        background: #fff;
        border: 1px solid var(--accent, #d9cfc2);
        border-left-width: 4px;
        border-radius: 10px;
        padding: 0.8rem 1rem;
        font-size: 0.88rem;
        line-height: 1.35;
        color: var(--text-primary, #1a1a1a);
        box-shadow: 0 6px 20px rgba(26, 26, 26, 0.12);
        opacity: 0;
        transform: translateY(-6px);
        transition: opacity 0.18s ease, transform 0.18s ease;
    }
    .kk-toast.kk-toast-in { opacity: 1; transform: translateY(0); }
    .kk-toast-error { border-left-color: #b00020; }
    .kk-toast-info { border-left-color: #D9C46A; }
    .kk-toast-success { border-left-color: #3F6B33; }

    .kk-confirm-overlay {
        position: fixed;
        inset: 0;
        background: rgba(26, 26, 26, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.25rem;
        z-index: 1001;
        opacity: 0;
        transition: opacity 0.15s ease;
    }
    .kk-confirm-overlay.kk-confirm-in { opacity: 1; }
    .kk-confirm {
        background: var(--bg, #F3EDE5);
        border: 1px solid var(--accent, #d9cfc2);
        border-radius: 14px;
        padding: 1.5rem;
        width: 100%;
        max-width: 400px;
        box-shadow: 0 10px 40px rgba(26, 26, 26, 0.2);
    }
    .kk-confirm-title {
        font-family: 'Cormorant Garamond', serif;
        font-size: 1.35rem;
        font-weight: 600;
        margin: 0 0 0.5rem;
        color: var(--text-primary, #1a1a1a);
    }
    .kk-confirm-msg {
        font-size: 0.9rem;
        color: var(--text-muted, #6b6258);
        margin: 0 0 1.25rem;
        line-height: 1.4;
    }
    .kk-confirm-actions { display: flex; gap: 0.6rem; justify-content: flex-end; }
    .kk-confirm-btn {
        border-radius: 10px;
        padding: 0.6rem 1.1rem;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
    }
    .kk-confirm-cancel {
        background: #fff;
        color: var(--text-muted, #6b6258);
        border: 1px solid var(--accent, #d9cfc2);
    }
    .kk-confirm-cancel:hover { color: var(--text-primary, #1a1a1a); }
    .kk-confirm-ok {
        background: var(--text-primary, #1a1a1a);
        color: var(--bg, #F3EDE5);
        border: none;
    }
    .kk-confirm-ok.kk-confirm-danger { background: #b00020; color: #fff; }
    `;
    document.head.appendChild(style);
}

let region: HTMLElement | null = null;

function getRegion(): HTMLElement {
    if (region && document.body.contains(region)) return region;
    injectStyles();
    region = document.createElement('div');
    region.className = 'kk-toast-region';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
    return region;
}

/** Show a non-blocking toast notification. Auto-dismisses after `duration` ms. */
export function showToast(message: string, kind: ToastKind = 'info', duration = 4000) {
    const host = getRegion();
    const el = document.createElement('div');
    el.className = `kk-toast kk-toast-${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = message;
    host.appendChild(el);
    // Trigger the enter transition on the next frame.
    requestAnimationFrame(() => el.classList.add('kk-toast-in'));

    const remove = () => {
        el.classList.remove('kk-toast-in');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        // Fallback in case the transition doesn't fire.
        setTimeout(() => el.remove(), 300);
    };
    setTimeout(remove, duration);
}

interface ConfirmOptions {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

/**
 * Promise-based replacement for window.confirm. Resolves true when the user
 * confirms, false when they cancel (via button, backdrop, or Escape).
 */
export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    injectStyles();
    const {
        title = 'Are you sure?',
        confirmLabel = 'Confirm',
        cancelLabel = 'Cancel',
        danger = false,
    } = options;

    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'kk-confirm-overlay';
        overlay.innerHTML = `
            <div class="kk-confirm" role="dialog" aria-modal="true">
                <h2 class="kk-confirm-title"></h2>
                <p class="kk-confirm-msg"></p>
                <div class="kk-confirm-actions">
                    <button type="button" class="kk-confirm-btn kk-confirm-cancel"></button>
                    <button type="button" class="kk-confirm-btn kk-confirm-ok${danger ? ' kk-confirm-danger' : ''}"></button>
                </div>
            </div>`;
        (overlay.querySelector('.kk-confirm-title') as HTMLElement).textContent = title;
        (overlay.querySelector('.kk-confirm-msg') as HTMLElement).textContent = message;
        const cancelBtn = overlay.querySelector('.kk-confirm-cancel') as HTMLButtonElement;
        const okBtn = overlay.querySelector('.kk-confirm-ok') as HTMLButtonElement;
        cancelBtn.textContent = cancelLabel;
        okBtn.textContent = confirmLabel;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('kk-confirm-in'));
        okBtn.focus();

        const cleanup = (result: boolean) => {
            document.removeEventListener('keydown', onKey);
            overlay.classList.remove('kk-confirm-in');
            overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            setTimeout(() => overlay.remove(), 300);
            resolve(result);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') cleanup(false);
            else if (e.key === 'Enter') cleanup(true);
        };

        cancelBtn.addEventListener('click', () => cleanup(false));
        okBtn.addEventListener('click', () => cleanup(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
        document.addEventListener('keydown', onKey);
    });
}
