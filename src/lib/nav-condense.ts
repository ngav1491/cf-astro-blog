export const NAV_CONDENSE_ENTER_Y = 56;
export const NAV_CONDENSE_EXIT_Y = 20;

function normalizeScrollY(scrollY: number): number {
	return Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;
}

export function getInitialNavCondensedState(scrollY: number): boolean {
	return normalizeScrollY(scrollY) >= NAV_CONDENSE_ENTER_Y;
}

export function getNextNavCondensedState(
	scrollY: number,
	isCondensed: boolean,
): boolean {
	const normalizedScrollY = normalizeScrollY(scrollY);

	if (isCondensed) {
		return normalizedScrollY > NAV_CONDENSE_EXIT_Y;
	}

	return normalizedScrollY >= NAV_CONDENSE_ENTER_Y;
}
