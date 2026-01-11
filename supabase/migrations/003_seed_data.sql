-- Insert default subscription plans
INSERT INTO subscription_plans (name, price_monthly, channels_limit, messages_limit, forms_limit, ai_agents_limit, teammates_limit, chat_history_days, features)
VALUES
(
  'Starter',
  50.00,
  3,
  10000,
  2,
  1,
  5,
  7,
  '{"support": "email", "analytics": "basic"}'::jsonb
),
(
  'Professional',
  85.00,
  5,
  50000,
  10,
  3,
  20,
  30,
  '{"support": "priority", "analytics": "advanced", "custom_branding": true, "api_access": true}'::jsonb
),
(
  'Enterprise',
  118.00,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  '{"support": "dedicated", "analytics": "advanced", "custom_branding": true, "api_access": true, "white_label": true, "sso": true, "dedicated_manager": true}'::jsonb
);
