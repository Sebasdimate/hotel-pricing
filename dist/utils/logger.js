"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = require("winston");
const { combine, timestamp, printf, colorize, splat } = winston_1.format;
// Rotación de archivos: tope duro de 25 MB por archivo de log (5 MB x 5 rotaciones)
const MAX_LOG_SIZE = 5 * 1024 * 1024;
const MAX_LOG_FILES = 5;
function safeStringify(obj) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (seen.has(value))
                return "[Circular]";
            seen.add(value);
        }
        return value;
    });
}
const logFormat = printf(({ level, message, timestamp, ...meta }) => {
    const metaString = meta && Object.keys(meta).length > 0
        ? ` | meta=${safeStringify(meta)}`
        : "";
    return `[${timestamp}] ${level}: ${message}${metaString}`;
});
exports.logger = (0, winston_1.createLogger)({
    level: process.env.LOG_LEVEL || "info",
    format: combine(splat(), timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
    transports: [
        new winston_1.transports.Console({
            format: combine(colorize(), splat(), timestamp(), logFormat),
        }),
        new winston_1.transports.File({
            filename: "logs/error.log",
            level: "error",
            maxsize: MAX_LOG_SIZE,
            maxFiles: MAX_LOG_FILES,
            tailable: true,
        }),
        new winston_1.transports.File({
            filename: "logs/combined.log",
            maxsize: MAX_LOG_SIZE,
            maxFiles: MAX_LOG_FILES,
            tailable: true,
        }),
    ],
});
