import { buildApp } from '../dist/server/app.js';

let fastifyInstance;

export default async function handler(req, res) {
  if (!fastifyInstance) {
    fastifyInstance = await buildApp();
    await fastifyInstance.ready();
  }
  
  fastifyInstance.server.emit('request', req, res);
}
