import express from "express";
import {
	createProduct,
	getProducts,
	getProductById,
	getStockLevels,
	getProductStock,
	updateProduct,
	adjustStock,
	deleteProduct,
} from "../controllers/productController.js";

const productRouter = express.Router();

//static paths must be declared before "/:productId"
productRouter.get("/stock/all", getStockLevels);
productRouter.get("/stock/:productId", getProductStock);

productRouter.post("/", createProduct);
productRouter.get("/", getProducts);
productRouter.get("/:productId", getProductById);
productRouter.put("/:productId", updateProduct);
productRouter.patch("/:productId/stock", adjustStock);
productRouter.delete("/:productId", deleteProduct);

export default productRouter;
