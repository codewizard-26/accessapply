import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";
import * as schema from "./schema.js";

dotenv.config();

let dbInstance: ReturnType<typeof createDrizzleDb> | null = null;

function createDrizzleDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in environment variables");
  }

  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = createDrizzleDb();
  }
  return dbInstance;
}

export const db = new Proxy({} as ReturnType<typeof createDrizzleDb>, {
  get(_target, prop) {
    const instance = getDb();
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
