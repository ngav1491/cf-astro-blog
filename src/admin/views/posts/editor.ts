import type { BlogCategory, BlogPost, BlogTag } from "@/db/schema";
import { getAllowedMediaAcceptValue } from "@/lib/media";
import {
	escapeAttribute,
	escapeHtml,
	escapeTextarea,
	getPostStatusLabel,
	normalizeDisplayStatus,
} from "@/lib/security";
import { adminLayout } from "../layout";

interface EditorData {
	post?: BlogPost;
	categories: BlogCategory[];
	tags: BlogTag[];
	defaultAuthorName: string;
	selectedTagIds?: number[];
	csrfToken: string;
	error?: string;
}

function toDateTimeLocalValue(value?: string | null): string {
	if (!value) {
		return "";
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "";
	}

	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function postEditorPage(data: EditorData): string {
	const {
		post,
		categories,
		tags,
		defaultAuthorName,
		selectedTagIds = [],
		csrfToken,
		error,
	} = data;
	const isEdit = !!post;
	const formAction = isEdit
		? `/api/admin/posts/${post.id}`
		: "/api/admin/posts";
	const currentStatus = normalizeDisplayStatus(post?.status || "draft");
	const featuredImageKey = post?.featuredImageKey || "";
	const featuredImageAlt = post?.featuredImageAlt || "";
	const featuredImageUrl = featuredImageKey ? `/media/${featuredImageKey}` : "";
	const isPinned = Boolean(post?.isPinned);
	const pinnedOrderValue =
		typeof post?.pinnedOrder === "number" && post.pinnedOrder > 0
			? String(post.pinnedOrder)
			: "100";
	const publishAtValue = toDateTimeLocalValue(post?.publishAt || null);
	const publishedAtValue = toDateTimeLocalValue(post?.publishedAt || null);
	const isScheduled = currentStatus === "scheduled";
	const isPublished = currentStatus === "published";
	const authorNameValue = post?.authorName?.trim() || defaultAuthorName.trim();

	const content = `
		<h1>${isEdit ? "Chỉnh sửa bài viết" : "Tạo bài viết mới"}</h1>
		${error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ""}

		<form
			method="post"
			action="${escapeAttribute(formAction)}"
			data-editor-upload-url="/api/admin/media/upload-async"
			data-editor-csrf-token="${escapeAttribute(csrfToken)}"
			data-editor-draft-scope="${escapeAttribute(formAction)}"
		>
			<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
			<div class="editor-grid">
				<div class="editor-panel">
					<div class="form-group">
						<label for="title">Tiêu đề</label>
						<input type="text" id="title" name="title" class="form-input" value="${escapeAttribute(post?.title || "")}" required maxlength="200" />
					</div>

					<div class="form-group">
						<label for="slug">Đường dẫn truy cập</label>
						<input
							type="text"
							id="slug"
							name="slug"
							class="form-input"
							value="${escapeAttribute(post?.slug || "")}"
							pattern="[a-z0-9\\-]*"
							maxlength="120"
							placeholder="Để trống sẽ tự động tạo"
							data-manual="${isEdit ? "true" : "false"}"
						/>
						<p class="form-help">/blog/<span data-slug-preview>${escapeHtml(post?.slug || "tự động tạo")}</span></p>
					</div>

					<div class="form-group">
						<label for="excerpt">Mô tả ngắn</label>
						<input type="text" id="excerpt" name="excerpt" class="form-input" value="${escapeAttribute(post?.excerpt || "")}" maxlength="200" />
						<div class="draft-toolbar ai-seo-toolbar">
							<button
								type="button"
								class="btn btn-sm"
								data-ai-seo-generate="true"
								data-ai-seo-endpoint="/api/admin/posts/ai-seo"
							>
								AI tạo mô tả và SEO
							</button>
							<span class="form-help" data-ai-seo-status>Sẽ dựa trên tiêu đề và nội dung hiện tại để tạo mô tả, tiêu đề SEO/mô tả/từ khóa</span>
						</div>
					</div>

					<div class="form-group">
						<label for="authorName">Tác giả</label>
						<input
							type="text"
							id="authorName"
							name="authorName"
							class="form-input"
							value="${escapeAttribute(authorNameValue)}"
							maxlength="120"
							required
						/>
						<p class="form-help">Dùng để hiển thị ở trang chủ và trang bài viết, mặc định lấy từ phần "Tên tác giả bài viết" trong giao diện trang web, không dùng tên đăng nhập GitHub.</p>
					</div>

					<div class="form-group">
						<label for="content">Nội dung (Markdown)</label>
						<div class="markdown-editor-shell">
							<textarea id="content" name="content" class="form-textarea" required data-markdown-input="true">${escapeTextarea(post?.content || "")}</textarea>
							<section class="markdown-preview-panel" aria-label="Xem trước Markdown">
								<div class="markdown-preview-head">Xem trước trực tiếp</div>
								<div class="markdown-preview-body" data-markdown-preview="true"></div>
							</section>
						</div>
						<p class="form-help">Nhập nội dung sẽ được xem trước trực tiếp ở bên phải, kể cả dấu xuống dòng đơn.</p>
						<div class="draft-toolbar" data-draft-toolbar="true" hidden>
							<button type="button" class="btn btn-sm" data-draft-restore="true" hidden>Khôi phục bản nháp cục bộ</button>
							<button type="button" class="btn btn-sm btn-danger" data-draft-clear="true" hidden>Xóa bản nháp cục bộ</button>
							<span class="form-help" data-draft-status="true"></span>
						</div>
						<p class="form-help" data-content-upload-status></p>
					</div>
				</div>

				<div class="editor-panel">
					<div class="form-group">
						<label for="status">Trạng thái</label>
						<select id="status" name="status" class="form-select">
							<option value="draft" ${currentStatus === "draft" ? "selected" : ""}>${getPostStatusLabel("draft")}</option>
							<option value="published" ${currentStatus === "published" ? "selected" : ""}>${getPostStatusLabel("published")}</option>
							<option value="scheduled" ${currentStatus === "scheduled" ? "selected" : ""}>${getPostStatusLabel("scheduled")}</option>
						</select>
					</div>

					<div class="form-group schedule-field ${isScheduled ? "" : "is-hidden"}" data-schedule-field="true">
						<label for="publishAt">Thời gian xuất bản hẹn giờ</label>
						<input
							type="datetime-local"
							id="publishAt"
							name="publishAt"
							class="form-input"
							value="${escapeAttribute(publishAtValue)}"
							data-publish-at-input="true"
							${isScheduled ? "" : "disabled"}
							${isScheduled ? "required" : ""}
						/>
					</div>

					<div class="form-group published-date-field ${isPublished ? "" : "is-hidden"}" data-published-date-field="true">
						<label for="publishedAt">Ngày xuất bản</label>
						<input
							type="datetime-local"
							id="publishedAt"
							name="publishedAt"
							class="form-input"
							value="${escapeAttribute(publishedAtValue)}"
							data-published-at-input="true"
							min="0001-01-01T00:00"
							max="9999-12-31T23:59"
							${isPublished ? "" : "disabled"}
						/>
						<p class="form-help">Có thể sửa ngày xuất bản thủ công, tối đa đến năm 9999.</p>
					</div>

					<div class="form-group">
						<label for="isPinned">
							<input
								type="checkbox"
								id="isPinned"
								name="isPinned"
								value="1"
								${isPinned ? "checked" : ""}
							/>
							Ghim bài viết lên trang chủ
						</label>
						<p class="form-help">Sau khi chọn, bài viết sẽ được hiển thị cố định ở phần "Bài viết đã ghim" trên trang chủ.</p>
					</div>

					<div class="form-group">
						<label for="pinnedOrder">Thứ tự ghim</label>
						<input
							type="number"
							id="pinnedOrder"
							name="pinnedOrder"
							class="form-input"
							value="${escapeAttribute(pinnedOrderValue)}"
							min="1"
							max="9999"
						/>
						<p class="form-help">Số nhỏ hơn sẽ hiển thị ở trên; nếu không chọn ghim thì giá trị này sẽ được bỏ qua.</p>
					</div>

					<div class="form-group">
						<label for="categoryId">Phân loại</label>
						<select id="categoryId" name="categoryId" class="form-select">
							<option value="">Chưa phân loại</option>
							${categories.map((cat) => `<option value="${cat.id}" ${post?.categoryId === cat.id ? "selected" : ""}>${escapeHtml(cat.name)}</option>`).join("")}
							<option value="__new__">+ Tạo phân loại mới</option>
						</select>
						<div class="new-category-wrap is-hidden" data-new-category-wrap="true">
							<input
								type="text"
								id="newCategoryName"
								name="newCategoryName"
								class="form-input"
								maxlength="60"
								placeholder="Nhập phân loại mới"
								disabled
								data-new-category-input="true"
							/>
						</div>
					</div>

					<div class="form-group">
						<label for="featuredImageKey">Hình ảnh bìa</label>
						<input
							type="hidden"
							id="featuredImageKey"
							name="featuredImageKey"
							value="${escapeAttribute(featuredImageKey)}"
							maxlength="255"
							data-cover-key-input="true"
						/>
						<div
							class="cover-uploader"
							data-cover-uploader="true"
							data-upload-url="/api/admin/media/upload-async"
							data-csrf-token="${escapeAttribute(csrfToken)}"
						>
							<input
								type="file"
								class="sr-only"
								accept="${escapeAttribute(getAllowedMediaAcceptValue())}"
								data-cover-file-input="true"
							/>
							<div class="cover-dropzone" data-cover-dropzone="true">
								${
									featuredImageUrl
										? `<img src="${escapeAttribute(featuredImageUrl)}" alt="${escapeAttribute(featuredImageAlt || "Xem trước bìa")}" class="cover-preview-image" data-cover-preview-image="true" />`
										: `<div class="cover-empty" data-cover-empty="true">Kéo thả hình ảnh hoặc nhấp để tải lên</div>`
								}
							</div>
							<div class="cover-actions">
								<button type="button" class="btn btn-sm" data-cover-select="true">Tải lên bìa</button>
								<button type="button" class="btn btn-sm btn-danger" data-cover-clear="true">Xóa bìa</button>
							</div>
							<p class="form-help" data-cover-upload-status></p>
						</div>
					</div>

					<div class="form-group">
						<label for="featuredImageAlt">Văn bản thay thế cho hình ảnh</label>
						<input type="text" id="featuredImageAlt" name="featuredImageAlt" class="form-input" value="${escapeAttribute(featuredImageAlt)}" maxlength="200" placeholder="Tùy chọn, nên mô tả nội dung hình ảnh để hỗ trợ khả năng tiếp cận" />
					</div>

					<details>
						<summary>SEO (Tùy chọn)</summary>
						<div class="form-group">
							<label for="metaTitle">Tiêu đề SEO</label>
							<input type="text" id="metaTitle" name="metaTitle" class="form-input" value="${escapeAttribute(post?.metaTitle || "")}" maxlength="200" />
						</div>
						<div class="form-group">
							<label for="metaDescription">Mô tả SEO</label>
							<input type="text" id="metaDescription" name="metaDescription" class="form-input" value="${escapeAttribute(post?.metaDescription || "")}" maxlength="160" />
						</div>
						<div class="form-group">
							<label for="metaKeywords">Từ khóa SEO</label>
							<input type="text" id="metaKeywords" name="metaKeywords" class="form-input" value="${escapeAttribute(post?.metaKeywords || "")}" maxlength="200" />
						</div>
						<div class="form-group">
							<label for="canonicalUrl">Địa chỉ liên kết chuẩn</label>
							<input type="url" id="canonicalUrl" name="canonicalUrl" class="form-input" value="${escapeAttribute(post?.canonicalUrl || "")}" maxlength="255" />
						</div>
					</details>

					<div class="form-group">
						<label>Nhãn</label>
						<input type="hidden" id="tagIds" name="tagIds" value="${escapeAttribute(selectedTagIds.join(","))}" />
						<div class="tag-list">
							${
								tags.length > 0
									? tags
											.map(
												(tag) => `
								<label class="tag-chip">
									<input type="checkbox" value="${tag.id}" ${selectedTagIds.includes(tag.id) ? "checked" : ""} data-tag-checkbox="true" />
									${escapeHtml(tag.name)}
								</label>`,
											)
											.join("")
									: `<span class="form-help">Chưa có nhãn</span>`
							}
						</div>
						<input
							type="text"
							id="newTagNames"
							name="newTagNames"
							class="form-input"
							maxlength="400"
							placeholder="Nhãn mới, nhiều nhãn cách nhau bằng dấu phẩy"
						/>
					</div>

					<div class="form-actions">
						<button type="submit" class="btn btn-primary">${isEdit ? "Lưu thay đổi" : "Tạo bài viết"}</button>
						<a href="/api/admin/posts" class="btn">Hủy</a>
					</div>
				</div>
			</div>
		</form>

	`;

	return adminLayout(isEdit ? "Chỉnh sửa bài viết" : "Tạo bài viết mới", content, {
		csrfToken,
	});
}
