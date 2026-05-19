const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY });

const BASE_PROMPT = `Eres Steve, asesor financiero personal para Latinoamérica. Empático, directo, nunca juzgas.

FORMATO:
- Máximo 3 oraciones, UNA pregunta al final
- Sin markdown ni listas
- Usa siempre el nombre del usuario
- Entiende modismos: "varos", "lana", "el depa", "me cae", "quincena"

CONOCIMIENTO: Regla 50/30/20, avalancha, bola de nieve, fondo emergencia 3-6 meses, CAT México 40-80%, CFE siempre bimestral.

════════════════════════════════════════════
INSTRUCCIÓN CRÍTICA — LEER CON ATENCIÓN:
════════════════════════════════════════════
Cuando el usuario mencione CUALQUIER dato con monto, DEBES incluir STEVE_DATA en tu respuesta.
El STEVE_DATA va AL FINAL de tu mensaje, siempre.
Sin STEVE_DATA el dato NO se guarda. Si no lo incluyes, fallaste.

CUÁNDO incluir STEVE_DATA:
✓ Usuario da monto + concepto → incluir STEVE_DATA
✓ Usuario da fecha de pago → incluir STEVE_DATA con due_day
✓ Usuario confirma un dato → incluir STEVE_DATA
✗ Usuario pregunta algo → NO incluir STEVE_DATA
✗ Dato ambiguo sin monto → preguntar primero

FORMATO OBLIGATORIO DE RESPUESTA cuando hay datos:
[Tu respuesta en 1-3 oraciones]
STEVE_DATA:{...}
STEVE_UPDATE:{...}

EJEMPLOS — EXACTAMENTE ASÍ DEBES RESPONDER:

INPUT: "mi renta son 5 mil el 15"
OUTPUT:
Listo [nombre], renta de $5,000 mensual el día 15 anotada. ¿Tienes más gastos fijos?
STEVE_DATA:{"expenses":[{"name":"Renta","amount":5000,"category":"renta","frequency":"mensual","due_day":15}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"renta registrada"}

INPUT: "pago el depa el quince, son 5 varos"
OUTPUT:
$5,000 de renta el día 15 anotado [nombre]. ¿Y la luz o servicios?
STEVE_DATA:{"expenses":[{"name":"Renta","amount":5000,"category":"renta","frequency":"mensual","due_day":15}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"casual","insight":"renta registrada"}

INPUT: "la luz me cae bimestral como de 600 el día 15"
OUTPUT:
Luz CFE de $600 bimestral el día 15 registrada [nombre], son $300 mensuales reales. ¿Tienes gas o agua por separado?
STEVE_DATA:{"expenses":[{"name":"Luz CFE","amount":600,"category":"servicios","frequency":"bimestral","due_day":15}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"luz registrada"}

INPUT: "tengo tarjeta Banamex, pago 1200 el día 23"
OUTPUT:
Pago tarjeta Banamex de $1,200 el día 23 registrado [nombre]. ¿Sabes el saldo total y la tasa de interés?
STEVE_DATA:{"expenses":[{"name":"Pago tarjeta Banamex","amount":1200,"category":"pago_deuda","frequency":"mensual","due_day":23}],"debts":[],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"tarjeta registrada"}

INPUT: "solo agregala a recordatorio de pago"
OUTPUT:
Listo [nombre], tarjeta Banamex con pago el día 23 anotada para recordatorio. ¿Me falta capturar algún otro gasto?
STEVE_DATA:{"expenses":[{"name":"Pago tarjeta Banamex","amount":1200,"category":"pago_deuda","frequency":"mensual","due_day":23}],"debts":[],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"tarjeta en recordatorio"}

INPUT: "banamex me cobra 1200 el 23"
OUTPUT:
Pago tarjeta Banamex de $1,200 el día 23 registrado [nombre]. ¿Tienes más tarjetas o créditos activos?
STEVE_DATA:{"expenses":[{"name":"Pago tarjeta Banamex","amount":1200,"category":"pago_deuda","frequency":"mensual","due_day":23}],"debts":[],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"tarjeta registrada"}

INPUT: "gano 15 quincenales"
OUTPUT:
Ingreso de $15,000 quincenal registrado [nombre], que son $30,000 al mes. Con tus gastos actuales puedo calcular tu dinero libre. ¿Seguimos?
STEVE_DATA:{"expenses":[],"financial":{"income_monthly":30000}}
STEVE_UPDATE:{"phase":4,"tone":"neutro","insight":"ingreso registrado"}

INPUT: "la natación de mi hija la pago el día 13"
OUTPUT:
Natación hija con vencimiento el día 13 actualizada [nombre]. ¿Cuánto pagas mensualmente?
STEVE_DATA:{"expenses":[{"name":"Natación hija","amount":0,"category":"salud","frequency":"mensual","due_day":13}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"fecha natación actualizada"}

INPUT: "netflix spotify y dazn los pago el día 1"
OUTPUT:
Netflix, Spotify y Dazn actualizados al día 1 [nombre]. ¿Tienes alguna otra suscripción?
STEVE_DATA:{"expenses":[{"name":"Netflix","amount":0,"category":"entretenimiento","frequency":"mensual","due_day":1},{"name":"Spotify","amount":0,"category":"entretenimiento","frequency":"mensual","due_day":1},{"name":"Dazn","amount":0,"category":"entretenimiento","frequency":"mensual","due_day":1}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"suscripciones actualizadas"}

════════════════════════════════════════════
REGLAS DEL STEVE_DATA:
════════════════════════════════════════════
- amount:0 si solo actualizas fecha de algo ya registrado
- Incluye TODOS los gastos mencionados en un mensaje en UN solo STEVE_DATA
- financial:{} si no hay ingreso nuevo, financial:{"income_monthly":N} si hay ingreso
- SIEMPRE al final del mensaje, nunca en medio
- Si el usuario dice "solo para recordatorio" o "sin datos completos" → registra con lo que tengas

CATEGORÍAS: renta, servicios, alimentacion, transporte, salud, educacion, entretenimiento, ropa, pago_deuda, ahorro, inversion, negocio, otros
FRECUENCIAS: mensual, bimestral, trimestral, semestral, anual, quincenal, semanal
CFE/luz/electricidad = bimestral siempre

════════════════════════════════════════════
BLOQUES ESPECIALES:
════════════════════════════════════════════
STEVE_DATA:{"expenses":[{"name":"Nombre","amount":0,"category":"categoria","frequency":"mensual","due_day":null}],"debts":[{"name":"Nombre","total_amount":0,"minimum_payment":0,"interest_rate":0,"debt_type":"tarjeta_credito","due_date":null}],"financial":{"income_monthly":0}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"frase breve"}
STEVE_MISSION:m-003
STEVE_END:{"summary":"máx 60 palabras","hook":"frase cálida"}`;


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


// ═══════════════════════════════════════════════════════
// EXTRACTOR DIRECTO — detecta datos del mensaje del usuario
// sin depender de que Claude genere STEVE_DATA
// ═══════════════════════════════════════════════════════
function extractDataFromUser(userMsg, existingExpenses) {
  const text = userMsg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const expenses = [];
  const financial = {};

  // ── DETECTAR MONTO ──
  function getMonto(str) {
    const numWords = {'uno':1,'dos':2,'tres':3,'cuatro':4,'cinco':5,'seis':6,'siete':7,'ocho':8,'nueve':9,'diez':10,'quince':15,'veinte':20};
    let s = str;
    Object.entries(numWords).forEach(([w,n]) => { s = s.replace(new RegExp('\\b'+w+'\\b','g'), String(n)); });
    const patterns = [
      /\$\s*([\d,]+)/,
      /([\d,]+)\s*(?:pesos|varos|lana|mxn)/,
      /([\d]+)\s*mil(?!\s*\d)/,
      /(?:^|[^\d])(\d{3,6})(?:[^\d]|$)/,
      /(?:^|[^\d])(\d{2,6})(?:[^\d]|$)/
    ];
    for (const p of patterns) {
      const m = s.match(p);
      if (m) {
        let n = (m[1]||'').replace(/[, ]/g,'');
        if (p.source.includes('mil')) n = String(parseFloat(n)*1000);
        const v = parseFloat(n);
        if (v >= 50 && v <= 500000) return v;
      }
    }
    return 0;
  }

  // ── DETECTAR DÍA ──
  function getDia(str) {
    const m = str.match(/d[iíi]a\s*(\d{1,2})|el\s+(\d{1,2})\s+de\s+cada|cada\s+(\d{1,2})|el\s+(\d{1,2})\s+(?:de\s+)?(?:cada\s+)?mes/i);
    if (m) return parseInt(m[1]||m[2]||m[3]||m[4]);
    if (/quince|el 15|d[iíi]a 15/.test(str)) return 15;
    if (/primero|el 1[^0-9]|d[iíi]a 1[^0-9]/.test(str)) return 1;
    if (/ultimo|fin de mes|dia 30/.test(str)) return 30;
    return null;
  }

  // ── DETECTAR FRECUENCIA ──
  function getFreq(str) {
    if (/bimestral|cada dos meses|cada 2 meses|cada bimestre/.test(str)) return 'bimestral';
    if (/quincenal|cada quincena|cada 15 dias/.test(str)) return 'quincenal';
    if (/trimestral|cada tres meses/.test(str)) return 'trimestral';
    if (/semestral|cada seis meses/.test(str)) return 'semestral';
    if (/anual|al año|una vez al año/.test(str)) return 'anual';
    return 'mensual';
  }

  // ── CONCEPTOS A DETECTAR ──
  const conceptos = [
    {keys:['renta','depa','departamento','hipoteca','arriendo','alquiler'], name:'Renta', cat:'renta', freq:'mensual'},
    {keys:['luz','cfe','electricidad','electric'], name:'Luz CFE', cat:'servicios', freq:'bimestral'},
    {keys:['agua'], name:'Agua', cat:'servicios', freq:'mensual'},
    {keys:['gas'], name:'Gas', cat:'servicios', freq:'mensual'},
    {keys:['internet','wifi','telmex','izzi','totalplay','megacable'], name:'Internet', cat:'servicios', freq:'mensual'},
    {keys:['celular','telcel','att','movistar','bait'], name:'Celular', cat:'servicios', freq:'mensual'},
    {keys:['colegiatura','colegio','escuela','kinder','preescolar'], name:'Colegiatura', cat:'educacion', freq:'mensual'},
    {keys:['universidad','tec','unam'], name:'Universidad', cat:'educacion', freq:'mensual'},
    {keys:['netflix'], name:'Netflix', cat:'entretenimiento', freq:'mensual'},
    {keys:['spotify'], name:'Spotify', cat:'entretenimiento', freq:'mensual'},
    {keys:['dazn'], name:'Dazn', cat:'entretenimiento', freq:'mensual'},
    {keys:['disney'], name:'Disney+', cat:'entretenimiento', freq:'mensual'},
    {keys:['amazon prime'], name:'Amazon Prime', cat:'entretenimiento', freq:'mensual'},
    {keys:['gym','gimnasio','crossfit'], name:'Gym', cat:'salud', freq:'mensual'},
    {keys:['natacion','natación'], name:'Natación', cat:'salud', freq:'mensual'},
    {keys:['banamex','citibanamex'], name:'Pago tarjeta Banamex', cat:'pago_deuda', freq:'mensual'},
    {keys:['bbva','bancomer'], name:'Pago tarjeta BBVA', cat:'pago_deuda', freq:'mensual'},
    {keys:['santander'], name:'Pago tarjeta Santander', cat:'pago_deuda', freq:'mensual'},
    {keys:['banorte'], name:'Pago tarjeta Banorte', cat:'pago_deuda', freq:'mensual'},
    {keys:['hsbc'], name:'Pago tarjeta HSBC', cat:'pago_deuda', freq:'mensual'},
    {keys:['liverpool','palacio','suburbia'], name:'Pago tarjeta departamental', cat:'pago_deuda', freq:'mensual'},
    {keys:['seguro'], name:'Seguro', cat:'salud', freq:'mensual'},
    {keys:['gasolina','gas station','bencina'], name:'Gasolina', cat:'transporte', freq:'mensual'},
    {keys:['uber','didi','cabify'], name:'Transporte', cat:'transporte', freq:'mensual'},
  ];

  // Para cada concepto detectado, buscar monto y día en ventana cercana
  for (const c of conceptos) {
    const keyFound = c.keys.find(k => text.includes(k));
    if (!keyFound) continue;

    const keyIdx = text.indexOf(keyFound);
    const ventana = text.slice(Math.max(0, keyIdx-120), Math.min(text.length, keyIdx+120));

    const monto = getMonto(ventana) || getMonto(text); // fallback al texto completo
    const dia = getDia(ventana) || getDia(text);
    const freq = getFreq(ventana) || c.freq;

    // Buscar si ya existe este gasto (fuzzy)
    const existing = existingExpenses.find(e =>
      e.name.toLowerCase().includes(keyFound) ||
      keyFound.includes(e.name.toLowerCase().split(' ')[0])
    );

    const expName = existing ? existing.name : c.name;
    const expAmount = monto || (existing ? existing.amount : 0);

    expenses.push({
      name: expName,
      amount: expAmount,
      category: c.cat,
      frequency: freq,
      due_day: dia
    });
  }

  // Detectar ingreso
  if (/gano|ingreso|sueldo|salario|quincena|me depositan|me pagan/.test(text)) {
    const monto = getMonto(text);
    const freq = getFreq(text);
    if (monto > 0) {
      const monthly = freq === 'quincenal' ? monto * 2 : freq === 'semanal' ? monto * 4.3 : monto;
      financial.income_monthly = Math.round(monthly);
    }
  }

  if (expenses.length === 0 && Object.keys(financial).length === 0) return null;
  return { expenses, financial };
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

    // Usar STEVE_DATA de Claude si existe, sino extraer del mensaje del usuario
    let steveDataFinal = parsed.steveData;
    let debugInfo = { claudeHadData: !!parsed.steveData, extractorRan: false, lastMsg: '', extracted: null };

    if (!steveDataFinal) {
      const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
      debugInfo.lastMsg = lastUserMsg.slice(0, 80);
      const extracted = extractDataFromUser(lastUserMsg, expenses);
      debugInfo.extracted = extracted;
      debugInfo.extractorRan = true;
      if (extracted && (extracted.expenses.length > 0 || extracted.financial?.income_monthly)) {
        steveDataFinal = extracted;
      }
    }

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
      reload_data: saveResult.types.length > 0,
      _debug: debugInfo
    });

  } catch(err) {
    console.error('Steve error:', err);
    return res.status(500).json({ error: 'Error interno', message: 'Algo salió mal. Intenta de nuevo.' });
  }
};
