# Reedeck Backend API

Node.js + Express backend for the Reedeck customer support dashboard.

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL (via Supabase)
- **ORM**: Prisma
- **Authentication**: JWT
- **Payments**: Stripe
- **AI**: OpenAI API
- **Vector Search**: pgvector

## Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files (database, Supabase, Stripe, OpenAI)
│   ├── middleware/      # Express middleware (auth, organization, rate limiting)
│   ├── routes/          # API routes
│   ├── controllers/     # Route controllers
│   ├── services/        # Business logic
│   ├── types/           # TypeScript types
│   ├── workers/         # Background job workers
│   └── app.ts          # Main Express application
├── prisma/
│   └── schema.prisma   # Prisma database schema
├── supabase/
│   └── migrations/     # SQL migrations
└── package.json
```

## Setup Instructions

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Environment Variables

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key
- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret key for JWT tokens
- `STRIPE_SECRET_KEY`: Stripe secret key
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook secret
- `OPENAI_API_KEY`: OpenAI API key
- `FRONTEND_URL`: Frontend application URL

### 3. Database Setup

Run the Supabase migrations:

```bash
# Apply migrations to your Supabase database
# You can do this through the Supabase dashboard SQL editor
# Or use the Supabase CLI:
supabase db push
```

Generate Prisma client:

```bash
npm run prisma:generate
```

### 4. Run the Server

Development mode with hot reload:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create new account and organization
- `POST /api/auth/login` - Login to existing account
- `GET /api/auth/verify` - Verify JWT token

### Organizations
- `GET /api/organizations` - Get all organizations for current user
- `GET /api/organizations/current` - Get current organization details
- `PATCH /api/organizations/current` - Update organization
- `GET /api/organizations/members` - Get organization members
- `POST /api/organizations/members/invite` - Invite teammate

### Subscriptions
- `GET /api/subscriptions/plans` - Get all subscription plans
- `GET /api/subscriptions/current` - Get current subscription
- `POST /api/subscriptions/checkout` - Create Stripe checkout session
- `POST /api/subscriptions/webhook` - Stripe webhook handler

### Tickets
- `GET /api/tickets` - Get all tickets
- `GET /api/tickets/:id` - Get single ticket
- `POST /api/tickets` - Create new ticket
- `PATCH /api/tickets/:id` - Update ticket
- `POST /api/tickets/:id/messages` - Add message to ticket

### AI Agents
- `GET /api/ai-agents` - Get all AI agents
- `GET /api/ai-agents/:id` - Get single AI agent
- `POST /api/ai-agents` - Create new AI agent
- `PATCH /api/ai-agents/:id` - Update AI agent
- `DELETE /api/ai-agents/:id` - Delete AI agent
- `POST /api/ai-agents/:id/chat` - Chat with AI agent

### Forms
- `GET /api/forms` - Get all forms
- `GET /api/forms/:id` - Get single form
- `POST /api/forms` - Create new form
- `PATCH /api/forms/:id` - Update form
- `GET /api/forms/:id/submissions` - Get form submissions

### Admin (Admin Only)
- `GET /api/admin/security/stats` - Get security statistics and blacklist
- `POST /api/admin/security/unblock-ip` - Remove IP from blacklist

## Database Schema

The database uses a multi-tenant architecture with organizations as the primary tenant entity.

Key tables:
- **organizations** - Organization/tenant accounts
- **users** - User accounts
- **organization_members** - User-organization relationships with roles
- **subscription_plans** - Available subscription tiers
- **subscriptions** - Active subscriptions
- **usage_tracking** - Track feature usage against limits
- **tickets** - Support tickets
- **forms** - Custom forms
- **ai_agents** - AI agent configurations
- **agent_embeddings** - Vector embeddings for RAG (using pgvector)

## Authentication & Authorization

- JWT-based authentication
- Organization-based multi-tenancy
- Role-based access control (admin/member)
- Row-level security enforced via Supabase RLS policies

## Subscription Management

Three subscription tiers:
- **Starter**: $50/month - 3 channels, 10K messages, 2 forms, 1 AI agent, 5 teammates
- **Professional**: $85/month - 5 channels, 50K messages, 10 forms, 3 AI agents, 20 teammates
- **Enterprise**: $118/month - Unlimited everything

Subscription limits are enforced via middleware on relevant endpoints.

## Development

Run Prisma Studio to view/edit database:

```bash
npm run prisma:studio
```

View logs:

```bash
tail -f logs/combined.log
```

## Next Steps

1. Setup Supabase project and apply migrations
2. Configure Stripe products and webhooks
3. Setup OpenAI API account
4. Configure environment variables
5. Run database migrations
6. Start the development server
7. Integrate with frontend application
