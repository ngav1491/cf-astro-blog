const DEPLOY_HOOK_TIMEOUT_MS = 6000;

interface DeployHookPayload {
	event: string;
	postId?: number;
	postSlug?: string;
	postStatus?: string;
}

function isGitHubDispatchUrl(url: URL): boolean {
	return (
		url.hostname === "api.github.com" &&
		/^\/repos\/[^/]+\/[^/]+\/dispatches$/u.test(url.pathname)
	);
}

function normalizeWebhookUrl(rawUrl: unknown): string | null {
	if (typeof rawUrl !== "string") {
		return null;
	}

	const value = rawUrl.trim();
	if (!value) {
		return null;
	}

	try {
		const parsed = new URL(value);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return null;
		}
		return parsed.toString();
	} catch {
		return null;
	}
}

export async function triggerDeployHook(
	env: Env,
	payload: DeployHookPayload,
): Promise<boolean> {
	const webhookUrl = normalizeWebhookUrl(env.AUTO_DEPLOY_WEBHOOK_URL);
	if (!webhookUrl) {
		return false;
	}

	const headers = new Headers({
		"content-type": "application/json",
		"user-agent": "cf-astro-blog-admin/1.0",
	});
	const secret = String(env.AUTO_DEPLOY_WEBHOOK_SECRET ?? "").trim();
	const webhook = new URL(webhookUrl);
	const githubDispatchMode = isGitHubDispatchUrl(webhook);

	let requestBody: Record<string, unknown> = {
		source: "admin-posts",
		siteUrl: String(env.SITE_URL ?? ""),
		triggeredAt: new Date().toISOString(),
		...payload,
	};
	if (githubDispatchMode) {
		if (!secret) {
			console.error("[Deployment hook] Chế độ GitHub dispatch thiếu token, đã bỏ qua.");
			return false;
		}

		headers.set("accept", "application/vnd.github+json");
		headers.set("x-github-api-version", "2022-11-28");
		headers.set("authorization", `Bearer ${secret}`);
		requestBody = {
			event_type:
				String(env.AUTO_DEPLOY_GITHUB_EVENT_TYPE ?? "").trim() ||
				"rebuild-search-index",
			client_payload: requestBody,
		};
	} else if (secret) {
		headers.set("x-deploy-token", secret);
	}

	const abortController = new AbortController();
	const timeoutId = setTimeout(() => {
		abortController.abort();
	}, DEPLOY_HOOK_TIMEOUT_MS);

	try {
		const response = await fetch(webhookUrl, {
			method: "POST",
			headers,
			body: JSON.stringify(requestBody),
			signal: abortController.signal,
		});

		if (!response.ok) {
			console.error(`[Deployment hook] Yêu cầu thất bại, mã trạng thái: ${response.status}`);
			return false;
		}

		return true;
	} catch (error) {
		console.error("[Deployment hook] Ngoại lệ yêu cầu", error);
		return false;
	} finally {
		clearTimeout(timeoutId);
	}
}
