import { next } from '@vercel/edge';

export const config = {
  matcher: ['/admin', '/admin.html'],
};

export default function middleware(request) {
  const user = process.env.ADMIN_BASIC_USER;
  const pass = process.env.ADMIN_BASIC_PASS;

  // Fail closed: if the env vars aren't configured in Vercel, block access
  // instead of leaving the panel open.
  if (!user || !pass) {
    return new Response('Admin panel is not configured.', { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const expected = 'Basic ' + btoa(`${user}:${pass}`);

  if (authHeader === expected) {
    return next();
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="TU Overlays Admin"' },
  });
}
