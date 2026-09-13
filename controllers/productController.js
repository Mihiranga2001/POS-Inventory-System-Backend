import Product from "../models/Product.js";
import Order from "../models/Order.js";
import { isAdmin } from "./userController.js";
import { getNextSequence } from "../models/Counter.js";
import { ACTIVE_STATUSES } from "../utils/orderStatus.js";
import { sendError, createError } from "../utils/errors.js";

//POST /api/products   (admin)
export async function createProduct(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can create products" });
		return;
	}

	try {
		const data = req.body;

		if (data.name == null || data.price == null) {
			throw createError(400, "name and price are required");
		}

		let productId = data.productId;
		if (productId == null) {
			const seq = await getNextSequence("productId");
			productId = "PRD" + String(seq).padStart(4, "0");
		}

		const product = new Product({
			productId: productId,
			name: data.name,
			description: data.description,
			category: data.category,
			price: Number(data.price),
			stock: Number(data.stock || 0),
			image: data.image,
		});

		await product.save();

		res.status(201).json({
			message: "Product created successfully",
			product: product,
		});
	} catch (error) {
		if (error.code === 11000) {
			res.status(409).json({ message: "A product with this productId already exists" });
			return;
		}
		sendError(res, error, "Failed to create product");
	}
}

//GET /api/products?search=&category=&minPrice=&maxPrice=&inStock=true&page=1&limit=20
export async function getProducts(req, res) {
	try {
		const query = {};

		if (!isAdmin(req)) {
			query.isActive = true;
		}

		if (req.query.search) {
			query.$or = [
				{ name: { $regex: req.query.search, $options: "i" } },
				{ description: { $regex: req.query.search, $options: "i" } },
				{ productId: { $regex: req.query.search, $options: "i" } },
			];
		}

		if (req.query.category) {
			query.category = req.query.category;
		}

		if (req.query.minPrice || req.query.maxPrice) {
			query.price = {};
			if (req.query.minPrice) {
				query.price.$gte = Number(req.query.minPrice);
			}
			if (req.query.maxPrice) {
				query.price.$lte = Number(req.query.maxPrice);
			}
		}

		if (req.query.inStock === "true") {
			query.$expr = { $gt: [{ $subtract: ["$stock", "$reservedStock"] }, 0] };
		}

		const page = Math.max(Number(req.query.page || 1), 1);
		const limit = Math.min(Number(req.query.limit || 20), 100);

		const total = await Product.countDocuments(query);
		const products = await Product.find(query)
			.sort({ createdAt: -1 })
			.skip((page - 1) * limit)
			.limit(limit);

		res.json({
			page: page,
			limit: limit,
			total: total,
			totalPages: Math.ceil(total / limit),
			products: products,
		});
	} catch (error) {
		sendError(res, error, "Failed to fetch products");
	}
}

//GET /api/products/:productId
export async function getProductById(req, res) {
	try {
		const product = await Product.findOne({ productId: req.params.productId });

		if (product == null) {
			throw createError(404, "Product not found");
		}

		res.json(product);
	} catch (error) {
		sendError(res, error, "Failed to fetch product");
	}
}

//GET /api/products/stock/all  -> live, accurate stock levels for every product
export async function getStockLevels(req, res) {
	try {
		const products = await Product.find({}).sort({ name: 1 });

		const stockLevels = products.map((product) => {
			return {
				productId: product.productId,
				name: product.name,
				price: product.price,
				totalStock: product.stock,
				reservedStock: product.reservedStock,
				availableStock: product.stock - product.reservedStock,
				isActive: product.isActive,
			};
		});

		res.json({
			generatedAt: new Date(),
			count: stockLevels.length,
			stockLevels: stockLevels,
		});
	} catch (error) {
		sendError(res, error, "Failed to fetch stock levels");
	}
}

//GET /api/products/stock/:productId
export async function getProductStock(req, res) {
	try {
		const product = await Product.findOne({ productId: req.params.productId });

		if (product == null) {
			throw createError(404, "Product not found");
		}

		res.json({
			productId: product.productId,
			name: product.name,
			totalStock: product.stock,
			reservedStock: product.reservedStock,
			availableStock: product.stock - product.reservedStock,
		});
	} catch (error) {
		sendError(res, error, "Failed to fetch product stock");
	}
}

//PUT /api/products/:productId   (admin)
export async function updateProduct(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can update products" });
		return;
	}

	try {
		const product = await Product.findOne({ productId: req.params.productId });

		if (product == null) {
			throw createError(404, "Product not found");
		}

		const data = req.body;
		const update = {};

		if (data.name != null) update.name = data.name;
		if (data.description != null) update.description = data.description;
		if (data.category != null) update.category = data.category;
		if (data.price != null) update.price = Number(data.price);
		if (data.image != null) update.image = data.image;
		if (data.isActive != null) update.isActive = data.isActive;

		//stock can never be set below what is currently reserved
		if (data.stock != null) {
			const newStock = Number(data.stock);
			if (newStock < product.reservedStock) {
				throw createError(
					409,
					`Stock cannot be set below the currently reserved quantity (${product.reservedStock})`
				);
			}
			update.stock = newStock;
		}

		const updated = await Product.findOneAndUpdate(
			{ productId: req.params.productId },
			{ $set: update },
			{ new: true, runValidators: true }
		);

		res.json({
			message: "Product updated successfully",
			product: updated,
		});
	} catch (error) {
		sendError(res, error, "Failed to update product");
	}
}

//PATCH /api/products/:productId/stock   (admin) -> restock, e.g. { "adjustment": 25 }
export async function adjustStock(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can adjust stock" });
		return;
	}

	try {
		const adjustment = Number(req.body.adjustment);

		if (!Number.isInteger(adjustment) || adjustment === 0) {
			throw createError(400, "adjustment must be a non zero integer");
		}

		const updated = await Product.findOneAndUpdate(
			{
				productId: req.params.productId,
				//never allow stock to drop under the reserved units
				$expr: { $gte: [{ $add: ["$stock", adjustment] }, "$reservedStock"] },
			},
			{ $inc: { stock: adjustment } },
			{ new: true }
		);

		if (updated == null) {
			throw createError(409, "Product not found or adjustment would break reserved stock");
		}

		res.json({
			message: "Stock adjusted successfully",
			product: updated,
		});
	} catch (error) {
		sendError(res, error, "Failed to adjust stock");
	}
}

//DELETE /api/products/:productId   (admin)
export async function deleteProduct(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can delete products" });
		return;
	}

	try {
		const product = await Product.findOne({ productId: req.params.productId });

		if (product == null) {
			throw createError(404, "Product not found");
		}

		//a product that is locked inside a live checkout must not disappear
		const activeOrders = await Order.countDocuments({
			"items.productId": req.params.productId,
			status: { $in: ACTIVE_STATUSES },
		});

		if (activeOrders > 0 || product.reservedStock > 0) {
			//soft delete keeps historical orders readable
			await Product.updateOne({ productId: req.params.productId }, { $set: { isActive: false } });

			res.json({
				message: "Product has active reservations, it was deactivated instead of deleted",
				softDeleted: true,
			});
			return;
		}

		await Product.deleteOne({ productId: req.params.productId });

		res.json({
			message: "Product deleted successfully",
			softDeleted: false,
		});
	} catch (error) {
		sendError(res, error, "Failed to delete product");
	}
}
