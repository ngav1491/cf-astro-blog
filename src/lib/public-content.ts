import { and, eq, isNotNull, like, lte, or } from "drizzle-orm";
import { blogPosts } from "@/db/schema";

export const PUBLIC_POST_STATUS = "published";
export const SCHEDULED_POST_STATUS = "scheduled";

export function getPublicPostVisibilityCondition() {
	const nowIso = new Date().toISOString();
	return or(
		eq(blogPosts.status, PUBLIC_POST_STATUS),
		and(
			eq(blogPosts.status, SCHEDULED_POST_STATUS),
			isNotNull(blogPosts.publishAt),
			lte(blogPosts.publishAt, nowIso),
		),
	);
}

export function getPublicPostBySlugCondition(slug: string) {
	return and(eq(blogPosts.slug, slug), getPublicPostVisibilityCondition());
}

export function getPublicPostKeywordCondition(pattern: string) {
	return or(
		like(blogPosts.title, pattern),
		like(blogPosts.content, pattern),
		like(blogPosts.excerpt, pattern),
	);
}

export function getPublicPostSearchCondition(pattern: string) {
	return and(
		getPublicPostVisibilityCondition(),
		getPublicPostKeywordCondition(pattern),
	);
}
