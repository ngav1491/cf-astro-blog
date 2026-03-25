import {
	encodeRouteParam,
	escapeHtml,
	getPostStatusLabel,
	normalizeDisplayStatus,
} from "@/lib/security";
import { adminLayout } from "./layout";

interface DashboardData {
	posts: { total: number; published: number; drafts: number };
	sessions: number;
	events: number;
	recentPosts: Array<{
		id: number;
		title: string;
		slug: string;
		status: string;
		viewCount: number | null;
		createdAt: string;
	}>;
}

export function dashboardPage(data: DashboardData, csrfToken: string): string {
	const content = `
		<h1>Bảng điều khiển</h1>
		<div class="stats-grid">
			<div class="stat-card">
				<span class="stat-value">${data.posts.total}</span>
				<span class="stat-label">Tổng số bài viết</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">${data.posts.published}</span>
				<span class="stat-label">Đã xuất bản</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">${data.posts.drafts}</span>
				<span class="stat-label">Bản nháp</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">${data.sessions}</span>
				<span class="stat-label">Phiên truy cập</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">${data.events}</span>
				<span class="stat-label">Số sự kiện</span>
			</div>
		</div>

		<h2>Bài viết gần đây</h2>
		${
			data.recentPosts.length > 0
				? `<div class="table-card"><table class="data-table">
				<thead>
					<tr>
						<th>Tiêu đề</th>
						<th>Trạng thái</th>
						<th>Lượt xem</th>
						<th>Ngày tạo</th>
						<th>Thao tác</th>
					</tr>
				</thead>
				<tbody>
					${data.recentPosts
						.map(
							(post) => `
						<tr>
							<td><a href="/api/admin/posts/${post.id}/edit">${escapeHtml(post.title)}</a></td>
							<td><span class="badge badge-${normalizeDisplayStatus(post.status)}">${escapeHtml(getPostStatusLabel(post.status))}</span></td>
							<td>${post.viewCount ?? 0}</td>
							<td>${new Date(post.createdAt).toLocaleDateString()}</td>
							<td>
								<a href="/api/admin/posts/${post.id}/edit" class="btn btn-sm">Chỉnh sửa</a>
								<a href="/blog/${encodeRouteParam(post.slug)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Xem</a>
							</td>
						</tr>`,
						)
						.join("")}
				</tbody>
		</table></div>`
			: '<p class="empty-state">Hiện chưa có bài viết nào, <a href="/api/admin/posts/new">tạo bài viết đầu tiên ngay</a>.</p>'
	}

		<div class="page-actions">
			<a href="/api/admin/posts/new" class="btn btn-primary">Tạo bài viết mới</a>
		</div>
	`;

	return adminLayout("Bảng điều khiển", content, { csrfToken });
}
