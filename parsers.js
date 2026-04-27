/**
 * parsers.js — UCV Planner v10.0.0 | 2026-04-27
 * Multi-mode parsers: Regex (offline), OCR (Tesseract.js, gratis), Gemini IA
 * 
 * KEY INSIGHT: pdf.js extracts text token-by-token, NOT line-by-line.
 * Tokens may be single words, numbers, or fragments joined by spaces.
 * Our regex must handle this fragmented format.
 */

// ===================== UTILS =====================
function timeUCVtoHHMM(raw) {
    if (!raw) return null;
    raw = raw.trim();
    let m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (m) {
        let h1 = parseInt(m[1]), h2 = parseInt(m[3]);
        const min1 = m[2] || '00', min2 = m[4] || '00';
        const mer = m[5].toLowerCase();
        if (mer === 'pm' && h1 < 12) h1 += 12;
        if (mer === 'pm' && h2 < 12) h2 += 12;
        if (mer === 'am' && h1 === 12) h1 = 0;
        if (mer === 'am' && h2 === 12) h2 = 0;
        return [`${String(h1).padStart(2,'0')}:${min1}`, `${String(h2).padStart(2,'0')}:${min2}`];
    }
    return null;
}

function fecha2digToISO(raw) {
    const m = raw.match(/(\d{1,2})[-\/](\d{2})[-\/](\d{2})/);
    if (!m) return null;
    return `${2000+parseInt(m[3])}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

function fechaLargaToISO(raw) {
    const m = raw.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (!m) return null;
    return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

// ===================== KARDEX PARSER =====================
// pdf.js output for the Kardex looks like:
// "PERIODO 2022-3 #2-2022"
// "080000012 INTRODUCCION A LA INGENIERIA 1 2 16 FINAL"
// But it may also come as one giant block with spaces. We scan globally.
function parseKardexUCV(text) {
    const results = [];
    const seen = {};

    // Normalize: collapse multiple spaces, keep newlines
    const clean = text.replace(/[ \t]+/g, ' ');

    // 1. Find all PERIODO markers
    const periodos = [];
    const rPer = /PERIODO\s+(\d{4})\s*[-–]?\s*([123])/gi;
    let pm;
    while ((pm = rPer.exec(clean)) !== null) {
        periodos.push({ periodo: `${pm[1]}-${pm[2]}`, idx: pm.index });
    }

    // 2. Find all materia entries: 9-digit code starting with 08, then eventually a 2-digit nota and FINAL/RETIRADA/NO ASISTIO
    // We use a very permissive regex that works even if pdf.js splits tokens
    const rMat = /(08\d{7})\s+(.+?)\s+(\d{1,2})\s+(\d{1,2})\s+(\d{2})\s+(FINAL|RETIRADA|NO\s*ASIST(?:IO|IÓ))/gi;
    let mm;
    while ((mm = rMat.exec(clean)) !== null) {
        const codigoFull = mm[1];
        const codigo = codigoFull.slice(-4);
        const notaRaw = parseInt(mm[5]);
        const estadoRaw = mm[6].toUpperCase().replace(/\s+/g, '');

        let estado, nota = null;
        if (estadoRaw === 'FINAL') {
            estado = notaRaw >= 10 ? 'Aprobada' : 'Reprobada';
            nota = notaRaw;
        } else if (estadoRaw === 'RETIRADA') {
            estado = 'Retirada';
        } else {
            estado = 'Reprobada'; // NO ASISTIO
        }

        // Find which periodo this entry belongs to
        let periodo = null;
        for (let i = periodos.length - 1; i >= 0; i--) {
            if (mm.index > periodos[i].idx) { periodo = periodos[i].periodo; break; }
        }

        // Deduplicate: keep last occurrence per codigo+periodo
        const key = `${codigo}-${periodo}`;
        seen[key] = { codigo, estado, nota, periodo };
    }

    for (const k in seen) results.push(seen[k]);
    return results;
}

// ===================== CALENDARIO PARSER =====================
function parseCalendarioUCV(text) {
    const results = [];
    const COLORS = ['#f59e0b','#3b82f6','#10b981','#ef4444','#8b5cf6','#f97316'];
    let ci = 0;
    const clean = text.replace(/[ \t]+/g, ' ');

    // Pattern: DD-MM-YY AL DD-MM-YY followed by text
    const rRange = /(\d{1,2}-\d{2}-\d{2})\s+AL\s+(\d{1,2}-\d{2}-\d{2})\s+(.+?)(?=\d{1,2}-\d{2}-\d{2}\s+AL|\n|$)/gi;
    let m;
    while ((m = rRange.exec(clean)) !== null) {
        const fecha = fecha2digToISO(m[1]);
        let titulo = m[3].trim();
        // Clean up: take first 80 chars, stop at next date pattern
        titulo = titulo.replace(/\d{1,2}-\d{2}-\d{2}.*/, '').trim().substring(0, 80);
        if (fecha && titulo.length > 2) {
            results.push({ titulo, fecha, color: COLORS[ci++ % COLORS.length] });
        }
    }

    // Also try DD/MM/YYYY format
    const rLong = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\s+(.+?)(?=\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\n|$)/gi;
    while ((m = rLong.exec(clean)) !== null) {
        const fecha = fechaLargaToISO(m[1]);
        const titulo = m[2].trim().substring(0, 80);
        if (fecha && titulo.length > 2) {
            results.push({ titulo, fecha, color: COLORS[ci++ % COLORS.length] });
        }
    }

    return results;
}

// ===================== PD (PROGRAMACIÓN DOCENTE) PARSER =====================
function parsePDUCV(text) {
    const results = [];
    const DIAS = ['Lunes','Martes','Miercoles','Jueves','Viernes'];
    const clean = text.replace(/[ \t]+/g, ' ');
    const lines = clean.split(/\n/);

    // The PD table has: ASIGNATURA | Cód. | Sec. | Lunes(Hora/Aula) | ... | PROFESOR | CUPO
    // pdf.js often outputs each row as a line with mixed tokens
    // We look for: 4-digit code + section number + at least one time pattern
    const rTime = /(\d{1,2}(?::\d{2})?)\s*[-–]\s*(\d{1,2}(?::\d{2})?)\s*(AM|PM|am|pm)/g;
    const rAula = /\b([A-Z]{1,2}\d{3,4}[A-Z]?)\b/g;

    for (const raw of lines) {
        const l = raw.trim();
        if (l.length < 10) continue;

        // Find a 4-digit code
        const codM = l.match(/\b(\d{4})\b/);
        if (!codM) continue;
        const codigo = codM[1];

        // Skip header rows, cupo numbers, etc.
        if (['CUPO', 'ASIG', 'Hora', 'Aula'].some(k => l.startsWith(k))) continue;

        // Find section: digit(s) right after the code
        const afterCode = l.substring(l.indexOf(codigo) + 4);
        const secM = afterCode.match(/^\s*(\d{1,2})\b/);
        const seccion = secM ? secM[1].padStart(3, '0') : '001';

        // Find all time patterns
        const times = [];
        let tm;
        rTime.lastIndex = 0;
        while ((tm = rTime.exec(l)) !== null) {
            const parsed = timeUCVtoHHMM(tm[0]);
            if (parsed) times.push({ ini: parsed[0], fin: parsed[1], idx: tm.index });
        }
        if (!times.length) continue;

        // Find aulas
        rAula.lastIndex = 0;
        const aulas = [];
        let am;
        while ((am = rAula.exec(l)) !== null) aulas.push(am[1]);
        const aula = aulas.length ? aulas[0] : '';

        // Determine days by position heuristic (times appear under day columns)
        const dias = [];
        const lineLen = l.length;
        if (lineLen > 0) {
            times.forEach(t => {
                // Approximate: the line is divided into ~5 day columns after code+sec
                const codeEnd = l.indexOf(codigo) + 4 + (secM ? secM[0].length : 0);
                const dayArea = lineLen - codeEnd;
                const col = Math.floor(((t.idx - codeEnd) / dayArea) * 5);
                const clampedCol = Math.max(0, Math.min(4, col));
                if (!dias.includes(DIAS[clampedCol])) dias.push(DIAS[clampedCol]);
            });
        }
        if (!dias.length) dias.push('Lunes');

        // Extract professor name (typically at the end, capitalized words)
        const lastTimeEnd = times[times.length - 1].idx + 10;
        const tail = l.substring(lastTimeEnd).replace(/[A-Z]\d{3,4}/g, '').trim();
        const profM = tail.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/);
        const profesor = profM ? profM[1] : '';

        results.push({ codigo, seccion, dias, hora_inicio: times[0].ini, hora_fin: times[0].fin, aula, profesor });
    }
    return results;
}

// ===================== SEMANAS PARSER =====================
function parseSemanasUCV(text) {
    const results = [];
    const clean = text.replace(/[ \t]+/g, ' ');

    // Global scan for "Sem X" or "Semana X"
    const rSem = /[Ss]em(?:ana)?\.?\s*(\d{1,2})/g;
    const rFecha = /(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/;
    let sm;
    while ((sm = rSem.exec(clean)) !== null) {
        const numero = parseInt(sm[1]);
        // Grab context: 200 chars after the match
        const context = clean.substring(sm.index, sm.index + 200);
        const fechaM = context.match(rFecha);
        let fecha = null;
        if (fechaM) {
            fecha = fechaM[3].length <= 2 ? fecha2digToISO(fechaM[0]) : fechaLargaToISO(fechaM[0]);
        }
        // Extract topic: everything after the number and optional date
        let tema = context.substring(sm[0].length)
            .replace(fechaM ? fechaM[0] : '', '')
            .replace(/[:\-–|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 120);
        // Stop at next "Sem" or newline
        const nextSem = tema.search(/[Ss]em(?:ana)?\.?\s*\d/);
        if (nextSem > 0) tema = tema.substring(0, nextSem).trim();

        if (numero > 0) results.push({ numero, fecha, materia: '', tema });
    }
    return results;
}

// ===================== DISPATCHER =====================
function parseByType(text, type) {
    switch (type) {
        case 'kardex':     return parseKardexUCV(text);
        case 'horario':    return parsePDUCV(text);
        case 'calendario': return parseCalendarioUCV(text);
        case 'semanas':    return parseSemanasUCV(text);
        default: return [];
    }
}

// ===================== GEMINI IA =====================
async function parseWithGemini(text, type, apiKey) {
    const PROMPTS = {
        kardex: `Eres un parser de expedientes UCV. Formato por materia:\n08XXXXXXX NOMBRE  SEC  UC  NOTA  ESTADO\nESTADO: FINAL (nota>=10=Aprobada, <10=Reprobada), RETIRADA, NO ASISTIO.\nRetorna SOLO array JSON: [{"codigo":"0251","estado":"Aprobada","nota":12,"periodo":"2023-1"}]\nTexto:\n${text.substring(0,15000)}`,
        horario: `Parsea PD UCV. Columnas: ASIGNATURA|Cód|Sec|Lunes(Hora/Aula)|...|Viernes|PROFESOR|CUPO.\nHorarios: "7-9 AM" o "7:00-9:00am". Convierte a HH:MM.\nRetorna SOLO array JSON: [{"codigo":"0251","seccion":"001","dias":["Lunes"],"hora_inicio":"07:00","hora_fin":"09:00","aula":"A216","profesor":"Nombre"}]\nTexto:\n${text.substring(0,45000)}`,
        calendario: `Parsea calendario UCV. Fechas DD-MM-YY. Convierte a YYYY-MM-DD.\nRetorna SOLO array JSON: [{"titulo":"Inicio Clases","fecha":"2025-10-27","color":"#f59e0b"}]\nTexto:\n${text.substring(0,15000)}`,
        semanas: `Extrae programación semanal. Retorna SOLO array JSON: [{"numero":1,"fecha":"2024-03-15","materia":"","tema":"Límites"}]\nTexto:\n${text.substring(0,45000)}`
    };

    const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let data, attempts = 0;
    while (attempts < 3) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELS[attempts]}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: PROMPTS[type] }] }], generationConfig: { temperature: 0.1 } })
        });
        data = await res.json();
        const err = (data.error?.message || '').toLowerCase();
        if (!data.error || (!err.includes('503') && !err.includes('overload') && !err.includes('spike'))) break;
        attempts++;
        await new Promise(r => setTimeout(r, 2000 * attempts));
    }
    if (data.error) throw new Error('Gemini: ' + data.error.message);
    if (!data.candidates?.[0]) throw new Error('Gemini no devolvió respuesta.');
    let raw = data.candidates[0].content.parts[0].text.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = raw.match(/(\[.*\]|\{.*\})/s);
    if (!match) throw new Error('Gemini no devolvió JSON válido.');
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : (parsed.eventos || []);
}

// ===================== MAIN DISPATCHER =====================
async function parsePDFMultiMode(file, type, mode, keys, onStatus) {
    const status = (msg, cls) => { if (onStatus) onStatus(msg, cls); };
    let text = '';

    // --- OCR MODE (free, client-side Tesseract.js) ---
    if (mode === 'ocr') {
        if (typeof Tesseract === 'undefined') throw new Error('Tesseract.js no está cargado. Recarga la página.');
        status('🧩 OCR: Renderizando páginas...', 'text-purple-600 animate-pulse');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const ocrTexts = [];
        const ab = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(ab).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
            status(`🧩 OCR: Página ${i}/${pdf.numPages}...`, 'text-purple-600 animate-pulse');
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;
            const dataUrl = canvas.toDataURL('image/png');
            const { data } = await Tesseract.recognize(dataUrl, 'spa');
            ocrTexts.push(data.text);
        }
        text = ocrTexts.join('\n');
        if (!text.trim()) throw new Error('OCR no extrajo texto.');
        status('⚙️ Analizando texto OCR...', 'text-blue-600 animate-pulse');
        const result = parseByType(text, type);
        if (!result.length) throw new Error('OCR completado pero no se encontraron datos. Prueba Gemini.');
        return result;
    }

    // --- Extract text with pdf.js (for regex and gemini modes) ---
    status('📄 Extrayendo texto del PDF...', 'text-purple-600 animate-pulse');
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(ab).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(s => s.str).join(' ') + '\n';
    }

    // DEBUG: log the raw extracted text so we can see what pdf.js gives us
    console.log('=== PDF.JS RAW TEXT ===');
    console.log(text.substring(0, 2000));
    console.log('=== END RAW TEXT ===');

    if (!text.trim()) throw new Error('PDF sin texto extraíble. Prueba el modo OCR.');

    // --- REGEX MODE (offline) ---
    if (mode === 'regex') {
        status('⚙️ Analizando con patrones UCV...', 'text-blue-600 animate-pulse');
        const result = parseByType(text, type);
        if (!result.length) {
            // Show first 200 chars of text to help debug
            console.warn('Regex parser found 0 results. Text preview:', text.substring(0, 500));
            throw new Error('Parser offline: 0 resultados. Revisa la consola (F12) para ver el texto extraído. Prueba Gemini.');
        }
        return result;
    }

    // --- GEMINI MODE ---
    if (mode === 'gemini') {
        if (!keys.gemini) throw new Error('Falta API Key de Gemini.');
        status('🤖 Enviando a Gemini...', 'text-purple-600 animate-pulse');
        return await parseWithGemini(text, type, keys.gemini);
    }

    throw new Error('Modo desconocido: ' + mode);
}

const PARSER_VERSION = '10.0.0';
