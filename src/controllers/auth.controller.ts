import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { DbService } from '../services/db.service.js';
import crypto from 'crypto';
import { getLoginPageHtml } from '../ui/login-page.js';
import { getSignupPageHtml } from '../ui/signup-page.js';

const authRoutes: FastifyPluginAsync = async (fastify, opts) => {
  console.log('🔌 Registering Auth Routes...');
  const db = DbService.getInstance();

  // Helper to hash keys
  const hashKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

  // 1. Login Page (Hosted UI)
  fastify.get('/auth/login', async (request, reply) => {
    const { redirect_port } = request.query as { redirect_port?: string };
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
    const redirectUrl = redirect_port ? `http://localhost:${redirect_port}/callback` : '';

    const html = getLoginPageHtml(supabaseUrl, supabaseKey, redirectUrl);
    reply.type('text/html').send(html);
  });

  // 2. Signup Page (Hosted UI)
  fastify.get('/auth/signup', async (request, reply) => {
    const { redirect_port } = request.query as { redirect_port?: string };
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
    const redirectUrl = redirect_port ? `http://localhost:${redirect_port}/callback` : '';

    const html = getSignupPageHtml(supabaseUrl, supabaseKey, redirectUrl);
    reply.type('text/html').send(html);
  });

  fastify.post('/keys', async (request, reply) => {
    // Auth middleware ensures request.user is set if Bearer token was valid
    if (!request.user || !request.user.id) {
       return reply.code(401).send({ error: 'Unauthorized' });
    }

    const key = `n8k_${crypto.randomBytes(24).toString('hex')}`;
    return { key };
  });
};

export default authRoutes;
