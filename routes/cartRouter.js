import express from "express";
import {
	getCart,
	addToCart,
	updateCartItem,
	removeFromCart,
	clearCart,
} from "../controllers/cartController.js";

const cartRouter = express.Router();

cartRouter.get("/", getCart);
cartRouter.post("/", addToCart);
cartRouter.put("/:productId", updateCartItem);
cartRouter.delete("/:productId", removeFromCart);
cartRouter.delete("/", clearCart);

export default cartRouter;
