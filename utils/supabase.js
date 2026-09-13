import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { createError } from "./errors.js";

dotenv.config();

let client = null;

//the service_role key bypasses row level security, so it only ever lives on the
//server. the client is created lazily so the app still boots without Supabase
//configured - only the upload routes fail in that case.
export function getSupabase() {
	if (client != null) {
		return client;
	}

	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_KEY;

	if (url == null || key == null || url == "" || key == "") {
		//503 not 500: sendError hides the message on 500, and this one is worth reading
		throw createError(
			503,
			"Image uploads are not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY on the server."
		);
	}

	client = createClient(url, key, {
		auth: {
			persistSession: false,
		},
	});

	return client;
}

export function getBucketName() {
	return process.env.SUPABASE_BUCKET || "images";
}

export function isSupabaseConfigured() {
	return (
		process.env.SUPABASE_URL != null &&
		process.env.SUPABASE_URL != "" &&
		process.env.SUPABASE_SERVICE_KEY != null &&
		process.env.SUPABASE_SERVICE_KEY != ""
	);
}
