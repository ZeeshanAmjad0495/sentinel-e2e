import * as dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  baseUrl: requireEnv("BASE_URL"),
  adminUser: requireEnv("ADMIN_USER"),
  adminPassword: requireEnv("ADMIN_PASSWORD"),
} as const;
