const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY });

// ─── PARSER ───────────────────────────────────────────────
function extractJSON(text, marker) {
  const idx = text.indexOf(marker + ':{');
  if (idx === -1) return null;
  const start = idx + marker.length + 1;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function parseBlocks(text) {
  let msg = text, steveData = null, update = null, missions = [];
  const dj = extractJSON(text, 'STEVE_DATA');
  if (dj) { try { steveData = JSON.parse(dj); } catch(e) {} msg = msg.replace('STEVE_DATA:' + dj, '').trim(); }
  const uj = extractJSON(text, 'STEVE_UPDATE');
  if (uj) { try { update = JSON.parse(uj); } catch(e) {} msg = msg.replace('STEVE_UPDATE:' + uj, '').trim(); }
  const mr = /STEVE_MISSION:(m-\d+)/g; let mm;
  while ((mm = mr.exec(text)) !== null) missions.push(mm[1]);
  if (missions.length) msg = msg.replace(/STEVE_MISSION:m-\d+/g, '').trim();
  return { msg: msg.trim(), steveData, update, missions };
}

// ─── EXTRACTOR DIRECTO ────────────────────────────────────
function extractFromUser(userMsg, existingExpenses) {
  const text = userMsg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const expenses = [];

  function getMonto(str) {
    const p = [/\$\s*([\d,]+)/, /([\d,]+)\s*(?:pesos|varos|lana)/, /([\d]+)\s*mil(?!\s*\d)/, /(?:^|[^\d])(\d{3,6})(?:[^\d]|$)/];
    for (const rx of p) {
      const m = str.match(rx);
      if (m) {
        let n = (m[1]||'').replace(/,/g,'');
        if (rx.source.includes('mil')) n = String(parseFloat(n)*1000);
        const v = parseFloat(n);
        if (v >= 50 && v <= 500000) return v;
      }
    }
    return 0;
  }

  function getDia(str) {
    const m = str.match(/dia\s*(\d{1,2})|el\s+(\d{1,2})\s+de\s+cada|el\s+(\d{1,2})\s+(?:de\s+)?(?:cada\s+)?mes/i);
    if (m) return parseInt(m[1]||m[2]||m[3]);
    if (/quince|el 15/.test(str)) return 15;
    if (/primero|el 1[^0-9]/.test(str)) return 1;
    return null;
  }

  const conceptos = [
    {keys:['renta','depa','departamento','hipoteca'], name:'Renta', cat:'renta', freq:'mensual'},
    {keys:['luz','cfe','electricidad'], name:'Luz CFE', cat:'servicios', freq:'bimestral'},
    {keys:['agua'], name:'Agua', cat:'servicios', freq:'mensual'},
    {keys:['gas'], name:'Gas', cat:'servicios', freq:'mensual'},
    {keys:['internet','wifi','telmex','izzi'], name:'Internet', cat:'servicios', freq:'mensual'},
    {keys:['celular','telcel','att','movistar'], name:'Celular', cat:'servicios', freq:'mensual'},
    {keys:['colegiatura','colegio','escuela'], name:'Colegiatura', cat:'educacion', freq:'mensual'},
    {keys:['netflix'], name:'Netflix', cat:'entretenimiento', freq:'mensual'},
    {keys:['spotify'], name:'Spotify', cat:'entretenimiento', freq:'mensual'},
    {keys:['dazn'], name:'Dazn', cat:'entretenimiento', freq:'mensual'},
    {keys:['disney'], name:'Disney+', cat:'entretenimiento', freq:'mensual'},
    {keys:['gym','gimnasio'], name:'Gym', cat:'salud', freq:'mensual'},
    {keys:['natacion','natación'], name:'Natación', cat:'salud', freq:'mensual'},
    {keys:['banamex','citibanamex'], name:'Pago tarjeta Banamex', cat:'pago_deuda', freq:'mensual'},
    {keys:['bbva','bancomer'], name:'Pago tarjeta BBVA', cat:'pago_deuda', freq:'mensual'},
    {keys:['santander'], name:'Pago tarjeta Santander', cat:'pago_deuda', freq:'mensual'},
    {keys:['banorte'], name:'Pago tarjeta Banorte', cat:'pago_deuda', freq:'mensual'},
    {keys:['hsbc'], name:'Pago tarjeta HSBC', cat:'pago_deuda', freq:'mensual'},
    {keys:['seguro'], name:'Seguro', cat:'salud', freq:'mensual'},
    {keys:['gasolina'], name:'Gasolina', cat:'transporte', freq:'mensual'},
  ];

  for (const c of conceptos) {
    const key = c.keys.find(k => text.includes(k));
    if (!key) continue;
    const keyIdx = text.indexOf(key);
    const win = text.slice(Math.max(0, keyIdx-100), Math.min(text.length, keyIdx+100));
    const monto = getMonto(win) || getMonto(text);
    const dia = getDia(win) || getDia(text);
    const freq = /bimestral|cada dos meses/.test(win) ? 'bimestral' : /quincenal/.test(win) ? 'quincenal' : c.freq;
    const existing = (existingExpenses||[]).find(e => e.name.toLowerCase().includes(key));
    expenses.push({
      name: existing ? existing.name : c.name,
      amount: monto || (existing ? existing.amount : 0),
      category: c.cat,
      frequency: freq,
      due_day: dia
    });
  }

  if (!expenses.length) return null;
  return { expenses, financial: {} };
}

// ─── GUARDAR DATOS ────────────────────────────────────────
async function saveData(userId, data) {
  if (!data) return [];
  const saved = [];

  // Ingreso
  if (data.financial?.income_monthly > 0) {
    await supabase.from('financial_data').update({ income_monthly: data.financial.income_monthly, updated_at: new Date().toISOString() }).eq('user_id', userId);
    saved.push('income');
  }

  // Gastos
  for (const e of (data.expenses || []).filter(x => x.name)) {
    // Buscar exacto
    let { data: ex } = await supabase.from('expenses').select('id,amount').eq('user_id', userId).eq('name', e.name).maybeSingle();
    // Buscar fuzzy
    if (!ex) {
      const { data: fz } = await supabase.from('expenses').select('id,amount').eq('user_id', userId).ilike('name', '%' + e.name.split(' ')[0] + '%').maybeSingle();
      if (fz) ex = fz;
    }
    const row = { name: e.name, category: e.category || 'otros', frequency: e.frequency || 'mensual', updated_at: new Date().toISOString() };
    if (e.amount > 0) row.amount = e.amount;
    if (e.due_day != null) row.due_day = e.due_day;

    if (ex) {
      await supabase.from('expenses').update(row).eq('id', ex.id);
    } else {
      if (!e.amount || e.amount <= 0) continue;
      await supabase.from('expenses').insert({ user_id: userId, ...row, amount: e.amount });
    }
    saved.push('expense');
  }

  // Deudas
  for (const d of (data.debts || []).filter(x => x.name && x.total_amount > 0)) {
    let { data: ex } = await supabase.from('debts').select('id').eq('user_id', userId).eq('name', d.name).maybeSingle();
    const row = { name: d.name, total_amount: d.total_amount, minimum_payment: d.minimum_payment || 0, interest_rate: d.interest_rate || 0, debt_type: d.debt_type || 'tarjeta_credito', is_active: true, priority: 1, updated_at: new Date().toISOString() };
    if (d.due_day != null) row.due_date = d.due_day;
    if (d.due_date != null) row.due_date = d.due_date;
    if (ex) await supabase.from('debts').update(row).eq('id', ex.id);
    else await supabase.from('debts').insert({ user_id: userId, ...row });
    saved.push('debt');
  }

  return saved;
}

// ─── PROMPT ───────────────────────────────────────────────
const PROMPT = `Eres Steve, asesor financiero personal para Latinoamérica. Empático, directo, nunca juzgas.

FORMATO: Máximo 3 oraciones. UNA pregunta al final. Sin markdown. Usa el nombre del usuario.
Entiende modismos: "varos", "lana", "el depa", "me cae", "quincena", "me cobran".

REGLA MÁS IMPORTANTE:
Cuando el usuario dé cualquier dato financiero con monto O fecha, incluye STEVE_DATA al final.
NO pidas confirmación si el dato es claro. Registra y confirma en el mismo mensaje.

EJEMPLOS DE RESPUESTA CORRECTA:

Usuario: "mi renta son 5 mil el 15"
Steve: Listo Giovanni, renta de $5,000 el día 15 anotada. ¿Tienes más gastos fijos?
STEVE_DATA:{"expenses":[{"name":"Renta","amount":5000,"category":"renta","frequency":"mensual","due_day":15}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"renta registrada"}

Usuario: "banamex me cobra 1200 el 23"
Steve: Pago tarjeta Banamex de $1,200 el día 23 registrado Giovanni. ¿Sabes el saldo total?
STEVE_DATA:{"expenses":[{"name":"Pago tarjeta Banamex","amount":1200,"category":"pago_deuda","frequency":"mensual","due_day":23}],"debts":[],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"tarjeta registrada"}

Usuario: "la natación vence el 13"
Steve: Natación hija actualizada al día 13 Giovanni. ¿Cuánto pagas mensualmente?
STEVE_DATA:{"expenses":[{"name":"Natación hija","amount":0,"category":"salud","frequency":"mensual","due_day":13}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"fecha natación"}

Usuario: "netflix spotify y dazn los pago el 1"
Steve: Netflix, Spotify y Dazn actualizados al día 1 Giovanni. ¿Tienes más suscripciones?
STEVE_DATA:{"expenses":[{"name":"Netflix","amount":0,"category":"entretenimiento","frequency":"mensual","due_day":1},{"name":"Spotify","amount":0,"category":"entretenimiento","frequency":"mensual","due_day":1},{"name":"Dazn","amount":0,"category":"entretenimiento","frequency":"mensual","due_day":1}],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"suscripciones con fecha"}

CATEGORÍAS: renta, servicios, alimentacion, transporte, salud, educacion, entretenimiento, ropa, pago_deuda, ahorro, inversion, negocio, otros
FRECUENCIAS: mensual, bimestral, trimestral, semestral, anual, quincenal. CFE/luz = bimestral siempre.

BLOQUES AL FINAL DE CADA RESPUESTA CON DATOS:
STEVE_DATA:{"expenses":[{"name":"...","amount":0,"category":"...","frequency":"mensual","due_day":null}],"debts":[],"financial":{}}
STEVE_UPDATE:{"phase":1,"tone":"neutro","insight":"..."}`;

// ─── HANDLER PRINCIPAL ────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { messages, user_id } = req.body;
    if (!user_id || !messages?.length) return res.status(400).json({ error: 'Faltan datos' });

    // Cargar contexto
    const [pR, fR, dR, eR] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user_id).maybeSingle(),
      supabase.from('financial_data').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('debts').select('*').eq('user_id', user_id).eq('is_active', true),
      supabase.from('expenses').select('*').eq('user_id', user_id).order('due_day', { ascending: true, nullsFirst: false }),
    ]);

    const profile = pR.data || {};
    const financial = fR.data || {};
    const debts = dR.data || [];
    const expenses = eR.data || [];
    const name = profile.full_name || 'amigo';

    const expCtx = expenses.length
      ? expenses.map(e => `${e.name}: $${e.amount} ${e.frequency||'mensual'}${e.due_day?' día '+e.due_day:' SIN FECHA'}`).join(' | ')
      : 'Ninguno';

    const system = PROMPT + `\n\nCONTEXTO ACTUAL:
Nombre: ${name}
Gastos registrados (${expenses.length}): ${expCtx}
Deudas (${debts.length}): ${debts.map(d=>`${d.name} $${d.total_amount}`).join(', ')||'Ninguna'}
Ingreso mensual: $${financial.income_monthly||0}`;

    // Llamar a Claude
    const aiRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system,
      messages: messages.slice(-15)
    });

    const raw = aiRes.content[0].text;
    const parsed = parseBlocks(raw);

    // Intentar guardar — primero con STEVE_DATA de Claude, sino con extractor
    let toSave = parsed.steveData;
    const debug = { claudeData: !!parsed.steveData, extractor: false };

    if (!toSave) {
      const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';
      const extracted = extractFromUser(lastUser, expenses);
      if (extracted) { toSave = extracted; debug.extractor = true; }
    }

    const savedTypes = await saveData(user_id, toSave);

    // Leer datos frescos
    const [fR2, dR2, eR2, mR2] = await Promise.all([
      supabase.from('financial_data').select('*').eq('user_id', user_id).maybeSingle(),
      supabase.from('debts').select('*').eq('user_id', user_id).eq('is_active', true),
      supabase.from('expenses').select('*').eq('user_id', user_id).order('due_day', { ascending: true, nullsFirst: false }),
      supabase.from('user_missions').select('*,missions(*)').eq('user_id', user_id),
    ]);

    return res.status(200).json({
      message: parsed.msg,
      update: parsed.update,
      saved_types: savedTypes,
      fresh_data: {
        financial: fR2.data,
        debts: dR2.data || [],
        expenses: eR2.data || [],
        missions: mR2.data || [],
      },
      reload_data: savedTypes.length > 0,
      _debug: debug
    });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(200).json({
      message: 'Algo salió mal, intenta de nuevo.',
      saved_types: [],
      fresh_data: null,
      reload_data: false,
      _debug: { error: err.message }
    });
  }
};
