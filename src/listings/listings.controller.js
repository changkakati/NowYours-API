import { randomUUID } from "node:crypto";
import { del } from "@vercel/blob";
import { query, withTransaction } from "../config/database.js";

const LISTING_TYPES = new Set(["sell", "exchange", "free"]);
const CONDITIONS = new Set(["new", "like_new", "good", "fair"]);
const STATUSES = new Set(["active", "sold", "given_away", "archived"]);

const MAX_IMAGES = 4;
const MAX_PRICE = 100_000_000;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseImage(image, userId) {
  if (!image || typeof image !== "object") {
    return null;
  }

  const imageUrl = text(image.url);
  let parsed;

  try {
    parsed = new URL(imageUrl);
  } catch {
    return null;
  }

  // Only accept HTTPS Vercel public Blob URLs.
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".public.blob.vercel-storage.com") ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  let pathname;

  try {
    pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }

  // Each user can attach only images uploaded to their own directory.
  const expectedPrefix = `marketplace/${userId}/`;

  if (!pathname.startsWith(expectedPrefix) || pathname.includes("..")) {
    return null;
  }

  return {
    url: parsed.toString(),
    pathname,
  };
}

async function getListingById(id) {
  const rows = await query(
    `SELECT
       l.id,
       l.user_id,
       u.name AS seller_name,
       l.title,
       l.description,
       l.listing_type,
       l.category,
       l.item_condition,
       l.price,
       l.desired_exchange,
       l.city,
       l.area,
       l.status,
       l.created_at,
       l.updated_at
     FROM listings l
     JOIN users u ON u.id = l.user_id
     WHERE l.id = ?
     LIMIT 1`,
    [id],
  );

  if (!rows.length) {
    return null;
  }

  const images = await query(
    `SELECT id, image_url AS url, position
     FROM listing_images
     WHERE listing_id = ?
     ORDER BY position ASC`,
    [id],
  );

  return {
    ...rows[0],
    images,
  };
}

function validateListingInput(
  body,
  { partial = false, userId } = {},
) {
  const data = {};
  const errors = {};

  const fields = [
    "title",
    "description",
    "listing_type",
    "category",
    "item_condition",
    "city",
    "area",
    "desired_exchange",
    "price",
    "status",
    "images",
  ];

  for (const field of fields) {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  }

  // Title
  if (!partial || data.title !== undefined) {
    data.title = text(data.title);

    if (data.title.length < 3 || data.title.length > 120) {
      errors.title = "Title must be 3–120 characters.";
    }
  }

  // Description
  if (!partial || data.description !== undefined) {
    data.description = text(data.description);

    if (
      data.description.length < 10 ||
      data.description.length > 5000
    ) {
      errors.description =
        "Description must be 10–5000 characters.";
    }
  }

  // Listing type
  if (!partial || data.listing_type !== undefined) {
    if (!LISTING_TYPES.has(data.listing_type)) {
      errors.listing_type =
        "Choose sell, exchange, or free.";
    }
  }

  // Category
  if (!partial || data.category !== undefined) {
    data.category = text(data.category);

    if (!data.category || data.category.length > 60) {
      errors.category =
        "Category is required and must be under 60 characters.";
    }
  }

  // Condition
  if (!partial || data.item_condition !== undefined) {
    if (!CONDITIONS.has(data.item_condition)) {
      errors.item_condition =
        "Choose new, like_new, good, or fair.";
    }
  }

  // City
  if (!partial || data.city !== undefined) {
    data.city = text(data.city);

    if (!data.city || data.city.length > 100) {
      errors.city =
        "City is required and must be under 100 characters.";
    }
  }

  // Area
  if (data.area !== undefined) {
    data.area = text(data.area);

    if (data.area.length > 100) {
      errors.area = "Area must be under 100 characters.";
    }
  }

  // Exchange preference
  if (data.desired_exchange !== undefined) {
    data.desired_exchange = text(data.desired_exchange);

    if (data.desired_exchange.length > 500) {
      errors.desired_exchange =
        "Exchange preference must be under 500 characters.";
    }
  }

  // Price
  if (
    data.price !== undefined &&
    data.price !== null &&
    data.price !== ""
  ) {
    const price = Number(data.price);

    if (
      !Number.isSafeInteger(price) ||
      price < 0 ||
      price > MAX_PRICE
    ) {
      errors.price =
        "Price must be a whole number between 0 and 100,000,000.";
    } else {
      data.price = price;
    }
  } else if (data.price === "") {
    data.price = null;
  }

  const type = data.listing_type;

  if (
    type === "sell" &&
    (data.price === undefined || data.price === null)
  ) {
    errors.price = "A price is required for items for sale.";
  }

  if (type === "free") {
    data.price = null;
  }

  if (
    type === "exchange" &&
    (data.price === "" || data.price === undefined)
  ) {
    data.price = null;
  }

  if (
    type !== "exchange" &&
    data.desired_exchange === undefined &&
    !partial
  ) {
    data.desired_exchange = null;
  }

  // Status
  if (
    data.status !== undefined &&
    !STATUSES.has(data.status)
  ) {
    errors.status = "Invalid listing status.";
  }

  // Images
  if (data.images !== undefined) {
    if (
      !Array.isArray(data.images) ||
      data.images.length > MAX_IMAGES
    ) {
      errors.images =
        "A listing can have a maximum of 4 images.";
    } else {
      data.images = data.images.map((image) =>
        parseImage(image, userId),
      );

      if (data.images.some((image) => !image)) {
        errors.images =
          "Each image must be a valid Vercel Blob URL uploaded to your own account directory.";
      } else if (
        new Set(data.images.map((image) => image.url)).size !==
        data.images.length
      ) {
        errors.images = "Duplicate images are not allowed.";
      }
    }
  } else if (!partial) {
    data.images = [];
  }

  return { data, errors };
}

// --------------------------------------------------
// CREATE LISTING
// POST /api/listings
// --------------------------------------------------

export async function createListing(req, res, next) {
  try {
    const { data, errors } = validateListingInput(
      req.body ?? {},
      { userId: req.user.id },
    );

    if (Object.keys(errors).length) {
      return res.status(400).json({
        message: "Please correct the listing details.",
        errors,
      });
    }

    if (
      data.listing_type === "exchange" &&
      !text(data.desired_exchange)
    ) {
      return res.status(400).json({
        message:
          "Tell buyers what you would like to exchange for.",
      });
    }

    const id = randomUUID();

    await withTransaction(async (txQuery) => {
      await txQuery(
        `INSERT INTO listings (
           id,
           user_id,
           title,
           description,
           listing_type,
           category,
           item_condition,
           price,
           desired_exchange,
           city,
           area
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          req.user.id,
          data.title,
          data.description,
          data.listing_type,
          data.category,
          data.item_condition,
          data.price ?? null,
          data.desired_exchange ?? null,
          data.city,
          data.area || null,
        ],
      );

      for (
        let position = 0;
        position < data.images.length;
        position += 1
      ) {
        const image = data.images[position];

        await txQuery(
          `INSERT INTO listing_images (
             id,
             listing_id,
             image_url,
             pathname,
             position
           )
           VALUES (?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            id,
            image.url,
            image.pathname,
            position,
          ],
        );
      }
    });

    const listing = await getListingById(id);

    return res.status(201).json({
      message: "Listing created successfully.",
      listing,
    });
  } catch (error) {
    return next(error);
  }
}

// --------------------------------------------------
// BROWSE LISTINGS
// GET /api/listings
// --------------------------------------------------

export async function listListings(req, res, next) {
  try {
    const page = Math.max(
      1,
      Number.parseInt(req.query.page, 10) || 1,
    );

    const limit = Math.min(
      40,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20),
    );

    const offset = (page - 1) * limit;

    const conditions = ["l.status = 'active'"];
    const args = [];

    const search = text(req.query.search);

    if (search) {
      conditions.push(
        "(l.title LIKE ? OR l.description LIKE ?)",
      );

      args.push(`%${search}%`, `%${search}%`);
    }

    const category = text(req.query.category);

    if (category) {
      conditions.push("l.category = ?");
      args.push(category);
    }

    const listingType = text(req.query.listing_type);

    if (listingType) {
      if (!LISTING_TYPES.has(listingType)) {
        return res.status(400).json({
          message: "Invalid listing_type filter.",
        });
      }

      conditions.push("l.listing_type = ?");
      args.push(listingType);
    }

    const city = text(req.query.city);

    if (city) {
      conditions.push("l.city LIKE ?");
      args.push(`%${city}%`);
    }

    if (req.query.min_price !== undefined) {
      const min = Number(req.query.min_price);

      if (!Number.isSafeInteger(min) || min < 0) {
        return res.status(400).json({
          message:
            "min_price must be a non-negative whole number.",
        });
      }

      conditions.push("l.price >= ?");
      args.push(min);
    }

    if (req.query.max_price !== undefined) {
      const max = Number(req.query.max_price);

      if (!Number.isSafeInteger(max) || max < 0) {
        return res.status(400).json({
          message:
            "max_price must be a non-negative whole number.",
        });
      }

      conditions.push("l.price <= ?");
      args.push(max);
    }

    const where = conditions.join(" AND ");

    const counts = await query(
      `SELECT COUNT(*) AS total
       FROM listings l
       WHERE ${where}`,
      args,
    );

    const rows = await query(
      `SELECT
         l.id,
         l.user_id,
         u.name AS seller_name,
         l.title,
         l.description,
         l.listing_type,
         l.category,
         l.item_condition,
         l.price,
         l.desired_exchange,
         l.city,
         l.area,
         l.status,
         l.created_at,
         l.updated_at,
         (
           SELECT li.image_url
           FROM listing_images li
           WHERE li.listing_id = l.id
           ORDER BY li.position
           LIMIT 1
         ) AS cover_image
       FROM listings l
       JOIN users u ON u.id = l.user_id
       WHERE ${where}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );

    const total = Number(counts[0]?.total ?? 0);

    return res.json({
      listings: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
}

// --------------------------------------------------
// GET LISTING DETAILS
// GET /api/listings/:id
// --------------------------------------------------

export async function getListing(req, res, next) {
  try {
    const listing = await getListingById(req.params.id);

    if (!listing || listing.status === "archived") {
      return res.status(404).json({
        message: "Listing not found.",
      });
    }

    return res.json({ listing });
  } catch (error) {
    return next(error);
  }
}

// --------------------------------------------------
// UPDATE LISTING
// PATCH /api/listings/:id
// --------------------------------------------------

export async function updateListing(req, res, next) {
  try {
    const currentRows = await query(
      "SELECT * FROM listings WHERE id = ? LIMIT 1",
      [req.params.id],
    );

    const current = currentRows[0];

    if (!current) {
      return res.status(404).json({
        message: "Listing not found.",
      });
    }

    if (current.user_id !== req.user.id) {
      return res.status(403).json({
        message: "You can only edit your own listings.",
      });
    }

    const { data, errors } = validateListingInput(
      req.body ?? {},
      {
        partial: true,
        userId: req.user.id,
      },
    );

    if (Object.keys(errors).length) {
      return res.status(400).json({
        message: "Please correct the listing details.",
        errors,
      });
    }

    const merged = {
      title: data.title ?? current.title,
      description: data.description ?? current.description,
      listing_type: data.listing_type ?? current.listing_type,
      category: data.category ?? current.category,
      item_condition: data.item_condition ?? current.item_condition,
      price:
        data.price !== undefined ? data.price : current.price,
      desired_exchange:
        data.desired_exchange !== undefined
          ? data.desired_exchange
          : current.desired_exchange,
      city: data.city ?? current.city,
      area: data.area !== undefined ? data.area : current.area,
      status: data.status ?? current.status,
    };

    if (
      merged.listing_type === "sell" &&
      merged.price == null
    ) {
      return res.status(400).json({
        message: "A price is required for items for sale.",
      });
    }

    if (merged.listing_type === "free") {
      merged.price = null;
      merged.desired_exchange = null;
    }

    if (
      merged.listing_type === "exchange" &&
      !text(merged.desired_exchange)
    ) {
      return res.status(400).json({
        message:
          "Tell buyers what you would like to exchange for.",
      });
    }

    if (merged.listing_type === "sell") {
      merged.desired_exchange = null;
    }

    const oldImages =
      data.images !== undefined
        ? await query(
            `SELECT image_url
             FROM listing_images
             WHERE listing_id = ?`,
            [current.id],
          )
        : [];

    await withTransaction(async (txQuery) => {
      await txQuery(
        `UPDATE listings
         SET title = ?,
             description = ?,
             listing_type = ?,
             category = ?,
             item_condition = ?,
             price = ?,
             desired_exchange = ?,
             city = ?,
             area = ?,
             status = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [
          merged.title,
          merged.description,
          merged.listing_type,
          merged.category,
          merged.item_condition,
          merged.price ?? null,
          merged.desired_exchange ?? null,
          merged.city,
          merged.area || null,
          merged.status,
          current.id,
          req.user.id,
        ],
      );

      // Only replace images when the request includes "images".
      if (data.images !== undefined) {
        await txQuery(
          "DELETE FROM listing_images WHERE listing_id = ?",
          [current.id],
        );

        for (
          let position = 0;
          position < data.images.length;
          position += 1
        ) {
          const image = data.images[position];

          await txQuery(
            `INSERT INTO listing_images (
               id,
               listing_id,
               image_url,
               pathname,
               position
             )
             VALUES (?, ?, ?, ?, ?)`,
            [
              randomUUID(),
              current.id,
              image.url,
              image.pathname,
              position,
            ],
          );
        }
      }
    });

    // Remove old images that are no longer attached.
    if (data.images !== undefined) {
      const keep = new Set(
        data.images.map((image) => image.url),
      );

      await Promise.allSettled(
        oldImages
          .filter((image) => !keep.has(image.image_url))
          .map((image) => del(image.image_url)),
      );
    }

    return res.json({
      message: "Listing updated successfully.",
      listing: await getListingById(current.id),
    });
  } catch (error) {
    return next(error);
  }
}

// --------------------------------------------------
// DELETE LISTING
// DELETE /api/listings/:id
// --------------------------------------------------

export async function deleteListing(req, res, next) {
  try {
    const rows = await query(
      `SELECT id, user_id
       FROM listings
       WHERE id = ?
       LIMIT 1`,
      [req.params.id],
    );

    const listing = rows[0];

    if (!listing) {
      return res.status(404).json({
        message: "Listing not found.",
      });
    }

    if (listing.user_id !== req.user.id) {
      return res.status(403).json({
        message: "You can only delete your own listings.",
      });
    }

    const images = await query(
      `SELECT image_url
       FROM listing_images
       WHERE listing_id = ?`,
      [listing.id],
    );

    await query(
      "DELETE FROM listings WHERE id = ? AND user_id = ?",
      [listing.id, req.user.id],
    );

    // Database deletion succeeds even if Blob cleanup temporarily fails.
    await Promise.allSettled(
      images.map((image) => del(image.image_url)),
    );

    return res.json({
      message: "Listing deleted successfully.",
    });
  } catch (error) {
    return next(error);
  }
}

// --------------------------------------------------
// GET CURRENT USER'S LISTINGS
// GET /api/listings/mine
// --------------------------------------------------

export async function myListings(req, res, next) {
  try {
    const rows = await query(
      `SELECT
         l.id,
         l.title,
         l.listing_type,
         l.category,
         l.item_condition,
         l.price,
         l.city,
         l.area,
         l.status,
         l.created_at,
         (
           SELECT li.image_url
           FROM listing_images li
           WHERE li.listing_id = l.id
           ORDER BY li.position
           LIMIT 1
         ) AS cover_image
       FROM listings l
       WHERE l.user_id = ?
       ORDER BY l.created_at DESC`,
      [req.user.id],
    );

    return res.json({ listings: rows });
  } catch (error) {
    return next(error);
  }
}