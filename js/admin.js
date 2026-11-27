// Panel de administración: capacidad y confirmación de asistencia.
let revisionAdmin = 0;
async function cargarConfiguracion() {
    if (rolActual !== 'admin') return;
    const id = usuarioActual.id;
    const {data,error} = await db.from('configuracion_restaurante').select('mesas_habilitadas,sillas_por_mesa').eq('id',1).single();
    if (usuarioActual?.id !== id || rolActual !== 'admin') return;
    if (error) { mostrarMensaje('#mesas-msg',error.message,true); return; }
    elemento('#mesas-habilitadas').value = data.mesas_habilitadas;
    elemento('#capacidad').textContent = `Capacidad habilitada: ${data.mesas_habilitadas * data.sillas_por_mesa} personas.`;
}
async function actualizarMesas(evento) {
    evento.preventDefault();
    if (rolActual !== 'admin') return;
    const id = usuarioActual.id;
    const boton = evento.target.querySelector('button'); boton.disabled = true;
    try {
        const {data,error} = await db.rpc('actualizar_mesas',{p_mesas:Number(elemento('#mesas-habilitadas').value)});
        if (usuarioActual?.id !== id || rolActual !== 'admin') return;
        if (error) throw error;
        mostrarMensaje('#mesas-msg',`Capacidad actualizada: ${data} mesas.`);
        await cargarConfiguracion();
    } catch(error) { if(usuarioActual?.id===id) mostrarMensaje('#mesas-msg',error.message,true); }
    finally { boton.disabled=false; }
}
async function confirmarAsistencia(reserva,boton) {
    if (rolActual !== 'admin') return;
    const id = usuarioActual.id;
    boton.disabled=true;
    try {
        const {error} = await db.rpc('confirmar_asistencia',{p_reserva_id:reserva.id});
        if (usuarioActual?.id !== id || rolActual !== 'admin') return;
        if (error) throw error;
        await cargarReservasAdmin();
        mostrarMensaje('#admin-msg',`Asistencia de la reserva #${reserva.id} confirmada.`);
    } catch(error) { if(usuarioActual?.id===id) mostrarMensaje('#admin-msg',error.message,true); }
    finally { boton.disabled=false; }
}
async function cargarReservasAdmin() {
    if (rolActual !== 'admin') return;
    const id = usuarioActual.id, revision = ++revisionAdmin;
    const contenedor = elemento('#admin-reservas'); contenedor.replaceChildren();
    mostrarMensaje('#admin-msg','Consultando reservas…');
    let consulta = db.from('reservas').select('id,usuario_id,fecha_reserva,hora_reserva,cantidad_personas,cantidad_mesas,estado,asistentes_reserva(dni)').order('fecha_reserva').order('hora_reserva');
    const fecha = elemento('#admin-fecha').value, estado = elemento('#admin-estado').value;
    if (fecha) consulta = consulta.eq('fecha_reserva',fecha);
    if (estado && estado !== 'activas') consulta = consulta.eq('estado',estado);
    const {data,error} = await consulta;
    if (usuarioActual?.id !== id || rolActual !== 'admin' || revision !== revisionAdmin) return;
    if (error) { mostrarMensaje('#admin-msg',error.message,true); return; }
    const reservas = estado === 'activas' ? data.filter(r=>r.estado !== 'vencida' && finReserva(r)>Date.now()) : data;
    // Los perfiles y las reservas se relacionan a través de auth.users; consultarlos por separado.
    const ids = [...new Set(reservas.map(r=>r.usuario_id))];
    let nombres = new Map();
    if (ids.length) {
        const perfiles = await db.from('profiles').select('id,nombre').in('id',ids);
        if (usuarioActual?.id !== id || rolActual !== 'admin' || revision !== revisionAdmin) return;
        nombres = new Map((perfiles.data || []).map(p=>[p.id,p.nombre]));
    }
    mostrarMensaje('#admin-msg',reservas.length ? `${reservas.length} reserva(s) encontradas.` : 'No hay reservas para estos filtros.');
    for (const reserva of reservas) {
        const tarjeta = crearTarjetaReserva(reserva,nombres.get(reserva.usuario_id)||'Cliente');
        if (reserva.estado === 'pendiente' && Date.now() < finReserva(reserva)) {
            const boton = document.createElement('button'); boton.className='btn-small ok'; boton.textContent='Confirmar asistencia';
            boton.disabled = Date.now() < inicioReserva(reserva);
            if (boton.disabled) boton.title='Disponible desde la hora reservada. Actualiza la lista al llegar el cliente.';
            boton.addEventListener('click',()=>confirmarAsistencia(reserva,boton)); tarjeta.append(boton);
        }
        contenedor.append(tarjeta);
    }
}
async function cargarPanel() { await Promise.all([cargarConfiguracion(),cargarReservasAdmin()]); }
function inicializarAdmin() {
    elemento('#admin-fecha').value=fechaLima();
    elemento('#mesas-form').addEventListener('submit',actualizarMesas);
    elemento('#admin-fecha').addEventListener('change',cargarReservasAdmin);
    elemento('#admin-estado').addEventListener('change',cargarReservasAdmin);
    elemento('#admin-refresh').addEventListener('click',cargarPanel);
}
