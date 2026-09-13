import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
	{
		productId: {
			type: String,
			required: true,
		},
		name: {
			type: String,
			required: true,
		},
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

const cartSchema = new mongoose.Schema(
	{
		customerEmail: {
			type: String,
			required: true,
			unique: true,
		},
		items: {
			type: [cartItemSchema],
			default: [],
		},
		//ACTIVE    -> customer can edit it
		//LOCKED    -> a checkout is currently running for this cart (blocks duplicate orders)
		//CONVERTED -> cart was paid and emptied
		status: {
			type: String,
			enum: ["ACTIVE", "LOCKED", "CONVERTED"],
			default: "ACTIVE",
		},
		activeOrderId: {
			type: String,
			default: null,
		},
	},
	{ timestamps: true }
);

const Cart = mongoose.model("Cart", cartSchema);
export default Cart;
