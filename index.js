import express from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import cors from "cors";
import dotenv from "dotenv";

import userRouter from "./routes/userRouter.js";
import productRouter from "./routes/productRouter.js";
import cartRouter from "./routes/cartRouter.js";
import orderRouter from "./routes/orderRouter.js";
import paymentRouter from "./routes/paymentRouter.js";
import { startReservationScheduler } from "../utils/reservationScheduler.js";

dotenv.config();

const mongoURI = process.env.MONGO_URL;

mongoose
	.connect(mongoURI)
	.then(() => {
		console.log("Connected to MongoDB Cluster");
		//start the 5 minute reservation sweeper only after the db is ready
		startReservationScheduler();
	})
	.catch((error) => {
		console.error("MongoDB connection failed", error);
	});

const app = express();

app.use(cors());

app.use(express.json());

app.use((req, res, next) => {
	const authorizationHeader = req.header("Authorization");

	if (authorizationHeader != null) {
		const token = authorizationHeader.replace("Bearer ", "");

		jwt.verify(token, process.env.JWT_SECRET, (error, content) => {
			if (content == null) {
				res.status(401).json({
					message: "invalid token",
				});
			} else {
				req.user = content;

				next();
			}
		});
	} else {
		next();
	}
});

app.get("/", (req, res) => {
	res.json({
		service: "Techloom POS Order & Inventory System - Task 01",
		status: "running",
		reservationWindowMinutes: Number(process.env.RESERVATION_TIMEOUT_MINUTES || 5),
		endpoints: {
			users: "/api/users",
			products: "/api/products",
			cart: "/api/cart",
			orders: "/api/orders",
			payments: "/api/payments",
		},
	});
});

app.get("/health", (req, res) => {
	res.json({
		status: "ok",
		database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
		time: new Date(),
	});
});

app.use("/api/users", userRouter);
app.use("/api/products", productRouter);
app.use("/api/cart", cartRouter);
app.use("/api/orders", orderRouter);
app.use("/api/payments", paymentRouter);

app.use((req, res) => {
	res.status(404).json({ message: "Route not found" });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
	console.log("server is running on port " + port);
});
