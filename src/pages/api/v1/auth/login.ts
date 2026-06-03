import type { APIRoute } from 'astro';
import { createAnonClient } from '../../../../lib/supabase';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData: FormData = await request.formData();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return redirect('/admin/login?error=Please+fill+in+all+fields');
  }

  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    return redirect('/admin/login?error=Invalid+email+or+password');
  }

  const cookieOptions = {
    httpOnly: true,
    secure: import.meta.env.PROD,
    path: '/',
    sameSite: 'lax' as const,
  };

  cookies.set('sb-access-token', data.session.access_token, {
    ...cookieOptions,
    maxAge: 60 * 60, // 1 hour
  });

  cookies.set('sb-refresh-token', data.session.refresh_token, {
    ...cookieOptions,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return redirect('/admin');
};

