'use strict';

/**
 * Shared validation step check evaluator.
 * Supports legacy regex strings and structured object checks from the build agent.
 */

function evaluateCheck({ stdout = '', stderr = '', statusCode = null, httpOk = false }, check) {
  if (!check) return { ok: true };

  if (typeof check === 'string') {
    try {
      const re = new RegExp(check, 's');
      const hay = `${stdout}\n${stderr}`;
      return { ok: re.test(hay), error: re.test(hay) ? null : `output did not match /${check}/` };
    } catch (e) {
      return { ok: false, error: `invalid regex check: ${e.message}` };
    }
  }

  if (typeof check === 'object' && check !== null) {
    const hay = `${stdout}\n${stderr}`;
    if (check.contains && !hay.includes(check.contains)) {
      return { ok: false, error: `expected output to contain "${check.contains}"` };
    }
    if (check.statusOk && (!statusCode || statusCode >= 400 || !httpOk)) {
      return { ok: false, error: `expected HTTP 2xx/3xx, got ${statusCode || 'none'}` };
    }
    return { ok: true };
  }

  return { ok: false, error: `unsupported check type: ${typeof check}` };
}

module.exports = { evaluateCheck };
