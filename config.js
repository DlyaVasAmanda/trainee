// Настройки облака (Supabase → Project Settings → API).
// Здесь только ПУБЛИЧНЫЙ ключ (sb_publishable_…): доступ к данным ограничен политиками RLS
// из supabase/schema.sql, каждый пользователь видит только свои записи.
// Секретный ключ (sb_secret_…) в приложение класть нельзя никогда.
// Пустые значения = приложение работает без аккаунтов, только на устройстве.
window.TRAINEE_CONFIG = {
  supabaseUrl: 'https://dtpdndyadsrqiekgfpzi.supabase.co',
  supabaseAnonKey: 'sb_publishable_3qgm5OvoNvzGr5XjBiSJNA_QILTQstf',
};
