import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Cart from "../models/Cart.js";
import Payment from "../models/Payment.js";
import { getNextSequence } from "../models/Counter.js";
import { isAdmin } from "./userController.js";
import { requireUser } from "./cartController.js";
import { sendError, createError } from "../utils/errors.js";
import { runInTransaction } from "../utils/transaction.js";
import {
	reserveStock,
	releaseReservation,
	restoreStock,
	calculateTotal,
} from "../utils/stockService.js";
import { ORDER_STATUS, assertTransition } from "../utils/orderStatus.js";

const RESERVATION_MINUTES = Number(process.env.RESERVATION_TIMEOUT_MINUTES || 5);

//merge duplicated lines and validate quantities
function normalizeItems(rawItems) {
	if (!Array.isArray(rawItems) || rawItems.length === 0) {
		throw createError(400, "At least one item is required");
	}

	const merged = new Map();

	for (const item of rawItems) {
		const productId = item.productId;
		const quantity = Number(item.quantity);

		if (productId == null || !Number.isInteger(quantity) || quantity <= 0) {
			throw createError(400, "Each item needs a productId and a positive integer quantity");
		}

		merged.set(productId, (merged.get(productId) || 0) + quantity);
	}

	return Array.from(merged.entries()).map(([productId, quantity]) => {
		return { productId: productId, quantity: quantity };
	});
}

//price + name snapshot taken from the database, never trusted from the client
async function buildOrderItems(normalizedItems) {
	const productIds = normalizedItems.map((item) => item.productId);
	const products = await Product.find({ productId: { $in: productIds } });

	const productMap = new Map();
	products.forEach((product) => productMap.set(product.productId, product));

	return normalizedItems.map((item) => {
		const product = productMap.get(item.productId);

		if (product == null || !product.isActive) {
			throw createError(404, `Product ${item.productId} is not available`);
		}

		return {
			productId: product.productId,
			name: product.name,
			price: product.price,
			quantity: item.quantity,
			image: product.image,
		};
	});
}

//POST /api/orders/checkout
//body: { items?: [{productId, quantity}], idempotencyKey? }
//if no items are sent the active cart of the logged in user is used
export async function checkout(req, res) {
	let lockedCart = null;

	try {
		const user = requireUser(req);

		//free up anything whose 5 minutes already passed before we check availability
		await expireDueOrders();

		const idempotencyKey = req.body.idempotencyKey || req.header("Idempotency-Key") || null;

		if (idempotencyKey != null) {
			const existing = await Order.findOne({ idempotencyKey: idempotencyKey });
			if (existing != null) {
				res.status(200).json({
					message: "Duplicate checkout request. Returning the original order.",
					duplicate: true,
					order: existing,
				});
				return;
			}
		}

		let rawItems = req.body.items;

		//cart based checkout -> lock the cart so the same cart cannot create two orders
		if (rawItems == null) {
			const cart = await Cart.findOne({ customerEmail: user.email });

			if (cart == null || cart.items.length === 0) {
				throw createError(400, "Your cart is empty");
			}

			lockedCart = await Cart.findOneAndUpdate(
				{ _id: cart._id, status: "ACTIVE" },
				{ $set: { status: "LOCKED" } },
				{ new: true }
			);

			if (lockedCart == null) {
				throw createError(409, "A checkout is already in progress for this cart");
			}

			rawItems = lockedCart.items;
		}

		const normalizedItems = normalizeItems(rawItems);
		const orderItems = await buildOrderItems(normalizedItems);

		const seq = await getNextSequence("orderId");
		const orderId = "ORD" + String(seq).padStart(4, "0");
		const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000);

		const order = await runInTransaction(async (session) => {
			//atomic, per product, oversell proof reservation
			await reserveStock(orderItems, session);

			const created = await Order.create(
				[
					{
						orderId: orderId,
						customerEmail: user.email,
						customerName: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
						items: orderItems,
						totalAmount: calculateTotal(orderItems),
						status: ORDER_STATUS.RESERVED,
						reservationExpiresAt: expiresAt,
						stockSettled: false,
						cartId: lockedCart == null ? null : String(lockedCart._id),
						idempotencyKey: idempotencyKey,
						statusHistory: [
							{ status: ORDER_STATUS.PENDING, note: "Order created" },
							{
								status: ORDER_STATUS.RESERVED,
								note: `Stock reserved for ${RESERVATION_MINUTES} minutes`,
							},
						],
					},
				],
				{ session: session }
			);

			return created[0];
		});

		if (lockedCart != null) {
			await Cart.updateOne({ _id: lockedCart._id }, { $set: { activeOrderId: orderId } });
		}

		res.status(201).json({
			message: "Checkout successful. Stock reserved, please complete the payment.",
			reservationExpiresAt: expiresAt,
			reservationWindowMinutes: RESERVATION_MINUTES,
			order: order,
		});
	} catch (error) {
		//checkout failed -> give the cart back to the customer
		if (lockedCart != null) {
			await Cart.updateOne(
				{ _id: lockedCart._id, status: "LOCKED" },
				{ $set: { status: "ACTIVE", activeOrderId: null } }
			);
		}

		if (error.code === 11000) {
			res.status(409).json({ message: "Duplicate checkout request detected" });
			return;
		}

		sendError(res, error, "Checkout failed");
	}
}

//GET /api/orders            -> my orders
export async function getMyOrders(req, res) {
	try {
		const user = requireUser(req);

		await expireDueOrders();

		const query = { customerEmail: user.email };
		if (req.query.status) {
			query.status = req.query.status.toUpperCase();
		}

		const orders = await Order.find(query).sort({ createdAt: -1 });

		res.json({
			count: orders.length,
			orders: orders,
		});
	} catch (error) {
		sendError(res, error, "Failed to fetch orders");
	}
}

//GET /api/orders/all        -> admin
export async function getAllOrders(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can view all orders" });
		return;
	}

	try {
		await expireDueOrders();

		const query = {};
		if (req.query.status) {
			query.status = req.query.status.toUpperCase();
		}
		if (req.query.email) {
			query.customerEmail = req.query.email;
		}

		const orders = await Order.find(query).sort({ createdAt: -1 });

		res.json({
			count: orders.length,
			orders: orders,
		});
	} catch (error) {
		sendError(res, error, "Failed to fetch orders");
	}
}

//GET /api/orders/:orderId
export async function getOrderById(req, res) {
	try {
		const user = requireUser(req);

		await expireDueOrders();

		const order = await Order.findOne({ orderId: req.params.orderId });

		if (order == null) {
			throw createError(404, "Order not found");
		}

		if (order.customerEmail !== user.email && !isAdmin(req)) {
			throw createError(403, "You are not allowed to view this order");
		}

		const payments = await Payment.find({ orderId: order.orderId }).sort({ createdAt: 1 });

		res.json({
			order: order,
			payments: payments,
			secondsUntilReservationExpiry:
				order.reservationExpiresAt == null
					? null
					: Math.max(Math.floor((order.reservationExpiresAt - Date.now()) / 1000), 0),
		});
	} catch (error) {
		sendError(res, error, "Failed to fetch order");
	}
}

//PUT /api/orders/:orderId/cancel
export async function cancelOrder(req, res) {
	try {
		const user = requireUser(req);

		const existing = await Order.findOne({ orderId: req.params.orderId });

		if (existing == null) {
			throw createError(404, "Order not found");
		}

		if (existing.customerEmail !== user.email && !isAdmin(req)) {
			throw createError(403, "You are not allowed to cancel this order");
		}

		//fails fast with a readable message for terminal states
		assertTransition(existing.status, ORDER_STATUS.CANCELLED);

		const result = await runInTransaction(async (session) => {
			//atomic guard: only one request can flip the status
			const previous = await Order.findOneAndUpdate(
				{
					orderId: req.params.orderId,
					status: { $in: [ORDER_STATUS.PENDING, ORDER_STATUS.RESERVED, ORDER_STATUS.PAID] },
				},
				{
					$set: { status: ORDER_STATUS.CANCELLED, reservationExpiresAt: null, stockSettled: true },
					$push: {
						statusHistory: {
							status: ORDER_STATUS.CANCELLED,
							note: `Cancelled by ${user.email}`,
							changedAt: new Date(),
						},
					},
				},
				{ new: false, session: session }
			);

			if (previous == null) {
				throw createError(409, "Order can no longer be cancelled");
			}

			if (previous.status === ORDER_STATUS.RESERVED && previous.stockSettled === false) {
				//stock was only locked -> unlock it
				await releaseReservation(previous.items, session);
			}

			if (previous.status === ORDER_STATUS.PAID) {
				//stock had physically left -> put it back on the shelf
				await restoreStock(previous.items, session);
			}

			return previous;
		});

		//release the cart that produced this order
		if (result.cartId != null) {
			await Cart.updateOne(
				{ _id: result.cartId, status: "LOCKED" },
				{ $set: { status: "ACTIVE", activeOrderId: null } }
			);
		}

		const order = await Order.findOne({ orderId: req.params.orderId });

		res.json({
			message:
				result.status === ORDER_STATUS.PAID
					? "Order cancelled and stock restored"
					: "Order cancelled and reserved stock released",
			previousStatus: result.status,
			order: order,
		});
	} catch (error) {
		sendError(res, error, "Failed to cancel order");
	}
}

//releases every reservation whose window has passed.
//called by the background sweeper, and lazily before checkout / payment / listings.
export async function expireDueOrders() {
	const now = new Date();

	const dueOrders = await Order.find({
		status: { $in: [ORDER_STATUS.RESERVED, ORDER_STATUS.PROCESSING] },
		reservationExpiresAt: { $lte: now },
	}).select("orderId status");

	const expiredIds = [];

	for (const due of dueOrders) {
		try {
			const expired = await runInTransaction(async (session) => {
				const previous = await Order.findOneAndUpdate(
					{
						orderId: due.orderId,
						status: { $in: [ORDER_STATUS.RESERVED, ORDER_STATUS.PROCESSING] },
						reservationExpiresAt: { $lte: now },
						stockSettled: false,
					},
					{
						$set: {
							status: ORDER_STATUS.EXPIRED,
							stockSettled: true,
							reservationExpiresAt: null,
						},
						$push: {
							statusHistory: {
								status: ORDER_STATUS.EXPIRED,
								note: "Reservation window elapsed, stock released automatically",
								changedAt: new Date(),
							},
						},
					},
					{ new: false, session: session }
				);

				if (previous == null) {
					return null;
				}

				await releaseReservation(previous.items, session);
				return previous;
			});

			if (expired != null) {
				expiredIds.push(expired.orderId);

				if (expired.cartId != null) {
					await Cart.updateOne(
						{ _id: expired.cartId, status: "LOCKED" },
						{ $set: { status: "ACTIVE", activeOrderId: null } }
					);
				}
			}
		} catch (error) {
			console.error(`Failed to expire order ${due.orderId}`, error);
		}
	}

	return expiredIds;
}

//GET /api/orders/report?range=today|week|month|all   (admin)
//sales summary: order counts, revenue and the best selling products
export async function getSalesReport(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can view the sales report" });
		return;
	}

	try {
		//release stale reservations first so the status counts are accurate
		await expireDueOrders();

		const range = req.query.range || "today";
		const now = new Date();
		let startDate = null;

		if (range == "today") {
			startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		} else if (range == "week") {
			startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
		} else if (range == "month") {
			startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
		}

		const query = {};
		if (startDate != null) {
			query.createdAt = { $gte: startDate };
		}

		const orders = await Order.find(query).sort({ createdAt: -1 });

		//every status is counted, but only PAID orders earn revenue
		const statusCounts = {};
		let revenue = 0;
		let itemsSold = 0;
		let paidOrders = 0;

		const productTotals = new Map();

		orders.forEach((order) => {
			statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;

			if (order.status != ORDER_STATUS.PAID) {
				return;
			}

			paidOrders = paidOrders + 1;
			revenue = revenue + order.totalAmount;

			order.items.forEach((item) => {
				itemsSold = itemsSold + item.quantity;

				const existing = productTotals.get(item.productId);

				if (existing == null) {
					productTotals.set(item.productId, {
						productId: item.productId,
						name: item.name,
						image: item.image,
						quantitySold: item.quantity,
						revenue: item.price * item.quantity,
					});
				} else {
					existing.quantitySold = existing.quantitySold + item.quantity;
					existing.revenue = existing.revenue + item.price * item.quantity;
				}
			});
		});

		const topSelling = Array.from(productTotals.values())
			.sort((a, b) => b.quantitySold - a.quantitySold)
			.slice(0, 10);

		res.json({
			range: range,
			from: startDate,
			generatedAt: now,
			totalOrders: orders.length,
			paidOrders: paidOrders,
			revenue: revenue,
			itemsSold: itemsSold,
			averageOrderValue: paidOrders == 0 ? 0 : revenue / paidOrders,
			statusCounts: statusCounts,
			topSelling: topSelling,
			recentOrders: orders.slice(0, 10),
		});
	} catch (error) {
		sendError(res, error, "Failed to build the sales report");
	}
}

//POST /api/orders/expire   (admin) -> manual trigger, handy for demos
export async function expireOrdersNow(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can run the expiry sweep" });
		return;
	}

	try {
		const expiredIds = await expireDueOrders();

		res.json({
			message: "Expiry sweep completed",
			expiredCount: expiredIds.length,
			expiredOrders: expiredIds,
		});
	} catch (error) {
		sendError(res, error, "Expiry sweep failed");
	}
}
