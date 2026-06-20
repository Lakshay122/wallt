import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ message: 'Logout successful' });

  // Clear cookies by setting expired dates
  response.cookies.set({
    name: 'accessToken',
    value: '',
    httpOnly: true,
    expires: new Date(0),
    path: '/',
  });

  response.cookies.set({
    name: 'refreshToken',
    value: '',
    httpOnly: true,
    expires: new Date(0),
    path: '/',
  });

  return response;
}
