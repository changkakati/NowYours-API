import express from "express";
import cors from "cors";

import authRoutes from "./auth/auth.routes.js";
import listingRoutes from "./listings/listings.routes.js";

const app = express();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "10kb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/listings", listingRoutes);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    message: "Internal server error",
  });
});

export default app;