import mongoose from "mongoose";

//Mongo transactions only work on a replica set / Atlas.
//If the dev is running a single standalone mongod we fall back to running the
//same work without a session (the stock updates themselves are still atomic,
//and every writer does its own manual rollback).
let transactionsSupported = true;

function isTransactionUnsupported(error) {
	const message = error && error.message ? error.message : "";
	return (
		error.code === 20 ||
		error.codeName === "IllegalOperation" ||
		message.includes("Transaction numbers are only allowed") ||
		message.includes("replica set") ||
		message.includes("not supported")
	);
}

export async function runInTransaction(work) {
	if (!transactionsSupported) {
		return await work(null);
	}

	const session = await mongoose.startSession();

	try {
		let result = null;
		await session.withTransaction(async () => {
			result = await work(session);
		});
		return result;
	} catch (error) {
		if (isTransactionUnsupported(error)) {
			transactionsSupported = false;
			console.warn(
				"MongoDB transactions are not available on this deployment. Falling back to atomic single document updates."
			);
			return await work(null);
		}
		throw error;
	} finally {
		session.endSession();
	}
}

export function usingTransactions() {
	return transactionsSupported;
}
