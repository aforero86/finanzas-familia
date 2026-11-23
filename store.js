// Capa de datos: Firebase (real) o Demo (localStorage). Misma interfaz para ambos.
const CFG = window.APP_CONFIG;
const FB_VER = "12.19.0";

// ---------- IA: instrucciones comunes ----------
export const CATEGORIAS = ["Frutas y verduras", "Carnes y pescados", "Lácteos y huevos", "Panadería", "Granos y despensa", "Bebidas", "Snacks y dulces", "Congelados", "Aseo del hogar", "Cuidado personal", "Mascotas", "Bebé", "Licores", "Otros"];
export const PROMPT_FACTURA = `Eres un asistente que lee facturas o tiquetes de compra de supermercado en Colombia (también pueden ser fotos de pantalla de domicilios).
Devuelve SOLO un JSON válido, sin texto adicional, con esta forma:
{"tienda": string, "fecha": "AAAA-MM-DD" o null, "total": number, "moneda": "COP" o "USD",
 "items": [{"descripcion": string (como aparece), "producto": string (nombre genérico corto en minúsculas y singular, ej. "huevos", "leche", "arroz", "pechuga de pollo", "papel higiénico"), "categoria": una de ${JSON.stringify(CATEGORIAS)}, "cantidad": number, "unidad": "un"|"kg"|"g"|"l"|"ml"|"paq", "total": number}]}
Reglas: en Colombia el punto separa miles ("12.900" = 12900). "total" de cada item es lo pagado por esa línea. Si hay descuentos, réstalos del item correspondiente; si no se puede, agrega un item "descuento" en "Otros" con total negativo. Ignora impuestos ya incluidos, cambio y medios de pago. Si algo no se lee, haz tu mejor estimación; no inventes productos.`;
const parseJSON = (txt) => { const m = String(txt).match(/\{[\s\S]*\}/); if (!m) throw new Error("La IA no devolvió datos"); return JSON.parse(m[0]); };
const dataUrlToBlob = async (u) => (await fetch(u)).blob();

export const ledgerId = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join("|");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ===================== DEMO =====================
function demoStore() {
  const KEY = "ff_demo_v8";
  let mem = null;
  const listeners = new Set();
  const load = () => {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem(KEY)); } catch { mem = null; }
    if (!mem) mem = seed();
    return mem;
  };
  const save = () => { let ok = true; try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { ok = false; } listeners.forEach((f) => f()); if (!ok) throw new Error("Memoria llena"); };
  const node = (path) => { // path: ['ledgers', lid, 'movs']
    let n = load();
    for (const p of path) n = n[p] = n[p] || {};
    return n;
  };
  const watch = (path, cb) => {
    const f = () => cb(Object.values(node(path)));
    listeners.add(f); f();
    return () => listeners.delete(f);
  };
  let userCb = null;
  let current = null;
  try { current = sessionStorage.getItem("ff_demo_user"); } catch {}

  function seed() {
    const m = { ledgers: {}, kids: {} };
    const A = CFG.adults, today = new Date();
    const d = (n) => new Date(today - n * 864e5).toISOString().slice(0, 10);
    if (A.length >= 2) {
      const lid = ledgerId(A[0].email, A[1].email), e0 = A[0].email, e1 = A[1].email;
      const x = (o) => (m.ledgers[lid] = m.ledgers[lid] || { movs: {} }).movs[o.id] = { creadoEn: Date.now(), anulado: false, ...o };
      x({ id: "s1", tipo: "deuda", deudor: e0, acreedor: e1, monto: 120000, moneda: "COP", concepto: "Mercado", fecha: d(20), creadoPor: e1 });
      x({ id: "s2", tipo: "deuda", deudor: e1, acreedor: e0, monto: 45000, moneda: "COP", concepto: "Gasolina", fecha: d(12), creadoPor: e0 });
      x({ id: "s3", tipo: "deuda", deudor: e0, acreedor: e1, monto: 80000, moneda: "COP", concepto: "Recibo gas", fecha: d(5), creadoPor: e0 });
      const ini2 = new Date(today.getFullYear(), today.getMonth() - 1, 5);
      x({ id: "r1", tipo: "recurrente", deudor: e1, acreedor: e0, monto: 70000, moneda: "COP", concepto: "Internet (mitad)", desde: `${ini2.getFullYear()}-${String(ini2.getMonth() + 1).padStart(2, "0")}-05`, variable: true, creadoPor: e0 });
      // Ejemplo de deuda a cuotas: celular pagado con tarjeta, 12 cuotas, empezó hace 3 meses
      const ini = new Date(today.getFullYear(), today.getMonth() - 3, 15);
      for (let i = 0; i < 12; i++) {
        const f = new Date(ini.getFullYear(), ini.getMonth() + i, 15);
        const iso = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-15`;
        x({ id: "c" + i, tipo: "deuda", deudor: e0, acreedor: e1, monto: 125000, moneda: "COP", concepto: `Celular · cuota ${i + 1}/12`, fecha: iso, creadoPor: e0, plan: { id: "pcel", nombre: "Celular", n: 12, i: i + 1 } });
      }
      [[150, 210000], [120, 180000], [95, 95000], [35, 160000], [3, 60000]].forEach(([dd, mm], i) => x({ id: "ph" + i, tipo: "pago", deudor: i % 2 ? e1 : e0, acreedor: i % 2 ? e0 : e1, monto: mm, moneda: "COP", concepto: "Transferencia", fecha: d(dd), creadoPor: e0, aplica: [] }));
      x({ id: "pg1", tipo: "pago", deudor: e0, acreedor: e1, monto: 125000, moneda: "COP", concepto: "Pago cuota 1", fecha: d(60), creadoPor: e0, aplica: [{ deudaId: "c0", monto: 125000 }] });
    }
    if (A.length >= 3) {
      const lid = ledgerId(A[0].email, A[2].email);
      m.ledgers[lid] = { movs: { s4: { id: "s4", tipo: "deuda", deudor: A[2].email, acreedor: A[0].email, monto: 300000, moneda: "COP", concepto: "Medicamentos", fecha: d(8), creadoPor: A[0].email, creadoEn: Date.now(), anulado: false } } };
    }
    if (A.length) {
      const ob = (m.users = { [A[0].email]: { obligaciones: {} } })[A[0].email].obligaciones;
      const fut = (n) => new Date(+today + n * 864e5).toISOString().slice(0, 10);
      ob.o1 = { id: "o1", tipo: "pagar", concepto: "Tarjeta Visa", contraparte: "Banco", monto: 850000, moneda: "COP", vence: fut(1), recurrente: "mensual", estado: "pendiente", creadoEn: Date.now() };
      ob.o2 = { id: "o2", tipo: "pagar", concepto: "Préstamo", contraparte: "Juan (compañero)", monto: 200000, moneda: "COP", vence: d(2), recurrente: "no", estado: "pendiente", creadoEn: Date.now() };
      ob.o4 = { id: "o4", tipo: "pagar", concepto: "Recibo de energía", contraparte: "Enel", monto: 180000, variable: true, moneda: "COP", vence: fut(2), recurrente: "mensual", estado: "pendiente", creadoEn: Date.now() };
      ob.o3 = { id: "o3", tipo: "cobrar", concepto: "Venta bicicleta", contraparte: "Carlos", monto: 300000, moneda: "COP", vence: fut(12), recurrente: "no", estado: "pendiente", creadoEn: Date.now() };
    }
    m.hogar = { mercado: { compras: seedCompras(A[0]?.email, A[1]?.email) } };
    CFG.kids.forEach((k, i) => {
      const kk = (m.kids[k.id] = { movs: {}, metas: {}, solicitudes: {} });
      const add = (o) => (kk.movs[o.id] = { creadoEn: Date.now(), anulado: false, creadoPor: A[0].email, ...o });
      add({ id: "k1" + i, tipo: "deposito", moneda: "COP", monto: 150000 + i * 50000, concepto: "Regalo cumpleaños", fecha: d(60), custodio: A[0].id });
      add({ id: "k2" + i, tipo: "deposito", moneda: "USD", monto: 40 + i * 10, concepto: "Regalo de la abuela", fecha: d(30), custodio: A[2]?.id || A[0].id });
      add({ id: "k3" + i, tipo: "retiro", moneda: "COP", monto: 30000, concepto: "Juguete", fecha: d(10), custodio: A[0].id });
      kk.metas["m" + i] = { id: "m" + i, nombre: i ? "Patines" : "Bicicleta", emoji: i ? "⛸️" : "🚲", moneda: "COP", objetivo: 400000, creadoEn: Date.now() };
    });
    return m;
  }

  const meFromEmail = (e) => (e ? { email: e } : null);
  return {
    mode: "demo",
    async init() { load(); },
    onUser(cb) { userCb = cb; cb(meFromEmail(current)); },
    async signIn(email) {
      current = email.toLowerCase();
      try { sessionStorage.setItem("ff_demo_user", current); } catch {}
      userCb && userCb(meFromEmail(current));
    },
    async signOut() { current = null; try { sessionStorage.removeItem("ff_demo_user"); } catch {} userCb && userCb(null); },
    async resetPassword() {},
    resetDemo() { mem = seed(); save(); },
    watchCompras: (cb) => watch(["hogar", "mercado", "compras"], cb),
    async addCompra(data) { const id = uid(); node(["hogar", "mercado", "compras"])[id] = { ...data, id, creadoPor: current, creadoEn: Date.now() }; save(); return id; },
    async updateCompra(id, patch) { const n = node(["hogar", "mercado", "compras"]); if (n[id]) { Object.assign(n[id], patch); save(); } },
    async deleteCompra(id) { delete node(["hogar", "mercado", "compras"])[id]; save(); },
    // IA en la demo: Claude (si la página corre dentro de Claude); si no, lectura simulada
    async aiSample() { try { return (await window.claude?.use?.("sample")) || null; } catch { return null; } },
    async aiExtract(dataUrl) {
      const s = await this.aiSample();
      if (s) { const r = await s(PROMPT_FACTURA, { images: [await dataUrlToBlob(dataUrl)], modelTier: "default" }); return { ...parseJSON(r.text), _ia: "Claude" }; }
      await new Promise((r) => setTimeout(r, 1200));
      return { ...simulatedReceipt(), _ia: "simulada" };
    },
    async aiText(prompt) {
      const s = await this.aiSample();
      if (s) return (await s(prompt, { modelTier: "default" })).text;
      return "• (Demo sin IA conectada) Aquí verás el análisis escrito por la IA con tus datos reales: en qué subió el gasto, qué productos compran más seguido y 2–3 ideas concretas para ahorrar.";
    },
    watchFamily(cb) { const f = () => cb(load().family || null); listeners.add(f); f(); return () => listeners.delete(f); },
    async saveFamily(data) { load().family = data; save(); },
    watchLedger: (lid, cb) => watch(["ledgers", lid, "movs"], cb),
    async addLedgerMov(lid, data) { const id = uid(); node(["ledgers", lid, "movs"])[id] = { ...data, id, creadoPor: current, creadoEn: Date.now(), anulado: false }; save(); return id; },
    async setLedgerMov(lid, id, data) { const n = node(["ledgers", lid, "movs"]); if (n[id]) return; n[id] = { ...data, id, creadoPor: current, creadoEn: Date.now(), anulado: false }; save(); },
    async confirmLedgerAmt(lid, id, monto) { const n = node(["ledgers", lid, "movs"]); if (n[id]) { n[id].monto = monto; n[id].porConfirmar = false; save(); } },
    async annulLedgerMov(lid, id) { const n = node(["ledgers", lid, "movs"]); if (n[id]) { n[id].anulado = true; n[id].anuladoEn = Date.now(); save(); } },
    watchKid: (kid, sub, cb) => watch(["kids", kid, sub], cb),
    async addAtt(scope, a) { const id = uid(); node([...scope, "adjuntos"])[id] = { ...a, id, creadoPor: current, creadoEn: Date.now() }; try { save(); } catch { throw new Error("Memoria del demo llena"); } return id; },
    async getAtt(scope, id) { return node([...scope, "adjuntos"])[id] || null; },
    async setLedgerAtt(lid, id, ids) { const n = node(["ledgers", lid, "movs"]); if (n[id]) { n[id].adjuntos = ids; save(); } },
    watchMine: (em, cb) => watch(["users", em, "obligaciones"], cb),
    async addMine(em, data) { const id = uid(); node(["users", em, "obligaciones"])[id] = { ...data, id, creadoEn: Date.now() }; save(); return id; },
    async updateMine(em, id, patch) { const n = node(["users", em, "obligaciones"]); if (n[id]) { Object.assign(n[id], patch); save(); } },
    async deleteMine(em, id) { delete node(["users", em, "obligaciones"])[id]; save(); },
    async addKid(kid, sub, data) { const id = uid(); node(["kids", kid, sub])[id] = { ...data, id, creadoPor: current, creadoEn: Date.now() }; save(); return id; },
    async updateKid(kid, sub, id, patch) { const n = node(["kids", kid, sub]); if (n[id]) { Object.assign(n[id], patch); save(); } },
    async deleteKid(kid, sub, id) { delete node(["kids", kid, sub])[id]; save(); },
  };
}

// ===================== FIREBASE =====================
async function firebaseStore() {
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
  const { initializeApp } = await import(base + "firebase-app.js");
  const A = await import(base + "firebase-auth.js");
  const F = await import(base + "firebase-firestore.js");
  const app = initializeApp(CFG.firebase);
  const auth = A.getAuth(app);
  await A.setPersistence(auth, A.browserLocalPersistence).catch(() => {});
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch { db = F.getFirestore(app); }
  // App Check (obligatorio para usar la IA de Firebase desde la web)
  if (CFG.appCheckKey) {
    try { const AC = await import(base + "firebase-app-check.js"); AC.initializeAppCheck(app, { provider: new AC.ReCaptchaEnterpriseProvider(CFG.appCheckKey), isTokenAutoRefreshEnabled: true }); }
    catch (e) { console.warn("App Check no cargó", e); }
  }
  let AI = null;
  async function aiModel(json) {
    AI = AI || await import(base + "firebase-ai.js");
    const ai = AI.getAI(app, { backend: new AI.GoogleAIBackend() });
    return AI.getGenerativeModel(ai, { model: CFG.aiModel || "gemini-2.5-flash", ...(json ? { generationConfig: { responseMimeType: "application/json" } } : {}) });
  }
  let me = null, userCb = null;
  const col = (...p) => F.collection(db, ...p);
  const watch = (ref, cb, onErr) =>
    F.onSnapshot(ref, (s) => cb(s.docs.map((d) => ({ ...d.data(), id: d.id }))), (e) => { console.error(e); onErr ? onErr(e) : cb([]); });

  return {
    mode: "firebase",
    async init() {},
    onUser(cb) { userCb = cb; A.onAuthStateChanged(auth, (u) => { me = u ? u.email.toLowerCase() : null; cb(u ? { email: me, verified: u.emailVerified } : null); }); },
    async signUp(email, pw) { const r = await A.createUserWithEmailAndPassword(auth, email.trim(), pw); await A.sendEmailVerification(r.user).catch(() => {}); },
    resendVerify: () => A.sendEmailVerification(auth.currentUser),
    async reloadUser() { await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); const u = auth.currentUser; userCb && userCb({ email: u.email.toLowerCase(), verified: u.emailVerified }); },
    watchCompras: (cb, err) => watch(col("hogar", "mercado", "compras"), cb, err),
    async addCompra(data) { const r = await F.addDoc(col("hogar", "mercado", "compras"), { ...data, creadoPor: me, creadoEn: Date.now() }); return r.id; },
    updateCompra: (id, patch) => F.updateDoc(F.doc(db, "hogar", "mercado", "compras", id), patch),
    deleteCompra: (id) => F.deleteDoc(F.doc(db, "hogar", "mercado", "compras", id)),
    async aiExtract(dataUrl) {
      const model = await aiModel(true);
      const r = await model.generateContent([PROMPT_FACTURA, { inlineData: { data: dataUrl.split(",")[1], mimeType: "image/jpeg" } }]);
      return { ...parseJSON(r.response.text()), _ia: "Gemini" };
    },
    async aiText(prompt) { const model = await aiModel(false); return (await model.generateContent(prompt)).response.text(); },
    watchFamily: (cb, err) => F.onSnapshot(F.doc(db, "family", "config"), (d) => cb(d.exists() ? d.data() : null), (e) => { console.error(e); err && err(e); }),
    saveFamily: (data) => F.setDoc(F.doc(db, "family", "config"), data),
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email.trim(), pw),
    signOut: () => A.signOut(auth),
    resetPassword: (email) => A.sendPasswordResetEmail(auth, email.trim()),
    changePassword: (pw) => A.updatePassword(auth.currentUser, pw),
    watchLedger: (lid, cb, err) => watch(col("ledgers", lid, "movs"), cb, err),
    async addLedgerMov(lid, data) { const r = await F.addDoc(col("ledgers", lid, "movs"), { ...data, creadoPor: me, creadoEn: Date.now(), anulado: false }); return r.id; },
    setLedgerMov: (lid, id, data) => F.setDoc(F.doc(db, "ledgers", lid, "movs", id), { ...data, creadoPor: me, creadoEn: Date.now(), anulado: false }),
    confirmLedgerAmt: (lid, id, monto) => F.updateDoc(F.doc(db, "ledgers", lid, "movs", id), { monto, porConfirmar: false }),
    annulLedgerMov: (lid, id) => F.updateDoc(F.doc(db, "ledgers", lid, "movs", id), { anulado: true, anuladoEn: Date.now() }),
    watchKid: (kid, sub, cb, err) => watch(col("kids", kid, sub), cb, err),
    async addAtt(scope, a) { const r = await F.addDoc(col(...scope, "adjuntos"), { ...a, creadoPor: me, creadoEn: Date.now() }); return r.id; },
    async getAtt(scope, id) { const d = await F.getDoc(F.doc(db, ...scope, "adjuntos", id)); return d.exists() ? d.data() : null; },
    setLedgerAtt: (lid, id, ids) => F.updateDoc(F.doc(db, "ledgers", lid, "movs", id), { adjuntos: ids }),
    watchMine: (em, cb, err) => watch(col("users", em, "obligaciones"), cb, err),
    async addMine(em, data) { const r = await F.addDoc(col("users", em, "obligaciones"), { ...data, creadoEn: Date.now() }); return r.id; },
    updateMine: (em, id, patch) => F.updateDoc(F.doc(db, "users", em, "obligaciones", id), patch),
    deleteMine: (em, id) => F.deleteDoc(F.doc(db, "users", em, "obligaciones", id)),
    async addKid(kid, sub, data) { const r = await F.addDoc(col("kids", kid, sub), { ...data, creadoPor: me, creadoEn: Date.now() }); return r.id; },
    updateKid: (kid, sub, id, patch) => F.updateDoc(F.doc(db, "kids", kid, sub, id), patch),
    deleteKid: (kid, sub, id) => F.deleteDoc(F.doc(db, "kids", kid, sub, id)),
  };
}

export async function createStore() {
  if (CFG.firebase && CFG.firebase.apiKey) {
    try { return await firebaseStore(); }
    catch (e) { console.error("Firebase no cargó", e); alert("No se pudo conectar con Firebase. Revisa internet o config.js."); throw e; }
  }
  return demoStore();
}

// Reglas de seguridad generadas desde config.js (se copian en Firebase > Firestore > Reglas)
export function buildRules() {
  const admin = (CFG.admin || CFG.adults[0].email).toLowerCase();
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // La lista de la familia vive en family/config (se edita desde la app: Más → Invitar).
    function fam() { return get(/databases/$(database)/documents/family/config).data; }
    function email() { return request.auth != null && request.auth.token.email != null ? request.auth.token.email.lower() : ''; }
    function ok() { return email() != '' && (request.auth.token.email_verified == true || email() in fam().noVerify); }
    function adults() { return fam().adultEmails; }
    function isAdult() { return ok() && email() in adults(); }
    function isKid(k) { return ok() && email() == fam().kidEmails.get(k, '#'); }
    function inPair(lid) { let p = lid.split('[|]'); return isAdult() && p.size() == 2 && email() in p && p[0] in adults() && p[1] in adults(); }
    function changes() { return request.resource.data.diff(resource.data).affectedKeys(); }

    match /family/config {
      allow read: if email() != '' && (resource == null || email() in resource.data.emails);
      allow create: if email() == '${admin}';
      allow update: if email() == resource.data.admin && request.resource.data.admin == resource.data.admin;
    }

    // Deudas entre dos adultos: SOLO esas dos personas pueden leer/escribir.
    match /ledgers/{lid}/movs/{m} {
      allow read: if inPair(lid);
      allow create: if inPair(lid) && request.resource.data.creadoPor == email()
                    && request.resource.data.deudor in lid.split('[|]') && request.resource.data.acreedor in lid.split('[|]');
      allow update: if inPair(lid) && (
                      (resource.data.creadoPor == email() && changes().hasOnly(['anulado', 'anuladoEn']))
                      || changes().hasOnly(['adjuntos'])
                      || (resource.data.get('porConfirmar', false) == true && changes().hasOnly(['monto', 'porConfirmar'])));
    }
    match /ledgers/{lid}/adjuntos/{a} {
      allow read, create: if inPair(lid);
    }

    // Obligaciones y fotos personales: solo su dueño.
    match /users/{em}/{sub}/{o} {
      allow read, write: if ok() && email() == em && (sub == 'obligaciones' || sub == 'adjuntos');
    }

    // Mercado del hogar (facturas y análisis): todos los adultos.
    match /hogar/mercado/{sub}/{id} {
      allow read, write: if isAdult() && (sub == 'compras' || sub == 'adjuntos');
    }

    // Cuentas de los niños: los adultos administran; cada niño solo ve la suya.
    match /kids/{kid}/movs/{m} {
      allow read: if isAdult() || isKid(kid);
      allow create, update: if isAdult();
    }
    match /kids/{kid}/adjuntos/{a} {
      allow read: if isAdult() || isKid(kid);
      allow create: if isAdult();
    }
    match /kids/{kid}/metas/{m} {
      allow read, write: if isAdult() || isKid(kid);
    }
    match /kids/{kid}/solicitudes/{s} {
      allow read: if isAdult() || isKid(kid);
      allow create: if (isAdult() || isKid(kid)) && request.resource.data.estado == 'pendiente';
      allow update: if isAdult();
    }
  }
}`;
}

// ---------- Datos de ejemplo para la demo ----------
const CATALOGO = [
  ["huevos", "Huevos AA x30", "Lácteos y huevos", 17900, 0.07], ["leche", "Leche entera 1.1L x6", "Lácteos y huevos", 21500, 0.02], ["queso", "Queso campesino 500g", "Lácteos y huevos", 12900, 0.01],
  ["pechuga de pollo", "Pechuga pollo kg", "Carnes y pescados", 18900, 0.03], ["carne molida", "Carne molida res kg", "Carnes y pescados", 26900, 0.05], ["tilapia", "Filete tilapia", "Carnes y pescados", 22900, 0],
  ["arroz", "Arroz Diana 5kg", "Granos y despensa", 21900, 0], ["aceite", "Aceite girasol 3L", "Granos y despensa", 32900, -0.03], ["pasta", "Pasta spaghetti 500g", "Granos y despensa", 3900, 0], ["café", "Café molido 500g", "Granos y despensa", 19900, 0.04],
  ["banano", "Banano kg", "Frutas y verduras", 3200, 0], ["tomate", "Tomate chonto kg", "Frutas y verduras", 4800, 0.12], ["papa", "Papa pastusa kg", "Frutas y verduras", 3100, -0.05], ["aguacate", "Aguacate hass und", "Frutas y verduras", 2900, 0.06], ["cebolla", "Cebolla cabezona kg", "Frutas y verduras", 3600, 0],
  ["pan tajado", "Pan tajado", "Panadería", 7900, 0.02], ["galletas", "Galletas surtidas", "Snacks y dulces", 8900, 0], ["gaseosa", "Gaseosa 2.5L", "Bebidas", 7500, 0.03], ["jugo", "Jugo caja 1L", "Bebidas", 5900, 0],
  ["papel higiénico", "Papel higiénico x12", "Aseo del hogar", 24900, 0], ["detergente", "Detergente 3kg", "Aseo del hogar", 34900, 0.02], ["jabón de manos", "Jabón líquido manos", "Cuidado personal", 9900, 0], ["concentrado perro", "Concentrado perro 4kg", "Mascotas", 48900, 0],
];
function seedCompras(e0, e1) {
  const out = {}, today = new Date();
  let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const tiendas = ["Éxito", "Carulla", "D1", "Ara", "Plaza de mercado"];
  for (let dd = 170, n = 0; dd >= 1; dd -= 4 + Math.floor(rnd() * 5), n++) {
    const f = new Date(today - dd * 864e5), fecha = f.toISOString().slice(0, 10), meses = dd / 30;
    const k = 4 + Math.floor(rnd() * 7), items = [], usados = new Set();
    for (let i = 0; i < k; i++) {
      const p = CATALOGO[Math.floor(rnd() * CATALOGO.length)]; if (usados.has(p[0])) continue; usados.add(p[0]);
      const cant = p[2] === "Frutas y verduras" ? Math.round((0.5 + rnd() * 2) * 10) / 10 : 1 + (rnd() < 0.2 ? 1 : 0);
      const unit = Math.round(p[3] * Math.pow(1 + p[4], 6 - meses) / 100) * 100;
      items.push({ descripcion: p[1], producto: p[0], categoria: p[2], cantidad: cant, unidad: p[2] === "Frutas y verduras" ? "kg" : "un", total: Math.round(unit * cant / 100) * 100 });
    }
    const total = items.reduce((s, x) => s + x.total, 0);
    out["c" + n] = { id: "c" + n, fecha, tienda: tiendas[Math.floor(rnd() * tiendas.length)], total, moneda: "COP", items, creadoPor: rnd() < 0.6 ? e0 : e1, creadoEn: Date.now() };
  }
  return out;
}
function simulatedReceipt() {
  const items = [["huevos", "HUEVO AA X30", "Lácteos y huevos", 1, "un", 19200], ["leche", "LECHE ENTERA 1100ML X6", "Lácteos y huevos", 1, "un", 21900], ["pechuga de pollo", "PECHUGA POLLO KG", "Carnes y pescados", 1.2, "kg", 23500],
    ["tomate", "TOMATE CHONTO", "Frutas y verduras", 1.5, "kg", 8100], ["arroz", "ARROZ DIANA 5KG", "Granos y despensa", 1, "un", 21900], ["papel higiénico", "PAPEL HIG X12", "Aseo del hogar", 1, "un", 24900]]
    .map(([producto, descripcion, categoria, cantidad, unidad, total]) => ({ producto, descripcion, categoria, cantidad, unidad, total }));
  return { tienda: "Éxito (lectura simulada)", fecha: new Date().toISOString().slice(0, 10), total: items.reduce((s, x) => s + x.total, 0), moneda: "COP", items };
}
