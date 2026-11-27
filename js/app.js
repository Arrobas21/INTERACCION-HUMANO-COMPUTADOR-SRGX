// Navegación e inicialización. Las restricciones reales se aplican en Supabase.
const elemento = selector => document.querySelector(selector);
function mostrarMensaje(selector, mensaje, esError = false) {
    const destino = elemento(selector);
    destino.textContent = mensaje;
    destino.classList.toggle('error', esError);
}
function mostrarVista(nombre) {
    if (nombre === 'cuenta' && rolActual !== 'cliente') nombre = 'login';
    if (nombre === 'admin' && rolActual !== 'admin') nombre = 'admin-login';
    for (const vista of document.querySelectorAll('[data-view]')) {
        vista.hidden = vista.dataset.view !== nombre;
    }
    for (const enlace of document.querySelectorAll('.nav-link')) {
        const destino = enlace.id === 'nav-auth' ? (rolActual === 'cliente' ? 'cuenta' : 'login') :
            enlace.id === 'nav-admin' ? (rolActual === 'admin' ? 'admin' : 'admin-login') : enlace.dataset.viewLink;
        enlace.classList.toggle('active', destino === nombre);
        if (destino === nombre) enlace.setAttribute('aria-current', 'page');
        else enlace.removeAttribute('aria-current');
    }
    window.scrollTo({top: 0, behavior: 'smooth'});
}
async function navegar(nombre) {
    mostrarVista(nombre);
    if (nombre === 'reservas') await prepararReserva();
    if (nombre === 'cuenta' && rolActual === 'cliente') await cargarMisReservas();
    if (nombre === 'admin' && rolActual === 'admin') await cargarPanel();
}
function fechaLima() {
    const partes = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Lima', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date());
    const valor = tipo => partes.find(p => p.type === tipo).value;
    return `${valor('year')}-${valor('month')}-${valor('day')}`;
}
function inicioReserva(r) { return new Date(`${r.fecha_reserva}T${r.hora_reserva}-05:00`).getTime(); }
function finReserva(r) { return inicioReserva(r) + 7200000; }
function etiquetaEstado(r) {
    if (r.estado === 'asistio') return 'Asistió';
    if (r.estado === 'vencida') return 'Vencida';
    return Date.now() >= finReserva(r) ? 'Plazo vencido (por actualizar)' : 'Pendiente';
}
async function iniciarAplicacion() {
    await inicializarAutenticacion();
    inicializarReservas();
    inicializarAdmin();
    for (const enlace of document.querySelectorAll('[data-view-link]')) {
        enlace.addEventListener('click', e => { e.preventDefault(); navegar(enlace.dataset.viewLink); });
    }
    elemento('#nav-auth').addEventListener('click', e => { e.preventDefault(); destinoCliente = 'cuenta'; navegar(rolActual === 'cliente' ? 'cuenta' : 'login'); });
    elemento('#nav-admin').addEventListener('click', e => { e.preventDefault(); navegar(rolActual === 'admin' ? 'admin' : 'admin-login'); });
}
iniciarAplicacion().catch(error => console.error('Error al iniciar:', error));
