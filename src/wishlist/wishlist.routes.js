
import { Router } from "express";
import { authenticateToken } from "../auth/auth.middleware.js";

import {
  getWishlist,
  checkWishlistItem,
  addToWishlist,
  removeFromWishlist,
} from "./wishlist.controller.js";

const router = Router();

router.use(authenticateToken);

router.get("/", getWishlist);
router.get("/:listingId", checkWishlistItem);
router.post("/:listingId", addToWishlist);
router.delete("/:listingId", removeFromWishlist);

export default router;
