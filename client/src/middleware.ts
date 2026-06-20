import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken, signAccessToken } from './lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect client-side /admin route
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const accessToken = request.cookies.get('accessToken')?.value;
    const refreshToken = request.cookies.get('refreshToken')?.value;

    let payload = accessToken ? await verifyToken(accessToken) : null;

    if (!payload && refreshToken) {
      const refreshPayload = await verifyToken(refreshToken);
      if (refreshPayload && refreshPayload.role === 'ADMIN') {
        payload = refreshPayload;
      }
    }

    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Protect all routes starting with /api/tickets, /api/users, /api/admin, or /api/analytics
  if (pathname.startsWith('/api/tickets') || pathname.startsWith('/api/users') || pathname.startsWith('/api/admin') || pathname.startsWith('/api/analytics')) {
    const accessToken = request.cookies.get('accessToken')?.value;
    const refreshToken = request.cookies.get('refreshToken')?.value;

    let payload = accessToken ? await verifyToken(accessToken) : null;

    const responseHeaders = new Headers(request.headers);

    // If access token is expired/invalid/missing, try using refresh token
    if (!payload) {
      if (!refreshToken) {
        return NextResponse.json({ error: 'Unauthorized: Access token missing or invalid' }, { status: 401 });
      }

      const refreshPayload = await verifyToken(refreshToken);
      if (!refreshPayload) {
        return NextResponse.json({ error: 'Unauthorized: Session expired' }, { status: 401 });
      }

      // Generate a new access token
      const newAccessToken = await signAccessToken({
        userId: refreshPayload.userId,
        email: refreshPayload.email,
        role: refreshPayload.role,
        tenantId: refreshPayload.tenantId,
      });

      // Prepare response to propagate headers to route handlers
      responseHeaders.set('x-tenant-id', refreshPayload.tenantId);
      responseHeaders.set('x-user-id', refreshPayload.userId);
      responseHeaders.set('x-user-role', refreshPayload.role);

      const response = NextResponse.next({
        request: {
          headers: responseHeaders,
        },
      });

      // Update the access token cookie in user's browser
      const accessMaxAge = parseInt(process.env.JWT_ACCESS_MAX_AGE || '900', 10);
      response.cookies.set({
        name: 'accessToken',
        value: newAccessToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: accessMaxAge,
        path: '/',
      });

      return response;
    }

    // Access token is valid. Forward info to route handlers.
    responseHeaders.set('x-tenant-id', payload.tenantId);
    responseHeaders.set('x-user-id', payload.userId);
    responseHeaders.set('x-user-role', payload.role);

    return NextResponse.next({
      request: {
        headers: responseHeaders,
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/tickets/:path*', '/api/users/:path*', '/api/admin/:path*', '/api/analytics/:path*', '/admin', '/admin/:path*'],
};
