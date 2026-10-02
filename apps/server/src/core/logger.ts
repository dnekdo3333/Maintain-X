import { pino, type LoggerOptions } from 'pino'
import { env } from '../config/env.js'

const options: LoggerOptions = {
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'maintainx-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },
}

if (env.isDevelopment) {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
  }
}

export const logger = pino(options)
export type Logger = typeof logger
