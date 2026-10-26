import jwt from "jsonwebtoken";
import { handleUpload } from "@vercel/blob/client";
import { query } from "../config/database.js";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
];

function isVerified(value) {
  return value === true || value === 1 || value === "1";
}

async function getUploadUser(clientPayload) {
  if (
    typeof clientPayload !== "string" ||
    clientPayload.length === 0
  ) {
    throw new Error("Authentication token is missing.");
  }

  let payload;

  try {
    payload = jwt.verify(clientPayload, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch {
    throw new Error("Invalid or expired access token.");
  }

  if (typeof payload.sub !== "string") {
    throw new Error("Invalid access token.");
  }

  const users = await query(
    `SELECT id, is_email_verified
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [payload.sub],
  );

  const user = users[0];

  if (!user) {
    throw new Error("User account no longer exists.");
  }

  if (!isVerified(user.is_email_verified)) {
    throw new Error("Please verify your email before uploading.");
  }

  return user;
}

export async function uploadListingImage(req, res) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(503).json({
        message: "Image storage is not configured.",
      });
    }

    const response = await handleUpload({
      request: req,
      body: req.body,

      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const user = await getUploadUser(clientPayload);

        const expectedPrefix = `marketplace/${user.id}/`;

        if (!pathname.startsWith(expectedPrefix)) {
          throw new Error("Invalid image upload path.");
        }

        return {
          allowedContentTypes: ALLOWED_IMAGE_TYPES,
          maximumSizeInBytes: MAX_IMAGE_SIZE,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            userId: user.id,
          }),
        };
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const metadata = JSON.parse(tokenPayload || "{}");

        console.info("Marketplace image uploaded", {
          pathname: blob.pathname,
          userId: metadata.userId,
        });
      },
    });

    return res.status(200).json(response);
  } catch (error) {
    console.error("Vercel Blob upload handler error:", error);

    return res.status(400).json({
      message: error.message || "Unable to generate upload token.",
    });
  }
}