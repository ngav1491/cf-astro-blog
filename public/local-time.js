(function () {
	const TARGET_SELECTOR = "[data-local-time]";
	const STYLE_OPTIONS = {
		date: {
			year: "numeric",
			month: "long",
			day: "numeric",
		},
		datetime: {
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		},
		time: {
			hour: "2-digit",
			minute: "2-digit",
		},
	};

	const safeParseDate = (value) => {
		const normalized = String(value ?? "").trim();
		if (!normalized) {
			return null;
		}

		const parsed = new Date(normalized);
		if (Number.isNaN(parsed.getTime())) {
			return null;
		}

		return parsed;
	};

	const resolveDatetimeSource = (element) => {
		if (!(element instanceof HTMLElement)) {
			return "";
		}

		if (element instanceof HTMLTimeElement && element.dateTime) {
			return element.dateTime;
		}

		return element.getAttribute("datetime") || element.dataset.datetime || "";
	};

	const resolveDisplayStyle = (element) => {
		const style = String(element.getAttribute("data-local-time") || "date")
			.trim()
			.toLowerCase();
		if (style in STYLE_OPTIONS) {
			return style;
		}

		return "date";
	};

	const formatLocalDate = (date, style) => {
		const options = STYLE_OPTIONS[style] || STYLE_OPTIONS.date;
		return new Intl.DateTimeFormat(undefined, options).format(date);
	};

	const localizeElement = (element) => {
		if (!(element instanceof HTMLElement)) {
			return;
		}

		const source = resolveDatetimeSource(element);
		const parsed = safeParseDate(source);
		if (!parsed) {
			element.classList.remove("local-time-pending");
			return;
		}

		const displayStyle = resolveDisplayStyle(element);
		element.textContent = formatLocalDate(parsed, displayStyle);

		if (!element.title) {
			element.title = formatLocalDate(parsed, "datetime");
		}

		element.classList.remove("local-time-pending");
		element.dataset.localTimeApplied = "true";
	};

	const localizeAll = (root = document) => {
		const targets = root.querySelectorAll(TARGET_SELECTOR);
		for (const target of targets) {
			localizeElement(target);
		}
	};

	const setupMutationObserver = () => {
		if (!(document.body instanceof HTMLBodyElement)) {
			return;
		}

		const observer = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (!(node instanceof HTMLElement)) {
						continue;
					}

					if (node.matches(TARGET_SELECTOR)) {
						localizeElement(node);
					}
					localizeAll(node);
				}
			}
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});
	};

	const init = () => {
		localizeAll(document);
		setupMutationObserver();
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}

	document.addEventListener("astro:page-load", () => {
		localizeAll(document);
	});
})();
