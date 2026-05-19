const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY });

const BASE_PROMPT = `Eres Steve, el mejor asesor financiero personal con IA para Latinoamérica. Eres ese amigo de confianza que sabe de finanzas: empático, directo, honesto, nunca juzgas.

PERSONALIDAD:
- Máximo 3 oraciones por respuesta, UNA pregunta al final
- Sin markdown, sin listas, sin bullets
- Usa siempre el nombre del usuario
- Entiende como habla la gente real: "varos", "lana", "feria", "quincena", "el depa", "me cae", "me cobran"
- Celebra cada avance genuinamente

CONOCIMIENTO FINANCIERO:
- Regla 50/30/20, método avalancha, bola de nieve
- Fondo de emergencia: 3-6 meses de gastos
- CAT México: tarjetas 40-80% anual
- INFONAVIT, AFORE, CETES, Buró de Crédito
- CFE (luz/electricidad): SIEMPRE bimestral por defecto
- Quincenas: días 15 y último de mes

════════════════════════════════════════════
TU FUNCIÓN MÁS IMPORTANTE: REGISTRAR DATOS
════════════════════════════════════════════
Cuando el usuario mencione CUALQUIER dato financiero con monto, DEBES incluir STEVE_DATA en tu respuesta.
No pidas permiso. No preguntes "¿lo registro?". Registra y confirma en el mismo mensaje.

SOLO pregunta cuando falte el monto:
- "pago luz" → "¿Cuánto te cae el recibo?"
- "tengo tarjeta" → "¿Cuánto pagas de mínimo?"

EJEMPLOS OBLIGATORIOS — así debes responder:

Usuario: "mi renta son 5 mil el 15"
Steve: "Listo [nombre], renta de $5,000 mensual el día 15 anotada. ¿Tienes más gastos fijos?"
STEVE_DATA:{"expenses":[{"name":"Renta","amount":5000,"category":"renta","frequency":"mensual","due_day":15}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"renta registrada"}

Usuario: "pago el depa el quince, son 5 varos"
Steve: "Perfecto [nombre], $5,000 de renta cada mes el día 15, anotado. ¿Y la luz o servicios?"
STEVE_DATA:{"expenses":[{"name":"Renta","amount":5000,"category":"renta","frequency":"mensual","due_day":15}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"casual","insight":"renta con fecha"}

Usuario: "la luz me cae bimestral como de 600 el día 15"
Steve: "Luz CFE de $600 bimestral el día 15 registrada [nombre]. Son $300 mensuales reales en tu presupuesto. ¿Tienes gas o agua por separado?"
STEVE_DATA:{"expenses":[{"name":"Luz CFE","amount":600,"category":"servicios","frequency":"bimestral","due_day":15}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"luz bimestral"}

Usuario: "banamex me cobra 1200 el 23"
Steve: "Pago tarjeta Banamex de $1,200 el día 23 registrado [nombre]. ¿Sabes cuánto es el saldo total de la tarjeta y la tasa de interés?"
STEVE_DATA:{"expenses":[{"name":"Pago tarjeta Banamex","amount":1200,"category":"pago_deuda","frequency":"mensual","due_day":23}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"pago tarjeta"}

Usuario: "necesito recordatorio para mi renta que pago el 15, son 5000, y la luz bimestral de 600 también el 15"
Steve: "Listo [nombre], renta de $5,000 el día 15 y luz CFE de $600 bimestral el día 15, ambas anotadas. ¿Tienes más gastos o deudas?"
STEVE_DATA:{"expenses":[{"name":"Renta","amount":5000,"category":"renta","frequency":"mensual","due_day":15},{"name":"Luz CFE","amount":600,"category":"servicios","frequency":"bimestral","due_day":15}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"renta y luz registradas"}

Usuario: "gano 15 quincenales"
Steve: "Ingreso de $15,000 quincenal registrado [nombre], que son $30,000 al mes. Con tus gastos actuales te quedan $X libres. ¿Seguimos?"
STEVE_DATA:{"expenses":[],"financial":{"income_monthly":30000}}
STEVE_UPDATE:{"phase":4,"tone":"neutro","insight":"ingreso registrado"}

Usuario: "la colegiatura vence el 5"
Steve: "Anotado [nombre], colegiatura con vencimiento el día 5 de cada mes. ¿Cuánto pagas?"
STEVE_DATA:{"expenses":[{"name":"Colegiatura hija","amount":0,"category":"educacion","frequency":"mensual","due_day":5}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"fecha colegiatura actualizada"}

════════════════════════════════════════════
REGLAS DEL STEVE_DATA:
════════════════════════════════════════════
- amount:0 si solo actualizas la fecha de algo ya existente
- Incluye TODOS los gastos mencionados en un mismo mensaje en un solo STEVE_DATA
- financial solo si hay ingreso nuevo
- Para tarjetas con saldo conocido: incluir también en debts
- Frecuencias: mensual, bimestral, trimestral, semestral, anual, quincenal, semanal

CATEGORÍAS: renta, servicios, alimentacion, transporte, salud, educacion, entretenimiento, ropa, pago_deuda, ahorro, inversion, negocio, otros

════════════════════════════════════════════
BLOQUES ESPECIALES:
════════════════════════════════════════════
STEVE_DATA:{"expenses":[{"name":"Nombre","amount":0,"category":"categoria","frequency":"mensual","due_day":null}],"debts":[{"name":"Nombre","total_amount":0,"minimum_payment":0,"interest_rate":0,"debt_type":"tarjeta_credito","due_day":null}],"financial":{"income_monthly":0}}

STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"frase breve"}

STEVE_MISSION:m-003

STEVE_END:{"summary":"máx 60 palabras","hook":"frase cálida para la próxima sesión"}`;


// Parser robusto: extrae JSON balanceado sin importar lo que venga después
function extractJSON(text, marker) {
  const idx = text.indexOf(marker + ':{');
  if (idx === -1) return null;
  const start = idx + marker.length + 1;
  let depth = 0, inStr = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === '\\' && inStr) { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function parseBlocks(text) {
  let msg = text;
  let steveData = null, update = null, end = null, missions = [];

  const dataJson = extractJSON(text, 'STEVE_DATA');
  if (dataJson) {
    try { steveData = JSON.parse(dataJson); } catch(e) {}
    msg = msg.replace('STEVE_DATA:' + dataJson, '').trim();
  }

  const updJson = extractJSON(text, 'STEVE_UPDATE');
  if (updJson) {
    try { update = JSON.parse(updJson); } catch(e) {}
    msg = msg.replace('STEVE_UPDATE:' + updJson, '').trim();
  }

  const endJson = extractJSON(text, 'STEVE_END');
  if (endJson) {
    try { end = JSON.parse(endJson); } catch(e) {}
    msg = msg.replace('STEVE_END:' + endJson, '').trim();
  }

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
    saves.push(supabase.from('financial_data').update({
      income_monthly: steveData.financial.income_monthly,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId));
    types.push('income');
  }

  for (const e of (steveData.expenses || []).filter(x => x.name)) {
    // Buscar por nombre exacto primero, luego fuzzy (contiene)
    let { data: ex } = await supabase.from('expenses').select('id,name,amount')
      .eq('user_id', userId).eq('name', e.name).maybeSingle();

    if (!ex) {
      // Buscar si existe con nombre similar (ej: "Colegiatura" vs "Colegiatura hija")
      const { data: fuzzy } = await supabase.from('expenses').select('id,name,amount')
        .eq('user_id', userId)
        .ilike('name', '%' + e.name.split(' ')[0] + '%')
        .maybeSingle();
      if (fuzzy) ex = fuzzy;
    }

    const row = {
      name: e.name,
      category: e.category || 'otros',
      frequency: e.frequency || 'mensual',
      updated_at: new Date().toISOString()
    };
    // Solo actualizar amount si viene con valor > 0
    if (e.amount > 0) row.amount = e.amount;
    // Siempre actualizar due_day si viene definido (aunque sea null para borrarlo)
    if (e.due_day !== undefined) row.due_day = e.due_day;

    if (ex) {
      saves.push(supabase.from('expenses').update(row).eq('id', ex.id));
    } else {
      if (!e.amount || e.amount <= 0) continue; // No crear sin monto
      saves.push(supabase.from('expenses').insert({ user_id: userId, ...row, amount: e.amount }));
    }
    types.push('expense');
  }

  for (const d of (steveData.debts || []).filter(x => x.name)) {
    let { data: ex } = await supabase.from('debts').select('id')
      .eq('user_id', userId).eq('name', d.name).eq('is_active', true).maybeSingle();

    if (!ex) {
      const { data: fuzzy } = await supabase.from('debts').select('id')
        .eq('user_id', userId).eq('is_active', true)
        .ilike('name', '%' + d.name.split(' ')[0] + '%').maybeSingle();
      if (fuzzy) ex = fuzzy;
    }

    const row = {
      name: d.name,
      minimum_payment: d.minimum_payment || 0,
      interest_rate: d.interest_rate || 0,
      debt_type: d.debt_type || 'tarjeta_credito',
      is_active: true,
      priority: 1,
      updated_at: new Date().toISOString()
    };
    if (d.total_amount > 0) row.total_amount = d.total_amount;
    // debts usa due_date (no due_day)
    if (d.due_day !== undefined && d.due_day !== null) row.due_date = d.due_day;
    if (d.due_date !== undefined && d.due_date !== null) row.due_date = d.due_date;

    if (ex) {
      saves.push(supabase.from('debts').update(row).eq('id', ex.id));
    } else {
      if (!d.total_amount || d.total_amount <= 0) continue;
      saves.push(supabase.from('debts').insert({ user_id: userId, ...row, total_amount: d.total_amount }));
    }
    types.push('debt');
  }

  if (saves.length) {
    await Promise.allSettled(saves);
    const { data: allExp } = await supabase.from('expenses').select('amount,frequency').eq('user_id', userId);
    if (allExp) {
      const mult = { bimestral:.5, trimestral:.333, semestral:.167, anual:.083, quincenal:2, semanal:4.3 };
      const total = allExp.reduce((s,e) => s + (Number(e.amount)||0) * (mult[e.frequency]||1), 0);
      await supabase.from('financial_data').update({
        total_fixed_expenses: Math.round(total),
        updated_at: new Date().toISOString()
      }).eq('user_id', userId);
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

    // LOG para debug en Vercel
    console.log('RAW:', raw.slice(0, 200));
    console.log('STEVE_DATA encontrado:', !!parsed.steveData);

    let steveDataFinal = parsed.steveData;

    // Guardar datos si los hay
    let saveResult = { types: [] };
    if (steveDataFinal) saveResult = await saveData(user_id, steveDataFinal);

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

    // Siempre enviar datos frescos para mantener el panel sincronizado
    const [fR2, dR2, eR2, pR2, misR2] = await Promise.all([
      supabase.from('financial_data').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('debts').select('*').eq('user_id', user_id).eq('is_active', true).order('interest_rate', { ascending: false }),
      supabase.from('expenses').select('*').eq('user_id', user_id).order('created_at', { ascending: true }),
      supabase.from('profiles').select('xp_total,level,streak_days,messages_this_month').eq('id', user_id).maybeSingle(),
      supabase.from('user_missions').select('*, missions(*)').eq('user_id', user_id)
    ]);
    const fresh = { financial: fR2.data, debts: dR2.data||[], expenses: eR2.data||[], profile: pR2.data, missions: misR2.data||[] };

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
