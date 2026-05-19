const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY });

const BASE_PROMPT = `Eres Steve, asesor financiero personal con IA para México. Eres ese amigo experto en finanzas: empático, honesto, directo y nunca juzgas.

CONOCIMIENTO FINANCIERO QUE APLICAS:
- Regla 50/30/20: 50% necesidades, 30% deseos, 20% ahorro/deudas
- Método avalancha: pagar primero la deuda con mayor tasa de interés
- Método bola de nieve: pagar primero la deuda más pequeña para ganar impulso
- Fondo de emergencia: mínimo 3-6 meses de gastos
- CAT real en México: tarjetas 40-80% anual, créditos personales 20-50%
- INFONAVIT, AFORE, SAR, Buró de Crédito
- Quincenas los días 15 y último de mes
- CFE (luz) es BIMESTRAL por defecto

PERSONALIDAD Y FORMATO:
- Máximo 3 oraciones por respuesta
- UNA sola pregunta por mensaje
- Sin markdown, sin listas, sin bullets
- Usa siempre el nombre del usuario
- Valida emoción primero, luego dato
- Celebra cada avance genuinamente
- Cuando termines un tema: "¿Seguimos con el siguiente paso o tienes alguna duda?"

════════════════════════════════════
REGLA CRÍTICA — CONFIRMACIÓN ANTES DE REGISTRAR:
════════════════════════════════════
Cuando el usuario mencione CUALQUIER dato financiero, DEBES:
1. Confirmar el dato brevemente
2. Preguntar "¿Lo registro ahora?"
Solo incluyes STEVE_DATA cuando el usuario confirme ("sí", "va", "ándele", "registra", "claro", etc.)
NUNCA incluyas STEVE_DATA sin confirmación explícita.

FRECUENCIAS — MUY IMPORTANTE:
La luz/CFE es BIMESTRAL por defecto. Si el usuario no especifica, pregunta.
Frecuencias soportadas: mensual, bimestral, trimestral, semestral, anual, quincenal, semanal
Guarda el monto REAL tal como lo dice el usuario (ej: $800 bimestral, NO lo conviertas).

DÍA DE VENCIMIENTO — CRÍTICO:
Cuando el usuario mencione una fecha de pago ("vence el 5", "pago el 15", "día 20"), 
SIEMPRE incluye due_day en el STEVE_DATA aunque el gasto ya exista.
Si el usuario da fecha de un gasto ya registrado, re-registra el gasto completo con la fecha.
Ejemplo: usuario dice "la renta vence el día 5" → STEVE_DATA con name:"Renta", amount:[monto que ya tienes], due_day:5

CATEGORÍAS DE GASTOS:
renta, servicios, alimentacion, transporte, salud, educacion, entretenimiento, ropa, pago_deuda, ahorro, inversion, negocio, otros

PAGO DE TARJETA — CRÍTICO, DOS REGISTROS OBLIGATORIOS:
Cuando el usuario mencione una tarjeta de crédito, SIEMPRE registras DOS cosas en el mismo STEVE_DATA:
1. La DEUDA: saldo total, pago mínimo, tasa de interés, día de corte → va en "debts"
2. El GASTO MENSUAL: el pago mínimo como gasto fijo con category="pago_deuda" → va en "expenses"

Ejemplo si usuario dice "tengo Banamex con $45,000 de saldo, pago $2,200 mínimo, tasa 45%, corte día 20":
STEVE_DATA:{"expenses":[{"name":"Pago tarjeta Banamex","amount":2200,"category":"pago_deuda","frequency":"mensual","due_day":20}],"debts":[{"name":"Tarjeta Banamex","total_amount":45000,"minimum_payment":2200,"interest_rate":45,"debt_type":"tarjeta_credito","due_day":20}],"financial":{}}

FLUJO DE ORGANIZACIÓN (respeta este orden):
PASO 1: Gastos fijos esenciales con monto + frecuencia + día de vencimiento
PASO 2: Gastos fijos no esenciales (suscripciones)
PASO 3: Deudas (saldo, mínimo, tasa, día de corte) + registrar pago como gasto
PASO 4: Ingresos (SOLO después de pasos 1-3)
PASO 5: Análisis y estrategia personalizada

PROHIBIDO preguntar ingresos antes de completar pasos 1-3.

════════════════════════════════════
MISIONES — SE COMPLETAN AUTOMÁTICAMENTE:
════════════════════════════════════
Steve detecta cuando el usuario cumple condiciones y completa misiones:
- Primer gasto registrado → STEVE_MISSION:m-003
- Primer ingreso registrado → STEVE_MISSION:m-002
- Primera deuda registrada → STEVE_MISSION:m-005
- 3 gastos registrados (el backend lo verifica) → misión m-007
- Consulta de compra detectada → STEVE_MISSION:m-008
- Pregunta sobre salud financiera → STEVE_MISSION:m-006

════════════════════════════════════
BLOQUES ESPECIALES (el frontend los procesa, el usuario no los ve):
════════════════════════════════════

REGISTRO (solo con confirmación del usuario):
STEVE_DATA:{"expenses":[{"name":"Nombre","amount":800,"category":"servicios","frequency":"bimestral","due_day":15}],"debts":[{"name":"Banamex","total_amount":45000,"minimum_payment":2200,"interest_rate":45,"debt_type":"tarjeta_credito","due_day":20}],"financial":{"income_monthly":0}}

Puedes incluir varios expenses y/o debts en un solo STEVE_DATA.
Para tarjeta: incluye TANTO el debt (saldo) COMO el expense (pago mensual con category="pago_deuda").

ESTADO (siempre al final de cada respuesta):
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"frase breve"}

MISIÓN COMPLETADA (cuando aplique):
STEVE_MISSION:m-003

CIERRE DE SESIÓN:
STEVE_END:{"summary":"máx 60 palabras","hook":"frase cálida para la próxima sesión"}`;

function parseBlocks(text) {
  let msg = text;
  let steveData = null, update = null, end = null, missions = [];

  // STEVE_DATA — regex más permisivo
  const dm = text.match(/STEVE_DATA:(\{[\s\S]*?\})(?=\nSTEVE_|\n\n|$|\s*$)/);
  if (dm) {
    try { steveData = JSON.parse(dm[1]); } catch(e) {
      // Intentar reparar JSON truncado
      try { steveData = JSON.parse(dm[1] + '}}'); } catch(e2) {}
    }
    msg = msg.replace(/STEVE_DATA:\{[\s\S]*?\}(?=\nSTEVE_|\n\n|$|\s*$)/, '').trim();
  }

  const um = text.match(/STEVE_UPDATE:(\{[^}]+\})/);
  if (um) { try { update = JSON.parse(um[1]); } catch(e) {} msg = msg.replace(/STEVE_UPDATE:\{[^}]+\}/, '').trim(); }

  const em = text.match(/STEVE_END:(\{[\s\S]*?\})(?=\n|$)/);
  if (em) { try { end = JSON.parse(em[1]); } catch(e) {} msg = msg.replace(/STEVE_END:\{[\s\S]*?\}(?=\n|$)/, '').trim(); }

  const mReg = /STEVE_MISSION:(m-\d+)/g;
  let mm;
  while ((mm = mReg.exec(text)) !== null) missions.push(mm[1]);
  if (missions.length) msg = msg.replace(/STEVE_MISSION:m-\d+/g, '').trim();

  return { msg: msg.trim(), steveData, update, end, missions };
}

function blockIncome(text, phase, expCount) {
  if (phase >= 4 && expCount >= 1) return text;
  const triggers = ['cuánto ganas','cuanto ganas','ingreso mensual','sueldo','salario mensual','cuánto recibes','cuanto recibes','cuánto entra','cuanto entra'];
  const lower = text.toLowerCase();
  if (!triggers.find(t => lower.includes(t))) return text;
  const fixes = {
    1: '¿Cuánto pagas de renta o hipoteca al mes y qué día del mes vence?',
    2: '¿Tienes suscripciones activas como Netflix, Spotify u otros servicios?',
    3: '¿Tienes tarjetas de crédito activas o algún crédito que estés pagando?'
  };
  return fixes[Math.min(phase || 1, 3)];
}

async function saveData(userId, steveData) {
  if (!steveData) return { types: [] };
  const saves = [], types = [];

  if (steveData.financial?.income_monthly > 0) {
    saves.push(supabase.from('financial_data').update({ income_monthly: steveData.financial.income_monthly, updated_at: new Date().toISOString() }).eq('user_id', userId));
    types.push('income');
  }

  for (const e of (steveData.expenses || []).filter(x => x.name && x.amount > 0)) {
    const { data: ex } = await supabase.from('expenses').select('id').eq('user_id', userId).eq('name', e.name).maybeSingle();
    const row = {
      name: e.name,
      amount: e.amount,
      category: e.category || 'otros',
      frequency: e.frequency || 'mensual',
      due_day: e.due_day !== undefined ? e.due_day : null,
      updated_at: new Date().toISOString()
    };
    if (ex) {
      // Actualizar TODOS los campos incluyendo due_day
      saves.push(supabase.from('expenses').update(row).eq('id', ex.id));
    } else {
      saves.push(supabase.from('expenses').insert({ user_id: userId, ...row }));
    }
    types.push('expense');
  }

  for (const d of (steveData.debts || []).filter(x => x.name && x.total_amount > 0)) {
    const { data: ex } = await supabase.from('debts').select('id').eq('user_id', userId).eq('name', d.name).maybeSingle();
    const row = { name: d.name, total_amount: d.total_amount, minimum_payment: d.minimum_payment || 0, interest_rate: d.interest_rate || 0, debt_type: d.debt_type || 'tarjeta_credito', due_day: d.due_day || null, is_active: true, updated_at: new Date().toISOString() };
    if (ex) saves.push(supabase.from('debts').update(row).eq('id', ex.id));
    else saves.push(supabase.from('debts').insert({ user_id: userId, ...row }));
    types.push('debt');
  }

  if (saves.length) {
    await Promise.allSettled(saves);
    // Recalcular total_fixed_expenses normalizado a mensual
    const { data: allExp } = await supabase.from('expenses').select('amount,frequency').eq('user_id', userId);
    if (allExp) {
      const mult = { bimestral:0.5, trimestral:0.333, semestral:0.167, anual:0.083, quincenal:2, semanal:4.3 };
      const total = allExp.reduce((s,e) => s + (Number(e.amount)||0) * (mult[e.frequency]||1), 0);
      await supabase.from('financial_data').update({ total_fixed_expenses: Math.round(total), updated_at: new Date().toISOString() }).eq('user_id', userId);
    }
  }
  return { types };
}

async function completeMissions(userId, missionIds) {
  let xpTotal = 0;
  for (const mid of missionIds) {
    const { data: um } = await supabase.from('user_missions').select('id,status,missions(xp_reward)').eq('user_id', userId).eq('mission_id', mid).maybeSingle();
    if (um?.status === 'active') {
      const xp = um.missions?.xp_reward || 50;
      await supabase.from('user_missions').update({ status: 'completed', completed_at: new Date().toISOString(), progress_pct: 100, xp_earned: xp }).eq('id', um.id);
      xpTotal += xp;
    }
  }
  if (xpTotal > 0) await supabase.rpc('add_xp', { p_user_id: userId, p_xp: xpTotal });
  return xpTotal;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { messages, user_id, conversation_id } = req.body;
    if (!user_id || !messages?.length) return res.status(400).json({ error: 'Faltan datos' });

    const [pR, fR, dR, mR, expR, misR] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user_id).maybeSingle(),
      supabase.from('financial_data').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('debts').select('*').eq('user_id', user_id).eq('is_active', true).order('interest_rate', { ascending: false }),
      supabase.from('user_memory').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('expenses').select('*').eq('user_id', user_id).order('created_at', { ascending: true }),
      supabase.from('user_missions').select('*, missions(*)').eq('user_id', user_id)
    ]);

    const profile  = pR.data  || {};
    const financial = fR.data || {};
    const debts    = dR.data  || [];
    const memory   = mR.data  || {};
    const expenses = expR.data || [];
    const missions = misR.data || [];
    const phase    = memory.onboarding_phase || 1;
    const name     = profile.full_name || 'amigo';

    const multMap = { bimestral:0.5, trimestral:0.333, semestral:0.167, anual:0.083, quincenal:2, semanal:4.3 };
    const totalExpMensual = expenses.reduce((s,e) => s + (Number(e.amount)||0) * (multMap[e.frequency]||1), 0);
    const minPay = debts.reduce((s,d) => s + (Number(d.minimum_payment)||0), 0);
    const freeCash = (Number(financial.income_monthly)||0) - totalExpMensual - minPay;

    const expSummary = expenses.length
      ? expenses.map(e => `${e.name}: $${e.amount} ${e.frequency||'mensual'}${e.due_day?' (día '+e.due_day+')':''}`).join(' | ')
      : 'Ninguno aún';
    const debtSummary = debts.length
      ? debts.map(d => `${d.name}: $${d.total_amount} al ${d.interest_rate||0}% anual, mín $${d.minimum_payment||0}${d.due_day?' día '+d.due_day:''}`).join(' | ')
      : 'Ninguna aún';
    const activeMis = missions.filter(m => m.status === 'active').map(m => `${m.missions?.title} (+${m.missions?.xp_reward||50} XP)`).join(', ') || 'Sin misiones activas';

    const phases = {
      1: 'PASO 1 ACTIVO: Organizar gastos fijos esenciales. Empezar por renta, luego luz/agua/gas, internet, teléfono.',
      2: 'PASO 2 ACTIVO: Gastos fijos no esenciales (suscripciones, membresías).',
      3: 'PASO 3 ACTIVO: Deudas. Saldo, pago mínimo, tasa, día de corte. También registrar el pago mínimo como gasto con category=pago_deuda.',
      4: 'PASO 4 ACTIVO: Ya puedes preguntar ingresos.',
      5: 'PASO 5 ACTIVO: Análisis completo y estrategia personalizada (avalancha o bola de nieve según el perfil).'
    };

    const system = BASE_PROMPT + `\n\nCONTEXTO:
Nombre: ${name} | Fase: ${phase} | Sesiones: ${profile.sessions_count||0} | XP: ${profile.xp_total||0}
${phases[Math.min(phase,5)]||phases[5]}
Gastos registrados (${expenses.length}): ${expSummary}
Deudas registradas (${debts.length}): ${debtSummary}
Ingreso mensual: $${Number(financial.income_monthly||0).toLocaleString()} MXN
Total gastos/mes (normalizado): $${Math.round(totalExpMensual).toLocaleString()} MXN
Dinero libre real: $${Math.max(0,freeCash).toLocaleString()} MXN
Salud financiera: ${financial.health_score||0}/100
Misiones activas: ${activeMis}
Última sesión: ${memory.last_session_summary||'Primera vez'}`;

    const aiRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 650,
      system,
      messages: messages.slice(-20)
    });

    let raw = aiRes.content[0].text;
    raw = blockIncome(raw, phase, expenses.length);
    const parsed = parseBlocks(raw);

    // Guardar datos si los hay
    let saveResult = { types: [] };
    if (parsed.steveData) saveResult = await saveData(user_id, parsed.steveData);

    // Misiones del mensaje + verificar misión de 3 gastos
    let missionIds = [...parsed.missions];
    if (saveResult.types.includes('expense')) {
      const { count } = await supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('user_id', user_id);
      if (count >= 3) missionIds.push('m-007');
    }
    if (missionIds.length) await completeMissions(user_id, [...new Set(missionIds)]);

    // Actualizar memoria y perfil
    const updates = [
      supabase.from('profiles').update({ messages_this_month: (profile.messages_this_month||0)+1, updated_at: new Date().toISOString() }).eq('id', user_id)
    ];
    if (parsed.update?.phase && parsed.update.phase !== phase) {
      updates.push(supabase.from('user_memory').update({ onboarding_phase: parsed.update.phase, updated_at: new Date().toISOString() }).eq('user_id', user_id));
    }
    if (parsed.end) {
      updates.push(
        supabase.from('user_memory').update({ last_session_summary: parsed.end.summary, next_session_hook: parsed.end.hook, updated_at: new Date().toISOString() }).eq('user_id', user_id),
        supabase.from('profiles').update({ sessions_count: (profile.sessions_count||0)+1 }).eq('id', user_id)
      );
    }
    await Promise.allSettled(updates);

    // Datos frescos para el frontend
    let fresh = null;
    if (saveResult.types.length > 0 || missionIds.length > 0) {
      const [fR2, dR2, eR2, pR2, misR2] = await Promise.all([
        supabase.from('financial_data').select('*').eq('user_id', user_id).maybeSingle(),
        supabase.from('debts').select('*').eq('user_id', user_id).eq('is_active', true).order('interest_rate', { ascending: false }),
        supabase.from('expenses').select('*').eq('user_id', user_id).order('created_at', { ascending: true }),
        supabase.from('profiles').select('xp_total,level,streak_days,messages_this_month').eq('id', user_id).maybeSingle(),
        supabase.from('user_missions').select('*, missions(*)').eq('user_id', user_id)
      ]);
      fresh = { financial: fR2.data, debts: dR2.data||[], expenses: eR2.data||[], profile: pR2.data, missions: misR2.data||[] };
    }

    return res.status(200).json({
      message: parsed.msg,
      update: parsed.update,
      saved_types: saveResult.types,
      missions_completed: missionIds,
      fresh_data: fresh,
      reload_data: saveResult.types.length > 0
    });

  } catch(err) {
    console.error('Steve error:', err);
    return res.status(500).json({ error: 'Error interno', message: 'Algo salió mal. Intenta de nuevo.' });
  }
};
