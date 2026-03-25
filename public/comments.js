(function () {
	const PANEL_SELECTOR = "[data-comments-panel]";
	const TOGGLE_SELECTOR = "[data-comments-toggle]";
	const BODY_SELECTOR = "[data-comments-body]";
	const HOST_SELECTOR = "[data-giscus-host]";
	let disposeComments = () => {};

	const resolveGiscusTheme = () => {
		const currentTheme = document.documentElement.getAttribute("data-theme");

		if (currentTheme === "dark") {
			return "dark";
		}

		if (currentTheme === "light") {
			return "light";
		}

		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	};

	const syncGiscusTheme = () => {
		const iframe = document.querySelector("iframe.giscus-frame");

		if (!(iframe instanceof HTMLIFrameElement)) {
			return;
		}

		iframe.contentWindow?.postMessage(
			{
				giscus: {
					setConfig: {
						theme: resolveGiscusTheme(),
					},
				},
			},
			"https://giscus.app",
		);
	};

	const injectGiscus = (panel) => {
		if (panel.dataset.commentsLoaded === "true") {
			syncGiscusTheme();
			return;
		}

		const host = panel.querySelector(HOST_SELECTOR);

		if (!(host instanceof HTMLElement)) {
			return;
		}

		const script = document.createElement("script");
		script.src = "https://giscus.app/client.js";
		script.async = true;
		script.crossOrigin = "anonymous";
		script.setAttribute("data-repo", panel.dataset.commentsRepo || "");
		script.setAttribute("data-repo-id", panel.dataset.commentsRepoId || "");
		script.setAttribute("data-category", panel.dataset.commentsCategory || "");
		script.setAttribute(
			"data-category-id",
			panel.dataset.commentsCategoryId || "",
		);
		script.setAttribute("data-mapping", panel.dataset.commentsMapping || "pathname");
		script.setAttribute("data-strict", panel.dataset.commentsStrict || "0");
		script.setAttribute(
			"data-reactions-enabled",
			panel.dataset.commentsReactionsEnabled || "1",
		);
		script.setAttribute(
			"data-input-position",
			panel.dataset.commentsInputPosition || "top",
		);
		script.setAttribute("data-lang", panel.dataset.commentsLang || "zh-CN");
		script.setAttribute("data-theme", resolveGiscusTheme());
		host.innerHTML = "";
		host.appendChild(script);
		panel.dataset.commentsLoaded = "true";
	};

	const setExpandedState = (panel, isOpen) => {
		const toggle = panel.querySelector(TOGGLE_SELECTOR);
		const body = panel.querySelector(BODY_SELECTOR);

		if (!(toggle instanceof HTMLButtonElement) || !(body instanceof HTMLElement)) {
			return;
		}

		panel.classList.toggle("is-open", isOpen);
		toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
		body.hidden = !isOpen;
	};

	const initComments = () => {
		disposeComments();

		const panel = document.querySelector(PANEL_SELECTOR);

		if (!(panel instanceof HTMLElement)) {
			return;
		}

		const isReady = panel.dataset.commentsReady === "true";
		const toggle = panel.querySelector(TOGGLE_SELECTOR);

		if (!(toggle instanceof HTMLButtonElement)) {
			return;
		}

		const handleToggle = () => {
			const isOpen = !panel.classList.contains("is-open");
			setExpandedState(panel, isOpen);

			if (isOpen && isReady) {
				injectGiscus(panel);
			}
		};

		const themeObserver = new MutationObserver(() => syncGiscusTheme());
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});

		setExpandedState(panel, false);
		toggle.addEventListener("click", handleToggle);

		disposeComments = () => {
			toggle.removeEventListener("click", handleToggle);
			themeObserver.disconnect();
		};
	};

	document.addEventListener("astro:before-swap", () => disposeComments());
	document.addEventListener("astro:page-load", initComments);

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initComments, { once: true });
	} else {
		initComments();
	}
})();
