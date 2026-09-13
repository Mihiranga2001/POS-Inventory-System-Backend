import express from "express";
import {
	processPayment,
	getPaymentsForOrder,
	getAllPayments,
} from "../controllers/paymentController.js";

const paymentRouter = express.Router();

paymentRouter.post("/:orderId", processPayment);
paymentRouter.get("/order/:orderId", getPaymentsForOrder);
paymentRouter.get("/", getAllPayments);

export default paymentRouter;
