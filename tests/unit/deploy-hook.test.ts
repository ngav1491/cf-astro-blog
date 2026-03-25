import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { triggerDeployHook } from "../../src/admin/lib/deploy-hook";

const originalFetch = globalThis.fetch;

function createEnv(overrides: Partial<Env> = {}): Env {
	return {
		DB: {} as D1Database,
		MEDIA_BUCKET: {} as R2Bucket,
		SESSION: {} as KVNamespace,
		ASSETS: {} as Fetcher,
		SITE_NAME: "测试站点",
		SITE_URL: "https://blog.example.com",
		TURNSTILE_SITE_KEY: "",
		JWT_SECRET: "jwt-secret",
		ADMIN_USERNAME: "",
		ADMIN_GITHUB_LOGIN: "",
		ADMIN_PASSWORD_HASH: "",
		TURNSTILE_SECRET_KEY: "",
		GITHUB_OAUTH_CLIENT_ID: "",
		GITHUB_OAUTH_CLIENT_SECRET: "",
		GITHUB_OAUTH_REDIRECT_URI: "",
		...overrides,
	};
}

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("部署钩子", () => {
	test("未配置钩子地址时会跳过请求", async () => {
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return new Response("ok");
		}) as typeof fetch;

		const triggered = await triggerDeployHook(createEnv(), {
			event: "post-created",
			postId: 1,
		});

		assert.equal(triggered, false);
		assert.equal(called, false);
	});

	test("配置钩子地址后会发送包含鉴权头的 POST 请求", async () => {
		const calls: Array<{ input: string; init?: RequestInit }> = [];
		globalThis.fetch = (async (input, init) => {
			calls.push({ input: String(input), init });
			return new Response("accepted", { status: 202 });
		}) as typeof fetch;

		const triggered = await triggerDeployHook(
			createEnv({
				AUTO_DEPLOY_WEBHOOK_URL: "https://example.com/deploy",
				AUTO_DEPLOY_WEBHOOK_SECRET: "secret-token",
			}),
			{
				event: "post-updated",
				postId: 2,
				postSlug: "hello-world",
				postStatus: "published",
			},
		);

		assert.equal(triggered, true);
		assert.equal(calls.length, 1);
		const requestInfo = calls[0];
		assert.equal(requestInfo.input, "https://example.com/deploy");
		assert.equal(requestInfo.init?.method, "POST");

		const headers = new Headers(requestInfo.init?.headers);
		assert.equal(headers.get("content-type"), "application/json");
		assert.equal(headers.get("x-deploy-token"), "secret-token");

		const payload = JSON.parse(String(requestInfo.init?.body));
		assert.equal(payload.source, "admin-posts");
		assert.equal(payload.siteUrl, "https://blog.example.com");
		assert.equal(payload.event, "post-updated");
		assert.equal(payload.postId, 2);
		assert.equal(payload.postSlug, "hello-world");
		assert.equal(payload.postStatus, "published");
		assert.ok(payload.triggeredAt);
	});

	test("GitHub dispatch 模式会改用 Authorization 并包装 payload", async () => {
		const calls: Array<{ input: string; init?: RequestInit }> = [];
		globalThis.fetch = (async (input, init) => {
			calls.push({ input: String(input), init });
			return new Response(null, { status: 204 });
		}) as typeof fetch;

		const triggered = await triggerDeployHook(
			createEnv({
				AUTO_DEPLOY_WEBHOOK_URL:
					"https://api.github.com/repos/Eric-Terminal/cf-astro-blog/dispatches",
				AUTO_DEPLOY_WEBHOOK_SECRET: "ghp_test_token",
				AUTO_DEPLOY_GITHUB_EVENT_TYPE: "rebuild-search-index",
			}),
			{
				event: "post-created",
				postId: 3,
				postSlug: "auto-deploy",
				postStatus: "published",
			},
		);

		assert.equal(triggered, true);
		assert.equal(calls.length, 1);
		const requestInfo = calls[0];

		const headers = new Headers(requestInfo.init?.headers);
		assert.equal(headers.get("authorization"), "Bearer ghp_test_token");
		assert.equal(headers.get("x-deploy-token"), null);
		assert.equal(headers.get("accept"), "application/vnd.github+json");

		const body = JSON.parse(String(requestInfo.init?.body));
		assert.equal(body.event_type, "rebuild-search-index");
		assert.equal(body.client_payload.source, "admin-posts");
		assert.equal(body.client_payload.postId, 3);
	});
});
