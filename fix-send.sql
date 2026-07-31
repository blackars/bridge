-- Fix: permitir enviar mensajes siempre (aunque la conversación haya expirado)
DROP POLICY IF EXISTS "users can send messages" ON messages;
CREATE POLICY "users can send messages"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND (c.user1_id = auth.uid() OR c.user2_email = auth.email())
    )
  );
