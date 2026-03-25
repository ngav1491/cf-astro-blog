import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, test } from "node:test";
import {
	autoFillPostSeoWithInternalAi,
	generatePostSeoWithInternalAi,
} from "../../src/admin/lib/ai-post-seo";
import type { OpenAICompatibleEndpointConfig } from "../../src/lib/openai-compatible";

const originalFetch = globalThis.fetch;

const endpoint: OpenAICompatibleEndpointConfig = {
	enabled: true,
	baseUrl: "https://api.openai.com/v1",
	apiKey: "sk-internal",
	model: "gpt-4o-mini",
};

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("文章 AI 摘要与 SEO 自动生成", () => {
	test("已发布文章在缺失字段时会自动补全摘要与 SEO", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									excerpt: "这是一段摘要",
									metaTitle: "示例文章 SEO 标题",
									metaDescription: "示例文章 SEO 描述",
									metaKeywords: ["Cloudflare", "Astro", "SEO"],
								}),
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			)) as typeof fetch;

		const result = await autoFillPostSeoWithInternalAi(
			{
				title: "示例文章",
				content: "正文内容",
				status: "published",
				excerpt: null,
				metaTitle: null,
				metaDescription: null,
				metaKeywords: null,
			},
			endpoint,
		);

		assert.equal(result.excerpt, "这是一段摘要");
		assert.equal(result.metaTitle, "示例文章 SEO 标题");
		assert.equal(result.metaDescription, "示例文章 SEO 描述");
		assert.equal(result.metaKeywords, "Cloudflare, Astro, SEO");
	});

	test("手动填写字段不会被 AI 覆盖", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									excerpt: "AI摘要",
									metaTitle: "AI标题",
									metaDescription: "AI描述",
									metaKeywords: ["AI关键词"],
								}),
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			)) as typeof fetch;

		const result = await autoFillPostSeoWithInternalAi(
			{
				title: "示例文章",
				content: "正文内容",
				status: "published",
				excerpt: "手写摘要",
				metaTitle: "手写标题",
				metaDescription: null,
				metaKeywords: "手写关键词",
			},
			endpoint,
		);

		assert.equal(result.excerpt, "手写摘要");
		assert.equal(result.metaTitle, "手写标题");
		assert.equal(result.metaDescription, "AI描述");
		assert.equal(result.metaKeywords, "手写关键词");
	});

	test("草稿状态不会触发自动生成", async () => {
		let called = false;
		globalThis.fetch = (async () => {
			called = true;
			return new Response("{}");
		}) as typeof fetch;

		const result = await autoFillPostSeoWithInternalAi(
			{
				title: "示例文章",
				content: "正文内容",
				status: "draft",
				excerpt: null,
				metaTitle: null,
				metaDescription: null,
				metaKeywords: null,
			},
			endpoint,
		);

		assert.equal(called, false);
		assert.equal(result.excerpt, null);
		assert.equal(result.metaTitle, null);
	});

	test("手动生成功能可直接返回摘要与 SEO 字段", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									excerpt: "手动生成摘要",
									metaTitle: "手动 SEO 标题",
									metaDescription: "手动 SEO 描述",
									metaKeywords: ["标签A", "标签B"],
								}),
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			)) as typeof fetch;

		const result = await generatePostSeoWithInternalAi(
			{
				title: "示例文章",
				content: "正文内容",
			},
			endpoint,
		);

		assert.deepEqual(result, {
			excerpt: "手动生成摘要",
			metaTitle: "手动 SEO 标题",
			metaDescription: "手动 SEO 描述",
			metaKeywords: "标签A, 标签B",
		});
	});

	test("手动生成功能可容错解析带原始换行的 JSON 字符串字段", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: `{"excerpt":"第一行
第二行","metaTitle":"标题","metaDescription":"描述","metaKeywords":["A","B",],}`,
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			)) as typeof fetch;

		const result = await generatePostSeoWithInternalAi(
			{
				title: "示例文章",
				content: "正文内容",
			},
			endpoint,
		);

		assert.deepEqual(result, {
			excerpt: "第一行 第二行",
			metaTitle: "标题",
			metaDescription: "描述",
			metaKeywords: "A, B",
		});
	});

	test("手动生成功能可容错解析半截 JSON 响应并提取摘要", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content:
									'{ "excerpt": "作者分享了博客上线一周后的近况，包括利用 AI 辅助（Vibe',
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			)) as typeof fetch;

		const result = await generatePostSeoWithInternalAi(
			{
				title: "示例文章",
				content: "正文内容",
			},
			endpoint,
		);

		assert.deepEqual(result, {
			excerpt: "我分享了博客上线一周后的近况，包括利用 AI 辅助（Vibe",
			metaTitle: null,
			metaDescription: null,
			metaKeywords: null,
		});
	});

	test("手动生成功能会将第三人称长摘要收敛为第一人称短句", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									excerpt:
										"作者分享了博客上线一周后的近况，包括利用 AI 辅助开发（Vibe Coding）完善功能、在社区宣传收获好评，以及对前端设计（如鼠标倾斜效果）的心得。虽然暂时遗忘了预定的写作计划，但记录了博客初创期的真实心路历程。",
									metaTitle: "标题",
									metaDescription: "描述",
									metaKeywords: ["博客", "AI"],
								}),
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			)) as typeof fetch;

		const result = await generatePostSeoWithInternalAi(
			{
				title: "示例文章",
				content: "正文内容",
			},
			endpoint,
		);

		assert.ok(result?.excerpt?.startsWith("我"));
		assert.ok(!(result?.excerpt ?? "").includes("作者"));
		assert.ok((result?.excerpt?.length ?? 0) <= 88);
	});

	test("后台文章路由提供手动 AI 生成接口", async () => {
		const source = await readFile("src/admin/routes/posts.ts", "utf8");

		assert.match(source, /posts\.post\("\/ai-seo"/u);
		assert.match(source, /generatePostSeoWithInternalAi/u);
		assert.match(source, /内部 AI 接口未配置完整/u);
		assert.doesNotMatch(source, /autoFillPostSeoWithInternalAi/u);
	});
});
