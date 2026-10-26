
import { Router } from "express";

import {
  register,
  login,
  me,
  refresh,
  logout,
  verifyEmail,
  resendVerification,
} from "./auth.controller.js";

import {
  authenticateToken,
  requireAdmin,
} from "./auth.middleware.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);

router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);

router.post("/refresh", refresh);
router.post("/logout", logout);

router.get("/me", authenticateToken, me);

router.get(
  "/admin-check",
  authenticateToken,
  requireAdmin,
  (req, res) => {
    res.json({
      message: "You have administrator access",
    });
  }
);

export default router;
