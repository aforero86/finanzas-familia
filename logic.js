// Lógica pura de saldos (sin interfaz). Se puede probar aparte.
(function (root) {
  const EPS = 0.005;
  const round = (n) => Math.round(n * 100) / 100;

  // ---------- Deudas entre dos adultos ----------
  // mov: {id,tipo:'deuda'|'pago'|'condonacion', deudor, acreedor, monto, moneda, fecha, aplica:[{deudaId,monto}], anulado}
  function debtStatus(movs) {
    const activos = movs.filter((m) => !m.anulado);
    const deudas = activos.filter((m) => m.tipo === "deuda");
    const aplicado = {};
    for (const m of activos) {
      if (m.tipo === "deuda") continue;
      for (const a of m.aplica || []) aplicado[a.deudaId] = (aplicado[a.deudaId] || 0) + a.monto;
    }
    return deudas.map((d) => {
      const abonado = round(aplicado[d.id] || 0);
      return { ...d, abonado, saldo: round(Math.max(0, d.monto - abonado)) };
    });
  }

  // Saldo neto desde el punto de vista de `yo`: >0 me deben, <0 debo. Por moneda.
  function netBalance(movs, yo) {
    const out = {};
    for (const d of debtStatus(movs)) {
      if (d.saldo < EPS) continue;
      const s = d.acreedor === yo ? d.saldo : -d.saldo;
      out[d.moneda] = round((out[d.moneda] || 0) + s);
    }
    return out;
  }

  const byDate = (a, b) => (a.fecha || "").localeCompare(b.fecha || "") || (a.creadoEn || 0) - (b.creadoEn || 0);

  function fifo(debts, amount) {
    const res = [];
    let left = amount;
    for (const d of [...debts].sort(byDate)) {
      if (left < EPS) break;
      const x = round(Math.min(d.saldo, left));
      if (x > 0) res.push({ deudaId: d.id, monto: x });
      left = round(left - x);
    }
    return { aplica: res, sobrante: round(left) };
  }

  // Liquidar varias deudas (en ambos sentidos) con un solo pago.
  // selected: deudas (con saldo) de una misma moneda. pago: monto que realmente se paga (null = el neto).
  function planSettlement(selected, yo, otro, pago) {
    const debo = selected.filter((d) => d.deudor === yo);
    const meDeben = selected.filter((d) => d.deudor === otro);
    const sDebo = round(debo.reduce((s, d) => s + d.saldo, 0));
    const sMeDeben = round(meDeben.reduce((s, d) => s + d.saldo, 0));
    const cruce = round(Math.min(sDebo, sMeDeben));
    const neto = round(Math.abs(sDebo - sMeDeben));
    const pagador = sDebo > sMeDeben ? yo : sMeDeben > sDebo ? otro : null;
    const p = pago == null ? neto : round(Math.max(0, pago));
    const ladoMayor = pagador === yo ? debo : meDeben;
    const ladoMenor = pagador === yo ? meDeben : debo;
    let aplica = [];
    // lado menor queda totalmente cubierto por el cruce
    if (pagador) {
      aplica = ladoMenor.map((d) => ({ deudaId: d.id, monto: d.saldo }));
      const r = fifo(ladoMayor, round(cruce + p));
      aplica = aplica.concat(r.aplica);
      return { pagador, receptor: pagador === yo ? otro : yo, neto, cruce, pago: p, aplica, excedente: r.sobrante };
    }
    // empatados: todo se cruza; si además se paga algo es excedente
    aplica = selected.map((d) => ({ deudaId: d.id, monto: d.saldo }));
    return { pagador: null, receptor: null, neto: 0, cruce, pago: p, aplica, excedente: p };
  }

  // ---------- Cuentas de los niños ----------
  // mov: {tipo:'deposito'|'retiro'|'rendimiento'|'ajuste', moneda, monto(+/- en ajuste), custodio, anulado}
  const signo = (m) => (m.tipo === "retiro" ? -1 : 1);
  function kidBalances(movs) {
    const total = {}, porCustodio = {};
    for (const m of movs) {
      if (m.anulado) continue;
      const v = signo(m) * m.monto;
      total[m.moneda] = round((total[m.moneda] || 0) + v);
      const c = m.custodio || "—";
      porCustodio[c] = porCustodio[c] || {};
      porCustodio[c][m.moneda] = round((porCustodio[c][m.moneda] || 0) + v);
    }
    return { total, porCustodio };
  }

  // ---------- Mercado: análisis de compras ----------
  // compra: {id, fecha, tienda, total, moneda, items:[{descripcion, producto, categoria, cantidad, unidad, total}]}
  const ym = (s) => (s || "").slice(0, 7);
  function prevMonths(mes, n) { const [y, m] = mes.split("-").map(Number); const out = []; for (let i = 1; i <= n; i++) { const d = new Date(y, m - 1 - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); } return out; }
  // corte: día del mes hasta el que se compara (para el mes en curso: comparar "a la misma fecha")
  function marketStats(compras, mes, corte = 31) {
    const delFull = (m) => compras.filter((c) => ym(c.fecha) === m);
    const del = (m) => delFull(m).filter((c) => +c.fecha.slice(8, 10) <= corte);
    const sum = (cs) => round(cs.reduce((s, c) => s + (c.total || 0), 0));
    const catOf = (cs) => { const o = {}; for (const c of cs) for (const it of c.items || []) o[it.categoria || "Otros"] = round((o[it.categoria || "Otros"] || 0) + (it.total || 0)); return o; };
    const actual = del(mes), prev = prevMonths(mes, 3);
    const totalMes = sum(actual), totalAnt = sum(del(prev[0]));
    const cats = catOf(actual);
    const prevCats = prev.map((m) => catOf(del(m)));
    const mesesConDatos = prev.filter((m) => del(m).length).length || 1;
    const categorias = Object.keys({ ...cats, ...Object.assign({}, ...prevCats) }).map((k) => {
      const prom = round(prevCats.reduce((s, o) => s + (o[k] || 0), 0) / mesesConDatos);
      return { categoria: k, total: cats[k] || 0, promedio: prom, variacion: prom ? round(((cats[k] || 0) - prom) / prom * 100) : null };
    }).filter((c) => c.total > 0 || c.promedio > 0).sort((a, b) => b.total - a.total);
    // productos en los últimos 90 días hasta fin del mes
    const fin = mes + "-31", ini = new Date(new Date(mes + "-01T00:00") - 60 * 864e5).toISOString().slice(0, 10);
    const ventana = compras.filter((c) => c.fecha >= ini && c.fecha <= fin).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const prods = {};
    for (const c of ventana) for (const it of c.items || []) {
      const k = (it.producto || it.descripcion || "").toLowerCase().trim(); if (!k) continue;
      const p = (prods[k] = prods[k] || { producto: k, categoria: it.categoria, veces: 0, gasto: 0, fechas: [], precios: [] });
      p.gasto = round(p.gasto + (it.total || 0));
      if (p.fechas[p.fechas.length - 1] !== c.fecha) { p.veces++; p.fechas.push(c.fecha); }
      const q = it.cantidad > 0 ? it.cantidad : 1;
      if (it.total > 0) p.precios.push({ fecha: c.fecha, unit: round(it.total / q), unidad: it.unidad || "un" });
    }
    const lista = Object.values(prods).map((p) => {
      let cada = null;
      if (p.fechas.length > 1) { const d = (new Date(p.fechas[p.fechas.length - 1]) - new Date(p.fechas[0])) / 864e5; cada = Math.round(d / (p.fechas.length - 1)); }
      let cambio = null;
      if (p.precios.length > 1) { const a = p.precios[p.precios.length - 2], b = p.precios[p.precios.length - 1]; if (a.unidad === b.unidad && a.unit > 0) cambio = { antes: a.unit, ahora: b.unit, pct: round((b.unit - a.unit) / a.unit * 100), fecha: b.fecha }; }
      return { ...p, cada, cambio };
    });
    const frecuentes = [...lista].sort((a, b) => b.veces - a.veces || b.gasto - a.gasto).slice(0, 8);
    const topGasto = [...lista].sort((a, b) => b.gasto - a.gasto).slice(0, 8);
    const precios = lista.filter((p) => p.cambio && Math.abs(p.cambio.pct) >= 5).sort((a, b) => Math.abs(b.cambio.pct) - Math.abs(a.cambio.pct)).slice(0, 8);
    const serie = [...prevMonths(mes, 5).reverse(), mes].map((m) => ({ mes: m, total: sum(delFull(m)) }));
    return { mes, corte, totalMes, totalAnt, varMes: totalAnt ? round((totalMes - totalAnt) / totalAnt * 100) : null, compras: actual.length,
      ticket: actual.length ? round(totalMes / actual.length) : 0, categorias, frecuentes, topGasto, precios, serie };
  }

  const api = { marketStats, prevMonths, debtStatus, netBalance, planSettlement, fifo, kidBalances, round, signo, EPS };
  if (typeof module !== "undefined") module.exports = api;
  else root.Logic = api;
})(typeof window !== "undefined" ? window : globalThis);
