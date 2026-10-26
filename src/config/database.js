
import "dotenv/config";
import { createClient } from "@libsql/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const url = databaseUrl.startsWith("sqlite:")
  ? databaseUrl.replace(/^sqlite:/, "file:")
  : databaseUrl;

export const db = createClient({
  url,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

async function execute(client, sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows.map((row) => ({ ...row }));
}

export async function query(sql, args = []) {
  return execute(db, sql, args);
}

export async function withTransaction(callback) {
  const tx = await db.transaction("write");

  const txQuery = (sql, args = []) => execute(tx, sql, args);

  try {
    const result = await callback(txQuery);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function closeDatabase() {
  await db.close();
}
