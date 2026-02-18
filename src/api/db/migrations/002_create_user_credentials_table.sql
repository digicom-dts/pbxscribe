CREATE TABLE user_credentials (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_type VARCHAR(20) NOT NULL
    CHECK (credential_type IN ('password', 'api_key')),
  credential_hash VARCHAR(255) NOT NULL,
  label VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_creds_user_id ON user_credentials (user_id);
CREATE INDEX IF NOT EXISTS idx_user_creds_type ON user_credentials (user_id, credential_type);
CREATE INDEX IF NOT EXISTS idx_user_creds_active ON user_credentials (user_id, is_active) WHERE is_active = true;
