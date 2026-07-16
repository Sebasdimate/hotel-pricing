"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const axios_retry_1 = __importDefault(require("axios-retry"));
const logger_1 = require("../../utils/logger");
const client = axios_1.default.create({
    timeout: 10000,
    headers: { "Content-Type": "application/json" },
});
(0, axios_retry_1.default)(client, {
    retries: 3,
    retryDelay: axios_retry_1.default.exponentialDelay,
    shouldResetTimeout: true,
    retryCondition: (error) => {
        // retry on network failures & 5xx
        return axios_retry_1.default.isNetworkError(error) || axios_retry_1.default.isRetryableError(error);
    },
});
client.interceptors.request.use((config) => {
    const token = process.env.PX_API_KEY;
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    logger_1.logger.info("➡️ Request:", {
        url: config.url,
        method: config.method,
    });
    return config;
}, (error) => {
    logger_1.logger.error("Error en request interceptor", { message: error.message });
    return Promise.reject(error);
});
client.interceptors.response.use(res => res, err => {
    logger_1.logger.error("HTTP Error", { message: err.message, url: err.config?.url });
    return Promise.reject(err);
});
exports.default = client;
