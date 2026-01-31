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
      credits: number;
    };
  }
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  const db = DbService.getInstance();

  fastify.decorateRequest('user', null as any);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for health, list models, and login endpoints
    const publicPaths = ['/health', '/api/v1/auth/login', '/api/v1/auth/signup', '/api/v1/auth/callback', '/api/v1/models'];
    if (publicPaths.some(path => request.url.startsWith(path))) {
      return;
    }

    const apiKey = request.headers['x-api-key'] as string;
    const authHeader = request.headers['authorization'];

    // MVP Bypass: If no SUPABASE credentials, allow specific dev key or bypass
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
       // ... existing bypass ...
       if (apiKey === 'dev-key-123') {
        request.user = { id: 'dev-user', credits: 999 };
        return;
      }
    }

    // 1. Bearer Token (JWT from Supabase)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user }, error } = await db.client.auth.getUser(token);
      
      if (error || !user) {
        return reply.code(401).send({ error: 'Invalid Session' });
      }

      // Sync user profile if needed
      // Check credits cache or DB
      request.user = { id: user.id, credits: 0 }; // Default credits? Fetch from profiles
      return;
    }

    // 2. API Key
    if (!apiKey) {
      return reply.code(401).send({ error: 'Missing API Key' });
    }

    // Hash the key for lookup
    const crypto = await import('crypto');
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Real DB Verification
    const { data: keyRecord, error } = await db.client
      .from('api_keys')
      .select('*, profiles(credits)')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single();

    if (keyRecord) {
       request.user = { id: keyRecord.user_id, credits: keyRecord.profiles?.credits || 0 };
       return;
    }
    
    // Fallback: Dev Mode ONLY
    // Only allow 'dev-key-123' if we are NOT in production and database is missing
    const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    if (isDev && apiKey === 'dev-key-123' && (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)) {
       request.log.warn('⚠️ using insecure dev-key-123 bypass');
       request.user = { id: 'dev-user', credits: 999 };
       return;
    }

    return reply.code(401).send({ error: 'Invalid API Key' });
  });
};

export default fp(authPlugin);
