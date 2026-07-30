-- ============================================
-- SCHEMA: Private E2EE Chat (2 usuarios)
-- IDEMPOTENTE: se puede ejecutar mil veces sin error
 -- ============================================
 -- Ejecutar todo esto en el SQL Editor de Supabase

-- 1. Profiles (extiende auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own profile" ON profiles;
CREATE POLICY "users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "users can insert own profile" ON profiles;
CREATE POLICY "users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 2. Conversations (sala entre 2 usuarios)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id UUID NOT NULL REFERENCES profiles(id),
  user2_email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  CONSTRAINT unique_pair UNIQUE (user1_id, user2_email)
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own conversations" ON conversations;
CREATE POLICY "users can read own conversations"
  ON conversations FOR SELECT
  USING (
    auth.uid() = user1_id
    OR auth.email() = user2_email
  );

DROP POLICY IF EXISTS "users can create conversations" ON conversations;
CREATE POLICY "users can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() = user1_id);

-- 3. Messages (encriptados)
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id),
  encrypted_content TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read messages in their conversations" ON messages;
CREATE POLICY "users can read messages in their conversations"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (c.user1_id = auth.uid() OR c.user2_email = auth.email())
        AND messages.created_at >= NOW() - INTERVAL '24 hours'
    )
  );

DROP POLICY IF EXISTS "users can send messages" ON messages;
CREATE POLICY "users can send messages"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND (c.user1_id = auth.uid() OR c.user2_email = auth.email())
        AND c.expires_at > NOW()
    )
  );

-- 4. Habilitar Realtime para messages
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- 5. Función de cleanup
CREATE OR REPLACE FUNCTION cleanup_expired()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM messages
  WHERE created_at < NOW() - INTERVAL '24 hours';

  DELETE FROM conversations
  WHERE expires_at < NOW();
END;
$$;

-- 6. Trigger: auto-crear profile al registrarse
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
