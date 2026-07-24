import axios from "axios";
import axiosRetry from "axios-retry";
import { logger } from "../../utils/logger";

const client = axios.create({
  // 60s: pedir 90 días x 40 habitaciones no cabe en 10s y provocaba que se
  // perdieran rangos completos en silencio (error.log lleno de timeouts)
  timeout: 60000,
  headers: { "Content-Type": "application/json" },
});

axiosRetry(client, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  shouldResetTimeout: true,
  retryCondition: (error) => {
    // retry on network failures & 5xx
    return axiosRetry.isNetworkError(error) || axiosRetry.isRetryableError(error);
  },
});

client.interceptors.request.use(
  (config) => {
    const token = process.env.PX_API_KEY;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    logger.debug("➡️ Request:", {
      url: config.url,
      method: config.method,
    });

    return config;
  },
  (error) => {
    logger.error("Error en request interceptor", { message: error.message });
    return Promise.reject(error);
  }
);

client.interceptors.response.use(
  res => res,
  err => {
    // debug y no error: axios-retry reintenta 3 veces (4 logs por fallo) y
    // quien llama ya loguea el error con contexto útil en su catch
    logger.debug("HTTP Error", { message: err.message, url: err.config?.url });
    return Promise.reject(err);
  }
);

export default client;
