(function () {
	const HERO_SELECTOR = "[data-hero-depth]";
	const TILT_SELECTOR = "[data-tilt-card]";
	const FINE_POINTER_QUERY = "(any-hover: hover) and (any-pointer: fine)";
	const HERO_SMOOTHING = 0.16;
	const TILT_SMOOTHING = 0.2;
	const MOTION_EPSILON = 0.001;
	let disposeHomeMotion = () => {};

	const prefersReducedMotion = () =>
		window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const prefersFinePointer = () => window.matchMedia(FINE_POINTER_QUERY).matches;

	const isFinePointerEvent = (event) => {
		if (
			typeof PointerEvent !== "undefined" &&
			event instanceof PointerEvent &&
			event.pointerType
		) {
			return event.pointerType === "mouse" || event.pointerType === "pen";
		}

		return prefersFinePointer();
	};

	const stepValue = (current, target, factor) => {
		const next = current + (target - current) * factor;
		return Math.abs(target - next) <= MOTION_EPSILON ? target : next;
	};

	const resetHeroState = (hero) => {
		hero.style.setProperty("--hero-pointer-x", "0");
		hero.style.setProperty("--hero-pointer-y", "0");
		hero.style.setProperty("--hero-scroll-shift", "0px");
	};

	const attachHeroDepth = (hero, disposers) => {
		let frame = 0;
		let currentPointerX = 0;
		let currentPointerY = 0;
		let currentScrollShift = 0;
		let targetPointerX = 0;
		let targetPointerY = 0;
		let targetScrollShift = 0;

		const render = () => {
			currentPointerX = stepValue(
				currentPointerX,
				targetPointerX,
				HERO_SMOOTHING,
			);
			currentPointerY = stepValue(
				currentPointerY,
				targetPointerY,
				HERO_SMOOTHING,
			);
			currentScrollShift = stepValue(
				currentScrollShift,
				targetScrollShift,
				HERO_SMOOTHING,
			);

			hero.style.setProperty("--hero-pointer-x", currentPointerX.toFixed(3));
			hero.style.setProperty("--hero-pointer-y", currentPointerY.toFixed(3));
			hero.style.setProperty(
				"--hero-scroll-shift",
				`${currentScrollShift.toFixed(1)}px`,
			);

			if (
				currentPointerX !== targetPointerX ||
				currentPointerY !== targetPointerY ||
				currentScrollShift !== targetScrollShift
			) {
				frame = window.requestAnimationFrame(render);
				return;
			}

			frame = 0;
		};

		const requestRender = () => {
			if (frame) {
				return;
			}

			frame = window.requestAnimationFrame(render);
		};

		const updateScrollShift = () => {
			targetScrollShift = Math.min(180, Math.max(0, window.scrollY));
			requestRender();
		};

		const handlePointerMove = (event) => {
			if (!isFinePointerEvent(event)) {
				return;
			}

			const rect = hero.getBoundingClientRect();

			if (!rect.width || !rect.height) {
				return;
			}

			const nextX = (event.clientX - rect.left) / rect.width - 0.5;
			const nextY = (event.clientY - rect.top) / rect.height - 0.5;

			targetPointerX = nextX * 1.45;
			targetPointerY = nextY * 1.3;
			requestRender();
		};

		const handlePointerLeave = () => {
			targetPointerX = 0;
			targetPointerY = 0;
			requestRender();
		};

		resetHeroState(hero);
		updateScrollShift();
		hero.addEventListener("pointermove", handlePointerMove);
		hero.addEventListener("pointerleave", handlePointerLeave);
		hero.addEventListener("mousemove", handlePointerMove);
		hero.addEventListener("mouseleave", handlePointerLeave);
		window.addEventListener("scroll", updateScrollShift, { passive: true });
		window.addEventListener("resize", updateScrollShift, { passive: true });
		requestRender();

		disposers.push(() => {
			if (frame) {
				window.cancelAnimationFrame(frame);
			}

			hero.removeEventListener("pointermove", handlePointerMove);
			hero.removeEventListener("pointerleave", handlePointerLeave);
			hero.removeEventListener("mousemove", handlePointerMove);
			hero.removeEventListener("mouseleave", handlePointerLeave);
			window.removeEventListener("scroll", updateScrollShift);
			window.removeEventListener("resize", updateScrollShift);
			resetHeroState(hero);
		});
	};

	const resetTiltState = (card) => {
		card.style.setProperty("--tilt-rotate-x", "0deg");
		card.style.setProperty("--tilt-rotate-y", "0deg");
		card.style.setProperty("--tilt-shift-x", "0");
		card.style.setProperty("--tilt-shift-y", "0");
	};

	const attachTiltCard = (card, disposers) => {
		let frame = 0;
		const tiltScale = Math.min(
			1,
			Math.max(0.18, Number.parseFloat(card.dataset.tiltScale || "1") || 1),
		);
		const shiftScale = Math.min(
			1.4,
			Math.max(
				0.2,
				Number.parseFloat(card.dataset.tiltShiftScale || "1") || 1,
			),
		);
		let currentRotateX = 0;
		let currentRotateY = 0;
		let currentShiftX = 0;
		let currentShiftY = 0;
		let targetRotateX = 0;
		let targetRotateY = 0;
		let targetShiftX = 0;
		let targetShiftY = 0;

		const render = () => {
			currentRotateX = stepValue(
				currentRotateX,
				targetRotateX,
				TILT_SMOOTHING,
			);
			currentRotateY = stepValue(
				currentRotateY,
				targetRotateY,
				TILT_SMOOTHING,
			);
			currentShiftX = stepValue(currentShiftX, targetShiftX, TILT_SMOOTHING);
			currentShiftY = stepValue(currentShiftY, targetShiftY, TILT_SMOOTHING);

			card.style.setProperty("--tilt-rotate-x", `${currentRotateX.toFixed(2)}deg`);
			card.style.setProperty("--tilt-rotate-y", `${currentRotateY.toFixed(2)}deg`);
			card.style.setProperty("--tilt-shift-x", currentShiftX.toFixed(3));
			card.style.setProperty("--tilt-shift-y", currentShiftY.toFixed(3));

			if (
				currentRotateX !== targetRotateX ||
				currentRotateY !== targetRotateY ||
				currentShiftX !== targetShiftX ||
				currentShiftY !== targetShiftY
			) {
				frame = window.requestAnimationFrame(render);
				return;
			}

			frame = 0;
		};

		const requestRender = () => {
			if (frame) {
				return;
			}

			frame = window.requestAnimationFrame(render);
		};

		const handlePointerMove = (event) => {
			if (!isFinePointerEvent(event)) {
				return;
			}

			const rect = card.getBoundingClientRect();

			if (!rect.width || !rect.height) {
				return;
			}

			const normalizedX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
			const normalizedY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;

			targetRotateY = normalizedX * 5.8 * tiltScale;
			targetRotateX = normalizedY * -5.8 * tiltScale;
			targetShiftX = normalizedX * 1.05 * shiftScale;
			targetShiftY = normalizedY * 0.92 * shiftScale;
			requestRender();
		};

		const handlePointerLeave = () => {
			targetRotateX = 0;
			targetRotateY = 0;
			targetShiftX = 0;
			targetShiftY = 0;
			requestRender();
		};

		resetTiltState(card);
		card.addEventListener("pointermove", handlePointerMove);
		card.addEventListener("pointerleave", handlePointerLeave);
		card.addEventListener("mousemove", handlePointerMove);
		card.addEventListener("mouseleave", handlePointerLeave);
		requestRender();

		disposers.push(() => {
			if (frame) {
				window.cancelAnimationFrame(frame);
			}

			card.removeEventListener("pointermove", handlePointerMove);
			card.removeEventListener("pointerleave", handlePointerLeave);
			card.removeEventListener("mousemove", handlePointerMove);
			card.removeEventListener("mouseleave", handlePointerLeave);
			resetTiltState(card);
		});
	};

	const initHomeMotion = () => {
		disposeHomeMotion();

		if (prefersReducedMotion()) {
			return;
		}

		const disposers = [];
		const hero = document.querySelector(HERO_SELECTOR);
		const tiltCards = document.querySelectorAll(TILT_SELECTOR);

		if (hero instanceof HTMLElement) {
			attachHeroDepth(hero, disposers);
		}

		for (const card of tiltCards) {
			if (card instanceof HTMLElement) {
				attachTiltCard(card, disposers);
			}
		}

		disposeHomeMotion = () => {
			for (const dispose of disposers.splice(0)) {
				dispose();
			}
		};
	};

	document.addEventListener("astro:before-swap", () => disposeHomeMotion());
	document.addEventListener("astro:page-load", initHomeMotion);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initHomeMotion, { once: true });
	} else {
		initHomeMotion();
	}
})();
