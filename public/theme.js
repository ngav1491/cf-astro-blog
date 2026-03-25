(function () {
	const root = document.documentElement;
	const NAV_CONDENSE_ENTER_Y = 56;
	const NAV_CONDENSE_EXIT_Y = 20;
	const ROUTE_TRANSITION_ORDER = [
		{
			order: 0,
			matches: (pathname) => pathname === "/",
		},
		{
			order: 1,
			matches: (pathname) =>
				pathname === "/blog" || pathname.startsWith("/blog/"),
		},
		{
			order: 2,
			matches: (pathname) => pathname === "/search",
		},
	];
	let isNavCondensed = root.hasAttribute("data-nav-condensed");
	let isRouteTransitioning = false;
	let isThemeTransitioning = false;
	let syncFrame = 0;
	let pendingForceSync = false;

	const theme = localStorage.getItem("theme");
	if (theme === "dark" || theme === "light") {
		root.setAttribute("data-theme", theme);
	}

	const normalizeScrollY = (scrollY) =>
		Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;

	const getRouteTransitionOrder = (pathname) => {
		const matchedRoute = ROUTE_TRANSITION_ORDER.find((route) =>
			route.matches(pathname),
		);

		return matchedRoute?.order ?? null;
	};

	const getRouteTransitionDirection = (fromUrl, toUrl, fallbackDirection) => {
		if (fallbackDirection === "back") {
			return fallbackDirection;
		}

		const fromOrder = getRouteTransitionOrder(fromUrl.pathname);
		const toOrder = getRouteTransitionOrder(toUrl.pathname);

		if (fromOrder === null || toOrder === null || fromOrder === toOrder) {
			return fallbackDirection;
		}

		return toOrder > fromOrder ? "forward" : "back";
	};

	const getInitialNavCondensedState = (scrollY) =>
		normalizeScrollY(scrollY) >= NAV_CONDENSE_ENTER_Y;

	const getNextNavCondensedState = (scrollY) => {
		const normalizedScrollY = normalizeScrollY(scrollY);

		if (isNavCondensed) {
			return normalizedScrollY > NAV_CONDENSE_EXIT_Y;
		}

		return normalizedScrollY >= NAV_CONDENSE_ENTER_Y;
	};

	// 测量导航栏子元素的自然内容宽度（不受容器宽度约束）
	const measureNavContentWidth = () => {
		const shell = document.querySelector(".site-nav-shell");
		if (!shell) return 0;
		const style = window.getComputedStyle(shell);
		const gap = parseFloat(style.columnGap) || parseFloat(style.gap) || 0;
		const pl = parseFloat(style.paddingLeft) || 0;
		const pr = parseFloat(style.paddingRight) || 0;
		const children = Array.from(shell.children);
		if (children.length === 0) return pl + pr;
		let totalW = pl + pr + gap * Math.max(0, children.length - 1);
		for (const child of children) {
			totalW += child.getBoundingClientRect().width;
		}
		return Math.ceil(totalW);
	};

	// 根据内容宽度动态计算胶囊内距，仅在内容超过默认胶囊时扩展
	const syncCondensedNavWidth = () => {
		if (!isNavCondensed) {
			root.style.removeProperty("--nav-shell-condensed-computed-inset");
			return;
		}
		const MIN_INSET_PX = 13; // ~0.8rem 保证与屏幕边缘的最小间距
		const NAV_MAX_W = 1060; // 与 CSS --nav-shell-max-width 对应
		const vw = window.innerWidth;
		// 计算默认胶囊宽度（当前 CSS 公式的 JS 等价）
		const defaultInset = Math.max(MIN_INSET_PX, (vw - NAV_MAX_W) / 2);
		const defaultCapsuleW = vw - defaultInset * 2;
		const contentW = measureNavContentWidth();
		if (contentW <= defaultCapsuleW || contentW === 0) {
			// 内容在默认胶囊内放得下，维持现状
			root.style.removeProperty("--nav-shell-condensed-computed-inset");
			return;
		}
		// 内容超出，扩展胶囊到内容所需宽度（但不超过屏幕边距限制）
		const maxCapsuleW = vw - MIN_INSET_PX * 2;
		const newCapsuleW = Math.min(contentW, maxCapsuleW);
		const newInset = Math.max(MIN_INSET_PX, (vw - newCapsuleW) / 2);
		root.style.setProperty(
			"--nav-shell-condensed-computed-inset",
			`${newInset.toFixed(1)}px`,
		);
	};

	const applyNavState = (nextCondensed) => {
		if (nextCondensed === isNavCondensed) {
			return;
		}

		isNavCondensed = nextCondensed;
		root.toggleAttribute("data-nav-condensed", nextCondensed);
		// 状态切换后重新计算胶囊宽度
		window.requestAnimationFrame(syncCondensedNavWidth);
	};

	const syncRootAttributeToDocument = (name, nextDocument) => {
		const value = root.getAttribute(name);

		if (value === null) {
			nextDocument.documentElement.removeAttribute(name);
			return;
		}

		nextDocument.documentElement.setAttribute(name, value);
	};

	const syncNavState = ({ force = false } = {}) => {
		if (isRouteTransitioning) {
			return;
		}

		const nextCondensed = force
			? getInitialNavCondensedState(window.scrollY)
			: getNextNavCondensedState(window.scrollY);

		applyNavState(nextCondensed);
	};

	const requestNavSync = (force = false) => {
		pendingForceSync ||= force;

		if (syncFrame) {
			return;
		}

		syncFrame = window.requestAnimationFrame(() => {
			syncFrame = 0;
			const shouldForceSync = pendingForceSync;
			pendingForceSync = false;
			syncNavState({ force: shouldForceSync });
		});
	};

	syncNavState({ force: true });
	// 首次加载时，DOM 就绪后测量并调整胶囊宽度（处理页面刷新时已滚动的情况）
	document.addEventListener("DOMContentLoaded", () => {
		window.requestAnimationFrame(syncCondensedNavWidth);
	});
	window.addEventListener("scroll", () => requestNavSync(), { passive: true });
	window.addEventListener(
		"resize",
		() => {
			requestNavSync(true);
			// resize 时重新测量，即使胶囊状态未变化
			window.requestAnimationFrame(syncCondensedNavWidth);
		},
		{ passive: true },
	);
	document.addEventListener("astro:page-load", () => requestNavSync(true));
	document.addEventListener("astro:before-preparation", (event) => {
		event.direction = getRouteTransitionDirection(
			event.from,
			event.to,
			event.direction,
		);
	});
	document.addEventListener("astro:before-swap", (event) => {
		isRouteTransitioning = true;
		syncRootAttributeToDocument("data-theme", event.newDocument);
		event.newDocument.documentElement.toggleAttribute(
			"data-nav-condensed",
			isNavCondensed,
		);

		const unlockNavSync = () => {
			isRouteTransitioning = false;
			requestNavSync(true);
		};

		if (event.viewTransition?.finished) {
			event.viewTransition.finished.finally(() => {
				window.requestAnimationFrame(unlockNavSync);
			});
			return;
		}

		window.requestAnimationFrame(unlockNavSync);
	});

	const prefersReducedMotion = () =>
		window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const getThemeToggleCenter = (toggle) => {
		const rect = toggle.getBoundingClientRect();
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
		};
	};

	const clampToViewport = (value, max) =>
		Math.min(Math.max(value, 0), Math.max(max, 0));

	const getThemeTransitionOrigin = (event, toggle) => {
		const isPointerTriggered = event.detail > 0;

		if (isPointerTriggered) {
			return {
				x: clampToViewport(event.clientX, window.innerWidth),
				y: clampToViewport(event.clientY, window.innerHeight),
			};
		}

		return getThemeToggleCenter(toggle);
	};

	const getThemeRippleRadius = (x, y) => {
		const width = window.innerWidth;
		const height = window.innerHeight;
		const maxHorizontal = Math.max(x, width - x);
		const maxVertical = Math.max(y, height - y);
		return Math.hypot(maxHorizontal, maxVertical);
	};

	const applyThemePreference = (nextTheme) => {
		root.setAttribute("data-theme", nextTheme);
		localStorage.setItem("theme", nextTheme);
	};

	const resolveNextTheme = () => {
		const current = root.getAttribute("data-theme");
		const prefersDark = window.matchMedia(
			"(prefers-color-scheme: dark)",
		).matches;

		return current === "dark" || (!current && prefersDark) ? "light" : "dark";
	};

	const runThemeTransition = (nextTheme, origin) => {
		const canUseViewTransition =
			typeof document.startViewTransition === "function" &&
			typeof document.documentElement.animate === "function";

		if (!canUseViewTransition || prefersReducedMotion()) {
			applyThemePreference(nextTheme);
			return Promise.resolve();
		}

		root.setAttribute("data-theme-switching", "ripple");

		let transition;
		try {
			transition = document.startViewTransition(() => {
				applyThemePreference(nextTheme);
			});
		} catch {
			root.removeAttribute("data-theme-switching");
			applyThemePreference(nextTheme);
			return Promise.resolve();
		}

		const rippleMotion = transition.ready
			.then(() => {
				const radius = getThemeRippleRadius(origin.x, origin.y);
				const clipPath = [
					`circle(0px at ${origin.x}px ${origin.y}px)`,
					`circle(${radius}px at ${origin.x}px ${origin.y}px)`,
				];

				const animation = document.documentElement.animate(
					{
						clipPath,
					},
					{
						duration: 620,
						easing: "cubic-bezier(0.22, 1, 0.36, 1)",
						pseudoElement: "::view-transition-new(root)",
					},
				);

				return animation.finished.catch(() => undefined);
			})
			.catch(() => undefined);

		return Promise.allSettled([transition.finished, rippleMotion]).finally(
			() => {
				root.removeAttribute("data-theme-switching");
			},
		);
	};

	document.addEventListener("click", (event) => {
		if (!(event.target instanceof Element)) {
			return;
		}

		const toggle = event.target.closest(".theme-toggle");
		if (!toggle) {
			return;
		}

		if (isThemeTransitioning) {
			return;
		}

		isThemeTransitioning = true;
		const next = resolveNextTheme();
		const origin = getThemeTransitionOrigin(event, toggle);

		void runThemeTransition(next, origin).finally(() => {
			isThemeTransitioning = false;
		});
	});
})();
