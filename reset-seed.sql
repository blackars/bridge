-- ============================================
-- RESET + SEED: borra todo + crea 2 usuarios
 -- ============================================
 -- PASO 1: Ejecuta este script completo UNA SOLA VEZ
 -- PASO 2: si quieres cambiar correos, usa el script
 --         "change-emails.sql" (más abajo)

-- ─── BORRAR DATOS EXISTENTES ───
DELETE FROM messages;
DELETE FROM conversations;
DELETE FROM profiles;
DELETE FROM auth.users;

-- ─── VOLVER A CORRER EL SCHEMA ───
-- Ejecuta ahora supabase-schema.sql (el nuevo, con DROP POLICY IF EXISTS)

-- ─── CREAR USUARIO 1 ───
-- REEMPLAZA: 'email1@ejemplo.com' y 'password123'
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

-- ─── CREAR USUARIO 2 ───
-- REEMPLAZA: 'email2@ejemplo.com' y 'password456'
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

-- ─── DESPUÉS DE ESTO ───
-- 1. Authentication > Settings > apaga "Enable sign up"
-- 2. Database > Replication > marca messages en supabase_realtime
-- 3. El frontend ya funciona con los 2 emails

-- ============================================
-- CAMBIAR EMAIL / CONTRASEÑA después de creados
-- ============================================
-- Copia y pega la query que corresponda en SQL Editor:

-- CAMBIAR EMAIL del usuario 1:
-- UPDATE auth.users
-- SET email = 'nuevo_email1@ejemplo.com'
-- WHERE email = 'email1@ejemplo.com';
--
-- UPDATE profiles
-- SET email = 'nuevo_email1@ejemplo.com'
-- WHERE email = 'email1@ejemplo.com';

-- CAMBIAR CONTRASEÑA del usuario 1:
-- UPDATE auth.users
-- SET encrypted_password = crypt('nuevaPassword123', gen_salt('bf'))
-- WHERE email = 'email1@ejemplo.com';

-- CAMBIAR EMAIL del usuario 2:
-- UPDATE auth.users
-- SET email = 'nuevo_email2@ejemplo.com'
-- WHERE email = 'email2@ejemplo.com';
--
-- UPDATE profiles
-- SET email = 'nuevo_email2@ejemplo.com'
-- WHERE email = 'email2@ejemplo.com';

-- CAMBIAR CONTRASEÑA del usuario 2:
-- UPDATE auth.users
-- SET encrypted_password = crypt('nuevaPassword456', gen_salt('bf'))
-- WHERE email = 'email2@ejemplo.com';
