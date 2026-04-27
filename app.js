/**
 * UCV Planner — Premium Edition
 * Versión : 10.0.4 (Offline Native)
 * Design  : Glassmorphism / Indigo Theme
 * Authors : Alex & Antigravity AI
 */
const APP_VERSION = '10.0.4';
const appState = { 
    currentCareer:null, 
    pensumData:null, 
    currentView:'list', 
    optimalPlan:null, 
    horarios:[], 
    eventos:[], 
    evaluaciones:[], 
    semanas:[], 
    currentDate:new Date(), 
    selectedDateStr:null, 
    kardexChartInstance:null, 
    seccionSeleccionada:null 
};

document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(err => console.error("SW fallback", err));
    }

    const db = loadDB();
    if (db.currentCareer) {
        await selectCareer(db.currentCareer);
    } else {
        document.getElementById('onboarding-screen').classList.remove('hidden');
        renderOnboarding();
    }
});

function renderOnboarding() { 
    const carreras = PENSUMS_DB;
    document.getElementById('ob-career-grid').innerHTML = Object.keys(carreras).map(k => `
        <div class="glass-card p-6 text-center group cursor-pointer" onclick="saveCareerChoice('${k}')">
            <div class="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-blue-500/40 transition-all">
                <i class="fas fa-university text-blue-400"></i>
            </div>
            <h3 class="font-black text-slate-200 text-lg group-hover:text-white transition-all">${carreras[k].NOMBRE}</h3>
        </div>
    `).join(''); 
}

async function saveCareerChoice(key) { 
    const db = loadDB();
    db.currentCareer = key;
    saveDB(db);
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
    switchTab('progreso'); 
}

function switchTab(tab) { 
    ['progreso','kardex','horario','evaluaciones','calendario','pd'].forEach(t => { 
        const sec = document.getElementById(`${t}-section`);
        if(sec) sec.classList.add('hidden'); 
        const el = document.getElementById(`tab-${t}`); 
        if(el) {
            el.className = 'px-5 py-3 font-bold text-slate-500 hover:text-white transition-all';
        }
    });
    
    const activeSec = document.getElementById(`${tab}-section`);
    if(activeSec) activeSec.classList.remove('hidden'); 
    
    let tabEl = document.getElementById(`tab-${tab}`); 
    if(tabEl) {
        tabEl.className = 'px-5 py-3 font-bold text-blue-500 border-b-2 border-blue-500 transition-all';
    }

    if(tab==='kardex') setTimeout(renderKardex, 50); 
    if(tab==='progreso' && appState.currentView==='visual') setTimeout(dibujarPrelaciones, 50); 
    if(tab==='horario') loadHorarios().then(() => renderHorarioLista());
    if(tab==='calendario') loadEventos().then(() => renderCalendario());
}

function changeView(v) { 
    appState.currentView = v; 
    ['semestres','pensum-visual-container','optimal-planner-container'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });
    
    ['list','visual','optimal'].forEach(id => {
        const btn = document.getElementById('btn-'+id);
        if(btn) btn.className = 'px-6 py-2 glass-card text-slate-400 font-bold transition-all';
    });

    const activeView = document.getElementById(v==='list' ? 'semestres' : (v==='visual' ? 'pensum-visual-container' : 'optimal-planner-container'));
    if(activeView) activeView.classList.remove('hidden');
    
    const activeBtn = document.getElementById('btn-'+v);
    if(activeBtn) activeBtn.className = 'px-6 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-lg transition-all';

    if(v==='list') renderizarSemestres(); 
    if(v==='visual') renderizarPensumVisual(); 
}

/* ===================== PROGRESO & MAPA ===================== */

function renderizarSemestres() { 
    const container = document.getElementById('semestres'); 
    if(!container) return;
    container.innerHTML = '';
    const p = appState.pensumData.pensum, credAp = p.filter(m=>m.estado==='Aprobada').reduce((a,m)=>a+m.creditos,0), curSet = new Set(p.filter(m=>m.estado==='Aprobada').map(m=>m.codigo));
    
    [...new Set(p.map(m=>m.semestre))].sort((a,b)=>a-b).forEach(s => { 
        const html = p.filter(m=>m.semestre===s).map(m => { 
            const status = checkDisponibilidad(m, credAp, curSet);
            const isApproved = m.estado === 'Aprobada';
            const isCurrent = m.estado === 'En Curso';
            
            return `
            <div class="flex justify-between items-center p-4 border-b border-slate-800/50 transition-all ${isApproved ? 'bg-emerald-500/10' : (isCurrent ? 'bg-blue-500/10' : 'hover:bg-white/5')} cursor-pointer" onclick="openMateriaModal(${m.id})">
                <div>
                    <p class="font-bold text-slate-200 text-sm">${m.nombre}</p>
                    <p class="text-xs text-slate-500">${m.codigo} • ${m.creditos} UC • <b class="capitalize ${status==='disponible' ? 'text-blue-400' : ''}">${m.estado==='Sin Cursar' ? status : m.estado}</b></p>
                </div>
                <div class="text-xl">
                    ${isApproved ? '<i class="fas fa-check-circle text-emerald-500"></i>' : (isCurrent ? '<i class="fas fa-spinner fa-spin text-blue-400"></i>' : '<i class="fas fa-edit text-slate-600 opacity-50"></i>')}
                </div>
            </div>`; 
        }).join(''); 
        
        container.innerHTML += `
            <div class="glass-card overflow-hidden">
                <div class="bg-slate-800/50 px-5 py-3 border-b border-slate-700">
                    <h3 class="font-black text-slate-300">Semestre ${s}</h3>
                </div>
                <div class="divide-y divide-slate-800/50">${html}</div>
            </div>`; 
    }); 
}

function renderizarPensumVisual() { 
    const cont = document.getElementById('pensum-visual'); 
    if(!cont) return;
    cont.innerHTML = '';
    const p = appState.pensumData.pensum, credAp = p.filter(m=>m.estado==='Aprobada').reduce((a,m)=>a+m.creditos,0), curSet = new Set(p.filter(m=>m.estado==='Aprobada').map(m=>m.codigo));
    
    [...new Set(p.map(m=>m.semestre))].sort((a,b)=>a-b).forEach(s => { 
        const sBlq = document.createElement('div'); 
        sBlq.className = 'w-full mb-12 flex flex-col items-center relative z-10'; 
        sBlq.innerHTML = `<h3 class="glass-card bg-blue-500/10 border-blue-500/30 text-blue-400 font-black px-6 py-1.5 rounded-full mb-6 shadow-lg uppercase tracking-widest text-xs">Semestre ${s}</h3>`;
        
        const mGr = document.createElement('div'); 
        mGr.className = 'flex flex-wrap justify-center gap-6';
        
        p.filter(m=>m.semestre===s).forEach(m => { 
            const status = checkDisponibilidad(m, credAp, curSet); 
            let cl = m.estado === 'En Curso' ? 'cursada' : (m.estado === 'Aprobada' ? 'cursada' : status);
            
            mGr.innerHTML += `
                <div id="nodo-${m.codigo}" 
                     class="materia-nodo glass-card p-4 w-44 h-24 flex flex-col justify-center text-center cursor-pointer transition-all ${cl}" 
                     onclick="openMateriaModal(${m.id})"
                     onmouseenter="highlightPaths('${m.codigo}')"
                     onmouseleave="clearHighlights()">
                    <p class="font-bold text-xs leading-tight text-slate-200">${m.nombre}</p>
                    <p class="text-[10px] mt-2 font-mono text-slate-500">${m.codigo} • ${m.creditos} UC</p>
                </div>`; 
        });
        sBlq.appendChild(mGr); 
        cont.appendChild(sBlq); 
    }); 
    setTimeout(dibujarPrelaciones, 200); 
}

function dibujarPrelaciones() { 
    const svg = document.getElementById('prelaciones-svg');
    const cont = document.getElementById('pensum-visual-container');
    if(!cont || !svg) return;

    svg.innerHTML = ''; 
    const rC = cont.getBoundingClientRect();
    const p = appState.pensumData.pensum;
    
    p.forEach(dst => { 
        const nD = document.getElementById(`nodo-${dst.codigo}`); 
        if(!nD) return; 
        
        dst.prelaciones.forEach(pr => { 
            if(typeof pr!=='string') return; 
            const nO = document.getElementById(`nodo-${pr}`); 
            if(!nO) return;
            
            const rO = nO.getBoundingClientRect();
            const rD = nD.getBoundingClientRect();
            
            const x1 = rO.left + rO.width/2 - rC.left;
            const y1 = rO.bottom - rC.top;
            const x2 = rD.left + rD.width/2 - rC.left;
            const y2 = rD.top - rC.top;

            const cp1y = y1 + (y2 - y1) / 2;
            const cp2y = y1 + (y2 - y1) / 2;
            
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${cp1y}, ${x2} ${cp2y}, ${x2} ${y2}`);
            path.setAttribute("class", "path-line");
            path.setAttribute("data-from", pr);
            path.setAttribute("data-to", dst.codigo);
            svg.appendChild(path);
        }); 
    });
}

function highlightPaths(codigo) {
    const lines = document.querySelectorAll('.path-line');
    lines.forEach(line => {
        const from = line.getAttribute('data-from');
        const to = line.getAttribute('data-to');
        if(from === codigo || to === codigo) line.classList.add('active');
        else line.style.opacity = '0.05';
    });
}

function clearHighlights() {
    document.querySelectorAll('.path-line').forEach(line => {
        line.classList.remove('active');
        line.style.opacity = '';
    });
}

/* ===================== KARDEX & ESTADÍSTICAS ===================== */

function renderKardex() { 
    let uc_insc = 0, uc_apr = 0, sum_pxu = 0; 
    let pPer = {};
    const kardex = appState.pensumData.kardex_history;
    
    kardex.forEach(k => { 
        const mBase = appState.pensumData.pensum.find(p=>p.id===k.materia_id); 
        if(!mBase || k.estado === 'En Curso' || k.estado === 'Sin Cursar') return;
        
        const m = {...k, nombre: mBase.nombre, creditos: mBase.creditos, codigo: mBase.codigo};
        const per = m.periodo || 'Sin Período';
        if(!pPer[per]) pPer[per] = { mats: [], uc_sem: 0, pts_sem: 0 };
        pPer[per].mats.push(m);

        if(m.estado !== 'Retirada') {
            uc_insc += m.creditos;
            pPer[per].uc_sem += m.creditos;
            const pts = (m.nota || 0) * m.creditos;
            sum_pxu += pts;
            pPer[per].pts_sem += pts;
            if(m.estado === 'Aprobada') uc_apr += m.creditos;
        }
    });

    const promedioEgreso = uc_insc > 0 ? (sum_pxu / uc_insc) : 0;
    const indiceAcademico = uc_insc > 0 ? (uc_apr / uc_insc) : 0;

    document.getElementById('kx-promedio-gral').textContent = promedioEgreso.toFixed(3);
    document.getElementById('kx-eficiencia').textContent = indiceAcademico.toFixed(3);
    document.getElementById('kx-uc-cursadas').textContent = uc_insc;

    let html = '';
    const periods = Object.keys(pPer).sort().reverse();
    periods.forEach(p => {
        const dp = pPer[p];
        const promS = dp.uc_sem > 0 ? (dp.pts_sem / dp.uc_sem).toFixed(2) : "0.00";
        html += `
            <div class="glass-card overflow-hidden">
                <div class="bg-slate-800/50 px-4 py-2 flex justify-between items-center border-b border-slate-700">
                    <span class="font-black text-sm text-slate-300">${p}</span>
                    <span class="text-[10px] font-bold bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">Prom: ${promS}</span>
                </div>
                <div class="divide-y divide-slate-800/50">
                    ${dp.mats.map(m => `
                        <div class="px-4 py-2 text-xs flex justify-between items-center">
                            <span class="text-slate-400">${m.nombre}</span>
                            <span class="font-bold ${m.estado==='Aprobada'?'text-emerald-400':(m.estado==='Retirada'?'text-slate-600':'text-red-400')}">${m.nota || m.estado}</span>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    });
    document.getElementById('kardex-table').innerHTML = html || '<p class="col-span-full text-center py-10 text-slate-500">No hay datos de kárdex.</p>';
    renderKardexChart(pPer);
}

function renderKardexChart(pPer) {
    const ctx = document.getElementById('kardexChart');
    if(!ctx) return;
    if(appState.kardexChartInstance) appState.kardexChartInstance.destroy();
    const labels = Object.keys(pPer).sort();
    const dataProm = labels.map(p => (pPer[p].pts_sem / pPer[p].uc_sem).toFixed(2));
    appState.kardexChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{ label: 'Promedio Semestral', data: dataProm, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 20, grid: { color: 'rgba(255,255,255,0.05)' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }
    });
}

/* ===================== OTROS ===================== */

async function parsePDF(type, mode) {
    const fileInput = document.getElementById(`${type}-file`);
    const statusEl = document.getElementById(`${type}-parse-status`);
    if(!fileInput.files[0]) return alert("Sube un archivo");
    statusEl.innerHTML = '<div class="flex items-center gap-2 text-blue-400 font-bold animate-pulse"><i class="fas fa-spinner fa-spin"></i> Procesando...</div>';
    try {
        const results = await parsePDFMultiMode(fileInput.files[0], type, mode, {}, (msg, cls) => { statusEl.innerHTML = `<div class="${cls}">${msg}</div>`; });
        if(type === 'kardex') {
            for(let m of results) {
                const mat = appState.pensumData.pensum.find(x => x.codigo === m.codigo);
                if(mat) await API.save_progreso(appState.currentCareer, mat.id, m.estado, m.nota, m.periodo);
            }
            appState.pensumData = await API.get_pensum(appState.currentCareer);
            actualizarVista(); renderKardex();
            statusEl.innerHTML = `<div class="text-emerald-400 font-bold">✅ ${results.length} materias importadas</div>`;
        }
        if(type === 'calendario') {
            for(let e of results) await API.save_evento(e);
            await loadEventos(); renderCalendario();
            statusEl.innerHTML = `<div class="text-emerald-400 font-bold">✅ ${results.length} eventos importados</div>`;
        }
    } catch(e) { statusEl.innerHTML = `<div class="text-red-400 font-bold">❌ Error: ${e.message}</div>`; }
}

function openMateriaModal(id) { 
    const m = appState.pensumData.pensum.find(x => x.id === id); 
    if(!m) return;
    document.getElementById('modal-mat-id').value = m.id; 
    document.getElementById('modal-mat-nombre').textContent = m.nombre; 
    document.getElementById('modal-mat-codigo').textContent = `${m.codigo} • ${m.creditos} UC`;
    document.getElementById('modal-mat-estado').value = m.estado; 
    document.getElementById('modal-mat-nota').value = m.nota || '';
    document.getElementById('modal-mat-periodo').value = m.periodo || '';
    document.getElementById('materia-modal').classList.remove('hidden'); 
}

async function guardarMateria() { 
    const id = parseInt(document.getElementById('modal-mat-id').value); 
    const est = document.getElementById('modal-mat-estado').value; 
    const nota = document.getElementById('modal-mat-nota').value;
    const per = document.getElementById('modal-mat-periodo').value;
    await API.save_progreso(appState.currentCareer, id, est, nota ? parseInt(nota) : null, per);
    document.getElementById('materia-modal').classList.add('hidden'); 
    appState.pensumData = await API.get_pensum(appState.currentCareer);
    actualizarVista(); 
    if(appState.currentView === 'list') renderizarSemestres(); else if(appState.currentView === 'visual') renderizarPensumVisual(); 
}

function actualizarVista() { 
    const p = appState.pensumData.pensum, cAp = p.filter(m=>m.estado==='Aprobada').reduce((a,m)=>a+m.creditos,0);
    document.getElementById('creditos-aprobados').textContent = cAp; 
    const prog = (cAp / appState.pensumData.TOTAL_CREDITOS_CARRERA)*100; 
    document.getElementById('progressBar').style.width = `${prog}%`; 
    document.getElementById('progress-percent').textContent = `${prog.toFixed(1)}%`;
    const curSet = new Set(p.filter(m=>m.estado==='Aprobada').map(m=>m.codigo));
    const disp = p.filter(m => m.estado==='Sin Cursar' && checkDisponibilidad(m, cAp, curSet)==='disponible');
    disp.forEach(d => { d.peso = calculateUnlockWeight(d.codigo, p); }); 
    disp.sort((a,b)=>b.peso - a.peso);
    document.getElementById('materias-disponibles-lista').innerHTML = disp.map(m=>`
        <div class="p-4 glass-card border-none bg-white/5 hover:bg-white/10 flex justify-between items-center cursor-pointer transition-all" onclick="openMateriaModal(${m.id})">
            <div><p class="font-bold text-slate-200 text-sm">${m.nombre}</p><span class="text-xs text-slate-500 font-mono">${m.creditos} UC</span></div>
            ${m.peso > 0 ? `<span class="bg-blue-500/20 text-blue-400 text-[10px] font-black px-2 py-1 rounded-lg border border-blue-500/30">Abre ${m.peso}</span>` : ''}
        </div>`).join('') || '<p class="text-sm text-slate-500 text-center py-4">No hay materias disponibles</p>'; 
}

function calculateUnlockWeight(codigo, pensum) {
    let weight = 0;
    const targets = pensum.filter(m => m.prelaciones.includes(codigo));
    weight += targets.length;
    targets.forEach(t => { weight += calculateUnlockWeight(t.codigo, pensum) * 0.5; });
    return Math.round(weight);
}

function checkDisponibilidad(materia, creditosAprobados, materiasAprobadasCodigos) { 
    if (materia.estado === 'Aprobada' || materia.estado === 'En Curso') return materia.estado; 
    return materia.prelaciones.every(p => { 
        if (typeof p === 'string') return materiasAprobadasCodigos.has(p); 
        if (typeof p === 'object' && p.tipo === 'creditos') return creditosAprobados >= p.valor; 
        return true; 
    }) ? 'disponible' : 'bloqueada'; 
}

/* ===================== HORARIO & CALENDARIO ===================== */
async function loadHorarios() { appState.horarios = await API.get_horarios(); }
function renderHorarioLista() {
    const lista = document.getElementById('horario-lista');
    if(!lista) return;
    lista.innerHTML = appState.horarios.map(h => `
        <div class="p-3 glass-card bg-white/5 flex justify-between items-center">
            <div><p class="font-bold text-xs text-slate-200">${h.materia_nombre}</p><p class="text-[10px] text-slate-500">${h.dia} ${h.hora_inicio}-${h.hora_fin}</p></div>
            <button onclick="borrarHorario(${h.id})" class="text-red-400 hover:text-red-300"><i class="fas fa-trash"></i></button>
        </div>`).join('') || '<p class="text-xs text-slate-500 text-center">No hay clases</p>';
}
async function guardarHorario() { 
    const m = document.getElementById('horario-materia-select').value;
    const h_ini = document.getElementById('horario-inicio').value;
    const h_fin = document.getElementById('horario-fin').value;
    const dias = Array.from(document.querySelectorAll('.dia-cb:checked')).map(cb => cb.value);
    if(!m || !h_ini || !h_fin || !dias.length) return alert("Completa los datos");
    for(let dia of dias) await API.save_horario({ materia_nombre: m, dia, hora_inicio: h_ini, hora_fin: h_fin });
    loadHorarios().then(renderHorarioLista);
}
async function borrarHorario(id) { if(confirm("¿Eliminar?")) { await API.delete_horario(id); loadHorarios().then(renderHorarioLista); } }

async function loadEventos() { appState.eventos = await API.get_eventos(); }
function cambiarMes(o) { appState.currentDate.setMonth(appState.currentDate.getMonth()+o); renderCalendario(); }
function renderCalendario() {
    const grid = document.getElementById('calendario-grid');
    if(!grid) return;
    const y = appState.currentDate.getFullYear(), m = appState.currentDate.getMonth();
    document.getElementById('mes-anio-display').textContent = new Intl.DateTimeFormat('es-ES', {month:'long', year:'numeric'}).format(appState.currentDate);
    grid.innerHTML = '';
    for(let i=0; i<new Date(y,m,1).getDay(); i++) grid.innerHTML += '<div class="h-20 bg-slate-900/50"></div>';
    for(let d=1; d<=new Date(y,m+1,0).getDate(); d++) {
        const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const evs = appState.eventos.filter(e => e.fecha === ds);
        grid.innerHTML += `
            <div class="h-20 p-1 border-t border-slate-700/50 relative">
                <span class="text-[10px] font-bold text-slate-500">${d}</span>
                <div class="space-y-0.5 mt-1">
                    ${evs.map(e => `<div class="text-[8px] bg-blue-500/30 text-blue-200 p-0.5 rounded truncate">${e.titulo}</div>`).join('')}
                </div>
            </div>`;
    }
}

function poblarSelectsMaterias() {
    const sel = document.getElementById('horario-materia-select');
    if(!sel) return;
    const enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
    sel.innerHTML = enCurso.map(m => `<option value="${m.nombre}">${m.nombre}</option>`).join('') + '<option value="MANUAL">-- Otro --</option>';
}

/* ===================== API OFFLINE NATIVE ===================== */
const API = {
    async get_pensum(key) {
        const db = loadDB();
        const pBase = JSON.parse(JSON.stringify(PENSUMS_DB[key]));
        const prog = db.progreso[key] || {};
        pBase.pensum.forEach(m => {
            if(prog[m.id]) { m.estado = prog[m.id].estado; m.nota = prog[m.id].nota; m.periodo = prog[m.id].periodo; }
            else { m.estado = 'Sin Cursar'; m.nota = null; m.periodo = ''; }
        });
        const kardexRaw = db.kardex_history?.[key] || [];
        pBase.kardex_history = kardexRaw;
        return pBase;
    },
    async save_progreso(career, id, estado, nota, periodo) {
        const db = loadDB();
        if(!db.progreso[career]) db.progreso[career] = {};
        db.progreso[career][id] = { estado, nota, periodo };
        // Sync to kardex history for stats
        if(!db.kardex_history[career]) db.kardex_history[career] = [];
        db.kardex_history[career] = db.kardex_history[career].filter(x => x.materia_id !== id || x.periodo !== periodo);
        db.kardex_history[career].push({ materia_id: id, estado, nota, periodo });
        saveDB(db);
    },
    async save_evento(e) { const db = loadDB(); db.eventos.push({...e, id: Date.now()}); saveDB(db); },
    async get_eventos() { return loadDB().eventos || []; },
    async save_horario(h) { const db = loadDB(); db.horarios.push({...h, id: Date.now()}); saveDB(db); },
    async get_horarios() { return loadDB().horarios || []; },
    async delete_horario(id) { const db = loadDB(); db.horarios = db.horarios.filter(x => x.id !== id); saveDB(db); }
};

function loadDB() {
    const data = localStorage.getItem('ucv_db_native');
    return data ? JSON.parse(data) : { currentCareer: null, progreso: {}, eventos: [], horarios: [], kardex_history: {} };
}
function saveDB(db) { localStorage.setItem('ucv_db_native', JSON.stringify(db)); }
