-- ============================================
-- DROP TOTAL: borra todo para empezar de cero
-- ============================================
-- Ejecuta esto UNA VEZ, después corre reset-seed.sql

DROP POLICY IF EXISTS "users can read messages in their conversations" ON messages;
DROP POLICY IF EXISTS "users can send messages" ON messages;
DROP POLICY IF EXISTS "users can read own conversations" ON conversations;
DROP POLICY IF EXISTS "users can create conversations" ON conversations;
DROP POLICY IF EXISTS "users can read own profile" ON profiles;
DROP POLICY IF EXISTS "users can insert own profile" ON profiles;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DROP FUNCTION IF EXISTS handle_new_user;
DROP FUNCTION IF EXISTS cleanup_expired;

DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS profiles;

-- La publicación se limpia sola al dropear la tabla
