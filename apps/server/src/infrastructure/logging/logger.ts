import pino from "pino";
export const logger = pino({
  redact: {
    paths: ["*.password", "*.token", "DATABASE_URL"],
    censor: "[REDACTED]",
  },
});
