
import { randomUUID } from "node:crypto";
import { query } from "../config/database.js";

export async function getWishlist(req, res, next) {
  try {
    const items = await query(
      `SELECT
          w.id,
          w.listing_id,
          w.created_at
       FROM wishlists w
       JOIN listings l ON l.id = w.listing_id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC, w.id DESC`,
      [req.user.id],
    );

    return res.json({ items });
  } catch (error) {
    return next(error);
  }
}

export async function checkWishlistItem(req, res, next) {
  try {
    const rows = await query(
      `SELECT id
       FROM wishlists
       WHERE user_id = ? AND listing_id = ?
       LIMIT 1`,
      [req.user.id, req.params.listingId],
    );

    return res.json({ saved: rows.length > 0 });
  } catch (error) {
    return next(error);
  }
}

export async function addToWishlist(req, res, next) {
  try {
    const listingId = req.params.listingId;

    const listings = await query(
      `SELECT id, status
       FROM listings
       WHERE id = ?
       LIMIT 1`,
      [listingId],
    );

    if (!listings.length || listings[0].status !== "active") {
      return res.status(404).json({
        message: "This listing is unavailable.",
      });
    }

    await query(
      `INSERT OR IGNORE INTO wishlists
        (id, user_id, listing_id)
       VALUES (?, ?, ?)`,
      [randomUUID(), req.user.id, listingId],
    );

    return res.status(200).json({
      message: "Added to wishlist.",
      saved: true,
    });
  } catch (error) {
    return next(error);
  }
}

export async function removeFromWishlist(req, res, next) {
  try {
    await query(
      `DELETE FROM wishlists
       WHERE user_id = ? AND listing_id = ?`,
      [req.user.id, req.params.listingId],
    );

    return res.json({
      message: "Removed from wishlist.",
      saved: false,
    });
  } catch (error) {
    return next(error);
  }
}
