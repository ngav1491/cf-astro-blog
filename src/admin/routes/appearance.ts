import { Hono } from "hono";
import { getDb } from "@/lib/db";
import {
	getAllowedMediaAcceptValue,
	isAllowedImageMimeType,
	MAX_UPLOAD_BYTES,
	saveMediaObjectWithDedup,
} from "@/lib/media";
import { escapeAttribute, escapeHtml, sanitizeMediaKey } from "@/lib/security";
import {
	type AiApiKeySource,
	type AiSettings,
	DEFAULT_AI_SETTINGS,
	DEFAULT_SITE_APPEARANCE,
	getAiSettings,
	getSiteAppearance,
	resolveAiSettingsWithSecrets,
	type SiteNavLink,
	saveAiSettings,
	saveSiteAppearance,
} from "@/lib/site-appearance";
import {
	type AdminAppEnv,
	assertCsrfToken,
	getAuthenticatedSession,
	requireAuth,
} from "../middleware/auth";
import { adminLayout } from "../views/layout";

const appearance = new Hono<AdminAppEnv>();

type AppearanceFormValue = string | File | (string | File)[];
type AppearanceFormBody = Record<string, AppearanceFormValue>;

function getBodyText(body: AppearanceFormBody, key: string): string {
	const value = body[key];
	if (Array.isArray(value)) {
		const firstText = value.find(
			(item): item is string => typeof item === "string",
		);
		return firstText?.trim() ?? "";
	}

	return typeof value === "string" ? value : "";
}

function getBodyTexts(body: AppearanceFormBody, key: string): string[] {
	const value = body[key];
	if (Array.isArray(value)) {
		return value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim());
	}

	if (typeof value === "string") {
		return [value.trim()];
	}

	return [];
}

function getBodyFile(body: AppearanceFormBody, key: string): File | null {
	const value = body[key];
	if (Array.isArray(value)) {
		const firstFile = value.find((item): item is File => item instanceof File);
		return firstFile ?? null;
	}

	return value instanceof File ? value : null;
}

function parseBodyNumber(
	body: AppearanceFormBody,
	primaryKey: string,
	fallbackKey?: string,
): number {
	const primaryRaw = getBodyText(body, primaryKey);
	if (primaryRaw !== "") {
		return Number(primaryRaw);
	}

	if (fallbackKey) {
		const fallbackRaw = getBodyText(body, fallbackKey);
		if (fallbackRaw !== "") {
			return Number(fallbackRaw);
		}
	}

	return Number.NaN;
}

function convertOpacityToTransparency(opacity: number): number {
	return Math.max(0, Math.min(100, 100 - Math.round(opacity)));
}

function convertTransparencyToOpacity(transparency: number): number {
	return Math.max(0, Math.min(100, 100 - Math.round(transparency)));
}

function buildLinkItemsFromBody(
	labels: string[],
	hrefs: string[],
): SiteNavLink[] {
	const maxLength = Math.max(labels.length, hrefs.length);
	const items: SiteNavLink[] = [];
	for (let index = 0; index < maxLength; index += 1) {
		const label = labels[index]?.trim() ?? "";
		const href = hrefs[index]?.trim() ?? "";
		if (!label || !href) {
			continue;
		}

		items.push({ label, href });
	}

	return items;
}

function renderLinkRow(options: {
	labelName: string;
	hrefName: string;
	labelText: string;
	hrefText: string;
	labelValue: string;
	hrefValue: string;
	hrefPlaceholder: string;
	removeLabel: string;
}) {
	return `
		<div class="appearance-link-row" data-link-row>
			<div class="appearance-link-field">
				<label>${escapeHtml(options.labelText)}</label>
				<input
					name="${escapeAttribute(options.labelName)}"
					class="form-input"
					value="${escapeAttribute(options.labelValue)}"
					maxlength="24"
					placeholder="Ví dụ: Lưu trữ"
				/>
			</div>
			<div class="appearance-link-field">
				<label>${escapeHtml(options.hrefText)}</label>
				<input
					name="${escapeAttribute(options.hrefName)}"
					class="form-input"
					value="${escapeAttribute(options.hrefValue)}"
					maxlength="240"
					placeholder="${escapeAttribute(options.hrefPlaceholder)}"
				/>
			</div>
			<button type="button" class="btn appearance-link-remove" data-link-remove>
				${escapeHtml(options.removeLabel)}
			</button>
		</div>
	`;
}

function renderLinkRows(
	items: SiteNavLink[],
	options: Omit<
		Parameters<typeof renderLinkRow>[0],
		"labelValue" | "hrefValue"
	>,
) {
	const safeItems = items.length > 0 ? items : [{ label: "", href: "" }];
	return safeItems
		.map((item) =>
			renderLinkRow({
				...options,
				labelValue: item.label,
				hrefValue: item.href,
			}),
		)
		.join("");
}

function renderAppearancePage(options: {
	csrfToken: string;
	settings: typeof DEFAULT_SITE_APPEARANCE;
	aiSettings: AiSettings;
	aiKeySource: {
		internal: AiApiKeySource;
		public: AiApiKeySource;
	};
	aiWebKeyStatus: {
		internalHasSavedKey: boolean;
		publicHasSavedKey: boolean;
	};
	alert?: { type: "success" | "error"; message: string };
}) {
	const {
		csrfToken,
		settings,
		aiSettings,
		aiKeySource,
		aiWebKeyStatus,
		alert,
	} = options;
	const backgroundScaleOffset = Math.min(
		80,
		Math.max(0, settings.backgroundScale - 100),
	);
	const backgroundPositionXOffset = Math.min(
		50,
		Math.max(-50, settings.backgroundPositionX - 50),
	);
	const backgroundPositionYOffset = Math.min(
		50,
		Math.max(-50, settings.backgroundPositionY - 50),
	);
	const backgroundTransparency = convertOpacityToTransparency(
		settings.backgroundOpacity,
	);
	const heroCardTransparency = convertOpacityToTransparency(
		settings.heroCardOpacity,
	);
	const articlePanelTransparency = convertOpacityToTransparency(
		settings.articlePanelOpacity,
	);
	const alertHtml = alert
		? `<div class="alert alert-${escapeAttribute(alert.type)}">${escapeHtml(alert.message)}</div>`
		: "";
	const internalManagedBySecret = aiKeySource.internal === "cloudflare-secret";
	const publicManagedBySecret = aiKeySource.public === "cloudflare-secret";
	const internalApiKeyHelp = internalManagedBySecret
		? "Hiện tại ưu tiên sử dụng Cloudflare Secret: AI_INTERNAL_API_KEY, biểu mẫu web sẽ không ghi đè giá trị này."
		: aiWebKeyStatus.internalHasSavedKey
			? "Đã lưu API Key (không hiển thị vì lý do bảo mật). Để trống khi gửi để giữ nguyên."
			: "Hiện chưa lưu API Key. Để trống khi gửi sẽ giữ nguyên trạng thái trống.";
	const publicApiKeyHelp = publicManagedBySecret
		? "Hiện tại ưu tiên sử dụng Cloudflare Secret: AI_PUBLIC_API_KEY, biểu mẫu web sẽ không ghi đè giá trị này."
		: aiWebKeyStatus.publicHasSavedKey
			? "Đã lưu API Key (không hiển thị vì lý do bảo mật). Để trống khi gửi để giữ nguyên."
			: "Hiện chưa lưu API Key. Để trống khi gửi sẽ giữ nguyên trạng thái trống.";
	const internalApiPlaceholder = internalManagedBySecret
		? "Được quản lý bởi AI_INTERNAL_API_KEY"
		: "Để trống để không thay đổi Key hiện tại";
	const publicApiPlaceholder = publicManagedBySecret
		? "Được quản lý bởi AI_PUBLIC_API_KEY"
		: "Để trống để không thay đổi Key hiện tại";
	const internalApiDisabled = internalManagedBySecret ? "disabled" : "";
	const publicApiDisabled = publicManagedBySecret ? "disabled" : "";

	return `
		<style>
			.appearance-grid {
				display: grid;
				grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
				gap: 1.5rem;
			}

			.appearance-form-grid {
				align-items: start;
				margin-bottom: 1.5rem;
			}

			.appearance-panel {
				background: var(--bg-secondary);
				border: 1px solid var(--border);
				border-radius: var(--radius);
				padding: 1.25rem;
				margin-bottom: 1.5rem;
			}

			.appearance-panel h2 {
				margin-top: 0;
			}

			.appearance-copy {
				color: var(--text-muted);
				margin-top: -0.75rem;
				margin-bottom: 1rem;
			}

			.appearance-stack {
				display: grid;
				gap: 1rem;
			}

			.appearance-upload-dropzone {
				position: relative;
				width: 100%;
				aspect-ratio: 5 / 2;
				border: 1px dashed rgba(10, 132, 255, 0.34);
				border-radius: 0.95rem;
				background:
					linear-gradient(140deg, rgba(10, 132, 255, 0.08), rgba(10, 132, 255, 0.02)),
					rgba(255, 255, 255, 0.02);
				display: grid;
				place-items: center;
				padding: 1rem;
				text-align: center;
				overflow: hidden;
				cursor: pointer;
				transition:
					border-color var(--transition),
					background-color var(--transition),
					transform var(--transition);
			}

			.appearance-upload-dropzone:hover,
			.appearance-upload-dropzone.is-dragover {
				border-color: rgba(10, 132, 255, 0.65);
				background:
					linear-gradient(140deg, rgba(10, 132, 255, 0.16), rgba(10, 132, 255, 0.06)),
					rgba(255, 255, 255, 0.03);
				transform: translateY(-1px);
			}

			.appearance-upload-dropzone:focus-visible {
				outline: 2px solid rgba(10, 132, 255, 0.6);
				outline-offset: 2px;
			}

			.appearance-upload-copy {
				display: grid;
				gap: 0.4rem;
				color: var(--text-secondary);
			}

			.appearance-upload-copy strong {
				font-size: 1rem;
				color: var(--text-primary);
			}

			.appearance-upload-copy span {
				font-size: 0.86rem;
			}

			.appearance-upload-input {
				display: none;
			}

			.appearance-hero-uploader {
				display: grid;
				gap: 0.65rem;
				margin-top: 0.75rem;
			}

			.appearance-hero-dropzone {
				aspect-ratio: auto;
				min-height: 170px;
			}

			.appearance-background-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 0.75rem;
				margin-top: 0.85rem;
			}

			.appearance-controls {
				display: grid;
				gap: 1rem;
			}

				.appearance-inline-grid {
					display: grid;
					grid-template-columns: repeat(2, minmax(0, 1fr));
					gap: 0.85rem;
				}

				.appearance-chip-grid {
					display: grid;
					grid-template-columns: repeat(3, minmax(0, 1fr));
					gap: 0.85rem;
				}

			.appearance-list-head {
				display: flex;
				justify-content: space-between;
				align-items: center;
				flex-wrap: wrap;
				gap: 0.75rem;
				margin-bottom: 0.8rem;
			}

			.appearance-list-head h3,
			.appearance-list-head h4 {
				margin: 0;
			}

			.appearance-note {
				margin: 0 0 0.8rem;
				color: var(--text-muted);
				font-size: 0.85rem;
			}

			.appearance-link-list {
				display: grid;
				gap: 0.75rem;
			}

			.appearance-link-row {
				display: grid;
				grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
				gap: 0.75rem;
				align-items: end;
				padding: 0.8rem;
				border: 1px solid var(--border);
				border-radius: 0.8rem;
				background: rgba(255, 255, 255, 0.02);
			}

			.appearance-link-field {
				display: grid;
				gap: 0.4rem;
			}

			.appearance-link-field label {
				font-size: 0.82rem;
				color: var(--text-secondary);
			}

			.appearance-link-remove {
				align-self: center;
			}

			.appearance-content-fieldset {
				margin-top: 1.25rem;
				border-top: 1px solid var(--border);
				padding-top: 1.25rem;
			}

			.appearance-content-fieldset h3 {
				margin-bottom: 0.8rem;
			}

			.appearance-range {
				display: grid;
				gap: 0.5rem;
			}

			.appearance-range-meta {
				display: flex;
				justify-content: space-between;
				align-items: center;
				color: var(--text-secondary);
				font-size: 0.85rem;
			}

			.appearance-range input[type="range"] {
				width: 100%;
			}

			.appearance-actions {
				display: flex;
				flex-wrap: wrap;
				gap: 0.75rem;
				margin-top: 1.5rem;
			}

			.appearance-key-input {
				font-family: var(--font-mono);
				font-size: 0.82rem;
			}

			.appearance-panel .form-textarea {
				min-height: 120px;
			}

				@media (max-width: 980px) {
					.appearance-grid {
						grid-template-columns: 1fr;
					}

					.appearance-inline-grid {
						grid-template-columns: 1fr;
					}

					.appearance-chip-grid {
						grid-template-columns: 1fr;
					}

				.appearance-link-row {
					grid-template-columns: 1fr;
				}

				.appearance-link-remove {
					justify-self: start;
				}
			}

		</style>
		${alertHtml}
		<h1>Giao diện trang web</h1>
		<p class="appearance-copy">Tại đây kiểm soát thống nhất hình nền trang chính, thanh trạng thái trên cùng, liên kết chỉ mục điều hướng, màn hình đầu trang chính và thông tin thanh bên trang bài viết.</p>
		<form method="post" action="/api/admin/appearance" class="appearance-grid appearance-form-grid" data-appearance-form="true">
			<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
			<div class="appearance-stack">
				<section class="appearance-panel">
			<section class="appearance-panel">
				<h2>Quản lý hình nền</h2>
				<div class="appearance-stack">
					<div
						class="appearance-upload-dropzone"
						data-appearance-upload-dropzone
						data-appearance-background-dropzone="true"
						role="button"
						tabindex="0"
						aria-label="Kéo thả tệp hoặc nhấp để tải lên hình nền"
					>
						${
							settings.backgroundImageKey
								? `<img src="/media/${escapeAttribute(settings.backgroundImageKey)}" alt="Xem trước hình nền" class="cover-preview-image" data-appearance-background-preview="true" />`
								: `<div class="appearance-upload-copy" data-appearance-background-empty="true">
										<strong>Kéo hình ảnh vào đây</strong>
										<span>Hoặc nhấp để chọn tệp, tự động tải lên và đặt làm hình nền hiện tại</span>
									</div>`
						}
					</div>
							type="file"
							name="file"
							accept="${escapeAttribute(getAllowedMediaAcceptValue())}"
							class="appearance-upload-input"
							data-appearance-upload-input
						/>
					</div>
					<div class="form-group">
				<div class="form-group">
					<label for="backgroundImageKey">Khóa hình nền</label>
					<input
						id="backgroundImageKey"
						name="backgroundImageKey"
						class="form-input appearance-key-input"
						value="${escapeAttribute(settings.backgroundImageKey ?? "")}"
						placeholder="appearance/background/2026-03-07/xxxx.webp"
						data-appearance-background-key-input="true"
					/>
				</div>
				<p class="appearance-copy">Tải lên và xóa chỉ ảnh hưởng đến "tham chiếu hiện tại", không xóa tệp gốc trong thư viện phương tiện.</p>
				${
					settings.backgroundImageKey
						? `<div class="appearance-background-actions">
								<button
									type="submit"
									class="btn"
									formaction="/api/admin/appearance/background/clear"
									formmethod="post"
									data-confirm-message="${escapeAttribute("Xác nhận xóa tham chiếu hình nền hiện tại?")}"
									formnovalidate
								>
									Xóa tham chiếu hiện tại
								</button>
							</div>`
						: ""
				}
				<section class="appearance-panel">
			<section class="appearance-panel">
				<div class="appearance-list-head">
					<h2>Thanh trạng thái trên cùng và chỉ mục điều hướng</h2>
					<button type="button" class="btn" data-link-add="nav">+ Thêm điều hướng</button>
				</div>
				<div class="form-group">
					<label for="headerSubtitle">Văn bản thanh trạng thái trên cùng</label>
					<input
						id="headerSubtitle"
						name="headerSubtitle"
						class="form-input"
						value="${escapeAttribute(settings.headerSubtitle)}"
						maxlength="120"
					/>
				</div>
				<p class="appearance-note">Điều hướng hỗ trợ thêm không giới hạn, trang chính sẽ tự động xuống dòng để phù hợp.</p>
				<div class="appearance-link-list" data-link-list="nav">
					${renderLinkRows(settings.navLinks, {
						labelName: "navLinkLabel",
						hrefName: "navLinkHref",
						labelText: "Văn bản điều hướng",
						hrefText: "Liên kết điều hướng",
						hrefPlaceholder: "/blog",
						removeLabel: "Xóa",
					})}
				</div>
				<template data-link-template="nav">
					${renderLinkRow({
						labelName: "navLinkLabel",
						hrefName: "navLinkHref",
						labelText: "Văn bản điều hướng",
						hrefText: "Liên kết điều hướng",
						labelValue: "",
						hrefValue: "",
						hrefPlaceholder: "/blog",
						removeLabel: "Xóa",
					})}
				</template>
			</section>
			<section class="appearance-panel">
				<h2>Văn bản màn hình đầu trang chính</h2>
				<div class="form-group">
					<label for="heroKicker">Nhãn trên cùng</label>
					<input
						id="heroKicker"
						name="heroKicker"
						class="form-input"
						value="${escapeAttribute(settings.heroKicker)}"
						maxlength="24"
					/>
				</div>
				<div class="form-group">
					<label for="heroTitle">Tiêu đề chính</label>
					<input
						id="heroTitle"
						name="heroTitle"
						class="form-input"
						value="${escapeAttribute(settings.heroTitle)}"
						maxlength="120"
					/>
				</div>
				<div class="form-group">
					<label for="heroIntro">Giới thiệu</label>
					<textarea id="heroIntro" name="heroIntro" class="form-textarea" maxlength="600">${escapeHtml(settings.heroIntro)}</textarea>
				</div>
				<div class="form-group">
					<label for="heroMainImagePath">Đường dẫn hình ảnh màn hình đầu</label>
					<input
						id="heroMainImagePath"
						name="heroMainImagePath"
						class="form-input appearance-key-input"
						value="${escapeAttribute(settings.heroMainImagePath ?? "")}"
						maxlength="320"
						placeholder="/media/appearance/home/hero-main.webp"
						data-hero-image-path-input="true"
					/>
					<div
						class="appearance-hero-uploader"
						data-hero-image-uploader="true"
						data-upload-url="/api/admin/media/upload-async"
						data-csrf-token="${escapeAttribute(csrfToken)}"
					>
						<input
							type="file"
							accept="${escapeAttribute(getAllowedMediaAcceptValue())}"
							class="appearance-upload-input"
							data-hero-image-file-input="true"
						/>
						<div
							class="appearance-upload-dropzone appearance-hero-dropzone"
							data-hero-image-dropzone="true"
							role="button"
							tabindex="0"
							aria-label="Kéo thả tệp hoặc nhấp để tải lên hình ảnh màn hình đầu"
						>
							${
								settings.heroMainImagePath
									? `<img src="${escapeAttribute(settings.heroMainImagePath)}" alt="Xem trước hình màn hình đầu" class="cover-preview-image" data-hero-image-preview="true" />`
									: `<div class="cover-empty" data-hero-image-empty="true">Kéo hình ảnh hoặc nhấp để tải lên hình màn hình đầu</div>`
							}
						</div>
						<div class="appearance-background-actions">
							<button type="button" class="btn btn-sm" data-hero-image-select="true">Tải lên hình màn hình đầu</button>
							<button type="button" class="btn btn-sm btn-danger" data-hero-image-clear="true">Xóa tham chiếu màn hình đầu</button>
						</div>
						<p class="form-help" data-hero-image-status></p>
					</div>
				</div>
				<p class="appearance-note">Hỗ trợ kéo thả tải lên tự động điền, cũng hỗ trợ nhập thủ công /media/..., đường dẫn tuyệt đối trong trang hoặc liên kết https:// bên ngoài.</p>
				<div class="appearance-list-head">
					<h4>Nút trang chính</h4>
					<button type="button" class="btn" data-link-add="hero">+ Thêm nút</button>
				</div>
				<p class="appearance-note">Nút đầu tiên sử dụng kiểu chính, các nút khác sẽ tự động sử dụng kiểu phụ.</p>
				<div class="appearance-link-list" data-link-list="hero">
					${renderLinkRows(settings.heroActions, {
						labelName: "heroActionLabel",
						hrefName: "heroActionHref",
						labelText: "Văn bản nút",
						hrefText: "Liên kết nút",
						hrefPlaceholder: "/search",
						removeLabel: "Xóa",
					})}
				</div>
				<template data-link-template="hero">
					${renderLinkRow({
						labelName: "heroActionLabel",
						hrefName: "heroActionHref",
						labelText: "Văn bản nút",
						hrefText: "Liên kết nút",
						labelValue: "",
						hrefValue: "",
						hrefPlaceholder: "/search",
						removeLabel: "Xóa",
					})}
				</template>
			</section>
			<div class="appearance-stack">
				<section class="appearance-panel">
			<section class="appearance-panel">
				<h2>Thông số hình ảnh nền và thẻ</h2>
				<p class="appearance-note">Độ trong suốt 0% có nghĩa là hoàn toàn không trong suốt, 100% có nghĩa là hoàn toàn trong suốt; Thu phóng 0% có nghĩa là tỷ lệ gốc; Tiêu điểm ngang/dọc 0% có nghĩa là hình ảnh ở giữa.</p>
				<div class="appearance-controls">
					<div class="appearance-range">
						<div class="appearance-range-meta">
							<label for="backgroundTransparency">Độ trong suốt nền</label>
							<span data-appearance-display="backgroundTransparency">${escapeHtml(String(backgroundTransparency))}%</span>
						</div>
						<input id="backgroundTransparency" name="backgroundTransparency" type="range" min="0" max="100" value="${escapeAttribute(String(backgroundTransparency))}" data-appearance-control="backgroundTransparency" />
					</div>
					<div class="appearance-range">
						<div class="appearance-range-meta">
							<label for="heroCardTransparency">Độ trong suốt thẻ trang chính</label>
							<span data-appearance-display="heroCardTransparency">${escapeHtml(String(heroCardTransparency))}%</span>
						</div>
						<input id="heroCardTransparency" name="heroCardTransparency" type="range" min="0" max="100" value="${escapeAttribute(String(heroCardTransparency))}" data-appearance-control="heroCardTransparency" />
					</div>
					<div class="appearance-range">
						<div class="appearance-range-meta">
							<label for="articlePanelTransparency">Độ trong suốt thẻ trang bài viết</label>
							<span data-appearance-display="articlePanelTransparency">${escapeHtml(String(articlePanelTransparency))}%</span>
						</div>
						<input id="articlePanelTransparency" name="articlePanelTransparency" type="range" min="0" max="100" value="${escapeAttribute(String(articlePanelTransparency))}" data-appearance-control="articlePanelTransparency" />
					</div>
					<div class="appearance-range">
						<div class="appearance-range-meta">
							<label for="backgroundScale">Thu phóng</label>
							<span data-appearance-display="backgroundScale">${escapeHtml(String(backgroundScaleOffset))}%</span>
						</div>
						<input id="backgroundScale" name="backgroundScale" type="range" min="0" max="80" value="${escapeAttribute(String(backgroundScaleOffset))}" data-appearance-control="backgroundScale" />
					</div>
					<div class="appearance-range">
						<div class="appearance-range-meta">
							<label for="backgroundBlur">Làm mờ Gaussian</label>
							<span data-appearance-display="backgroundBlur">${escapeHtml(String(settings.backgroundBlur))} px</span>
						</div>
						<input id="backgroundBlur" name="backgroundBlur" type="range" min="0" max="60" value="${escapeAttribute(String(settings.backgroundBlur))}" data-appearance-control="backgroundBlur" />
					</div>
					<div class="appearance-range">
						<div class="appearance-range-meta">
							<label for="heroCardBlur">Làm mờ thẻ trang chính</label>
							<span data-appearance-display="heroCardBlur">${escapeHtml(String(settings.heroCardBlur))} px</span>
						</div>
						<input id="heroCardBlur" name="heroCardBlur" type="range" min="0" max="48" value="${escapeAttribute(String(settings.heroCardBlur))}" data-appearance-control="heroCardBlur" />
					</div>
					<div class="appearance-range">
						<div class="appearance-range-meta">
							<label for="articlePanelBlur">Làm mờ thẻ trang bài viết</label>
							<span data-appearance-display="articlePanelBlur">${escapeHtml(String(settings.articlePanelBlur))} px</span>
						</div>
						<input id="articlePanelBlur" name="articlePanelBlur" type="range" min="0" max="48" value="${escapeAttribute(String(settings.articlePanelBlur))}" data-appearance-control="articlePanelBlur" />
					</div>
					<div class="appearance-range">
						<div class="appearance-range-meta">
							<label for="backgroundPositionX">Tiêu điểm ngang</label>
							<span data-appearance-display="backgroundPositionX">${escapeHtml(String(backgroundPositionXOffset))}%</span>
						</div>
						<input id="backgroundPositionX" name="backgroundPositionX" type="range" min="-50" max="50" value="${escapeAttribute(String(backgroundPositionXOffset))}" data-appearance-control="backgroundPositionX" />
					</div>
					<div class="appearance-range">
						<div class="appearance-range-meta">
							<label for="backgroundPositionY">Tiêu điểm dọc</label>
							<span data-appearance-display="backgroundPositionY">${escapeHtml(String(backgroundPositionYOffset))}%</span>
						</div>
						<input id="backgroundPositionY" name="backgroundPositionY" type="range" min="-50" max="50" value="${escapeAttribute(String(backgroundPositionYOffset))}" data-appearance-control="backgroundPositionY" />
					</div>
				</div>
			</section>
			<section class="appearance-panel">
				<h2>Văn bản thẻ thông tin bên phải</h2>
				<div class="form-group">
					<label for="heroSignalLabel">Nhãn thẻ bên phải</label>
					<input
						id="heroSignalLabel"
						name="heroSignalLabel"
						class="form-input"
						value="${escapeAttribute(settings.heroSignalLabel)}"
						maxlength="30"
					/>
				</div>
				<div class="form-group">
					<label for="heroSignalHeading">Tiêu đề thẻ bên phải</label>
					<input
						id="heroSignalHeading"
						name="heroSignalHeading"
						class="form-input"
						value="${escapeAttribute(settings.heroSignalHeading)}"
						maxlength="120"
					/>
				</div>
				<div class="form-group">
					<label for="heroSignalCopy">Mô tả thẻ bên phải</label>
					<textarea id="heroSignalCopy" name="heroSignalCopy" class="form-textarea" maxlength="300">${escapeHtml(settings.heroSignalCopy)}</textarea>
				</div>
				<div class="form-group">
					<label for="heroSignalImagePath">Đường dẫn hình ảnh thẻ bên phải (tùy chọn)</label>
					<input
						id="heroSignalImagePath"
						name="heroSignalImagePath"
						class="form-input appearance-key-input"
						value="${escapeAttribute(settings.heroSignalImagePath ?? "")}"
						maxlength="320"
						placeholder="/media/appearance/home/hero-signal.webp"
						data-signal-image-path-input="true"
					/>
					<div
						class="appearance-hero-uploader"
						data-signal-image-uploader="true"
						data-upload-url="/api/admin/media/upload-async"
						data-csrf-token="${escapeAttribute(csrfToken)}"
					>
						<input
							type="file"
							accept="${escapeAttribute(getAllowedMediaAcceptValue())}"
							class="appearance-upload-input"
							data-signal-image-file-input="true"
						/>
						<div
							class="appearance-upload-dropzone appearance-hero-dropzone"
							data-signal-image-dropzone="true"
							role="button"
							tabindex="0"
							aria-label="Kéo thả tệp hoặc nhấp để tải lên hình thẻ bên phải"
						>
							${
								settings.heroSignalImagePath
									? `<img src="${escapeAttribute(settings.heroSignalImagePath)}" alt="Xem trước hình thẻ bên phải" class="cover-preview-image" data-signal-image-preview="true" />`
									: `<div class="cover-empty" data-signal-image-empty="true">Kéo hình ảnh hoặc nhấp để tải lên hình thẻ bên phải</div>`
							}
						</div>
						<div class="appearance-background-actions">
							<button type="button" class="btn btn-sm" data-signal-image-select="true">Tải lên hình thẻ</button>
							<button type="button" class="btn btn-sm btn-danger" data-signal-image-clear="true">Xóa hình thẻ</button>
						</div>
						<p class="form-help" data-signal-image-status></p>
					</div>
				</div>
				<p class="appearance-note">Khi không tải lên, thẻ bên phải trang chính sẽ tiếp tục sử dụng kiểu không có hình ảnh hiện tại.</p>
				<div class="appearance-chip-grid">
					<div class="form-group">
						<label for="heroSignalChip1">Nhãn thẻ 1</label>
						<input
							id="heroSignalChip1"
							name="heroSignalChip1"
							class="form-input"
							value="${escapeAttribute(settings.heroSignalChip1)}"
							maxlength="24"
						/>
					</div>
					<div class="form-group">
						<label for="heroSignalChip2">Nhãn thẻ 2</label>
						<input
							id="heroSignalChip2"
							name="heroSignalChip2"
							class="form-input"
							value="${escapeAttribute(settings.heroSignalChip2)}"
							maxlength="24"
						/>
					</div>
					<div class="form-group">
						<label for="heroSignalChip3">Nhãn thẻ 3</label>
						<input
							id="heroSignalChip3"
							name="heroSignalChip3"
							class="form-input"
							value="${escapeAttribute(settings.heroSignalChip3)}"
							maxlength="24"
						/>
					</div>
				</div>
			</section>
			<section class="appearance-panel">
				<h2>Thanh thông tin bên trái trang bài viết</h2>
				<div class="form-group">
					<label for="articleSidebarAvatarPath">Đường dẫn avatar (tùy chọn)</label>
					<input
						id="articleSidebarAvatarPath"
						name="articleSidebarAvatarPath"
						class="form-input appearance-key-input"
						value="${escapeAttribute(settings.articleSidebarAvatarPath ?? "")}"
						maxlength="320"
						placeholder="/media/appearance/profile/avatar.webp"
					/>
					<p class="appearance-note">Hỗ trợ /media/..., đường dẫn tuyệt đối trong trang hoặc liên kết https:// bên ngoài.</p>
				</div>
				<div class="form-group">
					<label for="articleSidebarName">Tên thanh bên</label>
					<input
						id="articleSidebarName"
						name="articleSidebarName"
						class="form-input"
						value="${escapeAttribute(settings.articleSidebarName)}"
						maxlength="36"
					/>
				</div>
				<div class="form-group">
					<label for="articleSidebarBadge">Văn bản huy hiệu thanh bên</label>
					<input
						id="articleSidebarBadge"
						name="articleSidebarBadge"
						class="form-input"
						value="${escapeAttribute(settings.articleSidebarBadge)}"
						maxlength="24"
					/>
				</div>
				<div class="form-group">
					<label for="articleSidebarBio">Giới thiệu thanh bên</label>
					<textarea id="articleSidebarBio" name="articleSidebarBio" class="form-textarea" maxlength="320">${escapeHtml(settings.articleSidebarBio)}</textarea>
				</div>
			</section>
			<section class="appearance-panel">
				<h2>Giao diện mô hình AI (Tương thích OpenAI)</h2>
				<p class="appearance-note">Giao diện nội bộ được sử dụng để tạo tóm tắt tự động và SEO; Giao diện công khai dành cho khách truy cập trò chuyện, theo mặc định có giới hạn tốc độ, hạn ngạch và xác minh Turnstile để chống spam.</p>
				<div class="appearance-content-fieldset">
					<h3>Giao diện nội bộ (Tóm tắt tự động và SEO)</h3>
					<div class="form-group">
						<label>
							<input
								type="checkbox"
								name="aiInternalEnabled"
								value="1"
								${aiSettings.internal.enabled ? "checked" : ""}
							/>
							Bật tạo tự động AI nội bộ
						</label>
					</div>
					<div class="appearance-inline-grid">
						<div class="form-group">
							<label for="aiInternalBaseUrl">Địa chỉ cơ sở giao diện</label>
							<input
								id="aiInternalBaseUrl"
								name="aiInternalBaseUrl"
								class="form-input"
								value="${escapeAttribute(aiSettings.internal.baseUrl)}"
								maxlength="240"
								placeholder="https://api.openai.com/v1"
							/>
						</div>
						<div class="form-group">
							<label for="aiInternalModel">Tên mô hình</label>
							<input
								id="aiInternalModel"
								name="aiInternalModel"
								class="form-input"
								value="${escapeAttribute(aiSettings.internal.model)}"
								maxlength="120"
								placeholder="gpt-4o-mini"
							/>
						</div>
					</div>
					<div class="form-group">
						<label for="aiInternalApiKey">API Key</label>
						<input
							id="aiInternalApiKey"
							name="aiInternalApiKey"
							type="password"
							class="form-input"
							maxlength="400"
							autocomplete="off"
							placeholder="${escapeAttribute(internalApiPlaceholder)}"
							${internalApiDisabled}
						/>
						<p class="form-help">${escapeHtml(internalApiKeyHelp)}</p>
					</div>
				</div>
				<div class="appearance-content-fieldset">
					<h3>Giao diện công khai (Dự phòng)</h3>
					<div class="form-group">
						<label>
							<input
								type="checkbox"
								name="aiPublicEnabled"
								value="1"
								${aiSettings.public.enabled ? "checked" : ""}
							/>
							Bật giao diện AI công khai
						</label>
					</div>
					<div class="appearance-inline-grid">
						<div class="form-group">
							<label for="aiPublicBaseUrl">Địa chỉ cơ sở giao diện</label>
							<input
								id="aiPublicBaseUrl"
								name="aiPublicBaseUrl"
								class="form-input"
								value="${escapeAttribute(aiSettings.public.baseUrl)}"
								maxlength="240"
								placeholder="https://api.openai.com/v1"
							/>
						</div>
						<div class="form-group">
							<label for="aiPublicModel">Tên mô hình</label>
							<input
								id="aiPublicModel"
								name="aiPublicModel"
								class="form-input"
								value="${escapeAttribute(aiSettings.public.model)}"
								maxlength="120"
								placeholder="gpt-4o-mini"
							/>
						</div>
					</div>
					<div class="form-group">
						<label for="aiPublicApiKey">API Key</label>
						<input
							id="aiPublicApiKey"
							name="aiPublicApiKey"
							type="password"
							class="form-input"
							maxlength="400"
							autocomplete="off"
							placeholder="${escapeAttribute(publicApiPlaceholder)}"
							${publicApiDisabled}
						/>
						<p class="form-help">${escapeHtml(publicApiKeyHelp)}</p>
					</div>
				</div>
				<div class="appearance-content-fieldset">
					<h3>Công tắc giao diện MCP</h3>
					<div class="form-group">
						<label>
							<input
								type="checkbox"
								name="mcpEnabled"
								value="1"
								${settings.mcpEnabled ? "checked" : ""}
							/>
							Bật giao diện MCP (/api/mcp)
						</label>
						<p class="form-help">Sau khi tắt, ngay cả khi mang theo Bearer đúng, điểm cuối MCP cũng sẽ trả về 404.</p>
					</div>
				</div>
			</section>
			<section class="appearance-panel">
				<div class="appearance-actions">
					<button type="submit" class="btn btn-primary">Lưu cài đặt giao diện</button>
					<a href="/api/admin/media" class="btn">Mở thư viện phương tiện</a>
				</div>
			</section>
		</div>
	</form>
	`;
}

function renderAppearanceErrorPage(csrfToken: string, message: string) {
	return adminLayout(
		"Giao diện trang web",
		`<div class="alert alert-error">${escapeHtml(message)}</div><p><a href="/api/admin/appearance">Quay lại trang giao diện</a></p>`,
		{ csrfToken },
	);
}

function getAppearanceAlert(url: string) {
	const status = new URL(url).searchParams.get("status");
	switch (status) {
		case "saved":
			return { type: "success" as const, message: "Cài đặt giao diện đã được lưu" };
		case "uploaded":
			return {
				type: "success" as const,
				message: "Hình nền đã được tải lên và đặt làm hình nền hiện tại",
			};
		case "cleared":
			return { type: "success" as const, message: "Đã xóa tham chiếu hình nền hiện tại" };
		default:
			return undefined;
	}
}

appearance.use("*", requireAuth);

appearance.get("/", async (c) => {
	const session = getAuthenticatedSession(c);
	let settings = DEFAULT_SITE_APPEARANCE;
	let aiSettings = DEFAULT_AI_SETTINGS;

	try {
		settings = await getSiteAppearance(getDb(c.env.DB));
	} catch {
		// Khi D1 không được liên kết, quay về giao diện mặc định
	}
	try {
		aiSettings = await getAiSettings(getDb(c.env.DB));
	} catch {
		// Khi D1 không được liên kết, quay về cấu hình AI mặc định
	}
	const resolvedAi = resolveAiSettingsWithSecrets(aiSettings, c.env);

	return c.html(
		adminLayout(
			"Giao diện trang web",
			renderAppearancePage({
				csrfToken: session.csrfToken,
				settings,
				aiSettings: resolvedAi.settings,
				aiKeySource: resolvedAi.keySource,
				aiWebKeyStatus: {
					internalHasSavedKey: Boolean(aiSettings.internal.apiKey.trim()),
					publicHasSavedKey: Boolean(aiSettings.public.apiKey.trim()),
				},
				alert: getAppearanceAlert(c.req.url),
			}),
			{ csrfToken: session.csrfToken },
		),
	);
});

appearance.post("/", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = (await c.req.parseBody({ all: true })) as AppearanceFormBody;
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.text("Xác thực CSRF thất bại", 403);
	}

	const backgroundImageKey = getBodyText(body, "backgroundImageKey").trim();
	if (backgroundImageKey && !sanitizeMediaKey(backgroundImageKey)) {
		return c.html(
			renderAppearanceErrorPage(session.csrfToken, "Định dạng khóa hình nền không hợp lệ"),
			400,
		);
	}

	const backgroundTransparency = parseBodyNumber(
		body,
		"backgroundTransparency",
		"backgroundOpacity",
	);
	const unifiedCardTransparency = parseBodyNumber(
		body,
		"heroCardTransparency",
		"heroCardOpacity",
	);
	const unifiedCardBlur = parseBodyNumber(body, "heroCardBlur");
	const articlePanelTransparency = parseBodyNumber(
		body,
		"articlePanelTransparency",
		"articlePanelOpacity",
	);
	const articlePanelBlur = parseBodyNumber(body, "articlePanelBlur");
	const db = getDb(c.env.DB);
	const storedAiSettings = await getAiSettings(db).catch(
		() => DEFAULT_AI_SETTINGS,
	);
	const internalInputApiKey = getBodyText(body, "aiInternalApiKey").trim();
	const publicInputApiKey = getBodyText(body, "aiPublicApiKey").trim();
	const useInternalSecret = Boolean(c.env.AI_INTERNAL_API_KEY?.trim());
	const usePublicSecret = Boolean(c.env.AI_PUBLIC_API_KEY?.trim());
	const nextInternalApiKey = useInternalSecret
		? storedAiSettings.internal.apiKey
		: internalInputApiKey || storedAiSettings.internal.apiKey;
	const nextPublicApiKey = usePublicSecret
		? storedAiSettings.public.apiKey
		: publicInputApiKey || storedAiSettings.public.apiKey;

	await saveSiteAppearance(db, {
		backgroundImageKey: backgroundImageKey || null,
		backgroundOpacity: convertTransparencyToOpacity(backgroundTransparency),
		backgroundBlur: parseBodyNumber(body, "backgroundBlur"),
		backgroundScale: 100 + parseBodyNumber(body, "backgroundScale"),
		backgroundPositionX: 50 + parseBodyNumber(body, "backgroundPositionX"),
		backgroundPositionY: 50 + parseBodyNumber(body, "backgroundPositionY"),
		heroCardOpacity: convertTransparencyToOpacity(unifiedCardTransparency),
		heroCardBlur: unifiedCardBlur,
		postCardOpacity: convertTransparencyToOpacity(unifiedCardTransparency),
		postCardBlur: unifiedCardBlur,
		articlePanelOpacity: convertTransparencyToOpacity(articlePanelTransparency),
		articlePanelBlur,
		headerSubtitle: getBodyText(body, "headerSubtitle"),
		navLinks: buildLinkItemsFromBody(
			getBodyTexts(body, "navLinkLabel"),
			getBodyTexts(body, "navLinkHref"),
		),
		heroKicker: getBodyText(body, "heroKicker"),
		heroTitle: getBodyText(body, "heroTitle"),
		heroIntro: getBodyText(body, "heroIntro"),
		heroMainImagePath: getBodyText(body, "heroMainImagePath"),
		heroActions: buildLinkItemsFromBody(
			getBodyTexts(body, "heroActionLabel"),
			getBodyTexts(body, "heroActionHref"),
		),
		heroSignalLabel: getBodyText(body, "heroSignalLabel"),
		heroSignalHeading: getBodyText(body, "heroSignalHeading"),
		heroSignalCopy: getBodyText(body, "heroSignalCopy"),
		heroSignalImagePath: getBodyText(body, "heroSignalImagePath"),
		heroSignalChip1: getBodyText(body, "heroSignalChip1"),
		heroSignalChip2: getBodyText(body, "heroSignalChip2"),
		heroSignalChip3: getBodyText(body, "heroSignalChip3"),
		articleSidebarAvatarPath: getBodyText(body, "articleSidebarAvatarPath"),
		articleSidebarName: getBodyText(body, "articleSidebarName"),
		articleSidebarBadge: getBodyText(body, "articleSidebarBadge"),
		articleSidebarBio: getBodyText(body, "articleSidebarBio"),
		mcpEnabled: getBodyText(body, "mcpEnabled"),
	});
	await saveAiSettings(db, {
		aiInternalEnabled: getBodyText(body, "aiInternalEnabled"),
		aiInternalBaseUrl: getBodyText(body, "aiInternalBaseUrl"),
		aiInternalApiKey: nextInternalApiKey,
		aiInternalModel: getBodyText(body, "aiInternalModel"),
		aiPublicEnabled: getBodyText(body, "aiPublicEnabled"),
		aiPublicBaseUrl: getBodyText(body, "aiPublicBaseUrl"),
		aiPublicApiKey: nextPublicApiKey,
		aiPublicModel: getBodyText(body, "aiPublicModel"),
	});

	return c.redirect("/api/admin/appearance?status=saved");
});

appearance.post("/background/upload", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = (await c.req.parseBody({ all: true })) as AppearanceFormBody;
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.text("Xác thực CSRF thất bại", 403);
	}

	const file = getBodyFile(body, "file");
	if (!(file instanceof File)) {
		return c.html(
			renderAppearanceErrorPage(session.csrfToken, "Vui lòng chọn hình nền để tải lên"),
			400,
		);
	}

	if (!isAllowedImageMimeType(file.type)) {
		return c.html(
			renderAppearanceErrorPage(
				session.csrfToken,
				"Hình nền chỉ cho phép hình ảnh JPG, PNG, WEBP, AVIF hoặc GIF",
			),
			400,
		);
	}

	if (file.size > MAX_UPLOAD_BYTES) {
		return c.html(
			renderAppearanceErrorPage(
				session.csrfToken,
				"Hình nền không thể vượt quá 50 MB cho mỗi tệp",
			),
			400,
		);
	}

	const uploaded = await saveMediaObjectWithDedup({
		bucket: c.env.MEDIA_BUCKET,
		file,
		prefix: "appearance/background",
	});

	const currentSettings = await getSiteAppearance(getDb(c.env.DB)).catch(
		() => DEFAULT_SITE_APPEARANCE,
	);
	await saveSiteAppearance(getDb(c.env.DB), {
		...currentSettings,
		backgroundImageKey: uploaded.key,
	});

	return c.redirect("/api/admin/appearance?status=uploaded");
});

appearance.post("/background/clear", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = (await c.req.parseBody({ all: true })) as AppearanceFormBody;
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.text("Xác thực CSRF thất bại", 403);
	}

	const currentSettings = await getSiteAppearance(getDb(c.env.DB)).catch(
		() => DEFAULT_SITE_APPEARANCE,
	);
	await saveSiteAppearance(getDb(c.env.DB), {
		...currentSettings,
		backgroundImageKey: null,
	});

	return c.redirect("/api/admin/appearance?status=cleared");
});

export { appearance as appearanceRoutes };
