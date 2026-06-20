import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { esClient, TICKET_INDEX } from '@/lib/elasticsearch';
// @ts-ignore
import { Client } from '@elastic/elasticsearch';

export async function GET(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Tenant missing' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';
    const type = searchParams.get('type') || 'search'; // 'search' or 'suggest'

    if (!query) {
      return NextResponse.json({ success: true, tickets: [], source: 'empty' });
    }

    // Fallback: If Elasticsearch client is not configured, query database using Prisma
    if (!esClient) {
      console.warn('⚠️ Elasticsearch not configured. Falling back to Prisma database search.');
      
      const dbTickets = await prisma.ticket.findMany({
        where: {
          tenantId,
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } }
          ],
        },
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true } },
        }
      });

      return NextResponse.json({
        success: true,
        tickets: dbTickets.map(t => ({
          ticketId: t.id,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          createdAt: t.createdAt,
          assignedTo: t.assignedTo,
          creator: t.creator,
        })),
        source: 'database_fallback',
      });
    }

    const client: Client = esClient;

    if (type === 'suggest') {
      // Autocomplete Suggestions: match prefix query with strict tenant isolation filter (v7 body wrapping)
      const result = await client.search({
        index: TICKET_INDEX,
        body: {
          query: {
            bool: {
              must: [
                { term: { tenantId } },
                { match_phrase_prefix: { title: query } }
              ]
            }
          }
        },
        size: 5
      });

      const hits = result.body.hits.hits.map((hit: any) => ({
        ticketId: hit._source.ticketId,
        title: hit._source.title,
      }));

      return NextResponse.json({ success: true, tickets: hits, source: 'elasticsearch' });
    } 
    
    else {
      // Fuzzy Full-Text search: searching title, description, and nested replies with tenant isolation (v7 body wrapping)
      const result = await client.search({
        index: TICKET_INDEX,
        body: {
          query: {
            bool: {
              must: [
                { term: { tenantId } },
                {
                  bool: {
                    should: [
                      { match: { title: { query, fuzziness: 'AUTO' } } },
                      { match: { description: { query, fuzziness: 'AUTO' } } },
                      {
                        nested: {
                          path: 'replies',
                          query: {
                            match: { 'replies.content': { query, fuzziness: 'AUTO' } }
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        },
        size: 20
      });

      const hits = result.body.hits.hits.map((hit: any) => ({
        ticketId: hit._source.ticketId,
        title: hit._source.title,
        description: hit._source.description,
        status: hit._source.status,
        priority: hit._source.priority,
        createdAt: hit._source.createdAt,
      }));

      return NextResponse.json({ success: true, tickets: hits, source: 'elasticsearch' });
    }

  } catch (error: any) {
    console.error('🔴 Search API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
