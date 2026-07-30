-- Fix RLS: permitir a usuarios autenticados leer todos los profiles
DROP POLICY IF EXISTS "users can read own profile" ON profiles;
DROP POLICY IF EXISTS "users can read profiles" ON profiles;
CREATE POLICY "users can read profiles"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Si profiles está vacío, llenarlo desde auth.users
INSERT INTO profiles (id, email)
SELECT id, email FROM auth.users
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.users.id);
