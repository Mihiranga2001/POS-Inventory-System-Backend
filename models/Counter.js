import mongoose from "mongoose";

//used to generate collision free sequential ids (ORD0001, PAY0001 ...)
const counterSchema = new mongoose.Schema({
	_id: {
		type: String,
		required: true,
	},
	seq: {
		type: Number,
		required: true,
		default: 0,
	},
});

const Counter = mongoose.model("Counter", counterSchema);

export async function getNextSequence(name) {
	const counter = await Counter.findByIdAndUpdate(
		name,
		{ $inc: { seq: 1 } },
		{ new: true, upsert: true }
	);
	return counter.seq;
}

export default Counter;
