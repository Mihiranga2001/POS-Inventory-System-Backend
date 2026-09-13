import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { sendError, createError } from "../utils/errors.js";
import { calculateTotal } from "../utils/stockService.js";

function requireUser(req) {
	if (req.user == null) {
		throw createError(401, "Please login first");
	}
	return req.user;
}

async function loadOrCreateCart(email) {
	let cart = await Cart.findOne({ customerEmail: email });

	if (cart == null) {
		cart = new Cart({ customerEmail: email, items: [] });
		await cart.save();
	}

	//a cart that was already paid becomes a fresh empty active cart
	if (cart.status === "CONVERTED") {
		cart.items = [];
		cart.status = "ACTIVE";
		cart.activeOrderId = null;
		await cart.save();
	}

	return cart;
}

function buildCartResponse(cart) {
	return {
		customerEmail: cart.customerEmail,
		status: cart.status,
		activeOrderId: cart.activeOrderId,
		items: cart.items,
		itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
		totalAmount: calculateTotal(cart.items),
	};
}

//GET /api/cart
export async function getCart(req, res) {
	try {
		const user = requireUser(req);
		const cart = await loadOrCreateCart(user.email);

		res.json(buildCartResponse(cart));
	} catch (error) {
		sendError(res, error, "Failed to fetch cart");
	}
}

//POST /api/cart   { productId, quantity }
export async function addToCart(req, res) {
	try {
		const user = requireUser(req);
		const productId = req.body.productId;
		const quantity = Number(req.body.quantity || 1);

		if (productId == null || !Number.isInteger(quantity) || quantity <= 0) {
			throw createError(400, "productId and a positive integer quantity are required");
		}

		const product = await Product.findOne({ productId: productId, isActive: true });
		if (product == null) {
			throw createError(404, "Product not found");
		}

		const cart = await loadOrCreateCart(user.email);

		if (cart.status === "LOCKED") {
			throw createError(409, "A checkout is in progress for this cart. Complete or cancel it first.");
		}

		const existing = cart.items.find((item) => item.productId === productId);
		const newQuantity = existing == null ? quantity : existing.quantity + quantity;

		//soft check only, the real guarantee happens atomically at checkout
		const available = product.stock - product.reservedStock;
		if (newQuantity > available) {
			throw createError(409, `Only ${available} unit(s) of "${product.name}" are available`, {
				productId: productId,
				available: available,
			});
		}

		if (existing == null) {
			cart.items.push({
				productId: product.productId,
				name: product.name,
				price: product.price,
				quantity: quantity,
				image: product.image,
			});
		} else {
			existing.quantity = newQuantity;
			existing.price = product.price;
		}

		await cart.save();

		res.json({
			message: "Item added to cart",
			cart: buildCartResponse(cart),
		});
	} catch (error) {
		sendError(res, error, "Failed to add item to cart");
	}
}

//PUT /api/cart/:productId   { quantity }
export async function updateCartItem(req, res) {
	try {
		const user = requireUser(req);
		const quantity = Number(req.body.quantity);

		if (!Number.isInteger(quantity) || quantity < 0) {
			throw createError(400, "quantity must be an integer of 0 or more");
		}

		const cart = await loadOrCreateCart(user.email);

		if (cart.status === "LOCKED") {
			throw createError(409, "A checkout is in progress for this cart");
		}

		const item = cart.items.find((cartItem) => cartItem.productId === req.params.productId);
		if (item == null) {
			throw createError(404, "Item is not in the cart");
		}

		if (quantity === 0) {
			cart.items = cart.items.filter((cartItem) => cartItem.productId !== req.params.productId);
		} else {
			const product = await Product.findOne({ productId: req.params.productId });
			const available = product.stock - product.reservedStock;

			if (quantity > available) {
				throw createError(409, `Only ${available} unit(s) of "${product.name}" are available`);
			}

			item.quantity = quantity;
		}

		await cart.save();

		res.json({
			message: "Cart updated",
			cart: buildCartResponse(cart),
		});
	} catch (error) {
		sendError(res, error, "Failed to update cart");
	}
}

//DELETE /api/cart/:productId
export async function removeFromCart(req, res) {
	try {
		const user = requireUser(req);
		const cart = await loadOrCreateCart(user.email);

		if (cart.status === "LOCKED") {
			throw createError(409, "A checkout is in progress for this cart");
		}

		cart.items = cart.items.filter((item) => item.productId !== req.params.productId);
		await cart.save();

		res.json({
			message: "Item removed from cart",
			cart: buildCartResponse(cart),
		});
	} catch (error) {
		sendError(res, error, "Failed to remove item from cart");
	}
}

//DELETE /api/cart
export async function clearCart(req, res) {
	try {
		const user = requireUser(req);
		const cart = await loadOrCreateCart(user.email);

		if (cart.status === "LOCKED") {
			throw createError(409, "A checkout is in progress for this cart");
		}

		cart.items = [];
		await cart.save();

		res.json({
			message: "Cart cleared",
			cart: buildCartResponse(cart),
		});
	} catch (error) {
		sendError(res, error, "Failed to clear cart");
	}
}

export { loadOrCreateCart, buildCartResponse, requireUser };
