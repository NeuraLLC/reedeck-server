-- Enable Row Level Security on all tables
-- This file should be run after Prisma migrations to add RLS policies

-- =====================================================
-- ENABLE RLS ON ALL TABLES
-- =====================================================

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

-- =====================================================
-- DROP EXISTING POLICIES (IF ANY)
-- =====================================================

DROP POLICY IF EXISTS "Users can view their own data" ON users;
DROP POLICY IF EXISTS "Users can update their own data" ON users;
DROP POLICY IF EXISTS "Users can insert their own data" ON users;

DROP POLICY IF EXISTS "Organization members can view their organizations" ON organizations;
DROP POLICY IF EXISTS "Organization members can update their organizations" ON organizations;

DROP POLICY IF EXISTS "Users can view their organization memberships" ON organization_members;
DROP POLICY IF EXISTS "Organization admins can manage members" ON organization_members;

DROP POLICY IF EXISTS "Everyone can view active subscription plans" ON subscription_plans;

DROP POLICY IF EXISTS "Organization members can view their subscription" ON subscriptions;
DROP POLICY IF EXISTS "Organization owners can manage subscription" ON subscriptions;

DROP POLICY IF EXISTS "Organization members can view usage tracking" ON usage_tracking;

DROP POLICY IF EXISTS "Organization members can view tickets" ON tickets;
DROP POLICY IF EXISTS "Organization members can create tickets" ON tickets;
DROP POLICY IF EXISTS "Organization members can update tickets" ON tickets;

DROP POLICY IF EXISTS "Organization members can view ticket messages" ON ticket_messages;
DROP POLICY IF EXISTS "Organization members can create ticket messages" ON ticket_messages;

DROP POLICY IF EXISTS "Organization members can view ticket tags" ON ticket_tags;
DROP POLICY IF EXISTS "Organization members can manage ticket tags" ON ticket_tags;

DROP POLICY IF EXISTS "Organization members can view forms" ON forms;
DROP POLICY IF EXISTS "Organization members can manage forms" ON forms;

DROP POLICY IF EXISTS "Organization members can view form submissions" ON form_submissions;
DROP POLICY IF EXISTS "Anyone can submit forms" ON form_submissions;

DROP POLICY IF EXISTS "Organization members can view ai agents" ON ai_agents;
DROP POLICY IF EXISTS "Organization members can manage ai agents" ON ai_agents;

DROP POLICY IF EXISTS "Organization members can view agent sources" ON agent_sources;
DROP POLICY IF EXISTS "Organization members can manage agent sources" ON agent_sources;

DROP POLICY IF EXISTS "Organization members can view agent embeddings" ON agent_embeddings;
DROP POLICY IF EXISTS "Organization members can manage agent embeddings" ON agent_embeddings;

DROP POLICY IF EXISTS "Organization members can view agent conversations" ON agent_conversations;
DROP POLICY IF EXISTS "Organization members can manage agent conversations" ON agent_conversations;

DROP POLICY IF EXISTS "Organization members can view agent messages" ON agent_messages;
DROP POLICY IF EXISTS "Organization members can manage agent messages" ON agent_messages;

DROP POLICY IF EXISTS "Organization members can view source connections" ON source_connections;
DROP POLICY IF EXISTS "Organization members can manage source connections" ON source_connections;

DROP POLICY IF EXISTS "Organization members can view api keys" ON api_keys;
DROP POLICY IF EXISTS "Organization members can manage api keys" ON api_keys;

DROP POLICY IF EXISTS "Users can view their invitations" ON teammate_invitations;
DROP POLICY IF EXISTS "Organization members can manage invitations" ON teammate_invitations;

-- =====================================================
-- HELPER FUNCTION: Check if user is member of organization
-- =====================================================

CREATE OR REPLACE FUNCTION is_organization_member(org_id UUID, user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
    AND user_id = user_id
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- HELPER FUNCTION: Check if user is organization admin/owner
-- =====================================================

CREATE OR REPLACE FUNCTION is_organization_admin(org_id UUID, user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = org_id
    AND user_id = user_id
    AND role IN ('admin', 'owner')
    AND status = 'active'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- HELPER FUNCTION: Get user's organization IDs
-- =====================================================

CREATE OR REPLACE FUNCTION get_user_organizations(user_id UUID)
RETURNS TABLE(organization_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT om.organization_id
  FROM organization_members om
  WHERE om.user_id = user_id
  AND om.status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- USERS TABLE
CREATE POLICY "Users can view their own data"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own data"
  ON users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own data"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ORGANIZATIONS TABLE
CREATE POLICY "Organization members can view their organizations"
  ON organizations FOR SELECT
  USING (
    id IN (SELECT get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization admins can update their organizations"
  ON organizations FOR UPDATE
  USING (
    is_organization_admin(id, auth.uid())
  );

CREATE POLICY "Authenticated users can create organizations"
  ON organizations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ORGANIZATION MEMBERS TABLE
CREATE POLICY "Users can view their organization memberships"
  ON organization_members FOR SELECT
  USING (
    user_id = auth.uid() OR
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization admins can manage members"
  ON organization_members FOR ALL
  USING (
    is_organization_admin(organization_id, auth.uid())
  );

CREATE POLICY "Users can join organizations"
  ON organization_members FOR INSERT
  WITH CHECK (
    user_id = auth.uid() OR
    is_organization_admin(organization_id, auth.uid())
  );

-- SUBSCRIPTION PLANS TABLE (Read-only for all authenticated users)
CREATE POLICY "Everyone can view active subscription plans"
  ON subscription_plans FOR SELECT
  USING (is_active = true);

-- SUBSCRIPTIONS TABLE
CREATE POLICY "Organization members can view their subscription"
  ON subscriptions FOR SELECT
  USING (
    id IN (
      SELECT o.subscription_id
      FROM organizations o
      WHERE o.id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

CREATE POLICY "Organization owners can manage subscription"
  ON subscriptions FOR ALL
  USING (
    id IN (
      SELECT o.subscription_id
      FROM organizations o
      WHERE is_organization_admin(o.id, auth.uid())
    )
  );

-- USAGE TRACKING TABLE
CREATE POLICY "Organization members can view usage tracking"
  ON usage_tracking FOR SELECT
  USING (
    subscription_id IN (
      SELECT o.subscription_id
      FROM organizations o
      WHERE o.id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

-- TICKETS TABLE
CREATE POLICY "Organization members can view tickets"
  ON tickets FOR SELECT
  USING (
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization members can create tickets"
  ON tickets FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization members can update tickets"
  ON tickets FOR UPDATE
  USING (
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

-- TICKET MESSAGES TABLE
CREATE POLICY "Organization members can view ticket messages"
  ON ticket_messages FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM tickets
      WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

CREATE POLICY "Organization members can create ticket messages"
  ON ticket_messages FOR INSERT
  WITH CHECK (
    ticket_id IN (
      SELECT id FROM tickets
      WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

-- TICKET TAGS TABLE
CREATE POLICY "Organization members can view ticket tags"
  ON ticket_tags FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM tickets
      WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

CREATE POLICY "Organization members can manage ticket tags"
  ON ticket_tags FOR ALL
  USING (
    ticket_id IN (
      SELECT id FROM tickets
      WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

-- FORMS TABLE
CREATE POLICY "Organization members can view forms"
  ON forms FOR SELECT
  USING (
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization members can manage forms"
  ON forms FOR ALL
  USING (
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

-- FORM SUBMISSIONS TABLE
CREATE POLICY "Organization members can view form submissions"
  ON form_submissions FOR SELECT
  USING (
    form_id IN (
      SELECT id FROM forms
      WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

CREATE POLICY "Anyone can submit forms"
  ON form_submissions FOR INSERT
  WITH CHECK (true);

-- AI AGENTS TABLE
CREATE POLICY "Organization members can view ai agents"
  ON ai_agents FOR SELECT
  USING (
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization members can manage ai agents"
  ON ai_agents FOR ALL
  USING (
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

-- AGENT SOURCES TABLE
CREATE POLICY "Organization members can view agent sources"
  ON agent_sources FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM ai_agents
      WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

CREATE POLICY "Organization members can manage agent sources"
  ON agent_sources FOR ALL
  USING (
    agent_id IN (
      SELECT id FROM ai_agents
      WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

-- AGENT EMBEDDINGS TABLE
CREATE POLICY "Organization members can view agent embeddings"
  ON agent_embeddings FOR SELECT
  USING (
    source_id IN (
      SELECT id FROM agent_sources
      WHERE agent_id IN (
        SELECT id FROM ai_agents
        WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
      )
    )
  );

CREATE POLICY "Organization members can manage agent embeddings"
  ON agent_embeddings FOR ALL
  USING (
    source_id IN (
      SELECT id FROM agent_sources
      WHERE agent_id IN (
        SELECT id FROM ai_agents
        WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
      )
    )
  );

-- AGENT CONVERSATIONS TABLE
CREATE POLICY "Organization members can view agent conversations"
  ON agent_conversations FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM ai_agents
      WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

CREATE POLICY "Organization members can manage agent conversations"
  ON agent_conversations FOR ALL
  USING (
    agent_id IN (
      SELECT id FROM ai_agents
      WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
    )
  );

-- AGENT MESSAGES TABLE
CREATE POLICY "Organization members can view agent messages"
  ON agent_messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM agent_conversations
      WHERE agent_id IN (
        SELECT id FROM ai_agents
        WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
      )
    )
  );

CREATE POLICY "Organization members can manage agent messages"
  ON agent_messages FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM agent_conversations
      WHERE agent_id IN (
        SELECT id FROM ai_agents
        WHERE organization_id IN (SELECT get_user_organizations(auth.uid()))
      )
    )
  );

-- SOURCE CONNECTIONS TABLE
CREATE POLICY "Organization members can view source connections"
  ON source_connections FOR SELECT
  USING (
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization admins can manage source connections"
  ON source_connections FOR ALL
  USING (
    is_organization_admin(organization_id, auth.uid())
  );

-- API KEYS TABLE
CREATE POLICY "Organization members can view api keys"
  ON api_keys FOR SELECT
  USING (
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization admins can manage api keys"
  ON api_keys FOR ALL
  USING (
    is_organization_admin(organization_id, auth.uid())
  );

-- TEAMMATE INVITATIONS TABLE
CREATE POLICY "Users can view their invitations"
  ON teammate_invitations FOR SELECT
  USING (
    email = (SELECT email FROM users WHERE id = auth.uid()) OR
    organization_id IN (SELECT get_user_organizations(auth.uid()))
  );

CREATE POLICY "Organization admins can manage invitations"
  ON teammate_invitations FOR ALL
  USING (
    is_organization_admin(organization_id, auth.uid())
  );

-- =====================================================
-- GRANT NECESSARY PERMISSIONS
-- =====================================================

-- Grant execute on helper functions to authenticated users
GRANT EXECUTE ON FUNCTION is_organization_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_organization_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_organizations(UUID) TO authenticated;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON POLICY "Users can view their own data" ON users IS 'Users can only see their own user record';
COMMENT ON POLICY "Organization members can view their organizations" ON organizations IS 'Users can view organizations they are members of';
COMMENT ON POLICY "Everyone can view active subscription plans" ON subscription_plans IS 'All authenticated users can see available subscription plans';
