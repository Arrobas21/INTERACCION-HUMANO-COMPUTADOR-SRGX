(() => {
  // 1) Pega aquí los datos de tu proyecto (Supabase > Project Settings > API)
  const SUPABASE_URL = 'https://xylixxbxbpzztvqbadbp.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5bGl4eGJ4YnB6enR2cWJhZGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2MTQxNTEsImV4cCI6MjExMTE5MDE1MX0.UPRjjeU7irR4f6f3b5ZBXJj6sNMjVIZd_wpRaEoSabo'; // la clave "anon" es pública; la seguridad la dan las reglas RLS del SQL

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const $ = (s) => document.querySelector(s);
  const main = $('main.dashboard');
  let user = null, rol = null;

  // ---------- Interfaz (se inyecta, no hace falta tocar index.html) ----------
  $('.topbar nav').insertAdjacentHTML('beforeend',
    '<a href="#ingresar" id="nav-auth" class="nav-link" data-nav="login">Ingresar</a>' +
    '<a href="#admin" id="nav-admin" class="nav-link" data-nav="admin" hidden>Administración</a>');

  main.insertAdjacentHTML('beforeend', `
  <section class="view" data-view="login" hidden aria-labelledby="t-login">
    <div class="card auth-card">
      <h1 id="t-login" style="font-size:26px">Tu cuenta</h1>
      <div class="auth-tabs" role="tablist">
        <button role="tab" id="tab-in" aria-selected="true">Iniciar sesión</button>
        <button role="tab" id="tab-up" aria-selected="false">Crear cuenta</button>
      </div>
      <form id="auth-form" class="auth-form">
        <label class="field" id="f-nombre" hidden><span>Nombre</span><input name="nombre" autocomplete="name"></label>
        <label class="field"><span>Correo</span><input name="email" type="email" required autocomplete="email"></label>
        <label class="field"><span>Contraseña (mínimo 8 caracteres)</span><input name="password" type="password" minlength="8" required autocomplete="current-password"></label>
        <button class="primary-button" id="auth-submit">Iniciar sesión</button>
        <p class="form-msg" id="auth-msg" role="status"></p>
      </form>
    </div>
  </section>

  <section class="view" data-view="cuenta" hidden aria-labelledby="t-cuenta">
    <header class="page-header"><div><h1 id="t-cuenta">Mi cuenta</h1><p class="muted" id="who"></p></div>
      <button class="secondary-button" id="logout">Cerrar sesión</button></header>
    <div class="card wide-card">
      <h2 style="font-size:16px;margin:0 0 12px">Cuenta cómo fue tu espera</h2>
      <form id="rep-form" class="auth-form">
        <div class="form-row">
          <label class="field"><span>Fecha de tu visita</span><input name="fecha_visita" type="date" required></label>
          <label class="field"><span>Momento</span><select name="franja"><option>almuerzo</option><option>tarde</option><option>fin de semana o feriado</option></select></label>
        </div>
        <label class="field"><span>Minutos que esperaste (aprox.)</span><input name="minutos" type="number" min="0" max="360" required></label>
        <label class="field"><span>Comentario (opcional)</span><textarea name="comentario" maxlength="500"></textarea></label>
        <button class="primary-button">Enviar reporte</button>
        <p class="form-msg" id="rep-msg" role="status"></p>
      </form>
    </div>
    <div class="card wide-card"><h2 style="font-size:16px;margin:0 0 6px">Mis reportes</h2><div id="mine"></div></div>
  </section>

  <section class="view" data-view="admin" hidden aria-labelledby="t-admin">
    <header class="page-header"><h1 id="t-admin">Reportes por revisar</h1></header>
    <div class="card wide-card"><div id="pending"></div></div>
  </section>`);

  $('#esperas .flow-card').insertAdjacentHTML('afterend', `
    <div class="card flow-card"><div class="card-heading"><div><h3>Reportes de usuarios</h3>
      <p class="muted">Revisados antes de publicarse. Son experiencias individuales.</p></div></div>
      <div class="review-list" id="approved"></div>
      <a class="text-link review-source" href="#ingresar" id="share-link">Compartir mi espera</a></div>`);

  // ---------- Navegación ----------
  const show = (name) => {
    document.querySelectorAll('[data-view]').forEach((v) => { v.hidden = v.dataset.view !== name; });
    document.querySelectorAll('.nav-link').forEach((l) => {
      const on = l.dataset.nav === name || l.dataset.viewLink === name;
      l.classList.toggle('active', on);
    });
    window.scrollTo({ top: 0 });
  };
  const target = () => (user ? 'cuenta' : 'login');
  $('#nav-auth').addEventListener('click', (e) => { e.preventDefault(); show(target()); if (user) loadMine(); });
  $('#share-link').addEventListener('click', (e) => { e.preventDefault(); show(target()); if (user) loadMine(); });
  $('#nav-admin').addEventListener('click', (e) => { e.preventDefault(); show('admin'); loadPending(); });
  // Al volver a Inicio/Esperas con app.js, ocultar las vistas nuevas
  document.querySelectorAll('[data-view-link],[data-go-waits],[data-go-home]').forEach((l) =>
    l.addEventListener('click', () => document.querySelectorAll('[data-view=login],[data-view=cuenta],[data-view=admin]').forEach((v) => { v.hidden = true; })));

  // ---------- Helpers ----------
  const say = (id, text, err) => { const m = $(id); m.textContent = text; m.classList.toggle('error', !!err); };
  const item = (r, extra) => {
    const d = document.createElement('div'); d.className = 'row-item';
    const t = document.createElement('div');
    const h = document.createElement('strong');
    h.textContent = `${r.fecha_visita} · ${r.franja} · ${r.minutos} min`;
    const p = document.createElement('p'); p.textContent = r.comentario || 'Sin comentario.';
    t.append(h, p); d.append(t); if (extra) d.append(extra); return d;
  };
  const fill = (box, rows, empty, extra) => {
    box.replaceChildren();
    if (!rows || !rows.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = empty; box.append(p); return; }
    rows.forEach((r) => box.append(item(r, extra && extra(r))));
  };

  // ---------- Datos ----------
  async function loadApproved() {
    const { data, error } = await db.from('reportes_espera').select('*').eq('estado', 'aprobado').order('creado', { ascending: false }).limit(10);
    const box = $('#approved'); box.replaceChildren();
    if (error || !data.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = error ? 'No se pudieron cargar los reportes.' : 'Aún no hay reportes publicados.'; box.append(p); return; }
    data.forEach((r) => {
      const a = document.createElement('article'); a.className = 'review-entry';
      const s = document.createElement('span'); s.className = 'review-date'; s.textContent = r.fecha_visita;
      const p = document.createElement('p'); p.textContent = `Espera de unos ${r.minutos} min (${r.franja}).${r.comentario ? ' ' + r.comentario : ''}`;
      a.append(s, p); box.append(a);
    });
  }
  async function loadMine() {
    const { data } = await db.from('reportes_espera').select('*').eq('usuario_id', user.id).order('creado', { ascending: false });
    fill($('#mine'), data, 'Todavía no enviaste reportes.', (r) => { const s = document.createElement('span'); s.className = 'estado'; s.textContent = r.estado; return s; });
  }
  async function loadPending() {
    const { data } = await db.from('reportes_espera').select('*').eq('estado', 'pendiente').order('creado');
    fill($('#pending'), data, 'No hay reportes pendientes.', (r) => {
      const w = document.createElement('div'); w.className = 'row-actions';
      [['aprobado', 'Aprobar', 'ok'], ['rechazado', 'Rechazar', '']].forEach(([estado, label, cls]) => {
        const b = document.createElement('button'); b.className = 'btn-small ' + cls; b.textContent = label;
        b.addEventListener('click', async () => { await db.from('reportes_espera').update({ estado }).eq('id', r.id); loadPending(); loadApproved(); });
        w.append(b);
      });
      return w;
    });
  }

  // ---------- Sesión ----------
  async function refresh(session) {
    user = session ? session.user : null; rol = null;
    if (user) {
      const { data } = await db.from('profiles').select('nombre,rol').eq('id', user.id).single();
      rol = data ? data.rol : 'cliente';
      $('#who').textContent = `${(data && data.nombre) || user.email} · ${user.email}`;
    }
    $('#nav-auth').textContent = user ? 'Mi cuenta' : 'Ingresar';
    $('#nav-admin').hidden = rol !== 'admin';
  }
  db.auth.getSession().then(({ data }) => refresh(data.session));
  db.auth.onAuthStateChange((_e, session) => setTimeout(() => refresh(session), 0));

  let signup = false;
  const mode = (up) => {
    signup = up;
    $('#tab-in').setAttribute('aria-selected', !up); $('#tab-up').setAttribute('aria-selected', up);
    $('#f-nombre').hidden = !up; $('#auth-submit').textContent = up ? 'Crear cuenta' : 'Iniciar sesión'; say('#auth-msg', '');
  };
  $('#tab-in').addEventListener('click', () => mode(false));
  $('#tab-up').addEventListener('click', () => mode(true));

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), email = f.get('email'), password = f.get('password');
    say('#auth-msg', 'Un momento…');
    if (signup) {
      const { data, error } = await db.auth.signUp({ email, password, options: { data: { nombre: f.get('nombre') } } });
      if (error) return say('#auth-msg', error.message, true);
      if (!data.session) return say('#auth-msg', 'Cuenta creada. Confirma tu correo y luego inicia sesión.');
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) return say('#auth-msg', 'Correo o contraseña incorrectos.', true);
    }
    e.target.reset(); say('#auth-msg', ''); await new Promise((r) => setTimeout(r, 400)); show('cuenta'); loadMine();
  });

  $('#logout').addEventListener('click', async () => { await db.auth.signOut(); show('login'); });

  $('#rep-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)); f.minutos = Number(f.minutos);
    const { error } = await db.from('reportes_espera').insert(f);
    if (error) return say('#rep-msg', 'No se pudo enviar. Revisa los datos.', true);
    e.target.reset(); say('#rep-msg', 'Enviado. Se publicará cuando sea revisado.'); loadMine();
  });

  loadApproved();
})();
