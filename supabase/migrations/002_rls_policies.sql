-- Enable Row Level Security on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE teammate_invitations ENABLE ROW LEVEL SECURITY;

-- Organizations policies
CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT
  USING (
    id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can update their organizations"
  ON organizations FOR UPDATE
  USING (
    id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Users policies
CREATE POLICY "Users can view themselves"
  ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update themselves"
  ON users FOR UPDATE
  USING (id = auth.uid());

-- Organization members policies
CREATE POLICY "Users can view members of their organizations"
  ON organization_members FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage organization members"
  ON organization_members FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Subscription plans policies (public read)
CREATE POLICY "Anyone can view subscription plans"
  ON subscription_plans FOR SELECT
  USING (is_active = TRUE);

-- Subscriptions policies
CREATE POLICY "Users can view their organization's subscription"
  ON subscriptions FOR SELECT
  USING (
    id IN (
      SELECT subscription_id FROM organizations
      WHERE id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Admins can manage their organization's subscription"
  ON subscriptions FOR ALL
  USING (
    id IN (
      SELECT subscription_id FROM organizations
      WHERE id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid() AND role = 'admin'
      )
    )
  );

-- Usage tracking policies
CREATE POLICY "Users can view their organization's usage"
  ON usage_tracking FOR SELECT
  USING (
    subscription_id IN (
      SELECT subscription_id FROM organizations
      WHERE id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Tickets policies
CREATE POLICY "Users can view their organization's tickets"
  ON tickets FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create tickets in their organization"
  ON tickets FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tickets in their organization"
  ON tickets FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

-- Ticket messages policies
CREATE POLICY "Users can view messages for their organization's tickets"
  ON ticket_messages FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM tickets
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can create messages for their organization's tickets"
  ON ticket_messages FOR INSERT
  WITH CHECK (
    ticket_id IN (
      SELECT id FROM tickets
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Ticket tags policies
CREATE POLICY "Users can manage tags for their organization's tickets"
  ON ticket_tags FOR ALL
  USING (
    ticket_id IN (
      SELECT id FROM tickets
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Forms policies
CREATE POLICY "Users can view their organization's forms"
  ON forms FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage their organization's forms"
  ON forms FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Form submissions policies
CREATE POLICY "Users can view submissions for their organization's forms"
  ON form_submissions FOR SELECT
  USING (
    form_id IN (
      SELECT id FROM forms
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- AI agents policies
CREATE POLICY "Users can view their organization's AI agents"
  ON ai_agents FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage their organization's AI agents"
  ON ai_agents FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Agent sources policies
CREATE POLICY "Users can view sources for their organization's AI agents"
  ON agent_sources FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM ai_agents
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Admins can manage sources for their organization's AI agents"
  ON agent_sources FOR ALL
  USING (
    agent_id IN (
      SELECT id FROM ai_agents
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid() AND role = 'admin'
      )
    )
  );

-- Agent embeddings policies
CREATE POLICY "Users can view embeddings for their organization's AI agents"
  ON agent_embeddings FOR SELECT
  USING (
    source_id IN (
      SELECT id FROM agent_sources
      WHERE agent_id IN (
        SELECT id FROM ai_agents
        WHERE organization_id IN (
          SELECT organization_id FROM organization_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

-- Agent conversations policies
CREATE POLICY "Users can view conversations for their organization's AI agents"
  ON agent_conversations FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM ai_agents
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can create conversations for their organization's AI agents"
  ON agent_conversations FOR INSERT
  WITH CHECK (
    agent_id IN (
      SELECT id FROM ai_agents
      WHERE organization_id IN (
        SELECT organization_id FROM organization_members
        WHERE user_id = auth.uid()
      )
    )
  );

-- Agent messages policies
CREATE POLICY "Users can view messages for their organization's agent conversations"
  ON agent_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM agent_conversations
      WHERE agent_id IN (
        SELECT id FROM ai_agents
        WHERE organization_id IN (
          SELECT organization_id FROM organization_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "Users can create messages for their organization's agent conversations"
  ON agent_messages FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM agent_conversations
      WHERE agent_id IN (
        SELECT id FROM ai_agents
        WHERE organization_id IN (
          SELECT organization_id FROM organization_members
          WHERE user_id = auth.uid()
        )
      )
    )
  );

-- Source connections policies
CREATE POLICY "Users can view their organization's source connections"
  ON source_connections FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage their organization's source connections"
  ON source_connections FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- API keys policies
CREATE POLICY "Admins can manage their organization's API keys"
  ON api_keys FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Teammate invitations policies
CREATE POLICY "Admins can manage invitations for their organization"
  ON teammate_invitations FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
