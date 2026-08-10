import { defineMiddleware } from 'astro:middleware';
import { createAnonClient } from './lib/supabase';
import type { User } from '@supabase/supabase-js';

function stripTrailingSlash(pathname: string) {
  return pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
}

function isAdminRoute(pathname: string) {
  // Match /admin, /admin/, /admin/anything — but NOT /admin/login[/]
  const normalized = stripTrailingSlash(pathname);
  if (normalized === '/admin/login') return false;
  return normalized === '/admin' || normalized.startsWith('/admin/');
}

function isLoginRoute(pathname: string) {
  return stripTrailingSlash(pathname) === '/admin/login';
}

// Public API endpoints — everything customer-facing or called by an external
// service (Stripe) that can't present an admin session. This is an explicit
// allowlist: any /api route NOT listed here is treated as admin-only (deny by
// default), so new endpoints are protected automatically.
function isPublicApiRoute(pathname: string) {
  const p = stripTrailingSlash(pathname);
  return (
    p === '/api/v1/auth/login' ||
    p === '/api/v1/auth/logout' ||
    p === '/api/v1/checkout' ||
    p === '/api/v1/catering/quote' ||
    p.startsWith('/api/v1/catering/pay/') ||
    p === '/api/v1/coupons/validate' ||
    p === '/api/v1/sms-signup' ||
    p === '/api/v1/stripe/webhook' ||
    // Customer pays an in-person QR order on their own phone (no admin session).
    p.startsWith('/api/v1/pay/')
  );
}

// Any /api route that isn't explicitly public requires an authenticated admin.
function isProtectedApiRoute(pathname: string) {
  const p = stripTrailingSlash(pathname);
  if (!p.startsWith('/api/')) return false;
  return !isPublicApiRoute(p);
}

// Verifies the Supabase access token cookie. Returns the user, or null when the
// token is missing/invalid.
async function getUserFromCookies(
  cookies: { get: (name: string) => { value: string } | undefined },
): Promise<User | null> {
  const accessToken = cookies.get('sb-access-token')?.value;
  if (!accessToken) return null;
  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Protect admin API routes: no auth → 401 JSON (never a redirect, since the
  // caller is fetch()/an integration, not a browser navigation).
  if (isProtectedApiRoute(pathname)) {
    const user = await getUserFromCookies(context.cookies);
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    (context.locals as Record<string, unknown>).user = user;
    return next();
  }

  // Protect all /admin page routes except /admin/login
  if (isAdminRoute(pathname)) {
    const user = await getUserFromCookies(context.cookies);
    if (!user) {
      // Clear any stale tokens so a bad session doesn't loop.
      context.cookies.delete('sb-access-token', { path: '/' });
      context.cookies.delete('sb-refresh-token', { path: '/' });
      return context.redirect('/admin/login');
    }
    (context.locals as Record<string, unknown>).user = user;
  }

  // Redirect already-logged-in users away from login page
  if (isLoginRoute(pathname)) {
    const user = await getUserFromCookies(context.cookies);
    if (user) return context.redirect('/admin');
  }

  return next();
});
