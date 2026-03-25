(function () {
	const FOOTER_SELECTOR = "[data-footer-reveal]";
	let disposeFooterReveal = () => {};

	const setFooterMetrics = (footer) => {
		const height = Math.ceil(footer.getBoundingClientRect().height);
		const revealSpace = Math.ceil(height * 1.28);

		document.documentElement.style.setProperty(
			"--footer-reveal-height",
			`${height}px`,
		);
		document.documentElement.style.setProperty(
			"--footer-reveal-space",
			`${revealSpace}px`,
		);

		return revealSpace;
	};

	const initFooterReveal = () => {
		disposeFooterReveal();

		const footer = document.querySelector(FOOTER_SELECTOR);

		if (!(footer instanceof HTMLElement)) {
			return;
		}

		let frame = 0;
		let revealThreshold = setFooterMetrics(footer);

		const updateVisibility = () => {
			frame = 0;
			revealThreshold = setFooterMetrics(footer);

			const remaining =
				document.documentElement.scrollHeight -
				window.innerHeight -
				window.scrollY;
			const shouldReveal = remaining <= Math.max(96, revealThreshold * 0.72);

			footer.classList.toggle("is-visible", shouldReveal);
		};

		const requestUpdate = () => {
			if (frame) {
				return;
			}

			frame = window.requestAnimationFrame(updateVisibility);
		};

		updateVisibility();
		window.addEventListener("scroll", requestUpdate, { passive: true });
		window.addEventListener("resize", requestUpdate, { passive: true });

		disposeFooterReveal = () => {
			if (frame) {
				window.cancelAnimationFrame(frame);
			}

			window.removeEventListener("scroll", requestUpdate);
			window.removeEventListener("resize", requestUpdate);
			footer.classList.remove("is-visible");
			document.documentElement.style.removeProperty("--footer-reveal-height");
			document.documentElement.style.removeProperty("--footer-reveal-space");
		};
	};

	document.addEventListener("astro:before-swap", () => disposeFooterReveal());
	document.addEventListener("astro:page-load", initFooterReveal);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initFooterReveal, { once: true });
	} else {
		initFooterReveal();
	}
})();
