# Finanzas Familia — Guía de puesta en marcha

Tiempo: ~20 min, una sola vez. Todo gratis (Firebase plan Spark + GitHub Pages).

## 1. Ajusta `config.js`
- Nombres y **correos** de los 3 adultos y los 2 niños (el correo es el usuario).
- Los niños pueden tener un correo inventado (ej. `hijo1@familia.app`) solo para entrar.
- `bankName`: el nombre del banco que verán los niños.

## 2. Crea el proyecto en Firebase (console.firebase.google.com)
1. **Agregar proyecto** → nombre `finanzas-familia` → sin Analytics.
2. **Authentication** → Comenzar → habilita **Correo electrónico/contraseña**.
3. Authentication → **Usuarios** → *Agregar usuario*: crea uno por persona de config.js con una contraseña inicial (cada uno la cambia luego en Más).
4. Deja activado el registro: los familiares que invites desde la app crean su propia cuenta y deben confirmar su correo. Alguien externo podría crear una cuenta, pero no verá nada: solo entra quien esté en la lista de la familia.
5. **Firestore Database** → Crear base de datos → modo producción → región `southamerica-east1` (o la más cercana).

## 3. Conecta la app
1. Configuración del proyecto (⚙️) → **Tus apps** → ícono web `</>` → registra "finanzas".
2. Copia el objeto `firebaseConfig` y pégalo en `config.js` en `firebase: { ... }`.

## 4. Publica la app (GitHub Pages)
1. Crea cuenta en github.com → **New repository** → `finanzas-familia` (público o privado con plan que lo permita).
2. *Add file → Upload files* → arrastra TODO el contenido de la carpeta (incluida `icons/`).
3. Settings → **Pages** → Branch `main` / root → Save. En 1–2 min tendrás: `https://TUUSUARIO.github.io/finanzas-familia/`
   - Alternativa más rápida: app.netlify.com/drop (arrastras la carpeta).

## 5. Reglas de seguridad (lo que garantiza la privacidad)
1. Abre la app → entra como Andrés → **Más → Ver reglas de seguridad → Copiar**.
2. Firebase → Firestore → **Reglas** → pega → **Publicar**.
3. Si cambias un correo en config.js, repite este paso.

Qué garantizan: cada cuenta entre dos adultos solo la pueden leer esas dos personas (ni siquiera el administrador ve la de los otros dos). Cada niño solo ve la suya; los adultos administran las de los niños.

## 6. Primer ingreso (importante)
Entra primero tú (el administrador de config.js): la app crea la lista de la familia en la base de datos. Desde ahí, para sumar a alguien: **Más → Invitar a un familiar** → se le arma el mensaje de WhatsApp con el enlace. Para niños o correos inventados marca "Yo le creo la cuenta" y créala en Firebase → Authentication.

## 7. Activar la IA del Mercado (lectura de facturas)
Usa **Gemini a través de Firebase AI Logic**, con su nivel gratuito (sin tarjeta) para un uso familiar normal.
1. Firebase → **AI Services → AI Logic → Comenzar** → elige **Gemini Developer API** (la gratuita).
2. El asistente activa **App Check** (protege la IA de abusos): registra la app web con **reCAPTCHA Enterprise**, agrega tu dominio (ej. `tuusuario.github.io`) y copia la **clave del sitio**.
3. En `config.js` pega esa clave en `appCheckKey`. Si la consola muestra otro nombre de modelo recomendado, cámbialo en `aiModel`.
4. Listo: en la pestaña **Mercado → Escanear factura** toma la foto y revisa lo que leyó la IA antes de guardar.
Privacidad: la foto de la factura se envía a Google para leerla; no mandes fotos con datos de tarjetas completos. Si la IA no está configurada o falla, puedes registrar la compra a mano.

## 8. Instalar en cada celular
- Android (Chrome): abrir el enlace → menú ⋮ → *Instalar aplicación*.
- iPhone (Safari): Compartir ⬆️ → *Agregar a inicio*.

## Actualizar la app
Sube los archivos nuevos al repositorio (reemplazando). Al abrirla con internet toma la última versión. Los datos no se tocan.

## Cómo funciona
- **Pendiente**: quién debe a quién, monto, moneda, concepto.
- **Pagar / cruzar**: marcas varios pendientes (en ambos sentidos). Lo mutuo se cruza y solo se paga la diferencia. Si se paga menos, abona primero a lo más antiguo; si se paga de más, el excedente queda como saldo a favor.
- **Condonar**: solo quien presta puede perdonar (total o parcial). Queda en el historial.
- **Anular**: solo quien registró el movimiento; queda visible como anulado (nada se borra).
- **Deudas a cuotas** (ej. celular pagado con tarjeta): total, n.º de cuotas y valor de cuota (si hay intereses, la cuota real). Muestra cuánto falta, cuotas vencidas y próxima; al pagar vienen marcadas las vencidas y puedes adelantar.
- **Pendientes mensuales compartidos (🔁 Cada mes)**: en Cuentas → Pendiente → "Cada mes". Se crea solo cada mes y lo ven las dos personas. Si el valor cambia, cualquiera de los dos lo confirma cuando llega el recibo. Se detiene desde el historial.
- **Gasto compartido entre varios**: en Cuentas. Ej: donación, regalo, mercado. Se divide en partes iguales (o como quieras) y a cada persona le aparece en sus Cuentas lo que debe a quien pagó. Puede ser mensual. Si pagó otra persona, solo registras tu parte (por privacidad, no ves las cuentas entre los demás).
- **Alertas a ambos lados**: quien debe ve "Le debes a…" y quien prestó ve "…te debe" cuando hay cuotas o meses vencidos.
- **Pagos (obligaciones)**: deudas o cobros con cualquier persona o entidad, con fecha y opción mensual. Son privadas (solo tú las ves). Al abrir la app, una vez al día, sale una ventana con lo vencido o por vencer (3 días) para marcar "Ya pagué / Aún no". Si es mensual, al pagarla se crea la del mes siguiente.
- **Servicios públicos / valores que cambian**: marca "El valor cambia cada mes"; pones un valor aproximado (o nada) y al marcarla pagada te pregunta cuánto pagaste. La del mes siguiente se crea sola.
- **Soportes (fotos)**: en pendientes, pagos, obligaciones y cuentas de los niños puedes adjuntar hasta 3 fotos (recibo o pantallazo) al crear, o agregarlas después desde el detalle. Se comprimen en el celular y se guardan con los datos (no requiere plan de pago de Firebase).
- **Panel del mes**: cuánto pagaste y te pagaron (últimos 6 meses), obligaciones pagadas y detalle por persona.
- **Recordar por WhatsApp**: en la cuenta con alguien que te debe, arma un mensaje amable con el detalle; lo editas y lo envías.
- **Respaldo en Excel**: Más → Descargar respaldo. Los primeros días de cada mes la ventana de alertas te lo recuerda.
- **Mercado con IA**: foto de la factura → la IA lee productos, cantidades y precios y los clasifica (frutas y verduras, carnes, lácteos, aseo…). Muestra en qué se va la plata, la variación contra el promedio de los 3 meses anteriores (comparando a la misma fecha si el mes va en curso), lo que más compran y cada cuánto, y los productos que subieron o bajaron de precio. El botón **Análisis con IA** escribe un resumen con ideas para ahorrar. Las compras del mercado las ven todos los adultos.
- **Sesión**: se inicia una sola vez por celular; queda abierta hasta "Cerrar sesión".
- **Niños**: cuentas en pesos y dólares, quién guarda el dinero, metas, comprobantes, y el niño puede **pedir retiros** que un adulto aprueba.
