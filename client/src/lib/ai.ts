import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';

// Retrieve API keys from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';

// Initialize clients if API keys are present
let geminiClient: GoogleGenAI | null = null;
if (GEMINI_API_KEY) {
  try {
    geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  } catch (err) {
    console.error('Failed to initialize Gemini Client:', err);
  }
}

let groqClient: Groq | null = null;
if (GROQ_API_KEY) {
  try {
    groqClient = new Groq({ apiKey: GROQ_API_KEY });
  } catch (err) {
    console.error('Failed to initialize Groq Client:', err);
  }
}

/**
 * Builds a structured prompt for the AI suggestion engine using the ticket context.
 */
function buildPrompt(ticketTitle: string, ticketDescription: string, replies: { content: string; userRole?: string; userName?: string }[]): string {
  const formattedReplies = replies
    .map(r => `[${r.userRole || 'AGENT'} - ${r.userName || 'Unknown'}]: ${r.content}`)
    .join('\n');

  return `You are an expert customer support agent assistant. Your goal is to draft a professional, concise, and helpful response/reply to the customer's ticket.

Ticket Details:
- **Title:** ${ticketTitle}
- **Description:** ${ticketDescription}

Recent Conversation History:
${formattedReplies || 'No replies yet.'}

Draft a response that addresses the ticket's current state. Do not include signature blocks, placeholders (like [Your Name]), or metadata. Start drafting the reply directly.`;
}

/**
 * Streams suggestions sequentially through Gemini, Groq, and Nvidia DeepSeek as fallbacks.
 * Yields text tokens.
 */
export async function* getAiSuggestionStream(
  ticketTitle: string,
  ticketDescription: string,
  replies: { content: string; userRole?: string; userName?: string }[]
): AsyncGenerator<string, void, unknown> {
  const prompt = buildPrompt(ticketTitle, ticketDescription, replies);
  let triedPrimary = false;
  let triedSecondary = false;

  // 1. Try Gemini (Primary)
  if (geminiClient) {
    try {
      triedPrimary = true;
      console.log('🤖 Attempting suggestion generation with Gemini (Primary)...');
      
      const responseStream = await geminiClient.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      for await (const chunk of responseStream) {
        const text = chunk.text || '';
        if (text) {
          yield text;
        }
      }
      return; // Success, terminate generator
    } catch (error: any) {
      console.error('⚠️ Gemini generation failed, falling back to Groq. Error:', error.message || error);
    }
  } else {
    console.log('⚠️ Gemini API key not found. Skipping to Groq...');
  }

  // 2. Try Groq (Secondary)
  if (groqClient) {
    try {
      triedSecondary = true;
      console.log('🤖 Attempting suggestion generation with Groq / Llama (Secondary)...');
      
      const stream = await groqClient.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
        stream: true,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) {
          yield text;
        }
      }
      return; // Success, terminate generator
    } catch (error: any) {
      console.error('⚠️ Groq generation failed, falling back to Nvidia DeepSeek. Error:', error.message || error);
    }
  } else {
    console.log('⚠️ Groq API key not found. Skipping to Nvidia DeepSeek...');
  }

  // 3. Try Nvidia DeepSeek (Tertiary)
  if (NVIDIA_API_KEY) {
    try {
      console.log('🤖 Attempting suggestion generation with Nvidia DeepSeek (Tertiary)...');

      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-ai/deepseek-r1',
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Nvidia API responded with status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Nvidia stream body reader not available.');
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last partial line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanedLine = line.trim();
          if (!cleanedLine || cleanedLine === 'data: [DONE]') continue;

          if (cleanedLine.startsWith('data: ')) {
            try {
              const data = JSON.parse(cleanedLine.substring(6));
              const text = data.choices?.[0]?.delta?.content || '';
              if (text) {
                yield text;
              }
            } catch (jsonErr) {
              // Ignore line parsing error for incomplete chunks
            }
          }
        }
      }
      return; // Success, terminate generator
    } catch (error: any) {
      console.error('⚠️ Nvidia DeepSeek generation failed. Error:', error.message || error);
    }
  } else {
    console.log('⚠️ Nvidia API key not found. All providers exhausted.');
  }

  // Final Fallback if all models failed or keys were missing: stream a friendly working message instead of throwing a hard error.
  yield "Please don't use this option right now, we are working on this";
}
