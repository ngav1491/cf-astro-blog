import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { friendLinks } from "@/db/schema";
import { getDb } from "@/lib/db";
import { sanitizeCanonicalUrl, sanitizePlainText } from "@/lib/security";
import type { AdminAppEnv } from "../middleware/auth";

const friendLinksRoutes = new Hono<AdminAppEnv>();
const AVATAR_PROXY_TIMEOUT_MS = 8_000;
const AVATAR_PROXY_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_PROXY_CACHE_SECONDS = 6 * 60 * 60;
const AVATAR_PROXY_MAX_REDIRECTS = 3;
const AVATAR_PROXY_ALLOWED_CONTENT_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/avif",
	"image/gif",
]);

interface FriendLinkApplicationInput {
	name: string;
	siteUrl: string;
	avatarUrl: string | null;
	description: string;
	contact: string;
	note: string | null;
}

interface TurnstileVerifyResponse {
	success?: boolean;
	"error-codes"?: string[];
}

function isPrivateIpv4(hostname: string): boolean {
	const parts = hostname.split(".").map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
		return false;
	}

	const [a, b] = parts;
	if (a === 10 || a === 127 || a === 0) {
		return true;
	}

	if (a === 169 && b === 254) {
		return true;
	}

	if (a === 172 && b >= 16 && b <= 31) {
		return true;
	}

	if (a === 192 && b === 168) {
		return true;
	}

	if (a === 100 && b >= 64 && b <= 127) {
		return true;
	}

	return a === 198 && (b === 18 || b === 19);
}

function normalizeHostname(hostname: string): string {
	const normalized = hostname.trim().toLowerCase();
	if (normalized.startsWith("[") && normalized.endsWith("]")) {
		return normalized.slice(1, -1);
	}

	return normalized;
}

function isPrivateIpv6(hostname: string): boolean {
	if (!hostname.includes(":")) {
		return false;
	}

	if (
		hostname === "::1" ||
		hostname.startsWith("fe80:") ||
		hostname.startsWith("fc") ||
		hostname.startsWith("fd")
	) {
		return true;
	}

	return hostname.startsWith("::ffff:");
}

function isBlockedSourceHost(hostname: string): boolean {
	const normalized = normalizeHostname(hostname);
	if (!normalized) {
		return true;
	}

	if (
		normalized === "localhost" ||
		normalized.endsWith(".local") ||
		normalized.endsWith(".internal")
	) {
		return true;
	}

	if (isPrivateIpv4(normalized) || isPrivateIpv6(normalized)) {
		return true;
	}

	return false;
}

function validateAvatarTarget(target: URL, requestUrl: URL): string | null {
	if (!["http:", "https:"].includes(target.protocol)) {
		return "Địa chỉ avatar chỉ hỗ trợ giao thức http/https";
	}

	if (target.username || target.password) {
		return "Địa chỉ avatar không được chứa tên đăng nhập hoặc mật khẩu";
	}

	if (isBlockedSourceHost(target.hostname)) {
		return "Địa chỉ avatar không được sử dụng máy chủ cục bộ hoặc mạng nội bộ";
	}

	if (
		target.origin === requestUrl.origin &&
		target.pathname.startsWith("/api/friend-links/avatar")
	) {
		return "Địa chỉ avatar không hợp lệ";
	}

	return null;
}

function isRedirectStatus(status: number): boolean {
	return [301, 302, 303, 307, 308].includes(status);
}

function parseAvatarContentType(contentType: string | null): string {
	const normalized =
		sanitizePlainText(contentType, 120).toLowerCase() ||
		"application/octet-stream";
	const [mediaType] = normalized.split(";");
	return (mediaType || "").trim();
}

function isAllowedAvatarContentType(contentType: string): boolean {
	return AVATAR_PROXY_ALLOWED_CONTENT_TYPES.has(contentType);
}

function getBodyText(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (Array.isArray(value)) {
		const firstText = value.find(
			(item): item is string => typeof item === "string",
		);
		return firstText?.trim() ?? "";
	}

	return typeof value === "string" ? value.trim() : "";
}

function parseApplicationInput(
	body: Record<string, unknown>,
): { data: FriendLinkApplicationInput } | { error: "invalid" } {
	const name = sanitizePlainText(getBodyText(body, "name"), 80);
	const description = sanitizePlainText(getBodyText(body, "description"), 320, {
		allowNewlines: true,
	});
	const contact = sanitizePlainText(getBodyText(body, "contact"), 120, {
		allowNewlines: true,
	});
	const note =
		sanitizePlainText(getBodyText(body, "note"), 320, {
			allowNewlines: true,
		}) || null;
	const siteUrl = sanitizeCanonicalUrl(getBodyText(body, "siteUrl"));
	const rawAvatarUrl = getBodyText(body, "avatarUrl");
	const avatarUrl = rawAvatarUrl ? sanitizeCanonicalUrl(rawAvatarUrl) : null;

	if (!name || !contact || !siteUrl) {
		return { error: "invalid" } as const;
	}

	if (rawAvatarUrl && !avatarUrl) {
		return { error: "invalid" } as const;
	}

	return {
		data: {
			name,
			siteUrl,
			avatarUrl,
			description,
			contact,
			note,
		},
	} as const;
}

async function verifyTurnstileToken(c: Context<AdminAppEnv>, token: string) {
	const secret = String(c.env.TURNSTILE_SECRET_KEY || "").trim();
	if (!secret) {
		return { success: true, skipped: true } as const;
	}

	if (!token) {
		return { success: false, reason: "missing-token" } as const;
	}

	const formData = new URLSearchParams();
	formData.set("secret", secret);
	formData.set("response", token);

	const remoteIp =
		c.req.header("CF-Connecting-IP") ||
		c.req
			.header("x-forwarded-for")
			?.split(",")
			.map((item) => item.trim())
			.filter(Boolean)[0];
	if (remoteIp) {
		formData.set("remoteip", remoteIp);
	}

	try {
		const response = await fetch(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
			{
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: formData.toString(),
			},
		);
		if (!response.ok) {
			return { success: false, reason: "verify-request-failed" } as const;
		}

		const payload = (await response.json()) as TurnstileVerifyResponse;
		if (!payload.success) {
			return { success: false, reason: "verify-failed" } as const;
		}

		return { success: true, skipped: false } as const;
	} catch {
		return { success: false, reason: "verify-exception" } as const;
	}
}

friendLinksRoutes.post("/apply", async (c) => {
	const db = getDb(c.env.DB);
	const body = await c.req.parseBody();
	const turnstileToken = getBodyText(body, "cf-turnstile-response");
	const verifyResult = await verifyTurnstileToken(c, turnstileToken);
	if (!verifyResult.success) {
		return c.redirect("/friends/apply?apply=challenge-failed");
	}

	const parsed = parseApplicationInput(body);
	if ("error" in parsed) {
		return c.redirect("/friends/apply?apply=invalid");
	}

	const now = new Date().toISOString();
	const [existing] = await db
		.select({
			id: friendLinks.id,
			status: friendLinks.status,
		})
		.from(friendLinks)
		.where(eq(friendLinks.siteUrl, parsed.data.siteUrl))
		.limit(1);

	if (existing) {
		if (["pending", "approved", "offline"].includes(existing.status)) {
			return c.redirect("/friends/apply?apply=duplicate");
		}

		await db
			.update(friendLinks)
			.set({
				name: parsed.data.name,
				avatarUrl: parsed.data.avatarUrl,
				description: parsed.data.description,
				contact: parsed.data.contact,
				note: parsed.data.note,
				status: "pending",
				reviewNote: null,
				reviewedAt: null,
				updatedAt: now,
			})
			.where(eq(friendLinks.id, existing.id));

		return c.redirect("/friends/apply?apply=success");
	}

	await db.insert(friendLinks).values({
		name: parsed.data.name,
		siteUrl: parsed.data.siteUrl,
		avatarUrl: parsed.data.avatarUrl,
		description: parsed.data.description,
		contact: parsed.data.contact,
		note: parsed.data.note,
		status: "pending",
		createdAt: now,
		updatedAt: now,
	});

	return c.redirect("/friends/apply?apply=success");
});

friendLinksRoutes.get("/avatar", async (c) => {
	const rawUrl = sanitizeCanonicalUrl(c.req.query("url"));
	if (!rawUrl) {
		return c.text("Địa chỉ avatar không hợp lệ", 400);
	}

	let targetUrl: URL;
	try {
		targetUrl = new URL(rawUrl);
	} catch {
		return c.text("Địa chỉ avatar không hợp lệ", 400);
	}

	const requestUrl = new URL(c.req.url);
	const initialValidateError = validateAvatarTarget(targetUrl, requestUrl);
	if (initialValidateError) {
		return c.text(initialValidateError, 400);
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, AVATAR_PROXY_TIMEOUT_MS);

	try {
		let currentUrl = new URL(targetUrl.toString());

		for (
			let redirectCount = 0;
			redirectCount <= AVATAR_PROXY_MAX_REDIRECTS;
			redirectCount += 1
		) {
			const validateError = validateAvatarTarget(currentUrl, requestUrl);
			if (validateError) {
				return c.text(validateError, 400);
			}

			const response = await fetch(currentUrl.toString(), {
				method: "GET",
				headers: {
					accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
					"user-agent": "cf-astro-blog-friend-avatar-proxy/1.0",
				},
				redirect: "manual",
				signal: controller.signal,
			});

			if (isRedirectStatus(response.status)) {
				const location = response.headers.get("location");
				if (!location) {
					return c.text("Địa chỉ chuyển hướng avatar không hợp lệ", 400);
				}

				let nextUrl: URL;
				try {
					nextUrl = new URL(location, currentUrl);
				} catch {
					return c.text("Địa chỉ chuyển hướng avatar không hợp lệ", 400);
				}

				const redirectValidateError = validateAvatarTarget(nextUrl, requestUrl);
				if (redirectValidateError) {
					return c.text(redirectValidateError, 400);
				}

				currentUrl = nextUrl;
				continue;
			}

			if (!response.ok) {
				return c.text("Avatar tạm thời không khả dụng", 502);
			}

			const contentType = parseAvatarContentType(
				response.headers.get("content-type"),
			);
			if (!isAllowedAvatarContentType(contentType)) {
				return c.text(
					"Loại tài nguyên avatar không được hỗ trợ, chỉ cho phép JPG, PNG, WEBP, AVIF, GIF",
					415,
				);
			}

			const data = await response.arrayBuffer();
			if (data.byteLength > AVATAR_PROXY_MAX_BYTES) {
				return c.text("Tệp avatar quá lớn", 413);
			}

			return new Response(data, {
				headers: {
					"content-type": contentType,
					"cache-control": `public, max-age=${AVATAR_PROXY_CACHE_SECONDS}, stale-while-revalidate=86400`,
					"x-content-type-options": "nosniff",
				},
			});
		}

		return c.text("Số lần chuyển hướng avatar quá nhiều", 400);
	} catch {
		return c.text("Không thể lấy avatar", 502);
	} finally {
		clearTimeout(timeout);
	}
});

export { friendLinksRoutes };
