import { createLogger, format, transports } from "winston";

const { combine, timestamp, printf, colorize, splat } = format;

function safeStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  }, 2);
}

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaString =
    meta && Object.keys(meta).length > 0
      ? ` | meta=${safeStringify(meta)}`
      : "";

  return `[${timestamp}] ${level}: ${message}${metaString}`;
});

export const logger = createLogger({
  level: "info",
  format: combine(
    splat(),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(colorize(), splat(), timestamp(), logFormat),
    }),
    new transports.File({ filename: "logs/error.log", level: "error" }),
    new transports.File({ filename: "logs/combined.log" }),
  ],
});
