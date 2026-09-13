//tiny helper so controllers can throw errors that already carry a http status

export function createError(statusCode, message, details) {
	const error = new Error(message);
	error.statusCode = statusCode;
	if (details != null) {
		error.details = details;
	}
	return error;
}

export function sendError(res, error, fallbackMessage) {
	const statusCode = error.statusCode || 500;

	if (statusCode === 500) {
		console.error(fallbackMessage || "Unexpected error", error);
	}

	res.status(statusCode).json({
		message: statusCode === 500 ? fallbackMessage || "Internal server error" : error.message,
		details: error.details || null,
	});
}
