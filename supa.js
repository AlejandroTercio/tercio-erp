/* ERP TERCIO · Conexión con Supabase
 * ---------------------------------------------------------------------------
 * Esta capa hace tres cosas:
 *   1) Pide login (email + contraseña) y comprueba que el usuario tiene algún rol.
 *   2) Imita la base de datos, los archivos, los usuarios y las descargas que antes
 *      daba Claude (window.claude.use('db' | 'assets' | 'user' | 'downloads')),
 *      de modo que el código del ERP funciona sin cambios.
 *   3) Hace el trabajo en tiempo real: lo que guarda una persona aparece en las
 *      pantallas de las demás.
 *
 * Seguridad: la clave de abajo es PÚBLICA por diseño. Quien protege los datos son las
 * reglas de seguridad por filas (RLS) de Supabase, no esta clave. Nunca pongas aquí
 * la clave secreta (service_role).
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://wtfvgmfzsmgfpucufnmb.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_O6Z8nYLvYfDfHYU4z5DTdw_THsmUfX_';
  var BUCKET = 'adjuntos';
  var TABLAS = ['leads', 'interacciones', 'propuestas', 'contratos', 'empresas', 'trabajadores', 'maquinas',
    'documentos', 'horas', 'facturas', 'gastos', 'tareas', 'procesos', 'procpartes', 'registro', 'config'];

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  var session = null;
  var profile = null;
  var resolveReady;
  var readyP = new Promise(function (r) { resolveReady = r; });

  /* ------------------------------------------------------------------ utilidades */
  function err(e) {
    var msg = (e && e.message) || 'Error de base de datos';
    var code = e && (e.code || e.status);
    if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
      msg = 'No tienes permiso para esta acción.';
      code = 'permission-denied';
    }
    var x = new Error(msg);
    x.code = code;
    x.original = e;
    return x;
  }
  function randId() {
    var c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var a = new Uint8Array(20);
    crypto.getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) s += c[a[i] % 62];
    return s;
  }
  function check(t) {
    if (TABLAS.indexOf(t) < 0) throw new Error('Colección no permitida: ' + t);
    return t;
  }
  function docSnap(id, data) {
    return { id: id, exists: true, data: function () { return data; } };
  }
  function noDocSnap(id) {
    return { id: id, exists: false, data: function () { return undefined; } };
  }
  function colSnap(docs) {
    return { docs: docs, size: docs.length, empty: !docs.length, forEach: function (f) { docs.forEach(f); } };
  }
  function cmp(a, b, field, dir) {
    var x = a[field], y = b[field], r;
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    r = x < y ? -1 : x > y ? 1 : 0;
    return dir === 'desc' ? -r : r;
  }

  /* ------------------------------------------------------------------ base de datos */
  async function fetchAll(t, q) {
    var out = [], size = 1000, from = 0, max = q.limit || Infinity;
    while (out.length < max) {
      var n = Math.min(size, max - out.length);
      var req = sb.from(t).select('id,data');
      if (q.order) req = req.order('data->>' + q.order[0], { ascending: q.order[1] !== 'desc' });
      req = req.order('id').range(from, from + n - 1);
      var r = await req;
      if (r.error) throw err(r.error);
      for (var i = 0; i < r.data.length; i++) out.push([r.data[i].id, r.data[i].data || {}]);
      if (r.data.length < n) break;
      from += n;
    }
    return out;
  }

  var chSeq = 0;

  function watchQuery(t, q, next, errCb) {
    var map = new Map();
    var alive = true;

    function emit() {
      var arr = Array.from(map.entries());
      if (q.order) arr.sort(function (a, b) { return cmp(a[1], b[1], q.order[0], q.order[1]); });
      if (q.limit) arr = arr.slice(0, q.limit);
      next(colSnap(arr.map(function (e) { return docSnap(e[0], e[1]); })));
    }
    async function resync() {
      try {
        var rows = await fetchAll(t, q);
        if (!alive) return;
        map = new Map(rows);
        emit();
      } catch (e) {
        if (alive && errCb) errCb(e);
      }
    }

    var ch = sb.channel('rt-' + t + '-' + (++chSeq))
      .on('postgres_changes', { event: '*', schema: 'public', table: t }, function (p) {
        if (!alive) return;
        if (p.eventType === 'DELETE') {
          if (p.old && p.old.id != null) map.delete(p.old.id);
        } else if (p.new) {
          map.set(p.new.id, p.new.data || {});
        }
        emit();
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') resync(); /* carga inicial y tras cada reconexión */
      });

    return function () { alive = false; sb.removeChannel(ch); };
  }

  function watchDoc(t, id, next, errCb) {
    var alive = true;
    async function load() {
      try {
        var r = await sb.from(t).select('data').eq('id', id).maybeSingle();
        if (r.error) throw err(r.error);
        if (!alive) return;
        next(r.data ? docSnap(id, r.data.data || {}) : noDocSnap(id));
      } catch (e) {
        if (alive && errCb) errCb(e);
      }
    }
    var ch = sb.channel('rt-' + t + '-' + id + '-' + (++chSeq))
      .on('postgres_changes', { event: '*', schema: 'public', table: t, filter: 'id=eq.' + id }, function (p) {
        if (!alive) return;
        if (p.eventType === 'DELETE') next(noDocSnap(id));
        else if (p.new) next(docSnap(id, p.new.data || {}));
      })
      .subscribe(function (status) {
        if (status === 'SUBSCRIBED') load();
      });
    return function () { alive = false; sb.removeChannel(ch); };
  }

  function docRef(t, id) {
    return {
      id: id,
      get: async function () {
        var r = await sb.from(t).select('data').eq('id', id).maybeSingle();
        if (r.error) throw err(r.error);
        return r.data ? docSnap(id, r.data.data || {}) : noDocSnap(id);
      },
      set: async function (obj) {
        var r = await sb.from(t).upsert({ id: id, data: obj });
        if (r.error) throw err(r.error);
      },
      update: async function (patch) {
        var r = await sb.rpc('doc_merge', { p_table: t, p_id: id, p_patch: patch });
        if (r.error) throw err(r.error);
        if (r.data !== true) {
          var e = new Error('El registro no existe o no tienes permiso para modificarlo.');
          e.code = 'permission-denied';
          throw e;
        }
      },
      delete: async function () {
        var r = await sb.from(t).delete().eq('id', id).select('id');
        if (r.error) throw err(r.error);
      },
      onSnapshot: function (next, errCb) { return watchDoc(t, id, next, errCb); }
    };
  }

  function query(t, q) {
    return {
      orderBy: function (f, d) { return query(t, { order: [f, d || 'asc'], limit: q.limit }); },
      limit: function (n) { return query(t, { order: q.order, limit: n }); },
      get: async function () {
        var rows = await fetchAll(t, q);
        return colSnap(rows.map(function (e) { return docSnap(e[0], e[1]); }));
      },
      onSnapshot: function (next, errCb) { return watchQuery(t, q, next, errCb); }
    };
  }

  var db = {
    collection: function (t) {
      check(t);
      var base = query(t, {});
      base.doc = function (id) { return docRef(t, id || randId()); };
      return base;
    },
    doc: function (path) {
      var p = String(path).split('/');
      return docRef(check(p[0]), p.slice(1).join('/'));
    }
  };

  /* ------------------------------------------------------------------ archivos */
  function safeName(n) {
    var s = String(n || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_');
    return s.slice(-100) || 'archivo';
  }
  var assets = {
    upload: async function (file, opts) {
      var path = 'leads/' + crypto.randomUUID() + '/' + safeName(file.name);
      var r = await sb.storage.from(BUCKET).upload(path, file, {
        contentType: (opts && opts.type) || file.type || 'application/octet-stream',
        upsert: false
      });
      if (r.error) {
        var e = new Error(r.error.message);
        var m = String(r.error.message || '');
        e.code = /exceed|too large|maximum allowed size/i.test(m) ? 'too_large'
          : /row-level security|not authorized|permission/i.test(m) ? 'permission-denied'
          : /too many|rate/i.test(m) ? 'rate_limited' : 'error';
        throw e;
      }
      return { id: path, sizeBytes: file.size, contentType: (opts && opts.type) || file.type };
    },
    delete: async function (id) {
      var r = await sb.storage.from(BUCKET).remove([id]);
      if (r.error) throw err(r.error);
    }
  };

  /* Los enlaces a archivos del ERP apuntan a /_blob/<ruta>: aquí los convertimos en un enlace firmado temporal. */
  document.addEventListener('click', async function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href^="/_blob/"]') : null;
    if (!a) return;
    ev.preventDefault();
    var path = decodeURIComponent(a.getAttribute('href').slice('/_blob/'.length));
    var win = window.open('about:blank', '_blank');
    var r = await sb.storage.from(BUCKET).createSignedUrl(path, 120);
    if (r.error || !r.data) {
      if (win) win.close();
      alert('No se pudo abrir el archivo (puede que ya no exista o que no tengas permiso).');
      return;
    }
    if (win) { win.opener = null; win.location.href = r.data.signedUrl; }
    else window.location.href = r.data.signedUrl;
  }, true);

  /* ------------------------------------------------------------------ usuarios y descargas */
  var userCap = {
    id: async function () { return session ? session.user.id : ''; },
    profiles: async function (ids) {
      var out = {};
      if (!ids || !ids.length) return out;
      var r = await sb.from('profiles').select('id,name,email').in('id', ids);
      (r.data || []).forEach(function (p) { out[p.id] = { name: p.name || p.email || '' }; });
      return out;
    }
  };

  var MIME = {
    json: 'application/json', csv: 'text/csv;charset=utf-8', svg: 'image/svg+xml', png: 'image/png',
    doc: 'application/msword', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf: 'application/pdf', txt: 'text/plain;charset=utf-8'
  };
  var downloads = {
    save: async function (o) {
      var ext = String(o.filename).split('.').pop().toLowerCase();
      var blob = o.data instanceof Blob ? o.data : new Blob([o.data], { type: MIME[ext] || 'application/octet-stream' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = o.filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    }
  };

  /* Sustituye a window.claude: el ERP pide aquí sus "capacidades" y esperan al login. */
  window.claude = {
    use: async function (name) {
      if (name === 'sample') return null; /* las funciones con IA de Claude no están disponibles fuera de Claude */
      await readyP;
      if (name === 'db') return db;
      if (name === 'assets') return assets;
      if (name === 'user') return userCap;
      if (name === 'downloads') return downloads;
      throw new Error('Capacidad no disponible: ' + name);
    }
  };

  /* ------------------------------------------------------------------ pantalla de acceso */
  var css = document.createElement('style');
  css.textContent =
    '#supa-gate{position:fixed;inset:0;z-index:99999;background:#0B2545;display:flex;align-items:center;justify-content:center;padding:16px;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    '#supa-gate .card{background:#fff;color:#0B2545;border-radius:14px;padding:28px 24px;width:100%;max-width:380px;box-shadow:0 12px 40px rgba(0,0,0,.35)}' +
    '#supa-gate h1{margin:0 0 2px;font-size:30px;letter-spacing:.08em}#supa-gate h1 span{color:#F7B500;font-size:14px;letter-spacing:.16em;margin-left:8px}' +
    '#supa-gate p{margin:6px 0 16px;color:#4F5B6B}' +
    '#supa-gate label{display:block;font-weight:600;font-size:13px;margin:12px 0 4px}' +
    '#supa-gate input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #C9D1DC;border-radius:8px;font:inherit}' +
    '#supa-gate input:focus{outline:2px solid #F7B500;border-color:#F7B500}' +
    '#supa-gate button{width:100%;margin-top:18px;padding:11px;border:0;border-radius:8px;background:#F7B500;color:#0B2545;font:inherit;font-weight:700;cursor:pointer}' +
    '#supa-gate button.sec{background:#E8ECF1;margin-top:10px}#supa-gate button:disabled{opacity:.6;cursor:default}' +
    '#supa-gate .msg{margin-top:12px;color:#B3263A;font-weight:600;min-height:1.2em}' +
    '#supa-user{margin:auto 12px 12px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.09);color:#D2DBE8;font-size:12.5px}' +
    '#supa-user b{display:block;color:#fff;font-size:13px;overflow:hidden;text-overflow:ellipsis}' +
    '#supa-user button{all:unset;cursor:pointer;color:#FFD45C;margin-right:12px;margin-top:6px;display:inline-block}' +
    'body.no-admin [data-nav="set"],body.no-admin [data-nav="rent"]{display:none!important}' +
    'body.no-crm [data-nav="crm"]{display:none!important}' +
    'body.no-op [data-nav="op"]{display:none!important}';
  document.head.appendChild(css);

  var gate = document.createElement('div');
  gate.id = 'supa-gate';
  document.body.appendChild(gate);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function showLogin(msg) {
    gate.hidden = false;
    gate.innerHTML =
      '<form class="card" id="supa-form" novalidate>' +
      '<h1>TERCIO<span>ERP</span></h1><p>Accede con tu cuenta.</p>' +
      '<label for="supa-email">Email</label><input id="supa-email" type="email" autocomplete="username" required>' +
      '<label for="supa-pass">Contraseña</label><input id="supa-pass" type="password" autocomplete="current-password" required>' +
      '<button type="submit" id="supa-go">Entrar</button>' +
      '<div class="msg" id="supa-msg" role="alert">' + esc(msg || '') + '</div></form>';
    var f = document.getElementById('supa-form');
    f.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var em = document.getElementById('supa-email').value.trim();
      var pw = document.getElementById('supa-pass').value;
      var m = document.getElementById('supa-msg'), b = document.getElementById('supa-go');
      if (!em || !pw) { m.textContent = 'Escribe tu email y tu contraseña.'; return; }
      b.disabled = true; b.textContent = 'Entrando…'; m.textContent = '';
      var r = await sb.auth.signInWithPassword({ email: em, password: pw });
      if (r.error) {
        b.disabled = false; b.textContent = 'Entrar';
        m.textContent = /invalid login/i.test(r.error.message) ? 'Email o contraseña incorrectos.' : 'No se pudo entrar: ' + r.error.message;
        return;
      }
      afterLogin(r.data.session);
    });
    var first = document.getElementById('supa-email');
    if (first) first.focus();
  }

  function showNoAccess(email) {
    gate.hidden = false;
    gate.innerHTML =
      '<div class="card"><h1>TERCIO<span>ERP</span></h1>' +
      '<p>Tu cuenta (<b>' + esc(email) + '</b>) todavía no tiene acceso. Pide al administrador que te asigne un rol y vuelve a entrar.</p>' +
      '<button type="button" class="sec" id="supa-out">Cerrar sesión</button></div>';
    document.getElementById('supa-out').addEventListener('click', logout);
  }

  async function logout() {
    await sb.auth.signOut();
    location.reload();
  }

  function paintUser() {
    var roles = profile.roles || [];
    var isAdmin = roles.indexOf('admin') >= 0;
    document.body.classList.toggle('no-admin', !isAdmin);
    document.body.classList.toggle('no-crm', !(isAdmin || roles.indexOf('comercial') >= 0));
    document.body.classList.toggle('no-op', !(isAdmin || roles.indexOf('operativa') >= 0 || roles.indexOf('comercial') >= 0));
    var side = document.getElementById('side');
    if (!side || document.getElementById('supa-user')) return;
    var box = document.createElement('div');
    box.id = 'supa-user';
    box.innerHTML = '<b>' + esc(profile.name || profile.email) + '</b>' + esc(roles.join(' · ')) +
      '<div><button type="button" id="supa-pw">Cambiar contraseña</button><button type="button" id="supa-lo">Salir</button></div>';
    side.appendChild(box);
    document.getElementById('supa-lo').addEventListener('click', logout);
    document.getElementById('supa-pw').addEventListener('click', async function () {
      var pw = prompt('Escribe tu nueva contraseña (mínimo 8 caracteres):');
      if (!pw) return;
      if (pw.length < 8) { alert('La contraseña debe tener al menos 8 caracteres.'); return; }
      var r = await sb.auth.updateUser({ password: pw });
      alert(r.error ? 'No se pudo cambiar la contraseña: ' + r.error.message : 'Contraseña cambiada.');
    });
  }

  async function afterLogin(sess) {
    session = sess;
    var r = await sb.from('profiles').select('id,email,name,roles').eq('id', sess.user.id).maybeSingle();
    if (r.error) { showLogin('No se pudo leer tu perfil: ' + r.error.message); return; }
    if (!r.data || !r.data.roles || !r.data.roles.length) { showNoAccess(sess.user.email); return; }
    profile = r.data;
    paintUser();
    gate.hidden = true;
    gate.innerHTML = '';
    resolveReady();
  }

  sb.auth.onAuthStateChange(function (evt) {
    if (evt === 'SIGNED_OUT' && session) location.reload();
  });

  (async function boot() {
    var r = await sb.auth.getSession();
    if (r.data && r.data.session) afterLogin(r.data.session);
    else showLogin();
  })();
})();
