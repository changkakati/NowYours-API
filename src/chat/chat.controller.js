
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../config/database.js";
import { broadcastToUsers } from "./chat.realtime.js";

const MAX_MESSAGE_LENGTH = 5000;

async function getParticipantConversation(conversationId, userId) {
    const rows = await query(
        `SELECT
        c.id,
        c.listing_id,
        c.buyer_id,
        c.seller_id,
        c.created_at,
        c.updated_at,
        l.title AS listing_title,
        l.status AS listing_status,
        buyer.name AS buyer_name,
        seller.name AS seller_name
     FROM conversations c
     JOIN listings l ON l.id = c.listing_id
     JOIN users buyer ON buyer.id = c.buyer_id
     JOIN users seller ON seller.id = c.seller_id
     WHERE c.id = ?
       AND (c.buyer_id = ? OR c.seller_id = ?)
     LIMIT 1`,
        [conversationId, userId, userId],
    );

    return rows[0] ?? null;
}

export async function createOrGetConversation(req, res, next) {
    try {
        const listingId =
            typeof req.body?.listingId === "string"
                ? req.body.listingId.trim()
                : "";

        if (!listingId) {
            return res.status(400).json({
                message: "listingId is required.",
            });
        }

        const listings = await query(
            `SELECT id, user_id, title, status
       FROM listings
       WHERE id = ?
       LIMIT 1`,
            [listingId],
        );

        const listing = listings[0];

        if (!listing || listing.status !== "active") {
            return res.status(404).json({
                message: "This listing is not available for chat.",
            });
        }

        if (listing.user_id === req.user.id) {
            return res.status(400).json({
                message: "You cannot start a conversation with yourself.",
            });
        }

        const id = randomUUID();

        await query(
            `INSERT OR IGNORE INTO conversations
        (id, listing_id, buyer_id, seller_id)
       VALUES (?, ?, ?, ?)`,
            [id, listingId, req.user.id, listing.user_id],
        );

        const conversations = await query(
            `SELECT id, listing_id, buyer_id, seller_id, created_at, updated_at
       FROM conversations
       WHERE listing_id = ?
         AND buyer_id = ?
         AND seller_id = ?
       LIMIT 1`,
            [listingId, req.user.id, listing.user_id],
        );

        return res.status(200).json({
            conversation: conversations[0],
        });
    } catch (error) {
        return next(error);
    }
}

export async function listConversations(req, res, next) {
    try {
        const conversations = await query(
            `SELECT
          c.id,
          c.listing_id,
          c.buyer_id,
          c.seller_id,
          c.created_at,
          c.updated_at,
          l.title AS listing_title,
          l.status AS listing_status,
          CASE
            WHEN c.buyer_id = ? THEN seller.name
            ELSE buyer.name
          END AS other_user_name,
          (
            SELECT m.body
            FROM chat_messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
          ) AS last_message,
          (
            SELECT m.created_at
            FROM chat_messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
          ) AS last_message_at,
          (
            SELECT COUNT(*)
            FROM chat_messages m
            WHERE m.conversation_id = c.id
              AND m.sender_id <> ?
              AND m.read_at IS NULL
          ) AS unread_count
       FROM conversations c
       JOIN listings l ON l.id = c.listing_id
       JOIN users buyer ON buyer.id = c.buyer_id
       JOIN users seller ON seller.id = c.seller_id
       WHERE c.buyer_id = ? OR c.seller_id = ?
       ORDER BY COALESCE(last_message_at, c.updated_at) DESC
       LIMIT 100`,
            [req.user.id, req.user.id, req.user.id, req.user.id],
        );

        return res.json({ conversations });
    } catch (error) {
        return next(error);
    }
}

export async function getMessages(req, res, next) {
    try {
        const conversation = await getParticipantConversation(
            req.params.id,
            req.user.id,
        );

        if (!conversation) {
            return res.status(404).json({
                message: "Conversation not found.",
            });
        }

        const requestedLimit = Number.parseInt(req.query.limit, 10);

        const limit = Number.isInteger(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), 100)
            : 50;

        const before =
            typeof req.query.before === "string"
                ? req.query.before
                : null;

        const messages = await query(
            `SELECT
          m.id,
          m.conversation_id,
          m.sender_id,
          u.name AS sender_name,
          m.body,
          m.created_at,
          m.read_at
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ?
       ${before ? "AND m.created_at < ?" : ""}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ?`,
            before
                ? [conversation.id, before, limit]
                : [conversation.id, limit],
        );

        return res.json({
            conversation,
            messages: messages.reverse(),
        });
    } catch (error) {
        return next(error);
    }
}


export async function sendMessage(req, res, next) {
    try {
        const conversation = await getParticipantConversation(
            req.params.id,
            req.user.id,
        );

        if (!conversation) {
            return res.status(404).json({
                message: "Conversation not found.",
            });
        }

        const body =
            typeof req.body?.body === "string"
                ? req.body.body.trim()
                : "";

        if (!body) {
            return res.status(400).json({
                message: "Message cannot be empty.",
            });
        }

        if (body.length > MAX_MESSAGE_LENGTH) {
            return res.status(400).json({
                message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
            });
        }

        const messageId = randomUUID();
        const notificationId = randomUUID();

        const recipientId =
            conversation.buyer_id === req.user.id
                ? conversation.seller_id
                : conversation.buyer_id;

        const link = `/chat?conversationId=${encodeURIComponent(conversation.id)}`;

        await withTransaction(async (txQuery) => {
            await txQuery(
                `INSERT INTO chat_messages
          (id, conversation_id, sender_id, body)
         VALUES (?, ?, ?, ?)`,
                [messageId, conversation.id, req.user.id, body],
            );

            await txQuery(
                `UPDATE conversations
         SET updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
                [conversation.id],
            );

            await txQuery(
                `INSERT INTO notifications
          (id, user_id, actor_id, type, title, body, link, conversation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    notificationId,
                    recipientId,
                    req.user.id,
                    "new_message",
                    "New message",
                    body.length > 120 ? `${body.slice(0, 117)}...` : body,
                    link,
                    conversation.id,
                ],
            );
        });

        const messageRows = await query(
            `SELECT
          m.id,
          m.conversation_id,
          m.sender_id,
          u.name AS sender_name,
          m.body,
          m.created_at,
          m.read_at
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.id = ?
       LIMIT 1`,
            [messageId],
        );

        const notificationRows = await query(
            `SELECT
          n.id,
          n.type,
          n.title,
          n.body,
          n.link,
          n.conversation_id,
          n.read_at,
          n.created_at,
          n.actor_id,
          u.name AS actor_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.id = ?
       LIMIT 1`,
            [notificationId],
        );

        const message = messageRows[0];
        const notification = notificationRows[0];

        // Deliver the message to both participants' connected sockets.
        broadcastToUsers(
            [conversation.buyer_id, conversation.seller_id],
            {
                type: "message:new",
                conversationId: conversation.id,
                message,
            },
        );

        // Notify only the recipient, not the person who sent the message.
        broadcastToUsers([recipientId], {
            type: "notification:new",
            notification,
        });

        return res.status(201).json({ message });
    } catch (error) {
        return next(error);
    }
}


export async function markConversationRead(req, res, next) {
    try {
        const conversation = await getParticipantConversation(
            req.params.id,
            req.user.id,
        );

        if (!conversation) {
            return res.status(404).json({
                message: "Conversation not found.",
            });
        }

        await query(
            `UPDATE chat_messages
       SET read_at = CURRENT_TIMESTAMP
       WHERE conversation_id = ?
         AND sender_id <> ?
         AND read_at IS NULL`,
            [conversation.id, req.user.id],
        );

        broadcastToUsers(
            [conversation.buyer_id, conversation.seller_id],
            {
                type: "conversation:read",
                conversationId: conversation.id,
                userId: req.user.id,
            },
        );

        return res.json({
            message: "Conversation marked as read.",
        });
    } catch (error) {
        return next(error);
    }
}
