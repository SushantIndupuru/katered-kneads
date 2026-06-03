import { defineMiddleware } from 'astro:middleware';
import { createAnonClient } from './lib/supabase';

function isAdminRoute(pathname: string) {
  // Match /admin, /admin/, /admin/anything — but NOT /admin/login[/]
  const normalized = pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
  if (normalized === '/admin/login') return false;
  return normalized === '/admin' || normalized.startsWith('/admin/');
}

function isLoginRoute(pathname: string) {
  const normalized = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return normalized === '/admin/login';
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Protect all /admin routes except /admin/login
  if (isAdminRoute(pathname)) {
    const accessToken = context.cookies.get('sb-access-token')?.value;

    if (!accessToken) {
      return context.redirect('/admin/login');
    }

    // Verify the token with Supabase
    const supabase = createAnonClient();
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      context.cookies.delete('sb-access-token', { path: '/' });
      context.cookies.delete('sb-refresh-token', { path: '/' });
      return context.redirect('/admin/login');
    }

    (context.locals as Record<string, unknown>).user = user;
  }

  // Redirect already-logged-in users away from login page
  if (isLoginRoute(pathname)) {
    const accessToken = context.cookies.get('sb-access-token')?.value;
    if (accessToken) {
      const supabase = createAnonClient();
      const { data: { user } } = await supabase.auth.getUser(accessToken);
      if (user) return context.redirect('/admin');
    }
  }

  return next();
});
