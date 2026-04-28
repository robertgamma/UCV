// Manejo de Base de Datos Local (localStorage)
const DB_KEY = 'UCV_App_State';

function loadDB() {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) {
        const initial = { currentUser: null, users: {}, oferta_pd: {} };
        localStorage.setItem(DB_KEY, JSON.stringify(initial));
        return initial;
    }
    return JSON.parse(raw);
}

function saveDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function getUser() {
    const db = loadDB();
    return { db, user: db.users[db.currentUser] };
}

const API = {
    me: async () => {
        const db = loadDB();
        if (db.currentUser && db.users[db.currentUser]) {
            const u = db.users[db.currentUser];
            return { logged_in: true, username: db.currentUser, carrera_id: u.currentCareer, api_key: u.geminiApiKey };
        }
        return { logged_in: false };
    },
    login: async (username, password) => {
        const db = loadDB();
        if (db.users[username] && db.users[username].password === password) {
            db.currentUser = username; saveDB(db);
            return { success: true };
        }
        return { error: 'Usuario o contraseña incorrectos' };
    },
    register: async (username, password) => {
        const db = loadDB();
        if (db.users[username]) return { error: 'Usuario ya existe' };
        db.users[username] = {
            password, currentCareer: null, geminiApiKey: '',
            progreso: [], horarios: [], eventos: [], evaluaciones: [], semanas: []
        };
        db.currentUser = username; saveDB(db);
        return { success: true };
    },
    logout: async () => { const db = loadDB(); db.currentUser = null; saveDB(db); return { success: true }; },
    set_carrera: async (carrera_id) => {
        const { db, user } = getUser();
        if (user) { user.currentCareer = carrera_id; saveDB(db); }
        return { success: true };
    },
    set_api_key: async (api_key) => {
        const { db, user } = getUser();
        if (user) { user.geminiApiKey = api_key; saveDB(db); }
        return { success: true };
    },
    get_pensum: async (carrera_id) => {
        const base = PENSUMS_DATA[carrera_id]; if (!base) return null;
        const { user } = getUser();
        if (!user) return null;
        const history = user.progreso.filter(p => p.carrera_id === carrera_id);
        const mergedPensum = base.pensum.map(m => {
            const h = history.find(x => x.materia_id === m.id);
            return { ...m, cursada: !!h, estado: h ? h.estado : 'Sin Cursar', nota: h ? h.nota : null, periodo: h ? h.periodo : null };
        });
        return { ...base, pensum: mergedPensum, kardex_history: history };
    },
    save_progreso: async (carrera_id, materia_id, estado, nota, periodo) => {
        const { db, user } = getUser();
        const idx = user.progreso.findIndex(p => p.carrera_id === carrera_id && p.materia_id === materia_id);
        if (estado === 'Sin Cursar') { if (idx > -1) user.progreso.splice(idx, 1); }
        else {
            const entry = { carrera_id, materia_id, estado, nota, periodo };
            if (idx > -1) user.progreso[idx] = entry; else user.progreso.push(entry);
        }
        saveDB(db); return { success: true };
    },
    get_horarios: async (carrera_id) => { const { user } = getUser(); return (user?.horarios || []).filter(h => h.carrera_id === carrera_id); },
    save_horario: async (item) => {
        const { db, user } = getUser();
        item.id = Date.now() + Math.floor(Math.random() * 1000);
        user.horarios.push(item); saveDB(db); return { success: true };
    },
    delete_horario: async (id) => {
        const { db, user } = getUser();
        user.horarios = user.horarios.filter(h => h.id !== id); saveDB(db); return { success: true };
    },
    get_eventos: async () => { const { user } = getUser(); return user?.eventos || []; },
    save_evento: async (item) => {
        const { db, user } = getUser();
        item.id = Date.now() + Math.floor(Math.random() * 1000);
        user.eventos.push(item); saveDB(db); return { success: true };
    },
    delete_evento: async (id) => {
        const { db, user } = getUser();
        user.eventos = user.eventos.filter(h => h.id !== id); saveDB(db); return { success: true };
    },
    get_evaluaciones: async (carrera_id) => { const { user } = getUser(); return (user?.evaluaciones || []).filter(e => e.carrera_id === carrera_id); },
    save_evaluacion: async (item) => {
        const { db, user } = getUser();
        if (!user.evaluaciones) user.evaluaciones = [];
        item.id = Date.now() + Math.floor(Math.random() * 1000);
        user.evaluaciones.push(item);
        // Auto-create linked calendar event
        if (item.fecha) {
            user.eventos.push({
                id: Date.now() + Math.floor(Math.random() * 1000) + 1,
                fecha: item.fecha,
                titulo: `📝 ${item.titulo} · ${item.materia_nombre}`,
                color: '#3b82f6',
                evaluacion_id: item.id  // link back for grade entry
            });
        }
        saveDB(db); return { success: true, id: item.id };
    },
    update_evaluacion_nota: async (id, nota) => {
        const { db, user } = getUser();
        const ev = user.evaluaciones.find(e => e.id === id);
        if (ev) { ev.nota = nota; saveDB(db); }
        return { success: true };
    },
    delete_evaluacion: async (id) => {
        const { db, user } = getUser();
        user.evaluaciones = user.evaluaciones.filter(h => h.id !== id);
        // Remove linked calendar event too
        user.eventos = user.eventos.filter(e => e.evaluacion_id !== id);
        saveDB(db); return { success: true };
    },
    get_oferta: async (carrera_id, codigo_materia) => {
        const db = loadDB();
        if (!db.oferta_pd[carrera_id]) return [];
        return db.oferta_pd[carrera_id].filter(o => o.codigo === codigo_materia);
    },
    save_oferta_bulk: async (carrera_id, secciones) => {
        const db = loadDB(); db.oferta_pd[carrera_id] = secciones; saveDB(db); return { success: true };
    },
    // ---- SEMANAS (Programacion Semanal) ----
    get_semanas: async (carrera_id) => {
        const { user } = getUser();
        if (!user.semanas) return [];
        return user.semanas.filter(s => s.carrera_id === carrera_id);
    },
    save_semana: async (item) => {
        const { db, user } = getUser();
        if (!user.semanas) user.semanas = [];
        item.id = Date.now() + Math.floor(Math.random() * 1000);
        user.semanas.push(item);
        // Add to calendar if has fecha
        if (item.fecha) {
            user.eventos.push({
                id: Date.now() + Math.floor(Math.random() * 1000) + 2,
                fecha: item.fecha,
                titulo: `📅 Sem ${item.numero}: ${item.tema || item.materia}`,
                color: '#7c3aed',
                semana_id: item.id
            });
        }
        saveDB(db); return { success: true, id: item.id };
    },
    update_semana: async (id, fields) => {
        const { db, user } = getUser();
        if (!user.semanas) return { success: false };
        const idx = user.semanas.findIndex(s => s.id === id);
        if (idx > -1) {
            Object.assign(user.semanas[idx], fields);
            // Update linked calendar event
            const evIdx = user.eventos.findIndex(e => e.semana_id === id);
            if (evIdx > -1) {
                user.eventos[evIdx].titulo = `📅 Sem ${user.semanas[idx].numero}: ${fields.tema || user.semanas[idx].tema || ''}`;
                if (fields.fecha) user.eventos[evIdx].fecha = fields.fecha;
            }
            saveDB(db);
        }
        return { success: true };
    },
    delete_semana: async (id) => {
        const { db, user } = getUser();
        if (!user.semanas) return { success: false };
        user.semanas = user.semanas.filter(s => s.id !== id);
        user.eventos = user.eventos.filter(e => e.semana_id !== id);
        saveDB(db); return { success: true };
    },
    save_semanas_bulk: async (carrera_id, semanas) => {
        const { db, user } = getUser();
        if (!user.semanas) user.semanas = [];
        // Remove old ones for this career
        user.semanas = user.semanas.filter(s => s.carrera_id !== carrera_id);
        user.eventos = user.eventos.filter(e => !e.semana_id);
        semanas.forEach(s => {
            s.carrera_id = carrera_id;
            s.id = Date.now() + Math.floor(Math.random() * 9999);
            user.semanas.push(s);
            if (s.fecha) {
                user.eventos.push({
                    id: Date.now() + Math.floor(Math.random() * 9999) + 1,
                    fecha: s.fecha,
                    titulo: `📅 Sem ${s.numero}: ${s.tema || ''}`,
                    color: '#7c3aed',
                    semana_id: s.id
                });
            }
        });
        saveDB(db); return { success: true };
    },
    exportDB: () => {
        return localStorage.getItem(DB_KEY);
    },
    importDB: (json) => {
        try {
            const data = JSON.parse(json);
            // Basic validation
            if (data && data.users) {
                localStorage.setItem(DB_KEY, json);
                return { success: true };
            }
            return { success: false, error: 'Formato de archivo inválido' };
        } catch (e) {
            return { success: false, error: 'Error al procesar el archivo' };
        }
    }
};
