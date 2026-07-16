import axios from "axios";
import axiosRetry from "axios-retry";
import { logger } from "../../utils/logger";

const client = axios.create({
  timeout: 10000,
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

    logger.info("➡️ Request:", {
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
    logger.error("HTTP Error", { message: err.message, url: err.config?.url });
    return Promise.reject(err);
  }
);

export default client;
