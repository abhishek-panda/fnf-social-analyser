import axios from 'axios';
import { logger } from './logger';

/**
 * Attaches axios interceptors that log every outbound HTTP request
 * and its response (or error) to logs/http.log.
 * Access tokens are redacted in the log output.
 * Call once at app startup.
 */
export function attachHttpLogger(): void {
  axios.interceptors.request.use((config) => {
    const params = sanitiseParams(config.params);
    const url = buildUrl(config.baseURL, config.url);

    logger.http('HTTP Request', {
      method: config.method?.toUpperCase(),
      url,
      params,
      body: config.data ?? undefined,
      curl: buildCurl(config.method?.toUpperCase() ?? 'GET', url, params),
    });

    return config;
  });

  axios.interceptors.response.use(
    (response) => {
      logger.http('HTTP Response', {
        method: response.config.method?.toUpperCase(),
        url: response.config.url,
        status: response.status,
        data: response.data,
      });
      return response;
    },
    (error) => {
      if (axios.isAxiosError(error)) {
        logger.error('HTTP Error', {
          method: error.config?.method?.toUpperCase(),
          url: error.config?.url,
          body: error.config?.data,
          status: error.response?.status,
          response: error.response?.data,
          message: error.message,
        });
      } else {
        logger.error('HTTP Error (non-axios)', { message: String(error) });
      }
      return Promise.reject(error);
    }
  );
}

function buildUrl(baseURL: string | undefined, url: string | undefined): string {
  if (baseURL && url) return `${baseURL}${url}`;
  return url ?? baseURL ?? 'unknown';
}

function sanitiseParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  return params ?? {};
}

function buildCurl(method: string, url: string, params: Record<string, unknown>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `curl -X ${method} "${url}${qs ? '?' + qs : ''}"`;
}
