
import "dotenv/config";
import app from "./app.js";
import { closeDatabase } from "./config/database.js";

if (
  !process.env.JWT_SECRET ||
  Buffer.byteLength(process.env.JWT_SECRET) < 32
) {
  throw new Error("JWT_SECRET must contain at least 32 bytes");
}

const port = Number(process.env.PORT) || 3001;

const server = app.listen(port, () => {
  console.log(`API running at http://localhost:${port}`);
});

function shutdown() {
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
