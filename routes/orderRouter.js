import express from "express";
import {
	checkout,
	getMyOrders,
	getAllOrders,
	getOrderById,
	cancelOrder,
	expireOrdersNow,
	getSalesReport,
} from "../controllers/orderController.js";

const orderRouter = express.Router();

orderRouter.post("/checkout", checkout);
orderRouter.post("/expire", expireOrdersNow);
orderRouter.get("/all", getAllOrders);
orderRouter.get("/report", getSalesReport);
orderRouter.get("/", getMyOrders);
orderRouter.get("/:orderId", getOrderById);
orderRouter.put("/:orderId/cancel", cancelOrder);

export default orderRouter;
