function jsonResponse(res, status, detail, requestId) {
  return res.status(status).json({ detail, request_id: requestId });
}

function isJsonContentType(contentType) {
  return typeof contentType === 'string'
    && /^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType);
}

export async function proxyAgentRequest(req, res, {
  serviceUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8100',
  fetchImpl = globalThis.fetch,
  logger = console,
  timeoutMs = 120_000,
} = {}) {
  const requestId = req.requestId || 'unknown';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let serviceOrigin = 'invalid';

  try {
    const serviceBaseUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(serviceUrl)
      ? serviceUrl
      : `http://${serviceUrl}`;
    const base = new URL(serviceBaseUrl);
    serviceOrigin = base.origin;
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/api/v1${req.path}`;
    base.search = req.url.slice(req.path.length);

    const headers = { 'X-Request-ID': requestId };
    const authorization = req.get('authorization');
    if (authorization) headers.Authorization = authorization;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetchImpl(base, {
      method: req.method,
      headers,
      ...(req.method === 'GET' || req.method === 'HEAD'
        ? {}
        : { body: JSON.stringify(req.body || {}) }),
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type');
    if (!isJsonContentType(contentType)) {
      logger.error(JSON.stringify({
        event: 'ai_agent_upstream_invalid_content_type',
        request_id: requestId,
        endpoint: req.path,
        service_origin: serviceOrigin,
        upstream_status: response.status,
        content_type: contentType || 'missing',
      }));
      return jsonResponse(res, 502, 'The AI agent service returned an invalid response.', requestId);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      logger.error(JSON.stringify({
        event: 'ai_agent_upstream_invalid_json',
        request_id: requestId,
        endpoint: req.path,
        service_origin: serviceOrigin,
        upstream_status: response.status,
      }));
      return jsonResponse(res, 502, 'The AI agent service returned an invalid response.', requestId);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      logger.error(JSON.stringify({
        event: 'ai_agent_upstream_invalid_payload',
        request_id: requestId,
        endpoint: req.path,
        service_origin: serviceOrigin,
        upstream_status: response.status,
      }));
      return jsonResponse(res, 502, 'The AI agent service returned an invalid response.', requestId);
    }

    res.set('X-Request-ID', requestId);
    return res.status(response.status).json(payload);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    const causeCode = typeof error?.cause?.code === 'string' ? error.cause.code : undefined;
    logger.error(JSON.stringify({
      event: 'ai_agent_upstream_request_failed',
      request_id: requestId,
      endpoint: req.path,
      service_origin: serviceOrigin,
      error_type: error instanceof Error ? error.name : 'unknown',
      error_code: causeCode || (timedOut ? 'ETIMEDOUT' : 'UNKNOWN'),
    }));
    return jsonResponse(
      res,
      timedOut ? 504 : 503,
      timedOut
        ? 'The AI agent request timed out. Please try again.'
        : 'The AI agent service is unavailable.',
      requestId,
    );
  } finally {
    clearTimeout(timeout);
  }
}
