
import { Router } from "express";
import { authenticateToken } from "../auth/auth.middleware.js";

import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "./notifications.controller.js";

const router = Router();

router.use(authenticateToken);

router.get("/", listNotifications);
router.post("/read-all", markAllNotificationsRead);
router.post("/:id/read", markNotificationRead);

export default router;
