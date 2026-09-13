import path from "path";
import { isAdmin } from "./userController.js";
import { sendError, createError } from "../utils/errors.js";
import { getSupabase, getBucketName, isSupabaseConfigured } from "../utils/supabase.js";

//POST /api/upload   (admin)  multipart/form-data with a single "file" field
export async function uploadImage(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can upload images" });
		return;
	}

	try {
		if (req.file == null) {
			throw createError(400, "No file received. Send the image in a field named 'file'.");
		}

		const extension = path.extname(req.file.originalname).toLowerCase() || ".png";

		//a timestamp plus random suffix avoids collisions and stops one upload
		//overwriting another that happens to share a filename
		const fileName =
			Date.now() + "-" + Math.random().toString(36).slice(2, 8) + extension;

		const supabase = getSupabase();
		const bucket = getBucketName();

		const { error } = await supabase.storage.from(bucket).upload(fileName, req.file.buffer, {
			contentType: req.file.mimetype,
			cacheControl: "3600",
			upsert: false,
		});

		if (error != null) {
			throw createError(500, "Supabase upload failed: " + error.message);
		}

		const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);

		res.json({
			message: "Image uploaded successfully",
			fileName: fileName,
			url: data.publicUrl,
		});
	} catch (error) {
		sendError(res, error, "Failed to upload image");
	}
}

//DELETE /api/upload/:fileName   (admin)
export async function deleteImage(req, res) {
	if (!isAdmin(req)) {
		res.status(403).json({ message: "Only admins can delete images" });
		return;
	}

	try {
		const supabase = getSupabase();
		const bucket = getBucketName();

		const { error } = await supabase.storage.from(bucket).remove([req.params.fileName]);

		if (error != null) {
			throw createError(500, "Supabase delete failed: " + error.message);
		}

		res.json({
			message: "Image deleted successfully",
			fileName: req.params.fileName,
		});
	} catch (error) {
		sendError(res, error, "Failed to delete image");
	}
}

//GET /api/upload/status -> lets the admin UI show a helpful message when the
//environment variables were never set on the host
export function getUploadStatus(req, res) {
	res.json({
		configured: isSupabaseConfigured(),
		bucket: getBucketName(),
	});
}
