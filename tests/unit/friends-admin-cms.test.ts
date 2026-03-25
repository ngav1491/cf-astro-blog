import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

describe("后台友链直录能力", () => {
	test("友链管理页提供后台直接新增按钮和完整配置项", async () => {
		const source = await readFile("src/admin/routes/friends.ts", "utf8");

		assert.match(
			source,
			/href="#friend-create-form" class="btn btn-primary">添加友链/u,
		);
		assert.match(source, /id="friend-create-form"/u);
		assert.match(source, /action="\/api\/admin\/friends\/create"/u);
		assert.match(source, /name="createName"/u);
		assert.match(source, /name="createSiteUrl"/u);
		assert.match(source, /name="createAvatarUrl"/u);
		assert.match(source, /name="createDescription"/u);
		assert.match(source, /站点简介（可选）/u);
		assert.doesNotMatch(
			source,
			/<textarea[^>]*name="createDescription"[^>]*required/u,
		);
		assert.match(source, /name="createContact"/u);
		assert.match(source, /name="createStatus"/u);
		assert.match(source, /name="createReviewNote"/u);
		assert.match(source, /name="createNote"/u);
		assert.match(source, /不需要前台申请/u);
	});

	test("友链管理路由支持创建友链并处理非法参数与重复站点", async () => {
		const source = await readFile("src/admin/routes/friends.ts", "utf8");

		assert.match(source, /friendsRoutes\.post\("\/create"/u);
		assert.match(source, /parseFriendCreateInput/u);
		assert.match(source, /sanitizeCanonicalUrl/u);
		assert.match(
			source,
			/if \(!name \|\| !siteUrl \|\| !contact \|\| !status\)/u,
		);
		assert.match(source, /status=create-invalid/u);
		assert.match(source, /status=create-duplicate/u);
		assert.match(source, /status=created/u);
	});
});
