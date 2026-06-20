import amqp from 'amqplib';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE_NAME = 'helpdesk.events';
const QUEUE_NAME = 'helpdesk.notification_queue';

const DLX_EXCHANGE = 'helpdesk.events.dlx';
const DLQ_QUEUE = 'helpdesk.notification_queue.dlq';
const DLQ_ROUTING_KEY = 'helpdesk.notification_queue.dlq.routing';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const prisma = new PrismaClient();
let transporter: nodemailer.Transporter;
let isEthereal = false;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || '"Helpdesk SaaS Support" <no-reply@helpdesk-saas.com>';

// Check if email sending is enabled (defaults to true)
const SEND_EMAIL_ENABLED = process.env.SEND_EMAIL_ENABLED !== 'false';

// Initialize SMTP transporter (Real credentials or Ethereal fallback)
async function initMailer() {
  if (transporter) {
    return; // Already initialized
  }

  if (!SEND_EMAIL_ENABLED) {
    console.log('🔕 Email sending is disabled globally via SEND_EMAIL_ENABLED=false. SMTP setup skipped.');
    return;
  }

  try {
    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      console.log(`🔄 Configuring real SMTP mailer using host: ${SMTP_HOST}...`);
      transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465, // True for 465, false for 587/others
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });
      isEthereal = false;
      console.log(`🟢 Real SMTP Mailer ready. Sender: ${SMTP_FROM}`);
    } else {
      console.log('🔄 No SMTP credentials found. Creating Ethereal test SMTP account...');
      const testAccount = await nodemailer.createTestAccount();
      
      transporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      isEthereal = true;
      console.log(`🟢 SMTP Mailer ready (Ethereal Fallback). Test account: ${testAccount.user}`);
    }
  } catch (error) {
    console.error('🔴 Failed to initialize Nodemailer:', error);
    throw error;
  }
}

async function sendMailHelper(options: { to: string; subject: string; html: string }) {
  if (!SEND_EMAIL_ENABLED) {
    console.log(`🔕 Email sending disabled. Skipped sending to: ${options.to}`);
    console.log(`   Subject: "${options.subject}"`);
    return;
  }

  if (!transporter) {
    throw new Error('Mailer not initialized');
  }

  const info = await transporter.sendMail({
    from: SMTP_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });

  console.log(`   ✉️  Email sent to: ${options.to}`);
  
  if (isEthereal) {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`   🔗  Ethereal Preview URL: ${previewUrl}`);
  } else {
    console.log(`   ✅  Email delivered successfully. Message ID: ${info.messageId}`);
  }
}

async function startWorker() {
  try {
    // Initialize Mailer
    await initMailer();

    console.log('🔄 Connecting to RabbitMQ...');
    const connection = await amqp.connect(RABBITMQ_URL);

    connection.on('error', (err) => {
      console.error('🔴 RabbitMQ connection error in Email Worker:', err.message);
    });

    connection.on('close', () => {
      console.warn('🔴 RabbitMQ connection closed in Email Worker. Reconnecting in 5s...');
      setTimeout(startWorker, 5000);
    });

    const channel = await connection.createChannel();

    // 1. Declare Exchanges
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
    await channel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });

    // 2. Declare Queues
    await channel.assertQueue(DLQ_QUEUE, { durable: true });
    await channel.assertQueue(QUEUE_NAME, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX_EXCHANGE,
        'x-dead-letter-routing-key': DLQ_ROUTING_KEY,
      },
    });

    // 3. Bind Queues
    await channel.bindQueue(DLQ_QUEUE, DLX_EXCHANGE, DLQ_ROUTING_KEY);
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'ticket.*');
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'agent.invited');
    await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, 'reply.created');

    console.log(`🟢 Email Worker connected. Listening to exchange "${EXCHANGE_NAME}" via queue "${QUEUE_NAME}"...`);

    // 4. Consume messages
    channel.consume(QUEUE_NAME, async (msg) => {
      if (!msg) return;

      const routingKey = msg.fields.routingKey;
      const content = msg.content.toString();
      let payload: any;

      try {
        payload = JSON.parse(content);
      } catch (e) {
        console.error('🔴 Failed to parse message payload. Sending to DLQ...', e);
        channel.nack(msg, false, false);
        return;
      }

      const headers = msg.properties.headers || {};
      const retryCount = typeof headers['x-retry-count'] === 'number' ? headers['x-retry-count'] : 0;

      try {
        console.log(`📩 Received event "${routingKey}" (Attempt ${retryCount + 1})`);

        // Fetch creator details
        const creator = payload.createdById 
          ? await prisma.user.findUnique({ where: { id: payload.createdById } }) 
          : null;

        // Fetch assignee details
        const assignee = payload.assignedToId 
          ? await prisma.user.findUnique({ where: { id: payload.assignedToId } }) 
          : null;

        if (routingKey === 'ticket.created') {
          // 1. Notify Creator
          if (creator) {
            await sendMailHelper({
              to: creator.email,
              subject: `[Helpdesk] Ticket Received: ${payload.title}`,
              html: `
                <h3>Hello ${creator.name},</h3>
                <p>Your ticket has been successfully created in our system.</p>
                <hr />
                <p><b>Ticket ID:</b> ${payload.ticketId}</p>
                <p><b>Title:</b> ${payload.title}</p>
                <p><b>Priority:</b> ${payload.priority}</p>
                <p><b>Description:</b> ${payload.description}</p>
                <hr />
                <p>Our support team will review it shortly.</p>
              `,
            });
          }

          // 2. Notify Assignee (only if different from Creator)
          if (assignee && payload.assignedToId !== payload.createdById) {
            await sendMailHelper({
              to: assignee.email,
              subject: `[Helpdesk] New Ticket Assigned: ${payload.title}`,
              html: `
                <h3>Hello ${assignee.name},</h3>
                <p>A new support ticket has been assigned to you.</p>
                <hr />
                <p><b>Ticket ID:</b> ${payload.ticketId}</p>
                <p><b>Title:</b> ${payload.title}</p>
                <p><b>Priority:</b> ${payload.priority}</p>
                <p><b>Description:</b> ${payload.description}</p>
                <hr />
                <p>Please review and handle it according to SLA guidelines.</p>
              `,
            });
          }

          // 3. Notify all Admins/Agents of the Tenant if unassigned
          if (!payload.assignedToId) {
            const team = await prisma.user.findMany({
              where: {
                tenantId: payload.tenantId,
                isActive: true,
              },
            });
            const otherTeammates = team.filter((user: any) => user.id !== payload.createdById);
            for (const member of otherTeammates) {
              await sendMailHelper({
                to: member.email,
                subject: `[Helpdesk] Unassigned Ticket Alert: ${payload.title}`,
                html: `
                  <h3>Hello ${member.name},</h3>
                  <p>A new unassigned ticket is available in your tenant queue.</p>
                  <hr />
                  <p><b>Ticket ID:</b> ${payload.ticketId}</p>
                  <p><b>Title:</b> ${payload.title}</p>
                  <p><b>Priority:</b> ${payload.priority}</p>
                  <hr />
                  <p>Log in to assign the ticket to yourself or another team member.</p>
                `,
              });
            }
          }
        } 
        
        else if (routingKey === 'ticket.updated') {
          // Only send email notifications if status or priority changes
          // 1. Notify Assignee (if assigned and not the one who updated)
          if (assignee && payload.updatedById !== payload.assignedToId) {
            await sendMailHelper({
              to: assignee.email,
              subject: `[Helpdesk] Ticket Updated: ${payload.title}`,
              html: `
                <h3>Hello ${assignee.name},</h3>
                <p>The ticket assigned to you has been updated.</p>
                <hr />
                <p><b>Ticket ID:</b> ${payload.ticketId}</p>
                <p><b>Title:</b> ${payload.title}</p>
                <p><b>New Status:</b> ${payload.status}</p>
                <p><b>New Priority:</b> ${payload.priority}</p>
                <hr />
                <p>Please check the portal for further details.</p>
              `,
            });
          }

          // 2. Notify Creator (if creator exists and not the one who updated)
          if (creator && payload.updatedById !== payload.createdById) {
            await sendMailHelper({
              to: creator.email,
              subject: `[Helpdesk] Your Ticket Updated: ${payload.title}`,
              html: `
                <h3>Hello ${creator.name},</h3>
                <p>A ticket you created has been updated.</p>
                <hr />
                <p><b>Ticket ID:</b> ${payload.ticketId}</p>
                <p><b>Title:</b> ${payload.title}</p>
                <p><b>New Status:</b> ${payload.status}</p>
                <p><b>New Priority:</b> ${payload.priority}</p>
                <hr />
                <p>Please check the portal for further details.</p>
              `,
            });
          }
        } 
        
        else if (routingKey === 'agent.invited') {
          // Notify onboarding agent with credentials advice
          await sendMailHelper({
            to: payload.email,
            subject: `[Helpdesk] Workspace Invitation`,
            html: `
              <h3>Welcome to the Team!</h3>
              <p>You have been registered as an agent in the Support Helpdesk workspace.</p>
              <hr />
              <p><b>Name:</b> ${payload.name}</p>
              <p><b>Email:</b> ${payload.email}</p>
              <hr />
              <p>To sign in, please request your workspace credentials from your Tenant Administrator.</p>
            `,
          });
        }
        
        else if (routingKey === 'reply.created') {
          // Fetch ticket details
          const ticket = await prisma.ticket.findUnique({
            where: { id: payload.ticketId },
            include: { creator: true, assignedTo: true }
          });

          if (ticket) {
            // 1. Notify Assignee (if assigned, and assignee is not the commenter)
            if (ticket.assignedTo && ticket.assignedToId !== payload.userId) {
              await sendMailHelper({
                to: ticket.assignedTo.email,
                subject: `[Helpdesk] New Comment on: ${ticket.title}`,
                html: `
                  <h3>Hello ${ticket.assignedTo.name},</h3>
                  <p>A new comment/reply was added to a ticket assigned to you.</p>
                  <hr />
                  <p><b>Ticket:</b> ${ticket.title}</p>
                  <p><b>Author:</b> ${payload.user?.name || 'Someone'}</p>
                  <p><b>Comment:</b> ${payload.content}</p>
                  <hr />
                  <p>Please check the portal for details.</p>
                `,
              });
            }

            // 2. Notify Creator (if creator is not the commenter)
            if (ticket.creator && ticket.createdById !== payload.userId) {
              await sendMailHelper({
                to: ticket.creator.email,
                subject: `[Helpdesk] New Comment on: ${ticket.title}`,
                html: `
                  <h3>Hello ${ticket.creator.name},</h3>
                  <p>A new comment/reply was added to your ticket.</p>
                  <hr />
                  <p><b>Ticket:</b> ${ticket.title}</p>
                  <p><b>Author:</b> ${payload.user?.name || 'Someone'}</p>
                  <p><b>Comment:</b> ${payload.content}</p>
                  <hr />
                  <p>Please check the portal for details.</p>
                `,
              });
            }
          }
        }

        channel.ack(msg);
      } catch (error: any) {
        console.error(`🔴 Error processing event "${routingKey}":`, error.message);

        if (retryCount < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
          console.warn(`⚠️ Retrying event in ${delay}ms... (Remaining attempts: ${MAX_RETRIES - retryCount})`);
          
          await new Promise((resolve) => setTimeout(resolve, delay));

          channel.ack(msg);
          channel.publish(EXCHANGE_NAME, routingKey, Buffer.from(JSON.stringify(payload)), {
            persistent: true,
            headers: {
              ...headers,
              'x-retry-count': retryCount + 1,
            },
          });
        } else {
          console.error(`🚨 Max retries exceeded for event "${routingKey}". Quarantining message to DLQ...`);
          
          // Save to failed notifications table in Prisma
          try {
            await prisma.failedNotification.create({
              data: {
                event: routingKey,
                payload: payload,
                reason: error.message || 'Max retries exceeded',
                tenantId: payload.tenantId,
              },
            });
            console.log('💾 Logged failed notification to PostgreSQL.');
          } catch (dbErr) {
            console.error('🔴 Failed to log failed notification to database:', dbErr);
          }

          channel.nack(msg, false, false);
        }
      }
    });

  } catch (error) {
    console.error('🔴 Email Worker crashed during initialization. Retrying in 5s...', error);
    setTimeout(startWorker, 5000);
  }
}

startWorker();
