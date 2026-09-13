import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import Cart from "../models/Cart.js";
import { getNextSequence } from "../models/Counter.js";
import { isAdmin } from "./userController.js";
import { requireUser } from "./cartController.js";
import { sendError, createError } from "../utils/errors.js";
import { runInTransaction } from "../utils/transaction.js";
import { releaseReservation, commitReservation } from "../utils/stockService.js";
import { ORDER_STATUS } from "../utils/orderStatus.js";
import { expireDueOrders } from "./orderController.js";

const TIMEOUT_DELAY_MS = Number(process.env.PAYMENT_TIMEOUT_SIMULATION_MS || 2000);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

//mock gateway. the caller may force an outcome with "simulate",
//otherwise a weighted random outcome is produced (70% / 20% / 10%).
function resolveOutcome(simulate) {
	if (simulate != null) {
		const requested = String(simulate).toUpperCase();

		if (["SUCCESS", "FAILED", "FAILURE", "TIMEOUT"].includes(requested)) {
			return requested === "FAILURE" ? "FAILED" : requested;
		}

		throw createError(400, "simulate must be one of: success, failure, timeout");
	}

	const roll = Math.random();

	if (roll < 0.7) {
		return "SUCCESS";
	}
	if (roll < 0.9) {
		return "FAILED";
	}
	return "TIMEOUT";
}

//POST /api/payments/:orderId
//body: { simulate?: "success" | "failure" | "timeout", idempotencyKey? }
export async function processPayment(req, res) {
	let lockedOrder = null;

	try {
		const user = requireUser(req);
		const orderId = req.params.orderId;
		const idempotencyKey = req.body.idempotencyKey || req.header("Idempotency-Key") || null;

		//1. replay of the exact same request -> return the stored result, never charge twice
		if (idempotencyKey != null) {
			const existingPayment = await Payment.findOne({ idempotencyKey: idempotencyKey });

			if (existingPayment != null) {
				const order = await Order.findOne({ orderId: existingPayment.orderId });

				res.status(200).json({
					message: "Duplicate payment request. Returning the original gateway result.",
					duplicate: true,
					payment: existingPayment,
					order: order,
				});
				return;
			}
		}

		//2. release anything that already timed out, so we never charge an expired reservation
		await expireDueOrders();

		const order = await Order.findOne({ orderId: orderId });

		if (order == null) {
			throw createError(404, "Order not found");
		}

		if (order.customerEmail !== user.email && !isAdmin(req)) {
			throw createError(403, "You are not allowed to pay for this order");
		}

		if (order.status === ORDER_STATUS.PAID) {
			throw createError(409, "This order has already been paid", { orderId: orderId });
		}

		if (order.status === ORDER_STATUS.PROCESSING) {
			throw createError(409, "A payment for this order is already being processed");
		}

		if (order.status !== ORDER_STATUS.RESERVED) {
			throw createError(409, `Order in status ${order.status} cannot be paid`);
		}

		//3. atomic lock: RESERVED -> PROCESSING. a second simultaneous request gets null here
		lockedOrder = await Order.findOneAndUpdate(
			{ orderId: orderId, status: ORDER_STATUS.RESERVED },
			{
				$set: { status: ORDER_STATUS.PROCESSING },
				$inc: { paymentAttempts: 1 },
				$push: {
					statusHistory: {
						status: ORDER_STATUS.PROCESSING,
						note: "Payment sent to gateway",
						changedAt: new Date(),
					},
				},
			},
			{ new: true }
		);

		if (lockedOrder == null) {
			throw createError(409, "Duplicate payment submission detected for this order");
		}

		//4. the reservation must still be alive
		if (lockedOrder.reservationExpiresAt != null && lockedOrder.reservationExpiresAt <= new Date()) {
			await finaliseOrder(lockedOrder, ORDER_STATUS.EXPIRED, "Reservation expired before payment");
			lockedOrder = null;

			throw createError(410, "The 5 minute stock reservation expired. Please checkout again.");
		}

		//5. call the mock gateway
		const outcome = resolveOutcome(req.body.simulate);

		if (outcome === "TIMEOUT") {
			await sleep(TIMEOUT_DELAY_MS);
		}

		const seq = await getNextSequence("paymentId");
		const paymentId = "PAY" + String(seq).padStart(4, "0");

		let payment = null;

		try {
			payment = await Payment.create({
				paymentId: paymentId,
				orderId: lockedOrder.orderId,
				customerEmail: lockedOrder.customerEmail,
				amount: lockedOrder.totalAmount,
				status: outcome,
				gatewayReference: "MOCKGW-" + Math.random().toString(36).slice(2, 12).toUpperCase(),
				message:
					outcome === "SUCCESS"
						? "Payment approved by mock gateway"
						: outcome === "FAILED"
						? "Payment declined by mock gateway"
						: "Mock gateway did not respond in time",
				idempotencyKey: idempotencyKey,
			});
		} catch (error) {
			//unique index blocked a second SUCCESS row or a replayed idempotency key
			if (error.code === 11000) {
				await Order.updateOne(
					{ orderId: lockedOrder.orderId, status: ORDER_STATUS.PROCESSING },
					{ $set: { status: ORDER_STATUS.RESERVED } }
				);
				lockedOrder = null;

				throw createError(409, "Duplicate payment detected. This order was already charged.");
			}
			throw error;
		}

		//6. apply the outcome to stock + order status
		if (outcome === "SUCCESS") {
			await finaliseOrder(lockedOrder, ORDER_STATUS.PAID, "Payment successful", paymentId);
		} else if (outcome === "FAILED") {
			await finaliseOrder(lockedOrder, ORDER_STATUS.FAILED, "Payment failed, stock released", paymentId);
		} else {
			await finaliseOrder(
				lockedOrder,
				ORDER_STATUS.EXPIRED,
				"Payment timed out, reservation expired and stock released",
				paymentId
			);
		}

		const updatedOrder = await Order.findOne({ orderId: lockedOrder.orderId });
		lockedOrder = null;

		const httpStatus = outcome === "SUCCESS" ? 200 : outcome === "FAILED" ? 402 : 504;

		res.status(httpStatus).json({
			message: payment.message,
			outcome: outcome,
			payment: payment,
			order: updatedOrder,
		});
	} catch (error) {
		//an unexpected crash must never leave the order stuck in PROCESSING
		if (lockedOrder != null) {
			await Order.updateOne(
				{ orderId: lockedOrder.orderId, status: ORDER_STATUS.PROCESSING },
				{
					$set: { status: ORDER_STATUS.RESERVED },
					$push: {
						statusHistory: {
							status: ORDER_STATUS.RESERVED,
							note: "Rolled back after a gateway error",
							changedAt: new Date(),
						},
					},
				}
			);
		}

		sendError(res, error, "Payment processing failed");
	}
}

//moves PROCESSING -> PAID / FAILED / EXPIRED together with the matching stock movement
async function finaliseOrder(order, newStatus, note, paymentId) {
	await runInTransaction(async (session) => {
		const previous = await Order.findOneAndUpdate(
			{
				orderId: order.orderId,
				status: ORDER_STATUS.PROCESSING,
				stockSettled: false,
			},
			{
				$set: {
					status: newStatus,
					stockSettled: true,
					reservationExpiresAt: null,
					paymentId: paymentId == null ? order.paymentId : paymentId,
				},
				$push: {
					statusHistory: { status: newStatus, note: note, changedAt: new Date() },
				},
			},
			{ new: false, session: session }
		);

		if (previous == null) {
			throw createError(409, "Order state changed while the payment was being processed");
		}

		if (newStatus === ORDER_STATUS.PAID) {
			//reserved units physically leave the inventory
			await commitReservation(previous.items, session);
		} else {
			//failure or timeout -> unlock the units
			await releaseReservation(previous.items, session);
		}
	});

	//cart housekeeping
	if (order.cartId != null) {
		if (newStatus === ORDER_STATUS.PAID) {
			await Cart.updateOne(
				{ _id: order.cartId },
				{ $set: { status: "CONVERTED", items: [], activeOrderId: null } }
			);
		} else {
			await Cart.updateOne(
				{ _id: order.cartId, status: "LOCKED" },
				{ $set: { status: "ACTIVE", activeOrderId: null } }
			);
		}
	}
}

//GET /api/payments/order/:orderId
export async function getPaymentsForOrder(req, res) {
	try {
		const user = requireUser(req);
		const order = await Order.findOne({ orderId: req.params.orderId });

		if (order == null) {
			throw createError(404, "Order not found");
		}

		if (order.customerEmail !== user.email && !isAdmin(req)) {
			throw createError(403, "You are not allowed to view these payments");
		}

		const payments = await Payment.find({ orderId: req.params.orderId }).sort({ createdAt: 1 });

		res.json({
			orderId: req.params.orderId,
			count: payments.length,
			payments: payments,
		});
	} catch (error) {
		sendError(res, error, "Failed to fetch payments");
	}
}

//GET /api/payments   (admin)
export async function getAllPayments(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can view all payments" });
		return;
	}

	try {
		const payments = await Payment.find().sort({ createdAt: -1 });

		res.json({
			count: payments.length,
			payments: payments,
		});
	} catch (error) {
		sendError(res, error, "Failed to fetch payments");
	}
}
