import Product from "../models/Product.js";
import { createError } from "./errors.js";

//  Stock model used across the whole app
//  stock          -> physical units in the shop
//  reservedStock  -> units locked by an in flight checkout
//  availableStock -> stock - reservedStock  (what a new buyer may take)
//
//  Overselling is prevented by a SINGLE atomic findOneAndUpdate per product:
//  the $expr condition and the $inc happen inside one MongoDB document lock,
//  so two simultaneous requests can never both read the same "available" value.

export async function reserveStock(items, session) {
	const alreadyReserved = [];

	try {
		for (const item of items) {
			const updated = await Product.findOneAndUpdate(
				{
					productId: item.productId,
					isActive: true,
					$expr: {
						$gte: [{ $subtract: ["$stock", "$reservedStock"] }, item.quantity],
					},
				},
				{
					$inc: { reservedStock: item.quantity },
				},
				{ new: true, session: session }
			);

			if (updated == null) {
				const product = await Product.findOne({ productId: item.productId }).session(session);

				throw createError(
					409,
					product == null
						? `Product ${item.productId} not found`
						: `Insufficient stock for "${product.name}"`,
					{
						productId: item.productId,
						requested: item.quantity,
						available: product == null ? 0 : product.stock - product.reservedStock,
					}
				);
			}

			alreadyReserved.push(item);
		}
	} catch (error) {
		//when transactions are unavailable we undo the partial reservation by hand
		if (session == null) {
			for (const item of alreadyReserved) {
				await Product.updateOne(
					{ productId: item.productId },
					{ $inc: { reservedStock: -item.quantity } }
				);
			}
		}
		throw error;
	}
}

//payment failed / timed out / order cancelled before payment -> unlock the units
export async function releaseReservation(items, session) {
	for (const item of items) {
		await Product.updateOne(
			{ productId: item.productId, reservedStock: { $gte: item.quantity } },
			{ $inc: { reservedStock: -item.quantity } },
			{ session: session }
		);
	}
}

//payment succeeded -> the reserved units physically leave the shop
export async function commitReservation(items, session) {
	for (const item of items) {
		const updated = await Product.findOneAndUpdate(
			{
				productId: item.productId,
				stock: { $gte: item.quantity },
				reservedStock: { $gte: item.quantity },
			},
			{
				$inc: { stock: -item.quantity, reservedStock: -item.quantity },
			},
			{ new: true, session: session }
		);

		if (updated == null) {
			throw createError(409, `Stock inconsistency while confirming product ${item.productId}`);
		}
	}
}

//a PAID order was cancelled -> put the units back on the shelf
export async function restoreStock(items, session) {
	for (const item of items) {
		await Product.updateOne(
			{ productId: item.productId },
			{ $inc: { stock: item.quantity } },
			{ session: session }
		);
	}
}

export function calculateTotal(items) {
	return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
