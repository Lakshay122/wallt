import { NextRequest, NextResponse } from 'next/server';
import { getAiSuggestCount } from '@/lib/redis';

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized: Tenant missing' }, { status: 401 });
    }

    const count = await getAiSuggestCount(tenantId);
    return NextResponse.json({ success: true, count, limit: 10 });
  } catch (error: any) {
    console.error('Error fetching AI usage:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
