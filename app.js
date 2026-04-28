/**
 * UCV Planner — Premium Edition
 * Versión : 10.1.0 (All Fixes)
 * Design  : Glassmorphism / Indigo Theme
 * Authors : Alex & Antigravity AI
 */
const APP_VERSION = '10.1.0';

/* ===================== API OFFLINE NATIVE ===================== */
const API = {
    async get_pensum(key) {
        const db = loadDB();
        const pBase = JSON.parse(JSON.stringify(PENSUMS_DB[key] || {}));
        if (!pBase.pensum) return { pensum: [], NOMBRE: 'Error' };
        const prog = db.progreso[key] || {};
        pBase.pensum.forEach(m => {
            if (prog[m.id]) { m.estado = prog[m.id].estado; m.nota = prog[m.id].nota; m.periodo = prog[m.id].periodo; }
            else { m.estado = 'Sin Cursar'; m.nota = null; m.periodo = ''; }
        });
        pBase.kardex_history = db.kardex_history?.[key] || [];
        return pBase;
    },
    async save_progreso(career, id, estado, nota, periodo) {
        const db = loadDB();
        if (!db.progreso[career]) db.progreso[career] = {};
        db.progreso[career][id] = { estado, nota, periodo };
        if (!db.kardex_history) db.kardex_history = {};
        if (!db.kardex_history[career]) db.kardex_history[career] = [];
        db.kardex_history[career] = db.kardex_history[career].filter(x => x.materia_id !== id || x.periodo !== periodo);
        db.kardex_history[career].push({ materia_id: id, estado, nota, periodo });
        saveDB(db);
    },
    async save_evento(e) { const db = loadDB(); db.eventos.push({ ...e, id: Date.now() }); saveDB(db); },
    async get_eventos() { return loadDB().eventos || []; },
    async save_horario(h) { const db = loadDB(); db.horarios.push({ ...h, id: Date.now() }); saveDB(db); },
    async get_horarios() { return loadDB().horarios || []; },
    async delete_horario(id) { const db = loadDB(); db.horarios = db.horarios.filter(x => x.id !== id); saveDB(db); },
    async get_evaluaciones() { return loadDB().evaluaciones || []; },
    async save_evaluacion(e) { const db = loadDB(); if (!db.evaluaciones) db.evaluaciones = []; db.evaluaciones.push({ ...e, id: Date.now() }); saveDB(db); },
    async delete_evaluacion(id) { const db = loadDB(); db.evaluaciones = (db.evaluaciones || []).filter(x => x.id !== id); saveDB(db); }
};

const appState = {
    currentCareer: null,
    pensumData: null,
    currentView: 'list',
    optimalPlan: null,
    horarios: [],
    eventos: [],
    evaluaciones: [],
    currentDate: new Date(),
    kardexChartInstance: null,
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log("App Initializing v" + APP_VERSION);
    try {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js').catch(err => console.error("SW error", err));
        }
        const db = loadDB();
        if (db.currentCareer && PENSUMS_DB[db.currentCareer]) {
            await selectCareer(db.currentCareer);
        } else {
            const ob = document.getElementById('onboarding-screen');
            if (ob) { ob.classList.remove('hidden'); renderOnboarding(); }
        }
    } catch (err) {
        console.error("Initialization failed:", err);
        alert("Error al iniciar: " + err.message);
    }
});

function renderOnboarding() {
    const grid = document.getElementById('ob-career-grid');
    if (!grid) return;
    grid.innerHTML = Object.keys(PENSUMS_DB).map(k => `
        <div class="glass-card p-6 text-center group cursor-pointer" onclick="saveCareerChoice('${k}')">
            <div class="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:bg-blue-500/40 transition-all">
                <i class="fas fa-university text-blue-400"></i>
            </div>
            <h3 class="font-black text-slate-200 text-lg group-hover:text-white transition-all">${PENSUMS_DB[k].NOMBRE}</h3>
        </div>
    `).join('');
}

async function saveCareerChoice(key) {
    const db = loadDB(); db.currentCareer = key; saveDB(db);
    const ob = document.getElementById('onboarding-screen');
    if (ob) ob.classList.add('hidden');
    await selectCareer(key);
}

async function selectCareer(key) {
    appState.currentCareer = key;
    appState.pensumData = await API.get_pensum(key);
    const badge = document.getElementById('career-badge');
    const mainApp = document.getElementById('main-app');
    if (badge) badge.textContent = appState.pensumData.NOMBRE;
    if (mainApp) mainApp.classList.remove('hidden');
    actualizarVista();
    changeView(appState.currentView);
    poblarSelectsMaterias();
    switchTab('progreso');
}

function switchTab(tab) {
    ['progreso', 'kardex', 'horario', 'evaluaciones', 'calendario', 'pd'].forEach(t => {
        const sec = document.getElementById(`${t}-section`);
        if (sec) sec.classList.add('hidden');
        const el = document.getElementById(`tab-${t}`);
        if (el) el.className = 'px-5 py-3 font-bold text-slate-500 hover:text-white transition-all';
    });
    const activeSec = document.getElementById(`${tab}-section`);
    if (activeSec) activeSec.classList.remove('hidden');
    const tabEl = document.getElementById(`tab-${tab}`);
    if (tabEl) tabEl.className = 'px-5 py-3 font-bold text-blue-500 border-b-2 border-blue-500 transition-all';

    if (tab === 'kardex') setTimeout(renderKardex, 50);
    if (tab === 'progreso' && appState.currentView === 'visual') setTimeout(dibujarPrelaciones, 50);
    if (tab === 'horario') loadHorarios().then(() => { renderHorarioLista(); renderHorarioGrid(); });
    if (tab === 'calendario') loadEventos().then(() => renderCalendario());
    if (tab === 'evaluaciones') loadEvaluaciones().then(() => renderEvaluaciones());
    if (tab === 'pd') renderPDTab();
}

function changeView(v) {
    appState.currentView = v;
    ['semestres', 'pensum-visual-container', 'optimal-planner-container'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    ['list', 'visual', 'optimal'].forEach(id => {
        const btn = document.getElementById('btn-' + id);
        if (btn) btn.className = 'px-6 py-2 glass-card text-slate-400 font-bold transition-all';
    });
    const idMap = { list: 'semestres', visual: 'pensum-visual-container', optimal: 'optimal-planner-container' };
    const activeView = document.getElementById(idMap[v]);
    if (activeView) activeView.classList.remove('hidden');
    const activeBtn = document.getElementById('btn-' + v);
    if (activeBtn) activeBtn.className = 'px-6 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-lg transition-all';
    if (v === 'list') renderizarSemestres();
    if (v === 'visual') renderizarPensumVisual();
    if (v === 'optimal') renderOptimalPlan();
}

/* ===================== PROGRESO & MAPA ===================== */
function renderizarSemestres() {
    const container = document.getElementById('semestres');
    if (!container) return;
    container.innerHTML = '';
    const p = appState.pensumData.pensum;
    const credAp = p.filter(m => m.estado === 'Aprobada').reduce((a, m) => a + m.creditos, 0);
    const curSet = new Set(p.filter(m => m.estado === 'Aprobada').map(m => m.codigo));

    [...new Set(p.map(m => m.semestre))].sort((a, b) => a - b).forEach(s => {
        const html = p.filter(m => m.semestre === s).map(m => {
            const status = checkDisponibilidad(m, credAp, curSet);
            const isApproved = m.estado === 'Aprobada';
            const isCurrent = m.estado === 'En Curso';
            return `
            <div class="flex justify-between items-center p-4 border-b border-slate-800/50 transition-all ${isApproved ? 'bg-emerald-500/10' : (isCurrent ? 'bg-amber-500/10' : 'hover:bg-white/5')} cursor-pointer" onclick="openMateriaModal(${m.id})">
                <div>
                    <p class="font-bold text-slate-200 text-sm">${m.nombre}</p>
                    <p class="text-xs text-slate-500">${m.codigo} • ${m.creditos} UC • <b class="capitalize ${status === 'disponible' ? 'text-blue-400' : (isCurrent ? 'text-amber-400' : '')}">${m.estado === 'Sin Cursar' ? status : m.estado}</b></p>
                </div>
                <div class="text-xl">
                    ${isApproved ? '<i class="fas fa-check-circle text-emerald-500"></i>' : (isCurrent ? '<i class="fas fa-spinner fa-spin text-amber-400"></i>' : '<i class="fas fa-edit text-slate-600 opacity-50"></i>')}
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
    if (!cont) return;
    cont.innerHTML = '';
    const p = appState.pensumData.pensum;
    const credAp = p.filter(m => m.estado === 'Aprobada').reduce((a, m) => a + m.creditos, 0);
    const curSet = new Set(p.filter(m => m.estado === 'Aprobada').map(m => m.codigo));

    [...new Set(p.map(m => m.semestre))].sort((a, b) => a - b).forEach(s => {
        const sBlq = document.createElement('div');
        sBlq.className = 'w-full mb-12 flex flex-col items-center relative z-10';
        sBlq.innerHTML = `<h3 class="glass-card bg-blue-500/10 border-blue-500/30 text-blue-400 font-black px-6 py-1.5 rounded-full mb-6 shadow-lg uppercase tracking-widest text-xs">Semestre ${s}</h3>`;
        const mGr = document.createElement('div');
        mGr.className = 'flex flex-wrap justify-center gap-6';
        p.filter(m => m.semestre === s).forEach(m => {
            const status = checkDisponibilidad(m, credAp, curSet);
            let cl;
            if (m.estado === 'Aprobada') cl = 'aprobada';
            else if (m.estado === 'En Curso') cl = 'en-curso';
            else cl = status; // 'disponible' | 'bloqueada'
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
    if (!cont || !svg) return;
    svg.innerHTML = '';
    // Make SVG cover the full scrollable area of its container
    const scrollW = cont.scrollWidth;
    const scrollH = cont.scrollHeight;
    svg.setAttribute('width', scrollW);
    svg.setAttribute('height', scrollH);
    svg.style.width = scrollW + 'px';
    svg.style.height = scrollH + 'px';

    const contRect = cont.getBoundingClientRect();
    const scrollLeft = cont.scrollLeft;
    const scrollTop = cont.scrollTop;
    const p = appState.pensumData.pensum;

    p.forEach(dst => {
        const nD = document.getElementById(`nodo-${dst.codigo}`);
        if (!nD) return;
        dst.prelaciones.forEach(pr => {
            if (typeof pr !== 'string') return;
            const nO = document.getElementById(`nodo-${pr}`);
            if (!nO) return;
            const rO = nO.getBoundingClientRect();
            const rD = nD.getBoundingClientRect();
            // Convert viewport-relative coords to container-relative + scroll offset
            const x1 = rO.left + rO.width / 2 - contRect.left + scrollLeft;
            const y1 = rO.bottom - contRect.top + scrollTop;
            const x2 = rD.left + rD.width / 2 - contRect.left + scrollLeft;
            const y2 = rD.top - contRect.top + scrollTop;
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
    document.querySelectorAll('.path-line').forEach(line => {
        const from = line.getAttribute('data-from');
        const to = line.getAttribute('data-to');
        if (from === codigo || to === codigo) line.classList.add('active');
        else line.style.opacity = '0.05';
    });
}
function clearHighlights() {
    document.querySelectorAll('.path-line').forEach(line => {
        line.classList.remove('active');
        line.style.opacity = '';
    });
}

/* ===================== RUTA ÓPTIMA ===================== */
function renderOptimalPlan() {
    const container = document.getElementById('optimal-plan-results');
    if (!container || !appState.pensumData) return;
    const p = appState.pensumData.pensum;
    const aprobadas = new Set(p.filter(m => m.estado === 'Aprobada').map(m => m.codigo));
    const enCurso = new Set(p.filter(m => m.estado === 'En Curso').map(m => m.codigo));
    const credAp = p.filter(m => m.estado === 'Aprobada').reduce((a, m) => a + m.creditos, 0);

    // Build plan semester by semester
    const pendientes = p.filter(m => m.estado !== 'Aprobada' && m.estado !== 'En Curso');
    const plan = [];
    const cursadas = new Set(aprobadas);
    let credAcum = credAp;
    let semNum = 1;
    const MAX_UC = 25;
    const MAX_ITER = 20;

    while (pendientes.length > 0 && semNum <= MAX_ITER) {
        const disponibles = pendientes.filter(m => {
            return m.prelaciones.every(pr => {
                if (typeof pr === 'string') return cursadas.has(pr);
                if (typeof pr === 'object' && pr.tipo === 'creditos') return credAcum >= pr.valor;
                return true;
            });
        });
        if (disponibles.length === 0) break;
        // Prioritize by unlock weight (critical path)
        disponibles.forEach(d => { d._peso = calculateUnlockWeight(d.codigo, p); });
        disponibles.sort((a, b) => b._peso - a._peso);
        let ucSem = 0;
        const semMats = [];
        for (const m of disponibles) {
            if (ucSem + m.creditos <= MAX_UC) {
                semMats.push(m);
                ucSem += m.creditos;
                pendientes.splice(pendientes.indexOf(m), 1);
            }
        }
        semMats.forEach(m => cursadas.add(m.codigo));
        credAcum += ucSem;
        plan.push({ semNum, mats: semMats });
        semNum++;
    }

    if (plan.length === 0) {
        container.innerHTML = '<div class="text-center py-10 text-emerald-400 font-black text-lg"><i class="fas fa-graduation-cap"></i> ¡Carrera completada!</div>';
        return;
    }

    container.innerHTML = plan.map(sem => {
        const totalUC = sem.mats.reduce((a, m) => a + m.creditos, 0);
        const isCurrentSem = sem.semNum === 1;
        return `
        <div class="glass-card overflow-hidden ${isCurrentSem ? 'border-amber-500/40' : ''}">
            <div class="px-5 py-3 border-b border-slate-700 flex justify-between items-center ${isCurrentSem ? 'bg-amber-500/10' : 'bg-slate-800/50'}">
                <h3 class="font-black text-slate-300">${isCurrentSem ? '⚡ ' : ''}Semestre sugerido ${sem.semNum}</h3>
                <span class="text-xs font-bold text-slate-400">${totalUC} UC</span>
            </div>
            <div class="flex flex-wrap gap-2 p-4">
                ${sem.mats.map(m => `
                    <div class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-700 bg-white/5 cursor-pointer hover:bg-white/10 transition-all" onclick="openMateriaModal(${m.id})">
                        <span class="w-2 h-2 rounded-full ${m._peso > 3 ? 'bg-amber-400' : 'bg-blue-500'}" title="Peso crítico: ${m._peso}"></span>
                        <span class="text-xs font-bold text-slate-200">${m.nombre}</span>
                        <span class="text-[10px] text-slate-500">${m.creditos}UC</span>
                    </div>`).join('')}
            </div>
        </div>`;
    }).join('');
}

/* ===================== KARDEX & ESTADÍSTICAS ===================== */
function renderKardex() {
    let uc_insc = 0, uc_apr = 0, sum_pxu = 0;
    let pPer = {};
    const kardex = appState.pensumData.kardex_history;

    kardex.forEach(k => {
        const mBase = appState.pensumData.pensum.find(p => p.id === k.materia_id);
        if (!mBase || k.estado === 'En Curso' || k.estado === 'Sin Cursar') return;
        const m = { ...k, nombre: mBase.nombre, creditos: mBase.creditos, codigo: mBase.codigo };
        const per = m.periodo || 'Sin Período';
        if (!pPer[per]) pPer[per] = { mats: [], uc_sem: 0, pts_sem: 0 };
        pPer[per].mats.push(m);
        if (m.estado !== 'Retirada') {
            uc_insc += m.creditos;
            pPer[per].uc_sem += m.creditos;
            const pts = (m.nota || 0) * m.creditos;
            sum_pxu += pts;
            pPer[per].pts_sem += pts;
            if (m.estado === 'Aprobada') uc_apr += m.creditos;
        }
    });

    const promedioGeneral = uc_insc > 0 ? (sum_pxu / uc_insc) : 0;
    const indiceEficiencia = uc_insc > 0 ? (uc_apr / uc_insc) : 0;

    const prEl = document.getElementById('kx-promedio-gral');
    const efEl = document.getElementById('kx-eficiencia');
    const ucEl = document.getElementById('kx-uc-cursadas');
    if (prEl) prEl.textContent = promedioGeneral.toFixed(3);
    if (efEl) efEl.textContent = indiceEficiencia.toFixed(3);
    if (ucEl) ucEl.textContent = uc_insc;

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
                            <span class="font-bold ${m.estado === 'Aprobada' ? 'text-emerald-400' : (m.estado === 'Retirada' ? 'text-slate-600' : 'text-red-400')}">${m.nota !== null ? m.nota : m.estado}</span>
                        </div>`).join('')}
                </div>
            </div>`;
    });
    const kt = document.getElementById('kardex-table');
    if (kt) kt.innerHTML = html || '<p class="col-span-full text-center py-10 text-slate-500">No hay datos de kárdex.</p>';
    renderKardexChart(pPer, promedioGeneral, indiceEficiencia);
}

function renderKardexChart(pPer, promedioGeneral, indiceEficiencia) {
    const ctx = document.getElementById('kardexChart');
    if (!ctx) return;
    if (appState.kardexChartInstance) appState.kardexChartInstance.destroy();
    const labels = Object.keys(pPer).sort();
    const dataProm = labels.map(p => pPer[p].uc_sem > 0 ? (pPer[p].pts_sem / pPer[p].uc_sem) : 0);

    // Cumulative average line
    let cumPts = 0, cumUC = 0;
    const dataCumAvg = labels.map(p => {
        cumPts += pPer[p].pts_sem;
        cumUC += pPer[p].uc_sem;
        return cumUC > 0 ? +(cumPts / cumUC).toFixed(3) : 0;
    });

    // Efficiency per-semester (aprob UC / insc UC) * 20 for same scale
    let cumInsc = 0, cumApr = 0;
    const dataEff = labels.map(p => {
        cumInsc += pPer[p].uc_sem;
        cumApr += pPer[p].mats.filter(m => m.estado === 'Aprobada').reduce((a, m2) => a + m2.creditos, 0);
        return cumInsc > 0 ? +((cumApr / cumInsc) * 20).toFixed(3) : 0;
    });

    appState.kardexChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Promedio Semestral', data: dataProm, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, pointRadius: 4 },
                { label: 'Promedio Acumulado', data: dataCumAvg, borderColor: '#f59e0b', backgroundColor: 'transparent', borderDash: [6, 3], tension: 0.3, pointRadius: 3 },
                { label: 'Índice Eficiencia ×20', data: dataEff, borderColor: '#10b981', backgroundColor: 'transparent', borderDash: [3, 3], tension: 0.3, pointRadius: 3 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { min: 0, max: 20, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}` } }
            }
        }
    });
}

/* ===================== HORARIO ===================== */
async function loadHorarios() { appState.horarios = await API.get_horarios(); }
function renderHorarioLista() {
    const lista = document.getElementById('horario-lista');
    if (!lista) return;
    lista.innerHTML = appState.horarios.map(h => `
        <div class="p-3 glass-card bg-white/5 flex justify-between items-center">
            <div><p class="font-bold text-xs text-slate-200">${h.materia_nombre}</p><p class="text-[10px] text-slate-500">${h.dia} ${h.hora_inicio}-${h.hora_fin}</p></div>
            <button onclick="borrarHorario(${h.id})" class="text-red-400 hover:text-red-300"><i class="fas fa-trash"></i></button>
        </div>`).join('') || '<p class="text-xs text-slate-500 text-center">No hay clases</p>';
}

function renderHorarioGrid() {
    const container = document.getElementById('scheduleGridContainer');
    if (!container) return;
    const DIAS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    const HORA_INI = 7, HORA_FIN = 19; // 7am to 7pm
    const SLOT_H = 50; // px per hour
    const HEADER_H = 40;
    const LEFT_W = 48;

    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];
    const materiaColors = {};
    let colorIdx = 0;
    const getMateriaColor = (nombre) => {
        if (!materiaColors[nombre]) materiaColors[nombre] = colors[colorIdx++ % colors.length];
        return materiaColors[nombre];
    };

    const totalHours = HORA_FIN - HORA_INI;
    const totalH = totalHours * SLOT_H + HEADER_H;
    const colW = `calc((100% - ${LEFT_W}px) / ${DIAS.length})`;

    let html = `<div class="schedule-grid" style="position:relative;min-height:${totalH}px;">`;
    // Header
    html += `<div class="schedule-header" style="display:flex;position:sticky;top:0;z-index:20;background:rgba(15,23,42,0.95);border-bottom:1px solid rgba(255,255,255,0.1);">`;
    html += `<div style="width:${LEFT_W}px;min-width:${LEFT_W}px;"></div>`;
    DIAS.forEach(d => html += `<div style="flex:1;text-align:center;padding:10px 0;font-size:11px;font-weight:800;color:#94a3b8;letter-spacing:0.05em;">${d.toUpperCase()}</div>`);
    html += `</div>`;

    // Time slots + grid lines
    html += `<div style="display:flex;position:relative;">`;
    // Left time column
    html += `<div style="width:${LEFT_W}px;min-width:${LEFT_W}px;position:relative;">`;
    for (let h = HORA_INI; h < HORA_FIN; h++) {
        html += `<div style="height:${SLOT_H}px;display:flex;align-items:flex-start;padding-top:4px;justify-content:center;font-size:9px;color:#475569;font-weight:700;">${h}:00</div>`;
    }
    html += `</div>`;

    // Days columns
    DIAS.forEach(dia => {
        html += `<div style="flex:1;position:relative;border-left:1px solid rgba(255,255,255,0.05);">`;
        // Hour lines
        for (let h = 0; h < totalHours; h++) {
            html += `<div style="height:${SLOT_H}px;border-bottom:1px solid rgba(255,255,255,0.04);"></div>`;
        }
        // Classes
        // Normalize dia for matching
        const diaKey = dia.toLowerCase();
        const clases = appState.horarios.filter(h => {
            const hDia = (h.dia || '').toLowerCase().substring(0, 3);
            return hDia === diaKey;
        });
        clases.forEach(clase => {
            const [hIni, mIni] = clase.hora_inicio.split(':').map(Number);
            const [hFin, mFin] = clase.hora_fin.split(':').map(Number);
            const top = ((hIni - HORA_INI) + mIni / 60) * SLOT_H;
            const height = Math.max(((hFin - hIni) + (mFin - mIni) / 60) * SLOT_H - 4, 20);
            const col = getMateriaColor(clase.materia_nombre);
            html += `
                <div style="position:absolute;top:${top}px;left:2px;right:2px;height:${height}px;background:${col}33;border-left:3px solid ${col};border-radius:6px;padding:3px 5px;overflow:hidden;cursor:default;" title="${clase.materia_nombre} ${clase.hora_inicio}-${clase.hora_fin}">
                    <p style="font-size:9px;font-weight:800;color:${col};line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${clase.materia_nombre}</p>
                    <p style="font-size:8px;color:rgba(255,255,255,0.5);">${clase.hora_inicio}–${clase.hora_fin}</p>
                </div>`;
        });
        html += `</div>`;
    });
    html += `</div></div>`;
    container.innerHTML = html;
}

async function guardarHorario() {
    const m = document.getElementById('horario-materia-select').value;
    const h_ini = document.getElementById('horario-inicio').value;
    const h_fin = document.getElementById('horario-fin').value;
    const dias = Array.from(document.querySelectorAll('.dia-cb:checked')).map(cb => cb.value);
    if (!m || !h_ini || !h_fin || !dias.length) return alert("Completa los datos");
    for (let dia of dias) await API.save_horario({ materia_nombre: m, dia, hora_inicio: h_ini, hora_fin: h_fin });
    loadHorarios().then(() => { renderHorarioLista(); renderHorarioGrid(); });
}
async function borrarHorario(id) {
    if (confirm("¿Eliminar?")) { await API.delete_horario(id); loadHorarios().then(() => { renderHorarioLista(); renderHorarioGrid(); }); }
}

// ===================== EVALUACIONES =====================
async function loadEvaluaciones() { appState.evaluaciones = await API.get_evaluaciones(); }

function poblarFiltroEval() {
    if (!appState.pensumData) return;
    // ONLY show En Curso materias
    const enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
    const evalSel = document.getElementById('eval-materia');
    if (evalSel) {
        evalSel.innerHTML = '<option value="">-- Seleccionar materia --</option>' +
            enCurso.map(m => `<option value="${m.nombre}">${m.nombre}</option>`).join('');
    }
    const filtro = document.getElementById('eval-filtro-materia');
    if (filtro) {
        filtro.innerHTML = '<option value="">— Todas las materias en curso —</option>' +
            enCurso.map(m => `<option value="${m.nombre}">${m.nombre}</option>`).join('');
    }
}

function renderEvaluaciones() {
    poblarFiltroEval();
    const filtro = document.getElementById('eval-filtro-materia');
    const filtroVal = filtro ? filtro.value : '';

    // Filter evals: only En Curso materias (or all if filter not set)
    const enCurso = appState.pensumData
        ? new Set(appState.pensumData.pensum.filter(m => m.estado === 'En Curso').map(m => m.nombre))
        : new Set();

    let evs = (appState.evaluaciones || []).filter(e => enCurso.has(e.materia));
    if (filtroVal) evs = evs.filter(e => e.materia === filtroVal);

    // Sort by fecha
    const sorted = [...evs].sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999'));

    const tabla = document.getElementById('evaluaciones-tabla');
    if (!tabla) return;
    if (!sorted.length) {
        tabla.innerHTML = '<p class="text-slate-500 text-center py-10 text-sm">Sin evaluaciones. Agrega las evaluaciones de tus materias en curso.</p>';
        renderResumenEval(evs);
        return;
    }

    const hoy = new Date().toISOString().slice(0, 10);

    tabla.innerHTML = `
        <table class="w-full text-sm">
            <thead>
                <tr class="border-b border-slate-700">
                    <th class="text-left py-2 px-3 text-xs text-slate-400 font-black">Materia</th>
                    <th class="text-left py-2 px-3 text-xs text-slate-400 font-black">Evaluación</th>
                    <th class="text-center py-2 px-3 text-xs text-slate-400 font-black">Fecha</th>
                    <th class="text-center py-2 px-3 text-xs text-slate-400 font-black">Peso</th>
                    <th class="text-center py-2 px-3 text-xs text-slate-400 font-black">Nota</th>
                    <th class="text-center py-2 px-3 text-xs text-slate-400 font-black">Aporta</th>
                    <th class="text-center py-2 px-3 text-xs text-slate-400 font-black"></th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/50">
                ${sorted.map(e => {
        const aporte = (e.nota !== null && e.nota !== undefined && e.peso)
            ? ((e.nota * e.peso) / 100).toFixed(2) : '—';
        const esPasada = e.fecha && e.fecha < hoy;
        const sinNota = e.nota === null || e.nota === undefined;
        return `
                    <tr class="hover:bg-white/5 transition-all ${sinNota && esPasada ? 'bg-red-500/5' : ''}">
                        <td class="py-2 px-3 text-slate-300 text-xs font-bold">${e.materia}</td>
                        <td class="py-2 px-3 text-slate-200 text-xs">${e.nombre}</td>
                        <td class="py-2 px-3 text-center text-xs ${esPasada ? 'text-slate-600' : 'text-amber-400 font-bold'}">${e.fecha || '—'}</td>
                        <td class="py-2 px-3 text-center text-xs text-slate-400">${e.peso ? e.peso + '%' : '—'}</td>
                        <td class="py-2 px-3 text-center text-xs">
                            ${sinNota
                ? `<button onclick="abrirModalNota(${e.id})" class="px-2 py-0.5 text-[10px] font-bold bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/40 transition-all">+ Nota</button>`
                : `<span class="font-bold ${e.nota >= 10 ? 'text-emerald-400' : 'text-red-400'}">${e.nota}</span>`
            }
                        </td>
                        <td class="py-2 px-3 text-center text-xs text-blue-400 font-bold">${aporte}</td>
                        <td class="py-2 px-3 text-center">
                            <button onclick="borrarEvaluacion(${e.id})" class="text-red-400/40 hover:text-red-400 transition-all"><i class="fas fa-times text-xs"></i></button>
                        </td>
                    </tr>`;
    }).join('')}
            </tbody>
        </table>`;
    renderResumenEval(evs);
}

function abrirModalNota(evalId) {
    const existing = document.getElementById('modal-nota-eval');
    if (existing) existing.remove();
    const e = appState.evaluaciones.find(x => x.id === evalId);
    if (!e) return;
    const modal = document.createElement('div');
    modal.id = 'modal-nota-eval';
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4';
    modal.innerHTML = `
        <div class="glass-card p-8 w-full max-w-sm">
            <h3 class="font-black text-xl mb-1">${e.nombre}</h3>
            <p class="text-slate-400 text-sm mb-6">${e.materia} ${e.peso ? '• ' + e.peso + '%' : ''}</p>
            <label class="block text-xs font-bold text-slate-400 uppercase mb-2">¿Qué nota sacaste? (0-20)</label>
            <input type="number" id="input-nota-modal" class="w-full p-4 bg-slate-800 border-2 border-blue-500/50 rounded-xl font-black text-2xl text-center mb-6" min="0" max="20" step="0.1" autofocus placeholder="0 – 20">
            <div class="flex gap-3">
                <button onclick="document.getElementById('modal-nota-eval').remove()" class="w-1/2 py-3 glass-card font-bold text-sm">Cancelar</button>
                <button onclick="guardarNotaEval(${evalId})" class="w-1/2 py-3 bg-blue-600 hover:bg-blue-500 font-black rounded-xl text-white transition-all">Guardar</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    document.getElementById('input-nota-modal').focus();
}

async function guardarNotaEval(evalId) {
    const notaInput = document.getElementById('input-nota-modal');
    if (!notaInput) return;
    const nota = parseFloat(notaInput.value);
    if (isNaN(nota) || nota < 0 || nota > 20) return alert('Nota inválida (0-20)');
    const db = loadDB();
    const ev = (db.evaluaciones || []).find(x => x.id === evalId);
    if (ev) { ev.nota = nota; saveDB(db); }
    document.getElementById('modal-nota-eval').remove();
    await loadEvaluaciones();
    renderEvaluaciones();
}

function renderResumenEval(evs) {
    const el = document.getElementById('eval-resumen');
    if (!el) return;
    if (!evs || !evs.length) { el.innerHTML = '<span class="text-slate-500 text-xs">Sin evaluaciones</span>'; return; }
    const byMat = {};
    evs.forEach(e => {
        if (!byMat[e.materia]) byMat[e.materia] = [];
        byMat[e.materia].push(e);
    });
    el.innerHTML = Object.entries(byMat).map(([mat, evals]) => {
        const withNota = evals.filter(e => e.nota !== null && e.nota !== undefined && e.peso);
        const nota_pond = withNota.reduce((a, e) => a + (e.nota * e.peso / 100), 0);
        const peso_acum = evals.filter(e => e.peso).reduce((a, e) => a + e.peso, 0);
        const pending = evals.filter(e => e.nota === null || e.nota === undefined).length;
        return `
            <div class="p-3 bg-white/5 rounded-xl mb-2">
                <p class="font-bold text-slate-300 text-xs truncate mb-1">${mat}</p>
                <div class="flex justify-between text-[10px] text-slate-500">
                    <span>${evals.length} eval${evals.length > 1 ? 'es' : ''} • ${peso_acum}% cubierto</span>
                    ${pending > 0 ? `<span class="text-amber-400 font-bold">${pending} pendiente${pending > 1 ? 's' : ''}</span>` : '<span class="text-emerald-400 font-bold">Completo</span>'}
                </div>
                ${nota_pond > 0 ? `
                    <div class="mt-2">
                        <div class="flex justify-between text-[10px] mb-1">
                            <span class="text-slate-500">Acumulado</span>
                            <span class="font-black text-blue-400">${nota_pond.toFixed(2)} pts</span>
                        </div>
                        <div class="w-full bg-slate-800 rounded-full h-1.5">
                            <div class="h-1.5 rounded-full ${nota_pond / 20 * 100 >= 50 ? 'bg-emerald-500' : 'bg-red-500'}" style="width:${Math.min(nota_pond / 20 * 100, 100)}%"></div>
                        </div>
                    </div>` : ''}
            </div>`;
    }).join('');
}

async function guardarEvaluacion() {
    const materia = document.getElementById('eval-materia').value;
    const nombre = document.getElementById('eval-nombre').value.trim();
    const fecha = document.getElementById('eval-fecha').value;
    const peso = parseFloat(document.getElementById('eval-peso').value) || null;
    if (!materia || !nombre) return alert('Selecciona materia y nombre de la evaluación');
    await API.save_evaluacion({ materia, nombre, fecha, peso, nota: null });
    // Also add to calendar if fecha is set
    if (fecha) {
        await API.save_evento({ titulo: `📝 ${nombre} — ${materia}`, fecha, color: '#ec4899' });
    }
    document.getElementById('eval-nombre').value = '';
    document.getElementById('eval-fecha').value = '';
    document.getElementById('eval-peso').value = '';
    await loadEvaluaciones();
    renderEvaluaciones();
    // Refresh calendar if open
    if (appState.eventos) { await loadEventos(); }
}

async function borrarEvaluacion(id) {
    if (confirm('¿Eliminar esta evaluación?')) {
        await API.delete_evaluacion(id);
        await loadEvaluaciones();
        renderEvaluaciones();
    }
}

/* ===================== CALENDARIO ===================== */
async function loadEventos() { appState.eventos = await API.get_eventos(); }
function cambiarMes(o) { appState.currentDate.setMonth(appState.currentDate.getMonth() + o); renderCalendario(); }
function renderCalendario() {
    const grid = document.getElementById('calendario-grid');
    if (!grid) return;
    const y = appState.currentDate.getFullYear(), m = appState.currentDate.getMonth();
    const md = document.getElementById('mes-anio-display');
    if (md) md.textContent = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(appState.currentDate);
    grid.innerHTML = '';
    const firstDay = new Date(y, m, 1).getDay(); // 0=Sunday
    for (let i = 0; i < firstDay; i++) grid.innerHTML += '<div class="h-20 bg-slate-900/30 rounded"></div>';
    const today = new Date().toISOString().slice(0, 10);
    for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
        const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const evs = appState.eventos.filter(e => e.fecha === ds);
        const isToday = ds === today;
        grid.innerHTML += `
            <div class="h-20 p-1 border-t border-slate-700/50 relative ${isToday ? 'bg-blue-500/10 border-blue-500/40' : ''}">
                <span class="text-[10px] font-bold ${isToday ? 'text-blue-400 bg-blue-500/20 px-1 rounded' : 'text-slate-500'}">${d}</span>
                <div class="space-y-0.5 mt-1">
                    ${evs.map(e => `<div class="text-[8px] px-1 py-0.5 rounded truncate font-bold" style="background:${e.color || '#3b82f6'}33;color:${e.color || '#60a5fa'}">${e.titulo}</div>`).join('')}
                </div>
            </div>`;
    }
    renderProximosEventos();
}

function renderProximosEventos() {
    const el = document.getElementById('proximos-eventos');
    if (!el) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const proximos = appState.eventos
        .filter(e => e.fecha >= hoy)
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .slice(0, 5);
    if (!proximos.length) { el.innerHTML = '<span class="text-slate-600">Sin próximos eventos</span>'; return; }
    el.innerHTML = proximos.map(e => {
        const fecha = new Date(e.fecha + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
        return `<div class="flex items-start gap-2 p-2 rounded-lg bg-white/5">
            <div class="w-8 h-8 rounded-lg flex flex-col items-center justify-center text-center shrink-0" style="background:${e.color || '#3b82f6'}33;color:${e.color || '#60a5fa'}">
                <span class="text-[8px] font-black leading-tight">${fecha.split(' ')[0]}</span>
                <span class="text-[7px] uppercase">${fecha.split(' ')[1] || ''}</span>
            </div>
            <span class="text-[10px] text-slate-300 font-bold leading-tight mt-1">${e.titulo}</span>
        </div>`;
    }).join('');
}

/* ===================== PD TAB ===================== */
// mwikicpd.ing.ucv.ve URL maps by career key
const PD_URLS = {
    MEC: [
        { label: 'Dpto. Automática', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Mecanica/Mecanica_auto.pdf' },
        { label: 'Dpto. Diseño', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Mecanica/Mecanica_dise.pdf' },
        { label: 'Dpto. Energética', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Mecanica/Mecanica_ener.pdf' },
        { label: 'Dpto. Producción', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Mecanica/Mecanica_tecno.pdf' },
    ],
    QUIM: [
        { label: 'Dpto. Termodinámica', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Quimica/Quimica_termo.pdf' },
        { label: 'Dpto. Diseño y CP', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Quimica/Quimica_dise.pdf' },
    ],
    PET: [
        { label: 'Dpto. Perforación', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Petroleo/Petroleo_perfo.pdf' },
        { label: 'Dpto. Subsuelo', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Petroleo/Petroleo_subs.pdf' },
    ],
    GMG: [
        { label: 'Dpto. Geología', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/GMG/GMG_Geologia.pdf' },
        { label: 'Dpto. Minas', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/GMG/GMG_Minas.pdf' },
    ],
    META: [
        { label: 'Dpto. Meta-Física', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Metalurgia/Metalurgia_Fisica.pdf' },
        { label: 'Dpto. Meta-Química', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Metalurgia/Metalurgia_Quimica.pdf' },
    ],
    PROC: [
        { label: 'Proc-Industriales', url: 'http://mwikicpd.ing.ucv.ve/pd/PD/Procesos/Procesos.pdf' },
    ],
};

// Detect career key from current career name
function detectPDCareer() {
    const nombre = (appState.pensumData?.NOMBRE || '').toLowerCase();
    if (nombre.includes('mecán') || nombre.includes('mecani')) return 'MEC';
    if (nombre.includes('quím') || nombre.includes('quimi')) return 'QUIM';
    if (nombre.includes('petró') || nombre.includes('petro')) return 'PET';
    if (nombre.includes('geol') || nombre.includes('minas')) return 'GMG';
    if (nombre.includes('metal')) return 'META';
    if (nombre.includes('proc')) return 'PROC';
    return null;
}

function renderPDTab() {
    // Show materias en curso
    const elCurso = document.getElementById('pd-materias-curso');
    if (elCurso && appState.pensumData) {
        const enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
        if (!enCurso.length) {
            elCurso.innerHTML = '<span class="text-slate-600 text-xs">Sin materias en curso</span>';
        } else {
            elCurso.innerHTML = enCurso.map(m => `
                <div class="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <i class="fas fa-spinner fa-spin text-amber-400 text-[10px]"></i>
                    <span class="font-bold text-amber-300 text-xs">${m.nombre}</span>
                    <span class="text-slate-500 text-[10px] ml-auto">${m.creditos}UC</span>
                </div>`).join('');
        }
    }
    // Render dept buttons
    const careerKey = detectPDCareer();
    const depts = PD_URLS[careerKey] || [];
    const elDepts = document.getElementById('pd-dept-btns');
    if (elDepts) {
        if (!depts.length) {
            elDepts.innerHTML = '<p class="text-xs text-slate-500">No hay departamentos configurados para tu carrera.</p>';
        } else {
            elDepts.innerHTML = depts.map(d => `
                <button onclick="cargarPDDept('${d.url}', '${d.label}')" class="flex items-center gap-2 w-full text-left px-3 py-2 rounded-xl bg-white/5 hover:bg-blue-500/20 border border-white/5 hover:border-blue-500/30 text-xs font-bold text-slate-300 hover:text-white transition-all">
                    <i class="fas fa-file-pdf text-red-400"></i> ${d.label}
                </button>`).join('');
        }
    }
}

async function cargarPDDept(url, label) {
    const statusEl = document.getElementById('pd-parse-status');
    const resultsEl = document.getElementById('pd-resultados');
    if (statusEl) statusEl.innerHTML = `<div class="flex items-center gap-2 text-blue-400 text-xs font-bold animate-pulse"><i class="fas fa-spinner fa-spin"></i> Cargando ${label}...</div>`;
    if (resultsEl) resultsEl.innerHTML = '';
    const resultados = await fetchPDFromMwiki(url, (msg, cls) => {
        if (statusEl) statusEl.innerHTML = `<div class="text-xs ${cls || ''}">${msg}</div>`;
    });
    if (!resultados.length) {
        if (resultsEl) resultsEl.innerHTML = '<p class="text-slate-500 text-xs text-center py-8">No se encontraron secciones. Intenta importar el PDF manualmente.</p>';
        return;
    }
    if (statusEl) statusEl.innerHTML = `<div class="text-emerald-400 text-xs font-bold">✅ ${resultados.length} secciones encontradas</div>`;
    renderPDResultados(resultados);
}

function renderPDResultados(secciones) {
    const el = document.getElementById('pd-resultados');
    if (!el) return;
    // Group by materia
    const byMat = {};
    secciones.forEach(s => {
        if (!byMat[s.materia]) byMat[s.materia] = [];
        byMat[s.materia].push(s);
    });
    // Find which materias are En Curso
    const enCursoNombres = appState.pensumData
        ? new Set(appState.pensumData.pensum.filter(m => m.estado === 'En Curso').map(m => m.nombre.toLowerCase()))
        : new Set();

    el.innerHTML = Object.entries(byMat).map(([mat, secs]) => {
        const isEnCurso = [...enCursoNombres].some(n => mat.toLowerCase().includes(n.substring(0, 8)));
        return `
        <div class="glass-card overflow-hidden mb-3 ${isEnCurso ? 'border-amber-500/40' : ''}">
            <div class="px-4 py-2 flex items-center gap-2 border-b border-slate-700 ${isEnCurso ? 'bg-amber-500/10' : 'bg-slate-800/50'}">
                <span class="font-black text-sm text-slate-300">${mat}</span>
                ${isEnCurso ? '<span class="text-[10px] font-bold text-amber-400 bg-amber-500/20 px-2 rounded">En Curso</span>' : ''}
            </div>
            <div class="p-3 flex flex-wrap gap-2">
                ${secs.map(s => `
                    <button onclick="agregarSeccionHorario('${s.materia}', '${s.seccion}', '${s.horario}')" class="px-3 py-2 rounded-xl bg-white/5 hover:bg-blue-500/20 border border-white/5 hover:border-blue-500/30 transition-all text-left">
                        <p class="text-xs font-black text-slate-200">Sec. ${s.seccion}</p>
                        <p class="text-[10px] text-slate-500 font-mono">${s.horario}</p>
                    </button>`).join('')}
            </div>
        </div>`;
    }).join('');
}

async function agregarSeccionHorario(materia, seccion, horario) {
    // Parse horario string like "L7-9 J7-9" or "L14-16 X14-16"
    const DIA_MAP = { L: 'Lun', M: 'Mar', I: 'Mar', X: 'Mie', J: 'Jue', V: 'Vie', S: 'Sab' };
    const parts = horario.split(/\s+/);
    for (const part of parts) {
        const m = part.match(/^([LMIXJVS])(\d{1,2})(?:-(\d{1,2}))?/);
        if (!m) continue;
        const dia = DIA_MAP[m[1]] || m[1];
        const hIni = String(parseInt(m[2])).padStart(2, '0') + ':00';
        const hFin = m[3] ? String(parseInt(m[3])).padStart(2, '0') + ':00' : String(parseInt(m[2]) + 2).padStart(2, '0') + ':00';
        await API.save_horario({ materia_nombre: `${materia} (S.${seccion})`, dia, hora_inicio: hIni, hora_fin: hFin });
    }
    alert(`✅ Sección ${seccion} agregada al horario`);
    await loadHorarios();
}

/* ===================== PARSERS ===================== */
async function parsePDF(type, mode) {
    const fileInput = document.getElementById(`${type}-file`);
    const statusEl = document.getElementById(`${type}-parse-status`);
    if (!fileInput || !fileInput.files[0]) return alert("Sube un archivo");
    if (statusEl) statusEl.innerHTML = '<div class="flex items-center gap-2 text-blue-400 font-bold animate-pulse"><i class="fas fa-spinner fa-spin"></i> Procesando...</div>';
    try {
        const results = await parsePDFMultiMode(fileInput.files[0], type, mode, {}, (msg, cls) => {
            if (statusEl) statusEl.innerHTML = `<div class="${cls || ''}">${msg}</div>`;
        });
        if (type === 'kardex') {
            for (let m of results) {
                const mat = appState.pensumData.pensum.find(x => x.codigo === m.codigo);
                if (mat) await API.save_progreso(appState.currentCareer, mat.id, m.estado, m.nota, m.periodo);
            }
            appState.pensumData = await API.get_pensum(appState.currentCareer);
            actualizarVista(); renderKardex();
            if (statusEl) statusEl.innerHTML = `<div class="text-emerald-400 font-bold">✅ ${results.length} materias importadas</div>`;
        }
        if (type === 'calendario') {
            for (let e of results) await API.save_evento(e);
            await loadEventos(); renderCalendario();
            if (statusEl) statusEl.innerHTML = `<div class="text-emerald-400 font-bold">✅ ${results.length} eventos importados</div>`;
        }
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<div class="text-red-400 font-bold">❌ Error: ${e.message}</div>`;
    }
}

function openMateriaModal(id) {
    const m = appState.pensumData.pensum.find(x => x.id === id);
    if (!m) return;
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
    if (appState.currentView === 'list') renderizarSemestres();
    else if (appState.currentView === 'visual') renderizarPensumVisual();
    else if (appState.currentView === 'optimal') renderOptimalPlan();
    poblarSelectsMaterias();
}

function actualizarVista() {
    if (!appState.pensumData) return;
    const p = appState.pensumData.pensum;
    const cAp = p.filter(m => m.estado === 'Aprobada').reduce((a, m) => a + m.creditos, 0);
    const crEl = document.getElementById('creditos-aprobados');
    if (crEl) crEl.textContent = cAp;
    const prog = (cAp / appState.pensumData.TOTAL_CREDITOS_CARRERA) * 100;
    const pb = document.getElementById('progressBar');
    const pp = document.getElementById('progress-percent');
    if (pb) pb.style.width = `${prog}%`;
    if (pp) pp.textContent = `${prog.toFixed(1)}%`;
    const curSet = new Set(p.filter(m => m.estado === 'Aprobada').map(m => m.codigo));
    const disp = p.filter(m => m.estado === 'Sin Cursar' && checkDisponibilidad(m, cAp, curSet) === 'disponible');
    disp.forEach(d => { d.peso = calculateUnlockWeight(d.codigo, p); });
    disp.sort((a, b) => b.peso - a.peso);
    const dl = document.getElementById('materias-disponibles-lista');
    if (dl) dl.innerHTML = disp.map(m => `
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

function poblarSelectsMaterias() {
    if (!appState.pensumData) return;
    const enCurso = appState.pensumData.pensum.filter(m => m.estado === 'En Curso');
    const todasOpts = enCurso.map(m => `<option value="${m.nombre}">${m.nombre}</option>`).join('') + '<option value="MANUAL">-- Otro --</option>';
    const sel = document.getElementById('horario-materia-select');
    if (sel) sel.innerHTML = todasOpts;
    const evalSel = document.getElementById('eval-materia');
    if (evalSel) {
        const todasParaEval = [...enCurso, ...appState.pensumData.pensum.filter(m => m.estado === 'Sin Cursar')];
        evalSel.innerHTML = '<option value="">-- Seleccionar --</option>' +
            appState.pensumData.pensum.map(m => `<option value="${m.nombre}">${m.nombre}</option>`).join('');
    }
}

/* ===================== DB ===================== */
function loadDB() {
    try {
        const data = localStorage.getItem('ucv_db_native');
        if (data) {
            const parsed = JSON.parse(data);
            if (!parsed.evaluaciones) parsed.evaluaciones = [];
            return parsed;
        }
        return { currentCareer: null, progreso: {}, eventos: [], horarios: [], kardex_history: {}, evaluaciones: [] };
    } catch (e) {
        console.error("DB Load error", e);
        return { currentCareer: null, progreso: {}, eventos: [], horarios: [], kardex_history: {}, evaluaciones: [] };
    }
}
function saveDB(db) { localStorage.setItem('ucv_db_native', JSON.stringify(db)); }
