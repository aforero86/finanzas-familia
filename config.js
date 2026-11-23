// =====================================================
//  CONFIGURACIÓN DE LA FAMILIA  (único archivo a editar)
// =====================================================
// 1) Cambia nombres y correos (los correos son el usuario de cada uno).
// 2) Pega aquí los datos de Firebase (paso 3 de la GUÍA).
//    Mientras firebase sea null, la app corre en MODO DEMO (datos solo en este equipo).

window.APP_CONFIG = {
  appName: "Finanzas Familia",
  admin: "aforero86@gmail.com",        // Quien puede invitar miembros (normalmente tú)
  bankName: "Banco Forero",          // Nombre del "banco" que ven los niños

  // Solo el administrador. A los demás se les invita desde la app (Más → Invitar a un familiar).
  adults: [
    { id: "andres", nombre: "Andrés", email: "aforero86@gmail.com", emoji: "👨" },
  ],

  // Los niños también se agregan desde la app (Más → Invitar → Niño).
  kids: [],

  currencies: ["COP", "USD"],

  // IA para leer facturas (Firebase AI Logic → Gemini). Ver GUÍA paso 8.
  aiModel: "gemini-2.5-flash",       // si Firebase cambia de modelo, pon aquí el nombre que muestre la consola
  appCheckKey: "",                   // clave de sitio de reCAPTCHA Enterprise (App Check)

  // Pega aquí el objeto firebaseConfig de tu proyecto (o deja null para modo demo)
  firebase: {
    apiKey: "AIzaSyAK9_Uv7EX6xD2hfRt8oTh4adK0MxrzYWs",
    authDomain: "finanzas-familia-62096.firebaseapp.com",
    projectId: "finanzas-familia-62096",
    storageBucket: "finanzas-familia-62096.firebasestorage.app",
    messagingSenderId: "525831430750",
    appId: "1:525831430750:web:05b78e90cb4f2ded788acf",
  },
};
