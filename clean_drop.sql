-- ============================================
-- DROP TOTAL: borra todo para empezar de cero
-- ============================================
-- Ejecuta esto UNA VEZ, después corre reset-seed.sql

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DROP FUNCTION IF EXISTS handle_new_user();
DROP FUNCTION IF EXISTS cleanup_expired();

DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
