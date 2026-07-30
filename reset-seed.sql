-- ============================================
-- RESET + SEED: limpia todo + crea 2 usuarios
 -- ============================================
 -- ÚNICO SCRIPT: ejecuta esto COMPLETO UNA SOLA VEZ.
 -- Antes de correrlo: reemplaza los 4 valores marcados abajo.

-- ════════════════════════════════════════════
-- PASO 1: ASEGURAR QUE LAS TABLAS EXISTEN
-- ════════════════════════════════════════════

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

ALTER PUBLICATION supabase_realtime ADD TABLE messages;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ════════════════════════════════════════════
-- PASO 2: LIMPIAR DATOS EXISTENTES
-- ════════════════════════════════════════════

DELETE FROM messages;
DELETE FROM conversations;
DELETE FROM profiles;
DELETE FROM auth.users;

-- ════════════════════════════════════════════
-- PASO 3: CREAR USUARIO 1
-- ════════════════════════════════════════════
-- >>> REEMPLAZA 'email1@ejemplo.com' por el email real
-- >>> REEMPLAZA 'password123' por la contraseña real

INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'email1@ejemplo.com',
  crypt('password123', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(), now(), '', '', '', ''
);

-- ════════════════════════════════════════════
-- PASO 4: CREAR USUARIO 2
-- ════════════════════════════════════════════
-- >>> REEMPLAZA 'email2@ejemplo.com' por el email real
-- >>> REEMPLAZA 'password456' por la contraseña real

INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'email2@ejemplo.com',
  crypt('password456', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(), now(), '', '', '', ''
);

-- ════════════════════════════════════════════
-- PASO 5: VERIFICAR
-- ════════════════════════════════════════════

SELECT 'USUARIOS CREADOS:' as titulo;
SELECT id, email FROM auth.users;

SELECT 'PROFILES CREADOS:' as titulo;
SELECT id, email FROM profiles;

-- Si profiles está vacío, corre esto manualmente:
-- INSERT INTO profiles (id, email) SELECT id, email FROM auth.users;

-- ════════════════════════════════════════════
-- PASO 6: POST-DEPLOY
-- ════════════════════════════════════════════
-- 1. Authentication > Settings > apaga "Enable sign up"
-- 2. Database > Replication > marca messages en supabase_realtime
-- 3. El frontend ya funciona con los 2 emails

-- ════════════════════════════════════════════
-- CAMBIAR EMAIL / CONTRASEÑA (futuro)
-- ════════════════════════════════════════════
-- Copia y pega la query que necesites:

-- CAMBIAR EMAIL usuario 1:
-- UPDATE auth.users SET email = 'nuevo_email1@ejemplo.com' WHERE email = 'email1@ejemplo.com';
-- UPDATE profiles SET email = 'nuevo_email1@ejemplo.com' WHERE email = 'email1@ejemplo.com';

-- CAMBIAR CONTRASEÑA usuario 1:
-- UPDATE auth.users SET encrypted_password = crypt('nuevaPass123', gen_salt('bf')) WHERE email = 'email1@ejemplo.com';

-- CAMBIAR EMAIL usuario 2:
-- UPDATE auth.users SET email = 'nuevo_email2@ejemplo.com' WHERE email = 'email2@ejemplo.com';
-- UPDATE profiles SET email = 'nuevo_email2@ejemplo.com' WHERE email = 'email2@ejemplo.com';

-- CAMBIAR CONTRASEÑA usuario 2:
-- UPDATE auth.users SET encrypted_password = crypt('nuevaPass456', gen_salt('bf')) WHERE email = 'email2@ejemplo.com';
