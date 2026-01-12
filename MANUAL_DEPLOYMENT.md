# Manual Render Deployment Guide

This guide will walk you through deploying the Reedeck backend to Render manually (without using render.yaml).

## Prerequisites

- [ ] Git repository pushed to GitHub/GitLab/Bitbucket
- [ ] Render account created at [render.com](https://render.com)
- [ ] All environment variables ready (see checklist below)

## Step 1: Create Web Service

1. **Go to Render Dashboard**
   - Navigate to [dashboard.render.com](https://dashboard.render.com)
   - Click **"New +"** button in the top right
   - Select **"Web Service"**

2. **Connect Repository**
   - Click **"Connect a repository"** or select your Git provider
   - Authorize Render to access your repositories
   - Find and select your `reedeck-server` repository
   - Click **"Connect"**

3. **Configure Service Settings**

   Fill in the following fields:

   | Field | Value |
   |-------|-------|
   | **Name** | `reedeck-api` (or any name you prefer) |
   | **Region** | Choose closest to your users |
   | **Branch** | `main` (or your default branch) |
   | **Root Directory** | Leave blank |
   | **Environment** | `Node` |
   | **Build Command** | `npm install && npm run build` |
   | **Start Command** | `npm start` |
   | **Plan** | `Starter` ($7/month) or `Free` |

4. **Advanced Settings** (Click "Advanced" button)

   - **Auto-Deploy**: `Yes` (recommended)
   - **Health Check Path**: `/health`
   - **Node Version**: Leave as default or specify if needed

## Step 2: Add Environment Variables

In the **Environment Variables** section, add ALL of the following variables:

### Required Variables

Click **"Add Environment Variable"** for each:

#### Core Configuration
```
NODE_ENV = production
PORT = 10000
```

#### Database & Supabase
```
DATABASE_URL = postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres
SUPABASE_URL = https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY = your_service_role_key_here
```

#### Authentication
```
JWT_SECRET = [generate with: openssl rand -base64 32]
```

#### Stripe
```
STRIPE_SECRET_KEY = sk_test_or_sk_live_your_key
STRIPE_WEBHOOK_SECRET = whsec_your_webhook_secret
```

#### AI Services
```
OPENAI_API_KEY = sk-your_openai_key
GEMINI_API_KEY = your_gemini_key
```

#### Email Service
```
RESEND_API_KEY = re_your_resend_key
```

#### Frontend
```
FRONTEND_URL = https://your-frontend-app.com
```

#### Redis (Optional - for background jobs)
```
REDIS_URL = [leave empty for now, add later if using worker]
```

### How to Get These Values

#### DATABASE_URL (Supabase)
1. Go to Supabase Dashboard → Project Settings → Database
2. Find **"Session Pooler"** connection string (port 5432)
3. Copy the connection string
4. Replace `[YOUR-PASSWORD]` with your actual database password

#### SUPABASE_URL
1. Supabase Dashboard → Settings → API
2. Copy **"Project URL"**

#### SUPABASE_SERVICE_ROLE_KEY
1. Supabase Dashboard → Settings → API
2. Copy **"service_role"** secret (NOT anon public)
3. ⚠️ Keep this secret - it bypasses RLS

#### JWT_SECRET
1. Generate a secure random string:
   ```bash
   openssl rand -base64 32
   ```
2. Copy the output

#### STRIPE_SECRET_KEY
1. Stripe Dashboard → Developers → API keys
2. Copy **"Secret key"** (starts with `sk_test_` or `sk_live_`)

#### STRIPE_WEBHOOK_SECRET
1. We'll get this after deployment when we configure the webhook
2. Leave blank for now, add it in Step 5

#### OPENAI_API_KEY
1. OpenAI Dashboard → API keys
2. Create new secret key or copy existing one

#### GEMINI_API_KEY (Optional)
1. Google AI Studio → Get API key
2. Copy the API key

#### RESEND_API_KEY
1. Resend Dashboard → API Keys
2. Create new API key or copy existing one

#### FRONTEND_URL
1. Your frontend application URL (e.g., Vercel deployment)
2. Format: `https://your-app.vercel.app`

## Step 3: Deploy

1. After adding all environment variables, click **"Create Web Service"**
2. Render will start building your application
3. Monitor the build logs in real-time
4. Wait for the build to complete (usually 3-5 minutes)

### Build Output Should Show:
```
==> Installing dependencies
==> Running 'npm install && npm run build'
> prisma generate
✔ Generated Prisma Client
> tsc
Build complete!
==> Starting service with 'npm start'
Server running on port 10000
```

## Step 4: Verify Deployment

Once deployment is complete, test your API:

1. **Get Your Service URL**
   - In Render Dashboard, find your service URL
   - Format: `https://reedeck-api.onrender.com`

2. **Test Health Endpoint**
   ```bash
   curl https://your-service-name.onrender.com/health
   ```

   Expected response:
   ```json
   {
     "status": "ok",
     "timestamp": "2024-01-12T...",
     "database": "connected"
   }
   ```

3. **Test API Endpoint**
   ```bash
   curl https://your-service-name.onrender.com/api/auth/verify
   ```

## Step 5: Configure Stripe Webhook

After deployment, set up the Stripe webhook:

1. **Get Your Webhook URL**
   ```
   https://your-service-name.onrender.com/api/subscriptions/webhook
   ```

2. **Add Webhook in Stripe**
   - Go to Stripe Dashboard → Developers → Webhooks
   - Click **"Add endpoint"**
   - Enter your webhook URL
   - Select events to listen to:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - Click **"Add endpoint"**

3. **Get Webhook Secret**
   - Click on your newly created webhook
   - Click **"Reveal"** under "Signing secret"
   - Copy the secret (starts with `whsec_`)

4. **Add to Render Environment Variables**
   - Go back to Render Dashboard
   - Navigate to your service → Environment
   - Find `STRIPE_WEBHOOK_SECRET`
   - Paste the webhook secret
   - Click **"Save Changes"**
   - Service will automatically redeploy

## Step 6: Set Up Background Worker (Optional)

If you need background job processing:

1. **Create Redis Instance**
   - In Render Dashboard, click **"New +"**
   - Select **"Redis"**
   - Name: `reedeck-redis`
   - Plan: `Starter` or `Free`
   - Click **"Create Redis"**
   - Copy the **Internal Redis URL**

2. **Update Web Service**
   - Go to your web service → Environment
   - Add or update `REDIS_URL` with the Redis URL
   - Save changes

3. **Create Background Worker**
   - Click **"New +"** → **"Background Worker"**
   - Connect same repository
   - Configure:
     - **Name**: `reedeck-worker`
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `node dist/workers/index.js`
   - Add same environment variables as web service
   - Create worker

## Step 7: Post-Deployment Checks

- [ ] Health endpoint returns `200 OK`
- [ ] Database connection is working
- [ ] Can create a user account (test signup)
- [ ] Can log in
- [ ] Stripe webhook is receiving events
- [ ] CORS is working with frontend
- [ ] All API endpoints are accessible

## Updating Your Deployment

Whenever you push to your main branch, Render will automatically redeploy if you have auto-deploy enabled.

### Manual Deploy
1. Go to Render Dashboard → Your Service
2. Click **"Manual Deploy"** → **"Deploy latest commit"**

### Rollback
1. Go to Render Dashboard → Your Service
2. Click **"Events"** tab
3. Find a previous successful deploy
4. Click **"Rollback to this version"**

## Monitoring & Logs

### View Logs
1. Render Dashboard → Your Service → **"Logs"** tab
2. Real-time logs appear here
3. Use filters to find specific errors

### Metrics
1. Render Dashboard → Your Service → **"Metrics"** tab
2. View CPU, Memory, and HTTP request metrics

### Set Up Alerts
1. Go to **"Settings"** → **"Health & Alerts"**
2. Add email addresses for notifications
3. Configure alert thresholds

## Common Issues

### Issue: Build fails with "prisma not found"
**Solution:** Already fixed! Prisma is now in `dependencies` in package.json

### Issue: Database connection error
**Solution:**
- Verify DATABASE_URL format
- Use Session Pooler (port 5432), not Transaction Pooler
- Check Supabase allows external connections (0.0.0.0/0)

### Issue: Health check fails
**Solution:**
- Ensure app listens on `process.env.PORT`
- Check database connection in logs
- Verify no startup errors

### Issue: CORS errors from frontend
**Solution:**
- Verify FRONTEND_URL is correct
- Ensure FRONTEND_URL matches exactly (no trailing slash)
- Check CORS configuration in src/app.ts

### Issue: Service won't start
**Solution:**
- Check logs for errors
- Verify all required environment variables are set
- Ensure DATABASE_URL is accessible

## Environment Variables Checklist

Use this checklist to ensure all variables are set:

### Core (Required)
- [ ] `NODE_ENV` = production
- [ ] `PORT` = 10000
- [ ] `DATABASE_URL`
- [ ] `JWT_SECRET`

### Supabase (Required)
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

### Stripe (Required)
- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`

### AI (Required)
- [ ] `OPENAI_API_KEY`
- [ ] `GEMINI_API_KEY` (if using Gemini)

### Email (Required)
- [ ] `RESEND_API_KEY`

### Frontend (Required)
- [ ] `FRONTEND_URL`

### Optional
- [ ] `REDIS_URL` (if using workers)

## Scaling Your Service

### Upgrade Plan
1. Go to Settings → Plan
2. Choose larger instance type
3. Confirm upgrade

### Horizontal Scaling
1. Go to Settings → Scaling
2. Increase instance count
3. Load will be distributed automatically

## Cost Estimate

### Free Tier
- Web Service: Free (spins down after 15 min)
- Redis: Free
- **Total: $0/month** (limited hours)

### Production Setup
- Web Service (Starter): $7/month
- Worker (Starter): $7/month (optional)
- Redis (Starter): $10/month (optional)
- **Total: $7-$24/month**

## Next Steps

1. ✅ Set up custom domain (optional)
2. ✅ Configure monitoring/alerts
3. ✅ Set up error tracking (Sentry)
4. ✅ Test all API endpoints
5. ✅ Load test your API
6. ✅ Document API for frontend team
7. ✅ Set up staging environment

## Support

- **Render Docs**: https://render.com/docs
- **Render Community**: https://community.render.com
- **Render Support**: support@render.com

---

**Deployment Complete!** 🎉

Your API is now live at: `https://your-service-name.onrender.com`
