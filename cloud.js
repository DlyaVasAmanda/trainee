'use strict';
/* =========================================================
   Облако: тонкая обёртка над Supabase (вход и таблица records).
   Вся остальная логика (офлайн, очередь, слияние) — в app.js.
   Cloud === null, если облако не настроено (config.js пуст).
   ========================================================= */
const Cloud = (() => {
  if (window.__cloudMock) return window.__cloudMock; // для тестов
  const cfg = window.TRAINEE_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'trainee-auth' },
  });
  const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');
  const must = ({ data, error }) => { if (error) throw error; return data; };
  const PAGE = 1000;

  return {
    async session() { return must(await sb.auth.getSession()).session; },
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => setTimeout(() => cb(event, session), 0)); },
    async signUp(email, password) { return must(await sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } })); },
    async signIn(email, password) { return must(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut({ scope: 'local' }); },
    async resetPassword(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })); },
    async updatePassword(password) { must(await sb.auth.updateUser({ password })); },

    // rows: [{ user_id, kind, id, data, deleted, updated_at }]
    async push(rows) { must(await sb.from('records').upsert(rows, { onConflict: 'user_id,kind,id' })); },

    // Все записи с server_ts >= since (или все, если since пуст), постранично
    async pull(since) {
      const out = [];
      for (let from = 0; ; from += PAGE) {
        let q = sb.from('records').select('kind,id,data,deleted,updated_at,server_ts')
          .order('server_ts', { ascending: true }).order('kind').order('id').range(from, from + PAGE - 1);
        if (since) q = q.gte('server_ts', since);
        const rows = must(await q);
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    },
  };
})();
