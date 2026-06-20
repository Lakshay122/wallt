import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as signupHandler } from '@/app/api/auth/signup/route';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';

// Setup fallback environment secrets for test runs
process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars-long-123456';
process.env.JWT_ACCESS_MAX_AGE = '900';
process.env.JWT_REFRESH_MAX_AGE = '604800';

const mockTx = {
  tenant: {
    create: vi.fn(),
  },
  user: {
    create: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      tenant: {
        create: vi.fn(),
      },
      $transaction: vi.fn((cb) => cb(mockTx)),
    },
  };
});

import { prisma as prismaMock } from '@/lib/prisma';

describe('🔑 Multi-Tenant Authentication Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/auth/signup', () => {
    it('should return 400 if required fields are missing', async () => {
      const req = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email: 'test@example.com' }), // missing other fields
      });

      const res = await signupHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Missing required fields');
    });

    it('should hash the password and create tenant and user in a transaction', async () => {
      // Mock user not existing
      (prismaMock.user.findUnique as any).mockResolvedValue(null);

      // Mock transaction returns
      const mockTenant = { id: 'tenant-123', name: 'Acme Corp' };
      const mockUser = { id: 'user-123', email: 'admin@acme.com', name: 'Admin User', role: 'ADMIN' };
      mockTx.tenant.create.mockResolvedValue(mockTenant);
      mockTx.user.create.mockResolvedValue(mockUser);

      const req = new NextRequest('http://localhost/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          tenantName: 'Acme Corp',
          name: 'Admin User',
          email: 'admin@acme.com',
          password: 'securePassword123',
        }),
      });

      const res = await signupHandler(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.message).toBe('Signup successful');
      expect(data.user.tenant.id).toBe('tenant-123');

      // Assert password hashing was performed
      expect(mockTx.user.create).toHaveBeenCalled();
      const createArgs = mockTx.user.create.mock.calls[0][0].data;
      expect(createArgs.password).not.toBe('securePassword123');
      const isHashValid = await bcrypt.compare('securePassword123', createArgs.password);
      expect(isHashValid).toBe(true);

      // Verify auth cookies are generated and attached to response
      const accessCookie = res.cookies.get('accessToken');
      const refreshCookie = res.cookies.get('refreshToken');
      expect(accessCookie).toBeDefined();
      expect(refreshCookie).toBeDefined();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should authenticate existing active user and set cookies', async () => {
      const hashedPassword = await bcrypt.hash('validPassword', 10);
      const mockUser = {
        id: 'user-123',
        email: 'agent@acme.com',
        name: 'Agent User',
        password: hashedPassword,
        role: 'AGENT',
        tenantId: 'tenant-123',
        isActive: true,
        tenant: { id: 'tenant-123', name: 'Acme Corp' },
      };

      (prismaMock.user.findUnique as any).mockResolvedValue(mockUser);

      const req = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'agent@acme.com',
          password: 'validPassword',
        }),
      });

      const res = await loginHandler(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.message).toBe('Login successful');
      expect(data.user.role).toBe('AGENT');

      const accessCookie = res.cookies.get('accessToken');
      expect(accessCookie).toBeDefined();
    });

    it('should reject login for inactive users with 403 status', async () => {
      const mockUser = {
        id: 'user-disabled',
        email: 'disabled@acme.com',
        isActive: false, // Inactive user
      };

      (prismaMock.user.findUnique as any).mockResolvedValue(mockUser);

      const req = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'disabled@acme.com',
          password: 'somePassword',
        }),
      });

      const res = await loginHandler(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toContain('inactive');
    });
  });
});
