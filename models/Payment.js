import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
	{
		paymentId: {
			type: String,
			required: true,
			unique: true,
		},
		orderId: {
			type: String,
			required: true,
		},
		customerEmail: {
			type: String,
			required: true,
		},
		amount: {
			type: Number,
			required: true,
		},
		//outcome of the mock gateway
		status: {
			type: String,
			enum: ["SUCCESS", "FAILED", "TIMEOUT"],
			required: true,
		},
		gatewayReference: {
			type: String,
			default: null,
		},
		message: {
			type: String,
			default: "",
		},
		//client generated key -> blocks duplicate charges
		idempotencyKey: {
			type: String,
			default: null,
		},
		processedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{ timestamps: true }
);

paymentSchema.index(
	{ idempotencyKey: 1 },
	{ unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

//only ONE successful payment can ever exist for an order
paymentSchema.index(
	{ orderId: 1 },
	{ unique: true, partialFilterExpression: { status: "SUCCESS" } }
);

const Payment = mongoose.model("Payment", paymentSchema);
export default Payment;
