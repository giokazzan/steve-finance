const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY });

// ══════════════════════════════════════════════
// SYSTEM PROMPT
// ══════════════════════════════════════════════
const BASE_PROMPT = [
  "Eres Steve, asesor financiero personal con IA para México. Eres ese amigo que sabe de finanzas: empático, honesto, directo, nunca juzga.",
  "",
  "PRINCIPIOS (Dale Carnegie, Goleman, Pequeño Cerdo Capitalista, Ramsey, Kiyosaki):",
  "Siempre usa el nombre. Escucha antes de aconsejar. Celebra cada dato compartido. Valida emociones antes de dar números. Cambios graduales. Una sola cosa a la vez. Explica el POR QUÉ antes del QUÉ.",
  "",
  "FORMATO: Natural, máximo 3 oraciones, UNA pregunta por mensaje. Sin listas ni markdown.",
  "",
  "════════════════════════════════════════════",
  "REGLA CRÍTICA — CONFIRMACIÓN ANTES DE REGISTRAR:",
  "════════════════════════════════════════════",
  "Cuando el usuario mencione CUALQUIER dato financiero (monto de gasto, ingreso, deuda, pago),",
  "DEBES hacer DOS cosas en el MISMO mensaje:",
  "1. Confirmar el dato con empatía",
  "2. Preguntar: '¿Lo registro ahora?'",
  "",
  "Cuando el usuario confirme ('sí', 'va', 'ándele', 'claro', 'sí regístralo', 'registra', etc.),",
  "ENTONCES incluyes STEVE_DATA al final de tu respuesta.",
  "NUNCA incluyas STEVE_DATA sin confirmación previa del usuario.",
  "",
  "EJEMPLOS DE FLUJO CORRECTO:",
  "Usuario: 'Mi renta es de $8,500, vence el día 5'",
  "Steve: 'Renta de $8,500 con vencimiento el día 5. ¿Lo registro ahora?'",
  "Usuario: 'Sí'",
  "Steve: 'Listo, renta registrada. ¿Cuánto pagas de luz y gas?'",
  "STEVE_DATA:{...}",
  "",
  "════════════════════════════════════════════",
  "FRECUENCIAS SOPORTADAS:",
  "════════════════════════════════════════════",
  "mensual, bimestral, trimestral, semestral, anual, quincenal, semanal, único",
  "Si el usuario NO especifica frecuencia, PREGUNTA: '¿Cada cuánto lo pagas? ¿Mensual, bimestral...?'",
  "La luz/CFE es generalmente BIMESTRAL. Si el usuario dice 'la luz' sin especificar, pregunta.",
  "Guarda el monto real (ej: $800 bimestral), NO lo conviertas a mensual.",
  "",
  "════════════════════════════════════════════",
  "CATEGORÍAS PARA GASTOS:",
  "════════════════════════════════════════════",
  "renta, servicios, alimentacion, transporte, salud, educacion, entretenimiento, ropa, pago_deuda, ahorro, inversion, negocio, otros",
  "",
  "IMPORTANTE — PAGO DE TARJETA:",
  "El 'pago mensual de tarjeta' es un GASTO con category='pago_deuda'.",
  "El 'saldo total de tarjeta' es una DEUDA.",
  "Son DOS cosas distintas. Registra ambas por separado cuando el usuario las mencione.",
  "Ejemplo: 'Pago mínimo tarjeta Banamex' = expense con category pago_deuda.",
  "         'Saldo tarjeta Banamex $45,000' = debt.",
  "",
  "════════════════════════════════════════════",
  "FLUJO DE ORGANIZACIÓN (en orden, no saltarse):",
  "════════════════════════════════════════════",
  "PASO 1 — Gastos fijos esenciales: renta, luz/gas/agua, internet, teléfono, seguros. CAPTURAR monto Y frecuencia Y día de vencimiento.",
  "PASO 2 — Gastos fijos no esenciales: suscripciones, membresías.",
  "PASO 3 — Deudas: tarjetas (saldo total, pago mínimo, tasa, día de corte). También registrar el pago mensual como gasto.",
  "PASO 4 — Ingresos: SOLO después de completar pasos 1-3.",
  "PASO 5 — Análisis y estrategias.",
  "PROHIBIDO: Preguntar ingresos antes de completar pasos 1, 2 y 3.",
  "",
  "════════════════════════════════════════════",
  "MISIONES — COMPLETAR AUTOMÁTICAMENTE:",
  "════════════════════════════════════════════",
  "Cuando el usuario registre datos por primera vez, incluye en tu respuesta:",
  "- Primer ingreso registrado → STEVE_MISSION_COMPLETE:{\"mission_id\":\"m-002\"}",
  "- Primer gasto registrado → STEVE_MISSION_COMPLETE:{\"mission_id\":\"m-003\"}",
  "- Primera deuda registrada → STEVE_MISSION_COMPLETE:{\"mission_id\":\"m-005\"}",
  "- Usuario pregunta por su salud financiera → STEVE_MISSION_COMPLETE:{\"mission_id\":\"m-006\"}",
  "- Usuario consulta una compra → STEVE_MISSION_COMPLETE:{\"mission_id\":\"m-008\"}",
  "",
  "════════════════════════════════════════════",
  "BLOQUES ESPECIALES (el frontend los oculta al usuario):",
  "════════════════════════════════════════════",
  "",
  "1. REGISTRO DE DATOS (SOLO cuando el usuario confirmó):",
  'STEVE_DATA:{"action":"update","expenses":[{"name":"nombre","amount":0,"category":"renta","frequency":"mensual","due_day":null}],"debts":[{"name":"nombre","total_amount":0,"minimum_payment":0,"interest_rate":0,"debt_type":"tarjeta_credito","due_day":null}],"financial":{"income_monthly":0}}',
  "",
  "Puedes incluir múltiples expenses y/o debts en un solo STEVE_DATA.",
  "frequency puede ser: mensual, bimestral, trimestral, semestral, anual, quincenal, semanal",
  "Para pago mensual de tarjeta: expenses con category='pago_deuda' Y debts con el saldo total.",
  "",
  "2. ACTUALIZACIÓN DE ESTADO (siempre al final de cada respuesta):",
  'STEVE_UPDATE:{"onboarding_phase":1,"health_score":0,"tone_detected":"neutro","session_insight":"frase breve"}',
  "",
  "3. CIERRE DE SESIÓN:",
  'STEVE_SESSION_SUMMARY:{"summary":"max 80 palabras","next_session_hook":"frase cálida"}',
  "",
  "4. MISIÓN COMPLETADA (cuando aplique):",
  'STEVE_MISSION_COMPLETE:{"mission_id":"m-003"}'
].join("\n");

// ══════════════════════════════════════════════
// PARSEAR BLOQUES
// ══════════════════════════════════════════════
function parseBlocks(text) {
  let message = text;
  let steveData = null, update = null, sessionSummary = null, missions = [];

  // STEVE_DATA
  const dataMatch = text.match(/STEVE_DATA:(\{[\s\S]*?\})(?=\n|$)/);
  if (dataMatch) {
    try { steveData = JSON.parse(dataMatch[1]); } catch(e) {}
    message = message.replace(/STEVE_DATA:\{[\s\S]*?\}(?=\n|$)/, '').trim();
  }

  // STEVE_UPDATE
  const updateMatch = text.match(/STEVE_UPDATE:(\{[^}]+\})/);
  if (updateMatch) {
    try { update = JSON.parse(updateMatch[1]); } catch(e) {}
    message = message.replace(/STEVE_UPDATE:\{[^}]+\}/, '').trim();
  }

  // STEVE_SESSION_SUMMARY
  const summaryMatch = text.match(/STEVE_SESSION_SUMMARY:(\{[\s\S]*?\})(?=\n|$)/);
  if (summaryMatch) {
    try { sessionSummary = JSON.parse(summaryMatch[1]); } catch(e) {}
    message = message.replace(/STEVE_SESSION_SUMMARY:\{[\s\S]*?\}(?=\n|$)/, '').trim();
  }

  // STEVE_MISSION_COMPLETE (puede haber varios)
  const missionRegex = /STEVE_MISSION_COMPLETE:(\{[^}]+\})/g;
  let mMatch;
  while ((mMatch = missionRegex.exec(text)) !== null) {
    try { missions.push(JSON.parse(mMatch[1])); } catch(e) {}
  }
  if (missions.length) {
    message = message.replace(/STEVE_MISSION_COMPLETE:\{[^}]+\}/g, '').trim();
  }

  return { message: message.trim(), steveData, update, sessionSummary, missions };
}

// ══════════════════════════════════════════════
// GUARDIA DE INGRESOS
// ══════════════════════════════════════════════
function blockIncome(text, phase, expensesCount) {
  if (phase >= 4 && expensesCount >= 1) return text;

  const triggers = [
    'cuánto ganas','cuanto ganas','cuánto recibes','cuanto recibes',
    'cuánto entra','cuanto entra','cuánto te pagan','cuanto te pagan',
    'ingreso mensual','ingreso al mes','cuánto es tu ingreso','cuanto es tu ingreso',
    'sueldo mensual','salario mensual','cuánto recibes de ingreso',
    'para poder ayudarte necesito','conocer tu ingreso'
  ];

  const lower = text.toLowerCase();
  const found = triggers.find(t => lower.includes(t));
  if (!found) return text;

  const corrections = {
    1: '¿Cuánto pagas de renta o hipoteca al mes y qué día del mes vence?',
    2: '¿Tienes suscripciones activas como Netflix, Spotify u otros servicios mensuales?',
    3: '¿Tienes tarjetas de crédito activas o algún crédito que estés pagando?'
  };
  const firstSentence = text.split(/[.!?]/)[0];
  const isShortEmpathetic = firstSentence.length < 80 && !triggers.some(t => firstSentence.toLowerCase().includes(t));
  const correction = corrections[Math.min(phase || 1, 3)];
  return isShortEmpathetic ? firstSentence + '. ' + correction : correction;
}

// ══════════════════════════════════════════════
// GUARDAR DATOS EN SUPABASE
// ══════════════════════════════════════════════
async function saveData(userId, steveData) {
  if (!steveData) return { saved: false };
  const saves = [];
  let savedTypes = [];

  if (steveData.financial) {
    const f = steveData.financial;
    const fields = {};
    if (f.income_monthly > 0) fields.income_monthly = f.income_monthly;
    if (f.rent > 0) fields.rent = f.rent;
    if (Object.keys(fields).length > 0) {
      fields.updated_at = new Date().toISOString();
      saves.push(supabase.from('financial_data').update(fields).eq('user_id', userId));
      if (f.income_monthly > 0) savedTypes.push('income');
    }
  }

  if (steveData.expenses && steveData.expenses.length > 0) {
    for (const e of steveData.expenses.filter(e => e.name && e.amount > 0)) {
      const ex = await supabase.from('expenses').select('id').eq('user_id', userId).eq('name', e.name).maybeSingle();
      const expData = {
        name: e.name,
        amount: e.amount,
        category: e.category || 'otros',
        frequency: e.frequency || 'mensual',
        due_day: e.due_day || null,
        priority: e.priority || 2,
        is_fixed: true,
        updated_at: new Date().toISOString()
      };
      if (ex.data) {
        saves.push(supabase.from('expenses').update(expData).eq('id', ex.data.id));
      } else {
        saves.push(supabase.from('expenses').insert({ user_id: userId, ...expData }));
      }
      savedTypes.push('expense');
    }
  }

  if (steveData.debts && steveData.debts.length > 0) {
    for (const d of steveData.debts.filter(d => d.name && d.total_amount > 0)) {
      const ex = await supabase.from('debts').select('id').eq('user_id', userId).eq('name', d.name).maybeSingle();
      const debtData = {
        name: d.name,
        total_amount: d.total_amount,
        minimum_payment: d.minimum_payment || 0,
        interest_rate: d.interest_rate || 0,
        debt_type: d.debt_type || 'otro',
        due_day: d.due_day || null,
        priority: d.priority || 2,
        is_active: true,
        updated_at: new Date().toISOString()
      };
      if (ex.data) {
        saves.push(supabase.from('debts').update(debtData).eq('id', ex.data.id));
      } else {
        saves.push(supabase.from('debts').insert({ user_id: userId, ...debtData }));
      }
      savedTypes.push('debt');
    }
  }

  if (saves.length > 0) {
    await Promise.allSettled(saves);

    // Recalcular total_fixed_expenses con frecuencias reales
    const { data: allExp } = await supabase.from('expenses').select('amount,frequency').eq('user_id', userId);
    if (allExp) {
      const totalMonthly = allExp.reduce((s, e) => {
        const mult = { bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083, quincenal: 2, semanal: 4.3 }[e.frequency] || 1;
        return s + (Number(e.amount) || 0) * mult;
      }, 0);
      await supabase.from('financial_data').update({ total_fixed_expenses: Math.round(totalMonthly), updated_at: new Date().toISOString() }).eq('user_id', userId);
    }
  }

  return { saved: saves.length > 0, types: savedTypes };
}

// ══════════════════════════════════════════════
// COMPLETAR MISIONES
// ══════════════════════════════════════════════
async function completeMissions(userId, missionIds, profile) {
  if (!missionIds.length) return;
  let totalXp = 0;

  for (const missionId of missionIds) {
    const { data: um } = await supabase
      .from('user_missions')
      .select('id, status, missions(xp_reward)')
      .eq('user_id', userId)
      .eq('mission_id', missionId)
      .maybeSingle();

    if (um && um.status === 'active') {
      const xp = um.missions?.xp_reward || 50;
      await supabase.from('user_missions').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        progress_pct: 100,
        xp_earned: xp
      }).eq('id', um.id);
      totalXp += xp;
    }
  }

  if (totalXp > 0) {
    await supabase.rpc('add_xp', { p_user_id: userId, p_xp: totalXp });
  }
}

// ══════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { messages, user_id, conversation_id } = req.body;
    if (!user_id || !messages?.length) return res.status(400).json({ error: 'Faltan datos' });

    // Cargar contexto completo
    const [pR, fR, dR, mR, expR, misR] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user_id).maybeSingle(),
      supabase.from('financial_data').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('debts').select('*').eq('user_id', user_id).eq('is_active', true).order('priority'),
      supabase.from('user_memory').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('expenses').select('*').eq('user_id', user_id).order('priority'),
      supabase.from('user_missions').select('*, missions(*)').eq('user_id', user_id).limit(15)
    ]);

    const profile  = pR.data  || {};
    const financial = fR.data || {};
    const debts    = dR.data  || [];
    const memory   = mR.data  || {};
    const expenses = expR.data || [];
    const missions = misR.data || [];
    const phase    = memory.onboarding_phase || 1;
    const name     = profile.full_name || 'amigo';

    // Calcular dinero libre con frecuencias reales
    const totalExpMonthly = expenses.reduce((s, e) => {
      const mult = { bimestral: 0.5, trimestral: 0.333, semestral: 0.167, anual: 0.083, quincenal: 2, semanal: 4.3 }[e.frequency] || 1;
      return s + (Number(e.amount) || 0) * mult;
    }, 0);
    const minPay = debts.reduce((s, d) => s + (Number(d.minimum_payment) || 0), 0);
    const freeCash = (Number(financial.income_monthly) || 0) - totalExpMonthly - minPay;

    // Resúmenes para el prompt
    const expSummary = expenses.length > 0
      ? expenses.map(e => `${e.name}: $${e.amount} ${e.frequency || 'mensual'}${e.due_day ? ' (día ' + e.due_day + ')' : ''}`).join(' | ')
      : 'Ninguno aún';

    const debtSummary = debts.length > 0
      ? debts.map(d => `${d.name}: $${d.total_amount} al ${d.interest_rate}% anual, mín $${d.minimum_payment}${d.due_day ? ' día ' + d.due_day : ''}`).join(' | ')
      : 'Ninguna aún';

    const activeMissions = missions.filter(m => m.status === 'active')
      .map(m => `${m.missions?.icon || ''} ${m.missions?.title} (+${m.missions?.xp_reward || 50} XP)`).join(', ') || 'Sin misiones activas';

    const phaseInstructions = {
      1: 'PASO 1 ACTIVO: Organizar gastos fijos esenciales. Empezar por renta. Capturar monto, frecuencia y día de vencimiento.',
      2: 'PASO 2 ACTIVO: Organizar gastos fijos no esenciales (suscripciones, membresías).',
      3: 'PASO 3 ACTIVO: Registrar deudas con saldo total, pago mínimo, tasa y día de corte. También registrar el pago mensual como gasto con category=pago_deuda.',
      4: 'PASO 4 ACTIVO: Ya puedes preguntar ingresos para completar el panorama financiero.',
      5: 'PASO 5 ACTIVO: Dar análisis completo con estrategias, prioridades y pasos concretos.'
    };

    const systemPrompt = BASE_PROMPT + `

CONTEXTO ACTUAL:
Nombre: ${name} | Fase: ${phase} | Sesiones: ${profile.sessions_count || 0} | XP: ${profile.xp_total || 0}
${phaseInstructions[Math.min(phase, 5)] || phaseInstructions[5]}

FINANZAS REGISTRADAS:
Ingreso mensual: $${Number(financial.income_monthly || 0).toLocaleString()} MXN
Gastos (${expenses.length}): ${expSummary}
Deudas (${debts.length}): ${debtSummary}
Total gastos/mes (normalizado): $${Math.round(totalExpMonthly).toLocaleString()} MXN
Dinero libre real: $${Math.max(0, freeCash).toLocaleString()} MXN/mes
Salud financiera: ${financial.health_score || 0}/100

MISIONES ACTIVAS: ${activeMissions}
Última sesión: ${memory.last_session_summary || 'Primera vez que hablan'}

RECUERDA: Solo incluye STEVE_DATA cuando el usuario haya confirmado explícitamente que quiere registrar el dato.`;

    // Llamar a Claude
    const aiRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 650,
      system: systemPrompt,
      messages: messages.slice(-20)
    });

    let rawText = aiRes.content[0].text;

    // Aplicar guardia de ingresos
    rawText = blockIncome(rawText, phase, expenses.length);

    const parsed = parseBlocks(rawText);

    // Guardar datos si los hay
    let saveResult = { saved: false, types: [] };
    if (parsed.steveData) {
      saveResult = await saveData(user_id, parsed.steveData);
    }

    // Completar misiones si las hay
    if (parsed.missions.length > 0) {
      await completeMissions(user_id, parsed.missions.map(m => m.mission_id), profile);
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

    if (parsed.update?.health_score) {
      updates.push(supabase.from('financial_data').update({
        health_score: parsed.update.health_score
      }).eq('user_id', user_id));
    }

    if (parsed.sessionSummary) {
      updates.push(supabase.from('user_memory').update({
        last_session_summary: parsed.sessionSummary.summary,
        next_session_hook: parsed.sessionSummary.next_session_hook,
        updated_at: new Date().toISOString()
      }).eq('user_id', user_id));
      updates.push(supabase.from('profiles').update({
        sessions_count: (profile.sessions_count || 0) + 1
      }).eq('id', user_id));
    }

    await Promise.allSettled(updates);

    // Si se guardaron datos, recargar datos frescos para el frontend
    let freshData = null;
    if (saveResult.saved || parsed.missions.length > 0) {
      const [fR2, dR2, eR2, pR2, misR2] = await Promise.all([
        supabase.from('financial_data').select('*').eq('user_id', user_id).maybeSingle(),
        supabase.from('debts').select('*').eq('user_id', user_id).eq('is_active', true).order('priority'),
        supabase.from('expenses').select('*').eq('user_id', user_id).order('priority'),
        supabase.from('profiles').select('xp_total,level,streak_days,messages_this_month').eq('id', user_id).maybeSingle(),
        supabase.from('user_missions').select('*, missions(*)').eq('user_id', user_id).limit(15)
      ]);
      freshData = {
        financial: fR2.data,
        debts: dR2.data || [],
        expenses: eR2.data || [],
        profile: pR2.data,
        missions: misR2.data || []
      };
    }

    return res.status(200).json({
      message: parsed.message,
      update: parsed.update,
      reload_data: saveResult.saved,
      fresh_data: freshData,
      saved_types: saveResult.types,
      missions_completed: parsed.missions
    });

  } catch (err) {
    console.error('Steve error:', err);
    return res.status(500).json({
      error: 'Error interno',
      message: 'Algo salió mal. Intenta de nuevo.'
    });
  }
};
