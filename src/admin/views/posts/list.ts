import {
	encodeRouteParam,
	escapeAttribute,
	escapeHtml,
	getPostStatusLabel,
	normalizeDisplayStatus,
} from "@/lib/security";
import { adminLayout } from "../layout";

interface PostRow {
	id: number;
	title: string;
	slug: string;
	status: string;
	isPinned: boolean;
	pinnedOrder: number;
	publishedAt: string | null;
	viewCount: number | null;
	createdAt: string;
	categoryName: string | null;
}

interface TaxonomyRow {
	id: number;
	name: string;
	slug: string;
	postCount: number;
}

interface PostsListAlert {
	type: "success" | "error";
	message: string;
}

function renderTaxonomyRows(options: {
	items: TaxonomyRow[];
	emptyText: string;
	deleteActionBuilder: (id: number) => string;
	csrfToken: string;
	inUseLabel: string;
}) {
	const { items, emptyText, deleteActionBuilder, csrfToken, inUseLabel } =
		options;

	if (items.length === 0) {
		return `<p class="empty-state">${escapeHtml(emptyText)}</p>`;
	}

	return `
		<div class="table-card">
			<table class="data-table">
				<thead>
					<tr>
						<th>Tên</th>
						<th>Slug</th>
						<th>Bài viết liên kết</th>
						<th>Thao tác</th>
					</tr>
				</thead>
				<tbody>
					${items
						.map(
							(item) => `
						<tr>
							<td>${escapeHtml(item.name)}</td>
							<td><code>${escapeHtml(item.slug)}</code></td>
							<td>${item.postCount}</td>
							<td>
								${
									item.postCount > 0
										? `<span class="form-help">${escapeHtml(inUseLabel)}</span>`
										: `<form method="post" action="${escapeAttribute(deleteActionBuilder(item.id))}" data-confirm-message="${escapeAttribute("Bạn có chắc muốn xóa bản ghi lịch sử này không?")}">
												<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
												<button type="submit" class="btn btn-sm btn-danger">Xóa</button>
										</form>`
								}
							</td>
						</tr>`,
						)
						.join("")}
				</tbody>
			</table>
		</div>
	`;
}

export function postsListPage(
	posts: PostRow[],
	categories: TaxonomyRow[],
	tags: TaxonomyRow[],
	csrfToken: string,
	alert?: PostsListAlert,
): string {
	const content = `
		<div class="page-header">
			<h1>Bài viết</h1>
			<a href="/api/admin/posts/new" class="btn btn-primary">Tạo bài viết mới</a>
		</div>

		${alert ? `<div class="alert alert-${escapeAttribute(alert.type)}">${escapeHtml(alert.message)}</div>` : ""}

		${
			posts.length > 0
				? `<div class="table-card"><table class="data-table">
				<thead>
					<tr>
						<th>Tiêu đề</th>
						<th>Phân loại</th>
						<th>Trạng thái</th>
						<th>Ghim</th>
						<th>Lượt xem</th>
						<th>Ngày</th>
						<th>Thao tác</th>
					</tr>
				</thead>
				<tbody>
					${posts
						.map(
							(post) => `
					<tr>
						<td>
							<a href="/api/admin/posts/${post.id}/edit">${escapeHtml(post.title)}</a>
						</td>
						<td>${escapeHtml(post.categoryName || "-")}</td>
						<td><span class="badge badge-${normalizeDisplayStatus(post.status)}">${escapeHtml(getPostStatusLabel(post.status))}</span></td>
						<td>${post.isPinned ? `Ghim #${post.pinnedOrder}` : "-"}</td>
						<td>${post.viewCount ?? 0}</td>
						<td>${post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : new Date(post.createdAt).toLocaleDateString()}</td>
						<td class="table-actions">
							<a href="/api/admin/posts/${post.id}/edit" class="btn btn-sm">Chỉnh sửa</a>
							<a href="/blog/${encodeRouteParam(post.slug)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Xem</a>
							${
								normalizeDisplayStatus(post.status) === "scheduled"
									? `<form method="post" action="/api/admin/posts/${post.id}/cancel-schedule" data-confirm-message="${escapeAttribute("Bạn có chắc muốn hủy xuất bản hẹn giờ của bài viết này không?")}">
										<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
										<button type="submit" class="btn btn-sm">Hủy hẹn giờ</button>
								</form>`
									: ""
							}
							<form method="post" action="/api/admin/posts/${post.id}/delete" data-confirm-message="${escapeAttribute("Bạn có chắc muốn xóa bài viết này không?")}">
								<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
								<button type="submit" class="btn btn-sm btn-danger">Xóa</button>
							</form>
						</td>
					</tr>`,
						)
						.join("")}
				</tbody>
			</table></div>`
				: '<p class="empty-state">Hiện chưa có bài viết nào, <a href="/api/admin/posts/new">tạo bài viết đầu tiên ngay</a>.</p>'
		}

		<section style="margin-top: 1.25rem;">
			<h2 style="margin-bottom: 0.7rem;">Quản lý phân loại</h2>
			<p class="form-help" style="margin-bottom: 0.7rem;">Chỉ có thể xóa những phân loại chưa được sử dụng trong bài viết.</p>
			${renderTaxonomyRows({
				items: categories,
				emptyText: "Chưa có phân loại nào.",
				deleteActionBuilder: (id) => `/api/admin/posts/categories/${id}/delete`,
				csrfToken,
				inUseLabel: "Có bài viết liên kết, không thể xóa",
			})}
		</section>

		<section style="margin-top: 1.25rem;">
			<h2 style="margin-bottom: 0.7rem;">Quản lý nhãn</h2>
			<p class="form-help" style="margin-bottom: 0.7rem;">Chỉ có thể xóa những nhãn chưa được sử dụng trong bài viết.</p>
			${renderTaxonomyRows({
				items: tags,
				emptyText: "Chưa có nhãn nào.",
				deleteActionBuilder: (id) => `/api/admin/posts/tags/${id}/delete`,
				csrfToken,
				inUseLabel: "Có bài viết liên kết, không thể xóa",
			})}
		</section>
	`;

	return adminLayout("Bài viết", content, { csrfToken });
}
