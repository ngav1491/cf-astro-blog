const ALLOWED_MEDIA_TYPES = new Map<string, string>([
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/webp", "webp"],
	["image/avif", "avif"],
	["image/gif", "gif"],
]);

const MEDIA_HASH_INDEX_PREFIX = "__index/media-hash/v1";
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/u;

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface MediaHashIndexRecord {
	contentHash: string;
	contentType: string;
	createdAt: string;
	key: string;
	size: number;
}

function isValidContentHash(value: string) {
	return CONTENT_HASH_PATTERN.test(value);
}

function toHex(bytes: Uint8Array) {
	return [...bytes]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("");
}

export function getAllowedMediaAcceptValue() {
	return [...ALLOWED_MEDIA_TYPES.keys()].join(",");
}

export function isAllowedImageMimeType(value: string) {
	return ALLOWED_MEDIA_TYPES.has(value);
}

export function buildMediaObjectKey(file: File, prefix = "uploads") {
	const extension = ALLOWED_MEDIA_TYPES.get(file.type);
	if (!extension) {
		throw new Error("仅允许上传 JPG、PNG、WEBP、AVIF 或 GIF 图片");
	}

	return `${prefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
}

export function buildMediaHashIndexKey(contentHash: string) {
	return `${MEDIA_HASH_INDEX_PREFIX}/${contentHash}.json`;
}

export function isMediaHashIndexKey(key: string) {
	return key.startsWith(`${MEDIA_HASH_INDEX_PREFIX}/`) && key.endsWith(".json");
}

export async function computeFileContentHash(file: File) {
	const buffer = await file.arrayBuffer();
	const digest = await crypto.subtle.digest("SHA-256", buffer);
	return toHex(new Uint8Array(digest));
}

async function readMediaHashIndex(
	bucket: R2Bucket,
	contentHash: string,
): Promise<MediaHashIndexRecord | null> {
	const indexKey = buildMediaHashIndexKey(contentHash);
	const indexObject = await bucket.get(indexKey);
	if (!indexObject) {
		return null;
	}

	try {
		const payload = JSON.parse(
			await indexObject.text(),
		) as Partial<MediaHashIndexRecord>;
		if (
			typeof payload.key !== "string" ||
			typeof payload.contentHash !== "string" ||
			typeof payload.contentType !== "string" ||
			typeof payload.createdAt !== "string" ||
			typeof payload.size !== "number"
		) {
			return null;
		}

		if (!isValidContentHash(payload.contentHash)) {
			return null;
		}

		return payload as MediaHashIndexRecord;
	} catch {
		return null;
	}
}

async function writeMediaHashIndex(
	bucket: R2Bucket,
	record: MediaHashIndexRecord,
) {
	const indexKey = buildMediaHashIndexKey(record.contentHash);
	await bucket.put(indexKey, JSON.stringify(record), {
		httpMetadata: { contentType: "application/json; charset=utf-8" },
	});
}

async function resolveExistingKeyFromHashIndex(
	bucket: R2Bucket,
	contentHash: string,
): Promise<string | null> {
	const record = await readMediaHashIndex(bucket, contentHash);
	if (!record?.key) {
		return null;
	}

	const existingObject = await bucket.head(record.key);
	if (existingObject) {
		return record.key;
	}

	await bucket.delete(buildMediaHashIndexKey(contentHash));
	return null;
}

export interface SaveMediaObjectResult {
	contentHash: string;
	deduplicated: boolean;
	key: string;
}

export async function saveMediaObjectWithDedup(options: {
	bucket: R2Bucket;
	file: File;
	prefix?: string;
}): Promise<SaveMediaObjectResult> {
	const { bucket, file, prefix = "uploads" } = options;
	const contentHash = await computeFileContentHash(file);
	const existingKey = await resolveExistingKeyFromHashIndex(
		bucket,
		contentHash,
	);
	if (existingKey) {
		return { key: existingKey, deduplicated: true, contentHash };
	}

	const key = buildMediaObjectKey(file, prefix);
	const contentType = getMediaContentTypeForKey(key) || file.type;
	const fileBuffer = await file.arrayBuffer();
	await bucket.put(key, fileBuffer, {
		httpMetadata: { contentType },
		customMetadata: {
			contentHash,
		},
	});

	// 并发上传同一文件时，后写入者复用已有索引并清理重复对象。
	const concurrentKey = await resolveExistingKeyFromHashIndex(
		bucket,
		contentHash,
	);
	if (concurrentKey && concurrentKey !== key) {
		await bucket.delete(key);
		return { key: concurrentKey, deduplicated: true, contentHash };
	}

	await writeMediaHashIndex(bucket, {
		key,
		contentHash,
		contentType,
		size: file.size,
		createdAt: new Date().toISOString(),
	});

	return { key, deduplicated: false, contentHash };
}

export async function deleteMediaObjectAndIndex(bucket: R2Bucket, key: string) {
	const existingObject = await bucket.head(key);
	await bucket.delete(key);

	const contentHash = existingObject?.customMetadata?.contentHash;
	if (!contentHash || !isValidContentHash(contentHash)) {
		return;
	}

	const indexedKey = await resolveExistingKeyFromHashIndex(bucket, contentHash);
	if (indexedKey === key) {
		await bucket.delete(buildMediaHashIndexKey(contentHash));
	}
}

export function getMediaContentTypeForKey(key: string): string | null {
	const extension = key.split(".").pop()?.toLowerCase();
	for (const [contentType, allowedExtension] of ALLOWED_MEDIA_TYPES.entries()) {
		if (allowedExtension === extension) {
			return contentType;
		}
	}

	return null;
}

export function isImageMediaKey(key: string) {
	return /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(key);
}

export function buildPublicImageHeaders(contentType: string) {
	return {
		"Content-Type": contentType,
		"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
		"X-Content-Type-Options": "nosniff",
	};
}
