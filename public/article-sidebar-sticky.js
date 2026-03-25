(function () {
	if (window.__articleSidebarStickyBooted) {
		return;
	}
	window.__articleSidebarStickyBooted = true;

	const SIDEBAR_SELECTOR = ".article-sidebar-with-toc";
	const PROFILE_SELECTOR = ".article-profile";
	const TOC_SELECTOR = ".article-toc";
	let disposeCurrent = null;

	const resolveLengthToPx = (rawValue) => {
		const value = rawValue.trim();
		if (!value) {
			return 0;
		}

		const numeric = Number.parseFloat(value);
		if (!Number.isFinite(numeric)) {
			return 0;
		}

		if (value.endsWith("rem")) {
			const rootFontSize = Number.parseFloat(
				window.getComputedStyle(document.documentElement).fontSize,
			);
			return numeric * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
		}

		if (value.endsWith("vh")) {
			return (window.innerHeight * numeric) / 100;
		}

		return numeric;
	};

	const cleanup = () => {
		if (typeof disposeCurrent === "function") {
			disposeCurrent();
			disposeCurrent = null;
		}
	};

	const init = () => {
		cleanup();

		const sidebar = document.querySelector(SIDEBAR_SELECTOR);
		if (!(sidebar instanceof HTMLElement)) {
			return;
		}

		const profile = sidebar.querySelector(PROFILE_SELECTOR);
		if (!(profile instanceof HTMLElement)) {
			return;
		}

		const toc = sidebar.querySelector(TOC_SELECTOR);
		if (!(toc instanceof HTMLElement)) {
			return;
		}

		let profileFrameId = 0;
		let shiftFrameId = 0;

		const syncProfileShift = () => {
			if (shiftFrameId) {
				window.cancelAnimationFrame(shiftFrameId);
			}
			shiftFrameId = window.requestAnimationFrame(() => {
				const stickyTopValue = window
					.getComputedStyle(sidebar)
					.getPropertyValue("--article-sidebar-sticky-top");
				const stickyTopPx = resolveLengthToPx(stickyTopValue);
				const tocTop = toc.getBoundingClientRect().top;
				const profileShift = Math.min(0, Math.round(tocTop - stickyTopPx));
				sidebar.style.setProperty("--article-profile-shift", `${profileShift}px`);
			});
		};

		const syncProfileHeight = () => {
			if (profileFrameId) {
				window.cancelAnimationFrame(profileFrameId);
			}
			profileFrameId = window.requestAnimationFrame(() => {
				const height = Math.ceil(profile.getBoundingClientRect().height);
				sidebar.style.setProperty("--article-profile-height", `${height}px`);
				syncProfileShift();
			});
		};

		syncProfileHeight();
		syncProfileShift();
		window.addEventListener("resize", syncProfileHeight, { passive: true });
		window.addEventListener("scroll", syncProfileShift, { passive: true });

		let resizeObserver = null;
		if ("ResizeObserver" in window) {
			resizeObserver = new ResizeObserver(() => {
				syncProfileHeight();
				syncProfileShift();
			});
			resizeObserver.observe(profile);
			resizeObserver.observe(toc);
		}

		disposeCurrent = () => {
			window.removeEventListener("resize", syncProfileHeight);
			window.removeEventListener("scroll", syncProfileShift);
			if (profileFrameId) {
				window.cancelAnimationFrame(profileFrameId);
			}
			if (shiftFrameId) {
				window.cancelAnimationFrame(shiftFrameId);
			}
			resizeObserver?.disconnect();
			sidebar.style.removeProperty("--article-profile-height");
			sidebar.style.removeProperty("--article-profile-shift");
		};
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}

	document.addEventListener("astro:before-swap", cleanup);
	document.addEventListener("astro:page-load", init);
})();
