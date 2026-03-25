import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

describe("前端本地时间渲染保护", () => {
	test("基础布局会注入本地时间脚本", async () => {
		const baseLayoutSource = await readFile("src/layouts/Base.astro", "utf8");

		assert.match(baseLayoutSource, /local-time\.js/u);
	});

	test("文章卡片与详情页时间标签会标记为浏览器本地时间渲染", async () => {
		const [postCardSource, postLayoutSource] = await Promise.all([
			readFile("src/components/PostCard.astro", "utf8"),
			readFile("src/layouts/Post.astro", "utf8"),
		]);

		assert.match(postCardSource, /data-local-time="date"/u);
		assert.match(postCardSource, /local-time-pending/u);
		assert.match(postLayoutSource, /data-local-time="date"/u);
		assert.match(postLayoutSource, /local-time-pending/u);
	});

	test("首页最近更新时间会标记为本地时间渲染", async () => {
		const homePageSource = await readFile("src/pages/index.astro", "utf8");

		assert.match(homePageSource, /latestUpdateAt/u);
		assert.match(homePageSource, /data-local-time="date"/u);
	});

	test("搜索结果日期使用浏览器默认本地化格式", async () => {
		const searchScriptSource = await readFile(
			"public/pagefind-search.js",
			"utf8",
		);

		assert.match(searchScriptSource, /toLocaleDateString\(\)/u);
		assert.doesNotMatch(searchScriptSource, /toLocaleDateString\("zh-CN"\)/u);
	});
});
