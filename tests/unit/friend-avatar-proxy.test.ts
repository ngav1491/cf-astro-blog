import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

describe("友链头像代理保护", () => {
	test("友链页头像改为同源代理并禁用 Referer", async () => {
		const source = await readFile("src/pages/friends.astro", "utf8");

		assert.match(source, /buildFriendAvatarProxyUrl/u);
		assert.match(source, /\/api\/friend-links\/avatar\?url=/u);
		assert.match(source, /referrerpolicy="no-referrer"/u);
	});

	test("友链申请路由提供头像代理并限制 SSRF", async () => {
		const source = await readFile("src/admin/routes/friend-links.ts", "utf8");

		assert.match(source, /friendLinksRoutes\.get\("\/avatar"/u);
		assert.match(source, /isBlockedSourceHost/u);
		assert.match(source, /localhost/u);
		assert.match(source, /redirect:\s*"manual"/u);
		assert.match(source, /AVATAR_PROXY_ALLOWED_CONTENT_TYPES/u);
		assert.doesNotMatch(source, /image\/svg\+xml/u);
		assert.match(source, /头像资源类型不支持/u);
		assert.match(source, /cache-control/u);
	});
});
