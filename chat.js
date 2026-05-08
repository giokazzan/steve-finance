const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY });

// ── SYSTEM PROMPT ──────────────────────────────────────────
const BASE_PROMPT = [
  "Eres Steve, asesor financiero personal con IA para Mexico. Eres ese amigo que sabe de finanzas: empatico, honesto, directo, nunca juzga.",
  "",
  "PRINCIPIOS (Dale Carnegie, Goleman, Duhigg, Kahneman, Sinek):",
  "Siempre usa el nombre. Escucha antes de aconsejar. Celebra cada dato compartido. Valida emociones antes de dar numeros. Cambios graduales, no sacrificios. Una sola cosa a la vez. Siempre explica el POR QUE antes del QUE.",
  "",
  "FORMA: Natural, maximo 3 oraciones, UNA pregunta por mensaje. Sin listas ni markdown.",
  "",
  "OBJETIVO PRINCIPAL: Organizar los gastos fijos del usuario con sus fechas de pago. Esto le da control y permite recordatorios. Los ingresos vienen AL FINAL, solo despues de tener gastos y deudas organizados.",
  "",
  "FLUJO OBLIGATORIO:",
  "TIEMPO 1 (primer mensaje del usuario): Responde el saludo con calidez. Explica que organizaran sus gastos fijos con fechas para tener todo visible y recibir recordatorios. Pide permiso para empezar.",
  "TIEMPO 2 (usuario da permiso): Explica brevemente por que empiezas con gastos fijos. Pregunta por renta.",
  "PASOS EN ORDEN (sin saltarse ninguno):",
  "1. Gastos fijos esenciales: renta, luz/gas/agua, internet, telefono, seguros. Capturar monto Y dia de vencimiento de cada uno.",
  "2. Gastos fijos no esenciales: suscripciones, membresias.",
  "3. Deudas: tarjetas (saldo, minimo, tasa, dia de corte), creditos, INFONAVIT.",
  "4. Ingresos: SOLO despues de completar pasos 1-3.",
  "5. Analisis y estrategias con fundamentos y pasos concretos.",
  "",
  "PROHIBIDO: Preguntar ingresos antes de completar pasos 1, 2 y 3.",
  "CONFIRMACION empatica despues de cada dato: Listo [nombre], [dato] anotado. Siguiente pregunta.",
  "",
  "DATOS al final cuando haya montos:",
  'STEVE_DATA:{"action":"update","expenses":[{"name":"nombre","amount":0,"category":"fijo_esencial","priority":1,"due_date":null}],"debts":[{"name":"nombre","total_amount":0,"minimum_payment":0,"interest_rate":0,"debt_type":"tarjeta","priority":1,"due_date":null}],"financial":{"income_monthly":0,"rent":0}}',
  "",
  "Siempre al final:",
  'STEVE_UPDATE:{"onboarding_phase":1,"tone_detected":"neutro","session_insight":"frase breve"}',
  "",
  "Si el usuario se despide:",
  'STEVE_SESSION_SUMMARY:{"summary":"max 80 palabras","next_session_hook":"frase calida"}'
].join("\n");

// ── PARSEAR BLOQUES ────────────────────────────────────────
function parseBlocks(text) {
  let message = text;
  let steveData = null, update = null, sessionSummary = null;

  const dataMatch = text.match(/STEVE_DATA:(\{[\s\S]*?\})(?=\n|$)/);
  if (dataMatch) {
    try { steveData = JSON.parse(dataMatch[1]); } catch(e) {}
    message = message.replace(/STEVE_DATA:\{[\s\S]*?\}(?=\n|$)/, '').trim();
  }

  const updateMatch = text.match(/STEVE_UPDATE:(\{[^}]+\})/);
  if (updateMatch) {
    try { update = JSON.parse(updateMatch[1]); } catch(e) {}
    message = message.replace(/STEVE_UPDATE:\{[^}]+\}/, '').trim();
  }

  const summaryMatch = text.match(/STEVE_SESSION_SUMMARY:(\{[\s\S]*?\})(?=\n|$)/);
  if (summaryMatch) {
    try { sessionSummary = JSON.parse(summaryMatch[1]); } catch(e) {}
    message = message.replace(/STEVE_SESSION_SUMMARY:\{[\s\S]*?\}(?=\n|$)/, '').trim();
  }

  return { message: message.trim(), steveData, update, sessionSummary };
}

// ── GUARDIA DE INGRESOS ────────────────────────────────────
function blockIncome(text, phase, expensesCount) {
  if (phase > 3 && expensesCount >= 3) return text;

  const triggers = [
    'cuánto ganas', 'cuanto ganas',
    'cuánto recibes', 'cuanto recibes',
    'cuánto entra', 'cuanto entra',
    'cuánto te pagan', 'cuanto te pagan',
    'ingreso mensual', 'ingreso al mes',
    'cuánto es tu ingreso', 'cuanto es tu ingreso',
    'sueldo', 'salario mensual',
    'cuánto recibes de ingreso', 'cuanto recibes de ingreso',
    'para poder ayudarte', 'necesito conocer tu situaci',
    'conocer un poco tu situaci'
  ];

  const lower = text.toLowerCase();
  const found = triggers.find(t => lower.includes(t));

  if (found) {
    console.log('GUARDIA activada:', found);
    const corrections = {
      1: 'Para organizarte bien, empecemos por lo mas importante. Cuanto pagas de renta o hipoteca al mes y que dia del mes vence?',
      2: 'Sigamos con tus gastos fijos. Tienes suscripciones como Netflix, Spotify u otros servicios mensuales?',
      3: 'Hablemos de tus deudas. Tienes tarjetas de credito activas o algun credito que estes pagando?'
    };
    // Mantener primera oracion empatica si existe
    const firstSentence = text.split(/[.!?]/)[0];
    const isEmpathetic = firstSentence.length < 80 && !triggers.some(t => firstSentence.toLowerCase().includes(t));
    const correction = corrections[Math.min(phase, 3)] || corrections[1];
    return isEmpathetic ? firstSentence + '. ' + correction : correction;
  }

  return text;
}

// ── GUARDAR DATOS ──────────────────────────────────────────
async function saveData(userId, steveData) {
  if (!steveData) return;
  const saves = [];

  if (steveData.financial) {
    const f = steveData.financial;
    const fields = {};
    if (f.income_monthly > 0) fields.income_monthly = f.income_monthly;
    if (f.rent > 0) fields.rent = f.rent;
    if (Object.keys(fields).length > 0) {
      fields.updated_at = new Date().toISOString();
      saves.push(supabase.from('financial_data').update(fields).eq('user_id', userId));
    }
  }

  if (steveData.expenses) {
    for (const e of steveData.expenses.filter(e => e.name && e.amount > 0)) {
      const ex = await supabase.from('expenses').select('id').eq('user_id', userId).eq('name', e.name).maybeSingle();
      if (ex.data) {
        saves.push(supabase.from('expenses').update({ amount: e.amount, category: e.category, priority: e.priority || 1, due_date: e.due_date }).eq('id', ex.data.id));
      } else {
        saves.push(supabase.from('expenses').insert({ user_id: userId, name: e.name, amount: e.amount, category: e.category || 'fijo_esencial', priority: e.priority || 1, due_date: e.due_date, is_fixed: true }));
      }
    }
  }

  if (steveData.debts) {
    for (const d of steveData.debts.filter(d => d.name && d.total_amount > 0)) {
      const ex = await supabase.from('debts').select('id').eq('user_id', userId).eq('name', d.name).maybeSingle();
      if (ex.data) {
        saves.push(supabase.from('debts').update({ total_amount: d.total_amount, minimum_payment: d.minimum_payment || 0, interest_rate: d.interest_rate || 0, due_date: d.due_date }).eq('id', ex.data.id));
      } else {
        saves.push(supabase.from('debts').insert({ user_id: userId, name: d.name, total_amount: d.total_amount, minimum_payment: d.minimum_payment || 0, interest_rate: d.interest_rate || 0, debt_type: d.debt_type || 'otro', priority: d.priority || 1, due_date: d.due_date, is_active: true }));
      }
    }
  }

  if (saves.length > 0) await Promise.allSettled(saves);
}


// ── EXTRACCIÓN INTELIGENTE DE DATOS ───────────
function extractFinancialData(userMsg, steveMsg) {
  const combined = userMsg.toLowerCase() + ' ' + steveMsg.toLowerCase();
  const expenses = [];
  const financial = {};

  // Extraer montos con contexto
  const montoRegex = /\$?([\d,]+(?:\.\d{1,2})?)/g;
  const diaRegex = /d[íi]a\s*(\d{1,2})|el\s*(\d{1,2})\s*de\s*cada/gi;

  // Detectar renta/hipoteca
  if (/renta|hipoteca|arriendo/.test(combined)) {
    const monto = extractMonto(combined, /renta|hipoteca/);
    const dia = extractDia(combined);
    if (monto > 0) {
      expenses.push({ name: 'Renta', amount: monto, category: 'fijo_esencial', priority: 1, due_date: dia });
      financial.rent = monto;
    }
  }

  // Detectar colegiatura/escuela
  if (/colegiatura|escuela|colegio|universidad/.test(combined)) {
    const monto = extractMonto(combined, /colegiatura|escuela|colegio/);
    const dia = extractDia(combined);
    if (monto > 0) {
      expenses.push({ name: 'Colegiatura', amount: monto, category: 'fijo_esencial', priority: 1, due_date: dia });
    }
  }

  // Detectar luz/gas/agua
  if (/luz|gas|agua|cfe|electricidad/.test(combined)) {
    const monto = extractMonto(combined, /luz|gas|agua|cfe/);
    const dia = extractDia(combined);
    if (monto > 0) {
      expenses.push({ name: 'Luz y gas', amount: monto, category: 'fijo_esencial', priority: 1, due_date: dia });
    }
  }

  // Detectar internet/teléfono
  if (/internet|teléfono|celular|tel[eé]fono/.test(combined)) {
    const monto = extractMonto(combined, /internet|tel[eé]fono|celular/);
    const dia = extractDia(combined);
    if (monto > 0) {
      expenses.push({ name: 'Internet/Teléfono', amount: monto, category: 'fijo_esencial', priority: 1, due_date: dia });
    }
  }

  // Detectar Netflix/Spotify/suscripciones
  if (/netflix|spotify|disney|amazon|streaming/.test(combined)) {
    const monto = extractMonto(combined, /netflix|spotify|disney|amazon/);
    if (monto > 0) {
      const name = /netflix/.test(combined) ? 'Netflix' : /spotify/.test(combined) ? 'Spotify' : 'Suscripción';
      expenses.push({ name, amount: monto, category: 'fijo_no_esencial', priority: 3, due_date: null });
    }
  }

  // Detectar ingreso
  if (/gano|ingreso|sueldo|quincena|salario|recibo/.test(combined) && /\$?[\d,]+/.test(combined)) {
    const monto = extractMonto(combined, /gano|sueldo|salario|ingreso/);
    if (monto > 0) financial.income_monthly = monto;
  }

  if (expenses.length === 0 && Object.keys(financial).length === 0) return null;
  return { action: 'update', expenses, financial };
}

function extractMonto(text, contextRegex) {
  // Buscar número cerca del contexto
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (contextRegex.test(words[i])) {
      // Buscar número en las 5 palabras siguientes y anteriores
      for (let j = Math.max(0, i-5); j < Math.min(words.length, i+6); j++) {
        const num = words[j].replace(/[,$]/g, '');
        const parsed = parseFloat(num);
        if (!isNaN(parsed) && parsed > 100 && parsed < 500000) return parsed;
      }
    }
  }
  return 0;
}

function extractDia(text) {
  const match = text.match(/d[íi]a\s*(\d{1,2})|el\s*(\d{1,2})\s*(?:de cada|del mes)/i);
  if (match) return parseInt(match[1] || match[2]);
  return null;
}

// ── HANDLER PRINCIPAL ──────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { messages, user_id, conversation_id } = req.body;
    if (!user_id || !messages?.length) return res.status(400).json({ error: 'Faltan datos' });

    // Cargar contexto
    const [pR, fR, dR, mR, expR] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user_id).maybeSingle(),
      supabase.from('financial_data').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('debts').select('*').eq('user_id', user_id).eq('is_active', true).order('priority'),
      supabase.from('user_memory').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('expenses').select('*').eq('user_id', user_id).order('priority')
    ]);

    const profile = pR.data || {};
    const financial = fR.data || {};
    const debts = dR.data || [];
    const memory = mR.data || {};
    const expenses = expR.data || [];
    const phase = memory.onboarding_phase || 1;
    const name = profile.full_name || 'amigo';

    // Construir system prompt con contexto real
    const expSummary = expenses.length > 0
      ? expenses.map(e => `${e.name}:$${e.amount}(dia${e.due_date || '?'})`).join(', ')
      : 'Ninguno aun';
    const debtSummary = debts.length > 0
      ? debts.map(d => `${d.name}:$${d.total_amount}@${d.interest_rate}%`).join(', ')
      : 'Ninguna aun';

    const phaseInstructions = {
      1: 'PASO 1 ACTIVO: Organizar gastos fijos esenciales con fechas. Empezar por renta.',
      2: 'PASO 2 ACTIVO: Organizar gastos fijos no esenciales (suscripciones, membresias).',
      3: 'PASO 3 ACTIVO: Registrar deudas con saldo, minimo, tasa y dia de corte.',
      4: 'PASO 4 ACTIVO: Preguntar ingresos para completar el panorama financiero.',
      5: 'PASO 5 ACTIVO: Dar analisis completo con estrategias y pasos concretos.'
    };

    let systemPrompt = BASE_PROMPT + `\n\nCONTEXTO:\nNombre: ${name} | Fase: ${phase} | Sesiones: ${profile.sessions_count || 0}\n${phaseInstructions[phase] || phaseInstructions[5]}\nGastos registrados (${expenses.length}): ${expSummary}\nDeudas registradas (${debts.length}): ${debtSummary}\nUltima sesion: ${memory.last_session_summary || 'Primera vez'}\n\nREGLA CRITICA DE DATOS: Si el usuario menciona CUALQUIER monto de dinero (renta, gasto, deuda, ingreso), DEBES incluir STEVE_DATA al final de tu respuesta con los datos estructurados. Sin excepcion. Si mencionas "anote" o "registre" en tu respuesta, significa que DEBES incluir STEVE_DATA. Ejemplo de formato obligatorio:\nSTEVE_DATA:{"action":"update","expenses":[{"name":"Renta","amount":5000,"category":"fijo_esencial","priority":1,"due_date":15}],"financial":{"rent":5000}}`;

    // Instruccion critica para primer mensaje
    const isFirst = messages.filter(m => m.role === 'user').length === 1;
    if (isFirst) {
      systemPrompt += `\n\nINSTRUCCION CRITICA - PRIMER MENSAJE: Responde el saludo de ${name} con calidez genuina. Luego explica que van a organizar sus gastos fijos con fechas para tener todo visible y recibir recordatorios antes de cada vencimiento. Cierra preguntando si le parece bien empezar. ABSOLUTAMENTE PROHIBIDO mencionar ingresos, sueldo o dinero que gana.`;
    }

    // Llamar a Claude
    const aiRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: systemPrompt,
      messages: messages.slice(-20)
    });

    let rawText = aiRes.content[0].text;

    // Aplicar guardia de ingresos
    rawText = blockIncome(rawText, phase, expenses.length);

    const parsed = parseBlocks(rawText);

    // Guardar datos del STEVE_DATA si Claude lo incluyó
    if (parsed.steveData) await saveData(user_id, parsed.steveData);
    
    // EXTRACCIÓN INTELIGENTE: si no hay STEVE_DATA pero la respuesta confirma datos
    // extraer del contexto de la conversación
    if (!parsed.steveData) {
      const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
      const steveMsg = parsed.message || '';
      const extractedData = extractFinancialData(lastUserMsg, steveMsg);
      if (extractedData) {
        await saveData(user_id, extractedData);
        parsed.reloadData = true;
      }
    }

    // Actualizar BD
    const updates = [
      supabase.from('profiles').update({
        messages_this_month: (profile.messages_this_month || 0) + 1,
        updated_at: new Date().toISOString()
      }).eq('id', user_id)
    ];

    if (parsed.update?.onboarding_phase && parsed.update.onboarding_phase !== phase) {
      updates.push(supabase.from('user_memory').update({
        onboarding_phase: parsed.update.onboarding_phase,
        updated_at: new Date().toISOString()
      }).eq('user_id', user_id));
    }

    if (parsed.sessionSummary) {
      updates.push(supabase.from('user_memory').update({
        last_session_summary: parsed.sessionSummary.summary,
        next_session_hook: parsed.sessionSummary.next_session_hook,
        updated_at: new Date().toISOString()
      }).eq('user_id', user_id));
    }

    await Promise.allSettled(updates);

    return res.status(200).json({
      message: parsed.message,
      update: parsed.update,
      reload_data: !!parsed.steveData
    });

  } catch (err) {
    console.error('Steve error:', err);
    return res.status(500).json({
      error: 'Error interno',
      message: 'Algo salio mal. Intenta de nuevo.'
    });
  }
};
