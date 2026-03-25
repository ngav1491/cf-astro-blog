(function () {
	if (window.__codeBlockEnhancerInitialized) {
		return;
	}
	window.__codeBlockEnhancerInitialized = true;

	const PRE_SELECTOR = ".prose pre";
	const CODE_SELECTOR = "code";
	const ENHANCED_MARK = "codeEnhanced";
	const COPY_DEFAULT = "复制";
	const COPY_SUCCESS = "已复制";
	const COPY_ERROR = "复制失败";

	const LANGUAGE_LABELS = {
		js: "JavaScript",
		jsx: "JSX",
		ts: "TypeScript",
		tsx: "TSX",
		sh: "Shell",
		bash: "Bash",
		zsh: "Zsh",
		shell: "Shell",
		json: "JSON",
		yaml: "YAML",
		yml: "YAML",
		html: "HTML",
		css: "CSS",
		scss: "SCSS",
		sql: "SQL",
		md: "Markdown",
		markdown: "Markdown",
		plaintext: "Text",
		text: "Text",
		astro: "Astro",
		vue: "Vue",
		py: "Python",
		python: "Python",
		go: "Go",
		rs: "Rust",
		rust: "Rust",
		c: "C",
		cpp: "C++",
		cxx: "C++",
		java: "Java",
		kotlin: "Kotlin",
		swift: "Swift",
		php: "PHP",
		rb: "Ruby",
		ruby: "Ruby",
	};

	const fallbackCopy = (text) => {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		textarea.setAttribute("readonly", "true");
		textarea.style.position = "fixed";
		textarea.style.left = "-9999px";
		document.body.appendChild(textarea);
		textarea.select();
		let copied = false;

		try {
			copied = document.execCommand("copy");
		} catch {
			copied = false;
		}

		document.body.removeChild(textarea);
		return copied;
	};

	const copyText = async (text) => {
		if (
			navigator.clipboard &&
			typeof navigator.clipboard.writeText === "function"
		) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				// 回退到 execCommand，兼容旧浏览器或权限限制场景
			}
		}

		return fallbackCopy(text);
	};

	const formatLanguageLabel = (language) => {
		const normalized = String(language ?? "")
			.trim()
			.toLowerCase();
		if (!normalized) {
			return "Text";
		}

		if (normalized in LANGUAGE_LABELS) {
			return LANGUAGE_LABELS[normalized];
		}

		if (normalized.length <= 4) {
			return normalized.toUpperCase();
		}

		return normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
	};

	const detectLanguage = (codeElement) => {
		if (!(codeElement instanceof HTMLElement)) {
			return "text";
		}

		for (const className of codeElement.classList) {
			if (!className.startsWith("language-")) {
				continue;
			}

			const language = className.slice("language-".length).trim();
			if (language) {
				return language;
			}
		}

		const dataLanguage = codeElement.dataset.language?.trim();
		if (dataLanguage) {
			return dataLanguage;
		}

		return "text";
	};

	const updateCopyButtonState = (button, text) => {
		button.textContent = text;
		button.dataset.state = text;
	};

	const createMacDots = () => {
		const dots = document.createElement("span");
		dots.className = "code-window-dots";
		dots.setAttribute("aria-hidden", "true");
		const closeDot = document.createElement("span");
		closeDot.className = "code-window-dot code-window-dot-close";
		const minimizeDot = document.createElement("span");
		minimizeDot.className = "code-window-dot code-window-dot-minimize";
		const zoomDot = document.createElement("span");
		zoomDot.className = "code-window-dot code-window-dot-zoom";
		dots.append(closeDot, minimizeDot, zoomDot);
		return dots;
	};

	const enhanceCodeBlock = (preElement) => {
		if (!(preElement instanceof HTMLPreElement)) {
			return;
		}

		if (preElement.dataset[ENHANCED_MARK] === "true") {
			return;
		}

		const codeElement = preElement.querySelector(CODE_SELECTOR);
		if (!(codeElement instanceof HTMLElement)) {
			return;
		}

		const parent = preElement.parentElement;
		if (!parent) {
			return;
		}

		const language = detectLanguage(codeElement);
		const languageLabel = formatLanguageLabel(language);

		const wrapper = document.createElement("figure");
		wrapper.className = "prose-code-block";
		wrapper.dataset.codeLanguage = language;

		const head = document.createElement("figcaption");
		head.className = "prose-code-head";

		const headLeft = document.createElement("span");
		headLeft.className = "prose-code-head-left";

		const dots = createMacDots();
		const languageChip = document.createElement("span");
		languageChip.className = "prose-code-lang";
		languageChip.textContent = languageLabel;
		languageChip.setAttribute("aria-hidden", "true");

		headLeft.append(dots, languageChip);

		const copyButton = document.createElement("button");
		copyButton.type = "button";
		copyButton.className = "prose-code-copy";
		copyButton.textContent = COPY_DEFAULT;
		copyButton.setAttribute("aria-label", `复制 ${languageLabel} 代码`);

		let resetTimer = 0;
		copyButton.addEventListener("click", async () => {
			const content = codeElement.textContent ?? "";
			const copied = await copyText(content);
			updateCopyButtonState(copyButton, copied ? COPY_SUCCESS : COPY_ERROR);
			window.clearTimeout(resetTimer);
			resetTimer = window.setTimeout(() => {
				updateCopyButtonState(copyButton, COPY_DEFAULT);
			}, copied ? 1500 : 1800);
		});

		const scroll = document.createElement("div");
		scroll.className = "prose-code-scroll";

		head.append(headLeft, copyButton);
		wrapper.append(head, scroll);

		parent.insertBefore(wrapper, preElement);
		scroll.append(preElement);

		preElement.dataset.codeLanguage = language;
		preElement.dataset[ENHANCED_MARK] = "true";
	};

	const enhanceAll = (root = document) => {
		const targets = root.querySelectorAll(PRE_SELECTOR);
		for (const preElement of targets) {
			enhanceCodeBlock(preElement);
		}
	};

	const init = () => {
		enhanceAll(document);
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}

	document.addEventListener("astro:page-load", () => {
		enhanceAll(document);
	});
})();
