// Formulario y consultas de reservas. Supabase valida y registra de forma atómica.
let feriados = [];
let revisionDisponibilidad = 0;
function cantidadPersonas() { return Number(elemento('#personas').value); }
function generarDnis() {
    const cantidad = cantidadPersonas();
    const contenedor = elemento('#dnis');
    const anteriores = Array.from(contenedor.querySelectorAll('input'), input => input.value);
    contenedor.replaceChildren();
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 100) {
        elemento('#mesas-necesarias').textContent = 'Ingresa entre 1 y 100 personas.';
        return;
    }
    elemento('#mesas-necesarias').textContent = `Mesas necesarias: ${Math.ceil(cantidad/5)}`;
    for (let i = 0; i < cantidad; i++) {
        const etiqueta = document.createElement('label'); etiqueta.className = 'field';
        const titulo = document.createElement('span'); titulo.textContent = `DNI del asistente ${i+1}`;
        const input = document.createElement('input');
        input.type = 'text'; input.inputMode = 'numeric'; input.maxLength = 8; input.pattern = '[0-9]{8}'; input.required = true; input.autocomplete = 'off';
        input.value = anteriores[i] || '';
        etiqueta.append(titulo,input); contenedor.append(etiqueta);
    }
}
function invalidarDisponibilidad() { revisionDisponibilidad++; mostrarMensaje('#disponibilidad-msg',''); }
function actualizarHoras() {
    invalidarDisponibilidad();
    const fecha = elemento('#fecha-reserva').value;
    const selector = elemento('#hora-reserva');
    const anterior = selector.value;
    selector.replaceChildren();
    selector.add(new Option('Selecciona la hora',''));
    if (!fecha || fecha < fechaLima()) return;
    const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    const finSemana = dia === 0 || dia === 6 || feriados.includes(fecha);
    const apertura = finSemana ? 690 : 720;
    const cierre = finSemana ? 1050 : dia === 5 ? 1140 : 1020;
    for(let m=apertura; m<=cierre-120; m+=30) {
        const hora = `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
        if (new Date(`${fecha}T${hora}:00-05:00`).getTime() > Date.now()) selector.add(new Option(hora,hora));
    }
    if (Array.from(selector.options).some(o=>o.value===anterior)) selector.value=anterior;
}
async function prepararReserva() {
    const cliente = rolActual === 'cliente';
    elemento('#reserva-form').hidden = !cliente;
    elemento('#reserva-login').hidden = cliente || rolActual === 'admin';
    elemento('#reserva-acceso').hidden = cliente;
    elemento('#reserva-acceso').textContent = rolActual === 'admin' ? 'Las reservas se generan desde una cuenta de cliente.' : 'Inicia sesión como cliente para reservar.';
    if (!cliente) return;
    const id = usuarioActual.id;
    const {data,error} = await db.from('configuracion_restaurante').select('feriados').eq('id',1).single();
    if (usuarioActual?.id !== id || rolActual !== 'cliente') return;
    if (error) { mostrarMensaje('#reserva-msg',error.message,true); return; }
    feriados = data.feriados || [];
    const fecha = elemento('#fecha-reserva'); fecha.min = fechaLima();
    if (!fecha.value || fecha.value < fecha.min) fecha.value = fecha.min;
    actualizarHoras(); generarDnis();
}
async function consultarDisponibilidad() {
    const fecha = elemento('#fecha-reserva').value, hora = elemento('#hora-reserva').value;
    const personas = cantidadPersonas();
    const revision = ++revisionDisponibilidad;
    if (!fecha || !hora || !Number.isInteger(personas) || personas < 1 || personas > 100) {
        mostrarMensaje('#disponibilidad-msg','Selecciona fecha, hora y cantidad de personas válidas.',true); return;
    }
    mostrarMensaje('#disponibilidad-msg','Consultando…');
    const {data,error} = await db.rpc('calcular_disponibilidad',{p_fecha:fecha,p_hora:hora});
    if (revision !== revisionDisponibilidad || rolActual !== 'cliente') return;
    if (error) { mostrarMensaje('#disponibilidad-msg',error.message,true); return; }
    const suficientes = data >= Math.ceil(personas/5);
    mostrarMensaje('#disponibilidad-msg', suficientes ? `Hay ${data} mesas disponibles para ese intervalo.` : 'El límite de disponibilidad ha sido superado.', !suficientes);
}
async function crearReserva(evento) {
    evento.preventDefault();
    if (rolActual !== 'cliente') return;
    const id = usuarioActual.id;
    const boton = elemento('#reservar-submit'); boton.disabled = true;
    const dnis = Array.from(elemento('#dnis').querySelectorAll('input'), i=>i.value.trim());
    try {
        if (dnis.length !== cantidadPersonas() || dnis.some(d=>!/^\d{8}$/.test(d)) || new Set(dnis).size !== dnis.length) throw new Error('Ingresa un DNI válido y diferente por cada asistente.');
        mostrarMensaje('#reserva-msg','Registrando reserva…');
        const {data,error} = await db.rpc('crear_reserva', {p_fecha:elemento('#fecha-reserva').value,p_hora:elemento('#hora-reserva').value,p_personas:cantidadPersonas(),p_dnis:dnis});
        if (usuarioActual?.id !== id || rolActual !== 'cliente') return;
        if (error) throw error;
        evento.target.reset(); elemento('#dnis').replaceChildren();
        await prepararReserva();
        mostrarMensaje('#reserva-msg',`Reserva #${data} registrada correctamente. Consulta su estado en Mi cuenta.`);
    } catch(error) { if(usuarioActual?.id===id) mostrarMensaje('#reserva-msg',error.message,true); }
    finally { boton.disabled = false; }
}
function crearTarjetaReserva(r, nombre) {
    const tarjeta = document.createElement('article'); tarjeta.className='reserva-item';
    const titulo = document.createElement('strong'); titulo.textContent = `Reserva #${r.id} · ${r.fecha_reserva} · ${r.hora_reserva.slice(0,5)}`;
    const detalle = document.createElement('p'); detalle.textContent = `${nombre ? nombre+' · ' : ''}${r.cantidad_personas} personas · ${r.cantidad_mesas} mesa(s)`;
    const estado = document.createElement('span'); estado.className='reserva-estado'; estado.dataset.estado=r.estado; estado.textContent=etiquetaEstado(r);
    tarjeta.append(titulo,detalle,estado);
    const lista = document.createElement('details'); const resumen = document.createElement('summary'); resumen.textContent='Ver DNI de asistentes'; lista.append(resumen);
    const texto = document.createElement('p'); texto.className='dni-texto'; texto.textContent=(r.asistentes_reserva || []).map(a=>a.dni).join(', ') || 'Sin asistentes registrados.';
    lista.append(texto); tarjeta.append(lista); return tarjeta;
}
async function cargarMisReservas() {
    if (rolActual !== 'cliente') return;
    const id = usuarioActual.id;
    const contenedor = elemento('#mis-reservas'); contenedor.replaceChildren();
    const {data,error} = await db.from('reservas').select('id,fecha_reserva,hora_reserva,cantidad_personas,cantidad_mesas,estado,asistentes_reserva(dni)').eq('usuario_id',id).order('fecha_reserva',{ascending:false}).order('hora_reserva',{ascending:false});
    if (usuarioActual?.id !== id || rolActual !== 'cliente') return;
    if (error) { mostrarMensaje('#cuenta-msg',error.message,true); return; }
    mostrarMensaje('#cuenta-msg',data.length ? '' : 'Todavía no tienes reservas.');
    for (const reserva of data) contenedor.append(crearTarjetaReserva(reserva));
}
function inicializarReservas() {
    elemento('#reserva-login').addEventListener('click',()=>{destinoCliente='reservas';mostrarVista('login');});
    elemento('#fecha-reserva').addEventListener('change',actualizarHoras);
    elemento('#hora-reserva').addEventListener('change',invalidarDisponibilidad);
    elemento('#personas').addEventListener('input',()=>{generarDnis();invalidarDisponibilidad();});
    elemento('#consultar-disponibilidad').addEventListener('click',consultarDisponibilidad);
    elemento('#reserva-form').addEventListener('submit',crearReserva);
}
