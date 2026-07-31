-- ============================================
-- REALTIME AUTH: permitir broadcast (indicador de escribiendo)
-- Ejecutar TODO en el SQL Editor de Supabase (una sola vez)
-- ============================================

-- Permite RECIBIR broadcasts (ver la burbuja de escribiendo)
DROP POLICY IF EXISTS "authenticated can receive broadcasts" ON realtime.messages;
CREATE POLICY "authenticated can receive broadcasts"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (true);

-- Permite ENVIAR broadcasts (tu burbuja llega al otro)
DROP POLICY IF EXISTS "authenticated can send broadcasts" ON realtime.messages;
CREATE POLICY "authenticated can send broadcasts"
  ON realtime.messages FOR INSERT
  TO authenticated
  WITH CHECK (true);
