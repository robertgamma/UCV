/**
 * parsers.js — UCV Planner v10.0.1 | 2026-04-27
 * Multi-mode parsers: Regex (offline), OCR (Tesseract.js, gratis), Gemini IA
 */

// ===================== UTILS =====================
function timeUCVtoHHMM(raw) {
    if (!raw) return null;
    raw = raw.trim();
    // Handles 7-9, 7:00-9:00, 7am-9pm, etc.
    let m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (m) {
        let h1 = parseInt(m[1]), h2 = parseInt(m[3]);
        const min1 = m[2] || '00', min2 = m[4] || '00';
        const mer = (m[5] || '').toLowerCase();
        if (mer === 'pm' && h1 < 12) h1 += 12;
        if (mer === 'pm' && h2 < 12) h2 += 12;
        if (mer === 'am' && h1 === 12) h1 = 0;
        if (mer === 'am' && h2 === 12) h2 = 0;
        // Default to AM for early hours, PM for late ones if no meridian
        if (!mer) {
            if (h1 < 7) h1 += 12;
            if (h2 < 7) h2 += 12;
        }
        return [`${String(h1).padStart(2,'0')}:${min1}`, `${String(h2).padStart(2,'0')}:${min2}`];
    }
    return null;
}

function fecha2digToISO(raw) {
    const m = raw.match(/(\d{1,2})[-\/](\d{2,4})[-\/](\d{2,4})/);
    if (!m) return null;
    let y = parseInt(m[3]);
    if (y < 100) y += 2000;
    return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

// ===================== KARDEX PARSER =====================
function parseKardexUCV(text) {
    const results = [];
    const seen = {};
    const clean = text.replace(/[ \t]+/g, ' ');

    const periodos = [];
    const rPer = /(?:PERIODO|LAPSO)\s+(\d{4})\s*[-–]?\s*([123])/gi;
    let pm;
    while ((pm = rPer.exec(clean)) !== null) {
        periodos.push({ periodo: `${pm[1]}-${pm[2]}`, idx: pm.index });
    }

    // Pattern: 08XXXXXXX NAME (opt numbers) NOTA STATE
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
        else {
            estado = notaRaw >= 10 ? 'Aprobada' : 'Reprobada';
            nota = notaRaw;
        }

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
function parseCalendarioUCV(text) {
    const results = [];
    const COLORS = ['#f59e0b','#3b82f6','#10b981','#ef4444','#8b5cf6'];
    let ci = 0;
    const clean = text.replace(/[ \t]+/g, ' ');

    // 1. Ranges: Del DD/MM al DD/MM or DD-MM AL DD-MM
    const rRange = /(?:Del|Desde)?\s*(\d{1,2}[-\/]\d{1,2}(?:[-\/]\d{2,4})?)\s*(?:al|AL|a)\s*(\d{1,2}[-\/]\d{1,2}(?:[-\/]\d{2,4})?)\s+([^0-9\n][^0-9\n]{3,})/gi;
    let m;
    while ((m = rRange.exec(clean)) !== null) {
        const f1 = m[1];
        let iso = f1.includes('/') || f1.includes('-') ? fecha2digToISO(f1) : null;
        if (!iso && f1.length <= 5) iso = `2025-${f1.split(/[/-]/)[1].padStart(2,'0')}-${f1.split(/[/-]/)[0].padStart(2,'0')}`;
        
        if (iso) {
            results.push({ titulo: m[3].trim().substring(0,60), fecha: iso, color: COLORS[ci++ % COLORS.length] });
        }
    }

    // 2. Exact dates: DD/MM/YYYY
    const rSingle = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})\s+([^0-9\n][^0-9\n]{3,})/gi;
    while ((m = rSingle.exec(clean)) !== null) {
        const iso = fecha2digToISO(m[1]);
        if (iso) results.push({ titulo: m[2].trim().substring(0,60), fecha: iso, color: COLORS[ci++ % COLORS.length] });
    }

    return results;
}

// ===================== DISPATCHER =====================
function parseByType(text, type) {
    switch (type) {
        case 'kardex':     return parseKardexUCV(text);
        case 'calendario': return parseCalendarioUCV(text);
        default: return [];
    }
}

// ===================== GEMINI IA =====================
async function parseWithGemini(text, type, apiKey) {
    const PROMPTS = {
        kardex: `Eres un parser de expedientes UCV. Formato:\n08XXXXXXX NOMBRE SEC UC NOTA ESTADO\nRetorna SOLO array JSON: [{"codigo":"0251","estado":"Aprobada","nota":12,"periodo":"2023-1"}]\nTexto:\n${text.substring(0,15000)}`,
        calendario: `Extrae eventos del calendario UCV. Retorna SOLO array JSON: [{"titulo":"Inscripciones","fecha":"2025-05-20","color":"#f59e0b"}]\nTexto:\n${text.substring(0,20000)}`
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
            const viewport = page.getViewport({ scale: 3.5 }); // High scale for better OCR
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
            text += content.items.map(s => s.str).join(' ') + '\n';
        }
    }

    if (mode === 'gemini') return await parseWithGemini(text, type, keys.gemini);
    const result = parseByType(text, type);
    if (!result.length) throw new Error('No se detectaron datos. Prueba el modo OCR o Gemini.');
    return result;
}
