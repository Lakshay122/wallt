// @ts-ignore
import { Client } from '@elastic/elasticsearch';


const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
export const TICKET_INDEX = 'tickets';

// Graceful client setup. If URL is missing or connection fails, we log it but don't crash the server bootstrap.
let esClient: Client | null = null;

if (process.env.ELASTICSEARCH_URL) {
  try {
    esClient = new Client({ node: ELASTICSEARCH_URL });
  } catch (err) {
    console.error('🔴 Failed to initialize Elasticsearch client:', err);
  }
}

export { esClient };

export async function initElasticsearch() {
  if (!esClient) {
    console.warn('⚠️ Elasticsearch is not configured or client is not initialized. Skipping index initialization.');
    return;
  }

  try {
    const indexExists = await esClient.indices.exists({ index: TICKET_INDEX });
    // In v7, the check returns result in a body property (indexExists.body)
    const exists = typeof indexExists === 'boolean' ? indexExists : (indexExists as any).body;

    if (!exists) {
      console.log(`🔄 Creating Elasticsearch index "${TICKET_INDEX}"...`);
      await esClient.indices.create({
        index: TICKET_INDEX,
        body: {
          settings: {
            analysis: {
              analyzer: {
                autocomplete_analyzer: {
                  type: 'custom',
                  tokenizer: 'autocomplete_tokenizer',
                  filter: ['lowercase'],
                },
                search_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase'],
                },
              },
              tokenizer: {
                autocomplete_tokenizer: {
                  type: 'edge_ngram',
                  min_gram: 2,
                  max_gram: 20,
                  token_chars: ['letter', 'digit'],
                },
              },
            },
          },
          mappings: {
            properties: {
              ticketId: { type: 'keyword' },
              tenantId: { type: 'keyword' }, // Multi-tenant isolation boundary
              title: { 
                type: 'text', 
                analyzer: 'autocomplete_analyzer', 
                search_analyzer: 'search_analyzer' 
              },
              description: { type: 'text' },
              status: { type: 'keyword' },
              priority: { type: 'keyword' },
              assignedToId: { type: 'keyword' },
              createdById: { type: 'keyword' },
              createdAt: { type: 'date' },
              updatedAt: { type: 'date' },
              suggest: { type: 'completion' },
              replies: {
                type: 'nested',
                properties: {
                  replyId: { type: 'keyword' },
                  content: { type: 'text' },
                  createdById: { type: 'keyword' },
                  createdAt: { type: 'date' },
                },
              },
            },
          },
        },
      });
      console.log(`🟢 Elasticsearch index "${TICKET_INDEX}" created successfully.`);
    } else {
      console.log(`ℹ️ Elasticsearch index "${TICKET_INDEX}" already exists.`);
    }
  } catch (err: any) {
    console.error('🔴 Failed to configure Elasticsearch indices:', err.message || err);
  }
}
