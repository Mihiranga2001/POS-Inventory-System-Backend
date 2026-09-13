import express from "express";
import multer from "multer";
import { uploadImage, deleteImage, getUploadStatus } from "../controllers/uploadController.js";

const uploadRouter = express.Router();

//the file is held in memory and streamed straight to Supabase, so nothing is
//ever written to the host's disk (Render's filesystem is ephemeral anyway)
const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 5 * 1024 * 1024,
	},
	fileFilter: (req, file, callback) => {
		if (file.mimetype.startsWith("image/")) {
			callback(null, true);
		} else {
			callback(new Error("Only image files are allowed"));
		}
	},
});

//multer errors (file too large, wrong type) are thrown outside the controller,
//so they are converted into a clean JSON response here
function handleUpload(req, res, next) {
	upload.single("file")(req, res, (error) => {
		if (error != null) {
			res.status(400).json({
				message: error.message,
			});
			return;
		}
		next();
	});
}

uploadRouter.get("/status", getUploadStatus);
uploadRouter.post("/", handleUpload, uploadImage);
uploadRouter.delete("/:fileName", deleteImage);

export default uploadRouter;
