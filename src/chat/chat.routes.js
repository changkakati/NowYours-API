
import { Router } from "express";
import { authenticateToken } from "../auth/auth.middleware.js";

import {
  createOrGetConversation,
  getMessages,
  listConversations,
  markConversationRead,
  sendMessage,
} from "./chat.controller.js";

const router = Router();

router.use(authenticateToken);

router.get("/conversations", listConversations);

router.post("/conversations", createOrGetConversation);

router.get(
  "/conversations/:id/messages",
  getMessages,
);

router.post(
  "/conversations/:id/messages",
  sendMessage,
);

router.post(
  "/conversations/:id/read",
  markConversationRead,
);

export default router;
