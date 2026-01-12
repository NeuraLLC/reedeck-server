# Quick Render Setup Guide

This is a quick reference guide to get your Reedeck backend deployed on Render in minutes.

## Files Created for Deployment

- **`render.yaml`** - Render Blueprint configuration (infrastructure as code)
- **`build.sh`** - Build script that runs during deployment
- **`.env.example`** - Template for environment variables
- **`DEPLOYMENT.md`** - Comprehensive deployment guide
- **`DEPLOYMENT_CHECKLIST.md`** - Pre-deployment checklist

## Quick Start (5 Minutes)

### 1. Push to GitHub

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

### 2. Create Render Account

Go to [render.com](https://render.com) and sign up.

### 3. Deploy with Blueprint

1. Click **"New +"** → **"Blueprint"**
2. Connect your Git repository
3. Render automatically detects `render.yaml`
4. Click **"Apply"**

### 4. Add Environment Variables

In the Render Dashboard, add these environment variables to your `reedeck-api` service:

**Critical Variables (Required):**
```bash
DATABASE_URL=postgresql://postgres:[password]@[host]:5432/postgres
JWT_SECRET=[generate with: openssl rand -base64 32]
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
FRONTEND_URL=https://your-frontend-url.com
```

**API Keys (Required):**
```bash
STRIPE_SECRET_KEY=sk_live_or_test_key
STRIPE_WEBHOOK_SECRET=whsec_webhook_secret
OPENAI_API_KEY=sk-your_openai_key
RESEND_API_KEY=re_your_resend_key
```

**Optional:**
```bash
GEMINI_API_KEY=your_gemini_key
REDIS_URL=[auto-populated if using Render Redis]
```

### 5. Verify Deployment

Once deployed, test the API:

```bash
curl https://your-app-name.onrender.com/health
```

You should see:
```json
{
  "status": "ok",
  "timestamp": "2024-01-12T...",
  "database": "connected"
}
```

## Architecture Overview

Your deployment will include:

### Web Service (`reedeck-api`)
- **Main API server**
- Handles all HTTP requests
- Auto-scales based on traffic
- URL: `https://your-app-name.onrender.com`

### Worker Service (`reedeck-worker`)
- **Background job processor**
- Processes email queue
- Handles ticket processing
- Runs scheduled tasks
- Optional: Comment out in `render.yaml` if not needed

### Redis Instance (`reedeck-redis`)
- **Queue backend for Bull**
- Stores job queues
- Manages job state
- Optional: Remove if not using background jobs

## Environment-Specific Notes

### Supabase Database

1. Get your connection string from Supabase:
   - Go to Project Settings → Database
   - Use the **Session Pooler** connection string (port 5432)
   - Format: `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`

2. Enable external connections:
   - In Supabase Dashboard → Settings → Database
   - Add `0.0.0.0/0` to allowed IP addresses (or Render's IP range)

### Stripe Configuration

After deployment:
1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://your-app.onrender.com/api/subscriptions/webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

## Common Issues & Fixes

### Issue: Build Fails with "Prisma not found"
**Fix:** The `postinstall` script in `package.json` should handle this. If not, add:
```json
"postinstall": "prisma generate"
```

### Issue: Database Connection Error
**Fix:**
- Verify `DATABASE_URL` format
- Use Session Pooler (port 5432), not Transaction Pooler (port 6543)
- Check Supabase allows external connections

### Issue: Health Check Fails
**Fix:**
- Ensure the app listens on `process.env.PORT` (Render uses port 10000)
- Check database connection in startup logs

### Issue: Worker Service Not Processing Jobs
**Fix:**
- Verify `REDIS_URL` is set correctly
- Check worker logs for connection errors
- Ensure Redis instance is running

### Issue: CORS Errors
**Fix:**
- Add your frontend URL to `FRONTEND_URL` environment variable
- Check CORS configuration in [src/app.ts:60-66](src/app.ts#L60-L66)

## Render Plans & Pricing

### Free Tier
- Services spin down after 15 minutes of inactivity
- 750 hours/month
- Good for development/testing

### Starter Plan ($7/month per service)
- Always-on services
- No spin-down
- Faster instance
- Recommended for production

### Pro Plan ($25/month per service)
- More resources
- Better performance
- Priority support

## Monitoring Your Deployment

### View Logs
```bash
# In Render Dashboard
Services → reedeck-api → Logs (tab)
```

### Set Up Alerts
1. Go to Service Settings → Health Check
2. Configure notification preferences
3. Add notification emails

### Performance Monitoring
- Use Render's built-in metrics
- Consider integrating Sentry for error tracking
- Monitor `/health` endpoint uptime

## Scaling Your Application

### Horizontal Scaling (More Instances)
```
Services → reedeck-api → Settings → Scaling
→ Increase instance count
```

### Vertical Scaling (Bigger Instances)
```
Services → reedeck-api → Settings → Instance Type
→ Choose larger instance
```

### Auto-Scaling
Configure in Render Dashboard based on:
- CPU usage
- Memory usage
- Request rate

## Next Steps After Deployment

1. ✅ Test all API endpoints
2. ✅ Configure Stripe webhooks
3. ✅ Set up error tracking (Sentry)
4. ✅ Configure monitoring alerts
5. ✅ Add custom domain (optional)
6. ✅ Set up CI/CD for auto-deploy
7. ✅ Load test your API
8. ✅ Configure database backups

## Useful Commands

### Generate Secure JWT Secret
```bash
openssl rand -base64 32
```

### Test API Health
```bash
curl https://your-app.onrender.com/health
```

### Test Authentication
```bash
curl -X POST https://your-app.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'
```

## Support & Resources

- **Render Documentation:** https://render.com/docs
- **Render Community:** https://community.render.com
- **Supabase Docs:** https://supabase.com/docs
- **Prisma Docs:** https://www.prisma.io/docs

## Deployment Checklist

Before going live, review [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) to ensure everything is configured correctly.

---

**Need Help?** Check the comprehensive [DEPLOYMENT.md](DEPLOYMENT.md) guide for detailed instructions.
