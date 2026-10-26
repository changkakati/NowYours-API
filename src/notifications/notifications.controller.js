
import { query } from "../config/database.js";

export async function listNotifications(req, res, next) {
  try {
    const notifications = await query(
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
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 30`,
      [req.user.id],
    );

    const unreadRows = await query(
      `SELECT COUNT(*) AS unread_count
       FROM notifications
       WHERE user_id = ? AND read_at IS NULL`,
      [req.user.id],
    );

    return res.json({
      notifications,
      unreadCount: Number(unreadRows[0]?.unread_count || 0),
    });
  } catch (error) {
    return next(error);
  }
}

export async function markNotificationRead(req, res, next) {
  try {
    const result = await query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND user_id = ?
       RETURNING id, read_at`,
      [req.params.id, req.user.id],
    );

    if (!result.length) {
      return res.status(404).json({
        message: "Notification not found.",
      });
    }

    return res.json({
      notification: result[0],
    });
  } catch (error) {
    return next(error);
  }
}

export async function markAllNotificationsRead(req, res, next) {
  try {
    await query(
      `UPDATE notifications
       SET read_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND read_at IS NULL`,
      [req.user.id],
    );

    return res.json({
      message: "All notifications marked as read.",
    });
  } catch (error) {
    return next(error);
  }
}
