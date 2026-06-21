import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAiSuggestionStream } from '@/lib/ai';
import { checkAiSuggestRateLimit, refundAiSuggestRateLimit } from '@/lib/redis';

// GET /api/tickets/[id]/suggest - SSE endpoint for streaming AI ticket reply suggestion
export async function GET(req: NextRequest, { params }: { params: Promise<any> }) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized: Tenant missing' }, { status: 401 });
    }

    // Rate limit check
    const rateLimit = await checkAiSuggestRateLimit(tenantId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: 'AI request limit exceeded. Please try again later.',
        },
        { status: 429 }
      );
    }

    const { id: ticketId } = await params;

    // Fetch ticket and verify tenant isolation
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        tenantId: tenantId,
      },
      include: {
        tenant: {
          select: {
            name: true,
            description: true,
            type: true,
          },
        },
        replies: {
          orderBy: {
            createdAt: 'asc',
          },
          include: {
            user: {
              select: {
                name: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Format recent replies context for the prompt
    const repliesContext = ticket.replies.map(reply => ({
      content: reply.content,
      userRole: reply.user?.role,
      userName: reply.user?.name,
    }));

    // Construct the ReadableStream for Server-Sent Events (SSE)
    const responseStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let succeeded = false;
        try {
          const generator = getAiSuggestionStream(
            ticket.title,
            ticket.description,
            repliesContext,
            ticket.tenant?.name,
            ticket.tenant?.description || undefined,
            ticket.tenant?.type || undefined
          );
          for await (const chunk of generator) {
            if (chunk !== "Please don't use this option right now, we are working on this") {
              succeeded = true;
            }
            console.log(`🤖 SSE Streaming Chunk to Client: "${chunk}"`);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
          }
        } catch (error: any) {
          console.error('🔴 Error in AI stream generator:', error.message || error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message || 'Stream processing failed' })}\n\n`));
        } finally {
          if (!succeeded && rateLimit.token) {
            await refundAiSuggestRateLimit(tenantId, rateLimit.token);
          }
          controller.close();
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: any) {
    console.error('🔴 Suggestion endpoint error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
