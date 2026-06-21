import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { jwtVerify } from 'jose';
import amqp from 'amqplib';

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Adjust to your frontend domain in production
    methods: ['GET', 'POST'],
  },
});

const SOCKET_PORT = process.env.SOCKET_PORT || 3001;
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-jwt-secret-key-at-least-32-chars-long-12345678'
);
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE_NAME = 'helpdesk.events';
const SOCKET_QUEUE_NAME = 'helpdesk.socket_queue';

// Middleware to authenticate socket connection via JWT token passed in auth or query params
io.use(async (socket, next) => {
  console.log(`🔌 [Socket.IO Middleware] Received connection request. Headers:`, JSON.stringify(socket.handshake.headers));
  try {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) {
      console.warn('⚠️ [Socket.IO Auth] Connection rejected: Token is missing from handshake auth/query.');
      return next(new Error('Authentication error: Token missing'));
    }

    console.log('🔌 [Socket.IO Auth] Attempting JWT verification...');
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload || !payload.tenantId) {
      console.warn('⚠️ [Socket.IO Auth] Connection rejected: Token verified but tenantId is missing in payload.');
      return next(new Error('Authentication error: Invalid token'));
    }

    console.log(`✅ [Socket.IO Auth] Authentication successful! User: ${payload.userId}, Tenant: ${payload.tenantId}`);
    socket.data = {
      userId: payload.userId,
      role: payload.role,
      tenantId: payload.tenantId,
    };
    next();
  } catch (err: any) {
    console.error('🔴 [Socket.IO Auth] JWT verification failed:', err.message || err);
    return next(new Error('Authentication error: Invalid or expired token'));
  }
});

// Helper to broadcast active users in a ticket room
async function broadcastActiveUsers(ticketId: string) {
  const ticketRoom = `ticket:${ticketId}`;
  try {
    const sockets = await io.in(ticketRoom).fetchSockets();
    
    // Deduplicate by userId in case the same user has multiple tabs open
    const uniqueUsers = new Map();
    for (const s of sockets) {
      if (s.data.userId && s.data.userName) {
        uniqueUsers.set(s.data.userId, {
          userId: s.data.userId,
          name: s.data.userName,
          role: s.data.role,
        });
      }
    }

    const activeUsers = Array.from(uniqueUsers.values());
    io.to(ticketRoom).emit('ticket:active_users', activeUsers);
    console.log(`📢 Broadcasted active users for ticket ${ticketId}:`, activeUsers.map(u => u.name));
  } catch (err) {
    console.error(`Error broadcasting active users for ticket ${ticketId}:`, err);
  }
}

io.on('connection', (socket) => {
  const { tenantId, userId, role } = socket.data;
  console.log(`🔌 Client connected: User ${userId} (Role: ${role}) under Tenant ${tenantId}`);

  // Allow joining specific ticket-scoped rooms
  socket.on('ticket:join', async (data: string | { ticketId: string; userName: string }) => {
    // Handle both old string format and new object format for backward compatibility
    let ticketId = '';
    let userName = 'Active Agent';

    if (typeof data === 'string') {
      ticketId = data;
    } else {
      ticketId = data.ticketId;
      userName = data.userName;
    }

    const ticketRoom = `ticket:${ticketId}`;
    socket.join(ticketRoom);
    socket.data.userName = userName;
    socket.data.activeTicketId = ticketId;
    console.log(`   User ${userId} (${userName}) joined ticket room: ${ticketRoom}`);

    // Broadcast the updated list of active users to everyone in the room
    await broadcastActiveUsers(ticketId);
  });

  socket.on('ticket:leave', async (ticketId: string) => {
    const ticketRoom = `ticket:${ticketId}`;
    socket.leave(ticketRoom);
    socket.data.activeTicketId = undefined;
    console.log(`   User ${userId} left ticket room: ${ticketRoom}`);

    // Broadcast the updated list of active users
    await broadcastActiveUsers(ticketId);
  });

  socket.on('disconnect', async () => {
    console.log(`🔌 Client disconnected: User ${userId}`);
    const ticketId = socket.data.activeTicketId;
    if (ticketId) {
      await broadcastActiveUsers(ticketId);
    }
  });
});

async function startRabbitMQListener() {
  try {
    console.log('🔄 Connecting RabbitMQ for Socket.IO updates...');
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Assert exchange
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

    // Assert exclusive queue for this socket instance
    const q = await channel.assertQueue(SOCKET_QUEUE_NAME, {
      durable: true,
    });

    // Bind only to ticket updates and replies (no dashboard/tenant events)
    await channel.bindQueue(q.queue, EXCHANGE_NAME, 'ticket.updated');
    await channel.bindQueue(q.queue, EXCHANGE_NAME, 'reply.created');

    console.log(`🟢 RabbitMQ Socket listener bound. Queue: ${q.queue}`);

    channel.consume(q.queue, (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      const content = msg.content.toString();

      try {
        const payload = JSON.parse(content);
        const tenantId = payload.tenantId;

        if (tenantId) {
          if (routingKey === 'ticket.updated') {
            // Broadcast only to the specific ticket-scoped room
            const ticketId = payload.ticketId;
            if (ticketId) {
              io.to(`ticket:${ticketId}`).emit('ticket:updated', payload);
              console.log(`📢 Broadcasted ticket:updated to ticket:${ticketId}`);
            }
          } else if (routingKey === 'reply.created') {
            // Broadcast to the ticket-specific room
            const ticketId = payload.ticketId;
            if (ticketId) {
              io.to(`ticket:${ticketId}`).emit('reply:created', payload);
              console.log(`📢 Broadcasted reply:created to ticket:${ticketId}`);
            }
          }
        }
        channel.ack(msg);
      } catch (err) {
        console.error('🔴 Failed to process RabbitMQ event for Socket.IO:', err);
        channel.ack(msg);
      }
    });

  } catch (error) {
    console.error('🔴 RabbitMQ Socket listener crashed during initialization:', error);
  }
}

server.listen(SOCKET_PORT, () => {
  console.log(`🚀 Socket.IO Server running on port ${SOCKET_PORT}`);
  startRabbitMQListener();
});
