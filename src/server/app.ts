import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AIService } from '../services/ai.service.js';
import { N8nService } from '../services/n8n.service.js';
import { DbService } from '../services/db.service.js';
import authRoutes from '../controllers/auth.controller.js';
import billingRoutes from '../controllers/billing.controller.js';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: true });

  const aiService = AIService.getInstance();
  const n8nService = N8nService.getInstance();

  // Register Middleware
  await fastify.register(import('../middleware/auth.js'));
  await fastify.register(import('fastify-raw-body'), {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  });

  await fastify.register(authRoutes, { prefix: '/api/v1' });
  await fastify.register(billingRoutes, { prefix: '/api/v1/billing' });

  // Global Error Handler
  fastify.setErrorHandler(async (error, request, reply) => {
    request.log.error(error);
    const accept = request.headers['accept'] || '';
    if (accept.includes('text/html')) {
       const { getErrorPageHtml } = await import('../ui/error-page.js');
       const html = getErrorPageHtml({
         title: 'Engine Failure',
         message: (error as Error).message || 'An unexpected error occurred in the orchestrator.',
         code: (error as any).code || 'ERR_INTERNAL_SERVER',
         retryUrl: '/'
       });
       return reply.type('text/html').code(reply.statusCode || 500).send(html);
    }
    return reply.send(error);
  });

  // 404 Handler
  fastify.setNotFoundHandler(async (request, reply) => {
    const accept = request.headers['accept'] || '';
    if (accept.includes('text/html')) {
       const { getErrorPageHtml } = await import('../ui/error-page.js');
       const html = getErrorPageHtml({
         title: 'Coordinate Not Found',
         message: 'The requested path does not exist in the current workspace.',
         code: 'ERR_NOT_FOUND',
         retryUrl: '/api/v1/billing'
       });
       return reply.type('text/html').code(404).send(html);
    }
    return reply.code(404).send({ error: 'Not Found' });
  });

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
