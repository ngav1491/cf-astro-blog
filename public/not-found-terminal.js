const TERMINAL_STORAGE_KEY = "cf-astro-blog:not-found-terminal-session:v2";
const TERMINAL_LINE_TYPES = new Set(["system", "command", "output", "error"]);
const TERMINAL_HISTORY_ROLES = new Set(["user", "assistant"]);

function normalizeTerminalPath(pathname) {
	const raw = String(pathname ?? "").trim();
	if (!raw) {
		return "/";
	}

	let normalized = raw.startsWith("/") ? raw : `/${raw}`;
	normalized = normalized.replaceAll(/\/+/g, "/");
	if (normalized.length > 180) {
		return `${normalized.slice(0, 177)}...`;
	}
	return normalized;
}

function normalizeTerminalLineType(type) {
	const normalized = String(type ?? "").trim().toLowerCase();
	return TERMINAL_LINE_TYPES.has(normalized) ? normalized : "output";
}

function resolveTerminalLineTypeFromNode(node) {
	if (!(node instanceof HTMLElement)) {
		return "output";
	}
	if (node.classList.contains("terminal-line-command")) {
		return "command";
	}
	if (node.classList.contains("terminal-line-system")) {
		return "system";
	}
	if (node.classList.contains("terminal-line-error")) {
		return "error";
	}
	return "output";
}

function createTerminalLineEntry(text, type) {
	return {
		text: String(text ?? ""),
		type: normalizeTerminalLineType(type),
	};
}

function normalizeStoredTerminalLine(value) {
	if (!value || typeof value !== "object") {
		return null;
	}

	return createTerminalLineEntry(
		/** @type {{ text?: unknown }} */ (value).text,
		/** @type {{ type?: unknown }} */ (value).type,
	);
}

function normalizeStoredTerminalHistory(value) {
	if (!value || typeof value !== "object") {
		return null;
	}

	const role = String(/** @type {{ role?: unknown }} */ (value).role || "")
		.trim()
		.toLowerCase();
	if (!TERMINAL_HISTORY_ROLES.has(role)) {
		return null;
	}

	const content = String(
		/** @type {{ content?: unknown }} */ (value).content ?? "",
	).trim();
	if (!content) {
		return null;
	}

	return {
		role,
		content,
	};
}

function readTerminalSession() {
	const fallback = {
		entries: [],
		history: [],
		lastPath: null,
	};

	try {
		const raw = window.localStorage.getItem(TERMINAL_STORAGE_KEY);
		if (!raw) {
			return fallback;
		}

		const parsed = JSON.parse(raw);
		const entries = Array.isArray(parsed?.entries)
			? parsed.entries
					.map((item) => normalizeStoredTerminalLine(item))
					.filter((item) => item !== null)
			: [];
		const history = Array.isArray(parsed?.history)
			? parsed.history
					.map((item) => normalizeStoredTerminalHistory(item))
					.filter((item) => item !== null)
			: [];
		const lastPathRaw = String(parsed?.lastPath ?? "").trim();
		const lastPath = lastPathRaw ? normalizeTerminalPath(lastPathRaw) : null;

		return {
			entries,
			history,
			lastPath,
		};
	} catch {
		return fallback;
	}
}

function writeTerminalSession(state) {
	try {
		window.localStorage.setItem(
			TERMINAL_STORAGE_KEY,
			JSON.stringify({
				entries: state.entries,
				history: state.history,
				lastPath: state.lastPath,
			}),
		);
	} catch {}
}

function appendTerminalLine(logNode, text, type) {
	if (!(logNode instanceof HTMLElement)) {
		return;
	}

	const line = document.createElement("p");
	line.className = `terminal-line terminal-line-${normalizeTerminalLineType(type)}`;
	line.textContent = String(text ?? "");
	logNode.appendChild(line);
	logNode.scrollTop = logNode.scrollHeight;
}

function appendTerminalLineWithState(logNode, state, text, type) {
	const entry = createTerminalLineEntry(text, type);
	state.entries.push(entry);
	appendTerminalLine(logNode, entry.text, entry.type);
}

function appendTerminalBlockWithState(logNode, state, text, type) {
	const lines = String(text ?? "").replaceAll("\r", "").split("\n");
	if (lines.length === 0) {
		appendTerminalLineWithState(logNode, state, "", type);
		return;
	}

	for (const line of lines) {
		appendTerminalLineWithState(logNode, state, line, type);
	}
}

function readInitialEntriesFromDom(logNode) {
	if (!(logNode instanceof HTMLElement)) {
		return [];
	}

	return Array.from(logNode.querySelectorAll(".terminal-line")).map((node) =>
		createTerminalLineEntry(
			node.textContent ?? "",
			resolveTerminalLineTypeFromNode(node),
		),
	);
}

function renderTerminalEntries(logNode, entries) {
	if (!(logNode instanceof HTMLElement)) {
		return;
	}

	logNode.innerHTML = "";
	for (const entry of entries) {
		appendTerminalLine(logNode, entry.text, entry.type);
	}
}

function buildTerminalHistoryMessage(cwd, command) {
	return `PWD=${cwd}\nCOMMAND=${command}`;
}

function initNotFoundTerminal() {
	const root = document.querySelector("[data-not-found-terminal='true']");
	if (!(root instanceof HTMLElement)) {
		return;
	}

	if (root.dataset.terminalReady === "true") {
		return;
	}
	root.dataset.terminalReady = "true";

	const logNode = root.querySelector("[data-terminal-log='true']");
	const formNode = root.querySelector("[data-terminal-form='true']");
	const inputNode = root.querySelector("[data-terminal-input='true']");
	const promptNode = root.querySelector(".terminal-prompt");
	const aiEndpoint = root.dataset.aiEndpoint || "/api/ai/terminal-404";
	const missingPath = root.dataset.missingPath || "/";
	const cwd = normalizeTerminalPath(missingPath);
	const promptPrefix = `guest@404:${cwd}$`;

	if (
		!(logNode instanceof HTMLElement) ||
		!(formNode instanceof HTMLFormElement) ||
		!(inputNode instanceof HTMLInputElement)
	) {
		return;
	}

	if (promptNode instanceof HTMLElement) {
		promptNode.textContent = promptPrefix;
	}

	const terminalState = readTerminalSession();
	if (terminalState.entries.length > 0) {
		renderTerminalEntries(logNode, terminalState.entries);
	} else {
		terminalState.entries = readInitialEntriesFromDom(logNode);
	}

	if (
		terminalState.entries.length > 0 &&
		terminalState.lastPath &&
		terminalState.lastPath !== cwd
	) {
		appendTerminalLineWithState(
			logNode,
			terminalState,
			`[404] 当前路径已切换：${missingPath}`,
			"system",
		);
	}

	terminalState.lastPath = cwd;
	if (terminalState.entries.length === 0) {
		appendTerminalLineWithState(
			logNode,
			terminalState,
			`[404] 未找到路径：${missingPath}`,
			"system",
		);
		appendTerminalLineWithState(
			logNode,
			terminalState,
			"欢迎来到彩蛋终端，输入命令后将由外接 AI 返回终端风格结果。",
			"system",
		);
		appendTerminalLineWithState(
			logNode,
			terminalState,
			"可先试试：help、whoami、ls、pwd、about",
			"system",
		);
	}
	writeTerminalSession(terminalState);
	inputNode.focus();

	const setPendingState = (pending) => {
		if (pending) {
			formNode.dataset.pending = "true";
		} else {
			delete formNode.dataset.pending;
		}
		inputNode.disabled = pending;
	};

	formNode.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (formNode.dataset.pending === "true") {
			return;
		}

		const command = inputNode.value.trim();
		if (!command) {
			return;
		}

		appendTerminalLineWithState(
			logNode,
			terminalState,
			`${promptPrefix} ${command}`,
			"command",
		);
		writeTerminalSession(terminalState);
		inputNode.value = "";

		if (command.toLowerCase() === "clear" || command.toLowerCase() === "cls") {
			logNode.innerHTML = "";
			terminalState.entries = [];
			terminalState.history = [];
			appendTerminalLineWithState(
				logNode,
				terminalState,
				`[404] 未找到路径：${missingPath}`,
				"system",
			);
			appendTerminalLineWithState(logNode, terminalState, "终端已清屏。", "system");
			writeTerminalSession(terminalState);
			inputNode.focus();
			return;
		}

		setPendingState(true);
		appendTerminalLine(logNode, "...正在连接外接 AI 终端...", "system");

		try {
			const response = await fetch(aiEndpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				credentials: "same-origin",
				body: JSON.stringify({
					message: command,
					cwd,
					history: terminalState.history,
				}),
			});

			logNode.lastElementChild?.remove();

			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				appendTerminalLineWithState(
					logNode,
					terminalState,
					`[error] ${payload?.error || `请求失败（${response.status}）`}`,
					"error",
				);
				writeTerminalSession(terminalState);
				return;
			}

			const reply = String(payload?.reply ?? "").trim();
			const outputText = reply || "(无输出)";
			terminalState.history.push({
				role: "user",
				content: buildTerminalHistoryMessage(cwd, command),
			});
			terminalState.history.push({
				role: "assistant",
				content: outputText,
			});

			if (reply === "TERMINAL_CLEAR") {
				logNode.innerHTML = "";
				terminalState.entries = [];
				terminalState.history = [];
				appendTerminalLineWithState(logNode, terminalState, "终端已清屏。", "system");
				writeTerminalSession(terminalState);
				return;
			}

			appendTerminalBlockWithState(logNode, terminalState, outputText, "output");
			writeTerminalSession(terminalState);
		} catch (error) {
			logNode.lastElementChild?.remove();
			appendTerminalLineWithState(
				logNode,
				terminalState,
				`[error] ${error instanceof Error ? error.message : "网络异常，请稍后重试"}`,
				"error",
			);
			writeTerminalSession(terminalState);
		} finally {
			setPendingState(false);
			inputNode.focus();
		}
	});
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initNotFoundTerminal, {
		once: true,
	});
} else {
	initNotFoundTerminal();
}

document.addEventListener("astro:page-load", initNotFoundTerminal);
