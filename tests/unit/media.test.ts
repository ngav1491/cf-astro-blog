import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	computeFileContentHash,
	deleteMediaObjectAndIndex,
	isMediaHashIndexKey,
	saveMediaObjectWithDedup,
} from "../../src/lib/media";

interface StoredObject {
	body: Uint8Array;
	customMetadata?: Record<string, string>;
	httpMetadata?: { contentType?: string };
}

class InMemoryR2Bucket {
	private readonly store = new Map<string, StoredObject>();

	get keys() {
		return [...this.store.keys()];
	}

	async put(
		key: string,
		value: ArrayBuffer | ArrayBufferView | string,
		options?: {
			customMetadata?: Record<string, string>;
			httpMetadata?: { contentType?: string };
		},
	) {
		let body: Uint8Array;
		if (typeof value === "string") {
			body = new TextEncoder().encode(value);
		} else if (ArrayBuffer.isView(value)) {
			body = new Uint8Array(value.buffer.slice(0));
		} else {
			body = new Uint8Array(value.slice(0));
		}

		this.store.set(key, {
			body,
			customMetadata: options?.customMetadata,
			httpMetadata: options?.httpMetadata,
		});
	}

	async get(key: string) {
		const object = this.store.get(key);
		if (!object) {
			return null;
		}

		return {
			text: async () => new TextDecoder().decode(object.body),
			customMetadata: object.customMetadata,
			httpMetadata: object.httpMetadata,
		};
	}

	async head(key: string) {
		const object = this.store.get(key);
		if (!object) {
			return null;
		}

		return {
			key,
			size: object.body.byteLength,
			customMetadata: object.customMetadata,
		};
	}

	async delete(key: string) {
		this.store.delete(key);
	}
}

describe("媒体去重上传", () => {
	test("相同内容文件会复用同一个媒体对象", async () => {
		const bucket = new InMemoryR2Bucket();
		const fileA = new File(
			[new TextEncoder().encode("same-content")],
			"a.png",
			{
				type: "image/png",
			},
		);
		const fileB = new File(
			[new TextEncoder().encode("same-content")],
			"b.png",
			{
				type: "image/png",
			},
		);

		const first = await saveMediaObjectWithDedup({
			bucket: bucket as unknown as R2Bucket,
			file: fileA,
		});
		const second = await saveMediaObjectWithDedup({
			bucket: bucket as unknown as R2Bucket,
			file: fileB,
		});

		assert.equal(first.deduplicated, false);
		assert.equal(second.deduplicated, true);
		assert.equal(first.key, second.key);
		assert.equal(
			bucket.keys.filter((key) => isMediaHashIndexKey(key)).length,
			1,
		);
		assert.equal(
			bucket.keys.filter((key) => !isMediaHashIndexKey(key)).length,
			1,
		);
	});

	test("删除媒体对象时会同步删除对应内容哈希索引", async () => {
		const bucket = new InMemoryR2Bucket();
		const file = new File(
			[new TextEncoder().encode("content-for-delete")],
			"c.png",
			{
				type: "image/png",
			},
		);

		const uploaded = await saveMediaObjectWithDedup({
			bucket: bucket as unknown as R2Bucket,
			file,
		});

		await deleteMediaObjectAndIndex(
			bucket as unknown as R2Bucket,
			uploaded.key,
		);

		assert.equal(bucket.keys.length, 0);
	});

	test("会为文件生成稳定的 SHA-256 内容哈希", async () => {
		const file = new File([new TextEncoder().encode("hello")], "hash.png", {
			type: "image/png",
		});

		const hash = await computeFileContentHash(file);
		assert.equal(
			hash,
			"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	});
});
