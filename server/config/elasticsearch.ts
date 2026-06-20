import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';

dotenv.config();

const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
export const TICKET_INDEX = 'tickets';

let esClient: Client | null = null;

if (process.env.ELASTICSEARCH_URL) {
  try {
    esClient = new Client({ node: ELASTICSEARCH_URL });
  } catch (err) {
    console.error('🔴 Failed to initialize Elasticsearch client in server worker:', err);
  }
}

export { esClient };

export async function initElasticsearch() {
  if (!esClient) {
    console.warn('⚠️ ELASTICSEARCH_URL env variable not found. Elasticsearch sync functions will be bypassed.');
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
              tenantId: { type: 'keyword' },
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
      console.log(`🟢 Elasticsearch index "${TICKET_INDEX}" initialized successfully on server.`);
    }
  } catch (err: any) {
    console.error('🔴 Failed to initialize Elasticsearch index in worker:', err.message || err);
  }
}
