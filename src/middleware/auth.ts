import fp from 'fastify-plugin';
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { DbService } from '../services/db.service.js';

interface AuthPluginOptions {
  // Add options if needed
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email?: string;
      credits: number;
    };
  }
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const db = DbService.getInstance();

  fastify.decorateRequest('user', null as any);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    
    // 1. Identify Tokens / Keys
    const apiKey = request.headers['x-api-key'] as string;
    const authHeader = request.headers['authorization'];
    const queryToken = (request.query as any).access_token;
    const token = (authHeader && authHeader.startsWith('Bearer ')) ? authHeader.substring(7) : queryToken;

    // 2. Public Path Detection
    const publicPaths = [
      '/health',
      '/api/v1/auth/login',
      '/api/v1/auth/signup',
      '/api/v1/auth/callback',
      '/api/v1/auth/logout',
      '/api/v1/models',
      '/api/v1/billing/webhook',
      '/api/v1/billing'
    ];
    const isPublic = publicPaths.some(path => url.pathname === path || url.pathname.startsWith(path + '/'));

    // 3. Try Authenticating (Bearer Token)
    if (token) {
      try {
        const { data: { user }, error } = await db.client.auth.getUser(token);
        if (user && !error) {
          request.user = { id: user.id, email: user.email, credits: 0 };
          return;
        }
      } catch (err) {
        // Continue to other methods
      }
    }

    // 4. Try Authenticating (API Key)
    if (apiKey) {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
        if (apiKey === 'dev-key-123') {
          request.user = { id: 'dev-user', email: 'dev@n8m.io', credits: 999 };
          return;
        }
      } else {
        const crypto = await import('crypto');
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const { data: keyRecord } = await db.client
          .from('api_keys')
          .select('*, profiles(credits)')
          .eq('key_hash', keyHash)
          .eq('is_active', true)
          .single();

        if (keyRecord) {
          request.user = { id: keyRecord.user_id, email: 'managed-key@n8m.io', credits: keyRecord.profiles?.credits || 0 };
          return;
        }
      }
    }

    // 5. Final fallback for Public/Shim paths
    if (isPublic) {
      const isShim = db.getIsShim() || url.searchParams.get('mock') === 'true' || url.searchParams.get('guest') === 'true';
      if (isShim) {
        request.user = { id: 'shim-user', email: 'guest@n8m.io', credits: 42 };
      }
      return;
    }

    // 6. Access Denied
    const accept = request.headers['accept'] || '';
    if (accept.includes('text/html')) {
        const { getErrorPageHtml } = await import('../ui/error-page.js');
        const html = getErrorPageHtml({
            title: 'Authentication Required',
            message: 'You must be logged in to access this resource. Your session may have expired or is invalid.',
            code: 'ERR_UNAUTHORIZED',
            retryUrl: '/api/v1/auth/login'
        });
        return reply.type('text/html').code(401).send(html);
    }

    return reply.code(401).send({ error: 'Unauthorized Session or API Key' });
  });
};

export default fp(authPlugin);
