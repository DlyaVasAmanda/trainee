// Настройки облака. Значения берутся из Supabase → Project Settings → API.
// anon key публичный: доступ к данным ограничен политиками RLS из supabase/schema.sql.
// Пустые значения = приложение работает без аккаунтов, только на устройстве.
window.TRAINEE_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
