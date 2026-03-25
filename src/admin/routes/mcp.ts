import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { type Context, Hono } from "hono";
import * as z from "zod/v3";
import { triggerDeployHook } from "@/admin/lib/deploy-hook";
import {
	blogCategories,
	blogPosts,
	blogPostTags,
	blogTags,
	mcpAuditLogs,
	siteAppearanceSettings,
} from "@/db/schema";
import { getDb } from "@/lib/db";
import { timingSafeEqualText } from "@/lib/password";
import {
	buildUrlSlug,
	sanitizeCanonicalUrl,
	sanitizeMediaKey,
	sanitizePlainText,
	sanitizePostStatus,
	sanitizeSlug,
} from "@/lib/security";
import type { AdminAppEnv } from "../middleware/auth";

const mcpRoutes = new Hono<AdminAppEnv>();
type BlogDb = ReturnType<typeof getDb>;

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 100_000;
const MAX_AUTHOR_NAME_LENGTH = 80;
const MAX_SLUG_LENGTH = 120;
const MAX_EXCERPT_LENGTH = 200;
const MAX_META_TITLE_LENGTH = 200;
const MAX_META_DESCRIPTION_LENGTH = 160;
const MAX_META_KEYWORDS_LENGTH = 200;
const MAX_CANONICAL_URL_LENGTH = 255;
const MAX_CATEGORY_NAME_LENGTH = 60;
const MAX_TAG_NAME_LENGTH = 60;
const MAX_TAG_COUNT = 20;
const MAX_FEATURED_IMAGE_KEY_LENGTH = 255;
const MAX_FEATURED_IMAGE_ALT_LENGTH = 200;
const MAX_LIST_LIMIT = 50;
const MAX_KEYWORD_LENGTH = 120;

const DEFAULT_MCP_RATE_LIMIT_PER_MINUTE = 30;
const DEFAULT_MCP_AUTH_FAIL_LIMIT_PER_MINUTE = 20;
const DEFAULT_MCP_AUTH_BLOCK_SECONDS = 3600;
const MCP_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

interface CreatePostInput {
	title: string;
	slug: string;
	content: string;
	authorName: string;
	excerpt: string | null;
	status: "draft" | "published" | "scheduled";
	publishAt: string | null;
	categoryName: string | null;
	tagNames: string[];
	featuredImageKey: string | null;
	featuredImageAlt: string | null;
	metaTitle: string | null;
	metaDescription: string | null;
	metaKeywords: string | null;
	canonicalUrl: string | null;
}

type ParseCreatePostInputResult =
	| {
			data: CreatePostInput;
	  }
	| {
			error: string;
	  };

interface ListPostsInput {
	limit: number;
	status: "draft" | "published" | "scheduled" | null;
	keyword: string | null;
	includeContent: boolean;
}

type ParseListPostsInputResult =
	| {
			data: ListPostsInput;
	  }
	| {
			error: string;
	  };

interface GetPostInput {
	id: number | null;
	slug: string | null;
	includeContent: boolean;
}

type ParseGetPostInputResult =
	| {
			data: GetPostInput;
	  }
	| {
			error: string;
	  };

interface PostReadRow {
	id: number;
	title: string;
	slug: string;
	content: string;
	excerpt: string | null;
	status: string;
	publishAt: string | null;
	publishedAt: string | null;
	featuredImageKey: string | null;
	featuredImageAlt: string | null;
	metaTitle: string | null;
	metaDescription: string | null;
	metaKeywords: string | null;
	canonicalUrl: string | null;
	categoryName: string | null;
	authorName: string | null;
	createdAt: string;
	updatedAt: string;
}

interface McpSessionState {
	server: McpServer;
	transport: WebStandardStreamableHTTPServerTransport;
	updatedAt: number;
}

interface McpJsonRpcMeta {
	mcpMethod: string | null;
	toolName: string | null;
	requestId: string | null;
}

type McpAuditAuthState =
	| "disabled"
	| "blocked"
	| "token_missing"
	| "token_invalid"
	| "authorized";

type McpAuditOutcome =
	| "not_found"
	| "invalid_request"
	| "rate_limited"
	| "rate_limiter_error"
	| "success"
	| "session_error"
	| "internal_error"
	| "method_not_allowed";

interface McpAuditLogInput {
	ip: string;
	requestMethod: string;
	requestPath: string;
	sessionId: string | null;
	responseStatus: number;
	authState: McpAuditAuthState;
	outcome: McpAuditOutcome;
	mcpMethod?: string | null;
	toolName?: string | null;
	requestId?: string | null;
	detail?: string | null;
	userAgent?: string | null;
}

const mcpSessions = new Map<string, McpSessionState>();

function buildJsonRpcErrorPayload(code: number, message: string) {
	return {
		jsonrpc: "2.0",
		error: {
			code,
			message,
		},
		id: null,
	};
}

function pickFirstDefined(
	sources: Array<Record<string, unknown> | null | undefined>,
	keys: string[],
): unknown {
	for (const source of sources) {
		if (!source) {
			continue;
		}
		for (const key of keys) {
			if (Object.hasOwn(source, key)) {
				return source[key];
			}
		}
	}
	return undefined;
}

function parseBearerToken(headerValue: string | undefined): string | null {
	if (!headerValue) {
		return null;
	}

	const match = headerValue.match(/^Bearer\s+(.+)$/iu);
	if (!match) {
		return null;
	}

	const token = sanitizePlainText(match[1], 500, { trim: true });
	return token || null;
}

function parseMcpJsonRpcMeta(body: unknown): McpJsonRpcMeta {
	const candidate =
		Array.isArray(body) &&
		body.length > 0 &&
		body[0] &&
		typeof body[0] === "object"
			? body[0]
			: body;
	if (!candidate || typeof candidate !== "object") {
		return {
			mcpMethod: null,
			toolName: null,
			requestId: null,
		};
	}

	const requestRecord = candidate as Record<string, unknown>;
	const method = sanitizePlainText(requestRecord.method, 80);
	const params =
		requestRecord.params && typeof requestRecord.params === "object"
			? (requestRecord.params as Record<string, unknown>)
			: null;
	const toolName =
		method === "tools/call"
			? sanitizePlainText(params?.name, 120) || null
			: null;

	const rawId = requestRecord.id;
	const requestId =
		typeof rawId === "number"
			? sanitizePlainText(String(rawId), 120) || null
			: sanitizePlainText(rawId, 120) || null;

	return {
		mcpMethod: method || null,
		toolName,
		requestId,
	};
}

function toJsonRpcMessages(body: unknown): unknown[] {
	return Array.isArray(body) ? body : [body];
}

function hasInitializeRequest(body: unknown): boolean {
	return toJsonRpcMessages(body).some((message) =>
		isInitializeRequest(message),
	);
}

function getRequestPath(c: Context<AdminAppEnv>): string {
	const parsedUrl = new URL(c.req.url);
	const path = sanitizePlainText(parsedUrl.pathname, 255);
	return path || "/mcp";
}

async function recordMcpAuditLog(
	env: Env,
	input: McpAuditLogInput,
): Promise<void> {
	try {
		const db = getDb(env.DB);
		await db.insert(mcpAuditLogs).values({
			ipAddress: sanitizePlainText(input.ip, 64) || "unknown",
			requestMethod: sanitizePlainText(input.requestMethod, 16) || "UNKNOWN",
			requestPath: sanitizePlainText(input.requestPath, 255) || "/mcp",
			sessionId: sanitizePlainText(input.sessionId, 128) || null,
			authState: sanitizePlainText(input.authState, 40) || "authorized",
			responseStatus: Number.isFinite(input.responseStatus)
				? Math.max(100, Math.min(599, input.responseStatus))
				: 500,
			outcome: sanitizePlainText(input.outcome, 64) || "internal_error",
			mcpMethod: sanitizePlainText(input.mcpMethod, 80) || null,
			toolName: sanitizePlainText(input.toolName, 120) || null,
			requestId: sanitizePlainText(input.requestId, 120) || null,
			detail: sanitizePlainText(input.detail, 500) || null,
			userAgent: sanitizePlainText(input.userAgent, 500) || null,
			timestamp: new Date().toISOString(),
		});
	} catch {
		// Viết audit log thất bại không nên ảnh hưởng đến khả năng sử dụng của luồng chính MCP
	}
}

function parseLimit(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, parsed));
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") {
		return value;
	}

	const normalized = sanitizePlainText(value, 12).toLowerCase();
	if (["1", "true", "on", "yes"].includes(normalized)) {
		return true;
	}
	if (["0", "false", "off", "no"].includes(normalized)) {
		return false;
	}

	return fallback;
}

function parsePositiveInt(value: unknown): number | null {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return null;
	}
	return parsed;
}

function getClientIp(c: Context<AdminAppEnv>): string {
	const directIp = sanitizePlainText(c.req.header("CF-Connecting-IP"), 64);
	if (directIp) {
		return directIp;
	}

	const forwarded = sanitizePlainText(c.req.header("x-forwarded-for"), 255);
	if (!forwarded) {
		return "unknown";
	}

	const first = forwarded
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)[0];
	return sanitizePlainText(first, 64) || "unknown";
}

function getMinuteRateKey(ip: string): string {
	const currentMinute = Math.floor(Date.now() / 60_000);
	return `mcp:minute:${ip}:${currentMinute}`;
}

function getAuthFailMinuteRateKey(ip: string): string {
	const currentMinute = Math.floor(Date.now() / 60_000);
	return `mcp:auth-fail:minute:${ip}:${currentMinute}`;
}

function getAuthBlockKey(ip: string): string {
	return `mcp:auth:block:${ip}`;
}

async function incrementKvCounter(
	kv: KVNamespace,
	key: string,
	expirationTtl: number,
): Promise<number> {
	const currentRaw = await kv.get(key);
	const current = Number.parseInt(currentRaw ?? "0", 10);
	const next = (Number.isFinite(current) ? current : 0) + 1;
	await kv.put(key, String(next), {
		expirationTtl,
	});
	return next;
}

async function checkRateBudget(c: Context<AdminAppEnv>, ip: string) {
	const minuteLimit = parseLimit(
		c.env.MCP_RATE_LIMIT_PER_MINUTE,
		DEFAULT_MCP_RATE_LIMIT_PER_MINUTE,
		1,
		600,
	);

	const minuteCount = await incrementKvCounter(
		c.env.SESSION,
		getMinuteRateKey(ip),
		120,
	);
	if (minuteCount > minuteLimit) {
		return {
			ok: false as const,
			status: 429 as const,
			message: "Yêu cầu quá nhiều, vui lòng thử lại sau",
		};
	}

	return {
		ok: true as const,
	};
}

async function isAuthBlocked(c: Context<AdminAppEnv>, ip: string) {
	const blocked = await c.env.SESSION.get(getAuthBlockKey(ip));
	return Boolean(blocked);
}

async function recordAuthFailure(c: Context<AdminAppEnv>, ip: string) {
	const failLimitPerMinute = parseLimit(
		c.env.MCP_AUTH_FAIL_LIMIT_PER_MINUTE,
		DEFAULT_MCP_AUTH_FAIL_LIMIT_PER_MINUTE,
		1,
		600,
	);
	const blockSeconds = parseLimit(
		c.env.MCP_AUTH_BLOCK_SECONDS,
		DEFAULT_MCP_AUTH_BLOCK_SECONDS,
		60,
		86_400,
	);
	const failureCount = await incrementKvCounter(
		c.env.SESSION,
		getAuthFailMinuteRateKey(ip),
		120,
	);

	if (failureCount <= failLimitPerMinute) {
		return;
	}

	await c.env.SESSION.put(getAuthBlockKey(ip), "1", {
		expirationTtl: blockSeconds,
	});
}

function isPostPublic(
	status: string | null | undefined,
	publishAt: string | null | undefined,
): boolean {
	if (status === "published") {
		return true;
	}

	if (status !== "scheduled" || !publishAt) {
		return false;
	}

	const timestamp = Date.parse(publishAt);
	return !Number.isNaN(timestamp) && timestamp <= Date.now();
}

function buildSlugCandidate(
	baseSlug: string,
	index: number,
	maxLength: number,
): string {
	const suffix = index === 0 ? "" : `-${index + 1}`;
	const trimmedBase = baseSlug
		.slice(0, Math.max(1, maxLength - suffix.length))
		.replaceAll(/-+$/g, "");
	return `${trimmedBase}${suffix}`;
}

async function resolveUniquePostSlug(
	db: BlogDb,
	baseSlug: string,
): Promise<string> {
	for (let index = 0; index < 120; index += 1) {
		const candidate = buildSlugCandidate(baseSlug, index, MAX_SLUG_LENGTH);
		const [existing] = await db
			.select({ id: blogPosts.id })
			.from(blogPosts)
			.where(eq(blogPosts.slug, candidate))
			.limit(1);

		if (!existing) {
			return candidate;
		}
	}

	return buildSlugCandidate(
		`${baseSlug}-${crypto.randomUUID().slice(0, 8)}`,
		0,
		MAX_SLUG_LENGTH,
	);
}

async function createOrGetCategoryId(
	db: BlogDb,
	categoryName: string,
): Promise<number | null> {
	const [existingByName] = await db
		.select({ id: blogCategories.id })
		.from(blogCategories)
		.where(eq(blogCategories.name, categoryName))
		.limit(1);

	if (existingByName) {
		return existingByName.id;
	}

	const baseSlug = buildUrlSlug(categoryName, {
		fallbackPrefix: "category",
		maxLength: 80,
	});

	for (let index = 0; index < 120; index += 1) {
		const candidate = buildSlugCandidate(baseSlug, index, 80);
		const [existingBySlug] = await db
			.select({ id: blogCategories.id })
			.from(blogCategories)
			.where(eq(blogCategories.slug, candidate))
			.limit(1);

		if (existingBySlug) {
			continue;
		}

		const now = new Date().toISOString();
		const [inserted] = await db
			.insert(blogCategories)
			.values({
				name: categoryName,
				slug: candidate,
				createdAt: now,
				updatedAt: now,
			})
			.returning({ id: blogCategories.id });

		return inserted?.id ?? null;
	}

	return null;
}

async function createOrGetTagId(
	db: BlogDb,
	tagName: string,
): Promise<number | null> {
	const [existingByName] = await db
		.select({ id: blogTags.id })
		.from(blogTags)
		.where(eq(blogTags.name, tagName))
		.limit(1);

	if (existingByName) {
		return existingByName.id;
	}

	const baseSlug = buildUrlSlug(tagName, {
		fallbackPrefix: "tag",
		maxLength: 80,
	});

	for (let index = 0; index < 120; index += 1) {
		const candidate = buildSlugCandidate(baseSlug, index, 80);
		const [existingBySlug] = await db
			.select({ id: blogTags.id })
			.from(blogTags)
			.where(eq(blogTags.slug, candidate))
			.limit(1);

		if (existingBySlug) {
			continue;
		}

		const [inserted] = await db
			.insert(blogTags)
			.values({
				name: tagName,
				slug: candidate,
			})
			.returning({ id: blogTags.id });

		return inserted?.id ?? null;
	}

	return null;
}

function normalizeTagNames(rawValue: unknown): string[] {
	const values: string[] = [];
	if (Array.isArray(rawValue)) {
		for (const item of rawValue) {
			if (item && typeof item === "object") {
				const namedValue = pickFirstDefined(
					[item as Record<string, unknown>],
					["name", "label", "value", "tag"],
				);
				values.push(String(namedValue ?? ""));
				continue;
			}
			values.push(String(item ?? ""));
		}
	} else if (typeof rawValue === "string") {
		values.push(...rawValue.split(/[\n,，]/u));
	}

	const normalized = values
		.map((value) => sanitizePlainText(value, MAX_TAG_NAME_LENGTH))
		.filter(Boolean);

	return [...new Set(normalized)].slice(0, MAX_TAG_COUNT);
}

function normalizeCategoryName(rawValue: unknown): string | null {
	if (rawValue && typeof rawValue === "object") {
		const namedValue = pickFirstDefined(
			[rawValue as Record<string, unknown>],
			["name", "label", "title"],
		);
		return sanitizePlainText(namedValue, MAX_CATEGORY_NAME_LENGTH) || null;
	}

	return sanitizePlainText(rawValue, MAX_CATEGORY_NAME_LENGTH) || null;
}

function normalizeMetaKeywords(rawValue: unknown): string | null {
	if (Array.isArray(rawValue)) {
		const keywords = rawValue
			.map((item) => sanitizePlainText(item, MAX_TAG_NAME_LENGTH))
			.filter(Boolean)
			.slice(0, 20);
		return keywords.length > 0
			? sanitizePlainText(keywords.join(", "), MAX_META_KEYWORDS_LENGTH) || null
			: null;
	}

	return sanitizePlainText(rawValue, MAX_META_KEYWORDS_LENGTH) || null;
}

function parseCreatePostInput(args: unknown): ParseCreatePostInputResult {
	if (!args || typeof args !== "object") {
		return { error: "Định dạng tham số không hợp lệ, phải là đối tượng" };
	}

	const input = args as Record<string, unknown>;
	const seoInput =
		input.seo && typeof input.seo === "object"
			? (input.seo as Record<string, unknown>)
			: null;
	const title = sanitizePlainText(input.title, MAX_TITLE_LENGTH);
	if (!title) {
		return { error: "Tiêu đề không được để trống" };
	}

	const content = sanitizePlainText(input.content, MAX_CONTENT_LENGTH, {
		allowNewlines: true,
		trim: false,
	});
	if (!content.trim()) {
		return { error: "Nội dung chính không được để trống" };
	}

	const authorName = sanitizePlainText(
		input.authorName,
		MAX_AUTHOR_NAME_LENGTH,
	);
	if (!authorName) {
		return { error: "Đăng bài bằng AI phải điền tên tác giả" };
	}

	const rawSlugInput = sanitizePlainText(
		input.slug,
		MAX_SLUG_LENGTH,
	).toLowerCase();
	const manualSlug = rawSlugInput ? sanitizeSlug(rawSlugInput) : null;
	if (rawSlugInput && !manualSlug) {
		return { error: "Định dạng slug URL không hợp lệ" };
	}

	const slug =
		manualSlug ||
		buildUrlSlug(title, {
			fallbackPrefix: "post",
			maxLength: MAX_SLUG_LENGTH,
		});

	const statusRaw = sanitizePlainText(input.status, 24);
	const status = statusRaw
		? sanitizePostStatus(statusRaw)
		: ("published" as const);
	if (!status) {
		return { error: "Trạng thái bài viết không hợp lệ" };
	}

	const publishAtRaw = sanitizePlainText(input.publishAt, 32, { trim: true });
	let publishAt: string | null = null;
	if (publishAtRaw) {
		const parsed = new Date(publishAtRaw);
		if (Number.isNaN(parsed.getTime())) {
			return { error: "Định dạng thời gian đăng bài hẹn giờ không hợp lệ" };
		}
		publishAt = parsed.toISOString();
	}
	if (status === "scheduled" && !publishAt) {
		return { error: "Đăng bài hẹn giờ cần điền thời gian đăng bài" };
	}

	const categoryName = normalizeCategoryName(
		pickFirstDefined([input], ["categoryName", "category", "category_name"]),
	);
	const tagNames = normalizeTagNames(
		pickFirstDefined([input], ["tagNames", "tags", "tag_names"]),
	);

	const canonicalUrlRaw = sanitizePlainText(
		pickFirstDefined(
			[input, seoInput],
			["canonicalUrl", "canonical", "url", "canonical_url"],
		),
		MAX_CANONICAL_URL_LENGTH,
	);
	const canonicalUrl = canonicalUrlRaw
		? sanitizeCanonicalUrl(canonicalUrlRaw)
		: null;
	if (canonicalUrlRaw && !canonicalUrl) {
		return { error: "Địa chỉ liên kết chuẩn không hợp lệ" };
	}

	const featuredImageKeyRaw = sanitizePlainText(
		input.featuredImageKey,
		MAX_FEATURED_IMAGE_KEY_LENGTH,
	);
	const featuredImageKey = featuredImageKeyRaw
		? sanitizeMediaKey(featuredImageKeyRaw)
		: null;
	if (featuredImageKeyRaw && !featuredImageKey) {
		return { error: "Khóa hình ảnh đại diện không hợp lệ" };
	}

	return {
		data: {
			title,
			slug,
			content,
			authorName,
			excerpt:
				sanitizePlainText(
					pickFirstDefined(
						[input],
						["excerpt", "summary", "description", "excerptText"],
					),
					MAX_EXCERPT_LENGTH,
					{
						allowNewlines: true,
					},
				) || null,
			status,
			publishAt,
			categoryName,
			tagNames,
			featuredImageKey,
			featuredImageAlt:
				sanitizePlainText(
					input.featuredImageAlt,
					MAX_FEATURED_IMAGE_ALT_LENGTH,
				) || null,
			metaTitle:
				sanitizePlainText(
					pickFirstDefined([input], ["metaTitle", "seoTitle", "meta_title"]) ??
						pickFirstDefined([seoInput], ["title"]),
					MAX_META_TITLE_LENGTH,
				) || null,
			metaDescription:
				sanitizePlainText(
					pickFirstDefined(
						[input],
						["metaDescription", "seoDescription", "meta_description"],
					) ?? pickFirstDefined([seoInput], ["description"]),
					MAX_META_DESCRIPTION_LENGTH,
				) || null,
			metaKeywords: normalizeMetaKeywords(
				pickFirstDefined(
					[input],
					["metaKeywords", "seoKeywords", "meta_keywords", "keywords"],
				) ?? pickFirstDefined([seoInput], ["keywords"]),
			),
			canonicalUrl,
		},
	};
}

function parseListPostsInput(args: unknown): ParseListPostsInputResult {
	const input =
		args && typeof args === "object" ? (args as Record<string, unknown>) : {};
	const statusRaw = sanitizePlainText(input.status, 24);
	const status = statusRaw ? sanitizePostStatus(statusRaw) : null;
	if (statusRaw && !status) {
		return { error: "Trạng thái lọc không hợp lệ" };
	}

	return {
		data: {
			limit: parseLimit(input.limit, 10, 1, MAX_LIST_LIMIT),
			status,
			keyword:
				sanitizePlainText(
					pickFirstDefined([input], ["keyword", "query"]),
					MAX_KEYWORD_LENGTH,
				) || null,
			includeContent: parseBoolean(input.includeContent, false),
		},
	};
}

function parseGetPostInput(args: unknown): ParseGetPostInputResult {
	if (!args || typeof args !== "object") {
		return { error: "Định dạng tham số không hợp lệ, phải là đối tượng" };
	}

	const input = args as Record<string, unknown>;
	const idRaw = pickFirstDefined([input], ["id", "postId", "post_id"]);
	const slugRaw = sanitizePlainText(
		pickFirstDefined([input], ["slug", "postSlug", "post_slug"]),
		MAX_SLUG_LENGTH,
	).toLowerCase();
	const id = parsePositiveInt(idRaw);
	const slug = slugRaw ? sanitizeSlug(slugRaw) : null;

	if (slugRaw && !slug) {
		return { error: "Tham số slug không hợp lệ" };
	}
	if (!id && !slug) {
		return { error: "Vui lòng cung cấp ít nhất một trong hai tham số id hoặc slug" };
	}

	return {
		data: {
			id,
			slug,
			includeContent: parseBoolean(input.includeContent, true),
		},
	};
}

function buildPostReadPayload(
	row: PostReadRow,
	tags: string[],
	includeContent: boolean,
) {
	return {
		id: row.id,
		title: row.title,
		slug: row.slug,
		content: includeContent ? row.content : undefined,
		excerpt: row.excerpt,
		status: row.status,
		publishAt: row.publishAt,
		publishedAt: row.publishedAt,
		authorName: row.authorName,
		categoryName: row.categoryName,
		tags,
		featuredImageKey: row.featuredImageKey,
		featuredImageAlt: row.featuredImageAlt,
		metaTitle: row.metaTitle,
		metaDescription: row.metaDescription,
		metaKeywords: row.metaKeywords,
		canonicalUrl: row.canonicalUrl,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		url: `/blog/${row.slug}`,
	};
}

async function getPostTagsMap(db: BlogDb, postIds: number[]) {
	if (postIds.length === 0) {
		return new Map<number, string[]>();
	}

	const rows = await db
		.select({
			postId: blogPostTags.postId,
			tagName: blogTags.name,
		})
		.from(blogPostTags)
		.innerJoin(blogTags, eq(blogPostTags.tagId, blogTags.id))
		.where(inArray(blogPostTags.postId, postIds));

	const tagMap = new Map<number, string[]>();
	for (const row of rows) {
		if (!row.tagName) {
			continue;
		}
		const existing = tagMap.get(row.postId) ?? [];
		existing.push(row.tagName);
		tagMap.set(row.postId, existing);
	}

	return tagMap;
}

async function listPostsFromMcpInput(env: Env, input: ListPostsInput) {
	const db = getDb(env.DB);
	const conditions = [];

	if (input.status) {
		conditions.push(eq(blogPosts.status, input.status));
	}

	if (input.keyword) {
		const likeValue = `%${input.keyword}%`;
		conditions.push(
			or(
				like(blogPosts.title, likeValue),
				like(blogPosts.slug, likeValue),
				like(blogPosts.excerpt, likeValue),
			),
		);
	}

	const whereCondition =
		conditions.length === 0
			? undefined
			: conditions.length === 1
				? conditions[0]
				: and(...conditions);

	const rows = whereCondition
		? await db
				.select({
					id: blogPosts.id,
					title: blogPosts.title,
					slug: blogPosts.slug,
					content: blogPosts.content,
					excerpt: blogPosts.excerpt,
					status: blogPosts.status,
					publishAt: blogPosts.publishAt,
					publishedAt: blogPosts.publishedAt,
					featuredImageKey: blogPosts.featuredImageKey,
					featuredImageAlt: blogPosts.featuredImageAlt,
					metaTitle: blogPosts.metaTitle,
					metaDescription: blogPosts.metaDescription,
					metaKeywords: blogPosts.metaKeywords,
					canonicalUrl: blogPosts.canonicalUrl,
					categoryName: blogCategories.name,
					authorName: blogPosts.authorName,
					createdAt: blogPosts.createdAt,
					updatedAt: blogPosts.updatedAt,
				})
				.from(blogPosts)
				.leftJoin(blogCategories, eq(blogPosts.categoryId, blogCategories.id))
				.where(whereCondition)
				.orderBy(desc(blogPosts.createdAt))
				.limit(input.limit)
		: await db
				.select({
					id: blogPosts.id,
					title: blogPosts.title,
					slug: blogPosts.slug,
					content: blogPosts.content,
					excerpt: blogPosts.excerpt,
					status: blogPosts.status,
					publishAt: blogPosts.publishAt,
					publishedAt: blogPosts.publishedAt,
					featuredImageKey: blogPosts.featuredImageKey,
					featuredImageAlt: blogPosts.featuredImageAlt,
					metaTitle: blogPosts.metaTitle,
					metaDescription: blogPosts.metaDescription,
					metaKeywords: blogPosts.metaKeywords,
					canonicalUrl: blogPosts.canonicalUrl,
					categoryName: blogCategories.name,
					authorName: blogPosts.authorName,
					createdAt: blogPosts.createdAt,
					updatedAt: blogPosts.updatedAt,
				})
				.from(blogPosts)
				.leftJoin(blogCategories, eq(blogPosts.categoryId, blogCategories.id))
				.orderBy(desc(blogPosts.createdAt))
				.limit(input.limit);

	const ids = rows.map((item) => item.id);
	const tagMap = await getPostTagsMap(db, ids);
	const posts = rows.map((row) =>
		buildPostReadPayload(row, tagMap.get(row.id) ?? [], input.includeContent),
	);

	return {
		total: posts.length,
		posts,
	};
}

async function getPostFromMcpInput(env: Env, input: GetPostInput) {
	const db = getDb(env.DB);
	const whereCondition = input.id
		? eq(blogPosts.id, input.id)
		: eq(blogPosts.slug, input.slug as string);

	const [row] = await db
		.select({
			id: blogPosts.id,
			title: blogPosts.title,
			slug: blogPosts.slug,
			content: blogPosts.content,
			excerpt: blogPosts.excerpt,
			status: blogPosts.status,
			publishAt: blogPosts.publishAt,
			publishedAt: blogPosts.publishedAt,
			featuredImageKey: blogPosts.featuredImageKey,
			featuredImageAlt: blogPosts.featuredImageAlt,
			metaTitle: blogPosts.metaTitle,
			metaDescription: blogPosts.metaDescription,
			metaKeywords: blogPosts.metaKeywords,
			canonicalUrl: blogPosts.canonicalUrl,
			categoryName: blogCategories.name,
			authorName: blogPosts.authorName,
			createdAt: blogPosts.createdAt,
			updatedAt: blogPosts.updatedAt,
		})
		.from(blogPosts)
		.leftJoin(blogCategories, eq(blogPosts.categoryId, blogCategories.id))
		.where(whereCondition)
		.limit(1);

	if (!row) {
		return null;
	}

	const tagMap = await getPostTagsMap(db, [row.id]);
	return buildPostReadPayload(
		row,
		tagMap.get(row.id) ?? [],
		input.includeContent,
	);
}

async function createPostFromMcpInput(env: Env, input: CreatePostInput) {
	const db = getDb(env.DB);
	const now = new Date().toISOString();
	const slug = await resolveUniquePostSlug(db, input.slug);
	const publishAt =
		input.status === "scheduled"
			? input.publishAt
			: input.status === "published"
				? now
				: null;
	const publishedAt = input.status === "published" ? now : null;

	let categoryId: number | null = null;
	if (input.categoryName) {
		categoryId = await createOrGetCategoryId(db, input.categoryName);
	}

	const [inserted] = await db
		.insert(blogPosts)
		.values({
			title: input.title,
			slug,
			content: input.content,
			excerpt: input.excerpt,
			status: input.status,
			publishAt,
			publishedAt,
			featuredImageKey: input.featuredImageKey,
			featuredImageAlt: input.featuredImageAlt,
			isPinned: false,
			pinnedOrder: 100,
			metaTitle: input.metaTitle,
			metaDescription: input.metaDescription,
			metaKeywords: input.metaKeywords,
			canonicalUrl: input.canonicalUrl,
			categoryId,
			authorName: input.authorName,
			createdAt: now,
			updatedAt: now,
		})
		.returning({ id: blogPosts.id });

	if (inserted && input.tagNames.length > 0) {
		const tagIds = new Set<number>();
		for (const tagName of input.tagNames) {
			const tagId = await createOrGetTagId(db, tagName);
			if (tagId) {
				tagIds.add(tagId);
			}
		}

		if (tagIds.size > 0) {
			await db.insert(blogPostTags).values(
				[...tagIds].map((tagId) => ({
					postId: inserted.id,
					tagId,
				})),
			);
		}
	}

	if (isPostPublic(input.status, publishAt)) {
		await triggerDeployHook(env, {
			event: "post-created",
			postId: inserted?.id,
			postSlug: slug,
			postStatus: input.status,
		});
	}

	return {
		id: inserted?.id ?? null,
		slug,
		status: input.status,
		authorName: input.authorName,
		url: `/blog/${slug}`,
		publishedAt,
		publishAt,
	};
}

function createMcpServer(env: Env): McpServer {
	const server = new McpServer({
		name: "cf-astro-blog-mcp",
		version: "1.0.0",
	});

	server.registerTool(
		"create_post",
		{
			title: "Tạo bài viết blog",
			description:
				"Tạo một bài viết blog và ghi vào cơ sở dữ liệu trang web. authorName bắt buộc, status mặc định là published.",
			inputSchema: {
				title: z.string().describe("Tiêu đề bài viết"),
				content: z.string().describe("Nội dung Markdown"),
				authorName: z.string().describe("Tên tác giả, bắt buộc"),
				slug: z.string().optional().describe(" Bí danh đường dẫn, tùy chọn"),
				excerpt: z.string().optional().describe("Tóm tắt bài viết, tùy chọn"),
				summary: z.string().optional().describe("Bí danh tóm tắt bài viết, tùy chọn"),
				status: z
					.enum(["draft", "published", "scheduled"])
					.optional()
					.describe("Trạng thái bài viết, tùy chọn, mặc định published"),
				publishAt: z
					.string()
					.optional()
					.describe("Thời gian đăng bài hẹn giờ, chỉ bắt buộc khi scheduled"),
				categoryName: z.string().optional().describe("Tên danh mục, tùy chọn"),
				category: z
					.union([
						z.string(),
						z.object({
							name: z.string().optional(),
							label: z.string().optional(),
							title: z.string().optional(),
						}),
					])
					.optional()
					.describe("Bí danh danh mục, có thể truyền chuỗi hoặc đối tượng"),
				tagNames: z.array(z.string()).optional().describe("Mảng tên nhãn, tùy chọn"),
				tags: z
					.union([
						z.string(),
						z.array(
							z.union([
								z.string(),
								z.object({
									name: z.string().optional(),
									label: z.string().optional(),
									value: z.string().optional(),
									tag: z.string().optional(),
								}),
							]),
						),
					])
					.optional()
					.describe("Bí danh nhãn, có thể truyền chuỗi phân cách bằng dấu phẩy, mảng chuỗi hoặc mảng đối tượng"),
				featuredImageKey: z.string().optional().describe("Khóa hình ảnh đại diện, tùy chọn"),
				featuredImageAlt: z
					.string()
					.optional()
					.describe("Văn bản thay thế hình ảnh đại diện, tùy chọn"),
				metaTitle: z.string().optional().describe("Tiêu đề SEO, tùy chọn"),
				seoTitle: z.string().optional().describe("Bí danh tiêu đề SEO, tùy chọn"),
				metaDescription: z.string().optional().describe("Mô tả SEO, tùy chọn"),
				seoDescription: z.string().optional().describe("Bí danh mô tả SEO, tùy chọn"),
				metaKeywords: z
					.union([z.string(), z.array(z.string())])
					.optional()
					.describe("Từ khóa SEO, tùy chọn"),
				seoKeywords: z
					.union([z.string(), z.array(z.string())])
					.optional()
					.describe("Bí danh từ khóa SEO, tùy chọn"),
				seo: z
					.object({
						title: z.string().optional(),
						description: z.string().optional(),
						keywords: z.union([z.string(), z.array(z.string())]).optional(),
						canonicalUrl: z.string().optional(),
					})
					.optional()
					.describe("Đối tượng SEO, tùy chọn"),
				canonicalUrl: z.string().optional().describe("Liên kết chuẩn, tùy chọn"),
			},
		},
		async (args) => {
			const parsed = parseCreatePostInput(args);
			if ("error" in parsed) {
				return {
					isError: true,
					content: [{ type: "text", text: parsed.error }],
				};
			}

			try {
				const created = await createPostFromMcpInput(env, parsed.data);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									success: true,
									message: "Tạo bài viết thành công",
									post: created,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				console.error("[MCP create_post] Tạo thất bại", error);
				return {
					isError: true,
					content: [
						{
							type: "text",
							text:
								error instanceof Error
									? error.message
									: "Tạo bài viết thất bại, vui lòng thử lại sau",
						},
					],
				};
			}
		},
	);

	server.registerTool(
		"list_posts",
		{
			title: "Đọc danh sách bài viết",
			description: "Đọc danh sách bài viết blog theo điều kiện, có thể dùng cho việc chọn chủ đề AI, xem lại và truy xuất ngữ cảnh.",
			inputSchema: {
				limit: z
					.number()
					.int()
					.min(1)
					.max(MAX_LIST_LIMIT)
					.optional()
					.describe(`Số lượng trả về, mặc định 10, tối đa ${MAX_LIST_LIMIT}`),
				status: z
					.enum(["draft", "published", "scheduled"])
					.optional()
					.describe("Lọc theo trạng thái bài viết, tùy chọn"),
				keyword: z.string().optional().describe("Tìm kiếm mờ theo tiêu đề, slug, tóm tắt"),
				query: z.string().optional().describe("Bí danh của keyword"),
				includeContent: z
					.boolean()
					.optional()
					.describe("Có trả về nội dung chính trong danh sách hay không, mặc định false"),
			},
		},
		async (args) => {
			const parsed = parseListPostsInput(args);
			if ("error" in parsed) {
				return {
					isError: true,
					content: [{ type: "text", text: parsed.error }],
				};
			}

			try {
				const result = await listPostsFromMcpInput(env, parsed.data);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									success: true,
									message: "Đọc danh sách bài viết thành công",
									...result,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				console.error("[MCP list_posts] Đọc thất bại", error);
				return {
					isError: true,
					content: [
						{
							type: "text",
							text:
								error instanceof Error
									? error.message
									: "Đọc danh sách bài viết thất bại, vui lòng thử lại sau",
						},
					],
				};
			}
		},
	);

	server.registerTool(
		"get_post",
		{
			title: "Đọc một bài viết",
			description: "Đọc chi tiết một bài viết theo id hoặc slug, theo mặc định bao gồm nội dung chính.",
			inputSchema: {
				id: z.number().int().positive().optional().describe("ID bài viết, tùy chọn"),
				postId: z
					.number()
					.int()
					.positive()
					.optional()
					.describe("Bí danh của id, tùy chọn"),
				slug: z.string().optional().describe("Slug bài viết, tùy chọn"),
				postSlug: z.string().optional().describe("Bí danh của slug, tùy chọn"),
				includeContent: z
					.boolean()
					.optional()
					.describe("Có trả về nội dung chính hay không, mặc định true"),
			},
		},
		async (args) => {
			const parsed = parseGetPostInput(args);
			if ("error" in parsed) {
				return {
					isError: true,
					content: [{ type: "text", text: parsed.error }],
				};
			}

			try {
				const post = await getPostFromMcpInput(env, parsed.data);
				if (!post) {
					return {
						isError: true,
						content: [{ type: "text", text: "Bài viết không tồn tại" }],
					};
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									success: true,
									message: "Đọc bài viết thành công",
									post,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				console.error("[MCP get_post] Đọc thất bại", error);
				return {
					isError: true,
					content: [
						{
							type: "text",
							text:
								error instanceof Error
									? error.message
									: "Đọc bài viết thất bại, vui lòng thử lại sau",
						},
					],
				};
			}
		},
	);

	return server;
}

async function handleStatelessMcpPostRequest(
	c: Context<AdminAppEnv>,
	parsedBody: unknown,
): Promise<Response> {
	const server = createMcpServer(c.env);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});

	await server.connect(transport);
	try {
		return await transport.handleRequest(c.req.raw, {
			parsedBody,
		});
	} finally {
		try {
			await transport.close();
		} catch {
			// Lỗi cleanup ở chế độ tương thích không nên ảnh hưởng đến phản hồi yêu cầu
		}
		try {
			await server.close();
		} catch {
			// Lỗi cleanup ở chế độ tương thích không nên ảnh hưởng đến phản hồi yêu cầu
		}
	}
}

async function closeMcpSession(sessionId: string, state: McpSessionState) {
	mcpSessions.delete(sessionId);
	try {
		await state.transport.close();
	} catch {
		// Bỏ qua ngoại lệ cleanup để tránh ảnh hưởng đến các yêu cầu tiếp theo
	}
	try {
		await state.server.close();
	} catch {
		// Bỏ qua ngoại lệ cleanup để tránh ảnh hưởng đến các yêu cầu tiếp theo
	}
}

async function pruneExpiredMcpSessions() {
	const now = Date.now();
	for (const [sessionId, state] of mcpSessions.entries()) {
		if (now - state.updatedAt <= MCP_SESSION_IDLE_TTL_MS) {
			continue;
		}
		await closeMcpSession(sessionId, state);
	}
}

async function isMcpFeatureEnabled(env: Env): Promise<boolean> {
	const dbBinding = (env as Partial<Env>).DB;
	if (!dbBinding) {
		return true;
	}

	try {
		const db = getDb(dbBinding);
		const [row] = await db
			.select({
				mcpEnabled: siteAppearanceSettings.mcpEnabled,
			})
			.from(siteAppearanceSettings)
			.where(eq(siteAppearanceSettings.id, 1))
			.limit(1);
		if (!row) {
			return true;
		}
		return row.mcpEnabled;
	} catch {
		return true;
	}
}

mcpRoutes.all("/", async (c) => {
	await pruneExpiredMcpSessions();
	const method = c.req.method.toUpperCase();
	const requestPath = getRequestPath(c);
	const sessionId = sanitizePlainText(c.req.header("mcp-session-id"), 128);
	const userAgent = sanitizePlainText(c.req.header("user-agent"), 500) || null;
	const ip = getClientIp(c);

	const mcpEnabled = await isMcpFeatureEnabled(c.env);
	if (!mcpEnabled) {
		await recordMcpAuditLog(c.env, {
			ip,
			requestMethod: method,
			requestPath,
			sessionId,
			responseStatus: 404,
			authState: "disabled",
			outcome: "not_found",
			detail: "Giao diện MCP đã bị đóng ở backend",
			userAgent,
		});
		return c.text("Not Found", 404);
	}

	const blocked = await isAuthBlocked(c, ip).catch(() => false);
	if (blocked) {
		await recordMcpAuditLog(c.env, {
			ip,
			requestMethod: method,
			requestPath,
			sessionId,
			responseStatus: 404,
			authState: "blocked",
			outcome: "not_found",
			detail: "Số lần xác thực thất bại vượt quá giới hạn, đang trong thời gian cấm",
			userAgent,
		});
		return c.text("Not Found", 404);
	}

	const expectedToken = sanitizePlainText(c.env.MCP_BEARER_TOKEN, 500);
	if (!expectedToken) {
		await recordMcpAuditLog(c.env, {
			ip,
			requestMethod: method,
			requestPath,
			sessionId,
			responseStatus: 404,
			authState: "token_missing",
			outcome: "not_found",
			detail: "Dịch vụ chưa cấu hình MCP_BEARER_TOKEN",
			userAgent,
		});
		return c.text("Not Found", 404);
	}

	const providedToken = parseBearerToken(c.req.header("authorization"));
	if (!providedToken || !timingSafeEqualText(providedToken, expectedToken)) {
		await recordAuthFailure(c, ip).catch(() => undefined);
		await recordMcpAuditLog(c.env, {
			ip,
			requestMethod: method,
			requestPath,
			sessionId,
			responseStatus: 404,
			authState: "token_invalid",
			outcome: "not_found",
			detail: "Thiếu Bearer hoặc xác thực Bearer thất bại",
			userAgent,
		});
		return c.text("Not Found", 404);
	}

	const budget = await checkRateBudget(c, ip).catch(() => null);
	if (!budget) {
		await recordMcpAuditLog(c.env, {
			ip,
			requestMethod: method,
			requestPath,
			sessionId,
			responseStatus: 503,
			authState: "authorized",
			outcome: "rate_limiter_error",
			detail: "Dịch vụ đếm giới hạn tốc độ ngoại lệ",
			userAgent,
		});
		return c.json(
			buildJsonRpcErrorPayload(-32002, "Dịch vụ giới hạn tốc độ MCP tạm thời không khả dụng, vui lòng thử lại sau"),
			503,
		);
	}
	if (!budget.ok) {
		await recordMcpAuditLog(c.env, {
			ip,
			requestMethod: method,
			requestPath,
			sessionId,
			responseStatus: budget.status,
			authState: "authorized",
			outcome: "rate_limited",
			detail: budget.message,
			userAgent,
		});
		return c.json(
			buildJsonRpcErrorPayload(-32002, budget.message),
			budget.status,
		);
	}

	if (method === "POST") {
		let parsedBody: unknown;
		let requestMeta: McpJsonRpcMeta = {
			mcpMethod: null,
			toolName: null,
			requestId: null,
		};
		try {
			parsedBody = await c.req.json();
			requestMeta = parseMcpJsonRpcMeta(parsedBody);
		} catch {
			await recordMcpAuditLog(c.env, {
				ip,
				requestMethod: method,
				requestPath,
				sessionId,
				responseStatus: 400,
				authState: "authorized",
				outcome: "invalid_request",
				detail: "Nội dung yêu cầu không phải là JSON hợp lệ",
				userAgent,
			});
			return c.json(
				buildJsonRpcErrorPayload(-32700, "Nội dung yêu cầu không phải là JSON hợp lệ"),
				400,
			);
		}

		let transport: WebStandardStreamableHTTPServerTransport;

		if (sessionId) {
			const existing = mcpSessions.get(sessionId);
			if (!existing) {
				await recordMcpAuditLog(c.env, {
					ip,
					requestMethod: method,
					requestPath,
					sessionId,
					responseStatus: 404,
					authState: "authorized",
					outcome: "session_error",
					mcpMethod: requestMeta.mcpMethod,
					toolName: requestMeta.toolName,
					requestId: requestMeta.requestId,
					detail: "Phiên làm việc không tồn tại hoặc đã hết hạn",
					userAgent,
				});
				return c.json(
					buildJsonRpcErrorPayload(-32000, "Phiên làm việc không hợp lệ, vui lòng khởi tạo lại"),
					404,
				);
			}

			existing.updatedAt = Date.now();
			transport = existing.transport;
		} else if (hasInitializeRequest(parsedBody)) {
			const server = createMcpServer(c.env);
			const newTransport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: () => crypto.randomUUID(),
				enableJsonResponse: true,
				onsessioninitialized: (newSessionId) => {
					mcpSessions.set(newSessionId, {
						server,
						transport: newTransport,
						updatedAt: Date.now(),
					});
				},
				onsessionclosed: (closedSessionId) => {
					mcpSessions.delete(closedSessionId);
				},
			});
			newTransport.onclose = () => {
				const currentSessionId = newTransport.sessionId;
				if (currentSessionId) {
					mcpSessions.delete(currentSessionId);
				}
			};

			await server.connect(newTransport);
			transport = newTransport;
		} else {
			try {
				const response = await handleStatelessMcpPostRequest(c, parsedBody);
				await recordMcpAuditLog(c.env, {
					ip,
					requestMethod: method,
					requestPath,
					sessionId: null,
					responseStatus: response.status,
					authState: "authorized",
					outcome: "success",
					mcpMethod: requestMeta.mcpMethod,
					toolName: requestMeta.toolName,
					requestId: requestMeta.requestId,
					detail:
						response.status >= 400
							? `Chế độ không có phiên làm việc trả về trạng thái ${response.status}`
							: "Xử lý chế độ không có phiên làm việc thành công",
				});
				return response;
			} catch (error) {
				console.error("[MCP] Xử lý chế độ không có phiên làm việc thất bại", error);
				await recordMcpAuditLog(c.env, {
					ip,
					requestMethod: method,
					requestPath,
					sessionId: null,
					responseStatus: 500,
					authState: "authorized",
					outcome: "internal_error",
					mcpMethod: requestMeta.mcpMethod,
					toolName: requestMeta.toolName,
					requestId: requestMeta.requestId,
					detail:
						error instanceof Error
							? sanitizePlainText(error.message, 500)
							: "Ngoại lệ nội bộ ở chế độ không có phiên làm việc MCP",
					userAgent,
				});
				return c.json(
					buildJsonRpcErrorPayload(-32603, "Lỗi nội bộ MCP, vui lòng thử lại sau"),
					500,
				);
			}
		}

		try {
			const response = await transport.handleRequest(c.req.raw, {
				parsedBody,
			});
			await recordMcpAuditLog(c.env, {
				ip,
				requestMethod: method,
				requestPath,
				sessionId: sessionId || transport.sessionId || null,
				responseStatus: response.status,
				authState: "authorized",
				outcome: "success",
				mcpMethod: requestMeta.mcpMethod,
				toolName: requestMeta.toolName,
				requestId: requestMeta.requestId,
				detail:
					response.status >= 400
						? `Yêu cầu POST MCP trả về trạng thái ${response.status}`
						: null,
				userAgent,
			});
			return response;
		} catch (error) {
			console.error("[MCP] Xử lý yêu cầu POST thất bại", error);
			await recordMcpAuditLog(c.env, {
				ip,
				requestMethod: method,
				requestPath,
				sessionId: sessionId || transport.sessionId || null,
				responseStatus: 500,
				authState: "authorized",
				outcome: "internal_error",
				mcpMethod: requestMeta.mcpMethod,
				toolName: requestMeta.toolName,
				requestId: requestMeta.requestId,
				detail:
					error instanceof Error
						? sanitizePlainText(error.message, 500)
						: "Ngoại lệ nội bộ yêu cầu POST MCP",
				userAgent,
			});
			return c.json(
				buildJsonRpcErrorPayload(-32603, "Lỗi nội bộ MCP, vui lòng thử lại sau"),
				500,
			);
		}
	}

	if (method === "GET" || method === "DELETE") {
		if (!sessionId) {
			await recordMcpAuditLog(c.env, {
				ip,
				requestMethod: method,
				requestPath,
				sessionId,
				responseStatus: 400,
				authState: "authorized",
				outcome: "invalid_request",
				detail: "Thiếu tiêu đề yêu cầu mcp-session-id",
				userAgent,
			});
			return c.json(
				buildJsonRpcErrorPayload(-32000, "Thiếu tiêu đề yêu cầu mcp-session-id"),
				400,
			);
		}

		const existing = mcpSessions.get(sessionId);
		if (!existing) {
			await recordMcpAuditLog(c.env, {
				ip,
				requestMethod: method,
				requestPath,
				sessionId,
				responseStatus: 404,
				authState: "authorized",
				outcome: "session_error",
				detail: "Phiên làm việc không tồn tại hoặc đã hết hạn",
				userAgent,
			});
			return c.json(buildJsonRpcErrorPayload(-32000, "Phiên làm việc không hợp lệ"), 404);
		}

		existing.updatedAt = Date.now();
		try {
			const response = await existing.transport.handleRequest(c.req.raw);
			await recordMcpAuditLog(c.env, {
				ip,
				requestMethod: method,
				requestPath,
				sessionId,
				responseStatus: response.status,
				authState: "authorized",
				outcome: "success",
				detail:
					response.status >= 400
						? `Yêu cầu phiên làm việc MCP ${method} trả về trạng thái ${response.status}`
						: null,
				userAgent,
			});
			return response;
		} catch (error) {
			console.error("[MCP] Xử lý yêu cầu phiên làm việc thất bại", error);
			await recordMcpAuditLog(c.env, {
				ip,
				requestMethod: method,
				requestPath,
				sessionId,
				responseStatus: 500,
				authState: "authorized",
				outcome: "internal_error",
				detail:
					error instanceof Error
						? sanitizePlainText(error.message, 500)
						: "Ngoại lệ nội bộ yêu cầu phiên làm việc MCP",
				userAgent,
			});
			return c.json(
				buildJsonRpcErrorPayload(-32603, "Lỗi nội bộ MCP, vui lòng thử lại sau"),
				500,
			);
		}
	}

	await recordMcpAuditLog(c.env, {
		ip,
		requestMethod: method,
		requestPath,
		sessionId,
		responseStatus: 405,
		authState: "authorized",
		outcome: "method_not_allowed",
		detail: `Phương thức yêu cầu không được hỗ trợ: ${method}`,
		userAgent,
	});
	return c.text("Method Not Allowed", 405);
});

export { mcpRoutes };
