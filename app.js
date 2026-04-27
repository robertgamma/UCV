/**
 * UCV Planner — Planificador Académico Offline
 * Versión : 10.0.0
 * Fecha   : 2026-04-27
 * Historial:
 *   v10.0.0 — Parser multi-modo (Regex UCV / Cloudmersive / Gemini)
 *             Programación Semanal, Evaluaciones ↔ Calendario
 *             Nota con redondeo entero, Calendario como pantalla principal
 *   v9.0.0  — PWA Offline completa, LocalStorage, Service Worker
 *   v8.x    — Versión servidor Flask/Python (reemplazada)
 */
const APP_VERSION = '10.0.0';
const appState = { user:null, currentCareer:null, pensumData:null, currentView:'list', optimalPlan:null, horarios:[], eventos:[], evaluaciones:[], semanas:[], currentDate:new Date(), selectedDateStr:null, kardexChartInstance:null, seccionSeleccionada:null };

document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(err => console.error("SW fallback", err));
    }

    const data = await API.me();
    if(data.logged_in) {
        appState.user = data.username; 
        document.getElementById('user-greeting').textContent = '¡Hola, ' + data.username + '!';
        document.getElementById('auth-screen').classList.add('hidden');
        if(data.username === 'robert') { 
            document.getElementById('tab-editor').classList.remove('hidden'); 
            document.getElementById('robert-tools').classList.remove('hidden'); 
        }
        if (data.carrera_id) {
            await selectCareer(data.carrera_id); 
            checkApiKey(data.api_key);
        } else { 
            document.getElementById('onboarding-screen').classList.remove('hidden'); 
            await renderOnboarding(); 
        }
    }
});

function checkApiKey(key) {
    if(!key) {
        const k = prompt("Para leer PDFs, necesitas tu API Key de Gemini. Ingresa tu clave ahora o presiona Cancelar y configúrala luego:");
        if(k) API.set_api_key(k);
    }
}

async function renderOnboarding() { 
    const carreras = PENSUMS_DATA;
    document.getElementById('ob-career-grid').innerHTML = Object.keys(carreras).map(k => `<div class="card p-6 text-center border-2 border-transparent hover:border-blue-500 transition cursor-pointer shadow-lg" onclick="saveCareerChoice('${k}')"><h3 class="font-extrabold text-gray-800 text-lg"><i class="fas fa-university"></i> ${carreras[k].NOMBRE}</h3></div>`).join(''); 
}
async function saveCareerChoice(key) { 
    await API.set_carrera(key);
    document.getElementById('onboarding-screen').classList.add('hidden'); 
    await selectCareer(key); 
}
async function selectCareer(key) { 
    appState.currentCareer = key; 
    appState.pensumData = await API.get_pensum(key);
    document.getElementById('career-badge').textContent = appState.pensumData.NOMBRE; 
    document.getElementById('main-app').classList.remove('hidden');
    actualizarVista(); 
    changeView(appState.currentView); 
    poblarSelectsMaterias();
    switchTab('calendario'); // Default landing tab
}
function poblarSelectsMaterias() { 
    const enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
    const sel1 = document.getElementById('horario-materia-select'); 
    if(sel1) {
        sel1.innerHTML = enCurso.map(m => `<option value="${m.nombre}">${m.nombre} (${m.codigo})</option>`).join('') + '<option value="MANUAL">-- Otra (Escribir Manual) --</option>';
        sel1.onchange = (e) => { document.getElementById('horario-materia-manual').classList.toggle('hidden', e.target.value !== 'MANUAL'); };
    }
    const sel2 = document.getElementById('buscar-materia-select'); 
    if(sel2) sel2.innerHTML = '<option value="">-- Seleccionar materia --</option>' + enCurso.map(m => `<option value="${m.codigo}">${m.nombre} - ${m.codigo}</option>`).join('');
    const sel3 = document.getElementById('evento-materia-select'); 
    if(sel3) sel3.innerHTML = enCurso.map(m => `<option value="Examen: ${m.nombre}">Examen: ${m.nombre}</option><option value="Entrega: ${m.nombre}">Entrega: ${m.nombre}</option>`).join('') + '<option value="MANUAL">-- Otra Actividad --</option>'; 
}

async function auth(action) { 
    const u = document.getElementById('auth-user').value, p = document.getElementById('auth-pass').value, err = document.getElementById('auth-error');
    if(!u || !p) { err.textContent = "Llene todos los campos."; err.classList.remove('hidden'); return; }
    try { 
        const data = action === 'login' ? await API.login(u, p) : await API.register(u, p);
        if(data.error) { err.textContent = data.error; err.classList.remove('hidden'); } 
        else { window.location.reload(); } 
    } catch (e) { err.textContent = "Error interno."; err.classList.remove('hidden'); } 
}

async function logout() { await API.logout(); window.location.reload(); }

function switchTab(tab) { 
    ['progreso','kardex','horario','evaluaciones','calendario','pd','editor'].forEach(t => { 
        document.getElementById(`${t}-section`).classList.add('hidden'); 
        const el = document.getElementById(`tab-${t}`); 
        if(el) el.className = 'px-4 py-2 font-bold text-gray-500 hover:text-blue-600 whitespace-nowrap'; 
    });
    document.getElementById(`${tab}-section`).classList.remove('hidden'); 
    let tabEl = document.getElementById(`tab-${tab}`); 
    if(tabEl) tabEl.className = 'px-4 py-2 font-bold text-blue-600 border-b-2 border-blue-600 whitespace-nowrap';
    if(tab==='kardex') setTimeout(renderKardex, 50); 
    if(tab==='horario') { loadHorarios().then(() => renderHorarioLista()); } 
    if(tab==='calendario') { loadEventos().then(() => { renderCalendario(); loadSemanas(); }); }
    if(tab==='evaluaciones') { loadEvaluaciones().then(() => renderEvaluaciones()); }
    if(tab==='progreso' && appState.currentView==='visual') setTimeout(dibujarPrelaciones, 50); 
    if(tab==='pd') document.getElementById('pd-codigo').focus(); 
}

async function parsePDF(type, mode) {
    mode = mode || document.getElementById(`parse-mode-${type}`)?.value || 'regex';
    const fileInputId = (type === 'semanas') ? 'semanas-file' : `${type}-file`;
    const fileInput  = document.getElementById(fileInputId);
    const statusEl   = document.getElementById(`${type}-parse-status`);
    const btns       = document.querySelectorAll(`.btn-parse-${type}`);

    const showStatus = (msg, cls) => {
        if (statusEl) { statusEl.textContent = msg; statusEl.className = `text-xs font-bold mt-2 ${cls}`; }
    };

    if (!fileInput?.files[0]) { showStatus('⚠️ Sube un archivo PDF primero.', 'text-red-600'); return; }
    const db = loadDB();
    if (!db.currentUser) { showStatus('❌ Sin sesión.', 'text-red-600'); return; }
    const u = db.users[db.currentUser];

    // Gather API keys
    const keys = { gemini: u.geminiApiKey, cloudmersive: u.cloudmersiveKey };

    // If mode needs a key and it's missing, prompt
    if (mode === 'gemini' && !keys.gemini) {
        const k = prompt('Ingresa tu API Key de Gemini (google.ai/studio):');
        if (k) { keys.gemini = k; await API.set_api_key(k); } else return;
    }
    if (mode === 'cloudmersive' && !keys.cloudmersive) {
        const k = prompt('Ingresa tu API Key de Cloudmersive (cloudmersive.com — gratis):');
        if (k) { keys.cloudmersive = k; u.cloudmersiveKey = k; const d = loadDB(); d.users[d.currentUser].cloudmersiveKey = k; saveDB(d); } else return;
    }

    btns.forEach(b => b.disabled = true);

    try {
        const parsedData = await parsePDFMultiMode(fileInput.files[0], type, mode, keys, showStatus);

        if (type === 'kardex') {
            let count = 0;
            for (let item of parsedData) {
                const mat = appState.pensumData.pensum.find(m => m.codigo === item.codigo);
                if (mat) { await API.save_progreso(appState.currentCareer, mat.id, item.estado, item.nota, item.periodo); count++; }
            }
            appState.pensumData = await API.get_pensum(appState.currentCareer);
            renderKardex(); actualizarVista();
            showStatus(`✅ ${count} materias importadas`, 'text-green-600');

        } else if (type === 'horario') {
            await API.save_oferta_bulk(appState.currentCareer, parsedData);
            showStatus(`✅ ${parsedData.length} secciones guardadas`, 'text-green-600');

        } else if (type === 'calendario') {
            const items = Array.isArray(parsedData) ? parsedData : (parsedData.eventos || []);
            for (let ev of items) {
                if (ev.fecha && ev.titulo) await API.save_evento({ fecha: ev.fecha, titulo: ev.titulo, color: ev.color || '#f59e0b' });
            }
            await loadEventos(); renderCalendario();
            showStatus(`✅ ${items.length} eventos importados`, 'text-green-600');

        } else if (type === 'semanas') {
            const items = Array.isArray(parsedData) ? parsedData : [];
            await API.save_semanas_bulk(appState.currentCareer, items);
            await loadEventos(); renderCalendario(); await loadSemanas();
            showStatus(`✅ ${items.length} semanas importadas`, 'text-green-600');
        }

    } catch(e) {
        showStatus('❌ ' + e.message, 'text-red-600');
        console.error('parsePDF error:', e);
    }
    btns.forEach(b => b.disabled = false);
}



function checkDisponibilidad(materia, creditosAprobados, materiasAprobadasCodigos) { 
    if (materia.estado === 'Aprobada' || materia.estado === 'En Curso') return materia.estado; 
    const disponible = materia.prelaciones.every(prelacion => { 
        if (typeof prelacion === 'string') return materiasAprobadasCodigos.has(prelacion); 
        if (typeof prelacion === 'object' && prelacion.tipo === 'creditos') return creditosAprobados >= prelacion.valor; 
        return true; 
    }); 
    return disponible ? 'disponible' : 'bloqueada'; 
}

function openMateriaModal(id) { 
    const m = appState.pensumData.pensum.find(x => x.id === id); if(!m) return;
    document.getElementById('modal-mat-id').value = m.id; 
    document.getElementById('modal-mat-nombre').textContent = m.nombre; 
    document.getElementById('modal-mat-codigo').textContent = `${m.codigo} • ${m.creditos} UC`;
    document.getElementById('modal-mat-estado').value = m.estado; 
    document.getElementById('modal-mat-nota').value = m.nota !== null ? m.nota : ''; 
    document.getElementById('modal-mat-periodo').value = m.periodo || '';
    toggleNotaInput(); 
    document.getElementById('materia-modal').classList.remove('hidden'); 
}

function toggleNotaInput() { 
    const e = document.getElementById('modal-mat-estado').value, n = document.getElementById('modal-mat-nota'); 
    n.disabled = (e === 'En Curso' || e === 'Retirada' || e === 'Sin Cursar'); 
    if(n.disabled) n.value = ''; 
}

async function guardarMateria() { 
    const id = parseInt(document.getElementById('modal-mat-id').value), 
          est = document.getElementById('modal-mat-estado').value, 
          nota = document.getElementById('modal-mat-nota').value, 
          per = document.getElementById('modal-mat-periodo').value;
    
    if((est==='Aprobada' || est==='Reprobada') && nota==='') { alert("Ingrese la nota definitiva."); return; }
    const notaFinal = nota !== '' ? Math.round(parseFloat(nota)) : null;
    await API.save_progreso(appState.currentCareer, id, est, notaFinal, per);
    
    document.getElementById('materia-modal').classList.add('hidden'); 
    appState.pensumData = await API.get_pensum(appState.currentCareer);
    actualizarVista(); 
    if(appState.currentView === 'list') renderizarSemestres(); else if(appState.currentView === 'visual') renderizarPensumVisual(); 
    poblarSelectsMaterias(); 
}

function renderKardex() { 
    let uc_cur_total = 0, uc_apr_total = 0, uc_rep_total = 0, uc_ret_total = 0, sum_pxu_total = 0; let pPer = {};
    appState.pensumData.kardex_history.forEach(k => { 
        const mBase = appState.pensumData.pensum.find(p=>p.id===k.materia_id); 
        if(!mBase || k.estado === 'En Curso' || k.estado === 'Sin Cursar') return;
        const m = {...k, nombre: mBase.nombre, creditos: mBase.creditos, codigo: mBase.codigo};
        const per = m.periodo || 'Sin Período'; if(!pPer[per]) pPer[per] = { mats: [], uc_cur: 0, uc_apr: 0, pts: 0 }; pPer[per].mats.push(m);
        if(m.estado === 'Retirada') { uc_ret_total += m.creditos; } else { uc_cur_total += m.creditos; pPer[per].uc_cur += m.creditos; const v = (m.nota||0)*m.creditos; sum_pxu_total += v; pPer[per].pts += v;
        if(m.estado === 'Aprobada') { uc_apr_total += m.creditos; pPer[per].uc_apr += m.creditos; } if(m.estado === 'Reprobada') { uc_rep_total += m.creditos; } } 
    });
    const sVal = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    sVal('kx-promedio-gral', uc_cur_total > 0 ? (sum_pxu_total / uc_cur_total).toFixed(4) : "0.0000"); 
    sVal('kx-eficiencia', uc_cur_total > 0 ? ((uc_apr_total / uc_cur_total)*100).toFixed(2) + "%" : "0.00%");
    sVal('kx-uc-cursadas', uc_cur_total); 
    const periods = Object.keys(pPer).sort(), labels = [], dPromPer = [], dPromGral = [], dUcCur = [], dUcApr = [], dEfic = []; 
    let acum_uc = 0, acum_apr = 0, acum_pts = 0, html = '';
    periods.forEach(p => { 
        labels.push(p); const dp = pPer[p]; acum_uc += dp.uc_cur; acum_apr += dp.uc_apr; acum_pts += dp.pts;
        const promP = dp.uc_cur > 0 ? parseFloat((dp.pts / dp.uc_cur).toFixed(2)) : 0; 
        const promG = acum_uc > 0 ? parseFloat((acum_pts / acum_uc).toFixed(2)) : 0; 
        const efic = acum_uc > 0 ? parseFloat(((acum_apr / acum_uc) * 100).toFixed(1)) : 0;
        dPromPer.push(promP); dPromGral.push(promG); dUcCur.push(dp.uc_cur); dUcApr.push(dp.uc_apr); dEfic.push(efic);
        html += `<div class="border border-gray-200 rounded-lg overflow-hidden"><div class="bg-gray-100 px-4 py-2 flex justify-between font-bold text-sm text-gray-700"><span>Período: ${p}</span><span>Prom. Semestre: ${promP}</span></div><div class="divide-y divide-gray-100">`;
        dp.mats.forEach(m => { html += `<div class="px-4 py-2 text-sm flex justify-between"><span>${m.nombre} (${m.creditos} UC)</span><span class="font-bold ${m.estado==='Aprobada'?'text-green-600':m.estado==='Reprobada'?'text-red-600':'text-yellow-600'}">${m.nota!==null?m.nota:m.estado}</span></div>`; }); 
        html += `</div></div>`; 
    });
    document.getElementById('kardex-table').innerHTML = html;
    if(appState.kardexChartInstance) appState.kardexChartInstance.destroy();
    appState.kardexChartInstance = new Chart(document.getElementById('kardexChart').getContext('2d'), { type: 'bar', data: { labels: labels, datasets: [
        { type: 'line', label: 'Prom. Acumulado', data: dPromGral, borderColor: '#2563eb', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.3, pointRadius: 5, pointBackgroundColor: '#2563eb', borderWidth: 3, yAxisID: 'y' },
        { type: 'line', label: 'Prom. del Período', data: dPromPer, borderColor: '#8b5cf6', backgroundColor: 'transparent', borderDash: [5, 5], tension: 0.3, pointRadius: 5, pointBackgroundColor: '#8b5cf6', borderWidth: 2, yAxisID: 'y' },
        { type: 'line', label: 'Eficiencia (%)', data: dEfic, borderColor: '#10b981', backgroundColor: 'transparent', tension: 0.3, pointRadius: 5, pointBackgroundColor: '#10b981', borderWidth: 2, yAxisID: 'yEficiencia' },
        { type: 'bar', label: 'UC Cursadas', data: dUcCur, backgroundColor: 'rgba(203, 213, 225, 0.6)', borderRadius: 4, yAxisID: 'yCreditos' },
        { type: 'bar', label: 'UC Aprobadas', data: dUcApr, backgroundColor: 'rgba(16, 185, 129, 0.6)', borderRadius: 4, yAxisID: 'yCreditos' } ]},
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false } }, y: { type: 'linear', display: true, position: 'left', min: 0, max: 20, title: { display: true, text: 'Notas (0-20)', font: {weight: 'bold'} } }, yEficiencia: { type: 'linear', display: false, position: 'right', min: 0, max: 100 }, yCreditos: { type: 'linear', display: false, position: 'right', min: 0, max: 35 } }, plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } } }); 
}

function changeView(v) { 
    appState.currentView = v; 
    ['semestres','pensum-visual-container','optimal-planner-container'].forEach(id => document.getElementById(id).classList.add('hidden'));
    ['list','visual','optimal'].forEach(id => document.getElementById('btn-'+id).className = 'px-4 py-2 bg-gray-200 text-gray-800 font-bold rounded-lg');
    document.getElementById(v==='list'?'semestres':(v==='visual'?'pensum-visual-container':'optimal-planner-container')).classList.remove('hidden'); 
    document.getElementById('btn-'+v).className = 'px-4 py-2 bg-blue-600 text-white font-bold rounded-lg shadow';
    if(v==='list') renderizarSemestres(); 
    if(v==='visual') renderizarPensumVisual(); 
    if(v==='optimal') alert("Ruta Óptima requiere conexión a Python y no está disponible en versión Offline.");
}

function renderizarSemestres() { 
    const container = document.getElementById('semestres'); container.innerHTML = '';
    const p = appState.pensumData.pensum, credAp = p.filter(m=>m.estado==='Aprobada').reduce((a,m)=>a+m.creditos,0), curSet = new Set(p.filter(m=>m.estado==='Aprobada').map(m=>m.codigo));
    [...new Set(p.map(m=>m.semestre))].sort((a,b)=>a-b).forEach(s => { 
        const html = p.filter(m=>m.semestre===s).map(m => { 
            const status = checkDisponibilidad(m, credAp, curSet);
            return `<div class="flex justify-between items-center p-3 border-b transition ${m.estado==='Aprobada'?'bg-green-50':(m.estado==='En Curso'?'bg-purple-50':'hover:bg-gray-50')} ${status==='bloqueada'?'opacity-50':'cursor-pointer'}" onclick="openMateriaModal(${m.id})">
            <div><p class="font-bold text-gray-800 text-sm">${m.nombre}</p><p class="text-xs text-gray-500">${m.codigo} • ${m.creditos} UC • <b class="capitalize">${m.estado==='Sin Cursar'?status:m.estado}</b></p></div>
            <div>${m.estado==='Aprobada'?'✅':(m.estado==='En Curso'?'🔄':'✏️')}</div></div>`; 
        }).join(''); 
        container.innerHTML += `<div class="card p-0 shadow-sm"><div class="bg-gray-100 p-3 border-b"><h3 class="font-black">Semestre ${s}</h3></div>${html}</div>`; 
    }); 
}

function renderizarPensumVisual() { 
    const cont = document.getElementById('pensum-visual'); cont.innerHTML = '';
    const p = appState.pensumData.pensum, credAp = p.filter(m=>m.estado==='Aprobada').reduce((a,m)=>a+m.creditos,0), curSet = new Set(p.filter(m=>m.estado==='Aprobada').map(m=>m.codigo));
    [...new Set(p.map(m=>m.semestre))].sort((a,b)=>a-b).forEach(s => { 
        const sBlq = document.createElement('div'); sBlq.className = 'w-full mb-8 flex flex-col items-center relative z-10'; sBlq.innerHTML = `<h3 class="bg-blue-50 border text-blue-900 font-bold px-4 py-1 rounded-full mb-4 shadow-sm">Semestre ${s}</h3>`;
        const mGr = document.createElement('div'); mGr.className = 'flex flex-wrap justify-center gap-4';
        p.filter(m=>m.semestre===s).forEach(m => { 
            const status = checkDisponibilidad(m, credAp, curSet); let cl = m.estado === 'En Curso' ? 'En\\.Curso' : m.estado;
            mGr.innerHTML += `<div id="nodo-${m.codigo}" class="materia-nodo ${m.estado==='Sin Cursar'?status:cl} bg-white z-10 border-2 border-transparent hover:border-blue-400" onclick="openMateriaModal(${m.id})"><p class="font-bold text-xs leading-tight">${m.nombre}</p><p class="text-[10px] mt-1 opacity-80">${m.codigo} • ${m.creditos} UC</p></div>`; 
        });
        sBlq.appendChild(mGr); cont.appendChild(sBlq); 
    }); 
    setTimeout(dibujarPrelaciones, 200); 
}

function dibujarPrelaciones() { 
    const svg = document.getElementById('prelaciones-svg'), cont = document.getElementById('pensum-visual-container');
    if(!cont || !svg || appState.currentView!=='visual' || document.getElementById('progreso-section').classList.contains('hidden')) return;
    svg.innerHTML = ''; const rC = cont.getBoundingClientRect(), p = appState.pensumData.pensum, credAp = p.filter(m=>m.estado==='Aprobada').reduce((a,m)=>a+m.creditos,0), curSet = new Set(p.filter(m=>m.estado==='Aprobada').map(m=>m.codigo));
    p.forEach(dst => { 
        const nD = document.getElementById(`nodo-${dst.codigo}`); if(!nD) return; 
        dst.prelaciones.forEach(pr => { 
            if(typeof pr!=='string') return; const nO = document.getElementById(`nodo-${pr}`); if(!nO) return;
            const org = p.find(m=>m.codigo===pr); if(org.estado === 'Aprobada') return; const rO = nO.getBoundingClientRect(), rD = nD.getBoundingClientRect(); if(rD.top <= rO.bottom) return;
            const dispO = checkDisponibilidad(org, credAp, curSet) !== 'bloqueada', dispD = checkDisponibilidad(dst, credAp, curSet) !== 'bloqueada';
            svg.innerHTML += `<line x1="${rO.left+rO.width/2-rC.left}" y1="${rO.bottom-rC.top}" x2="${rD.left+rD.width/2-rC.left}" y2="${rD.top-rC.top}" class="linea-prelacion ${(dispO && !dispD)?'critica':'activa'}"></line>`; 
        }); 
    });
    svg.setAttribute('width', rC.width); svg.setAttribute('height', cont.offsetHeight); 
}

function actualizarVista() { 
    const p = appState.pensumData.pensum, cAp = p.filter(m=>m.estado==='Aprobada').reduce((a,m)=>a+m.creditos,0);
    document.getElementById('creditos-aprobados').textContent = cAp; 
    document.getElementById('creditos-basico').textContent = Math.max(0, 50 - p.filter(m=>m.estado==='Aprobada').length); // Simplified since base doesn't have type
    const prog = (cAp / appState.pensumData.TOTAL_CREDITOS_CARRERA)*100; 
    document.getElementById('progressBar').style.width = `${prog}%`; document.getElementById('progressBar').textContent = `${prog.toFixed(1)}%`;
    const curSet = new Set(p.filter(m=>m.estado==='Aprobada').map(m=>m.codigo)), disp = p.filter(m => m.estado==='Sin Cursar' && checkDisponibilidad(m, cAp, curSet)==='disponible');
    disp.forEach(d => { d.peso = p.filter(f=>!f.cursada && f.prelaciones.includes(d.codigo)).length; }); disp.sort((a,b)=>b.peso - a.peso);
    document.getElementById('materias-disponibles-lista').innerHTML = disp.map(m=>`<div class="p-3 border rounded-lg flex justify-between items-center cursor-pointer hover:bg-blue-50" onclick="openMateriaModal(${m.id})"><div><p class="font-bold text-sm">${m.nombre}</p><span class="text-xs text-gray-500">${m.creditos} UC</span></div>${m.peso>0?`<span class="bg-blue-100 text-blue-800 text-[10px] font-black px-2 py-1 rounded shadow-sm">Abre ${m.peso}</span>`:''}</div>`).join('') || '<p class="text-sm text-gray-500 text-center">No hay materias disponibles aún</p>'; 
}

function timeToFloat(t) { let [h, m] = t.split(':'); return parseInt(h) + parseInt(m)/60; }
function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

async function loadHorarios() { 
    appState.horarios = await API.get_horarios(appState.currentCareer);
    const gridContainer = document.getElementById('scheduleGridContainer'); 
    let html = '<table class="schedule-grid-table"><thead><tr><th class="time-header" style="width:60px">Hora</th>';
    const realDayName = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']; const todayStr = realDayName[new Date().getDay()];
    const days = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado']; 
    days.forEach(d => { html += `<th class="${d === todayStr ? 'bg-blue-600 border-b-4 border-yellow-400' : 'bg-blue-900'} text-white p-2 text-xs uppercase">${d}</th>`; }); 
    html += '</tr></thead><tbody>';
    
    let minH = 420, maxH = 1140; 
    if(appState.horarios.length > 0) {
        minH = Math.min(...appState.horarios.map(h => timeToMinutes(h.hora_inicio)));
        maxH = Math.max(...appState.horarios.map(h => timeToMinutes(h.hora_fin)));
        minH = Math.max(420, Math.floor(minH/60)*60);
        maxH = Math.min(1320, Math.ceil(maxH/60)*60);
    }
    let timeSlots = []; for (let t = minH; t <= maxH; t += 30) { timeSlots.push(t); }
    timeSlots.forEach((mins, i) => { 
        const h = Math.floor(mins/60), m = mins % 60; 
        const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; 
        const display = (mins%60 === 0) ? timeStr : '';
        html += `<tr data-row="${i}"><td class="time-header">${display}</td>`; 
        days.forEach(d => { html += `<td class="${d === todayStr ? 'bg-blue-50' : ''}" data-day="${d}" data-time="${timeStr}"></td>`; }); 
        html += '</tr>'; 
    });
    html += '</tbody></table>'; gridContainer.innerHTML = html;
    
    const tbody = gridContainer.querySelector('tbody'); 
    appState.horarios.forEach(h => {
        const diaFormat = h.dia.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const startMins = timeToMinutes(h.hora_inicio), endMins = timeToMinutes(h.hora_fin); 
        const slotIndex = timeSlots.findIndex(t => t <= startMins && t+30 > startMins); if(slotIndex === -1) return;
        const startRow = tbody.querySelector(`tr[data-row="${slotIndex}"]`); if(!startRow) return; 
        const startCell = startRow.querySelector(`td[data-day="${diaFormat}"]`); 
        if(startCell) {
            startCell.style.position = 'relative'; 
            const block = document.createElement('div'); block.className = 'course-block cursor-pointer flex flex-col justify-between hover:brightness-110 transition';
            block.style.backgroundColor = h.color; block.style.top = `${(startMins - timeSlots[slotIndex])}px`; block.style.height = `${(endMins - startMins)}px`;
            const overlap = Array.from(startCell.querySelectorAll('.course-block')).filter(b => parseInt(b.style.top) < parseInt(block.style.top) + parseInt(block.style.height) && parseInt(b.style.top) + parseInt(b.style.height) > parseInt(block.style.top));
            if(overlap.length > 0) { 
                block.style.clipPath = 'polygon(0 0, 100% 0, 100% 100%)'; 
                overlap.forEach(b => { b.style.clipPath = 'polygon(0 0, 100% 100%, 0 100%)'; }); 
            } else { 
                block.style.width = '95%'; block.style.left = '2.5%'; 
            }
            block.innerHTML = `<span class="truncate font-bold">${h.materia_nombre}${h.seccion?` <span class="text-[9px]">Sec.${h.seccion}</span>`:''}</span><button onclick="borrarHorario(${h.id}); event.stopPropagation();" class="text-white hover:text-red-200 text-right text-[9px]">&times;</button>`;
            block.onclick = () => alert(`📋 ${h.materia_nombre}\n🔢 Sec: ${h.seccion||'N/A'}\n🏫 Aula: ${h.aula||'N/A'}\n👨‍🏫 Prof: ${h.profesor||'N/A'}`); 
            startCell.appendChild(block); 
        }
    });
    const sel = document.getElementById('horario-materia-select'), enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
    if(sel) { 
        sel.innerHTML = enCurso.map(m => `<option value="${m.nombre}">${m.nombre} (${m.codigo})</option>`).join('') + '<option value="MANUAL">-- Otra (Escribir Manual) --</option>';
        sel.onchange = (e) => { document.getElementById('horario-materia-manual').classList.toggle('hidden', e.target.value !== 'MANUAL'); }; 
        sel.onchange({target:sel}); 
    } 
}

function renderHorarioLista() { 
    const lista = document.getElementById('horario-lista'); if(!lista) return;
    lista.innerHTML = appState.horarios.map(h => `<div class="flex justify-between items-center p-2 bg-gray-50 rounded border-l-4" style="border-color:${h.color}"><div class="text-sm"><span class="font-bold">${h.materia_nombre}</span><span class="text-xs text-gray-500 ml-2">${h.dia} ${h.hora_inicio}-${h.hora_fin}</span>${h.seccion ? `<span class="text-[10px] bg-blue-100 px-1 rounded ml-1">Sec.${h.seccion}</span>` : ''}</div><button onclick="borrarHorario(${h.id})" class="text-red-500 hover:text-red-700 text-xs"><i class="fas fa-trash"></i></button></div>`).join('') || '<p class="text-sm text-gray-500 text-center">No hay clases añadidas</p>'; 
}

async function guardarHorario() { 
    let m = document.getElementById('horario-materia-select').value; if(m === 'MANUAL') m = document.getElementById('horario-materia-manual').value;
    const diasChecked = Array.from(document.querySelectorAll('.dia-cb:checked')).map(cb=>cb.value), 
          inicio = document.getElementById('horario-inicio').value, fin = document.getElementById('horario-fin').value, 
          color = document.getElementById('horario-color').value, seccion = document.getElementById('horario-seccion').value, 
          aula = document.getElementById('horario-aula').value, profesor = document.getElementById('horario-profesor').value;
    
    if(!m || !inicio || !fin || diasChecked.length === 0) { alert("Completa materia, días y horas"); return; }
    
    for(let dia of diasChecked) {
        const diaNorm = dia.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const choque = appState.horarios.some(h => {
            const hDiaNorm = h.dia.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return hDiaNorm === diaNorm && hayChoqueSimple(inicio, fin, h.hora_inicio, h.hora_fin);
        });
        if(choque) { 
            const alertEl = document.getElementById('conflict-alert'); 
            alertEl.textContent = `⚠️ Choque detectado el ${dia}`; alertEl.classList.remove('hidden'); 
            setTimeout(() => alertEl.classList.add('hidden'), 3000); 
        }
        await API.save_horario({
            carrera_id: appState.currentCareer, materia_nombre: m, dia: dia, 
            hora_inicio: inicio, hora_fin: fin, color: color, seccion: seccion, aula: aula, profesor: profesor
        });
    }
    document.getElementById('horario-materia-manual').value=''; 
    document.getElementById('horario-seccion').value=''; 
    document.getElementById('horario-aula').value=''; 
    document.getElementById('horario-profesor').value='';
    loadHorarios(); renderHorarioLista(); 
}

function hayChoqueSimple(inicio1, fin1, inicio2, fin2) { 
    const [h1i, m1i] = inicio1.split(':').map(Number); const [h1f, m1f] = fin1.split(':').map(Number); 
    const [h2i, m2i] = inicio2.split(':').map(Number); const [h2f, m2f] = fin2.split(':').map(Number);
    const start1 = h1i*60+m1i, end1 = h1f*60+m1f; const start2 = h2i*60+m2i, end2 = h2f*60+m2f; 
    return !(end1 <= start2 || end2 <= start1); 
}

async function borrarHorario(id) { 
    if(!confirm('¿Eliminar esta clase de tu horario?')) return; 
    await API.delete_horario(id);
    loadHorarios(); renderHorarioLista(); 
}

async function cargarSeccionesDisponibles() { 
    const codigo = document.getElementById('buscar-materia-select').value; 
    if(!codigo) { alert("Selecciona una materia"); return; }
    const container = document.getElementById('secciones-resultados'); 
    container.innerHTML = '<p class="text-sm text-gray-500 text-center"><i class="fas fa-spinner fa-spin"></i> Buscando...</p>';
    try { 
        const seccionesRaw = await API.get_oferta(appState.currentCareer, codigo);
        const secciones = seccionesRaw.map(s => {
            let choque = false;
            s.dias.forEach(d => {
                const diaNorm = d.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (appState.horarios.some(h => h.dia.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === diaNorm && hayChoqueSimple(h.hora_inicio, h.hora_fin, s.hora_inicio, s.hora_fin))) choque = true;
            });
            return {...s, disponible: !choque};
        });
        if(secciones.length === 0) { container.innerHTML = '<p class="text-sm text-gray-500 text-center">No hay secciones registradas para esta materia</p>'; return; }
        container.innerHTML = secciones.map(sec => `<div class="seccion-card p-3 border rounded ${sec.disponible?'disponible':'choque'} cursor-pointer" onclick="abrirModalSeccion('${codigo}', '${sec.seccion}', '${sec.dias.join(',')}', '${sec.hora_inicio}', '${sec.hora_fin}', '${sec.aula}', '${sec.profesor}')"><div class="flex justify-between items-start"><div><p class="font-bold text-sm">${sec.dias.join(', ')}</p><p class="text-xs text-gray-600">${sec.hora_inicio} - ${sec.hora_fin}</p></div><span class="text-xs font-bold ${sec.disponible?'text-green-600':'text-red-600'}">${sec.disponible?'✅ Disponible':'❌ Choque'}</span></div><p class="text-[10px] text-gray-500 mt-1">Sec.${sec.seccion} • ${sec.aula} • ${sec.profesor}</p></div>`).join(''); 
    } catch(e) { container.innerHTML = `<p class="text-sm text-red-600">Error: ${e.message}</p>`; } 
}

function abrirModalSeccion(codigo, seccion, diasStr, h_ini, h_fin, aula, profesor) { 
    const materia = appState.pensumData.pensum.find(m => m.codigo === codigo); if(!materia) return;
    appState.seccionSeleccionada = {codigo, seccion, materia: materia.nombre, dias: diasStr.split(','), h_ini, h_fin, aula, profesor};
    document.getElementById('seccion-modal-nombre').textContent = materia.nombre; document.getElementById('seccion-modal-info').textContent = `Código: ${codigo} • ${materia.creditos} UC`;
    document.getElementById('seccion-modal-seccion').textContent = seccion; document.getElementById('seccion-modal-dias').textContent = diasStr; document.getElementById('seccion-modal-horario').textContent = `${h_ini}-${h_fin}`;
    document.getElementById('seccion-modal-aula').textContent = aula; document.getElementById('seccion-modal-profesor').textContent = profesor; document.getElementById('seccion-modal-cupos').textContent = '';
    document.getElementById('seccion-modal').classList.remove('hidden'); 
}

async function confirmarSeccion() { 
    if(!appState.seccionSeleccionada) return; const sec = appState.seccionSeleccionada;
    for(let dia of sec.dias) { 
        await API.save_horario({
            carrera_id: appState.currentCareer, materia_nombre: sec.materia, dia: dia.trim(), 
            hora_inicio: sec.h_ini, hora_fin: sec.h_fin, color: '#3b82f6', seccion: sec.seccion, aula: sec.aula, profesor: sec.profesor
        });
    }
    document.getElementById('seccion-modal').classList.add('hidden'); 
    await loadHorarios(); renderHorarioLista(); alert(`✅ Sección añadida`); 
}

async function buscarSeccionesPD() { 
    const codigo = document.getElementById('pd-codigo').value.padStart(4, '0'); const dia = document.getElementById('pd-dia').value;
    if(!codigo) { alert("Ingresa un código de materia"); return; }
    const container = document.getElementById('pd-resultados'); container.innerHTML = '<p class="text-center text-gray-500 py-4"><i class="fas fa-spinner fa-spin"></i> Buscando...</p>';
    try { 
        const seccionesRaw = await API.get_oferta(appState.currentCareer, codigo);
        const secciones = seccionesRaw.filter(s => !dia || s.dias.includes(dia)).map(s => {
            let choque = false;
            s.dias.forEach(d => {
                const diaNorm = d.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                if (appState.horarios.some(h => h.dia.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === diaNorm && hayChoqueSimple(h.hora_inicio, h.hora_fin, s.hora_inicio, s.hora_fin))) choque = true;
            });
            return {...s, disponible: !choque};
        });
        if(secciones.length === 0) { container.innerHTML = '<p class="text-center text-gray-500 py-4">No se encontraron secciones para ' + codigo + '</p>'; return; }
        container.innerHTML = secciones.map(sec => `<div class="card p-4 border-l-4 ${sec.disponible?'border-green-500':'border-red-500'}"><div class="flex justify-between items-start"><div><h4 class="font-bold text-gray-800">${codigo} - Sección ${sec.seccion}</h4><p class="text-sm text-gray-600">${sec.dias.join(', ')} • ${sec.hora_inicio}-${sec.hora_fin}</p><p class="text-xs text-gray-500 mt-1">🏫 ${sec.aula} • 👨‍🏫 ${sec.profesor}</p></div><span class="px-2 py-1 rounded text-xs font-bold ${sec.disponible?'bg-green-100 text-green-800':'bg-red-100 text-red-800'}">${sec.disponible?'✅ Sin Choques':'❌ Con Choque'}</span></div>${sec.disponible ? `<button onclick="abrirModalSeccion('${codigo}', '${sec.seccion}', '${sec.dias.join(',')}', '${sec.hora_inicio}', '${sec.hora_fin}', '${sec.aula}', '${sec.profesor}')" class="mt-3 w-full bg-blue-600 text-white text-sm font-bold py-2 rounded hover:bg-blue-700"><i class="fas fa-plus"></i> Añadir a Mi Horario</button>` : ''}</div>`).join(''); 
    } catch(e) { container.innerHTML = `<p class="text-center text-red-600 py-4">Error: ${e.message}</p>`; } 
}

function generarICS(horarios, eventos) {
    let ics = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//UCV App Offline//ES\n";
    horarios.forEach(h => {
        const dtstart = "20240401T" + h.hora_inicio.replace(':', '') + "00Z";
        const dtend = "20240401T" + h.hora_fin.replace(':', '') + "00Z";
        ics += "BEGIN:VEVENT\nSUMMARY:" + h.materia_nombre + "\nDESCRIPTION:Aula " + h.aula + " Prof " + h.profesor + "\nDTSTART:" + dtstart + "\nDTEND:" + dtend + "\nEND:VEVENT\n";
    });
    eventos.forEach(e => {
        ics += "BEGIN:VEVENT\nSUMMARY:" + e.titulo + "\nDTSTART:" + e.fecha.replace(/-/g,'') + "T090000Z\nEND:VEVENT\n";
    });
    ics += "END:VCALENDAR";
    return ics;
}

async function exportarHorarioICS() { 
    if(!appState.currentCareer) return;
    try { 
        const icsString = generarICS(appState.horarios, appState.eventos);
        const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' });
        const url = window.URL.createObjectURL(blob); 
        const a = document.createElement('a'); a.href = url; a.download = `horario_ucv_${appState.user}.ics`; 
        document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url); document.body.removeChild(a);
        alert('✅ Calendario exportado.'); 
    } catch(e) { alert('❌ Error: ' + e.message); } 
}

async function loadEventos() { appState.eventos = await API.get_eventos(); }
function cambiarMes(o) { appState.currentDate.setMonth(appState.currentDate.getMonth()+o); renderCalendario(); }

function renderCalendario() { 
    const y = appState.currentDate.getFullYear(), m = appState.currentDate.getMonth(), grid = document.getElementById('calendario-grid'); grid.innerHTML = '';
    document.getElementById('mes-anio-display').textContent = new Date(y, m).toLocaleDateString('es-ES', {month:'long', year:'numeric'});
    for(let i=0; i<new Date(y,m,1).getDay(); i++) grid.innerHTML += `<div></div>`;
    const t = new Date(); for(let d=1; d<=new Date(y,m+1,0).getDate(); d++) { 
    const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = (d === t.getDate() && m === t.getMonth() && y === t.getFullYear());
    const cellClass = isToday ? 'bg-yellow-50 border-2 border-yellow-400' : 'hover:bg-gray-50 border';
    const evsDia = appState.eventos.filter(e=>e.fecha===ds);
    const evHtml = evsDia.map(e => {
        const hasEval = !!e.evaluacion_id;
        const clickHandler = hasEval
            ? `abrirNotaEvalModal(${e.evaluacion_id}, '${e.titulo.replace(/'/g,"&#39;")}'); event.stopPropagation()`
            : `borrarEvento(${e.id}, event)`;
        const icon = hasEval ? '✏️' : '&times;';
        return `<div class="text-[10px] text-white px-1 py-0.5 rounded mt-1 truncate flex justify-between" style="background:${e.color}"><span class="truncate">${e.titulo}</span><button onclick="${clickHandler}" class="hover:text-red-200 ml-1 flex-shrink-0">${icon}</button></div>`;
    }).join('');
    grid.innerHTML += `<div class="min-h-[80px] p-1 rounded cursor-pointer flex flex-col ${cellClass}" onclick="abrirModalEvento('${ds}')"><span class="self-end text-xs font-bold ${isToday?'text-yellow-600':'text-gray-500'}">${d}</span>${evHtml}</div>`; } 
}

function abrirModalEvento(ds) { 
    appState.selectedDateStr = ds; document.getElementById('evento-fecha-display').textContent = ds; document.getElementById('evento-modal').classList.remove('hidden');
    const sel = document.getElementById('evento-materia-select'), enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
    sel.innerHTML = enCurso.map(m => `<option value="Examen: ${m.nombre}">Examen: ${m.nombre}</option><option value="Entrega: ${m.nombre}">Entrega: ${m.nombre}</option>`).join('') + '<option value="MANUAL">-- Otra Actividad --</option>';
    sel.onchange = (e) => { document.getElementById('evento-titulo-manual').classList.toggle('hidden', e.target.value !== 'MANUAL'); }; sel.onchange({target:sel}); 
}

async function guardarEvento() { 
    let t = document.getElementById('evento-materia-select').value; if(t === 'MANUAL') t = document.getElementById('evento-titulo-manual').value; const c = document.getElementById('evento-color').value; if(!t) return;
    await API.save_evento({fecha:appState.selectedDateStr, titulo:t, color:c});
    document.getElementById('evento-modal').classList.add('hidden'); await loadEventos(); renderCalendario(); 
}

async function borrarEvento(id, e) { 
    e.stopPropagation(); if(!confirm('¿Eliminar este evento?')) return; 
    await API.delete_evento(id); await loadEventos(); renderCalendario(); 
}

/* ==================== EVALUACIONES & WHAT-IF ==================== */
async function loadEvaluaciones() { appState.evaluaciones = await API.get_evaluaciones(appState.currentCareer); }

function renderEvaluaciones() {
   const container = document.getElementById('evaluaciones-grid');
   const enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
   if(enCurso.length === 0) { container.innerHTML = '<p class="text-gray-500 lg:col-span-2 text-center py-6">No tienes materias En Curso. Inscríbelas en Progreso primero.</p>'; return; }
   
   container.innerHTML = enCurso.map(m => {
       const evs = appState.evaluaciones.filter(e => e.materia_codigo === m.codigo);
       let pesoTotal = 0, notaAcumulada = 0;
       evs.forEach(e => { pesoTotal += e.peso; if(e.nota != null) notaAcumulada += (e.nota * e.peso / 100); });
       const faltaAprobar = Math.max(0, 10 - notaAcumulada);
       const restantePeso = Math.max(0, 100 - pesoTotal);
       const objFalta = restantePeso > 0 ? ((faltaAprobar / restantePeso) * 100).toFixed(1) : '-';
       
       const evsHtml = evs.length === 0 ? '<p class="text-xs text-gray-400 italic">No hay evaluaciones registradas.</p>' : evs.map(e => `
           <div class="flex justify-between items-center text-sm border-b py-1">
             <span><b>${e.titulo}</b> (${e.peso}%) <br><span class="text-[10px] text-gray-500">${e.fecha || 'Sin fecha'}</span></span>
             <span><b class="${e.nota>=10?'text-green-600':(e.nota==null?'text-gray-400':'text-red-600')}">${e.nota!=null?e.nota:'--'}</b>/20 <button onclick="borrarEvaluacion(${e.id})" class="text-red-400 hover:text-red-600 ml-2"><i class="fas fa-trash"></i></button></span>
           </div>
       `).join('');
       
       return `
       <div class="card p-5 border-l-4 border-blue-500 shadow-sm flex flex-col justify-between">
           <div>
             <div class="flex justify-between items-center mb-2">
               <h3 class="font-bold text-lg text-gray-800">${m.nombre}</h3>
               <span class="text-xs font-bold bg-blue-100 text-blue-800 px-2 py-1 rounded">Acumulado: ${notaAcumulada.toFixed(1)}/20</span>
             </div>
             <div class="w-full bg-gray-200 h-2 flex rounded-full overflow-hidden mb-1">
               <div class="bg-blue-600 h-2" style="width: ${pesoTotal}%"></div>
             </div>
             <div class="flex justify-between text-[11px] font-bold text-gray-500 mb-4">
               <span>Evaluado: ${pesoTotal}%</span>
               <span>Restante: ${restantePeso}%</span>
             </div>
             <p class="text-xs text-gray-700 font-medium mb-3 bg-gray-50 p-2 rounded border">Necesitas un promedio de <b>${objFalta}/20</b> en el ${restantePeso}% restante para llegar a 10.</p>
             <div class="space-y-1 mb-4">${evsHtml}</div>
           </div>
           <div class="bg-blue-50 p-3 rounded border text-sm mt-auto">
             <input type="text" id="ev-tit-${m.codigo}" placeholder="Título (ej: Parcial 1)" class="w-full p-2 mb-2 border rounded">
             <div class="flex gap-2 mb-2">
               <input type="number" id="ev-peso-${m.codigo}" placeholder="Peso %" class="w-1/3 p-2 border rounded" min="1" max="100">
               <input type="number" id="ev-nota-${m.codigo}" placeholder="Nota/20" class="w-1/3 p-2 border rounded" min="0" max="20">
               <input type="date" id="ev-fec-${m.codigo}" class="w-1/3 p-2 border rounded">
             </div>
             <button onclick="addEvaluacion('${m.codigo}', '${m.nombre.replace(/'/g, "\\'")}')" class="w-full bg-blue-600 text-white font-bold py-1.5 rounded hover:bg-blue-700 transition">Agregar Evaluación</button>
           </div>
       </div>`;
   }).join('');
}

async function addEvaluacion(codigo, nombreMat) {
   const titulo = document.getElementById('ev-tit-'+codigo).value;
   const peso = parseInt(document.getElementById('ev-peso-'+codigo).value);
   const notaStr = document.getElementById('ev-nota-'+codigo).value;
   const nota = notaStr ? Math.round(parseFloat(notaStr)) : null;
   const fecha = document.getElementById('ev-fec-'+codigo).value;
   
   if(!titulo || !peso) { alert("Título y Peso son obligatorios."); return; }
   await API.save_evaluacion({carrera_id:appState.currentCareer, materia_codigo:codigo, materia_nombre:nombreMat, titulo, peso, nota, fecha});
   await loadEvaluaciones(); renderEvaluaciones();
}

async function borrarEvaluacion(id) {
   if(!confirm('¿Eliminar esta evaluación?')) return;
   await API.delete_evaluacion(id);
   await loadEvaluaciones(); renderEvaluaciones();
}

function abrirSimulador() {
   document.getElementById('simulador-modal').classList.remove('hidden');
   const enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
   const cont = document.getElementById('simulador-materias');
   if(enCurso.length === 0) { cont.innerHTML = '<p class="text-sm text-gray-500">No hay materias en curso.</p>'; }
   else {
       cont.innerHTML = enCurso.map(m => `
         <div class="flex justify-between items-center border-b pb-2">
           <span class="font-bold text-sm text-gray-800 truncate">${m.nombre} <span class="text-[10px] text-gray-500">(${m.creditos} UC)</span></span>
           <input type="number" min="0" max="20" placeholder="0-20" class="sim-nota-input w-20 p-2 border-2 border-purple-200 focus:border-purple-500 rounded text-center font-black text-purple-900 ml-2" data-creditos="${m.creditos}" oninput="calcularSimulador()">
         </div>
       `).join('');
   }
   calcularSimulador();
}

function calcularSimulador() {
   let uc_cur = 0, pts = 0, uc_apr = 0;
   appState.pensumData.kardex_history.forEach(k => {
     const mBase = appState.pensumData.pensum.find(p=>p.id===k.materia_id);
     if(!mBase || k.estado === 'En Curso' || k.estado === 'Sin Cursar' || k.estado === 'Retirada') return;
     uc_cur += mBase.creditos; pts += (k.nota || 0) * mBase.creditos;
     if(k.estado === 'Aprobada') uc_apr += mBase.creditos;
   });
   
   document.querySelectorAll('.sim-nota-input').forEach(inp => {
     if(inp.value !== '') {
       const v = parseFloat(inp.value); const cr = parseInt(inp.dataset.creditos);
       if(v >= 0 && v <= 20) { uc_cur += cr; pts += v * cr; if(v >= 10) uc_apr += cr; }
     }
   });
   
   document.getElementById('sim-promedio').textContent = uc_cur > 0 ? (pts/uc_cur).toFixed(3) : "0.000";
   document.getElementById('sim-eficiencia').textContent = uc_cur > 0 ? ((uc_apr/uc_cur)*100).toFixed(1) + "%" : "0.0%";
}

/* ======= NOTA DESDE CALENDARIO ======= */
function abrirNotaEvalModal(evalId, titulo) {
    const ev = appState.evaluaciones.find(e => e.id === evalId);
    document.getElementById('nota-eval-id').value = evalId;
    document.getElementById('nota-eval-titulo').textContent = ev ? `${ev.titulo} · ${ev.materia_nombre} (Peso: ${ev.peso}%)` : titulo;
    document.getElementById('nota-eval-input').value = (ev && ev.nota != null) ? ev.nota : '';
    document.getElementById('nota-eval-modal').classList.remove('hidden');
}

async function guardarNotaDesdeCalendario() {
    const id = parseInt(document.getElementById('nota-eval-id').value);
    const raw = document.getElementById('nota-eval-input').value;
    if (raw === '') { alert('Ingresa una nota (0-20).'); return; }
    const nota = Math.round(parseFloat(raw));
    await API.update_evaluacion_nota(id, nota);
    document.getElementById('nota-eval-modal').classList.add('hidden');
    await loadEvaluaciones();
    await loadEventos();
    renderCalendario();
}

/* ======= PROGRAMACIÓN SEMANAL ======= */
async function loadSemanas() {
    if (!appState.currentCareer) return;
    if (!appState.semanas) appState.semanas = [];
    appState.semanas = await API.get_semanas(appState.currentCareer);
    renderSemanas();
}

function renderSemanas() {
    const tbody = document.getElementById('semanas-tbody');
    if (!tbody) return;
    if (!appState.semanas || appState.semanas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400 py-6 italic">No hay semanas. Añade una o importa con IA.</td></tr>';
        return;
    }
    const sorted = [...appState.semanas].sort((a,b) => (a.numero||0) - (b.numero||0));
    tbody.innerHTML = sorted.map(s => `
        <tr class="border-b hover:bg-purple-50 transition">
            <td class="p-2 border text-center font-black text-purple-800">${s.numero || '-'}</td>
            <td class="p-2 border text-center text-xs">${s.fecha || '<em class="text-gray-400">Sin fecha</em>'}</td>
            <td class="p-2 border text-sm font-medium">${s.materia || ''}</td>
            <td class="p-2 border text-sm">${s.tema || ''}</td>
            <td class="p-2 border text-center whitespace-nowrap">
                <button onclick="editarSemana(${s.id})" class="text-blue-500 hover:text-blue-700 mr-2" title="Editar"><i class="fas fa-pen"></i></button>
                <button onclick="borrarSemanaConfirm(${s.id})" class="text-red-400 hover:text-red-600" title="Borrar"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`).join('');
}

function poblarSelectSemanaMateria(valorActual) {
    const sel = document.getElementById('semana-modal-materia');
    if (!sel) return;
    const enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
    sel.innerHTML = enCurso.map(m => `<option value="${m.nombre}">${m.nombre}</option>`).join('') || '<option value="">Sin materias En Curso</option>';
    if (valorActual) sel.value = valorActual;
}

function agregarSemana() {
    document.getElementById('semana-modal-title').textContent = 'Añadir Semana';
    document.getElementById('semana-modal-id').value = '';
    const nextNum = appState.semanas && appState.semanas.length > 0 ? Math.max(...appState.semanas.map(s=>s.numero||0)) + 1 : 1;
    document.getElementById('semana-modal-numero').value = nextNum;
    document.getElementById('semana-modal-fecha').value = '';
    document.getElementById('semana-modal-tema').value = '';
    poblarSelectSemanaMateria();
    document.getElementById('semana-modal').classList.remove('hidden');
}

function editarSemana(id) {
    const s = appState.semanas.find(x => x.id === id);
    if (!s) return;
    document.getElementById('semana-modal-title').textContent = 'Editar Semana';
    document.getElementById('semana-modal-id').value = id;
    document.getElementById('semana-modal-numero').value = s.numero || '';
    document.getElementById('semana-modal-fecha').value = s.fecha || '';
    document.getElementById('semana-modal-tema').value = s.tema || '';
    poblarSelectSemanaMateria(s.materia);
    document.getElementById('semana-modal').classList.remove('hidden');
}

async function guardarSemanaModal() {
    const idVal = document.getElementById('semana-modal-id').value;
    const numero = parseInt(document.getElementById('semana-modal-numero').value) || 1;
    const fecha = document.getElementById('semana-modal-fecha').value;
    const materia = document.getElementById('semana-modal-materia').value;
    const tema = document.getElementById('semana-modal-tema').value;
    document.getElementById('semana-modal').classList.add('hidden');
    if (idVal) {
        await API.update_semana(parseInt(idVal), { numero, fecha, materia, tema });
    } else {
        await API.save_semana({ carrera_id: appState.currentCareer, numero, fecha, materia, tema });
    }
    await loadEventos();
    renderCalendario();
    await loadSemanas();
}

async function borrarSemanaConfirm(id) {
    if (!confirm('¿Eliminar esta semana del planificador?')) return;
    await API.delete_semana(id);
    await loadEventos();
    renderCalendario();
    await loadSemanas();
}
