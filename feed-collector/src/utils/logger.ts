import path from 'path';
import winston from 'winston';

const LOG_DIR = path.resolve(process.cwd(), 'logs');

export const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({
      format: () =>
        new Date().toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' IST',
    }),
    winston.format.json()
  ),
  transports: [
    // All logs → logs/app.log
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'app.log'),
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    // HTTP request/response only → logs/http.log
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'http.log'),
      level: 'http',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
    // Console — info and above only
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf((info) => {
          return `${info['timestamp']} [${info.level}]: ${info.message}`;
        })
      ),
      level: 'info',
    }),
  ],
});
