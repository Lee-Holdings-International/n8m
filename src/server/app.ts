import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../services/ai.service.js';
import { N8nService } from '../services/n8n.service.js';
import { DbService } from '../services/db.service.js';
import authRoutes from '../controllers/auth.controller.js';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true });

  const aiService = AIService.getInstance();
  const n8nService = N8nService.getInstance();

  // Register Middleware
  await fastify.register(import('../middleware/auth.js'));
  await fastify.register(authRoutes, { prefix: '/api/v1' });

  // Public Balance check
  fastify.get('/api/v1/balance', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) return { credits: 0 };
    const credits = await DbService.getInstance().getCredits(request.user.id);
    return { credits };
  });

  // Deploy Workflow - REMOVED (Client-side only now)
  // fastify.post('/api/v1/deploy', ...);

  // Generate Workflow
  fastify.post('/api/v1/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { prompt } = request.body as { prompt: string };
    const db = DbService.getInstance();
    
    // Check Credits
    if (request.user) {
       const credits = await db.getCredits(request.user.id);
       if (credits < 1) {
          return reply.status(402).send({ error: 'Insufficient credits. Please top up.' });
       }
    }

    try {
      // Note: Gemini 1.5 Flash is fast (<60s usually), fitting Vercel functions.
      const { workflow } = await aiService.generateWorkflow(prompt);
      
      // Deduct Credit on success
      if (request.user) {
         await db.decrementCredits(request.user.id, 1);
      }
      
      return { workflow };
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({ error: (error as Error).message });
    }
  });

  // Health Check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date(), platform: process.env.VERCEL ? 'vercel' : 'vm' };
  });

  return fastify;
}
