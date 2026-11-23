import { createStore, ledgerId, buildRules, CATEGORIAS } from "./store.js";

const CFG = window.APP_CONFIG;
const L = window.Logic;
const APP_VERSION = "1.6.0";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const money = (n, cur = "COP") =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: cur, minimumFractionDigits: cur === "COP" ? 0 : 2, maximumFractionDigits: cur === "COP" ? 0 : 2 }).format(n || 0);
const fdate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${+d} ${["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][m - 1]} ${y}`; };
const num = (v) => { const x = parseFloat(String(v).replace(/\./g, "").replace(",", ".")); return isFinite(x) ? x : 0; };
const adultByEmail = (e) => CFG.adults.find((a) => a.email.toLowerCase() === (e || "").toLowerCase());
const adultById = (id) => CFG.adults.find((a) => a.id === id);
const kidById = (id) => CFG.kids.find((k) => k.id === id);
const nameOf = (email) => adultByEmail(email)?.nombre || email || "—";

let store;
const ADMIN = (CFG.admin || CFG.adults[0].email).toLowerCase();
const slug = (t) => (t || "m").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "").slice(0, 10) + Math.random().toString(36).slice(2, 5);
// Lista de familia: vive en la base de datos (para poder invitar desde la app). config.js es solo el punto de partida.
function familyFromConfig() {
  return { adults: CFG.adults.map((a) => ({ ...a, email: a.email.toLowerCase(), sinVerificar: true })), kids: CFG.kids.map((k) => ({ ...k, email: (k.email || "").toLowerCase(), sinVerificar: true })) };
}
function famPayload(f) {
  const all = [...f.adults, ...f.kids].filter((m) => m.email);
  return { ...f, admin: ADMIN, adultEmails: f.adults.map((a) => a.email), kidEmails: Object.fromEntries(f.kids.map((k) => [k.id, k.email || ""])),
    emails: all.map((m) => m.email), noVerify: all.filter((m) => m.sinVerificar).map((m) => m.email), actualizado: Date.now() };
}
let famSig = "";
function applyFamily(f) {
  if (!f || !f.adults) return false;
  const sig = JSON.stringify([f.adults, f.kids]);
  if (sig === famSig) return false;
  famSig = sig; CFG.adults = f.adults; CFG.kids = f.kids; S.family = f;
  return true;
}
const S = { user: null, me: null, kind: null, ledgers: {}, kids: {}, compras: [], obl: [], oblLoaded: false, unsubs: [], ready: false };
const app = $("#app");

// ---------------- Arranque ----------------
(async function boot() {
  try { store = await createStore(); } catch { app.innerHTML = `<div class="center pad">No se pudo iniciar. Recarga la página.</div>`; return; }
  await store.init();
  if (store.mode === "demo") store.watchFamily((f) => { if (!f) store.saveFamily(famPayload(familyFromConfig())); else if (applyFamily(f)) { resolveMe(); subscribeAll(); render(); } });
  let famUnsub = null;
  store.onUser((u) => {
    S.user = u;
    if (store.mode !== "demo") {
      famUnsub && famUnsub(); famUnsub = null; famSig = "";
      if (u) famUnsub = store.watchFamily((f) => {
        if (!f && u.email === ADMIN) { store.saveFamily(famPayload(familyFromConfig())).catch((e) => toast("No se pudo crear la familia: " + e.code)); return; }
        applyFamily(f || familyFromConfig()); resolveMe(); subscribeAll(); render();
      }, () => { applyFamily(familyFromConfig()); resolveMe(); subscribeAll(); render(); });
    }
    resolveMe(); subscribeAll(); render();
  });
  window.addEventListener("hashchange", () => { closeSheet(); render(); });
  try { if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {}); } catch {}
})();

function resolveMe() {
  S.me = null; S.kind = null;
  if (!S.user) return;
  const m = [...CFG.adults, ...CFG.kids].find((x) => x.email && x.email.toLowerCase() === S.user.email);
  S.needsVerify = store.mode !== "demo" && m && !m.sinVerificar && S.user.verified === false;
  const a = adultByEmail(S.user.email);
  if (a) { S.me = a; S.kind = "adult"; return; }
  const k = CFG.kids.find((k) => k.email && k.email.toLowerCase() === S.user.email);
  if (k) { S.me = k; S.kind = "kid"; }
}

function subscribeAll() {
  S.unsubs.forEach((u) => u && u()); S.unsubs = []; S.ledgers = {}; S.kids = {}; S.obl = []; S.oblLoaded = false;
  if (!S.me) return;
  const onErr = (e) => toast("Sin permiso o sin conexión: " + (e.code || e.message));
  if (S.kind === "adult") {
    for (const o of CFG.adults) {
      if (o.id === S.me.id) continue;
      const lid = ledgerId(S.me.email, o.email);
      S.unsubs.push(store.watchLedger(lid, (movs) => { S.ledgers[o.id] = movs; genRecurring(lid, movs); render(); }, onErr));
    }
    S.unsubs.push(store.watchCompras((rows) => { S.compras = rows; render(); }, onErr));
    S.unsubs.push(store.watchMine(S.me.email, (rows) => { S.obl = rows; const first = !S.oblLoaded; S.oblLoaded = true; render(); if (first) setTimeout(maybeAlert, 900); }, onErr));
  }
  const kids = S.kind === "adult" ? CFG.kids : [S.me];
  for (const k of kids) {
    S.kids[k.id] = { movs: [], metas: [], solicitudes: [] };
    for (const sub of ["movs", "metas", "solicitudes"])
      S.unsubs.push(store.watchKid(k.id, sub, (rows) => { S.kids[k.id][sub] = rows; render(); }, onErr));
  }
}

// ---------------- Render ----------------
let renderQueued = false;
function render() {
  if (renderQueued) return; renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; draw(); });
}
function draw() {
  const scroll = window.scrollY;
  if (!S.user) { document.body.className = "theme-adult"; app.innerHTML = viewLogin(); return; }
  if (!S.me) { app.innerHTML = viewNoProfile(); return; }
  if (S.needsVerify) { app.innerHTML = viewVerify(); return; }
  const r = location.hash.replace(/^#\/?/, "").split("/");
  if (S.kind === "kid") { document.body.className = "theme-bank"; app.innerHTML = viewKid(S.me.id); }
  else {
    if (r[0] === "panel") { document.body.className = "theme-adult"; app.innerHTML = viewPanel(); }
    else if (r[0] === "par" && adultById(r[1])) { document.body.className = "theme-adult"; app.innerHTML = viewPair(r[1]); }
    else if (r[0] === "kid" && kidById(r[1])) { document.body.className = "theme-bank"; app.innerHTML = viewKid(r[1]); }
    else { document.body.className = "theme-adult"; app.innerHTML = viewHome(r[0] || "cuentas"); }
  }
  if (S.celebrate && location.hash === "#/par/" + S.celebrate) {
    const b = L.netBalance(S.ledgers[S.celebrate] || [], S.me.email);
    if (!Object.values(b).some((v) => Math.abs(v) > L.EPS)) celebrate(adultById(S.celebrate).nombre);
    S.celebrate = null;
  }
  if (draw.lastHash === location.hash) window.scrollTo(0, scroll); else window.scrollTo(0, 0);
  draw.lastHash = location.hash;
}

// ---------------- Login ----------------
function viewLogin() {
  if (store.mode === "demo") {
    const btn = (p, tipo) => `<button class="profile" data-act="demo-login" data-email="${esc(p.email)}"><span class="av">${p.emoji}</span><b>${esc(p.nombre)}</b><small>${tipo}</small></button>`;
    return `<div class="login">
      ${brand()}
      <p class="demo-tag">MODO DEMO · los datos quedan solo en este equipo</p>
      <p class="muted">¿Quién eres?</p>
      <div class="profiles">${CFG.adults.map((a) => btn(a, "Adulto")).join("")}${CFG.kids.filter((k) => k.email).map((k) => btn(k, "Mi banco")).join("")}</div>
    </div>`;
  }
  const reg = signupMode;
  return `<form class="login" data-form="login">
    ${brand()}
    ${reg ? `<p class="muted">Crea tu cuenta con el correo con el que te invitaron.</p>` : ""}
    <label>Correo<input name="email" type="email" autocomplete="username" required></label>
    <label>Contraseña<input name="pw" type="password" autocomplete="${reg ? "new-password" : "current-password"}" minlength="6" required></label>
    <button class="btn primary block">${reg ? "Crear mi cuenta" : "Entrar"}</button>
    <button type="button" class="link" data-act="toggle-signup">${reg ? "Ya tengo cuenta" : "¿Te invitaron? Crea tu cuenta"}</button>
    ${reg ? "" : `<button type="button" class="link" data-act="reset-pw">Olvidé mi contraseña</button>`}
  </form>`;
}
const viewNoProfile = () => `<div class="login"><div class="logo">🤔</div><h2>Aún no estás en la familia</h2>
  <p class="muted">${esc(S.user.email)} no ha sido invitado. Pídele al administrador que te invite con este correo.</p><button class="btn" data-act="logout">Salir</button></div>`;
const viewVerify = () => `<div class="login"><div class="logo">✉️</div><h2>Confirma tu correo</h2>
  <p class="muted">Te enviamos un enlace a <b>${esc(S.user.email)}</b>. Ábrelo y luego toca "Ya confirmé".</p>
  <button class="btn primary block" data-act="verified">Ya confirmé</button><button class="btn block" data-act="resend">Reenviar correo</button><button class="link" data-act="logout">Salir</button></div>`;

let signupMode = false;
const brand = () => `<div class="brand"><div class="crest">F</div><h1>${esc(CFG.appName)}</h1><div class="rule"></div></div>`;

// ---------------- Adulto: inicio ----------------
function balanceWith(otherId) { return L.netBalance(S.ledgers[otherId] || [], S.me.email); }

function viewHome(tab) {
  const others = CFG.adults.filter((a) => a.id !== S.me.id);
  const tot = {};
  others.forEach((o) => { const b = balanceWith(o.id); for (const c in b) tot[c] = (tot[c] || 0) + b[c]; });
  let body = "";
  if (tab === "cuentas") {
    const resumen = Object.keys(tot).filter((c) => Math.abs(tot[c]) > L.EPS);
    body = `<section class="hero">
        <small>Mi posición neta</small>
        ${resumen.length ? resumen.map((c) => `<div class="big ${tot[c] >= 0 ? "pos" : "neg"}">${tot[c] >= 0 ? "+" : "−"}${money(Math.abs(tot[c]), c)}</div>`).join("") : `<div class="big">Paz y salvo 🙌</div>`}
        <small class="muted">Positivo: te deben · Negativo: debes</small>
      </section>
      <div class="actions"><a class="btn" href="#/panel">📊 Panel del mes</a><button class="btn" data-act="split">➗ Gasto entre varios</button></div>
      <h3 class="sec">Mis cuentas con…</h3>
      ${others.map((o) => {
        const b = balanceWith(o.id); const cs = Object.keys(b).filter((c) => Math.abs(b[c]) > L.EPS);
        const pend = L.debtStatus(S.ledgers[o.id] || []).filter((d) => d.saldo > L.EPS && (!d.plan || d.fecha <= today())).length;
        return `<a class="card row" href="#/par/${o.id}">
          <span class="av">${o.emoji}</span>
          <span class="grow"><b>${esc(o.nombre)}</b><small class="muted">${pend ? pend + " pendiente" + (pend > 1 ? "s" : "") : "Sin pendientes"}</small></span>
          <span class="amt">${cs.length ? cs.map((c) => `<span class="${b[c] > 0 ? "pos" : "neg"}">${b[c] > 0 ? "Te debe" : "Le debes"} ${money(Math.abs(b[c]), c)}</span>`).join("") : `<span class="muted">Paz y salvo</span>`}</span>
        </a>`;
      }).join("")}
      <p class="hint">🔒 Solo ves tus cuentas con cada persona. Lo que otros se deben entre ellos no aparece aquí.</p>`;
  } else if (tab === "mercado") {
    body = viewMercado();
  } else if (tab === "pagos") {
    body = viewObligaciones();
  } else if (tab === "ninos") {
    body = `<h3 class="sec">Ahorros de los niños</h3>` + CFG.kids.map((k) => {
      const kd = S.kids[k.id] || { movs: [], solicitudes: [] };
      const b = L.kidBalances(kd.movs).total;
      const pend = kd.solicitudes.filter((s) => s.estado === "pendiente").length;
      return `<a class="card kidcard" href="#/kid/${k.id}" style="--kc:${k.color}">
        <span class="av">${k.emoji}</span><span class="grow"><b>${esc(k.nombre)}</b>
        ${CFG.currencies.map((c) => `<small>${c}: <b>${money(b[c] || 0, c)}</b></small>`).join("")}</span>
        ${pend ? `<span class="badge">${pend} solicitud${pend > 1 ? "es" : ""}</span>` : `<span class="chev">›</span>`}
      </a>`;
    }).join("");
  } else {
    body = `<h3 class="sec">Más</h3>
      <div class="card list">
        <div class="li"><span>Usuario</span><b>${esc(S.me.nombre)} · ${esc(S.user.email)}</b></div>
        <div class="li"><span>Modo</span><b>${store.mode === "demo" ? "Demo (local)" : "En línea (Firebase)"}</b></div>
        <div class="li"><span>Versión</span><b>${APP_VERSION}</b></div>
      </div>
      <h3 class="sec">Familia</h3>
      <div class="card list">${CFG.adults.map((a) => memberLine(a, "Adulto")).join("")}${CFG.kids.map((k) => memberLine(k, "Niño")).join("")}</div>
      ${S.me.email === ADMIN ? `<button class="btn primary block" data-act="invite">＋ Invitar a un familiar</button>` : `<p class="hint">Solo ${esc(adultByEmail(ADMIN)?.nombre || "el administrador")} puede invitar miembros.</p>`}
      <h3 class="sec">Ajustes</h3>
      <div class="stack">
        <button class="btn block" data-act="backup">📗 Descargar respaldo en Excel</button>
        ${deferredInstall ? `<button class="btn primary block" data-act="install">📲 Instalar app</button>` : `<button class="btn block" data-act="install-help">📲 Cómo instalar en el celular</button>`}
        ${"Notification" in window && Notification.permission !== "granted" ? `<button class="btn block" data-act="notif">🔔 Activar avisos del celular</button>` : ""}
        ${store.changePassword ? `<button class="btn block" data-act="change-pw">🔑 Cambiar contraseña</button>` : ""}
        <button class="btn block" data-act="rules">🛡️ Ver reglas de seguridad (para Firebase)</button>

        ${store.mode === "demo" ? `<button class="btn block" data-act="reset-demo">♻️ Reiniciar datos demo</button>` : ""}
        <button class="btn block danger" data-act="logout">Cerrar sesión</button>
      </div>`;
  }
  const t = (id, ic, lb) => `<a href="#/${id}" class="${tab === id ? "on" : ""}"><span>${ic}</span>${lb}</a>`;
  return `<header class="top"><span class="av sm">${S.me.emoji}</span><div><small class="muted">Hola,</small><b>${esc(S.me.nombre)}</b></div>${store.mode === "demo" ? `<span class="demo-pill">DEMO</span>` : ""}</header>
    <main class="pad">${body}</main>
    <nav class="tabs">${t("cuentas", "🤝", "Cuentas")}${t("pagos", `📅${alertCount() ? `<i class="tb">${alertCount()}</i>` : ""}`, "Pagos")}${t("mercado", "🛒", "Mercado")}${t("ninos", "🐷", "Niños")}${t("mas", "⚙️", "Más")}</nav>`;
}

// ---------------- Adulto: cuenta con otra persona ----------------
function viewPair(oid) {
  const o = adultById(oid), movs = S.ledgers[oid] || [];
  const st = L.debtStatus(movs), b = L.netBalance(movs, S.me.email);
  const pend = st.filter((d) => d.saldo > L.EPS).sort((a, z) => z.fecha.localeCompare(a.fecha));
  const cs = Object.keys(b).filter((c) => Math.abs(b[c]) > L.EPS);
  const hoy = today();
  const vencido = {}; // neto exigible hoy (sin cuotas futuras)
  pend.filter((d) => d.fecha <= hoy).forEach((d) => { vencido[d.moneda] = L.round((vencido[d.moneda] || 0) + (d.acreedor === S.me.email ? d.saldo : -d.saldo)); });
  const sueltos = pend.filter((d) => !d.plan);
  const planes = plansOf(st).filter((p) => p.falta > L.EPS);
  const recs = movs.filter((m) => m.tipo === "recurrente" && !m.anulado);
  const condonables = pend.filter((d) => d.acreedor === S.me.email);
  const hist = [...movs].filter((m) => !(m.tipo === "deuda" && m.plan && m.plan.i !== 1)).sort((a, z) => (z.fecha || "").localeCompare(a.fecha || "") || z.creadoEn - a.creadoEn);
  const debtLine = (d) => {
    const yoDebo = d.deudor === S.me.email;
    return `<div class="li tap" data-act="mov" data-oid="${oid}" data-id="${d.id}">
      <span class="dot ${yoDebo ? "neg" : "pos"}"></span>
      <span class="grow"><b>${esc(d.concepto || "Sin concepto")}</b><small class="muted">${fdate(d.fecha)} · ${yoDebo ? "Tú debes" : esc(o.nombre) + " debe"}${d.abonado ? ` · abonado ${money(d.abonado, d.moneda)}` : ""}${d.porConfirmar ? ` · <span class="warn">valor por confirmar</span>` : ""}</small></span>
      <b class="${yoDebo ? "neg" : "pos"}">${money(d.saldo, d.moneda)}</b></div>`;
  };
  return `<header class="top"><a href="#/cuentas" class="back">‹</a><span class="av sm">${o.emoji}</span><div><small class="muted">Cuenta con</small><b>${esc(o.nombre)}</b></div></header>
  <main class="pad">
    <section class="hero">
      ${cs.length ? cs.map((c) => b[c] > 0
        ? `<small>${esc(o.nombre)} te debe en total</small><div class="big pos">${money(b[c], c)}</div>${dueLine(vencido[c], b[c], c)}`
        : `<small>Le debes a ${esc(o.nombre)} en total</small><div class="big neg">${money(-b[c], c)}</div>${dueLine(vencido[c], b[c], c)}`).join("")
      : `<div class="big">Paz y salvo 🙌</div><small class="muted">No hay pendientes entre ustedes</small>`}
    </section>
    <div class="actions">
      <button class="btn primary" data-act="new-debt" data-oid="${oid}">＋ Pendiente</button>
      <button class="btn" data-act="settle" data-oid="${oid}" ${pend.length ? "" : "disabled"}>💸 Pagar / cruzar</button>
      <button class="btn" data-act="forgive" data-oid="${oid}" ${condonables.length ? "" : "disabled"}>🎁 Condonar</button>
      ${Object.values(b).some((v) => v > L.EPS) ? `<button class="btn wa-o" data-act="remind" data-oid="${oid}">💬 Recordarle a ${esc(o.nombre)}</button>` : ""}
    </div>
    ${recs.length ? `<h3 class="sec">Se repiten cada mes (${recs.length})</h3><div class="card list">${recs.map((r) => `<div class="li tap" data-act="mov" data-oid="${oid}" data-id="${r.id}"><span class="ic">🔁</span><span class="grow"><b>${esc(r.concepto)}</b><small class="muted">${r.deudor === S.me.email ? "Tú pagas" : esc(o.nombre) + " paga"} · día ${+r.desde.slice(8)} de cada mes${r.grupo ? " · compartido" : ""}</small></span><b>${r.variable ? "≈ " : ""}${money(r.monto, r.moneda)}</b></div>`).join("")}</div>` : ""}
    ${planes.length ? `<h3 class="sec">Deudas a cuotas (${planes.length})</h3>${planes.map((p) => planCard(p, oid)).join("")}` : ""}
    <h3 class="sec">Pendientes (${sueltos.length})</h3>
    <div class="card list">${sueltos.length ? sueltos.map(debtLine).join("") : `<div class="li muted">Nada pendiente</div>`}</div>
    <h3 class="sec">Historial</h3>
    <div class="card list">${hist.length ? hist.map((m) => histLine(m, oid)).join("") : `<div class="li muted">Aún no hay movimientos</div>`}</div>
  </main>`;
}
const dueLine = (v, total, c) => {
  v = v || 0;
  if (Math.abs(v - total) < L.EPS) return "";
  return `<small>${Math.abs(v) < L.EPS ? "Nada vencido hoy" : (v > 0 ? "Vencido a tu favor hoy: " : "Vencido hoy: ") + money(Math.abs(v), c)} · el resto son cuotas futuras</small>`;
};
const addMonths = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1 + n, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
// Agrupa las cuotas por plan
function plansOf(st) {
  const g = {};
  for (const d of st) if (d.plan) (g[d.plan.id] = g[d.plan.id] || []).push(d);
  const hoy = today();
  return Object.values(g).map((cuotas) => {
    cuotas.sort((a, z) => a.plan.i - z.plan.i);
    const f = cuotas[0], abiertas = cuotas.filter((c) => c.saldo > L.EPS);
    const venc = abiertas.filter((c) => c.fecha <= hoy);
    return {
      id: f.plan.id, nombre: f.plan.nombre, n: f.plan.n, moneda: f.moneda, deudor: f.deudor, acreedor: f.acreedor, cuotas,
      total: L.round(cuotas.reduce((s, c) => s + c.monto, 0)),
      falta: L.round(abiertas.reduce((s, c) => s + c.saldo, 0)),
      pagadas: cuotas.length - abiertas.length,
      vencidas: venc.length, vencido: L.round(venc.reduce((s, c) => s + c.saldo, 0)),
      proxima: abiertas.find((c) => c.fecha > hoy),
    };
  });
}
function planCard(p, oid) {
  const yoDebo = p.deudor === S.me.email, pct = Math.round((1 - p.falta / p.total) * 100);
  return `<div class="card plan tap" data-act="plan" data-oid="${oid}" data-id="${p.id}">
    <div class="row"><span class="gi">💳</span><span class="grow"><b>${esc(p.nombre)}</b><small class="muted">${yoDebo ? "Tú debes" : esc(adultById(oid).nombre) + " debe"} · ${p.pagadas} de ${p.n} cuotas pagadas</small></span>
    <span class="amt"><small class="muted">Falta</small><b class="${yoDebo ? "neg" : "pos"}">${money(p.falta, p.moneda)}</b></span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <small>${p.vencidas ? `<b class="neg">${p.vencidas} cuota${p.vencidas > 1 ? "s" : ""} vencida${p.vencidas > 1 ? "s" : ""}: ${money(p.vencido, p.moneda)}</b>` : `<span class="pos">Al día ✓</span>`}${p.proxima ? ` · Próxima: ${fdate(p.proxima.fecha)} (${money(p.proxima.saldo, p.moneda)})` : ""}</small>
  </div>`;
}
function sheetPlan(oid, pid) {
  const movs = S.ledgers[oid] || [], p = plansOf(L.debtStatus(movs)).find((x) => x.id === pid); if (!p) return;
  const hoy = today(), canAnnul = p.cuotas[0].creadoPor === S.me.email;
  const libres = p.cuotas.filter((c) => !c.abonado);
  sheet(`<h2>💳 ${esc(p.nombre)}</h2>
    <div class="card list flat">
      <div class="li"><span>Total</span><b>${money(p.total, p.moneda)}</b></div>
      <div class="li"><span>Pagado</span><b class="pos">${money(p.total - p.falta, p.moneda)}</b></div>
      <div class="li"><span>Falta</span><b class="neg">${money(p.falta, p.moneda)}</b></div>
      <div class="li"><span>Vencido hoy</span><b>${money(p.vencido, p.moneda)}</b></div>
    </div>
    <h3 class="sec">Cuotas</h3>
    <div class="card list flat">${p.cuotas.map((c) => {
      const est = c.saldo < L.EPS ? `<span class="pos">Pagada ✓</span>` : c.abonado ? `<span class="warn">Abonada · falta ${money(c.saldo, c.moneda)}</span>` : c.fecha <= hoy ? `<span class="neg">Vencida</span>` : `<span class="muted">Próxima</span>`;
      return `<div class="li"><span class="ic">${c.plan.i}</span><span class="grow"><b>${fdate(c.fecha)}</b><small>${est}</small></span><b>${money(c.monto, c.moneda)}</b></div>`;
    }).join("")}</div>
    <p class="muted small">Para pagar usa "Pagar / cruzar": ya vienen marcadas las cuotas vencidas y puedes marcar más para adelantar.</p>
    ${canAnnul && libres.length ? `<button class="btn danger block" id="annulPlan">Anular las ${libres.length} cuota(s) sin pagos</button>` : ""}`);
  const b = document.getElementById("annulPlan");
  if (b) b.onclick = async () => {
    if (!(await ask(`¿Anular ${libres.length} cuota(s) sin pagos de "${p.nombre}"?`))) return;
    const lid = ledgerId(S.me.email, adultById(oid).email);
    for (const c of libres) await store.annulLedgerMov(lid, c.id);
    closeSheet(); toast("Cuotas anuladas");
  };
}

function histLine(m, oid) {
  if (m.tipo === "recurrente") return `<div class="li tap ${m.anulado ? "void" : ""}" data-act="mov" data-oid="${oid}" data-id="${m.id}"><span class="ic">🔁</span><span class="grow"><b>${esc(m.concepto)}</b><small class="muted">Mensual desde ${fdate(m.desde)} · ${esc(nameOf(m.deudor))} paga a ${esc(nameOf(m.acreedor))}${m.anulado ? " · DETENIDO" : ""}</small></span><b>${m.variable ? "≈ " : ""}${money(m.monto, m.moneda)}</b></div>`;
  if (m.tipo === "deuda" && m.plan) return `<div class="li tap" data-act="plan" data-oid="${oid}" data-id="${m.plan.id}">
    <span class="ic">💳</span><span class="grow"><b>${esc(m.plan.nombre)}</b><small class="muted">${fdate(m.fecha)} · ${m.plan.n} cuotas · ${esc(nameOf(m.deudor))} debe a ${esc(nameOf(m.acreedor))}</small></span>
    <b>${m.plan.n} × ${money(m.monto, m.moneda)}</b></div>`;
  const ic = { deuda: "🧾", pago: "💸", condonacion: "🎁" }[m.tipo];
  const lb = m.tipo === "deuda" ? `${nameOf(m.deudor)} debe a ${nameOf(m.acreedor)}`
    : m.tipo === "pago" ? (m.monto > 0 ? `${nameOf(m.deudor)} pagó a ${nameOf(m.acreedor)}` : "Cruce de cuentas")
    : `${nameOf(m.acreedor)} condonó a ${nameOf(m.deudor)}`;
  return `<div class="li tap ${m.anulado ? "void" : ""}" data-act="mov" data-oid="${oid}" data-id="${m.id}">
    <span class="ic">${ic}</span><span class="grow"><b>${esc(m.concepto || lb)}</b><small class="muted">${fdate(m.fecha)} · ${esc(lb)}${m.tipo !== "deuda" ? ` · ${m.aplica?.length || 0} pendiente(s)` : ""}${m.anulado ? " · ANULADO" : ""}</small></span>
    <b>${money(m.monto, m.moneda)}</b></div>`;
}

// ---------------- Pendientes mensuales compartidos ----------------
// Una "plantilla" (tipo recurrente) genera cada mes un pendiente con id fijo plantilla_AAAA-MM (no se duplica).
const genDone = new Set();
function genRecurring(lid, movs) {
  const ids = new Set(movs.map((m) => m.id)), hoy = today();
  for (const t of movs.filter((m) => m.tipo === "recurrente" && !m.anulado)) {
    for (let k = 0; k < 60; k++) {
      const f = addMonths(t.desde, k); if (f > hoy) break;
      const id = `${t.id}_${f.slice(0, 7)}`;
      if (ids.has(id) || genDone.has(id)) continue;
      genDone.add(id);
      const mes = new Date(f + "T00:00").toLocaleDateString("es-CO", { month: "short", year: "numeric" });
      store.setLedgerMov(lid, id, { tipo: "deuda", deudor: t.deudor, acreedor: t.acreedor, monto: t.monto, moneda: t.moneda, concepto: `${t.concepto} · ${mes}`, fecha: f, rec: { id: t.id, nombre: t.concepto }, porConfirmar: !!t.variable, ...(t.grupo ? { grupo: t.grupo } : {}) }).catch(() => {});
    }
  }
}

// ---------------- Obligaciones (pagos y cobros con cualquiera) ----------------
// Privadas: solo las ve quien las crea.
const diasA = (iso) => Math.round((new Date(iso + "T00:00") - new Date(today() + "T00:00")) / 864e5);
const cuando = (iso) => { const d = diasA(iso); return d < -1 ? `venció hace ${-d} días` : d === -1 ? "venció ayer" : d === 0 ? "vence HOY" : d === 1 ? "vence mañana" : `en ${d} días`; };
const oblPend = () => S.obl.filter((o) => o.estado === "pendiente");
function familyDue() { // cuotas y mensualidades vencidas con la familia (debo / me deben / valor por confirmar)
  const out = [];
  for (const a of CFG.adults) {
    if (a.id === S.me?.id) continue;
    const st = L.debtStatus(S.ledgers[a.id] || []).filter((d) => d.saldo > L.EPS && (d.plan || d.rec) && d.fecha <= today());
    const conf = st.filter((d) => d.porConfirmar);
    for (const [dir, arr] of [["debo", st.filter((d) => d.deudor === S.me.email && !d.porConfirmar)], ["meDeben", st.filter((d) => d.acreedor === S.me.email && !d.porConfirmar)], ["confirmar", conf]])
      if (arr.length) out.push({ a, dir, n: arr.length, total: L.round(arr.reduce((x, d) => x + d.saldo, 0)), moneda: arr[0].moneda });
  }
  return out;
}
const famLine = (f, cls = "li") => {
  const t = f.dir === "debo" ? [`Le debes a ${esc(f.a.nombre)}`, `${f.n} cuota(s)/mes(es) vencido(s) · toca para pagar`, "neg"]
    : f.dir === "meDeben" ? [`${esc(f.a.nombre)} te debe`, `${f.n} cuota(s)/mes(es) vencido(s)`, "pos"]
    : [`Confirmar valor con ${esc(f.a.nombre)}`, `${f.n} recibo(s) con valor por confirmar`, "warn"];
  return `<a class="${cls}" href="#/par/${f.a.id}"><span class="ic">${f.dir === "confirmar" ? "✏️" : "💳"}</span><span class="grow"><b>${t[0]}</b><small class="muted">${t[1]}</small></span><b class="${t[2]}">${f.dir === "confirmar" ? "≈ " : ""}${money(f.total, f.moneda)}</b></a>`;
};
const AVISO = 3; // días de anticipación
function alertCount() { if (S.kind !== "adult") return 0; return oblPend().filter((o) => diasA(o.vence) <= AVISO).length + familyDue().length + (backupDue() ? 1 : 0); }

function viewObligaciones() {
  const p = oblPend().sort((a, z) => a.vence.localeCompare(z.vence));
  const venc = p.filter((o) => diasA(o.vence) < 0), prox = p.filter((o) => diasA(o.vence) >= 0 && diasA(o.vence) <= 30), luego = p.filter((o) => diasA(o.vence) > 30);
  const pagadas = S.obl.filter((o) => o.estado === "pagada").sort((a, z) => (z.pagadaEn || 0) - (a.pagadaEn || 0)).slice(0, 10);
  const fam = familyDue();
  const tot = (arr, tipo) => { const t = {}; arr.filter((o) => o.tipo === tipo).forEach((o) => (t[o.moneda] = (t[o.moneda] || 0) + o.monto)); return Object.entries(t).map(([c, v]) => money(v, c)).join(" · ") || money(0); };
  const line = (o) => `<div class="li tap" data-act="obl" data-id="${o.id}">
    <span class="ic">${o.tipo === "cobrar" ? "📥" : "📤"}</span>
    <span class="grow"><b>${esc(o.concepto)}</b><small class="muted">${o.tipo === "cobrar" ? "Me debe" : "A"}: ${esc(o.contraparte || "—")} · ${fdate(o.vence)} · <span class="${diasA(o.vence) < 0 ? "neg" : diasA(o.vence) <= AVISO ? "warn" : ""}">${cuando(o.vence)}</span>${o.recurrente === "mensual" ? " · 🔁 mensual" : ""}${o.variable ? " · valor variable" : ""}</small></span>
    <b class="${o.tipo === "cobrar" ? "pos" : "neg"}">${o.variable ? (o.monto ? "≈ " + money(o.monto, o.moneda) : "Por confirmar") : money(o.monto, o.moneda)}</b></div>`;
  const block = (t, arr) => arr.length ? `<h3 class="sec">${t} (${arr.length})</h3><div class="card list">${arr.map(line).join("")}</div>` : "";
  return `<section class="hero"><small>Por pagar (próx. 30 días)</small><div class="big neg">${tot([...venc, ...prox], "pagar")}</div><small>Por cobrar: ${tot([...venc, ...prox], "cobrar")}</small></section>
    <div class="actions"><button class="btn primary" data-act="obl-new">＋ Obligación</button><button class="btn" data-act="alerts">🔔 Ver alertas</button></div>
    ${fam.length ? `<h3 class="sec">Vencido con la familia</h3><div class="card list">${fam.map((f) => famLine(f)).join("")}</div>` : ""}
    ${block("⚠️ Vencidas", venc)}${block("Próximas 30 días", prox)}${block("Más adelante", luego)}
    ${!p.length && !fam.length ? `<div class="card li muted center">No tienes obligaciones pendientes 🎉</div>` : ""}
    ${pagadas.length ? `<h3 class="sec">Pagadas recientes</h3><div class="card list">${pagadas.map((o) => `<div class="li tap void-soft" data-act="obl" data-id="${o.id}"><span class="ic">✅</span><span class="grow"><b>${esc(o.concepto)}</b><small class="muted">${esc(o.contraparte || "")} · pagada ${o.pagadaFecha ? fdate(o.pagadaFecha) : ""}</small></span><b>${money(o.monto, o.moneda)}</b></div>`).join("")}</div>` : ""}
    <p class="hint">🔒 Esta lista es solo tuya: nadie más de la familia la ve.</p>`;
}

function sheetObl(id) {
  const o = id ? S.obl.find((x) => x.id === id) : null;
  const w = sheet(`<h2>${o ? "Obligación" : "Nueva obligación"}</h2><form>
    <div class="seg"><label><input type="radio" name="tipo" value="pagar" ${o?.tipo !== "cobrar" ? "checked" : ""}><span>📤 Yo debo pagar</span></label><label><input type="radio" name="tipo" value="cobrar" ${o?.tipo === "cobrar" ? "checked" : ""}><span>📥 Me deben a mí</span></label></div>
    <label>Concepto<input name="concepto" required maxlength="60" value="${esc(o?.concepto || "")}" placeholder="Ej: tarjeta Visa, préstamo, arriendo"></label>
    <label>¿Con quién?<input name="contraparte" maxlength="60" value="${esc(o?.contraparte || "")}" placeholder="Ej: Bancolombia, Juan, administración"></label>
    <div class="row2"><label>Monto <small class="muted" style="display:inline">(aprox. si varía)</small><input name="monto" inputmode="decimal" placeholder="0" value="${o?.monto || ""}" autocomplete="off"></label><label>Moneda${curSelect("moneda", o?.moneda)}</label></div>
    <label class="chkline"><input type="checkbox" name="variable" ${o?.variable ? "checked" : ""}> El valor cambia cada mes (servicios, etc.): me lo pregunta al pagar</label>
    ${o ? attBlock(o.adjuntos, true) : ""}
    <div class="row2"><label>Vence<input name="vence" type="date" required value="${o?.vence || today()}"></label><label>Se repite<select name="recurrente"><option value="no">No</option><option value="mensual" ${o?.recurrente === "mensual" ? "selected" : ""}>Cada mes</option></select></label></div>
    ${o ? "" : fileField()}
    <button class="btn primary block">Guardar</button>
    ${o && o.estado === "pendiente" ? `<button type="button" class="btn block ok" id="paid">✅ Ya ${o.tipo === "cobrar" ? "me pagaron" : "la pagué"}</button>` : ""}
    ${o && o.estado === "pagada" ? `<button type="button" class="btn block" id="unpaid">↩️ Marcar como NO pagada</button>` : ""}
    ${o ? `<button type="button" class="btn danger block" id="del">Eliminar</button>` : ""}</form>`,
    async (v, form) => {
      const variable = !!v.variable, monto = num(v.monto);
      if (monto <= 0 && !variable) throw new Error("Monto inválido (o marca que el valor cambia)");
      const adj = o ? [] : await uploadFrom(form, ["users", S.me.email]);
      const data = { ...(adj.length ? { adjuntos: adj } : {}), tipo: v.tipo, concepto: v.concepto.trim(), contraparte: v.contraparte.trim(), monto: L.round(monto), variable, moneda: v.moneda, vence: v.vence, recurrente: v.recurrente };
      o ? await store.updateMine(S.me.email, o.id, data) : await store.addMine(S.me.email, { ...data, estado: "pendiente" });
      toast("Guardado");
    });
  const q = (x) => w.querySelector(x);
  wirePreview(w);
  if (o) wireAtt(w, ["users", S.me.email], o.adjuntos || [], (ids) => store.updateMine(S.me.email, o.id, { adjuntos: ids }));
  if (q("#paid")) q("#paid").onclick = async () => { if ((await markPaid(o)) !== false) closeSheet(); };
  if (q("#unpaid")) q("#unpaid").onclick = async () => { await store.updateMine(S.me.email, o.id, { estado: "pendiente", pagadaEn: null, pagadaFecha: null }); closeSheet(); toast("Marcada como pendiente"); };
  if (q("#del")) q("#del").onclick = async () => { if (!(await ask("¿Eliminar esta obligación?"))) return; await store.deleteMine(S.me.email, o.id); closeSheet(); };
}
async function markPaid(o) {
  let monto = o.monto;
  if (o.variable) {
    const r = await ask(`¿Cuánto ${o.tipo === "cobrar" ? "te pagaron" : "pagaste"} de "${o.concepto}"?${o.monto ? ` (último: ${money(o.monto, o.moneda)})` : ""}`, "text");
    if (r === null) return false;
    monto = L.round(num(r)); if (monto <= 0) { toast("Monto inválido"); return false; }
  }
  await store.updateMine(S.me.email, o.id, { estado: "pagada", pagadaEn: Date.now(), pagadaFecha: today(), monto });
  o = { ...o, monto }; // la próxima toma este valor como referencia
  if (o.recurrente === "mensual") {
    const { id, estado, pagadaEn, pagadaFecha, creadoEn, creadoPor, adjuntos, ...rest } = o;
    await store.addMine(S.me.email, { ...rest, vence: addMonths(o.vence, 1), estado: "pendiente" });
    toast(`Pagada ✅ · próxima: ${fdate(addMonths(o.vence, 1))}`);
  } else toast("Pagada ✅");
}

// Ventana de alertas: al abrir la app (1 vez al día) o desde el botón 🔔
function maybeAlert() {
  if (S.kind !== "adult" || !alertCount()) return;
  const k = "ff_alert_" + S.me.id;
  let last = null; try { last = localStorage.getItem(k); } catch {}
  if (last === today()) return;
  try { localStorage.setItem(k, today()); } catch {}
  showAlerts();
  notifyOS();
}
function showAlerts() {
  const items = oblPend().filter((o) => diasA(o.vence) <= AVISO).sort((a, z) => a.vence.localeCompare(z.vence));
  const fam = familyDue();
  if (!items.length && !fam.length && !backupDue()) { toast("No hay alertas 🎉"); return; }
  const w = sheet(`<h2>🔔 Pendientes por revisar</h2><p class="muted small">¿Ya se pagaron? Márcalo para que no te vuelva a avisar.</p>
    <div id="al">${items.map((o) => `<div class="card alert-it" data-id="${o.id}">
      <div class="row"><span class="ic">${o.tipo === "cobrar" ? "📥" : "📤"}</span><span class="grow"><b>${esc(o.concepto)}</b><small class="muted">${esc(o.contraparte || "")} · <span class="${diasA(o.vence) < 0 ? "neg" : "warn"}">${cuando(o.vence)}</span></small></span><b>${money(o.monto, o.moneda)}</b></div>
      <div class="dlg-b"><button class="btn sm ok" data-al="si">✅ ${o.tipo === "cobrar" ? "Ya me pagaron" : "Ya pagué"}</button><button class="btn sm" data-al="no">Aún no</button></div></div>`).join("")}
    ${fam.map((f) => famLine(f, "card alert-it row")).join("")}
    ${backupDue() ? `<button class="card alert-it row bk" data-act="backup"><span class="ic">📗</span><span class="grow"><b>Respaldo de ${mesNom(ym(today()))}</b><small class="muted">Descarga tu copia mensual en Excel</small></span><span class="chev">›</span></button>` : ""}</div>
    <button class="btn block" data-close>Cerrar</button>`);
  w.querySelector("#al").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-al]"); if (!b) return;
    const card = b.closest("[data-id]"), o = S.obl.find((x) => x.id === card.dataset.id);
    if (b.dataset.al === "si" && (await markPaid(o)) === false) return;
    card.remove();
    if (!w.querySelector(".alert-it")) closeSheet();
  });
}
// Notificación del sistema (solo cuando la app está abierta; requiere permiso)
function notifyOS() {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const n = alertCount();
    navigator.serviceWorker?.ready.then((r) => r.showNotification(CFG.appName, { body: `Tienes ${n} pago(s) por revisar`, icon: "icons/icon-192.png", tag: "ff-alert" })).catch(() => {});
  } catch {}
}

// ---------------- Mercado con IA ----------------
// Facturas compartidas entre los adultos del hogar. La IA lee la foto y clasifica cada producto.
const CAT_IC = { "Frutas y verduras": "🥦", "Carnes y pescados": "🥩", "Lácteos y huevos": "🥚", "Panadería": "🥖", "Granos y despensa": "🍚", "Bebidas": "🧃", "Snacks y dulces": "🍪", "Congelados": "🧊", "Aseo del hogar": "🧴", "Cuidado personal": "🪥", "Mascotas": "🐾", "Bebé": "🍼", "Licores": "🍷", "Otros": "🛍️" };
let mercadoMes = null, aiInsight = {};
function viewMercado() {
  const meses = [...L.prevMonths(ym(today()), 5).reverse(), ym(today())];
  const mes = mercadoMes || ym(today());
  const enCurso = mes === ym(today()), corte = enCurso ? +today().slice(8) : 31;
  const st = L.marketStats(S.compras, mes, corte), cur = CFG.currencies[0];
  const maxCat = Math.max(1, ...st.categorias.map((c) => Math.max(c.total, c.promedio)));
  const maxS = Math.max(1, ...st.serie.map((x) => x.total));
  const chip = (v) => v == null ? `<span class="chip">nuevo</span>` : Math.abs(v) < 5 ? `<span class="chip">≈ igual</span>` : `<span class="chip ${v > 0 ? "up" : "down"}">${v > 0 ? "▲" : "▼"} ${Math.abs(Math.round(v))}%</span>`;
  const lista = S.compras.filter((c) => ym(c.fecha) === mes).sort((a, z) => z.fecha.localeCompare(a.fecha));
  return `<section class="hero"><small>Mercado · ${mesNom(mes)}</small><div class="big">${money(st.totalMes, cur)}</div>
      <small class="muted">${st.compras} compra(s) · ticket promedio ${money(st.ticket, cur)}${st.varMes != null ? ` · ${st.varMes > 0 ? "▲" : "▼"} ${Math.abs(Math.round(st.varMes))}% vs ${mesNom(L.prevMonths(mes, 1)[0])}${enCurso ? ` al día ${corte}` : ""}` : ""}</small></section>
    <div class="actions">
      <label class="btn primary scan">📷 Escanear factura<input type="file" accept="image/*" capture="environment" hidden data-scan></label>
      <button class="btn" data-act="compra-new">✍️ A mano</button>
    </div>
    <div class="months">${meses.map((m) => `<button class="mchip ${m === mes ? "on" : ""}" data-act="mes" data-m="${m}">${mesNom(m)}</button>`).join("")}</div>
    ${st.totalMes || st.categorias.length ? `
    <div class="card ai-card">
      <div class="row"><span class="gi">✨</span><span class="grow"><b>Análisis con IA</b><small class="muted">En qué gastan más, qué cambió y cómo ahorrar</small></span>
      <button class="btn sm primary" data-act="ai-insight" data-m="${mes}">${aiInsight[mes] ? "Actualizar" : "Analizar"}</button></div>
      ${aiInsight[mes] ? `<div class="ai-text">${aiInsight[mes]}</div>` : ""}
    </div>
    <h3 class="sec">¿En qué se va la plata?</h3>
    <div class="card cats">${st.categorias.map((c) => `<div class="cat">
      <div class="row"><span class="ic">${CAT_IC[c.categoria] || "🛍️"}</span><span class="grow"><b>${esc(c.categoria)}</b></span><b>${money(c.total, cur)}</b>${chip(c.variacion)}</div>
      <div class="hbar"><i style="width:${(c.total / maxCat) * 100}%"></i>${c.promedio ? `<u style="left:${(c.promedio / maxCat) * 100}%" title="Promedio 3 meses"></u>` : ""}</div></div>`).join("")}
      <small class="muted legend2"><u></u> línea = promedio de los 3 meses anteriores${enCurso ? ` (hasta el día ${corte}, para comparar parejo)` : ""}</small></div>
    <h3 class="sec">Tendencia 6 meses</h3>
    <div class="card chart"><div class="bars sm">${st.serie.map((x) => `<div class="bcol"><div class="bpair"><i class="${x.mes === mes ? "b2" : "b1"}" style="height:${(x.total / maxS) * 100}%;width:60%">${x.total ? `<em>${x.total >= 1e6 ? (x.total / 1e6).toFixed(1) + "M" : Math.round(x.total / 1e3) + "k"}</em>` : ""}</i></div><span>${mesNom(x.mes)}</span></div>`).join("")}</div></div>
    <h3 class="sec">Lo que más compran (90 días)</h3>
    <div class="card list">${st.frecuentes.map((p) => `<div class="li"><span class="ic">${CAT_IC[p.categoria] || "🛍️"}</span><span class="grow"><b class="cap">${esc(p.producto)}</b><small class="muted">${p.veces} ${p.veces === 1 ? "vez" : "veces"}${p.cada ? ` · cada ~${p.cada} días` : ""}</small></span><b>${money(p.gasto, cur)}</b></div>`).join("") || `<div class="li muted">Aún sin datos</div>`}</div>
    ${st.precios.length ? `<h3 class="sec">Precios que cambiaron</h3>
    <div class="card list">${st.precios.map((p) => `<div class="li"><span class="ic">${p.cambio.pct > 0 ? "📈" : "📉"}</span><span class="grow"><b class="cap">${esc(p.producto)}</b><small class="muted">${money(p.cambio.antes, cur)} → ${money(p.cambio.ahora, cur)} por ${p.precios.at(-1).unidad === "kg" ? "kg" : "unidad"}</small></span>${chip(p.cambio.pct)}</div>`).join("")}</div>` : ""}
    ` : `<div class="card li muted center">Aún no hay compras en ${mesNom(mes)}. Toma una foto a la próxima factura 📷</div>`}
    ${lista.length ? `<h3 class="sec">Compras de ${mesNom(mes)} (${lista.length})</h3><div class="card list">${lista.map((c) => `<div class="li tap" data-act="compra" data-id="${c.id}"><span class="ic">🧾</span><span class="grow"><b>${esc(c.tienda || "Compra")}</b><small class="muted">${fdate(c.fecha)} · ${(c.items || []).length} productos · ${esc(nameOf(c.creadoPor))}${c.fotoId ? " · 📎" : ""}</small></span><b>${money(c.total, c.moneda)}</b></div>`).join("")}</div>` : ""}
    <p class="hint">🛒 Las compras del mercado las ven todos los adultos de la casa.</p>`;
}

async function scanReceipt(file) {
  const wait = sheet(`<div class="ai-wait"><div class="spin big"></div><h2>Leyendo la factura…</h2><p class="muted small">La IA está identificando productos, cantidades y precios.</p></div>`);
  try {
    const [foto, paraIA] = await Promise.all([compress(file), compressHi(file)]);
    const r = await store.aiExtract(paraIA);
    if (!r || !Array.isArray(r.items)) throw new Error("No se pudieron leer productos");
    closeSheet();
    sheetCompra(null, { ...r, fecha: r.fecha && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha) ? r.fecha : today(), _foto: foto });
  } catch (e) {
    closeSheet(); console.error(e);
    toast("No se pudo leer con IA: " + (e.message || e.code || "error").slice(0, 80) + ". Regístrala a mano.");
    sheetCompra(null, { items: [], _foto: await compress(file).catch(() => null) });
  }
}
function compressHi(file) { // más resolución para que la IA lea letra pequeña
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const sc = Math.min(1, 1800 / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = img.width * sc; c.height = img.height * sc; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", 0.85)); }; img.onerror = rej; img.src = URL.createObjectURL(file); });
}

function sheetCompra(id, draft) {
  const c = id ? S.compras.find((x) => x.id === id) : draft;
  if (!c) return;
  let items = (c.items || []).map((x) => ({ ...x }));
  const cur = c.moneda || CFG.currencies[0];
  const w = sheet(`<h2>${id ? "Compra" : "Revisa la compra"}</h2>
    ${!id && c._ia ? `<p class="ai-ok">✨ Leída con IA (${c._ia === "simulada" ? "lectura simulada en la demo" : c._ia}). Revisa y corrige si algo no cuadra.</p>` : ""}
    <form>
    <div class="row2"><label>Tienda<input name="tienda" value="${esc(c.tienda || "")}" maxlength="40" placeholder="Ej: Éxito"></label><label>Fecha<input name="fecha" type="date" value="${c.fecha || today()}"></label></div>
    <div class="row2"><label>Total de la factura<input name="total" inputmode="decimal" value="${c.total || ""}"></label><label>Moneda${curSelect("moneda", cur)}</label></div>
    <div id="sumInfo" class="muted small"></div>
    <h3 class="sec">Productos</h3>
    <div id="its" class="items"></div>
    <button type="button" class="btn block" id="addIt">＋ Agregar producto</button>
    ${c.fotoId ? `<div class="thumbs att"><button type="button" class="th" data-att="${c.fotoId}"><span class="spin"></span></button></div>` : c._foto ? `<div class="thumbs"><img src="${c._foto}" alt=""></div>` : ""}
    <button class="btn primary block">${id ? "Guardar cambios" : "Guardar compra"}</button>
    ${id ? `<button type="button" class="btn danger block" id="delC">Eliminar compra</button>` : ""}
    </form>`,
    async (v) => {
      readItems();
      const clean = items.filter((x) => x.descripcion || x.producto).map((x) => ({ descripcion: (x.descripcion || x.producto).trim(), producto: (x.producto || x.descripcion).toLowerCase().trim(), categoria: CATEGORIAS.includes(x.categoria) ? x.categoria : "Otros", cantidad: num(x.cantidad) || 1, unidad: x.unidad || "un", total: L.round(num(x.total)) }));
      const sumItems = L.round(clean.reduce((s2, x) => s2 + x.total, 0));
      const total = num(v.total) || sumItems;
      if (total <= 0) throw new Error("Falta el total");
      const data = { tienda: v.tienda.trim(), fecha: v.fecha || today(), total: L.round(total), moneda: v.moneda, items: clean };
      if (id) { await store.updateCompra(id, data); toast("Compra actualizada"); return; }
      if (c._foto) { try { data.fotoId = await store.addAtt(["hogar", "mercado"], { data: c._foto, nombre: "factura" }); } catch { toast("La foto no se guardó (los datos sí)"); } }
      await store.addCompra(data); toast("Compra guardada 🛒");
    });
  const box = w.querySelector("#its"), f = w.querySelector("form");
  const readItems = () => { items = [...box.querySelectorAll(".it")].map((r) => ({ ...items[+r.dataset.i], descripcion: r.querySelector("[name=d]").value, categoria: r.querySelector("[name=c]").value, total: r.querySelector("[name=t]").value, producto: items[+r.dataset.i]?.producto && items[+r.dataset.i].descripcion === r.querySelector("[name=d]").value ? items[+r.dataset.i].producto : r.querySelector("[name=d]").value })); };
  const draw = () => {
    box.innerHTML = items.map((x, i) => `<div class="it" data-i="${i}"><input name="d" value="${esc(x.descripcion || x.producto || "")}" placeholder="Producto">
      <div class="row2"><select name="c">${CATEGORIAS.map((k) => `<option ${k === x.categoria ? "selected" : ""}>${k}</option>`).join("")}</select><input name="t" inputmode="decimal" value="${x.total ?? ""}" placeholder="$"></div>
      <button type="button" class="rm" data-rm="${i}">✕</button></div>`).join("") || `<p class="muted small">Sin productos (puedes guardar solo el total).</p>`;
    sum();
  };
  const sum = () => {
    const sItems = [...box.querySelectorAll("[name=t]")].reduce((a, i) => a + num(i.value), 0), tot = num(f.total.value);
    w.querySelector("#sumInfo").innerHTML = items.length ? `Suma de productos: <b>${money(sItems, f.moneda.value)}</b>${tot && Math.abs(sItems - tot) > 100 ? ` · <span class="warn">difiere del total en ${money(tot - sItems, f.moneda.value)}</span>` : " ✓"}` : "";
  };
  box.addEventListener("input", sum); f.total.addEventListener("input", sum);
  box.addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; readItems(); items.splice(+b.dataset.rm, 1); draw(); });
  w.querySelector("#addIt").onclick = () => { readItems(); items.push({ descripcion: "", categoria: "Otros", total: "" }); draw(); box.lastElementChild?.querySelector("input")?.focus(); };
  const del = w.querySelector("#delC"); if (del) del.onclick = async () => { if (!(await ask("¿Eliminar esta compra?"))) return; await store.deleteCompra(id); closeSheet(); toast("Eliminada"); };
  if (c.fotoId) wireAtt(w, ["hogar", "mercado"], [c.fotoId]);
  draw();
}

async function runInsight(mes) {
  const enCurso = mes === ym(today());
  const st = L.marketStats(S.compras, mes, enCurso ? +today().slice(8) : 31), cur = CFG.currencies[0];
  const resumen = { mes, nota: enCurso ? `mes en curso: comparaciones hasta el día ${today().slice(8)} de cada mes` : "mes completo", total: st.totalMes, mesAnterior: st.totalAnt, variacionPct: st.varMes, compras: st.compras, ticketPromedio: st.ticket,
    categorias: st.categorias.filter((c) => c.total > 0).map((c) => ({ c: c.categoria, total: c.total, promedio3m: c.promedio, varPct: c.variacion })),
    masFrecuentes: st.frecuentes.map((p) => ({ p: p.producto, veces: p.veces, cadaDias: p.cada, gasto: p.gasto })),
    preciosCambiaron: st.precios.map((p) => ({ p: p.producto, antes: p.cambio.antes, ahora: p.cambio.ahora, pct: p.cambio.pct })) };
  const prompt = `Eres un asesor de finanzas del hogar en Colombia, cálido y práctico. Con estos datos del mercado de una familia (moneda ${cur}) escribe en español, máximo 6 viñetas cortas que empiecen con "• ":
1) en qué se va más la plata y qué cambió frente al promedio, 2) hábitos de frecuencia llamativos, 3) alzas de precio relevantes, 4) 2 o 3 ideas concretas para ahorrar sin sacrificar calidad. Usa cifras redondeadas. Sin títulos ni introducción.
DATOS: ${JSON.stringify(resumen)}`;
  aiInsight[mes] = `<div class="spin"></div>`; render();
  try { const txt = await store.aiText(prompt); aiInsight[mes] = esc(txt.trim()).replace(/\n/g, "<br>"); }
  catch (e) { aiInsight[mes] = ""; toast("La IA no respondió: " + (e.message || e.code || "").slice(0, 80)); }
  render();
}

// ---------------- Banco de los niños ----------------
const acctNo = (id, c) => { let h = 0; for (const ch of id + c) h = (h * 31 + ch.charCodeAt(0)) % 10000; return String(h).padStart(4, "0"); };
let kidCurTab = {};
function viewKid(kid) {
  const k = kidById(kid), kd = S.kids[kid] || { movs: [], metas: [], solicitudes: [] };
  const isAdult = S.kind === "adult";
  const { total, porCustodio } = L.kidBalances(kd.movs);
  const cur = kidCurTab[kid] || CFG.currencies[0];
  const movs = kd.movs.filter((m) => m.moneda === cur).sort((a, z) => (z.fecha || "").localeCompare(a.fecha || "") || z.creadoEn - a.creadoEn);
  const pend = kd.solicitudes.filter((s) => s.estado === "pendiente");
  const otherSol = kd.solicitudes.filter((s) => s.estado !== "pendiente").sort((a, z) => z.creadoEn - a.creadoEn).slice(0, 5);
  const curName = { COP: "Pesos", USD: "Dólares" };
  const custodios = Object.entries(porCustodio).filter(([, v]) => Object.values(v).some((x) => Math.abs(x) > L.EPS));
  return `<header class="bank-top" style="--kc:${k.color}">
    <div class="bank-bar">${isAdult ? `<a href="#/ninos" class="back light">‹</a>` : ""}<span class="bank-name">🏦 ${esc(CFG.bankName)}</span>
      ${isAdult ? "" : `<button class="icon-btn" data-act="logout" title="Salir">⏻</button>`}</div>
    <div class="bank-hello"><span class="av">${k.emoji}</span><div><small>Bienvenido(a)</small><b>${esc(k.nombre)}</b></div></div>
    <div class="accts">${CFG.currencies.map((c) => `<button class="acct ${c === cur ? "on" : ""}" data-act="kid-cur" data-kid="${kid}" data-cur="${c}">
      <small>Cuenta de ahorros ${curName[c] || c}</small><b>${money(total[c] || 0, c)}</b><span class="no">•••• ${acctNo(kid, c)} · ${c}</span></button>`).join("")}</div>
  </header>
  <main class="pad bank">
    <div class="actions">
      ${isAdult ? `<button class="btn primary" data-act="kid-mov" data-kid="${kid}" data-tipo="deposito">⬇️ Depositar</button>
        <button class="btn" data-act="kid-mov" data-kid="${kid}" data-tipo="retiro">⬆️ Retirar</button>
        <button class="btn" data-act="kid-mov" data-kid="${kid}" data-tipo="rendimiento">✨ Interés/premio</button>`
      : `<button class="btn primary" data-act="kid-req" data-kid="${kid}">🙋 Pedir un retiro</button>`}
      <button class="btn" data-act="kid-goal" data-kid="${kid}">🎯 Nueva meta</button>
    </div>
    ${pend.length ? `<h3 class="sec">Solicitudes pendientes</h3><div class="card list">${pend.map((s) => `<div class="li">
      <span class="ic">🙋</span><span class="grow"><b>${money(s.monto, s.moneda)}</b><small class="muted">${esc(s.motivo || "")}</small></span>
      ${isAdult ? `<button class="btn sm primary" data-act="sol-ok" data-kid="${kid}" data-id="${s.id}">Aprobar</button><button class="btn sm" data-act="sol-no" data-kid="${kid}" data-id="${s.id}">No</button>` : `<span class="badge">En revisión</span>`}
    </div>`).join("")}</div>` : ""}
    ${kd.metas.length ? `<h3 class="sec">Mis metas</h3><div class="goals">${kd.metas.map((g) => {
      const have = Math.max(0, total[g.moneda] || 0), pct = Math.min(100, Math.round((have / g.objetivo) * 100));
      return `<div class="card goal tap" data-act="goal" data-kid="${kid}" data-id="${g.id}"><div class="row"><span class="gi">${g.emoji || "🎯"}</span><span class="grow"><b>${esc(g.nombre)}</b><small class="muted">${money(have, g.moneda)} de ${money(g.objetivo, g.moneda)}</small></span><b>${pct}%</b></div>
        <div class="bar"><i style="width:${pct}%"></i></div>${pct >= 100 ? `<small class="pos">¡Meta alcanzada! 🎉</small>` : `<small class="muted">Te faltan ${money(g.objetivo - have, g.moneda)}</small>`}</div>`;
    }).join("")}</div>` : ""}
    ${custodios.length ? `<h3 class="sec">¿Quién guarda tu dinero?</h3><div class="card list">${custodios.map(([c, v]) => `<div class="li"><span class="ic">${adultById(c)?.emoji || "🏦"}</span><span class="grow"><b>${esc(adultById(c)?.nombre || c)}</b></span><span class="amt">${Object.entries(v).filter(([, x]) => Math.abs(x) > L.EPS).map(([cc, x]) => `<span>${money(x, cc)}</span>`).join("")}</span></div>`).join("")}</div>` : ""}
    <h3 class="sec">Movimientos · ${curName[cur] || cur}</h3>
    <div class="card list">${movs.length ? movs.map((m) => {
      const s = L.signo(m) > 0;
      return `<div class="li tap ${m.anulado ? "void" : ""}" data-act="kid-mov-view" data-kid="${kid}" data-id="${m.id}"><span class="ic">${{ deposito: "⬇️", retiro: "⬆️", rendimiento: "✨", ajuste: "🔧" }[m.tipo]}</span>
        <span class="grow"><b>${esc(m.concepto || m.tipo)}</b><small class="muted">${fdate(m.fecha)}${m.custodio ? " · guarda " + esc(adultById(m.custodio)?.nombre || "") : ""}${m.anulado ? " · ANULADO" : ""}</small></span>
        <b class="${s ? "pos" : "neg"}">${s ? "+" : "−"}${money(m.monto, m.moneda)}</b></div>`;
    }).join("") : `<div class="li muted">Sin movimientos en esta cuenta</div>`}</div>
    ${otherSol.length ? `<h3 class="sec">Solicitudes anteriores</h3><div class="card list">${otherSol.map((s) => `<div class="li"><span class="ic">${s.estado === "aprobada" ? "✅" : "❌"}</span><span class="grow"><b>${money(s.monto, s.moneda)}</b><small class="muted">${esc(s.motivo || "")}</small></span><small>${s.estado}</small></div>`).join("")}</div>` : ""}
  </main>`;
}

// ---------------- Adjuntos (fotos de recibos / pantallazos) ----------------
// Se comprimen en el celular (máx ~1280 px, JPEG) y se guardan junto a los datos: no requiere plan de pago.
const MAX_FOTOS = 3;
const fileField = () => `<label class="file">📎 Adjuntar recibo o pantallazo <small class="muted">(opcional, máx ${MAX_FOTOS})</small>
  <input type="file" name="fotos" accept="image/*" multiple></label><div class="thumbs prev"></div>`;
function wirePreview(w) {
  const inp = w.querySelector("input[name=fotos]"); if (!inp) return;
  inp.addEventListener("change", () => {
    const box = w.querySelector(".thumbs.prev");
    if (inp.files.length > MAX_FOTOS) toast(`Solo se guardan las primeras ${MAX_FOTOS}`);
    box.innerHTML = [...inp.files].slice(0, MAX_FOTOS).map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join("");
  });
}
function compress(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      let q = 0.72, max = 1280, out;
      for (let k = 0; k < 5; k++) {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL("image/jpeg", q);
        if (out.length < 650000) break; // Firestore admite ~1 MB por documento
        q -= 0.12; max = Math.round(max * 0.8);
      }
      URL.revokeObjectURL(img.src); res(out);
    };
    img.onerror = () => rej(new Error("No se pudo leer la imagen"));
    img.src = URL.createObjectURL(file);
  });
}
async function uploadFrom(form, scope) {
  const inp = form.querySelector("input[name=fotos]"); if (!inp || !inp.files.length) return [];
  const ids = [];
  for (const f of [...inp.files].slice(0, MAX_FOTOS)) ids.push(await store.addAtt(scope, { data: await compress(f), nombre: f.name.slice(0, 60) }));
  return ids;
}
// Sección de adjuntos en una ficha de detalle. save(ids) guarda la lista nueva en el registro.
const attBlock = (ids = [], canAdd) => (ids.length || canAdd) ? `<h3 class="sec">Soportes (${ids.length})</h3>
  <div class="thumbs att">${ids.map((id) => `<button class="th" data-att="${id}"><span class="spin"></span></button>`).join("")}
  ${canAdd && ids.length < MAX_FOTOS * 2 ? `<label class="th add">＋<input type="file" accept="image/*" hidden></label>` : ""}</div>` : "";
function wireAtt(w, scope, ids = [], save) {
  w.querySelectorAll("[data-att]").forEach(async (b) => {
    try { const a = await store.getAtt(scope, b.dataset.att); b.innerHTML = a ? `<img src="${a.data}" alt="">` : "?"; b.onclick = () => a && viewImg(a.data); }
    catch { b.textContent = "⚠️"; }
  });
  const add = w.querySelector(".th.add input");
  if (add && save) add.onchange = async () => {
    if (!add.files[0]) return;
    toast("Subiendo…");
    try { const id = await store.addAtt(scope, { data: await compress(add.files[0]), nombre: add.files[0].name.slice(0, 60) }); await save([...ids, id]); toast("Soporte agregado 📎"); closeSheet(); }
    catch (e) { toast(e.message); }
  };
}
function celebrate(nombre) {
  const c = document.createElement("div"); c.className = "celebrate";
  c.innerHTML = `<div class="cel-card"><div class="cel-ic">🥂</div><h2>Paz y salvo</h2><p>Tú y ${esc(nombre)} están al día.</p></div>${[...Array(28)].map((_, i) => `<i style="left:${Math.random() * 100}%;animation-delay:${Math.random() * .8}s;background:${["#c8a96a", "#e8d9b5", "#7fc8b0", "#2f7f9e"][i % 4]}"></i>`).join("")}`;
  c.onclick = () => c.remove(); document.body.appendChild(c); setTimeout(() => c.remove(), 3800);
}
function viewImg(src) {
  const v = document.createElement("div"); v.className = "viewer";
  v.innerHTML = `<img src="${src}" alt=""><button class="x">✕</button>`;
  v.onclick = () => v.remove(); document.body.appendChild(v);
}

// ---------------- Hojas (modales) ----------------
function sheet(html, onSubmit) {
  closeSheet();
  const w = document.createElement("div");
  w.className = "sheet-wrap";
  w.innerHTML = `<div class="sheet" role="dialog"><button class="x" data-close>✕</button>${html}</div>`;
  document.body.appendChild(w);
  requestAnimationFrame(() => w.classList.add("open"));
  w.addEventListener("click", (e) => { if (e.target === w || e.target.closest("[data-close]")) closeSheet(); });
  const f = w.querySelector("form");
  if (f && onSubmit) f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = f.querySelector("button[type=submit],button:not([type])"); if (btn) btn.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(f)), f); closeSheet(); }
    catch (err) { console.error(err); toast(err.message || "Error"); if (btn) btn.disabled = false; }
  });
  return w;
}
// Diálogo propio (reemplaza confirm/prompt del navegador). input: tipo de campo o null.
function ask(msg, input = null) {
  return new Promise((res) => {
    const w = document.createElement("div");
    w.className = "dlg-wrap";
    w.innerHTML = `<div class="dlg"><p>${esc(msg)}</p>${input ? `<input type="${input}" autocomplete="off">` : ""}
      <div class="dlg-b"><button class="btn" data-v="0">Cancelar</button><button class="btn primary" data-v="1">Aceptar</button></div></div>`;
    document.body.appendChild(w);
    const inp = w.querySelector("input"); if (inp) inp.focus();
    w.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]"); if (!b && e.target !== w) return;
      e.stopPropagation(); w.remove();
      const ok = b && b.dataset.v === "1";
      res(input ? (ok ? inp.value.trim() : null) : ok);
    });
  });
}
function closeSheet() { document.querySelectorAll(".sheet-wrap").forEach((n) => n.remove()); }
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.classList.add("on")); setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }, 2600);
}
const curSelect = (name = "moneda", val) => `<select name="${name}">${CFG.currencies.map((c) => `<option ${c === val ? "selected" : ""}>${c}</option>`).join("")}</select>`;
const moneyInput = (name = "monto", val = "") => `<input name="${name}" inputmode="decimal" placeholder="0" required value="${val}" autocomplete="off">`;

function sheetNewDebt(oid) {
  const o = adultById(oid);
  const w = sheet(`<h2>Nuevo pendiente</h2><form>
    <div class="seg"><label><input type="radio" name="dir" value="yo" checked><span>Yo le debo a ${esc(o.nombre)}</span></label><label><input type="radio" name="dir" value="el"><span>${esc(o.nombre)} me debe</span></label></div>
    <div class="seg seg3"><label><input type="radio" name="forma" value="unico" checked><span>Una vez</span></label><label><input type="radio" name="forma" value="cuotas"><span>💳 A cuotas</span></label><label><input type="radio" name="forma" value="mensual"><span>🔁 Cada mes</span></label></div>
    <div class="row2"><label><span id="lblMonto">Monto</span>${moneyInput()}</label><label>Moneda${curSelect()}</label></div>
    <div id="cuotasBox" hidden>
      <div class="row2"><label>N.º de cuotas<input name="n" type="number" min="2" max="120" value="12" inputmode="numeric"></label><label>Día de pago<input name="dia" type="number" min="1" max="31" inputmode="numeric" value="${+today().slice(8)}"></label></div>
      <label>Valor de cada cuota<input name="cuota" inputmode="decimal" autocomplete="off" placeholder="0"></label>
      <small class="muted" id="cuotaInfo">Se calcula del total. Si la tarjeta cobra intereses, escribe aquí la cuota real del extracto.</small>
    </div>
    <div id="mensBox" hidden><label class="chkline"><input type="checkbox" name="variable"> El valor cambia cada mes (se confirma cuando llegue el recibo)</label>
      <small class="muted">Se crea solo cada mes y ${esc(o.nombre)} también lo ve. Se detiene desde el historial.</small></div>
    <label>Concepto<input name="concepto" placeholder="Ej: celular, mercado, préstamo" maxlength="80"></label>
    <label><span id="lblFecha">Fecha</span><input name="fecha" type="date" value="${today()}"></label>
    ${fileField()}
    <button class="btn primary block">Guardar</button></form>`,
    async (v, form) => {
      const yo = S.me.email, el = o.email, lid = ledgerId(yo, el);
      const base = { tipo: "deuda", deudor: v.dir === "yo" ? yo : el, acreedor: v.dir === "yo" ? el : yo, moneda: v.moneda };
      const concepto = v.concepto.trim();
      if (v.forma === "cuotas") {
        const n = Math.round(num(v.n)), cuota = L.round(num(v.cuota));
        if (n < 2 || n > 120) throw new Error("N.º de cuotas inválido");
        if (cuota <= 0) throw new Error("Valor de cuota inválido");
        if (!concepto) throw new Error("Ponle un nombre (ej: Celular)");
        const pid = "p" + Date.now().toString(36), adj = await uploadFrom(form, ["ledgers", lid]);
        const f0 = v.fecha || today();
        for (let i = 0; i < n; i++)
          await store.addLedgerMov(lid, { ...base, monto: cuota, concepto: `${concepto} · cuota ${i + 1}/${n}`, fecha: addMonths(f0, i), plan: { id: pid, nombre: concepto, n, i: i + 1 }, ...(i === 0 && adj.length ? { adjuntos: adj } : {}) });
        toast(`${n} cuotas registradas 💳`);
      } else if (v.forma === "mensual") {
        const monto = num(v.monto); if (monto <= 0 && !v.variable) throw new Error("Monto inválido");
        if (!concepto) throw new Error("Ponle un nombre (ej: Internet)");
        await store.addLedgerMov(lid, { ...base, tipo: "recurrente", monto: L.round(monto), concepto, desde: v.fecha || today(), variable: !!v.variable });
        toast("Pendiente mensual creado 🔁");
      } else {
        const monto = num(v.monto); if (monto <= 0) throw new Error("Monto inválido");
        const adj = await uploadFrom(form, ["ledgers", lid]);
        await store.addLedgerMov(lid, { ...base, monto: L.round(monto), concepto, fecha: v.fecha || today(), ...(adj.length ? { adjuntos: adj } : {}) });
        toast("Pendiente registrado");
      }
    });
  const f = w.querySelector("form"); wirePreview(w);
  let cuotaTocada = false;
  const upd = () => {
    const c = f.forma.value === "cuotas";
    $("#cuotasBox", w).hidden = !c; $("#mensBox", w).hidden = f.forma.value !== "mensual";
    $("#lblMonto", w).textContent = c ? "Valor total" : "Monto";
    $("#lblFecha", w).textContent = c ? "Fecha de la 1.ª cuota" : f.forma.value === "mensual" ? "Primer mes (fecha de cobro)" : "Fecha";
    f.monto.required = !c;
    if (c && !cuotaTocada) { const n = Math.max(1, Math.round(num(f.n.value))); f.cuota.value = f.monto.value ? String(L.round(num(f.monto.value) / n)) : ""; }
    if (c) { const n = Math.round(num(f.n.value)), cu = num(f.cuota.value), t = num(f.monto.value);
      $("#cuotaInfo", w).textContent = cu ? `Total a pagar: ${money(n * cu, f.moneda.value)}${t && Math.abs(n * cu - t) > 1 ? ` (incluye ${money(n * cu - t, f.moneda.value)} de intereses)` : ""}` : "Se calcula del total. Si la tarjeta cobra intereses, escribe la cuota real."; }
  };
  f.addEventListener("input", (e) => { if (e.target.name === "cuota") cuotaTocada = true; if (e.target.name === "dia" && f.dia.value) { const d = String(Math.min(31, Math.max(1, num(f.dia.value)))).padStart(2, "0"); const t = today(); let fx = t.slice(0, 8) + d; if (fx < t) fx = addMonths(fx, 1); f.fecha.value = fx; } upd(); });
  f.addEventListener("change", upd);
  upd();
}

function sheetSplit() {
  const yo = S.me.email;
  const w = sheet(`<h2>➗ Gasto compartido</h2><p class="muted small">Ej: la donación a la caridad, un regalo o el mercado. Se divide y a cada uno le aparece lo que debe.</p><form>
    <label>Concepto<input name="concepto" required maxlength="60" placeholder="Ej: donación fundación"></label>
    <div class="row2"><label>Valor total${moneyInput("total")}</label><label>Moneda${curSelect()}</label></div>
    <label>¿Quién pagó?<select name="pagador">${CFG.adults.map((a) => `<option value="${a.id}" ${a.id === S.me.id ? "selected" : ""}>${esc(a.nombre)}${a.id === S.me.id ? " (yo)" : ""}</option>`).join("")}</select></label>
    <label>¿Entre quiénes se divide?</label>
    <div class="checks" id="parts">${CFG.adults.map((a) => `<label class="chk"><input type="checkbox" name="p" value="${a.id}" checked><span class="grow"><b>${a.emoji} ${esc(a.nombre)}</b></span><input class="share" data-id="${a.id}" inputmode="decimal" placeholder="0"></label>`).join("")}</div>
    <small class="muted" id="splitInfo"></small>
    <label class="chkline"><input type="checkbox" name="mensual"> 🔁 Se repite cada mes (aporte mensual)</label>
    <label>Fecha<input name="fecha" type="date" value="${today()}"></label>
    ${fileField()}
    <button class="btn primary block">Repartir</button></form>`,
    async (v, form) => {
      const total = num(v.total); if (total <= 0) throw new Error("Valor inválido");
      const parts = [...form.querySelectorAll("input[name=p]:checked")].map((i) => i.value);
      if (parts.length < 2) throw new Error("Selecciona al menos 2 personas");
      const shares = Object.fromEntries(parts.map((id) => [id, L.round(num(form.querySelector(`.share[data-id=${id}]`).value))]));
      const suma = L.round(Object.values(shares).reduce((a, b) => a + b, 0));
      if (Math.abs(suma - total) > 1) throw new Error(`Las partes suman ${money(suma, v.moneda)}, no ${money(total, v.moneda)}`);
      const pag = adultById(v.pagador), gid = "g" + Date.now().toString(36), concepto = v.concepto.trim();
      // Solo se registran las cuentas donde yo participo (privacidad): pagué yo → cada uno me debe; pagó otro → yo le debo mi parte.
      const pares = pag.id === S.me.id ? parts.filter((id) => id !== S.me.id).map((id) => ({ otro: adultById(id), deudor: adultById(id).email, acreedor: yo, monto: shares[id] }))
        : parts.includes(S.me.id) ? [{ otro: pag, deudor: yo, acreedor: pag.email, monto: shares[S.me.id] }] : [];
      if (!pares.length) throw new Error("No participas en este gasto: que lo registre quien pagó");
      for (const p of pares) {
        if (p.monto <= 0) continue;
        const lid = ledgerId(yo, p.otro.email);
        const base = { deudor: p.deudor, acreedor: p.acreedor, monto: p.monto, moneda: v.moneda, concepto, grupo: gid };
        if (v.mensual) await store.addLedgerMov(lid, { ...base, tipo: "recurrente", desde: v.fecha || today(), variable: false });
        else { const adj = await uploadFrom(form, ["ledgers", lid]); await store.addLedgerMov(lid, { ...base, tipo: "deuda", fecha: v.fecha || today(), concepto: `${concepto} (parte de ${money(total, v.moneda)})`, ...(adj.length ? { adjuntos: adj } : {}) }); }
      }
      toast(pag.id === S.me.id ? `Listo: ${pares.length} persona(s) te deben su parte` : `Registrado lo que le debes a ${pag.nombre}. Cada uno registra su parte.`);
    });
  const f = w.querySelector("form"); wirePreview(w);
  const touched = new Set();
  const upd = () => {
    const parts = [...f.querySelectorAll("input[name=p]:checked")].map((i) => i.value), total = num(f.total.value);
    const libres = parts.filter((id) => !touched.has(id));
    const fijo = parts.filter((id) => touched.has(id)).reduce((s, id) => s + num(f.querySelector(`.share[data-id=${id}]`).value), 0);
    const each = libres.length ? L.round((total - fijo) / libres.length) : 0;
    f.querySelectorAll(".share").forEach((i) => { const on = parts.includes(i.dataset.id); i.disabled = !on; if (!on) i.value = ""; else if (!touched.has(i.dataset.id)) i.value = total ? String(each) : ""; });
    const pag = adultById(f.pagador.value);
    $("#splitInfo", w).textContent = pag.id === S.me.id ? "Pagaste tú: a cada persona le aparecerá en sus Cuentas lo que te debe." : parts.includes(S.me.id) ? `Pagó ${pag.nombre}: se registra solo lo que tú le debes. Los demás registran su parte (tú no ves sus cuentas).` : "No participas: este gasto debe registrarlo quien pagó.";
  };
  f.addEventListener("input", (e) => { if (e.target.classList.contains("share")) touched.add(e.target.dataset.id); upd(); });
  f.addEventListener("change", (e) => { if (e.target.name === "p" && !e.target.checked) touched.delete(e.target.value); upd(); });
  upd();
}

function sheetSettle(oid) {
  const o = adultById(oid), yo = S.me.email, lid = ledgerId(yo, o.email);
  const pend = L.debtStatus(S.ledgers[oid] || []).filter((d) => d.saldo > L.EPS);
  const curs = [...new Set(pend.map((d) => d.moneda))];
  let cur = curs[0];
  const w = sheet(`<h2>Pagar / cruzar cuentas</h2><p class="muted small">Marca los pendientes que se saldan con este movimiento. Lo que se deben mutuamente se cruza y solo se paga la diferencia.</p>
    <form>${curs.length > 1 ? `<label>Moneda<select name="cur">${curs.map((c) => `<option>${c}</option>`).join("")}</select></label>` : ""}
    <div class="checks" id="chk"></div>
    <div class="summary" id="sum"></div>
    <label>Monto que se paga<input name="pago" inputmode="decimal" autocomplete="off"></label>
    <label>Nota<input name="concepto" placeholder="Ej: transferencia Nequi" maxlength="80"></label>
    <label>Fecha<input name="fecha" type="date" value="${today()}"></label>
    ${fileField()}
    <button class="btn primary block">Registrar</button></form>`,
    async (v, f) => {
      const plan = calc(f); if (!plan.sel.length) throw new Error("Selecciona al menos un pendiente");
      const p = plan.plan;
      if (!p.pagador && p.pago > 0) throw new Error("Las cuentas ya se cruzan exacto; el pago debe ser 0");
      const adj = await uploadFrom(f, ["ledgers", lid]);
      await store.addLedgerMov(lid, { ...(adj.length ? { adjuntos: adj } : {}),
        tipo: "pago", deudor: p.pagador || yo, acreedor: p.receptor || o.email, monto: p.pago, cruce: p.cruce, moneda: cur,
        concepto: v.concepto.trim() || (p.pago > 0 ? "Pago" : "Cruce de cuentas"), fecha: v.fecha || today(), aplica: p.aplica,
      });
      if (p.pagador && p.excedente > L.EPS)
        await store.addLedgerMov(lid, { tipo: "deuda", deudor: p.receptor, acreedor: p.pagador, monto: p.excedente, moneda: cur, concepto: "Saldo a favor por pago de más", fecha: v.fecha || today() });
      toast("Movimiento registrado ✅");
      S.celebrate = oid;
    });
  const f = w.querySelector("form"); let touchedPago = false; wirePreview(w);
  function drawChecks() {
    const hoy = today();
    $("#chk", w).innerHTML = pend.filter((d) => d.moneda === cur).sort((a, z) => a.fecha.localeCompare(z.fecha)).map((d) => `<label class="chk ${d.fecha > hoy ? "fut" : ""}"><input type="checkbox" name="d" value="${d.id}" ${d.fecha <= hoy ? "checked" : ""}>
      <span class="grow"><b>${esc(d.concepto || "Sin concepto")}</b><small class="muted">${fdate(d.fecha)} · ${d.deudor === yo ? "Tú debes" : esc(o.nombre) + " debe"}${d.fecha > hoy ? " · futura" : ""}</small></span>
      <b class="${d.deudor === yo ? "neg" : "pos"}">${money(d.saldo, d.moneda)}</b></label>`).join("");
    touchedPago = false; calc(f);
  }
  function calc(f) {
    const ids = [...f.querySelectorAll("input[name=d]:checked")].map((i) => i.value);
    const sel = pend.filter((d) => ids.includes(d.id));
    const pagoIn = f.elements.pago;
    let plan = L.planSettlement(sel, yo, o.email, null);
    if (!touchedPago) pagoIn.value = plan.neto ? String(plan.neto) : "0";
    else plan = L.planSettlement(sel, yo, o.email, num(pagoIn.value));
    const quien = plan.pagador === yo ? "Tú pagas" : plan.pagador ? `${esc(o.nombre)} paga` : "Nadie paga";
    const parcial = plan.pagador && plan.pago < plan.neto - L.EPS;
    $("#sum", w).innerHTML = sel.length ? `
      ${plan.cruce > 0 ? `<div><span>Se cruzan</span><b>${money(plan.cruce, cur)}</b></div>` : ""}
      <div><span>Diferencia</span><b>${money(plan.neto, cur)}</b></div>
      <div class="hl"><span>${quien}</span><b>${money(plan.pago, cur)}</b></div>
      ${parcial ? `<small class="muted">Abono parcial: quedan ${money(plan.neto - plan.pago, cur)} pendientes (se abona primero a lo más antiguo).</small>` : ""}
      ${plan.pagador && plan.excedente > L.EPS ? `<small class="warn">Pago de más: ${money(plan.excedente, cur)} quedan como saldo a favor de quien paga.</small>` : ""}` : `<small class="muted">Selecciona pendientes</small>`;
    return { sel, plan };
  }
  f.addEventListener("change", (e) => { if (e.target.name === "cur") { cur = e.target.value; drawChecks(); } else calc(f); });
  f.elements.pago.addEventListener("input", () => { touchedPago = true; calc(f); });
  drawChecks();
}

function sheetForgive(oid) {
  const o = adultById(oid), yo = S.me.email;
  const pend = L.debtStatus(S.ledgers[oid] || []).filter((d) => d.saldo > L.EPS && d.acreedor === yo);
  const curs = [...new Set(pend.map((d) => d.moneda))]; let cur = curs[0];
  const w = sheet(`<h2>Condonar a ${esc(o.nombre)}</h2><p class="muted small">Perdonas total o parcialmente lo que ${esc(o.nombre)} te debe. Queda registrado en el historial.</p>
    <form>${curs.length > 1 ? `<label>Moneda<select name="cur">${curs.map((c) => `<option>${c}</option>`).join("")}</select></label>` : ""}
    <div class="checks" id="chk"></div>
    <label>Monto a condonar<input name="monto" inputmode="decimal" autocomplete="off"></label>
    <label>Nota<input name="concepto" placeholder="Ej: regalo de cumpleaños 🎂" maxlength="80"></label>
    <button class="btn primary block">Condonar</button></form>`,
    async (v, f) => {
      const ids = [...f.querySelectorAll("input[name=d]:checked")].map((i) => i.value);
      const sel = pend.filter((d) => ids.includes(d.id)); if (!sel.length) throw new Error("Selecciona al menos un pendiente");
      const max = sel.reduce((s, d) => s + d.saldo, 0);
      const m = Math.min(num(v.monto), max); if (m <= 0) throw new Error("Monto inválido");
      const r = L.fifo(sel, m);
      await store.addLedgerMov(ledgerId(yo, o.email), { tipo: "condonacion", deudor: o.email, acreedor: yo, monto: L.round(m), moneda: cur, concepto: v.concepto.trim() || "Condonación", fecha: today(), aplica: r.aplica });
      toast("Deuda condonada 🎁");
    });
  const f = w.querySelector("form");
  const upd = () => { const ids = [...f.querySelectorAll("input[name=d]:checked")].map((i) => i.value); f.elements.monto.value = String(L.round(pend.filter((d) => ids.includes(d.id)).reduce((s, d) => s + d.saldo, 0))); };
  const draw = () => { $("#chk", w).innerHTML = pend.filter((d) => d.moneda === cur).map((d) => `<label class="chk"><input type="checkbox" name="d" value="${d.id}" checked><span class="grow"><b>${esc(d.concepto || "Sin concepto")}</b><small class="muted">${fdate(d.fecha)}</small></span><b class="pos">${money(d.saldo, d.moneda)}</b></label>`).join(""); upd(); };
  f.addEventListener("change", (e) => { if (e.target.name === "cur") { cur = e.target.value; draw(); } else if (e.target.name === "d") upd(); });
  draw();
}

function sheetMov(oid, id) {
  const movs = S.ledgers[oid] || [], m = movs.find((x) => x.id === id); if (!m) return;
  const st = L.debtStatus(movs), byId = Object.fromEntries(st.map((d) => [d.id, d]));
  const canAnnul = !m.anulado && m.creadoPor === S.me.email;
  const usedBy = m.tipo === "deuda" ? movs.filter((x) => !x.anulado && x.aplica?.some((a) => a.deudaId === m.id)) : [];
  const t = { deuda: "Pendiente", pago: m.monto > 0 ? "Pago" : "Cruce de cuentas", condonacion: "Condonación", recurrente: "🔁 Pendiente mensual" }[m.tipo];
  const canConfirm = m.porConfirmar && !m.anulado && !(byId[m.id]?.abonado);
  sheet(`<h2>${t}</h2>
    <div class="card list flat">
      <div class="li"><span>Monto</span><b>${money(m.monto, m.moneda)}</b></div>
      ${m.tipo === "recurrente" ? `<div class="li"><span>Paga</span><b>${esc(nameOf(m.deudor))} → ${esc(nameOf(m.acreedor))}</b></div><div class="li"><span>Desde</span><b>${fdate(m.desde)}</b></div><div class="li"><span>Valor</span><b>${m.variable ? "Variable (se confirma)" : "Fijo"}</b></div>` : m.tipo === "deuda" ? `<div class="li"><span>Debe</span><b>${esc(nameOf(m.deudor))} → ${esc(nameOf(m.acreedor))}</b></div><div class="li"><span>Saldo</span><b>${money(byId[m.id]?.saldo, m.moneda)}</b></div>`
        : `<div class="li"><span>${m.tipo === "pago" ? "Pagó" : "Condonó"}</span><b>${esc(nameOf(m.tipo === "pago" ? m.deudor : m.acreedor))}</b></div>${m.cruce ? `<div class="li"><span>Cruzado</span><b>${money(m.cruce, m.moneda)}</b></div>` : ""}`}
      <div class="li"><span>Concepto</span><b>${esc(m.concepto || "—")}</b></div>
      <div class="li"><span>Fecha</span><b>${fdate(m.fecha)}</b></div>
      <div class="li"><span>Registró</span><b>${esc(nameOf(m.creadoPor))}</b></div>
      ${m.anulado ? `<div class="li"><span>Estado</span><b class="neg">Anulado</b></div>` : ""}
    </div>
    ${m.aplica?.length ? `<h3 class="sec">Pendientes que saldó</h3><div class="card list flat">${m.aplica.map((a) => { const d = movs.find((x) => x.id === a.deudaId); return `<div class="li"><span class="grow">${esc(d?.concepto || "Pendiente")}<small class="muted">${d ? fdate(d.fecha) + " · " + esc(nameOf(d.deudor)) + " debía" : ""}</small></span><b>${money(a.monto, m.moneda)}</b></div>`; }).join("")}</div>` : ""}
    ${canConfirm ? `<button class="btn primary block" id="conf">✏️ Confirmar valor real (llegó el recibo)</button>` : ""}
    ${m.tipo !== "recurrente" ? attBlock(m.adjuntos, !m.anulado) : ""}
    ${usedBy.length ? `<p class="muted small">Tiene ${usedBy.length} pago(s)/condonación(es) aplicados. Para anularlo, anula primero esos movimientos.</p>` : ""}
    ${canAnnul && !usedBy.length ? `<button class="btn danger block" id="annul">${m.tipo === "recurrente" ? "Detener (no crear más meses)" : "Anular este movimiento"}</button>` : ""}
    ${!canAnnul && !m.anulado ? `<p class="muted small">Solo quien lo registró puede anularlo.</p>` : ""}`);
  const lidM = ledgerId(S.me.email, adultById(oid).email);
  wireAtt(document.querySelector(".sheet-wrap"), ["ledgers", lidM], m.adjuntos || [], (ids) => store.setLedgerAtt(lidM, id, ids));
  const cf = document.getElementById("conf");
  if (cf) cf.onclick = async () => {
    const r = await ask(`Valor real de "${m.concepto}" (estimado ${money(m.monto, m.moneda)}):`, "text"); if (r === null) return;
    const v = L.round(num(r)); if (v <= 0) return toast("Monto inválido");
    await store.confirmLedgerAmt(lidM, id, v); closeSheet(); toast("Valor confirmado ✅");
  };
  const b = document.getElementById("annul");
  if (b) b.onclick = async () => { if (!(await ask(m.tipo === "recurrente" ? "¿Detener? Los meses ya creados se quedan." : "¿Anular? Quedará en el historial como anulado."))) return; await store.annulLedgerMov(ledgerId(S.me.email, adultById(oid).email), id); closeSheet(); toast("Anulado"); };
}

function sheetKidMov(kid, tipo) {
  const k = kidById(kid), T = { deposito: "Depositar", retiro: "Retirar", rendimiento: "Interés o premio" }[tipo];
  sheet(`<h2>${T} · ${esc(k.nombre)}</h2><form>
    <div class="row2"><label>Monto${moneyInput()}</label><label>Moneda${curSelect("moneda", kidCurTab[kid])}</label></div>
    <label>Concepto<input name="concepto" placeholder="${tipo === "deposito" ? "Ej: regalo de la tía" : tipo === "retiro" ? "Ej: compra de un libro" : "Ej: interés del mes"}" maxlength="80"></label>
    <label>¿Quién ${tipo === "retiro" ? "entrega" : "guarda"} el dinero?<select name="custodio">${CFG.adults.map((a) => `<option value="${a.id}" ${a.id === S.me.id ? "selected" : ""}>${esc(a.nombre)}</option>`).join("")}</select></label>
    <label>Fecha<input name="fecha" type="date" value="${today()}"></label>
    ${fileField()}
    <button class="btn primary block">Guardar</button></form>`,
    async (v, form) => {
      const monto = num(v.monto); if (monto <= 0) throw new Error("Monto inválido");
      if (tipo === "retiro") { const bal = L.kidBalances(S.kids[kid].movs).total[v.moneda] || 0; if (monto > bal + L.EPS && !(await ask("El retiro supera el saldo. ¿Continuar?"))) return; }
      const adj = await uploadFrom(form, ["kids", kid]);
      await store.addKid(kid, "movs", { tipo, moneda: v.moneda, monto: L.round(monto), concepto: v.concepto.trim(), custodio: v.custodio, fecha: v.fecha || today(), anulado: false, ...(adj.length ? { adjuntos: adj } : {}) });
      toast("Listo ✅");
    });
  wirePreview(document.querySelector(".sheet-wrap"));
}
function sheetKidMovView(kid, id) {
  const m = S.kids[kid].movs.find((x) => x.id === id); if (!m) return;
  const canAnnul = S.kind === "adult" && !m.anulado;
  sheet(`<h2>Comprobante</h2><div class="receipt"><div class="r-amt ${L.signo(m) > 0 ? "pos" : "neg"}">${L.signo(m) > 0 ? "+" : "−"}${money(m.monto, m.moneda)}</div>
    <div class="card list flat"><div class="li"><span>Tipo</span><b>${m.tipo}</b></div><div class="li"><span>Concepto</span><b>${esc(m.concepto || "—")}</b></div>
    <div class="li"><span>Fecha</span><b>${fdate(m.fecha)}</b></div><div class="li"><span>Guarda</span><b>${esc(adultById(m.custodio)?.nombre || "—")}</b></div>
    <div class="li"><span>Comprobante</span><b>#${esc(id.slice(-6).toUpperCase())}</b></div>${m.anulado ? `<div class="li"><span>Estado</span><b class="neg">Anulado</b></div>` : ""}</div></div>
    ${attBlock(m.adjuntos, S.kind === "adult" && !m.anulado)}
    ${canAnnul ? `<button class="btn danger block" id="annul">Anular</button>` : ""}`);
  wireAtt(document.querySelector(".sheet-wrap"), ["kids", kid], m.adjuntos || [], (ids) => store.updateKid(kid, "movs", id, { adjuntos: ids }));
  const b = document.getElementById("annul");
  if (b) b.onclick = async () => { if (!(await ask("¿Anular este movimiento?"))) return; await store.updateKid(kid, "movs", id, { anulado: true, anuladoEn: Date.now() }); closeSheet(); toast("Anulado"); };
}
function sheetKidReq(kid) {
  sheet(`<h2>Pedir un retiro 🙋</h2><p class="muted small">Un adulto revisará tu solicitud.</p><form>
    <div class="row2"><label>Monto${moneyInput()}</label><label>Moneda${curSelect("moneda", kidCurTab[kid])}</label></div>
    <label>¿Para qué?<input name="motivo" required maxlength="80" placeholder="Ej: un juego, un libro"></label>
    <button class="btn primary block">Enviar solicitud</button></form>`,
    async (v) => {
      const monto = num(v.monto); if (monto <= 0) throw new Error("Monto inválido");
      await store.addKid(kid, "solicitudes", { moneda: v.moneda, monto: L.round(monto), motivo: v.motivo.trim(), estado: "pendiente" });
      toast("Solicitud enviada 📨");
    });
}
function sheetGoal(kid, id) {
  const g = id ? S.kids[kid].metas.find((x) => x.id === id) : null;
  const w = sheet(`<h2>${g ? "Editar meta" : "Nueva meta"} 🎯</h2><form>
    <div class="row2"><label>Emoji<input name="emoji" maxlength="4" value="${esc(g?.emoji || "🎯")}"></label><label>Nombre<input name="nombre" required maxlength="40" value="${esc(g?.nombre || "")}" placeholder="Ej: Bicicleta"></label></div>
    <div class="row2"><label>¿Cuánto cuesta?${moneyInput("objetivo", g?.objetivo || "")}</label><label>Moneda${curSelect("moneda", g?.moneda || kidCurTab[kid])}</label></div>
    <button class="btn primary block">Guardar</button>${g ? `<button type="button" class="btn danger block" id="del">Eliminar meta</button>` : ""}</form>`,
    async (v) => {
      const objetivo = num(v.objetivo); if (objetivo <= 0) throw new Error("Monto inválido");
      const data = { nombre: v.nombre.trim(), emoji: v.emoji.trim() || "🎯", moneda: v.moneda, objetivo: L.round(objetivo) };
      g ? await store.updateKid(kid, "metas", id, data) : await store.addKid(kid, "metas", data);
      toast("Meta guardada");
    });
  const d = w.querySelector("#del"); if (d) d.onclick = async () => { if (!(await ask("¿Eliminar la meta?"))) return; await store.deleteKid(kid, "metas", id); closeSheet(); };
}
async function resolveSol(kid, id, ok) {
  const s = S.kids[kid].solicitudes.find((x) => x.id === id); if (!s) return;
  if (ok) {
    const bal = L.kidBalances(S.kids[kid].movs).total[s.moneda] || 0;
    if (s.monto > bal + L.EPS && !(await ask("Supera el saldo. ¿Aprobar de todas formas?"))) return;
    await store.addKid(kid, "movs", { tipo: "retiro", moneda: s.moneda, monto: s.monto, concepto: s.motivo || "Retiro solicitado", custodio: S.me.id, fecha: today(), anulado: false, solicitud: id });
  }
  await store.updateKid(kid, "solicitudes", id, { estado: ok ? "aprobada" : "rechazada", resueltoPor: S.me.email, resueltoEn: Date.now() });
  toast(ok ? "Aprobada ✅" : "Rechazada");
}

// ---------------- Instalación / ajustes ----------------
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; render(); });

const memberLine = (m, tipo) => `<div class="li ${S.me.email === ADMIN && m.email !== ADMIN ? "tap" : ""}" ${S.me.email === ADMIN && m.email !== ADMIN ? `data-act="member" data-id="${m.id}"` : ""}>
  <span class="av sm">${m.emoji || "🙂"}</span><span class="grow"><b>${esc(m.nombre)}</b><small class="muted">${tipo}${m.email ? " · " + esc(m.email) : ""}${m.tel ? " · 📱 " + esc(m.tel) : ""}${m.email === ADMIN ? " · administrador" : ""}</small></span></div>`;

function sheetInvite(id) {
  const all = [...CFG.adults.map((a) => ({ ...a, tipo: "adulto" })), ...CFG.kids.map((k) => ({ ...k, tipo: "nino" }))];
  const m = id ? all.find((x) => x.id === id) : null;
  const w = sheet(`<h2>${m ? "Editar miembro" : "Invitar a un familiar"}</h2><form>
    <div class="seg"><label><input type="radio" name="tipo" value="adulto" ${m?.tipo !== "nino" ? "checked" : ""} ${m ? "disabled" : ""}><span>Adulto</span></label><label><input type="radio" name="tipo" value="nino" ${m?.tipo === "nino" ? "checked" : ""} ${m ? "disabled" : ""}><span>Niño (banco)</span></label></div>
    <div class="row2"><label>Nombre<input name="nombre" required maxlength="30" value="${esc(m?.nombre || "")}"></label><label>Emoji<input name="emoji" maxlength="4" value="${esc(m?.emoji || "🙂")}"></label></div>
    <label>Correo (será su usuario)<input name="email" type="email" ${m ? "readonly" : ""} value="${esc(m?.email || "")}" placeholder="nombre@gmail.com"></label>
    <label>Celular (para recordatorios por WhatsApp)<input name="tel" inputmode="tel" value="${esc(m?.tel || "")}" placeholder="3001234567"></label>
    ${m ? "" : `<label class="chkline"><input type="checkbox" name="sinVerificar"> Yo le creo la cuenta en Firebase (para niños o correos inventados: no se le pedirá confirmar el correo)</label>`}
    <button class="btn primary block">${m ? "Guardar" : "Invitar"}</button>
    ${m ? `<button type="button" class="btn danger block" id="rm">Quitar de la familia</button>` : ""}</form>`,
    async (v) => {
      const fam = { adults: [...CFG.adults], kids: [...CFG.kids] };
      const email = (v.email || m?.email || "").trim().toLowerCase();
      if (m) {
        const list = m.tipo === "nino" ? fam.kids : fam.adults, i = list.findIndex((x) => x.id === m.id);
        list[i] = { ...list[i], nombre: v.nombre.trim(), emoji: v.emoji.trim() || "🙂", tel: v.tel.trim() };
        await store.saveFamily(famPayload(fam)); toast("Guardado"); return;
      }
      if (v.tipo === "adulto" && !email) throw new Error("Los adultos necesitan correo");
      if (email && all.some((x) => x.email === email)) throw new Error("Ese correo ya está en la familia");
      const nuevo = { id: slug(v.nombre), nombre: v.nombre.trim(), emoji: v.emoji.trim() || "🙂", email, tel: v.tel.trim(), sinVerificar: !!v.sinVerificar, ...(v.tipo === "nino" ? { color: ["#1e3a5f", "#7a5c2e", "#2f6f6a", "#5b3a6b"][fam.kids.length % 4] } : {}) };
      (v.tipo === "nino" ? fam.kids : fam.adults).push(nuevo);
      await store.saveFamily(famPayload(fam));
      setTimeout(() => shareInvite(nuevo), 50);
    });
  const rm = w.querySelector("#rm");
  if (rm) rm.onclick = async () => {
    if (!(await ask(`¿Quitar a ${m.nombre}? Sus movimientos se conservan, pero ya no podrá entrar.`))) return;
    const fam = { adults: CFG.adults.filter((x) => x.id !== m.id), kids: CFG.kids.filter((x) => x.id !== m.id) };
    await store.saveFamily(famPayload(fam)); closeSheet(); toast("Quitado");
  };
}
function shareInvite(m) {
  const url = location.href.split("#")[0];
  const txt = `Hola ${m.nombre} 👋 Te invité a ${CFG.appName}, donde llevamos las cuentas de la familia.\n\n1) Abre: ${url}\n2) Toca "¿Te invitaron? Crea tu cuenta"\n3) Usa este correo: ${m.email || "(te lo paso)"}\n\nLuego instálala: menú ⋮ → "Instalar aplicación" (iPhone: Compartir → "Agregar a inicio").`;
  sheet(`<h2>✉️ Envía la invitación</h2><p class="muted small">${esc(m.nombre)} ya está en la familia. Mándale este mensaje:</p>
    <textarea class="msg" id="invTxt">${esc(txt)}</textarea>
    <a class="btn primary block wa" target="_blank" rel="noopener" href="${waLink(m.tel, txt)}">Enviar por WhatsApp</a>
    <button class="btn block" id="cpInv">Copiar mensaje</button>
    ${m.sinVerificar ? `<p class="muted small">Recuerda crearle la cuenta en Firebase → Authentication → Agregar usuario.</p>` : ""}`);
  $("#cpInv").onclick = () => navigator.clipboard.writeText($("#invTxt").value).then(() => toast("Copiado"), () => toast("Selecciona y copia"));
}
const waLink = (tel, txt) => { const t = (tel || "").replace(/\D/g, ""); return `https://wa.me/${t ? (t.length === 10 ? "57" + t : t) : ""}?text=${encodeURIComponent(txt)}`; };

// ---------------- 3) Recordatorio amable por WhatsApp ----------------
function sheetRemind(oid) {
  const o = adultById(oid), movs = S.ledgers[oid] || [], b = L.netBalance(movs, S.me.email);
  const items = L.debtStatus(movs).filter((d) => d.saldo > L.EPS && d.deudor === o.email && d.fecha <= today()).sort((a, z) => a.fecha.localeCompare(z.fecha));
  const tot = Object.entries(b).filter(([, v]) => v > L.EPS).map(([c, v]) => money(v, c)).join(" y ");
  const lista = items.slice(0, 8).map((d) => `• ${d.concepto || "Pendiente"} (${fdate(d.fecha)}): ${money(d.saldo, d.moneda)}`).join("\n");
  const txt = `Hola ${o.nombre} 😊 te comparto cómo vamos en nuestras cuentas:\n\n${lista}${items.length > 8 ? `\n…y ${items.length - 8} más` : ""}\n\nTotal: ${tot}. Cuando puedas, sin afán 💛\n(Lo puedes ver en ${CFG.appName})`;
  const w = sheet(`<h2>💬 Recordarle a ${esc(o.nombre)}</h2><p class="muted small">Un mensaje amable con el detalle. Puedes editarlo antes de enviar.</p>
    <textarea class="msg" id="rmTxt">${esc(txt)}</textarea>
    <a class="btn primary block wa" id="rmWa" target="_blank" rel="noopener" href="${waLink(o.tel, txt)}">Enviar por WhatsApp</a>
    ${o.tel ? "" : `<p class="muted small">Sin celular guardado: WhatsApp te dejará escoger el contacto.</p>`}`);
  const ta = $("#rmTxt", w); ta.oninput = () => { $("#rmWa", w).href = waLink(o.tel, ta.value); };
}

// ---------------- 2) Panel del mes ----------------
const ym = (iso) => (iso || "").slice(0, 7);
const mesNom = (k) => { const [y, m] = k.split("-"); return ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][m - 1] + (k.slice(0, 4) !== today().slice(0, 4) ? " " + y.slice(2) : ""); };
function viewPanel() {
  const cur = CFG.currencies[0], yo = S.me.email, mes = ym(today());
  const meses = [...Array(6)].map((_, i) => ym(addMonths(today().slice(0, 8) + "01", i - 5)));
  const serie = Object.fromEntries(meses.map((k) => [k, { pague: 0, recibi: 0 }]));
  const porPersona = {};
  let nuevasDeudas = 0, nuevosCreditos = 0;
  for (const a of CFG.adults) {
    if (a.id === S.me.id) continue;
    for (const m of (S.ledgers[a.id] || []).filter((x) => !x.anulado && x.moneda === cur)) {
      const k = ym(m.fecha);
      if (m.tipo === "pago" && m.monto > 0 && serie[k]) { if (m.deudor === yo) serie[k].pague += m.monto; else serie[k].recibi += m.monto; }
      if (k === mes) {
        porPersona[a.id] = porPersona[a.id] || { pague: 0, recibi: 0 };
        if (m.tipo === "pago") m.deudor === yo ? (porPersona[a.id].pague += m.monto) : (porPersona[a.id].recibi += m.monto);
        if (m.tipo === "deuda") m.deudor === yo ? (nuevasDeudas += m.monto) : (nuevosCreditos += m.monto);
      }
    }
  }
  const oblMes = S.obl.filter((o) => o.estado === "pagada" && ym(o.pagadaFecha) === mes && o.moneda === cur && o.tipo === "pagar");
  const oblTot = oblMes.reduce((x, o) => x + o.monto, 0);
  const max = Math.max(1, ...meses.map((k) => Math.max(serie[k].pague, serie[k].recibi)));
  const s = serie[mes];
  const fmtK = (v) => v >= 1e6 ? (v / 1e6).toFixed(1).replace(".0", "") + "M" : v >= 1e3 ? Math.round(v / 1e3) + "k" : String(Math.round(v));
  return `<header class="top"><a href="#/cuentas" class="back">‹</a><div><small class="muted">Resumen</small><b>Panel de ${mesNom(mes)}</b></div></header>
  <main class="pad">
    <div class="kpis">
      <div class="kpi"><small>Pagué a la familia</small><b class="neg">${money(s.pague, cur)}</b></div>
      <div class="kpi"><small>Me pagaron</small><b class="pos">${money(s.recibi, cur)}</b></div>
      <div class="kpi"><small>Obligaciones pagadas</small><b>${money(oblTot, cur)}</b><small class="muted">${oblMes.length} pago(s)</small></div>
      <div class="kpi"><small>Nuevo este mes</small><b>${money(nuevasDeudas, cur)}</b><small class="muted">que debo · ${money(nuevosCreditos, cur)} que me deben</small></div>
    </div>
    <h3 class="sec">Últimos 6 meses · ${cur}</h3>
    <div class="card chart">
      <div class="bars">${meses.map((k) => `<div class="bcol"><div class="bpair">
        <i class="b1" style="height:${(serie[k].pague / max) * 100}%" title="${money(serie[k].pague, cur)}">${serie[k].pague ? `<em>${fmtK(serie[k].pague)}</em>` : ""}</i>
        <i class="b2" style="height:${(serie[k].recibi / max) * 100}%" title="${money(serie[k].recibi, cur)}">${serie[k].recibi ? `<em>${fmtK(serie[k].recibi)}</em>` : ""}</i></div><span>${mesNom(k)}</span></div>`).join("")}</div>
      <div class="legend"><span><i class="b1"></i>Pagué</span><span><i class="b2"></i>Me pagaron</span></div>
    </div>
    <h3 class="sec">Este mes, por persona</h3>
    <div class="card list">${CFG.adults.filter((a) => a.id !== S.me.id).map((a) => { const p = porPersona[a.id] || { pague: 0, recibi: 0 };
      return `<a class="li" href="#/par/${a.id}"><span class="av sm">${a.emoji}</span><span class="grow"><b>${esc(a.nombre)}</b><small class="muted">Pagué ${money(p.pague, cur)} · Recibí ${money(p.recibi, cur)}</small></span><span class="chev">›</span></a>`; }).join("")}</div>
    ${oblMes.length ? `<h3 class="sec">Obligaciones pagadas en ${mesNom(mes)}</h3><div class="card list">${oblMes.map((o) => `<div class="li"><span class="ic">✓</span><span class="grow"><b>${esc(o.concepto)}</b><small class="muted">${esc(o.contraparte || "")} · ${fdate(o.pagadaFecha)}</small></span><b>${money(o.monto, o.moneda)}</b></div>`).join("")}</div>` : ""}
  </main>`;
}

// ---------------- 6) Respaldo en Excel ----------------
async function backupExcel() {
  const rows = { Cuentas: [], Obligaciones: [], Ninos: [] };
  for (const a of CFG.adults) {
    if (a.id === S.me?.id) continue;
    for (const m of S.ledgers[a.id] || []) rows.Cuentas.push({ Con: a.nombre, Fecha: m.fecha || m.desde, Tipo: m.tipo, Concepto: m.concepto, Debe: nameOf(m.deudor), A: nameOf(m.acreedor), Monto: m.monto, Moneda: m.moneda, Anulado: m.anulado ? "sí" : "", Registro: nameOf(m.creadoPor) });
  }
  for (const o of S.obl) rows.Obligaciones.push({ Concepto: o.concepto, Con: o.contraparte, Tipo: o.tipo, Monto: o.monto, Moneda: o.moneda, Vence: o.vence, Estado: o.estado, Pagada: o.pagadaFecha || "", Mensual: o.recurrente === "mensual" ? "sí" : "" });
  for (const [kid, d] of Object.entries(S.kids)) for (const m of d.movs) rows.Ninos.push({ Nino: kidById(kid)?.nombre, Fecha: m.fecha, Tipo: m.tipo, Concepto: m.concepto, Monto: m.monto, Moneda: m.moneda, Guarda: adultById(m.custodio)?.nombre || "", Anulado: m.anulado ? "sí" : "" });
  const name = `respaldo-${S.me.id}-${today()}`;
  try {
    const X = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
    const wb = X.utils.book_new();
    for (const [n, r] of Object.entries(rows)) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(r.length ? r : [{ Info: "Sin datos" }]), n);
    X.writeFile(wb, name + ".xlsx");
  } catch {
    const csv = Object.entries(rows).map(([n, r]) => `${n}\n` + (r.length ? [Object.keys(r[0]).join(";"), ...r.map((x) => Object.values(x).map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";"))].join("\n") : "")).join("\n\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" })); a.download = name + ".csv"; a.click();
  }
  try { localStorage.setItem("ff_backup_" + S.me.id, ym(today())); } catch {}
  toast("Respaldo descargado 📗");
}
const backupDue = () => { if (S.kind !== "adult") return false; let l = null; try { l = localStorage.getItem("ff_backup_" + S.me.id); } catch {} return l !== ym(today()) && +today().slice(8) <= 7; };

function exportData() {
  const data = { exportado: new Date().toISOString(), usuario: S.user.email, cuentas: S.ledgers, ninos: S.kids };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `finanzas-${S.me.id}-${today()}.json`; a.click();
}

// ---------------- Eventos ----------------
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const d = el.dataset;
  switch (d.act) {
    case "demo-login": return store.signIn(d.email);
    case "logout": if (await ask("¿Cerrar sesión?")) { location.hash = ""; store.signOut(); } return;
    case "reset-pw": { const em = $("input[name=email]")?.value || await ask("Escribe tu correo:", "email"); if (!em) return; try { await store.resetPassword(em); toast("Te enviamos un correo para cambiar la contraseña"); } catch (err) { toast(err.message); } return; }
    case "change-pw": { const pw = await ask("Nueva contraseña (mínimo 6 caracteres):", "password"); if (!pw) return; try { await store.changePassword(pw); toast("Contraseña cambiada"); } catch (err) { toast(err.code === "auth/requires-recent-login" ? "Cierra sesión, vuelve a entrar e inténtalo de nuevo" : err.message); } return; }
    case "new-debt": return sheetNewDebt(d.oid);
    case "settle": return sheetSettle(d.oid);
    case "forgive": return sheetForgive(d.oid);
    case "mov": return sheetMov(d.oid, d.id);
    case "plan": return sheetPlan(d.oid, d.id);
    case "split": return sheetSplit();
    case "mes": mercadoMes = d.m; return render();
    case "compra-new": return sheetCompra(null, { items: [] });
    case "compra": return sheetCompra(d.id);
    case "ai-insight": return runInsight(d.m);
    case "remind": return sheetRemind(d.oid);
    case "invite": return sheetInvite();
    case "member": return sheetInvite(d.id);
    case "backup": closeSheet(); return backupExcel();
    case "toggle-signup": signupMode = !signupMode; return render();
    case "verified": try { await store.reloadUser(); } catch {} return;
    case "resend": try { await store.resendVerify(); toast("Correo reenviado ✉️"); } catch (e) { toast(e.message); } return;
    case "obl-new": return sheetObl();
    case "obl": return sheetObl(d.id);
    case "alerts": return showAlerts();
    case "notif": try { const p = await Notification.requestPermission(); toast(p === "granted" ? "Avisos activados 🔔" : "No se activaron los avisos"); render(); } catch { toast("Este navegador no permite avisos"); } return;
    case "kid-cur": kidCurTab[d.kid] = d.cur; return render();
    case "kid-mov": return sheetKidMov(d.kid, d.tipo);
    case "kid-mov-view": return sheetKidMovView(d.kid, d.id);
    case "kid-req": return sheetKidReq(d.kid);
    case "kid-goal": return sheetGoal(d.kid);
    case "goal": return sheetGoal(d.kid, d.id);
    case "sol-ok": return resolveSol(d.kid, d.id, true);
    case "sol-no": return resolveSol(d.kid, d.id, false);
    case "install": if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; render(); } return;
    case "install-help": return sheet(`<h2>Instalar en el celular</h2><div class="card list flat">
      <div class="li"><span class="grow"><b>Android (Chrome)</b><small class="muted">Menú ⋮ → "Instalar aplicación" o "Agregar a pantalla principal"</small></span></div>
      <div class="li"><span class="grow"><b>iPhone (Safari)</b><small class="muted">Botón Compartir ⬆️ → "Agregar a inicio"</small></span></div></div>`);
    case "rules": {
      const r = buildRules();
      sheet(`<h2>Reglas de seguridad</h2><p class="muted small">Cópialas en Firebase → Firestore Database → Reglas → Publicar. Se generan desde config.js: si cambias correos, vuelve a copiarlas.</p><textarea class="code" readonly>${esc(r)}</textarea><button class="btn primary block" id="cp">Copiar</button>`);
      $("#cp").onclick = () => navigator.clipboard.writeText(r).then(() => toast("Copiado"), () => toast("Selecciona y copia manualmente"));
      return;
    }
    case "export": return exportData();
    case "reset-demo": if (await ask("¿Borrar los datos demo y volver al ejemplo?")) { store.resetDemo(); toast("Demo reiniciada"); } return;
  }
});
document.addEventListener("change", (e) => { if (e.target.matches("[data-scan]") && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ""; scanReceipt(f); } });
document.addEventListener("submit", async (e) => {
  if (e.target.dataset.form !== "login") return;
  e.preventDefault();
  const f = e.target, b = f.querySelector("button"); b.disabled = true;
  try { signupMode ? (await store.signUp(f.email.value, f.pw.value), toast("Cuenta creada. Revisa tu correo para confirmarla ✉️")) : await store.signIn(f.email.value, f.pw.value); }
  catch (err) { toast({ "auth/invalid-credential": "Correo o contraseña incorrectos", "auth/email-already-in-use": "Ese correo ya tiene cuenta: usa Entrar", "auth/weak-password": "La contraseña debe tener mínimo 6 caracteres" }[err.code] || err.message); b.disabled = false; }
});
