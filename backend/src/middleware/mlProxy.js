/**
 * Forward /api/ml/* to the FastAPI ML service (axios — avoids GET hang from raw req.pipe).
 * Mobile: API_BASE_URL + /ml/api/v1/health → http://host:5000/api/ml/api/v1/health
 */
import axios from 'axios';
import logger from '../utils/logger.js';

export default function createMlProxy() {
  const baseURL = (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
  const timeoutMs = parseInt(process.env.ML_PROXY_TIMEOUT_MS, 10) || 60_000;

  const toMlPath = (url = '/') => {
    const qIndex = url.indexOf('?');
    const pathPart = qIndex >= 0 ? url.slice(0, qIndex) : url;
    const queryPart = qIndex >= 0 ? url.slice(qIndex) : '';
    let path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
    if (!path.startsWith('/api/v1')) {
      path = `/api/v1${path}`;
    }
    return `${path}${queryPart}`;
  };

  return async (req, res) => {
    const targetUrl = `${baseURL}${toMlPath(req.url)}`;

    try {
      const response = await axios({
        method: req.method,
        url: targetUrl,
        data: req.body,
        headers: {
          accept: req.headers.accept || 'application/json',
          'content-type': req.headers['content-type'],
          authorization: req.headers.authorization,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
      });

      const contentType = response.headers['content-type'] || '';
      res.status(response.status);
      if (contentType.includes('application/json')) {
        return res.json(response.data);
      }
      return res.send(response.data);
    } catch (err) {
      const code = err.code || err.cause?.code;
      logger.warn('ML proxy upstream error', {
        message: err.message,
        code,
        target: targetUrl,
      });

      if (err.code === 'ECONNREFUSED' || code === 'ECONNREFUSED') {
        return res.status(502).json({
          success: false,
          message:
            'ML service is not running. Start it: cd ml-service && python -m uvicorn main:app --host 0.0.0.0 --port 8001',
        });
      }

      if (err.code === 'ECONNABORTED') {
        return res.status(504).json({
          success: false,
          message: 'ML service request timed out. Try restarting the ml-service process.',
        });
      }

      return res.status(502).json({
        success: false,
        message: err.message || 'ML service unreachable',
      });
    }
  };
}
