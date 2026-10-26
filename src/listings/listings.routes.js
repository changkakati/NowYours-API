import { Router } from "express";
import { authenticateToken } from "../auth/auth.middleware.js";

import {
  createListing,
  deleteListing,
  getListing,
  listListings,
  myListings,
  updateListing,
} from "./listings.controller.js";

import { uploadListingImage } from "./listings.upload.js";

const router = Router();

router.post("/upload", uploadListingImage);

// Public browsing
router.get("/", listListings);

// Must be registered before "/:id".
router.get("/mine", authenticateToken, myListings);

router.get("/:id", getListing);

// Authenticated listing management
router.post("/", authenticateToken, createListing);
router.patch("/:id", authenticateToken, updateListing);
router.delete("/:id", authenticateToken, deleteListing);

export default router;