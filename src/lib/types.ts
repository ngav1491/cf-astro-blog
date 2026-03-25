export interface SiteConfig {
	name: string;
	url: string;
	description: string;
	author: string;
	language: string;
	comments: CommentConfig;
}

export interface CommentConfig {
	provider: "giscus";
	repo: string;
	repoId: string;
	category: string;
	categoryId: string;
	mapping: "pathname" | "url" | "title" | "og:title";
	strict: boolean;
	reactionsEnabled: boolean;
	inputPosition: "top" | "bottom";
	lang: string;
}

export const siteConfig: SiteConfig = {
	name: "Eric-Terminal 的博客",
	url: "https://blog.ericterminal.com",
	description: "Ghi chép về Cloudflare, Frontend Engineering, Thiết kế hệ thống và những kinh nghiệm kỹ thuật bền vững.",
	author: "Eric",
	language: "vi-VN",
	comments: {
		provider: "giscus",
		repo: "Eric-Terminal/cf-astro-blog",
		repoId: "R_kgDORhlfAw",
		category: "Announcements",
		categoryId: "DIC_kwDORhlfA84C39BM",
		mapping: "pathname",
		strict: false,
		reactionsEnabled: true,
		inputPosition: "top",
		lang: "vi",
	},
};

export interface PaginationParams {
	page: number;
	limit: number;
}

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export type PostStatus = "draft" | "published" | "scheduled";
