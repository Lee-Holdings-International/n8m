# n8m SaaS Deployment Guide

This guide explains how to host the `n8m` platform for production use.

## Architecture Components

1. **API Server** (`src/server`): The "Control Plane". Needs to run 24/7.
2. **Database**: Supabase (Hosted).
3. **Workflow Engine**: n8n (Hosted).
4. **CLI**: Distributed via NPM to users.

---

## 1. Hosting the API Server (Fastify)

Since our API uses a long-running Fastify server (not serverless functions),
**Railway** or **Render** are the best options. They support Docker/Node.js
processes natively.

### Recommended: Railway.app

1. **Create Project**: Go to [Railway](https://railway.app/) -> "New Project" ->
   "GitHub Repo".
2. **Select Repo**: Choose `n8m`.
3. **Configure Build**:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start:server`
4. **Variables**: Add the production variables (see Step 4).
5. **Domain**: Railway will give you a domain (e.g., `n8m-api.up.railway.app`).

---

## 2. Hosting n8n (The Engine)

You need a public n8n instance that the API can talk to.

### Option A: n8n Cloud (Easiest)

- Sign up at [n8n.io](https://n8n.io).
- Get your URL (`https://<your-instance>.app.n8n.cloud`).
- Create an API Key in n8n Settings.

### Option B: Self-Hosted (Railway)

- In your Railway project, click "New" -> "Template" -> "n8n".
- This spins up n8n with Postgres automatically.

---

## 3. Database (Supabase)

You are likely already using this. Just ensure your **Production** Supabase
URL/Key are used in the Railway environment variables, effectively connecting
your production API to your production DB.

---

## 4. Environment Variables (Production)

Set these in your hosting provider (Railway/Render):

| Variable            | Value                                    |
| ------------------- | ---------------------------------------- |
| `PORT`              | `3000` (or `PORT` provided by host)      |
| `GEMINI_API_KEY`    | Your Production Google AI Key            |
| `N8N_API_URL`       | `https://<your-n8n-instance>/api/v1`     |
| `N8N_API_KEY`       | Your Production n8n API Key              |
| `SUPABASE_URL`      | `https://<project>.supabase.co`          |
| `SUPABASE_ANON_KEY` | Your Production Anon Key                 |
| `HOST`              | `0.0.0.0` (Important for Railway/Docker) |

---

## 5. Publishing the CLI

For users to use `n8m` from anywhere:

1. **Login to NPM**:
   ```bash
   npm login
   ```
2. **Publish**:
   ```bash
   npm publish --access public
   ```
3. **Users Install**:
   ```bash
   npm install -g n8m
   ```

## 6. Testing Production

Once deployed:

1. **Login**:
   ```bash
   # Set the remote API URL via env var or config
   export N8N_API_URL=https://n8m-api.up.railway.app/api/v1 
   n8m login
   ```
2. **Check Balance**:
   ```bash
   n8m balance
   ```
3. **Generate**:
   ```bash
   n8m create "Production test workflow"
   ```
