/**
 * parsers.js — UCV Planner v10.1.0
 * Parsers: Regex offline | OCR Tesseract | Gemini IA
 */

// ===================== UTILS =====================
function timeUCVtoHHMM(raw) {
    if (!raw) return null;
    raw = raw.trim();
    let m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (m) {
        let h1 = parseInt(m[1]), h2 = parseInt(m[3]);
        const min1 = m[2] || '00', min2 = m[4] || '00';
        const mer = (m[5] || '').toLowerCase();
        if (mer === 'pm' && h1 < 12) h1 += 12;
        if (mer === 'pm' && h2 < 12) h2 += 12;
        if (mer === 'am' && h1 === 12) h1 = 0;
        if (mer === 'am' && h2 === 12) h2 = 0;
        if (!mer) { if (h1 < 7) h1 += 12; if (h2 < 7) h2 += 12; }
        return [`${String(h1).padStart(2, '0')}:${min1}`, `${String(h2).padStart(2, '0')}:${min2}`];
    }
    return null;
}

// Convierte fecha en formatos DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY a ISO
function fecha2ISO(raw) {
    if (!raw) return null;
    raw = raw.trim();
    // DD/MM/YYYY or DD-MM-YYYY
    let m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (m) {
        let y = parseInt(m[3]);
        if (y < 100) y += 2000;
        return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    }
    // DD/MM (no year) — assume current or next year
    m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})$/);
    if (m) {
        const now = new Date();
        const y = now.getFullYear();
        const mes = String(m[2]).padStart(2, '0');
        const dia = String(m[1]).padStart(2, '0');
        return `${y}-${mes}-${dia}`;
    }
    return null;
}

// Spanish month names → number
const MESES_ES = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12
};

function mesNombreANum(nombre) {
    return MESES_ES[(nombre || '').toLowerCase().trim()] || null;
}

// "15 de enero de 2026" → "2026-01-15"
function fechaLargaToISO(raw, defaultYear) {
    if (!raw) return null;
    const m = raw.match(/(\d{1,2})\s+(?:de\s+)?([a-záéíóúüñ]+)(?:\s+(?:de\s+)?(\d{4}))?/i);
    if (!m) return null;
    const dia = parseInt(m[1]);
    const numMes = mesNombreANum(m[2]);
    if (!numMes) return null;
    const y = m[3] ? parseInt(m[3]) : (defaultYear || new Date().getFullYear());
    return `${y}-${String(numMes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// ===================== KARDEX PARSER =====================
function parseKardexUCV(text) {
    const results = [];
    const seen = {};
    const clean = text.replace(/[ \t]+/g, ' ');

    const periodos = [];
    const rPer = /(?:PERIODO|LAPSO|SEMESTRE)\s+(\d{4})\s*[-–]?\s*([123])/gi;
    let pm;
    while ((pm = rPer.exec(clean)) !== null) {
        periodos.push({ periodo: `${pm[1]}-${pm[2]}`, idx: pm.index });
    }

    const rMat = /(08\d{7})\s+(.+?)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(FINAL|RETIRADA|RET|INSCRITA|APROBADA|REPROBADA|NO\s*ASIST(?:IO|IÓ))/gi;
    let mm;
    while ((mm = rMat.exec(clean)) !== null) {
        const codigo = mm[1].slice(-4);
        const notaRaw = parseInt(mm[5]);
        const stateStr = mm[6].toUpperCase();
        let estado, nota = null;
        if (stateStr.includes('RET')) estado = 'Retirada';
        else if (stateStr.includes('NO ASIST')) estado = 'Reprobada';
        else if (stateStr.includes('INSCRITA')) estado = 'En Curso';
        else { estado = notaRaw >= 10 ? 'Aprobada' : 'Reprobada'; nota = notaRaw; }
        let periodo = null;
        for (let i = periodos.length - 1; i >= 0; i--) {
            if (mm.index > periodos[i].idx) { periodo = periodos[i].periodo; break; }
        }
        const key = `${codigo}-${periodo}`;
        seen[key] = { codigo, estado, nota, periodo };
    }
    for (const k in seen) results.push(seen[k]);
    return results;
}

// ===================== CALENDARIO PARSER =====================
/**
 * Parses the UCV FI academic calendar PDF.
 * Real format: table with rows like
 *   "1  27-10-25  AL  31-10-25  CLASES. INICIO DEL SEMESTRE..."
 *   Or the inner events: "Lunes 27-10-25: Inicio del semestre"
 * Dates use DD-MM-YY (2-digit year) or DD-MM-YYYY.
 */
function parseCalendarioUCV(text) {
    const results = [];
    const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#a855f7'];
    let ci = 0;
    const added = new Set();

    // Normalize text
    const clean = text
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .replace(/[ \t]{2,}/g, ' ');
    const lines = clean.split('\n');

    function fix2DigYear(y2) {
        const y = parseInt(y2);
        return y < 50 ? 2000 + y : 1900 + y;
    }

    // DD-MM-YY or DD-MM-YYYY → ISO
    function dateToISO(raw) {
        if (!raw) return null;
        // DD-MM-YY
        let m = raw.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.]((\d{2}|\d{4}))$/);
        if (m) {
            const y = m[3].length === 2 ? fix2DigYear(m[3]) : parseInt(m[3]);
            return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
        }
        return null;
    }

    function addEvt(titulo, fecha, extraColor) {
        if (!titulo || !fecha) return;
        titulo = titulo.trim().replace(/\s+/g, ' ');
        // Trim leading sem numbers, pipes, dashes
        titulo = titulo.replace(/^[\d\s\|\-\*]+/, '').trim();
        if (titulo.length < 4) return;
        titulo = titulo.substring(0, 90);
        const key = `${fecha}|${titulo.substring(0, 25)}`;
        if (added.has(key)) return;
        added.add(key);
        results.push({ titulo, fecha, color: extraColor || COLORS[ci++ % COLORS.length] });
    }

    // ── Pattern 1: Table rows
    // Format: (SEM)  DD-MM-YY  AL  DD-MM-YY  ACTIVIDAD
    // The SEM may be missing (-- rows like vacacional)
    const pTabla = /(?:\d+|--|[\-]{2,})\s+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\s+AL\s+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\s+(.+)/gi;
    let m;
    while ((m = pTabla.exec(clean)) !== null) {
        const iso = dateToISO(m[1].trim());
        const isoFin = dateToISO(m[2].trim());
        const desc = m[3].trim();
        if (iso && desc) addEvt(desc, iso);
        // Also extract specific sub-dates mentioned inline
        // e.g. "Lunes 27-10-25: Inicio" or "Viernes 21-04: Publicacion"
        const pInline = /(?:Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes)[,:]?\s*(\d{1,2}[-\/]\d{1,2}(?:[-\/]\d{2,4})?)[:.]?\s*([^.;]+)/gi;
        let mi;
        while ((mi = pInline.exec(desc)) !== null) {
            let rawD = mi[1].trim();
            // If only DD/MM, add year from range
            if (!rawD.match(/\d{4}/) && iso) rawD = rawD + '-' + iso.substring(0, 4);
            const isoSub = dateToISO(rawD);
            if (isoSub) addEvt(mi[2].trim(), isoSub);
        }
    }

    // ── Pattern 2: Exact date lines (DD/MM/YYYY or DD-MM-YYYY)
    const pExacto = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})\s*[:\-]?\s*([^\n]{5,})/g;
    while ((m = pExacto.exec(clean)) !== null) {
        const iso = dateToISO(m[1].trim());
        if (iso) addEvt(m[2], iso);
    }

    // ── Pattern 3: Dates with 2-digit year only (DD-MM-YY : Event)
    const pCorto = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2})\s*[:\-]?\s*([^\n]{5,})/g;
    while ((m = pCorto.exec(clean)) !== null) {
        const iso = dateToISO(m[1].trim());
        if (iso) addEvt(m[2], iso);
    }

    // ── Pattern 4: Inline day mentions in text body
    // "Viernes 13-03-26" or "Miércoles 11-03-26"
    const pDia = /(?:Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[áa]bado|Domingo)[,]?\s+(\d{1,2}[-\/\.](\d{1,2})[-\/\.](\d{2,4}))\s*[:\-]?\s*([^.;\n]{5,})/gi;
    while ((m = pDia.exec(clean)) !== null) {
        const iso = dateToISO(m[1].trim());
        if (iso) addEvt(m[4], iso);
    }

    // ── Pattern 5: Spanish long dates within text
    // "Martes 06/01/2026: Día de Reyes"
    const pLargaES = /(\d{1,2})\s+de\s+([a-záéíóúüñ]+)(?:\s+de\s+(\d{4}))?\s*[:\-]?\s*([^.\n]{5,})/gi;
    const MESES2 = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12, ene: 1, feb: 2, mar: 3, abr: 4, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
    while ((m = pLargaES.exec(clean)) !== null) {
        const numMes = MESES2[(m[2] || '').toLowerCase()];
        if (!numMes) continue;
        const y = m[3] ? parseInt(m[3]) : 2026;
        const iso = `${y}-${String(numMes).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
        addEvt(m[4], iso);
    }

    return results;
}

// ===================== PROGRAMACIÓN DOCENTE PARSER =====================
function parsePD(text) {
    const results = [];
    // Pattern: CODIGO  NOMBRE  SECCION  HORARIO
    const pRow = /(08\d{3})\s+(.+?)\s+(\d{2})\s+((?:L|M|I|J|V|S)\d{1,2}(?:-\d{1,2})?)/gi;
    let m;
    while ((m = pRow.exec(text)) !== null) {
        results.push({
            codigo: m[1],
            materia: m[2].trim(),
            seccion: m[3],
            horario: m[4]
        });
    }
    return results;
}

// ===================== DISPATCHER =====================
function parseByType(text, type) {
    switch (type) {
        case 'kardex': return parseKardexUCV(text);
        case 'calendario': return parseCalendarioUCV(text);
        case 'pd': return parsePD(text);
        default: return [];
    }
}

// ===================== FETCH PD FROM MWIKI =====================
async function fetchPDFromMwiki(deptUrl, onStatus) {
    const status = (msg, cls) => { if (onStatus) onStatus(msg, cls); };
    status('📡 Descargando PD...', 'text-blue-400');
    try {
        const resp = await fetch(deptUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const ab = await resp.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(ab).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            let prevY = null;
            for (const item of content.items) {
                if (prevY !== null && Math.abs(item.transform[5] - prevY) > 5) text += '\n';
                text += item.str + ' ';
                prevY = item.transform[5];
            }
            text += '\n';
        }
        return parsePD(text);
    } catch (e) {
        status(`❌ Error: ${e.message}`, 'text-red-400');
        return [];
    }
}

// ===================== GEMINI IA =====================
async function parseWithGemini(text, type, apiKey) {
    const PROMPTS = {
        kardex: `Eres un parser de expedientes UCV. Formato:\n08XXXXXXX NOMBRE SEC UC NOTA ESTADO\nRetorna SOLO array JSON: [{"codigo":"0251","estado":"Aprobada","nota":12,"periodo":"2023-1"}]\nTexto:\n${text.substring(0, 15000)}`,
        calendario: `Extrae TODOS los eventos del calendario académico UCV. Para rangos de fechas usa la fecha de inicio. Retorna SOLO array JSON válido: [{"titulo":"Inscripciones","fecha":"2025-05-20","color":"#f59e0b"}]\nTexto:\n${text.substring(0, 20000)}`
    };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: PROMPTS[type] }] }] })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const raw = data.candidates[0].content.parts[0].text.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(raw);
}

// ===================== MAIN DISPATCHER =====================
async function parsePDFMultiMode(file, type, mode, keys, onStatus) {
    const status = (msg, cls) => { if (onStatus) onStatus(msg, cls); };
    let text = '';

    if (mode === 'ocr') {
        status('🧩 OCR: Cargando Tesseract...', 'text-purple-400');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const ocrTexts = [];
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(ab).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
            status(`🧩 OCR: Renderizando pág ${i}/${pdf.numPages}...`, 'text-purple-400 animate-pulse');
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 3.5 });
            canvas.width = viewport.width; canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;
            const { data } = await Tesseract.recognize(canvas.toDataURL('image/png'), 'spa');
            ocrTexts.push(data.text);
        }
        text = ocrTexts.join('\n');
    } else {
        status('📄 Leyendo PDF...', 'text-blue-400');
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(ab).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            // Preserve line breaks by grouping by y-position
            const items = content.items;
            let prevY = null;
            for (const item of items) {
                if (prevY !== null && Math.abs(item.transform[5] - prevY) > 5) text += '\n';
                text += item.str + ' ';
                prevY = item.transform[5];
            }
            text += '\n';
        }
    }

    if (mode === 'gemini') return await parseWithGemini(text, type, keys.gemini);
    const result = parseByType(text, type);
    if (!result.length) throw new Error('No se detectaron datos. Prueba con el archivo PDF oficial o el modo Gemini.');
    return result;
}
