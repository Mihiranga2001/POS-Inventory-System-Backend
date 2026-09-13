import mongoose from "mongoose";
import { ORDER_STATUS } from "./utils/orderStatus.js";

const orderItemSchema = new mongoose.Schema(
	{
		productId: {
			type: String,
			required: true,
		},
		name: {
			type: String,
			required: true,
		},
		//price snapshot at the moment of checkout
		price: {
			type: Number,
			required: true,
		},
		quantity: {
			type: Number,
			required: true,
			min: 1,
		},
		image: {
			type: String,
			default: "/default-product.jpg",
		},
	},
	{ _id: false }
);

const statusHistorySchema = new mongoose.Schema(
	{
		status: {
			type: String,
			required: true,
		},
		note: {
			type: String,
			default: "",
		},
		changedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{ _id: false }
);

const orderSchema = new mongoose.Schema(
	{
		orderId: {
			type: String,
			required: true,
			unique: true,
		},
		customerEmail: {
			type: String,
			required: true,
		},
		customerName: {
			type: String,
			default: "",
		},
		items: {
			type: [orderItemSchema],
			required: true,
		},
		totalAmount: {
			type: Number,
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(ORDER_STATUS),
			default: ORDER_STATUS.PENDING,
		},
		//the 5 minute stock lock deadline
		reservationExpiresAt: {
			type: Date,
			default: null,
		},
		//true once the reserved units were released OR committed. guards double release
		stockSettled: {
			type: Boolean,
			default: false,
		},
		cartId: {
			type: String,
			default: null,
		},
		//client generated key -> makes checkout safe to retry
		idempotencyKey: {
			type: String,
			default: null,
		},
		paymentId: {
			type: String,
			default: null,
		},
		paymentAttempts: {
			type: Number,
			default: 0,
		},
		statusHistory: {
			type: [statusHistorySchema],
			default: [],
		},
	},
	{ timestamps: true }
);

//unique only when idempotencyKey actually exists
orderSchema.index(
	{ idempotencyKey: 1 },
	{ unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

const Order = mongoose.model("Order", orderSchema);
export default Order;
