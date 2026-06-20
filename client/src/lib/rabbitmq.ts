import amqp from 'amqplib';

let connection: any = null;
let channel: any = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE_NAME = 'helpdesk.events';

async function initRabbitMQ() {
  if (connection && channel) return { connection, channel };

  try {
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    // Declare topic exchange
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
    
    console.log('🟢 Connected to RabbitMQ successfully.');
    return { connection, channel };
  } catch (error) {
    console.error('🔴 RabbitMQ initialization error:', error);
    throw error;
  }
}

export async function publishEvent(routingKey: string, payload: any): Promise<boolean> {
  try {
    const { channel } = await initRabbitMQ();
    const msgBuffer = Buffer.from(JSON.stringify(payload));
    
    const published = channel.publish(EXCHANGE_NAME, routingKey, msgBuffer, {
      persistent: true,
      headers: {
        'x-retry-count': 0,
      },
    });

    if (published) {
      console.log(`[RabbitMQ] Published event: ${routingKey}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`[RabbitMQ] Failed to publish event: ${routingKey}`, error);
    return false;
  }
}
