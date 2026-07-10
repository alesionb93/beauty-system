/**
 * Helper centralizado de datas — imune a TZ/locale do runner.
 *
 * Regras:
 *   - Toda data usada nos testes DEVE passar por este helper.
 *   - Nunca usar `new Date()` direto dentro de um spec.
 *   - Saída sempre em formato ISO `YYYY-MM-DD`, que é o `.value`
 *     nativo de `<input type="date">` em qualquer locale.
 *
 * Truque: `toLocaleDateString('en-CA', { timeZone })` devolve
 * exatamente `YYYY-MM-DD` — mais limpo e seguro que `padStart`
 * manual a partir de `getFullYear/getMonth/getDate`, que dependem
 * do timezone do processo (UTC no GitHub Actions).
 */

const TZ_PADRAO = 'America/Sao_Paulo';

function _iso(date, tz = TZ_PADRAO) {
  return date.toLocaleDateString('en-CA', { timeZone: tz });
}

/** Hoje no fuso de São Paulo, em `YYYY-MM-DD`. */
function hoje(tz = TZ_PADRAO) {
  return _iso(new Date(), tz);
}

/** Hoje + N dias (N pode ser negativo) no fuso de SP, em `YYYY-MM-DD`. */
function diasAFrente(n, tz = TZ_PADRAO) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n); // soma puramente numérica, sem efeito de DST
  return _iso(d, tz);
}

/** Alias semântico para datas no passado. */
function diasAtras(n, tz = TZ_PADRAO) {
  return diasAFrente(-n, tz);
}

module.exports = { hoje, diasAFrente, diasAtras, TZ_PADRAO };
