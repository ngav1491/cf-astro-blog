import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	getInitialNavCondensedState,
	getNextNavCondensedState,
	NAV_CONDENSE_ENTER_Y,
	NAV_CONDENSE_EXIT_Y,
} from "../../src/lib/nav-condense";

describe("导航收缩状态机", () => {
	test("初始判定只会在进入阈值之后收缩", () => {
		assert.equal(getInitialNavCondensedState(NAV_CONDENSE_ENTER_Y - 1), false);
		assert.equal(getInitialNavCondensedState(NAV_CONDENSE_ENTER_Y), true);
	});

	test("展开状态在进入阈值之前不会提前抖动", () => {
		assert.equal(
			getNextNavCondensedState(NAV_CONDENSE_ENTER_Y - 1, false),
			false,
		);
		assert.equal(getNextNavCondensedState(NAV_CONDENSE_ENTER_Y, false), true);
	});

	test("已收缩状态会在滞回区内保持稳定", () => {
		const middleScrollY = Math.round(
			(NAV_CONDENSE_ENTER_Y + NAV_CONDENSE_EXIT_Y) / 2,
		);

		assert.equal(getNextNavCondensedState(middleScrollY, true), true);
		assert.equal(getNextNavCondensedState(middleScrollY, false), false);
	});

	test("已收缩状态只有回到退出阈值附近才会展开", () => {
		assert.equal(getNextNavCondensedState(NAV_CONDENSE_EXIT_Y + 1, true), true);
		assert.equal(getNextNavCondensedState(NAV_CONDENSE_EXIT_Y, true), false);
	});

	test("异常滚动值会被安全归零处理", () => {
		assert.equal(getInitialNavCondensedState(Number.NaN), false);
		assert.equal(getNextNavCondensedState(-999, true), false);
	});
});
