import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
	{
		productId: {
			type: String,
			required: true,
			unique: true,
		},
		name: {
			type: String,
			required: true,
		},
		description: {
			type: String,
			default: "",
		},
		category: {
			type: String,
			default: "general",
		},
		price: {
			type: Number,
			required: true,
			min: 0,
		},
		//total physical stock sitting in the shop
		stock: {
			type: Number,
			required: true,
			default: 0,
			min: 0,
		},
		//part of "stock" that is temporarily locked by an active checkout
		reservedStock: {
			type: Number,
			required: true,
			default: 0,
			min: 0,
		},
		image: {
			type: String,
			default: "/default-product.jpg",
		},
		isActive: {
			type: Boolean,
			default: true,
		},
	},
	{ timestamps: true }
);

//availableStock is what a new customer is actually allowed to buy
productSchema.virtual("availableStock").get(function () {
	return this.stock - this.reservedStock;
});

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

const Product = mongoose.model("Product", productSchema);
export default Product;
