-- Add metadata column to ticket_messages for per-message platform data
-- (e.g., Slack message ts for correct thread reply targeting)
ALTER TABLE ticket_messages
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';
