import path from "node:path";

const rootDir = process.cwd();

export const config = {
  rootDir,
  port: Number.parseInt(process.env.PORT ?? "3101", 10),
  host: process.env.HOST ?? "127.0.0.1",
  databasePath: path.resolve(rootDir, process.env.DATABASE_PATH ?? "storage/database/daka.db"),
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR ?? "storage/uploads"),
  appOrigin: process.env.APP_ORIGIN ?? "http://127.0.0.1:5173",
  sessionSecret: process.env.SESSION_SECRET ?? "development-only-change-this-secret",
  initialAdminUsername: process.env.INITIAL_ADMIN_USERNAME ?? "admin",
  initialAdminPassword: process.env.INITIAL_ADMIN_PASSWORD ?? "admin123",
  isProduction: process.env.NODE_ENV === "production",
  trustProxy: process.env.TRUST_PROXY === "1"
};

if (config.isProduction) {
  if (config.sessionSecret === "development-only-change-this-secret" || config.sessionSecret.length < 32) {
    throw new Error("生产环境 SESSION_SECRET 必须设置为至少 32 位的随机字符串");
  }
  if (config.initialAdminPassword === "admin123" || config.initialAdminPassword.length < 10) {
    throw new Error("生产环境 INITIAL_ADMIN_PASSWORD 必须设置为至少 10 位的非默认密码");
  }
}
