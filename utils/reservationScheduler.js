import { expireDueOrders } from "../controllers/orderController.js";

//background sweeper: releases every reservation whose 5 minute window has passed
export function startReservationScheduler() {
	const intervalSeconds = Number(process.env.RESERVATION_SWEEP_INTERVAL_SECONDS || 30);

	setInterval(async () => {
		try {
			const expired = await expireDueOrders();
			if (expired.length > 0) {
				console.log(`Reservation sweeper released ${expired.length} expired order(s):`, expired.join(", "));
			}
		} catch (error) {
			console.error("Reservation sweeper failed", error);
		}
	}, intervalSeconds * 1000);

	console.log(`Reservation sweeper started (every ${intervalSeconds}s)`);
}
