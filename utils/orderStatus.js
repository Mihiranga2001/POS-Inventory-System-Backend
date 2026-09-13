//single source of truth for the order state machine

export const ORDER_STATUS = {
	PENDING: "PENDING", //order row created, stock not locked yet
	RESERVED: "RESERVED", //stock locked, waiting for payment (5 min window)
	PROCESSING: "PROCESSING", //payment is being handled right now (internal lock)
	PAID: "PAID", //payment success, stock permanently deducted
	FAILED: "FAILED", //payment failed, stock released
	EXPIRED: "EXPIRED", //5 min window passed or gateway timeout, stock released
	CANCELLED: "CANCELLED", //cancelled by user/admin, stock released or restored
};

const ALLOWED_TRANSITIONS = {
	[ORDER_STATUS.PENDING]: [
		ORDER_STATUS.RESERVED,
		ORDER_STATUS.FAILED,
		ORDER_STATUS.CANCELLED,
		ORDER_STATUS.EXPIRED,
	],
	[ORDER_STATUS.RESERVED]: [
		ORDER_STATUS.PROCESSING,
		ORDER_STATUS.PAID,
		ORDER_STATUS.FAILED,
		ORDER_STATUS.EXPIRED,
		ORDER_STATUS.CANCELLED,
	],
	[ORDER_STATUS.PROCESSING]: [
		ORDER_STATUS.PAID,
		ORDER_STATUS.FAILED,
		ORDER_STATUS.EXPIRED,
		ORDER_STATUS.RESERVED, //rollback when the gateway call crashed
	],
	[ORDER_STATUS.PAID]: [ORDER_STATUS.CANCELLED],
	//terminal states
	[ORDER_STATUS.FAILED]: [],
	[ORDER_STATUS.EXPIRED]: [],
	[ORDER_STATUS.CANCELLED]: [],
};

export const ACTIVE_STATUSES = [
	ORDER_STATUS.PENDING,
	ORDER_STATUS.RESERVED,
	ORDER_STATUS.PROCESSING,
];

export const TERMINAL_STATUSES = [
	ORDER_STATUS.FAILED,
	ORDER_STATUS.EXPIRED,
	ORDER_STATUS.CANCELLED,
];

export function canTransition(from, to) {
	const allowed = ALLOWED_TRANSITIONS[from];
	if (allowed == null) {
		return false;
	}
	return allowed.includes(to);
}

export function assertTransition(from, to) {
	if (!canTransition(from, to)) {
		const error = new Error(`Invalid order status transition: ${from} -> ${to}`);
		error.statusCode = 409;
		throw error;
	}
}
