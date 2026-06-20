import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-jwt-secret-key-at-least-32-chars-long-12345678'
);

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
}

export async function signAccessToken(payload: JWTPayload): Promise<string> {
  const expiresIn = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET);
}

export async function signRefreshToken(payload: JWTPayload): Promise<string> {
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch (error) {
    return null;
  }
}
