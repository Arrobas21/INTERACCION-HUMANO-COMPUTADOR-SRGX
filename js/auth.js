// Autenticación de clientes y administradores con la misma base de usuarios.
let usuarioActual = null;
let rolActual = null;
let modoRegistro = false;
let destinoCliente = 'cuenta';
let autenticando = false;
let versionSesion = 0;

function limpiarDatosPrivados() {
    for (const selector of ['#mis-reservas', '#admin-reservas', '#dnis']) elemento(selector).replaceChildren();
    revisionDisponibilidad++;
    revisionAdmin++;
    elemento('#reserva-form').reset();
    elemento('#reserva-form').hidden = true;
    elemento('#who').textContent = '';
    elemento('#admin-who').textContent = '';
    elemento('#mesas-form').reset();
    elemento('#capacidad').textContent = '';
    for (const selector of ['#cuenta-msg','#admin-msg','#mesas-msg','#reserva-msg','#disponibilidad-msg']) mostrarMensaje(selector, '');
}
async function actualizarSesion(sesion) {
    const version = ++versionSesion;
    const nuevoUsuario = sesion?.user || null;
    if (usuarioActual?.id !== nuevoUsuario?.id || !nuevoUsuario) limpiarDatosPrivados();
    usuarioActual = nuevoUsuario;
    rolActual = null;
    if (nuevoUsuario) {
        const {data, error} = await db.from('profiles').select('nombre,rol').eq('id', nuevoUsuario.id).single();
        if (version !== versionSesion) return;
        if (!error && ['cliente','admin'].includes(data?.rol)) rolActual = data.rol;
        const texto = `${data?.nombre || nuevoUsuario.email} · ${nuevoUsuario.email}`;
        elemento('#who').textContent = texto;
        elemento('#admin-who').textContent = texto;
    }
    elemento('#nav-auth').textContent = rolActual === 'cliente' ? 'Mi cuenta' : 'Ingresar';
    elemento('#nav-admin').textContent = rolActual === 'admin' ? 'Administración' : 'Acceso admin';
}
function cambiarModoRegistro(registro) {
    modoRegistro = registro;
    elemento('#tab-in').setAttribute('aria-selected', String(!registro));
    elemento('#tab-up').setAttribute('aria-selected', String(registro));
    elemento('#f-nombre').hidden = !registro;
    elemento('#f-nombre input').required = registro;
    elemento('#auth-submit').textContent = registro ? 'Crear cuenta' : 'Iniciar sesión';
    elemento('#auth-form [name="password"]').autocomplete = registro ? 'new-password' : 'current-password';
    mostrarMensaje('#auth-msg', '');
}
async function autenticar(evento, administrador) {
    evento.preventDefault();
    if (autenticando) return;
    autenticando = true;
    const formulario = evento.target;
    const datos = new FormData(formulario);
    const selector = administrador ? '#admin-login-msg' : '#auth-msg';
    const boton = formulario.querySelector('button[type="submit"],button:not([type])');
    boton.disabled = true;
    mostrarMensaje(selector, 'Un momento…');
    try {
        const email = datos.get('email');
        const password = datos.get('password');
        const registro = !administrador && modoRegistro;
        // Evita conservar la sesión anterior al intentar acceder con otra cuenta.
        if (usuarioActual) {
            const salida = await db.auth.signOut();
            if (salida.error) throw salida.error;
            await actualizarSesion(null);
        }
        const respuesta = registro ? await db.auth.signUp({email, password, options:{data:{nombre:datos.get('nombre')}}}) : await db.auth.signInWithPassword({email,password});
        if (respuesta.error) throw respuesta.error;
        if (!respuesta.data.session) {
            mostrarMensaje(selector, 'Cuenta creada. Confirma tu correo y luego inicia sesión.');
            return;
        }
        await actualizarSesion(respuesta.data.session);
        if (rolActual !== (administrador ? 'admin' : 'cliente')) {
            const salida = await db.auth.signOut();
            await actualizarSesion(null);
            if (salida.error) throw salida.error;
            mostrarMensaje(selector, 'Esta cuenta no tiene el rol requerido para este acceso.', true);
            return;
        }
        formulario.reset();
        mostrarMensaje(selector, '');
        await navegar(administrador ? 'admin' : destinoCliente);
    } catch(error) {
        mostrarMensaje(selector, error.message || 'No se pudo completar la autenticación.', true);
    } finally { boton.disabled = false; autenticando = false; }
}
async function cerrarSesion() {
    const eraAdmin = rolActual === 'admin';
    autenticando = true;
    try {
        const {error} = await db.auth.signOut();
        if (error) throw error;
        await actualizarSesion(null);
        cambiarModoRegistro(false);
        mostrarVista(eraAdmin ? 'admin-login' : 'login');
    } catch(error) { mostrarMensaje(eraAdmin ? '#admin-msg' : '#cuenta-msg', error.message, true); }
    finally { autenticando = false; }
}
async function inicializarAutenticacion() {
    elemento('#tab-in').addEventListener('click', () => cambiarModoRegistro(false));
    elemento('#tab-up').addEventListener('click', () => cambiarModoRegistro(true));
    elemento('#auth-form').addEventListener('submit', e => autenticar(e,false));
    elemento('#admin-login-form').addEventListener('submit', e => autenticar(e,true));
    elemento('#logout').addEventListener('click', cerrarSesion);
    elemento('#admin-logout').addEventListener('click', cerrarSesion);
    const {data,error} = await db.auth.getSession();
    if (error) mostrarMensaje('#auth-msg',error.message,true);
    await actualizarSesion(data?.session);
    db.auth.onAuthStateChange((_evento,sesion) => {
        if (autenticando) return;
        setTimeout(async () => {
            if (autenticando || (sesion?.user?.id ?? null) === (usuarioActual?.id ?? null)) return;
            await actualizarSesion(sesion);
            const vista = elemento('[data-view]:not([hidden])')?.dataset.view;
            if (vista === 'admin' && rolActual !== 'admin') mostrarVista('admin-login');
            if (vista === 'cuenta' && rolActual !== 'cliente') mostrarVista('login');
            if (vista === 'reservas') await prepararReserva();
        },0);
    });
}
