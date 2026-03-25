import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

const ROOT_DIR = process.cwd();
const SOURCE_DIR = join(ROOT_DIR, ".pagefind-source");
const OUTPUT_DIR = join(ROOT_DIR, "public", "pagefind");
const META_FILE = join(ROOT_DIR, "public", "pagefind-meta.json");

const forceRemote = process.argv.includes("--remote");
const forceLocal = process.argv.includes("--local");
if (forceRemote && forceLocal) {
	throw new Error("不能同时指定 --local 与 --remote。");
}

const requestedMode = forceRemote ? "remote" : forceLocal ? "local" : "auto";

const POSTS_QUERY = `
SELECT
	p.id AS id,
	p.slug AS slug,
	p.title AS title,
	p.excerpt AS excerpt,
	p.content AS content,
	p.published_at AS publishedAt,
	p.updated_at AS updatedAt,
	p.author_name AS authorName,
	p.featured_image_key AS featuredImageKey,
	p.featured_image_alt AS featuredImageAlt,
	c.slug AS categorySlug,
	c.name AS categoryName
FROM blog_posts p
LEFT JOIN blog_categories c ON c.id = p.category_id
WHERE
	p.status = 'published'
	OR (
		p.status = 'scheduled'
		AND p.publish_at IS NOT NULL
		AND p.publish_at <= datetime('now')
	)
ORDER BY COALESCE(p.published_at, p.updated_at, p.created_at) DESC;
`;

const TAGS_QUERY = `
SELECT
	pt.post_id AS postId,
	t.slug AS slug,
	t.name AS name
FROM blog_post_tags pt
JOIN blog_tags t ON t.id = pt.tag_id
ORDER BY pt.post_id ASC;
`;

function sanitizePlainText(value, maxLength) {
	return String(value ?? "")
		.replaceAll(/\r/g, "")
		.replaceAll(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
}

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function stripMarkdown(value) {
	return String(value ?? "")
		.replaceAll(/```[\s\S]*?```/g, " ")
		.replaceAll(/`[^`]*`/g, " ")
		.replaceAll(/!\[[^\]]*]\([^)]*\)/g, " ")
		.replaceAll(/\[([^\]]+)]\(([^)]+)\)/g, "$1")
		.replaceAll(/<[^>]+>/g, " ")
		.replaceAll(/[*_~>#-]+/g, " ")
		.replaceAll(/\s+/g, " ")
		.trim();
}

function toIsoDate(value) {
	if (!value) {
		return "";
	}

	const raw = String(value).trim();
	if (!raw) {
		return "";
	}

	const normalized = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function runWranglerQuery(command, sourceMode) {
	const modeFlag = sourceMode === "remote" ? "--remote" : "--local";
	const stdout = execFileSync(
		"npx",
		[
			"wrangler",
			"d1",
			"execute",
			"DB",
			modeFlag,
			"--command",
			command,
			"--json",
		],
		{
			encoding: "utf8",
			stdio: ["ignore", "pipe", "inherit"],
		},
	);

	const jsonStart = stdout.indexOf("[");
	const jsonEnd = stdout.lastIndexOf("]");
	if (jsonStart < 0 || jsonEnd < jsonStart) {
		throw new Error("wrangler 输出中未找到可解析的 JSON 结果。");
	}

	const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
	const rows = Array.isArray(parsed) ? parsed[0]?.results : [];
	return Array.isArray(rows) ? rows : [];
}

function readRowsForMode(sourceMode) {
	return {
		postsRows: runWranglerQuery(POSTS_QUERY, sourceMode),
		tagsRows: runWranglerQuery(TAGS_QUERY, sourceMode),
	};
}

function resolveSourceRows() {
	const attempts =
		requestedMode === "auto" ? ["local", "remote"] : [requestedMode];
	let fallback = null;

	for (let index = 0; index < attempts.length; index += 1) {
		const mode = attempts[index];
		const hasNext = index < attempts.length - 1;

		try {
			const rows = readRowsForMode(mode);

			if (
				requestedMode === "auto" &&
				mode === "local" &&
				rows.postsRows.length === 0 &&
				hasNext
			) {
				console.warn("[Pagefind] 本地 D1 未读取到文章，自动回退远端 D1。");
				fallback = { mode, ...rows };
				continue;
			}

			return { mode, ...rows };
		} catch (error) {
			console.warn(`[Pagefind] 读取 ${mode} D1 失败。`);
			console.warn(error instanceof Error ? error.message : String(error));
		}
	}

	if (fallback) {
		return fallback;
	}

	return {
		mode: requestedMode === "remote" ? "remote" : "local",
		postsRows: [],
		tagsRows: [],
	};
}

async function ensureDirectory(pathname) {
	await mkdir(pathname, { recursive: true });
}

async function writeHtmlFile(pathname, content) {
	await ensureDirectory(dirname(pathname));
	await writeFile(pathname, content, "utf8");
}

async function buildSourceFiles(posts) {
	await rm(SOURCE_DIR, { recursive: true, force: true });
	await ensureDirectory(SOURCE_DIR);

	if (posts.length === 0) {
		await writeHtmlFile(
			join(SOURCE_DIR, "index.html"),
			`<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
	<title>暂无可索引内容</title>
</head>
<body>
	<main data-pagefind-body>
		<h1>暂无可索引内容</h1>
		<p>请先发布文章后再生成搜索索引。</p>
	</main>
</body>
</html>`,
		);
		return;
	}

	for (const post of posts) {
		const title = escapeHtml(post.title);
		const excerpt = escapeHtml(post.excerpt);
		const authorName = escapeHtml(post.authorName);
		const categoryName = escapeHtml(post.categoryName);
		const tagsText = escapeHtml(post.tagNames.join("、"));
		const contentText = escapeHtml(post.contentText);
		const html = `<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8" />
	<title>${title}</title>
	<meta name="description" content="${excerpt}" />
</head>
<body>
	<main data-pagefind-body>
		<h1>${title}</h1>
		<p>${excerpt}</p>
		<p>作者：${authorName || "未署名"}</p>
		<p>分类：${categoryName || "未分类"}</p>
		<p>标签：${tagsText || "无标签"}</p>
		<article>${contentText}</article>
	</main>
</body>
</html>`;

		const filePath = join(SOURCE_DIR, "blog", post.slug, "index.html");
		await writeHtmlFile(filePath, html);
	}
}

async function runPagefind() {
	await rm(OUTPUT_DIR, { recursive: true, force: true });
	await ensureDirectory(join(ROOT_DIR, "public"));

	execFileSync(
		"npx",
		[
			"pagefind",
			"--site",
			SOURCE_DIR,
			"--output-path",
			OUTPUT_DIR,
			"--force-language",
			"zh",
			"--quiet",
		],
		{
			stdio: "inherit",
		},
	);
}

function buildMetaPayload(posts, sourceMode) {
	const categoriesMap = new Map();
	const tagsMap = new Map();

	for (const post of posts) {
		if (post.categorySlug) {
			categoriesMap.set(post.categorySlug, {
				slug: post.categorySlug,
				name: post.categoryName || post.categorySlug,
			});
		}

		for (const tag of post.tags) {
			tagsMap.set(tag.slug, tag);
		}
	}

	return {
		generatedAt: new Date().toISOString(),
		mode: sourceMode,
		posts: posts.map((post) => ({
			slug: post.slug,
			url: `/blog/${post.slug}`,
			title: post.title,
			excerpt: post.excerpt,
			authorName: post.authorName,
			categorySlug: post.categorySlug,
			categoryName: post.categoryName,
			tagSlugs: post.tags.map((tag) => tag.slug),
			tagNames: post.tags.map((tag) => tag.name),
			publishedAt: post.publishedAt,
			updatedAt: post.updatedAt,
			featuredImageKey: post.featuredImageKey,
			featuredImageAlt: post.featuredImageAlt,
		})),
		categories: [...categoriesMap.values()].sort((a, b) =>
			a.name.localeCompare(b.name, "zh-CN"),
		),
		tags: [...tagsMap.values()].sort((a, b) =>
			a.name.localeCompare(b.name, "zh-CN"),
		),
	};
}

function buildPosts(postsRows, tagsRows) {
	const tagsByPostId = new Map();
	for (const row of tagsRows) {
		const postId = Number(row.postId);
		if (!Number.isInteger(postId)) {
			continue;
		}

		const slug = sanitizePlainText(row.slug, 80);
		const name = sanitizePlainText(row.name, 80);
		if (!slug || !name) {
			continue;
		}

		const current = tagsByPostId.get(postId) ?? [];
		current.push({ slug, name });
		tagsByPostId.set(postId, current);
	}

	return postsRows
		.map((row) => {
			const id = Number(row.id);
			const slug = sanitizePlainText(row.slug, 160).toLowerCase();
			const title = sanitizePlainText(row.title, 180);
			if (!Number.isInteger(id) || !slug || !title) {
				return null;
			}

			const excerpt = sanitizePlainText(row.excerpt, 320);
			const contentText = stripMarkdown(row.content).slice(0, 20000);
			const categorySlug = sanitizePlainText(row.categorySlug, 120).toLowerCase();
			const categoryName = sanitizePlainText(row.categoryName, 120);
			const authorName = sanitizePlainText(row.authorName, 120);
			const featuredImageKey = sanitizePlainText(row.featuredImageKey, 240);
			const featuredImageAlt = sanitizePlainText(row.featuredImageAlt, 240);
			const publishedAt = toIsoDate(row.publishedAt) || toIsoDate(row.updatedAt);
			const updatedAt = toIsoDate(row.updatedAt);
			const tags = tagsByPostId.get(id) ?? [];
			const dedupedTags = [...new Map(tags.map((tag) => [tag.slug, tag])).values()];

			return {
				id,
				slug,
				title,
				excerpt: excerpt || title,
				contentText,
				authorName,
				categorySlug,
				categoryName,
				featuredImageKey,
				featuredImageAlt,
				publishedAt,
				updatedAt,
				tags: dedupedTags,
				tagNames: dedupedTags.map((tag) => tag.name),
			};
		})
		.filter((item) => Boolean(item));
}

async function writeMetaFile(payload) {
	await ensureDirectory(dirname(META_FILE));
	await writeFile(META_FILE, JSON.stringify(payload, null, 2), "utf8");
}

async function main() {
	console.log(`[Pagefind] 开始生成索引（请求模式：${requestedMode}）`);

	const { mode: sourceMode, postsRows, tagsRows } = resolveSourceRows();
	console.log(
		`[Pagefind] 使用 ${sourceMode} D1 数据源，读取到 ${postsRows.length} 篇文章。`,
	);

	const posts = buildPosts(postsRows, tagsRows);
	await buildSourceFiles(posts);
	await runPagefind();

	const payload = buildMetaPayload(posts, sourceMode);
	await writeMetaFile(payload);

	await rm(SOURCE_DIR, { recursive: true, force: true });

	console.log(
		`[Pagefind] 索引生成完成（数据源：${sourceMode}），文章 ${payload.posts.length} 篇，分类 ${payload.categories.length} 个，标签 ${payload.tags.length} 个。`,
	);
}

main().catch((error) => {
	console.error("[Pagefind] 索引生成失败");
	console.error(error);
	process.exitCode = 1;
});
